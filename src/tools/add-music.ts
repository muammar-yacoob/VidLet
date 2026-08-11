/**
 * Lay a music bed onto a video that is already finished.
 *
 * The video stream is copied, never re-encoded, so scoring a rendered Short
 * costs a couple of seconds instead of a full render. That matters because
 * the bed is the thing people change their mind about most: picking a
 * different mood should not mean re-cutting, re-grading and re-burning
 * captions that were already right.
 */
import { existsSync } from 'node:fs';
import { executeFFmpegRaw, getMediaDuration, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { type ResolvedTrack, resolveMusicChoice } from '../lib/music.js';

export interface AddMusicOptions {
  input: string;
  output: string;
  /** Bundled mood, a path to an audio file, or "none". */
  music?: string;
  /** Bed level, 0-1. Default 0.08. */
  volume?: number;
  /** Duck the bed under existing speech. Default true. */
  duck?: boolean;
  /** Seconds of fade at each end. Default 1.5 in, 2 out. */
  fadeIn?: number;
  fadeOut?: number;
  onProgress?: (stage: string) => void;
}

export interface AddMusicResult {
  output: string;
  duration: number;
  track: ResolvedTrack;
  ducked: boolean;
  replacedExistingAudio: boolean;
}

/**
 * Audio graph for laying a bed under whatever the video already has.
 * Split out for unit tests: getting the sidechain wiring wrong is silent
 * (the bed simply never ducks) rather than an error.
 */
export function buildMusicGraph(opts: {
  hasSourceAudio: boolean;
  duration: number;
  volume: number;
  duck: boolean;
  fadeIn: number;
  fadeOut: number;
}): string {
  const { hasSourceAudio, duration, volume, duck, fadeIn, fadeOut } = opts;
  const fadeStart = Math.max(0, duration - fadeOut);
  const chains: string[] = [
    `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${duration.toFixed(3)},` +
      `asetpts=PTS-STARTPTS,volume=${volume},afade=t=in:st=0:d=${fadeIn},` +
      `afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOut}[bed]`,
  ];

  if (!hasSourceAudio) {
    chains.push('[bed]anull[a]');
    return chains.join(';');
  }

  // apad, because a narration track is routinely shorter than the picture.
  // Without it the mix ends when the voice does and the whole file gets
  // truncated to the narration, losing the tail of the video.
  chains.push('[0:a]aresample=48000,aformat=channel_layouts=stereo,apad[voice]');
  if (duck) {
    // The key has to be a separate copy of the voice: feeding one stream to
    // both the sidechain and the mix consumes it, and the bed never ducks.
    chains.push('[voice]asplit=2[vmix][vkey]');
    chains.push(
      '[bed][vkey]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=350[duckedbed]'
    );
    // A hard true-peak ceiling: amix with normalize=0 just sums the two
    // streams, and a voice peak lining up with a music peak can clip.
    chains.push(
      `[duckedbed][vmix]amix=inputs=2:duration=longest:normalize=0,atrim=0:${duration.toFixed(3)},alimiter=limit=0.891:level=disabled[a]`
    );
  } else {
    chains.push(
      `[bed][voice]amix=inputs=2:duration=longest:normalize=0,atrim=0:${duration.toFixed(3)},alimiter=limit=0.891:level=disabled[a]`
    );
  }
  return chains.join(';');
}

export async function addMusic(options: AddMusicOptions): Promise<AddMusicResult> {
  const { input, output } = options;
  const volume = options.volume ?? 0.08;
  const duck = options.duck !== false;
  const fadeIn = options.fadeIn ?? 1.5;
  const fadeOut = options.fadeOut ?? 2;
  const progress = options.onProgress ?? ((s: string) => console.log(fmt.dim(`  ${s}...`)));

  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  const track = resolveMusicChoice(options.music ?? 'auto');
  if (!track) {
    throw new Error(
      'No music resolved. Pass a bundled mood ("upbeat", "calm", "tense", "playful") or a path.'
    );
  }

  const info = await getVideoInfo(input);
  const duration = await getMediaDuration(input);

  header('Add Music');
  console.log(`Input:    ${fmt.white(input)} (${duration.toFixed(1)}s)`);
  console.log(`Bed:      ${fmt.green(track.title)} ${fmt.dim(`(${track.mood})`)}`);
  console.log(
    `Level:    ${fmt.yellow(String(volume))}${duck ? fmt.dim(', ducked under speech') : ''}`
  );
  console.log(`Video:    ${fmt.dim('stream copy, not re-encoded')}`);
  separator();

  progress('mixing');
  const graph = buildMusicGraph({
    hasSourceAudio: info.hasAudio,
    duration,
    volume,
    duck,
    fadeIn,
    fadeOut,
  });

  await executeFFmpegRaw([
    '-y',
    '-i',
    input,
    '-stream_loop',
    '-1',
    '-i',
    track.path,
    '-filter_complex',
    graph,
    '-map',
    '0:v',
    '-map',
    '[a]',
    // The whole point: the picture is untouched.
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-t',
    duration.toFixed(3),
    output,
  ]);

  success(`Output: ${output}`);
  return {
    output,
    duration,
    track,
    ducked: duck && info.hasAudio,
    replacedExistingAudio: !info.hasAudio,
  };
}
