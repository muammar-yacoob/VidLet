import type { Command } from 'commander';
import { getConfigPath, loadToolsConfig, resetToolsConfig } from '../../lib/config.js';
import { fmt } from '../../lib/logger.js';

/**
 * Register the config command
 */
export function registerConfigCommand(program: Command): void {
	const configCmd = program
		.command('config')
		.description('Display current settings')
		.action(async () => {
			try {
				const config = await loadToolsConfig();
				console.log(fmt.bold('\n  VidLet Configuration'));
				console.log(fmt.dim(`  ${getConfigPath()}\n`));
				console.log(JSON.stringify(config, null, 2));
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});

	configCmd
		.command('reset')
		.description('Reset to defaults')
		.action(async () => {
			try {
				await resetToolsConfig();
				console.log(fmt.green('Configuration reset to defaults.'));
			} catch (error) {
				console.error(fmt.red(`Error: ${(error as Error).message}`));
				process.exit(1);
			}
		});
}
