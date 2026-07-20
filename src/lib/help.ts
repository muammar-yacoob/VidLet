import { printBanner } from './banner.js';
import { fmt } from './logger.js';

/**
 * Display custom help formatting
 */
export function showHelp(): void {
  printBanner();

  const cmd = fmt.cyan;
  const arg = fmt.yellow;
  const opt = fmt.green;
  const head = fmt.bold;
  const $ = fmt.gray('$');
  const comment = fmt.gray;

  console.log(
    `  ${head('Usage:')} vidlet ${cmd('<command>')} ${arg('<file>')} ${opt('[options]')}`
  );
  console.log();
  console.log(head('  All-in-one'));
  console.log(`    ${cmd('vidlet')} ${arg('<file>')}            Open unified GUI with all tools`);
  console.log(`    ${cmd('autocleanup')} ${arg('<file>')}       Denoise + de-silence + compress`);
  console.log();
  console.log(head('  Video Tools'));
  console.log(`    ${cmd('compress')} ${arg('<file>')}          Reduce file size with H.264`);
  console.log(`    ${cmd('togif')} ${arg('<file>')}             Convert to optimized GIF`);
  console.log(`    ${cmd('mkv2mp4')} ${arg('<file>')}           Convert MKV to MP4`);
  console.log(`    ${cmd('shrink')} ${arg('<file>')}            Speed up for YouTube Shorts`);
  console.log(`    ${cmd('thumb')} ${arg('<file> <image>')}     Embed thumbnail image`);
  console.log(`    ${cmd('loop')} ${arg('<file>')}              Create seamless loop`);
  console.log();
  console.log(head('  AI Tools'));
  console.log(`    ${cmd('caption')} ${arg('<file>')}           Auto-transcribe + burn captions`);
  console.log(`    ${cmd('jumpcut')} ${arg('<file>')}           Auto-edit: cut silence + zoom`);
  console.log(
    `    ${cmd('voiceover')} ${arg('<script>')}        Narration: free TTS or clone your voice`
  );
  console.log();
  console.log(head('  Audio Tools'));
  console.log(`    ${cmd('cleanvoice')} ${arg('<file>')}        Denoise and enhance voice`);
  console.log(`    ${cmd('removesilence')} ${arg('<file>')}     Cut silent segments`);
  console.log(`    ${cmd('extractaudio')} ${arg('<file>')}      Extract audio track`);
  console.log();
  console.log(head('  Other'));
  console.log(`    ${cmd('optimize')} ${arg('<file>')}          Optimize Lottie JSON or GIF`);
  console.log();
  console.log(head('  Setup'));
  console.log(`    ${cmd('install')}                Add Windows right-click menu`);
  console.log(`    ${cmd('uninstall')}              Remove right-click menu`);
  console.log(`    ${cmd('config')}                 Display current settings`);
  console.log(`    ${cmd('config reset')}           Restore defaults`);
  console.log(
    `    ${cmd('config set-key')} ${arg('<key>')}    Set Spark AI key ${fmt.dim('(sparkbrain.app)')}`
  );
  console.log();
  console.log(head('  Options'));
  console.log(`    ${opt('-g, --gui')}              Open GUI window`);
  console.log(`    ${opt('-y, --yes')}              Use defaults, skip prompts`);
  console.log(`    ${opt('-o <path>')}              Output file path`);
  console.log();
  console.log(head('  Examples'));
  console.log(
    `    ${$} vidlet ${arg('clip.mp4')}                    ${comment('# Open unified GUI')}`
  );
  console.log(
    `    ${$} vidlet ${cmd('autocleanup')} ${arg('clip.mp4')}        ${comment('# One-click cleanup')}`
  );
  console.log(
    `    ${$} vidlet ${cmd('compress')} ${arg('clip.mp4')} ${opt('-b 2000')}    ${comment('# 2000 kbps bitrate')}`
  );
  console.log(
    `    ${$} vidlet ${cmd('removesilence')} ${arg('clip.mp4')}      ${comment('# Cut dead air')}`
  );
  console.log(
    `    ${$} vidlet ${cmd('cleanvoice')} ${arg('clip.mp4')} ${opt('-n 7')}     ${comment('# Heavy denoise')}`
  );
  console.log(
    `    ${$} vidlet ${cmd('togif')} ${arg('clip.mp4')} ${opt('-g')}            ${comment('# Open GUI')}`
  );

  console.log();
  console.log(head('  Requirements'));
  console.log('    - WSL (Windows Subsystem for Linux)');
  console.log('    - FFmpeg: sudo apt install ffmpeg');
}
