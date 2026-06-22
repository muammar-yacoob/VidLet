import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the loop command
 */
export function registerLoopCommand(program: Command): void {
  program
    .command('loop <file>')
    .description('Create seamless looping video')
    .option('-g, --gui', 'Open GUI window')
    .option('-s <seconds>', 'Start time in seconds')
    .option('-e <seconds>', 'End time in seconds')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('loop', file, options, () => ({
        output: options.o,
        start: options.s ? Number.parseFloat(options.s) : undefined,
        end: options.e ? Number.parseFloat(options.e) : undefined,
      }))
    );
}
