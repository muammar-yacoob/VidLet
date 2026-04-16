import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { optimize } from '../../tools/optimize.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the optimize command
 */
export function registerOptimizeCommand(program: Command): void {
  program
    .command('optimize <files...>')
    .description('Optimize Lottie JSON or GIF files')
    .option('-g, --gui', 'Open GUI window')
    .option('-d, --dotlottie', 'Output as .lottie (compressed dotLottie format)')
    .option('-o <path>', 'Output file path (single file only)')
    .option('-l, --lossy <n>', 'GIF lossy compression level (0-200, default 80)', Number)
    .option('--level <n>', 'GIF optimization level (1-3, default 3)', Number)
    .option('--colors <n>', 'Max GIF colors (2-256)', Number)
    .action(async (files: string[], options) => {
      try {
        // GUI mode: single file only
        if (options.gui && files.length === 1) {
          const { getToolById } = await import('../tools.js');
          const tool = getToolById('optimize');
          if (tool) {
            const input = await resolveInputPath(files[0]);
            await tool.runGUI?.(input);
          }
          return;
        }

        // Resolve all paths
        const inputs: string[] = [];
        for (const file of files) {
          inputs.push(await resolveInputPath(file));
        }

        // Single batch call
        await optimize({
          input: inputs.length === 1 ? inputs[0] : inputs,
          output: files.length === 1 ? options.o : undefined,
          dotlottie: options.dotlottie,
          lossy: options.lossy,
          level: options.level,
          colors: options.colors,
        });
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
