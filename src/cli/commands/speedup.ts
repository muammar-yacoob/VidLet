import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/** Parse pitch value: "5%" → 0.05, "-0.03" → -0.03 */
function parsePitch(val: string): number {
  if (val.endsWith('%')) {
    return Number.parseFloat(val.slice(0, -1)) / 100;
  }
  return Number.parseFloat(val);
}

/**
 * Register the speedup command
 */
export function registerSpeedupCommand(program: Command): void {
  program
    .command('speedup <file>')
    .description('Speed up video tempo while preserving pitch')
    .option('-g, --gui', 'Open GUI window')
    .option('-s <factor>', 'Speed multiplier (default: 1.5)')
    .option('-p <percent>', 'Pitch shift: -0.03 or -0.03% (default: -0.03)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('speedup', file, options, () => ({
        output: options.o,
        speed: options.s ? Number.parseFloat(options.s) : undefined,
        pitchShift: options.p ? parsePitch(options.p) : undefined,
      }))
    );
}
