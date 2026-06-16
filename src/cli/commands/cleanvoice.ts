import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

export function registerCleanVoiceCommand(program: Command): void {
  program
    .command('cleanvoice <file>')
    .description('Clean and enhance voice audio')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-n <level>', 'Denoise strength 1-10 (default: 5)')
    .option('-l <LUFS>', 'Target loudness in LUFS (default: -14)')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('cleanvoice');

        if (!tool) {
          throw new Error('Clean voice tool not found');
        }

        if (options.yes) setUseDefaults(true);

        await tool.run(input, {
          output: options.o,
          noiseReduction: options.n ? Number.parseFloat(options.n) : undefined,
          targetLoudness: options.l ? Number.parseFloat(options.l) : undefined,
        });
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
