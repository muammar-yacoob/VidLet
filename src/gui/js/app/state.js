/**
 * VidLet App - shared state
 *
 * The app layer is split across app/init.js, app/tools.js and app/process.js,
 * all hanging off this one namespace so they can see the same state without
 * relying on cross-script top-level bindings.
 */
(() => {
  window.VidLetApp = window.VidLetApp || {};
  const App = window.VidLetApp;

  /** Video metadata from /api/info. Replaced wholesale on load. */
  App.info = {};

  /** Id of the selected tool, or null when nothing can run. */
  App.activeTool = null;

  /** Homepage shown in the header; overridden by server config. */
  App.homepage = 'https://vidlet.app';

  /** MKV input can only reach the converter, so every other tool is locked out. */
  App.isMkvFile = false;

  /** Set when the next "continue editing" should keep the page as-is. */
  App.skipReloadOnContinue = false;

  /** Audio panel mode: 'add' a track, or 'clean' the existing one. */
  App.audioMode = 'add';

  // Modules read the video metadata from these two spots
  window.videoInfo = App.info;
  window.VidLet = window.VidLet || {};
  window.VidLet.state = window.VidLet.state || {};
})();
