/**
 * Short - Turn a full landscape video into a YouTube Short.
 *
 * Pipeline: whisper.cpp transcript (local) → Groq LLM picks the most
 * engaging moments → motion tracking estimates where the action/cursor is
 * so the 9:16 crop follows it → segments stitched via portraitMultiSegment.
 *
 * Every run writes a `<output>.segments.json` sidecar; tweak times/cropX in
 * it and re-render with `--from-segments` (no AI call needed).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { checkFFmpeg, getVideoInfo } from '../lib/ffmpeg.js';
import { groqChatJSON } from '../lib/groq.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { estimateCropX } from '../lib/motion.js';
import { getOutputPath } from '../lib/paths.js';
import { type TranscriptSegment, type WhisperModel, transcribe } from '../lib/whisper.js';
import { type CaptionStyle, caption } from './caption.js';
import { type PortraitSegment, portraitMultiSegment } from './shorts.js';

export interface ShortOptions {
  input: string;
  output?: string;
  /** Target total length in seconds (YouTube Shorts limit is 60). Default 57. */
  maxDuration?: number;
  whisperModel?: WhisperModel;
  /** Burn styled captions into the finished short. */
  captions?: boolean;
  captionStyle?: CaptionStyle;
  /** Re-render from an edited segments JSON - skips transcription and AI. */
  fromSegments?: string;
  /** Also generate a ready-to-paste title/description/hashtags sidecar. */
  post?: boolean;
  resolution?: number;
  onProgress?: (stage: string) => void;
}

export interface ShortClip {
  start: number;
  end: number;
  reason?: string;
}

const clipsSchema = z.object({
  clips: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        reason: z.string().optional(),
      })
    )
    .min(1),
});

const sidecarSchema = z.object({
  segments: z
    .array(
      z.object({
        startTime: z.number(),
        endTime: z.number(),
        cropX: z.number().min(0).max(1),
        text: z.string().optional(),
        reason: z.string().optional(),
      })
    )
    .min(1),
});

export const MIN_CLIP_LENGTH = 1.5;
/** Clips closer than this are fused - the LLM often returns back-to-back
 * picks, and separate render segments would add pointless cuts/seams. */
export const MERGE_GAP = 0.5;

/**
 * Clamp, order, de-overlap and fuse near-contiguous LLM-picked clips, then
 * trim the total to maxTotal seconds (shortening from the last clip).
 */
export function sanitizeClips(
  clips: ShortClip[],
  videoDuration: number,
  maxTotal: number
): ShortClip[] {
  const cleaned = clips
    .map((c) => ({
      ...c,
      start: Math.max(0, Math.min(c.start, videoDuration)),
      end: Math.max(0, Math.min(c.end, videoDuration)),
    }))
    .filter((c) => c.end - c.start >= MIN_CLIP_LENGTH)
    .sort((a, b) => a.start - b.start);

  // Drop overlaps and fuse back-to-back clips into one continuous take.
  const result: ShortClip[] = [];
  for (const clip of cleaned) {
    const prev = result[result.length - 1];
    if (prev && clip.start - prev.end <= MERGE_GAP) {
      if (clip.end > prev.end) prev.end = clip.end;
      continue;
    }
    result.push({ ...clip });
  }

  // Enforce the total-duration budget.
  let total = 0;
  const budgeted: ShortClip[] = [];
  for (const clip of result) {
    const length = clip.end - clip.start;
    if (total + length <= maxTotal) {
      budgeted.push(clip);
      total += length;
    } else {
      const remaining = maxTotal - total;
      if (remaining >= MIN_CLIP_LENGTH) {
        budgeted.push({ ...clip, end: clip.start + remaining });
      }
      break;
    }
  }
  return budgeted;
}

/** Format transcript segments for the LLM prompt. */
export function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`)
    .join('\n');
}

async function pickHighlights(
  segments: TranscriptSegment[],
  videoDuration: number,
  maxTotal: number
): Promise<ShortClip[]> {
  const raw = await groqChatJSON<unknown>([
    {
      role: 'system',
      content:
        'You are a short-form video editor. Given a timestamped transcript, pick the moments ' +
        'that make the best YouTube Short: the hook, key insights, punchlines, demos, results. ' +
        'Rules: 2-6 clips, chronological, non-overlapping, each 3-20 seconds, total at most ' +
        `${maxTotal} seconds. Cut on sentence boundaries using ONLY the given timestamps. ` +
        'Prefer starting with the strongest hook. Respond with JSON: ' +
        '{"clips":[{"start":<sec>,"end":<sec>,"reason":"<short why>"}]}',
    },
    {
      role: 'user',
      content: `Video duration: ${videoDuration.toFixed(1)}s\n\nTranscript:\n${formatTranscript(segments)}`,
    },
  ]);

  const parsed = clipsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`AI returned an unexpected clip format: ${parsed.error.message.slice(0, 200)}`);
  }
  return sanitizeClips(parsed.data.clips, videoDuration, maxTotal);
}

/** Transcript text covered by a clip (stored in the sidecar for editing context). */
function clipText(segments: TranscriptSegment[], clip: ShortClip): string {
  return segments
    .filter((s) => s.end > clip.start && s.start < clip.end)
    .map((s) => s.text.trim())
    .join(' ')
    .slice(0, 200);
}

interface SidecarSegment extends PortraitSegment {
  text?: string;
  reason?: string;
}

const postSchema = z.object({
  title: z.string(),
  description: z.string(),
  hashtags: z.array(z.string()).min(3),
});

/**
 * Ready-to-paste YouTube/TikTok post copy from the picked clips.
 * Written to `<output>.post.txt`. Also reused by the demo tool.
 */
export async function generatePostCopy(
  segments: { text?: string; reason?: string }[],
  output: string
): Promise<string> {
  const content = segments
    .map((s) => `- ${s.text ?? ''}${s.reason ? ` (${s.reason})` : ''}`)
    .join('\n');

  const raw = await groqChatJSON<unknown>([
    {
      role: 'system',
      content:
        'You write viral YouTube Shorts metadata. Given the clips in a short, respond with JSON ' +
        '{"title": "<hooky, <=90 chars, no clickbait lies>", "description": "<2-3 sentences, ' +
        'plain human voice, one call to action>", "hashtags": ["<5-8 tags without #>"]}',
    },
    { role: 'user', content: `Clips in the short:\n${content}` },
  ]);

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) throw new Error('AI returned unexpected post format');

  const { title, description, hashtags } = parsed.data;
  const postFile = `${output}.post.txt`;
  writeFileSync(
    postFile,
    `${title}\n\n${description}\n\n${hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}\n`
  );
  return postFile;
}

export async function short(options: ShortOptions): Promise<string> {
  const {
    input,
    maxDuration = 57,
    whisperModel = 'base.en',
    resolution = 1080,
    onProgress,
  } = options;
  const progress = onProgress ?? ((stage: string) => console.log(fmt.dim(`  ${stage}...`)));

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const info = await getVideoInfo(input);
  const output = options.output ?? getOutputPath(input, '_short');

  header('AI Short');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(
    `Duration: ${fmt.white(`${info.duration.toFixed(1)}s`)} → target ≤ ${fmt.yellow(`${maxDuration}s`)}`
  );
  separator();

  let segments: SidecarSegment[];

  if (options.fromSegments) {
    progress('loading edited segments');
    const sidecarPath = resolve(options.fromSegments);
    if (!existsSync(sidecarPath)) throw new Error(`Segments file not found: ${sidecarPath}`);
    const parsed = sidecarSchema.safeParse(JSON.parse(readFileSync(sidecarPath, 'utf8')));
    if (!parsed.success) {
      throw new Error(`Invalid segments file: ${parsed.error.message.slice(0, 200)}`);
    }
    segments = parsed.data.segments.map((s, i) => ({ id: `clip-${i + 1}`, ...s }));
  } else {
    progress(`transcribing (whisper ${whisperModel})`);
    const transcript = await transcribe(input, { model: whisperModel, onProgress: progress });
    if (transcript.segments.length === 0) {
      throw new Error('Transcript is empty - is there speech in this video?');
    }

    progress('picking highlights (Groq)');
    const clips = await pickHighlights(transcript.segments, info.duration, maxDuration);
    if (clips.length === 0) {
      throw new Error('AI found no usable highlight clips in the transcript.');
    }
    console.log(`Clips:    ${fmt.green(String(clips.length))}`);
    for (const c of clips) {
      console.log(
        fmt.dim(`  ${c.start.toFixed(1)}s-${c.end.toFixed(1)}s  ${c.reason ?? ''}`.trimEnd())
      );
    }

    progress('tracking motion for crop positions');
    segments = [];
    for (const clip of clips) {
      const cropX = await estimateCropX(input, clip.start, clip.end, info.width, info.height);
      segments.push({
        id: `clip-${segments.length + 1}`,
        startTime: clip.start,
        endTime: clip.end,
        cropX: Number(cropX.toFixed(3)),
        text: clipText(transcript.segments, clip),
        reason: clip.reason,
      });
    }
  }

  // Sidecar first, so the plan survives even if rendering fails.
  const sidecar = `${output}.segments.json`;
  writeFileSync(sidecar, JSON.stringify({ input, resolution, segments }, null, 2));

  progress('rendering 9:16 short');
  const rendered = await portraitMultiSegment({ input, output, segments, resolution });

  let result = rendered;
  if (options.captions) {
    progress('burning captions');
    result = await caption({
      input: rendered,
      autoTranscribe: true,
      whisperModel,
      style: options.captionStyle ?? 'hormozi',
    });
  }

  if (options.post) {
    progress('writing post copy');
    try {
      const postFile = await generatePostCopy(segments, output);
      console.log(fmt.dim(`Post copy: ${postFile}`));
    } catch (err) {
      console.log(fmt.yellow(`Post copy skipped: ${(err as Error).message.slice(0, 120)}`));
    }
  }

  success(`Short: ${result}`);
  console.log(fmt.dim(`Adjust crops/times in ${sidecar}`));
  console.log(fmt.dim(`then re-render: vidlet short "${input}" --from-segments "${sidecar}"`));
  return result;
}
