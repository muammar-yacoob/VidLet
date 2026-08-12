/**
 * Numbers that shape the pacing of every Short.
 *
 * These are measured, not chosen: each one is here because a plausible
 * guess produced a visible fault in a rendered video. Shared by the
 * planning stage and the pipeline, so they cannot drift apart.
 */

/**
 * Words per second Edge neural TTS actually delivers (~175 wpm).
 *
 * Measured, not assumed. The word budget originally assumed 2.3, and the
 * narration ran out halfway through the video.
 */
export const TTS_WPS = 2.9;

/**
 * Fraction of the runtime narration should cover. Raised from 0.85, which
 * left long stretches of a Short silent and forced later sections to be
 * summarised in a line.
 */
export const NARRATION_COVERAGE = 0.92;

/**
 * Silence before the first word. Fixed rather than tunable-by-accident: a
 * Short has about a second to earn attention.
 *
 * Measured from the FIRST FRAME, not from the end of the intro. Measuring
 * from the intro put the opening line seven seconds in.
 */
export const DEFAULT_LEAD_IN = 0.7;

/** Picture kept after the last word, for the music to breathe out. */
export const DEFAULT_TAIL_PAD = 1.8;
