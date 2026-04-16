/**
 * Caption Tool Module
 * Handles SRT subtitle file loading and karaoke-style caption preview
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

  /**
   * Initialize caption tool - set up event handlers and preview
   */
  function init() {
    // Initialize segmented button handlers
    for (const groupId of ['captionPosition', 'captionSize']) {
      const group = $(groupId);
      if (!group) continue;

      for (const btn of group.querySelectorAll('button')) {
        btn.onclick = () => {
          for (const b of group.querySelectorAll('button')) {
            b.classList.remove('active');
          }
          btn.classList.add('active');
          const hiddenId = groupId === 'captionPosition' ? 'caption-position' : 'caption-size';
          $(hiddenId).value = btn.dataset.val;
          updatePreview();
        };
      }
    }

    // Initialize drop zone
    const dropZone = $('srtDropZone');
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

    updatePreview();
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
        $('srtFileName').textContent = file.name;
        $('srtDropZone').classList.add('has-file');
        $('captionStatus').textContent = `Loaded: ${file.name}`;
        updatePreview();
      };
      reader.readAsText(file);
    }
  }

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

    // Add highlight to first word (karaoke effect)
    const words = previewText.split(' ');
    if (words.length > 0) {
      words[0] = `<span class="highlight">${words[0]}</span>`;
    }
    textEl.innerHTML = words.join(' ');

    // Update position class
    const position = $('caption-position')?.value || 'bottom';
    overlay.classList.remove('pos-top', 'pos-center');
    if (position === 'top') overlay.classList.add('pos-top');
    else if (position === 'center') overlay.classList.add('pos-center');

    // Scale font size based on video preview height
    const size = Number.parseInt($('caption-size')?.value) || 48;
    const video = $('videoPreview');
    const scale = video ? video.clientHeight / 720 : 0.4;
    const previewSize = Math.round(size * scale);
    textEl.style.fontSize = `${Math.max(12, previewSize)}px`;
  }

  /**
   * Get caption options for processing
   * @returns {Object} Caption configuration
   */
  function getOptions() {
    return {
      srtContent: captionUsingDefault ? null : captionSrtContent,
      position: $('caption-position')?.value || 'bottom',
      size: Number.parseInt($('caption-size')?.value) || 48,
      usingDefault: captionUsingDefault,
    };
  }

  /**
   * Check if captions are enabled
   * @returns {boolean} True if custom captions are loaded
   */
  function isEnabled() {
    return !captionUsingDefault && captionSrtContent.length > 0;
  }

  /**
   * Reset caption tool to default state
   */
  function reset() {
    captionSrtContent = DEFAULT_SRT;
    captionUsingDefault = true;
    $('srtFileName').textContent = 'Drop .srt file or click to browse';
    $('srtDropZone').classList.remove('has-file');
    $('captionStatus').textContent = 'Using test subtitle';

    // Reset position and size
    setSegBtn('captionPosition', 'bottom');
    setSegBtn('captionSize', '48');

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
