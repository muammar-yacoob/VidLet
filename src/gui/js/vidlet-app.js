/**
 * VidLet App - the contract between the markup and the app
 *
 * The GUI pages use inline `onclick=` handlers, which resolve against the
 * global scope. Rather than scatter one-line globals across the app modules,
 * every name the HTML can call is declared here in one table, and the app
 * itself lives in app/state.js, app/init.js, app/tools.js and app/process.js.
 */
(() => {
  const App = window.VidLetApp;
  const { $ } = VidLet;

  const copyToClipboard = (textId, buttonId) => {
    navigator.clipboard.writeText($(textId).textContent).then(() => {
      $(buttonId).classList.add('copied');
      setTimeout(() => $(buttonId).classList.remove('copied'), 1500);
    });
  };

  const setPlaybackRate = (rate) => {
    $('videoPreview').playbackRate = rate;
    const speedBtn = $('speedVal');
    if (speedBtn) speedBtn.textContent = `${rate}x`;
  };

  Object.assign(window, {
    // Tool selection & processing
    selectTool: (id) => App.selectTool(id),
    process: () => App.process(),
    continueEditing: () => App.continueEditing(),
    openOutput: () => VidLet.postJson('/api/open-folder', {}).catch(() => {}),

    // Settings modal
    openSettings: () => window.VidLetSettingsManager.openSettings(App.info),
    closeSettings: () => window.VidLetSettingsManager.closeSettings(App.updateEstimates),
    updateFrameSkipLabel: () => window.VidLetSettingsManager.updateFrameSkipLabel(),
    setHotkeyPreset: (preset) => {
      window.VidLetSettingsManager.setCurrentHotkeyPreset(preset);
      window.VidLet.hotkeys.setPreset(preset);
      window.VidLet.hotkeys.updateDisplay();
    },
    openHomepage: () => VidLet.openUrl(App.homepage),

    // Player controls
    togglePlay: () => window.VidLetPlayerControls.togglePlay(),
    toggleMute: () => window.VidLetPlayerControls.toggleMute(),
    adjustSpeed: (delta) => {
      const current = $('videoPreview').playbackRate || 1;
      setPlaybackRate(Math.max(0.5, Math.min(8, current + delta)));
    },
    resetSpeed: () => setPlaybackRate(1),

    // Loop match markers
    findMatchingFrames: () => window.VidLetMatchMarkers.findAllMatches(App.info),
    cycleMatch: () => window.VidLetMatchMarkers.nextMatch(),
    toggleAutoZoom: () => window.VidLetMatchMarkers.toggleAutoZoom(),

    // Undo/redo
    undo: () => window.VidLet.undo.undo(),
    redo: () => window.VidLet.undo.redo(),

    // Quality presets
    setCompressQuality: (level) => {
      window.VidLetCompressTool.setQuality(level);
      App.updateEstimates();
    },
    setGifQuality: (level) => {
      window.VidLetGifTool.setQuality(level);
      App.updateEstimates();
    },
    setShrinkTo60: () => window.VidLetShrinkTool.setTo60(),
    updateShrinkLabel: () => App.updateShrinkLabel(),

    // Extract audio modal
    openExtractAudioModal: () => window.VidLetExtractAudio.open(),
    closeExtractAudioModal: () => window.VidLetExtractAudio.close(),
    extractAudio: () => App.extractAudio(),
    setAudioFormat: (format) => window.VidLetExtractAudio.setFormat(format),
    setAudioBitrate: (bitrate) => window.VidLetExtractAudio.setBitrate(bitrate),

    // Audio panel
    setAudioMode: (mode) => App.setAudioMode(mode),
    updateCleanNoiseLabel: () => {
      if ($('clean-noise-val')) $('clean-noise-val').textContent = $('clean-noise')?.value;
    },
    updateCleanLoudnessLabel: () => {
      if ($('clean-loudness-val')) {
        $('clean-loudness-val').textContent = `${$('clean-loudness')?.value} LUFS`;
      }
    },

    // MKV converter
    setMkvMode: (mode) => window.VidLetMkvTool.setMode(mode),

    // Filter tool
    updateFilterPreview: () => window.VidLetFilterTool.updateFilterPreview(),
    toggleEffect: (name) => window.VidLetFilterTool.toggleEffect(name),
    selectFilterPreset: (preset) => window.VidLetFilterTool.selectFilterPreset(preset),
    resetFilters: () => window.VidLetFilterTool.resetFilters(),
    resetColorFilters: () => window.VidLetFilterTool.resetColorFilters(),
    resetEffectFilters: () => window.VidLetFilterTool.resetEffectFilters(),

    // Thumbnail tool
    captureCurrentFrame: () => window.VidLetThumbTool.captureCurrentFrame(),
    selectUploadedImage: () => window.VidLetThumbTool.selectUploadedImage(),
    updateThumbAspectRatio: () => window.VidLetThumbTool.updateAspectRatio(),

    // Portrait crop overlay (called from the portrait module)
    updateCropOverlay: () => window.VidLet.portrait.updateOverlay(),

    // Auto cleanup
    toggleCleanupContrast: () => {
      const isOn = $('cleanup-contrast-toggle').classList.toggle('on');
      $('cleanup-skip-contrast').value = isOn ? 'false' : 'true';
      $('cleanup-contrast-label').textContent = isOn ? 'On' : 'Off';
    },

    // AI features
    aiSuggestSettings: () => App.aiSuggestSettings(),
    copyAiRename: () => copyToClipboard('ai-rename-text', 'ai-copy-btn'),
    copyAiCaption: () => copyToClipboard('ai-caption-text', 'ai-caption-copy'),

    // Badges
    hideGifStar: () => App.hideGifBadge(),
    hideTrimStar: () => {}, // Legacy handler, kept so the markup keeps working
  });

  document.addEventListener('DOMContentLoaded', () => App.init());
})();
