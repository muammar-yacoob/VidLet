/**
 * Player Controls Module
 * Manages video player controls and keyboard shortcuts
 */
(() => {
  const { $, formatDuration } = window.VidLet;
  const { formatTime, matchesHotkey } = window.VidLetUtils;

  // Player state
  let currentSpeed = 1;

  /**
   * Initialize player controls
   * @param {Function} setTrimStartToCurrent - Callback to set trim start
   * @param {Function} setTrimEndToCurrent - Callback to set trim end
   * @param {Function} getActiveTool - Callback to get active tool
   */
  function initPlayerControls(setTrimStartToCurrent, setTrimEndToCurrent, getActiveTool) {
    const video = $('videoPreview');
    const playBtn = $('playBtn');
    const muteBtn = $('muteBtn');
    const speedBtn = $('speedBtn');
    const progressBar = $('progress-bar');
    const progressFill = $('progress-fill');
    const currentTimeEl = $('current-time');
    const durationEl = $('total-duration');

    // Play/Pause
    playBtn?.addEventListener('click', togglePlay);
    video.addEventListener('play', () => {
      playBtn.textContent = 'Pause';
      playBtn.classList.add('playing');
    });
    video.addEventListener('pause', () => {
      playBtn.textContent = 'Play';
      playBtn.classList.remove('playing');
    });

    // Mute
    muteBtn?.addEventListener('click', toggleMute);

    // Speed control
    speedBtn?.addEventListener('click', cycleSpeed);

    // Progress bar
    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      progressFill.style.width = `${pct}%`;
      currentTimeEl.textContent = formatTime(video.currentTime);
      durationEl.textContent = formatDuration(video.duration);
    });

    progressBar?.addEventListener('click', (e) => {
      const rect = progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      video.currentTime = pct * video.duration;
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) =>
      handlePlayerKeydown(e, setTrimStartToCurrent, setTrimEndToCurrent, getActiveTool)
    );
  }

  /**
   * Toggle play/pause
   */
  function togglePlay() {
    const video = $('videoPreview');
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  /**
   * Toggle mute
   */
  function toggleMute() {
    const video = $('videoPreview');
    video.muted = !video.muted;
    const muteBtn = $('muteBtn');
    if (muteBtn) {
      muteBtn.textContent = video.muted ? 'Unmute' : 'Mute';
    }
  }

  /**
   * Cycle through playback speeds
   */
  function cycleSpeed() {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(currentSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    currentSpeed = speeds[nextIndex];
    const video = $('videoPreview');
    video.playbackRate = currentSpeed;
    const speedBtn = $('speedBtn');
    if (speedBtn) {
      speedBtn.textContent = `${currentSpeed}x`;
    }
  }

  /**
   * Handle player keyboard shortcuts
   * @param {KeyboardEvent} e - Keyboard event
   * @param {Function} setTrimStartToCurrent - Callback to set trim start
   * @param {Function} setTrimEndToCurrent - Callback to set trim end
   * @param {Function} getActiveTool - Callback to get active tool
   */
  function handlePlayerKeydown(e, setTrimStartToCurrent, setTrimEndToCurrent, getActiveTool) {
    // Don't handle if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const video = $('videoPreview');
    const hotkeys = window.VidLet.hotkeys.getMap();
    const activeTool = getActiveTool();

    // Space: Play/Pause
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }

    // M: Mute
    if (e.code === 'KeyM') {
      e.preventDefault();
      toggleMute();
      return;
    }

    // Arrow keys: Seek
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const delta = e.code === 'ArrowLeft' ? -1 : 1;
      if (e.altKey) {
        // Frame step (assuming 30fps)
        video.currentTime += delta / 30;
      } else {
        // 1 second step
        video.currentTime += delta;
      }
      return;
    }

    // Trim tool hotkeys
    if (activeTool === 'trim') {
      if (matchesHotkey(e, hotkeys.markIn)) {
        e.preventDefault();
        setTrimStartToCurrent();
        return;
      }
      if (matchesHotkey(e, hotkeys.markOut)) {
        e.preventDefault();
        setTrimEndToCurrent();
        return;
      }
    }

    // Portrait tool hotkeys
    if (activeTool === 'portrait') {
      if (matchesHotkey(e, hotkeys.split)) {
        e.preventDefault();
        window.VidLet.portrait.splitAtCurrentTime();
        return;
      }
      if (matchesHotkey(e, hotkeys.delete)) {
        e.preventDefault();
        window.VidLet.portrait.deleteSelectedSegment();
        return;
      }
      if (matchesHotkey(e, hotkeys.selectPrev)) {
        e.preventDefault();
        window.VidLet.portrait.selectPreviousSegment();
        return;
      }
      if (matchesHotkey(e, hotkeys.selectNext)) {
        e.preventDefault();
        window.VidLet.portrait.selectNextSegment();
        return;
      }
    }

    // Undo/Redo
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        window.VidLet.undo.undo();
        return;
      }
      if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') {
        e.preventDefault();
        window.VidLet.undo.redo();
        return;
      }
    }
  }

  // Export API
  window.VidLetPlayerControls = {
    initPlayerControls,
    togglePlay,
    toggleMute,
    cycleSpeed,
  };
})();
