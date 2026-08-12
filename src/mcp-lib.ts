// Re-exports consumed by the MCP server (mcp.js at repo root). Bundled as its
// own tsup entry (dist/mcp-lib.js) so mcp.js can call the real tool functions
// directly instead of shelling out to the `vidlet` CLI binary.
export { checkFFmpeg, getVideoInfo, type VideoInfo } from './lib/ffmpeg.js';
export { changeExtension, getOutputPath } from './lib/paths.js';
export { type ExtractAudioOptions, extractAudio } from './tools/audio.js';
export { type CaptionOptions, caption } from './tools/caption.js';
export { type CompressOptions, compress } from './tools/compress.js';
export { type DemoOptions, demo } from './tools/demo.js';
export { type JumpcutOptions, jumpcut } from './tools/jumpcut.js';
export { type ShortOptions, short } from './tools/short.js';
export { type ToGifOptions, togif } from './tools/togif.js';
export { type TrimOptions, trim } from './tools/trim.js';
export {
  type CloneEngine,
  resolveCloneEngine,
  type VoiceoverOptions,
  voiceover,
} from './tools/voiceover.js';
