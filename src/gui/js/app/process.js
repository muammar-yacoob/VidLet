/**
 * VidLet App - running a tool
 *
 * Every tool posts to the same /api/process endpoint; all that differs is the
 * option payload, so each tool contributes a collector to OPTION_COLLECTORS
 * and `runProcess` owns the shared loading / polling / result handling.
 */
(() => {
  const App = window.VidLetApp;
  const { $, postJson } = VidLet;
  const { celebrate } = window.VidLetUtils;

  /** Tell the user why a tool can't run, and abort the run. */
  function refuse(message) {
    alert(message);
    return null;
  }

  /**
   * Per-tool option payloads. A collector returns the fields to merge into the
   * request, or null (having explained itself) when the tool can't run yet.
   * Tools absent from this table need nothing beyond their id.
   */
  const OPTION_COLLECTORS = {
    compress: () => window.VidLetCompressTool.getOptions(),
    togif: () => window.VidLetGifTool.getOptions(),
    shrink: () => window.VidLetShrinkTool.getOptions(),
    mkv2mp4: () => window.VidLetMkvTool.getOptions(),
    thumb: () => window.VidLetThumbTool.getOptions(),
    portrait: () => window.VidLet.portrait.getProcessOptions(),

    trim: () => ({
      trimStart: Number.parseFloat($('trim-start').value),
      trimEnd: Number.parseFloat($('trim-end').value),
      accurate: $('trim-accurate').value === 'true',
    }),

    audio: () => {
      if (App.audioMode !== 'clean') {
        if (!window.VidLetAudioTool.isLoaded()) return refuse('Please select an audio file first');
        return window.VidLetAudioTool.getOptions();
      }
      // Clean mode is a different tool wearing the audio panel
      const opts = {
        tool: 'cleanvoice',
        noiseReduction: Number.parseInt($('clean-noise').value, 10),
        targetLoudness: Number.parseInt($('clean-loudness').value, 10),
      };
      const nsStart = Number.parseFloat($('clean-noise-start').value);
      const nsEnd = Number.parseFloat($('clean-noise-end').value);
      if (nsStart >= 0 && nsEnd > nsStart) {
        opts.noiseSampleStart = nsStart;
        opts.noiseSampleEnd = nsEnd;
      }
      return opts;
    },

    filter: () => {
      if (!window.VidLetFilterTool.hasActiveFilters()) return refuse('No filters applied');
      return window.VidLetFilterTool.getFilterOptions();
    },

    caption: () => {
      if (!window.VidLetCaptionTool.isEnabled()) {
        return refuse('Please select a caption file first');
      }
      return window.VidLetCaptionTool.getOptions();
    },

    removesilence: () => ({
      minSilenceDuration: Number.parseFloat($('silence-duration').value),
      silenceThreshold: Number.parseFloat($('silence-threshold').value),
    }),

    autocleanup: () => ({
      noiseReduction: Number.parseInt($('cleanup-denoise').value, 10),
      minSilenceDuration: Number.parseFloat($('cleanup-silence').value),
      skipContrast: $('cleanup-skip-contrast').value === 'true',
      cleanupContrast: 1.15,
    }),

    jumpcut: () => ({
      jumpcutPace: $('jumpcut-pace')?.value || 'normal',
      jumpcutZoom: Number.parseInt($('jumpcut-zoom')?.value, 10) || 3,
    }),

    short: () => ({
      maxDuration: Number.parseInt($('short-duration').value, 10) || 57,
      captions: $('short-captions').value === 'true',
    }),

    demo: () => {
      const makeShort = $('demo-short').value === 'true';
      const opts = {
        about: $('demo-about').value.trim() || undefined,
        gender: $('demo-gender').value,
        makeShort,
        captions: makeShort,
      };
      const cloneRef = $('demo-clone').value.trim();
      if (cloneRef) opts.cloneRef = cloneRef;
      return opts;
    },

    voiceover: () => {
      const text = $('vo-text').value.trim();
      if (!text) return refuse('Please type the narration script first');
      const opts = { text, language: $('vo-lang').value, gender: $('vo-gender').value };
      const cloneRef = $('vo-clone').value.trim();
      if (cloneRef) {
        opts.cloneRef = cloneRef;
        opts.cloneEngine = $('vo-clone-engine').value;
      }
      return opts;
    },
  };

  function setLoading(on, label) {
    $('loading').classList.toggle('on', on);
    if (on) $('loading').querySelector('span').textContent = label;
  }

  /**
   * Poll the server's status line while a tool runs, animating the trailing
   * dots so a long stage still looks alive. Returns a stop function.
   */
  function pollStatus() {
    const logEl = $('process-log');
    logEl.textContent = '';
    let lastStatus = '';
    let dotCount = 0;

    const timer = setInterval(async () => {
      try {
        const s = await fetch('/api/process-status').then((r) => r.json());
        if (!s.status) return;
        const base = s.status.replace(/\.+$/, '');
        if (base !== lastStatus) lastStatus = base;
        dotCount = (dotCount % 3) + 1;
        logEl.textContent = `› ${lastStatus}${'.'.repeat(dotCount)}`;
      } catch {
        /* ignore */
      }
    }, 400);

    return () => clearInterval(timer);
  }

  /**
   * Post a job, show the result, and surface any error as an alert.
   *
   * @param {object} opts Request body.
   * @param {object} ui `{ busy, fallback, poll }` - loading label, message
   *   shown when the server returns no output path, and whether to poll status.
   */
  async function runProcess(opts, ui) {
    setLoading(true, ui.busy);
    const stopPolling = ui.poll ? pollStatus() : null;

    try {
      const res = await postJson('/api/process', opts);
      stopPolling?.();
      setLoading(false);

      if (!res.success) {
        alert(`Error: ${res.error || 'Unknown error'}`);
        return null;
      }

      celebrate();
      $('done').classList.add('on');
      $('output').textContent = res.output || ui.fallback;
      return res;
    } catch (err) {
      stopPolling?.();
      setLoading(false);
      alert(`Error: ${err.message}`);
      return null;
    }
  }

  /** Offer an AI filename and caption once a job lands — one round trip for both. */
  function showAiSuggestions(tool) {
    $('ai-rename-row').classList.add('hidden');
    $('ai-caption-row').classList.add('hidden');
    if (!window.VidLetAI?.isAvailable()) return;

    window.VidLetAI.suggestOutputText(tool, App.info).then(({ name, caption }) => {
      if (name) {
        $('ai-rename-text').textContent = name;
        $('ai-rename-row').classList.remove('hidden');
      }
      if (caption) {
        $('ai-caption-text').textContent = caption;
        $('ai-caption-row').classList.remove('hidden');
      }
    });
  }

  async function process() {
    const tool = App.activeTool;
    if (!tool) return;

    // Stop playback before processing
    const video = $('videoPreview');
    if (video && !video.paused) video.pause();

    const collect = OPTION_COLLECTORS[tool];
    const extra = collect ? collect() : {};
    if (extra === null) return;

    const res = await runProcess(
      { tool, ...extra },
      { busy: 'Processing...', fallback: 'Processing complete!', poll: true }
    );
    if (res) showAiSuggestions(tool);
  }

  async function extractAudio() {
    window.VidLetExtractAudio.close();
    await runProcess(window.VidLetExtractAudio.getOptions(), {
      busy: 'Extracting audio...',
      fallback: 'Audio extracted!',
    });
  }

  function continueEditing() {
    $('done').classList.remove('on');
    if (!App.skipReloadOnContinue) location.reload();
    App.skipReloadOnContinue = false;
  }

  /** Ask the AI for auto-cleanup settings and apply what it suggests. */
  async function aiSuggestSettings() {
    const btn = $('ai-suggest-btn');
    btn.disabled = true;
    btn.textContent = 'Thinking...';

    const settings = await window.VidLetAI.suggestCleanupSettings(App.info);
    if (settings) {
      if (settings.noiseReduction != null) {
        $('cleanup-denoise').value = settings.noiseReduction;
        $('cleanup-denoise-val').textContent = String(settings.noiseReduction);
      }
      if (settings.minSilenceDuration != null) {
        $('cleanup-silence').value = settings.minSilenceDuration;
        $('cleanup-silence-val').textContent = `${settings.minSilenceDuration}s`;
      }
      if (settings.applyContrast != null) {
        const on = settings.applyContrast === true;
        $('cleanup-contrast-toggle').classList.toggle('on', on);
        $('cleanup-skip-contrast').value = on ? 'false' : 'true';
        $('cleanup-contrast-label').textContent = on ? 'On (AI)' : 'Off (AI)';
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="ai-badge">AI</span> Suggest settings';
  }

  Object.assign(App, { process, extractAudio, continueEditing, aiSuggestSettings });
})();
