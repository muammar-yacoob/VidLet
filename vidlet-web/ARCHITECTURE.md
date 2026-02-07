# Architecture Comparison

## Desktop Version (Current)

```
┌─────────────────────────────────────────────────────────┐
│ Windows Explorer                                        │
│   User right-clicks video.mp4                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ launcher.vbs (Windows Script)                           │
│   • Converts Windows path → WSL path                    │
│   • Spawns: wsl vidlet compress video.mp4               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Node.js (WSL)                                           │
│   • Express server on localhost:random                  │
│   • Serves GUI from src/gui/                            │
│   • Video at: /mnt/d/Videos/video.mp4                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ loading.hta (Windows)                                   │
│   • Polls for signal file                               │
│   • Spawns: msedge --app="http://localhost:PORT"        │
│   • Closes itself                                       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Edge Browser (App Mode)                                 │
│   • Loads vidlet.html                                   │
│   • GET /api/video → streams from local file            │
│   • POST /api/process → runs FFmpeg                     │
│   • Saves to: /mnt/d/Videos/VidLet/video_compressed.mp4 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
                  ✅ Done!
           File saved to VidLet/ folder
```

---

## Web Version (New)

```
┌─────────────────────────────────────────────────────────┐
│ Browser                                                 │
│   User visits: vidlet-web.vercel.app                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Landing Page (index.html)                               │
│   • Drag & drop video.mp4                               │
│   • POST /api/upload (multipart form)                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Vercel Serverless Function (api/upload.ts)              │
│   • Saves to /tmp/{uuid}.mp4                            │
│   • Runs ffprobe (metadata)                             │
│   • Returns: { videoId, info }                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Redirect to: /vidlet.html?v={videoId}                   │
│   • GET /api/info?v={uuid}                              │
│   • GET /api/video?v={uuid} → streams from /tmp         │
│   • User selects options (compress, trim, etc.)         │
│   • POST /api/process?v={uuid}                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Vercel Serverless Function (api/process.ts)             │
│   • Runs FFmpeg on /tmp/{uuid}.mp4                      │
│   • Outputs to /tmp/{uuid}_output.mp4                   │
│   • Returns: video/mp4 blob with download headers       │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Browser                                                 │
│   • Receives blob                                       │
│   • Triggers download: compressed.mp4                   │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
                  ✅ Done!
           File downloaded to user's device
```

---

## Side-by-Side Comparison

| Step | Desktop | Web |
|------|---------|-----|
| **1. Trigger** | Right-click menu | Visit website |
| **2. File Access** | Local filesystem | File upload |
| **3. Backend** | Express on localhost | Vercel serverless |
| **4. FFmpeg** | Runs in WSL | Runs on Vercel |
| **5. GUI** | Served from localhost | Served from CDN |
| **6. Output** | Save to VidLet/ folder | Download to browser |
| **7. Session** | In-memory variables | URL parameter (videoId) |
| **8. Lifecycle** | Starts → Processes → Shuts down | Stateless (each request isolated) |

---

## Code Reuse Map

```
Desktop (src/)                    Web (vidlet-web/)
================                  ===================

gui/
  vidlet.html        ───────────►  public/vidlet.html (+ 12 line changes)
  compress.html      ───────────►  public/compress.html (unchanged!)
  css/               ───────────►  public/css/ (unchanged!)
  js/                ───────────►  public/js/ (+ videoId param)

lib/
  gui-server.ts      ─────┐
    app.get('/api/info')   ──────►  api/info.ts (same logic!)
    app.post('/api/process') ─────►  api/process.ts (+ download response)
    app.get('/api/video')    ─────►  api/video.ts (same logic!)
    app.post('/api/preview') ─────►  api/preview.ts (same logic!)

lib/
  ffmpeg.ts          ───────────►  lib/ffmpeg.ts (unchanged!)
  paths.ts           ───────────►  lib/paths.ts (unchanged!)

tools/
  compress.ts        ───────────►  lib/tools/compress.ts (unchanged!)
  togif.ts           ───────────►  lib/tools/togif.ts (unchanged!)
  trim.ts            ───────────►  lib/tools/trim.ts (unchanged!)
  loop.ts            ───────────►  lib/tools/loop.ts (unchanged!)
  [all others]       ───────────►  [all copied as-is]

                     ──────────►  api/upload.ts (NEW - 100 lines)
                     ──────────►  public/index.html (NEW - 150 lines)
```

---

## Data Flow

### Desktop: Local File
```
C:\Videos\video.mp4
    │
    ├─► Streamed to browser via /api/video
    ├─► Processed by FFmpeg
    └─► Saved to C:\Videos\VidLet\video_compressed.mp4
```

### Web: Upload → Process → Download
```
User's Device: video.mp4
    │
    ├─► Upload to Vercel (multipart form)
    ├─► Saved to /tmp/{uuid}.mp4
    ├─► Streamed to browser via /api/video?v={uuid}
    ├─► Processed by FFmpeg
    ├─► Read from /tmp/{uuid}_output.mp4
    └─► Downloaded to User's Device: compressed.mp4
```

---

## Shared Components (100% Reuse)

### GUI Layer
- ✅ HTML structure
- ✅ CSS styling
- ✅ JavaScript player controls
- ✅ Timeline component
- ✅ Undo/Redo system
- ✅ Tool options panels
- ✅ Hotkey system

### Processing Layer
- ✅ FFmpeg wrapper (`ffmpeg.ts`)
- ✅ All video tools (`tools/*.ts`)
- ✅ Metadata extraction
- ✅ Frame extraction
- ✅ Loop detection algorithms
- ✅ Filter preview generation

### API Layer (70% Reuse)
- ✅ `/api/info` - metadata
- ✅ `/api/video` - streaming
- ✅ `/api/preview` - thumbnail generation
- ✅ `/api/detect-loops` - loop analysis
- 🆕 `/api/upload` - file upload (new)
- 🔀 `/api/process` - returns download (adapted)

---

## What This Means

**You're NOT:**
- Building a new app
- Rewriting your tools
- Redesigning the GUI
- Learning a new framework

**You ARE:**
- Splitting one file (gui-server.ts) into multiple files (api/*.ts)
- Adding file upload (new feature)
- Changing output method (save → download)
- Adding URL parameter for session tracking

**Total effort: 2-3 hours**

---

## Deployment Comparison

### Desktop Deployment
```bash
npm run build
npm publish @spark-apps/vidlet
# Users install: npm install -g @spark-apps/vidlet
# Users run: vidlet compress video.mp4
```

### Web Deployment
```bash
npm run build
vercel --prod
# Users visit: vidlet-web.vercel.app
# Users drag & drop video
```

**Both can coexist!** Desktop for power users, Web for casual users.
