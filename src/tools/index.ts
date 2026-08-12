// Re-export tool configurations from CLI module
export {
  getToolConfigById,
  getToolsForExtension,
  type ToolConfig,
  toolConfigs,
} from '../cli/tools.js';
export { type ExtractAudioOptions, extractAudio } from './audio.js';
export { type AutoCleanupOptions, autoCleanup } from './autocleanup.js';
export {
  type CaptionOptions,
  type CaptionPosition,
  type CaptionStyle,
  caption,
  DEFAULT_SRT,
} from './caption.js';
export {
  analyzeVoice,
  type CleanVoiceOptions,
  cleanVoice,
  ensureDeepFilter,
  type VoiceAnalysis,
} from './cleanvoice.js';
// Re-export all tools
export { type CompressOptions, compress } from './compress.js';
export { type DemoOptions, demo } from './demo.js';
export { type FilterOptions, filter } from './filter.js';
export { type JumpcutOptions, type JumpcutPace, jumpcut } from './jumpcut.js';
export { type LoopOptions, loop } from './loop.js';
export { type Mkv2Mp4Options, mkv2mp4 } from './mkv2mp4.js';
export { type OptimizeOptions, optimize } from './optimize.js';
export { type OverlayLayer, type OverlayOptions, overlay } from './overlay.js';
export { type RemoveSilenceOptions, removeSilence } from './removesilence.js';
export { type ShortOptions, short } from './short.js';
export { type PortraitOptions, portrait } from './shorts.js';
export { type ShrinkOptions, shrink } from './shrink.js';
export { type SliceOptions, type SliceRegion, slice } from './slice.js';
export { type SpeedupOptions, speedup } from './speedup.js';
export { type ThumbOptions, thumb } from './thumb.js';
export { type ToGifOptions, togif } from './togif.js';
export { type TrimOptions, trim, trimAccurate } from './trim.js';
export { type VoiceoverOptions, voiceover } from './voiceover.js';
