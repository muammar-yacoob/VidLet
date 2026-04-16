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
    .description('Optimize Lottie JSON or GIF files')
    .option('-g, --gui', 'Open GUI window')
    .option('-d, --dotlottie', 'Output as .lottie (compressed dotLottie format)')
    .option('-o <path>', 'Output file path (single file only)')
    .option('-l, --lossy <n>', 'GIF lossy compression level (0-200, default 80)', Number)
    .option('--level <n>', 'GIF optimization level (1-3, default 3)', Number)
    .option('--colors <n>', 'Max GIF colors (2-256)', Number)
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
            dotlottie: options.dotlottie,
            lossy: options.lossy,
            level: options.level,
            colors: options.colors,
          });
        }
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
