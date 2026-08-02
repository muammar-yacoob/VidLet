/**
 * VidLet App - tool selection and the chrome that reacts to it
 */
(() => {
  const App = window.VidLetApp;
  const { $, postJson } = VidLet;
  const { formatHotkey } = window.VidLetUtils;

  /**
   * Extra setup a tool needs when it becomes the active one.
   * Anything not listed here just shows its options panel.
   */
  const ON_ACTIVATE = {
    portrait: () => {
      $('cropOverlay').classList.add('active');
      window.VidLet.portrait.init(App.info);
    },
    trim: () => {
      $('videoPreview').currentTime = Number.parseFloat($('trim-start').value) || 0;
    },
    audio: () => {
      window.VidLetAudioTool.setActiveTool(true);
      window.VidLetAudioTool.startPreview();
      window.VidLetAudioTool.updateVolumeUI();
    },
    togif: () => App.hideGifBadge(),
    thumb: () => window.VidLetThumbTool.setActiveTool(true),
    filter: () => window.VidLetFilterTool.applyFilterPreview(),
    caption: () => {
      $('captionOverlay').classList.remove('hidden');
      window.VidLetCaptionTool.show();
    },
  };

  /** Cleanup a tool needs when it stops being the active one. */
  const ON_DEACTIVATE = {
    audio: () => window.VidLetAudioTool.stopPreview(),
    filter: () => window.VidLetFilterTool.clearFilterPreview(),
  };

  function selectTool(id) {
    if (App.activeTool && App.activeTool !== id) {
      ON_DEACTIVATE[App.activeTool]?.();
    }

    for (const t of document.querySelectorAll('.tool')) t.classList.remove('active');
    for (const o of document.querySelectorAll('.opts')) o.classList.remove('active');
    $('mkv-notice').classList.remove('active');
    $('cropOverlay').classList.remove('active');
    $('captionOverlay').classList.add('hidden');

    const el = $(`t-${id}`);

    // MKV files can only use the mkv2mp4 tool
    if (App.isMkvFile && id !== 'mkv2mp4') {
      el?.classList.add('active');
      $('mkv-notice').classList.add('active');
      App.activeTool = null;
      $('processBtn').disabled = true;
      return;
    }

    if (!el || el.classList.contains('disabled')) {
      App.activeTool = null;
      $('processBtn').disabled = true;
      updatePlayerHotkeyHint();
      return;
    }

    el.classList.add('active');
    $(`opts-${id}`)?.classList.add('active');
    App.activeTool = id;
    $('processBtn').disabled = false;
    ON_ACTIVATE[id]?.();

    updatePlayerHotkeyHint();
  }

  /**
   * Update player hotkey hint based on active tool
   */
  function updatePlayerHotkeyHint() {
    const hint = $('playerHotkeyHint');
    if (!hint) return;

    const hotkeys = window.VidLet.hotkeys.getMap();
    const toolHints = {
      portrait: ` | ${formatHotkey(hotkeys.split)}: Split | ${formatHotkey(hotkeys.delete)}: Del`,
      trim: ` | ${formatHotkey(hotkeys.markIn)}: Set In | ${formatHotkey(hotkeys.markOut)}: Set Out`,
    };

    hint.textContent = `Space: Play | ←→: 1s | Alt+←→: Frame | M: Mute${toolHints[App.activeTool] || ''}`;
  }

  // ============ ESTIMATES & HINTS ============

  function updateEstimates() {
    window.VidLetCompressTool.updateEstimate();
    window.VidLetGifTool.updateEstimate();
    window.VidLetShrinkTool.updateEstimate();
  }

  /** Grey out or light up the "under 60s unlocks Loop" style hints. */
  function updateFeatureHints(tool, outputDuration) {
    const hintEl = $(`${tool}-unlock-hint`);
    if (!hintEl) return;

    const loopUnlocked = outputDuration <= 60;
    const gifUnlocked = outputDuration <= 15;

    for (const item of hintEl.querySelectorAll('.hint-item')) {
      const text = item.textContent;
      if (text.includes('60s') || text.includes('Loop')) {
        item.classList.toggle('unlocked', loopUnlocked);
      } else if (text.includes('15s') || text.includes('GIF')) {
        item.classList.toggle('unlocked', gifUnlocked);
      }
    }
  }

  function updateShrinkLabel() {
    window.VidLetShrinkTool.updateLabel();
    updateEstimates();
    window.VidLetShrinkTool.updateMarker();
    updateFeatureHints('shrink', Number.parseFloat($('shrink-duration').value));
  }

  // ============ GIF BADGE ============

  function showGifBadge() {
    const badge = $('gif-badge');
    if (!badge) return;
    badge.style.display = 'flex';
    setTimeout(() => badge.classList.add('show'), 100);
  }

  function hideGifBadge() {
    const badge = $('gif-badge');
    if (!badge) return;
    badge.classList.remove('show');
    setTimeout(() => {
      badge.style.display = 'none';
    }, 300);
  }

  // ============ AUDIO MODE ============

  function setAudioMode(mode) {
    App.audioMode = mode;
    const addOpts = $('audio-add-opts');
    const cleanOpts = $('audio-clean-opts');
    if (addOpts) addOpts.style.display = mode === 'add' ? '' : 'none';
    if (cleanOpts) cleanOpts.style.display = mode === 'clean' ? '' : 'none';
    for (const btn of document.querySelectorAll('#audio-mode-btns .preset-btn')) {
      btn.classList.remove('active');
    }
    document.querySelector(`#audio-mode-btns [data-mode="${mode}"]`)?.classList.add('active');

    if (mode === 'clean') analyzeAudioForCleanVoice();
  }

  /** Probe the audio so the clean-voice sliders start somewhere sensible. */
  async function analyzeAudioForCleanVoice() {
    const infoEl = $('clean-analysis-info');
    if (infoEl) infoEl.textContent = 'Analyzing audio...';

    try {
      const res = await postJson('/api/analyze-audio', {});
      if (!res.success) {
        if (infoEl) infoEl.textContent = 'Analysis failed — using defaults';
        return;
      }

      $('clean-noise').value = res.suggestedNoiseReduction;
      $('clean-noise-val').textContent = `${res.suggestedNoiseReduction}`;
      $('clean-loudness').value = -14;
      $('clean-loudness-val').textContent = '-14 LUFS';

      if (res.noiseSampleStart != null && res.noiseSampleEnd != null) {
        $('clean-noise-start').value = res.noiseSampleStart.toFixed(1);
        $('clean-noise-end').value = res.noiseSampleEnd.toFixed(1);
      }

      const sample =
        res.noiseSampleStart != null
          ? `Sample: ${res.noiseSampleStart.toFixed(1)}→${res.noiseSampleEnd.toFixed(1)}s`
          : 'No noise detected';
      infoEl.textContent = `${sample} · ${res.currentLoudness.toFixed(1)} LUFS`;
    } catch {
      if (infoEl) infoEl.textContent = 'Analysis failed — using defaults';
    }
  }

  // ============ UNDO/REDO SNAPSHOTS ============

  function getStateSnapshot() {
    return {
      tool: App.activeTool,
      trimStart: $('trim-start')?.value,
      trimEnd: $('trim-end')?.value,
      ...window.VidLet.portrait.getState(),
    };
  }

  function restoreState(snapshot) {
    if (snapshot.tool === 'portrait' && App.activeTool === 'portrait') {
      window.VidLet.portrait.setState(snapshot);
    }
    if (snapshot.tool === 'trim' && App.activeTool === 'trim') {
      if (snapshot.trimStart !== undefined) $('trim-start').value = snapshot.trimStart;
      if (snapshot.trimEnd !== undefined) $('trim-end').value = snapshot.trimEnd;
      window.VidLetTrimTimeline.updateTimeline(App.info);
    }
  }

  // trim-timeline.js snapshots through this global before each edit
  window.getStateSnapshot = getStateSnapshot;
  window.restoreState = restoreState;

  Object.assign(App, {
    selectTool,
    updatePlayerHotkeyHint,
    updateEstimates,
    updateFeatureHints,
    updateShrinkLabel,
    showGifBadge,
    hideGifBadge,
    setAudioMode,
    analyzeAudioForCleanVoice,
  });
})();
