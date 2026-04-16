/**
 * Lottie JSON optimizer. Safe techniques only:
 * 1. Truncate floats to 2 decimal places
 * 2. Strip editor-only metadata keys
 * 3. Strip default-value keys (hd:false, bm:0, ao:0, ddd:0)
 * 4. Remove zero-width strokes (w.k === 0)
 * 5. Collapse single-keyframe animations to static values
 * 6. Compact JSON (no whitespace)
 */

import { execFileSync, execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { getOutputPath } from '../lib/paths.js';

export interface OptimizeOptions {
  input: string;
  output?: string;
  dotlottie?: boolean;
  /** GIF lossy compression level (0-200, default 80). Higher = smaller but lower quality */
  lossy?: number;
  /** GIF optimization level (1-3, default 3) */
  level?: number;
  /** Max colors for GIF (2-256) */
  colors?: number;
}

export interface OptimizeResult {
  file: string;
  originalSize: number;
  optimizedSize: number;
  savedBytes: number;
  savedPercent: number;
}

const STRIP_KEYS = new Set(['nm', 'mn', 'meta', 'tc', 'ix', 'cix', 'cl', 'ln']);

const DEFAULT_VALS: Record<string, unknown> = { hd: false, bm: 0, ao: 0, ddd: 0 };

function roundFloats(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'number') {
    if (Number.isInteger(obj)) return obj;
    return Math.round(obj * 100) / 100;
  }
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
      if (k in DEFAULT_VALS && v === DEFAULT_VALS[k]) continue;
      out[k] = stripMeta(v);
    }
    return out;
  }
  return obj;
}

function collapseStatic(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(collapseStatic);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = collapseStatic(v);
    }
    if (out.a === 0 && Array.isArray(out.k) && out.k.length === 1 && typeof out.k[0] === 'number') {
      out.k = out.k[0];
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
  data = collapseStatic(data);
  data = roundFloats(data);
  const optimized = JSON.stringify(data);
  const newSize = Buffer.byteLength(optimized, 'utf8');
  return { optimized, originalSize, newSize };
}

/**
 * Resolve input to a list of JSON file paths (supports files and directories)
 */
/**
 * Quick check if a JSON file looks like a Lottie animation
 * Lottie files have "v" (version), "ip", "op", and "layers" keys
 */
function isLottieFile(filePath: string): boolean {
  const head = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 2000);
  return head.includes('"v"') && (head.includes('"layers"') || head.includes('"fr"'));
}

function resolveFiles(input: string): string[] {
  const stat = statSync(input);
  if (stat.isDirectory()) {
    return readdirSync(input)
      .filter((f) => f.endsWith('.json') || f.endsWith('.gif'))
      .map((f) => join(input, f));
  }
  return [input];
}

/**
 * Optimize a GIF file using gifsicle
 */
async function optimizeGif(
  file: string,
  options: { output?: string; lossy?: number; level?: number; colors?: number },
): Promise<OptimizeResult> {
  const gifsicle = (await import('gifsicle')).default;
  const originalSize = statSync(file).size;
  const outPath = options.output ?? getOutputPath(file, '_optimized');

  const args: string[] = [
    `-O${options.level ?? 3}`,
    `--lossy=${options.lossy ?? 80}`,
  ];
  if (options.colors) {
    args.push(`--colors=${options.colors}`);
  }
  args.push('-o', outPath, file);

  execFileSync(gifsicle, args);

  const optimizedSize = statSync(outPath).size;
  const saved = originalSize - optimizedSize;
  const pct = originalSize > 0 ? (saved / originalSize) * 100 : 0;

  return {
    file: basename(outPath),
    originalSize,
    optimizedSize,
    savedBytes: saved,
    savedPercent: Number.parseFloat(pct.toFixed(1)),
  };
}

/**
 * Convert optimized JSON data to .lottie (dotLottie) format
 */
async function toDotLottie(jsonData: unknown, outputPath: string): Promise<number> {
  const { DotLottie } = await import('@dotlottie/dotlottie-js');
  const dotlottie = new DotLottie();
  const animId = basename(outputPath, '.lottie');
  // biome-ignore lint: Lottie JSON conforms to Animation at runtime
  dotlottie.addAnimation({ id: animId, data: jsonData as any });
  const built = await dotlottie.build();
  const buffer = await built.toArrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
  return Buffer.byteLength(Buffer.from(buffer));
}

/** Format bytes as human-readable */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Resolve Windows temp dir as WSL path (cached) */
let _wslTemp: string | null = null;
function getWslTemp(): string | null {
  if (_wslTemp !== null) return _wslTemp;
  try {
    const winTemp = execSync('cmd.exe /c echo %TEMP%', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    _wslTemp = execSync(`wslpath -u "${winTemp}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    _wslTemp = '';
  }
  return _wslTemp || null;
}

function writeProgress(current: number, total: number, fileName: string): void {
  const tmp = getWslTemp();
  if (!tmp) return;
  try {
    writeFileSync(join(tmp, 'vidlet-optimize-progress.tmp'), `${current}/${total}|${fileName}`, 'utf-8');
  } catch { /* ignore */ }
}

/**
 * Optimize Lottie JSON or GIF files
 */
export async function optimize(options: OptimizeOptions): Promise<string> {
  const allFiles = resolveFiles(options.input);
  const gifFiles = allFiles.filter((f) => extname(f).toLowerCase() === '.gif');
  let lottieFiles = allFiles.filter((f) => extname(f).toLowerCase() === '.json' && isLottieFile(f));

  if (gifFiles.length === 0 && lottieFiles.length === 0) {
    throw new Error('No Lottie JSON or GIF files found');
  }

  // Sort Lottie files by size (smallest first)
  lottieFiles.sort((a, b) => statSync(a).size - statSync(b).size);

  const results: OptimizeResult[] = [];
  const totalFiles = gifFiles.length + lottieFiles.length;
  let processed = 0;

  // Optimize GIF files
  for (const file of gifFiles) {
    processed++;
    writeProgress(processed, totalFiles, basename(file));
    const result = await optimizeGif(file, {
      output: options.output && gifFiles.length === 1 ? options.output : undefined,
      lossy: options.lossy,
      level: options.level,
      colors: options.colors,
    });
    results.push(result);
  }

  // Optimize Lottie JSON files
  for (const file of lottieFiles) {
    processed++;
    writeProgress(processed, totalFiles, basename(file));
    const raw = readFileSync(file, 'utf8');
    const originalSize = Buffer.byteLength(raw, 'utf8');
    const { optimized, newSize } = optimizeJson(raw);

    let finalSize: number;
    let outPath: string;

    if (options.dotlottie) {
      outPath = options.output && lottieFiles.length === 1
        ? options.output
        : file.replace(/\.json$/, '.lottie');
      const jsonData = JSON.parse(optimized);
      finalSize = await toDotLottie(jsonData, outPath);
    } else {
      outPath = options.output && lottieFiles.length === 1 ? options.output : file;
      writeFileSync(outPath, optimized);
      finalSize = newSize;
    }

    const saved = originalSize - finalSize;
    const pct = originalSize > 0 ? (saved / originalSize) * 100 : 0;
    results.push({
      file: basename(outPath),
      originalSize,
      optimizedSize: finalSize,
      savedBytes: saved,
      savedPercent: Number.parseFloat(pct.toFixed(1)),
    });
  }

  // Print per-file summary
  for (const r of results) {
    console.log(`${r.file}: ${formatBytes(r.originalSize)} → ${formatBytes(r.optimizedSize)} (${r.savedPercent}% saved)`);
  }

  const totalOriginal = results.reduce((s, r) => s + r.originalSize, 0);
  const totalOptimized = results.reduce((s, r) => s + r.optimizedSize, 0);
  const totalSaved = totalOriginal - totalOptimized;
  const totalPct = totalOriginal > 0 ? (totalSaved / totalOriginal) * 100 : 0;

  if (results.length > 1) {
    console.log(`\nTotal: ${results.length} files, ${formatBytes(totalOriginal)} → ${formatBytes(totalOptimized)} (${totalPct.toFixed(1)}% saved)`);
  }

  // Signal toast HTA
  try {
    const tmp = getWslTemp();
    if (tmp) {
      const msg = results.length === 1
        ? `${results[0].file}: ${results[0].savedPercent}% saved (${formatBytes(results[0].savedBytes)})`
        : `${results.length} files: ${formatBytes(totalSaved)} saved (${totalPct.toFixed(1)}%)`;
      writeFileSync(join(tmp, 'vidlet-optimize-done.tmp'), msg, 'utf-8');
    }
  } catch { /* ignore */ }

  const allProcessed = [...gifFiles, ...lottieFiles];
  return allProcessed.length === 1 ? allProcessed[0] : options.input;
}
