/**
 * VidLet Portrait Tool Module
 * Handles portrait/vertical video conversion with dynamic crop positioning
 * and multi-segment editing
 */
((V) => {
  // ============ STATE ============

  let portraitSegments = []; // [{id, startTime, endTime, cropX}]
  let selectedSegmentIndex = 0;
  let portraitCropX = 0.5;
  let portraitSegmentsInitialized = false;

  // Keyframes for smooth crop animation
  let portraitKeyframes = [];
  let keyframeAnimationEnabled = false;

  // Timeline zoom state
  let portraitZoom = 1;
  let portraitOffset = 0; // 0-1, left edge position as fraction of duration

  // ============ CROP OVERLAY ============

  /**
   * Initialize crop overlay drag handler
   */
  function initCropOverlay() {
    const _overlay = V.$('cropOverlay');
    const cropWindow = V.$('cropWindow');
    let isDragging = false;
    let _startX = 0;

    function onMove(e) {
      if (!isDragging) return;
      const video = V.$('videoPreview');
      const rect = video.getBoundingClientRect();
      const x = e.clientX - rect.left;
      portraitCropX = Math.max(0.1, Math.min(0.9, x / rect.width));
      updateSelectedSegmentCropX(portraitCropX);
      updateCropOverlay();
    }

    cropWindow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      _startX = e.clientX;
      document.addEventListener('mousemove', onMove);
      document.addEventListener(
        'mouseup',
        () => {
          isDragging = false;
          document.removeEventListener('mousemove', onMove);
        },
        { once: true }
      );
    });
  }

  /**
   * Update crop overlay position and size
   */
  function updateCropOverlay() {
    const video = V.$('videoPreview');
    const _overlay = V.$('cropOverlay');
    if (!video.videoWidth) return;

    const videoRect = video.getBoundingClientRect();
    const wrapRect = V.$('previewWrap').getBoundingClientRect();

    const offsetX = videoRect.left - wrapRect.left;
    const _offsetY = videoRect.top - wrapRect.top;

    const cropWidth = videoRect.height * (9 / 16);
    const cropLeft = offsetX + videoRect.width * portraitCropX - cropWidth / 2;

    V.$('cropLeft').style.width = `${Math.max(0, cropLeft - offsetX)}px`;
    V.$('cropLeft').style.left = `${offsetX}px`;
    V.$('cropRight').style.width =
      `${Math.max(0, offsetX + videoRect.width - (cropLeft + cropWidth))}px`;
    V.$('cropRight').style.right = `${wrapRect.width - offsetX - videoRect.width}px`;
    V.$('cropWindow').style.left = `${cropLeft}px`;
    V.$('cropWindow').style.width = `${cropWidth}px`;

    // Update crop window border color to match selected segment
    if (portraitSegments.length > 0 && selectedSegmentIndex < portraitSegments.length) {
      const segColor =
        window.VidLetPortraitRendering.SEGMENT_COLORS[
          selectedSegmentIndex % window.VidLetPortraitRendering.SEGMENT_COLORS.length
        ];
      V.$('cropWindow').style.borderColor = segColor;
      for (const h of document.querySelectorAll('.crop-handle')) {
        h.style.background = segColor;
      }
    }
  }

  // ============ SEGMENT MANAGEMENT ============

  /**
   * Initialize portrait segments
   */
  function initSegments() {
    // If already initialized, just refresh UI (preserve segments on tool switch)
    if (portraitSegmentsInitialized && portraitSegments.length > 0) {
      window.VidLetPortraitRendering.renderSegments({
        segments: portraitSegments,
        selectedIndex: selectedSegmentIndex,
        zoom: portraitZoom,
        onSegmentClick: selectSegment,
        onHandleInit: initSegmentHandles,
      });
      window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
      return;
    }

    // Reset zoom state
    portraitZoom = 1;
    portraitOffset = 0;
    V.$('segment-timeline-wrap')?.classList.remove('zoomed');

    // Use trim values if set, otherwise full video duration
    const trimStart = Number.parseFloat(V.$('trim-start')?.value) || 0;
    const trimEnd = Number.parseFloat(V.$('trim-end')?.value) || V.state.info.duration || 10;

    // Create default segment covering the trim range
    portraitSegments = [
      {
        id: `seg_${Date.now()}`,
        startTime: trimStart,
        endTime: trimEnd,
        cropX: 0.5,
      },
    ];
    selectedSegmentIndex = 0;
    portraitCropX = 0.5;
    portraitSegmentsInitialized = true;
    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });

    // Initialize timeline zoom (only once)
    initTimelineZoom();
  }

  /**
   * Split current segment at video playhead position
   */
  function splitSegment() {
    if (V.undo) V.undo.save();

    const video = V.$('videoPreview');
    const currentTime = video.currentTime;

    // Find which segment contains the current time
    const segmentIndex = portraitSegments.findIndex(
      (s) => currentTime >= s.startTime && currentTime < s.endTime
    );
    if (segmentIndex === -1) return;

    const segment = portraitSegments[segmentIndex];

    // Don't split if too close to edges (minimum 0.5s segments)
    if (currentTime - segment.startTime < 0.5 || segment.endTime - currentTime < 0.5) {
      V.toast('Segment too small to split');
      return;
    }

    // Create new segment from split point to end
    const newSegment = {
      id: `seg_${Date.now()}`,
      startTime: currentTime,
      endTime: segment.endTime,
      cropX: segment.cropX, // Inherit crop position
    };

    // Trim original segment
    segment.endTime = currentTime;

    // Insert new segment after the current one
    portraitSegments.splice(segmentIndex + 1, 0, newSegment);

    // Select the new segment
    selectedSegmentIndex = segmentIndex + 1;
    portraitCropX = newSegment.cropX;

    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
    updateCropOverlay();
  }

  /**
   * Delete selected segment
   * @param {boolean} ripple - If true, merge with adjacent segment to fill gap
   */
  function deleteSegment(ripple = true) {
    if (portraitSegments.length <= 1) return;

    if (V.undo) V.undo.save();

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

    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
    updateCropOverlay();
  }

  /**
   * Auto-split segments - divides each segment in half
   * Doubles segments each click: 1 -> 2 -> 4 -> 8, then hides
   */
  function autoSplit() {
    // Don't split if already at 8 or more segments
    if (portraitSegments.length >= 8) return;

    if (V.undo) V.undo.save();

    // Split each existing segment in half
    const newSegments = [];
    portraitSegments.forEach((seg, i) => {
      const midTime = (seg.startTime + seg.endTime) / 2;
      // First half keeps original crop
      newSegments.push({
        id: `seg-${newSegments.length}`,
        startTime: seg.startTime,
        endTime: midTime,
        cropX: seg.cropX,
      });
      // Second half gets alternating crop position
      const altCrop = seg.cropX <= 0.4 ? 0.7 : seg.cropX >= 0.6 ? 0.3 : i % 2 === 0 ? 0.7 : 0.3;
      newSegments.push({
        id: `seg-${newSegments.length}`,
        startTime: midTime,
        endTime: seg.endTime,
        cropX: altCrop,
      });
    });

    portraitSegments = newSegments;
    selectedSegmentIndex = 0;
    portraitCropX = portraitSegments[0].cropX;

    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    updateCropOverlay();
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });

    V.toast(`Split into ${portraitSegments.length} segments`);
  }

  /**
   * Select a segment by index
   */
  function selectSegment(index) {
    if (index < 0 || index >= portraitSegments.length) return;

    selectedSegmentIndex = index;
    portraitCropX = portraitSegments[index].cropX;

    // Pause and seek video precisely to segment start
    const video = V.$('videoPreview');
    video.pause();
    // Use a small timeout to ensure seek happens after pause
    setTimeout(() => {
      video.currentTime = portraitSegments[index].startTime;
    }, 10);

    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
    updateCropOverlay();
    window.VidLetPortraitRendering.updatePlayhead(video.currentTime, portraitSegments);
  }

  /**
   * Update selected segment's cropX value
   */
  function updateSelectedSegmentCropX(cropX) {
    if (portraitSegments[selectedSegmentIndex]) {
      portraitSegments[selectedSegmentIndex].cropX = cropX;
      window.VidLetPortraitRendering.updateCropPositionLabel(cropX);
      window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
    }
  }

  // ============ KEYFRAME ANIMATION ============

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
    const video = V.$('videoPreview');
    const time = video.currentTime;

    // Remove existing keyframe at same time (within 0.1s)
    portraitKeyframes = portraitKeyframes.filter((k) => Math.abs(k.time - time) > 0.1);

    // Add new keyframe
    portraitKeyframes.push({ time, cropX: portraitCropX });
    portraitKeyframes.sort((a, b) => a.time - b.time);

    keyframeAnimationEnabled = true;
    V.toast(`Keyframe added at ${time.toFixed(1)}s`);
    window.VidLetPortraitRendering.renderKeyframes(portraitKeyframes, (kf) => {
      V.$('videoPreview').currentTime = kf.time;
      portraitCropX = kf.cropX;
      updateCropOverlay();
    });
  }

  /**
   * Clear all keyframes
   */
  function clearKeyframes() {
    if (portraitKeyframes.length === 0) {
      V.toast('No keyframes to clear');
      return;
    }
    portraitKeyframes = [];
    keyframeAnimationEnabled = false;
    window.VidLetPortraitRendering.renderKeyframes(portraitKeyframes, (kf) => {
      V.$('videoPreview').currentTime = kf.time;
      portraitCropX = kf.cropX;
      updateCropOverlay();
    });
    V.toast('Keyframes cleared');
  }

  /**
   * Update crop position during playback based on keyframes
   */
  function updateKeyframeAnimation() {
    const video = V.$('videoPreview');
    if (keyframeAnimationEnabled && !video.paused && portraitKeyframes.length > 0) {
      const newCropX = getCropXAtTime(video.currentTime);
      if (Math.abs(newCropX - portraitCropX) > 0.001) {
        portraitCropX = newCropX;
        updateCropOverlay();
      }
    }
  }

  // ============ SEGMENT HANDLES ============

  /**
   * Initialize segment resize handles
   */
  function initSegmentHandles() {
    const handles = document.querySelectorAll('.segment-handle');

    for (const handle of handles) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const segmentIndex = Number.parseInt(handle.dataset.segment);
        const side = handle.dataset.side; // 'start' or 'end'
        const seg = portraitSegments[segmentIndex];
        if (!seg) return;

        const video = V.$('videoPreview');
        const _wasPlaying = !video.paused;

        // Pause video and seek to the edge being adjusted
        video.pause();
        video.currentTime = side === 'start' ? seg.startTime : seg.endTime;

        // Select this segment
        selectedSegmentIndex = segmentIndex;
        portraitCropX = seg.cropX;
        updateCropOverlay();

        const onMove = (e) => {
          const timelineWrap = V.$('segment-timeline-wrap');
          const rect = timelineWrap.getBoundingClientRect();
          // Account for 8px padding on each side
          const innerWidth = rect.width - 16;
          const x = e.clientX - rect.left - 8;
          const viewportRatio = Math.max(0, Math.min(1, x / innerWidth));

          // Convert viewport position to time (relative to trim range)
          const trimStart = Number.parseFloat(V.$('trim-start')?.value) || 0;
          const trimEnd = Number.parseFloat(V.$('trim-end')?.value) || V.state.info.duration || 1;
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

          window.VidLetPortraitRendering.renderSegments({
            segments: portraitSegments,
            selectedIndex: selectedSegmentIndex,
            zoom: portraitZoom,
            onSegmentClick: selectSegment,
            onHandleInit: initSegmentHandles,
          });
          window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
          window.VidLetPortraitRendering.updatePlayhead(video.currentTime, portraitSegments);
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          // Sort segments by start time after adjustment
          portraitSegments.sort((a, b) => a.startTime - b.startTime);
          // Update selected index after sort
          selectedSegmentIndex = portraitSegments.indexOf(seg);
          window.VidLetPortraitRendering.renderSegments({
            segments: portraitSegments,
            selectedIndex: selectedSegmentIndex,
            zoom: portraitZoom,
            onSegmentClick: selectSegment,
            onHandleInit: initSegmentHandles,
          });
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  // ============ PLAYHEAD UPDATE (wrapper) ============

  /**
   * Update playhead position on timeline with gap-jumping logic
   */
  function updatePlayhead() {
    const video = V.$('videoPreview');
    const currentTime = video.currentTime;

    // Call rendering module to update playhead visual position
    const segIndex = window.VidLetPortraitRendering.updatePlayhead(currentTime, portraitSegments);

    // Check if we're in a gap - if so, skip to next segment during playback
    if (!video.paused && segIndex === null) {
      // Find the next segment to jump to
      const sortedSegments = [...portraitSegments].sort((a, b) => a.startTime - b.startTime);
      const nextSegment = sortedSegments.find((s) => s.startTime > currentTime);
      if (nextSegment) {
        video.currentTime = nextSegment.startTime;
        return;
      }
      // No more segments, loop back to first segment
      if (sortedSegments.length > 0) {
        video.currentTime = sortedSegments[0].startTime;
        return;
      }
    }

    // Auto-select segment based on playhead position
    if (segIndex !== null && segIndex !== -1 && segIndex !== selectedSegmentIndex) {
      selectedSegmentIndex = segIndex;
      portraitCropX = portraitSegments[segIndex].cropX;
      window.VidLetPortraitRendering.renderSegments({
        segments: portraitSegments,
        selectedIndex: selectedSegmentIndex,
        zoom: portraitZoom,
        onSegmentClick: selectSegment,
        onHandleInit: initSegmentHandles,
      });
      window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
      updateCropOverlay();
    }
  }

  // ============ TIMELINE ZOOM ============

  /**
   * Initialize timeline zoom and pan functionality
   */
  function initTimelineZoom() {
    const timelineWrap = V.$('segment-timeline-wrap');
    const timeline = V.$('segment-timeline');
    if (!timelineWrap || !timeline) return;

    let isPanning = false;
    let panStartX = 0;
    let panStartOffset = 0;

    // Wheel zoom
    timelineWrap.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = timeline.getBoundingClientRect();
        const duration = V.state.info.duration || 1;

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
          portraitOffset = Math.max(
            0,
            Math.min(1 - visibleAfter, cursorPosition - cursorViewportPct * visibleAfter)
          );
          timelineWrap.classList.add('zoomed');
        }

        window.VidLetPortraitRendering.renderSegments({
          segments: portraitSegments,
          selectedIndex: selectedSegmentIndex,
          zoom: portraitZoom,
          onSegmentClick: selectSegment,
          onHandleInit: initSegmentHandles,
        });
        updatePlayhead();
      },
      { passive: false }
    );

    // Pan with drag when zoomed
    timelineWrap.addEventListener('mousedown', (e) => {
      if (
        e.target.classList.contains('segment-handle') ||
        e.target.classList.contains('portrait-segment')
      )
        return;
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
      portraitOffset = Math.max(
        0,
        Math.min(1 - visibleFraction, panStartOffset - dx * visibleFraction)
      );
      window.VidLetPortraitRendering.renderSegments({
        segments: portraitSegments,
        selectedIndex: selectedSegmentIndex,
        zoom: portraitZoom,
        onSegmentClick: selectSegment,
        onHandleInit: initSegmentHandles,
      });
      updatePlayhead();
    });

    document.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        timelineWrap.classList.remove('panning');
      }
    });
  }

  // ============ RESET ============

  /**
   * Reset portrait tool state
   */
  function reset() {
    portraitSegmentsInitialized = false;
    portraitSegments = [];
    selectedSegmentIndex = 0;
    portraitCropX = 0.5;
    portraitKeyframes = [];
    keyframeAnimationEnabled = false;
    portraitZoom = 1;
    portraitOffset = 0;
  }

  // ============ DATA EXPORT ============

  /**
   * Get portrait processing options for API
   */
  function getProcessOptions() {
    return {
      segments: portraitSegments.map((seg) => ({
        id: seg.id,
        startTime: seg.startTime,
        endTime: seg.endTime,
        cropX: seg.cropX,
      })),
      transition: V.$('portrait-transition')?.value || 'none',
      transitionDuration: Number.parseFloat(V.$('portrait-transition-duration')?.value) || 0.3,
    };
  }

  // ============ STATE ACCESS (for undo module) ============

  /**
   * Get current portrait state
   */
  function getState() {
    return {
      portraitSegments: JSON.parse(JSON.stringify(portraitSegments)),
      selectedSegmentIndex,
      portraitCropX,
      portraitKeyframes: JSON.parse(JSON.stringify(portraitKeyframes)),
    };
  }

  /**
   * Restore portrait state
   */
  function setState(state) {
    portraitSegments = state.portraitSegments;
    selectedSegmentIndex = state.selectedSegmentIndex;
    portraitCropX = state.portraitCropX;
    portraitKeyframes = state.portraitKeyframes;
    window.VidLetPortraitRendering.renderSegments({
      segments: portraitSegments,
      selectedIndex: selectedSegmentIndex,
      zoom: portraitZoom,
      onSegmentClick: selectSegment,
      onHandleInit: initSegmentHandles,
    });
    updateCropOverlay();
    window.VidLetPortraitRendering.updateUI({ segments: portraitSegments });
    window.VidLetPortraitRendering.renderKeyframes(portraitKeyframes, (kf) => {
      V.$('videoPreview').currentTime = kf.time;
      portraitCropX = kf.cropX;
      updateCropOverlay();
    });
  }

  // ============ EXPORTS ============

  V.portrait = {
    // Initialization
    init: initSegments,
    initOverlay: initCropOverlay,
    reset,

    // Segment management
    splitSegment,
    deleteSegment,
    autoSplit,
    selectSegment,

    // Keyframes
    addKeyframe,
    clearKeyframes,
    getCropXAtTime,
    updateKeyframeAnimation,

    // Rendering
    updateOverlay: updateCropOverlay,
    updatePlayhead,
    updateTransitionUI: () => window.VidLetPortraitRendering.updateTransitionUI(),

    // Data
    getProcessOptions,
    getState,
    setState,

    // State accessors (for undo and other modules)
    get segments() {
      return portraitSegments;
    },
    get selectedIndex() {
      return selectedSegmentIndex;
    },
    get cropX() {
      return portraitCropX;
    },
    set cropX(val) {
      portraitCropX = val;
    },
  };
  // biome-ignore lint/suspicious/noAssignInExpressions: IIFE pattern for module initialization
})(window.VidLet || (window.VidLet = {}));
