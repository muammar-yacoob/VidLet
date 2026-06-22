import type { Command } from 'commander';
import { resolveInputPath, runToolCommand } from '../utils.js';

/**
 * Register the thumb command
 */
export function registerThumbCommand(program: Command): void {
  program
    .command('thumb <file> [image]')
    .description('Embed thumbnail image into video')
    .option('-g, --gui', 'Open GUI window')
    .option('-o <path>', 'Output file path')
    .action((file: string, image: string | undefined, options) =>
      runToolCommand('thumb', file, options, async () => {
        if (!image) {
          throw new Error('Image path required in CLI mode');
        }
        return {
          output: options.o,
          image: await resolveInputPath(image),
        };
      })
    );
}
