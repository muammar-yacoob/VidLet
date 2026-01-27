/**
 * VidLet App - Main application logic
 */
const { $, log, postJson, formatDuration } = VidLet;

// App state
let info = {};
let activeTool = null;
let homepage = 'https://vidlet.app';
let currentFilePath = null;
let isMkvFile = false;
let skipReloadOnContinue = false;

// Tool states
let mkvFastCopy = true;
let portraitCropX = 0.5;
let audioMix = true;

// Portrait segment state
let portraitSegments = []; // [{id, startTime, endTime, cropX}]
let selectedSegmentIndex = 0;
let portraitSegmentsInitialized = false; // Track if portrait has been initialized (to preserve on tool switch)
const SEGMENT_COLORS = [
  '#a855f7', // purple
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#84cc16', // lime
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

// Portrait keyframes for smooth crop animation: [{time, cropX}]
let portraitKeyframes = [];
let keyframeAnimationEnabled = false;

// Portrait timeline zoom state
let portraitZoom = 1;
let portraitOffset = 0; // 0-1, left edge position as fraction of duration
let audioVolume = 50;
let audioPreviewLoaded = false;

// Match markers for trim tool (loop-like functionality)
let matchMarkers = [];
let currentMatchIndex = 0;
const MATCH_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];

// Pre-initialized matches cache (from loading screen)
let preloadedMatches = null;
let preloadPromise = null;

// Player state
const MIN_SPEED = 0.5;
const MAX_SPEED = 8;
let currentSpeed = 1;
let isSeeking = false;

// Frame cache for smooth scrubbing
let frameCache = [];        // Array of {time, imageData}
let frameCacheCanvas = null;
let frameCacheCtx = null;
let frameCacheReady = false;
const FRAME_CACHE_INTERVAL = 0.25; // Cache a frame every 0.25 seconds

// Timeline zoom state
let timelineZoom = 1;
let timelineOffset = 0; // 0-1, represents the left edge position as fraction of duration
let autoZoomEnabled = false; // Auto-zoom to marker on hover (disabled by default)
let panToMarker = null; // Function to pan/zoom to current marker (set by initTimelineZoom)

// ============ UNDO/REDO SYSTEM ============
const MAX_HISTORY = 20;
let undoStack = [];
let redoStack = [];

/**
 * Get current state snapshot for undo
 */
function getStateSnapshot() {
  return {
    tool: activeTool,
    portraitSegments: JSON.parse(JSON.stringify(portraitSegments)),
    selectedSegmentIndex,
    portraitCropX,
    portraitKeyframes: JSON.parse(JSON.stringify(portraitKeyframes)),
    trimStart: $('trim-start')?.value,
    trimEnd: $('trim-end')?.value,
  };
}

/**
 * Restore state from snapshot
 */
function restoreState(snapshot) {
  if (snapshot.tool === 'portrait') {
    portraitSegments = snapshot.portraitSegments;
    selectedSegmentIndex = snapshot.selectedSegmentIndex;
    portraitCropX = snapshot.portraitCropX;
    portraitKeyframes = snapshot.portraitKeyframes;
    renderPortraitSegments();
    updateCropOverlay();
    updatePortraitUI();
    renderKeyframeMarkers();
  }
  if (snapshot.tool === 'trim') {
    if (snapshot.trimStart !== undefined) $('trim-start').value = snapshot.trimStart;
    if (snapshot.trimEnd !== undefined) $('trim-end').value = snapshot.trimEnd;
    updateTimeline();
  }
}

/**
 * Save current state to undo stack
 */
function saveUndoState() {
  const snapshot = getStateSnapshot();
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack = []; // Clear redo stack on new action
  updateUndoButtons();
}

/**
 * Undo last action
 */
function undo() {
  if (undoStack.length === 0) return;
  const current = getStateSnapshot();
  redoStack.push(current);
  const previous = undoStack.pop();
  restoreState(previous);
  updateUndoButtons();
  showToast('Undo');
}

/**
 * Redo last undone action
 */
function redo() {
  if (redoStack.length === 0) return;
  const current = getStateSnapshot();
  undoStack.push(current);
  const next = redoStack.pop();
  restoreState(next);
  updateUndoButtons();
  showToast('Redo');
}

/**
 * Update undo/redo button states
 */
function updateUndoButtons() {
  const undoBtn = $('undo-btn');
  const redoBtn = $('redo-btn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// Hotkey presets - maps action names to key bindings
let currentHotkeyPreset = 'premiere';
const HOTKEY_PRESETS = {
  premiere: {
    name: 'Adobe Premiere',
    split: { key: 'KeyK', ctrl: true },
    delete: { key: 'Delete' },
    rippleDelete: { key: 'Delete', shift: true },
    selectPrev: { key: 'BracketLeft' },
    selectNext: { key: 'BracketRight' },
    markIn: { key: 'KeyI' },
    markOut: { key: 'KeyO' },
  },
  resolve: {
    name: 'DaVinci Resolve',
    split: { key: 'KeyB', ctrl: true },
    delete: { key: 'Backspace' },
    rippleDelete: { key: 'Backspace', shift: true },
    selectPrev: { key: 'ArrowUp' },
    selectNext: { key: 'ArrowDown' },
    markIn: { key: 'KeyI' },
    markOut: { key: 'KeyO' },
  },
  capcut: {
    name: 'CapCut',
    split: { key: 'KeyB', ctrl: true },
    delete: { key: 'Delete' },
    rippleDelete: { key: 'Delete' },
    selectPrev: { key: 'ArrowUp' },
    selectNext: { key: 'ArrowDown' },
    markIn: { key: 'BracketLeft' },
    markOut: { key: 'BracketRight' },
  },
  shotcut: {
    name: 'Shotcut',
    split: { key: 'KeyS' },
    delete: { key: 'KeyX' },
    rippleDelete: { key: 'KeyZ' },
    selectPrev: { key: 'BracketLeft' },
    selectNext: { key: 'BracketRight' },
    markIn: { key: 'KeyI' },
    markOut: { key: 'KeyO' },
  },
  descript: {
    name: 'Descript',
    split: { key: 'KeyK', ctrl: true },
    delete: { key: 'Backspace' },
    rippleDelete: { key: 'Backspace' },
    selectPrev: { key: 'BracketLeft', ctrl: true },
    selectNext: { key: 'BracketRight', ctrl: true },
    markIn: { key: 'KeyI' },
    markOut: { key: 'KeyO' },
  },
  camtasia: {
    name: 'Camtasia',
    split: { key: 'KeyS', ctrl: true },
    delete: { key: 'Delete' },
    rippleDelete: { key: 'Delete', ctrl: true },
    selectPrev: { key: 'PageUp' },
    selectNext: { key: 'PageDown' },
    markIn: { key: 'KeyI' },
    markOut: { key: 'KeyO' },
  },
};

/** Check if keyboard event matches a hotkey binding */
function matchesHotkey(event, binding) {
  if (!binding) return false;
  const ctrlMatch = binding.ctrl ? (event.ctrlKey || event.metaKey) : !(event.ctrlKey || event.metaKey);
  const shiftMatch = binding.shift ? event.shiftKey : !event.shiftKey;
  const altMatch = binding.alt ? event.altKey : !event.altKey;
  return event.code === binding.key && ctrlMatch && shiftMatch && altMatch;
}

/** Format a hotkey binding for display */
function formatHotkey(binding) {
  if (!binding) return '';
  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  let keyName = binding.key
    .replace('Key', '')
    .replace('Arrow', '')
    .replace('Bracket', '')
    .replace('Left', '[')
    .replace('Right', ']');
  if (keyName === 'Space') keyName = 'Space';
  else if (keyName === 'Delete') keyName = 'Del';
  else if (keyName === 'Backspace') keyName = 'Bksp';
  else if (keyName === 'PageUp') keyName = 'PgUp';
  else if (keyName === 'PageDown') keyName = 'PgDn';
  parts.push(keyName);
  return parts.join('+');
}

/** Get current hotkey map */
function getHotkeyMap() {
  return HOTKEY_PRESETS[currentHotkeyPreset] || HOTKEY_PRESETS.premiere;
}

/** Set hotkey preset and update UI */
function setHotkeyPreset(preset) {
  if (!HOTKEY_PRESETS[preset]) return;
  currentHotkeyPreset = preset;
  updateHotkeyDisplay();
  updatePlayerHotkeyHint();
  // Save to config
  saveSettings();
}

/** Update hotkey display in settings */
function updateHotkeyDisplay() {
  const map = getHotkeyMap();
  const markInEl = $('hk-markIn');
  const markOutEl = $('hk-markOut');
  const splitEl = $('hk-split');
  const deleteEl = $('hk-delete');
  const rippleEl = $('hk-ripple');
  if (markInEl) markInEl.innerHTML = `<b>${formatHotkey(map.markIn)}</b> Set In`;
  if (markOutEl) markOutEl.innerHTML = `<b>${formatHotkey(map.markOut)}</b> Set Out`;
  if (splitEl) splitEl.innerHTML = `<b>${formatHotkey(map.split)}</b> Split`;
  if (deleteEl) deleteEl.innerHTML = `<b>${formatHotkey(map.delete)}</b> Delete`;
  if (rippleEl) rippleEl.innerHTML = `<b>${formatHotkey(map.rippleDelete)}</b> Ripple Del`;
}

// Quality presets
const gifPresets = {
  low: { fps: 10, width: 320, dither: 'none' },
  medium: { fps: 15, width: 480, dither: 'floyd_steinberg' },
  high: { fps: 24, width: 640, dither: 'floyd_steinberg' }
};

// ============ INITIALIZATION ============

async function init() {
  const res = await VidLet.fetchJson('/api/info');
  info = res;
  currentFilePath = res.filePath;
  updateFileDisplay();

  const video = $('videoPreview');
  video.src = '/api/video';

  if (res.width && res.height) {
    VidLet.resizeToVideo(res.width, res.height);
  }

  // Initialize sliders
  // Shrink slider: min is duration/10 (10x max speed), max is full duration
  const shrinkMin = Math.max(1, Math.ceil(res.duration / 10));
  $('shrink-duration').min = shrinkMin;
  $('shrink-duration').max = Math.floor(res.duration);
  $('shrink-duration').value = Math.min(60, Math.max(shrinkMin, Math.floor(res.duration)));
  updateShrinkLabel();

  // Hide 60s button if video <= 60s or if 60s is below min (10x limit)
  const show60s = res.duration > 60 && 60 >= shrinkMin;
  $('shrink-60-btn').classList.toggle('hidden', !show60s);
  $('shrink-marker-60').classList.toggle('hidden', !show60s);

  // Show Find Match button only for short videos (<60s)
  const isShortVideo = res.duration <= 60;
  $('find-match-btn').classList.toggle('hidden', !isShortVideo);

  // Auto-find best loop start for short videos
  if (isShortVideo) {
    // Find best loop start in first 5 seconds, then preload additional matches
    findBestLoopStart().then(() => {
      preloadPromise = preloadMatches();
    });
  }

  if (res.defaults?.homepage) {
    homepage = res.defaults.homepage;
    $('homepageLink').textContent = homepage.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // Load hotkey preset
  if (res.defaults?.hotkeyPreset && HOTKEY_PRESETS[res.defaults.hotkeyPreset]) {
    currentHotkeyPreset = res.defaults.hotkeyPreset;
    updateHotkeyDisplay();
  }

  // Handle MKV files - show converter, disable other tools
  isMkvFile = res.defaults?.isMkv || false;
  $('t-mkv2mp4').classList.toggle('hidden', !isMkvFile);

  // Show Portrait for all videos except 9:16 (already portrait)
  const aspectRatio = res.width / res.height;
  const isAlreadyPortrait = Math.abs(aspectRatio - 9/16) < 0.05;
  $('t-portrait').classList.toggle('hidden', isAlreadyPortrait);

  // Hide GIF export for long videos (>15s), show badge if available
  const canExportGif = res.duration <= 15;
  $('t-togif').classList.toggle('hidden', !canExportGif);
  if (canExportGif) {
    showGifBadge();
  }

  // Initialize trim timeline with visible default boundaries
  // Set start at 10% and end at 90% so handles are easy to see and grab
  const trimStart = Math.min(res.duration * 0.1, 5); // 10% or max 5s
  const trimEnd = Math.max(res.duration * 0.9, res.duration - 5); // 90% or at least 5s from end
  $('trim-start').value = trimStart.toFixed(2);
  $('trim-end').value = Math.max(trimEnd, trimStart + 1).toFixed(2); // Ensure at least 1s range
  updateTimeline();
  initTimelineHandles();
  initTimelineZoom();

  initCropOverlay();
  initPlayerControls();
  initResizeDivider();
  initDropZones();
  initVideoZoom();
  initCaptionTool();
  setupAudioPreviewSync();
  updateThumbAspectRatio();

  updateCompressLabels();
  const defaultPresets = getCompressPresets();
  $('compress-bitrate').value = defaultPresets.medium.bitrate;
  updateEstimates();

  // Prevent page zoom except on video player
  initPageZoomLock();

  // Select first tool (mkv2mp4 for MKV files, otherwise first available)
  if (isMkvFile) {
    selectTool('mkv2mp4');
  } else {
    const firstTool = document.querySelector('.tool:not(.hidden):not(.disabled)');
    if (firstTool) {
      selectTool(firstTool.id.replace('t-', ''));
    }
  }

  // Signal ready after window is fully rendered
  signalAppReady();
}

/**
 * Signal that app is ready - only signals when frame cache reaches 30%
 * The loading HTA waits for this signal before closing
 */
function signalAppReady() {
  const video = $('videoPreview');
  let signaled = false;

  // Send the ready signal to close the loading HTA
  const doSignal = () => {
    if (signaled) return;
    signaled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        postJson('/api/ready', {});
      });
    });
  };

  // Show progress UI and start caching
  const startCaching = () => {
    // Show progress bar in main app
    const progressEl = $('cache-progress');
    if (progressEl) {
      progressEl.style.display = 'flex';
      $('cache-progress-label').textContent = 'Caching frames...';
      $('cache-progress-fill').style.width = '0%';
      $('cache-progress-pct').textContent = '0%';
    }

    // If already cached, signal immediately
    if (frameCacheReady && frameCache.length > 0) {
      postJson('/api/progress', { percent: 100 });
      doSignal();
      return;
    }

    // Start frame cache in background
    // Progress is sent to loading HTA, signal at 30%
    buildFrameCache((pct) => {
      // Always send progress to loading HTA
      postJson('/api/progress', { percent: pct });
      // Signal ready when 30% cached (loading HTA will close)
      if (pct >= 30) {
        doSignal();
      }
    });
  };

  // Wait for video to be ready before starting cache
  const waitForVideo = () => {
    if (video && video.readyState >= 2 && video.duration > 0) {
      startCaching();
    } else if (video) {
      // Send initial progress to show loading HTA we're working
      postJson('/api/progress', { percent: 0 });
      video.addEventListener('canplay', () => {
        if (video.duration > 0) {
          startCaching();
        } else {
          // No valid duration, signal anyway after delay
          setTimeout(doSignal, 2000);
        }
      }, { once: true });
    } else {
      // No video element, signal after delay
      setTimeout(doSignal, 2000);
    }
  };

  // Start once DOM is ready
  if (document.readyState === 'complete') {
    waitForVideo();
  } else {
    window.addEventListener('load', waitForVideo, { once: true });
  }

  // Fallback: if nothing works after 30 seconds, signal anyway
  setTimeout(() => {
    if (!signaled) {
      console.warn('Fallback signal triggered - caching may have failed');
      doSignal();
    }
  }, 30000);
}

function updateFileDisplay() {
  $('fileName').textContent = ' ' + info.fileName;
  $('resolution').textContent = ' ' + `${info.width.toLocaleString()}×${info.height.toLocaleString()}`;
  $('aspectRatio').textContent = ' ' + getAspectRatioLabel(info.width, info.height);
  $('fileSize').textContent = ' ' + formatFileSize(info.fileSize);
  $('duration').textContent = ' ' + formatDuration(info.duration);
  $('fps').textContent = ' ' + (info.fps ? info.fps.toFixed(1) : '-');
}

function getAspectRatioLabel(width, height) {
  if (!width || !height) return '-';
  const ratio = width / height;
  // Common aspect ratios
  if (Math.abs(ratio - 16/9) < 0.05) return '16:9';
  if (Math.abs(ratio - 9/16) < 0.05) return '9:16';
  if (Math.abs(ratio - 4/3) < 0.05) return '4:3';
  if (Math.abs(ratio - 3/4) < 0.05) return '3:4';
  if (Math.abs(ratio - 21/9) < 0.05) return '21:9';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 3/2) < 0.05) return '3:2';
  if (Math.abs(ratio - 2/3) < 0.05) return '2:3';
  // Calculate simplified ratio
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  if (w <= 100 && h <= 100) return `${w}:${h}`;
  return ratio.toFixed(2);
}

function formatFileSize(bytes) {
  if (!bytes) return '-';
  const formatNum = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (bytes < 1024) return formatNum(bytes) + ' B';
  if (bytes < 1024 * 1024) return formatNum(bytes / 1024) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return formatNum(bytes / (1024 * 1024)) + ' MB';
  return formatNum(bytes / (1024 * 1024 * 1024)) + ' GB';
}

// ============ TOOL SELECTION ============

function selectTool(id) {
  if (activeTool === 'audio' && id !== 'audio') {
    stopAudioPreview();
  }
  if (activeTool === 'filter' && id !== 'filter') {
    clearFilterPreview();
  }

  document.querySelectorAll('.tool').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.opts').forEach(o => o.classList.remove('active'));
  $('mkv-notice').classList.remove('active');

  const el = $('t-' + id);
  const opts = $('opts-' + id);

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

    if (id === 'portrait') {
      $('cropOverlay').classList.add('active');
      initPortraitSegments();
      updateCropOverlay();
      updateTransitionUI();
    }

    if (id === 'trim') {
      const video = $('videoPreview');
      video.currentTime = parseFloat($('trim-start').value) || 0;
    }

    if (id === 'audio') {
      startAudioPreview();
      updateVolumeUI();
    }

    if (id === 'togif') {
      hideGifBadge();
    }

    if (id === 'thumb') {
      initThumbTool();
    }

    if (id === 'filter') {
      applyFilterPreview();
    }

    if (id === 'caption') {
      $('captionOverlay').classList.remove('hidden');
      updateCaptionPreview();
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

  // Base hints (always shown)
  const baseHints = 'Space: Play | ←→: 5s | Alt+←→: Frame | M: Mute';

  // Tool-specific hints
  let toolHints = '';
  const hotkeys = HOTKEY_PRESETS[currentHotkeyPreset] || HOTKEY_PRESETS.premiere;

  if (activeTool === 'portrait') {
    toolHints = ` | ${formatHotkey(hotkeys.split)}: Split | ${formatHotkey(hotkeys.delete)}: Del`;
  } else if (activeTool === 'trim') {
    toolHints = ` | ${formatHotkey(hotkeys.markIn)}: Set In | ${formatHotkey(hotkeys.markOut)}: Set Out`;
  }

  hint.textContent = baseHints + toolHints;
}

// ============ SETTINGS MODAL ============

function openSettings() {
  document.querySelectorAll('.seg-btns').forEach(group => {
    group.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
  });

  const preset = $('compress-preset').value;
  const presetMap = { ultrafast: 'fast', superfast: 'fast', veryfast: 'fast', faster: 'fast', fast: 'fast', medium: 'medium', slow: 'slow', slower: 'slow', veryslow: 'slow' };
  setSegBtn('settingsCompressQuality', presetMap[preset] || 'medium');
  setSegBtn('settingsGifFps', $('togif-fps').value);
  setSegBtn('settingsGifWidth', $('togif-width').value);
  setSegBtn('settingsMkvQuality', $('mkv2mp4-quality').value);
  setSegBtn('settingsTrimMode', $('trim-accurate').value === 'true' ? 'accurate' : 'fast');

  // Hotkey preset
  const hotkeySelect = $('settingsHotkeyPreset');
  if (hotkeySelect) hotkeySelect.value = currentHotkeyPreset;
  updateHotkeyDisplay();

  $('settingsModal').classList.add('on');
}

function closeSettings() {
  // Compress settings
  const qualityPresetMap = { fast: 'veryfast', medium: 'medium', slow: 'slow' };
  const bitrateMap = { fast: 0.3, medium: 0.5, slow: 0.7 };
  const quality = getSegVal('settingsCompressQuality');
  $('compress-preset').value = qualityPresetMap[quality] || 'medium';
  // Update bitrate based on quality preset
  const origBitrate = info.bitrate || 5000;
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

  // Update all estimates
  updateEstimates();
  updateCompressLabels();

  $('settingsModal').classList.remove('on');

  // Save settings to server
  saveSettings();
}

/** Save app settings to config file */
async function saveSettings() {
  try {
    await postJson('/api/save-settings', {
      hotkeyPreset: currentHotkeyPreset,
    });
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

// ============ EXTRACT AUDIO MODAL ============

function openExtractAudioModal() {
  $('extractAudioModal').classList.add('on');
}

function closeExtractAudioModal() {
  $('extractAudioModal').classList.remove('on');
}

async function extractAudio() {
  closeExtractAudioModal();

  $('loading').classList.add('on');
  $('loading').querySelector('span').textContent = 'Extracting audio...';

  const opts = {
    tool: 'extractaudio',
    audioFormat: $('extract-audio-format').value || 'mp3',
    audioBitrate: parseInt($('extract-audio-bitrate').value) || 192
  };

  try {
    const res = await postJson('/api/process', opts);
    $('loading').classList.remove('on');

    if (res.success) {
      $('done').classList.add('on');
      $('output').textContent = res.output || 'Audio extracted!';
    } else {
      alert('Error: ' + (res.error || 'Unknown error'));
    }
  } catch (err) {
    $('loading').classList.remove('on');
    alert('Error: ' + err.message);
  }
}

function setSegBtn(groupId, val) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
}

function setSegBtnClosest(groupId, numVal) {
  const group = $(groupId);
  if (!group) return;
  const buttons = Array.from(group.querySelectorAll('button'));
  let closest = buttons[0];
  let minDiff = Infinity;
  buttons.forEach(b => {
    const diff = Math.abs(parseFloat(b.dataset.val) - numVal);
    if (diff < minDiff) {
      minDiff = diff;
      closest = b;
    }
  });
  buttons.forEach(b => b.classList.remove('active'));
  if (closest) closest.classList.add('active');
}

function getSegVal(groupId) {
  const group = $(groupId);
  if (!group) return null;
  const active = group.querySelector('button.active');
  return active ? active.dataset.val : null;
}

function openHomepage() {
  VidLet.openUrl(homepage);
}

// ============ QUALITY PRESETS ============

function getCompressPresets() {
  const origBitrate = info.bitrate || 5000;
  return {
    low: { bitrate: Math.round(origBitrate * 0.3), preset: 'veryfast', label: '~30%' },
    medium: { bitrate: Math.round(origBitrate * 0.5), preset: 'medium', label: '~50%' },
    high: { bitrate: Math.round(origBitrate * 0.7), preset: 'slow', label: '~70%' }
  };
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function updateCompressLabels() {
  const presets = getCompressPresets();
  const btns = document.querySelectorAll('#opts-compress .preset-btn');
  const labels = ['Small', 'Balanced', 'Quality'];
  const keys = ['low', 'medium', 'high'];
  btns.forEach((btn, i) => {
    const p = presets[keys[i]];
    btn.textContent = `${labels[i]} (${p.label})`;
  });
}

function updateEstimates() {
  const duration = info.duration || 60;
  const origBitrate = info.bitrate || 5000;

  const bitrate = parseInt($('compress-bitrate').value) || 2500;
  const compressSize = (bitrate * 1000 * duration) / 8;
  const reduction = origBitrate > 0 ? Math.round((1 - bitrate / origBitrate) * 100) : 0;
  $('compress-estimate').textContent = `Est: ~${formatSize(compressSize)} (${reduction}% smaller)`;

  const gifFps = parseInt($('togif-fps').value) || 15;
  const gifWidth = parseInt($('togif-width').value) || 480;
  const frames = gifFps * duration;
  const bytesPerFrame = (gifWidth / 480) * 15000;
  const gifSize = frames * bytesPerFrame;
  $('togif-estimate').textContent = `Est. output: ~${formatSize(gifSize)} (varies)`;

  const targetDuration = parseFloat($('shrink-duration').value) || 60;
  const speedMultiplier = (duration / targetDuration).toFixed(1);
  const isAtLimit = parseFloat(speedMultiplier) >= 9.9;
  $('shrink-estimate').textContent = isAtLimit
    ? `Speed: ${speedMultiplier}x (max)`
    : `Speed: ${speedMultiplier}x faster`;
}

function setCompressQuality(level) {
  const presets = getCompressPresets();
  const p = presets[level];
  $('compress-bitrate').value = p.bitrate;
  $('compress-preset').value = p.preset;
  document.querySelectorAll('#opts-compress .preset-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  updateEstimates();
}

function setGifQuality(level) {
  const p = gifPresets[level];
  $('togif-fps').value = p.fps;
  $('togif-width').value = p.width;
  $('togif-dither').value = p.dither;
  document.querySelectorAll('#opts-togif .preset-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  updateEstimates();
}

function setAudioFormat(format) {
  $('extract-audio-format').value = format;
  document.querySelectorAll('#audio-format-btns .seg-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#audio-format-btns [data-val="${format}"]`).classList.add('active');
  // Hide bitrate for lossless formats
  const bitrateRow = $('audio-bitrate-row');
  if (bitrateRow) {
    bitrateRow.style.display = (format === 'wav' || format === 'flac') ? 'none' : 'flex';
  }
}

function setAudioBitrate(bitrate) {
  $('extract-audio-bitrate').value = bitrate;
  document.querySelectorAll('#audio-bitrate-btns .seg-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#audio-bitrate-btns [data-val="${bitrate}"]`).classList.add('active');
}

function setMkvMode(mode) {
  mkvFastCopy = mode === 'fast';
  $('mkv2mp4-quality').value = mkvFastCopy ? 23 : 20;
  $('mkv-fast').classList.toggle('active', mkvFastCopy);
  $('mkv-compat').classList.toggle('active', !mkvFastCopy);
}

// ============ SHRINK ============

function updateShrinkLabel() {
  const val = parseFloat($('shrink-duration').value);
  $('shrink-val').textContent = (val % 1 === 0 ? val : val.toFixed(1)) + 's';
  updateEstimates();
  updateShrinkMarker();
  updateFeatureHints('shrink', val);
}

function updateShrinkMarker() {
  const slider = $('shrink-duration');
  const marker = $('shrink-marker-60');
  const min = parseInt(slider.min) || 10;
  const max = parseInt(slider.max) || 300;

  if (60 >= min && 60 <= max) {
    const pct = ((60 - min) / (max - min)) * 100;
    marker.style.left = `calc(${pct}% - 1px)`;
    marker.style.display = 'block';
  } else {
    marker.style.display = 'none';
  }
}

/**
 * Update feature unlock hints based on output duration
 */
function updateFeatureHints(tool, outputDuration) {
  const hintEl = $(tool + '-unlock-hint');
  if (!hintEl) return;

  const loopUnlocked = outputDuration <= 60;
  const gifUnlocked = outputDuration <= 15;

  const hintItems = hintEl.querySelectorAll('.hint-item');
  hintItems.forEach(item => {
    const text = item.textContent;
    if (text.includes('60s') || text.includes('Loop')) {
      item.classList.toggle('unlocked', loopUnlocked);
    } else if (text.includes('15s') || text.includes('GIF')) {
      item.classList.toggle('unlocked', gifUnlocked);
    }
  });
}

function setShrinkTo60() {
  const slider = $('shrink-duration');
  const min = parseFloat(slider.min) || 10;
  const max = parseFloat(slider.max) || 300;
  if (60 >= min && 60 <= max) {
    slider.value = 60;
    updateShrinkLabel();
  }
}

// ============ TIMELINE (TRIM) ============

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + s.toString().padStart(2, '0');
}

function formatTimeMs(sec) {
  if (!sec || isNaN(sec)) return '0:00.0';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return m + ':' + s.toString().padStart(2, '0') + '.' + ms;
}

function updateTimeline() {
  const duration = info.duration || 10;
  const start = parseFloat($('trim-start').value) || 0;
  const end = parseFloat($('trim-end').value) || duration;

  // Calculate positions based on zoom and offset
  const visibleDuration = duration / timelineZoom;
  const visibleStart = timelineOffset * duration;
  const visibleEnd = visibleStart + visibleDuration;

  // Timeline element width scales with zoom
  const timeline = $('timeline');
  timeline.style.width = (timelineZoom * 100) + '%';
  // translateX percentage is relative to element's own width, so no need to multiply by zoom
  timeline.style.transform = `translateX(${-timelineOffset * 100}%)`;

  // Position handles and range (as percentage of full duration)
  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  // Clamp handle positions to stay visible (handles are ~5px wide, need ~1% padding at edges)
  const handlePadding = 1; // percentage
  const startHandlePct = Math.max(handlePadding, startPct);
  const endHandlePct = Math.min(100 - handlePadding, endPct);

  $('timeline-range').style.left = startPct + '%';
  $('timeline-range').style.width = (endPct - startPct) + '%';
  $('handle-start').style.left = startHandlePct + '%';
  $('handle-end').style.left = endHandlePct + '%';

  // Position dim overlays (unselected areas)
  $('timeline-dim-left').style.width = startPct + '%';
  $('timeline-dim-right').style.left = endPct + '%';
  $('timeline-dim-right').style.width = (100 - endPct) + '%';

  // Update info badges
  const outputDuration = Math.max(0, end - start);
  $('trim-start-badge').textContent = formatTimeMs(start);
  $('trim-end-badge').textContent = formatTimeMs(end);
  $('trim-duration-badge').textContent = outputDuration.toFixed(1) + 's';

  // Update feature hints based on output duration
  updateFeatureHints('trim', outputDuration);

  // Update ticks
  renderTimelineTicks();
}

function renderTimelineTicks() {
  const container = $('timeline-ticks');
  container.innerHTML = '';
  const duration = info.duration || 10;

  // Calculate visible range
  const visibleDuration = duration / timelineZoom;
  const visibleStart = timelineOffset * duration;
  const visibleEnd = visibleStart + visibleDuration;

  // Determine tick interval based on zoom level and duration
  let interval;
  if (visibleDuration <= 5) interval = 0.5;
  else if (visibleDuration <= 15) interval = 1;
  else if (visibleDuration <= 30) interval = 2;
  else if (visibleDuration <= 60) interval = 5;
  else if (visibleDuration <= 120) interval = 10;
  else interval = 30;

  const majorEvery = visibleDuration <= 30 ? 5 : 10;

  // Generate ticks
  const startTick = Math.floor(visibleStart / interval) * interval;
  for (let t = startTick; t <= visibleEnd + interval; t += interval) {
    if (t < 0 || t > duration) continue;

    const pct = ((t - visibleStart) / visibleDuration) * 100;
    if (pct < -5 || pct > 105) continue;

    const tick = document.createElement('div');
    tick.className = 'timeline-tick' + (t % majorEvery === 0 ? ' major' : '');
    tick.style.left = pct + '%';

    const line = document.createElement('div');
    line.className = 'timeline-tick-line';
    tick.appendChild(line);

    if (t % majorEvery === 0 || interval >= 5) {
      const label = document.createElement('div');
      label.className = 'timeline-tick-label';
      label.textContent = formatTime(t);
      tick.appendChild(label);
    }

    container.appendChild(tick);
  }
}

function updatePlayhead() {
  const video = $('videoPreview');
  const playhead = $('timeline-playhead');
  if (!video.duration || !playhead) return;

  const pct = (video.currentTime / info.duration) * 100;
  playhead.style.left = pct + '%';
}

// ============ FRAME CACHE FOR SMOOTH SCRUBBING ============

/**
 * Build frame cache for smooth scrubbing preview
 * Uses a hidden video element to avoid blocking the main player
 * @param {function} onProgress - Optional callback called with progress (0-100)
 */
async function buildFrameCache(onProgress) {
  const mainVideo = $('videoPreview');

  // Send initial progress immediately
  if (onProgress) onProgress(0);

  // Validate video is ready
  if (!mainVideo || !mainVideo.duration || mainVideo.duration <= 0) {
    console.warn('buildFrameCache: Video not ready or no duration');
    if (onProgress) onProgress(100); // Signal complete to close loading window
    return;
  }

  // Don't cache twice
  if (frameCacheReady || frameCache.length > 0) {
    if (onProgress) onProgress(100);
    return;
  }

  // Create hidden video element for background caching
  const cacheVideo = document.createElement('video');
  cacheVideo.src = mainVideo.src;
  cacheVideo.muted = true;
  cacheVideo.preload = 'auto';
  cacheVideo.style.display = 'none';
  document.body.appendChild(cacheVideo);

  // Wait for video to be ready
  await new Promise(resolve => {
    cacheVideo.addEventListener('loadeddata', resolve, { once: true });
    cacheVideo.load();
  });

  // Create offscreen canvas for frame extraction
  frameCacheCanvas = document.createElement('canvas');
  const scale = 0.5; // Cache at half resolution for memory efficiency
  frameCacheCanvas.width = cacheVideo.videoWidth * scale;
  frameCacheCanvas.height = cacheVideo.videoHeight * scale;
  frameCacheCtx = frameCacheCanvas.getContext('2d', { willReadFrequently: true });

  frameCache = [];
  const duration = cacheVideo.duration;
  const frameCount = Math.ceil(duration / FRAME_CACHE_INTERVAL);

  // Show caching progress
  const progressEl = $('cache-progress');
  const progressFill = $('cache-progress-fill');
  const progressPct = $('cache-progress-pct');
  if (progressEl) progressEl.style.display = 'flex';

  // Track last reported progress to avoid redundant updates
  let lastReportedPct = 0;

  for (let i = 0; i <= frameCount; i++) {
    const time = Math.min(i * FRAME_CACHE_INTERVAL, duration);

    await new Promise(resolve => {
      const onSeeked = () => {
        cacheVideo.removeEventListener('seeked', onSeeked);
        // Draw frame to canvas
        frameCacheCtx.drawImage(cacheVideo, 0, 0, frameCacheCanvas.width, frameCacheCanvas.height);
        // Store as data URL for quick access
        frameCache.push({
          time,
          dataUrl: frameCacheCanvas.toDataURL('image/jpeg', 0.7)
        });
        resolve();
      };
      cacheVideo.addEventListener('seeked', onSeeked);
      cacheVideo.currentTime = time;
    });

    // Calculate progress percentage
    const pct = Math.round((i / frameCount) * 100);

    // Update UI every 2 frames or at key thresholds (10%, 20%, 30%, etc.)
    const isKeyThreshold = pct >= lastReportedPct + 10;
    if (i % 2 === 0 || isKeyThreshold) {
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressPct) progressPct.textContent = `${pct}%`;
      if (onProgress && pct > lastReportedPct) {
        onProgress(pct);
        lastReportedPct = pct;
      }
    }

    // Yield to allow UI updates
    if (i % 4 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Cleanup
  cacheVideo.remove();
  frameCacheReady = true;
  if (progressEl) progressEl.style.display = 'none';

  // Signal 100% complete
  if (onProgress) onProgress(100);

  console.log(`Frame cache ready: ${frameCache.length} frames`);
}

/**
 * Get cached frame closest to given time
 */
function getCachedFrame(time) {
  if (!frameCacheReady || frameCache.length === 0) return null;

  // Binary search for closest frame
  let left = 0;
  let right = frameCache.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (frameCache[mid].time < time) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Check if previous frame is closer
  if (left > 0 && Math.abs(frameCache[left - 1].time - time) < Math.abs(frameCache[left].time - time)) {
    left--;
  }

  return frameCache[left];
}

/**
 * Show scrub overlay with cached frame
 */
function showScrubFrame(time) {
  const overlay = $('scrub-overlay');
  const img = $('scrub-frame');
  if (!overlay || !img) return;

  const frame = getCachedFrame(time);
  if (frame) {
    img.src = frame.dataUrl;
    overlay.style.display = 'block';
  }
}

/**
 * Hide scrub overlay
 */
function hideScrubFrame() {
  const overlay = $('scrub-overlay');
  if (overlay) overlay.style.display = 'none';
}

function toggleAutoZoom() {
  autoZoomEnabled = !autoZoomEnabled;
  $('auto-zoom-btn').classList.toggle('active', autoZoomEnabled);
}

function initTimelineZoom() {
  const viewport = $('timeline-viewport');
  const timelineWrap = $('trim-controls');
  const timeline = $('timeline');
  let isHovered = false;
  let manualZoom = false; // Track if user manually zoomed with wheel

  // Enable CSS transitions for smooth zoom animation
  function enableTransition() {
    timeline.style.transition = 'transform 0.25s ease-out, width 0.25s ease-out';
  }
  function disableTransition() {
    timeline.style.transition = 'none';
  }

  // Zoom to show selected marker when hovered
  function zoomToMarker() {
    if (!autoZoomEnabled || matchMarkers.length === 0 || manualZoom) return;

    const duration = info.duration || 1;
    const marker = matchMarkers[currentMatchIndex];
    if (!marker) return;

    const markerPosition = marker.time / duration;
    const autoZoom = 3; // Auto-zoom level for hover

    enableTransition();
    timelineZoom = autoZoom;
    const visibleFraction = 1 / timelineZoom;
    // Center the marker in viewport
    timelineOffset = Math.max(0, Math.min(1 - visibleFraction, markerPosition - visibleFraction * 0.5));
    viewport.classList.add('zoomed');
    updateTimeline();
    renderMatchMarkers();
  }

  // Zoom out to full view
  function zoomOutFull() {
    if (!autoZoomEnabled || manualZoom) return;

    enableTransition();
    timelineZoom = 1;
    timelineOffset = 0;
    viewport.classList.remove('zoomed');
    updateTimeline();
    renderMatchMarkers();
    // Clear transition after animation
    setTimeout(disableTransition, 250);
  }

  // Auto-zoom on hover (only when enabled, markers exist, and not manually zoomed)
  viewport.addEventListener('mouseenter', () => {
    isHovered = true;
    if (autoZoomEnabled && matchMarkers.length > 0 && !manualZoom) {
      zoomToMarker();
    }
  });

  viewport.addEventListener('mouseleave', () => {
    isHovered = false;
    if (autoZoomEnabled && !manualZoom) {
      zoomOutFull();
    }
  });

  // Attach wheel to timelineWrap so scrolling on ticks also zooms
  timelineWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    disableTransition();
    manualZoom = true; // User took control

    const rect = viewport.getBoundingClientRect();
    const duration = info.duration || 1;

    // Get cursor position as fraction of viewport (0-1)
    const cursorViewportPct = (e.clientX - rect.left) / rect.width;

    // Convert cursor position to time position (accounting for current zoom/offset)
    const visibleDuration = duration / timelineZoom;
    const visibleStart = timelineOffset * duration;
    const cursorTime = visibleStart + cursorViewportPct * visibleDuration;
    const cursorPosition = cursorTime / duration; // 0-1 position in full timeline

    // Zoom in/out
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    timelineZoom = Math.max(1, Math.min(10, timelineZoom + delta * timelineZoom));

    if (timelineZoom === 1) {
      timelineOffset = 0;
      viewport.classList.remove('zoomed');
      manualZoom = false; // Reset manual control when fully zoomed out
    } else {
      // Adjust offset to keep cursor position stable
      const visibleAfter = 1 / timelineZoom;
      timelineOffset = Math.max(0, Math.min(1 - visibleAfter, cursorPosition - cursorViewportPct * visibleAfter));
      viewport.classList.add('zoomed');
    }

    updateTimeline();
    renderMatchMarkers();
  }, { passive: false });

  // Pan with middle mouse, shift+drag, or left-click drag when zoomed
  let isPanning = false;
  let panStartX = 0;
  let panStartOffset = 0;

  viewport.addEventListener('mousedown', (e) => {
    // Allow panning with: middle mouse, shift+left, or left-click when zoomed (not on handles)
    const isHandle = e.target.classList.contains('timeline-handle');
    const canPan = e.button === 1 || (e.button === 0 && e.shiftKey) ||
                   (e.button === 0 && timelineZoom > 1 && !isHandle);

    if (canPan) {
      e.preventDefault();
      disableTransition();
      manualZoom = true;
      isPanning = true;
      panStartX = e.clientX;
      panStartOffset = timelineOffset;
      viewport.classList.add('panning');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const rect = viewport.getBoundingClientRect();
    const dx = (e.clientX - panStartX) / rect.width;
    const visibleFraction = 1 / timelineZoom;
    timelineOffset = Math.max(0, Math.min(1 - visibleFraction, panStartOffset - dx * visibleFraction));
    updateTimeline();
    renderMatchMarkers();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove('panning');
    }
  });
}

function initTimelineHandles() {
  const viewport = $('timeline-viewport');
  const handleStart = $('handle-start');
  const handleEnd = $('handle-end');
  let dragging = null;

  function onMouseMove(e) {
    if (!dragging) return;
    const rect = viewport.getBoundingClientRect();
    const viewportPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // Convert viewport position to time, accounting for zoom and offset
    const visibleDuration = info.duration / timelineZoom;
    const visibleStart = timelineOffset * info.duration;
    let time = visibleStart + viewportPct * visibleDuration;
    time = Math.max(0, Math.min(info.duration, time));

    const video = $('videoPreview');

    // Snap to match markers (with zoom-aware threshold)
    if (dragging === 'end' && matchMarkers.length > 0) {
      const snapThreshold = visibleDuration * 0.02; // 2% of visible duration
      for (const marker of matchMarkers) {
        if (Math.abs(time - marker.time) < snapThreshold) {
          time = marker.time;
          break;
        }
      }
    }

    if (dragging === 'start') {
      const endVal = parseFloat($('trim-end').value);
      const maxStart = Math.max(0, endVal - 0.1);
      const newStart = Math.max(0, Math.min(time, maxStart));
      $('trim-start').value = newStart.toFixed(2);
      video.currentTime = newStart;
      clearMatchMarkers(); // Clear markers when start changes
      hideNoMatchesMessage();
    } else {
      const startVal = parseFloat($('trim-start').value);
      const minEnd = startVal + 0.1;
      const newEnd = Math.min(info.duration, Math.max(time, minEnd));
      $('trim-end').value = newEnd.toFixed(2);
      video.currentTime = Math.max(0, newEnd - 0.5);
      hideNoMatchesMessage();
    }
    updateTimeline();
  }

  function onMouseUp() {
    if (dragging) {
      (dragging === 'start' ? handleStart : handleEnd).classList.remove('dragging');
      dragging = null;
    }
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  ['start', 'end'].forEach(type => {
    const handle = type === 'start' ? handleStart : handleEnd;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = type;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });

  // Expose pan to marker function for external use (e.g., cycleMatch)
  panToMarker = function(forceZoom = false) {
    if (matchMarkers.length === 0) return;
    const duration = info.duration || 1;
    const marker = matchMarkers[currentMatchIndex];
    if (!marker) return;

    const markerPosition = marker.time / duration;
    const targetZoom = forceZoom ? 3 : Math.max(timelineZoom, 2);

    enableTransition();
    timelineZoom = targetZoom;
    const visibleFraction = 1 / timelineZoom;
    timelineOffset = Math.max(0, Math.min(1 - visibleFraction, markerPosition - visibleFraction * 0.5));
    viewport.classList.add('zoomed');
    manualZoom = true; // Prevent auto-zoom from overriding
    updateTimeline();
    renderMatchMarkers();
    setTimeout(disableTransition, 250);
  };
}

// ============ MATCH FINDING (LOOP POINTS) ============

function clearMatchMarkers() {
  matchMarkers = [];
  currentMatchIndex = 0;
  $('match-markers').innerHTML = '';
  $('match-info').classList.add('hidden');
  $('cycle-match-btn').classList.add('hidden');
}

function renderMatchMarkers() {
  const container = $('match-markers');
  container.innerHTML = '';
  const duration = info.duration || 1;

  matchMarkers.forEach((marker, i) => {
    const el = document.createElement('div');
    el.className = 'match-marker';
    el.style.left = (marker.time / duration * 100) + '%';
    el.style.backgroundColor = MATCH_COLORS[i % MATCH_COLORS.length];
    el.style.opacity = i === currentMatchIndex ? '1' : '0.5';
    el.style.height = i === currentMatchIndex ? '100%' : '60%';
    el.title = `${marker.time.toFixed(1)}s (${(marker.score * 100).toFixed(0)}% match)`;
    el.onclick = () => {
      currentMatchIndex = i;
      selectMatch(i);
      renderMatchMarkers();
    };
    container.appendChild(el);
  });
}

function selectMatch(index) {
  if (matchMarkers.length === 0) return;
  const marker = matchMarkers[index];
  $('trim-end').value = marker.time.toFixed(2);
  updateTimeline();
  updateMatchInfo();
  // Seek to slightly before the match point for preview
  $('videoPreview').currentTime = parseFloat($('trim-start').value) || 0;
}

function updateMatchInfo() {
  const btn = $('cycle-match-btn');
  if (matchMarkers.length > 0) {
    $('match-info').textContent = `${currentMatchIndex + 1}/${matchMarkers.length} loops`;
    $('match-info').classList.remove('hidden');
    btn.classList.toggle('hidden', matchMarkers.length <= 1);
    // Set button color to current match color
    const color = MATCH_COLORS[currentMatchIndex % MATCH_COLORS.length];
    btn.style.backgroundColor = color;
    btn.style.borderColor = color;
    btn.style.color = '#fff';
  } else {
    $('match-info').classList.add('hidden');
    btn.classList.add('hidden');
    btn.style.backgroundColor = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

function cycleMatch() {
  if (matchMarkers.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % matchMarkers.length;
  selectMatch(currentMatchIndex);
  renderMatchMarkers();
  // Pan timeline to focus on the selected marker
  if (panToMarker) panToMarker();
}

/**
 * Find best loop start point in first 5 seconds of video
 * Sets trim start/end and shows match marker
 */
async function findBestLoopStart() {
  try {
    const res = await postJson('/api/find-best-start', { searchRange: 5, minGap: 3 });
    if (res.success && res.score > 0) {
      // Set trim start and end to the found loop points
      $('trim-start').value = res.startTime.toFixed(2);
      $('trim-end').value = res.endTime.toFixed(2);

      // Add match marker for the end point
      matchMarkers = [{ time: res.endTime, score: res.score }];
      currentMatchIndex = 0;
      renderMatchMarkers();
      updateMatchInfo();
      updateTimeline();

      // Seek video to start position
      const video = $('videoPreview');
      video.currentTime = res.startTime;

      return true;
    }
  } catch (err) {
    console.error('Find best start error:', err);
  }
  return false;
}

/**
 * Pre-load matches in background during loading screen
 */
async function preloadMatches() {
  try {
    const startTime = parseFloat($('trim-start').value) || 0;
    const res = await postJson('/api/find-matches', { referenceTime: startTime, minGap: 3 });
    if (res.success && res.matches) {
      preloadedMatches = res.matches;
    }
  } catch (err) {
    console.error('Preload matches error:', err);
  }
}

async function findMatchingFrames() {
  // Remove glow from Find Loop button when clicked
  $('find-match-btn')?.classList.remove('new-feature');

  const startTime = parseFloat($('trim-start').value) || 0;

  // Show inline loading, hide controls
  $('trim-controls').classList.add('hidden');
  $('trim-loading').classList.remove('hidden');

  try {
    let matches = null;

    // If start time is 0 and we have preloaded matches, use them
    if (startTime === 0 && preloadedMatches) {
      matches = preloadedMatches;
    } else {
      // Wait for any ongoing preload if start is 0
      if (startTime === 0 && preloadPromise) {
        await preloadPromise;
        if (preloadedMatches) {
          matches = preloadedMatches;
        }
      }

      // Fetch new matches if needed
      if (!matches) {
        const res = await postJson('/api/find-matches', { referenceTime: startTime, minGap: 3 });
        if (res.success && res.matches) {
          matches = res.matches;
        }
      }
    }

    if (matches && matches.length > 0) {
      matchMarkers = matches.slice(0, 5).map(m => ({ time: m.time, score: m.score }));
      currentMatchIndex = 0;
      renderMatchMarkers();
      updateMatchInfo();
      hideNoMatchesMessage();

      // Auto-select first match
      $('trim-end').value = matchMarkers[0].time.toFixed(2);
      updateTimeline();
    } else {
      clearMatchMarkers();
      showNoMatchesMessage();
    }
  } catch (err) {
    console.error('Find match error:', err);
    clearMatchMarkers();
    showNoMatchesMessage();
  } finally {
    // Hide loading, show controls
    $('trim-loading').classList.add('hidden');
    $('trim-controls').classList.remove('hidden');
  }
}

// ============ AUDIO PREVIEW ============

function updateAudioVolume() {
  audioVolume = parseInt($('audio-volume').value);
  $('audio-vol-val').textContent = audioVolume + '%';
  const audioEl = $('audioPreview');
  if (audioEl) audioEl.volume = audioVolume / 100;
}

function toggleAudioMix() {
  audioMix = !audioMix;
  $('audio-toggle').classList.toggle('on', audioMix);
  $('audio-toggle').querySelector('.toggle-label').textContent = audioMix ? 'Blend with original' : 'Replace original';
  if (activeTool === 'audio' && audioPreviewLoaded) {
    $('videoPreview').muted = !audioMix;
    updateVolumeUI();
  }
}

function setupAudioPreviewSync() {
  const video = $('videoPreview');
  const audio = $('audioPreview');

  video.addEventListener('play', () => {
    if (activeTool === 'audio' && audioPreviewLoaded) {
      audio.currentTime = video.currentTime;
      audio.play().catch(() => {});
    }
  });

  video.addEventListener('pause', () => audio.pause());

  video.addEventListener('seeked', () => {
    if (activeTool === 'audio' && audioPreviewLoaded) {
      audio.currentTime = video.currentTime;
    }
  });

  video.addEventListener('timeupdate', () => {
    if (activeTool === 'audio' && audioPreviewLoaded && !video.paused) {
      const drift = Math.abs(audio.currentTime - video.currentTime);
      if (drift > 0.3) audio.currentTime = video.currentTime;
    }
  });
}

function startAudioPreview() {
  if (!audioPreviewLoaded) return;
  const video = $('videoPreview');
  const audio = $('audioPreview');
  audio.volume = audioVolume / 100;
  video.muted = !audioMix;
  audio.currentTime = video.currentTime;
  if (!video.paused) audio.play().catch(() => {});
  updateVolumeUI();
}

function stopAudioPreview() {
  const audio = $('audioPreview');
  const video = $('videoPreview');
  audio.pause();
  video.muted = false;
  updateVolumeUI();
}

// ============ FILE HANDLING ============

async function uploadFile(file, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await postJson('/api/upload', { fileName: file.name, data: reader.result, type });
        if (res.success) resolve(res.path);
        else reject(new Error(res.error || 'Upload failed'));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function handleAudioFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    $('audioFileName').textContent = 'Uploading...';
    try {
      const audioEl = $('audioPreview');
      audioEl.src = URL.createObjectURL(file);
      audioEl.volume = audioVolume / 100;
      audioPreviewLoaded = true;

      const path = await uploadFile(file, 'audio');
      $('audio-path').value = path;
      $('audioFileName').textContent = file.name;
      $('audioDropZone').classList.add('has-file');

      if (activeTool === 'audio') startAudioPreview();
    } catch (err) {
      $('audioFileName').textContent = 'Upload failed: ' + err.message;
      audioPreviewLoaded = false;
    }
  }
}

async function handleThumbFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        $('thumbPreview').src = e.target.result;
        $('thumbUpload').classList.add('has-image');
      };
      reader.readAsDataURL(file);

      const path = await uploadFile(file, 'image');
      $('thumb-image').value = path;
      // Auto-select the uploaded image
      selectUploadedImage();
    } catch (err) {
      $('thumbUpload').classList.remove('selected', 'has-image');
    }
  }
}

// ============ THUMBNAIL ============

function captureCurrentFrame() {
  const video = $('videoPreview');
  const time = video.currentTime;
  $('thumb-timestamp').value = time.toFixed(3);
  $('thumb-source').value = 'video';
  $('thumbCapture').classList.add('selected');
  $('thumbUpload').classList.remove('selected');
  drawThumbCanvas();
}

function handleThumbClick() {
  // If image already loaded, select it; otherwise open file browser
  if ($('thumb-image').value) {
    selectUploadedImage();
  } else {
    $('thumbFileInput').click();
  }
}

function selectUploadedImage() {
  $('thumb-source').value = 'file';
  $('thumb-timestamp').value = '';
  $('thumbUpload').classList.add('selected');
  $('thumbCapture').classList.remove('selected');
}

function updateThumbFrameTime() {
  if (activeTool !== 'thumb') return;
  const video = $('videoPreview');
  $('thumbFrameTime').textContent = formatTimeMs(video.currentTime);
  // Update canvas preview in real-time (only if not already selected)
  if (!$('thumbCapture').classList.contains('selected')) {
    drawThumbCanvas();
  }
}

function drawThumbCanvas() {
  const video = $('videoPreview');
  const canvas = $('thumbCanvas');
  if (!canvas || !video.videoWidth) return;
  const ctx = canvas.getContext('2d');

  // Draw full frame to canvas
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
}

function initThumbTool() {
  $('thumb-timestamp').value = '';
  $('thumb-source').value = 'video';
  $('thumbCapture').classList.remove('selected');
  $('thumbUpload').classList.remove('selected');
  // Keep uploaded image - don't clear thumb-image value or has-image class
  updateThumbAspectRatio();
  drawThumbCanvas();
}

function updateThumbAspectRatio() {
  // Set aspect ratio based on video dimensions
  if (info.width && info.height) {
    const aspectRatio = info.width / info.height;

    // Update CSS variable on thumb preview boxes
    document.querySelectorAll('.thumb-preview-box').forEach(box => {
      box.style.setProperty('--video-aspect', `${info.width}/${info.height}`);
    });

    // Update canvas dimensions to match aspect ratio (keep width at 120)
    const canvas = $('thumbCanvas');
    if (canvas) {
      const canvasWidth = 120;
      const canvasHeight = Math.round(canvasWidth / aspectRatio);
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
  }
}

function initDropZones() {
  const audioZone = $('audioDropZone');
  audioZone.addEventListener('dragover', (e) => { e.preventDefault(); audioZone.classList.add('dragover'); });
  audioZone.addEventListener('dragleave', () => audioZone.classList.remove('dragover'));
  audioZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    audioZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      const input = $('audioFileInput');
      input.files = e.dataTransfer.files;
      handleAudioFile(input);
    }
  });

  const thumbZone = $('thumbUpload').querySelector('.thumb-preview-box');
  if (thumbZone) {
    thumbZone.addEventListener('dragover', (e) => { e.preventDefault(); thumbZone.style.borderColor = 'var(--acc)'; });
    thumbZone.addEventListener('dragleave', () => thumbZone.style.borderColor = '');
    thumbZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      thumbZone.style.borderColor = '';
      if (e.dataTransfer.files.length) {
        const input = $('thumbFileInput');
        input.files = e.dataTransfer.files;
        handleThumbFile(input);
      }
    });
  }

  // Video drop zone on preview area
  const previewWrap = $('previewWrap');
  previewWrap.addEventListener('dragover', (e) => {
    const hasVideo = Array.from(e.dataTransfer.types).includes('Files');
    if (hasVideo) {
      e.preventDefault();
      previewWrap.style.outline = '2px dashed var(--acc)';
      previewWrap.style.outlineOffset = '-2px';
    }
  });
  previewWrap.addEventListener('dragleave', (e) => {
    if (!previewWrap.contains(e.relatedTarget)) {
      previewWrap.style.outline = '';
      previewWrap.style.outlineOffset = '';
    }
  });
  previewWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    previewWrap.style.outline = '';
    previewWrap.style.outlineOffset = '';

    const file = Array.from(e.dataTransfer.files).find(f =>
      f.type.startsWith('video/') || /\.(mp4|mkv|avi|mov|webm)$/i.test(f.name)
    );

    if (file) {
      const confirmed = await showConfirmModal({
        title: 'Load New Video',
        message: `Load <b>${file.name}</b> as new video?<br><br>This will replace the current video.`,
        okText: 'Load',
        icon: 'warning'
      });
      if (confirmed) {
        await handleVideoFileDrop(file);
      }
    }
  });
}

async function handleVideoFileDrop(file) {
  $('loading').classList.add('on');
  $('loading').querySelector('span').textContent = 'Loading video...';

  try {
    const path = await uploadFile(file, 'video');
    await loadOutputAsSource(path);
    showToast('Video loaded: ' + file.name);
  } catch (err) {
    showToast('Failed to load video');
    console.error('Video drop error:', err);
  } finally {
    $('loading').classList.remove('on');
  }
}

// ============ VIDEO PLAYER ============

function togglePlay() {
  const video = $('videoPreview');
  video.paused ? video.play() : video.pause();
}

function toggleMute() {
  const video = $('videoPreview');
  video.muted = !video.muted;
  updateVolumeUI();
}

function updatePlayIcon() {
  const video = $('videoPreview');
  $('playIcon').style.display = video.paused ? 'block' : 'none';
  $('pauseIcon').style.display = video.paused ? 'none' : 'block';
}

function updateVolumeUI() {
  const video = $('videoPreview');
  const muted = video.muted || video.volume === 0;
  $('volIcon').style.display = muted ? 'none' : 'block';
  $('mutedIcon').style.display = muted ? 'block' : 'none';
  $('volumeLevel').style.width = (muted ? 0 : video.volume * 100) + '%';
}

function updateTimeDisplay(overrideTime) {
  const video = $('videoPreview');
  if (!video.duration) return;

  const currentTime = overrideTime !== undefined ? overrideTime : video.currentTime;

  // In trim mode, normalize to selection range
  if (activeTool === 'trim') {
    const trimStart = parseFloat($('trim-start').value) || 0;
    const trimEnd = parseFloat($('trim-end').value) || video.duration;
    const trimDuration = trimEnd - trimStart;
    const relativeTime = Math.max(0, currentTime - trimStart);
    const pct = trimDuration > 0 ? (relativeTime / trimDuration) * 100 : 0;
    $('playerProgress').style.width = Math.min(100, pct) + '%';
    $('playerThumb').style.left = Math.min(100, pct) + '%';
    $('playerTime').textContent = formatTime(relativeTime) + ' / ' + formatTime(trimDuration);
  } else {
    const pct = (currentTime / video.duration) * 100;
    $('playerProgress').style.width = pct + '%';
    $('playerThumb').style.left = pct + '%';
    $('playerTime').textContent = formatTime(currentTime) + ' / ' + formatTime(video.duration);
  }
}

function adjustSpeed(delta) {
  currentSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, currentSpeed + delta));
  $('videoPreview').playbackRate = currentSpeed;
  $('speedVal').textContent = currentSpeed + 'x';
}

function resetSpeed() {
  currentSpeed = 1;
  $('videoPreview').playbackRate = 1;
  $('speedVal').textContent = '1x';
}

function initPlayerControls() {
  const video = $('videoPreview');
  const seek = $('playerSeek');
  const volumeSlider = $('volumeSlider');

  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);
  video.addEventListener('timeupdate', () => {
    updateTimeDisplay();
    updatePlayhead();
    updateThumbFrameTime();
    // Update portrait segment playhead and keyframe animation
    if (activeTool === 'portrait') {
      updatePortraitPlayhead();
      // Animate crop position based on keyframes during playback
      if (keyframeAnimationEnabled && !video.paused && portraitKeyframes.length > 0) {
        const newCropX = getCropXAtTime(video.currentTime);
        if (Math.abs(newCropX - portraitCropX) > 0.001) {
          portraitCropX = newCropX;
          updateCropOverlay();
        }
      }
    }
    // Seamless loop in trim mode
    if (activeTool === 'trim' && !video.paused) {
      const trimEnd = parseFloat($('trim-end').value) || video.duration;
      const trimStart = parseFloat($('trim-start').value) || 0;
      if (video.currentTime >= trimEnd - 0.05) {
        video.currentTime = trimStart;
      }
    }
  });
  video.addEventListener('loadedmetadata', updateTimeDisplay);

  // Seek bar scrubbing support with frame cache
  let isSeeking = false;
  let wasPlayingBeforeSeek = false;
  let lastScrubTime = 0;

  function getTimeFromPosition(e) {
    const rect = seek.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (activeTool === 'trim') {
      const trimStart = parseFloat($('trim-start').value) || 0;
      const trimEnd = parseFloat($('trim-end').value) || video.duration;
      return trimStart + pct * (trimEnd - trimStart);
    }
    return pct * video.duration;
  }

  function seekToPosition(e) {
    const time = getTimeFromPosition(e);

    // Show cached frame instantly during scrubbing
    if (frameCacheReady && isSeeking) {
      showScrubFrame(time);
      // Update playhead position immediately
      const pct = (time / info.duration) * 100;
      $('timeline-playhead').style.left = pct + '%';
      updateTimeDisplay(time);
    }

    // Throttle actual video seeks for performance
    const now = performance.now();
    if (now - lastScrubTime > 50) { // Seek at most every 50ms
      video.currentTime = time;
      lastScrubTime = now;
    }
  }

  seek.addEventListener('mousedown', (e) => {
    isSeeking = true;
    wasPlayingBeforeSeek = !video.paused;
    video.pause();
    seekToPosition(e);
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isSeeking) return;
    seekToPosition(e);
  });

  document.addEventListener('mouseup', (e) => {
    if (!isSeeking) return;
    isSeeking = false;
    hideScrubFrame();
    // Final seek to exact position
    video.currentTime = getTimeFromPosition(e);
    if (wasPlayingBeforeSeek) {
      video.play();
    }
  });

  volumeSlider.addEventListener('click', (e) => {
    const rect = volumeSlider.getBoundingClientRect();
    const vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.volume = vol;
    video.muted = false;
    updateVolumeUI();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const hotkeys = getHotkeyMap();

    // Portrait tool hotkeys (configurable based on preset)
    if (activeTool === 'portrait') {
      // Split segment
      if (matchesHotkey(e, hotkeys.split)) {
        e.preventDefault();
        splitPortraitSegment();
        return;
      }

      // Delete selected segment (leave gap)
      if (matchesHotkey(e, hotkeys.delete)) {
        e.preventDefault();
        deleteSelectedSegment(false);
        return;
      }

      // Ripple delete (fill gap)
      if (matchesHotkey(e, hotkeys.rippleDelete)) {
        e.preventDefault();
        deleteSelectedSegment(true);
        return;
      }

      // Select previous segment
      if (matchesHotkey(e, hotkeys.selectPrev)) {
        e.preventDefault();
        if (selectedSegmentIndex > 0) {
          selectSegment(selectedSegmentIndex - 1);
        }
        return;
      }

      // Select next segment
      if (matchesHotkey(e, hotkeys.selectNext)) {
        e.preventDefault();
        if (selectedSegmentIndex < portraitSegments.length - 1) {
          selectSegment(selectedSegmentIndex + 1);
        }
        return;
      }

      // Add keyframe at current position ('K' key in portrait mode)
      if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        addKeyframe();
        return;
      }
    }

    // Undo/Redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y)
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      redo();
      return;
    }

    // Navigation steps
    const frameStep = 1 / (info.fps || 30);
    const shortSeek = e.altKey ? frameStep : 5;  // Alt = frame, normal = 5s
    const longSeek = e.shiftKey ? 30 : 10;       // Shift = 30s, normal = 10s

    // Global playback & navigation hotkeys
    switch (e.code) {
      // Playback
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyJ': adjustSpeed(-0.5); break;
      case 'KeyK': if (!e.ctrlKey && !e.metaKey) resetSpeed(); break;
      case 'KeyL': adjustSpeed(0.5); break;

      // Navigation: Arrow keys (Alt = frame, normal = 5s)
      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - shortSeek);
        break;
      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + shortSeek);
        break;

      // Navigation: Home/End = start/end of video
      case 'Home':
        e.preventDefault();
        video.currentTime = 0;
        break;
      case 'End':
        e.preventDefault();
        video.currentTime = video.duration;
        break;

      // Navigation: Page Up/Down = 10s jumps (Shift = 30s)
      case 'PageUp':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - longSeek);
        break;
      case 'PageDown':
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + longSeek);
        break;

      // Mark In/Out points (I/O keys - common in NLEs)
      case 'KeyI':
        if (activeTool === 'trim') {
          e.preventDefault();
          $('trim-start').value = video.currentTime.toFixed(2);
          updateTimeline();
        }
        break;
      case 'KeyO':
        if (activeTool === 'trim') {
          e.preventDefault();
          $('trim-end').value = video.currentTime.toFixed(2);
          updateTimeline();
        }
        break;
    }
  });
}

// ============ RESIZE DIVIDER ============

function initResizeDivider() {
  const divider = $('resizeDivider');
  const container = $('previewContainer');
  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    startY = e.clientY;
    startHeight = container.offsetHeight;
    divider.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = e.clientY - startY;
    const newHeight = Math.max(120, Math.min(600, startHeight + delta));
    container.style.height = newHeight + 'px';
    updateCropOverlay();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ============ VIDEO ZOOM ============

let videoZoom = 1;
let videoPanX = 0;
let videoPanY = 0;

function initVideoZoom() {
  const wrap = $('previewWrap');
  const video = $('videoPreview');
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let startPanX = 0, startPanY = 0;

  // Touch pinch state
  let initialPinchDistance = 0;
  let initialPinchZoom = 1;
  let pinchCenterX = 0, pinchCenterY = 0;

  function updateVideoTransform() {
    video.style.transform = `scale(${videoZoom}) translate(${videoPanX}px, ${videoPanY}px)`;
    wrap.classList.toggle('zoomed', videoZoom > 1);
  }

  function resetZoom() {
    videoZoom = 1;
    videoPanX = 0;
    videoPanY = 0;
    updateVideoTransform();
  }

  function clampPan() {
    const maxPan = (videoZoom - 1) * 50;
    videoPanX = Math.max(-maxPan, Math.min(maxPan, videoPanX));
    videoPanY = Math.max(-maxPan, Math.min(maxPan, videoPanY));
  }

  // Get cursor position relative to wrap center
  function getCursorOffset(clientX, clientY) {
    const rect = wrap.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      x: clientX - centerX,
      y: clientY - centerY
    };
  }

  // Zoom towards a point (cursor or pinch center)
  function zoomTowards(newZoom, pointX, pointY) {
    if (newZoom === 1) {
      resetZoom();
      return;
    }

    const oldZoom = videoZoom;
    videoZoom = newZoom;

    // Adjust pan so the point under cursor stays under cursor
    // Point on video: (pointX/oldZoom - oldPanX, pointY/oldZoom - oldPanY)
    // After zoom: (pointX/newZoom - newPanX, pointY/newZoom - newPanY) should equal same point
    videoPanX += pointX * (1/newZoom - 1/oldZoom);
    videoPanY += pointY * (1/newZoom - 1/oldZoom);

    clampPan();
    updateVideoTransform();
  }

  // Mouse wheel zoom towards cursor
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const newZoom = Math.max(1, Math.min(5, videoZoom + delta));
    const cursor = getCursorOffset(e.clientX, e.clientY);
    zoomTowards(newZoom, cursor.x, cursor.y);
  }, { passive: false });

  // Mouse pan
  video.addEventListener('mousedown', (e) => {
    if (videoZoom <= 1) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    startPanX = videoPanX;
    startPanY = videoPanY;
    wrap.classList.add('panning');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = (e.clientX - panStartX) / videoZoom;
    const dy = (e.clientY - panStartY) / videoZoom;
    videoPanX = startPanX + dx;
    videoPanY = startPanY + dy;
    clampPan();
    updateVideoTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      wrap.classList.remove('panning');
    }
  });

  // Touch pinch-to-zoom
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      initialPinchDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      initialPinchZoom = videoZoom;
      // Pinch center
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const offset = getCursorOffset(centerX, centerY);
      pinchCenterX = offset.x;
      pinchCenterY = offset.y;
    } else if (e.touches.length === 1 && videoZoom > 1) {
      // Single touch pan
      isPanning = true;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      startPanX = videoPanX;
      startPanY = videoPanY;
    }
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      const scale = currentDistance / initialPinchDistance;
      const newZoom = Math.max(1, Math.min(5, initialPinchZoom * scale));

      // Update pinch center as fingers move
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      const offset = getCursorOffset(centerX, centerY);

      zoomTowards(newZoom, offset.x, offset.y);
    } else if (e.touches.length === 1 && isPanning) {
      e.preventDefault();
      const dx = (e.touches[0].clientX - panStartX) / videoZoom;
      const dy = (e.touches[0].clientY - panStartY) / videoZoom;
      videoPanX = startPanX + dx;
      videoPanY = startPanY + dy;
      clampPan();
      updateVideoTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      initialPinchDistance = 0;
    }
    if (e.touches.length === 0) {
      isPanning = false;
    }
  });

  // Double-click/tap to fit/center video
  wrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetZoom();
  });
}

// ============ FILTER PREVIEW ============

// Filter state
const filterState = {
  brightness: 0,      // -100 to 100 (0 = normal)
  contrast: 0,        // -100 to 100 (0 = normal)
  saturation: 0,      // -100 to 100 (0 = normal)
  blur: 0,            // 0 to 10
  blurEnabled: false,
  sharpen: false,
  vignette: false,
  vignetteIntensity: 0,
  bloom: false,
  bloomIntensity: 0,
  filterPreset: 'none', // none, grayscale, sepia, vintage, cool, warm
};

function updateFilterPreview() {
  // Read slider values (all use 0 as neutral)
  const brightness = parseInt($('filter-brightness')?.value) || 0;
  const contrast = parseInt($('filter-contrast')?.value) || 0;
  const saturation = parseInt($('filter-saturation')?.value) || 0;
  const blur = parseFloat($('filter-blur')?.value) || 0;
  const vignetteIntensity = parseInt($('filter-vignette-intensity')?.value) || 0;
  const bloomIntensity = parseInt($('filter-bloom-intensity')?.value) || 0;

  // Update state
  filterState.brightness = brightness;
  filterState.contrast = contrast;
  filterState.saturation = saturation;
  filterState.blur = blur;
  filterState.vignetteIntensity = vignetteIntensity;
  filterState.bloomIntensity = bloomIntensity;

  // Auto-toggle effects based on slider values (0 = off)
  filterState.blurEnabled = blur > 0;
  filterState.vignette = vignetteIntensity > 0;
  filterState.bloom = bloomIntensity > 0;

  // Update effect button states based on values
  $('effect-blur')?.classList.toggle('active', blur > 0);
  $('effect-vignette')?.classList.toggle('active', vignetteIntensity > 0);
  $('effect-bloom')?.classList.toggle('active', bloomIntensity > 0);

  // Update value labels
  if ($('filter-brightness-val')) $('filter-brightness-val').textContent = brightness;
  if ($('filter-contrast-val')) $('filter-contrast-val').textContent = contrast;
  if ($('filter-saturation-val')) $('filter-saturation-val').textContent = saturation;
  if ($('filter-blur-val')) $('filter-blur-val').textContent = blur;
  if ($('filter-vignette-val')) $('filter-vignette-val').textContent = vignetteIntensity;
  if ($('filter-bloom-val')) $('filter-bloom-val').textContent = bloomIntensity;

  applyFilterPreview();
}

function toggleEffect(name) {
  const btn = $('effect-' + name);
  const settings = $('settings-' + name);

  // Toggle the effect state
  if (name === 'blur') {
    filterState.blurEnabled = !filterState.blurEnabled;
    btn?.classList.toggle('active', filterState.blurEnabled);
    // Set default value when first enabled
    if (filterState.blurEnabled && filterState.blur === 0) {
      filterState.blur = 3;
      if ($('filter-blur')) $('filter-blur').value = 3;
      if ($('filter-blur-val')) $('filter-blur-val').textContent = '3';
    }
  } else if (name === 'vignette') {
    filterState.vignette = !filterState.vignette;
    btn?.classList.toggle('active', filterState.vignette);
    // Set default value when first enabled
    if (filterState.vignette && filterState.vignetteIntensity === 0) {
      filterState.vignetteIntensity = 60;
      if ($('filter-vignette-intensity')) $('filter-vignette-intensity').value = 60;
      if ($('filter-vignette-val')) $('filter-vignette-val').textContent = '60';
    }
  } else if (name === 'bloom') {
    filterState.bloom = !filterState.bloom;
    btn?.classList.toggle('active', filterState.bloom);
    // Set default value when first enabled
    if (filterState.bloom && filterState.bloomIntensity === 0) {
      filterState.bloomIntensity = 50;
      if ($('filter-bloom-intensity')) $('filter-bloom-intensity').value = 50;
      if ($('filter-bloom-val')) $('filter-bloom-val').textContent = '50';
    }
  } else if (name === 'sharpen') {
    filterState.sharpen = !filterState.sharpen;
    btn?.classList.toggle('active', filterState.sharpen);
  }

  // Show/hide settings panel
  if (settings) {
    settings.classList.toggle('hidden', !btn?.classList.contains('active'));
  }

  applyFilterPreview();
}

function selectFilterPreset(preset) {
  filterState.filterPreset = preset;

  // Update button states
  document.querySelectorAll('.filter-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === preset);
  });

  applyFilterPreview();
}

function resetFilters() {
  resetColorFilters();
  resetEffectFilters();
  resetEnhanceFilters();
}

function resetColorFilters() {
  filterState.brightness = 0;
  filterState.contrast = 0;
  filterState.saturation = 0;

  if ($('filter-brightness')) $('filter-brightness').value = 0;
  if ($('filter-contrast')) $('filter-contrast').value = 0;
  if ($('filter-saturation')) $('filter-saturation').value = 0;

  if ($('filter-brightness-val')) $('filter-brightness-val').textContent = '0';
  if ($('filter-contrast-val')) $('filter-contrast-val').textContent = '0';
  if ($('filter-saturation-val')) $('filter-saturation-val').textContent = '0';

  applyFilterPreview();
}

function resetEffectFilters() {
  filterState.blur = 0;
  filterState.blurEnabled = false;
  filterState.sharpen = false;
  filterState.vignette = false;
  filterState.vignetteIntensity = 0;
  filterState.bloom = false;
  filterState.bloomIntensity = 0;

  if ($('filter-blur')) $('filter-blur').value = 0;
  if ($('filter-blur-val')) $('filter-blur-val').textContent = '0';
  if ($('filter-vignette-intensity')) $('filter-vignette-intensity').value = 0;
  if ($('filter-vignette-val')) $('filter-vignette-val').textContent = '0';
  if ($('filter-bloom-intensity')) $('filter-bloom-intensity').value = 0;
  if ($('filter-bloom-val')) $('filter-bloom-val').textContent = '0';

  // Reset effect buttons
  ['blur', 'sharpen', 'vignette', 'bloom'].forEach(name => {
    const btn = $('effect-' + name);
    if (btn) btn.classList.remove('active');
    const settings = $('settings-' + name);
    if (settings) settings.classList.add('hidden');
  });

  // Reset filter preset
  filterState.filterPreset = 'none';
  document.querySelectorAll('.filter-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'none');
  });

  applyFilterPreview();
}

function applyFilterPreview() {
  const video = $('videoPreview');
  if (!video) return;

  const filters = [];

  // Brightness: CSS uses 0-2 (1 = normal), our range is -100 to 100 (0 = normal)
  const brightnessVal = 1 + (filterState.brightness / 100);
  if (brightnessVal !== 1) filters.push(`brightness(${brightnessVal.toFixed(2)})`);

  // Contrast: CSS uses 0-2+ (1 = normal), our range is -100 to 100 (0 = normal)
  const contrastVal = 1 + (filterState.contrast / 100);
  if (contrastVal !== 1) filters.push(`contrast(${contrastVal.toFixed(2)})`);

  // Saturation: CSS uses 0-2+ (1 = normal), our range is -100 to 100 (0 = normal)
  const saturationVal = 1 + (filterState.saturation / 100);
  if (saturationVal !== 1) filters.push(`saturate(${saturationVal.toFixed(2)})`);

  // Blur (only if enabled)
  if (filterState.blurEnabled && filterState.blur > 0) {
    filters.push(`blur(${filterState.blur}px)`);
  }

  // Filter presets
  switch (filterState.filterPreset) {
    case 'grayscale':
      filters.push('grayscale(1)');
      break;
    case 'sepia':
      filters.push('sepia(1)');
      break;
    case 'vintage':
      filters.push('sepia(0.4)', 'contrast(1.1)', 'brightness(0.9)');
      break;
    case 'cool':
      filters.push('saturate(0.9)', 'hue-rotate(15deg)');
      break;
    case 'warm':
      filters.push('saturate(1.2)', 'hue-rotate(-10deg)');
      break;
  }

  // Apply CSS filter to video
  video.style.filter = filters.length > 0 ? filters.join(' ') : '';

  // Vignette overlay preview
  const vignetteOverlay = $('vignetteOverlay');
  if (vignetteOverlay) {
    const showVignette = filterState.vignette && filterState.vignetteIntensity > 0;
    vignetteOverlay.classList.toggle('hidden', !showVignette);
    if (showVignette) {
      // Intensity 0-100 maps to opacity and spread
      const intensity = filterState.vignetteIntensity / 100;
      const innerStop = Math.max(0, 50 - intensity * 30); // 50% down to 20%
      const opacity = 0.3 + intensity * 0.6; // 0.3 to 0.9
      vignetteOverlay.style.background = `radial-gradient(ellipse at center, transparent 0%, transparent ${innerStop}%, rgba(0,0,0,${opacity.toFixed(2)}) 100%)`;
    }
  }

  // Bloom overlay preview
  const bloomOverlay = $('bloomOverlay');
  if (bloomOverlay) {
    const showBloom = filterState.bloom && filterState.bloomIntensity > 0;
    bloomOverlay.classList.toggle('hidden', !showBloom);
    if (showBloom) {
      // Intensity 0-100 maps to glow strength
      const intensity = filterState.bloomIntensity / 100;
      const opacity = 0.1 + intensity * 0.25; // 0.1 to 0.35
      const spread = 40 + intensity * 30; // 40% to 70%
      bloomOverlay.style.background = `radial-gradient(ellipse at center, rgba(255,255,255,${opacity.toFixed(2)}) 0%, transparent ${spread}%)`;
    }
  }
}

function clearFilterPreview() {
  const video = $('videoPreview');
  if (video) video.style.filter = '';
  // Hide vignette and bloom overlays
  $('vignetteOverlay')?.classList.add('hidden');
  $('bloomOverlay')?.classList.add('hidden');
}

// ============ CROP OVERLAY (PORTRAIT) ============

function initCropOverlay() {
  const overlay = $('cropOverlay');
  const cropWindow = $('cropWindow');
  let isDragging = false;
  let startX = 0;

  function onMove(e) {
    if (!isDragging) return;
    const video = $('videoPreview');
    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    portraitCropX = Math.max(0.1, Math.min(0.9, x / rect.width));
    updateSelectedSegmentCropX(portraitCropX);
    updateCropOverlay();
  }

  cropWindow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMove);
    }, { once: true });
  });
}

function updateCropOverlay() {
  const video = $('videoPreview');
  const overlay = $('cropOverlay');
  if (!video.videoWidth) return;

  const videoRect = video.getBoundingClientRect();
  const wrapRect = $('previewWrap').getBoundingClientRect();

  const offsetX = videoRect.left - wrapRect.left;
  const offsetY = videoRect.top - wrapRect.top;

  const cropWidth = videoRect.height * (9 / 16);
  const cropLeft = offsetX + (videoRect.width * portraitCropX) - (cropWidth / 2);

  $('cropLeft').style.width = Math.max(0, cropLeft - offsetX) + 'px';
  $('cropLeft').style.left = offsetX + 'px';
  $('cropRight').style.width = Math.max(0, (offsetX + videoRect.width) - (cropLeft + cropWidth)) + 'px';
  $('cropRight').style.right = (wrapRect.width - offsetX - videoRect.width) + 'px';
  $('cropWindow').style.left = cropLeft + 'px';
  $('cropWindow').style.width = cropWidth + 'px';

  // Update crop window border color to match selected segment
  if (portraitSegments.length > 0 && selectedSegmentIndex < portraitSegments.length) {
    const segColor = SEGMENT_COLORS[selectedSegmentIndex % SEGMENT_COLORS.length];
    $('cropWindow').style.borderColor = segColor;
    document.querySelectorAll('.crop-handle').forEach(h => h.style.background = segColor);
  }
}

// ============ PORTRAIT SEGMENTS ============

function initPortraitSegments() {
  // If already initialized, just refresh UI (preserve segments on tool switch)
  if (portraitSegmentsInitialized && portraitSegments.length > 0) {
    renderPortraitSegments();
    updatePortraitUI();
    return;
  }

  // Reset zoom state
  portraitZoom = 1;
  portraitOffset = 0;
  $('segment-timeline-wrap')?.classList.remove('zoomed');

  // Use trim values if set, otherwise full video duration
  const trimStart = parseFloat($('trim-start')?.value) || 0;
  const trimEnd = parseFloat($('trim-end')?.value) || info.duration || 10;

  // Create default segment covering the trim range
  portraitSegments = [{
    id: 'seg_' + Date.now(),
    startTime: trimStart,
    endTime: trimEnd,
    cropX: 0.5
  }];
  selectedSegmentIndex = 0;
  portraitCropX = 0.5;
  portraitSegmentsInitialized = true;
  renderPortraitSegments();
  updatePortraitUI();

  // Initialize timeline zoom (only once)
  initPortraitTimelineZoom();
}

function splitPortraitSegment() {
  saveUndoState();

  const video = $('videoPreview');
  const currentTime = video.currentTime;

  // Find which segment contains the current time
  const segmentIndex = portraitSegments.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);
  if (segmentIndex === -1) return;

  const segment = portraitSegments[segmentIndex];

  // Don't split if too close to edges (minimum 0.5s segments)
  if (currentTime - segment.startTime < 0.5 || segment.endTime - currentTime < 0.5) {
    showToast('Segment too small to split');
    return;
  }

  // Create new segment from split point to end
  const newSegment = {
    id: 'seg_' + Date.now(),
    startTime: currentTime,
    endTime: segment.endTime,
    cropX: segment.cropX // Inherit crop position
  };

  // Trim original segment
  segment.endTime = currentTime;

  // Insert new segment after the current one
  portraitSegments.splice(segmentIndex + 1, 0, newSegment);

  // Select the new segment
  selectedSegmentIndex = segmentIndex + 1;
  portraitCropX = newSegment.cropX;

  renderPortraitSegments();
  updatePortraitUI();
  updateCropOverlay();
}

function deleteSelectedSegment(ripple = true) {
  if (portraitSegments.length <= 1) return;

  saveUndoState();

  const deleted = portraitSegments.splice(selectedSegmentIndex, 1)[0];

  if (ripple) {
    // Ripple delete: merge with previous or next segment (fills the gap)
    if (selectedSegmentIndex > 0) {
      // Merge with previous
      portraitSegments[selectedSegmentIndex - 1].endTime = deleted.endTime;
      selectedSegmentIndex--;
    } else if (portraitSegments.length > 0) {
      // Merge with next
      portraitSegments[0].startTime = deleted.startTime;
    }
  } else {
    // Regular delete: just remove, leave gap (other segments don't change)
    if (selectedSegmentIndex >= portraitSegments.length) {
      selectedSegmentIndex = Math.max(0, portraitSegments.length - 1);
    }
  }

  // Update cropX to selected segment
  if (portraitSegments[selectedSegmentIndex]) {
    portraitCropX = portraitSegments[selectedSegmentIndex].cropX;
  }

  renderPortraitSegments();
  updatePortraitUI();
  updateCropOverlay();
}

/**
 * Get interpolated cropX at a given time from keyframes
 */
function getCropXAtTime(time) {
  if (portraitKeyframes.length === 0) return 0.5;
  if (portraitKeyframes.length === 1) return portraitKeyframes[0].cropX;

  // Find surrounding keyframes
  let before = portraitKeyframes[0];
  let after = portraitKeyframes[portraitKeyframes.length - 1];

  for (let i = 0; i < portraitKeyframes.length - 1; i++) {
    if (portraitKeyframes[i].time <= time && portraitKeyframes[i + 1].time >= time) {
      before = portraitKeyframes[i];
      after = portraitKeyframes[i + 1];
      break;
    }
  }

  // Interpolate
  if (before.time === after.time) return before.cropX;
  const t = (time - before.time) / (after.time - before.time);
  return before.cropX + (after.cropX - before.cropX) * t;
}

/**
 * Add a keyframe at current video time with current crop position
 */
function addKeyframe() {
  const video = $('videoPreview');
  const time = video.currentTime;

  // Remove existing keyframe at same time (within 0.1s)
  portraitKeyframes = portraitKeyframes.filter(k => Math.abs(k.time - time) > 0.1);

  // Add new keyframe
  portraitKeyframes.push({ time, cropX: portraitCropX });
  portraitKeyframes.sort((a, b) => a.time - b.time);

  keyframeAnimationEnabled = true;
  showToast(`Keyframe added at ${time.toFixed(1)}s`);
  renderKeyframeMarkers();
}

/**
 * Clear all keyframes
 */
function clearKeyframes() {
  if (portraitKeyframes.length === 0) {
    showToast('No keyframes to clear');
    return;
  }
  portraitKeyframes = [];
  keyframeAnimationEnabled = false;
  renderKeyframeMarkers();
  showToast('Keyframes cleared');
}

/**
 * Render keyframe markers on timeline
 */
function renderKeyframeMarkers() {
  const timeline = $('segment-timeline');
  if (!timeline) return;

  // Remove existing keyframe markers
  timeline.querySelectorAll('.keyframe-marker').forEach(m => m.remove());

  const duration = info.duration || 1;
  portraitKeyframes.forEach((kf, i) => {
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    marker.style.left = `${(kf.time / duration) * 100}%`;
    marker.title = `${kf.time.toFixed(1)}s: ${Math.round(kf.cropX * 100)}%`;
    marker.onclick = (e) => {
      e.stopPropagation();
      $('videoPreview').currentTime = kf.time;
      portraitCropX = kf.cropX;
      updateCropOverlay();
    };
    timeline.appendChild(marker);
  });
}

/**
 * Auto-split segments - divides each segment in half
 * Doubles segments each click: 1 -> 2 -> 4 -> 8, then hides
 */
function autoSplitSegments() {
  // Don't split if already at 8 or more segments
  if (portraitSegments.length >= 8) return;

  saveUndoState();

  // Split each existing segment in half
  const newSegments = [];
  portraitSegments.forEach((seg, i) => {
    const midTime = (seg.startTime + seg.endTime) / 2;
    // First half keeps original crop
    newSegments.push({
      id: `seg-${newSegments.length}`,
      startTime: seg.startTime,
      endTime: midTime,
      cropX: seg.cropX
    });
    // Second half gets alternating crop position
    const altCrop = seg.cropX <= 0.4 ? 0.7 : seg.cropX >= 0.6 ? 0.3 : (i % 2 === 0 ? 0.7 : 0.3);
    newSegments.push({
      id: `seg-${newSegments.length}`,
      startTime: midTime,
      endTime: seg.endTime,
      cropX: altCrop
    });
  });

  portraitSegments = newSegments;
  selectedSegmentIndex = 0;
  portraitCropX = portraitSegments[0].cropX;

  renderPortraitSegments();
  updateCropOverlay();
  updatePortraitUI();

  // Hide button if at 8 segments
  updateAutoSplitButton();

  showToast(`Split into ${portraitSegments.length} segments`);
}

function selectSegment(index) {
  if (index < 0 || index >= portraitSegments.length) return;

  selectedSegmentIndex = index;
  portraitCropX = portraitSegments[index].cropX;

  // Pause and seek video precisely to segment start
  const video = $('videoPreview');
  video.pause();
  // Use a small timeout to ensure seek happens after pause
  setTimeout(() => {
    video.currentTime = portraitSegments[index].startTime;
  }, 10);

  renderPortraitSegments();
  updatePortraitUI();
  updateCropOverlay();
  updatePortraitPlayhead();
}

function renderPortraitSegments() {
  const timeline = $('segment-timeline');
  const grid = $('segment-grid');
  if (!timeline) return;

  timeline.innerHTML = '';

  // Get trim range - portrait timeline is normalized to this range
  const trimStart = parseFloat($('trim-start')?.value) || 0;
  const trimEnd = parseFloat($('trim-end')?.value) || info.duration || 1;
  const trimDuration = trimEnd - trimStart;

  // Render grid lines
  if (grid) {
    grid.innerHTML = '';
    // Determine grid interval based on duration and zoom
    let minorInterval = trimDuration <= 10 ? 1 : trimDuration <= 30 ? 2 : trimDuration <= 60 ? 5 : 10;
    let majorInterval = minorInterval * 5;
    if (portraitZoom >= 4) {
      minorInterval = Math.max(0.5, minorInterval / 4);
      majorInterval = minorInterval * 5;
    } else if (portraitZoom >= 2) {
      minorInterval = Math.max(0.5, minorInterval / 2);
      majorInterval = minorInterval * 5;
    }

    for (let t = 0; t <= trimDuration; t += minorInterval) {
      const line = document.createElement('div');
      const isMajor = Math.abs(t % majorInterval) < 0.01 || Math.abs((t % majorInterval) - majorInterval) < 0.01;
      line.className = 'segment-grid-line' + (isMajor ? ' major' : '');
      line.style.left = `${(t / trimDuration) * 100}%`;
      grid.appendChild(line);
    }
  }

  // Render each segment (positioned relative to trim range)
  portraitSegments.forEach((seg, i) => {
    // Clamp segment times to trim range
    const segStart = Math.max(seg.startTime, trimStart);
    const segEnd = Math.min(seg.endTime, trimEnd);
    if (segEnd <= segStart) return; // Skip if outside trim range

    // Convert to percentage of trim range
    const startPos = (segStart - trimStart) / trimDuration;
    const endPos = (segEnd - trimStart) / trimDuration;

    const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];

    const el = document.createElement('div');
    el.className = 'portrait-segment' + (i === selectedSegmentIndex ? ' selected' : '');
    el.style.left = `${startPos * 100}%`;
    el.style.width = `${(endPos - startPos) * 100}%`;
    el.style.background = `linear-gradient(135deg, ${color}, ${adjustColor(color, -20)})`;
    el.dataset.index = i;

    // Add segment number label
    const label = document.createElement('span');
    label.className = 'segment-label';
    label.textContent = i + 1;
    el.appendChild(label);

    // Add resize handles
    const handleLeft = document.createElement('div');
    handleLeft.className = 'segment-handle segment-handle-left';
    handleLeft.dataset.segment = i;
    handleLeft.dataset.side = 'start';
    el.appendChild(handleLeft);

    const handleRight = document.createElement('div');
    handleRight.className = 'segment-handle segment-handle-right';
    handleRight.dataset.segment = i;
    handleRight.dataset.side = 'end';
    el.appendChild(handleRight);

    el.onclick = (e) => {
      e.stopPropagation();
      if (!e.target.classList.contains('segment-handle')) {
        selectSegment(i);
      }
    };

    timeline.appendChild(el);
  });

  initSegmentHandles();
}

// Helper to darken/lighten a hex color
function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function initSegmentHandles() {
  const handles = document.querySelectorAll('.segment-handle');

  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const segmentIndex = parseInt(handle.dataset.segment);
      const side = handle.dataset.side; // 'start' or 'end'
      const seg = portraitSegments[segmentIndex];
      if (!seg) return;

      const video = $('videoPreview');
      const wasPlaying = !video.paused;

      // Pause video and seek to the edge being adjusted
      video.pause();
      video.currentTime = side === 'start' ? seg.startTime : seg.endTime;

      // Select this segment
      selectedSegmentIndex = segmentIndex;
      portraitCropX = seg.cropX;
      updateCropOverlay();

      const onMove = (e) => {
        const timelineWrap = $('segment-timeline-wrap');
        const rect = timelineWrap.getBoundingClientRect();
        // Account for 8px padding on each side
        const innerWidth = rect.width - 16;
        const x = e.clientX - rect.left - 8;
        const viewportRatio = Math.max(0, Math.min(1, x / innerWidth));

        // Convert viewport position to time (relative to trim range)
        const trimStart = parseFloat($('trim-start')?.value) || 0;
        const trimEnd = parseFloat($('trim-end')?.value) || info.duration || 1;
        const trimDuration = trimEnd - trimStart;
        const newTime = trimStart + viewportRatio * trimDuration;

        if (side === 'start') {
          // Adjust start time - can't go past end - 0.5s, can't go before trim start
          const maxStart = seg.endTime - 0.5;
          seg.startTime = Math.max(trimStart, Math.min(maxStart, newTime));
          video.currentTime = seg.startTime;
        } else {
          // Adjust end time - can't go before start + 0.5s, can't go past trim end
          const minEnd = seg.startTime + 0.5;
          seg.endTime = Math.min(trimEnd, Math.max(minEnd, newTime));
          video.currentTime = seg.endTime;
        }

        renderPortraitSegments();
        updatePortraitUI();
        updatePortraitPlayhead();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Sort segments by start time after adjustment
        portraitSegments.sort((a, b) => a.startTime - b.startTime);
        // Update selected index after sort
        selectedSegmentIndex = portraitSegments.indexOf(seg);
        renderPortraitSegments();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function updatePortraitPlayhead() {
  const playhead = $('segment-playhead');
  const timeline = $('segment-timeline');
  if (!playhead || !timeline || activeTool !== 'portrait') return;

  const video = $('videoPreview');
  const currentTime = video.currentTime;

  // Get trim range - playhead is relative to this
  const trimStart = parseFloat($('trim-start')?.value) || 0;
  const trimEnd = parseFloat($('trim-end')?.value) || info.duration || 1;
  const trimDuration = trimEnd - trimStart;

  // Calculate position relative to trim range
  const normalizedPos = (currentTime - trimStart) / trimDuration;

  // Hide playhead if outside trim range
  if (normalizedPos < 0 || normalizedPos > 1) {
    playhead.style.opacity = '0';
  } else {
    playhead.style.opacity = '1';
    // Position aligned with the timeline area (8px inset from edges)
    playhead.style.left = `calc(8px + (100% - 16px) * ${normalizedPos})`;
  }

  // Check if we're in a gap - if so, skip to next segment during playback
  if (!video.paused) {
    const inSegment = portraitSegments.some(s => currentTime >= s.startTime && currentTime < s.endTime);
    if (!inSegment) {
      // Find the next segment to jump to
      const sortedSegments = [...portraitSegments].sort((a, b) => a.startTime - b.startTime);
      const nextSegment = sortedSegments.find(s => s.startTime > currentTime);
      if (nextSegment) {
        video.currentTime = nextSegment.startTime;
        return;
      } else {
        // No more segments, loop back to first segment
        if (sortedSegments.length > 0) {
          video.currentTime = sortedSegments[0].startTime;
          return;
        }
      }
    }
  }

  // Auto-select segment based on playhead position
  const segIndex = portraitSegments.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);
  if (segIndex !== -1 && segIndex !== selectedSegmentIndex) {
    selectedSegmentIndex = segIndex;
    portraitCropX = portraitSegments[segIndex].cropX;
    renderPortraitSegments();
    updatePortraitUI();
    updateCropOverlay();
  }
}

function updatePortraitUI() {
  // Update segment count
  const countEl = $('portrait-segment-count');
  if (countEl) {
    countEl.textContent = portraitSegments.length;
  }

  // Update output duration (sum of segments, not including gaps)
  const durationEl = $('portrait-total-duration');
  if (durationEl) {
    const outputDuration = portraitSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
    const totalDuration = info.duration || 1;
    const gapDuration = totalDuration - outputDuration;

    if (gapDuration > 0.5) {
      // Show output duration with cut indicator
      durationEl.textContent = formatDuration(outputDuration);
      durationEl.style.color = 'var(--warn)';
      durationEl.title = `${formatDuration(gapDuration)} will be cut`;
    } else {
      durationEl.textContent = formatDuration(outputDuration);
      durationEl.style.color = '';
      durationEl.title = '';
    }
  }

  // Update delete button state
  const deleteBtn = $('portrait-delete-btn');
  if (deleteBtn) {
    deleteBtn.disabled = portraitSegments.length <= 1;
  }

  // Update crop position label for current segment
  const cropPosEl = $('portrait-crop-position');
  if (cropPosEl) {
    const pos = portraitCropX;
    let label = 'Center';
    if (pos < 0.33) label = 'Left';
    else if (pos > 0.66) label = 'Right';
    cropPosEl.textContent = `${label} ${Math.round(pos * 100)}%`;
  }

  // Update auto-split button visibility
  updateAutoSplitButton();
}

function updateAutoSplitButton() {
  const btn = $('portrait-auto-split');
  if (btn) {
    btn.style.display = portraitSegments.length >= 8 ? 'none' : '';
  }
}

function updateSelectedSegmentCropX(cropX) {
  if (portraitSegments[selectedSegmentIndex]) {
    portraitSegments[selectedSegmentIndex].cropX = cropX;
    updatePortraitUI();
  }
}

function updateTransitionUI() {
  const transition = $('portrait-transition').value;
  const durationSlider = $('portrait-transition-duration');
  const durationVal = $('portrait-transition-duration-val');
  const row = durationSlider?.closest('.portrait-transition-row');

  // Disable duration slider if transition is 'none'
  if (transition === 'none') {
    if (durationSlider) durationSlider.disabled = true;
    if (durationVal) durationVal.style.opacity = '0.4';
  } else {
    if (durationSlider) durationSlider.disabled = false;
    if (durationVal) durationVal.style.opacity = '1';
  }

  // Update duration label
  if (durationVal && durationSlider) {
    durationVal.textContent = durationSlider.value + 's';
  }
}

function initPortraitTimelineZoom() {
  const timelineWrap = $('segment-timeline-wrap');
  const timeline = $('segment-timeline');
  if (!timelineWrap || !timeline) return;

  let isPanning = false;
  let panStartX = 0;
  let panStartOffset = 0;

  // Wheel zoom
  timelineWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = timeline.getBoundingClientRect();
    const duration = info.duration || 1;

    // Get cursor position as fraction of viewport (0-1)
    const cursorViewportPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    // Convert cursor position to time position (accounting for current zoom/offset)
    const visibleDuration = duration / portraitZoom;
    const visibleStart = portraitOffset * duration;
    const cursorTime = visibleStart + cursorViewportPct * visibleDuration;
    const cursorPosition = cursorTime / duration;

    // Zoom in/out
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    portraitZoom = Math.max(1, Math.min(8, portraitZoom + delta * portraitZoom));

    if (portraitZoom <= 1.01) {
      portraitZoom = 1;
      portraitOffset = 0;
      timelineWrap.classList.remove('zoomed');
    } else {
      // Adjust offset to keep cursor position stable
      const visibleAfter = 1 / portraitZoom;
      portraitOffset = Math.max(0, Math.min(1 - visibleAfter, cursorPosition - cursorViewportPct * visibleAfter));
      timelineWrap.classList.add('zoomed');
    }

    renderPortraitSegments();
    updatePortraitPlayhead();
  }, { passive: false });

  // Pan with drag when zoomed
  timelineWrap.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('segment-handle') || e.target.classList.contains('portrait-segment')) return;
    if (portraitZoom > 1) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartOffset = portraitOffset;
      timelineWrap.classList.add('panning');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const rect = timelineWrap.getBoundingClientRect();
    const dx = (e.clientX - panStartX) / rect.width;
    const visibleFraction = 1 / portraitZoom;
    portraitOffset = Math.max(0, Math.min(1 - visibleFraction, panStartOffset - dx * visibleFraction));
    renderPortraitSegments();
    updatePortraitPlayhead();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      timelineWrap.classList.remove('panning');
    }
  });
}

// ============ PAGE ZOOM LOCK ============

function initPageZoomLock() {
  // Prevent ctrl+wheel zoom on page except video player
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      // Allow zoom only on video preview
      const isOnVideo = e.target.closest('#previewWrap') || e.target.closest('#videoPreview');
      if (!isOnVideo) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  // Prevent ctrl+plus/minus zoom
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });

  // Prevent pinch zoom on touch devices
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      const isOnVideo = e.target.closest('#previewWrap') || e.target.closest('#videoPreview');
      if (!isOnVideo) {
        e.preventDefault();
      }
    }
  }, { passive: false });
}

// ============ PROCESS ============

async function process() {
  if (!activeTool) return;

  $('loading').classList.add('on');
  $('loading').querySelector('span').textContent = 'Processing...';

  const opts = { tool: activeTool };

  switch (activeTool) {
    case 'compress':
      opts.bitrate = parseInt($('compress-bitrate').value);
      opts.preset = $('compress-preset').value;
      opts.codec = $('compress-codec').value || 'h264';
      break;
    case 'togif':
      opts.fps = parseInt($('togif-fps').value);
      opts.width = parseInt($('togif-width').value);
      opts.dither = $('togif-dither').value;
      break;
    case 'mkv2mp4':
      opts.copyStreams = mkvFastCopy;
      opts.crf = parseInt($('mkv2mp4-quality').value);
      break;
    case 'shrink':
      opts.targetDuration = parseFloat($('shrink-duration').value);
      break;
    case 'trim':
      opts.trimStart = parseFloat($('trim-start').value);
      opts.trimEnd = parseFloat($('trim-end').value);
      opts.accurate = $('trim-accurate').value === 'true';
      break;
    case 'thumb':
      // Check if user selected a frame or uploaded an image
      if ($('thumb-timestamp').value) {
        opts.thumbTimestamp = parseFloat($('thumb-timestamp').value);
      } else if ($('thumb-image').value) {
        opts.imagePath = $('thumb-image').value;
      } else {
        $('loading').classList.remove('on');
        alert('Click "Use This Frame" or drop an image');
        return;
      }
      break;
    case 'audio':
      opts.audioPath = $('audio-path').value;
      opts.audioVolume = audioVolume / 100;
      opts.audioMix = audioMix;
      if (!opts.audioPath) {
        $('loading').classList.remove('on');
        alert('Please select an audio file');
        return;
      }
      break;
    case 'extractaudio':
      opts.audioFormat = $('extract-audio-format').value || 'mp3';
      opts.audioBitrate = parseInt($('extract-audio-bitrate').value) || 192;
      break;
    case 'portrait':
      opts.mode = 'crop';
      opts.resolution = 1080;
      // Send segments array for multi-segment processing
      opts.segments = portraitSegments.map(seg => ({
        id: seg.id,
        startTime: seg.startTime,
        endTime: seg.endTime,
        cropX: seg.cropX
      }));
      // Transition options (only for multi-segment)
      opts.transition = $('portrait-transition').value || 'none';
      opts.transitionDuration = parseFloat($('portrait-transition-duration').value) || 0.3;
      break;
    case 'filter':
      // Convert UI values to FFmpeg ranges
      // Brightness: UI -100 to 100 (0 = normal) -> FFmpeg -1 to 1 (0 = normal)
      opts.filterBrightness = filterState.brightness / 100;
      // Contrast: UI 0-200 (100 = normal) -> FFmpeg 0-2 (1 = normal)
      opts.filterContrast = filterState.contrast / 100;
      // Saturation: UI 0-200 (100 = normal) -> FFmpeg 0-2 (1 = normal)
      opts.filterSaturation = filterState.saturation / 100;
      opts.filterBlur = filterState.blurEnabled ? filterState.blur : 0;
      opts.filterSharpen = filterState.sharpen;
      opts.filterVignette = filterState.vignette;
      // Filter presets
      opts.filterGrayscale = filterState.filterPreset === 'grayscale';
      opts.filterSepia = filterState.filterPreset === 'sepia' || filterState.filterPreset === 'vintage';

      // Check if any filter is active
      const hasFilters = opts.filterBrightness !== 0 ||
        opts.filterContrast !== 1 ||
        opts.filterSaturation !== 1 ||
        opts.filterBlur > 0 ||
        opts.filterGrayscale ||
        opts.filterSepia ||
        opts.filterSharpen ||
        opts.filterVignette ||
        filterState.filterPreset !== 'none';

      if (!hasFilters) {
        $('loading').classList.remove('on');
        alert('No filters selected');
        return;
      }
      break;
    case 'caption':
      opts.srtContent = captionSrtContent;
      opts.captionFontSize = parseInt($('caption-size').value) || 48;
      opts.captionPosition = $('caption-position').value || 'bottom';
      break;
  }

  try {
    const res = await postJson('/api/process', opts);
    $('loading').classList.remove('on');

    if (res.success) {
      // Mark tool as done
      const toolEl = $('t-' + activeTool);
      if (toolEl) toolEl.classList.add('done');

      // Store output path
      if (res.output) currentFilePath = res.output;

      // Handle output based on tool type
      if (activeTool === 'togif') {
        // GIF - show done modal with continue (but don't reload GIF as source)
        $('done').classList.add('on', 'ok');
        $('done').classList.remove('err');
        $('output').textContent = res.output || 'Done!';
        $('continueBtn').classList.remove('hidden');
        // Don't update currentFilePath - keep original video loaded
        skipReloadOnContinue = true;
      } else if (activeTool === 'trim' || activeTool === 'mkv2mp4') {
        // Trim/MKV - show done modal with continue button
        $('done').classList.add('on', 'ok');
        $('done').classList.remove('err');
        $('output').textContent = res.output || 'Done!';
        $('continueBtn').classList.remove('hidden');
        // Store output path for Continue button
        if (res.output) {
          currentFilePath = res.output;
        }
        skipReloadOnContinue = false;
      } else if (res.output) {
        // Other tools - auto-load and show toast
        await loadOutputAsSource(res.output);
        showToast('Applied: ' + activeTool);
      }
    } else {
      $('done').classList.add('on', 'err');
      $('done').classList.remove('ok');
      $('output').textContent = res.error || 'Processing failed';
    }
  } catch (err) {
    $('loading').classList.remove('on');
    $('done').classList.add('on', 'err');
    $('done').classList.remove('ok');
    $('output').textContent = err.message || 'Processing failed';
  }
}

/**
 * Load output video as new source
 */
async function loadOutputAsSource(filePath) {
  try {
    const res = await postJson('/api/load', { filePath });
    if (res.success) {
      info.filePath = filePath;
      info.fileName = res.fileName || filePath.split(/[\\/]/).pop();
      info.width = res.width || info.width;
      info.height = res.height || info.height;
      info.duration = res.duration || info.duration;
      info.fps = res.fps || info.fps;
      info.bitrate = res.bitrate || info.bitrate;
      info.fileSize = res.fileSize || info.fileSize;
      currentFilePath = filePath;

      // Update MKV state based on file extension
      const ext = filePath.split('.').pop()?.toLowerCase();
      isMkvFile = ext === 'mkv';
      $('t-mkv2mp4').classList.toggle('hidden', !isMkvFile);

      updateFileDisplay();

      // Update video source
      const video = $('videoPreview');
      video.src = '/api/video?t=' + Date.now();

      // Reset frame cache for new video
      frameCache = [];
      frameCacheReady = false;
      video.addEventListener('canplaythrough', () => {
        if (!frameCacheReady && frameCache.length === 0) {
          setTimeout(() => buildFrameCache(), 100);
        }
      }, { once: true });

      // Reset and update trim timeline for new duration
      $('trim-start').value = 0;
      $('trim-end').value = info.duration;
      clearMatchMarkers();
      updateTimeline();

      // Reset portrait state for new video
      portraitSegmentsInitialized = false;
      portraitSegments = [];

      // Update shrink slider and 60s button (10x max speed limit)
      const shrinkMin = Math.max(1, Math.ceil(info.duration / 10));
      $('shrink-duration').min = shrinkMin;
      $('shrink-duration').max = Math.floor(info.duration);
      $('shrink-duration').value = Math.min(60, Math.max(shrinkMin, Math.floor(info.duration)));
      updateShrinkLabel();
      const show60s = info.duration > 60 && 60 >= shrinkMin;
      $('shrink-60-btn').classList.toggle('hidden', !show60s);
      $('shrink-marker-60').classList.toggle('hidden', !show60s);

      // Update Find Match button visibility (only for short videos)
      const isNowShort = info.duration <= 60;
      $('find-match-btn').classList.toggle('hidden', !isNowShort);

      // Show star and glow hint when loop feature becomes available after processing
      if (isNowShort && !window.trimStarDismissed) {
        showTrimStar();
        $('find-match-btn').classList.add('new-feature');
      }

      // Update thumbnail aspect ratio
      updateThumbAspectRatio();

      // Update GIF visibility based on duration (max 20s) and show star/glow if newly available
      const canExportGif = info.duration <= 20;
      $('t-togif').classList.toggle('hidden', !canExportGif);
      if (canExportGif && !window.gifStarDismissed) {
        showGifStar();
      }

      // Update landscape tools visibility
      // Show Portrait for all videos except 9:16 (already portrait)
      const aspectRatio = info.width / info.height;
      const isAlreadyPortrait = Math.abs(aspectRatio - 9/16) < 0.05;
      $('t-portrait').classList.toggle('hidden', isAlreadyPortrait);

      // Update Extract Audio visibility - only show if video has audio
      const extractAudioBtn = $('t-extractaudio');
      if (extractAudioBtn) {
        extractAudioBtn.classList.toggle('hidden', !info.hasAudio);
      }

      // Select next uncompleted tool, or first available if all done
      if (isMkvFile) {
        selectTool('mkv2mp4');
      } else {
        // Prefer uncompleted tools, but fall back to any visible tool
        const nextTool = document.querySelector('.tool:not(.hidden):not(.disabled):not(.done)') ||
                         document.querySelector('.tool:not(.hidden):not(.disabled)');
        if (nextTool) {
          selectTool(nextTool.id.replace('t-', ''));
        }
      }

      return true;
    }
  } catch (err) {
    console.error('Load output error:', err);
  }
  return false;
}

/**
 * Show a brief toast notification
 */
function showToast(message) {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function showLoopTooltip() {
  // Only show once per session
  if (window.loopTooltipShown) return;
  window.loopTooltipShown = true;

  // Wait for trim tab to be visible
  setTimeout(() => {
    const btn = $('find-match-btn');
    if (!btn || btn.classList.contains('hidden')) return;

    let tooltip = document.createElement('div');
    tooltip.className = 'feature-tooltip';
    tooltip.innerHTML = '<span>✨</span> Loop detection available for short videos';
    btn.parentElement.appendChild(tooltip);

    // Position near button
    setTimeout(() => tooltip.classList.add('show'), 100);
    setTimeout(() => {
      tooltip.classList.remove('show');
      setTimeout(() => tooltip.remove(), 300);
    }, 4000);
  }, 500);
}

function showFeatureBadge(toolId, badgeId, text) {
  const tool = $(toolId);
  if (!tool || tool.classList.contains('hidden')) return;

  // Don't show if already exists
  if ($(badgeId)) return;

  const badge = document.createElement('span');
  badge.id = badgeId;
  badge.className = 'feature-badge';
  badge.textContent = text;
  tool.appendChild(badge);

  // Animate in
  setTimeout(() => badge.classList.add('show'), 50);
}

function hideFeatureBadge(badgeId) {
  const badge = $(badgeId);
  if (badge) {
    badge.classList.remove('show');
    setTimeout(() => badge.remove(), 300);
  }
}

function showTrimStar() {
  if (window.trimStarDismissed) return;
  const tool = $('t-trim');
  if (!tool || $('trim-star') || tool.classList.contains('done')) return;

  // Add animated star next to trim label
  const star = document.createElement('span');
  star.id = 'trim-star';
  star.className = 'feature-star';
  star.innerHTML = '★';
  tool.appendChild(star);

  // Add glow animation to the tab
  tool.classList.add('new-feature');

  setTimeout(() => star.classList.add('show'), 50);
}

function hideTrimStar() {
  window.trimStarDismissed = true;
  const star = $('trim-star');
  const tool = $('t-trim');

  if (star) {
    star.classList.remove('show');
    setTimeout(() => star.remove(), 300);
  }

  // Remove glow from trim tab
  tool?.classList.remove('new-feature');
}

function showGifBadge() {
  if (window.gifBadgeDismissed) return;
  showFeatureBadge('t-togif', 'gif-badge', 'GIF Unlocked');
}

function hideGifBadge() {
  window.gifBadgeDismissed = true;
  hideFeatureBadge('gif-badge');
}

function showGifStar() {
  if (window.gifStarDismissed) return;
  const tool = $('t-togif');
  if (!tool || tool.classList.contains('hidden') || tool.classList.contains('done') || $('gif-star')) return;

  // Add animated star next to GIF label
  const star = document.createElement('span');
  star.id = 'gif-star';
  star.className = 'feature-star';
  star.innerHTML = '★';
  tool.appendChild(star);

  // Add glow animation to the tab
  tool.classList.add('new-feature');

  setTimeout(() => star.classList.add('show'), 50);
}

function hideGifStar() {
  window.gifStarDismissed = true;
  const star = $('gif-star');
  const tool = $('t-togif');

  if (star) {
    star.classList.remove('show');
    setTimeout(() => star.remove(), 300);
  }

  // Remove glow from GIF tab
  tool?.classList.remove('new-feature');
}

function showNoMatchesMessage() {
  const btn = $('find-match-btn');
  const msg = $('no-matches-msg');

  if (btn) btn.classList.add('hidden');

  if (!msg) {
    const noMatchMsg = document.createElement('span');
    noMatchMsg.id = 'no-matches-msg';
    noMatchMsg.className = 'no-matches-msg';
    noMatchMsg.textContent = 'No matching frames found';
    $('find-match-btn').parentElement.appendChild(noMatchMsg);
  } else {
    msg.classList.remove('hidden');
  }
}

function hideNoMatchesMessage() {
  const msg = $('no-matches-msg');
  const btn = $('find-match-btn');

  if (msg) msg.classList.add('hidden');
  if (btn && info.duration <= 60) btn.classList.remove('hidden');
}

async function continueEditing() {
  $('done').classList.remove('on');

  // Skip reload for GIF export (keeps original video)
  if (skipReloadOnContinue) {
    skipReloadOnContinue = false;
    return;
  }

  if (currentFilePath) {
    // Show loading animation
    $('loading').classList.add('on');
    $('loading').querySelector('span').textContent = 'Loading video...';

    await loadOutputAsSource(currentFilePath);

    $('loading').classList.remove('on');
  }
}

// ============ CAPTION TOOL ============

// Default test SRT content
const DEFAULT_SRT = `1
00:00:00,500 --> 00:00:03,000
This is a sample caption

2
00:00:03,500 --> 00:00:06,500
With karaoke style highlighting

3
00:00:07,000 --> 00:00:10,000
Words light up as they play
`;

let captionSrtContent = DEFAULT_SRT;
let captionUsingDefault = true;

function initCaptionTool() {
  // Initialize segmented button handlers
  ['captionPosition', 'captionSize'].forEach(groupId => {
    const group = $(groupId);
    if (!group) return;
    group.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const hiddenId = groupId === 'captionPosition' ? 'caption-position' : 'caption-size';
        $(hiddenId).value = btn.dataset.val;
        updateCaptionPreview();
      };
    });
  });

  // Initialize drop zone
  const dropZone = $('srtDropZone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      const input = $('srtFileInput');
      input.files = e.dataTransfer.files;
      handleSrtFile(input);
    }
  });

  updateCaptionPreview();
}

function handleSrtFile(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      captionSrtContent = e.target.result;
      captionUsingDefault = false;
      $('srtFileName').textContent = file.name;
      $('srtDropZone').classList.add('has-file');
      $('captionStatus').textContent = `Loaded: ${file.name}`;
      updateCaptionPreview();
    };
    reader.readAsText(file);
  }
}

function updateCaptionPreview() {
  const overlay = $('captionOverlay');
  const textEl = $('captionOverlayText');
  if (!overlay || !textEl) return;

  // Parse first subtitle for preview
  const lines = captionSrtContent.split('\n');
  let previewText = 'Sample caption text';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('-->') && i + 1 < lines.length) {
      previewText = lines[i + 1].trim();
      break;
    }
  }

  // Add highlight to first word
  const words = previewText.split(' ');
  if (words.length > 0) {
    words[0] = `<span class="highlight">${words[0]}</span>`;
  }
  textEl.innerHTML = words.join(' ');

  // Update position class
  const position = $('caption-position')?.value || 'bottom';
  overlay.classList.remove('pos-top', 'pos-center');
  if (position === 'top') overlay.classList.add('pos-top');
  else if (position === 'center') overlay.classList.add('pos-center');

  // Scale font size based on video preview height
  const size = parseInt($('caption-size')?.value) || 48;
  const video = $('videoPreview');
  const scale = video ? video.clientHeight / 720 : 0.4;
  const previewSize = Math.round(size * scale);
  textEl.style.fontSize = Math.max(12, previewSize) + 'px';
}

// ============ CONFIRM MODAL ============

let confirmResolve = null;

function showConfirmModal(options = {}) {
  const {
    title = 'Confirm Action',
    message = 'Are you sure?',
    okText = 'OK',
    cancelText = 'Cancel',
    icon = 'info' // 'info', 'warning', 'danger'
  } = options;

  $('confirmTitle').textContent = title;
  $('confirmMessage').innerHTML = message;
  $('confirmOkBtn').textContent = okText;

  const iconEl = $('confirmIcon');
  iconEl.className = 'confirm-icon';
  if (icon === 'warning') iconEl.classList.add('warning');
  else if (icon === 'danger') iconEl.classList.add('danger');

  $('confirmModal').classList.add('on');
  $('confirmOkBtn').focus();

  // Keyboard handler
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeConfirmModal(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      closeConfirmModal(true);
    }
  };
  document.addEventListener('keydown', keyHandler);

  return new Promise(resolve => {
    confirmResolve = (result) => {
      document.removeEventListener('keydown', keyHandler);
      resolve(result);
    };
  });
}

function closeConfirmModal(result) {
  $('confirmModal').classList.remove('on');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
