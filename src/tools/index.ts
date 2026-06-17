// Re-export tool configurations from CLI module
export {
  toolConfigs,
  getToolConfigById,
  getToolsForExtension,
  type ToolConfig,
} from '../cli/tools.js';

// Re-export all tools
export { compress, type CompressOptions } from './compress.js';
export { loop, type LoopOptions } from './loop.js';
export { mkv2mp4, type Mkv2Mp4Options } from './mkv2mp4.js';
export { shrink, type ShrinkOptions } from './shrink.js';
export { thumb, type ThumbOptions } from './thumb.js';
export { togif, type ToGifOptions } from './togif.js';
export { filter, type FilterOptions } from './filter.js';
export { caption, type CaptionOptions, DEFAULT_SRT } from './caption.js';
export { extractAudio, type ExtractAudioOptions } from './audio.js';
export {
  cleanVoice,
  analyzeVoice,
  ensureDeepFilter,
  type CleanVoiceOptions,
  type VoiceAnalysis,
} from './cleanvoice.js';
export { optimize, type OptimizeOptions } from './optimize.js';
export { removeSilence, type RemoveSilenceOptions } from './removesilence.js';
export { autoCleanup, type AutoCleanupOptions } from './autocleanup.js';
export { trim, trimAccurate, type TrimOptions } from './trim.js';
export { portrait, type PortraitOptions } from './shorts.js';
export { slice, type SliceOptions, type SliceRegion } from './slice.js';
