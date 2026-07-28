/**
 * Audio mixdown for `.vidlet` rendering.
 *
 * Voice/music/sfx clips are trimmed (sourceIn), faded, gained, looped
 * (-stream_loop) and placed on the timeline with adelay, then mixed over
 * the main track's own audio. Voice clips with ducking:true form a
 * narration bus that sidechain-compresses everything else; the bus is
 * apad-ed so the compressor runs for the full program length — without it,
 * sidechaincompress hits EOF when the narration ends and truncates the mix.
 */
import { executeFFmpegRaw } from '../lib/ffmpeg.js';
import type { AudioClip, VidletProject } from '../lib/vidlet-project.js';

interface ClipRef {
  clip: AudioClip;
  path: string;
  ducking: boolean;
}

export function hasAudioClips(project: VidletProject): boolean {
  const { voice, music, sfx } = project.tracks;
  return voice.length + music.length + sfx.length > 0;
}

/** Compact number formatting for filter graphs (no trailing float noise). */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * Per-clip filter chain: cut the source range, normalize the format, apply
 * gain and fades, then shift onto the project timeline.
 */
function clipChain(ref: ClipRef, inputIndex: number, label: string): string {
  const { clip } = ref;
  const steps = [
    `atrim=start=${n(clip.sourceIn)}:end=${n(clip.sourceIn + clip.duration)}`,
    'asetpts=PTS-STARTPTS',
    'aformat=sample_rates=48000:channel_layouts=stereo',
  ];
  if (clip.gain !== 1) steps.push(`volume=${n(clip.gain)}`);
  if (clip.fadeIn > 0) steps.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`);
  if (clip.fadeOut > 0) {
    steps.push(
      `afade=t=out:st=${n(Math.max(0, clip.duration - clip.fadeOut))}:d=${n(clip.fadeOut)}`
    );
  }
  if (clip.start > 0) steps.push(`adelay=${Math.round(clip.start * 1000)}:all=1`);
  return `[${inputIndex}:a]${steps.join(',')}${label}`;
}

export interface MixProjectAudioOptions {
  project: VidletProject;
  /** mediaId -> absolute path (from resolveProjectMedia). */
  files: Map<string, string>;
  /** Main-track intermediate whose audio anchors the mix (full program length). */
  basePath: string;
  output: string;
  /** Total project duration in seconds — the mix is cut to exactly this. */
  duration: number;
}

/** Mix all audio tracks over the main-track audio into an AAC file. */
export async function mixProjectAudio(options: MixProjectAudioOptions): Promise<void> {
  const { project, files, basePath, output, duration } = options;

  const refs: ClipRef[] = [];
  const collect = (clips: AudioClip[], track: 'voice' | 'music' | 'sfx') => {
    for (const clip of clips) {
      const path = files.get(clip.mediaId);
      if (!path)
        throw new Error(`Audio clip "${clip.id}" references unknown media "${clip.mediaId}".`);
      refs.push({ clip, path, ducking: track === 'voice' && clip.ducking === true });
    }
  };
  collect(project.tracks.voice, 'voice');
  collect(project.tracks.music, 'music');
  collect(project.tracks.sfx, 'sfx');

  const args = ['-y', '-i', basePath];
  for (const ref of refs) {
    // loop:true tiles media shorter than the clip; atrim cuts the tiling.
    if (ref.clip.loop) args.push('-stream_loop', '-1');
    args.push('-i', ref.path);
  }

  const chains = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo[b0]'];
  const otherLabels = ['[b0]'];
  const duckLabels: string[] = [];
  refs.forEach((ref, i) => {
    const label = `[a${i}]`;
    chains.push(clipChain(ref, i + 1, label));
    (ref.ducking ? duckLabels : otherLabels).push(label);
  });

  // Everything that is NOT ducking narration mixes into one bus.
  let otherBus = otherLabels[0];
  if (otherLabels.length > 1) {
    chains.push(
      `${otherLabels.join('')}amix=inputs=${otherLabels.length}:duration=longest:normalize=0[ob]`
    );
    otherBus = '[ob]';
  }

  if (duckLabels.length > 0) {
    let narrationBus = duckLabels[0];
    if (duckLabels.length > 1) {
      chains.push(
        `${duckLabels.join('')}amix=inputs=${duckLabels.length}:duration=longest:normalize=0[nb]`
      );
      narrationBus = '[nb]';
    }
    chains.push(
      `${narrationBus}apad[nbp]`,
      '[nbp]asplit=2[sc][keep]',
      `${otherBus}[sc]sidechaincompress=threshold=0.05:ratio=10:attack=20:release=400[duck]`,
      '[duck][keep]amix=inputs=2:duration=first:normalize=0[aout]'
    );
  } else {
    chains.push(`${otherBus}anull[aout]`);
  }

  args.push(
    '-filter_complex',
    chains.join(';'),
    '-map',
    '[aout]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    n(duration),
    output
  );
  await executeFFmpegRaw(args);
}
