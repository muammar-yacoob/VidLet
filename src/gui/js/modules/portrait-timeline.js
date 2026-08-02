/**
 * Portrait Tool - segment timeline
 *
 * Dragging segment edges, following the playhead, and zooming/panning the
 * timeline strip.
 */
((V) => {
  const S = window.VidLetPortraitState;
  const Crop = () => window.VidLetPortraitCrop;
  const Segments = () => window.VidLetPortraitSegments;

  // ============ SEGMENT HANDLES ============

  /**
   * Initialize segment resize handles
   */
  function initSegmentHandles() {
    for (const handle of document.querySelectorAll('.segment-handle')) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const segmentIndex = Number.parseInt(handle.dataset.segment);
        const side = handle.dataset.side; // 'start' or 'end'
        const seg = S.segments[segmentIndex];
        if (!seg) return;

        // Pause video and seek to the edge being adjusted
        const video = V.$('videoPreview');
        video.pause();
        video.currentTime = side === 'start' ? seg.startTime : seg.endTime;

        S.selectedIndex = segmentIndex;
        S.cropX = seg.cropX;
        Crop().updateCropOverlay();

        const onMove = (moveEvent) => {
          const rect = V.$('segment-timeline-wrap').getBoundingClientRect();
          // Account for 8px padding on each side
          const innerWidth = rect.width - 16;
          const x = moveEvent.clientX - rect.left - 8;
          const viewportRatio = Math.max(0, Math.min(1, x / innerWidth));

          // Convert viewport position to time (relative to trim range)
          const { start: trimStart, end: trimEnd } = Segments().trimRange();
          const newTime = trimStart + viewportRatio * (trimEnd - trimStart);

          if (side === 'start') {
            // Can't go past end - 0.5s, can't go before trim start
            seg.startTime = Math.max(trimStart, Math.min(seg.endTime - 0.5, newTime));
            video.currentTime = seg.startTime;
          } else {
            // Can't go before start + 0.5s, can't go past trim end
            seg.endTime = Math.min(trimEnd, Math.max(seg.startTime + 0.5, newTime));
            video.currentTime = seg.endTime;
          }

          S.render();
          window.VidLetPortraitRendering.updatePlayhead(video.currentTime, S.segments);
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          // Dragging an edge past a neighbour reorders the list
          S.segments.sort((a, b) => a.startTime - b.startTime);
          S.selectedIndex = S.segments.indexOf(seg);
          S.render({ ui: false });
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  // ============ PLAYHEAD UPDATE ============

  /**
   * Update playhead position on timeline with gap-jumping logic
   */
  function updatePlayhead() {
    const video = V.$('videoPreview');
    const currentTime = video.currentTime;

    // Call rendering module to update playhead visual position
    const segIndex = window.VidLetPortraitRendering.updatePlayhead(currentTime, S.segments);

    // Playing through a gap: skip ahead to the next segment, or loop to the first
    if (!video.paused && segIndex === null) {
      const sorted = [...S.segments].sort((a, b) => a.startTime - b.startTime);
      const nextSegment = sorted.find((s) => s.startTime > currentTime);
      if (nextSegment) {
        video.currentTime = nextSegment.startTime;
        return;
      }
      if (sorted.length > 0) {
        video.currentTime = sorted[0].startTime;
        return;
      }
    }

    // Auto-select segment based on playhead position
    if (segIndex !== null && segIndex !== -1 && segIndex !== S.selectedIndex) {
      S.selectedIndex = segIndex;
      S.cropX = S.segments[segIndex].cropX;
      S.render();
      Crop().updateCropOverlay();
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
        const duration = V.state?.info?.duration || 1;

        // Where the cursor sits in the visible window, and what time that is
        const cursorViewportPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const cursorTime = S.offset * duration + cursorViewportPct * (duration / S.zoom);
        const cursorPosition = cursorTime / duration;

        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        S.zoom = Math.max(1, Math.min(8, S.zoom + delta * S.zoom));

        if (S.zoom <= 1.01) {
          S.zoom = 1;
          S.offset = 0;
          timelineWrap.classList.remove('zoomed');
        } else {
          // Adjust offset to keep cursor position stable
          const visibleAfter = 1 / S.zoom;
          S.offset = Math.max(
            0,
            Math.min(1 - visibleAfter, cursorPosition - cursorViewportPct * visibleAfter)
          );
          timelineWrap.classList.add('zoomed');
        }

        S.render({ ui: false });
        updatePlayhead();
      },
      { passive: false }
    );

    // Pan with drag when zoomed
    timelineWrap.addEventListener('mousedown', (e) => {
      const onSegment =
        e.target.classList.contains('segment-handle') ||
        e.target.classList.contains('portrait-segment');
      if (onSegment || S.zoom <= 1) return;

      e.preventDefault();
      isPanning = true;
      panStartX = e.clientX;
      panStartOffset = S.offset;
      timelineWrap.classList.add('panning');
    });

    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      const rect = timelineWrap.getBoundingClientRect();
      const dx = (e.clientX - panStartX) / rect.width;
      const visibleFraction = 1 / S.zoom;
      S.offset = Math.max(0, Math.min(1 - visibleFraction, panStartOffset - dx * visibleFraction));
      S.render({ ui: false });
      updatePlayhead();
    });

    document.addEventListener('mouseup', () => {
      if (!isPanning) return;
      isPanning = false;
      timelineWrap.classList.remove('panning');
    });
  }

  window.VidLetPortraitTimeline = { initSegmentHandles, updatePlayhead, initTimelineZoom };
  // biome-ignore lint/suspicious/noAssignInExpressions: IIFE pattern for module initialization
})(window.VidLet || (window.VidLet = {}));
