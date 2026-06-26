import type { Command } from 'commander';
import { runGUI } from '../../tools/vidlet-main.js';
import { handleError, resolveInputPath } from '../utils.js';

/**
 * Register the unified vidlet GUI command
 */
export function registerVidletCommand(program: Command): void {
  program
    .command('vidlet <file>')
    .description('Open unified VidLet GUI with all tools')
    .option('-g, --gui', 'Open GUI window (default)')
    .action(async (file: string) => {
      try {
        const input = await resolveInputPath(file);
        const success = await runGUI(input);
        process.exit(success ? 0 : 1);
      } catch (error) {
        handleError(error);
      }
    });
}
