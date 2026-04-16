/**
 * GIF Export Tool Module
 * Handles GIF quality presets and size estimation
 */

(() => {
  const { $ } = window.VidLet;
  const { formatSize } = window.VidLetUtils;

  // Quality presets
  const gifPresets = {
    low: { fps: 10, width: 320, dither: 'none' },
    medium: { fps: 15, width: 480, dither: 'floyd_steinberg' },
    high: { fps: 24, width: 640, dither: 'floyd_steinberg' },
  };

  // Video info reference (set from main app)
  let videoInfo = null;

  /**
   * Set video info for calculations
   * @param {Object} info - Video metadata
   */
  function setVideoInfo(info) {
    videoInfo = info;
  }

  /**
   * Get GIF quality presets
   * @returns {Object} Preset configurations
   */
  function getPresets() {
    return gifPresets;
  }

  /**
   * Update GIF size estimate
   */
  function updateEstimate() {
    const duration = videoInfo?.duration || 10;
    const fps = Number.parseInt($('togif-fps')?.value) || 15;
    const width = Number.parseInt($('togif-width')?.value) || 480;

    const frames = fps * duration;
    const bytesPerFrame = (width / 480) * 15000;
    const gifSize = frames * bytesPerFrame;

    const estimateEl = $('togif-estimate');
    if (estimateEl) {
      estimateEl.textContent = `Est. output: ~${formatSize(gifSize)} (varies)`;
    }
  }

  /**
   * Set GIF quality level
   * @param {string} level - Quality level ('low', 'medium', 'high')
   */
  function setQuality(level) {
    const p = gifPresets[level];

    if ($('togif-fps')) $('togif-fps').value = p.fps;
    if ($('togif-width')) $('togif-width').value = p.width;
    if ($('togif-dither')) $('togif-dither').value = p.dither;

    // Update button states
    for (const btn of document.querySelectorAll('#opts-togif .preset-btn')) {
      btn.classList.remove('active');
    }

    // Note: event.target is available when called from button onclick
    if (window.event?.target) {
      window.event.target.classList.add('active');
    }

    updateEstimate();
  }

  /**
   * Get current GIF options for processing
   * @returns {Object} GIF configuration
   */
  function getOptions() {
    return {
      fps: Number.parseInt($('togif-fps')?.value) || 15,
      width: Number.parseInt($('togif-width')?.value) || 480,
      dither: $('togif-dither')?.value || 'floyd_steinberg',
    };
  }

  /**
   * Initialize GIF tool
   */
  function init() {
    updateEstimate();
  }

  // Export to global VidLetGifTool namespace
  window.VidLetGifTool = {
    setVideoInfo,
    getPresets,
    updateEstimate,
    setQuality,
    getOptions,
    init,
  };
})();
