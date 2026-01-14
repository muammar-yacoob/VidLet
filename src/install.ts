import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { fmt, header, separator, success, warn } from './lib/logger.js';
import { isWSL } from './lib/paths.js';

interface ContextMenuEntry {
  extension: string;
  key: string;
  label: string;
  command: string;
  icon?: string;
}

const CONTEXT_MENU_ENTRIES: ContextMenuEntry[] = [
  {
    extension: '.mp4',
    key: 'VidLetCompress',
    label: 'Compress Video',
    command: 'compress',
  },
  {
    extension: '.mp4',
    key: 'VidLetToGif',
    label: 'Convert to GIF',
    command: 'togif',
  },
  {
    extension: '.mp4',
    key: 'VidLetShrink',
    label: 'Shrink Video',
    command: 'shrink',
  },
  {
    extension: '.mp4',
    key: 'VidLetThumb',
    label: 'Set Thumbnail',
    command: 'thumb',
  },
  {
    extension: '.mp4',
    key: 'VidLetLoop',
    label: 'Create Loop',
    command: 'loop',
  },
  {
    extension: '.mkv',
    key: 'VidLetMkv2Mp4',
    label: 'Convert to MP4',
    command: 'mkv2mp4',
  },
];

/**
 * Generate Windows registry file content
 */
function generateRegContent(): string {
  const lines: string[] = ['Windows Registry Editor Version 5.00', ''];

  for (const entry of CONTEXT_MENU_ENTRIES) {
    const regPath = `HKEY_CLASSES_ROOT\\SystemFileAssociations\\${entry.extension}\\Shell\\${entry.key}`;

    lines.push(`[${regPath}]`);
    lines.push(`@="${entry.label}"`);
    lines.push('');

    lines.push(`[${regPath}\\command]`);
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

  const regContent = generateRegContent();
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
  console.log(fmt.dim('Right-click video files to see VidLet options.'));
}

/**
 * Generate and display the registry file path
 */
export async function generateRegFile(): Promise<string> {
  const regContent = generateRegContent();
  const regPath = path.join(os.tmpdir(), 'vidlet_install.reg');
  await fs.writeFile(regPath, regContent, 'utf-8');
  return regPath;
}

/**
 * Get the registry content as string (for inspection)
 */
export function getRegContent(): string {
  return generateRegContent();
}
