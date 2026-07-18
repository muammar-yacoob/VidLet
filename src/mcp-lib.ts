// Re-exports consumed by the MCP server (mcp.js at repo root). Bundled as its
// own tsup entry (dist/mcp-lib.js) so mcp.js can call the real tool functions
// directly instead of shelling out to the `vidlet` CLI binary.
export { getVideoInfo, checkFFmpeg, type VideoInfo } from './lib/ffmpeg.js';
export { getOutputPath, changeExtension } from './lib/paths.js';
export { compress, type CompressOptions } from './tools/compress.js';
export { trim, type TrimOptions } from './tools/trim.js';
export { extractAudio, type ExtractAudioOptions } from './tools/audio.js';
export { caption, type CaptionOptions } from './tools/caption.js';
export { jumpcut, type JumpcutOptions } from './tools/jumpcut.js';
export { togif, type ToGifOptions } from './tools/togif.js';
