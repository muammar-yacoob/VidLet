import { exec } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { wslToWindows } from '../lib/paths.js';
import { toolConfigs } from './tools.js';

const execAsync = promisify(exec);

/**
 * Get dist directory (where cli.js lives after bundling)
 */
export function getDistDir(): string {
	const currentFile = fileURLToPath(import.meta.url);
	// tsup bundles everything into dist/cli.js, so dirname gives dist/
	return dirname(currentFile);
}

/**
 * Get registry base path for VidLet menu on an extension
 */
export function getMenuBasePath(extension: string): string {
	return `HKCU\\Software\\Classes\\SystemFileAssociations\\${extension}\\shell\\VidLet`;
}

/**
 * Add a registry key with value
 */
export async function addRegistryKey(
	keyPath: string,
	valueName: string,
	value: string,
	type = 'REG_SZ',
): Promise<boolean> {
	const valueArg = valueName ? `/v "${valueName}"` : '/ve';
	const escapedValue = value.replace(/"/g, '\\"');
	const cmd = `reg.exe add "${keyPath}" ${valueArg} /t ${type} /d "${escapedValue}" /f`;

	try {
		await execAsync(cmd);
		return true;
	} catch (error) {
		const message = (error as Error).message;
		const ignoredErrors = ['Exec format error', 'not found'];
		const shouldIgnore = ignoredErrors.some((e) =>
			message.toLowerCase().includes(e.toLowerCase()),
		);
		if (!shouldIgnore) {
			console.error(`Failed to add registry key: ${keyPath}`);
			console.error(message);
		}
		return false;
	}
}

/**
 * Delete a registry key
 */
export async function deleteRegistryKey(keyPath: string): Promise<boolean> {
	const cmd = `reg.exe delete "${keyPath}" /f`;

	try {
		await execAsync(cmd);
		return true;
	} catch (error) {
		const message = (error as Error).message;
		const ignoredErrors = ['unable to find', 'Exec format error', 'not found'];
		const shouldIgnore = ignoredErrors.some((e) =>
			message.toLowerCase().includes(e.toLowerCase()),
		);
		if (!shouldIgnore) {
			console.error(`Failed to delete registry key: ${keyPath}`);
		}
		return false;
	}
}

/**
 * Registration result for tracking
 */
export interface RegistrationResult {
	extension: string;
	toolName: string;
	success: boolean;
}

/**
 * Register unified VidLet menu entry for a single extension
 * Opens the unified GUI with all tools available
 */
async function registerMenuForExtension(
	extension: string,
	iconsDir: string,
	launcherPath: string,
): Promise<RegistrationResult[]> {
	const results: RegistrationResult[] = [];
	const basePath = getMenuBasePath(extension);
	const iconsDirWin = wslToWindows(iconsDir);
	const launcherWin = wslToWindows(launcherPath);

	// Check if any tools support this extension
	const extensionTools = toolConfigs.filter((t) =>
		t.extensions.includes(extension),
	);

	if (extensionTools.length === 0) {
		return results;
	}

	// Create single VidLet menu entry (opens unified GUI)
	const menuSuccess = await addRegistryKey(basePath, 'MUIVerb', 'Open with VidLet');
	const iconSuccess = await addRegistryKey(basePath, 'Icon', `${iconsDirWin}\\tv.ico`);

	// Enable multi-select
	await addRegistryKey(basePath, 'MultiSelectModel', 'Player');

	// Command - opens unified VidLet GUI
	const commandValue = `wscript.exe //B "${launcherWin}" vidlet "%1" -g`;
	const cmdSuccess = await addRegistryKey(`${basePath}\\command`, '', commandValue);

	results.push({
		extension,
		toolName: 'VidLet',
		success: menuSuccess && iconSuccess && cmdSuccess,
	});

	return results;
}

/**
 * Unregister VidLet menu for a single extension
 */
async function unregisterMenuForExtension(
	extension: string,
): Promise<RegistrationResult[]> {
	const results: RegistrationResult[] = [];
	const basePath = getMenuBasePath(extension);

	// Delete command and VidLet menu entry
	await deleteRegistryKey(`${basePath}\\command`);
	const success = await deleteRegistryKey(basePath);

	results.push({
		extension,
		toolName: 'VidLet',
		success,
	});

	return results;
}

/**
 * Get all unique extensions from tool configs
 */
export function getAllExtensions(): string[] {
	const extensions = new Set<string>();
	for (const tool of toolConfigs) {
		for (const ext of tool.extensions) {
			extensions.add(ext);
		}
	}
	return Array.from(extensions);
}

/**
 * Register all tools for all supported extensions
 */
export async function registerAllTools(): Promise<RegistrationResult[]> {
	const distDir = getDistDir();
	const iconsDir = join(distDir, 'icons');
	const launcherPath = join(distDir, 'launcher.vbs');
	const results: RegistrationResult[] = [];

	// Register for each unique extension
	for (const extension of getAllExtensions()) {
		const extResults = await registerMenuForExtension(
			extension,
			iconsDir,
			launcherPath,
		);
		results.push(...extResults);
	}

	return results;
}

/**
 * Unregister all tools from all extensions
 */
export async function unregisterAllTools(): Promise<RegistrationResult[]> {
	const results: RegistrationResult[] = [];

	// Unregister from all extensions
	for (const extension of getAllExtensions()) {
		const extResults = await unregisterMenuForExtension(extension);
		results.push(...extResults);
	}

	return results;
}

/**
 * Escape a string value for .reg file format
 */
function escapeRegValue(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate registry content for unified VidLet menu
 */
function generateRegContent(): string {
	const distDir = getDistDir();
	const iconsDir = join(distDir, 'icons');
	const launcherPath = join(distDir, 'launcher.vbs');
	const iconsDirWin = wslToWindows(iconsDir);
	const launcherWin = wslToWindows(launcherPath);

	const lines: string[] = ['Windows Registry Editor Version 5.00', ''];

	for (const extension of getAllExtensions()) {
		const basePath = `HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${extension}\\shell\\VidLet`;

		// Check if any tools support this extension
		const extensionTools = toolConfigs.filter((t) =>
			t.extensions.includes(extension),
		);

		if (extensionTools.length === 0) {
			continue;
		}

		// Create single VidLet menu entry (opens unified GUI)
		lines.push(`[${basePath}]`);
		lines.push(`"MUIVerb"="${escapeRegValue('Open with VidLet')}"`);
		lines.push(`"Icon"="${escapeRegValue(`${iconsDirWin}\\tv.ico`)}"`);
		lines.push('"MultiSelectModel"="Player"');
		lines.push('');

		// Command - opens unified VidLet GUI
		const commandValue = `wscript.exe //B "${launcherWin}" vidlet "%1" -g`;
		lines.push(`[${basePath}\\command]`);
		lines.push(`@="${escapeRegValue(commandValue)}"`);
		lines.push('');
	}

	return lines.join('\r\n');
}

/**
 * Generate uninstall registry content (deletion entries)
 */
function generateUninstallRegContent(): string {
	const lines: string[] = ['Windows Registry Editor Version 5.00', ''];

	for (const extension of getAllExtensions()) {
		const basePath = `HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${extension}\\shell\\VidLet`;

		// Delete the entire VidLet key (minus sign deletes)
		lines.push(`[-${basePath}]`);
		lines.push('');
	}

	return lines.join('\r\n');
}

/**
 * Generate a .reg file for installation
 * @returns Path to the generated .reg file
 */
export async function generateRegFile(): Promise<string> {
	const distDir = getDistDir();
	const regPath = join(distDir, 'vidlet-install.reg');
	const content = generateRegContent();
	await writeFile(regPath, content, 'utf-8');
	return regPath;
}

/**
 * Generate a .reg file for uninstallation
 * @returns Path to the generated .reg file
 */
export async function generateUninstallRegFile(): Promise<string> {
	const distDir = getDistDir();
	const regPath = join(distDir, 'vidlet-uninstall.reg');
	const content = generateUninstallRegContent();
	await writeFile(regPath, content, 'utf-8');
	return regPath;
}
