/**
 * Player Controls Module
 * Manages video player controls and keyboard shortcuts
 */
(() => {
  const { $ } = window.VidLet;
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
    const seek = $('playerSeek');

    // Play/Pause icon toggling
    video.addEventListener('play', updatePlayIcon);
    video.addEventListener('pause', updatePlayIcon);

    // Progress bar + time display + timeline playhead
    video.addEventListener('timeupdate', () => {
      updateTimeDisplay(getActiveTool);
      updatePlayhead();
      if (getActiveTool() === 'portrait') {
        window.VidLet.portrait.updatePlayhead?.();
      }
    });

    // Seek on click
    seek?.addEventListener('click', (e) => {
      const rect = seek.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      video.currentTime = pct * video.duration;
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) =>
      handlePlayerKeydown(e, setTrimStartToCurrent, setTrimEndToCurrent, getActiveTool)
    );
  }

  function updatePlayIcon() {
    const video = $('videoPreview');
    $('playIcon').style.display = video.paused ? 'block' : 'none';
    $('pauseIcon').style.display = video.paused ? 'none' : 'block';
  }

  function updateTimeDisplay(getActiveTool) {
    const video = $('videoPreview');
    if (!video.duration) return;

    const currentTime = video.currentTime;

    if (getActiveTool() === 'trim') {
      const trimStart = Number.parseFloat($('trim-start').value) || 0;
      const trimEnd = Number.parseFloat($('trim-end').value) || video.duration;
      const trimDuration = trimEnd - trimStart;
      const relativeTime = Math.max(0, currentTime - trimStart);
      const pct = trimDuration > 0 ? (relativeTime / trimDuration) * 100 : 0;
      $('playerProgress').style.width = Math.min(100, pct) + '%';
      $('playerThumb').style.left = Math.min(100, pct) + '%';
      $('playerTime').textContent = formatTime(relativeTime) + ' / ' + formatTime(trimDuration);
    } else {
      const pct = (currentTime / video.duration) * 100;
      $('playerProgress').style.width = pct + '%';
      $('playerThumb').style.left = pct + '%';
      $('playerTime').textContent = formatTime(currentTime) + ' / ' + formatTime(video.duration);
    }
  }

  function updatePlayhead() {
    const video = $('videoPreview');
    const playhead = $('timeline-playhead');
    if (!video.duration || !playhead) return;
    const pct = (video.currentTime / video.duration) * 100;
    playhead.style.left = pct + '%';
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
    updateVolumeUI();
  }

  function updateVolumeUI() {
    const video = $('videoPreview');
    const muted = video.muted || video.volume === 0;
    $('volIcon').style.display = muted ? 'none' : 'block';
    $('mutedIcon').style.display = muted ? 'block' : 'none';
    $('volumeLevel').style.width = (muted ? 0 : video.volume * 100) + '%';
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
    const speedBtn = $('speedVal');
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
        window.VidLet.portrait.splitSegment();
        return;
      }
      if (matchesHotkey(e, hotkeys.delete)) {
        e.preventDefault();
        window.VidLet.portrait.deleteSegment();
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
    updateVolumeUI,
    cycleSpeed,
  };
})();
