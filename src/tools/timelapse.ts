/**
 * Timelapse - turn a long screen recording into a short, fast, watchable
 * clip: drop the idle stretches, speed up what's left, frame it 9:16, and
 * lay a progress bar + real-elapsed-time readout over the top.
 *
 * Why the source-time readout is not just `t * speed`: cutting idle spans
 * makes output time a piecewise-linear function of source time, so the
 * clock would drift further out with every cut. buildSourceTimeExpr rebuilds
 * the exact mapping as an ffmpeg expression instead.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFFmpeg, executeFFmpegWithProgress, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { detectIdleSpans } from '../lib/motion.js';
import { getOutputPath } from '../lib/paths.js';
import { type TimeSegment, invertSegments } from '../lib/segments.js';

export interface TimelapseOptions {
  input: string;
  output?: string;
  /** Playback multiplier applied after idle cutting. Default 15. */
  speed?: number;
  /** Drop static stretches before speeding up. Default true. */
  cutIdle?: boolean;
  /** Background music file. Looped and faded to fit; omit for a silent clip. */
  music?: string;
  /** Music level, 0-1. Default 0.35. */
  musicVolume?: number;
  /** Burn a progress bar + source-time readout. Default true. */
  overlay?: boolean;
  /** Frame the result 9:16 for Shorts. Default true. */
  portrait?: boolean;
  onProgress?: (stage: string) => void;
}

export interface TimelapseResult {
  output: string;
  sourceDuration: number;
  keptDuration: number;
  outputDuration: number;
  spans: number;
  speed: number;
  music: string | null;
}

const SHORT_WIDTH = 1080;
const SHORT_HEIGHT = 1920;
/** Progress bar height in the 1080x1920 frame. */
const BAR_HEIGHT = 14;

/** Fonts to try, in order, before falling back to fontconfig's `sans`. */
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
];

/** drawtext font option: a concrete file when we can find one, else fontconfig. */
export function resolveFontOption(candidates: string[] = FONT_CANDIDATES): string {
  const found = candidates.find((f) => existsSync(f));
  return found ? `fontfile='${found}'` : "font='sans'";
}

/** mm:ss, for the static "of NN:NN" half of the readout. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Map an output timestamp back to the source timestamp it came from.
 *
 * Kept spans are laid end to end in the output, so span i occupies output
 * [outStart_i, outStart_i + len_i/speed). Past the last span the value pins
 * to the final source time rather than running away.
 *
 * This deliberately stays in JS rather than becoming an ffmpeg expression:
 * an expression form needs one gated term per span (74 on a ten-minute
 * recording), embedded twice for mm and ss, which lands as a ~28KB drawtext
 * argument that the filter parser chokes on. The readout is burned as a
 * subtitle track instead — same house pattern as caption.ts.
 */
export function sourceTimeAt(spans: TimeSegment[], speed: number, t: number): number {
  if (spans.length === 0) return 0;
  let outStart = 0;
  for (const span of spans) {
    const outEnd = outStart + (span.end - span.start) / speed;
    if (t < outEnd) return span.start + Math.max(0, t - outStart) * speed;
    outStart = outEnd;
  }
  return spans[spans.length - 1].end;
}

/** ASS timestamp: H:MM:SS.cc */
function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

/**
 * An ASS track showing where in the ORIGINAL recording each output moment
 * sits. One cue per step (default 0.5s) — fine-grained enough to read as a
 * running clock, coarse enough to keep the file small.
 */
export function buildTimestampAss(opts: {
  spans: TimeSegment[];
  speed: number;
  outputDuration: number;
  sourceDuration: number;
  width: number;
  height: number;
  step?: number;
}): string {
  const { spans, speed, outputDuration, sourceDuration, width, height } = opts;
  const step = opts.step ?? 0.5;
  const fontSize = Math.round(height / 40);
  const marginV = Math.round(height / 22);
  const total = formatClock(sourceDuration);

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, ' +
      'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, ' +
      'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // BorderStyle 3 = opaque box drawn in BackColour, so the clock stays
    // readable over whatever the recording happens to be showing.
    `Style: Clock,DejaVu Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,` +
      `-1,0,0,0,100,100,0,0,3,6,0,2,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (let t = 0; t < outputDuration; t += step) {
    const end = Math.min(t + step, outputDuration);
    const label = `${formatClock(sourceTimeAt(spans, speed, t))} / ${total}`;
    lines.push(`Dialogue: 0,${assTime(t)},${assTime(end)},Clock,,0,0,0,,${label}`);
  }

  return `${lines.join('\n')}\n`;
}

/** Escape a path for use inside an ffmpeg filter argument. */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** ffmpeg `select` expression keeping only the given source spans. */
export function buildSelectExpr(spans: TimeSegment[]): string {
  return spans.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
}

/**
 * Build the full filtergraph. Split out so it can be unit-tested without
 * running ffmpeg, and written to a script file by the caller because these
 * graphs run to several kilobytes on a heavily-cut recording.
 */
export function buildFilterGraph(opts: {
  spans: TimeSegment[];
  speed: number;
  outputDuration: number;
  fps: number;
  portrait: boolean;
  overlay: boolean;
  hasMusic: boolean;
  musicVolume: number;
  /** ASS file with the source-time readout; omit to skip the clock. */
  timestampAssPath?: string;
}): string {
  const { spans, speed, outputDuration, fps, portrait, overlay, hasMusic } = opts;
  const chains: string[] = [];

  chains.push(
    `[0:v]select='${buildSelectExpr(spans)}',setpts=N/FRAME_RATE/TB,setpts=PTS/${speed},fps=${fps}[cut]`
  );

  let videoLabel = 'cut';
  if (portrait) {
    // Blurred, darkened copy of the frame fills the 9:16 canvas; the real
    // frame sits centred on top at its own aspect. A 320x360 capture has no
    // detail to gain from cropping, so pad rather than crop.
    chains.push('[cut]split=2[bg][fg]');
    chains.push(
      `[bg]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=increase,crop=${SHORT_WIDTH}:${SHORT_HEIGHT},gblur=sigma=32,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.4:thickness=fill[bgb]`
    );
    chains.push(
      `[fg]scale=${SHORT_WIDTH}:${SHORT_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos[fgs]`
    );
    chains.push('[bgb][fgs]overlay=(W-w)/2:(H-h)/2[padded]');
    videoLabel = 'padded';
  }

  if (overlay) {
    const font = resolveFontOption();
    const barY = `ih-${BAR_HEIGHT}`;
    // The clock rides in as a subtitle track; only the bar and the speed
    // badge need per-frame expressions, and neither contains a colon that
    // drawtext's option parser would misread.
    const clock = opts.timestampAssPath
      ? `,subtitles='${escapeFilterPath(opts.timestampAssPath)}'`
      : '';
    chains.push(
      `[${videoLabel}]drawbox=x=0:y=${barY}:w=iw:h=${BAR_HEIGHT}:color=white@0.18:thickness=fill,` +
        `drawbox=x=0:y=${barY}:w=iw*t/${outputDuration.toFixed(4)}:h=${BAR_HEIGHT}:color=0x00E5FFff:thickness=fill,` +
        `drawtext=${font}:text='${speed}x':fontcolor=0x00E5FFff:fontsize=52:` +
        `box=1:boxcolor=black@0.55:boxborderw=16:x=w-text_w-48:y=48${clock}[v]`
    );
    videoLabel = 'v';
  }

  if (videoLabel !== 'v') {
    chains.push(`[${videoLabel}]null[v]`);
  }

  if (hasMusic) {
    const fadeStart = Math.max(0, outputDuration - 2);
    chains.push(
      `[1:a]atrim=0:${outputDuration.toFixed(4)},asetpts=PTS-STARTPTS,` +
        `volume=${opts.musicVolume},afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${fadeStart.toFixed(4)}:d=2[a]`
    );
  }

  return chains.join(';\n');
}

/**
 * Cut, speed up, frame and score a screen recording in one ffmpeg pass.
 */
export async function timelapse(options: TimelapseOptions): Promise<TimelapseResult> {
  const { input, music } = options;
  const speed = options.speed ?? 15;
  const cutIdle = options.cutIdle !== false;
  const overlay = options.overlay !== false;
  const portrait = options.portrait !== false;
  const musicVolume = options.musicVolume ?? 0.35;
  const progress = options.onProgress ?? ((stage: string) => console.log(fmt.dim(`  ${stage}...`)));

  if (speed <= 0) throw new Error('`speed` must be greater than 0');
  if (music && !existsSync(music)) throw new Error(`Music file not found: ${music}`);

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg: sudo apt install ffmpeg');
  }

  const info = await getVideoInfo(input);
  const output = options.output ?? getOutputPath(input, '_timelapse');
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-timelapse-'));

  header('Timelapse');
  console.log(`Input:    ${fmt.white(input)} (${info.duration.toFixed(1)}s)`);
  console.log(`Speed:    ${fmt.yellow(`${speed}x`)}`);
  console.log(`Music:    ${music ? fmt.green(music) : fmt.dim('none')}`);
  separator();

  try {
    let spans: TimeSegment[] = [{ start: 0, end: info.duration }];
    if (cutIdle) {
      progress('detecting idle spans');
      const idle = await detectIdleSpans(input, info.duration, workDir);
      const active = invertSegments(info.duration, idle, { padding: 0.35, minLength: 0.8 });
      if (active.length > 0) spans = active;
    }

    const keptDuration = spans.reduce((sum, s) => sum + (s.end - s.start), 0);
    const outputDuration = keptDuration / speed;
    console.log(
      `Kept:     ${fmt.white(keptDuration.toFixed(1))}s of ${info.duration.toFixed(1)}s ` +
        `(${spans.length} span${spans.length === 1 ? '' : 's'}) → ${fmt.green(outputDuration.toFixed(1))}s out`
    );

    const fps = Math.min(30, info.fps || 30);

    let timestampAssPath: string | undefined;
    if (overlay) {
      timestampAssPath = join(workDir, 'clock.ass');
      writeFileSync(
        timestampAssPath,
        buildTimestampAss({
          spans,
          speed,
          outputDuration,
          sourceDuration: info.duration,
          width: portrait ? SHORT_WIDTH : info.width,
          height: portrait ? SHORT_HEIGHT : info.height,
        }),
        'utf8'
      );
    }

    const graph = buildFilterGraph({
      spans,
      speed,
      outputDuration,
      fps,
      portrait,
      overlay,
      hasMusic: !!music,
      musicVolume,
      timestampAssPath,
    });
    // Long graphs blow past shell/exec argument limits, so ffmpeg reads it
    // from disk instead of the command line.
    const graphPath = join(workDir, 'filtergraph.txt');
    writeFileSync(graphPath, graph, 'utf8');

    progress('rendering');
    const args: string[] = [];
    if (music) {
      // Loop the bed so a short track still covers the whole clip; atrim in
      // the graph cuts it back to length.
      args.push('-stream_loop', '-1', '-i', music);
    }
    args.push(
      '-filter_complex_script',
      graphPath,
      '-map',
      '[v]',
      ...(music ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    );

    await executeFFmpegWithProgress({
      input,
      output,
      args,
      expectedDuration: outputDuration,
    });

    success(`Output: ${output}`);
    return {
      output,
      sourceDuration: info.duration,
      keptDuration,
      outputDuration,
      spans: spans.length,
      speed,
      music: music ?? null,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
