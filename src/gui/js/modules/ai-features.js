/**
 * VidLet AI Features — powered by Spark AI
 * Provides smart rename, settings suggestions, and video descriptions.
 */
(() => {
  function isAvailable() {
    return !!window.SparkAI?._configured;
  }

  /**
   * Suggest a descriptive filename after processing
   */
  async function suggestRename(toolUsed, videoInfo) {
    if (!isAvailable()) return null;

    const prompt = `Suggest ONE short, descriptive filename for this processed video. Original: "${videoInfo.fileName}", Tool: ${toolUsed}, Duration: ${videoInfo.duration?.toFixed(1)}s, Resolution: ${videoInfo.width}x${videoInfo.height}. Reply with ONLY the filename (with .mp4 extension), no explanation. Keep it concise (max 40 chars), use hyphens, lowercase, no special chars.`;

    try {
      const res = await window.SparkAI.ask(prompt);
      if (res.error) return null;
      const name = (res.reply || '').trim().replace(/['"]/g, '').replace(/\n.*/s, '');
      if (!name || name.length > 60) return null;
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Suggest optimal autocleanup settings based on video metadata
   */
  async function suggestCleanupSettings(videoInfo) {
    if (!isAvailable()) return null;

    const prompt = `You are a video editor assistant. Given this video: filename="${videoInfo.fileName}", duration=${videoInfo.duration?.toFixed(1)}s, resolution=${videoInfo.width}x${videoInfo.height}, bitrate=${videoInfo.bitrate}kbps, fps=${videoInfo.fps}. Suggest optimal cleanup settings as JSON only: {"noiseReduction": 1-10, "minSilenceDuration": 0.1-3.0, "applyContrast": true/false}. Consider: high bitrate = less noise, short video = contrast ok, screen recordings need less denoise, talking-head videos need more silence removal. Reply with ONLY valid JSON, nothing else.`;

    try {
      const res = await window.SparkAI.ask(prompt);
      if (res.error) return null;
      const text = (res.reply || '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  /**
   * Generate a social media description for the processed video
   */
  async function generateDescription(videoInfo, toolUsed) {
    if (!isAvailable()) return null;

    const prompt = `Write a short social media caption (under 150 chars) for a video: "${videoInfo.fileName}", ${videoInfo.duration?.toFixed(0)}s long, processed with ${toolUsed}. Make it engaging and include 2-3 relevant hashtags. Reply with ONLY the caption text.`;

    try {
      const res = await window.SparkAI.ask(prompt);
      if (res.error) return null;
      return (res.reply || '').trim();
    } catch {
      return null;
    }
  }

  // Patch SparkAI.configure to track availability
  const origConfigure = window.SparkAI?.configure;
  if (origConfigure) {
    window.SparkAI.configure = (opts) => {
      origConfigure(opts);
      if (opts.apiKey) window.SparkAI._configured = true;
    };
  }

  window.VidLetAI = {
    isAvailable,
    suggestRename,
    suggestCleanupSettings,
    generateDescription,
  };
})();
