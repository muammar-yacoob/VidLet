/**
 * dots.tts Engine - Local zero-shot voice cloning via rednote-hilab's dots.tts
 * (Apache-2.0, watermark-free, https://github.com/rednote-hilab/dots.tts).
 *
 * Second clone engine beside Chatterbox (chatterbox.ts) - same venv-under-
 * ~/.config/vidlet/ lazy-install pattern, same vidlet:stage: progress
 * protocol. Highest cloning fidelity of the free engines, but the 2B model
 * really wants an NVIDIA GPU (~6GB VRAM for typical narrations); on CPU it
 * is impractically slow, so Chatterbox stays the default.
 *
 * dots.tts import-checks that torch/torchaudio minor versions match, and each
 * torch release only ships wheels for specific CUDA versions - so the install
 * picks a torch pin from the driver's reported CUDA version instead of
 * letting pip resolve a mismatched pair (which makes `import dots_tts` fail).
 *
 * Env overrides: VIDLET_DOTS_MODEL (default rednote-hilab/dots.tts-soar,
 * best similarity; -mf is the fast 4-step distill), VIDLET_DOTS_STEPS.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { logToFile } from './logger.js';

const VENV_DIR = join(homedir(), '.config', 'vidlet', 'dots-venv');
const VENV_PYTHON = join(VENV_DIR, 'bin', 'python');

const DEFAULT_MODEL = 'rednote-hilab/dots.tts-soar';

export interface DotsCloneOptions {
  text: string;
  /** Path to ~10s reference recording of the voice to clone (wav/mp3). */
  referenceAudio: string;
  /** Transcript of the reference recording - optional, improves similarity. */
  promptText?: string;
  /** Output WAV path. */
  output: string;
  onProgress?: (stage: string) => void;
}

/**
 * Python runner: chunks the script into sentence groups (bounds VRAM - memory
 * grows with generated audio length), synthesizes each with the cloned voice,
 * concatenates, and saves one WAV.
 */
const RUNNER_SCRIPT = `
import json, re, sys

cfg = json.load(open(sys.argv[1]))

import torch

if not torch.cuda.is_available():
    print("vidlet:stage:no CUDA GPU - running on CPU (very slow)", flush=True)

print("vidlet:stage:loading model (first run downloads ~4GB)", flush=True)
from dots_tts.runtime import DotsTtsRuntime

runtime = DotsTtsRuntime.from_pretrained(cfg["model"])

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

import numpy as np
import soundfile as sf

chunks = chunk_sentences(cfg["text"])
wavs = []
sample_rate = runtime.sample_rate
for i, chunk in enumerate(chunks):
    print(f"vidlet:stage:synthesizing {i + 1}/{len(chunks)}", flush=True)
    result = runtime.generate(
        text=chunk,
        prompt_audio_path=cfg["ref"],
        prompt_text=cfg.get("prompt_text") or None,
        num_steps=int(cfg.get("num_steps", 10)),
    )
    wavs.append(result["audio"].float().cpu().squeeze().numpy())
    sample_rate = result["sample_rate"]

sf.write(cfg["out"], np.concatenate(wavs), sample_rate)
print("vidlet:stage:done", flush=True)
`;

/** True once the venv exists and dots_tts imports cleanly (this also verifies
 * the torch/torchaudio pairing, which dots_tts checks on import). */
export async function isDotsTtsInstalled(): Promise<boolean> {
  if (!existsSync(VENV_PYTHON)) return false;
  const { execa } = await import('execa');
  try {
    await execa(VENV_PYTHON, ['-c', 'import dots_tts'], { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

/** torch/torchaudio pip spec matched to the driver's CUDA version. */
async function torchInstallArgs(): Promise<string[]> {
  const { execa } = await import('execa');
  try {
    const { stdout } = await execa('nvidia-smi', [], { timeout: 15_000 });
    const match = stdout.match(/CUDA Version:\s*(\d+)\.(\d+)/);
    if (match) {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      // PyPI default wheels: torch 2.11.x -> cu130, torch 2.8.x -> cu128.
      if (major >= 13) return ['torch==2.11.*', 'torchaudio==2.11.*'];
      if (major === 12 && minor >= 8) return ['torch==2.8.*', 'torchaudio==2.8.*'];
      if (major === 12) {
        return [
          'torch==2.8.0',
          'torchaudio==2.8.0',
          '--index-url',
          'https://download.pytorch.org/whl/cu126',
        ];
      }
    }
  } catch {
    // No nvidia-smi - fall through to CPU wheels.
  }
  return [
    'torch==2.11.*',
    'torchaudio==2.11.*',
    '--index-url',
    'https://download.pytorch.org/whl/cpu',
  ];
}

/**
 * Create the venv and install dots.tts on first use.
 * Downloads several GB (PyTorch); prints what is happening via onProgress.
 */
export async function ensureDotsTts(onProgress?: (stage: string) => void): Promise<void> {
  if (await isDotsTtsInstalled()) return;

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
      logToFile(`dots venv creation failed: ${(err as Error).message}`);
      throw new Error(
        'Could not create a Python venv. Install venv support with: sudo apt install python3-venv'
      );
    }
  }

  progress('installing dots.tts (one-time, several GB — grab a coffee)');
  try {
    await execa(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], { timeout: 300_000 });
    // Matching torch/torchaudio first (dots_tts refuses mismatched minors),
    // then dots.tts resolves against the pinned pair.
    await execa(VENV_PYTHON, ['-m', 'pip', 'install', ...(await torchInstallArgs())], {
      timeout: 3_600_000, // torch download can genuinely take this long
    });
    await execa(VENV_PYTHON, ['-m', 'pip', 'install', 'dots.tts'], { timeout: 3_600_000 });
  } catch (err) {
    logToFile(`dots.tts install failed: ${(err as Error).message}`);
    throw new Error(
      `dots.tts install failed: ${(err as Error).message.slice(0, 300)}\n` +
        `Retry, or install manually: ${VENV_PYTHON} -m pip install dots.tts`
    );
  }
}

/**
 * Synthesize speech in a cloned voice. Model weights auto-download from
 * Hugging Face on the first generation.
 */
export async function synthesizeCloneDots(options: DotsCloneOptions): Promise<void> {
  const { text, referenceAudio, promptText, output, onProgress } = options;
  const progress = onProgress ?? (() => {});

  if (!existsSync(referenceAudio)) {
    throw new Error(`Reference audio not found: ${referenceAudio}`);
  }

  await ensureDotsTts(progress);

  const runDir = join(tmpdir(), `vidlet-dots-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });
  const scriptPath = join(runDir, 'runner.py');
  const cfgPath = join(runDir, 'cfg.json');
  writeFileSync(scriptPath, RUNNER_SCRIPT);
  writeFileSync(
    cfgPath,
    JSON.stringify({
      text,
      ref: referenceAudio,
      prompt_text: promptText ?? null,
      out: output,
      model: process.env.VIDLET_DOTS_MODEL ?? DEFAULT_MODEL,
      num_steps: Number(process.env.VIDLET_DOTS_STEPS ?? 10),
    })
  );

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
    logToFile(`dots.tts synthesis failed: ${(err as Error).message}`);
    // The traceback lives at the END of stderr - keep the tail, not the head.
    const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message;
    throw new Error(`Voice cloning failed:\n...${stderr.slice(-600)}`);
  }

  if (!existsSync(output)) {
    throw new Error('Voice cloning produced no output file.');
  }
}
