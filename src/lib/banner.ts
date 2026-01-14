import figlet from 'figlet';
import { fmt } from './logger.js';

/**
 * Generate the VidLet ASCII art banner
 */
export function getBanner(): string {
  const ascii = figlet.textSync('VidLet', {
    font: 'Slant',
    horizontalLayout: 'default',
  });
  return `${fmt.cyan(ascii)}`;
}

/**
 * Print the VidLet banner to console
 */
export function printBanner(): void {
  console.log(getBanner());
  console.log(fmt.dim('  Video utility toolkit with Windows shell integration\n'));
}

/**
 * Print installation success message
 */
export function printInstallSuccess(): void {
  printBanner();
  console.log(`
  Successfully installed! Get started:

  ${fmt.cyan('vidlet --help')}          Show all commands
  ${fmt.cyan('vidlet install')}         Add Windows context menu
  ${fmt.cyan('vidlet compress')} <file> Compress a video
`);
}
