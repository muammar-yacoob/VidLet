import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the compress command
 */
export function registerCompressCommand(program: Command): void {
  program
    .command('compress <file>')
    .description('Compress video using H.264 encoding')
    .option('-g, --gui', 'Open GUI window')
    .option('-b <kbps>', 'Bitrate in kb/s (default: 2500)')
    .option('-p <preset>', 'Preset: ultrafast|fast|medium|slow|veryslow')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('compress', file, options, () => ({
        output: options.o,
        bitrate: options.b ? Number.parseInt(options.b, 10) : undefined,
        preset: options.p,
      }))
    );
}
