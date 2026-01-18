/**
 * VidLet App - Main application logic
 */
const { $, log, postJson, formatDuration } = VidLet;

// App state
let info = {};
let activeTool = null;
let homepage = 'https://vidlet.app';
let currentFilePath = null;

// Tool states
let mkvFastCopy = true;
let portraitCropX = 0.5;
let audioMix = true;
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

// Timeline zoom state
let timelineZoom = 1;
let timelineOffset = 0; // 0-1, represents the left edge position as fraction of duration

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
  $('shrink-duration').max = Math.floor(res.duration);
  $('shrink-duration').value = Math.min(60, Math.floor(res.duration));
  updateShrinkLabel();

  // Hide 60s button if video <= 60s
  const show60s = res.duration > 60;
  $('shrink-60-btn').classList.toggle('hidden', !show60s);
  $('shrink-marker-60').classList.toggle('hidden', !show60s);

  // Show Find Match button only for short videos (<60s)
  const isShortVideo = res.duration <= 60;
  $('find-match-btn').classList.toggle('hidden', !isShortVideo);

  // Pre-initialize frame matching in background for short videos
  if (isShortVideo) {
    preloadPromise = preloadMatches();
  }

  if (res.defaults?.homepage) {
    homepage = res.defaults.homepage;
    $('homepageLink').textContent = homepage.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  // Show MKV→MP4 only for MKV files
  if (res.defaults?.isMkv) {
    $('t-mkv2mp4').classList.remove('hidden');
  }

  // Show Portrait only for landscape videos
  if (res.defaults?.isLandscape) {
    $('t-portrait').classList.remove('hidden');
  }

  // Hide GIF export for long videos (>15s)
  $('t-togif').classList.toggle('hidden', res.duration > 15);

  // Initialize trim timeline
  $('trim-end').value = res.duration;
  updateTimeline();
  initTimelineHandles();
  initTimelineZoom();

  initCropOverlay();
  initPlayerControls();
  initResizeDivider();
  initDropZones();
  initVideoZoom();
  setupAudioPreviewSync();

  updateCompressLabels();
  const defaultPresets = getCompressPresets();
  $('compress-bitrate').value = defaultPresets.medium.bitrate;
  updateEstimates();

  if (window.lucide) lucide.createIcons();

  // Select first tool
  const firstTool = document.querySelector('.tool:not(.hidden):not(.disabled)');
  if (firstTool) {
    selectTool(firstTool.id.replace('t-', ''));
  }

  // Signal ready to close loading HTA
  postJson('/api/ready', {});
}

function updateFileDisplay() {
  $('fileName').textContent = ' ' + info.fileName;
  $('size').textContent = ' ' + `${info.width}×${info.height}`;
  $('duration').textContent = ' ' + formatDuration(info.duration);
  $('fps').textContent = ' ' + (info.fps ? info.fps.toFixed(1) : '-');
}

// ============ TOOL SELECTION ============

function selectTool(id) {
  if (activeTool === 'audio' && id !== 'audio') {
    stopAudioPreview();
  }

  document.querySelectorAll('.tool').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.opts').forEach(o => o.classList.remove('active'));

  const el = $('t-' + id);
  const opts = $('opts-' + id);

  $('cropOverlay').classList.remove('active');

  if (el && !el.classList.contains('disabled') && !el.classList.contains('done')) {
    el.classList.add('active');
    if (opts) opts.classList.add('active');
    activeTool = id;
    $('processBtn').disabled = false;

    if (id === 'portrait') {
      $('cropOverlay').classList.add('active');
      updateCropOverlay();
    }

    if (id === 'trim') {
      const video = $('videoPreview');
      video.currentTime = parseFloat($('trim-start').value) || 0;
    }

    if (id === 'audio') {
      startAudioPreview();
      updateVolumeUI();
    }
  } else {
    activeTool = null;
    $('processBtn').disabled = true;
  }
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
  setSegBtn('settingsCompressCodec', $('compress-codec').value || 'h264');
  setSegBtn('settingsGifFps', $('togif-fps').value);
  setSegBtn('settingsGifWidth', $('togif-width').value);
  setSegBtn('settingsMkvQuality', $('mkv2mp4-quality').value);
  setSegBtn('settingsShrinkTarget', Math.round(parseFloat($('shrink-duration').value)));
  setSegBtn('settingsTrimMode', $('trim-accurate').value === 'true' ? 'accurate' : 'fast');

  $('settingsModal').classList.add('on');
}

function closeSettings() {
  const qualityPresetMap = { fast: 'veryfast', medium: 'medium', slow: 'slow' };
  const quality = getSegVal('settingsCompressQuality');
  $('compress-preset').value = qualityPresetMap[quality] || 'medium';

  const codec = getSegVal('settingsCompressCodec');
  if (codec) $('compress-codec').value = codec;

  const fps = getSegVal('settingsGifFps');
  const width = getSegVal('settingsGifWidth');
  if (fps) $('togif-fps').value = fps;
  if (width) $('togif-width').value = width;

  const crf = getSegVal('settingsMkvQuality');
  if (crf) $('mkv2mp4-quality').value = crf;

  const shrinkTarget = getSegVal('settingsShrinkTarget');
  if (shrinkTarget) {
    $('shrink-duration').value = shrinkTarget;
    updateShrinkLabel();
  }

  const trimMode = getSegVal('settingsTrimMode');
  $('trim-accurate').value = trimMode === 'accurate' ? 'true' : 'false';

  $('settingsModal').classList.remove('on');
}

function setSegBtn(groupId, val) {
  const group = $(groupId);
  if (!group) return;
  group.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
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
  $('shrink-estimate').textContent = `Speed: ${speedMultiplier}x faster`;
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
  timeline.style.transform = `translateX(${-timelineOffset * 100 * timelineZoom}%)`;

  // Position handles and range (as percentage of full duration)
  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  $('timeline-range').style.left = startPct + '%';
  $('timeline-range').style.width = (endPct - startPct) + '%';
  $('handle-start').style.left = 'calc(' + startPct + '% - 6px)';
  $('handle-end').style.left = 'calc(' + endPct + '% - 6px)';

  // Update info badges
  const outputDuration = Math.max(0, end - start);
  $('trim-start-badge').textContent = formatTimeMs(start);
  $('trim-end-badge').textContent = formatTimeMs(end);
  $('trim-duration-badge').textContent = outputDuration.toFixed(1) + 's';

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

function initTimelineZoom() {
  const container = $('timeline-container');
  const viewport = $('timeline-viewport');

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = viewport.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;

    // Zoom in/out
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    const oldZoom = timelineZoom;
    timelineZoom = Math.max(1, Math.min(10, timelineZoom + delta * timelineZoom));

    if (timelineZoom === 1) {
      timelineOffset = 0;
    } else {
      // Adjust offset to zoom toward mouse position
      const visibleBefore = 1 / oldZoom;
      const visibleAfter = 1 / timelineZoom;
      const mouseTime = timelineOffset + mouseX * visibleBefore;
      timelineOffset = Math.max(0, Math.min(1 - visibleAfter, mouseTime - mouseX * visibleAfter));
    }

    updateTimeline();
    renderMatchMarkers();
  }, { passive: false });

  // Pan with middle mouse or shift+drag
  let isPanning = false;
  let panStartX = 0;
  let panStartOffset = 0;

  viewport.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartOffset = timelineOffset;
      viewport.style.cursor = 'grabbing';
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
      viewport.style.cursor = '';
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
    } else {
      const startVal = parseFloat($('trim-start').value);
      const minEnd = startVal + 0.1;
      const newEnd = Math.min(info.duration, Math.max(time, minEnd));
      $('trim-end').value = newEnd.toFixed(2);
      video.currentTime = Math.max(0, newEnd - 0.5);
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
}

/**
 * Pre-load matches in background during loading screen
 */
async function preloadMatches() {
  try {
    const res = await postJson('/api/find-matches', { referenceTime: 0, minGap: 3 });
    if (res.success && res.matches) {
      preloadedMatches = res.matches;
    }
  } catch (err) {
    console.error('Preload matches error:', err);
  }
}

async function findMatchingFrames() {
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

      // Auto-select first match
      $('trim-end').value = matchMarkers[0].time.toFixed(2);
      updateTimeline();
    } else {
      clearMatchMarkers();
    }
  } catch (err) {
    console.error('Find match error:', err);
    clearMatchMarkers();
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
    $('thumbFileName').textContent = 'Uploading...';
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        $('thumbPreview').src = e.target.result;
        $('thumbPreviewWrap').classList.add('has-image');
      };
      reader.readAsDataURL(file);

      const path = await uploadFile(file, 'image');
      $('thumb-image').value = path;
      $('thumbFileName').textContent = 'Click to change';
    } catch (err) {
      $('thumbFileName').textContent = 'Upload failed: ' + err.message;
      $('thumbPreviewWrap').classList.remove('has-image');
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

  const thumbZone = $('thumbPreviewWrap');
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

function updateTimeDisplay() {
  const video = $('videoPreview');
  if (!video.duration) return;

  const pct = (video.currentTime / video.duration) * 100;
  $('playerProgress').style.width = pct + '%';
  $('playerThumb').style.left = pct + '%';
  $('playerTime').textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
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

  seek.addEventListener('click', (e) => {
    const rect = seek.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  });

  volumeSlider.addEventListener('click', (e) => {
    const rect = volumeSlider.getBoundingClientRect();
    const vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.volume = vol;
    video.muted = false;
    updateVolumeUI();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space': e.preventDefault(); togglePlay(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyJ': adjustSpeed(-0.5); break;
      case 'KeyK': resetSpeed(); break;
      case 'KeyL': adjustSpeed(0.5); break;
      case 'ArrowLeft': e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break;
      case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration, video.currentTime + 5); break;
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

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(1, Math.min(5, videoZoom + delta));

    if (newZoom === 1) {
      resetZoom();
    } else {
      videoZoom = newZoom;
      const maxPan = (videoZoom - 1) * 50;
      videoPanX = Math.max(-maxPan, Math.min(maxPan, videoPanX));
      videoPanY = Math.max(-maxPan, Math.min(maxPan, videoPanY));
      updateVideoTransform();
    }
  }, { passive: false });

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
    const maxPan = (videoZoom - 1) * 50;
    videoPanX = Math.max(-maxPan, Math.min(maxPan, startPanX + dx));
    videoPanY = Math.max(-maxPan, Math.min(maxPan, startPanY + dy));
    updateVideoTransform();
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      wrap.classList.remove('panning');
    }
  });
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
      opts.imagePath = $('thumb-image').value;
      if (!opts.imagePath) {
        $('loading').classList.remove('on');
        alert('Please select a thumbnail image');
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
    case 'portrait':
      opts.mode = 'crop';
      opts.cropX = portraitCropX;
      opts.resolution = 1080;
      break;
  }

  try {
    const res = await postJson('/api/process', opts);
    $('loading').classList.remove('on');

    if (res.success) {
      $('done').classList.add('on', 'ok');
      $('done').classList.remove('err');
      $('output').textContent = res.output || 'Done!';

      // Hide continue for GIF export
      $('continueBtn').classList.toggle('hidden', activeTool === 'togif');

      // Mark tool as done
      const toolEl = $('t-' + activeTool);
      if (toolEl) toolEl.classList.add('done');

      // Store output for continue
      if (res.output) currentFilePath = res.output;
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

async function continueEditing() {
  $('done').classList.remove('on');

  if (currentFilePath) {
    try {
      const res = await postJson('/api/load', { filePath: currentFilePath });
      if (res.success) {
        info.filePath = currentFilePath;
        info.fileName = res.fileName || currentFilePath.split(/[\\/]/).pop();
        info.width = res.width || info.width;
        info.height = res.height || info.height;
        info.duration = res.duration || info.duration;
        info.fps = res.fps || info.fps;
        updateFileDisplay();
        $('videoPreview').src = '/api/video?t=' + Date.now();
      }
    } catch (err) {
      console.error('Continue error:', err);
    }
  }

  // Reset done state on tools
  document.querySelectorAll('.tool.done').forEach(t => t.classList.remove('done'));

  // Select first available tool
  const firstTool = document.querySelector('.tool:not(.hidden):not(.disabled)');
  if (firstTool) selectTool(firstTool.id.replace('t-', ''));
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
