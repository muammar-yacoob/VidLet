/**
 * VidLet App - Main application integration layer
 * Coordinates between all tool modules and manages app state
 */
const { $, postJson, formatDuration } = VidLet;

// Import module APIs from window namespace
const { formatFileSize, getAspectRatioLabel, celebrate, formatHotkey } = window.VidLetUtils;

// App state
let info = {};
let activeTool = null;
let homepage = 'https://vidlet.app';
let _currentFilePath = null;
let isMkvFile = false;
let skipReloadOnContinue = false;

// Make info globally accessible for modules
window.videoInfo = info;

// ============ INITIALIZATION ============

async function init() {
  const res = await VidLet.fetchJson('/api/info');
  info = res;
  window.videoInfo = info; // Make accessible to modules
  _currentFilePath = res.filePath;
  updateFileDisplay();

  const video = $('videoPreview');
  video.src = '/api/video';

  if (res.width && res.height) {
    VidLet.resizeToVideo(res.width, res.height);
  }

  // Load hotkey preset from server config
  if (res.defaults?.hotkeyPreset) {
    window.VidLetSettingsManager.setCurrentHotkeyPreset(res.defaults.hotkeyPreset);
    window.VidLet.hotkeys.setPreset(res.defaults.hotkeyPreset);
  }

  // Load frame skip setting from server config
  if (typeof res.defaults?.frameSkip === 'number') {
    window.VidLetSettingsManager.setPhase1FrameSkip(res.defaults.frameSkip);
  }

  // Handle MKV files - show converter, disable other tools
  isMkvFile = res.defaults?.isMkv || false;
  $('t-mkv2mp4').classList.toggle('hidden', !isMkvFile);

  // Show Portrait for all videos except 9:16 (already portrait)
  const aspectRatio = res.width / res.height;
  const isAlreadyPortrait = Math.abs(aspectRatio - 9 / 16) < 0.05;
  $('t-portrait').classList.toggle('hidden', isAlreadyPortrait);

  // Hide GIF export for long videos (>15s), show badge if available
  const canExportGif = res.duration <= 15;
  $('t-togif').classList.toggle('hidden', !canExportGif);
  if (canExportGif) {
    showGifBadge();
  }

  // Show Find Match button only for short videos (<60s)
  const isShortVideo = res.duration <= 60;
  $('find-match-btn').classList.toggle('hidden', !isShortVideo);

  // Auto-find best loop start for short videos
  if (isShortVideo) {
    // Find best loop start in first 5 seconds, then preload additional matches
    window.VidLetMatchMarkers.findBestLoopStart(info).then(() => {
      const preloadPromise = window.VidLetMatchMarkers.preloadMatches(info);
      window.VidLetMatchMarkers.setPreloadPromise(preloadPromise);
    });
  }

  if (res.defaults?.homepage) {
    homepage = res.defaults.homepage;
    $('homepageLink').textContent = homepage.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // Initialize trim timeline with visible default boundaries
  const trimStart = Math.min(res.duration * 0.1, 5);
  const trimEnd = Math.max(res.duration * 0.9, res.duration - 5);
  $('trim-start').value = trimStart.toFixed(2);
  $('trim-end').value = Math.max(trimEnd, trimStart + 1).toFixed(2);
  window.VidLetTrimTimeline.updateTimeline(info);
  window.VidLetTrimTimeline.initTimelineHandles(info);
  window.VidLetTrimTimeline.initTimelineZoom(info);

  // Initialize tool modules
  window.VidLetCompressTool.init(info);
  window.VidLetGifTool.init(info);
  window.VidLetShrinkTool.init(info);
  window.VidLetAudioTool.init();
  window.VidLetThumbTool.init();
  window.VidLetMkvTool.init();
  window.VidLetExtractAudio.init();
  window.VidLetCaptionTool.init();
  window.VidLet.portrait.init(info);

  // Initialize UI components
  initCropOverlay();
  window.VidLetPlayerControls.initPlayerControls(
    () => window.VidLetTrimTimeline.setTrimStartToCurrent(info),
    () => window.VidLetTrimTimeline.setTrimEndToCurrent(info),
    () => activeTool
  );
  window.VidLetUIControls.initResizeDivider();
  window.VidLetDropZones.initDropZones();
  window.VidLetUIControls.initVideoZoom();
  initPageZoomLock();

  // Update initial estimates
  updateEstimates();

  // Select first tool (mkv2mp4 for MKV files, otherwise first available)
  if (isMkvFile) {
    selectTool('mkv2mp4');
  } else {
    const firstTool = document.querySelector('.tool:not(.hidden):not(.disabled)');
    if (firstTool) {
      selectTool(firstTool.id.replace('t-', ''));
    }
  }

  // Signal ready and start frame caching
  signalAppReady();
}

/**
 * Start frame caching and show progress
 * Loading HTA closes when cache threshold is reached
 */
function signalAppReady() {
  const video = $('videoPreview');
  let signaled = false;

  const doSignal = () => {
    if (signaled) return;
    signaled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Signal is handled by writing to temp file via /api/progress
      });
    });
  };

  const startCaching = () => {
    const progressEl = $('cache-progress');
    if (progressEl) {
      progressEl.style.display = 'flex';
      $('cache-progress-label').textContent = 'Caching frames...';
      $('cache-progress-fill').style.width = '0%';
      $('cache-progress-pct').textContent = '0%';
    }

    // If already cached, signal immediately
    if (window.VidLet.frameCache.isReady()) {
      VidLet.postJson('/api/progress', { percent: 100 });
      doSignal();
      return;
    }

    // Start frame cache with progress callback
    const frameSkip = window.VidLetSettingsManager.getPhase1FrameSkip();
    window.VidLet.frameCache.build(frameSkip, (pct) => {
      VidLet.postJson('/api/progress', { percent: pct });
    });
  };

  const waitForVideo = () => {
    if (video && video.readyState >= 2 && video.duration > 0) {
      startCaching();
    } else if (video) {
      VidLet.postJson('/api/progress', { percent: 0 });
      video.addEventListener(
        'canplay',
        () => {
          if (video.duration > 0) {
            startCaching();
          }
        },
        { once: true }
      );
    }
  };

  if (document.readyState === 'complete') {
    waitForVideo();
  } else {
    window.addEventListener('load', waitForVideo, { once: true });
  }
}

function updateFileDisplay() {
  $('fileName').textContent = ` ${info.fileName}`;
  $('resolution').textContent = ` ${info.width.toLocaleString()}×${info.height.toLocaleString()}`;
  $('aspectRatio').textContent = ` ${getAspectRatioLabel(info.width, info.height)}`;
  $('fileSize').textContent = ` ${formatFileSize(info.fileSize)}`;
  $('duration').textContent = ` ${formatDuration(info.duration)}`;
  $('fps').textContent = ` ${info.fps ? info.fps.toFixed(1) : '-'}`;
}

// ============ TOOL SELECTION ============

function selectTool(id) {
  // Stop audio preview when leaving audio tool
  if (activeTool === 'audio' && id !== 'audio') {
    window.VidLetAudioTool.stopPreview();
  }

  // Clear filter preview when leaving filter tool
  if (activeTool === 'filter' && id !== 'filter') {
    window.VidLetFilterTool.clearFilterPreview();
  }

  for (const t of document.querySelectorAll('.tool')) {
    t.classList.remove('active');
  }
  for (const o of document.querySelectorAll('.opts')) {
    o.classList.remove('active');
  }
  $('mkv-notice').classList.remove('active');

  const el = $(`t-${id}`);
  const opts = $(`opts-${id}`);

  $('cropOverlay').classList.remove('active');
  $('captionOverlay').classList.add('hidden');

  // MKV files can only use mkv2mp4 tool
  if (isMkvFile && id !== 'mkv2mp4') {
    el?.classList.add('active');
    $('mkv-notice').classList.add('active');
    activeTool = null;
    $('processBtn').disabled = true;
    return;
  }

  if (el && !el.classList.contains('disabled')) {
    el.classList.add('active');
    if (opts) opts.classList.add('active');
    activeTool = id;
    $('processBtn').disabled = false;

    // Tool-specific activation
    if (id === 'portrait') {
      $('cropOverlay').classList.add('active');
      window.VidLet.portrait.show();
    }

    if (id === 'trim') {
      const video = $('videoPreview');
      video.currentTime = Number.parseFloat($('trim-start').value) || 0;
    }

    if (id === 'audio') {
      window.VidLetAudioTool.setActiveTool(true);
      window.VidLetAudioTool.startPreview();
      window.VidLetAudioTool.updateVolumeUI();
    }

    if (id === 'togif') {
      hideGifBadge();
    }

    if (id === 'thumb') {
      window.VidLetThumbTool.setActiveTool(true);
    }

    if (id === 'filter') {
      window.VidLetFilterTool.applyFilterPreview();
    }

    if (id === 'caption') {
      $('captionOverlay').classList.remove('hidden');
      window.VidLetCaptionTool.show();
    }
  } else {
    activeTool = null;
    $('processBtn').disabled = true;
  }

  updatePlayerHotkeyHint();
}

/**
 * Update player hotkey hint based on active tool
 */
function updatePlayerHotkeyHint() {
  const hint = $('playerHotkeyHint');
  if (!hint) return;

  const baseHints = 'Space: Play | ←→: 1s | Alt+←→: Frame | M: Mute';
  let toolHints = '';
  const hotkeys = window.VidLet.hotkeys.getMap();

  if (activeTool === 'portrait') {
    toolHints = ` | ${formatHotkey(hotkeys.split)}: Split | ${formatHotkey(hotkeys.delete)}: Del`;
  } else if (activeTool === 'trim') {
    toolHints = ` | ${formatHotkey(hotkeys.markIn)}: Set In | ${formatHotkey(hotkeys.markOut)}: Set Out`;
  }

  hint.textContent = baseHints + toolHints;
}

// ============ SETTINGS MODAL ============
// These functions are called from HTML onclick handlers
// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function openSettings() {
  window.VidLetSettingsManager.openSettings(info);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function updateFrameSkipLabel() {
  window.VidLetSettingsManager.updateFrameSkipLabel();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function closeSettings() {
  window.VidLetSettingsManager.closeSettings(updateEstimates);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function openHomepage() {
  VidLet.openUrl(homepage);
}

// Wrapper functions for HTML onclick handlers
// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setHotkeyPreset(preset) {
  window.VidLetSettingsManager.setCurrentHotkeyPreset(preset);
  window.VidLet.hotkeys.setPreset(preset);
  window.VidLet.hotkeys.updateDisplay();
}

// Player control wrappers (called from HTML)
// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function togglePlay() {
  window.VidLetPlayerControls.togglePlay();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function toggleMute() {
  window.VidLetPlayerControls.toggleMute();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function adjustSpeed(delta) {
  const video = $('videoPreview');
  const currentSpeed = video.playbackRate || 1;
  const newSpeed = Math.max(0.5, Math.min(8, currentSpeed + delta));
  video.playbackRate = newSpeed;
  const speedBtn = $('speedVal');
  if (speedBtn) {
    speedBtn.textContent = `${newSpeed}x`;
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function resetSpeed() {
  const video = $('videoPreview');
  video.playbackRate = 1;
  const speedBtn = $('speedVal');
  if (speedBtn) {
    speedBtn.textContent = '1x';
  }
}

// Match marker wrappers (called from HTML)
// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function findMatchingFrames() {
  window.VidLetMatchMarkers.findAllMatches(info);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function cycleMatch() {
  window.VidLetMatchMarkers.nextMatch();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function toggleAutoZoom() {
  window.VidLetMatchMarkers.toggleAutoZoom();
}

// Undo/Redo wrappers (called from HTML)
// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function undo() {
  window.VidLet.undo.undo();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function redo() {
  window.VidLet.undo.redo();
}

// ============ QUALITY PRESETS ============

function updateEstimates() {
  window.VidLetCompressTool.updateEstimate();
  window.VidLetGifTool.updateEstimate();
  window.VidLetShrinkTool.updateEstimate();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setCompressQuality(level) {
  window.VidLetCompressTool.setQuality(level);
  updateEstimates();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setGifQuality(level) {
  window.VidLetGifTool.setQuality(level);
  updateEstimates();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setShrinkTo60() {
  window.VidLetShrinkTool.setTo60();
}

// ============ EXTRACT AUDIO MODAL ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function openExtractAudioModal() {
  window.VidLetExtractAudio.open();
}

function closeExtractAudioModal() {
  window.VidLetExtractAudio.close();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
async function extractAudio() {
  closeExtractAudioModal();

  $('loading').classList.add('on');
  $('loading').querySelector('span').textContent = 'Extracting audio...';

  const opts = window.VidLetExtractAudio.getOptions();

  try {
    const res = await postJson('/api/process', opts);
    $('loading').classList.remove('on');

    if (res.success) {
      celebrate();
      $('done').classList.add('on');
      $('output').textContent = res.output || 'Audio extracted!';
    } else {
      alert(`Error: ${res.error || 'Unknown error'}`);
    }
  } catch (err) {
    $('loading').classList.remove('on');
    alert(`Error: ${err.message}`);
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setAudioFormat(format) {
  window.VidLetExtractAudio.setFormat(format);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setAudioBitrate(bitrate) {
  window.VidLetExtractAudio.setBitrate(bitrate);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function setMkvMode(mode) {
  window.VidLetMkvTool.setMode(mode);
}

// ============ SHRINK ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function updateShrinkLabel() {
  window.VidLetShrinkTool.updateLabel();
  updateEstimates();
  updateShrinkMarker();
  const val = Number.parseFloat($('shrink-duration').value);
  updateFeatureHints('shrink', val);
}

function updateShrinkMarker() {
  window.VidLetShrinkTool.updateMarker();
}

function updateFeatureHints(tool, outputDuration) {
  const hintEl = $(`${tool}-unlock-hint`);
  if (!hintEl) return;

  const loopUnlocked = outputDuration <= 60;
  const gifUnlocked = outputDuration <= 15;

  const hintItems = hintEl.querySelectorAll('.hint-item');
  for (const item of hintItems) {
    const text = item.textContent;
    if (text.includes('60s') || text.includes('Loop')) {
      item.classList.toggle('unlocked', loopUnlocked);
    } else if (text.includes('15s') || text.includes('GIF')) {
      item.classList.toggle('unlocked', gifUnlocked);
    }
  }
}

// Timeline, match markers, and player controls are now in separate modules

// ============ VIDEO ZOOM ============
// Moved to ui-controls.js module

// ============ CROP OVERLAY (PORTRAIT) ============

function initCropOverlay() {
  window.VidLet.portrait.initCropOverlay();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from portrait module
function updateCropOverlay() {
  window.VidLet.portrait.updateCropOverlay();
}

// Drop zones are now in drop-zones.js module

// ============ RESIZE DIVIDER ============
// Moved to ui-controls.js module

// ============ PAGE ZOOM LOCK ============

function initPageZoomLock() {
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        const isVideoZoom = e.target.closest('#previewContainer');
        const isTimelineZoom = e.target.closest('#timeline-container');
        if (!isVideoZoom && !isTimelineZoom) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );
}

// ============ FILTER TOOL ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function updateFilterPreview() {
  window.VidLetFilterTool.updateFilterPreview();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function toggleEffect(name) {
  window.VidLetFilterTool.toggleEffect(name);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function selectFilterPreset(preset) {
  window.VidLetFilterTool.selectFilterPreset(preset);
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function resetFilters() {
  window.VidLetFilterTool.resetFilters();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function resetColorFilters() {
  window.VidLetFilterTool.resetColorFilters();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function resetEffectFilters() {
  window.VidLetFilterTool.resetEffectFilters();
}

// ============ THUMB TOOL ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function captureCurrentFrame() {
  window.VidLetThumbTool.captureCurrentFrame();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function selectUploadedImage() {
  window.VidLetThumbTool.selectUploadedImage();
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function updateThumbAspectRatio() {
  window.VidLetThumbTool.updateAspectRatio();
}

// ============ GIF BADGE ============

function showGifBadge() {
  const badge = $('gif-badge');
  if (badge) {
    badge.style.display = 'flex';
    setTimeout(() => badge.classList.add('show'), 100);
  }
}

function hideGifBadge() {
  const badge = $('gif-badge');
  if (badge) {
    badge.classList.remove('show');
    setTimeout(() => {
      badge.style.display = 'none';
    }, 300);
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function hideGifStar() {
  hideGifBadge();
}

// ============ TRIM STAR (HIDDEN) ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function hideTrimStar() {
  // Legacy function, kept for compatibility
}

// ============ UNDO/REDO ============

function getStateSnapshot() {
  return {
    tool: activeTool,
    trimStart: $('trim-start')?.value,
    trimEnd: $('trim-end')?.value,
    ...window.VidLet.portrait.getState(),
  };
}

function restoreState(snapshot) {
  if (snapshot.tool === 'portrait' && activeTool === 'portrait') {
    window.VidLet.portrait.restoreState(snapshot);
  }
  if (snapshot.tool === 'trim' && activeTool === 'trim') {
    if (snapshot.trimStart !== undefined) $('trim-start').value = snapshot.trimStart;
    if (snapshot.trimEnd !== undefined) $('trim-end').value = snapshot.trimEnd;
    window.VidLetTrimTimeline.updateTimeline(info);
  }
}

// Make getStateSnapshot and restoreState globally accessible for undo module
window.getStateSnapshot = getStateSnapshot;
window.restoreState = restoreState;

// ============ PROCESS ============

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
async function process() {
  if (!activeTool) return;

  $('loading').classList.add('on');
  $('loading').querySelector('span').textContent = 'Processing...';

  let opts = { tool: activeTool };

  try {
    // Get tool-specific options
    if (activeTool === 'compress') {
      opts = { ...opts, ...window.VidLetCompressTool.getOptions() };
    } else if (activeTool === 'togif') {
      opts = { ...opts, ...window.VidLetGifTool.getOptions() };
    } else if (activeTool === 'shrink') {
      opts = { ...opts, ...window.VidLetShrinkTool.getOptions() };
    } else if (activeTool === 'mkv2mp4') {
      opts = { ...opts, ...window.VidLetMkvTool.getOptions() };
    } else if (activeTool === 'trim') {
      const start = Number.parseFloat($('trim-start').value);
      const end = Number.parseFloat($('trim-end').value);
      const accurate = $('trim-accurate').value === 'true';
      opts = { ...opts, start, end, accurate };
    } else if (activeTool === 'portrait') {
      opts = { ...opts, ...window.VidLet.portrait.getOptions() };
    } else if (activeTool === 'audio') {
      if (!window.VidLetAudioTool.isLoaded()) {
        alert('Please select an audio file first');
        $('loading').classList.remove('on');
        return;
      }
      opts = { ...opts, ...window.VidLetAudioTool.getOptions() };
    } else if (activeTool === 'filter') {
      if (!window.VidLetFilterTool.hasActiveFilters()) {
        alert('No filters applied');
        $('loading').classList.remove('on');
        return;
      }
      opts = { ...opts, ...window.VidLetFilterTool.getFilterOptions() };
    } else if (activeTool === 'caption') {
      if (!window.VidLetCaptionTool.isEnabled()) {
        alert('Please select a caption file first');
        $('loading').classList.remove('on');
        return;
      }
      opts = { ...opts, ...window.VidLetCaptionTool.getOptions() };
    } else if (activeTool === 'thumb') {
      opts = { ...opts, ...window.VidLetThumbTool.getOptions() };
    }

    const res = await postJson('/api/process', opts);
    $('loading').classList.remove('on');

    if (res.success) {
      celebrate();
      $('done').classList.add('on');
      $('output').textContent = res.output || 'Processing complete!';
    } else {
      alert(`Error: ${res.error || 'Unknown error'}`);
    }
  } catch (err) {
    $('loading').classList.remove('on');
    alert(`Error: ${err.message}`);
  }
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function continueEditing() {
  $('done').classList.remove('on');
  if (!skipReloadOnContinue) {
    location.reload();
  }
  skipReloadOnContinue = false;
}

// biome-ignore lint/correctness/noUnusedVariables: Called from HTML
function openOutput() {
  VidLet.openFolder();
}

// ============ START APP ============

document.addEventListener('DOMContentLoaded', init);
