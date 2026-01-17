import type { Command } from 'commander';
import { printBanner } from '../../lib/banner.js';
import { fmt } from '../../lib/logger.js';
import { isWSL } from '../../lib/paths.js';
import { registerAllTools, unregisterAllTools } from '../registry.js';

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

			// Clean up existing entries first
			console.log(fmt.dim('Removing old entries...'));
			await unregisterAllTools();
			console.log();

			const results = await registerAllTools();

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
					console.log(`${fmt.red('✗')} ${toolName} ${fmt.dim(`[${extList}]`)} ${fmt.red('(failed)')}`);
				}
			}

			console.log();
			if (successCount === grouped.size) {
				console.log(fmt.green(`✓ Registered ${grouped.size} context menu entries.`));
			} else {
				console.log(fmt.yellow(`! Registered ${successCount}/${grouped.size} entries.`));
			}

			console.log(fmt.bold('\nUsage:'));
			console.log('  Right-click any supported video in Windows Explorer.');
			console.log('  Multi-select supported for batch processing.');
			console.log();
		});
}
