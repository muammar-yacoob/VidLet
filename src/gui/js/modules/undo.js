/**
 * VidLet Undo/Redo Module
 * Simple command pattern for undo/redo operations
 */
window.VidLet = window.VidLet || {};
window.VidLet.state = window.VidLet.state || {};
((V) => {
  const MAX_HISTORY = 20;
  let undoStack = [];
  let redoStack = [];

  /**
   * Get current state snapshot
   */
  function getSnapshot() {
    const s = V.state || {};
    return {
      tool: s.activeTool,
      portraitSegments: JSON.parse(JSON.stringify(s.portraitSegments || [])),
      selectedSegmentIndex: s.selectedSegmentIndex || 0,
      portraitCropX: s.portraitCropX || 0.5,
      portraitKeyframes: JSON.parse(JSON.stringify(s.portraitKeyframes || [])),
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
        V.portrait.setState(snapshot);
      }
    }
    if (snapshot.tool === 'trim') {
      if (snapshot.trimStart !== undefined) V.$('trim-start').value = snapshot.trimStart;
      if (snapshot.trimEnd !== undefined) V.$('trim-end').value = snapshot.trimEnd;
      window.VidLetTrimTimeline?.updateTimeline?.(V.state.info);
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

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(getSnapshot());
    restore(undoStack.pop());
    updateButtons();
    window.VidLetUtils?.showToast?.('Undo');
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(getSnapshot());
    restore(redoStack.pop());
    updateButtons();
    window.VidLetUtils?.showToast?.('Redo');
  }

  function updateButtons() {
    const undoBtn = V.$('undo-btn');
    const redoBtn = V.$('redo-btn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function clear() {
    undoStack = [];
    redoStack = [];
    updateButtons();
  }

  V.undo = { save, undo, redo, clear, updateButtons };
})(window.VidLet);
