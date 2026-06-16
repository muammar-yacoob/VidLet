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

export async function cleanVoice(options: CleanVoiceOptions): Promise<string> {
  const { input, output: customOutput, noiseReduction = 12, targetLoudness = -14 } = options;

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
  console.log(`Denoise:  ${fmt.yellow(`${noiseReduction} dB`)}`);
  console.log(`Loudness: ${fmt.yellow(`${targetLoudness} LUFS`)}`);
  separator();

  let spin = createSpinner('Analyzing audio...');
  try {
    // Pass 1: Detect where voice starts (noise profile boundary)
    const voiceStart = await detectVoiceStart(input);
    if (voiceStart > 0) {
      spin.stop(`Profile:  ${fmt.yellow(`0 → ${voiceStart.toFixed(2)}s`)}`);
    } else {
      spin.stop(`Profile:  ${fmt.yellow('auto (no leading silence)')}`);
    }

    const baseFilters = buildBaseFilters(voiceStart, noiseReduction);

    // Pass 2: Measure loudness through the processing chain
    spin = createSpinner('Measuring loudness...');
    const measurements = await measureLoudness(input, baseFilters, targetLoudness);
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

    const filters = [...baseFilters, loudnorm, 'alimiter=limit=0.85:attack=3:release=50:asc=1'].join(',');

    await executeFFmpeg({
      input,
      output,
      args: ['-af', filters, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
    });
    spin.stop();
  } catch (err) {
    spin.stop();
    throw err;
  }

  success(`Output: ${output}`);
  return output;
}

async function detectVoiceStart(input: string): Promise<number> {
  const stderr = await executeFFmpegAnalysis(input, ['-af', 'silencedetect=n=-30dB:d=0.2']);

  const match = stderr.match(/silence_end:\s*([\d.]+)/);
  if (!match) return 0;

  const silenceEnd = Number.parseFloat(match[1]);
  return silenceEnd >= MIN_NOISE_PROFILE_DURATION ? silenceEnd : 0;
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

function buildBaseFilters(voiceStart: number, noiseReduction: number): string[] {
  const filters: string[] = [];

  // Downmix to mono first — all subsequent filters process one channel
  filters.push('pan=mono|c0=0.5*c0+0.5*c1');

  // High-pass: remove rumble below 80Hz
  filters.push('highpass=f=80');

  // Low-pass: remove hiss above speech range (16kHz preserves voice harmonics)
  filters.push('lowpass=f=16000');

  // Noise reduction: non-local means (no FFT artifacts / robotic sound)
  filters.push(`anlmdn=s=${noiseReduction}:p=0.002:r=0.006:m=15`);

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

  // Suggest denoise strength (anlmdn scale: 1=subtle, 10=aggressive)
  let suggestedNoiseReduction = 3;
  if (voiceStart > 1.0) suggestedNoiseReduction = 7;
  else if (voiceStart >= MIN_NOISE_PROFILE_DURATION) suggestedNoiseReduction = 5;

  return { voiceStart, currentLoudness, suggestedNoiseReduction };
}
