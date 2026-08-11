/**
 * Short audible samples of the bundled beds, so a bed is chosen by ear
 * rather than by mood label. Written next to the project the user is
 * working on; each is a few seconds from the middle of the track, where it
 * has usually reached its main figure.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeFFmpegRaw } from '../lib/ffmpeg.js';
import { type ResolvedTrack, listBundledMusic } from '../lib/music.js';

export interface MusicPreview {
  mood: string;
  title: string;
  artist: string;
  license: string;
  path: string;
  seconds: number;
}

/** Seconds into the track to start the sample from. */
const SAMPLE_OFFSET = 20;

export async function previewMusic(opts: {
  outputDir: string;
  seconds?: number;
  /** Level to preview at - defaults to the level a Short actually uses. */
  volume?: number;
}): Promise<MusicPreview[]> {
  const seconds = opts.seconds ?? 10;
  const volume = opts.volume ?? 0.08;
  // The caller names a directory; it is not required to exist yet.
  mkdirSync(opts.outputDir, { recursive: true });
  const tracks: ResolvedTrack[] = listBundledMusic();
  const previews: MusicPreview[] = [];

  for (const track of tracks) {
    const out = join(opts.outputDir, `preview-${track.mood}.mp3`);
    const start = track.duration && track.duration > SAMPLE_OFFSET + seconds ? SAMPLE_OFFSET : 0;
    await executeFFmpegRaw([
      '-y',
      '-ss',
      String(start),
      '-i',
      track.path,
      '-t',
      String(seconds),
      // Previewed at the mix level it will actually sit at, plus a fade so
      // the sample does not click in and out.
      '-af',
      `volume=${volume},afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, seconds - 1)}:d=1,loudnorm=I=-18`,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      out,
    ]);
    previews.push({
      mood: track.mood,
      title: track.title,
      artist: track.artist,
      license: track.license,
      path: out,
      seconds,
    });
  }
  return previews;
}
