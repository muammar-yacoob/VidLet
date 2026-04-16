/**
 * VidLet Utilities Module
 * Shared utility functions for formatting, UI manipulation, and user feedback
 *
 * This module provides utilities that are specific to vidlet-app.js
 * For basic utilities like $() and fetchJson, use the global VidLet object from vidlet.js
 */

(() => {
  // Import basic utilities from global VidLet object
  const { $ } = window.VidLet;

  // ============ FORMATTING UTILITIES ============

  /**
   * Format time in seconds to M:SS format
   * @param {number} sec - Time in seconds
   * @returns {string} Formatted time
   */
  function formatTime(sec) {
    if (!sec || Number.isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Format time in seconds to M:SS.D format (deciseconds)
   * @param {number} sec - Time in seconds
   * @returns {string} Formatted time with deciseconds
   */
  function formatTimeMs(sec) {
    if (!sec || Number.isNaN(sec)) return '0:00.0';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  }

  /**
   * Format file size in bytes to human-readable format with locale formatting
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted file size
   */
  function formatFileSize(bytes) {
    if (!bytes) return '-';
    const formatNum = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (bytes < 1024) return `${formatNum(bytes)} B`;
    if (bytes < 1024 * 1024) return `${formatNum(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${formatNum(bytes / (1024 * 1024))} MB`;
    return `${formatNum(bytes / (1024 * 1024 * 1024))} GB`;
  }

  /**
   * Format size in bytes to human-readable format (simple version)
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * Get aspect ratio label from width and height
   * @param {number} width - Video width
   * @param {number} height - Video height
   * @returns {string} Aspect ratio label (e.g., "16:9", "4:3")
   */
  function getAspectRatioLabel(width, height) {
    if (!width || !height) return '-';
    const ratio = width / height;

    // Common aspect ratios
    if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
    if (Math.abs(ratio - 9 / 16) < 0.05) return '9:16';
    if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
    if (Math.abs(ratio - 3 / 4) < 0.05) return '3:4';
    if (Math.abs(ratio - 21 / 9) < 0.05) return '21:9';
    if (Math.abs(ratio - 1) < 0.05) return '1:1';
    if (Math.abs(ratio - 3 / 2) < 0.05) return '3:2';
    if (Math.abs(ratio - 2 / 3) < 0.05) return '2:3';

    // Calculate simplified ratio using GCD
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height);
    const w = width / divisor;
    const h = height / divisor;
    if (w <= 100 && h <= 100) return `${w}:${h}`;
    return ratio.toFixed(2);
  }

  // ============ UI STATE HELPERS ============

  /**
   * Set active button in a segmented button group
   * @param {string} groupId - Group element ID
   * @param {string|number} val - Value to match against data-val attribute
   */
  function setSegBtn(groupId, val) {
    const group = $(groupId);
    if (!group) return;
    for (const b of group.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.val === String(val));
    }
  }

  /**
   * Set active button in a group based on closest numeric value
   * @param {string} groupId - Group element ID
   * @param {number} numVal - Numeric value to find closest match
   */
  function setSegBtnClosest(groupId, numVal) {
    const group = $(groupId);
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll('button'));
    let closest = buttons[0];
    let minDiff = Number.POSITIVE_INFINITY;

    for (const b of buttons) {
      const diff = Math.abs(Number.parseFloat(b.dataset.val) - numVal);
      if (diff < minDiff) {
        minDiff = diff;
        closest = b;
      }
    }

    for (const b of buttons) {
      b.classList.remove('active');
    }
    if (closest) closest.classList.add('active');
  }

  /**
   * Get active button value from a segmented button group
   * @param {string} groupId - Group element ID
   * @returns {string|null} Active button's data-val attribute
   */
  function getSegVal(groupId) {
    const group = $(groupId);
    if (!group) return null;
    const active = group.querySelector('button.active');
    return active ? active.dataset.val : null;
  }

  // ============ USER FEEDBACK ============

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   */
  function showToast(message) {
    let toast = $('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  /**
   * Show confirmation modal dialog
   * @param {Object} options - Modal configuration
   * @param {string} [options.title='Confirm Action'] - Modal title
   * @param {string} [options.message='Are you sure?'] - Modal message (HTML allowed)
   * @param {string} [options.okText='OK'] - OK button text
   * @param {string} [options.icon='info'] - Icon type: 'info', 'warning', 'danger'
   * @returns {Promise<boolean>} Resolves to true if OK clicked, false if cancelled
   */
  function showConfirmModal(options = {}) {
    const {
      title = 'Confirm Action',
      message = 'Are you sure?',
      okText = 'OK',
      icon = 'info', // 'info', 'warning', 'danger'
    } = options;

    $('confirmTitle').textContent = title;
    $('confirmMessage').innerHTML = message;
    $('confirmOkBtn').textContent = okText;

    const iconEl = $('confirmIcon');
    iconEl.className = 'confirm-icon';
    if (icon === 'warning') iconEl.classList.add('warning');
    else if (icon === 'danger') iconEl.classList.add('danger');

    $('confirmModal').classList.add('on');
    $('confirmOkBtn').focus();

    // Keyboard handler
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmModal(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        closeConfirmModal(true);
      }
    };
    document.addEventListener('keydown', keyHandler);

    return new Promise((resolve) => {
      window.confirmResolve = (result) => {
        document.removeEventListener('keydown', keyHandler);
        resolve(result);
      };
    });
  }

  /**
   * Close confirmation modal with result
   * @param {boolean} result - True if confirmed, false if cancelled
   */
  function closeConfirmModal(result) {
    $('confirmModal').classList.remove('on');
    if (window.confirmResolve) {
      window.confirmResolve(result);
      window.confirmResolve = null;
    }
  }

  /**
   * Celebrate with confetti burst
   */
  function celebrate() {
    if (typeof confetti !== 'function') return;

    // Big burst from center
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });

    // Smaller side bursts after a delay
    setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
      });
    }, 200);
  }

  // ============ HOTKEY UTILITIES ============

  /**
   * Check if keyboard event matches a hotkey binding
   * @param {KeyboardEvent} event - Keyboard event
   * @param {Object} binding - Hotkey binding object
   * @param {string} binding.key - Key code (e.g., 'KeyK')
   * @param {boolean} [binding.ctrl] - Ctrl/Cmd modifier
   * @param {boolean} [binding.shift] - Shift modifier
   * @param {boolean} [binding.alt] - Alt modifier
   * @returns {boolean} True if event matches binding
   */
  function matchesHotkey(event, binding) {
    if (!binding) return false;
    const ctrlMatch = binding.ctrl
      ? event.ctrlKey || event.metaKey
      : !(event.ctrlKey || event.metaKey);
    const shiftMatch = binding.shift ? event.shiftKey : !event.shiftKey;
    const altMatch = binding.alt ? event.altKey : !event.altKey;
    return event.code === binding.key && ctrlMatch && shiftMatch && altMatch;
  }

  /**
   * Format a hotkey binding for display
   * @param {Object} binding - Hotkey binding object
   * @returns {string} Formatted hotkey string (e.g., "Ctrl+K")
   */
  function formatHotkey(binding) {
    if (!binding) return '';
    const parts = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.shift) parts.push('Shift');
    if (binding.alt) parts.push('Alt');

    let keyName = binding.key
      .replace('Key', '')
      .replace('Arrow', '')
      .replace('Bracket', '')
      .replace('Left', '[')
      .replace('Right', ']');

    if (keyName === 'Space') keyName = 'Space';
    else if (keyName === 'Delete') keyName = 'Del';
    else if (keyName === 'Backspace') keyName = 'Bksp';
    else if (keyName === 'PageUp') keyName = 'PgUp';
    else if (keyName === 'PageDown') keyName = 'PgDn';

    parts.push(keyName);
    return parts.join('+');
  }

  // Export to global VidLetUtils namespace
  window.VidLetUtils = {
    formatTime,
    formatTimeMs,
    formatFileSize,
    formatSize,
    getAspectRatioLabel,
    setSegBtn,
    setSegBtnClosest,
    getSegVal,
    showToast,
    showConfirmModal,
    closeConfirmModal,
    celebrate,
    matchesHotkey,
    formatHotkey,
  };
})();
