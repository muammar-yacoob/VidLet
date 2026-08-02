/**
 * Portrait Tool - segments and keyframes
 *
 * Splitting, deleting and selecting the crop segments, plus the keyframe
 * track that animates the crop between them.
 */
((V) => {
  const S = window.VidLetPortraitState;
  const Crop = () => window.VidLetPortraitCrop;

  // ============ SEGMENT MANAGEMENT ============

  /** Trim range the segments live inside, falling back to the whole video. */
  function trimRange() {
    const start = Number.parseFloat(V.$('trim-start')?.value) || 0;
    const end = Number.parseFloat(V.$('trim-end')?.value) || V.state?.info?.duration || 10;
    return { start, end };
  }

  /**
   * Initialize portrait segments
   */
  function initSegments() {
    // If already initialized, just refresh UI (preserve segments on tool switch)
    if (S.initialized && S.segments.length > 0) {
      S.render();
      return;
    }

    // Reset zoom state
    S.zoom = 1;
    S.offset = 0;
    V.$('segment-timeline-wrap')?.classList.remove('zoomed');

    // Create default segment covering the trim range
    const { start, end } = trimRange();
    S.segments = [{ id: `seg_${Date.now()}`, startTime: start, endTime: end, cropX: 0.5 }];
    S.selectedIndex = 0;
    S.cropX = 0.5;
    S.initialized = true;
    S.render();

    // Initialize timeline zoom (only once)
    window.VidLetPortraitTimeline.initTimelineZoom();
  }

  /**
   * Split current segment at video playhead position
   */
  function splitSegment() {
    if (V.undo) V.undo.save();

    const currentTime = V.$('videoPreview').currentTime;

    // Find which segment contains the current time
    const segmentIndex = S.segments.findIndex(
      (s) => currentTime >= s.startTime && currentTime < s.endTime
    );
    if (segmentIndex === -1) return;

    const segment = S.segments[segmentIndex];

    // Don't split if too close to edges (minimum 0.5s segments)
    if (currentTime - segment.startTime < 0.5 || segment.endTime - currentTime < 0.5) {
      window.VidLetUtils?.showToast?.('Segment too small to split');
      return;
    }

    // New segment runs from the split point to the old end; inherit the crop
    const newSegment = {
      id: `seg_${Date.now()}`,
      startTime: currentTime,
      endTime: segment.endTime,
      cropX: segment.cropX,
    };
    segment.endTime = currentTime;
    S.segments.splice(segmentIndex + 1, 0, newSegment);

    S.selectedIndex = segmentIndex + 1;
    S.cropX = newSegment.cropX;

    S.render();
    Crop().updateCropOverlay();
  }

  /**
   * Delete selected segment
   * @param {boolean} ripple - If true, merge with adjacent segment to fill gap
   */
  function deleteSegment(ripple = true) {
    if (S.segments.length <= 1) return;

    if (V.undo) V.undo.save();

    const deleted = S.segments.splice(S.selectedIndex, 1)[0];

    if (ripple) {
      // Ripple delete: merge with previous or next segment (fills the gap)
      if (S.selectedIndex > 0) {
        S.segments[S.selectedIndex - 1].endTime = deleted.endTime;
        S.selectedIndex--;
      } else if (S.segments.length > 0) {
        S.segments[0].startTime = deleted.startTime;
      }
    } else if (S.selectedIndex >= S.segments.length) {
      // Regular delete: just remove, leave gap (other segments don't change)
      S.selectedIndex = Math.max(0, S.segments.length - 1);
    }

    if (S.segments[S.selectedIndex]) {
      S.cropX = S.segments[S.selectedIndex].cropX;
    }

    S.render();
    Crop().updateCropOverlay();
  }

  /**
   * Auto-split segments - divides each segment in half
   * Doubles segments each click: 1 -> 2 -> 4 -> 8, then hides
   */
  function autoSplit() {
    // Don't split if already at 8 or more segments
    if (S.segments.length >= 8) return;

    if (V.undo) V.undo.save();

    const newSegments = [];
    S.segments.forEach((seg, i) => {
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

    S.segments = newSegments;
    S.selectedIndex = 0;
    S.cropX = S.segments[0].cropX;

    S.render({ ui: false });
    Crop().updateCropOverlay();
    window.VidLetPortraitRendering.updateUI({ segments: S.segments });

    window.VidLetUtils?.showToast?.(`Split into ${S.segments.length} segments`);
  }

  /**
   * Select a segment by index
   */
  function selectSegment(index) {
    if (index < 0 || index >= S.segments.length) return;

    S.selectedIndex = index;
    S.cropX = S.segments[index].cropX;

    // Pause and seek video precisely to segment start
    const video = V.$('videoPreview');
    video.pause();
    // Use a small timeout to ensure seek happens after pause
    setTimeout(() => {
      video.currentTime = S.segments[index].startTime;
    }, 10);

    S.render();
    Crop().updateCropOverlay();
    window.VidLetPortraitRendering.updatePlayhead(video.currentTime, S.segments);
  }

  // ============ KEYFRAME ANIMATION ============

  /**
   * Get interpolated cropX at a given time from keyframes
   */
  function getCropXAtTime(time) {
    const frames = S.keyframes;
    if (frames.length === 0) return 0.5;
    if (frames.length === 1) return frames[0].cropX;

    // Find surrounding keyframes
    let before = frames[0];
    let after = frames[frames.length - 1];

    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].time <= time && frames[i + 1].time >= time) {
        before = frames[i];
        after = frames[i + 1];
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
    const time = V.$('videoPreview').currentTime;

    // Replace any keyframe already sitting within 0.1s of this one
    S.keyframes = S.keyframes.filter((k) => Math.abs(k.time - time) > 0.1);
    S.keyframes.push({ time, cropX: S.cropX });
    S.keyframes.sort((a, b) => a.time - b.time);

    S.keyframeAnimation = true;
    window.VidLetUtils?.showToast?.(`Keyframe added at ${time.toFixed(1)}s`);
    S.renderKeyframes();
  }

  /**
   * Clear all keyframes
   */
  function clearKeyframes() {
    if (S.keyframes.length === 0) {
      window.VidLetUtils?.showToast?.('No keyframes to clear');
      return;
    }
    S.keyframes = [];
    S.keyframeAnimation = false;
    S.renderKeyframes();
    window.VidLetUtils?.showToast?.('Keyframes cleared');
  }

  /**
   * Update crop position during playback based on keyframes
   */
  function updateKeyframeAnimation() {
    const video = V.$('videoPreview');
    if (!S.keyframeAnimation || video.paused || S.keyframes.length === 0) return;

    const newCropX = getCropXAtTime(video.currentTime);
    if (Math.abs(newCropX - S.cropX) > 0.001) {
      S.cropX = newCropX;
      Crop().updateCropOverlay();
    }
  }

  window.VidLetPortraitSegments = {
    initSegments,
    splitSegment,
    deleteSegment,
    autoSplit,
    selectSegment,
    trimRange,
    getCropXAtTime,
    addKeyframe,
    clearKeyframes,
    updateKeyframeAnimation,
  };
  // biome-ignore lint/suspicious/noAssignInExpressions: IIFE pattern for module initialization
})(window.VidLet || (window.VidLet = {}));
