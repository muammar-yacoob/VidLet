import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the jumpcut command
 */
export function registerJumpcutCommand(program: Command): void {
  program
    .command('jumpcut <file>')
    .description('Auto-edit: cut silence + punch-in zoom on jump cuts')
    .option('-g, --gui', 'Open GUI window')
    .option('-p, --pace <preset>', 'Pace: tight|normal|loose (default: normal)')
    .option('-z, --zoom <pct>', 'Punch-in zoom %: 0-8 (default: 3, 0=off)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('jumpcut', file, options, () => ({
        output: options.o,
        pace: options.pace,
        zoom: options.zoom ? Number.parseFloat(options.zoom) : undefined,
      }))
    );
}
