import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the shrink command
 */
export function registerShrinkCommand(program: Command): void {
	program
		.command('shrink <file>')
		.description('Speed up video to fit target duration')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-t <seconds>', 'Target duration (default: 59.5)')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('shrink');

				if (!tool) {
					throw new Error('Shrink tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					await tool.run(input, {
						output: options.o,
						targetDuration: options.t ? Number.parseFloat(options.t) : undefined,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
