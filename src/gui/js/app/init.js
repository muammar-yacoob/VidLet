/**
 * VidLet App - boot sequence
 *
 * Reads /api/info, decides which tools this file can use, wires the modules
 * up and kicks off frame caching.
 */
(() => {
  const App = window.VidLetApp;
  const { $, formatDuration } = VidLet;
  const { formatFileSize, getAspectRatioLabel } = window.VidLetUtils;

  /**
   * Apply saved slider defaults, writing the matching label as we go.
   *
   * @param {object|undefined} saved Config section from the server.
   * @param {Array<[string, string, string, unknown, (v: string) => string]>} fields
   *   `[inputId, labelId, configKey, fallback, format]` for each slider.
   */
  function applyDefaults(saved, fields) {
    if (!saved) return;
    for (const [inputId, labelId, configKey, fallback, format] of fields) {
      $(inputId).value = saved[configKey] ?? fallback;
      $(labelId).textContent = format($(inputId).value);
    }
  }

  /**
   * Wire a segmented button group to the hidden input holding its value.
   */
  function initSegmentedGroup(groupId, hiddenId) {
    const group = $(groupId);
    if (!group) return;
    for (const btn of group.querySelectorAll('button')) {
      btn.onclick = () => {
        for (const b of group.querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        $(hiddenId).value = btn.dataset.val;
      };
    }
  }

  function updateFileDisplay() {
    const { info } = App;
    $('fileName').textContent = ` ${info.fileName}`;
    $('resolution').textContent = ` ${info.width.toLocaleString()}×${info.height.toLocaleString()}`;
    $('aspectRatio').textContent = ` ${getAspectRatioLabel(info.width, info.height)}`;
    $('fileSize').textContent = ` ${formatFileSize(info.fileSize)}`;
    $('duration').textContent = ` ${formatDuration(info.duration)}`;
    $('fps').textContent = ` ${info.fps ? info.fps.toFixed(1) : '-'}`;
  }

  /**
   * Start frame caching and report progress to the loading window, which
   * closes itself once enough of the video is cached.
   */
  function startFrameCaching() {
    const video = $('videoPreview');

    const startCaching = () => {
      const progressEl = $('cache-progress');
      if (progressEl) {
        progressEl.style.display = 'flex';
        $('cache-progress-label').textContent = 'Caching frames...';
        $('cache-progress-fill').style.width = '0%';
        $('cache-progress-pct').textContent = '0%';
      }

      if (window.VidLet.frameCache.isReady()) {
        VidLet.postJson('/api/progress', { percent: 100 });
        return;
      }

      const frameSkip = window.VidLetSettingsManager.getPhase1FrameSkip();
      window.VidLet.frameCache.build(frameSkip, (pct) => {
        $('cache-progress-fill').style.width = `${pct}%`;
        $('cache-progress-pct').textContent = `${pct}%`;
        VidLet.postJson('/api/progress', { percent: pct });
      });
    };

    const waitForVideo = () => {
      if (!video) return;
      if (video.readyState >= 2 && video.duration > 0) {
        startCaching();
        return;
      }
      VidLet.postJson('/api/progress', { percent: 0 });
      video.addEventListener(
        'canplay',
        () => {
          if (video.duration > 0) startCaching();
        },
        { once: true }
      );
    };

    if (document.readyState === 'complete') {
      waitForVideo();
    } else {
      window.addEventListener('load', waitForVideo, { once: true });
    }
  }

  /** Ctrl+wheel zooms the video and the timeline, never the page itself. */
  function initPageZoomLock() {
    document.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        const isVideoZoom = e.target.closest('#previewContainer');
        const isTimelineZoom = e.target.closest('#timeline-container');
        if (!isVideoZoom && !isTimelineZoom) e.preventDefault();
      },
      { passive: false }
    );
  }

  /** Hide tools this file can't use, and reveal the ones it can. */
  function applyToolAvailability(res) {
    // MKV files - show converter, disable other tools
    App.isMkvFile = res.defaults?.isMkv || false;
    $('t-mkv2mp4').classList.toggle('hidden', !App.isMkvFile);

    // Portrait is pointless on something already 9:16
    const isAlreadyPortrait = Math.abs(res.width / res.height - 9 / 16) < 0.05;
    $('t-portrait').classList.toggle('hidden', isAlreadyPortrait);

    // Audio-dependent tools need an audio track
    const noAudio = !res.hasAudio;
    $('t-removesilence').classList.toggle('hidden', noAudio);
    $('t-autocleanup').classList.toggle('hidden', noAudio);

    // GIF export only makes sense for short clips
    const canExportGif = res.duration <= 15;
    $('t-togif').classList.toggle('hidden', !canExportGif);
    if (canExportGif) App.showGifBadge();

    // Loop matching is only offered on short videos
    const isShortVideo = res.duration <= 60;
    $('find-match-btn').classList.toggle('hidden', !isShortVideo);
    return isShortVideo;
  }

  async function init() {
    const res = await VidLet.fetchJson('/api/info');
    App.info = res;
    window.videoInfo = res;
    window.VidLet.state.info = res;

    if (res.sparkAiKey && window.SparkAI) {
      window.SparkAI.configure({ apiKey: res.sparkAiKey });
      $('ai-suggest-btn')?.classList.remove('hidden');
    }
    updateFileDisplay();

    $('videoPreview').src = '/api/video';
    if (res.width && res.height) {
      VidLet.resizeToVideo(res.width, res.height);
    }

    if (res.defaults?.hotkeyPreset) {
      window.VidLetSettingsManager.setCurrentHotkeyPreset(res.defaults.hotkeyPreset);
      window.VidLet.hotkeys.setPreset(res.defaults.hotkeyPreset);
    }
    if (typeof res.defaults?.frameSkip === 'number') {
      window.VidLetSettingsManager.setPhase1FrameSkip(res.defaults.frameSkip);
    }

    const isShortVideo = applyToolAvailability(res);

    applyDefaults(res.defaults?.removesilence, [
      ['silence-duration', 'silence-duration-val', 'minSilenceDuration', 0.5, (v) => `${v}s`],
      ['silence-threshold', 'silence-threshold-val', 'silenceThreshold', -30, (v) => `${v}dB`],
    ]);
    applyDefaults(res.defaults?.autocleanup, [
      ['cleanup-denoise', 'cleanup-denoise-val', 'noiseReduction', 3, (v) => v],
      ['cleanup-silence', 'cleanup-silence-val', 'minSilenceDuration', 0.5, (v) => `${v}s`],
    ]);

    initSegmentedGroup('jumpcutPace', 'jumpcut-pace');
    initSegmentedGroup('jumpcutZoom', 'jumpcut-zoom');

    // Contrast is too slow to be worth it past five minutes
    if (res.duration > 300) {
      $('cleanup-contrast-toggle').classList.remove('on');
      $('cleanup-skip-contrast').value = 'true';
      $('cleanup-contrast-label').textContent = 'Off';
    }

    if (isShortVideo) {
      window.VidLetMatchMarkers.findBestLoopStart(App.info).then(() => {
        const preloadPromise = window.VidLetMatchMarkers.preloadMatches(App.info);
        window.VidLetMatchMarkers.setPreloadPromise(preloadPromise);
      });
    }

    if (res.defaults?.homepage) {
      App.homepage = res.defaults.homepage;
      $('homepageLink').textContent = App.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }

    // Start the trim handles somewhere visible rather than on the very edges
    const trimStart = Math.min(res.duration * 0.1, 5);
    const trimEnd = Math.max(res.duration * 0.9, res.duration - 5);
    $('trim-start').value = trimStart.toFixed(2);
    $('trim-end').value = Math.max(trimEnd, trimStart + 1).toFixed(2);
    window.VidLetTrimTimeline.updateTimeline(App.info);
    window.VidLetTrimTimeline.initTimelineHandles(App.info);
    window.VidLetTrimTimeline.initTimelineZoom(App.info);

    window.VidLetCompressTool.init(App.info);
    window.VidLetGifTool.init(App.info);
    window.VidLetShrinkTool.init(App.info);
    window.VidLetAudioTool.init();
    window.VidLetThumbTool.init();
    window.VidLetMkvTool.init();
    window.VidLetExtractAudio.init();
    window.VidLetCaptionTool.init();
    window.VidLet.portrait.init(App.info);

    window.VidLet.portrait.initOverlay();
    window.VidLetPlayerControls.initPlayerControls(
      () => window.VidLetTrimTimeline.setTrimStartToCurrent(App.info),
      () => window.VidLetTrimTimeline.setTrimEndToCurrent(App.info),
      () => App.activeTool
    );
    window.VidLetUIControls.initResizeDivider();
    window.VidLetDropZones.initDropZones();
    window.VidLetUIControls.initVideoZoom();
    initPageZoomLock();

    App.updateEstimates();

    // Select first tool (mkv2mp4 for MKV files, otherwise first available)
    if (App.isMkvFile) {
      App.selectTool('mkv2mp4');
    } else {
      const firstTool = document.querySelector('.tool:not(.hidden):not(.disabled)');
      if (firstTool) App.selectTool(firstTool.id.replace('t-', ''));
    }

    startFrameCaching();
  }

  App.init = init;
  App.updateFileDisplay = updateFileDisplay;
})();
