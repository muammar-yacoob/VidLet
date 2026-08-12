/**
 * The public shape of an auto-short request and its result.
 *
 * Separated from the pipeline because this is the contract: the MCP tool
 * schema, the CLI flags and the tests all describe the same options, and
 * having them in one small file makes a mismatch obvious.
 */
import type { ResolvedTrack } from '../lib/music.js';

export interface AutoShortOptions {
  inputs: string[];
  /**
   * How near-square footage meets a 9:16 canvas. 'pad' (default) fits the
   * whole frame and fills the rest with a blurred copy, keeping every pixel
   * of a screen recording readable. 'crop' zooms until the content fills
   * the canvas, which looks properly full-screen but cuts the sides off -
   * on a 320x360 source that is 37% of the width, so side panels go.
   */
  fill?: 'pad' | 'crop';
  /** Narration text. Used verbatim when `scriptIsFinal`, else rewritten. */
  narration?: string;
  /** Skip the AI rewrite - this text was already approved by a human. */
  scriptIsFinal?: boolean;
  music?: string;
  /** Bed level, 0-1. Default 0.08 - it sits under the voice, not beside it. */
  musicVolume?: number;
  maxDuration?: number;
  captions?: boolean;
  /** Contrast boost on top of per-clip matching. Default 1.25. */
  contrast?: number;
  voiceover?: 'auto' | 'tts' | 'keep';
  /**
   * A call-to-action pinned near the top for the whole Short: the domain,
   * its favicon and an optional tagline. Speaking a URL never sounds
   * right, so this is where the address belongs.
   */
  cta?: { url: string; tagline?: string };
  /** Silence before the first word, so it does not open mid-syllable. */
  leadIn?: number;
  /**
   * Seconds of picture kept after the last word. Ending on the final
   * syllable feels like the file was truncated; a short tail lets the music
   * fade and the last frame land.
   */
  tailPad?: number;
  /**
   * A clip to open with, played at NATURAL speed. Intros are branding, not
   * footage: sweeping a 6s logo animation into an 18x timelapse would leave
   * a third of a second of nothing anyone can read.
   */
  intro?: string;
  /**
   * Place each narration line by LOOKING at the footage (Groq vision) so
   * the words describe what is on screen, rather than spacing lines
   * arithmetically. Default true; degrades silently to proportional
   * placement without a key.
   */
  alignToContent?: boolean;
  /**
   * Draft mode: small canvas, fastest encoder, no sensitive-data scan. For
   * approving timing, narration and captions before paying for the real
   * render - everything that decides the EDIT is identical, only the
   * pixels are cheap.
   */
  draft?: boolean;
  /** Reuse/populate the analysis cache. Default true. */
  cache?: boolean;
  /**
   * Write the edit as a .vidlet project beside the output. Default true:
   * the render shows the result, the project shows the reasoning, and the
   * expensive part (deciding the edit) is already paid for.
   */
  emitProject?: boolean;
  /**
   * Encode the video. Default true. Setting it false gives the project
   * without the render, for when the edit is going to be tweaked in the
   * editor anyway and encoding it first would be wasted work.
   */
  render?: boolean;
  /**
   * Scan the FINISHED Short for on-screen card numbers, emails, keys and
   * addresses and pixelate them. Default true. Deliberately run on the
   * output rather than the sources: only the frames that survived the cut
   * can leak anything, and there are a few dozen of them instead of tens of
   * thousands.
   */
  maskSensitive?: boolean;
  output?: string;
  language?: string;
  gender?: 'female' | 'male';
  onProgress?: (stage: string) => void;
}

export interface AutoShortResult {
  output: string;
  sourceDuration: number;
  keptDuration: number;
  outputDuration: number;
  speed: number;
  videos: number;
  spansKept: number;
  retakesDropped: number;
  voiced: boolean;
  narration: 'tts' | 'original-voice' | 'none';
  narrationSeconds: number;
  captionsBurned: boolean;
  /** Output canvas, chosen from how much detail the sources actually have. */
  resolution: string;
  /** True when this was a cheap draft rather than a publishable render. */
  draft: boolean;
  /** True when the analysis pass was served from cache. */
  cachedAnalysis: boolean;
  /** The .vidlet project describing this edit, when one was written. */
  project: string | null;
  /** False when only the project was produced. */
  rendered: boolean;
  /** Seconds of un-sped intro at the head, 0 when there is none. */
  introSeconds: number;
  /** Whether narration was placed by looking at the footage. */
  contentAligned: boolean;
  /** What the sensitive-data scan did, and why, so it is never silent. */
  masking: { scanned: boolean; regionsMasked: number; note?: string };
  music: ResolvedTrack | null;
  /** Wall-clock per stage, so a slow render can be attributed. */
  stageSeconds: Record<string, number>;
}
