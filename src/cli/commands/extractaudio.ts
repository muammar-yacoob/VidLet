import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the extractaudio command
 */
export function registerExtractAudioCommand(program: Command): void {
	program
		.command('extractaudio <file>')
		.description('Extract audio track from video')
		.option('-y, --yes', 'Use defaults, skip prompts')
		.option('-f <format>', 'Audio format: mp3|aac|wav|flac|ogg (default: mp3)')
		.option('-b <kbps>', 'Bitrate in kb/s (default: 192)')
		.option('-o <path>', 'Output file path')
		.action(async (file: string, options) => {
			try {
				const input = await resolveInputPath(file);
				const tool = getToolById('extractaudio');

				if (!tool) {
					throw new Error('Extract audio tool not found');
				}

				if (options.yes) setUseDefaults(true);

				await tool.run(input, {
					output: options.o,
					format: options.f,
					bitrate: options.b ? Number.parseInt(options.b, 10) : undefined,
				});
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
