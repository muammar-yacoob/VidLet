/**
 * Tool lookup surface. The registry itself lives in `tool-defs.ts`.
 */
import * as vidletMain from '../tools/vidlet-main.js';
import { type Tool, type ToolConfig, toolConfigs, tools } from './tool-defs.js';

export type { Tool, ToolConfig };
export { toolConfigs, tools };

/**
 * Get tool by ID
 */
export function getToolById(id: string): Tool | undefined {
  return tools.find((t) => t.config.id === id);
}

/**
 * Get tool config by ID
 */
export function getToolConfigById(id: string): ToolConfig | undefined {
  return toolConfigs.find((t) => t.id === id);
}

/**
 * Get tools that support a given file extension
 */
export function getToolsForExtension(ext: string): Tool[] {
  const normalizedExt = ext.toLowerCase().startsWith('.')
    ? ext.toLowerCase()
    : `.${ext.toLowerCase()}`;
  return tools.filter((t) => t.config.extensions.includes(normalizedExt));
}

/**
 * Unified tool interface (GUI-only, combines all tools)
 */
export interface UnifiedTool {
  config: ToolConfig;
  runGUI: (input: string) => Promise<boolean>;
}

/**
 * Unified VidLet tool - all-in-one GUI
 */
export const vidletTool: UnifiedTool = {
  config: vidletMain.config,
  runGUI: vidletMain.runGUI,
};
