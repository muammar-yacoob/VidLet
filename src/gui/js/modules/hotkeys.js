/**
 * VidLet Hotkeys Module
 * Configurable keyboard shortcuts for different editor presets
 */
(function(V) {
  let currentPreset = 'premiere';

  const PRESETS = {
    premiere: {
      split: { key: 'KeyK', ctrl: true },
      delete: { key: 'Backspace' },
      rippleDelete: { key: 'Delete' },
      selectPrev: { key: 'BracketLeft' },
      selectNext: { key: 'BracketRight' },
      markIn: { key: 'KeyI' },
      markOut: { key: 'KeyO' },
    },
    resolve: {
      split: { key: 'KeyB', ctrl: true },
      delete: { key: 'Backspace' },
      rippleDelete: { key: 'Delete' },
      selectPrev: { key: 'ArrowUp' },
      selectNext: { key: 'ArrowDown' },
      markIn: { key: 'KeyI' },
      markOut: { key: 'KeyO' },
    },
    capcut: {
      split: { key: 'KeyB', ctrl: true },
      delete: { key: 'Delete' },
      rippleDelete: { key: 'Backspace' },
      selectPrev: { key: 'ArrowLeft', ctrl: true },
      selectNext: { key: 'ArrowRight', ctrl: true },
      markIn: { key: 'BracketLeft' },
      markOut: { key: 'BracketRight' },
    },
    shotcut: {
      split: { key: 'KeyS' },
      delete: { key: 'KeyX' },
      rippleDelete: { key: 'KeyZ' },
      selectPrev: { key: 'ArrowUp' },
      selectNext: { key: 'ArrowDown' },
      markIn: { key: 'KeyI' },
      markOut: { key: 'KeyO' },
    },
    descript: {
      split: { key: 'KeyK', ctrl: true },
      delete: { key: 'Backspace' },
      rippleDelete: { key: 'Delete' },
      selectPrev: { key: 'BracketLeft' },
      selectNext: { key: 'BracketRight' },
      markIn: { key: 'KeyI' },
      markOut: { key: 'KeyO' },
    },
    camtasia: {
      split: { key: 'KeyS', ctrl: true },
      delete: { key: 'Delete' },
      rippleDelete: { key: 'Backspace' },
      selectPrev: { key: 'PageUp' },
      selectNext: { key: 'PageDown' },
      markIn: { key: 'KeyM' },
      markOut: { key: 'KeyM', shift: true },
    },
  };

  /**
   * Check if keyboard event matches a hotkey binding
   */
  function matches(event, binding) {
    if (!binding) return false;
    const ctrlMatch = !!binding.ctrl === (event.ctrlKey || event.metaKey);
    const shiftMatch = !!binding.shift === event.shiftKey;
    const altMatch = !!binding.alt === event.altKey;
    return event.code === binding.key && ctrlMatch && shiftMatch && altMatch;
  }

  /**
   * Format hotkey for display
   */
  function format(binding) {
    if (!binding) return '';
    const parts = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.shift) parts.push('Shift');
    if (binding.alt) parts.push('Alt');
    const key = binding.key.replace('Key', '').replace('Bracket', '').replace('Arrow', '');
    parts.push(key);
    return parts.join('+');
  }

  /**
   * Get current hotkey map
   */
  function getMap() {
    return PRESETS[currentPreset] || PRESETS.premiere;
  }

  /**
   * Set hotkey preset
   */
  function setPreset(preset) {
    if (PRESETS[preset]) {
      currentPreset = preset;
      updateDisplay();
    }
  }

  /**
   * Get current preset name
   */
  function getPreset() {
    return currentPreset;
  }

  /**
   * Update hotkey display in settings
   */
  function updateDisplay() {
    const container = V.$('hotkey-list');
    if (!container) return;

    const map = getMap();
    const labels = {
      split: 'Split',
      delete: 'Delete',
      rippleDelete: 'Ripple Delete',
      selectPrev: 'Prev Segment',
      selectNext: 'Next Segment',
      markIn: 'Mark In',
      markOut: 'Mark Out',
    };

    container.innerHTML = Object.entries(labels)
      .map(([key, label]) => `<div class="hotkey-item"><span>${label}</span><kbd>${format(map[key])}</kbd></div>`)
      .join('');
  }

  // Export to VidLet namespace
  V.hotkeys = { matches, format, getMap, setPreset, getPreset, updateDisplay, PRESETS };

})(window.VidLet || (window.VidLet = {}));
