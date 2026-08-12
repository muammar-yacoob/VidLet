/**
 * The persistent call-to-action: a rounded pill pinned near the top of the
 * Short carrying the domain's favicon, the domain, and an optional tagline.
 *
 * Modelled on ViralCat's ctaPill, but drawn as SVG and rasterised by
 * ffmpeg's own librsvg rather than satori + resvg, so it needs no new
 * dependencies. Rounded corners, a real icon and a tagline are the whole
 * point: a drawtext bar looks like a debug overlay, and the CTA is the one
 * element meant to survive in the viewer's memory.
 *
 * It exists because speaking a URL never sounds right. "Find him at Duck
 * Tax" is what a person says; "ducktax.com" is what the screen shows.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeFFmpegRaw } from '../lib/ffmpeg.js';

export interface CtaSpec {
  /** The URL or bare domain to display. */
  url: string;
  /** Optional short line under the domain. */
  tagline?: string;
}

/** Strip protocol, www and any trailing slash - nobody reads those. */
export function displayDomain(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

/** XML-escape, since a tagline is user text going into an SVG document. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Rough advance width for the pill's face at a given size. The pill has to
 * size itself to its text, and SVG cannot measure before it renders.
 */
const GLYPH_W = 0.58;

export interface PillLayout {
  width: number;
  height: number;
  fontSize: number;
  taglineSize: number;
}

/** Size the pill to its content, capped so it never spans the frame. */
export function layoutPill(
  domain: string,
  tagline: string | undefined,
  canvasWidth: number
): PillLayout {
  const fontSize = Math.round(canvasWidth / 22);
  const taglineSize = Math.round(fontSize * 0.62);
  const iconBox = fontSize * 1.5;
  const padding = fontSize * 0.8;

  const domainW = domain.length * fontSize * GLYPH_W;
  const taglineW = (tagline?.length ?? 0) * taglineSize * GLYPH_W;
  const textW = Math.max(domainW, taglineW);

  const width = Math.min(canvasWidth * 0.92, padding * 2 + iconBox + padding * 0.6 + textW);
  const height = tagline ? fontSize * 2.9 : fontSize * 2.1;
  return {
    width: Math.round(width),
    height: Math.round(height),
    fontSize,
    taglineSize,
  };
}

/**
 * The pill as an SVG document. The favicon is embedded as a data URI so the
 * rasteriser never reaches the network, which also means a missing icon
 * degrades to a text-only pill instead of a failed render.
 */
export function buildCtaSvg(opts: {
  domain: string;
  tagline?: string;
  faviconDataUri?: string;
  canvasWidth: number;
}): string {
  const { domain, tagline, faviconDataUri, canvasWidth } = opts;
  const L = layoutPill(domain, tagline, canvasWidth);
  const pad = L.fontSize * 0.8;
  const iconBox = L.fontSize * 1.5;
  const hasIcon = Boolean(faviconDataUri);
  const textX = pad + (hasIcon ? iconBox + L.fontSize * 0.6 : 0);
  const centreY = L.height / 2;
  const domainY = tagline ? centreY - L.taglineSize * 0.25 : centreY + L.fontSize * 0.35;
  const radius = L.height / 2;

  const icon = hasIcon
    ? `<image x="${pad}" y="${(L.height - iconBox) / 2}" width="${iconBox}" height="${iconBox}" href="${faviconDataUri}" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  const taglineEl = tagline
    ? `<text x="${textX}" y="${centreY + L.taglineSize * 1.15}" font-family="DejaVu Sans, sans-serif" font-size="${L.taglineSize}" fill="#C8D2E0">${escapeXml(tagline)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#14181F" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0B0E13" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="${L.width - 2}" height="${L.height - 2}" rx="${radius}" ry="${radius}"
        fill="url(#g)" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>
  ${icon}
  <text x="${textX}" y="${domainY}" font-family="DejaVu Sans, sans-serif" font-size="${L.fontSize}"
        font-weight="bold" fill="#FFFFFF">${escapeXml(domain)}</text>
  ${taglineEl}
</svg>`;
}

/** Fetch a site's favicon as a data URI. Never throws; icon is optional. */
export async function fetchFaviconDataUri(domain: string): Promise<string | undefined> {
  // Google's service normalises size and format and copes with sites that
  // only ship a .ico, which ffmpeg's rasteriser would not read.
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return undefined;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Rasterise the pill to a transparent PNG ready to overlay. */
export async function renderCtaPng(
  spec: CtaSpec,
  canvasWidth: number,
  workDir: string
): Promise<{ path: string; width: number; height: number }> {
  const domain = displayDomain(spec.url);
  const faviconDataUri = await fetchFaviconDataUri(domain);
  const svg = buildCtaSvg({ domain, tagline: spec.tagline, faviconDataUri, canvasWidth });

  const svgPath = join(workDir, 'cta.svg');
  const pngPath = join(workDir, 'cta.png');
  writeFileSync(svgPath, svg, 'utf8');
  await executeFFmpegRaw(['-y', '-i', svgPath, pngPath]);

  const L = layoutPill(domain, spec.tagline, canvasWidth);
  return { path: pngPath, width: L.width, height: L.height };
}
