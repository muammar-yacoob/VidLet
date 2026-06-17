import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFFmpeg,
  executeFFmpeg,
  executeFFmpegAnalysis,
  executeFFmpegRaw,
  getVideoInfo,
} from '../lib/ffmpeg.js';
import { createSpinner, fmt, header, separator, success } from '../lib/logger.js';
import { getOutputPath } from '../lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RNNOISE_MODEL = join(__dirname, 'models', 'rnnoise.rnnn');
const DEEPFILTER_DIR = join(homedir(), '.config', 'vidlet', 'bin');
const DEEPFILTER_BIN = join(DEEPFILTER_DIR, 'deep-filter');
const DEEPFILTER_VERSION = '0.5.6';

export interface CleanVoiceOptions {
  input: string;
  output?: string;
  noiseReduction?: number;
  targetLoudness?: number;
  noiseSampleStart?: number;
  noiseSampleEnd?: number;
  onProgress?: (stage: string) => void;
}

export interface VoiceAnalysis {
  voiceStart: number;
  currentLoudness: number;
  suggestedNoiseReduction: number;
  noiseSampleStart: number | null;
  noiseSampleEnd: number | null;
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

type Engine = 'deepfilter' | 'rnnoise' | 'ffmpeg';

// Shared filter constants — standard studio vocal chain
const HIGHPASS = 'highpass=f=80';
const COMPRESSOR = 'acompressor=threshold=0.089:ratio=3:attack=10:release=100:knee=4:makeup=2';
const LIMITER = 'alimiter=limit=0.95:attack=5:release=50:asc=1';

function buildLoudnorm(measurements: LoudnormMeasurements, targetLoudness: number): string {
  return (
    `loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11` +
    `:measured_I=${measurements.input_i}` +
    `:measured_TP=${measurements.input_tp}` +
    `:measured_LRA=${measurements.input_lra}` +
    `:measured_thresh=${measurements.input_thresh}` +
    `:offset=${measurements.target_offset}` +
    ':linear=true'
  );
}

// ============ ENGINE RESOLUTION ============

function resolveEngine(): Engine {
  if (existsSync(DEEPFILTER_BIN)) return 'deepfilter';
  if (existsSync(RNNOISE_MODEL)) return 'rnnoise';
  return 'ffmpeg';
}

function getDeepFilterUrl(): string | null {
  const p = platform();
  const a = arch();
  const base = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DEEPFILTER_VERSION}`;
  if (p === 'linux' && a === 'x64')
    return `${base}/deep-filter-${DEEPFILTER_VERSION}-x86_64-unknown-linux-musl`;
  if (p === 'linux' && a === 'arm64')
    return `${base}/deep-filter-${DEEPFILTER_VERSION}-aarch64-unknown-linux-gnu`;
  if (p === 'darwin' && a === 'x64')
    return `${base}/deep-filter-${DEEPFILTER_VERSION}-x86_64-apple-darwin`;
  if (p === 'darwin' && a === 'arm64')
    return `${base}/deep-filter-${DEEPFILTER_VERSION}-aarch64-apple-darwin`;
  return null;
}

export async function ensureDeepFilter(): Promise<boolean> {
  if (existsSync(DEEPFILTER_BIN)) return true;

  const url = getDeepFilterUrl();
  if (!url) return false;

  mkdirSync(DEEPFILTER_DIR, { recursive: true });

  const { execaCommand } = await import('execa');
  try {
    await execaCommand(`curl -sL "${url}" -o "${DEEPFILTER_BIN}"`, { shell: true });
    chmodSync(DEEPFILTER_BIN, 0o755);
    return true;
  } catch {
    try {
      unlinkSync(DEEPFILTER_BIN);
    } catch {
      /* ignore */
    }
    return false;
  }
}

const ENGINE_LABELS: Record<Engine, string> = {
  deepfilter: 'DeepFilterNet (neural, 48kHz)',
  rnnoise: 'RNNoise (neural)',
  ffmpeg: 'FFmpeg (adaptive FFT)',
};

// ============ MAIN ENTRY ============

export async function cleanVoice(options: CleanVoiceOptions): Promise<string> {
  const {
    input,
    output: customOutput,
    noiseReduction = 5,
    targetLoudness = -14,
    noiseSampleStart,
    noiseSampleEnd,
  } = options;
  const progress = options.onProgress ?? (() => {});

  if (!(await checkFFmpeg())) {
    throw new Error('FFmpeg not found. Please install ffmpeg.');
  }

  const info = await getVideoInfo(input);
  if (!info.hasAudio) {
    throw new Error('Video has no audio stream to clean.');
  }

  const output = customOutput ?? getOutputPath(input, '_cleanvoice');
  const engine = resolveEngine();

  header('Clean Voice');
  console.log(`Input:    ${fmt.white(input)}`);
  console.log(`Denoise:  ${fmt.yellow(`${noiseReduction}/10`)}`);
  console.log(`Engine:   ${fmt.yellow(ENGINE_LABELS[engine])}`);
  console.log(`Loudness: ${fmt.yellow(`${targetLoudness} LUFS`)}`);
  separator();

  if (engine === 'deepfilter') {
    await cleanWithDeepFilter(input, output, noiseReduction, targetLoudness, progress);
  } else {
    const manualSample =
      noiseSampleStart != null && noiseSampleEnd != null && noiseSampleEnd > noiseSampleStart
        ? { start: noiseSampleStart, end: noiseSampleEnd }
        : undefined;
    await cleanWithFFmpegFilters(
      input,
      output,
      noiseReduction,
      targetLoudness,
      engine,
      manualSample,
      progress
    );
  }

  progress('Done!');
  success(`Output: ${output}`);
  return output;
}

// ============ DEEPFILTER PATH ============

async function cleanWithDeepFilter(
  input: string,
  output: string,
  noiseReduction: number,
  targetLoudness: number,
  progress: (s: string) => void
): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vidlet-df-'));
  const tmpWav = join(tmpDir, 'audio.wav');
  const enhancedDir = join(tmpDir, 'enhanced');
  mkdirSync(enhancedDir);

  let spin = createSpinner('Extracting audio...');
  try {
    // Step 1: Extract audio as 48kHz WAV (DeepFilterNet requires 48kHz)
    progress('Extracting audio...');
    await executeFFmpegRaw(['-y', '-i', input, '-vn', '-ar', '48000', '-f', 'wav', tmpWav]);
    spin.stop();

    // Step 2: Run DeepFilterNet
    progress('Denoising...');
    spin = createSpinner('Denoising...');
    const attenDb = Math.round(10 + noiseReduction * 4); // Scale 1-10 → 14-50 dB
    const { execaCommand } = await import('execa');
    await execaCommand(
      `"${DEEPFILTER_BIN}" "${tmpWav}" -o "${enhancedDir}" --pf --atten-lim-db ${attenDb}`,
      { shell: true, timeout: 600_000 }
    );
    spin.stop();

    // Find the enhanced file (same basename in output dir)
    const enhancedWav = join(enhancedDir, 'audio.wav');
    if (!existsSync(enhancedWav)) {
      throw new Error('DeepFilterNet did not produce output');
    }

    // Step 3: Measure loudness on enhanced audio (through the pre-loudnorm chain)
    progress('Measuring loudness...');
    spin = createSpinner('Measuring loudness...');
    const measurements = await measureLoudness(enhancedWav, [HIGHPASS, COMPRESSOR], targetLoudness);
    spin.stop();

    // Step 4: Mux enhanced audio back with original video
    progress('Encoding final output...');
    spin = createSpinner('Encoding final output...');
    const filters = [
      HIGHPASS,
      COMPRESSOR,
      buildLoudnorm(measurements, targetLoudness),
      LIMITER,
    ].join(',');

    await executeFFmpegRaw([
      '-y',
      '-i',
      input,
      '-i',
      enhancedWav,
      '-map',
      '0:v',
      '-map',
      '1:a',
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
      output,
    ]);
    spin.stop();
  } finally {
    // Cleanup temp files
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// ============ FFMPEG FILTER PATH (RNNOISE / AFFTDN) ============

async function cleanWithFFmpegFilters(
  input: string,
  output: string,
  noiseReduction: number,
  targetLoudness: number,
  engine: 'rnnoise' | 'ffmpeg',
  manualSample: { start: number; end: number } | undefined,
  progress: (s: string) => void
): Promise<void> {
  // Auto-detect noise sample if not manually specified
  progress('Detecting noise...');
  let spin = createSpinner('Detecting noise...');
  let noiseSample = manualSample;
  if (!noiseSample) {
    const segments = await detectSilenceSegments(input);
    if (segments.length > 0) {
      noiseSample = segments.reduce((best, seg) =>
        seg.end - seg.start > best.end - best.start ? seg : best
      );
    }
  }

  if (noiseSample) {
    const label = manualSample ? 'manual' : 'auto';
    console.log(
      `Sample:   ${fmt.yellow(`${noiseSample.start.toFixed(1)}s → ${noiseSample.end.toFixed(1)}s (${label})`)}`
    );
  }
  spin.stop();

  const baseFilters = buildBaseFilters(noiseReduction, engine === 'rnnoise', noiseSample);

  progress('Measuring loudness...');
  spin = createSpinner('Measuring loudness...');
  const lightFilters = baseFilters.filter(
    (f) => !f.startsWith('arnndn') && !f.startsWith('afftdn') && !f.startsWith('asendcmd')
  );
  const measurements = await measureLoudness(input, lightFilters, targetLoudness);
  spin.stop();

  progress(engine === 'rnnoise' ? 'Denoising...' : 'Denoising audio...');
  spin = createSpinner('Processing audio...');
  const filters = [...baseFilters, buildLoudnorm(measurements, targetLoudness), LIMITER].join(',');

  progress('Encoding final output...');
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
}

// ============ SHARED HELPERS ============

async function detectSilenceSegments(input: string): Promise<SilenceSegment[]> {
  const stderr = await executeFFmpegAnalysis(input, [
    '-t',
    '120',
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
      segments.push({ start: pendingStart ?? 0, end: time });
      pendingStart = null;
    }
  }

  return segments;
}

async function measureLoudness(
  input: string,
  baseFilters: string[],
  targetLoudness: number
): Promise<LoudnormMeasurements> {
  const filters = [
    ...baseFilters,
    `loudnorm=I=${targetLoudness}:TP=-1.5:LRA=11:print_format=json`,
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

function buildBaseFilters(
  noiseReduction: number,
  hasRnnoise: boolean,
  noiseSample?: { start: number; end: number }
): string[] {
  const filters: string[] = [];
  filters.push(HIGHPASS);

  if (noiseSample) {
    const nr = noiseReduction * 3 + 3;
    filters.push(
      `asendcmd=c='${noiseSample.start.toFixed(3)} afftdn sn start;${noiseSample.end.toFixed(3)} afftdn sn stop'`
    );
    filters.push(`afftdn=nr=${nr}:nf=-30:tn=0`);
  }

  if (hasRnnoise) {
    const mix = Math.min(1, 0.4 + noiseReduction * 0.06);
    filters.push(`arnndn=m=${RNNOISE_MODEL}:mix=${mix.toFixed(2)}`);
  } else if (!noiseSample) {
    filters.push('lowpass=f=16000');
    const nr = noiseReduction * 3 + 3;
    filters.push(`afftdn=nr=${nr}:nf=-40:tn=1`);
  }

  return filters;
}

// ============ ANALYSIS (GUI) ============

export async function analyzeVoice(input: string): Promise<VoiceAnalysis> {
  const segments = await detectSilenceSegments(input);
  const voiceStart = segments.length > 0 && segments[0].start === 0 ? segments[0].end : 0;
  const bestSegment =
    segments.length > 0
      ? segments.reduce((best, seg) => (seg.end - seg.start > best.end - best.start ? seg : best))
      : null;

  const stderr = await executeFFmpegAnalysis(input, [
    '-af',
    'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
  ]);

  let currentLoudness = -24;
  const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[0]);
    currentLoudness = Number.parseFloat(data.input_i);
  }

  let suggestedNoiseReduction = 3;
  if (voiceStart > 1.0) suggestedNoiseReduction = 7;
  else if (voiceStart >= MIN_NOISE_PROFILE_DURATION) suggestedNoiseReduction = 5;

  return {
    voiceStart,
    currentLoudness,
    suggestedNoiseReduction,
    noiseSampleStart: bestSegment?.start ?? null,
    noiseSampleEnd: bestSegment?.end ?? null,
  };
}
