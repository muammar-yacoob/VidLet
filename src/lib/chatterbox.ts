/**
 * Chatterbox Engine - Local zero-shot voice cloning via Resemble AI's
 * Chatterbox (MIT licence, https://github.com/resemble-ai/chatterbox).
 *
 * Manages a dedicated Python venv under ~/.config/vidlet/, same lazy-install
 * philosophy as whisper.cpp in whisper.ts and DeepFilterNet in cleanvoice.ts.
 * First use downloads PyTorch + model weights (several GB, one-time).
 * Clones any voice from a ~10 second reference recording. Runs on CPU
 * (slow but fine for short narrations) or CUDA GPU automatically.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { logToFile } from './logger.js';

const VENV_DIR = join(homedir(), '.config', 'vidlet', 'chatterbox-venv');
const VENV_PYTHON = join(VENV_DIR, 'bin', 'python');

export interface CloneOptions {
  text: string;
  /** Path to ~10s reference recording of the voice to clone (wav/mp3). */
  referenceAudio: string;
  /** Output WAV path. */
  output: string;
  onProgress?: (stage: string) => void;
}

/**
 * Python runner: chunks the script into sentence groups (Chatterbox degrades
 * on very long single generations), synthesizes each with the cloned voice,
 * concatenates, and saves one WAV.
 */
const RUNNER_SCRIPT = `
import json, re, sys

cfg = json.load(open(sys.argv[1]))

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"vidlet:stage:loading model ({device})", flush=True)
model = ChatterboxTTS.from_pretrained(device=device)

def chunk_sentences(text, max_len=300):
    sentences = re.split(r"(?<=[.!?])\\s+", text.strip())
    chunks, current = [], ""
    for s in sentences:
        if current and len(current) + len(s) + 1 > max_len:
            chunks.append(current)
            current = s
        else:
            current = f"{current} {s}".strip()
    if current:
        chunks.append(current)
    return chunks or [text]

chunks = chunk_sentences(cfg["text"])
wavs = []
for i, chunk in enumerate(chunks):
    print(f"vidlet:stage:synthesizing {i + 1}/{len(chunks)}", flush=True)
    wavs.append(model.generate(chunk, audio_prompt_path=cfg["ref"]))

torchaudio.save(cfg["out"], torch.cat(wavs, dim=-1), model.sr)
print("vidlet:stage:done", flush=True)
`;

/** True once the venv exists and chatterbox imports cleanly. */
export async function isChatterboxInstalled(): Promise<boolean> {
  if (!existsSync(VENV_PYTHON)) return false;
  const { execa } = await import('execa');
  try {
    await execa(VENV_PYTHON, ['-c', 'import chatterbox'], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the venv and install chatterbox-tts on first use.
 * Downloads several GB (PyTorch); prints what is happening via onProgress.
 */
export async function ensureChatterbox(onProgress?: (stage: string) => void): Promise<void> {
  if (await isChatterboxInstalled()) return;

  const { execa } = await import('execa');
  const progress = onProgress ?? (() => {});

  try {
    await execa('python3', ['--version'], { timeout: 30_000 });
  } catch {
    throw new Error('python3 not found. Install it with: sudo apt install python3 python3-venv');
  }

  if (!existsSync(VENV_PYTHON)) {
    progress('creating Python venv');
    mkdirSync(join(homedir(), '.config', 'vidlet'), { recursive: true });
    try {
      await execa('python3', ['-m', 'venv', VENV_DIR], { timeout: 120_000 });
    } catch (err) {
      logToFile(`venv creation failed: ${(err as Error).message}`);
      throw new Error(
        'Could not create a Python venv. Install venv support with: sudo apt install python3-venv'
      );
    }
  }

  progress('installing chatterbox-tts (one-time, several GB — grab a coffee)');
  try {
    await execa(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], { timeout: 300_000 });
    await execa(VENV_PYTHON, ['-m', 'pip', 'install', 'chatterbox-tts'], {
      timeout: 3_600_000, // torch download can genuinely take this long
    });
  } catch (err) {
    logToFile(`chatterbox install failed: ${(err as Error).message}`);
    throw new Error(
      `Chatterbox install failed: ${(err as Error).message.slice(0, 300)}\n` +
        `Retry, or install manually: ${VENV_PYTHON} -m pip install chatterbox-tts`
    );
  }
}

/**
 * Synthesize speech in a cloned voice. Model weights download automatically
 * from Hugging Face on the first generation.
 */
export async function synthesizeClone(options: CloneOptions): Promise<void> {
  const { text, referenceAudio, output, onProgress } = options;
  const progress = onProgress ?? (() => {});

  if (!existsSync(referenceAudio)) {
    throw new Error(`Reference audio not found: ${referenceAudio}`);
  }

  await ensureChatterbox(progress);

  const runDir = join(tmpdir(), `vidlet-clone-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });
  const scriptPath = join(runDir, 'runner.py');
  const cfgPath = join(runDir, 'cfg.json');
  writeFileSync(scriptPath, RUNNER_SCRIPT);
  writeFileSync(cfgPath, JSON.stringify({ text, ref: referenceAudio, out: output }));

  const { execa } = await import('execa');
  const proc = execa(VENV_PYTHON, [scriptPath, cfgPath], { timeout: 3_600_000 });
  proc.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      if (line.startsWith('vidlet:stage:')) progress(line.slice('vidlet:stage:'.length));
    }
  });

  try {
    await proc;
  } catch (err) {
    logToFile(`chatterbox synthesis failed: ${(err as Error).message}`);
    throw new Error(`Voice cloning failed: ${(err as Error).message.slice(0, 400)}`);
  }

  if (!existsSync(output)) {
    throw new Error('Voice cloning produced no output file.');
  }
}
