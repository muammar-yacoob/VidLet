/**
 * Filter Tool Module
 * Handles visual adjustments, effects, and filter presets
 */

(() => {
  const { $ } = window.VidLet;

  // Filter state
  const filterState = {
    brightness: 0, // -100 to 100 (0 = normal)
    contrast: 0, // -100 to 100 (0 = normal)
    saturation: 0, // -100 to 100 (0 = normal)
    blur: 0, // 0 to 10
    blurEnabled: false,
    sharpen: false,
    vignette: false,
    vignetteIntensity: 0,
    bloom: false,
    bloomIntensity: 0,
    filterPreset: 'none', // none, grayscale, sepia, vintage, cool, warm
  };

  /**
   * Update filter preview based on current slider values
   */
  function updateFilterPreview() {
    // Read slider values (all use 0 as neutral)
    const brightness = Number.parseInt($('filter-brightness')?.value) || 0;
    const contrast = Number.parseInt($('filter-contrast')?.value) || 0;
    const saturation = Number.parseInt($('filter-saturation')?.value) || 0;
    const blur = Number.parseFloat($('filter-blur')?.value) || 0;
    const vignetteIntensity = Number.parseInt($('filter-vignette-intensity')?.value) || 0;
    const bloomIntensity = Number.parseInt($('filter-bloom-intensity')?.value) || 0;

    // Update state
    filterState.brightness = brightness;
    filterState.contrast = contrast;
    filterState.saturation = saturation;
    filterState.blur = blur;
    filterState.vignetteIntensity = vignetteIntensity;
    filterState.bloomIntensity = bloomIntensity;

    // Auto-toggle effects based on slider values (0 = off)
    filterState.blurEnabled = blur > 0;
    filterState.vignette = vignetteIntensity > 0;
    filterState.bloom = bloomIntensity > 0;

    // Update effect button states based on values
    $('effect-blur')?.classList.toggle('active', blur > 0);
    $('effect-vignette')?.classList.toggle('active', vignetteIntensity > 0);
    $('effect-bloom')?.classList.toggle('active', bloomIntensity > 0);

    // Update value labels
    if ($('filter-brightness-val')) $('filter-brightness-val').textContent = brightness;
    if ($('filter-contrast-val')) $('filter-contrast-val').textContent = contrast;
    if ($('filter-saturation-val')) $('filter-saturation-val').textContent = saturation;
    if ($('filter-blur-val')) $('filter-blur-val').textContent = blur;
    if ($('filter-vignette-val')) $('filter-vignette-val').textContent = vignetteIntensity;
    if ($('filter-bloom-val')) $('filter-bloom-val').textContent = bloomIntensity;

    applyFilterPreview();
  }

  /**
   * Toggle effect on/off with default values
   * @param {string} name - Effect name ('blur', 'vignette', 'bloom', 'sharpen')
   */
  function toggleEffect(name) {
    const btn = $(`effect-${name}`);
    const settings = $(`settings-${name}`);

    // Toggle the effect state
    if (name === 'blur') {
      filterState.blurEnabled = !filterState.blurEnabled;
      btn?.classList.toggle('active', filterState.blurEnabled);
      // Set default value when first enabled
      if (filterState.blurEnabled && filterState.blur === 0) {
        filterState.blur = 3;
        if ($('filter-blur')) $('filter-blur').value = 3;
        if ($('filter-blur-val')) $('filter-blur-val').textContent = '3';
      }
    } else if (name === 'vignette') {
      filterState.vignette = !filterState.vignette;
      btn?.classList.toggle('active', filterState.vignette);
      // Set default value when first enabled
      if (filterState.vignette && filterState.vignetteIntensity === 0) {
        filterState.vignetteIntensity = 60;
        if ($('filter-vignette-intensity')) $('filter-vignette-intensity').value = 60;
        if ($('filter-vignette-val')) $('filter-vignette-val').textContent = '60';
      }
    } else if (name === 'bloom') {
      filterState.bloom = !filterState.bloom;
      btn?.classList.toggle('active', filterState.bloom);
      // Set default value when first enabled
      if (filterState.bloom && filterState.bloomIntensity === 0) {
        filterState.bloomIntensity = 50;
        if ($('filter-bloom-intensity')) $('filter-bloom-intensity').value = 50;
        if ($('filter-bloom-val')) $('filter-bloom-val').textContent = '50';
      }
    } else if (name === 'sharpen') {
      filterState.sharpen = !filterState.sharpen;
      btn?.classList.toggle('active', filterState.sharpen);
    }

    // Show/hide settings panel
    if (settings) {
      settings.classList.toggle('hidden', !btn?.classList.contains('active'));
    }

    applyFilterPreview();
  }

  /**
   * Select a filter preset
   * @param {string} preset - Preset name ('none', 'grayscale', 'sepia', 'vintage', 'cool', 'warm')
   */
  function selectFilterPreset(preset) {
    filterState.filterPreset = preset;

    // Update button states
    for (const btn of document.querySelectorAll('.filter-preset')) {
      btn.classList.toggle('active', btn.dataset.filter === preset);
    }

    applyFilterPreview();
  }

  /**
   * Reset all filters (color adjustments and effects)
   */
  function resetFilters() {
    resetColorFilters();
    resetEffectFilters();
  }

  /**
   * Reset color adjustment filters (brightness, contrast, saturation)
   */
  function resetColorFilters() {
    filterState.brightness = 0;
    filterState.contrast = 0;
    filterState.saturation = 0;

    if ($('filter-brightness')) $('filter-brightness').value = 0;
    if ($('filter-contrast')) $('filter-contrast').value = 0;
    if ($('filter-saturation')) $('filter-saturation').value = 0;

    if ($('filter-brightness-val')) $('filter-brightness-val').textContent = '0';
    if ($('filter-contrast-val')) $('filter-contrast-val').textContent = '0';
    if ($('filter-saturation-val')) $('filter-saturation-val').textContent = '0';

    applyFilterPreview();
  }

  /**
   * Reset effect filters (blur, sharpen, vignette, bloom)
   */
  function resetEffectFilters() {
    filterState.blur = 0;
    filterState.blurEnabled = false;
    filterState.sharpen = false;
    filterState.vignette = false;
    filterState.vignetteIntensity = 0;
    filterState.bloom = false;
    filterState.bloomIntensity = 0;

    if ($('filter-blur')) $('filter-blur').value = 0;
    if ($('filter-blur-val')) $('filter-blur-val').textContent = '0';
    if ($('filter-vignette-intensity')) $('filter-vignette-intensity').value = 0;
    if ($('filter-vignette-val')) $('filter-vignette-val').textContent = '0';
    if ($('filter-bloom-intensity')) $('filter-bloom-intensity').value = 0;
    if ($('filter-bloom-val')) $('filter-bloom-val').textContent = '0';

    // Reset effect buttons
    for (const name of ['blur', 'sharpen', 'vignette', 'bloom']) {
      const btn = $(`effect-${name}`);
      if (btn) btn.classList.remove('active');
      const settings = $(`settings-${name}`);
      if (settings) settings.classList.add('hidden');
    }

    // Reset filter preset
    filterState.filterPreset = 'none';
    for (const btn of document.querySelectorAll('.filter-preset')) {
      btn.classList.toggle('active', btn.dataset.filter === 'none');
    }

    applyFilterPreview();
  }

  /**
   * Apply current filter state to video preview
   */
  function applyFilterPreview() {
    const video = $('videoPreview');
    if (!video) return;

    const filters = [];

    // Brightness: CSS uses 0-2 (1 = normal), our range is -100 to 100 (0 = normal)
    const brightnessVal = 1 + filterState.brightness / 100;
    if (brightnessVal !== 1) filters.push(`brightness(${brightnessVal.toFixed(2)})`);

    // Contrast: CSS uses 0-2+ (1 = normal), our range is -100 to 100 (0 = normal)
    const contrastVal = 1 + filterState.contrast / 100;
    if (contrastVal !== 1) filters.push(`contrast(${contrastVal.toFixed(2)})`);

    // Saturation: CSS uses 0-2+ (1 = normal), our range is -100 to 100 (0 = normal)
    const saturationVal = 1 + filterState.saturation / 100;
    if (saturationVal !== 1) filters.push(`saturate(${saturationVal.toFixed(2)})`);

    // Blur (only if enabled)
    if (filterState.blurEnabled && filterState.blur > 0) {
      filters.push(`blur(${filterState.blur}px)`);
    }

    // Filter presets
    switch (filterState.filterPreset) {
      case 'grayscale':
        filters.push('grayscale(1)');
        break;
      case 'sepia':
        filters.push('sepia(1)');
        break;
      case 'vintage':
        filters.push('sepia(0.4)', 'contrast(1.1)', 'brightness(0.9)');
        break;
      case 'cool':
        filters.push('saturate(0.9)', 'hue-rotate(15deg)');
        break;
      case 'warm':
        filters.push('saturate(1.2)', 'hue-rotate(-10deg)');
        break;
    }

    // Apply CSS filter to video
    video.style.filter = filters.length > 0 ? filters.join(' ') : '';

    // Vignette overlay preview
    const vignetteOverlay = $('vignetteOverlay');
    if (vignetteOverlay) {
      const showVignette = filterState.vignette && filterState.vignetteIntensity > 0;
      vignetteOverlay.classList.toggle('hidden', !showVignette);
      if (showVignette) {
        // Intensity 0-100 maps to opacity and spread
        const intensity = filterState.vignetteIntensity / 100;
        const innerStop = Math.max(0, 50 - intensity * 30); // 50% down to 20%
        const opacity = 0.3 + intensity * 0.6; // 0.3 to 0.9
        vignetteOverlay.style.background = `radial-gradient(ellipse at center, transparent 0%, transparent ${innerStop}%, rgba(0,0,0,${opacity.toFixed(2)}) 100%)`;
      }
    }

    // Bloom overlay preview
    const bloomOverlay = $('bloomOverlay');
    if (bloomOverlay) {
      const showBloom = filterState.bloom && filterState.bloomIntensity > 0;
      bloomOverlay.classList.toggle('hidden', !showBloom);
      if (showBloom) {
        // Intensity 0-100 maps to glow strength
        const intensity = filterState.bloomIntensity / 100;
        const opacity = 0.1 + intensity * 0.25; // 0.1 to 0.35
        const spread = 40 + intensity * 30; // 40% to 70%
        bloomOverlay.style.background = `radial-gradient(ellipse at center, rgba(255,255,255,${opacity.toFixed(2)}) 0%, transparent ${spread}%)`;
      }
    }
  }

  /**
   * Clear all filter effects from video preview
   */
  function clearFilterPreview() {
    const video = $('videoPreview');
    if (video) video.style.filter = '';
    // Hide vignette and bloom overlays
    $('vignetteOverlay')?.classList.add('hidden');
    $('bloomOverlay')?.classList.add('hidden');
  }

  /**
   * Get current filter configuration for processing
   * @returns {Object} Filter configuration object
   */
  function getFilterOptions() {
    return {
      brightness: filterState.brightness,
      contrast: filterState.contrast,
      saturation: filterState.saturation,
      blur: filterState.blurEnabled ? filterState.blur : 0,
      sharpen: filterState.sharpen,
      vignette: filterState.vignette ? filterState.vignetteIntensity : 0,
      bloom: filterState.bloom ? filterState.bloomIntensity : 0,
      preset: filterState.filterPreset,
    };
  }

  /**
   * Check if any filters are currently applied
   * @returns {boolean} True if filters are active
   */
  function hasActiveFilters() {
    return (
      filterState.brightness !== 0 ||
      filterState.contrast !== 0 ||
      filterState.saturation !== 0 ||
      (filterState.blurEnabled && filterState.blur > 0) ||
      filterState.sharpen ||
      (filterState.vignette && filterState.vignetteIntensity > 0) ||
      (filterState.bloom && filterState.bloomIntensity > 0) ||
      filterState.filterPreset !== 'none'
    );
  }

  // Export to global VidLetFilterTool namespace
  window.VidLetFilterTool = {
    updateFilterPreview,
    toggleEffect,
    selectFilterPreset,
    resetFilters,
    resetColorFilters,
    resetEffectFilters,
    applyFilterPreview,
    clearFilterPreview,
    getFilterOptions,
    hasActiveFilters,
  };
})();
