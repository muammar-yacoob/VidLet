import type { Command } from 'commander';
import { printBanner } from '../../lib/banner.js';
import { fmt } from '../../lib/logger.js';
import { isWSL, isWSLInteropEnabled, wslToWindows } from '../../lib/paths.js';
import { generateRegFile, registerAllTools, unregisterAllTools } from '../registry.js';
import { toolConfigs } from '../tools.js';

/**
 * Register the install command
 */
export function registerInstallCommand(program: Command): void {
	program
		.command('install')
		.description('Install Windows shell context menu integration')
		.action(async () => {
			printBanner();
			console.log(fmt.bold('Installing...\n'));

			if (!isWSL()) {
				console.log(fmt.yellow('! Not running in WSL. Registry integration skipped.'));
				console.log(fmt.yellow('! Run "vidlet install" from WSL to add context menu.'));
				return;
			}

			if (!isWSLInteropEnabled()) {
				console.log(fmt.yellow('WSL Interop not available. Generating registry file...\n'));

				const regPath = await generateRegFile();
				const winPath = wslToWindows(regPath);

				console.log(fmt.green('✓ Generated registry file:'));
				console.log(fmt.cyan(`  ${winPath}\n`));
				console.log(fmt.bold('To install, either:'));
				console.log(fmt.dim('  1. Double-click the .reg file in Windows Explorer'));
				console.log(fmt.dim(`  2. Run in elevated PowerShell: reg import "${winPath}"`));
				console.log();
				return;
			}

			// Clean up existing entries first
			console.log(fmt.dim('Removing old entries...'));
			await unregisterAllTools();
			console.log();

			const results = await registerAllTools();

			// Check if registration was successful (any result with success)
			const registrationSuccess = results.some((r) => r.success);

			// Display individual tools with their extensions
			console.log(fmt.bold('Available tools:\n'));
			for (const tool of toolConfigs) {
				const extList = tool.extensions.join(', ');
				if (registrationSuccess) {
					console.log(`${fmt.green('✓')} ${tool.name} ${fmt.dim(`[${extList}]`)}`);
				} else {
					console.log(`${fmt.red('✗')} ${tool.name} ${fmt.dim(`[${extList}]`)} ${fmt.red('(failed)')}`);
				}
			}

			console.log();
			if (registrationSuccess) {
				console.log(fmt.green(`✓ Registered unified VidLet context menu.`));
			} else {
				console.log(fmt.yellow(`! Registration failed. Try running as administrator.`));
			}

			console.log(fmt.bold('\nContext Menu Usage:'));
			console.log('  Right-click any supported video in Windows Explorer.');
			console.log('  Multi-select supported for batch processing.');

			console.log(fmt.bold('\nCLI Usage:'));
			console.log(`  ${fmt.cyan('vidlet <command> <file>')} ${fmt.dim('[options]')}    ${fmt.dim('Run with options')}`);
			console.log(`  ${fmt.cyan('vidlet <command> <file> -g')}               ${fmt.dim('Open GUI')}`);
			console.log();
			console.log(fmt.dim('  compress   Reduce file size with H.264'));
			console.log(`    ${fmt.cyan('vidlet compress')} video.mp4 -b 2000 -p fast`);
			console.log();
			console.log(fmt.dim('  togif      Convert to optimized GIF'));
			console.log(`    ${fmt.cyan('vidlet togif')} video.mp4 -f 15 -w 480`);
			console.log();
			console.log(fmt.dim('  mkv2mp4    Convert MKV to MP4'));
			console.log(`    ${fmt.cyan('vidlet mkv2mp4')} video.mkv -r -c 23`);
			console.log();
			console.log(fmt.dim('  shrink     Speed up to target duration'));
			console.log(`    ${fmt.cyan('vidlet shrink')} video.mp4 -t 59`);
			console.log();
			console.log(fmt.dim('  loop       Create seamless loop'));
			console.log(`    ${fmt.cyan('vidlet loop')} video.mp4 -s 5 -e 15`);
			console.log();
			console.log(fmt.dim('  thumb      Embed thumbnail image'));
			console.log(`    ${fmt.cyan('vidlet thumb')} video.mp4 cover.jpg`);
			console.log();
		});
}
