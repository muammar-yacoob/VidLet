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
	console.log(head('  Options'));
	console.log(`    ${opt('-g, --gui')}            Open GUI window`);
	console.log(`    ${opt('-y, --yes')}            Use defaults, skip prompts`);
	console.log(`    ${opt('-o <path>')}            Output file path`);
	console.log();
	console.log(head('  Examples'));
	console.log(`    ${$} vidlet ${cmd('compress')} ${arg('clip.mp4')} ${opt('-b 2000')}    ${comment('# 2000 kbps bitrate')}`);
	console.log(`    ${$} vidlet ${cmd('togif')} ${arg('clip.mp4')} ${opt('-g')}            ${comment('# Open GUI')}`);
	console.log(`    ${$} vidlet ${cmd('mkv2mp4')} ${arg('clip.mkv')} ${opt('-y')}          ${comment('# Use defaults')}`);
	console.log(`    ${$} vidlet ${cmd('shrink')} ${arg('clip.mp4')} ${opt('-t 30')}        ${comment('# Fit to 30 seconds')}`);
	console.log(`    ${$} vidlet ${cmd('thumb')} ${arg('clip.mp4 cover.png')}     ${comment('# Embed thumbnail')}`);
	console.log(`    ${$} vidlet ${cmd('loop')} ${arg('clip.mp4')} ${opt('-s 1 -e 3')}      ${comment('# Loop 1s to 3s')}`);

	console.log();
	console.log(head('  Requirements'));
	console.log('    - WSL (Windows Subsystem for Linux)');
	console.log('    - FFmpeg: sudo apt install ffmpeg');
}
