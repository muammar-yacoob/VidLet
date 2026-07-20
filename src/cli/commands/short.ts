import type { Command } from 'commander';
import { short } from '../../tools/short.js';
import { handleError, resolveInputPath } from '../utils.js';

export function registerShortCommand(program: Command): void {
  program
    .command('short <file>')
    .description('AI Short: Groq picks the highlights, crop follows the action, 9:16 output')
    .option('-o <path>', 'Output file path')
    .option('-d <seconds>', 'Target length in seconds (default: 57, max 60)')
    .option('--model <model>', 'Whisper model: tiny.en, base.en, small.en (default: base.en)')
    .option('-c, --captions', 'Burn styled captions into the short')
    .option('-s, --style <style>', 'Caption style: hormozi, karaoke, classic, minimal')
    .option('--from-segments <json>', 'Re-render from an edited .segments.json (skips AI)')
    .action(async (file: string, options) => {
      try {
        await short({
          input: await resolveInputPath(file),
          output: options.o,
          maxDuration: options.d ? Math.min(60, Number.parseFloat(options.d)) : undefined,
          whisperModel: options.model,
          captions: options.captions,
          captionStyle: options.style,
          fromSegments: options.fromSegments,
        });
      } catch (error) {
        handleError(error);
      }
    });
}
