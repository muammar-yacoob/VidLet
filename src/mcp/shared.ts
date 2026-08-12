/**
 * Shared plumbing for the VidLet MCP server tools. Moved verbatim out of
 * mcp.js (which is now a thin stdio bootstrap importing dist/mcp-tools.js).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP content blocks. The spec carries text, image, audio and embedded
 * resources - there is NO video block, so a rendered Short can never play
 * inside a chat client. A poster frame plus a file:// link is the closest
 * honest equivalent, and the frame at least makes the result visible at a
 * glance instead of a path the user has to go and open.
 */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      mimeType?: string;
      description?: string;
    };

export interface ToolResult {
  content: ToolContent[];
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
  // A caller-supplied output_path may name a directory that does not exist
  // yet, and so may a tool that builds its own path rather than going
  // through getOutputPath.
  mkdirSync(dir, { recursive: true });
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

/**
 * Result for any tool that WROTE a file. Always carries the name, a
 * clickable file:// url, and how long the call took. Building it here
 * rather than in each handler is what makes it impossible to forget, which
 * it repeatedly was.
 */
export function fileResult(
  output: string,
  data: Record<string, unknown> = {},
  /** Extra artifacts to surface as their own file cards, e.g. the project. */
  alsoLink: string[] = []
): ToolResult {
  const result = jsonContent({
    name: basename(output),
    output,
    url: fileUrl(output),
    ...data,
  });

  // Show the poster frame inline when there is one. Kept small on purpose:
  // an image block costs tokens on every call, and the point is a glance
  // that says "this is what you made", not a viewing experience.
  const thumb = typeof data.thumbnail === 'string' ? data.thumbnail : null;
  if (thumb && existsSync(thumb)) {
    try {
      const bytes = statSync(thumb).size;
      if (bytes <= MAX_INLINE_IMAGE_BYTES) {
        result.content.push({
          type: 'image',
          data: readFileSync(thumb).toString('base64'),
          mimeType: thumb.endsWith('.png') ? 'image/png' : 'image/jpeg',
        });
      }
    } catch {
      // A poster frame that cannot be read is not worth failing a render for.
    }
  }

  // resource_link, not an embedded resource: an embedded one has to carry
  // the bytes inline, which for a video is absurd. A link renders as a file
  // card the user can click, which is the whole point - a bare path in JSON
  // is something they have to go and find.
  for (const path of [output, ...alsoLink]) {
    if (!existsSync(path)) continue;
    result.content.push({
      type: 'resource_link',
      uri: fileUrl(path),
      name: basename(path),
      mimeType: mimeFor(path),
      description: `${(statSync(path).size / 1048576).toFixed(1)} MB`,
    });
  }
  return result;
}

/** Above this an inline poster frame costs more than it informs. */
const MAX_INLINE_IMAGE_BYTES = 400_000;

function mimeFor(path: string): string {
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.m4a')) return 'audio/mp4';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.vidlet')) return 'application/json';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/**
 * A poster frame for a rendered video, written beside it.
 *
 * Taken a little way in rather than at 0s: the first frame of a Short is
 * often a fade or a title card, which makes a useless thumbnail.
 */
export async function writeThumbnail(video: string, atSeconds = 1.5): Promise<string | null> {
  const out = `${video.replace(/\.[^.]+$/, '')}-thumb.jpg`;
  try {
    const { executeFFmpegRaw } = await import('../lib/ffmpeg.js');
    await executeFFmpegRaw([
      '-y',
      '-ss',
      atSeconds.toFixed(2),
      '-i',
      video,
      '-frames:v',
      '1',
      '-vf',
      'scale=360:-2',
      '-qscale:v',
      '4',
      out,
    ]);
    return existsSync(out) ? out : null;
  } catch {
    return null; // a missing thumbnail must never fail a finished render
  }
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
