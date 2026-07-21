import type { Command } from 'commander';
import { isChatterboxInstalled } from '../../lib/chatterbox.js';
import { isDotsTtsInstalled } from '../../lib/dots-tts.js';
import { fmt } from '../../lib/logger.js';
import { type CloneEngine, resolveCloneEngine, voiceover } from '../../tools/voiceover.js';
import { handleError, resolveInputPath } from '../utils.js';

/**
 * First `--clone` use downloads several GB — ask before kicking that off.
 * Only the CLI prompts: the GUI and MCP disclose the one-time size in their
 * own copy and cannot answer a TTY prompt mid-request. Returns true when
 * already installed, confirmed, or running non-interactively (scripts/CI).
 */
async function confirmCloneInstall(engine: CloneEngine): Promise<boolean> {
  const installed =
    engine === 'dots' ? await isDotsTtsInstalled() : await isChatterboxInstalled();
  if (installed || !process.stdin.isTTY || !process.stdout.isTTY) return true;

  const size =
    engine === 'dots'
      ? '~3 GB now (PyTorch), plus a ~4 GB model on the first generation'
      : '~3 GB (PyTorch + model)';
  const name = engine === 'dots' ? 'dots.tts' : 'Chatterbox';
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `${name} voice cloning needs a one-time setup: ${size}. Continue? [Y/n] `
    );
    return !/^n/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function registerVoiceoverCommand(program: Command): void {
  program
    .command('voiceover <textOrFile>')
    .description('Generate narration from a script (free Edge TTS, or clone your own voice)')
    .option('-o <path>', 'Output audio path (.mp3/.wav)')
    .option('-l <lang>', 'Language: en, es, fr, de, it, pt, ja, ko, zh, ar, hi, ru, tr, nl')
    .option('-m, --male', 'Use the male voice for the language')
    .option('--voice <name>', 'Exact Edge voice name (overrides -l/-m)')
    .option('--clone <ref>', 'Clone the voice in this ~10s recording (local, free)')
    .option(
      '--clone-engine <engine>',
      'Cloning engine: chatterbox (CPU/GPU, default) or dots (best quality, NVIDIA GPU)'
    )
    .option('--video <file>', 'Mix narration over this video, auto-ducking its audio')
    .option('--no-normalize', 'Skip loudness normalization')
    .action(async (textOrFile: string, options) => {
      try {
        const cloneEngine = resolveCloneEngine(options.cloneEngine);
        if (options.clone && !(await confirmCloneInstall(cloneEngine))) {
          console.log(fmt.dim('Cancelled — no worries, Edge TTS needs no setup: drop --clone.'));
          return;
        }
        await voiceover({
          input: textOrFile,
          output: options.o,
          language: options.l,
          gender: options.male ? 'male' : 'female',
          voice: options.voice,
          cloneRef: options.clone ? await resolveInputPath(options.clone) : undefined,
          cloneEngine,
          video: options.video ? await resolveInputPath(options.video) : undefined,
          normalize: options.normalize,
        });
      } catch (error) {
        handleError(error);
      }
    });
}
