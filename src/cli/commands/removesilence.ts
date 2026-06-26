import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

export function registerRemoveSilenceCommand(program: Command): void {
  program
    .command('removesilence <file>')
    .description('Remove silent segments from video')
    .option('-d <seconds>', 'Minimum silence duration in seconds (default: 0.5)')
    .option('-t <dB>', 'Silence threshold in dB (default: -30)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('removesilence', file, options, () => ({
        output: options.o,
        minSilenceDuration: options.d ? Number.parseFloat(options.d) : undefined,
        silenceThreshold: options.t ? Number.parseFloat(options.t) : undefined,
      }))
    );
}
