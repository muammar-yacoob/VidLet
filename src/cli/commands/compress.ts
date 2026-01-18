import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the compress command
 */
export function registerCompressCommand(program: Command): void {
	program
		.command('compress <file>')
		.description('Compress video using H.264 encoding')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-b <kbps>', 'Bitrate in kb/s (default: 2500)')
		.option('-p <preset>', 'Preset: ultrafast|fast|medium|slow|veryslow')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('compress');

				if (!tool) {
					throw new Error('Compress tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					await tool.run(input, {
						output: options.o,
						bitrate: options.b ? Number.parseInt(options.b, 10) : undefined,
						preset: options.p,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
