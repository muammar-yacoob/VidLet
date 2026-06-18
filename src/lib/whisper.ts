/**
 * Whisper Engine - Manages whisper.cpp binary/model and provides transcription
 * Downloads pre-built whisper.cpp CLI binary from GitHub releases.
 * Follows the same pattern as DeepFilterNet in cleanvoice.ts.
 */
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { arch, homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeFFmpegRaw } from './ffmpeg.js';
import { logToFile } from './logger.js';

const WHISPER_DIR = join(homedir(), '.config', 'vidlet', 'bin');
const WHISPER_BIN = join(WHISPER_DIR, 'whisper-cli');
const WHISPER_MODEL_DIR = join(homedir(), '.config', 'vidlet', 'models');
const WHISPER_VERSION = '1.9.0';

export type WhisperModel = 'tiny.en' | 'base.en' | 'small.en';

export interface TranscribeOptions {
  model?: WhisperModel;
  language?: string;
  onProgress?: (stage: string) => void;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
}

/**
 * Get the download URL and tarball inner path for whisper.cpp binary.
 * Releases are tarballs containing a folder with binaries inside.
 */
function getWhisperDownload(): { url: string; innerDir: string } | null {
  const p = platform();
  const a = arch();
  const base = `https://github.com/ggml-org/whisper.cpp/releases/download/v${WHISPER_VERSION}`;

  if (p === 'linux' && a === 'x64')
    return { url: `${base}/whisper-bin-ubuntu-x64.tar.gz`, innerDir: 'whisper-bin-ubuntu-x64' };
  if (p === 'linux' && a === 'arm64')
    return { url: `${base}/whisper-bin-ubuntu-arm64.tar.gz`, innerDir: 'whisper-bin-ubuntu-arm64' };
  // macOS: not available as pre-built in recent releases — users must build from source
  return null;
}

/**
 * Get the download URL for a whisper model
 */
function getModelUrl(model: WhisperModel): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
}

/**
 * Get local path for a whisper model
 */
function getModelPath(model: WhisperModel): string {
  return join(WHISPER_MODEL_DIR, `ggml-${model}.bin`);
}

/**
 * Download whisper.cpp binary if not present.
 * Downloads a tarball, extracts the whisper-cli binary, cleans up.
 */
export async function ensureWhisper(): Promise<boolean> {
  if (existsSync(WHISPER_BIN)) return true;

  const dl = getWhisperDownload();
  if (!dl) {
    logToFile('Whisper: No pre-built binary available for this platform');
    return false;
  }

  mkdirSync(WHISPER_DIR, { recursive: true });

  const tempTar = join(tmpdir(), `vidlet_whisper_${Date.now()}.tar.gz`);
  const { execa: execaFn } = await import('execa');
  try {
    logToFile(`Whisper: Downloading from ${dl.url}`);
    await execaFn('curl', ['-sL', dl.url, '-o', tempTar], { timeout: 300_000 });

    // Extract only the whisper-cli binary from the tarball
    await execaFn('tar', ['-xzf', tempTar, '-C', WHISPER_DIR, '--strip-components=1', `${dl.innerDir}/whisper-cli`], {
      timeout: 30_000,
    });

    chmodSync(WHISPER_BIN, 0o755);
    logToFile('Whisper: Binary installed successfully');
    return true;
  } catch (err) {
    logToFile(`Whisper: Failed to download/extract binary: ${(err as Error).message}`);
    try {
      unlinkSync(WHISPER_BIN);
    } catch {
      /* ignore */
    }
    return false;
  } finally {
    try {
      unlinkSync(tempTar);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Download whisper model if not present
 */
export async function ensureWhisperModel(model: WhisperModel = 'base.en'): Promise<string> {
  const modelPath = getModelPath(model);
  if (existsSync(modelPath)) return modelPath;

  mkdirSync(WHISPER_MODEL_DIR, { recursive: true });

  const url = getModelUrl(model);
  const { execa: execaFn } = await import('execa');
  try {
    logToFile(`Whisper: Downloading model ${model} from ${url}`);
    await execaFn('curl', ['-sL', url, '-o', modelPath], { timeout: 600_000 });
    logToFile(`Whisper: Model ${model} downloaded successfully`);
    return modelPath;
  } catch (err) {
    logToFile(`Whisper: Failed to download model: ${(err as Error).message}`);
    try {
      unlinkSync(modelPath);
    } catch {
      /* ignore */
    }
    throw new Error(`Failed to download whisper model: ${(err as Error).message}`);
  }
}

/**
 * Check if whisper is available (binary exists)
 */
export function isWhisperAvailable(): boolean {
  return existsSync(WHISPER_BIN);
}

/**
 * Transcribe audio from a video/audio file using whisper.cpp
 * Extracts audio as 16kHz mono WAV, runs whisper, parses JSON output.
 */
export async function transcribe(
  inputPath: string,
  options: TranscribeOptions = {}
): Promise<TranscriptResult> {
  const { model = 'base.en', onProgress } = options;

  const progress = onProgress ?? (() => {});

  // Ensure binary + model are ready
  progress('Checking whisper...');
  const hasBinary = await ensureWhisper();
  if (!hasBinary) {
    throw new Error(
      'whisper.cpp binary not available for this platform. ' +
        'Install whisper.cpp manually and place the binary at: ' +
        WHISPER_BIN
    );
  }

  progress('Checking model...');
  const modelPath = await ensureWhisperModel(model);

  // Extract audio as 16kHz mono WAV (whisper.cpp requirement)
  const tempWav = join(tmpdir(), `vidlet_whisper_${Date.now()}.wav`);
  try {
    progress('Extracting audio...');
    logToFile(`Whisper: Extracting audio to ${tempWav}`);
    await executeFFmpegRaw([
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      tempWav,
    ]);

    // Run whisper.cpp with JSON output for word-level timestamps
    progress('Transcribing...');
    logToFile(`Whisper: Running transcription with model ${model}`);

    const { execa: execaFn } = await import('execa');
    const result = await execaFn(
      WHISPER_BIN,
      ['-m', modelPath, '-f', tempWav, '--output-json-full', '--no-prints', '--language', 'en'],
      {
        timeout: 600_000,
        reject: false,
      }
    );

    if (result.exitCode !== 0) {
      const errMsg = result.stderr?.trim() || `Exit code ${result.exitCode}`;
      logToFile(`Whisper: Transcription failed: ${errMsg}`);
      throw new Error(`Whisper transcription failed: ${errMsg}`);
    }

    // whisper.cpp with --output-json-full writes to <input>.json
    const jsonPath = `${tempWav}.json`;
    if (!existsSync(jsonPath)) {
      // Try parsing stdout as JSON fallback
      throw new Error('Whisper did not produce JSON output');
    }

    const { readFileSync } = await import('node:fs');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(jsonContent);

    // Clean up JSON output file
    try {
      unlinkSync(jsonPath);
    } catch {
      /* ignore */
    }

    // Parse whisper.cpp JSON format
    const segments = parseWhisperJson(data);
    logToFile(`Whisper: Transcribed ${segments.length} segments`);
    progress('Transcription complete');

    return { segments };
  } finally {
    // Clean up temp WAV
    try {
      unlinkSync(tempWav);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Parse whisper.cpp full JSON output into our segment format
 */
function parseWhisperJson(data: any): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // whisper.cpp JSON format: { transcription: [{ offsets: { from, to }, text, timestamps: [{ offsets: { from, to }, text }] }] }
  const transcription = data.transcription || data.result || [];

  for (const seg of transcription) {
    const start = (seg.offsets?.from ?? seg.t0 ?? 0) / 1000; // ms to seconds
    const end = (seg.offsets?.to ?? seg.t1 ?? 0) / 1000;
    const text = (seg.text || '').trim();

    if (!text) continue;

    const words: TranscriptWord[] = [];
    const timestamps = seg.timestamps || seg.tokens || [];

    for (const token of timestamps) {
      const word = (token.text || '').trim();
      if (!word || word.startsWith('[')) continue; // Skip special tokens like [BLANK_AUDIO]

      words.push({
        word,
        start: (token.offsets?.from ?? token.t0 ?? 0) / 1000,
        end: (token.offsets?.to ?? token.t1 ?? 0) / 1000,
      });
    }

    // If no word-level timestamps, split evenly
    if (words.length === 0 && text) {
      const textWords = text.split(/\s+/).filter((w: string) => w.length > 0);
      const duration = end - start;
      const wordDur = duration / textWords.length;
      for (let i = 0; i < textWords.length; i++) {
        words.push({
          word: textWords[i],
          start: start + i * wordDur,
          end: start + (i + 1) * wordDur,
        });
      }
    }

    segments.push({ start, end, text, words });
  }

  return segments;
}

/**
 * Convert transcript segments to SRT format string
 */
export function segmentsToSrt(segments: TranscriptSegment[]): string {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    lines.push(`${i + 1}`);
    lines.push(`${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`);
    lines.push(seg.text);
    lines.push('');
  }
  return lines.join('\n');
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
