/**
 * MCP smoke test: pipes JSON-RPC lines into `node mcp.js` over stdio and
 * asserts the server initializes, lists all 17 tools, and answers a
 * list_capabilities call. Requires a build (dist/mcp-tools.js) — run
 * `npm run build` first; skipped otherwise.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const built = existsSync(join(repoRoot, 'dist', 'mcp-tools.js'));

const EXPECTED_TOOL_COUNT = 27;

interface JsonRpcMessage {
  id?: number;
  // biome-ignore lint/suspicious/noExplicitAny: raw JSON-RPC payloads
  result?: any;
  // biome-ignore lint/suspicious/noExplicitAny: raw JSON-RPC payloads
  [key: string]: any;
}

function runMcpSession(messages: object[], wantedIds: number[]): Promise<JsonRpcMessage[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['mcp.js'], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const wanted = new Set(wantedIds);
    const responses: JsonRpcMessage[] = [];
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP smoke timed out; got ids: ${responses.map((r) => r.id).join(',')}`));
    }, 20_000);

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        if (!line) continue;
        const message = JSON.parse(line) as JsonRpcMessage;
        if (typeof message.id === 'number' && wanted.has(message.id)) {
          responses.push(message);
          wanted.delete(message.id);
          if (wanted.size === 0) {
            clearTimeout(timer);
            child.kill();
            resolvePromise(responses);
          }
        }
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });
}

describe.runIf(built)('mcp.js smoke (stdio JSON-RPC)', () => {
  it(`initializes, lists ${EXPECTED_TOOL_COUNT} tools, and answers list_capabilities`, async () => {
    const responses = await runMcpSession(
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'vidlet-smoke', version: '0.0.0' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_capabilities', arguments: {} },
        },
      ],
      [1, 2, 3]
    );

    const init = responses.find((r) => r.id === 1);
    expect(init?.result?.serverInfo?.name).toBe('vidlet');

    const list = responses.find((r) => r.id === 2);
    const toolNames = list?.result?.tools?.map((t: { name: string }) => t.name) ?? [];
    expect(toolNames).toHaveLength(EXPECTED_TOOL_COUNT);
    for (const name of [
      'list_capabilities',
      'probe_video',
      'speed_up_video',
      'create_timelapse_short',
      'generate_short',
      'preview_music',
      'preview_short',
      'add_music',
      'mask_sensitive',
      'connect_youtube',
      'upload_to_youtube',
      'rotate_youtube_test',
      'generate_captions',
      'setup_recording',
      'generate_voiceover',
      'create_project',
      'validate_project',
      'render_project',
      'open_in_editor',
      'add_voiceover_to_project',
    ]) {
      expect(toolNames).toContain(name);
    }

    const call = responses.find((r) => r.id === 3);
    const payload = JSON.parse(call?.result?.content?.[0]?.text ?? '{}');
    expect(payload.tools).toHaveLength(EXPECTED_TOOL_COUNT);
  }, 30_000);
});

describe.runIf(!built)('mcp.js smoke (skipped)', () => {
  it.skip('requires dist/mcp-tools.js — run `npm run build` first', () => {});
});
