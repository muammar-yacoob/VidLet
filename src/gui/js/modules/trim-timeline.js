/**
 * Trim Timeline Module
 * Manages the timeline UI for the trim tool including zoom, pan, and markers
 */
(() => {
  const { $ } = window.VidLet;

  // Timeline zoom state
  let timelineZoom = 1;
  let timelineOffset = 0; // 0-1, represents the left edge position as fraction of duration
  let panToMarker = null; // Function to pan/zoom to marker

  /**
   * Update timeline visualization
   * @param {object} info - Video info object
   */
  function updateTimeline(info) {
    const duration = info.duration || 10;
    const start = Number.parseFloat($('trim-start').value) || 0;
    const end = Number.parseFloat($('trim-end').value) || duration;

    // Calculate positions based on zoom and offset
    const _visibleDuration = duration / timelineZoom;
    const _visibleStart = timelineOffset * duration;

    const timeline = $('timeline');
    timeline.style.width = `${timelineZoom * 100}%`;
    timeline.style.left = `${-timelineOffset * 100}%`;

    const startPct = (start / duration) * 100;
    const endPct = (end / duration) * 100;
    const rangePct = endPct - startPct;

    $('trim-range').style.left = `${startPct}%`;
    $('trim-range').style.width = `${rangePct}%`;

    const { formatTime, formatDuration } = window.VidLetUtils;
    $('trim-start-time').textContent = formatTime(start);
    $('trim-end-time').textContent = formatTime(end);
    $('trim-duration').textContent = formatDuration(Math.max(0, end - start));
  }

  /**
   * Set trim start time
   * @param {number} val - Start time in seconds
   * @param {object} info - Video info object
   */
  function setTrimStart(val, info) {
    const duration = info.duration || 10;
    const end = Number.parseFloat($('trim-end').value) || duration;
    const start = Math.max(0, Math.min(val, end - 0.1));
    $('trim-start').value = start.toFixed(2);
    updateTimeline(info);
    window.VidLet.undo.save(window.getStateSnapshot());
  }

  /**
   * Set trim end time
   * @param {number} val - End time in seconds
   * @param {object} info - Video info object
   */
  function setTrimEnd(val, info) {
    const duration = info.duration || 10;
    const start = Number.parseFloat($('trim-start').value) || 0;
    const end = Math.min(duration, Math.max(val, start + 0.1));
    $('trim-end').value = end.toFixed(2);
    updateTimeline(info);
    window.VidLet.undo.save(window.getStateSnapshot());
  }

  /**
   * Set trim start to current video time
   */
  function setTrimStartToCurrent(info) {
    const video = $('videoPreview');
    setTrimStart(video.currentTime, info);
  }

  /**
   * Set trim end to current video time
   */
  function setTrimEndToCurrent(info) {
    const video = $('videoPreview');
    setTrimEnd(video.currentTime, info);
  }

  /**
   * Initialize timeline drag handles
   * @param {object} info - Video info object
   */
  function initTimelineHandles(info) {
    const timeline = $('timeline');
    const startHandle = $('trim-start-handle');
    const endHandle = $('trim-end-handle');
    const rangeHandle = $('trim-range');

    let isDragging = false;
    let dragType = null;
    let dragStartX = 0;
    let dragStartValue = 0;
    let dragStartEnd = 0;

    const getTimeFromX = (x) => {
      const rect = timeline.getBoundingClientRect();
      const pct = (x - rect.left) / rect.width;
      return pct * info.duration;
    };

    const startDrag = (e, type) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      dragType = type;
      dragStartX = e.clientX;
      dragStartValue = Number.parseFloat($('trim-start').value);
      dragStartEnd = Number.parseFloat($('trim-end').value);
      document.body.style.cursor = 'ew-resize';
      window.VidLet.undo.save(window.getStateSnapshot());
    };

    const moveDrag = (e) => {
      if (!isDragging) return;
      e.preventDefault();

      if (dragType === 'start') {
        const time = getTimeFromX(e.clientX);
        setTrimStart(time, info);
      } else if (dragType === 'end') {
        const time = getTimeFromX(e.clientX);
        setTrimEnd(time, info);
      } else if (dragType === 'range') {
        const deltaX = e.clientX - dragStartX;
        const rect = timeline.getBoundingClientRect();
        const deltaTime = (deltaX / rect.width) * info.duration;
        const duration = dragStartEnd - dragStartValue;
        let newStart = dragStartValue + deltaTime;
        let newEnd = dragStartEnd + deltaTime;

        if (newStart < 0) {
          newStart = 0;
          newEnd = duration;
        } else if (newEnd > info.duration) {
          newEnd = info.duration;
          newStart = info.duration - duration;
        }

        $('trim-start').value = newStart.toFixed(2);
        $('trim-end').value = newEnd.toFixed(2);
        updateTimeline(info);
      }
    };

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      dragType = null;
      document.body.style.cursor = '';
    };

    startHandle.addEventListener('mousedown', (e) => startDrag(e, 'start'));
    endHandle.addEventListener('mousedown', (e) => startDrag(e, 'end'));
    rangeHandle.addEventListener('mousedown', (e) => startDrag(e, 'range'));
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
  }

  /**
   * Initialize timeline zoom and pan
   * @param {object} info - Video info object
   */
  function initTimelineZoom(info) {
    const container = $('timeline-container');
    const timeline = $('timeline');
    const zoomIn = $('timeline-zoom-in');
    const zoomOut = $('timeline-zoom-out');
    const zoomReset = $('timeline-zoom-reset');

    let isPanning = false;
    let panStartX = 0;
    let panStartOffset = 0;

    const updateZoom = () => {
      timeline.style.width = `${timelineZoom * 100}%`;
      timeline.style.left = `${-timelineOffset * timelineZoom * 100}%`;
      updateTimeline(info);

      if (zoomIn) zoomIn.disabled = timelineZoom >= 10;
      if (zoomOut) zoomOut.disabled = timelineZoom <= 1;
      if (zoomReset) zoomReset.disabled = timelineZoom === 1;
    };

    zoomIn?.addEventListener('click', () => {
      if (timelineZoom < 10) {
        const oldZoom = timelineZoom;
        timelineZoom = Math.min(10, timelineZoom * 1.5);
        timelineOffset = timelineOffset * (oldZoom / timelineZoom);
        timelineOffset = Math.max(0, Math.min(1 - 1 / timelineZoom, timelineOffset));
        updateZoom();
      }
    });

    zoomOut?.addEventListener('click', () => {
      if (timelineZoom > 1) {
        const oldZoom = timelineZoom;
        timelineZoom = Math.max(1, timelineZoom / 1.5);
        if (timelineZoom === 1) {
          timelineOffset = 0;
        } else {
          timelineOffset = timelineOffset * (oldZoom / timelineZoom);
          timelineOffset = Math.max(0, Math.min(1 - 1 / timelineZoom, timelineOffset));
        }
        updateZoom();
      }
    });

    zoomReset?.addEventListener('click', () => {
      timelineZoom = 1;
      timelineOffset = 0;
      updateZoom();
    });

    container?.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mousePosPct = mouseX / rect.width;

      const oldZoom = timelineZoom;
      if (e.deltaY < 0) {
        timelineZoom = Math.min(10, timelineZoom * 1.1);
      } else {
        timelineZoom = Math.max(1, timelineZoom / 1.1);
      }

      if (timelineZoom === 1) {
        timelineOffset = 0;
      } else {
        const visibleFraction = 1 / oldZoom;
        const mouseTimePos = timelineOffset + mousePosPct * visibleFraction;
        const newVisibleFraction = 1 / timelineZoom;
        timelineOffset = mouseTimePos - mousePosPct * newVisibleFraction;
        timelineOffset = Math.max(0, Math.min(1 - newVisibleFraction, timelineOffset));
      }

      updateZoom();
    });

    container?.addEventListener('mousedown', (e) => {
      if (e.target === container || e.target === timeline) {
        if (timelineZoom > 1) {
          isPanning = true;
          panStartX = e.clientX;
          panStartOffset = timelineOffset;
          container.style.cursor = 'grabbing';
        }
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      e.preventDefault();
      const deltaX = e.clientX - panStartX;
      const rect = container.getBoundingClientRect();
      const deltaPct = deltaX / rect.width / timelineZoom;
      timelineOffset = panStartOffset - deltaPct;
      timelineOffset = Math.max(0, Math.min(1 - 1 / timelineZoom, timelineOffset));
      updateZoom();
    });

    document.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        container.style.cursor = '';
      }
    });

    panToMarker = (time) => {
      const normalizedTime = time / info.duration;
      const visibleDuration = 1 / timelineZoom;
      timelineOffset = Math.max(
        0,
        Math.min(1 - visibleDuration, normalizedTime - visibleDuration / 2)
      );
      updateZoom();
    };
  }

  /**
   * Get pan to marker function
   * @returns {Function} Function to pan/zoom to marker
   */
  function getPanToMarker() {
    return panToMarker;
  }

  // Export API
  window.VidLetTrimTimeline = {
    updateTimeline,
    setTrimStart,
    setTrimEnd,
    setTrimStartToCurrent,
    setTrimEndToCurrent,
    initTimelineHandles,
    initTimelineZoom,
    getPanToMarker,
  };
})();
