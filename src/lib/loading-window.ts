/**
 * Loading Window Manager - Handles the loading HTA lifecycle
 *
 * Flow:
 * 1. VBS launcher cleans up stale files and opens HTA
 * 2. Node.js starts server, opens Edge (behind HTA)
 * 3. Frontend caches frames, reports progress via /api/progress
 * 4. When threshold reached, /api/ready signals HTA to close
 * 5. HTA fades out, revealing the main window
 */

import { spawn, spawnSync } from 'node:child_process';

/**
 * Clean up any stale signal/progress files from previous sessions
 * Uses synchronous spawn to ensure completion before continuing
 */
export function cleanupSignalFiles(): void {
	spawnSync(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			'Remove-Item -Path $env:TEMP\\vidlet-ready.tmp,$env:TEMP\\vidlet-progress.tmp -Force -ErrorAction SilentlyContinue',
		],
		{
			stdio: 'ignore',
			windowsHide: true,
		},
	);
}

/**
 * Signal the loading HTA to close by creating the ready file
 */
export function signalLoadingComplete(): void {
	spawn(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			'New-Item -Path $env:TEMP\\vidlet-ready.tmp -ItemType File -Force | Out-Null',
		],
		{
			stdio: 'ignore',
			windowsHide: true,
		},
	);
}

/**
 * Update caching progress (displayed in loading HTA)
 * @param percent - Progress percentage (0-100)
 */
export function updateLoadingProgress(percent: number): void {
	const rounded = Math.round(percent);
	spawn(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			`Set-Content -Path $env:TEMP\\vidlet-progress.tmp -Value '${rounded}' -Force`,
		],
		{
			stdio: 'ignore',
			windowsHide: true,
		},
	);
}

/**
 * Open the main app window in Edge app mode
 * Window opens behind the loading HTA (which is topmost)
 * @param url - URL to open in Edge
 */
export function openMainWindow(url: string): void {
	// Clean up any stale signal files first
	cleanupSignalFiles();

	// Open Edge in app mode (no browser UI)
	// The loading HTA is topmost, so Edge opens behind it
	spawn(
		'powershell.exe',
		[
			'-WindowStyle',
			'Hidden',
			'-Command',
			`Start-Process msedge -ArgumentList '--app=${url}'`,
		],
		{
			detached: true,
			stdio: 'ignore',
			windowsHide: true,
		},
	).unref();
}
