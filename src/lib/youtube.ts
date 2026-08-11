import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
/**
 * YouTube connection and upload client. Zero new dependencies: OAuth and
 * every API call go through fetch, and the loopback redirect is a one-shot
 * node http server.
 *
 * Credentials model: the user supplies their OWN Google OAuth client
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server env, or saved in
 * the token file). VidLet ships no client secret - it is an open-source
 * package, and a bundled secret would be everyone's secret.
 *
 * The redirect URI must EXACTLY match one registered on that OAuth client.
 * Default is http://localhost:3000/auth/youtube/callback (the ViralCat
 * pattern, already registered on this user's client); override with
 * YOUTUBE_REDIRECT_URI or the connect tool's redirect_uri argument.
 *
 * Endpoints and flows verified against current docs (Context7,
 * developers.google.com/youtube/v3): resumable upload is the recommended
 * video path; thumbnails.set takes jpeg/png up to 2MB (~50 quota units);
 * Studio's native "Test & compare" has NO public API, so A/B testing is
 * implemented as variant rotation via videos.update + thumbnails.set.
 */
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openInBrowser } from '../mcp/shared.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  // Needed for channels.list (connection check) and videos.list (A/B stats).
  'https://www.googleapis.com/auth/youtube.readonly',
  // videos.update for title rotation during an A/B test.
  'https://www.googleapis.com/auth/youtube',
];

const TOKEN_FILE = join(homedir(), '.config', 'vidlet', 'youtube.json');
const DEFAULT_REDIRECT = 'http://localhost:3000/auth/youtube/callback';

export interface YouTubeTokens {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  /** Epoch ms when access_token dies. */
  expires_at?: number;
  channel?: { id: string; title: string; url: string | null };
}

export function tokenFilePath(): string {
  return TOKEN_FILE;
}

export function loadTokens(): YouTubeTokens | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as YouTubeTokens;
  } catch {
    return null;
  }
}

function saveTokens(tokens: YouTubeTokens): void {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  chmodSync(TOKEN_FILE, 0o600); // refresh token = channel access; owner-only
}

/** OAuth client credentials from env, falling back to the saved file. */
export function resolveClientCreds(): { clientId: string; clientSecret: string } | null {
  const saved = loadTokens();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || saved?.client_id;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || saved?.client_secret;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * One-shot loopback: listen on the redirect URI's own port and path, catch
 * the ?code, answer with a "you can close this tab" page, and shut down.
 */
function waitForOAuthCode(redirectUri: string, timeoutMs: number): Promise<string> {
  const url = new URL(redirectUri);
  const port = Number(url.port || 80);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', redirectUri);
      if (reqUrl.pathname !== url.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const err = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body style="font-family:sans-serif;padding:3em;text-align:center">
         <h2>${code ? 'VidLet is connected to YouTube.' : 'Connection failed.'}</h2>
         <p>You can close this tab.</p></body></html>`
      );
      server.close();
      clearTimeout(timer);
      if (code) resolve(code);
      else reject(new Error(`OAuth denied: ${err ?? 'no code returned'}`));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser consent.`
        )
      );
    }, timeoutMs);
    server.on('error', (e) =>
      reject(
        new Error(
          `Cannot listen on ${redirectUri} (${(e as Error).message}). Is a dev server using that port? Stop it or pass a different registered redirect_uri.`
        )
      )
    );
    server.listen(port);
  });
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Google token endpoint ${res.status}: ${await res.text()}`);
  return (await res.json()) as never;
}

/** Valid access token, refreshing (and persisting) when within 60s of expiry. */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('Not connected to YouTube. Run connect_youtube first.');
  }
  if (tokens.access_token && tokens.expires_at && tokens.expires_at - Date.now() > 60_000) {
    return tokens.access_token;
  }
  const refreshed = await tokenRequest({
    client_id: tokens.client_id,
    client_secret: tokens.client_secret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  tokens.access_token = refreshed.access_token;
  tokens.expires_at = Date.now() + refreshed.expires_in * 1000;
  saveTokens(tokens);
  return refreshed.access_token;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as T;
}

export interface ChannelInfo {
  id: string;
  title: string;
  url: string | null;
  subscribers: string | null;
}

/** The channel behind the stored tokens; also the cheapest connection check. */
export async function getChannel(): Promise<ChannelInfo> {
  const data = await api<{
    items?: Array<{
      id: string;
      snippet: { title: string; customUrl?: string };
      statistics?: { subscriberCount?: string };
    }>;
  }>('channels?part=snippet,statistics&mine=true');
  const ch = data.items?.[0];
  if (!ch) throw new Error('Token is valid but no channel is attached to this account.');
  return {
    id: ch.id,
    title: ch.snippet.title,
    url: ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : null,
    subscribers: ch.statistics?.subscriberCount ?? null,
  };
}

/**
 * Full browser consent flow. Opens the consent page, catches the loopback
 * redirect, exchanges the code, verifies the channel, and persists tokens.
 */
export async function connectYouTube(options?: {
  redirectUri?: string;
  timeoutMs?: number;
}): Promise<ChannelInfo> {
  const creds = resolveClientCreds();
  if (!creds) {
    throw new Error(
      'No Google OAuth client configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the ' +
        'MCP server env (create one at console.cloud.google.com > APIs & Services > Credentials, ' +
        'type "Web application", with your redirect URI registered).'
    );
  }
  const redirectUri =
    options?.redirectUri ?? process.env.YOUTUBE_REDIRECT_URI?.trim() ?? DEFAULT_REDIRECT;

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // Forces a refresh_token even on reconnect; without it Google only
    // issues one on the very first consent.
    prompt: 'consent',
  });

  const codePromise = waitForOAuthCode(redirectUri, options?.timeoutMs ?? 180_000);
  openInBrowser(`${AUTH_URL}?${params.toString()}`);
  const code = await codePromise;

  const granted = await tokenRequest({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (!granted.refresh_token) {
    throw new Error(
      'Google returned no refresh token; revoke access at myaccount.google.com/permissions and reconnect.'
    );
  }

  saveTokens({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: granted.refresh_token,
    access_token: granted.access_token,
    expires_at: Date.now() + granted.expires_in * 1000,
  });

  const channel = await getChannel();
  const tokens = loadTokens();
  if (tokens) {
    tokens.channel = { id: channel.id, title: channel.title, url: channel.url };
    saveTokens(tokens);
  }
  return channel;
}

export interface UploadMeta {
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  privacyStatus: 'private' | 'public' | 'unlisted';
}

/**
 * Resumable upload (the protocol Google recommends for video): one POST to
 * open the session, one PUT streaming the file. Returns the video id.
 */
export async function uploadVideo(
  filePath: string,
  meta: UploadMeta,
  onProgress?: (stage: string) => void
): Promise<string> {
  const token = await getAccessToken();
  const size = statSync(filePath).size;
  const body = {
    snippet: {
      title: meta.title.slice(0, 100),
      description: meta.description.slice(0, 5000),
      tags: meta.tags.slice(0, 30).map((t) => t.replace(/^#/, '')),
      categoryId: meta.categoryId ?? '28', // Science & Technology
      defaultLanguage: 'en',
    },
    status: {
      privacyStatus: meta.privacyStatus,
      madeForKids: false,
      selfDeclaredMadeForKids: false,
    },
  };

  onProgress?.('opening upload session');
  const open = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(body),
    }
  );
  if (!open.ok)
    throw new Error(`Upload session ${open.status}: ${(await open.text()).slice(0, 400)}`);
  const uploadUrl = open.headers.get('location');
  if (!uploadUrl) throw new Error('Upload session opened but no session URL was returned.');

  onProgress?.(`uploading ${(size / 1048576).toFixed(1)}MB`);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
    body: createReadStream(filePath) as unknown as ReadableStream,
    duplex: 'half',
  });
  if (!put.ok) throw new Error(`Upload ${put.status}: ${(await put.text()).slice(0, 400)}`);
  const uploaded = (await put.json()) as { id: string };
  return uploaded.id;
}

/** thumbnails.set: jpeg/png, 2MB max, ~50 quota units. */
export async function setThumbnail(videoId: string, imagePath: string): Promise<void> {
  const token = await getAccessToken();
  const size = statSync(imagePath).size;
  if (size > 2 * 1024 * 1024) throw new Error(`Thumbnail over YouTube's 2MB cap: ${imagePath}`);
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
        'Content-Length': String(size),
      },
      body: createReadStream(imagePath) as unknown as ReadableStream,
      duplex: 'half',
    }
  );
  if (!res.ok) throw new Error(`thumbnails.set ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Swap title/description in place - the A/B rotation primitive. */
export async function updateVideoMeta(
  videoId: string,
  meta: { title: string; description: string; tags: string[]; categoryId?: string }
): Promise<void> {
  await api('videos?part=snippet', {
    method: 'PUT',
    body: JSON.stringify({
      id: videoId,
      snippet: {
        title: meta.title.slice(0, 100),
        description: meta.description.slice(0, 5000),
        tags: meta.tags.slice(0, 30).map((t) => t.replace(/^#/, '')),
        // snippet is replaced wholesale on update; omitting categoryId 400s.
        categoryId: meta.categoryId ?? '28',
      },
    }),
  });
}

export interface VideoStats {
  views: number;
  likes: number;
  comments: number;
}

/** One videos.list call (1 quota unit) - the A/B measurement primitive. */
export async function getVideoStats(videoId: string): Promise<VideoStats> {
  const data = await api<{
    items?: Array<{
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  }>(`videos?part=statistics&id=${videoId}`);
  const s = data.items?.[0]?.statistics;
  return {
    views: Number.parseInt(s?.viewCount ?? '0', 10),
    likes: Number.parseInt(s?.likeCount ?? '0', 10),
    comments: Number.parseInt(s?.commentCount ?? '0', 10),
  };
}
