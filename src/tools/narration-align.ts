/**
 * Align narration to what is actually on screen.
 *
 * Placing lines by arithmetic - evenly, or in proportion to each clip's
 * length - only works if the script happens to describe the footage at a
 * constant rate. It does not: "then I rig it" arrives when the rigging
 * starts, which is wherever the maker happened to get to. Proportional
 * placement put the armature narration over modelling footage.
 *
 * So VidLet looks. Frames are sampled across the FINISHED timeline, a
 * vision model says what each shows, and a language model assigns each line
 * to the moment it belongs to. Both calls are Groq. Without a key, or if
 * either call fails, the caller falls back to proportional placement, which
 * is worse but never worse than not rendering.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { outputTimeToSource } from '../lib/autoshort-plan.js';
import { executeFFmpegRaw } from '../lib/ffmpeg.js';
import { GROQ_MODELS, groqChatJSON, visionMessage } from '../lib/groq.js';
import type { TimeSegment } from '../lib/segments.js';
import { isOcrAvailable, parseTesseractTsv } from './mask.js';

/** Vision models to try, in order - Groq orgs enable different sets. */
const VISION_CANDIDATES = [GROQ_MODELS.VISION, 'groq/compound-mini'];

export interface TimelineFrame {
  /** Position in the finished Short. */
  outputTime: number;
  description: string;
}

/**
 * Sample frames evenly across the finished timeline and describe each.
 *
 * Frames come from the SOURCE at the mapped timestamp rather than from a
 * rendered file, so this runs before anything is encoded.
 */
export async function describeTimeline(opts: {
  clips: Array<{ source: string; spans: TimeSegment[] }>;
  speed: number;
  introSeconds: number;
  outputDuration: number;
  count?: number;
}): Promise<TimelineFrame[]> {
  const count = opts.count ?? 8;
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-align-'));
  try {
    const times: number[] = [];
    const frames: string[] = [];
    const jpegPaths: string[] = [];

    for (let i = 0; i < count; i++) {
      // Sample at the middle of each slice, not its edges: a boundary frame
      // is often mid-transition and describes neither side.
      const outputTime =
        opts.introSeconds + ((opts.outputDuration - opts.introSeconds) * (i + 0.5)) / count;
      const point = outputTimeToSource(opts.clips, opts.speed, opts.introSeconds, outputTime);
      if (!point) continue;
      const jpg = join(workDir, `k${i}.jpg`);
      try {
        await executeFFmpegRaw([
          '-y',
          '-ss',
          point.sourceTime.toFixed(2),
          '-i',
          opts.clips[point.clipIndex].source,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-1',
          '-q:v',
          '5',
          jpg,
        ]);
        frames.push(readFileSync(jpg).toString('base64'));
        jpegPaths.push(jpg);
        times.push(outputTime);
      } catch {
        // A frame we cannot grab is one fewer anchor, not a failure.
      }
    }
    if (frames.length === 0) return [];

    // Vision first, where the account has it.
    for (const model of VISION_CANDIDATES) {
      try {
        const { descriptions } = await groqChatJSON<{ descriptions: string[] }>(
          [
            {
              role: 'system',
              content:
                'You describe frames from a screen recording, in order. Say what STEP of the ' +
                'work each frame shows, concretely and in a few words (for example "modelling ' +
                'the body with a mirror modifier", "weight painting the armature"). Respond ' +
                'with JSON {"descriptions": ["<one per image, in order>"]}',
            },
            visionMessage('Frames in chronological order:', frames),
          ],
          model,
          'frame_descriptions'
        );
        if (Array.isArray(descriptions) && descriptions.length > 0) {
          return times
            .slice(0, descriptions.length)
            .map((outputTime, i) => ({ outputTime, description: descriptions[i] }));
        }
      } catch {
        // Model missing or blocked on this account - try the next.
      }
    }

    // No vision model available (this is common: Groq accounts routinely
    // have none enabled). Screen recordings label themselves though - a
    // Blender window says "Edit Mode", "Mirror", "Armature", "Vertex
    // Groups" - so read the UI text instead and use THAT as the
    // description. Same alignment, no vision required.
    // AWAIT, do not just return the promise: the finally below deletes the
    // frame files, and an un-awaited return lets that cleanup run first, so
    // tesseract was handed paths that no longer existed.
    return await describeByScreenText(jpegPaths, times);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Ask which sampled moment each line belongs to.
 *
 * Returns one frame index per line, in the order the lines were given, or
 * null when the model is unavailable or answers unusably. The caller is
 * responsible for making the answer playable; this only reports intent.
 */
export async function assignLinesToFrames(
  lines: string[],
  frames: TimelineFrame[]
): Promise<number[] | null> {
  if (frames.length === 0 || lines.length === 0) return null;
  const shots = frames.map((f, i) => `${i}: ${f.description}`).join('\n');
  const script = lines.map((l, i) => `${i}: ${l}`).join('\n');

  try {
    // Mechanical index-matching, not creative writing - the cheap tier does this fine.
    const { assignment } = await groqChatJSON<{ assignment: number[] }>(
      [
        {
          role: 'system',
          content:
            'You are syncing a voiceover to a screen recording. Given numbered moments from ' +
            'the video and numbered lines of narration, say which moment each line should be ' +
            'spoken over, so the words describe what is visible. The narration follows the ' +
            'video in order, so your numbers must never decrease. Several lines may share a ' +
            'moment. Respond with JSON {"assignment": [<one moment index per line, in line ' +
            'order>]}',
        },
        { role: 'user', content: `MOMENTS:\n${shots}\n\nNARRATION:\n${script}` },
      ],
      GROQ_MODELS.FAST,
      'frame_assignment'
    );
    if (!Array.isArray(assignment) || assignment.length === 0) return null;
    // Pad a short answer by repeating the last moment rather than dropping
    // the tail of the script.
    const filled = lines.map((_, i) =>
      Number.isFinite(assignment[i])
        ? Number(assignment[i])
        : (assignment[assignment.length - 1] ?? 0)
    );
    return filled;
  } catch {
    return null;
  }
}

/** Words too generic to say WHICH step of the work a frame shows. */
const CHROME_WORDS = new Set([
  'file',
  'edit',
  'render',
  'window',
  'help',
  'view',
  'select',
  'add',
  'object',
  'options',
  'search',
  'scene',
  'viewlayer',
  'user',
  'perspective',
  'playback',
  'keying',
  'item',
  'tool',
  'new',
  'open',
  'save',
  'close',
  'cancel',
  'confirm',
  'snap',
  'move',
  'rotate',
  'resize',
  'zoom',
  'pan',
  'collection',
]);

/**
 * Describe each moment by the interface text visible in it.
 *
 * A screen recording names its own state. Reading that is a far cheaper and
 * more reliable signal than describing pixels, and it works on accounts
 * with no vision model at all. Generic window chrome is dropped so what
 * survives is the part that distinguishes one step from another.
 */
async function describeByScreenText(
  jpegPaths: string[],
  times: number[]
): Promise<TimelineFrame[]> {
  if (!(await isOcrAvailable())) return [];
  const out: TimelineFrame[] = [];
  for (let i = 0; i < jpegPaths.length; i++) {
    try {
      const { stdout } = await execa('tesseract', [jpegPaths[i], 'stdout', '--psm', '11', 'tsv']);
      const words = parseTesseractTsv(stdout, 55)
        .map((w) => w.text.replace(/[^A-Za-z]/g, ''))
        .filter((w) => w.length > 2 && !CHROME_WORDS.has(w.toLowerCase()));
      const distinct = [...new Set(words)].slice(0, 25);
      if (distinct.length > 0) out.push({ outputTime: times[i], description: distinct.join(' ') });
    } catch {
      // A frame tesseract cannot read is one fewer anchor.
    }
  }
  return out;
}
