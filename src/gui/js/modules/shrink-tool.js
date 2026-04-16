/**
 * Shrink Tool Module
 * Handles video speed-up to fit target duration
 */

(() => {
  const { $ } = window.VidLet;

  // Video info reference (set from main app)
  let videoInfo = null;

  /**
   * Set video info for calculations
   * @param {Object} info - Video metadata
   */
  function setVideoInfo(info) {
    videoInfo = info;
  }

  /**
   * Initialize shrink tool slider bounds
   */
  function init() {
    const duration = videoInfo?.duration || 60;

    // Slider min is duration/10 (10x max speed), max is full duration
    const shrinkMin = Math.max(1, Math.ceil(duration / 10));
    const slider = $('shrink-duration');

    if (slider) {
      slider.min = shrinkMin;
      slider.max = Math.floor(duration);
      slider.value = Math.min(60, Math.max(shrinkMin, Math.floor(duration)));
    }

    updateLabel();
    updateMarker();

    // Hide 60s button if video <= 60s or if 60s is below min (10x limit)
    const show60s = duration > 60 && 60 >= shrinkMin;
    $('shrink-60-btn')?.classList.toggle('hidden', !show60s);
    $('shrink-marker-60')?.classList.toggle('hidden', !show60s);
  }

  /**
   * Update shrink duration label
   */
  function updateLabel() {
    const val = Number.parseFloat($('shrink-duration')?.value);
    const labelEl = $('shrink-val');

    if (labelEl && val) {
      labelEl.textContent = `${val % 1 === 0 ? val : val.toFixed(1)}s`;
    }

    updateEstimate();
    updateMarker();
  }

  /**
   * Update shrink speed estimate
   */
  function updateEstimate() {
    const duration = videoInfo?.duration || 60;
    const targetDuration = Number.parseFloat($('shrink-duration')?.value) || 60;
    const speedMultiplier = (duration / targetDuration).toFixed(1);
    const isAtLimit = Number.parseFloat(speedMultiplier) >= 9.9;

    const estimateEl = $('shrink-estimate');
    if (estimateEl) {
      estimateEl.textContent = isAtLimit
        ? `Speed: ${speedMultiplier}x (max)`
        : `Speed: ${speedMultiplier}x faster`;
    }
  }

  /**
   * Update 60s marker position on slider
   */
  function updateMarker() {
    const slider = $('shrink-duration');
    const marker = $('shrink-marker-60');

    if (!slider || !marker) return;

    const min = Number.parseInt(slider.min) || 10;
    const max = Number.parseInt(slider.max) || 300;

    if (60 >= min && 60 <= max) {
      const pct = ((60 - min) / (max - min)) * 100;
      marker.style.left = `calc(${pct}% - 1px)`;
    }
  }

  /**
   * Set shrink duration to 60 seconds
   */
  function setTo60() {
    const slider = $('shrink-duration');
    if (slider) {
      slider.value = 60;
      updateLabel();
    }
  }

  /**
   * Get current shrink options for processing
   * @returns {Object} Shrink configuration
   */
  function getOptions() {
    const duration = videoInfo?.duration || 60;
    const targetDuration = Number.parseFloat($('shrink-duration')?.value) || 60;

    return {
      targetDuration,
      speedMultiplier: duration / targetDuration,
    };
  }

  // Export to global VidLetShrinkTool namespace
  window.VidLetShrinkTool = {
    setVideoInfo,
    init,
    updateLabel,
    updateEstimate,
    updateMarker,
    setTo60,
    getOptions,
  };
})();
