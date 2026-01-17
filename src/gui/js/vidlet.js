/**
 * VidLet Shared GUI Utilities
 */
(() => {
  // DOM helper
  function $(id) {
    return document.getElementById(id);
  }

  // Logging helper
  function log(container, type, msg) {
    const el = typeof container === 'string' ? $(container) : container;
    el.classList.add('on');
    el.innerHTML += `<p class="${type}">${msg}</p>`;
    el.scrollTop = el.scrollHeight;
  }

  // Fetch JSON helper
  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error('Invalid JSON response:', text.substring(0, 200));
      throw new Error('Server returned invalid response');
    }
  }

  // POST JSON helper
  async function postJson(url, data) {
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }

  // Close window via API
  function close() {
    fetch('/api/close', { method: 'POST' }).finally(() => window.close());
  }

  // Cancel and close window
  function cancel() {
    fetch('/api/cancel', { method: 'POST' }).finally(() => window.close());
  }

  // Open URL in default browser
  function openUrl(url) {
    fetch('/api/open-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  }

  // Format duration as MM:SS
  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Format file size
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Initialize window
  function init(opts = {}) {
    const w = opts.width || 400;
    const h = opts.height || 340;

    // Center on available screen (excludes taskbar)
    const x = Math.round((screen.availWidth - w) / 2) + (screen.availLeft || 0);
    const y = Math.round((screen.availHeight - h) / 2) + (screen.availTop || 0);
    window.moveTo(x, y);
    window.resizeTo(w, h);

    // Reset zoom
    document.documentElement.style.zoom = '100%';

    // Disable context menu
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Resize window to fit video aspect ratio
  function resizeToVideo(videoWidth, videoHeight, opts = {}) {
    // UI chrome dimensions
    const sidebarWidth = opts.sidebarWidth || 160;
    const headerHeight = opts.headerHeight || 100;
    const optionsHeight = opts.optionsHeight || 90;
    const footerHeight = opts.footerHeight || 50;
    const chromeV = headerHeight + optionsHeight + footerHeight;

    // Constraints
    const minPreviewW = opts.minPreviewWidth || 280;
    const maxPreviewW = opts.maxPreviewWidth || 800;
    const minPreviewH = opts.minPreviewHeight || 180;
    const maxPreviewH = opts.maxPreviewHeight || 600;
    const padding = opts.padding || 40; // Window chrome padding

    // Calculate aspect ratio
    const aspect = videoWidth / videoHeight;

    // Start with a reasonable preview width based on video size
    let previewW = Math.min(videoWidth, maxPreviewW);
    previewW = Math.max(previewW, minPreviewW);

    // Calculate height from width maintaining aspect ratio
    let previewH = previewW / aspect;

    // Clamp height and recalculate width if needed
    if (previewH > maxPreviewH) {
      previewH = maxPreviewH;
      previewW = previewH * aspect;
    }
    if (previewH < minPreviewH) {
      previewH = minPreviewH;
      previewW = previewH * aspect;
    }

    // Final window dimensions
    const winW = Math.round(previewW + sidebarWidth + padding);
    const winH = Math.round(previewH + chromeV + padding);

    // Ensure it fits on screen
    const maxWinW = screen.availWidth - 100;
    const maxWinH = screen.availHeight - 100;
    const finalW = Math.min(winW, maxWinW);
    const finalH = Math.min(winH, maxWinH);

    // Center and resize
    const x = Math.round((screen.availWidth - finalW) / 2) + (screen.availLeft || 0);
    const y = Math.round((screen.availHeight - finalH) / 2) + (screen.availTop || 0);
    window.resizeTo(finalW, finalH);
    window.moveTo(x, y);

    return { width: finalW, height: finalH };
  }

  // Show/hide elements
  function show(element) {
    const el = typeof element === 'string' ? $(element) : element;
    if (el) el.classList.remove('hide');
  }

  function hide(element) {
    const el = typeof element === 'string' ? $(element) : element;
    if (el) el.classList.add('hide');
  }

  // Toggle loading state
  function setLoading(isLoading, message) {
    const ld = $('loading');
    const form = $('form');
    const btns = $('btns');

    if (isLoading) {
      if (form) form.classList.add('hide');
      if (btns) btns.classList.add('hide');
      if (ld) {
        ld.classList.add('on');
        const span = ld.querySelector('span');
        if (span && message) span.textContent = message;
      }
    } else {
      if (form) form.classList.remove('hide');
      if (btns) btns.classList.remove('hide');
      if (ld) ld.classList.remove('on');
    }
  }

  // Show done state
  function showDone(success, message, details) {
    const dn = $('done');
    const form = $('form');
    const btns = $('btns');
    const ld = $('loading');

    if (form) form.classList.add('hide');
    if (btns) btns.classList.add('hide');
    if (ld) ld.classList.remove('on');

    if (dn) {
      dn.classList.add('on');
      dn.classList.toggle('ok', success);
      dn.classList.toggle('err', !success);

      const h4 = dn.querySelector('h4');
      const p = dn.querySelector('p');
      if (h4) h4.textContent = message;
      if (p) p.textContent = details || '';

      // Add copy button for errors
      const existingCopyBtn = dn.querySelector('.copy-btn');
      if (existingCopyBtn) existingCopyBtn.remove();

      if (!success && details) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy Error';
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(details);
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copy Error';
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = details;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copy Error';
              copyBtn.classList.remove('copied');
            }, 2000);
          }
        };
        p.after(copyBtn);
      }
    }
  }

  // Export to global
  window.VidLet = {
    $,
    log,
    fetchJson,
    postJson,
    close,
    cancel,
    openUrl,
    init,
    resizeToVideo,
    show,
    hide,
    setLoading,
    showDone,
    formatDuration,
    formatSize
  };

  // Auto-init on DOMContentLoaded if data attributes present
  document.addEventListener('DOMContentLoaded', () => {
    const html = document.documentElement;
    if (html.dataset.vidlet !== undefined) {
      init({
        width: Number.parseInt(html.dataset.width) || undefined,
        height: Number.parseInt(html.dataset.height) || undefined
      });
    }
  });
})();
