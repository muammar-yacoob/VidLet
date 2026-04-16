/**
 * Match Markers Module
 * Manages loop match markers for the trim tool
 */
(() => {
  const { $, fetchJson } = window.VidLet;
  const { showToast } = window.VidLetUtils;

  // Match markers state
  let matchMarkers = [];
  let currentMatchIndex = 0;
  let autoZoomEnabled = false;
  const MATCH_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];

  // Pre-initialized matches cache (from loading screen)
  let preloadedMatches = null;
  let preloadPromise = null;

  /**
   * Find best loop start point
   * @param {object} info - Video info object
   */
  async function findBestLoopStart(info) {
    const btn = $('find-match-btn');
    if (!btn) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Finding...';

    try {
      const res = await fetchJson(`/api/find-loop-start?duration=${info.duration}`);
      if (res.success && res.time !== undefined) {
        $('trim-start').value = res.time.toFixed(2);
        if (window.VidLetTrimTimeline) {
          window.VidLetTrimTimeline.updateTimeline(info);
        }
        showToast('Best loop start found');
      }
    } catch (err) {
      console.error('Failed to find loop start:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  /**
   * Preload matches in background
   * @param {object} info - Video info object
   */
  async function preloadMatches(info) {
    try {
      const res = await fetchJson(`/api/find-matches?duration=${info.duration}`);
      if (res.success && res.matches) {
        preloadedMatches = res.matches;
      }
    } catch (err) {
      console.error('Failed to preload matches:', err);
    }
  }

  /**
   * Find all matching frames
   * @param {object} info - Video info object
   */
  async function findAllMatches(info) {
    const btn = event?.target;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Finding...';
    }

    try {
      let matches;
      if (preloadedMatches) {
        matches = preloadedMatches;
      } else {
        if (preloadPromise) {
          await preloadPromise;
          matches = preloadedMatches;
        } else {
          const res = await fetchJson(`/api/find-matches?duration=${info.duration}`);
          matches = res.matches || [];
        }
      }

      matchMarkers = matches.map((m, i) => ({
        time: m.time,
        similarity: m.similarity,
        color: MATCH_COLORS[i % MATCH_COLORS.length],
      }));

      if (matchMarkers.length > 0) {
        currentMatchIndex = 0;
        renderMatchMarkers(info);
        showToast(`Found ${matchMarkers.length} similar frames`);
      } else {
        showToast('No similar frames found');
      }
    } catch (err) {
      console.error('Failed to find matches:', err);
      showToast('Error finding matches');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Find All Matches';
      }
    }
  }

  /**
   * Render match markers on timeline
   * @param {object} info - Video info object
   */
  function renderMatchMarkers(info) {
    const container = $('match-markers');
    if (!container) return;

    container.innerHTML = '';
    const duration = info.duration || 10;

    matchMarkers.forEach((marker, index) => {
      const el = document.createElement('div');
      el.className = 'match-marker';
      el.style.left = `${(marker.time / duration) * 100}%`;
      el.style.background = marker.color;
      el.dataset.index = index;
      el.title = `Match ${index + 1}: ${marker.time.toFixed(2)}s (${(marker.similarity * 100).toFixed(1)}% similar)`;

      if (index === currentMatchIndex) {
        el.classList.add('active');
      }

      el.addEventListener('click', () => {
        currentMatchIndex = index;
        jumpToMatch(index);
      });

      container.appendChild(el);
    });
  }

  /**
   * Jump to specific match marker
   * @param {number} index - Match index
   */
  function jumpToMatch(index) {
    if (index < 0 || index >= matchMarkers.length) return;
    currentMatchIndex = index;
    const marker = matchMarkers[index];
    const video = $('videoPreview');
    video.currentTime = marker.time;
    renderMatchMarkers(window.videoInfo);

    if (autoZoomEnabled && window.VidLetTrimTimeline) {
      const panToMarker = window.VidLetTrimTimeline.getPanToMarker();
      if (panToMarker) {
        panToMarker(marker.time);
      }
    }
  }

  /**
   * Navigate to next match
   */
  function nextMatch() {
    if (matchMarkers.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % matchMarkers.length;
    jumpToMatch(currentMatchIndex);
  }

  /**
   * Navigate to previous match
   */
  function prevMatch() {
    if (matchMarkers.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + matchMarkers.length) % matchMarkers.length;
    jumpToMatch(currentMatchIndex);
  }

  /**
   * Clear all match markers
   */
  function clearMatches() {
    matchMarkers = [];
    currentMatchIndex = 0;
    if (window.videoInfo && window.VidLetTrimTimeline) {
      window.VidLetTrimTimeline.updateTimeline(window.videoInfo);
    }
    showToast('Matches cleared');
  }

  /**
   * Toggle auto-zoom to marker on hover
   */
  function toggleAutoZoom() {
    autoZoomEnabled = !autoZoomEnabled;
    const btn = $('toggle-autozoom-btn');
    if (btn) {
      btn.textContent = autoZoomEnabled ? 'Auto-Zoom: ON' : 'Auto-Zoom: OFF';
      btn.classList.toggle('active', autoZoomEnabled);
    }
  }

  /**
   * Set preload promise
   * @param {Promise} promise - Preload promise
   */
  function setPreloadPromise(promise) {
    preloadPromise = promise;
  }

  // Export API
  window.VidLetMatchMarkers = {
    findBestLoopStart,
    preloadMatches,
    findAllMatches,
    renderMatchMarkers,
    nextMatch,
    prevMatch,
    clearMatches,
    toggleAutoZoom,
    setPreloadPromise,
  };
})();
