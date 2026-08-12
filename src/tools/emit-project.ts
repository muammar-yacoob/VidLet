import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
/**
 * Emit the edit autoshort just decided as a `.vidlet` project.
 *
 * The render is an opaque MP4: it shows the result but not the reasoning.
 * The project is the SAME edit as data - every kept span as its own clip
 * with the speed it plays at, the narration on the voice track, the bed on
 * the music track, the captions as subtitle entries - so it can be opened
 * in the browser editor, nudged, and re-rendered with render_project.
 *
 * This is emitted regardless of whether a render was asked for, which is
 * what makes "just give me the project" a real option: the expensive part
 * (deciding the edit) is already paid for by the analysis pass.
 */
import { basename, dirname, relative } from 'node:path';
import { getMediaDuration, getVideoInfo } from '../lib/ffmpeg.js';
import type { TimeSegment } from '../lib/segments.js';
import {
  type MediaEntry,
  VIDLET_FORMAT_VERSION,
  type VidletProject,
  serializeProject,
  sha256File,
} from '../lib/vidlet-project.js';

export interface EmitProjectInput {
  /** Where the .vidlet file goes. */
  output: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  /** Clips in story order, each with the spans kept from it. */
  clips: Array<{ source: string; spans: TimeSegment[] }>;
  /** Multiplier applied to the timelapse footage (not the intro). */
  speed: number;
  /** Per-clip rate when sections earned different shares of the runtime. */
  clipSpeeds?: number[];
  /** Intro clip played at natural speed, if any. */
  intro?: string;
  introSeconds: number;
  /** Narration audio and where each line starts on the timeline. */
  narration?: { path: string; start: number } | null;
  music?: { path: string; volume: number } | null;
  /** Caption lines, already on output time. */
  subtitles: Array<{ start: number; end: number; text: string }>;
}

/**
 * Build and write the project. Media are referenced by RELATIVE path plus a
 * sha256, per the format spec, so a project stays valid when the folder
 * moves and warns when a source has changed underneath it.
 */
export async function emitVidletProject(input: EmitProjectInput): Promise<string> {
  const projectDir = dirname(input.output);
  const media: MediaEntry[] = [];
  const videoClips: VidletProject['tracks']['video'] = [];

  const addMedia = async (path: string, kind: 'video' | 'audio'): Promise<string> => {
    const existing = media.find((m) => m.path === relative(projectDir, path));
    if (existing) return existing.id;
    const id = `m${media.length + 1}`;
    media.push({
      id,
      kind,
      name: basename(path),
      bytes: statSync(path).size,
      duration: await getMediaDuration(path),
      sha256: await sha256File(path),
      path: relative(projectDir, path),
    });
    return id;
  };

  let timeline = 0;

  // The intro plays whole and at natural speed, so it is one clip at 1x.
  if (input.intro && input.introSeconds > 0) {
    const id = await addMedia(input.intro, 'video');
    videoClips.push({
      id: 'intro',
      mediaId: id,
      start: 0,
      sourceIn: 0,
      duration: input.introSeconds,
      gain: 1,
      // The intro's own audio is never wanted under a narration.
      muted: true,
      speed: 1,
    });
    timeline = input.introSeconds;
  }

  // One clip per kept span: this is the cut list, laid end to end, at the
  // rate the timelapse plays. Editing means dragging these.
  let clipIndex = 0;
  for (const [ci, clip] of input.clips.entries()) {
    const mediaId = await addMedia(clip.source, 'video');
    const rate = input.clipSpeeds?.[ci] ?? input.speed;
    for (const span of clip.spans) {
      const sourceSpan = span.end - span.start;
      const onTimeline = sourceSpan / rate;
      videoClips.push({
        id: `c${++clipIndex}`,
        mediaId,
        start: Number(timeline.toFixed(3)),
        sourceIn: Number(span.start.toFixed(3)),
        duration: Number(onTimeline.toFixed(3)),
        gain: 1,
        muted: true, // narration carries the audio
        speed: Number(rate.toFixed(4)),
      });
      timeline += onTimeline;
    }
  }

  const voice: VidletProject['tracks']['voice'] = [];
  if (input.narration) {
    const id = await addMedia(input.narration.path, 'audio');
    voice.push({
      id: 'v1',
      mediaId: id,
      // The narration file already carries its own internal offsets, so it
      // starts at zero rather than at the first line's time.
      start: 0,
      sourceIn: 0,
      duration: await getMediaDuration(input.narration.path),
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      ducking: true,
    });
  }

  const music: VidletProject['tracks']['music'] = [];
  if (input.music) {
    const id = await addMedia(input.music.path, 'audio');
    music.push({
      id: 'mus1',
      mediaId: id,
      start: 0,
      sourceIn: 0,
      duration: Number(timeline.toFixed(3)),
      gain: input.music.volume,
      fadeIn: 1.5,
      fadeOut: 2,
      loop: true,
      ducking: false,
    });
  }

  const now = new Date().toISOString();
  const project: VidletProject = {
    vidlet: VIDLET_FORMAT_VERSION,
    meta: {
      title: input.title,
      createdAt: now,
      modifiedAt: now,
      generator: 'vidlet generate_short',
    },
    settings: {
      width: input.width,
      height: input.height,
      fps: input.fps,
      background: '#000000',
    },
    media,
    tracks: { video: videoClips, overlay: [], voice, music, sfx: [] },
    subtitles: {
      style: {
        fontFamily: 'DejaVu Sans',
        fontSize: Math.round(input.height / 20),
        color: '#FFFFFF',
        position: 'bottom',
        outline: true,
      },
      entries: input.subtitles.map((s, i) => ({
        id: `s${i + 1}`,
        start: Number(s.start.toFixed(3)),
        end: Number(s.end.toFixed(3)),
        text: s.text,
      })),
    },
  };

  await writeFile(input.output, serializeProject(project), 'utf8');
  return input.output;
}

/** Convention: the project sits beside the render, same stem. */
export function projectPathFor(videoPath: string): string {
  return `${videoPath.replace(/\.[^.]+$/, '')}.vidlet`;
}

/** Canvas the project should declare, given the source video info. */
export async function canvasFps(source: string): Promise<number> {
  try {
    return Math.min(30, (await getVideoInfo(source)).fps || 30);
  } catch {
    return 30;
  }
}
