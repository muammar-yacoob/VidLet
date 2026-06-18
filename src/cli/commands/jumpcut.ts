import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the jumpcut command
 */
export function registerJumpcutCommand(program: Command): void {
  program
    .command('jumpcut <file>')
    .description('Auto-edit: cut silence + punch-in zoom on jump cuts')
    .option('-g, --gui', 'Open GUI window')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-p, --pace <preset>', 'Pace: tight|normal|loose (default: normal)')
    .option('-z, --zoom <pct>', 'Punch-in zoom %: 0-8 (default: 3, 0=off)')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('jumpcut');

        if (!tool) {
          throw new Error('Jump cut tool not found');
        }

        if (options.yes) setUseDefaults(true);

        if (options.gui) {
          await tool.runGUI?.(input);
        } else {
          await tool.run(input, {
            output: options.o,
            pace: options.pace,
            zoom: options.zoom ? Number.parseFloat(options.zoom) : undefined,
          });
        }
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
