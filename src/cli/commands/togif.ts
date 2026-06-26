import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the togif command
 */
export function registerTogifCommand(program: Command): void {
  program
    .command('togif <file>')
    .description('Convert video to optimized GIF')
    .option('-g, --gui', 'Open GUI window')
    .option('-f <fps>', 'Frames per second (default: 15)')
    .option('-w <pixels>', 'Output width (default: 480)')
    .option('-d <method>', 'Dither: none|floyd_steinberg|sierra2|bayer')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('togif', file, options, () => ({
        output: options.o,
        fps: options.f ? Number.parseInt(options.f, 10) : undefined,
        width: options.w ? Number.parseInt(options.w, 10) : undefined,
        dither: options.d,
      }))
    );
}
