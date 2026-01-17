import { toWSLPath } from '../lib/paths.js';

/**
 * Resolve input path - converts Windows path to WSL if needed
 */
export async function resolveInputPath(inputPath: string): Promise<string> {
	if (/^[A-Za-z]:/.test(inputPath)) {
		return toWSLPath(inputPath);
	}
	return inputPath;
}

/**
 * Handle command error with formatted output
 */
export function handleError(error: unknown): never {
	const { fmt } = require('../lib/logger.js');
	console.error(fmt.red(`Error: ${(error as Error).message}`));
	process.exit(1);
}
