import type { Command } from 'commander';
import { printBanner } from '../../lib/banner.js';
import { fmt } from '../../lib/logger.js';
import { isWSL, isWSLInteropEnabled, wslToWindows } from '../../lib/paths.js';
import { generateRegFile, registerAllTools, unregisterAllTools } from '../registry.js';

/**
 * Register the install command
 */
export function registerInstallCommand(program: Command): void {
	program
		.command('install')
		.description('Install Windows shell context menu integration')
		.action(async () => {
			printBanner();

			if (!isWSL()) {
				console.log(fmt.yellow('! Run from WSL to add context menu.'));
				return;
			}

			if (!isWSLInteropEnabled()) {
				const regPath = await generateRegFile();
				const winPath = wslToWindows(regPath);
				console.log(fmt.green('✓ Generated:'), winPath);
				console.log(fmt.dim('  Double-click to install, or: reg import "' + winPath + '"'));
				return;
			}

			await unregisterAllTools();
			const results = await registerAllTools();
			const success = results.some((r) => r.success);

			if (success) {
				console.log(fmt.green('✓ Windows Context menu installed, right-click video files to open VidLet\n'));
			} else {
				console.log(fmt.red('✗ Failed. Try as administrator.\n'));
				return;
			}

			console.log(fmt.bold('Commands:'));
			console.log(`  ${fmt.cyan('vidlet compress')} video.mp4 -b 2000    ${fmt.dim('# reduce to 2000 kbps')}`);
			console.log(`  ${fmt.cyan('vidlet togif')} video.mp4 -f 15 -w 480  ${fmt.dim('# gif at 15fps, 480px wide')}`);
			console.log(`  ${fmt.cyan('vidlet mkv2mp4')} video.mkv             ${fmt.dim('# convert mkv to mp4')}`);
			console.log(`  ${fmt.cyan('vidlet shrink')} video.mp4 -t 59        ${fmt.dim('# speed up to 59 seconds')}`);
			console.log(`  ${fmt.cyan('vidlet loop')} video.mp4 -s 5 -e 15     ${fmt.dim('# trim between 5s and 15s')}`);
			console.log(`  ${fmt.cyan('vidlet thumb')} video.mp4 cover.jpg     ${fmt.dim('# embed cover.jpg as thumbnail')}`);
			console.log();
		});
}
