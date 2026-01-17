import type { Command } from 'commander';
import { showHelp } from '../../lib/help.js';

/**
 * Register the help command
 */
export function registerHelpCommand(program: Command): void {
	program
		.command('help')
		.description('Show help')
		.action(() => {
			showHelp();
		});
}
