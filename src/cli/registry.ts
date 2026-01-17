import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isWSL, wslToWindows } from '../lib/paths.js';
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
 * Tools that should open in GUI mode (vs headless with defaults)
 */
const guiTools = ['compress', 'togif', 'mkv2mp4', 'shrink', 'loop'];

/**
 * Register unified VidLet menu for a single extension
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

	// Get tools that support this extension
	const extensionTools = toolConfigs.filter((t) =>
		t.extensions.includes(extension),
	);

	if (extensionTools.length === 0) {
		return results;
	}

	// Create parent VidLet menu with submenu
	await addRegistryKey(basePath, 'MUIVerb', 'VidLet');
	await addRegistryKey(basePath, 'Icon', `${iconsDirWin}\\tv.ico`);
	await addRegistryKey(basePath, 'SubCommands', '');

	// Create submenu for each tool
	for (const tool of extensionTools) {
		const toolPath = `${basePath}\\shell\\${tool.id}`;

		const menuSuccess = await addRegistryKey(toolPath, 'MUIVerb', tool.name);
		const iconSuccess = await addRegistryKey(
			toolPath,
			'Icon',
			`${iconsDirWin}\\${tool.icon}`,
		);

		// Enable multi-select
		await addRegistryKey(toolPath, 'MultiSelectModel', 'Player');

		// Command - use VBScript launcher for hidden cmd.exe window
		let commandValue: string;
		if (guiTools.includes(tool.id)) {
			// GUI mode - opens Edge app window
			commandValue = `wscript.exe //B "${launcherWin}" ${tool.id} "%1" -g`;
		} else {
			// Run headless with defaults
			commandValue = `wscript.exe //B "${launcherWin}" ${tool.id} "%1" -y`;
		}
		const cmdSuccess = await addRegistryKey(
			`${toolPath}\\command`,
			'',
			commandValue,
		);

		results.push({
			extension,
			toolName: tool.name,
			success: menuSuccess && iconSuccess && cmdSuccess,
		});
	}

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

	// Get tools that support this extension
	const extensionTools = toolConfigs.filter((t) =>
		t.extensions.includes(extension),
	);

	// Delete each tool's submenu
	for (const tool of extensionTools) {
		const toolPath = `${basePath}\\shell\\${tool.id}`;
		await deleteRegistryKey(`${toolPath}\\command`);
		const success = await deleteRegistryKey(toolPath);

		results.push({
			extension,
			toolName: tool.name,
			success,
		});
	}

	// Delete the shell container
	await deleteRegistryKey(`${basePath}\\shell`);

	// Delete parent VidLet menu
	await deleteRegistryKey(basePath);

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
