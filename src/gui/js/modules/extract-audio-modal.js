/**
 * Extract Audio Modal Module
 * Handles audio extraction format and bitrate selection
 */

(() => {
  const { $ } = window.VidLet;

  /**
   * Open extract audio modal
   */
  function open() {
    $('extractAudioModal')?.classList.add('on');
  }

  /**
   * Close extract audio modal
   */
  function close() {
    $('extractAudioModal')?.classList.remove('on');
  }

  /**
   * Set audio format
   * @param {string} format - Audio format ('mp3', 'aac', 'wav', 'flac')
   */
  function setFormat(format) {
    $('extract-audio-format').value = format;

    // Update button states
    for (const btn of document.querySelectorAll('#audio-format-btns .seg-btn')) {
      btn.classList.remove('active');
    }

    const activeBtn = document.querySelector(`#audio-format-btns [data-val="${format}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Hide bitrate for lossless formats
    const bitrateRow = $('audio-bitrate-row');
    if (bitrateRow) {
      bitrateRow.style.display = format === 'wav' || format === 'flac' ? 'none' : 'flex';
    }
  }

  /**
   * Set audio bitrate
   * @param {number} bitrate - Bitrate in kbps
   */
  function setBitrate(bitrate) {
    $('extract-audio-bitrate').value = bitrate;

    // Update button states
    for (const btn of document.querySelectorAll('#audio-bitrate-btns .seg-btn')) {
      btn.classList.remove('active');
    }

    const activeBtn = document.querySelector(`#audio-bitrate-btns [data-val="${bitrate}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  /**
   * Get extract audio options
   * @returns {Object} Extract audio configuration
   */
  function getOptions() {
    return {
      format: $('extract-audio-format')?.value || 'mp3',
      bitrate: Number.parseInt($('extract-audio-bitrate')?.value) || 192,
    };
  }

  /**
   * Initialize extract audio modal
   */
  function init() {
    setFormat('mp3');
    setBitrate(192);
  }

  // Export to global VidLetExtractAudio namespace
  window.VidLetExtractAudio = {
    open,
    close,
    setFormat,
    setBitrate,
    getOptions,
    init,
  };
})();
