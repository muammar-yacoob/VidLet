import { existsSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { execa } from 'execa';

/**
 * Detect if running in WSL environment
 */
export function isWSL(): boolean {
  return process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || !!process.env.WSLENV);
}

/**
 * Check if WSL interop is enabled (can run Windows executables)
 */
export function isWSLInteropEnabled(): boolean {
  return existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
}

/**
 * Convert Windows path to WSL path
 * @example toWSLPath('C:\\Users\\test.mp4') => '/mnt/c/Users/test.mp4'
 */
export async function toWSLPath(windowsPath: string): Promise<string> {
  if (!windowsPath) {
    throw new Error('Path is required');
  }

  // If already a WSL path, return as-is
  if (windowsPath.startsWith('/')) {
    return windowsPath;
  }

  try {
    const { stdout } = await execa('wslpath', ['-u', windowsPath]);
    return stdout.trim();
  } catch {
    // Fallback manual conversion
    return manualToWSLPath(windowsPath);
  }
}

/**
 * Convert WSL path to Windows path
 * @example toWindowsPath('/mnt/c/Users/test.mp4') => 'C:\\Users\\test.mp4'
 */
export async function toWindowsPath(wslPath: string): Promise<string> {
  if (!wslPath) {
    throw new Error('Path is required');
  }

  // If already a Windows path, return as-is
  if (/^[A-Za-z]:/.test(wslPath)) {
    return wslPath;
  }

  try {
    const { stdout } = await execa('wslpath', ['-w', wslPath]);
    return stdout.trim();
  } catch {
    // Fallback manual conversion
    return manualToWindowsPath(wslPath);
  }
}

/**
 * Manual Windows to WSL path conversion (fallback)
 */
function manualToWSLPath(windowsPath: string): string {
  // Handle UNC paths (\\server\share)
  if (windowsPath.startsWith('\\\\')) {
    const parts = windowsPath.slice(2).split('\\');
    return `/mnt/${parts.join('/')}`;
  }

  // Handle drive letters (C:\path)
  const match = windowsPath.match(/^([A-Za-z]):(.*)/);
  if (match) {
    const [, drive, rest] = match;
    const unixPath = rest.replace(/\\/g, '/');
    return `/mnt/${drive.toLowerCase()}${unixPath}`;
  }

  // Return as-is if no conversion needed
  return windowsPath.replace(/\\/g, '/');
}

/**
 * Synchronous WSL to Windows path conversion
 * @example wslToWindows('/mnt/c/Users/test.mp4') => 'C:\\Users\\test.mp4'
 */
export function wslToWindows(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/i);
  if (match) {
    const [, drive, rest = ''] = match;
    return `${drive.toUpperCase()}:${rest.replace(/\//g, '\\')}`;
  }
  return wslPath;
}

/**
 * Synchronous Windows to WSL path conversion
 * @example windowsToWsl('C:\\Users\\test.mp4') => '/mnt/c/Users/test.mp4'
 */
export function windowsToWsl(winPath: string): string {
  const match = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return winPath;
}

/**
 * Manual WSL to Windows path conversion (fallback)
 */
function manualToWindowsPath(wslPath: string): string {
  // Handle /mnt/c/... paths
  const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (match) {
    const [, drive, rest = ''] = match;
    return `${drive.toUpperCase()}:${rest.replace(/\//g, '\\')}`;
  }

  return wslPath;
}

/**
 * Ensure VidLet output directory exists
 */
function ensureVidLetDir(inputPath: string): string {
  const dir = dirname(inputPath);
  const vidletDir = join(dir, 'VidLet');
  if (!existsSync(vidletDir)) {
    mkdirSync(vidletDir, { recursive: true });
  }
  return vidletDir;
}

/**
 * Generate output filename with suffix in VidLet subdirectory
 * @example getOutputPath('/path/video.mp4', '_compressed') => '/path/VidLet/video_compressed.mp4'
 */
export function getOutputPath(inputPath: string, suffix: string): string {
  const vidletDir = ensureVidLetDir(inputPath);
  const fileName = basename(inputPath);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return join(vidletDir, `${fileName}${suffix}`);
  }
  return join(vidletDir, `${fileName.slice(0, lastDot)}${suffix}${fileName.slice(lastDot)}`);
}

/**
 * Change file extension and output to VidLet subdirectory
 * @example changeExtension('/path/video.mp4', '.gif') => '/path/VidLet/video.gif'
 */
export function changeExtension(inputPath: string, newExt: string): string {
  const vidletDir = ensureVidLetDir(inputPath);
  const fileName = basename(inputPath);
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return join(vidletDir, `${fileName}${newExt}`);
  }
  return join(vidletDir, `${fileName.slice(0, lastDot)}${newExt}`);
}
