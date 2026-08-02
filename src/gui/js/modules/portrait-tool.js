/**
 * VidLet Portrait Tool Module
 * Handles portrait/vertical video conversion with dynamic crop positioning
 * and multi-segment editing
 *
 * This file is the public face of the tool. The work lives in
 * portrait-state.js (shared state + redraw), portrait-crop.js (the crop
 * window), portrait-segments.js (segments + keyframes) and
 * portrait-timeline.js (handles, playhead, zoom).
 */
((V) => {
  const S = window.VidLetPortraitState;
  const Crop = window.VidLetPortraitCrop;
  const Segments = window.VidLetPortraitSegments;
  const Timeline = window.VidLetPortraitTimeline;

  /**
   * Get portrait processing options for API
   */
  function getProcessOptions() {
    return {
      segments: S.segments.map((seg) => ({
        id: seg.id,
        startTime: seg.startTime,
        endTime: seg.endTime,
        cropX: seg.cropX,
      })),
      transition: V.$('portrait-transition')?.value || 'none',
      transitionDuration: Number.parseFloat(V.$('portrait-transition-duration')?.value) || 0.3,
    };
  }

  /**
   * Get current portrait state (for the undo module)
   */
  function getState() {
    return {
      portraitSegments: structuredClone(S.segments),
      selectedSegmentIndex: S.selectedIndex,
      portraitCropX: S.cropX,
      portraitKeyframes: structuredClone(S.keyframes),
    };
  }

  /**
   * Restore portrait state
   */
  function setState(state) {
    S.segments = state.portraitSegments;
    S.selectedIndex = state.selectedSegmentIndex;
    S.cropX = state.portraitCropX;
    S.keyframes = state.portraitKeyframes;

    S.render({ ui: false });
    Crop.updateCropOverlay();
    window.VidLetPortraitRendering.updateUI({ segments: S.segments });
    S.renderKeyframes();
  }

  V.portrait = {
    // Initialization
    init: Segments.initSegments,
    initOverlay: Crop.initCropOverlay,
    reset: S.reset,

    // Segment management
    splitSegment: Segments.splitSegment,
    deleteSegment: Segments.deleteSegment,
    autoSplit: Segments.autoSplit,
    selectSegment: Segments.selectSegment,

    // Keyframes
    addKeyframe: Segments.addKeyframe,
    clearKeyframes: Segments.clearKeyframes,
    getCropXAtTime: Segments.getCropXAtTime,
    updateKeyframeAnimation: Segments.updateKeyframeAnimation,

    // Rendering
    updateOverlay: Crop.updateCropOverlay,
    updatePlayhead: Timeline.updatePlayhead,
    updateTransitionUI: () => window.VidLetPortraitRendering.updateTransitionUI(),

    // Data
    getProcessOptions,
    getState,
    setState,

    // State accessors (for undo and other modules)
    get segments() {
      return S.segments;
    },
    get selectedIndex() {
      return S.selectedIndex;
    },
    get cropX() {
      return S.cropX;
    },
    set cropX(val) {
      S.cropX = val;
    },
  };
  // biome-ignore lint/suspicious/noAssignInExpressions: IIFE pattern for module initialization
})(window.VidLet || (window.VidLet = {}));
