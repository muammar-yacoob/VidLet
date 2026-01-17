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
