import type { Command } from 'commander';
import { demo } from '../../tools/demo.js';
import { handleError, resolveInputPath } from '../utils.js';

export function registerDemoCommand(program: Command): void {
  program
    .command('demo <file>')
    .description('Silent screen recording → trimmed, AI-narrated demo + 9:16 Short (no mic needed)')
    .option('-a, --about <text>', 'One line about the product/feature (sharpens the script)')
    .option('-o <path>', 'Output file path for the full demo')
    .option('-l <lang>', 'Narration language (default en)')
    .option('-m, --male', 'Use the male voice')
    .option('--voice <name>', 'Exact Edge voice name')
    .option('--clone <ref>', 'Narrate in the voice from this ~10s recording (local)')
    .option('--no-short', 'Skip the 9:16 Short output')
    .option('-c, --captions', 'Burn captions into the Short')
    .option('-p, --post', 'Also write title/description/hashtags sidecar')
    .action(async (file: string, options) => {
      try {
        await demo({
          input: await resolveInputPath(file),
          about: options.about,
          output: options.o,
          language: options.l,
          gender: options.male ? 'male' : 'female',
          voice: options.voice,
          cloneRef: options.clone ? await resolveInputPath(options.clone) : undefined,
          short: options.short,
          captions: options.captions,
          post: options.post,
        });
      } catch (error) {
        handleError(error);
      }
    });
}
