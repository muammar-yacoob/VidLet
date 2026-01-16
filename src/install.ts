import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { fmt, header, success, warn } from './lib/logger.js';
import { isWSL } from './lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SubMenuEntry {
  key: string;
  label: string;
  command: string;
}

const MP4_MENU_ENTRIES: SubMenuEntry[] = [
  { key: 'Compress', label: 'Compress Video', command: 'compress' },
  { key: 'ToGif', label: 'Convert to GIF', command: 'togif' },
  { key: 'Shrink', label: 'Shrink Video', command: 'shrink' },
  { key: 'Loop', label: 'Create Loop', command: 'loop' },
];

const MKV_MENU_ENTRIES: SubMenuEntry[] = [
  { key: 'Mkv2Mp4', label: 'Convert to MP4', command: 'mkv2mp4' },
];

/**
 * Get the Windows path to the icon file
 */
async function getIconPath(): Promise<string> {
  // Icon is in the package's icons folder
  const iconPath = path.resolve(__dirname, '../icons/tv.ico');

  if (isWSL()) {
    try {
      const { stdout } = await execa('wslpath', ['-w', iconPath]);
      return stdout.trim();
    } catch {
      return iconPath;
    }
  }
  return iconPath;
}

/**
 * Generate Windows registry file content with cascading menu
 */
async function generateRegContent(): Promise<string> {
  const iconPath = await getIconPath();
  const lines: string[] = ['Windows Registry Editor Version 5.00', ''];

  // Generate menu for .mp4 files
  const mp4Base = 'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\shell\\VidLet';
  const mp4SubCommands = MP4_MENU_ENTRIES.map((e) => `VidLet.${e.key}`).join(';');

  lines.push(`[${mp4Base}]`);
  lines.push(`"MUIVerb"="VidLet"`);
  lines.push(`"Icon"="${iconPath.replace(/\\/g, '\\\\')}"`);
  lines.push(`"SubCommands"="${mp4SubCommands}"`);
  lines.push('');

  // Add subcommands for .mp4
  for (const entry of MP4_MENU_ENTRIES) {
    const cmdBase = `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\VidLet.${entry.key}`;
    lines.push(`[${cmdBase}]`);
    lines.push(`@="${entry.label}"`);
    lines.push('');
    lines.push(`[${cmdBase}\\command]`);
    lines.push(
      `@="wsl.exe -e bash -c \\"vidlet ${entry.command} \\\\\\"$(wslpath '%1')\\\\\\"\\""`
    );
    lines.push('');
  }

  // Generate menu for .mkv files
  const mkvBase = 'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mkv\\shell\\VidLet';
  const mkvSubCommands = MKV_MENU_ENTRIES.map((e) => `VidLet.${e.key}`).join(';');

  lines.push(`[${mkvBase}]`);
  lines.push(`"MUIVerb"="VidLet"`);
  lines.push(`"Icon"="${iconPath.replace(/\\/g, '\\\\')}"`);
  lines.push(`"SubCommands"="${mkvSubCommands}"`);
  lines.push('');

  // Add subcommands for .mkv
  for (const entry of MKV_MENU_ENTRIES) {
    const cmdBase = `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell\\VidLet.${entry.key}`;
    lines.push(`[${cmdBase}]`);
    lines.push(`@="${entry.label}"`);
    lines.push('');
    lines.push(`[${cmdBase}\\command]`);
    lines.push(
      `@="wsl.exe -e bash -c \\"vidlet ${entry.command} \\\\\\"$(wslpath '%1')\\\\\\"\\""`
    );
    lines.push('');
  }

  return lines.join('\r\n');
}

/**
 * Install Windows shell context menu integration
 */
export async function install(): Promise<void> {
  if (!isWSL()) {
    warn('Warning: This command should be run from WSL.');
    console.log(fmt.dim('The registry file will be generated but may need manual import.'));
  }

  header('VidLet Windows Integration');

  const regContent = await generateRegContent();
  const regPath = path.join(os.tmpdir(), 'vidlet_install.reg');
  await fs.writeFile(regPath, regContent, 'utf-8');

  console.log(fmt.dim(`Registry file created: ${regPath}`));

  if (isWSL()) {
    console.log(fmt.dim('Importing registry (requires elevation)...'));
    console.log('');
    warn('Please run the following command in an elevated PowerShell:');
    console.log('');

    try {
      const { stdout: winPath } = await execa('wslpath', ['-w', regPath]);
      console.log(fmt.white(`  reg import "${winPath.trim()}"`));
    } catch {
      console.log(fmt.white(`  reg import "${regPath}"`));
    }

    console.log('');
    console.log(fmt.dim('Or double-click the .reg file in Windows Explorer.'));
  } else {
    console.log(fmt.dim('Importing registry...'));

    try {
      await execa('reg', ['import', regPath]);
      success('Registry imported successfully!');
    } catch {
      console.log(fmt.red('Failed to import registry. Run as Administrator.'));
      console.log(fmt.dim(`Manual import: reg import "${regPath}"`));
    }
  }

  console.log('');
  success('Installation complete!');
  console.log(fmt.dim('Right-click video files to see VidLet menu.'));
}

/**
 * Generate and display the registry file path
 */
export async function generateRegFile(): Promise<string> {
  const regContent = await generateRegContent();
  const regPath = path.join(os.tmpdir(), 'vidlet_install.reg');
  await fs.writeFile(regPath, regContent, 'utf-8');
  return regPath;
}

/**
 * Get the registry content as string (for inspection)
 */
export async function getRegContent(): Promise<string> {
  return generateRegContent();
}
