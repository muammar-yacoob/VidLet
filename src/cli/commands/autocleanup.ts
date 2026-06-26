import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

export function registerAutoCleanupCommand(program: Command): void {
  program
    .command('autocleanup <file>')
    .description('Auto cleanup: denoise, remove silence, contrast, compress')
    .option('-n <level>', 'Denoise strength 1-10 (default: 3)')
    .option('-d <seconds>', 'Minimum silence duration to cut (default: 0.5)')
    .option('--no-contrast', 'Skip the contrast step')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('autocleanup', file, options, () => ({
        output: options.o,
        noiseReduction: options.n ? Number.parseFloat(options.n) : undefined,
        minSilenceDuration: options.d ? Number.parseFloat(options.d) : undefined,
        skipContrast: options.contrast === false,
      }))
    );
}
