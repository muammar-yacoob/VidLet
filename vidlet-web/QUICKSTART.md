# Quick Start Guide

Get VidLet Web running in 5 minutes.

## Prerequisites

- Node.js 18+
- Vercel CLI (`npm install -g vercel`)
- FFmpeg installed locally (for testing)

## Setup

```bash
# 1. Copy GUI files from desktop version
./setup.sh

# 2. Install dependencies
npm install

# 3. Run locally
npm run dev
```

Visit `http://localhost:3000`

## What You'll See

1. **Landing page** - Drag & drop video upload
2. **Upload** - File uploads to `/tmp` (simulated locally)
3. **Redirect** - Opens `vidlet.html?v=VIDEO_ID`
4. **Process** - Compress video (example)
5. **Download** - Get processed video

## Current Implementation

✅ **Working:**
- File upload interface
- Video metadata extraction
- Compress tool (example)
- Download processed video

⚠️ **Not Yet Implemented:**
- All other tools (trim, loop, gif, etc.) - **just copy from desktop!**
- Video streaming endpoint (`api/video.ts`)
- Preview generation (`api/preview.ts`)
- Progress updates

## Adding More Tools

To add more tools (they're already written!), just copy the logic:

### Example: Add ToGIF Tool

**Desktop** (`src/tools/togif.ts`):
```typescript
export async function convertToGif(input: string, output: string, options: GifOptions) {
  await executeFFmpeg({
    input,
    output,
    args: [
      '-vf', `fps=${options.fps},scale=${options.width}:-1`,
      '-c:v', 'gif',
    ]
  });
}
```

**Web** (`api/process.ts`):
```typescript
// Add to existing handler
if (options.tool === 'togif') {
  await execa('ffmpeg', [
    '-i', inputPath,
    '-vf', `fps=${options.fps},scale=${options.width}:-1`,
    '-c:v', 'gif',
    outputPath
  ]);

  const buffer = await readFile(outputPath);
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Disposition', 'attachment; filename="output.gif"');
  res.send(buffer);
}
```

**That's it!** Same FFmpeg command, just return download instead of saving.

## Deploy to Vercel

```bash
# Login (first time only)
vercel login

# Deploy
vercel --prod
```

Your app will be live at `https://your-project.vercel.app`

## Limitations (Free Tier)

- **Function timeout:** 10 seconds (enough for small videos)
- **Max file size:** 4.5 MB request body
- **Bandwidth:** 100 GB/month

**Solutions:**
- Upgrade to Pro ($20/mo) for 60s timeout and larger files
- Use Vercel Blob for file storage (first GB free)
- Add chunked upload for large files

## Cost Estimate

**Processing 1 minute video:**
- Upload: ~50 MB (1 second)
- Process: ~30 seconds compute
- Download: ~20 MB (1 second)

**Free tier allows:**
- ~200 video compressions/month
- ~10,000 page views/month

## Next Steps

1. **Copy remaining tools** - They're already written, just adapt output!
2. **Add progress updates** - Use Server-Sent Events or polling
3. **Add storage** - Use Vercel Blob for persistent uploads
4. **Add authentication** - Optional, for user accounts
5. **Monitor usage** - Vercel dashboard shows costs

## Questions?

**"My FFmpeg command works on desktop but not Vercel"**
- Vercel uses FFmpeg 4.x (check compatibility)
- Some codecs might not be available
- Test locally with `vercel dev` first

**"File upload fails"**
- Check file size (4.5 MB default limit)
- Increase limit in `vercel.json` or use chunked upload
- For >100MB files, use Vercel Blob direct upload

**"Processing times out"**
- Free tier: 10s limit
- Pro tier: 60s limit
- For longer videos, use background jobs (external worker)

**"How do I share code between desktop and web?"**
- Use symlinks: `ln -s ../src/lib lib`
- Use monorepo: npm workspaces
- Publish shared code as npm package

---

**You're now running VidLet in the browser using 95% of your existing code!**
