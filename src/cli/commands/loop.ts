import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the loop command
 */
export function registerLoopCommand(program: Command): void {
	program
		.command('loop <file>')
		.description('Create seamless looping video')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-s <seconds>', 'Start time in seconds')
		.option('-e <seconds>', 'End time in seconds')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('loop');

				if (!tool) {
					throw new Error('Loop tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					await tool.run(input, {
						output: options.o,
						start: options.s ? Number.parseFloat(options.s) : undefined,
						end: options.e ? Number.parseFloat(options.e) : undefined,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
