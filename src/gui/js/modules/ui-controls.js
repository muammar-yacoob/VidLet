/**
 * UI Controls Module
 * Handles video zoom and sidebar resize functionality
 */

(() => {
  const { $ } = window.VidLet;

  /**
   * Initialize video preview zoom (Ctrl+scroll to zoom)
   */
  function initVideoZoom() {
    const container = $('previewContainer');
    const wrap = $('previewWrap');
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    container?.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const oldScale = scale;
      if (e.deltaY < 0) {
        scale = Math.min(5, scale * 1.1);
      } else {
        scale = Math.max(1, scale / 1.1);
      }

      if (scale === 1) {
        offsetX = 0;
        offsetY = 0;
      } else {
        const scaleChange = scale / oldScale;
        offsetX = mouseX - (mouseX - offsetX) * scaleChange;
        offsetY = mouseY - (mouseY - offsetY) * scaleChange;
      }

      wrap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    });

    container?.addEventListener('mousedown', (e) => {
      if (scale > 1 && e.target === container) {
        isPanning = true;
        startX = e.clientX - offsetX;
        startY = e.clientY - offsetY;
        container.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      e.preventDefault();
      offsetX = e.clientX - startX;
      offsetY = e.clientY - startY;
      wrap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    });

    document.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        container.style.cursor = '';
      }
    });
  }

  /**
   * Initialize sidebar resize divider
   */
  function initResizeDivider() {
    const divider = $('resize-divider');
    const main = $('main');
    const side = main?.querySelector('.side');
    const content = main?.querySelector('.content');

    if (!divider || !side || !content) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    divider.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = side.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      e.preventDefault();
      const delta = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(500, startWidth + delta));
      side.style.width = `${newWidth}px`;
      side.style.flexShrink = '0';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // Export to global namespace
  window.VidLetUIControls = {
    initVideoZoom,
    initResizeDivider,
  };
})();
