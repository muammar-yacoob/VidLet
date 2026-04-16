/**
 * Settings Manager Module
 * Manages the settings modal and user preferences
 */
(() => {
  const { $, postJson } = window.VidLet;
  const { setSegBtn, getSegVal } = window.VidLetUtils;

  // Settings state
  let currentHotkeyPreset = 'premiere';
  let phase1FrameSkip = 3;

  /**
   * Open settings modal
   * @param {object} info - Video info object
   */
  function openSettings(_info) {
    for (const group of document.querySelectorAll('.seg-btns')) {
      for (const btn of group.querySelectorAll('button')) {
        btn.onclick = () => {
          for (const b of group.querySelectorAll('button')) {
            b.classList.remove('active');
          }
          btn.classList.add('active');
        };
      }
    }

    const preset = $('compress-preset').value;
    const presetMap = {
      ultrafast: 'fast',
      superfast: 'fast',
      veryfast: 'fast',
      faster: 'fast',
      fast: 'fast',
      medium: 'medium',
      slow: 'slow',
      slower: 'slow',
      veryslow: 'slow',
    };
    setSegBtn('settingsCompressQuality', presetMap[preset] || 'medium');
    setSegBtn('settingsGifFps', $('togif-fps').value);
    setSegBtn('settingsGifWidth', $('togif-width').value);
    setSegBtn('settingsMkvQuality', $('mkv2mp4-quality').value);
    setSegBtn('settingsTrimMode', $('trim-accurate').value === 'true' ? 'accurate' : 'fast');

    // Hotkey preset
    const hotkeySelect = $('settingsHotkeyPreset');
    if (hotkeySelect) hotkeySelect.value = currentHotkeyPreset;
    window.VidLet.hotkeys.updateDisplay();

    // Frame skip setting
    const frameSkipSlider = $('settingsFrameSkip');
    if (frameSkipSlider) {
      frameSkipSlider.value = phase1FrameSkip;
      updateFrameSkipLabel();
    }

    $('settingsModal').classList.add('on');
  }

  /**
   * Update frame skip label
   */
  function updateFrameSkipLabel() {
    const slider = $('settingsFrameSkip');
    const label = $('frameSkipVal');
    if (slider && label) {
      label.textContent = slider.value;
    }
  }

  /**
   * Close settings modal and save
   * @param {Function} updateEstimates - Callback to update estimates
   */
  function closeSettings(updateEstimates) {
    // Compress settings
    const qualityPresetMap = { fast: 'veryfast', medium: 'medium', slow: 'slow' };
    const bitrateMap = { fast: 0.3, medium: 0.5, slow: 0.7 };
    const quality = getSegVal('settingsCompressQuality');
    $('compress-preset').value = qualityPresetMap[quality] || 'medium';
    const origBitrate = window.videoInfo?.bitrate || 5000;
    $('compress-bitrate').value = Math.round(origBitrate * (bitrateMap[quality] || 0.5));

    // GIF settings
    const fps = getSegVal('settingsGifFps');
    const width = getSegVal('settingsGifWidth');
    if (fps) $('togif-fps').value = fps;
    if (width) $('togif-width').value = width;

    // MKV settings
    const crf = getSegVal('settingsMkvQuality');
    if (crf) $('mkv2mp4-quality').value = crf;

    // Trim settings
    const trimMode = getSegVal('settingsTrimMode');
    $('trim-accurate').value = trimMode === 'accurate' ? 'true' : 'false';

    // Frame skip setting
    const frameSkipSlider = $('settingsFrameSkip');
    if (frameSkipSlider) {
      phase1FrameSkip = Number.parseInt(frameSkipSlider.value, 10) || 3;
    }

    // Update all estimates
    if (updateEstimates) {
      updateEstimates();
    }
    window.VidLetCompressTool.updateLabels();

    $('settingsModal').classList.remove('on');
    saveSettings();
  }

  /**
   * Save settings to server
   */
  async function saveSettings() {
    try {
      await postJson('/api/save-settings', {
        hotkeyPreset: currentHotkeyPreset,
        frameSkip: phase1FrameSkip,
      });
    } catch (err) {
      console.warn('Failed to save settings:', err);
    }
  }

  /**
   * Get current hotkey preset
   * @returns {string} Current hotkey preset
   */
  function getCurrentHotkeyPreset() {
    return currentHotkeyPreset;
  }

  /**
   * Set current hotkey preset
   * @param {string} preset - Hotkey preset name
   */
  function setCurrentHotkeyPreset(preset) {
    currentHotkeyPreset = preset;
  }

  /**
   * Get current frame skip value
   * @returns {number} Current frame skip value
   */
  function getPhase1FrameSkip() {
    return phase1FrameSkip;
  }

  /**
   * Set current frame skip value
   * @param {number} value - Frame skip value
   */
  function setPhase1FrameSkip(value) {
    phase1FrameSkip = value;
  }

  // Export API
  window.VidLetSettingsManager = {
    openSettings,
    closeSettings,
    updateFrameSkipLabel,
    getCurrentHotkeyPreset,
    setCurrentHotkeyPreset,
    getPhase1FrameSkip,
    setPhase1FrameSkip,
  };
})();
