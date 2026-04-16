/**
 * Lottie JSON optimizer. Safe techniques only:
 * 1. Truncate floats to 3 decimal places
 * 2. Strip editor-only metadata: nm, mn, meta, tc fields
 * 3. Remove zero-width strokes (w.k === 0)
 * 4. Remove effect "name" fields (nm inside ef)
 * 5. Compact JSON (no whitespace)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface OptimizeOptions {
  input: string;
  output?: string;
}

export interface OptimizeResult {
  file: string;
  originalSize: number;
  optimizedSize: number;
  savedBytes: number;
  savedPercent: number;
}

const STRIP_KEYS = new Set(['nm', 'mn', 'meta', 'tc']);

function roundFloats(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'number') return Math.round(obj * 1000) / 1000;
  if (Array.isArray(obj)) return obj.map(roundFloats);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = roundFloats(v);
    }
    return out;
  }
  return obj;
}

function stripMeta(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((v) => stripMeta(v)).filter((v) => v !== undefined);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = stripMeta(v);
    }
    return out;
  }
  return obj;
}

function removeZeroStrokes(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => {
        if (item && typeof item === 'object' && (item as Record<string, unknown>).ty === 'st') {
          const w = (item as Record<string, unknown>).w as Record<string, unknown> | undefined;
          if (w && w.a === 0 && w.k === 0) return false;
        }
        return true;
      })
      .map((v) => removeZeroStrokes(v));
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = removeZeroStrokes(v);
    }
    return out;
  }
  return obj;
}

function optimizeJson(raw: string): { optimized: string; originalSize: number; newSize: number } {
  const originalSize = Buffer.byteLength(raw, 'utf8');
  let data: unknown = JSON.parse(raw);
  data = stripMeta(data);
  data = removeZeroStrokes(data);
  data = roundFloats(data);
  const optimized = JSON.stringify(data);
  const newSize = Buffer.byteLength(optimized, 'utf8');
  return { optimized, originalSize, newSize };
}

/**
 * Resolve input to a list of JSON file paths (supports files and directories)
 */
function resolveFiles(input: string): string[] {
  const stat = statSync(input);
  if (stat.isDirectory()) {
    return readdirSync(input)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(input, f));
  }
  return [input];
}

/**
 * Optimize one or more Lottie JSON files
 */
export async function optimize(options: OptimizeOptions): Promise<string> {
  const files = resolveFiles(options.input);
  if (files.length === 0) {
    throw new Error('No JSON files found');
  }

  const results: OptimizeResult[] = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const { optimized, originalSize, newSize } = optimizeJson(raw);
    const outPath = options.output && files.length === 1 ? options.output : file;
    writeFileSync(outPath, optimized);

    const saved = originalSize - newSize;
    const pct = originalSize > 0 ? (saved / originalSize) * 100 : 0;
    results.push({
      file: basename(file),
      originalSize,
      optimizedSize: newSize,
      savedBytes: saved,
      savedPercent: Number.parseFloat(pct.toFixed(1)),
    });
  }

  const summary = results
    .map((r) => `${r.file}: ${r.originalSize} → ${r.optimizedSize} bytes (${r.savedPercent}% smaller)`)
    .join('\n');

  console.log(summary);
  return files.length === 1 ? files[0] : options.input;
}
