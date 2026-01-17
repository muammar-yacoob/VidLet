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

			console.log(fmt.bold('\nUsage:'));
			console.log('  Right-click any supported video in Windows Explorer.');
			console.log('  Multi-select supported for batch processing.');
			console.log();
		});
}
