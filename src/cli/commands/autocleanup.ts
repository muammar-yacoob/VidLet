import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

export function registerAutoCleanupCommand(program: Command): void {
  program
    .command('autocleanup <file>')
    .description('Auto cleanup: denoise, remove silence, contrast, compress')
    .option('-n <level>', 'Denoise strength 1-10 (default: 3)')
    .option('-d <seconds>', 'Minimum silence duration to cut (default: 1.2)')
    .option('-p <seconds>', 'Breathing room kept around each cut (default: 0.3)')
    .option('--no-contrast', 'Skip the contrast step')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('autocleanup', file, options, () => ({
        output: options.o,
        noiseReduction: options.n ? Number.parseFloat(options.n) : undefined,
        minSilenceDuration: options.d ? Number.parseFloat(options.d) : undefined,
        silencePadding: options.p ? Number.parseFloat(options.p) : undefined,
        skipContrast: options.contrast === false,
      }))
    );
}
