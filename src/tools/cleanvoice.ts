import { checkFFmpeg, executeFFmpeg, executeFFmpegAnalysis, getVideoInfo } from '../lib/ffmpeg.js';
import { createSpinner, fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

export interface CleanVoiceOptions {
  input: string;
  output?: string;
  noiseReduction?: number;
  targetLoudness?: number;
}

export interface VoiceAnalysis {
  voiceStart: number;
  currentLoudness: number;
  suggestedNoiseReduction: number;
}

interface LoudnormMeasurements {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

const MIN_NOISE_PROFILE_DURATION = 0.3;

interface SilenceSegment {
  start: number;
  end: number;
}

export async function cleanVoice(options: CleanVoiceOptions): Promise<string> {
  const { input, output: customOutput, noiseReduction = 5, targetLoudness = -14 } = options;

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  const info = await getVideoInfo(input);
  if (!info.hasAudio) {
    throw new Error('Video has no audio stream to clean.');
  }

  const output = customOutput ?? getOutputPath(input, '_cleanvoice');

  header('Clean Voice');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Denoise:  ${fmt.yellow(`${noiseReduction}/10`)}`);
  console.log(`Loudness: ${fmt.yellow(`${targetLoudness} LUFS`)}`);
  separator();

  let spin = createSpinner('Analyzing audio...');
  try {
    // Pass 1: Find all silence gaps (pauses, breaths, room tone) for noise profiling
    const segments = await detectSilenceSegments(input);
    if (segments.length > 0) {
      const totalNoise = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
      spin.stop(`Noise:    ${fmt.yellow(`${segments.length} segments (${totalNoise.toFixed(1)}s)`)}`);
    } else {
      spin.stop(`Noise:    ${fmt.yellow('adaptive (no silence found)')}`);
    }

    const baseFilters = buildBaseFilters(segments, noiseReduction);

    // Pass 2: Measure loudness (lightweight — skip anlmdn to avoid double processing)
    spin = createSpinner('Measuring loudness...');
    const lightFilters = baseFilters.filter(
      (f) => !f.startsWith('anlmdn') && !f.startsWith('afftdn') && !f.startsWith('asendcmd')
    );
    const measurements = await measureLoudness(input, lightFilters, targetLoudness);
    spin.stop();

    // Pass 3: Apply full chain with calibrated loudnorm
    spin = createSpinner('Processing audio...');
    const loudnorm =
      `loudnorm=I=${targetLoudness}:TP=-3:LRA=11` +
      `:measured_I=${measurements.input_i}` +
      `:measured_TP=${measurements.input_tp}` +
      `:measured_LRA=${measurements.input_lra}` +
      `:measured_thresh=${measurements.input_thresh}` +
      `:offset=${measurements.target_offset}` +
      ':linear=true';

    const filters = [
      ...baseFilters,
      loudnorm,
      'alimiter=limit=0.85:attack=3:release=50:asc=1',
    ].join(',');

    await executeFFmpeg({
      input,
      output,
      args: [
        '-af',
        filters,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '256k',
        '-movflags',
        '+faststart',
      ],
    });
    spin.stop();
  } catch (err) {
    spin.stop();
    throw err;
  }

  success(`Output: ${output}`);
  return output;
}

/**
 * Find all silence segments across the entire audio.
 * These are gaps between speech (pauses, breaths, room tone) — ideal
 * for building a noise profile since they contain noise but no voice.
 */
async function detectSilenceSegments(input: string): Promise<SilenceSegment[]> {
  const stderr = await executeFFmpegAnalysis(input, [
    '-af',
    `silencedetect=n=-30dB:d=${MIN_NOISE_PROFILE_DURATION}`,
  ]);

  const segments: SilenceSegment[] = [];
  let pendingStart: number | null = null;

  for (const match of stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    const time = Number.parseFloat(match[2]);
    if (match[1] === 'start') {
      pendingStart = time;
    } else {
      // silence_end with no prior start means leading silence from t=0
      segments.push({ start: pendingStart ?? 0, end: time });
      pendingStart = null;
    }
  }

  return segments;
}

/** Derive voice start from first silence segment (for analyzeVoice) */
async function detectVoiceStart(input: string): Promise<number> {
  const segments = await detectSilenceSegments(input);
  if (segments.length > 0 && segments[0].start === 0) {
    return segments[0].end;
  }
  return 0;
}

async function measureLoudness(
  input: string,
  baseFilters: string[],
  targetLoudness: number
): Promise<LoudnormMeasurements> {
  const filters = [
    ...baseFilters,
    `loudnorm=I=${targetLoudness}:TP=-3:LRA=11:print_format=json`,
  ].join(',');

  const stderr = await executeFFmpegAnalysis(input, ['-af', filters]);

  const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse loudnorm measurements.');
  }

  const data = JSON.parse(jsonMatch[0]);
  return {
    input_i: data.input_i,
    input_tp: data.input_tp,
    input_lra: data.input_lra,
    input_thresh: data.input_thresh,
    target_offset: data.target_offset,
  };
}

function buildBaseFilters(segments: SilenceSegment[], noiseReduction: number): string[] {
  const filters: string[] = [];

  // Downmix to mono first — all subsequent filters process one channel
  filters.push('pan=mono|c0=0.5*c0+0.5*c1');

  // High-pass: remove rumble below 80Hz
  filters.push('highpass=f=80');

  // Low-pass: remove hiss above speech range (16kHz preserves voice harmonics)
  filters.push('lowpass=f=16000');

  // Noise reduction: FFT spectral denoising with noise profiling
  // Map user-facing scale (1-10) to noise reduction in dB (6-33)
  const nr = noiseReduction * 3 + 3;

  if (segments.length > 0) {
    // Sample noise from every silence gap — afftdn accumulates the profile
    const cmds = segments
      .map((s) => `${s.start.toFixed(3)} afftdn sn start;${s.end.toFixed(3)} afftdn sn stop`)
      .join(';');
    filters.push(`asendcmd=c='${cmds}'`);
    filters.push(`afftdn=nr=${nr}:nf=-30:tn=0`);
  } else {
    // No silence found — use adaptive noise tracking
    filters.push(`afftdn=nr=${nr}:nf=-30:tn=1`);
  }

  return filters;
}

export async function analyzeVoice(input: string): Promise<VoiceAnalysis> {
  const voiceStart = await detectVoiceStart(input);

  // Measure current loudness on raw audio
  const stderr = await executeFFmpegAnalysis(input, [
    '-af',
    'loudnorm=I=-14:TP=-3:LRA=11:print_format=json',
  ]);

  let currentLoudness = -24;
  const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[0]);
    currentLoudness = Number.parseFloat(data.input_i);
  }

  // Suggest denoise strength (afftdn scale: 1=subtle, 10=aggressive)
  let suggestedNoiseReduction = 3;
  if (voiceStart > 1.0) suggestedNoiseReduction = 7;
  else if (voiceStart >= MIN_NOISE_PROFILE_DURATION) suggestedNoiseReduction = 5;

  return { voiceStart, currentLoudness, suggestedNoiseReduction };
}
