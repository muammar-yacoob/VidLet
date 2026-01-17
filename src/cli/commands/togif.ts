import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the togif command
 */
export function registerTogifCommand(program: Command): void {
	program
		.command('togif <file>')
		.description('Convert video to optimized GIF')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-f <fps>', 'Frames per second (default: 15)')
		.option('-w <pixels>', 'Output width (default: 480)')
		.option('-d <method>', 'Dither: none|floyd_steinberg|sierra2|bayer')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('togif');

				if (!tool) {
					throw new Error('ToGIF tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					await tool.run(input, {
						output: options.o,
						fps: options.f ? Number.parseInt(options.f, 10) : undefined,
						width: options.w ? Number.parseInt(options.w, 10) : undefined,
						dither: options.d,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
