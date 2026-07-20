import type { Command } from 'commander';
import { voiceover } from '../../tools/voiceover.js';
import { handleError, resolveInputPath } from '../utils.js';

export function registerVoiceoverCommand(program: Command): void {
  program
    .command('voiceover <textOrFile>')
    .description('Generate narration from a script (free Edge TTS, or clone your own voice)')
    .option('-o <path>', 'Output audio path (.mp3/.wav)')
    .option('-l <lang>', 'Language: en, es, fr, de, it, pt, ja, ko, zh, ar, hi, ru, tr, nl')
    .option('-m, --male', 'Use the male voice for the language')
    .option('--voice <name>', 'Exact Edge voice name (overrides -l/-m)')
    .option('--clone <ref>', 'Clone the voice in this ~10s recording (local Chatterbox, MIT)')
    .option('--video <file>', 'Mix narration over this video, auto-ducking its audio')
    .option('--no-normalize', 'Skip loudness normalization')
    .action(async (textOrFile: string, options) => {
      try {
        await voiceover({
          input: textOrFile,
          output: options.o,
          language: options.l,
          gender: options.male ? 'male' : 'female',
          voice: options.voice,
          cloneRef: options.clone ? await resolveInputPath(options.clone) : undefined,
          video: options.video ? await resolveInputPath(options.video) : undefined,
          normalize: options.normalize,
        });
      } catch (error) {
        handleError(error);
      }
    });
}
