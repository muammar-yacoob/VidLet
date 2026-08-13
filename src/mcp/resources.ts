/**
 * MCP resources for rendered outputs.
 *
 * Every write-tool result already carries a `resource_link` block (see
 * fileResult in shared.ts). Per the spec that block is "a link to a resource
 * the server is capable of reading" — a client that wants to show a file card
 * or a preview resolves it with `resources/read`. vidlet used to advertise
 * only `{ tools: {} }` and implement no resource handlers, so those links were
 * dangling: nothing on the other end to fetch, and clients fall back to
 * rendering them as inert text. This module is the other end.
 *
 * Deliberately a registry rather than a path-walker: `resources/read` that
 * honoured any file:// URI would hand every MCP client an arbitrary-file-read
 * primitive on the user's machine. Only paths this server itself produced in
 * this session are served.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ServedFile {
  uri: string;
  path: string;
  name: string;
  mimeType: string;
}

/** One entry of a `resources/read` reply: text OR blob, never both. */
interface ResourceContents {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

/**
 * Session registry, newest last. Bounded because a long-lived server doing
 * many renders would otherwise hold every path it ever emitted; 200 is far
 * more than a session realistically produces, and eviction only costs a
 * client the ability to re-fetch something ancient.
 */
const served = new Map<string, ServedFile>();
const MAX_SERVED_ENTRIES = 200;

/**
 * Above this a file is described rather than inlined. `resources/read` has to
 * carry the bytes base64-encoded inside a single JSON-RPC message on stdio,
 * which inflates them by 4/3 — a 32 MB video arrives as a ~43 MB line. Shorts
 * land around 8 MB so this clears them comfortably; a feature-length render
 * does not, and saying so beats stalling the transport.
 */
const MAX_SERVED_BLOB_BYTES = 32 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.vidlet',
  '.json',
  '.txt',
  '.md',
  '.srt',
  '.vtt',
  '.ass',
  '.csv',
]);

export function mimeFor(path: string): string {
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.mov')) return 'video/quicktime';
  if (path.endsWith('.mkv')) return 'video/x-matroska';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.m4a')) return 'audio/mp4';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.flac')) return 'audio/flac';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.vidlet') || path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.srt') || path.endsWith('.vtt') || path.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

/** Notifier wired up by the stdio bootstrap so clients can refresh their list. */
let onListChanged: (() => void) | null = null;

export function setResourceListChangedNotifier(fn: () => void): void {
  onListChanged = fn;
}

/**
 * Record a file this server produced, making its `resource_link` resolvable.
 * Returns the URI used in the link so both sides cannot drift.
 */
export function registerServedFile(path: string): string {
  const uri = pathToFileURL(path).href;
  const isNew = !served.has(uri);
  // Re-inserting moves it to the end, so eviction is least-recently-emitted.
  served.delete(uri);
  served.set(uri, { uri, path, name: basename(path), mimeType: mimeFor(path) });
  while (served.size > MAX_SERVED_ENTRIES) {
    const oldest = served.keys().next().value;
    if (oldest === undefined) break;
    served.delete(oldest);
  }
  if (isNew) onListChanged?.();
  return uri;
}

/** Everything produced this session that still exists on disk. */
export function listServedResources() {
  const resources = [];
  for (const file of served.values()) {
    if (!existsSync(file.path)) continue;
    resources.push({
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: statSync(file.path).size,
    });
  }
  return { resources: resources.reverse() };
}

/**
 * Serve one registered file. Text-ish outputs (.vidlet projects, subtitles,
 * post copy) go back as text so a client can show them without a download
 * step; everything else as a base64 blob.
 */
export function readServedResource(uri: string): { contents: ResourceContents[] } {
  const file = served.get(uri);
  if (!file) {
    // Not "not found": the distinction matters, because the honest reason is
    // that this server only vends what it made.
    throw new Error(
      `Unknown resource: ${uri}. This server only serves files it produced in this session.`
    );
  }
  if (!existsSync(file.path)) {
    throw new Error(`Resource no longer exists on disk: ${file.path}`);
  }

  const bytes = statSync(file.path).size;
  if (bytes > MAX_SERVED_BLOB_BYTES) {
    return {
      contents: [
        {
          uri: file.uri,
          mimeType: 'text/plain',
          text:
            `${file.name} is ${(bytes / 1048576).toFixed(1)} MB, too large to inline over stdio ` +
            `(limit ${MAX_SERVED_BLOB_BYTES / 1048576} MB). Open it directly at: ${file.path}`,
        },
      ],
    };
  }

  if (TEXT_EXTENSIONS.has(extname(file.path).toLowerCase())) {
    return {
      contents: [{ uri: file.uri, mimeType: file.mimeType, text: readFileSync(file.path, 'utf8') }],
    };
  }

  return {
    contents: [
      { uri: file.uri, mimeType: file.mimeType, blob: readFileSync(file.path).toString('base64') },
    ],
  };
}

/** Test seam — the registry is process-global otherwise. */
export function clearServedResources(): void {
  served.clear();
}
