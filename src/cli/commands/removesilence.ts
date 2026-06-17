import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

export function registerRemoveSilenceCommand(program: Command): void {
  program
    .command('removesilence <file>')
    .description('Remove silent segments from video')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-d <seconds>', 'Minimum silence duration in seconds (default: 0.5)')
    .option('-t <dB>', 'Silence threshold in dB (default: -30)')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('removesilence');

        if (!tool) {
          throw new Error('Remove silence tool not found');
        }

        if (options.yes) setUseDefaults(true);

        await tool.run(input, {
          output: options.o,
          minSilenceDuration: options.d ? Number.parseFloat(options.d) : undefined,
          silenceThreshold: options.t ? Number.parseFloat(options.t) : undefined,
        });
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
