/**
 * The satellites of generate_short: the standalone mask and music-bed
 * handlers, plus the post-render masking question that generate_short
 * attaches to a finished video. Split from tools-autoshort.ts to keep both
 * sides of the file-size cap.
 */
import { resolve } from 'node:path';
import { getOutputPath } from '../lib/paths.js';
import { describeRegion } from '../lib/pii.js';
import { addMusic } from '../tools/add-music.js';
import type { AutoShortResult } from '../tools/autoshort-types.js';
import { maskSensitive } from '../tools/mask.js';
import {
  fileResult,
  fileUrl,
  jsonContent,
  resolveInputPath,
  runWriteTool,
  safeOutputPath,
  withSilencedStdout,
  writeThumbnail,
} from './shared.js';

/**
 * Turn leftover scan hits into a question, or nothing when there are none.
 *
 * The regions are already in output pixels, so the answer is one
 * mask_sensitive call with `regions` - no second detection pass, and no
 * re-render of the Short.
 */
export function buildMaskQuestion(result: AutoShortResult): Record<string, unknown> | null {
  const pending = result.masking.pending;
  if (!pending || pending.length === 0) return null;
  const [w, h] = result.resolution.split('x').map(Number);
  return {
    id: 'masking',
    ask:
      `The scan found ${pending.length} region(s) in the finished Short that look like ` +
      'sensitive data. Nothing was covered. Should they be pixelated?',
    found: pending.map((r) => ({
      what: describeRegion(r, w, h),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    })),
    options: [
      'Leave it - the video above is final, do nothing',
      'Cover them - call mask_sensitive with this video as `path` and the `found` boxes ' +
        'as `regions`, which writes a masked copy alongside it',
    ],
    maps_to: 'mask_sensitive',
  };
}

export async function handleMaskSensitive({
  path,
  sample_fps,
  regions,
  blockiness,
  dry_run,
  output_path,
}: {
  path?: string;
  sample_fps?: number;
  regions?: Array<{ x: number; y: number; width: number; height: number }>;
  blockiness?: number;
  dry_run?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  return withSilencedStdout(async () => {
    const supplied = regions?.map((r) => ({ ...r, kinds: [] as never[] }));
    // Dry runs and no-op scans must not reserve an output path; they write
    // nothing, and a reserved placeholder would litter the folder.
    if (dry_run || supplied === undefined) {
      const probe = await maskSensitive({
        input,
        output: '',
        sampleFps: sample_fps,
        regions: supplied,
        blockiness,
        dryRun: true,
      });
      if (dry_run || probe.regions.length === 0) {
        return jsonContent({ ...probe, masked: false });
      }
      const desired = output_path ? resolve(output_path) : getOutputPath(input, '_masked');
      const output = safeOutputPath(input, desired);
      return runWriteTool(output, async () => {
        const result = await maskSensitive({
          input,
          output,
          regions: probe.regions,
          blockiness,
        });
        const thumbnail = await writeThumbnail(output);
        return fileResult(output, {
          ...result,
          masked: true,
          thumbnail,
          thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
        });
      });
    }

    const desired = output_path ? resolve(output_path) : getOutputPath(input, '_masked');
    const output = safeOutputPath(input, desired);
    return runWriteTool(output, async () => {
      const result = await maskSensitive({ input, output, regions: supplied, blockiness });
      const thumbnail = await writeThumbnail(output);
      return fileResult(output, {
        ...result,
        masked: true,
        thumbnail,
        thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
      });
    });
  });
}

export async function handleAddMusic({
  path,
  music,
  volume,
  duck,
  output_path,
}: {
  path?: string;
  music?: string;
  volume?: number;
  duck?: boolean;
  output_path?: string;
}) {
  const input = resolveInputPath(path);
  if (!music) throw new Error('`music` is required - a bundled mood or a path to audio.');
  const desired = output_path ? resolve(output_path) : getOutputPath(input, '_scored');
  const output = safeOutputPath(input, desired);
  return runWriteTool(output, () =>
    withSilencedStdout(async () => {
      const startedAt = Date.now();
      const result = await addMusic({ input, output, music, volume, duck });
      const thumbnail = await writeThumbnail(result.output);
      return fileResult(result.output, {
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        thumbnail,
        thumbnailUrl: thumbnail ? fileUrl(thumbnail) : null,
        duration: result.duration,
        ducked: result.ducked,
        music: {
          title: result.track.title,
          artist: result.track.artist,
          license: result.track.license,
          source: result.track.source,
        },
        next_steps: ['Show the user the `url`.'],
      });
    })
  );
}
