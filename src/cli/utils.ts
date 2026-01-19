import { resolve } from 'node:path';
import { toWSLPath } from '../lib/paths.js';

/**
 * Resolve input path - converts Windows path to WSL if needed, and makes relative paths absolute
 */
export async function resolveInputPath(inputPath: string): Promise<string> {
	if (/^[A-Za-z]:/.test(inputPath)) {
		return toWSLPath(inputPath);
	}
	// Make relative paths absolute
	return resolve(inputPath);
}

/**
 * Handle command error with formatted output
 */
export function handleError(error: unknown): never {
	const { fmt } = require('../lib/logger.js');
	console.error(fmt.red(`Error: ${(error as Error).message}`));
	process.exit(1);
}
