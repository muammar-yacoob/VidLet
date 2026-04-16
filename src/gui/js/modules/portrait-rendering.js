/**
 * Portrait Tool Rendering Module
 * Handles segment rendering, grid lines, and visual updates
 */

(() => {
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

  /**
   * Render portrait segments on timeline
   * @param {Object} params - Rendering parameters
   * @param {Array} params.segments - Segment array
   * @param {number} params.selectedIndex - Currently selected segment index
   * @param {number} params.zoom - Current zoom level
   * @param {Function} params.onSegmentClick - Callback when segment is clicked
   * @param {Function} params.onHandleInit - Callback to initialize handles
   */
  function renderSegments({ segments, selectedIndex, zoom, onSegmentClick, onHandleInit }) {
    const V = window.VidLet;
    const timeline = V.$('segment-timeline');
    const grid = V.$('segment-grid');
    if (!timeline) return;

    timeline.innerHTML = '';

    // Get trim range - portrait timeline is normalized to this range
    const trimStart = Number.parseFloat(V.$('trim-start')?.value) || 0;
    const trimEnd = Number.parseFloat(V.$('trim-end')?.value) || V.state.info.duration || 1;
    const trimDuration = trimEnd - trimStart;

    // Render grid lines
    if (grid) {
      grid.innerHTML = '';
      // Determine grid interval based on duration and zoom
      let minorInterval =
        trimDuration <= 10 ? 1 : trimDuration <= 30 ? 2 : trimDuration <= 60 ? 5 : 10;
      let majorInterval = minorInterval * 5;
      if (zoom >= 4) {
        minorInterval = Math.max(0.5, minorInterval / 4);
        majorInterval = minorInterval * 5;
      } else if (zoom >= 2) {
        minorInterval = Math.max(0.5, minorInterval / 2);
        majorInterval = minorInterval * 5;
      }

      for (let t = 0; t <= trimDuration; t += minorInterval) {
        const line = document.createElement('div');
        const isMajor =
          Math.abs(t % majorInterval) < 0.01 ||
          Math.abs((t % majorInterval) - majorInterval) < 0.01;
        line.className = `segment-grid-line${isMajor ? ' major' : ''}`;
        line.style.left = `${(t / trimDuration) * 100}%`;
        grid.appendChild(line);
      }
    }

    // Render each segment (positioned relative to trim range)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      // Clamp segment times to trim range
      const segStart = Math.max(seg.startTime, trimStart);
      const segEnd = Math.min(seg.endTime, trimEnd);
      if (segEnd <= segStart) continue; // Skip if outside trim range

      // Convert to percentage of trim range
      const startPos = (segStart - trimStart) / trimDuration;
      const endPos = (segEnd - trimStart) / trimDuration;

      const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];

      const el = document.createElement('div');
      el.className = `portrait-segment${i === selectedIndex ? ' selected' : ''}`;
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
          onSegmentClick(i);
        }
      };

      timeline.appendChild(el);
    }

    // Initialize segment handles
    if (onHandleInit) {
      onHandleInit();
    }
  }

  /**
   * Helper to darken/lighten a hex color
   * @param {string} hex - Hex color code
   * @param {number} amount - Amount to adjust (-255 to 255)
   * @returns {string} Adjusted hex color
   */
  function adjustColor(hex, amount) {
    const num = Number.parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  /**
   * Render keyframe markers on timeline
   * @param {Array} keyframes - Array of keyframe objects {time, cropX}
   * @param {Function} onKeyframeClick - Callback when keyframe is clicked
   */
  function renderKeyframes(keyframes, onKeyframeClick) {
    const V = window.VidLet;
    const timeline = V.$('segment-timeline');
    if (!timeline) return;

    // Remove existing keyframe markers
    for (const m of timeline.querySelectorAll('.keyframe-marker')) {
      m.remove();
    }

    const duration = V.state.info.duration || 1;
    for (const kf of keyframes) {
      const marker = document.createElement('div');
      marker.className = 'keyframe-marker';
      marker.style.left = `${(kf.time / duration) * 100}%`;
      marker.title = `${kf.time.toFixed(1)}s: ${Math.round(kf.cropX * 100)}%`;
      marker.onclick = (e) => {
        e.stopPropagation();
        if (onKeyframeClick) {
          onKeyframeClick(kf);
        }
      };
      timeline.appendChild(marker);
    }
  }

  /**
   * Update playhead position on timeline
   * @param {number} currentTime - Current video time
   * @returns {number|null} Index of segment at current time, or null if in gap
   */
  function updatePlayhead(currentTime, segments) {
    const V = window.VidLet;
    const playhead = V.$('segment-playhead');
    const timeline = V.$('segment-timeline');
    if (!playhead || !timeline || V.state.activeTool !== 'portrait') return null;

    // Get trim range - playhead is relative to this
    const trimStart = Number.parseFloat(V.$('trim-start')?.value) || 0;
    const trimEnd = Number.parseFloat(V.$('trim-end')?.value) || V.state.info.duration || 1;
    const trimDuration = trimEnd - trimStart;

    // Calculate position relative to trim range
    const normalizedPos = (currentTime - trimStart) / trimDuration;

    // Hide playhead if outside trim range
    if (normalizedPos < 0 || normalizedPos > 1) {
      playhead.style.opacity = '0';
      return null;
    }

    playhead.style.opacity = '1';
    // Position aligned with the timeline area (8px inset from edges)
    playhead.style.left = `calc(8px + (100% - 16px) * ${normalizedPos})`;

    // Find which segment contains the current time
    const segIndex = segments.findIndex(
      (s) => currentTime >= s.startTime && currentTime < s.endTime
    );

    return segIndex;
  }

  /**
   * Update UI elements (segment count, duration, buttons, etc.)
   * @param {Object} params - UI update parameters
   */
  function updateUI({ segments, segmentCount }) {
    const V = window.VidLet;

    // Update segment count
    const countEl = V.$('portrait-segment-count');
    if (countEl) {
      countEl.textContent = segmentCount || segments.length;
    }

    // Update output duration (sum of segments, not including gaps)
    const durationEl = V.$('portrait-total-duration');
    if (durationEl) {
      const outputDuration = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
      const totalDuration = V.state.info.duration || 1;
      const gapDuration = totalDuration - outputDuration;

      if (gapDuration > 0.5) {
        // Show output duration with cut indicator
        durationEl.textContent = V.formatDuration(outputDuration);
        durationEl.style.color = 'var(--warn)';
        durationEl.title = `${V.formatDuration(gapDuration)} will be cut`;
      } else {
        durationEl.textContent = V.formatDuration(outputDuration);
        durationEl.style.color = '';
        durationEl.title = '';
      }
    }

    // Update delete button state
    const deleteBtn = V.$('portrait-delete-btn');
    if (deleteBtn) {
      deleteBtn.disabled = segments.length <= 1;
    }

    // Update auto-split button visibility
    const autoSplitBtn = V.$('portrait-auto-split');
    if (autoSplitBtn) {
      autoSplitBtn.style.display = segments.length >= 8 ? 'none' : '';
    }
  }

  /**
   * Update crop position label
   * @param {number} cropX - Crop X position (0-1)
   */
  function updateCropPositionLabel(cropX) {
    const V = window.VidLet;
    const cropPosEl = V.$('portrait-crop-position');
    if (cropPosEl) {
      const pos = cropX;
      let label = 'Center';
      if (pos < 0.33) label = 'Left';
      else if (pos > 0.66) label = 'Right';
      cropPosEl.textContent = `${label} ${Math.round(pos * 100)}%`;
    }
  }

  /**
   * Update transition UI based on selected transition type
   */
  function updateTransitionUI() {
    const V = window.VidLet;
    const transition = V.$('portrait-transition').value;
    const durationSlider = V.$('portrait-transition-duration');
    const durationVal = V.$('portrait-transition-duration-val');

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
      durationVal.textContent = `${durationSlider.value}s`;
    }
  }

  // Export to global namespace
  window.VidLetPortraitRendering = {
    renderSegments,
    renderKeyframes,
    updatePlayhead,
    updateUI,
    updateCropPositionLabel,
    updateTransitionUI,
    SEGMENT_COLORS,
  };
})();
