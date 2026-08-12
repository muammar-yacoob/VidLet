/**
 * Turning an approved script into placed, spoken audio.
 *
 * Each sentence is its own take so it can be laid where the picture calls
 * for it, cached so an edit to one line does not re-speak the rest, and
 * checked against the runtime so the closing lines are never silently cut.
 * Split out of autoshort.ts to keep synthesis separate from rendering.
 */
import { join } from 'node:path';
import {
  allocateLinesToSections,
  fitBeatsToRuntime,
  planNarrationBeats,
  splitScriptSections,
  splitSentences,
  toSpokenForm,
} from '../lib/autoshort-plan.js';
import type { SectionWindow } from '../lib/autoshort-plan.js';
import { executeFFmpegRaw, getMediaDuration } from '../lib/ffmpeg.js';
import { putCached, takeCached, ttsKey } from '../lib/tts-cache.js';
import { generateNarrationAudio } from './voiceover.js';

/** Voice selection passed straight through to the TTS engine. */
export interface NarrationVoice {
  language?: string;
  gender?: 'female' | 'male';
}

export interface PlacedTake {
  path: string;
  text: string;
  start: number;
  duration: number;
}

export async function synthesizeNarration(
  script: string,
  workDir: string,
  leadIn: number,
  outputDuration: number,
  boundaries: number[],
  sections: SectionWindow[],
  /** Vision-derived start time per line, when alignment succeeded. */
  alignedStarts: number[] | null,
  options: NarrationVoice
): Promise<{ path: string; takes: PlacedTake[] }> {
  // An explicit `---` marker per clip beats any inference: the person who
  // recorded it knows which lines describe which footage.
  const declared = splitScriptSections(script);
  const useDeclared = declared.length > 1 && declared.length === sections.length;
  const sentences = splitSentences(script.replace(/^\s*-{3,}\s*$/gm, ' '));

  // Lines are independent takes, so they synthesise concurrently.
  const takes = await Promise.all(
    sentences.map(async (text, i) => {
      // The voice gets the spoken form; `text` stays as written, because
      // that is what the caption burns in. One script, two renderings.
      const spoken = toSpokenForm(text);
      const path = join(workDir, `line-${i}.mp3`);
      const key = ttsKey(spoken, { language: options.language, gender: options.gender });
      // A cached line makes a draft and its final render share the SAME
      // audio rather than two separate syntheses that merely sound alike,
      // and an edit to one sentence stops re-speaking all the others.
      if (!takeCached(key, path)) {
        await generateNarrationAudio({
          input: spoken,
          output: path,
          language: options.language,
          gender: options.gender,
        });
        putCached(key, path);
      }
      return { text, path, duration: await getMediaDuration(path) };
    })
  );

  // Vision placement knows what is on screen, so it wins - EXCEPT over an
  // explicit `---` marker. A declared section is the person who recorded
  // the footage saying which lines belong to which clip, and inference must
  // not overrule that. It did: every rigging line was placed at 19-43s
  // while the rigging clip did not start until 43s, so the whole second
  // half of the narration played over the modelling footage.
  if (alignedStarts && alignedStarts.length === takes.length && !useDeclared) {
    const beats = takes.map((t, i) => ({
      text: t.text,
      start: alignedStarts[i],
      duration: t.duration,
    }));
    const fitted = fitBeatsToRuntime(beats, outputDuration);
    return renderNarrationMix(fitted.beats, takes, workDir, fitted.overran);
  }

  // `outputDuration` here is already the runtime MINUS the end tail, so the
  // sections have to be clamped to it. Leaving them at the full runtime is
  // what let the closing line run to the final frame despite the padding.
  const usable = sections.map((w, i) => ({
    // The FIRST section may begin before its clip does: the opening beat is
    // measured from the first frame of the video, so narration talks over
    // an intro rather than waiting politely for it to finish. Anything else
    // meant a 6s intro pushed the first word to 7s.
    start: i === 0 ? Math.min(leadIn, w.start) : Math.min(w.start, outputDuration),
    end: Math.min(w.end, outputDuration),
  }));
  // Lines are allocated to the clip they describe, then placed inside that
  // clip's own window, so "then we rig it" cannot start while the modelling
  // footage is still on screen.
  // Declared sections map straight onto clips; otherwise fall back to
  // splitting by how long each clip runs.
  const groups = useDeclared
    ? (() => {
        const counts = declared.map((d) => splitSentences(d).length);
        const out: (typeof takes)[] = [];
        let at = 0;
        for (const n of counts) {
          out.push(takes.slice(at, at + n));
          at += n;
        }
        return out;
      })()
    : allocateLinesToSections(takes, usable);
  const beats: ReturnType<typeof planNarrationBeats> = [];
  groups.forEach((group, i) => {
    if (group.length === 0) return;
    const win = usable[i] ?? { start: leadIn, end: outputDuration };
    const placed = planNarrationBeats(
      group,
      boundaries.filter((b) => b >= win.start && b < win.end),
      win.end,
      Math.max(win.start, i === 0 ? leadIn : win.start)
    );
    beats.push(...placed);
  });

  // Placement above used ESTIMATED durations because the audio did not
  // exist yet. Now it does, so check the real thing actually fits.
  const fitted = fitBeatsToRuntime(beats, outputDuration);
  return renderNarrationMix(fitted.beats, takes, workDir, fitted.overran);
}

/** Lay each spoken take at its start time and mix them into one track. */
async function renderNarrationMix(
  beats: Array<{ text: string; start: number; duration: number }>,
  takes: Array<{ path: string }>,
  workDir: string,
  reflowed = false
): Promise<{ path: string; takes: PlacedTake[]; reflowed: boolean }> {
  const output = join(workDir, 'narration.m4a');

  // One line needs no mixing, just its offset.
  const inputs = takes.flatMap((t) => ['-i', t.path]);
  const delays = beats.map((b, i) => {
    const ms = Math.round(b.start * 1000);
    return `[${i}:a]adelay=${ms}|${ms}[d${i}]`;
  });
  const mix =
    beats.length === 1
      ? '[d0]anull[a]'
      : `${beats.map((_, i) => `[d${i}]`).join('')}amix=inputs=${beats.length}:duration=longest:normalize=0[a]`;

  await executeFFmpegRaw([
    '-y',
    ...inputs,
    '-filter_complex',
    `${delays.join(';')};${mix}`,
    '-map',
    '[a]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    output,
  ]);
  return {
    path: output,
    reflowed,
    takes: beats.map((b, i) => ({
      path: takes[i].path,
      text: b.text,
      start: b.start,
      duration: b.duration,
    })),
  };
}

/** Output-time window each clip occupies, after any intro. */
