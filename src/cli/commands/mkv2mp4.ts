import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the mkv2mp4 command
 */
export function registerMkv2mp4Command(program: Command): void {
	program
		.command('mkv2mp4 <file>')
		.description('Convert MKV to MP4')
		.option('-g, --gui', 'Open GUI window')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-r', 'Re-encode instead of stream copy')
		.option('-c <value>', 'CRF quality 0-51 (default: 23)')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('mkv2mp4');

				if (!tool) {
					throw new Error('MKV to MP4 tool not found');
				}

				if (options.yes) setUseDefaults(true);

				if (options.gui) {
					await tool.runGUI?.(input);
				} else {
					await tool.run(input, {
						output: options.o,
						copyStreams: !options.r,
						crf: options.c ? Number.parseInt(options.c, 10) : undefined,
					});
				}
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
