import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the shrink command
 */
export function registerShrinkCommand(program: Command): void {
  program
    .command('shrink <file>')
    .description('Speed up video to fit target duration')
    .option('-g, --gui', 'Open GUI window')
    .option('-t <seconds>', 'Target duration (default: 59.5)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('shrink', file, options, () => ({
        output: options.o,
        targetDuration: options.t ? Number.parseFloat(options.t) : undefined,
      }))
    );
}
