import * as path from 'node:path';
import type { Command } from 'commander';
import { getVideoInfo } from '../../lib/ffmpeg.js';
import { startGuiServer, type VideoInfo } from '../../lib/gui-server.js';
import { fmt } from '../../lib/logger.js';
import { resolveInputPath } from '../utils.js';

/**
 * Get video info for GUI mode
 */
async function getVideoInfoForGui(filePath: string): Promise<VideoInfo> {
	const info = await getVideoInfo(filePath);
	return {
		filePath,
		fileName: path.basename(filePath),
		width: info.width,
		height: info.height,
		duration: info.duration,
		fps: info.fps ?? 30,
	};
}

/**
 * Register the unified vidlet GUI command
 */
export function registerVidletCommand(program: Command): void {
	program
		.command('vidlet <file>')
		.description('Open unified VidLet GUI')
		.option('-g, --gui', 'Open GUI window (default)')
		.action(async (file: string) => {
			try {
				const input = await resolveInputPath(file);
				const videoInfo = await getVideoInfoForGui(input);
				await startGuiServer({
					htmlFile: 'vidlet.html',
					title: 'VidLet',
					videoInfo,
					defaults: {},
					onProcess: async () => {
						return { success: true, logs: [] };
					},
				});
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
