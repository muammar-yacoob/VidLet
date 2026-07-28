/**
 * Render a `.vidlet` project (docs/vidlet-format.md, CC0 spec) to MP4 with
 * native ffmpeg. Shared by the CLI (`vidlet render`) and the MCP server's
 * render_project tool.
 *
 * Multi-pass, with temp intermediates in os.tmpdir() cleaned on exit:
 *   1. main track: each clip cut (sourceIn) and normalized to the canvas
 *      (aspect-fit + pad + fps); gaps become background color + silence;
 *      segments concatenated losslessly (mpegts + concat demuxer)
 *   2. overlays (free: scale fraction + x/y + opacity + enable window;
 *      cover: scale-to-cover + crop; loop tiles short media, non-loop holds
 *      the last frame) and burned subtitles, one filter_complex pass
 *   3. audio mixdown (render-audio.ts) when any audio track has clips
 *   4. mux with +faststart
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildConcatFileContent,
  checkFFmpeg,
  executeFFmpegRaw,
  getVideoInfo,
  hasGpuEncoder,
  videoEncoderArgs,
} from '../lib/ffmpeg.js';
import { changeExtension } from '../lib/paths.js';
import {
  type MediaEntry,
  type OverlayClip,
  type VideoClip,
  type VidletProject,
  parseProject,
  projectDuration,
  resolveProjectMedia,
} from '../lib/vidlet-project.js';
import { hasAudioClips, mixProjectAudio } from './render-audio.js';
import { uniquePath } from './voiceover.js';

export interface RenderProjectOptions {
  projectPath: string;
  /** Explicit output path. Default: VidLet/<name>.mp4 beside the project, never overwriting. */
  output?: string;
  /** Fast preview: x264 ultrafast, canvas capped at 1280x720. */
  draft?: boolean;
  /** "1920x1080" or "720p"-style override of the project canvas. */
  resolution?: string;
  onProgress?: (stage: string) => void;
}

export interface RenderProjectResult {
  output: string;
  duration: number;
  encoder: string;
}

interface Canvas {
  width: number;
  height: number;
}

interface RenderContext extends Canvas {
  fps: number;
  background: string;
  encArgs: string[];
  tmp: string;
}

const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
const GAP_EPSILON = 0.01;

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

export function parseResolution(spec: string, base: Canvas): Canvas {
  const wxh = spec
    .trim()
    .toLowerCase()
    .match(/^(\d+)x(\d+)$/);
  if (wxh) return { width: even(Number(wxh[1])), height: even(Number(wxh[2])) };
  const p = spec
    .trim()
    .toLowerCase()
    .match(/^(\d+)p$/);
  if (p) {
    const height = Number(p[1]);
    return { width: even((base.width * height) / base.height), height: even(height) };
  }
  throw new Error(
    `Bad resolution "${spec}" — use WIDTHxHEIGHT (e.g. 1920x1080) or a height like 720p.`
  );
}

function draftCanvas(canvas: Canvas): Canvas {
  const factor = Math.min(1, 1280 / canvas.width, 720 / canvas.height);
  if (factor >= 1) return canvas;
  return { width: even(canvas.width * factor), height: even(canvas.height * factor) };
}

// ============ SUBTITLES (ASS) ============

const ASS_ALIGNMENT = { bottom: 2, center: 5, top: 8 } as const;

/** "#RRGGBB" -> ASS "&H00BBGGRR" (BGR order). */
function hexToAssColor(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function toAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Build ASS for the project's subtitles block, or null when there are no entries. */
export function buildSubtitleAss(project: VidletProject, canvas: Canvas): string | null {
  const { style, entries } = project.subtitles;
  if (entries.length === 0) return null;
  // fontSize is specified against the project canvas; scale to the render canvas.
  const fontSize = Math.max(
    8,
    Math.round(style.fontSize * (canvas.height / project.settings.height))
  );
  const alignment = ASS_ALIGNMENT[style.position];
  const marginV = style.position === 'center' ? 0 : Math.max(10, Math.round(canvas.height * 0.04));
  const outline = style.outline ? Math.max(1, Math.round(fontSize / 16)) : 0;
  const color = hexToAssColor(style.color);

  const header = `[Script Info]
Title: VidLet Render
ScriptType: v4.00+
PlayResX: ${canvas.width}
PlayResY: ${canvas.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${fontSize},${color},${color},&H00202020,&H80000000,0,0,0,0,100,100,0,0,1,${outline},0,${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [...entries]
    .sort((a, b) => a.start - b.start)
    .map((entry) => {
      const text = entry.text.replace(/\r?\n/g, '\\N');
      return `Dialogue: 0,${toAssTime(entry.start)},${toAssTime(entry.end)},Default,,0,0,0,,${text}`;
    });
  return header + lines.join('\n');
}

/** Escape a path for use inside an ffmpeg filter graph (ass=...). */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ============ PASS 1: MAIN TRACK ============

async function encodeGapSegment(
  duration: number,
  ctx: RenderContext,
  index: number
): Promise<string> {
  const out = join(ctx.tmp, `seg-${index}.ts`);
  await executeFFmpegRaw([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${ctx.background}:s=${ctx.width}x${ctx.height}:r=${ctx.fps}:d=${n(duration)}`,
    '-f',
    'lavfi',
    '-t',
    n(duration),
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-vf',
    'format=yuv420p,setsar=1',
    ...ctx.encArgs,
    ...AUDIO_ARGS,
    '-t',
    n(duration),
    '-f',
    'mpegts',
    out,
  ]);
  return out;
}

async function encodeClipSegment(
  clip: VideoClip,
  media: MediaEntry,
  mediaPath: string,
  hasAudio: boolean,
  ctx: RenderContext,
  index: number
): Promise<string> {
  const out = join(ctx.tmp, `seg-${index}.ts`);
  const duration = clip.duration;
  const isImage = media.kind === 'image';
  const inputArgs = isImage
    ? ['-loop', '1', '-framerate', String(ctx.fps), '-t', n(duration), '-i', mediaPath]
    : ['-ss', n(clip.sourceIn), '-t', n(duration), '-i', mediaPath];

  // Aspect-fit onto the canvas, pad with the background color, normalize
  // fps; tpad clones the last frame if the source runs short of `duration`.
  const vf =
    `scale=${ctx.width}:${ctx.height}:force_original_aspect_ratio=decrease,` +
    `pad=${ctx.width}:${ctx.height}:(ow-iw)/2:(oh-ih)/2:color=${ctx.background},` +
    `fps=${ctx.fps},setsar=1,format=yuv420p,tpad=stop=-1:stop_mode=clone`;
  const useSourceAudio = !isImage && !clip.muted && hasAudio;
  const gainStep = clip.gain !== 1 ? `volume=${n(clip.gain)},` : '';
  const audioChain = useSourceAudio
    ? `[0:a]${gainStep}aformat=sample_rates=48000:channel_layouts=stereo,apad[a]`
    : '[1:a]anull[a]';

  await executeFFmpegRaw([
    '-y',
    ...inputArgs,
    '-f',
    'lavfi',
    '-t',
    n(duration),
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-filter_complex',
    `[0:v]${vf}[v];${audioChain}`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    ...ctx.encArgs,
    ...AUDIO_ARGS,
    '-t',
    n(duration),
    '-f',
    'mpegts',
    out,
  ]);
  return out;
}

async function renderMainTrack(
  project: VidletProject,
  files: Map<string, string>,
  mediaById: Map<string, MediaEntry>,
  audioByPath: Map<string, boolean>,
  totalDuration: number,
  ctx: RenderContext
): Promise<string> {
  const clips = [...project.tracks.video].sort((a, b) => a.start - b.start);
  const segments: string[] = [];
  let cursor = 0;
  let index = 0;

  for (const clip of clips) {
    if (clip.start > cursor + GAP_EPSILON) {
      segments.push(await encodeGapSegment(clip.start - cursor, ctx, index++));
    }
    const mediaPath = files.get(clip.mediaId) as string;
    const media = mediaById.get(clip.mediaId) as MediaEntry;
    const hasAudio = audioByPath.get(mediaPath) ?? false;
    segments.push(await encodeClipSegment(clip, media, mediaPath, hasAudio, ctx, index++));
    cursor = Math.max(cursor, clip.start + clip.duration);
  }
  if (totalDuration > cursor + GAP_EPSILON) {
    segments.push(await encodeGapSegment(totalDuration - cursor, ctx, index++));
  }

  if (segments.length === 1) return segments[0];
  const list = join(ctx.tmp, 'concat.txt');
  writeFileSync(list, buildConcatFileContent(segments), 'utf8');
  const out = join(ctx.tmp, 'base.ts');
  await executeFFmpegRaw(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  return out;
}

// ============ PASS 2: OVERLAYS + SUBTITLES ============

function overlayPrepChain(clip: OverlayClip, isImage: boolean, ctx: RenderContext): string {
  const steps: string[] = [];
  if (!isImage) {
    // loop: -stream_loop -1 upstream tiles the media; trim cuts the tiling.
    // non-loop: tpad clones the last frame through the clip window.
    steps.push(
      `trim=start=${n(clip.sourceIn)}${clip.loop ? `:end=${n(clip.sourceIn + clip.duration)}` : ''}`,
      `fps=${ctx.fps}`
    );
    if (!clip.loop) steps.push('tpad=stop=-1:stop_mode=clone');
  }
  if (clip.fit === 'cover') {
    steps.push(
      `scale=${ctx.width}:${ctx.height}:force_original_aspect_ratio=increase`,
      `crop=${ctx.width}:${ctx.height}`
    );
  } else {
    steps.push(`scale=${even(ctx.width * clip.scale)}:-2`);
  }
  if (clip.opacity < 1) steps.push('format=rgba', `colorchannelmixer=aa=${n(clip.opacity)}`);
  steps.push(`setpts=PTS-STARTPTS+${n(clip.start)}/TB`);
  return steps.join(',');
}

async function renderOverlaysAndSubtitles(
  project: VidletProject,
  files: Map<string, string>,
  mediaById: Map<string, MediaEntry>,
  basePath: string,
  assPath: string | null,
  ctx: RenderContext
): Promise<string> {
  const overlays = project.tracks.overlay;
  if (overlays.length === 0 && !assPath) return basePath;

  const args = ['-y', '-i', basePath];
  const chains: string[] = [];
  let current = '[0:v]';

  overlays.forEach((clip, i) => {
    const media = mediaById.get(clip.mediaId) as MediaEntry;
    const path = files.get(clip.mediaId) as string;
    if (media.kind === 'audio') {
      throw new Error(`Overlay clip "${clip.id}" references audio media "${media.name}".`);
    }
    const isImage = media.kind === 'image';
    if (isImage) {
      args.push('-loop', '1', '-framerate', String(ctx.fps), '-t', n(clip.duration), '-i', path);
    } else if (clip.loop) {
      args.push('-stream_loop', '-1', '-i', path);
    } else {
      args.push('-i', path);
    }
    chains.push(`[${i + 1}:v]${overlayPrepChain(clip, isImage, ctx)}[ov${i}]`);
    const x = clip.fit === 'cover' ? 0 : Math.round(clip.x * ctx.width);
    const y = clip.fit === 'cover' ? 0 : Math.round(clip.y * ctx.height);
    const window = `between(t,${n(clip.start)},${n(clip.start + clip.duration)})`;
    chains.push(`${current}[ov${i}]overlay=${x}:${y}:eof_action=pass:enable='${window}'[mix${i}]`);
    current = `[mix${i}]`;
  });

  if (assPath) {
    chains.push(`${current}ass='${escapeFilterPath(assPath)}'[vout]`);
    current = '[vout]';
  }

  const out = join(ctx.tmp, 'video.mp4');
  args.push(
    '-filter_complex',
    chains.join(';'),
    '-map',
    current,
    '-map',
    '0:a',
    '-c:a',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    ...ctx.encArgs,
    out
  );
  await executeFFmpegRaw(args);
  return out;
}

// ============ ORCHESTRATION ============

async function muxFinal(
  videoPath: string,
  audioPath: string | null,
  output: string,
  videoIsTs: boolean,
  duration: number
): Promise<void> {
  const args = ['-y', '-i', videoPath];
  if (audioPath) args.push('-i', audioPath, '-map', '0:v', '-map', '1:a');
  else args.push('-map', '0:v', '-map', '0:a');
  args.push('-c', 'copy');
  if (!audioPath && videoIsTs) args.push('-bsf:a', 'aac_adtstoasc');
  // Segment concat can overshoot by a frame or two (fps rounding per
  // segment) — cut the mux to the exact project duration.
  args.push('-t', n(duration), '-movflags', '+faststart', output);
  await executeFFmpegRaw(args);
}

export async function renderProject(options: RenderProjectOptions): Promise<RenderProjectResult> {
  const progress = options.onProgress ?? (() => {});
  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Install with: sudo apt install ffmpeg');
  }

  const projectPath = resolve(options.projectPath);
  const project = parseProject(readFileSync(projectPath, 'utf8'));
  const { files, warnings, missing } = await resolveProjectMedia(project, projectPath);
  for (const warning of warnings) progress(`warning: ${warning}`);
  if (missing.length > 0) {
    throw new Error(`Missing media:\n${missing.map((m) => `  ${m.name}: ${m.hint}`).join('\n')}`);
  }
  const mediaById = new Map(project.media.map((m) => [m.id, m]));
  const allClips = [
    ...project.tracks.video,
    ...project.tracks.overlay,
    ...project.tracks.voice,
    ...project.tracks.music,
    ...project.tracks.sfx,
  ];
  for (const clip of allClips) {
    if (!mediaById.has(clip.mediaId)) {
      throw new Error(`Clip "${clip.id}" references unknown media id "${clip.mediaId}".`);
    }
  }

  const totalDuration = projectDuration(project);
  if (totalDuration <= 0) throw new Error('Project is empty — nothing on any track to render.');

  let canvas: Canvas = { width: project.settings.width, height: project.settings.height };
  if (options.resolution) canvas = parseResolution(options.resolution, canvas);
  if (options.draft) canvas = draftCanvas(canvas);
  const encArgs = options.draft
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28']
    : await videoEncoderArgs();
  const encoder = options.draft
    ? 'libx264 (draft)'
    : (await hasGpuEncoder())
      ? 'h264_nvenc'
      : 'libx264';
  const output = options.output
    ? resolve(options.output)
    : uniquePath(changeExtension(projectPath, '.mp4'));

  // Probe each main-track media file once for an audio stream.
  const audioByPath = new Map<string, boolean>();
  for (const clip of project.tracks.video) {
    const path = files.get(clip.mediaId) as string;
    if (audioByPath.has(path) || mediaById.get(clip.mediaId)?.kind === 'image') continue;
    audioByPath.set(
      path,
      await getVideoInfo(path).then(
        (i) => i.hasAudio,
        () => false
      )
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), 'vidlet-render-'));
  const ctx: RenderContext = {
    ...canvas,
    fps: project.settings.fps,
    background: project.settings.background,
    encArgs,
    tmp,
  };
  try {
    progress('cutting main track');
    const base = await renderMainTrack(project, files, mediaById, audioByPath, totalDuration, ctx);

    const ass = buildSubtitleAss(project, canvas);
    let assPath: string | null = null;
    if (ass) {
      assPath = join(tmp, 'subtitles.ass');
      writeFileSync(assPath, ass, 'utf8');
    }
    if (project.tracks.overlay.length > 0 || assPath) progress('compositing overlays & subtitles');
    const video = await renderOverlaysAndSubtitles(project, files, mediaById, base, assPath, ctx);

    let audioPath: string | null = null;
    if (hasAudioClips(project)) {
      progress('mixing audio');
      audioPath = join(tmp, 'audio.m4a');
      await mixProjectAudio({
        project,
        files,
        basePath: base,
        output: audioPath,
        duration: totalDuration,
      });
    }

    progress('muxing');
    await muxFinal(video, audioPath, output, video === base, totalDuration);
    const info = await getVideoInfo(output);
    return { output, duration: Math.round(info.duration * 100) / 100, encoder };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
