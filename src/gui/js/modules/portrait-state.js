/**
 * Portrait Tool State
 *
 * The portrait editor is split across portrait-crop.js, portrait-segments.js,
 * portrait-timeline.js and portrait-tool.js. They all mutate the same segment
 * list, so it lives here along with the redraw every one of them triggers.
 */
(() => {
  const S = {
    /** [{ id, startTime, endTime, cropX }] */
    segments: [],
    selectedIndex: 0,
    /** Horizontal crop centre of the selected segment, 0-1. */
    cropX: 0.5,
    /** Segments survive a tool switch; this says whether they exist yet. */
    initialized: false,

    /** [{ time, cropX }], sorted by time. */
    keyframes: [],
    keyframeAnimation: false,

    /** Timeline zoom factor and left-edge offset (0-1 of duration). */
    zoom: 1,
    offset: 0,
  };

  const R = () => window.VidLetPortraitRendering;

  /**
   * Redraw the segment timeline.
   *
   * @param {{ ui?: boolean }} [opts] `ui: false` skips the segment counters,
   *   for the drag paths that only need the bars to move.
   */
  S.render = (opts = {}) => {
    R().renderSegments({
      segments: S.segments,
      selectedIndex: S.selectedIndex,
      zoom: S.zoom,
      onSegmentClick: (i) => window.VidLetPortraitSegments.selectSegment(i),
      onHandleInit: () => window.VidLetPortraitTimeline.initSegmentHandles(),
    });
    if (opts.ui !== false) {
      R().updateUI({ segments: S.segments });
    }
  };

  /** Redraw the keyframe markers, wiring each to seek and re-crop on click. */
  S.renderKeyframes = () => {
    R().renderKeyframes(S.keyframes, (kf) => {
      VidLet.$('videoPreview').currentTime = kf.time;
      S.cropX = kf.cropX;
      window.VidLetPortraitCrop.updateCropOverlay();
    });
  };

  /** Drop everything back to a single default segment's worth of state. */
  S.reset = () => {
    S.initialized = false;
    S.segments = [];
    S.selectedIndex = 0;
    S.cropX = 0.5;
    S.keyframes = [];
    S.keyframeAnimation = false;
    S.zoom = 1;
    S.offset = 0;
  };

  window.VidLetPortraitState = S;
})();
