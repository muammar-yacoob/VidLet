/**
 * Find and cover sensitive information in a recording.
 *
 * Detection is OCR (tesseract) over sampled frames, classified by the pure
 * rules in lib/pii.ts. Tesseract is an optional system dependency: when it
 * is missing this degrades to "mask nothing, say so loudly" rather than
 * failing a render, because a missing OCR binary should not cost someone
 * their edit. Manual regions always work, with or without it.
 *
 * Masking style is pixelation, not a black bar: a mosaic reads as
 * deliberate, keeps the layout legible, and costs one scale-down plus one
 * scale-up per region, which is far cheaper than a large-radius blur.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { executeFFmpegRaw, getVideoInfo } from '../lib/ffmpeg.js';
import { fmt, header, separator, success } from '../lib/logger.js';
import { type MaskRegion, type OcrWord, regionsForFrame, unionRegions } from '../lib/pii.js';

export interface MaskOptions {
  input: string;
  output: string;
  /** Frames sampled per second for OCR. Default 0.5 (one every 2s). */
  sampleFps?: number;
  /** Explicit regions to cover, in source pixels. Always honoured. */
  regions?: MaskRegion[];
  /** Mosaic block size as a fraction of region width. Default 0.12. */
  blockiness?: number;
  /** Report what would be masked without writing a video. */
  dryRun?: boolean;
  onProgress?: (stage: string) => void;
}

export interface MaskResult {
  output: string | null;
  regions: MaskRegion[];
  framesScanned: number;
  ocrAvailable: boolean;
  note?: string;
}

/** tesseract is optional; probe once and remember. */
let ocrProbe: Promise<boolean> | null = null;
export function isOcrAvailable(): Promise<boolean> {
  if (!ocrProbe) {
    ocrProbe = execa('tesseract', ['--version'])
      .then(() => true)
      .catch(() => false);
  }
  return ocrProbe;
}

/**
 * Parse tesseract TSV into word boxes. Columns are fixed by the format:
 * level, page, block, para, line, word, left, top, width, height, conf, text
 */
export function parseTesseractTsv(tsv: string, minConfidence = 40): OcrWord[] {
  const words: OcrWord[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12) continue;
    const conf = Number.parseFloat(cols[10]);
    const text = cols[11]?.trim();
    if (!text || Number.isNaN(conf) || conf < minConfidence) continue;
    words.push({
      text,
      x: Number.parseInt(cols[6], 10),
      y: Number.parseInt(cols[7], 10),
      width: Number.parseInt(cols[8], 10),
      height: Number.parseInt(cols[9], 10),
    });
  }
  return words;
}

/**
 * Pixelate each region: crop it out, shrink it hard, scale it back with
 * nearest-neighbour, and overlay it in place.
 */
export function buildMaskGraph(regions: MaskRegion[], blockiness: number): string {
  if (regions.length === 0) return '';
  const chains: string[] = [];
  let base = '0:v';
  regions.forEach((r, i) => {
    const blocks = Math.max(2, Math.round(r.width * blockiness));
    const smallW = Math.max(2, Math.round(r.width / blocks) * 2);
    const smallH = Math.max(2, Math.round((r.height * smallW) / r.width));
    chains.push(
      `[${base}]split=2[keep${i}][cut${i}];` +
        `[cut${i}]crop=${r.width}:${r.height}:${r.x}:${r.y},` +
        `scale=${smallW}:${smallH},scale=${r.width}:${r.height}:flags=neighbor[px${i}];` +
        `[keep${i}][px${i}]overlay=${r.x}:${r.y}[m${i}]`
    );
    base = `m${i}`;
  });
  // The caller maps [masked]; name the last link predictably.
  chains.push(`[${base}]null[masked]`);
  return chains.join(';');
}

/** OCR sampled frames and return every region worth covering. */
async function detectRegions(
  input: string,
  sampleFps: number,
  progress: (s: string) => void
): Promise<{ regions: MaskRegion[]; frames: number }> {
  const info = await getVideoInfo(input);
  const workDir = mkdtempSync(join(tmpdir(), 'vidlet-mask-'));
  try {
    const framesDir = join(workDir, 'frames');
    mkdirSync(framesDir, { recursive: true });
    progress('sampling frames');
    await executeFFmpegRaw([
      '-y',
      '-i',
      input,
      '-vf',
      `fps=${sampleFps}`,
      '-qscale:v',
      '3',
      join(framesDir, 'f%05d.jpg'),
    ]);

    const files = readdirSync(framesDir).sort();
    progress(`reading text from ${files.length} frames`);
    const perFrame: MaskRegion[][] = [];
    for (const file of files) {
      const base = join(framesDir, file);
      try {
        // `tsv` gives per-word boxes; stdout keeps it off disk.
        const { stdout } = await execa('tesseract', [base, 'stdout', '--psm', '11', 'tsv']);
        const words = parseTesseractTsv(stdout);
        const regions = regionsForFrame(words, info.width, info.height);
        if (regions.length > 0) perFrame.push(regions);
      } catch {
        // A frame tesseract cannot read is not worth failing the pass for.
      }
    }
    return { regions: unionRegions(perFrame), frames: files.length };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function maskSensitive(options: MaskOptions): Promise<MaskResult> {
  const { input, output } = options;
  const sampleFps = options.sampleFps ?? 0.5;
  const blockiness = options.blockiness ?? 0.12;
  const progress = options.onProgress ?? ((s: string) => console.log(fmt.dim(`  ${s}...`)));

  header('Mask Sensitive');
  console.log(`Input:    ${fmt.white(input)}`);

  let regions = options.regions ?? [];
  let framesScanned = 0;
  const ocrAvailable = await isOcrAvailable();

  if (options.regions === undefined) {
    if (!ocrAvailable) {
      const note =
        'tesseract is not installed, so nothing was scanned. Install it with ' +
        '`sudo apt install tesseract-ocr` for automatic detection, or pass `regions` ' +
        'to mask areas you choose.';
      console.log(`Scan:     ${fmt.yellow('skipped (no tesseract)')}`);
      separator();
      return { output: null, regions: [], framesScanned: 0, ocrAvailable: false, note };
    }
    const found = await detectRegions(input, sampleFps, progress);
    regions = found.regions;
    framesScanned = found.frames;
  }

  console.log(`Found:    ${fmt.yellow(String(regions.length))} region(s) to cover`);
  separator();

  if (regions.length === 0) {
    return {
      output: null,
      regions: [],
      framesScanned,
      ocrAvailable,
      note: 'Nothing sensitive was detected, so no video was written.',
    };
  }
  if (options.dryRun) {
    return {
      output: null,
      regions,
      framesScanned,
      ocrAvailable,
      note: 'Dry run: nothing written.',
    };
  }

  progress('masking');
  await executeFFmpegRaw([
    '-y',
    '-i',
    input,
    '-filter_complex',
    buildMaskGraph(regions, blockiness),
    '-map',
    '[masked]',
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-movflags',
    '+faststart',
    output,
  ]);

  success(`Output: ${output}`);
  return { output, regions, framesScanned, ocrAvailable };
}
