import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { fmt, header, success, warn } from './lib/logger.js';
import { isWSL } from './lib/paths.js';

const REGISTRY_KEYS = [
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\Shell\\VidLetCompress',
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\Shell\\VidLetToGif',
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\Shell\\VidLetShrink',
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\Shell\\VidLetThumb',
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mp4\\Shell\\VidLetLoop',
  'HKEY_CLASSES_ROOT\\SystemFileAssociations\\.mkv\\Shell\\VidLetMkv2Mp4',
];

/**
 * Generate uninstall registry content
 */
function generateUninstallRegContent(): string {
  const lines: string[] = ['Windows Registry Editor Version 5.00', ''];

  for (const key of REGISTRY_KEYS) {
    lines.push(`[-${key}]`);
    lines.push('');
  }

  return lines.join('\r\n');
}

/**
 * Uninstall Windows shell context menu integration
 */
export async function uninstall(): Promise<void> {
  header('VidLet Uninstall');

  const regContent = generateUninstallRegContent();
  const regPath = path.join(os.tmpdir(), 'vidlet_uninstall.reg');
  await fs.writeFile(regPath, regContent, 'utf-8');

  console.log(fmt.dim(`Uninstall registry file created: ${regPath}`));

  if (isWSL()) {
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
    console.log(fmt.dim('Or run these commands to delete keys individually:'));
    console.log('');

    for (const key of REGISTRY_KEYS) {
      console.log(fmt.dim(`  reg delete "${key}" /f`));
    }
  } else {
    console.log(fmt.dim('Removing registry entries...'));

    let allSuccess = true;
    for (const key of REGISTRY_KEYS) {
      try {
        await execa('reg', ['delete', key, '/f']);
      } catch {
        allSuccess = false;
      }
    }

    if (allSuccess) {
      success('Registry entries removed successfully!');
    } else {
      warn('Some registry entries could not be removed.');
      console.log(fmt.dim('Run as Administrator or import the uninstall .reg file.'));
    }
  }

  console.log('');
  success('Uninstall complete!');
}

/**
 * Generate and get the uninstall registry file path
 */
export async function generateUninstallRegFile(): Promise<string> {
  const regContent = generateUninstallRegContent();
  const regPath = path.join(os.tmpdir(), 'vidlet_uninstall.reg');
  await fs.writeFile(regPath, regContent, 'utf-8');
  return regPath;
}
