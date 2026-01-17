import { execa } from 'execa';

/**
 * Detect if running in WSL environment
 */
export function isWSL(): boolean {
  return process.platform === 'linux' && (!!process.env.WSL_DISTRO_NAME || !!process.env.WSLENV);
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
 * Generate output filename with suffix
 * @example getOutputPath('/path/video.mp4', '_compressed') => '/path/video_compressed.mp4'
 */
export function getOutputPath(inputPath: string, suffix: string): string {
  const lastDot = inputPath.lastIndexOf('.');
  if (lastDot === -1) {
    return `${inputPath}${suffix}`;
  }
  return `${inputPath.slice(0, lastDot)}${suffix}${inputPath.slice(lastDot)}`;
}

/**
 * Change file extension
 * @example changeExtension('/path/video.mp4', '.gif') => '/path/video.gif'
 */
export function changeExtension(inputPath: string, newExt: string): string {
  const lastDot = inputPath.lastIndexOf('.');
  if (lastDot === -1) {
    return `${inputPath}${newExt}`;
  }
  return `${inputPath.slice(0, lastDot)}${newExt}`;
}
