/**
 * Compress Tool Module
 * Handles video compression quality presets and size estimation
 */

(() => {
  const { $ } = window.VidLet;
  const { formatSize } = window.VidLetUtils;

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
   * Get compression quality presets based on original bitrate
   * @returns {Object} Preset configurations
   */
  function getPresets() {
    const origBitrate = videoInfo?.bitrate || 5000;
    return {
      low: { bitrate: Math.round(origBitrate * 0.3), preset: 'veryfast', label: '~30%' },
      medium: { bitrate: Math.round(origBitrate * 0.5), preset: 'medium', label: '~50%' },
      high: { bitrate: Math.round(origBitrate * 0.7), preset: 'slow', label: '~70%' },
    };
  }

  /**
   * Update compress preset button labels with percentages
   */
  function updateLabels() {
    const presets = getPresets();
    const btns = document.querySelectorAll('#opts-compress .preset-btn');
    const labels = ['Small', 'Balanced', 'Quality'];
    const keys = ['low', 'medium', 'high'];

    btns.forEach((btn, i) => {
      const p = presets[keys[i]];
      btn.textContent = `${labels[i]} (${p.label})`;
    });
  }

  /**
   * Update compress size estimate
   */
  function updateEstimate() {
    const duration = videoInfo?.duration || 60;
    const origBitrate = videoInfo?.bitrate || 5000;

    const bitrate = Number.parseInt($('compress-bitrate')?.value) || 2500;
    const compressSize = (bitrate * 1000 * duration) / 8;
    const reduction = origBitrate > 0 ? Math.round((1 - bitrate / origBitrate) * 100) : 0;

    const estimateEl = $('compress-estimate');
    if (estimateEl) {
      estimateEl.textContent = `Est: ~${formatSize(compressSize)} (${reduction}% smaller)`;
    }
  }

  /**
   * Set compression quality level
   * @param {string} level - Quality level ('low', 'medium', 'high')
   */
  function setQuality(level) {
    const presets = getPresets();
    const p = presets[level];

    if ($('compress-bitrate')) $('compress-bitrate').value = p.bitrate;
    if ($('compress-preset')) $('compress-preset').value = p.preset;

    // Update button states
    for (const btn of document.querySelectorAll('#opts-compress .preset-btn')) {
      btn.classList.remove('active');
    }

    // Note: event.target is available when called from button onclick
    if (window.event?.target) {
      window.event.target.classList.add('active');
    }

    updateEstimate();
  }

  /**
   * Get current compression options for processing
   * @returns {Object} Compression configuration
   */
  function getOptions() {
    return {
      bitrate: Number.parseInt($('compress-bitrate')?.value) || 2500,
      preset: $('compress-preset')?.value || 'medium',
      codec: $('compress-codec')?.value || 'h264',
    };
  }

  /**
   * Initialize compress tool with default values
   */
  function init() {
    updateLabels();
    const defaultPresets = getPresets();
    if ($('compress-bitrate')) {
      $('compress-bitrate').value = defaultPresets.medium.bitrate;
    }
    updateEstimate();
  }

  // Export to global VidLetCompressTool namespace
  window.VidLetCompressTool = {
    setVideoInfo,
    getPresets,
    updateLabels,
    updateEstimate,
    setQuality,
    getOptions,
    init,
  };
})();
