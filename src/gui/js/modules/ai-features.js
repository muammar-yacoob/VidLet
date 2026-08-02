/**
 * VidLet AI Features — powered by Spark AI
 * Provides smart rename, settings suggestions, and video descriptions.
 */
(() => {
  function isAvailable() {
    return !!window.SparkAI?._configured;
  }

  /**
   * Per-session memo of prompt -> reply.
   *
   * Every suggestion here is a pure function of the video's metadata and the
   * tool that ran, so re-processing the same file (or reloading after
   * "continue editing") would otherwise re-ask - and re-bill - for an answer
   * we already have. sessionStorage keeps it across those reloads.
   */
  const MEMO_KEY = 'vidlet.ai.memo';

  function readMemo() {
    try {
      return JSON.parse(sessionStorage.getItem(MEMO_KEY) || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Ask Spark AI, reusing a previous reply to the same prompt.
   *
   * @param {string} prompt
   * @returns {Promise<string|null>} The reply text, or null on any failure.
   */
  async function ask(prompt) {
    if (!isAvailable()) return null;

    const memo = readMemo();
    if (typeof memo[prompt] === 'string') return memo[prompt];

    try {
      const res = await window.SparkAI.ask(prompt);
      if (res.error) return null;
      const reply = (res.reply || '').trim();
      if (!reply) return null;

      memo[prompt] = reply;
      try {
        sessionStorage.setItem(MEMO_KEY, JSON.stringify(memo));
      } catch {
        // Quota or private mode - the call still succeeded
      }
      return reply;
    } catch {
      return null;
    }
  }

  /** The metadata every prompt is derived from. */
  function describe(videoInfo, toolUsed) {
    return `filename="${videoInfo.fileName}", tool=${toolUsed}, duration=${videoInfo.duration?.toFixed(1)}s, resolution=${videoInfo.width}x${videoInfo.height}`;
  }

  /**
   * Suggest a filename and a social caption for the processed video.
   *
   * One round trip for both: they run together after every successful job and
   * share the same inputs, so asking separately doubled the calls for nothing.
   *
   * @returns {Promise<{name: string|null, caption: string|null}>}
   */
  async function suggestOutputText(toolUsed, videoInfo) {
    const empty = { name: null, caption: null };

    const reply = await ask(
      `For this processed video (${describe(videoInfo, toolUsed)}) give two things as JSON only: ${
        '{"filename":"<short descriptive filename with .mp4, max 40 chars, lowercase, hyphens, no special chars>",' +
        '"caption":"<engaging social media caption under 150 chars with 2-3 relevant hashtags>"}. ' +
        'Reply with ONLY valid JSON, nothing else.'
      }`
    );
    if (!reply) return empty;

    try {
      const match = reply.match(/\{[\s\S]*\}/);
      if (!match) return empty;
      const parsed = JSON.parse(match[0]);

      const name = (parsed.filename || '').trim().replace(/['"]/g, '').replace(/\n.*/s, '');
      const caption = (parsed.caption || '').trim();
      return {
        name: name && name.length <= 60 ? name : null,
        caption: caption || null,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Suggest optimal autocleanup settings based on video metadata
   */
  async function suggestCleanupSettings(videoInfo) {
    const reply = await ask(
      `You are a video editor assistant. Given this video: filename="${videoInfo.fileName}", duration=${videoInfo.duration?.toFixed(1)}s, resolution=${videoInfo.width}x${videoInfo.height}, bitrate=${videoInfo.bitrate}kbps, fps=${videoInfo.fps}. Suggest optimal cleanup settings as JSON only: {"noiseReduction": 1-10, "minSilenceDuration": 0.1-3.0, "applyContrast": true/false}. Consider: high bitrate = less noise, short video = contrast ok, screen recordings need less denoise, talking-head videos need more silence removal. Reply with ONLY valid JSON, nothing else.`
    );
    if (!reply) return null;

    try {
      const match = reply.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
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
    suggestOutputText,
    suggestCleanupSettings,
  };
})();
