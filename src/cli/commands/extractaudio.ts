import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the extractaudio command
 */
export function registerExtractAudioCommand(program: Command): void {
  program
    .command('extractaudio <file>')
    .description('Extract audio track from video')
    .option('-f <format>', 'Audio format: mp3|aac|wav|flac|ogg (default: mp3)')
    .option('-b <kbps>', 'Bitrate in kb/s (default: 192)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('extractaudio', file, options, () => ({
        output: options.o,
        format: options.f,
        bitrate: options.b ? Number.parseInt(options.b, 10) : undefined,
      }))
    );
}
