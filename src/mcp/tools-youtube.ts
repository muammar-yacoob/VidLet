/**
 * YouTube MCP tools: connect, gated upload, A/B rotation.
 *
 * The upload is NEVER one call. "upload to youtube" first verifies the
 * connection (returning a connect question when there is none), then
 * returns the full proposal - title variants with virality grades,
 * hashtags with real view counts, thumbnail candidates - as a question for
 * the human to approve. Only a re-call carrying confirm: true and the
 * approved fields touches the channel. Publishing to a real audience is
 * exactly the kind of action that must not happen as a side effect of
 * loose phrasing.
 */
import { existsSync } from 'node:fs';
import { fetchSharedTrends, fmtViews, suggestHashtags } from '../lib/hashtags.js';
import { connectYouTube, getChannel, loadTokens, tokenFilePath } from '../lib/youtube.js';
import {
  buildDescription,
  extractThumbnailCandidates,
  generateTitleVariants,
  publishShort,
  rotateAbTest,
  topicFromFilename,
} from '../tools/youtube-short.js';
import {
  fileUrl,
  jsonContent,
  resolveInputPath,
  type ToolDefinition,
  type ToolHandler,
  withSilencedStdout,
} from './shared.js';

export const YOUTUBE_TOOLS: ToolDefinition[] = [
  {
    name: 'connect_youtube',
    description:
      'Connect VidLet to a YouTube channel (first-time setup or reconnect). Opens the Google ' +
      'consent page via the vidlet.app OAuth broker - no Google client or API keys needed on ' +
      'this machine - and stores the refresh token in ~/.config/vidlet/youtube.json ' +
      '(owner-only permissions). Publishing is a VidLet Pro feature: a free account gets an ' +
      'upgrade link instead of a connection. Pass check_only to report connection state ' +
      'without opening a browser.',
    inputSchema: {
      type: 'object',
      properties: {
        check_only: {
          type: 'boolean',
          description: 'Just report whether a working connection exists.',
        },
      },
    },
  },
  {
    name: 'upload_to_youtube',
    description:
      'Publish a finished Short to the connected YouTube channel - with a human approval ' +
      'gate. First call: verifies the connection (returns a connect question if there is ' +
      'none), then generates three title variants (graded by a virality scorer), hashtags ' +
      'with real view counts from trending videos, and three thumbnail candidates from the ' +
      'video, and returns it all as a `questions` round WITHOUT uploading. Relay the ' +
      'proposal verbatim for approval; the user picks two of the three titles and thumbs as ' +
      'the A/B pair. Only a re-call with confirm: true and the approved fields uploads ' +
      '(resumable), sets the thumbnail, and starts an A/B test (variant A live, variant B ' +
      'stored in a sidecar for rotate_youtube_test). Result carries the YouTube url.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The finished video file.' },
        topic: {
          type: 'string',
          description:
            'What the video is about, for titles and hashtags. Defaults from the filename.',
        },
        narration: {
          type: 'string',
          description: 'The narration script, used for the description and better titles.',
        },
        link: { type: 'string', description: 'A link to include in the description.' },
        privacy: {
          type: 'string',
          enum: ['public', 'unlisted', 'private'],
          description: 'Default public - but only ever after explicit approval.',
        },
        confirm: {
          type: 'boolean',
          description: 'True ONLY after the user approved the proposal. Uploads immediately.',
        },
        title_a: { type: 'string', description: 'Approved variant-A title (confirm round).' },
        title_b: { type: 'string', description: 'Approved variant-B title (confirm round).' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Approved hashtags (confirm round).',
        },
        thumbnail_a: { type: 'string', description: 'Variant-A thumbnail image path.' },
        thumbnail_b: { type: 'string', description: 'Variant-B thumbnail image path.' },
        description: { type: 'string', description: 'Full description override (confirm round).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'rotate_youtube_test',
    description:
      'Advance the A/B test on an uploaded Short: snapshot the stats for the variant that was ' +
      'live, swap to the other title + thumbnail (videos.update + thumbnails.set), and report ' +
      'views-per-hour per variant with a winner once both have enough exposure. Three API ' +
      'calls per rotation. Rotate roughly daily; apply the winner permanently once the gap ' +
      'holds.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The local video file that was uploaded (its .youtube.json sidecar drives the test).',
        },
      },
      required: ['path'],
    },
  },
];

async function handleConnectYouTube({ check_only }: { check_only?: boolean }) {
  return withSilencedStdout(async () => {
    const tokens = loadTokens();
    if (check_only) {
      if (!tokens?.refresh_token) {
        return jsonContent({
          connected: false,
          reason:
            'No stored tokens. Call connect_youtube (no args) to open the consent flow - ' +
            'no keys or Google client setup needed.',
        });
      }
      try {
        const channel = await getChannel();
        return jsonContent({ connected: true, channel, token_file: tokenFilePath() });
      } catch (e) {
        return jsonContent({
          connected: false,
          reason: `Stored tokens failed: ${(e as Error).message}. Call connect_youtube to reconnect.`,
        });
      }
    }

    const channel = await connectYouTube();
    return jsonContent({
      connected: true,
      channel,
      token_file: tokenFilePath(),
      next_steps: [`Connected to "${channel.title}". upload_to_youtube is ready to use.`],
    });
  });
}

async function handleUploadToYouTube(args: {
  path?: string;
  topic?: string;
  narration?: string;
  link?: string;
  privacy?: 'public' | 'unlisted' | 'private';
  confirm?: boolean;
  title_a?: string;
  title_b?: string;
  tags?: string[];
  thumbnail_a?: string;
  thumbnail_b?: string;
  description?: string;
}) {
  const input = resolveInputPath(args.path);
  const topic = args.topic?.trim() || topicFromFilename(input);

  return withSilencedStdout(async () => {
    // ---- connection gate ----
    if (!loadTokens()?.refresh_token) {
      return jsonContent({
        questions: [
          {
            id: 'connect',
            ask: 'VidLet is not connected to a YouTube channel yet. Connect now?',
            options: [
              'Connect - call connect_youtube (opens a Google consent page in the browser), then call upload_to_youtube again',
              'Cancel the upload',
            ],
            maps_to: 'none',
          },
        ],
        next_steps: ['Nothing was uploaded.'],
      });
    }

    // ---- proposal round: generate everything, upload nothing ----
    if (!args.confirm) {
      let channel: Awaited<ReturnType<typeof getChannel>>;
      try {
        channel = await getChannel();
      } catch (e) {
        return jsonContent({
          questions: [
            {
              id: 'connect',
              ask: `The stored YouTube connection failed (${(e as Error).message}). Reconnect?`,
              options: ['Reconnect - call connect_youtube, then upload_to_youtube again', 'Cancel'],
              maps_to: 'none',
            },
          ],
          next_steps: ['Nothing was uploaded.'],
        });
      }

      // Shared trend cache first: one server-side YouTube+Groq fetch per
      // genre serves everyone, so this machine needs no keys of its own.
      const shared = await fetchSharedTrends(topic);
      const [titles, thumbs, hashtags] = await Promise.all([
        generateTitleVariants(topic, args.narration),
        extractThumbnailCandidates(input),
        shared
          ? Promise.resolve(shared.hashtags)
          : suggestHashtags({
              topic,
              description: args.narration,
              youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim(),
            }),
      ]);
      const description = buildDescription({
        narration: args.narration,
        link: args.link,
        tags: hashtags,
      });

      return jsonContent({
        questions: [
          {
            id: 'publish',
            ask: `Ready to publish to "${channel.title}" as ${args.privacy ?? 'public'}. Review the proposal: approve as-is, edit any field, or cancel. NOTHING has been uploaded yet.`,
            proposal: {
              channel: channel.title,
              privacy: args.privacy ?? 'public',
              // Three of each; the user picks two as the A/B pair.
              titles: titles.map((t) => ({
                text: t.title,
                grade: t.score.grade,
                score: t.score.total,
              })),
              thumbnails: {
                a: fileUrl(thumbs[0]),
                b: fileUrl(thumbs[1]),
                c: fileUrl(thumbs[2]),
              },
              hashtags: hashtags.map((h) => ({
                tag: h.tag,
                views: h.viewCount > 0 ? fmtViews(h.viewCount) : null,
                kind: h.kind,
              })),
              // Real titles from the genre's top/recent videos. YOU are a
              // language model - compose stronger A/B title variants from
              // these patterns and offer them alongside the graded three.
              trending_titles: (shared?.titles ?? []).map((t) => ({
                title: t.title,
                views: fmtViews(t.views),
                recent: t.recent,
              })),
              description,
            },
            options: [
              'Approve - re-call with confirm: true plus title_a, title_b (any two of the three titles), thumbnail_a, thumbnail_b (any two of the three thumbs), tags and description',
              'Edit - re-call with confirm: true and your edited versions of those fields',
              'Cancel - do not call again',
            ],
            maps_to: 'confirm',
          },
        ],
        // The confirm round reuses these verbatim - no external call re-runs.
        prepared: {
          title_a: titles[0].title,
          title_b: titles[1].title,
          tags: hashtags.map((h) => h.tag),
          thumbnail_a: thumbs[0],
          thumbnail_b: thumbs[1],
          description,
        },
        next_steps: [
          'Show the user the proposal: all three thumbnail urls, all three graded titles, ' +
            'and the hashtags. They pick two of each as the A/B pair (prepared defaults to ' +
            'the first two). Only after they approve, call again with confirm: true and the ' +
            'approved fields.',
        ],
      });
    }

    // ---- confirmed upload ----
    if (!args.title_a || !args.title_b) {
      throw new Error('confirm: true requires title_a and title_b from the approved proposal.');
    }
    const thumbA =
      args.thumbnail_a && existsSync(args.thumbnail_a)
        ? args.thumbnail_a
        : (await extractThumbnailCandidates(input))[0];
    const thumbB =
      args.thumbnail_b && existsSync(args.thumbnail_b)
        ? args.thumbnail_b
        : (await extractThumbnailCandidates(input))[1];

    const result = await publishShort({
      videoPath: input,
      titleA: args.title_a,
      titleB: args.title_b,
      thumbA,
      thumbB,
      description: args.description ?? args.narration ?? topic,
      tags: args.tags ?? [],
      privacyStatus: args.privacy ?? 'public',
    });

    return jsonContent({
      name: args.title_a,
      url: result.url,
      videoId: result.videoId,
      variant_live: 'a',
      ab_sidecar: result.sidecar,
      next_steps: [
        `Live at ${result.url} with variant A. In ~24h, call rotate_youtube_test with the same `,
        'path to switch to variant B and start comparing views per hour.',
      ],
    });
  });
}

async function handleRotateYouTubeTest({ path }: { path?: string }) {
  const input = resolveInputPath(path);
  return withSilencedStdout(async () => {
    const result = await rotateAbTest(input);
    return jsonContent({
      url: result.url,
      now_live: result.nowLive,
      now_live_title: result.nowLiveTitle,
      verdict: result.verdict,
      next_steps: [
        result.verdict.winner
          ? `Variant ${result.verdict.winner.toUpperCase()} is ahead - once the gap holds across rotations, stop rotating with it live.`
          : 'Rotate again after roughly a day of exposure.',
      ],
    });
  });
}

export const YOUTUBE_HANDLERS: Record<string, ToolHandler> = {
  connect_youtube: handleConnectYouTube,
  upload_to_youtube: handleUploadToYouTube,
  rotate_youtube_test: handleRotateYouTubeTest,
};
