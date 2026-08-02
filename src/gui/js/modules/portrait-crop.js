/**
 * Portrait Tool - crop overlay
 *
 * The draggable 9:16 window over the video preview, and the letterbox panels
 * either side of it.
 */
((V) => {
  const S = window.VidLetPortraitState;

  /**
   * Update selected segment's cropX value
   */
  function updateSelectedSegmentCropX(cropX) {
    if (!S.segments[S.selectedIndex]) return;
    S.segments[S.selectedIndex].cropX = cropX;
    window.VidLetPortraitRendering.updateCropPositionLabel(cropX);
    window.VidLetPortraitRendering.updateUI({ segments: S.segments });
  }

  /**
   * Initialize crop overlay drag handler
   */
  function initCropOverlay() {
    const cropWindow = V.$('cropWindow');
    let isDragging = false;

    function onMove(e) {
      if (!isDragging) return;
      const rect = V.$('videoPreview').getBoundingClientRect();
      const x = e.clientX - rect.left;
      S.cropX = Math.max(0.1, Math.min(0.9, x / rect.width));
      updateSelectedSegmentCropX(S.cropX);
      updateCropOverlay();
    }

    cropWindow.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
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
    if (!video.videoWidth) return;

    const videoRect = video.getBoundingClientRect();
    const wrapRect = V.$('previewWrap').getBoundingClientRect();

    const offsetX = videoRect.left - wrapRect.left;
    const cropWidth = videoRect.height * (9 / 16);
    const cropLeft = offsetX + videoRect.width * S.cropX - cropWidth / 2;

    V.$('cropLeft').style.width = `${Math.max(0, cropLeft - offsetX)}px`;
    V.$('cropLeft').style.left = `${offsetX}px`;
    V.$('cropRight').style.width =
      `${Math.max(0, offsetX + videoRect.width - (cropLeft + cropWidth))}px`;
    V.$('cropRight').style.right = `${wrapRect.width - offsetX - videoRect.width}px`;
    V.$('cropWindow').style.left = `${cropLeft}px`;
    V.$('cropWindow').style.width = `${cropWidth}px`;

    // Match the crop window's colour to the selected segment
    if (S.segments.length > 0 && S.selectedIndex < S.segments.length) {
      const colors = window.VidLetPortraitRendering.SEGMENT_COLORS;
      const segColor = colors[S.selectedIndex % colors.length];
      V.$('cropWindow').style.borderColor = segColor;
      for (const h of document.querySelectorAll('.crop-handle')) {
        h.style.background = segColor;
      }
    }
  }

  window.VidLetPortraitCrop = {
    initCropOverlay,
    updateCropOverlay,
    updateSelectedSegmentCropX,
  };
  // biome-ignore lint/suspicious/noAssignInExpressions: IIFE pattern for module initialization
})(window.VidLet || (window.VidLet = {}));
