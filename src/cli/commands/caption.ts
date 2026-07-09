import * as fs from 'node:fs';
import type { Command } from 'commander';
import { runToolCommand } from '../utils.js';

/**
 * Register the caption command
 */
export function registerCaptionCommand(program: Command): void {
  program
    .command('caption <file>')
    .description('Auto-transcribe and burn styled captions into video')
    .option('-g, --gui', 'Open GUI window')
    .option('-s, --style <name>', 'Style: classic|hormozi|karaoke|minimal (default: hormozi)')
    .option('-c, --color <name>', 'Highlight color: yellow|cyan|red|green|white (default: yellow)')
    .option('--srt <path>', 'Use existing SRT file instead of auto-transcribe')
    .option('--font-size <n>', 'Font size (default: 48)')
    .option('--position <pos>', 'Position: bottom|center|top (default: bottom)')
    .option('--model <name>', 'Whisper model: tiny.en|base.en|small.en (default: base.en)')
    .option('-o <path>', 'Output file path')
    .action((file: string, options) =>
      runToolCommand('caption', file, options, () => {
        // If --srt is provided, read the SRT file; otherwise auto-transcribe
        const srtContent = options.srt ? fs.readFileSync(options.srt, 'utf-8') : undefined;

        return {
          output: options.o,
          srtContent,
          autoTranscribe: !options.srt,
          style: options.style,
          highlightColor: options.color,
          fontSize: options.fontSize ? Number.parseInt(options.fontSize, 10) : undefined,
          position: options.position,
          whisperModel: options.model,
        };
      })
    );
}
