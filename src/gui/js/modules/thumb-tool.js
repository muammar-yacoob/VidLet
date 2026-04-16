/**
 * Thumbnail Tool Module
 * Handles custom thumbnail selection from video frame or uploaded image
 */

(() => {
  const { $ } = window.VidLet;
  const { formatTimeMs } = window.VidLetUtils;

  // Video info reference
  let videoInfo = null;
  let activeTool = null;

  /**
   * Set video info and active tool references
   * @param {Object} info - Video metadata
   */
  function setVideoInfo(info) {
    videoInfo = info;
  }

  /**
   * Set active tool reference
   * @param {string} tool - Current active tool
   */
  function setActiveTool(tool) {
    activeTool = tool;
  }

  /**
   * Capture current video frame as thumbnail
   */
  function captureCurrentFrame() {
    const video = $('videoPreview');
    if (!video) return;

    const time = video.currentTime;
    $('thumb-timestamp').value = time.toFixed(3);
    $('thumb-source').value = 'video';
    $('thumbCapture')?.classList.add('selected');
    $('thumbUpload')?.classList.remove('selected');
    drawCanvas();
  }

  /**
   * Handle thumbnail upload area click
   */
  function handleClick() {
    // If image already loaded, select it; otherwise open file browser
    if ($('thumb-image')?.value) {
      selectUploadedImage();
    } else {
      $('thumbFileInput')?.click();
    }
  }

  /**
   * Select uploaded image as thumbnail source
   */
  function selectUploadedImage() {
    $('thumb-source').value = 'file';
    $('thumb-timestamp').value = '';
    $('thumbUpload')?.classList.add('selected');
    $('thumbCapture')?.classList.remove('selected');
  }

  /**
   * Update thumbnail frame time display
   */
  function updateFrameTime() {
    if (activeTool !== 'thumb') return;

    const video = $('videoPreview');
    const frameTimeEl = $('thumbFrameTime');

    if (video && frameTimeEl) {
      frameTimeEl.textContent = formatTimeMs(video.currentTime);
    }

    // Update canvas preview in real-time (only if not already selected)
    if (!$('thumbCapture')?.classList.contains('selected')) {
      drawCanvas();
    }
  }

  /**
   * Draw current video frame to thumbnail canvas
   */
  function drawCanvas() {
    const video = $('videoPreview');
    const canvas = $('thumbCanvas');

    if (!canvas || !video?.videoWidth) return;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  /**
   * Initialize thumbnail tool
   */
  function init() {
    $('thumb-timestamp').value = '';
    $('thumb-source').value = 'video';
    $('thumbCapture')?.classList.remove('selected');
    $('thumbUpload')?.classList.remove('selected');
    // Keep uploaded image - don't clear thumb-image value or has-image class
    updateAspectRatio();
    drawCanvas();
  }

  /**
   * Update thumbnail canvas aspect ratio based on video
   */
  function updateAspectRatio() {
    // Set aspect ratio based on video dimensions
    if (videoInfo?.width && videoInfo?.height) {
      const aspectRatio = videoInfo.width / videoInfo.height;

      // Update CSS variable on thumb preview boxes
      for (const box of document.querySelectorAll('.thumb-preview-box')) {
        box.style.setProperty('--video-aspect', `${videoInfo.width}/${videoInfo.height}`);
      }

      // Update canvas dimensions to match aspect ratio (keep width at 120)
      const canvas = $('thumbCanvas');
      if (canvas) {
        const canvasWidth = 120;
        const canvasHeight = Math.round(canvasWidth / aspectRatio);
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
      }
    }
  }

  /**
   * Handle uploaded thumbnail file
   * @param {HTMLInputElement} input - File input element
   * @returns {Promise<void>}
   */
  async function handleFile(input) {
    if (!input.files?.[0]) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const preview = $('thumbPreview');
      if (preview) preview.src = e.target.result;
      $('thumbUpload')?.classList.add('has-image');
    };

    reader.readAsDataURL(file);

    try {
      // Upload file (uses shared uploadFile from audio-tool pattern)
      const { postJson } = window.VidLet;
      const uploadResult = await new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = async () => {
          try {
            const res = await postJson('/api/upload', {
              fileName: file.name,
              data: fileReader.result,
              type: 'image',
            });
            if (res.success) resolve(res.path);
            else reject(new Error(res.error || 'Upload failed'));
          } catch (err) {
            reject(err);
          }
        };
        fileReader.onerror = () => reject(new Error('Failed to read file'));
        fileReader.readAsDataURL(file);
      });

      $('thumb-image').value = uploadResult;
      // Auto-select the uploaded image
      selectUploadedImage();
    } catch (_err) {
      $('thumbUpload')?.classList.remove('selected', 'has-image');
    }
  }

  /**
   * Get thumbnail options for processing
   * @returns {Object} Thumbnail configuration
   */
  function getOptions() {
    const source = $('thumb-source')?.value;

    if (source === 'video') {
      return {
        source: 'video',
        timestamp: Number.parseFloat($('thumb-timestamp')?.value) || 0,
      };
    }

    return {
      source: 'file',
      imagePath: $('thumb-image')?.value || '',
    };
  }

  // Export to global VidLetThumbTool namespace
  window.VidLetThumbTool = {
    setVideoInfo,
    setActiveTool,
    captureCurrentFrame,
    handleClick,
    selectUploadedImage,
    updateFrameTime,
    drawCanvas,
    init,
    updateAspectRatio,
    handleFile,
    getOptions,
  };
})();
