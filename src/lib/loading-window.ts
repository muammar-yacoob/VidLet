/**
 * Loading Window Manager - Handles the loading HTA lifecycle
 *
 * Flow:
 * 1. VBS launcher cleans up stale files and opens HTA
 * 2. Node.js starts server
 * 3. When server is ready, writes URL to ready file
 * 4. HTA reads URL, opens Edge, fades out, closes
 * 5. Edge window appears (only one window visible at a time)
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Cache Windows temp directory
let cachedTempDir: string | null = null;

/**
 * Get Windows temp directory (works in WSL)
 */
function getWindowsTempDir(): string {
	if (cachedTempDir) return cachedTempDir;

	try {
		// Get Windows TEMP path via cmd.exe
		const winTemp = execSync('cmd.exe /c echo %TEMP%', {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();
		// Convert Windows path to WSL path
		const wslPath = execSync(`wslpath -u "${winTemp}"`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();
		cachedTempDir = wslPath;
		return wslPath;
	} catch {
		// Fallback: use Windows username from environment or path
		const winUser = process.env.WSLENV
			? process.env.USERNAME
			: execSync('cmd.exe /c echo %USERNAME%', {
					encoding: 'utf-8',
					stdio: ['pipe', 'pipe', 'pipe'],
				})
					.trim()
					.replace(/\r?\n/g, '');
		cachedTempDir = `/mnt/c/Users/${winUser || 'Default'}/AppData/Local/Temp`;
		return cachedTempDir;
	}
}

/**
 * Get the path to the ready signal file
 */
function getReadyFilePath(): string {
	return path.join(getWindowsTempDir(), 'vidlet-ready.tmp');
}

/**
 * Get the path to the progress signal file
 */
function getProgressFilePath(): string {
	return path.join(getWindowsTempDir(), 'vidlet-progress.tmp');
}

/**
 * Clean up any stale signal files from previous sessions
 * Uses synchronous operations to ensure completion before continuing
 */
export function cleanupSignalFiles(): void {
	const readyFile = getReadyFilePath();
	const progressFile = getProgressFilePath();
	try {
		if (fs.existsSync(readyFile)) {
			fs.unlinkSync(readyFile);
		}
		if (fs.existsSync(progressFile)) {
			fs.unlinkSync(progressFile);
		}
	} catch {
		// Ignore errors
	}
}

/**
 * Update loading progress in the HTA
 * @param percent - Progress percentage (0-100)
 */
export function updateLoadingProgress(percent: number): void {
	const progressFile = getProgressFilePath();
	try {
		fs.writeFileSync(progressFile, String(Math.round(percent)), 'utf-8');
	} catch {
		// Ignore errors
	}
}

/**
 * Signal the loading HTA to open the main window and close
 * Writes the URL to the ready file so HTA can open Edge
 * @param url - The URL for Edge to open
 */
export function signalLoadingComplete(url: string): void {
	const readyFile = getReadyFilePath();
	try {
		fs.writeFileSync(readyFile, url, 'utf-8');
	} catch (err) {
		console.error('Failed to write ready signal:', err);
	}
}
