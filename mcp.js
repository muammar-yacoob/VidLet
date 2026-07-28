#!/usr/bin/env node

// VidLet MCP server — local video-processing tools over stdio.
//
// This file is a thin bootstrap: transport wiring, the protocol-stdout
// proxy, and dispatch. The 17 tool schemas/handlers live in src/mcp/
// (bundled by tsup into dist/mcp-tools.js, like dist/mcp-lib.js), calling
// the real tool functions directly — no shelling out to the `vidlet` CLI.
// These are local file-processing tools the user explicitly invokes: no
// auth needed. Deliberately NO delete/move tools — outputs are always new
// files, never overwrites, never touches the input.

import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_HANDLERS, TOOLS, errorContent } from './dist/mcp-tools.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Captured once, before anything ever patches process.stdout.write
// (withSilencedStdout in dist/mcp-tools.js mutates it during tool calls).
const REAL_STDOUT_WRITE = process.stdout.write.bind(process.stdout);

// The transport's send() calls `this._stdout.write(...)`, resolving `.write`
// dynamically off whatever object we hand it — the SAME property
// withSilencedStdout mutates. Requests are handled concurrently (e.g. a
// `generate_captions` call can still be running when the `initialize`
// response is sent), so if the transport shared process.stdout directly, a
// call silenced mid-flight would also swallow or misdirect unrelated
// protocol responses. This proxy always uses the pristine write captured
// above, while delegating everything else to the real stream.
const protocolStdout = new Proxy(process.stdout, {
  get(target, prop, receiver) {
    if (prop === 'write') return REAL_STDOUT_WRITE;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const server = new Server({ name: 'vidlet', version: pkg.version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) return errorContent(new Error(`Unknown tool: ${name}`));
  try {
    return await handler(args ?? {});
  } catch (e) {
    // Never crash the server on a tool failure — surface it as a tool error instead.
    return errorContent(e);
  }
});

async function main() {
  const transport = new StdioServerTransport(process.stdin, protocolStdout);
  await server.connect(transport);
}

main().catch((e) => {
  console.error(`vidlet-mcp failed to start: ${e?.message ?? e}`);
  process.exit(1);
});
