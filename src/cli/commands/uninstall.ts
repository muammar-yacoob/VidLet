import type { Command } from 'commander';
import { printBanner } from '../../lib/banner.js';
import { fmt } from '../../lib/logger.js';
import { isWSL, isWSLInteropEnabled, wslToWindows } from '../../lib/paths.js';
import { generateUninstallRegFile, unregisterAllTools } from '../registry.js';

/**
 * Register the uninstall command
 */
export function registerUninstallCommand(program: Command): void {
	program
		.command('uninstall')
		.description('Remove Windows shell context menu integration')
		.action(async () => {
			printBanner();
			console.log(fmt.bold('Uninstalling...\n'));

			if (!isWSL()) {
				console.log(fmt.yellow('! Not running in WSL. Registry removal skipped.'));
				console.log(fmt.yellow('! Run "vidlet uninstall" from WSL to remove context menu.'));
				return;
			}

			if (!isWSLInteropEnabled()) {
				console.log(fmt.yellow('WSL Interop not available. Generating registry file...\n'));

				const regPath = await generateUninstallRegFile();
				const winPath = wslToWindows(regPath);

				console.log(fmt.green('✓ Generated uninstall registry file:'));
				console.log(fmt.cyan(`  ${winPath}\n`));
				console.log(fmt.bold('To uninstall, either:'));
				console.log(fmt.dim('  1. Double-click the .reg file in Windows Explorer'));
				console.log(fmt.dim(`  2. Run in elevated PowerShell: reg import "${winPath}"`));
				console.log();
				return;
			}

			const results = await unregisterAllTools();

			// Group results by tool name
			const grouped = new Map<string, { extensions: string[]; allSuccess: boolean }>();
			for (const result of results) {
				const existing = grouped.get(result.toolName);
				if (existing) {
					existing.extensions.push(result.extension);
					existing.allSuccess = existing.allSuccess && result.success;
				} else {
					grouped.set(result.toolName, {
						extensions: [result.extension],
						allSuccess: result.success,
					});
				}
			}

			// Display grouped results
			let successCount = 0;
			for (const [toolName, { extensions, allSuccess }] of grouped) {
				const extList = extensions.join(', ');
				if (allSuccess) {
					console.log(`${fmt.green('✓')} ${toolName} ${fmt.dim(`[${extList}]`)}`);
					successCount++;
				} else {
					console.log(`${fmt.dim('○')} ${toolName} ${fmt.dim(`[${extList}]`)} ${fmt.dim('(not found)')}`);
				}
			}

			console.log();
			console.log(fmt.green('✓ Context menu entries removed.'));
			console.log();
		});
}
