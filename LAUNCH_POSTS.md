# Launch Posts — Ready to Paste

## Hacker News (Show HN)

**Title:** Show HN: VidLet -- Free local auto-captions and jump cuts with whisper.cpp

**Body:**
I built a CLI video toolkit that runs entirely locally. The two features I'm most excited about:

1. Auto-captions -- transcribes via whisper.cpp and burns styled subtitles (hormozi word-highlight, karaoke, classic, minimal). No API key, no cloud upload.

2. Auto jump cuts -- detects silence, cuts it, adds alternating punch-in zoom. The editing style you see in every fast-paced YouTube video, in one command.

Plus 14 other tools: compress, voice cleanup (DeepFilterNet neural denoising), silence removal, GIF conversion, seamless loop detection, etc.

It's a Node.js CLI that runs in WSL with FFmpeg. Right-click any video in Windows Explorer to use it.

    npm i -g @spark-apps/vidlet
    vidlet caption video.mp4
    vidlet jumpcut video.mp4

MIT licensed. Feedback welcome.

https://github.com/muammar-yacoob/VidLet

---

## r/commandline

**Title:** I built a CLI that auto-captions and jump-cuts videos locally (whisper.cpp + FFmpeg)

**Body:**
Made a video toolkit for the terminal. Two features that might interest this sub:

`vidlet caption video.mp4` -- transcribes with whisper.cpp locally, burns in styled captions (4 presets including the hormozi word-highlight style). No cloud, no API keys.

`vidlet jumpcut video.mp4 --pace tight` -- detects silence, cuts dead air, adds alternating punch-in zoom. Basically automates what podcast editors do manually.

Also has: compress, neural voice denoising (DeepFilterNet), silence removal, GIF conversion, seamless loop detection, and more.

Runs in WSL, hooks into the Windows right-click menu. Everything goes through FFmpeg.

```
npm i -g @spark-apps/vidlet
```

Source: https://github.com/muammar-yacoob/VidLet

---

## r/ffmpeg

**Title:** Built a CLI toolkit on top of FFmpeg: auto-captions (whisper.cpp), jump cuts with punch-in zoom, neural denoising

**Body:**
Sharing a project that wraps FFmpeg for common video editing tasks. The interesting bits under the hood:

- **Auto-captions**: extracts audio as 16kHz WAV, runs whisper.cpp for word-level timestamps, generates ASS subtitles with 4 style presets (hormozi word-by-word highlight, karaoke \kf fill, classic, minimal), burns with `ass=` filter
- **Jump cuts**: `silencedetect` to find gaps, splits into speech segments, alternating segments get `crop` + `scale` for punch-in zoom effect, concat demuxer to stitch
- **Voice cleanup**: multi-engine pipeline -- DeepFilterNet (neural, 48kHz) > RNNoise > FFmpeg afftdn fallback. Two-pass loudnorm with compressor + limiter chain
- **Seamless loops**: extracts frames as PNG, pixelmatch for pixel-level comparison to find matching frames

All Node.js/TypeScript, MIT licensed.

```
npm i -g @spark-apps/vidlet
vidlet caption video.mp4 --style karaoke --color cyan
vidlet jumpcut video.mp4 --pace tight --zoom 5
```

https://github.com/muammar-yacoob/VidLet

---

## r/videography

**Title:** Free alternative to CapCut/Descript for auto-captions -- runs 100% locally, no subscription

**Body:**
Built a free tool that does what CapCut Pro and Descript charge $10-24/mo for:

- **Auto-captions** with 4 styles (including the hormozi word-highlight everyone uses on Reels/Shorts)
- **Auto jump cuts** that remove dead air and add punch-in zoom
- **Voice cleanup** with neural denoising
- **Silence removal**, compression, GIF conversion, etc.

Everything runs locally on your machine. Your videos never get uploaded anywhere. Uses whisper.cpp for transcription (auto-downloads, no setup).

It's a CLI tool (install with `npm i -g @spark-apps/vidlet`), but every tool also has a GUI you can open with `-g`.

MIT open source: https://github.com/muammar-yacoob/VidLet

---

## One-liner for Twitter/X bio or anywhere

> Free local auto-captions + video tools. No subscription, no cloud. CapCut alternative.

## GitHub repo description (already set)

> Free auto-captions (whisper.cpp) + 16 video tools. Local, private, no subscription. CapCut alternative.
