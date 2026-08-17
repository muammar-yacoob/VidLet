import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fmt } from './logger.js';
import { isWSL } from './paths.js';

/**
 * Marker recording that `vidlet install` registered the context menu.
 *
 * npm v12 disables lifecycle scripts by default, so the postinstall hook that
 * used to run `vidlet install` silently no longer fires on fresh installs.
 * The marker lets the CLI notice that state and print a one-line hint instead
 * of querying the Windows registry (a slow cmd.exe interop round-trip) on
 * every invocation.
 */
function markerPath(): string {
  return path.join(os.homedir(), '.config', 'vidlet', '.context-menu-installed');
}

export function markContextMenuInstalled(): void {
  mkdirSync(path.dirname(markerPath()), { recursive: true });
  writeFileSync(markerPath(), new Date().toISOString());
}

export function clearContextMenuMarker(): void {
  rmSync(markerPath(), { force: true });
}

/**
 * Print a hint if the context menu was never installed. WSL-only: elsewhere
 * there is no context menu to install, so the hint would be noise.
 */
export function printInstallHintIfNeeded(): void {
  if (!isWSL() || existsSync(markerPath())) return;
  console.log(
    fmt.yellow('  ! Right-click menu not installed, run ') +
      fmt.cyan('vidlet install') +
      fmt.yellow(' to add it.')
  );
  console.log();
}
