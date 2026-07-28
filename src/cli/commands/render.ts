import type { Command } from 'commander';
import { fmt, header, success } from '../../lib/logger.js';
import { renderProject } from '../../tools/render.js';
import { handleError, resolveInputPath } from '../utils.js';

/**
 * Register the render command — renders a `.vidlet` project file
 * (the CC0 layered-edit format, see docs/vidlet-format.md) to MP4.
 */
export function registerRenderCommand(program: Command): void {
  program
    .command('render <project>')
    .description('Render a .vidlet project file to MP4 (native ffmpeg, NVENC when available)')
    .option('-o <path>', 'Output video path (default: VidLet/<name>.mp4 beside the project)')
    .option('--draft', 'Fast preview render: x264 ultrafast, capped at 720p')
    .option('--resolution <res>', 'Output resolution: WIDTHxHEIGHT (e.g. 1920x1080) or 720p')
    .action(async (project: string, options) => {
      try {
        header('Render');
        const result = await renderProject({
          projectPath: await resolveInputPath(project),
          output: options.o,
          draft: options.draft,
          resolution: options.resolution,
          onProgress: (stage) => console.log(fmt.dim(`  ${stage}...`)),
        });
        success(`Done: ${result.output} (${result.duration}s, ${result.encoder})`);
      } catch (error) {
        handleError(error);
      }
    });
}
