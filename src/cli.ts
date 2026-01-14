import { Command } from 'commander';
import { install } from './install.js';
import { printBanner } from './lib/banner.js';
import {
  getConfigPath,
  loadToolsConfig,
  resetToolsConfig,
} from './lib/config.js';
import { fmt } from './lib/logger.js';
import { toWSLPath } from './lib/paths.js';
import { compress } from './tools/compress.js';
import { loop } from './tools/loop.js';
import { mkv2mp4 } from './tools/mkv2mp4.js';
import { shrink } from './tools/shrink.js';
import { thumb } from './tools/thumb.js';
import { togif } from './tools/togif.js';
import { uninstall } from './uninstall.js';

const program = new Command();

// Custom help formatting
function showHelp() {
  printBanner();

  const cmd = fmt.cyan;
  const arg = fmt.yellow;
  const opt = fmt.green;
  const head = fmt.bold;
  const $ = fmt.gray('$');
  const comment = fmt.gray;

  console.log(`  ${head('Usage:')} vidlet ${cmd('<command>')} ${arg('<file>')} ${opt('[options]')}`);
  console.log();
  console.log(head('  Video Tools'));
  console.log(`    ${cmd('compress')} ${arg('<file>')}        Reduce file size with H.264`);
  console.log(`    ${cmd('togif')} ${arg('<file>')}           Convert to optimized GIF`);
  console.log(`    ${cmd('mkv2mp4')} ${arg('<file>')}         Convert MKV to MP4`);
  console.log(`    ${cmd('shrink')} ${arg('<file>')}          Speed up for YouTube Shorts`);
  console.log(`    ${cmd('thumb')} ${arg('<file> <image>')}   Embed thumbnail image`);
  console.log(`    ${cmd('loop')} ${arg('<file>')}            Create seamless loop`);
  console.log();
  console.log(head('  Setup'));
  console.log(`    ${cmd('install')}              Add Windows right-click menu`);
  console.log(`    ${cmd('uninstall')}            Remove right-click menu`);
  console.log();
  console.log(head('  Config'));
  console.log(`    ${cmd('config')}               Display current settings`);
  console.log(`    ${cmd('config reset')}         Restore defaults`);
  console.log();
  console.log(head('  Examples'));
  console.log(`    ${$} vidlet ${cmd('compress')} ${arg('clip.mp4')} ${opt('-b 2000')}    ${comment('# 2000 kbps bitrate')}`);
  console.log(`    ${$} vidlet ${cmd('togif')} ${arg('clip.mp4')} ${opt('-f 10')}         ${comment('# 10 fps GIF')}`);
  console.log(`    ${$} vidlet ${cmd('mkv2mp4')} ${arg('clip.mkv')}             ${comment('# Convert MKV to MP4')}`);
  console.log(`    ${$} vidlet ${cmd('shrink')} ${arg('clip.mp4')} ${opt('-t 30')}        ${comment('# Fit to 30 seconds')}`);
  console.log(`    ${$} vidlet ${cmd('thumb')} ${arg('clip.mp4 cover.png')}     ${comment('# Embed thumbnail')}`);
  console.log(`    ${$} vidlet ${cmd('loop')} ${arg('clip.mp4')} ${opt('-s 1 -e 3')}      ${comment('# Loop 1s to 3s')}`);

  console.log();
  console.log(head('  Requirements'));
  console.log('    - WSL (Windows Subsystem for Linux)');
  console.log('    - FFmpeg: sudo apt install ffmpeg');
}

// Override default help
program.helpInformation = () => '';
program.on('--help', () => {});

program
  .name('vidlet')
  .description('Video utility toolkit with Windows shell integration')
  .version('1.0.0')
  .action(() => {
    showHelp();
  });

// Help command
program
  .command('help')
  .description('Show help')
  .action(() => {
    showHelp();
  });

// Install command
program
  .command('install')
  .description('Install Windows shell context menu integration')
  .action(async () => {
    try {
      await install();
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Uninstall command
program
  .command('uninstall')
  .description('Remove Windows shell context menu integration')
  .action(async () => {
    try {
      await uninstall();
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Compress command
program
  .command('compress <file>')
  .description('Compress video using H.264 encoding')
  .option('-b <kbps>', 'Bitrate in kb/s (default: 2500)')
  .option('-p <preset>', 'Preset: ultrafast|fast|medium|slow|veryslow')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, options) => {
    try {
      const input = await resolveInputPath(file);
      await compress({
        input,
        output: options.o,
        bitrate: options.b ? parseInt(options.b, 10) : undefined,
        preset: options.p,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ToGIF command
program
  .command('togif <file>')
  .description('Convert video to optimized GIF')
  .option('-f <fps>', 'Frames per second (default: 15)')
  .option('-w <pixels>', 'Output width (default: 480)')
  .option('-d <method>', 'Dither: none|floyd_steinberg|sierra2|bayer')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, options) => {
    try {
      const input = await resolveInputPath(file);
      await togif({
        input,
        output: options.o,
        fps: options.f ? parseInt(options.f, 10) : undefined,
        width: options.w ? parseInt(options.w, 10) : undefined,
        dither: options.d,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// MKV to MP4 command
program
  .command('mkv2mp4 <file>')
  .description('Convert MKV to MP4')
  .option('-r', 'Re-encode instead of stream copy')
  .option('-c <value>', 'CRF quality 0-51 (default: 23)')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, options) => {
    try {
      const input = await resolveInputPath(file);
      await mkv2mp4({
        input,
        output: options.o,
        copyStreams: !options.r,
        crf: options.c ? parseInt(options.c, 10) : undefined,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Shrink command
program
  .command('shrink <file>')
  .description('Speed up video to fit target duration')
  .option('-t <seconds>', 'Target duration (default: 59.5)')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, options) => {
    try {
      const input = await resolveInputPath(file);
      await shrink({
        input,
        output: options.o,
        targetDuration: options.t ? parseFloat(options.t) : undefined,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Thumbnail command
program
  .command('thumb <file> <image>')
  .description('Embed thumbnail image into video')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, image: string, options) => {
    try {
      const input = await resolveInputPath(file);
      const imagePath = await resolveInputPath(image);
      await thumb({
        input,
        image: imagePath,
        output: options.o,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Loop command
program
  .command('loop <file>')
  .description('Create seamless looping video')
  .option('-s <seconds>', 'Start time in seconds')
  .option('-e <seconds>', 'End time in seconds')
  .option('-o <path>', 'Output file path')
  .action(async (file: string, options) => {
    try {
      const input = await resolveInputPath(file);
      await loop({
        input,
        output: options.o,
        start: options.s ? parseFloat(options.s) : undefined,
        end: options.e ? parseFloat(options.e) : undefined,
      });
    } catch (error) {
      console.error(fmt.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Config command
const configCmd = program
  .command('config')
  .description('Display current settings')
  .action(async () => {
    try {
      const config = await loadToolsConfig();
      console.log(fmt.bold('\n  VidLet Configuration'));
      console.log(fmt.dim(`  ${getConfigPath()}\n`));
      console.log(JSON.stringify(config, null, 2));
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

/**
 * Resolve input path - converts Windows path to WSL if needed
 */
async function resolveInputPath(inputPath: string): Promise<string> {
  if (/^[A-Za-z]:/.test(inputPath)) {
    return toWSLPath(inputPath);
  }
  return inputPath;
}

// Parse and run
program.parseAsync(process.argv).catch((error) => {
  console.error(fmt.red(`Error: ${error.message}`));
  process.exit(1);
});
