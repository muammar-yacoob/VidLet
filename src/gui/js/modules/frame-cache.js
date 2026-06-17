/**
 * VidLet Frame Cache Module
 * Caches video frames for smooth scrubbing preview
 * Uses a hidden video element so caching doesn't interrupt playback
 */
window.VidLet = window.VidLet || {};
((V) => {
  let frames = [];
  let canvas = null;
  let ctx = null;
  let ready = false;
  const INTERVAL = 0.25;

  /**
   * Build frame cache from video using a hidden clone
   * @param {number} [_frameSkip] - unused, kept for API compat
   * @param {Function} [onProgress] - called with percentage (0-100)
   */
  async function build(_frameSkip, onProgress) {
    const source = V.$('videoPreview');
    if (!source || !source.duration) return;

    // Create a hidden video element for background caching
    const video = document.createElement('video');
    video.src = source.currentSrc || source.src;
    video.muted = true;
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
      video.addEventListener('canplay', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      video.load();
    });

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

    for (let i = 0; i <= frameCount; i++) {
      const time = Math.min(i * INTERVAL, duration);

      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({
            time,
            dataUrl: canvas.toDataURL('image/jpeg', 0.7),
          });
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = time;
      });

      const pct = Math.round((i / frameCount) * 100);
      if (onProgress) onProgress(pct);

      const cachedBar = V.$('playerCached');
      if (cachedBar) cachedBar.style.width = `${pct}%`;

      const statusEl = V.$('scrub-cache-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = `Caching ${pct}%`;
      }
    }

    // Cleanup hidden video
    video.src = '';
    video.load();

    ready = true;
    const statusEl = V.$('scrub-cache-status');
    if (statusEl) statusEl.style.display = 'none';
    if (onProgress) onProgress(100);
    console.log(`Frame cache ready: ${frames.length} frames`);
  }

  /**
   * Get cached frame closest to time
   */
  function get(time) {
    if (!ready || frames.length === 0) return null;

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

  function hideFrame() {
    const overlay = V.$('scrub-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function isReady() {
    return ready;
  }

  function clear() {
    frames = [];
    ready = false;
  }

  V.frameCache = { build, get, showFrame, hideFrame, isReady, clear };
})(window.VidLet);
