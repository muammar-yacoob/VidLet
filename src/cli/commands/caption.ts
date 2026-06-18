import * as fs from 'node:fs';
import type { Command } from 'commander';
import { fmt } from '../../lib/logger.js';
import { setUseDefaults } from '../../lib/prompts.js';
import { getToolById } from '../tools.js';
import { resolveInputPath } from '../utils.js';

/**
 * Register the caption command
 */
export function registerCaptionCommand(program: Command): void {
  program
    .command('caption <file>')
    .description('Auto-transcribe and burn styled captions into video')
    .option('-g, --gui', 'Open GUI window')
    .option('-y, --yes', 'Use defaults, skip prompts')
    .option('-s, --style <name>', 'Style: classic|hormozi|karaoke|minimal (default: hormozi)')
    .option('-c, --color <name>', 'Highlight color: yellow|cyan|red|green|white (default: yellow)')
    .option('--srt <path>', 'Use existing SRT file instead of auto-transcribe')
    .option('--font-size <n>', 'Font size (default: 48)')
    .option('--position <pos>', 'Position: bottom|center|top (default: bottom)')
    .option('--model <name>', 'Whisper model: tiny.en|base.en|small.en (default: base.en)')
    .option('-o <path>', 'Output file path')
    .action(async (file: string, options) => {
      try {
        const input = await resolveInputPath(file);
        const tool = getToolById('caption');

        if (!tool) {
          throw new Error('Caption tool not found');
        }

        if (options.yes) setUseDefaults(true);

        if (options.gui) {
          await tool.runGUI?.(input);
        } else {
          // If --srt is provided, read the SRT file; otherwise auto-transcribe
          let srtContent: string | undefined;
          let autoTranscribe = true;

          if (options.srt) {
            srtContent = fs.readFileSync(options.srt, 'utf-8');
            autoTranscribe = false;
          }

          await tool.run(input, {
            output: options.o,
            srtContent,
            autoTranscribe,
            style: options.style,
            highlightColor: options.color,
            fontSize: options.fontSize ? Number.parseInt(options.fontSize, 10) : undefined,
            position: options.position,
            whisperModel: options.model,
          });
        }
      } catch (error) {
        console.error(fmt.red(`Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
