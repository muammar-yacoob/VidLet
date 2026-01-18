import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the thumb command
 */
export function registerThumbCommand(program: Command): void {
	program
		.command('thumb <file> [image]')
		.description('Embed thumbnail image into video')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, image: string | undefined, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('thumb');

				if (!tool) {
					throw new Error('Thumbnail tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					if (!image) {
						console.error(fmt.red('Error: Image path required in CLI mode'));
						process.exit(1);
					}
					const imagePath = await resolveInputPath(image);
					await tool.run(input, {
						output: options.o,
						image: imagePath,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
