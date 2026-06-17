import type { Command } from 'commander';
import {
  getConfigPath,
  loadToolsConfig,
  resetToolsConfig,
  saveToolsConfig,
} from '../../lib/config.js';
import { fmt } from '../../lib/logger.js';

/**
 * Register the config command
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Display current settings')
    .action(async () => {
      try {
        const config = await loadToolsConfig();
        console.log(fmt.bold('\n  VidLet Configuration'));
        console.log(fmt.dim(`  ${getConfigPath()}\n`));
        // Mask the AI key in display
        const display = {
          ...config,
          app: {
            ...config.app,
            sparkAiKey: config.app.sparkAiKey ? `••••${config.app.sparkAiKey.slice(-4)}` : '',
          },
        };
        console.log(JSON.stringify(display, null, 2));
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  configCmd
    .command('reset')
    .description('Reset to defaults')
    .action(async () => {
      try {
        await resetToolsConfig();
        console.log(fmt.green('Configuration reset to defaults.'));
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  configCmd
    .command('set-key <key>')
    .description('Set Spark AI API key for AI features')
    .action(async (key: string) => {
      try {
        const config = await loadToolsConfig();
        config.app.sparkAiKey = key;
        await saveToolsConfig(config);
        console.log(fmt.green('Spark AI key saved.'));
        console.log(fmt.dim(`Stored in ${getConfigPath()}`));
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
