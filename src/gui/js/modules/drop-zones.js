/**
 * Drop Zones Module
 * Manages drag-and-drop zones for audio, caption, and thumb tools
 */
(() => {
  const { $ } = window.VidLet;

  /**
   * Initialize all drop zones
   */
  function initDropZones() {
    initAudioDropZone();
    initCaptionDropZone();
    initThumbDropZone();
  }

  /**
   * Initialize audio tool drop zone
   */
  function initAudioDropZone() {
    const audioDropZone = $('audio-drop-zone');
    if (!audioDropZone) return;

    audioDropZone.addEventListener('click', () => {
      window.VidLetAudioTool.handleFile();
    });

    audioDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      audioDropZone.classList.add('drag-over');
    });

    audioDropZone.addEventListener('dragleave', () => {
      audioDropZone.classList.remove('drag-over');
    });

    audioDropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      audioDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        await window.VidLetAudioTool.handleFile(file);
      }
    });
  }

  /**
   * Initialize caption tool drop zone
   */
  function initCaptionDropZone() {
    const captionDropZone = $('caption-drop-zone');
    if (!captionDropZone) return;

    captionDropZone.addEventListener('click', () => {
      window.VidLetCaptionTool.handleFile();
    });

    captionDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      captionDropZone.classList.add('drag-over');
    });

    captionDropZone.addEventListener('dragleave', () => {
      captionDropZone.classList.remove('drag-over');
    });

    captionDropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      captionDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        await window.VidLetCaptionTool.handleFile(file);
      }
    });
  }

  /**
   * Initialize thumb tool drop zone
   */
  function initThumbDropZone() {
    const thumbDropZone = $('thumb-drop-zone');
    if (!thumbDropZone) return;

    thumbDropZone.addEventListener('click', () => {
      window.VidLetThumbTool.handleFile();
    });

    thumbDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      thumbDropZone.classList.add('drag-over');
    });

    thumbDropZone.addEventListener('dragleave', () => {
      thumbDropZone.classList.remove('drag-over');
    });

    thumbDropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      thumbDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        await window.VidLetThumbTool.handleFile(file);
      }
    });
  }

  // Export API
  window.VidLetDropZones = {
    initDropZones,
  };
})();
