import { Command } from 'commander';
import { showHelp } from '../lib/help.js';
import {
	registerCompressCommand,
	registerConfigCommand,
	registerHelpCommand,
	registerInstallCommand,
	registerLoopCommand,
	registerMkv2mp4Command,
	registerShrinkCommand,
	registerThumbCommand,
	registerTogifCommand,
	registerUninstallCommand,
	registerVidletCommand,
} from './commands/index.js';

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
	const program = new Command();

	// Override default help
	program.helpInformation = () => '';
	program.on('--help', () => {});

	program
		.name('vidlet')
		.description('Video utility toolkit with Windows shell integration')
		.version('1.0.0')
		.action(() => {
			showHelp();
		});

	// Register all commands
	registerHelpCommand(program);
	registerInstallCommand(program);
	registerUninstallCommand(program);
	registerConfigCommand(program);

	// Tool commands
	registerCompressCommand(program);
	registerTogifCommand(program);
	registerMkv2mp4Command(program);
	registerShrinkCommand(program);
	registerThumbCommand(program);
	registerLoopCommand(program);
	registerVidletCommand(program);

	return program;
}

// Re-export tools and utilities
export * from './tools.js';
export * from './registry.js';
export * from './utils.js';
