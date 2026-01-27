// Re-export tool configurations from CLI module
export { toolConfigs, getToolConfigById, getToolsForExtension, type ToolConfig } from '../cli/tools.js';

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
