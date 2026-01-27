/**
 * VidLet Frame Cache Module
 * Caches video frames for smooth scrubbing preview
 */
(function(V) {
  let frames = [];
  let canvas = null;
  let ctx = null;
  let ready = false;
  const INTERVAL = 0.25; // Cache frame every 0.25 seconds

  /**
   * Build frame cache from video
   */
  async function build() {
    const video = V.$('videoPreview');
    if (!video || !video.duration) return;

    // Create offscreen canvas at half resolution
    canvas = document.createElement('canvas');
    const scale = 0.5;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    frames = [];
    ready = false;

    const duration = video.duration;
    const frameCount = Math.ceil(duration / INTERVAL);
    const originalTime = video.currentTime;
    const wasPlaying = !video.paused;

    if (wasPlaying) video.pause();

    const statusEl = V.$('scrub-cache-status');
    if (statusEl) statusEl.style.display = 'block';

    for (let i = 0; i <= frameCount; i++) {
      const time = Math.min(i * INTERVAL, duration);

      await new Promise(resolve => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({
            time,
            dataUrl: canvas.toDataURL('image/jpeg', 0.7)
          });
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = time;
      });

      if (statusEl) {
        statusEl.textContent = `Caching ${Math.round((i / frameCount) * 100)}%`;
      }
    }

    video.currentTime = originalTime;
    if (wasPlaying) video.play();

    ready = true;
    if (statusEl) statusEl.style.display = 'none';
    V.log(`Frame cache ready: ${frames.length} frames`);
  }

  /**
   * Get cached frame closest to time
   */
  function get(time) {
    if (!ready || frames.length === 0) return null;

    // Binary search
    let left = 0;
    let right = frames.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (frames[mid].time < time) left = mid + 1;
      else right = mid;
    }

    if (left > 0 && Math.abs(frames[left - 1].time - time) < Math.abs(frames[left].time - time)) {
      left--;
    }

    return frames[left];
  }

  /**
   * Show scrub overlay with cached frame
   */
  function showFrame(time) {
    const overlay = V.$('scrub-overlay');
    const img = V.$('scrub-frame');
    if (!overlay || !img) return;

    const frame = get(time);
    if (frame) {
      img.src = frame.dataUrl;
      overlay.style.display = 'block';
    }
  }

  /**
   * Hide scrub overlay
   */
  function hideFrame() {
    const overlay = V.$('scrub-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Check if cache is ready
   */
  function isReady() {
    return ready;
  }

  /**
   * Clear cache
   */
  function clear() {
    frames = [];
    ready = false;
  }

  // Export to VidLet namespace
  V.frameCache = { build, get, showFrame, hideFrame, isReady, clear };

})(window.VidLet || (window.VidLet = {}));
