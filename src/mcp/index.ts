import { gateHandlers } from './gate.js';
import { errorContent, jsonContent, type ToolDefinition, type ToolHandler } from './shared.js';
/**
 * VidLet MCP tool registry — bundled by tsup as dist/mcp-tools.js and
 * consumed by mcp.js (the stdio bootstrap at the repo root). Tool schemas
 * and handlers live in tools-core.ts (file tools), tools-studio.ts
 * (recording/voiceover/short/demo) and tools-project.ts (.vidlet projects);
 * shared plumbing in shared.ts.
 */
import { AUTOSHORT_HANDLERS, AUTOSHORT_TOOLS } from './tools-autoshort.js';
import { CORE_HANDLERS, CORE_TOOLS } from './tools-core.js';
import { PROJECT_HANDLERS, PROJECT_TOOLS } from './tools-project.js';
import { STUDIO_HANDLERS, STUDIO_TOOLS } from './tools-studio.js';
import { YOUTUBE_HANDLERS, YOUTUBE_TOOLS } from './tools-youtube.js';

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
  ...AUTOSHORT_TOOLS,
  ...PROJECT_TOOLS,
  ...YOUTUBE_TOOLS,
];

async function handleListCapabilities() {
  return jsonContent({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    note: 'No delete/move tools by design — outputs are always new files.',
  });
}

// Every handler goes through gateHandlers: plan gating is applied once here
// rather than remembered inside each tool, so a new tool cannot ship ungated
// by omission.
export const TOOL_HANDLERS: Record<string, ToolHandler> = gateHandlers({
  list_capabilities: handleListCapabilities,
  ...CORE_HANDLERS,
  ...STUDIO_HANDLERS,
  ...AUTOSHORT_HANDLERS,
  ...PROJECT_HANDLERS,
  ...YOUTUBE_HANDLERS,
});

export {
  listServedResources,
  readServedResource,
  setResourceListChangedNotifier,
} from './resources.js';
export type { ToolDefinition, ToolHandler, ToolResult } from './shared.js';
export { errorContent, jsonContent };
