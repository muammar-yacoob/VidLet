import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

export function registerCleanVoiceCommand(program: Command): void {
  program
    .command('cleanvoice <file>')
    .description('Clean and enhance voice audio')
    .option('-n <level>', 'Denoise strength 1-10 (default: 5)')
    .option('-l <LUFS>', 'Target loudness in LUFS (default: -14)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('cleanvoice', file, options, () => ({
        output: options.o,
        noiseReduction: options.n ? Number.parseFloat(options.n) : undefined,
        targetLoudness: options.l ? Number.parseFloat(options.l) : undefined,
      }))
    );
}
