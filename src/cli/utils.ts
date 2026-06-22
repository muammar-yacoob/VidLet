import { resolve } from 'node:path';
import { fmt } from '../lib/logger.js';
import { toWSLPath } from '../lib/paths.js';
import { type Tool, getToolById } from './tools.js';

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
 * Look up a tool by id, throwing if it is not registered.
 */
export function getToolByIdOrThrow(id: string): Tool {
  const tool = getToolById(id);
  if (!tool) {
    throw new Error(`Tool "${id}" not found`);
  }
  return tool;
}

/**
 * Print a formatted error and exit. Used as the single error path for all commands.
 */
export function handleError(error: unknown): never {
  console.error(fmt.red(`Error: ${(error as Error).message}`));
  process.exit(1);
}

/**
 * Shared command runner: resolves the input path, dispatches to the GUI or CLI
 * implementation, and routes any failure through handleError.
 *
 * buildRunOptions is only invoked in CLI mode (skipped when the GUI is opened),
 * so it may perform CLI-only work such as reading files or validating arguments.
 */
export async function runToolCommand(
  toolId: string,
  file: string,
  options: { gui?: boolean },
  buildRunOptions: () => Record<string, unknown> | Promise<Record<string, unknown>>
): Promise<void> {
  try {
    const input = await resolveInputPath(file);
    const tool = getToolByIdOrThrow(toolId);

    if (options.gui && tool.runGUI) {
      await tool.runGUI(input);
    } else {
      await tool.run(input, await buildRunOptions());
    }
  } catch (error) {
    handleError(error);
  }
}
