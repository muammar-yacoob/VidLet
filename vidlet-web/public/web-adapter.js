/**
 * Web Adapter - Injects video ID handling for web version
 * This allows the desktop vidlet.html to work without modifications
 */
(() => {
  // Get video ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  if (!videoId) {
    window.location.href = '/';
    return;
  }

  // Store globally for access
  window.VIDEO_ID = videoId;

  // Intercept all fetch calls to add video ID
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      // Add video ID to API calls
      if (url.includes('?')) {
        url += `&v=${videoId}`;
      } else {
        url += `?v=${videoId}`;
      }
    }
    return originalFetch(url, options);
  };

  // Intercept video.src assignments to add video ID
  // This runs BEFORE vidlet-app.js loads
  const originalSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get: function() {
      return originalSrc.get.call(this);
    },
    set: function(value) {
      // If setting to /api/video, add the video ID
      if (typeof value === 'string' && value.includes('/api/video')) {
        if (!value.includes('?v=')) {
          // Add video ID
          if (value.includes('?')) {
            value += `&v=${videoId}`;
          } else {
            value = value.replace('/api/video', `/api/video?v=${videoId}`);
          }
          console.log('🎬 Intercepted video.src assignment, added video ID:', value);
        }
      }
      return originalSrc.set.call(this, value);
    }
  });

  console.log('🌐 Web adapter loaded - Video ID:', videoId);
})();
