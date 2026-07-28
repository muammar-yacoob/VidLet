import { type ToolDefinition, type ToolHandler, errorContent, jsonContent } from './shared.js';
/**
 * VidLet MCP tool registry — bundled by tsup as dist/mcp-tools.js and
 * consumed by mcp.js (the stdio bootstrap at the repo root). Tool schemas
 * and handlers live in tools-core.ts (file tools), tools-studio.ts
 * (recording/voiceover/short/demo) and tools-project.ts (.vidlet projects);
 * shared plumbing in shared.ts.
 */
import { CORE_HANDLERS, CORE_TOOLS } from './tools-core.js';
import { PROJECT_HANDLERS, PROJECT_TOOLS } from './tools-project.js';
import { STUDIO_HANDLERS, STUDIO_TOOLS } from './tools-studio.js';

const LIST_CAPABILITIES: ToolDefinition = {
  name: 'list_capabilities',
  description:
    'List every tool this server offers with a one-line description. Cheap discovery, no file I/O.',
  inputSchema: { type: 'object', properties: {} },
};

export const TOOLS: ToolDefinition[] = [
  LIST_CAPABILITIES,
  ...CORE_TOOLS,
  ...STUDIO_TOOLS,
  ...PROJECT_TOOLS,
];

async function handleListCapabilities() {
  return jsonContent({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    note: 'No delete/move tools by design — outputs are always new files.',
  });
}

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  list_capabilities: handleListCapabilities,
  ...CORE_HANDLERS,
  ...STUDIO_HANDLERS,
  ...PROJECT_HANDLERS,
};

export { errorContent, jsonContent };
export type { ToolDefinition, ToolHandler, ToolResult } from './shared.js';
