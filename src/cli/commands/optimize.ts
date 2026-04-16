import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the optimize command
 */
export function registerOptimizeCommand(program: Command): void {
  program
    .command('optimize <file>')
    .description('Optimize Lottie JSON animation files')
    .option('-g, --gui', 'Open GUI window')
    .option('-o <path>', 'Output file path (single file only)')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('optimize');

        if (!tool) {
          throw new Error('Optimize tool not found');
        }

        if (options.gui) {
          await tool.runGUI?.(input);
        } else {
          await tool.run(input, {
            output: options.o,
          });
        }
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
