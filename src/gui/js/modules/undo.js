/**
 * VidLet Undo/Redo Module
 * Simple command pattern for undo/redo operations
 */
(function(V) {
  const MAX_HISTORY = 20;
  let undoStack = [];
  let redoStack = [];

  /**
   * Get current state snapshot
   */
  function getSnapshot() {
    return {
      tool: V.state.activeTool,
      portraitSegments: JSON.parse(JSON.stringify(V.state.portraitSegments || [])),
      selectedSegmentIndex: V.state.selectedSegmentIndex || 0,
      portraitCropX: V.state.portraitCropX || 0.5,
      portraitKeyframes: JSON.parse(JSON.stringify(V.state.portraitKeyframes || [])),
      trimStart: V.$('trim-start')?.value,
      trimEnd: V.$('trim-end')?.value,
    };
  }

  /**
   * Restore state from snapshot
   */
  function restore(snapshot) {
    if (snapshot.tool === 'portrait') {
      V.state.portraitSegments = snapshot.portraitSegments;
      V.state.selectedSegmentIndex = snapshot.selectedSegmentIndex;
      V.state.portraitCropX = snapshot.portraitCropX;
      V.state.portraitKeyframes = snapshot.portraitKeyframes;
      if (V.portrait) {
        V.portrait.renderSegments();
        V.portrait.updateOverlay();
        V.portrait.updateUI();
        V.portrait.renderKeyframes();
      }
    }
    if (snapshot.tool === 'trim') {
      if (snapshot.trimStart !== undefined) V.$('trim-start').value = snapshot.trimStart;
      if (snapshot.trimEnd !== undefined) V.$('trim-end').value = snapshot.trimEnd;
      if (V.timeline) V.timeline.update();
    }
  }

  /**
   * Save current state before modifying
   */
  function save() {
    undoStack.push(getSnapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateButtons();
  }

  /**
   * Undo last action
   */
  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(getSnapshot());
    restore(undoStack.pop());
    updateButtons();
    V.toast('Undo');
  }

  /**
   * Redo last undone action
   */
  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(getSnapshot());
    restore(redoStack.pop());
    updateButtons();
    V.toast('Redo');
  }

  /**
   * Update button states
   */
  function updateButtons() {
    const undoBtn = V.$('undo-btn');
    const redoBtn = V.$('redo-btn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  /**
   * Clear history
   */
  function clear() {
    undoStack = [];
    redoStack = [];
    updateButtons();
  }

  // Export to VidLet namespace
  V.undo = { save, undo, redo, clear, updateButtons };

})(window.VidLet || (window.VidLet = {}));
