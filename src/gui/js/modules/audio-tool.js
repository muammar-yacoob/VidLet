/**
 * Audio Tool Module
 * Handles audio file upload, preview sync, and volume mixing
 */

(() => {
  const { $, postJson } = window.VidLet;

  // Audio state
  let audioMix = true;
  let audioVolume = 50;
  let audioPreviewLoaded = false;
  let activeTool = null; // Reference to active tool from main app

  /**
   * Set active tool reference from main app
   * @param {string} tool - Current active tool ID
   */
  function setActiveTool(tool) {
    activeTool = tool;
  }

  /**
   * Update audio volume from slider
   */
  function updateVolume() {
    audioVolume = Number.parseInt($('audio-volume')?.value);
    if ($('audio-vol-val')) {
      $('audio-vol-val').textContent = `${audioVolume}%`;
    }

    const audioEl = $('audioPreview');
    if (audioEl) audioEl.volume = audioVolume / 100;
  }

  /**
   * Toggle audio mix mode (blend vs replace)
   */
  function toggleMix() {
    audioMix = !audioMix;
    $('audio-toggle')?.classList.toggle('on', audioMix);

    const labelEl = $('audio-toggle')?.querySelector('.toggle-label');
    if (labelEl) {
      labelEl.textContent = audioMix ? 'Blend with original' : 'Replace original';
    }

    if (activeTool === 'audio' && audioPreviewLoaded) {
      const video = $('videoPreview');
      if (video) video.muted = !audioMix;
      updateVolumeUI();
    }
  }

  /**
   * Setup audio preview synchronization with video
   */
  function setupSync() {
    const video = $('videoPreview');
    const audio = $('audioPreview');

    if (!video || !audio) return;

    video.addEventListener('play', () => {
      if (activeTool === 'audio' && audioPreviewLoaded) {
        audio.currentTime = video.currentTime;
        audio.play().catch(() => {});
      }
    });

    video.addEventListener('pause', () => audio.pause());

    video.addEventListener('seeked', () => {
      if (activeTool === 'audio' && audioPreviewLoaded) {
        audio.currentTime = video.currentTime;
      }
    });

    video.addEventListener('timeupdate', () => {
      if (activeTool === 'audio' && audioPreviewLoaded && !video.paused) {
        const drift = Math.abs(audio.currentTime - video.currentTime);
        if (drift > 0.3) audio.currentTime = video.currentTime;
      }
    });
  }

  /**
   * Start audio preview playback
   */
  function startPreview() {
    if (!audioPreviewLoaded) return;

    const video = $('videoPreview');
    const audio = $('audioPreview');

    if (!video || !audio) return;

    audio.volume = audioVolume / 100;
    video.muted = !audioMix;
    audio.currentTime = video.currentTime;

    if (!video.paused) {
      audio.play().catch(() => {});
    }

    updateVolumeUI();
  }

  /**
   * Stop audio preview playback
   */
  function stopPreview() {
    const audio = $('audioPreview');
    const video = $('videoPreview');

    if (audio) audio.pause();
    if (video) video.muted = false;

    updateVolumeUI();
  }

  /**
   * Update volume UI icons and slider
   */
  function updateVolumeUI() {
    const video = $('videoPreview');
    if (!video) return;

    const muted = video.muted || video.volume === 0;
    const volIcon = $('volIcon');
    const mutedIcon = $('mutedIcon');
    const volumeLevel = $('volumeLevel');

    if (volIcon) volIcon.style.display = muted ? 'none' : 'block';
    if (mutedIcon) mutedIcon.style.display = muted ? 'block' : 'none';
    if (volumeLevel) volumeLevel.style.width = `${muted ? 0 : video.volume * 100}%`;
  }

  /**
   * Upload file to server
   * @param {File} file - File to upload
   * @param {string} type - File type ('audio' or 'image')
   * @returns {Promise<string>} Uploaded file path
   */
  async function uploadFile(file, type) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await postJson('/api/upload', {
            fileName: file.name,
            data: reader.result,
            type,
          });
          if (res.success) resolve(res.path);
          else reject(new Error(res.error || 'Upload failed'));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Handle audio file selection
   * @param {HTMLInputElement} input - File input element
   */
  async function handleFile(input) {
    if (input.files?.[0]) {
      const file = input.files[0];
      $('audioFileName').textContent = 'Uploading...';

      try {
        const audioEl = $('audioPreview');
        if (audioEl) {
          audioEl.src = URL.createObjectURL(file);
          audioEl.volume = audioVolume / 100;
        }
        audioPreviewLoaded = true;

        const path = await uploadFile(file, 'audio');
        $('audio-path').value = path;
        $('audioFileName').textContent = file.name;
        $('audioDropZone')?.classList.add('has-file');

        if (activeTool === 'audio') startPreview();
      } catch (err) {
        $('audioFileName').textContent = `Upload failed: ${err.message}`;
        audioPreviewLoaded = false;
      }
    }
  }

  /**
   * Get audio options for processing
   * @returns {Object|null} Audio configuration or null if no audio
   */
  function getOptions() {
    const audioPath = $('audio-path')?.value;
    if (!audioPath || !audioPreviewLoaded) return null;

    return {
      audioPath,
      volume: audioVolume,
      mix: audioMix,
    };
  }

  /**
   * Initialize audio tool drop zone
   */
  function init() {
    const dropZone = $('audioDropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        const input = $('audioFileInput');
        input.files = e.dataTransfer.files;
        handleFile(input);
      }
    });

    updateVolume();
  }

  /**
   * Check if audio is loaded
   * @returns {boolean} True if audio file is loaded
   */
  function isLoaded() {
    return audioPreviewLoaded;
  }

  // Export to global VidLetAudioTool namespace
  window.VidLetAudioTool = {
    setActiveTool,
    updateVolume,
    toggleMix,
    setupSync,
    startPreview,
    stopPreview,
    updateVolumeUI,
    handleFile,
    getOptions,
    init,
    isLoaded,
  };
})();
