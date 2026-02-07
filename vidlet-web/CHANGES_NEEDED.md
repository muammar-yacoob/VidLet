# Exact Changes Needed to Existing Files

This document shows the **minimal edits** needed to make your existing GUI work with web upload.

---

## 1. vidlet.html - Add Video ID Parameter

### Change #1: Get video ID from URL
```javascript
// Add at the top of your existing script
const urlParams = new URLSearchParams(window.location.search);
const videoId = urlParams.get('v');

if (!videoId) {
  window.location.href = '/'; // Redirect to upload page
}
```

### Change #2: Update API calls to include video ID
```javascript
// Before (desktop):
fetch('/api/info')

// After (web):
fetch(`/api/info?v=${videoId}`)

// Before (desktop):
fetch('/api/process', { ... })

// After (web):
fetch(`/api/process?v=${videoId}`, { ... })

// Before (desktop):
<video src="/api/video">

// After (web):
<video src={`/api/video?v=${videoId}`}>
```

### Change #3: Handle download response
```javascript
// Before (desktop) - shows file path:
const { success, output } = await response.json();
if (success) {
  alert('Saved to: ' + output);
}

// After (web) - triggers download:
if (response.ok) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'compressed.mp4'; // or get from Content-Disposition header
  a.click();
  URL.revokeObjectURL(url);
}
```

**That's it!** Just 3 small changes to make the entire GUI work with web uploads.

---

## 2. vidlet-app.js - Update Fetch Calls

Find all `fetch('/api/....')` calls and add `?v=${videoId}`:

```javascript
// At the top of the file:
const videoId = new URLSearchParams(window.location.search).get('v');

// Then update all fetch calls:
await fetch(`/api/info?v=${videoId}`)
await fetch(`/api/process?v=${videoId}`, { ... })
await fetch(`/api/preview?v=${videoId}`, { ... })
await fetch(`/api/detect-loops?v=${videoId}`, { ... })
// etc.
```

---

## 3. Optional: Add Upload Button (Instead of Landing Page)

If you want to skip the landing page and add upload directly to vidlet.html:

```html
<!-- Add to vidlet.html -->
<div id="uploadOverlay" style="display:none">
  <input type="file" id="videoUpload" accept="video/*">
  <div>Drag video here or click to browse</div>
</div>

<script>
// Show upload overlay if no video ID
if (!videoId) {
  document.getElementById('uploadOverlay').style.display = 'flex';

  document.getElementById('videoUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('video', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const { videoId } = await res.json();
    window.location.href = `/vidlet.html?v=${videoId}`;
  });
}
</script>
```

---

## Full File Diff Example

### Before (Desktop) - `src/gui/js/vidlet-app.js` lines 1-50:
```javascript
(async () => {
  // Load video info
  const info = await fetch('/api/info').then(r => r.json());

  // Set up player
  const player = document.getElementById('player');
  player.src = '/api/video';

  // Process button
  document.getElementById('processBtn').onclick = async () => {
    const res = await fetch('/api/process', {
      method: 'POST',
      body: JSON.stringify({ bitrate: '2000k' })
    });

    const { success, output } = await res.json();
    if (success) {
      alert('Saved to: ' + output);
    }
  };
})();
```

### After (Web) - `public/js/vidlet-app.js`:
```javascript
(async () => {
  // 🆕 Get video ID from URL
  const videoId = new URLSearchParams(window.location.search).get('v');
  if (!videoId) {
    window.location.href = '/';
    return;
  }

  // Load video info (🆕 added ?v= parameter)
  const info = await fetch(`/api/info?v=${videoId}`).then(r => r.json());

  // Set up player (🆕 added ?v= parameter)
  const player = document.getElementById('player');
  player.src = `/api/video?v=${videoId}`;

  // Process button
  document.getElementById('processBtn').onclick = async () => {
    const res = await fetch(`/api/process?v=${videoId}`, { // 🆕 added ?v=
      method: 'POST',
      body: JSON.stringify({ bitrate: '2000k' })
    });

    // 🆕 Download instead of showing path
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compressed.mp4';
    a.click();
    URL.revokeObjectURL(url);
  };
})();
```

**Changes:**
- Added 3 lines (get videoId)
- Added `?v=${videoId}` to 3 fetch calls
- Changed 6 lines (download instead of alert)

**Total: ~10 lines changed out of hundreds!**

---

## Automated Migration Script

Want to do this automatically? Create `migrate.sh`:

```bash
#!/bin/bash
# Migrate desktop GUI to web version

# Copy files
cp src/gui/vidlet.html public/vidlet.html
cp -r src/gui/js public/
cp -r src/gui/css public/

# Add video ID parameter to all API calls
sed -i "s|fetch('/api/|fetch(\`/api/|g" public/js/*.js
sed -i "s|')|\?v=\${videoId}\`)|g" public/js/*.js

# Update video source
sed -i 's|src="/api/video"|src={`/api/video?v=${videoId}`}|g' public/vidlet.html

echo "Migration complete! Review changes in public/"
```

---

## Testing Changes

### 1. Test Desktop Version (Unchanged)
```bash
cd VidLet
npm run build
vidlet compress test.mp4
```

### 2. Test Web Version (With Changes)
```bash
cd vidlet-web
npm run dev
# Visit localhost:3000
# Upload video
# Test compress tool
```

Both should work identically!

---

## Summary

**To convert desktop → web:**
1. Add `?v=${videoId}` to API calls (3 places)
2. Get `videoId` from URL params (3 lines)
3. Download instead of save (6 lines)

**Total changes: ~12 lines in your entire codebase**
**Everything else: copy-paste as-is**
