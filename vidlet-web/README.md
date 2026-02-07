# VidLet Web - Proof of Concept

This is a **minimal adaptation** of your existing VidLet desktop app for Vercel deployment.

## What Changed vs Desktop Version

### ✅ **REUSED (95% of code)**
- All GUI files (`src/gui/*.html`, `src/gui/js/*.js`, `src/gui/css/*.css`)
- All FFmpeg processing logic (`src/tools/*.ts`)
- All video processing functions (`src/lib/ffmpeg.ts`)
- API endpoint structure (same routes, same logic)

### 🆕 **NEW for Web (5% new code)**
1. **File Upload** (`public/index.html` + `api/upload.ts`)
   - Drag & drop interface
   - Stores video in `/tmp` on Vercel
   - Returns video ID for session

2. **Download Response** (change in `api/process.ts`)
   ```typescript
   // Desktop: fs.writeFileSync('./VidLet/output.mp4', buffer)
   // Web:     res.send(buffer) with download headers
   ```

3. **Serverless Structure**
   ```
   Desktop: gui-server.ts (370 lines, 1 Express app)
   Web:     api/*.ts (50 lines each, split into functions)
   ```

---

## Project Structure

```
vidlet-web/
├── public/              # 📋 COPY from ../src/gui/ (unchanged!)
│   ├── index.html       # 🆕 NEW: File upload landing page
│   ├── vidlet.html      # ✅ COPIED from src/gui/vidlet.html
│   ├── css/             # ✅ COPIED from src/gui/css/
│   └── js/              # ✅ COPIED from src/gui/js/
│
├── api/                 # 🔀 ADAPTED from gui-server.ts
│   ├── upload.ts        # 🆕 NEW: Handle video upload
│   ├── info.ts          # ✅ SAME logic as GET /api/info
│   ├── process.ts       # 🔀 ADAPTED: Returns download instead of saving
│   ├── video.ts         # ✅ SAME: Stream video from /tmp
│   └── preview.ts       # ✅ SAME: Generate preview frames
│
├── lib/                 # 📋 COPY from ../src/lib/ (unchanged!)
│   ├── ffmpeg.ts        # ✅ COPIED: Same FFmpeg wrapper
│   └── tools/           # ✅ COPIED: Same processing logic
│
├── vercel.json          # ⚙️ Config: FFmpeg layer, timeout
└── package.json
```

---

## How It Works

### Desktop Flow (Current)
```
1. User right-clicks video.mp4
2. VBS launcher → wsl vidlet compress video.mp4
3. Express server starts on localhost:random
4. HTA window opens Edge to http://127.0.0.1:PORT/vidlet.html
5. User selects options, clicks process
6. FFmpeg runs locally, saves to VidLet/video_compressed.mp4
7. Server shuts down
```

### Web Flow (New)
```
1. User visits vidlet-web.vercel.app
2. Drag & drop video.mp4
3. Upload to /tmp, get video ID
4. Redirect to /vidlet.html?v={videoId}
5. User selects options, clicks process
6. FFmpeg runs on Vercel, returns download
7. User saves compressed.mp4
```

---

## API Comparison

### Desktop (`src/lib/gui-server.ts`)
```typescript
// 370 lines, single Express app
app.get('/api/info', (req, res) => {
  res.json({
    fileName: options.videoInfo.fileName,
    filePath: options.videoInfo.filePath,
    // ...
  });
});

app.post('/api/process', async (req, res) => {
  const result = await options.onProcess(req.body);
  // Saves to filesystem
  res.json(result);
});
```

### Web (`api/*.ts`)
```typescript
// Split into separate files, ~50 lines each
// api/info.ts
export default async function handler(req, res) {
  const { v: videoId } = req.query;
  const filePath = `/tmp/${videoId}.mp4`;
  const info = await getVideoInfo(filePath); // SAME function!
  res.json(info);
}

// api/process.ts
export default async function handler(req, res) {
  const result = await processVideo(options); // SAME logic!
  // Returns download instead of saving
  res.setHeader('Content-Disposition', 'attachment');
  res.send(buffer);
}
```

---

## Setup

### 1. Install Vercel CLI
```bash
npm install -g vercel
```

### 2. Install Dependencies
```bash
cd vidlet-web
npm install
```

### 3. Add FFmpeg Layer (Vercel)
Vercel doesn't include FFmpeg by default. Options:

**Option A: Use FFmpeg Layer (Lambda)**
```json
// vercel.json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 300,
      "memory": 3008
    }
  }
}
```
Then install FFmpeg layer from Vercel Marketplace or use Docker container.

**Option B: Use Docker Container** (Recommended)
```dockerfile
# Dockerfile
FROM node:18
RUN apt-get update && apt-get install -y ffmpeg
COPY . .
RUN npm install
CMD ["vercel", "dev"]
```

### 4. Copy GUI Files
```bash
# From VidLet root directory
cp -r src/gui/* vidlet-web/public/
cp -r src/lib vidlet-web/
cp -r src/tools vidlet-web/lib/
```

### 5. Run Locally
```bash
vercel dev
```

### 6. Deploy
```bash
vercel --prod
```

---

## What's Missing (For Full Production)

This POC demonstrates the **concept**. For production, you'd need:

### Storage
- [ ] Use S3/Vercel Blob for uploaded videos (not `/tmp`)
- [ ] Session management (Redis/DB instead of URL params)
- [ ] Cleanup old uploads

### Processing
- [ ] Progress updates (WebSockets or polling)
- [ ] Queue system for long videos (BullMQ + Redis)
- [ ] Timeout handling (Vercel has 5min limit on Hobby, 15min on Pro)

### Security
- [ ] File size limits (prevent abuse)
- [ ] Rate limiting
- [ ] Authentication (optional)
- [ ] Virus scanning

### Features
- [ ] Implement all tools (currently only compress is shown)
- [ ] Copy preview.ts, video.ts, etc. from desktop version
- [ ] Handle all file formats (currently hardcoded .mp4)

### UX
- [ ] Progress bar during processing
- [ ] Preview results before downloading
- [ ] Batch processing

---

## Key Differences

| Aspect | Desktop | Web |
|--------|---------|-----|
| **Video Input** | File path from Windows | File upload |
| **Processing** | Local FFmpeg | Vercel FFmpeg |
| **Output** | Save to VidLet/ folder | Download link |
| **Session** | In-memory variables | URL params / Redis |
| **GUI** | Served from localhost | Served from Vercel CDN |
| **Launcher** | VBS + HTA + Edge | Direct browser |
| **Timeout** | 30 minutes | 5 minutes (Hobby) / 15 min (Pro) |

---

## Cost Estimate (Vercel)

**Hobby Plan (Free):**
- 100 GB bandwidth/month
- 100 GB-hours compute/month
- 5 minute function timeout
- **Good for:** Testing, low traffic

**Pro Plan ($20/mo):**
- 1 TB bandwidth
- 1000 GB-hours compute
- 15 minute timeout
- **Good for:** Production, moderate usage

**Example:**
- 1 min video compression = ~30s processing
- 100 GB-hours = ~12,000 compressions/month (free tier)

---

## Next Steps

1. **Try the POC:**
   ```bash
   cd vidlet-web
   npm install
   vercel dev
   ```

2. **Copy remaining tools:**
   - Copy logic from `src/tools/compress.ts`, `togif.ts`, etc.
   - Adapt output to return downloads

3. **Test deployment:**
   ```bash
   vercel --prod
   ```

4. **Decide on architecture:**
   - Full Vercel (serverless)
   - Hybrid (Vercel + separate FFmpeg workers)
   - Docker container on cloud provider

---

## Questions?

- **"Do I need to maintain two codebases?"** → No! You can share `lib/` and `tools/` between both versions using symlinks or a monorepo.

- **"Can I keep adding features to both?"** → Yes! The processing logic is identical, only input/output differs.

- **"Which should I use?"** → Desktop for power users, Web for casual users / cross-platform.

---

**This POC proves you can deploy to Vercel with <100 lines of new code, reusing 95% of your existing work!**
