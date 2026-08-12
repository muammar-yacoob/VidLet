/**
 * Sensitive-data detection over OCR'd screen text.
 *
 * Screen recordings leak card numbers, emails, phone numbers and addresses
 * without the maker noticing, and by the time it is on YouTube it is too
 * late. This module is deliberately pure: OCR and ffmpeg live elsewhere, so
 * every rule here is testable without rendering anything.
 *
 * The bias is toward FALSE POSITIVES. Masking a version string that looked
 * like a phone number costs a blurred rectangle; missing a real card number
 * costs a lot more. Rules that would fire constantly on ordinary UI text
 * (bare 4-digit numbers, any @) are still excluded, because a video where
 * half the screen is blurred is one nobody will ship.
 */

export type PiiKind = 'card' | 'email' | 'phone' | 'iban' | 'postcode' | 'address' | 'ssn' | 'key';

export interface OcrWord {
  text: string;
  /** Pixel box in the frame the word was read from. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PiiMatch {
  kind: PiiKind;
  text: string;
}

/** Luhn check, so "1234 5678 9012 3456" is not treated as a card number. */
export function luhnValid(digits: string): boolean {
  const only = digits.replace(/\D/g, '');
  if (only.length < 13 || only.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = only.length - 1; i >= 0; i--) {
    let d = only.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/;
// 7+ digits with optional separators, optionally international. Deliberately
// not "any run of digits": timestamps and version strings would all match.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}[\s.-]?\d{0,4}/;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/;
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;
const US_ZIP = /\b\d{5}(?:-\d{4})?\b/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
// API keys and tokens: long opaque strings with a recognisable prefix.
const KEY = /\b(?:sk|pk|gsk|ghp|xox[abps]|AKIA)[-_][A-Za-z0-9]{16,}\b/;
/**
 * Street address. Deliberately strict, and case-SENSITIVE on the name.
 *
 * The loose version matched OCR garbage: a digit, any token, then a common
 * English word. "= owe & 4 HT way)" scanned off a Blender panel was read as
 * an address and pixelated a quarter of the frame. Requiring capitalised
 * name words of real length, at most three of them, and either a full
 * street type or an abbreviation WITH its period, makes noise very unlikely
 * to qualify while "42 Elm Street" still does.
 */
const STREET =
  /\b\d{1,5}\s+(?:[A-Z][A-Za-z'-]{2,}\s+){1,3}(?:(?:Street|Road|Avenue|Lane|Drive|Close|Court|Way|Place|Boulevard|Terrace|Crescent)\b|(?:St|Rd|Ave|Ln|Dr|Ct|Pl|Blvd)\.)/;

/** Digits-only run long enough to be a card, ignoring spaces and dashes. */
function cardCandidate(text: string): string | null {
  const match = text.match(/\b(?:\d[ -]?){13,19}\b/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 ? match[0] : null;
}

/**
 * Classify a run of text. Returns every kind that fires, most specific
 * first, or an empty array when the text is ordinary.
 */
export function classifyText(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  const push = (kind: PiiKind, value?: string | null): void => {
    if (value) found.push({ kind, text: value });
  };

  const card = cardCandidate(text);
  if (card && luhnValid(card)) push('card', card);

  push('key', text.match(KEY)?.[0]);
  push('email', text.match(EMAIL)?.[0]);
  push('iban', text.match(IBAN)?.[0]);
  push('ssn', text.match(SSN)?.[0]);
  push('address', text.match(STREET)?.[0]);
  push('postcode', text.match(UK_POSTCODE)?.[0]);

  // Phone last, and only when nothing more specific claimed the text: it is
  // the loosest rule and would otherwise shadow cards and postcodes.
  if (found.length === 0) {
    const phone = text.match(PHONE)?.[0];
    if (phone && phone.replace(/\D/g, '').length >= 9) push('phone', phone);
    const zip = text.match(US_ZIP)?.[0];
    if (!phone && zip) push('postcode', zip);
  }

  return found;
}

/**
 * A single mask may not cover more than this fraction of the frame. No card
 * number, address or key occupies a fifth of a screen; a region that large
 * is a merge that ran away or a rule that fired on noise, and covering it
 * ruins the video more surely than the thing it was hiding.
 */
export const MAX_REGION_AREA_FRACTION = 0.2;

export interface MaskRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  kinds: PiiKind[];
}

/** Grow a box by `pad` px on every side, clamped to the frame. */
function padBox(
  box: { x: number; y: number; width: number; height: number },
  pad: number,
  frameW: number,
  frameH: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(frameW - x, box.width + pad * 2),
    height: Math.min(frameH - y, box.height + pad * 2),
  };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Find sensitive words in one OCR'd frame and return the boxes to cover.
 *
 * Boxes are padded generously: OCR bounds hug the glyphs, and a mask that
 * stops exactly at the last pixel of a digit still shows its edge. Masks
 * are never time-bounded, so the only safety margin that matters is spatial.
 *
 * OCR splits a card number across several word boxes, so words are joined
 * into short sliding windows before classification and any window that
 * fires contributes all of its boxes. Overlapping boxes are merged, which
 * both looks tidier and keeps the ffmpeg graph small.
 */
export function regionsForFrame(
  words: OcrWord[],
  frameW: number,
  frameH: number,
  windowSize = 6,
  pad = 14
): MaskRegion[] {
  const raw: MaskRegion[] = [];

  for (let i = 0; i < words.length; i++) {
    // Longest window first. OCR splits "4242 4242 4242 4242" into four
    // boxes, and a 3-box prefix satisfies the phone rule, so shortest-first
    // classified real card numbers as phone numbers and cropped the mask to
    // part of the field.
    for (let n = Math.min(windowSize, words.length - i); n >= 1; n--) {
      const window = words.slice(i, i + n);
      const matches = classifyText(window.map((w) => w.text).join(' '));
      if (matches.length === 0) continue;
      const xs = window.map((w) => w.x);
      const ys = window.map((w) => w.y);
      const x2 = Math.max(...window.map((w) => w.x + w.width));
      const y2 = Math.max(...window.map((w) => w.y + w.height));
      const box = padBox(
        {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: x2 - Math.min(...xs),
          height: y2 - Math.min(...ys),
        },
        pad,
        frameW,
        frameH
      );
      raw.push({ ...box, kinds: matches.map((m) => m.kind) });
      break; // longest window wins; shorter ones are subsets of it
    }
  }

  // Merge overlaps so adjacent fields become one rectangle.
  const merged: MaskRegion[] = [];
  for (const region of raw) {
    const hit = merged.find((m) => overlaps(m, region));
    if (!hit) {
      merged.push({ ...region, kinds: [...region.kinds] });
      continue;
    }
    const x = Math.min(hit.x, region.x);
    const y = Math.min(hit.y, region.y);
    hit.width = Math.max(hit.x + hit.width, region.x + region.width) - x;
    hit.height = Math.max(hit.y + hit.height, region.y + region.height) - y;
    hit.x = x;
    hit.y = y;
    for (const k of region.kinds) if (!hit.kinds.includes(k)) hit.kinds.push(k);
  }
  return merged.filter((r) => withinAreaLimit(r, frameW, frameH));
}

/** True when a region is small enough to be a plausible piece of data. */
export function withinAreaLimit(
  region: { width: number; height: number },
  frameW: number,
  frameH: number
): boolean {
  const frame = Math.max(1, frameW * frameH);
  return (region.width * region.height) / frame <= MAX_REGION_AREA_FRACTION;
}

/**
 * Union every frame's regions into one static set.
 *
 * Screen recordings keep a field in the same place for long stretches, and
 * a mask that blinks on and off draws more attention than one that simply
 * stays. Covering the union for the whole clip is both cheaper (one overlay
 * chain, no per-region enable expressions) and safer, since OCR that misses
 * a frame cannot briefly expose the field.
 */
export function unionRegions(perFrame: MaskRegion[][]): MaskRegion[] {
  return regionsForFrameMerge(perFrame.flat());
}

function regionsForFrameMerge(all: MaskRegion[]): MaskRegion[] {
  const merged: MaskRegion[] = [];
  for (const region of all) {
    const hit = merged.find((m) => overlaps(m, region));
    if (!hit) {
      merged.push({ ...region, kinds: [...region.kinds] });
      continue;
    }
    const x = Math.min(hit.x, region.x);
    const y = Math.min(hit.y, region.y);
    hit.width = Math.max(hit.x + hit.width, region.x + region.width) - x;
    hit.height = Math.max(hit.y + hit.height, region.y + region.height) - y;
    hit.x = x;
    hit.y = y;
    for (const k of region.kinds) if (!hit.kinds.includes(k)) hit.kinds.push(k);
  }
  return merged;
}
