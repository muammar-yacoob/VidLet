import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/** Parse pitch value: "5%" → 0.05, "-0.03" → -0.03 */
function parsePitch(val: string): number {
  if (val.endsWith('%')) {
    return Number.parseFloat(val.slice(0, -1)) / 100;
  }
  return Number.parseFloat(val);
}

/**
 * Register the speedup command
 */
export function registerSpeedupCommand(program: Command): void {
  program
    .command('speedup <file>')
    .description('Speed up video tempo while preserving pitch')
    .option('-g, --gui', 'Open GUI window')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-s <factor>', 'Speed multiplier (default: 1.5)')
    .option('-p <percent>', 'Pitch shift: -0.03 or -0.03% (default: -0.03)')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('speedup');

        if (!tool) {
          throw new Error('Speedup tool not found');
        }

        if (options.yes) setUseDefaults(true);

        if (options.gui) {
          await tool.runGUI?.(input);
        } else {
          await tool.run(input, {
            output: options.o,
            speed: options.s ? Number.parseFloat(options.s) : undefined,
            pitchShift: options.p ? parsePitch(options.p) : undefined,
          });
        }
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
