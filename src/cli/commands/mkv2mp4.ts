import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the mkv2mp4 command
 */
export function registerMkv2mp4Command(program: Command): void {
  program
    .command('mkv2mp4 <file>')
    .description('Convert MKV to MP4')
    .option('-g, --gui', 'Open GUI window')
    .option('-r', 'Re-encode instead of stream copy')
    .option('-c <value>', 'CRF quality 0-51 (default: 23)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('mkv2mp4', file, options, () => ({
        output: options.o,
        copyStreams: !options.r,
        crf: options.c ? Number.parseInt(options.c, 10) : undefined,
      }))
    );
}
