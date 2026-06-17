import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

export function registerAutoCleanupCommand(program: Command): void {
  program
    .command('autocleanup <file>')
    .description('Auto cleanup: denoise, remove silence, contrast, compress')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-n <level>', 'Denoise strength 1-10 (default: 3)')
    .option('-d <seconds>', 'Minimum silence duration to cut (default: 0.5)')
    .option('--no-contrast', 'Skip the contrast step')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('autocleanup');

        if (!tool) {
          throw new Error('Auto cleanup tool not found');
        }

        if (options.yes) setUseDefaults(true);

        await tool.run(input, {
          output: options.o,
          noiseReduction: options.n ? Number.parseFloat(options.n) : undefined,
          minSilenceDuration: options.d ? Number.parseFloat(options.d) : undefined,
          skipContrast: options.contrast === false,
        });
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
