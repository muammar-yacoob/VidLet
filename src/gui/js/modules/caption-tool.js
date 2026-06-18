/**
 * Caption Tool Module
 * Handles auto-transcription, SRT file loading, style presets,
 * color picking, and karaoke-style caption preview.
 */

(() => {
  const { $ } = window.VidLet;
  const { setSegBtn } = window.VidLetUtils;

  // Default test SRT content
  const DEFAULT_SRT = `1
00:00:00,500 --> 00:00:03,000
This is a sample caption

2
00:00:03,500 --> 00:00:06,500
With karaoke style highlighting

3
00:00:07,000 --> 00:00:10,000
Words light up as they play
`;

  let captionSrtContent = DEFAULT_SRT;
  let captionUsingDefault = true;
  let captionSource = 'auto'; // 'auto' | 'file'
  let captionStyleVal = 'hormozi';
  let captionColorVal = 'yellow';
  let transcribedSegments = null;
  let isTranscribing = false;

  /**
   * Initialize caption tool - set up event handlers and preview
   */
  function init() {
    // Source toggle (auto-transcribe vs upload SRT)
    initSegGroup('captionSource', (val) => {
      captionSource = val;
      $('captionAutoPanel').classList.toggle('hidden', val !== 'auto');
      $('captionFilePanel').classList.toggle('hidden', val !== 'file');
    });

    // Style preset toggle
    initSegGroup('captionStyle', (val) => {
      captionStyleVal = val;
      $('caption-style').value = val;
      // Show/hide color row — only relevant for hormozi and karaoke
      const colorRow = $('captionColorRow');
      if (colorRow) {
        colorRow.style.display = val === 'hormozi' || val === 'karaoke' ? '' : 'none';
      }
      updatePreview();
    });

    // Position toggle
    initSegGroup('captionPosition', (val) => {
      $('caption-position').value = val;
      updatePreview();
    });

    // Size toggle
    initSegGroup('captionSize', (val) => {
      $('caption-size').value = val;
      updatePreview();
    });

    // Color swatches
    const colorPicker = $('captionColorPicker');
    if (colorPicker) {
      for (const swatch of colorPicker.querySelectorAll('.color-swatch')) {
        swatch.onclick = () => {
          for (const s of colorPicker.querySelectorAll('.color-swatch')) {
            s.classList.remove('active');
          }
          swatch.classList.add('active');
          captionColorVal = swatch.dataset.color;
          $('caption-color').value = captionColorVal;
          updatePreview();
        };
      }
    }

    // Transcribe button
    const transcribeBtn = $('transcribeBtn');
    if (transcribeBtn) {
      transcribeBtn.onclick = startTranscribe;
    }

    // Initialize drop zone
    const dropZone = $('srtDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          const input = $('srtFileInput');
          input.files = e.dataTransfer.files;
          handleFile(input);
        }
      });
    }

    updatePreview();
  }

  /**
   * Helper: wire up a segmented button group
   */
  function initSegGroup(groupId, onChange) {
    const group = $(groupId);
    if (!group) return;
    for (const btn of group.querySelectorAll('button')) {
      btn.onclick = () => {
        for (const b of group.querySelectorAll('button')) b.classList.remove('active');
        btn.classList.add('active');
        onChange(btn.dataset.val);
      };
    }
  }

  /**
   * Start auto-transcription via the server
   */
  async function startTranscribe() {
    if (isTranscribing) return;
    isTranscribing = true;

    const btn = $('transcribeBtn');
    const btnText = $('transcribeBtnText');
    const status = $('captionStatus');

    btn.disabled = true;
    btnText.textContent = 'Transcribing...';
    status.textContent = 'Transcribing audio (this may take a moment)...';

    try {
      const res = await fetch('/api/transcribe', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        transcribedSegments = data.segments;
        captionSrtContent = data.srtContent;
        captionUsingDefault = false;

        const segCount = data.segments?.length || 0;
        status.textContent = `Transcribed: ${segCount} segments`;
        btnText.textContent = 'Re-transcribe';
        updatePreview();
      } else {
        status.textContent = `Error: ${data.error}`;
        btnText.textContent = 'Retry Transcribe';
      }
    } catch (err) {
      status.textContent = `Failed: ${err.message}`;
      btnText.textContent = 'Retry Transcribe';
    } finally {
      btn.disabled = false;
      isTranscribing = false;
    }
  }

  /**
   * Handle SRT file upload
   * @param {HTMLInputElement} input - File input element
   */
  function handleFile(input) {
    if (input.files?.[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        captionSrtContent = e.target.result;
        captionUsingDefault = false;
        transcribedSegments = null;
        $('srtFileName').textContent = file.name;
        $('srtDropZone').classList.add('has-file');
        $('captionStatus').textContent = `Loaded: ${file.name}`;
        updatePreview();
      };
      reader.readAsText(file);
    }
  }

  /**
   * Color name to CSS color for preview
   */
  const PREVIEW_COLORS = {
    yellow: '#FFE500',
    cyan: '#00E5FF',
    red: '#FF4444',
    green: '#44FF44',
    white: '#FFFFFF',
    orange: '#FF8000',
    pink: '#FF00FF',
  };

  /**
   * Update caption preview overlay with current settings
   */
  function updatePreview() {
    const overlay = $('captionOverlay');
    const textEl = $('captionOverlayText');
    if (!overlay || !textEl) return;

    // Parse first subtitle for preview
    const lines = captionSrtContent.split('\n');
    let previewText = 'Sample caption text';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->') && i + 1 < lines.length) {
        previewText = lines[i + 1].trim();
        break;
      }
    }

    // Sanitize text to prevent XSS from user-uploaded SRT content
    const escapeHtml = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const words = previewText.split(' ').map(escapeHtml);
    const hlColor = PREVIEW_COLORS[captionColorVal] || PREVIEW_COLORS.yellow;

    // Style-specific preview rendering
    if (captionStyleVal === 'hormozi' && words.length > 0) {
      words[0] = `<span class="highlight" style="color:${hlColor}">${words[0]}</span>`;
    } else if (captionStyleVal === 'karaoke' && words.length > 0) {
      // Show first two words as "filled"
      const filled = Math.min(2, words.length);
      for (let i = 0; i < filled; i++) {
        words[i] = `<span class="highlight" style="color:${hlColor}">${words[i]}</span>`;
      }
    }
    // classic and minimal: plain white text (no highlight in preview)

    textEl.innerHTML = words.join(' ');

    // Update style class on overlay
    overlay.className = 'caption-overlay';
    overlay.classList.add(`style-${captionStyleVal}`);

    // Update position class
    const position = $('caption-position')?.value || 'bottom';
    if (position === 'top') overlay.classList.add('pos-top');
    else if (position === 'center') overlay.classList.add('pos-center');

    // Scale font size based on video preview height
    const size = Number.parseInt($('caption-size')?.value) || 48;
    const video = $('videoPreview');
    const scale = video ? video.clientHeight / 720 : 0.4;
    const previewSize = Math.round(size * scale);
    textEl.style.fontSize = `${Math.max(12, previewSize)}px`;

    // Minimal style: smaller, less prominent
    if (captionStyleVal === 'minimal') {
      textEl.style.fontSize = `${Math.max(10, Math.round(previewSize * 0.65))}px`;
      overlay.classList.add('pos-bottom-left');
    }
  }

  /**
   * Get caption options for processing
   * @returns {Object} Caption configuration
   */
  function getOptions() {
    const useAutoTranscribe =
      captionSource === 'auto' && captionUsingDefault && !transcribedSegments;

    return {
      srtContent: captionUsingDefault ? null : captionSrtContent,
      captionAutoTranscribe: useAutoTranscribe,
      captionStyle: captionStyleVal,
      captionColor: captionColorVal,
      captionPosition: $('caption-position')?.value || 'bottom',
      captionFontSize: Number.parseInt($('caption-size')?.value) || 48,
      usingDefault: captionUsingDefault,
    };
  }

  /**
   * Check if captions are ready (transcribed or SRT loaded)
   * @returns {boolean}
   */
  function isEnabled() {
    // Enabled if we have transcribed content, uploaded SRT, or auto-transcribe is selected
    if (captionSource === 'auto') return true;
    return !captionUsingDefault && captionSrtContent.length > 0;
  }

  /**
   * Reset caption tool to default state
   */
  function reset() {
    captionSrtContent = DEFAULT_SRT;
    captionUsingDefault = true;
    captionSource = 'auto';
    captionStyleVal = 'hormozi';
    captionColorVal = 'yellow';
    transcribedSegments = null;
    isTranscribing = false;

    $('srtFileName').textContent = 'Drop .srt file or click to browse';
    const dropZone = $('srtDropZone');
    if (dropZone) dropZone.classList.remove('has-file');
    $('captionStatus').textContent = 'Ready';
    $('transcribeBtnText').textContent = 'Transcribe Audio';

    // Reset toggles
    setSegBtn('captionSource', 'auto');
    setSegBtn('captionStyle', 'hormozi');
    setSegBtn('captionPosition', 'bottom');
    setSegBtn('captionSize', '48');

    // Reset color swatches
    const colorPicker = $('captionColorPicker');
    if (colorPicker) {
      for (const s of colorPicker.querySelectorAll('.color-swatch')) {
        s.classList.toggle('active', s.dataset.color === 'yellow');
      }
    }

    // Reset panels
    $('captionAutoPanel')?.classList.remove('hidden');
    $('captionFilePanel')?.classList.add('hidden');

    // Reset hidden inputs
    $('caption-style').value = 'hormozi';
    $('caption-color').value = 'yellow';
    $('caption-position').value = 'bottom';
    $('caption-size').value = '48';

    updatePreview();
  }

  /**
   * Show caption overlay
   */
  function show() {
    $('captionOverlay')?.classList.remove('hidden');
    updatePreview();
  }

  /**
   * Hide caption overlay
   */
  function hide() {
    $('captionOverlay')?.classList.add('hidden');
  }

  // Export to global VidLetCaptionTool namespace
  window.VidLetCaptionTool = {
    init,
    handleFile,
    updatePreview,
    getOptions,
    isEnabled,
    reset,
    show,
    hide,
  };
})();
