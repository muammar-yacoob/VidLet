import type { Command } from 'commander';
import { printBanner } from '../../lib/banner.js';
import { fmt } from '../../lib/logger.js';
import { isWSL } from '../../lib/paths.js';
import { unregisterAllTools } from '../registry.js';

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
