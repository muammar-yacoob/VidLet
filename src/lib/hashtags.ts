/**
 * Hashtag suggestions with real view counts, ported from ViralCat
 * (suggest-hashtags/hashtag-helpers.ts) rather than re-derived. The flow:
 * search YouTube for the topic, harvest hashtags off the top videos paired
 * with their view counts, have the LLM keep only the relevant ones, and
 * fall back to pure-AI suggestions when YouTube is unavailable.
 *
 * External-call budget, since this runs inside an interactive question
 * round: at most TWO YouTube Data API requests (search + videos, ~101
 * quota units) and ONE Groq chat per invocation.
 */
import {
  fmtViews,
  type HashtagSuggestion,
  normalizeTag,
  TAG_BLACKLIST,
  type TagHit,
} from '@spark-apps/video-kit';
import { groqChatJSON } from './groq.js';

// Vocabulary and normalisation come from the kit: the same video must
// get the same tags whichever Spark tool posts it.
export {
  fmtViews,
  type HashtagSuggestion,
  normalizeTag,
  TAG_BLACKLIST,
  type TagHit,
} from '@spark-apps/video-kit';

/**
 * Search YouTube for `query`, pull hashtags from the top videos, and pair
 * them with view counts. Returns `null` on 403 (quota exhausted) so the
 * caller can fall back rather than retry.
 */
export async function fetchYouTubeTags(apiKey: string, query: string): Promise<TagHit[] | null> {
  const hits: TagHit[] = [];
  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&type=video&q=${encodeURIComponent(query)}&maxResults=15&order=viewCount&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!searchRes.ok) {
      if (searchRes.status === 403) return null;
      return hits;
    }
    const searchData = (await searchRes.json()) as {
      items?: Array<{ id?: { videoId?: string } }>;
    };
    const videoIds = (searchData.items ?? []).map((i) => i.id?.videoId).filter(Boolean);
    if (videoIds.length === 0) return hits;

    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(',')}&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!videoRes.ok) return hits;
    const videoData = (await videoRes.json()) as {
      items?: Array<{
        statistics?: { viewCount?: string };
        snippet?: { tags?: string[]; title?: string; description?: string };
      }>;
    };

    for (const item of videoData.items ?? []) {
      const viewCount = Number.parseInt(item.statistics?.viewCount ?? '0', 10);
      const snippetTags = item.snippet?.tags ?? [];
      const title = item.snippet?.title ?? '';
      const desc = item.snippet?.description ?? '';
      const inlineMatches = `${title} ${desc}`.match(/#[\p{L}\p{N}_]+/gu) ?? [];
      for (const raw of [...snippetTags.slice(0, 8), ...inlineMatches]) {
        const tag = normalizeTag(raw);
        if (tag.length < 3 || TAG_BLACKLIST.has(tag)) continue;
        hits.push({ tag, viewCount });
      }
    }
  } catch {
    // Network trouble degrades to whatever was gathered - or nothing.
  }
  return hits;
}

/**
 * The LLM filters a pool of REAL YouTube tags down to the relevant ones.
 * Only tags that exist in the pool survive, so the model cannot invent
 * hashtags and attribute view counts to them.
 */
export async function filterRelevantTags(input: {
  topic: string;
  description?: string;
  tagsWithViews: { tag: string; views: string }[];
}): Promise<string[]> {
  const { topic, description, tagsWithViews } = input;
  if (tagsWithViews.length === 0) return [];

  const tagList = tagsWithViews.map((t) => `${t.tag} (${t.views} views)`).join('\n');
  const prompt = `You are filtering YouTube hashtags for a video.

Video topic: ${topic}
Description: ${description ?? '(none)'}

Here are hashtags from trending YouTube videos with their total view counts. Pick at least 16 that are BOTH relevant to this video AND have strong engagement:

${tagList}

Rules:
- The tag must be relevant to what the video actually shows. When two tags are equally relevant, prefer the one with higher views.
- DROP any tag that is foreign-language, a TV show / drama / movie reference, a celebrity name, a song, a gaming meme, or otherwise off-topic.
- Return in order of relevance (most relevant first), breaking ties by view count.

Respond with JSON {"tags": ["#tag1", "#tag2", ...]}.`;

  try {
    const result = await groqChatJSON<{ tags: unknown }>(
      [{ role: 'user', content: prompt }],
      undefined,
      'hashtags'
    );
    if (!Array.isArray(result.tags)) return [];
    const pool = new Set(tagsWithViews.map((t) => t.tag));
    return result.tags
      .filter((t): t is string => typeof t === 'string')
      .map(normalizeTag)
      .filter((t) => pool.has(t))
      .slice(0, 16);
  } catch {
    return [];
  }
}

/**
 * Pure-AI fallback when YouTube is unavailable: brand-aligned tags split
 * into 6 popular + 6 trending, without view counts.
 */
export async function fallbackTagsAIOnly(input: {
  topic: string;
  description?: string;
}): Promise<HashtagSuggestion[]> {
  const prompt = `You are generating hashtag suggestions for a YouTube Short.

Video topic: ${input.topic}
Description: ${input.description ?? '(none)'}

Return JSON with exactly two keys:
1. "popular": an array of 6 hashtags that are established, widely used in this niche community.
2. "trending": an array of 6 hashtags that are newer, more niche, or currently rising in this specific community.

Rules:
- Every tag MUST be directly relevant to the specific thing the video shows.
- Generic tags like viral, trending, fyp, shorts are forbidden.
- No foreign-language phrases, TV/drama references, celebrity names, songs, gaming memes.
- Lowercase, no spaces, no leading # in the response.
- The two arrays must not overlap.`;

  try {
    const parsed = await groqChatJSON<{ popular?: unknown; trending?: unknown }>(
      [{ role: 'user', content: prompt }],
      undefined,
      'hashtags'
    );
    const pickSix = (r: unknown): string[] => {
      if (!Array.isArray(r)) return [];
      return r
        .filter((t): t is string => typeof t === 'string')
        .map(normalizeTag)
        .filter((t) => t.length > 3 && !TAG_BLACKLIST.has(t))
        .slice(0, 6);
    };
    const popular = pickSix(parsed.popular);
    const popularSet = new Set(popular);
    const trending = pickSix(parsed.trending)
      .filter((t) => !popularSet.has(t))
      .slice(0, 6);
    return [
      ...popular.map((tag) => ({ tag, viewCount: 0, label: null, kind: 'popular' as const })),
      ...trending.map((tag) => ({ tag, viewCount: 0, label: null, kind: 'trending' as const })),
    ];
  } catch {
    return [];
  }
}

export interface SharedTrends {
  hashtags: HashtagSuggestion[];
  titles: Array<{ title: string; views: number; recent: boolean }>;
}

/**
 * The vidlet.app shared trend cache (ViralCat's niche-pool pattern, hosted
 * server-side): one YouTube+Groq fetch per genre serves every user, so this
 * machine needs no YOUTUBE_API_KEY and no GROQ_API_KEY for publish material.
 * Null on any failure - callers fall back to the local paths.
 */
export async function fetchSharedTrends(topic: string): Promise<SharedTrends | null> {
  const base =
    process.env.VIDLET_TRENDS_URL?.trim().replace(/\/$/, '') ||
    'https://vidlet.app/api/youtube/trends';
  try {
    const res = await fetch(`${base}?topic=${encodeURIComponent(topic)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tags?: Array<{ tag: string; viewCount: number; label: string | null; kind: string }>;
      titles?: Array<{ title: string; views: number; recent: boolean }>;
    };
    const hashtags = (data.tags ?? []).map((t) => ({
      tag: t.tag,
      viewCount: t.viewCount,
      label: t.label,
      kind: t.kind === 'trending' ? ('trending' as const) : ('popular' as const),
    }));
    if (hashtags.length === 0) return null;
    return { hashtags, titles: data.titles ?? [] };
  } catch {
    return null;
  }
}

/**
 * The whole pipeline, cheapest first: the shared vidlet.app cache (no local
 * keys needed), then real tags via a local YouTube API key, then AI-only.
 */
export async function suggestHashtags(input: {
  topic: string;
  description?: string;
  youtubeApiKey?: string;
}): Promise<HashtagSuggestion[]> {
  const { topic, description, youtubeApiKey } = input;

  const shared = await fetchSharedTrends(topic);
  if (shared) return shared.hashtags;

  if (youtubeApiKey) {
    const hits = await fetchYouTubeTags(youtubeApiKey, topic);
    if (hits && hits.length > 0) {
      // Best view count per tag.
      const best = new Map<string, number>();
      for (const h of hits) best.set(h.tag, Math.max(best.get(h.tag) ?? 0, h.viewCount));
      const withViews = [...best.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([tag, views]) => ({ tag, views: fmtViews(views) }));
      const relevant = await filterRelevantTags({ topic, description, tagsWithViews: withViews });
      if (relevant.length > 0) {
        return relevant.map((tag, i) => ({
          tag,
          viewCount: best.get(tag) ?? 0,
          label: fmtViews(best.get(tag) ?? 0),
          // The top half by relevance are "popular"; the rest read as rising.
          kind: i < Math.ceil(relevant.length / 2) ? ('popular' as const) : ('trending' as const),
        }));
      }
    }
  }

  return fallbackTagsAIOnly({ topic, description });
}
