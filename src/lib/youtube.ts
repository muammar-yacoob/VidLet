import { randomBytes } from 'node:crypto';
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
 * YouTube connection and upload client, now speaking to the vidlet.app OAuth
 * broker (docs/youtube-broker.md in the vidlet-website repo) instead of
 * running its own Google OAuth client.
 *
 * Credentials model: VidLet ships no client secret - it is an open-source
 * package, and a bundled secret would be everyone's secret. vidlet.app owns
 * the Google OAuth client; this CLI holds only a refresh token, and every
 * access-token mint goes back through the broker, which is also where the
 * SparkPay plan gate lives (publishing is a paid feature - editing the CLI
 * cannot skip a server-side check).
 *
 * Connect flow: listen on an ephemeral loopback port, open
 * https://vidlet.app/auth/google/start?port=<port>&nonce=<nonce> in the
 * browser, and receive the tokens as a POST from the broker's success page.
 * A POST, not a redirect - a redirect would put the refresh token in the URL
 * bar and browser history.
 */
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { openInBrowser } from '../mcp/shared.js';
import { accountEmail, pricingUrl, tierUnlocking } from './spark-pay/index.js';

/**
 * "Publishing needs plan X" - named from the catalog, never hardcoded. The
 * tier that owns `youtube_publish` has moved before, and a message naming the
 * wrong one tells a subscriber to upgrade to the plan they already pay for.
 */
function upgradeLine(fallbackUrl?: string): string {
  const plan = tierUnlocking('youtube_publish')?.name ?? 'a paid';
  return `YouTube publishing needs an active VidLet ${plan} plan. Upgrade at ${
    fallbackUrl ?? pricingUrl(accountEmail() ?? undefined)
  }.`;
}

/** Overridable for local broker testing (VIDLET_BROKER_URL=http://localhost:3000). */
function brokerBase(): string {
  return process.env.VIDLET_BROKER_URL?.trim().replace(/\/$/, '') || 'https://vidlet.app';
}

const TOKEN_FILE = join(homedir(), '.config', 'vidlet', 'youtube.json');

export interface YouTubeTokens {
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

interface BrokerDelivery {
  nonce: string;
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
  channel?: { id: string; title: string; url: string | null } | null;
  error?: string;
  upgradeUrl?: string;
}

/**
 * One-shot loopback: an ephemeral port, one POST /callback from the broker's
 * success page, nonce verified so a stray local process cannot hand us a
 * token. Returns the delivered payload.
 */
function waitForBrokerDelivery(
  nonce: string,
  timeoutMs: number
): { port: Promise<number>; delivery: Promise<BrokerDelivery> } {
  let resolvePort: (p: number) => void = () => {};
  const port = new Promise<number>((r) => {
    resolvePort = r;
  });
  const delivery = new Promise<BrokerDelivery>((resolve, reject) => {
    const server = createServer((req, res) => {
      // The page can read the reply and confirm delivery to the user.
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method !== 'POST' || req.url !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
        try {
          const parsed = JSON.parse(body) as BrokerDelivery;
          if (parsed.nonce !== nonce) return; // not ours; keep listening
          server.close();
          clearTimeout(timer);
          resolve(parsed);
        } catch {
          // Malformed post from something else on this port - ignore.
        }
      });
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
      reject(new Error(`Loopback listener failed: ${(e as Error).message}`))
    );
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolvePort(addr.port);
    });
  });
  return { port, delivery };
}

/** Valid access token, refreshing via the broker when within 60s of expiry. */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) {
    throw new Error('Not connected to YouTube. Run connect_youtube first.');
  }
  if (tokens.access_token && tokens.expires_at && tokens.expires_at - Date.now() > 60_000) {
    return tokens.access_token;
  }
  const res = await fetch(`${brokerBase()}/api/auth/youtube/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    code?: string;
    upgradeUrl?: string;
  };
  if (!res.ok || !body.access_token) {
    if (body.code === 'subscription_required') {
      throw new Error(upgradeLine(body.upgradeUrl));
    }
    if (body.code === 'reconnect_required') {
      throw new Error(
        'This YouTube connection is no longer valid. Run connect_youtube to reconnect.'
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${body.error ?? 'unknown error'}`);
  }
  tokens.access_token = body.access_token;
  tokens.expires_at = Date.now() + (body.expires_in ?? 3600) * 1000;
  saveTokens(tokens);
  return body.access_token;
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
 * Full browser consent flow through the broker. No Google client needed on
 * this machine; the broker delivers {refresh_token, access_token, channel}
 * to our loopback listener and we persist it.
 */
export async function connectYouTube(options?: { timeoutMs?: number }): Promise<ChannelInfo> {
  const nonce = randomBytes(16).toString('base64url');
  const { port, delivery } = waitForBrokerDelivery(nonce, options?.timeoutMs ?? 180_000);
  const p = await port;
  openInBrowser(`${brokerBase()}/auth/google/start?port=${p}&nonce=${nonce}`);
  const granted = await delivery;

  if (granted.error === 'subscription_required') {
    throw new Error(`${upgradeLine(granted.upgradeUrl)} Then connect again.`);
  }
  if (granted.error || !granted.refresh_token) {
    throw new Error(`OAuth denied: ${granted.error ?? 'no refresh token returned'}`);
  }

  saveTokens({
    refresh_token: granted.refresh_token,
    access_token: granted.access_token,
    expires_at: granted.expires_in ? Date.now() + granted.expires_in * 1000 : undefined,
    channel: granted.channel ?? undefined,
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
