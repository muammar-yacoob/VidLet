/**
 * MKV to MP4 Tool Module
 * Handles MKV container conversion settings
 */

(() => {
  const { $ } = window.VidLet;

  let mkvFastCopy = true;

  /**
   * Set MKV conversion mode
   * @param {string} mode - Mode ('fast' or 'compat')
   */
  function setMode(mode) {
    mkvFastCopy = mode === 'fast';
    $('mkv2mp4-quality').value = mkvFastCopy ? 23 : 20;
    $('mkv-fast')?.classList.toggle('active', mkvFastCopy);
    $('mkv-compat')?.classList.toggle('active', !mkvFastCopy);
  }

  /**
   * Get MKV conversion options
   * @returns {Object} MKV configuration
   */
  function getOptions() {
    return {
      fastCopy: mkvFastCopy,
      quality: Number.parseInt($('mkv2mp4-quality')?.value) || 23,
    };
  }

  /**
   * Initialize MKV tool
   */
  function init() {
    setMode('fast');
  }

  // Export to global VidLetMkvTool namespace
  window.VidLetMkvTool = {
    setMode,
    getOptions,
    init,
  };
})();
