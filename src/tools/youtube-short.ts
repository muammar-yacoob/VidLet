/**
 * Orchestration for publishing a Short: title variants, thumbnail frames,
 * hashtags, the upload itself, and A/B rotation. The MCP layer supplies the
 * human gate; nothing here asks questions or uploads without being told.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { scoreYouTubeTitle, type TitleScore } from '@spark-apps/video-kit';
import {
  type AbSidecar,
  type AbVerdict,
  computeVerdict,
  nextVariant,
  sidecarPathFor,
} from '../lib/ab-test.js';
import { executeFFmpegRaw, getMediaDuration } from '../lib/ffmpeg.js';
import { groqChatJSON, rethrowIfDelegated } from '../lib/groq.js';
import { fetchSharedTrends, type HashtagSuggestion, suggestHashtags } from '../lib/hashtags.js';
import { getVideoStats, setThumbnail, updateVideoMeta, uploadVideo } from '../lib/youtube.js';

export interface TitleVariant {
  title: string;
  score: TitleScore;
}

/**
 * Three title candidates in different registers, scored with the ported
 * ViralCat model. One Groq call for all three.
 */
export async function generateTitleVariants(
  topic: string,
  narration?: string
): Promise<[TitleVariant, TitleVariant, TitleVariant]> {
  const fallbacks = [
    topic.slice(0, 65),
    `How I ${topic}`.slice(0, 65),
    `${topic} in Under a Minute`.slice(0, 65),
  ];
  const scored = (titles: string[]): [TitleVariant, TitleVariant, TitleVariant] =>
    titles.map((t) => ({ title: t, score: scoreYouTubeTitle(t) })) as [
      TitleVariant,
      TitleVariant,
      TitleVariant,
    ];
  if (!process.env.GROQ_API_KEY?.trim()) return scored(fallbacks);
  try {
    const result = await groqChatJSON<{ a?: string; b?: string; c?: string }>(
      [
        {
          role: 'system',
          content:
            'You write YouTube Shorts titles. Rules learned from top performers: 45-65 ' +
            'characters; strong opener ("How to...", "This tool...", "Why..."); at most ONE ' +
            'ALL-CAPS power word; include a number when honest; a parenthetical hook like ' +
            '"(Here\'s How)" works well; no emojis, no exclamation marks, never an em dash. ' +
            'Return JSON {"a": "<curiosity-driven title>", "b": "<benefit-driven title>", ' +
            '"c": "<process/transformation-driven title>"} - three genuinely different ' +
            'angles, not rephrasings.',
        },
        {
          role: 'user',
          content: `Topic: ${topic}\n${narration ? `Narration: ${narration.slice(0, 600)}` : ''}`,
        },
      ],
      undefined,
      'titles'
    );
    return scored([result.a, result.b, result.c].map((t, i) => (t ?? fallbacks[i]).slice(0, 100)));
  } catch (e) {
    rethrowIfDelegated(e);
    return scored(fallbacks);
  }
}

/**
 * Three thumbnail candidates pulled from the video itself, at 25%, 50% and
 * 75% - past the intro, before the outro. JPEG q4 keeps them far under the
 * 2MB thumbnails.set cap.
 */
export async function extractThumbnailCandidates(
  videoPath: string
): Promise<[string, string, string]> {
  const duration = await getMediaDuration(videoPath);
  const outs: string[] = [];
  for (const [label, frac] of [
    ['a', 0.25],
    ['b', 0.5],
    ['c', 0.75],
  ] as const) {
    const out = `${videoPath.replace(/\.[^.]+$/, '')}-yt-thumb-${label}.jpg`;
    await executeFFmpegRaw([
      '-y',
      '-ss',
      (duration * frac).toFixed(2),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-qscale:v',
      '4',
      out,
    ]);
    outs.push(out);
  }
  return [outs[0], outs[1], outs[2]];
}

export interface PublishSuggestions {
  titles: [TitleVariant, TitleVariant, TitleVariant];
  thumbnails: [string, string, string];
  hashtags: HashtagSuggestion[];
  /**
   * Real titles from the genre's top/recent videos (shared vidlet.app trend
   * cache). Raw material for the CALLING model to write its own variants -
   * an MCP caller is already an LLM, so no local Groq key is needed for
   * title writing.
   */
  trendingTitles: Array<{ title: string; views: number; recent: boolean }>;
}

/**
 * Everything worth showing right after a render, before any upload: three
 * graded titles, three thumbnail frames, and hashtags with real view counts
 * when a YouTube API key is configured. Failures degrade to null - a
 * suggestion block must never fail the render that produced the video.
 */
export async function suggestPublish(
  videoPath: string,
  topic: string,
  narration?: string
): Promise<PublishSuggestions | null> {
  try {
    // One shared-cache round trip covers hashtags AND trending titles;
    // suggestHashtags would otherwise fetch the same entry again.
    const shared = await fetchSharedTrends(topic);
    const [titles, thumbnails, hashtags] = await Promise.all([
      generateTitleVariants(topic, narration),
      extractThumbnailCandidates(videoPath),
      shared
        ? Promise.resolve(shared.hashtags)
        : suggestHashtags({
            topic,
            description: narration,
            youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim(),
          }),
    ]);
    return { titles, thumbnails, hashtags, trendingTitles: shared?.titles ?? [] };
  } catch {
    return null;
  }
}

/** Description: narration first, hashtag block last - the YouTube idiom. */
export function buildDescription(opts: {
  narration?: string;
  link?: string;
  tags: HashtagSuggestion[];
}): string {
  const parts: string[] = [];
  if (opts.narration) parts.push(opts.narration.trim());
  if (opts.link) parts.push(opts.link);
  if (opts.tags.length > 0) parts.push(opts.tags.map((t) => t.tag).join(' '));
  return parts.join('\n\n').slice(0, 5000);
}

export interface PublishInput {
  videoPath: string;
  titleA: string;
  titleB: string;
  thumbA: string;
  thumbB: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'public' | 'unlisted';
  onProgress?: (stage: string) => void;
}

export interface PublishResult {
  videoId: string;
  url: string;
  sidecar: string;
  variantLive: 'a';
}

/**
 * Upload variant A, set its thumbnail, and write the sidecar that makes the
 * A/B test resumable across sessions. The FIRST stats snapshot is taken at
 * upload time so the first rotation window has a baseline.
 */
export async function publishShort(input: PublishInput): Promise<PublishResult> {
  const { videoPath, onProgress } = input;
  const videoId = await uploadVideo(
    videoPath,
    {
      title: input.titleA,
      description: input.description,
      tags: input.tags,
      privacyStatus: input.privacyStatus,
    },
    onProgress
  );
  onProgress?.('setting thumbnail');
  await setThumbnail(videoId, input.thumbA);

  const url = `https://www.youtube.com/shorts/${videoId}`;
  const sidecar: AbSidecar = {
    videoId,
    url,
    a: { title: input.titleA, thumbnail: input.thumbA },
    b: { title: input.titleB, thumbnail: input.thumbB },
    active: 'a',
    description: input.description,
    tags: input.tags,
    snapshots: [{ variant: 'a', at: Date.now(), views: 0, likes: 0 }],
  };
  const sidecarPath = sidecarPathFor(videoPath);
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');
  return { videoId, url, sidecar: sidecarPath, variantLive: 'a' };
}

export interface RotateResult {
  videoId: string;
  url: string;
  nowLive: 'a' | 'b';
  nowLiveTitle: string;
  verdict: AbVerdict;
}

/**
 * Close the current variant's window (stats snapshot), apply the other
 * variant, and report which one is winning. Three API calls total.
 */
export async function rotateAbTest(videoPath: string): Promise<RotateResult> {
  const sidecarPath = sidecarPathFor(videoPath);
  if (!existsSync(sidecarPath)) {
    throw new Error(
      `No A/B sidecar at ${sidecarPath}. Only videos uploaded by upload_to_youtube can rotate.`
    );
  }
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as AbSidecar;

  const stats = await getVideoStats(sidecar.videoId);
  sidecar.snapshots.push({
    variant: sidecar.active,
    at: Date.now(),
    views: stats.views,
    likes: stats.likes,
  });

  const target = nextVariant(sidecar.active);
  const variant = sidecar[target];
  await updateVideoMeta(sidecar.videoId, {
    title: variant.title,
    description: sidecar.description,
    tags: sidecar.tags,
  });
  if (existsSync(variant.thumbnail)) {
    await setThumbnail(sidecar.videoId, variant.thumbnail);
  }
  sidecar.active = target;
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');

  return {
    videoId: sidecar.videoId,
    url: sidecar.url,
    nowLive: target,
    nowLiveTitle: variant.title,
    verdict: computeVerdict(sidecar.snapshots),
  };
}

/** Human-readable default topic from a slugged filename. */
export function topicFromFilename(videoPath: string): string {
  return basename(videoPath)
    .replace(/\.[^.]+$/, '')
    .replace(/-\d+$/, '')
    .replace(/-/g, ' ');
}
