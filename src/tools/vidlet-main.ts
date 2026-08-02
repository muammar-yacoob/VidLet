/**
 * VidLet Main - Unified tool window with all video tools
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getToolConfig } from '../lib/config.js';
import { getVideoInfo } from '../lib/ffmpeg.js';
import { getVideoInfoForGui, startGuiServer } from '../lib/gui-server.js';
import { logToFile } from '../lib/logger.js';
import { setProcessStatus } from '../lib/process-status.js';
import { analyzeVoice } from './cleanvoice.js';
import { findAllLoopPoints, findBestLoopStart, findMatchesFromEnd } from './loop.js';
import { type ToolOptions, runTool } from './vidlet-run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get package.json homepage URL
 */
function getHomepage(): string {
  try {
    // Try reading from dist/../package.json
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.homepage || 'https://vidlet.app';
  } catch {
    return 'https://vidlet.app';
  }
}

/** Tool configuration */
export const config = {
  id: 'vidlet',
  name: 'VidLet',
  icon: 'tv.ico',
  extensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm'],
  description: 'Video utility toolkit',
};

/**
 * Run a GUI callback, turning a throw into the `{ success: false, error }`
 * reply the pages expect — they parse every response as JSON, so a rejection
 * must never reach the wire.
 */
async function attempt<T extends object>(
  label: string,
  work: () => Promise<T>
): Promise<(T & { success: true }) | { success: false; error: string }> {
  try {
    return { ...(await work()), success: true };
  } catch (err) {
    const error = (err as Error).message;
    logToFile(`VidLet: ${label} failed: ${error}`);
    return { success: false, error };
  }
}

/**
 * Run unified VidLet GUI
 */
export async function runGUI(input: string): Promise<boolean> {
  logToFile(`VidLet: Opening unified GUI for ${input}`);

  const videoInfo = await getVideoInfoForGui(input);
  const ext = path.extname(input).toLowerCase();

  // Check if video is landscape (16:9 or wider, aspect ratio >= 1.7)
  const isLandscape = videoInfo.width / videoInfo.height >= 1.7;

  // Load defaults for all tools
  const appConfig = await getToolConfig('app');
  const defaults = {
    compress: await getToolConfig('compress'),
    togif: await getToolConfig('togif'),
    mkv2mp4: await getToolConfig('mkv2mp4'),
    shrink: await getToolConfig('shrink'),
    cleanvoice: await getToolConfig('cleanvoice'),
    removesilence: await getToolConfig('removesilence'),
    autocleanup: await getToolConfig('autocleanup'),
    caption: await getToolConfig('caption'),
    jumpcut: await getToolConfig('jumpcut'),
    isMkv: ext === '.mkv',
    isLandscape,
    homepage: getHomepage(),
    hotkeyPreset: appConfig?.hotkeyPreset || 'premiere',
    frameSkip: appConfig?.frameSkip || 3,
    sparkAiKey: appConfig?.sparkAiKey || '',
  };

  // Track current input for chained operations
  let currentInput = input;

  return startGuiServer({
    htmlFile: 'vidlet.html',
    title: 'VidLet',
    videoInfo,
    defaults,
    onProcess: async (opts) => {
      return runTool(currentInput, opts as unknown as ToolOptions);
    },
    onLoadVideo: (data: { filePath: string }) =>
      attempt('Load video', async () => {
        logToFile(`VidLet: Loading new video: ${data.filePath}`);
        const newInfo = await getVideoInfo(data.filePath);
        const stats = fs.statSync(data.filePath);
        currentInput = data.filePath;
        // Update videoInfo for the server
        videoInfo.filePath = data.filePath;
        videoInfo.fileName = path.basename(data.filePath);
        videoInfo.width = newInfo.width;
        videoInfo.height = newInfo.height;
        videoInfo.duration = newInfo.duration;
        videoInfo.fps = newInfo.fps ?? 30;
        videoInfo.bitrate = newInfo.bitrate ?? 0;
        videoInfo.fileSize = stats.size;
        videoInfo.hasAudio = newInfo.hasAudio;
        logToFile(
          `VidLet: Loaded ${videoInfo.fileName} (${videoInfo.width}x${videoInfo.height}, ${videoInfo.duration}s)`
        );
        return { ...videoInfo };
      }),
    onDetectLoops: (minGap: number) =>
      attempt('Loop detection', async () => {
        logToFile(`VidLet: Detecting loop points with minGap=${minGap}s`);
        const startPoints = await findAllLoopPoints(currentInput, videoInfo.duration, minGap);
        logToFile(`VidLet: Found ${startPoints.length} start points`);
        return { startPoints };
      }),
    onFindMatches: (referenceTime: number, minGap: number) =>
      attempt('Match finding', async () => {
        logToFile(`VidLet: Finding matches from end, ref=${referenceTime}s, minGap=${minGap}s`);
        const matches = await findMatchesFromEnd(
          currentInput,
          videoInfo.duration,
          referenceTime,
          minGap
        );
        logToFile(`VidLet: Found ${matches.length} matches from end`);
        return { matches };
      }),
    onFindBestStart: (searchRange: number, minGap: number) =>
      attempt('Best start finding', async () => {
        logToFile(`VidLet: Finding best loop start in first ${searchRange}s`);
        const result = await findBestLoopStart(
          currentInput,
          videoInfo.duration,
          searchRange,
          minGap
        );
        if (!result) {
          return { startTime: 0, endTime: 0, score: 0 };
        }
        logToFile(
          `VidLet: Best start at ${result.startTime.toFixed(2)}s -> ${result.endTime.toFixed(2)}s`
        );
        return result;
      }),
    onAnalyzeAudio: () =>
      attempt('Audio analysis', async () => {
        logToFile('VidLet: Analyzing voice audio...');
        const result = await analyzeVoice(currentInput);
        logToFile(
          `VidLet: Analysis: voiceStart=${result.voiceStart.toFixed(2)}s, loudness=${result.currentLoudness.toFixed(1)} LUFS, suggestedNR=${result.suggestedNoiseReduction}dB`
        );
        return result;
      }),
    onTranscribe: () =>
      attempt('Transcription', async () => {
        logToFile('VidLet: Starting transcription...');
        const { transcribe, segmentsToSrt, ensureWhisper, ensureWhisperModel } = await import(
          '../lib/whisper.js'
        );
        try {
          setProcessStatus('Downloading whisper...');
          const hasWhisper = await ensureWhisper();
          if (!hasWhisper) {
            throw new Error('Could not download whisper.cpp binary for this platform');
          }
          setProcessStatus('Downloading model...');
          await ensureWhisperModel();
          setProcessStatus('Transcribing audio...');
          const result = await transcribe(currentInput, {
            onProgress: (stage) => setProcessStatus(stage),
          });
          logToFile(`VidLet: Transcribed ${result.segments.length} segments`);
          return { segments: result.segments, srtContent: segmentsToSrt(result.segments) };
        } finally {
          setProcessStatus('');
        }
      }),
  });
}
