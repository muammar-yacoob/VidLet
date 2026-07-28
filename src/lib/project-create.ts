/**
 * Build new `.vidlet` projects from a story source: an .srt/.vtt subtitle
 * file (cues with timings), a .txt/.md script (text only), or a
 * QuickPeek-style .json plan ({url?, steps:[...]}) whose step captions
 * become sequentially-timed subtitle cues.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, relative } from 'node:path';
import { execa } from 'execa';
import { getMediaDuration, getVideoInfo } from './ffmpeg.js';
import {
  type MediaEntry,
  type VidletProject,
  sha256File,
  vidletProjectSchema,
} from './vidlet-project.js';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SniffedSource {
  kind: 'subtitles' | 'script' | 'plan';
  cues: SubtitleCue[];
  /** Full narration text (cue/caption text joined, or the script itself). */
  script: string;
  /** Present for QuickPeek-style plans that carry a target URL. */
  url?: string;
}

const DEFAULT_SUBTITLE_STYLE = {
  fontFamily: 'Arial',
  fontSize: 28,
  color: '#FFFFFF',
  position: 'bottom' as const,
  outline: true,
};

// ============ CUE FILE PARSING (.srt / .vtt) ============

/** "00:00:01,500", "00:00:01.500" or "01:02.500" -> seconds. */
function parseCueTime(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/);
  if (!match) return null;
  const [, h = '0', m, s, frac] = match;
  const ms = Number.parseInt(frac.padEnd(3, '0').slice(0, 3), 10);
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + ms / 1000;
}

/** Shared .srt/.vtt cue parser: blocks with a "start --> end" timing line. */
function parseCueFile(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of content.replace(/\r/g, '').trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex === -1) continue; // WEBVTT header, NOTE/STYLE blocks, ...
    const [startRaw, endRaw] = lines[timingIndex].split('-->');
    // VTT cue settings ("position:10%") may trail the end time.
    const start = parseCueTime(startRaw);
    const end = parseCueTime(endRaw.trim().split(/\s+/)[0]);
    if (start === null || end === null) continue;
    const text = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

// ============ QUICKPEEK-STYLE PLAN PARSING (.json) ============

/** Roughly how long a caption stays readable, at ~15 chars/second. */
function estimateCueDuration(text: string): number {
  return Math.max(2, Math.round((text.length / 15) * 10) / 10);
}

function parsePlan(content: string): SniffedSource {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(`Plan file is not valid JSON: ${(e as Error).message}`);
  }
  const plan = raw as { url?: unknown; steps?: unknown };
  if (!Array.isArray(plan.steps)) {
    throw new Error(
      'JSON source is not a QuickPeek-style plan — expected { url?, steps: [...] } with a ' +
        'caption and optional duration per step.'
    );
  }
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (const step of plan.steps as Array<Record<string, unknown>>) {
    const caption = [step.caption, step.text, step.narration, step.say].find(
      (v) => typeof v === 'string' && v.trim()
    ) as string | undefined;
    const explicit = [step.duration, step.seconds, step.durationSeconds].find(
      (v) => typeof v === 'number' && v > 0
    ) as number | undefined;
    const duration = explicit ?? estimateCueDuration(caption ?? '');
    if (caption) cues.push({ start: cursor, end: cursor + duration, text: caption.trim() });
    cursor += duration; // caption-less steps still take up time
  }
  return {
    kind: 'plan',
    cues,
    script: cues.map((c) => c.text).join(' '),
    ...(typeof plan.url === 'string' ? { url: plan.url } : {}),
  };
}

// ============ SOURCE SNIFFING ============

export function sniffSource(sourcePath: string): SniffedSource {
  const ext = extname(sourcePath).toLowerCase();
  const content = readFileSync(sourcePath, 'utf8');
  if (ext === '.srt' || ext === '.vtt') {
    const cues = parseCueFile(content);
    if (cues.length === 0) throw new Error(`No subtitle cues found in ${sourcePath}.`);
    return { kind: 'subtitles', cues, script: cues.map((c) => c.text).join(' ') };
  }
  if (ext === '.json') return parsePlan(content);
  if (ext === '.txt' || ext === '.md') {
    const script = content.trim();
    if (!script) throw new Error(`Script file ${sourcePath} is empty.`);
    return { kind: 'script', cues: [], script };
  }
  throw new Error(
    `Unsupported source type "${ext}" — use .srt/.vtt subtitles, a .txt/.md script, or a QuickPeek-style .json plan.`
  );
}

// ============ PROJECT CONSTRUCTION ============

function packageVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
      if (typeof pkg?.name === 'string' && pkg.name.includes('vidlet')) {
        return pkg.version ?? '0.0.0';
      }
    } catch {
      // keep looking
    }
  }
  return '0.0.0';
}

export async function makeMediaEntry(
  id: string,
  kind: 'video' | 'image' | 'audio',
  absPath: string,
  projectDir: string
): Promise<MediaEntry> {
  const entry: MediaEntry = {
    id,
    kind,
    name: basename(absPath),
    bytes: statSync(absPath).size,
    sha256: await sha256File(absPath),
    path: relative(projectDir, absPath),
  };
  if (kind !== 'image') entry.duration = await getMediaDuration(absPath);
  return entry;
}

export interface BuildProjectOptions {
  source: SniffedSource;
  title: string;
  /** Directory the .vidlet file will live in (media paths are relative to it). */
  projectDir: string;
  videoPath?: string;
  musicPath?: string;
}

export async function buildProject(options: BuildProjectOptions): Promise<VidletProject> {
  const { source, title, projectDir, videoPath, musicPath } = options;
  const media: MediaEntry[] = [];
  const videoClips: Array<Record<string, unknown>> = [];
  const musicClips: Array<Record<string, unknown>> = [];
  let settings = { width: 1920, height: 1080, fps: 30, background: '#000000' };

  if (videoPath) {
    const info = await getVideoInfo(videoPath);
    settings = { width: info.width, height: info.height, fps: info.fps, background: '#000000' };
    const entry = await makeMediaEntry('m1', 'video', videoPath, projectDir);
    media.push(entry);
    videoClips.push({
      id: 'c1',
      mediaId: 'm1',
      start: 0,
      sourceIn: 0,
      duration: info.duration,
      gain: 1,
      muted: false,
    });
  }

  if (musicPath) {
    const id = `m${media.length + 1}`;
    const entry = await makeMediaEntry(id, 'audio', musicPath, projectDir);
    media.push(entry);
    musicClips.push({
      id: 'mus1',
      mediaId: id,
      start: 0,
      sourceIn: 0,
      duration: entry.duration ?? 1,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
      ducking: false,
    });
  }

  const now = new Date().toISOString();
  const project = {
    vidlet: 1,
    meta: {
      title,
      createdAt: now,
      modifiedAt: now,
      generator: `@spark-apps/vidlet/${packageVersion()}`,
    },
    settings,
    media,
    tracks: { video: videoClips, overlay: [], voice: [], music: musicClips, sfx: [] },
    subtitles: {
      style: DEFAULT_SUBTITLE_STYLE,
      entries: source.cues.map((cue, i) => ({
        id: `s${i + 1}`,
        start: Math.round(cue.start * 1000) / 1000,
        end: Math.round(cue.end * 1000) / 1000,
        text: cue.text,
      })),
    },
  };
  // Round-trip through the schema: sanity-checks our own output and fills defaults.
  return vidletProjectSchema.parse(project);
}

// ============ QUICKPEEK DETECTION ============

export interface QuickPeekInfo {
  installed: boolean;
  command: string | null;
}

/** Cheap PATH probe for the QuickPeek recorder — never shells out to run it. */
export async function detectQuickPeek(): Promise<QuickPeekInfo> {
  for (const command of ['quickpeek', 'qp']) {
    const result = await execa('which', [command], { reject: false });
    if (result.exitCode === 0) return { installed: true, command };
  }
  return { installed: false, command: null };
}
