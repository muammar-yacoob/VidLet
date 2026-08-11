/**
 * Shared plumbing for the VidLet MCP server tools. Moved verbatim out of
 * mcp.js (which is now a thin stdio bootstrap importing dist/mcp-tools.js).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: tool args arrive untyped over JSON-RPC
export type ToolHandler = (args: Record<string, any>) => Promise<ToolResult>;

export const PATH_PROPERTY = {
  path: { type: 'string', description: 'Absolute (or CWD-relative) path to the video file' },
};

// Tool functions print progress straight to stdout (console.log /
// process.stdout.write). Over stdio transport, stdout is the MCP protocol
// channel — any stray print corrupts the JSON-RPC stream. Redirect all
// writes to stderr for the duration of the call, then restore.
//
// This mutates the shared process.stdout.write property, which is racy
// against concurrent requests (e.g. a slow tool call overlapping the
// initialize response) — see protocolStdout in mcp.js for how the transport
// itself stays immune to that.
export async function withSilencedStdout<T>(fn: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the stream's overloaded signature
  process.stdout.write = ((chunk: any, encoding: any, cb: any) =>
    process.stderr.write(chunk, encoding, cb)) as typeof process.stdout.write;
  console.log = (...args: unknown[]) => process.stderr.write(`${args.join(' ')}\n`);
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
}

/** Validate and resolve a tool's `path` argument to an absolute file. */
export function resolveInputPath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) throw new Error('`path` is required');
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);
  if (!statSync(abs).isFile()) throw new Error(`Path is not a file: ${abs}`);
  return abs;
}

/**
 * Claim a free path, appending -1, -2, ... before the extension as needed.
 * Uses an atomic exclusive-create (`wx`) rather than existsSync-then-write:
 * two concurrent tool calls targeting the same default name would otherwise
 * both pass an existsSync check before either finished writing, and collide
 * (observed while testing this server — two overlapping trim_video calls
 * both computed the same "unclaimed" name). The reserved placeholder is
 * overwritten by ffmpeg (this codebase's executeFFmpeg defaults to `-y`).
 */
export function reserveUniqueOutputPath(desiredPath: string): string {
  const dir = dirname(desiredPath);
  const ext = extname(desiredPath);
  const base = basename(desiredPath, ext);
  let candidate = desiredPath;
  let i = 0;
  for (;;) {
    try {
      writeFileSync(candidate, '', { flag: 'wx' });
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      i += 1;
      candidate = join(dir, `${base}-${i}${ext}`);
    }
  }
}

/** Remove a reserved placeholder if a tool call failed before writing real output. */
export function releaseIfEmpty(path: string): void {
  try {
    if (existsSync(path) && statSync(path).size === 0) unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Resolve a tool's output path: never the input file, never an existing
 * file. `desired` is the tool's own default-naming convention (VidLet/
 * subfolder + suffix, or `output_path` if the caller supplied one).
 */
export function safeOutputPath(inputAbs: string, desired: string): string {
  const resolvedDesired = resolve(desired);
  if (resolvedDesired === inputAbs) {
    throw new Error('Refusing to overwrite the input file; choose a different output_path.');
  }
  return reserveUniqueOutputPath(resolvedDesired);
}

/** Run a write-tool body; releases the reserved placeholder if it throws before writing real output. */
export async function runWriteTool<T>(output: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    releaseIfEmpty(output);
    throw e;
  }
}

/**
 * A clickable file:// URL for a rendered output. Returned alongside the raw
 * path so a chat client can open the result directly instead of the user
 * hunting for it on disk.
 */
export function fileUrl(absPath: string): string {
  return pathToFileURL(absPath).href;
}

export function jsonContent(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorContent(e: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${(e as Error)?.message ?? e}` }],
    isError: true,
  };
}

// ============ BROWSER / URL HELPERS ============

function isWslRuntime(): boolean {
  return (
    process.platform === 'linux' &&
    existsSync('/proc/version') &&
    readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
  );
}

/** Open a URL in the OS default browser (WSL included). Fire-and-forget. */
export function openInBrowser(url: string): void {
  const [cmd, args] = isWslRuntime()
    ? ['cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // no opener available — the URL is still returned
  child.unref();
}

/**
 * Longest URL we will hand to the OS opener. On Windows/WSL the URL travels
 * through `cmd.exe /c start "" <url>`, and cmd.exe's whole command line tops
 * out at 8191 chars — 6000 leaves margin for the wrapper and ^-escaping.
 * Elsewhere the arg limit is huge; 60000 keeps URLs browser-sane.
 */
export function maxSafeUrlLength(): number {
  return process.platform === 'win32' || isWslRuntime() ? 6000 : 60000;
}

/** vidlet.app (or VIDLET_URL override) — base for editor/teleprompter links. */
export function editorBaseUrl(): string {
  return process.env.VIDLET_URL || 'https://vidlet.app';
}
