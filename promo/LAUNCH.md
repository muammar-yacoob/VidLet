# VidLet Launch Kit

## Tagline

> Free local auto-captions + video tools. No subscription, no cloud. CapCut alternative.

## Install

```
npm i -g @spark-apps/vidlet
```

## Links

- GitHub: https://github.com/muammar-yacoob/VidLet
- npm: https://www.npmjs.com/package/@spark-apps/vidlet
- Web: https://vidlet.app
- CLI page: https://vidlet.app/cli

---

## Posts (copy-paste ready)

### Hacker News

**Title:** `Show HN: VidLet -- Free local auto-captions and jump cuts with whisper.cpp`

I built a CLI video toolkit that runs entirely locally. Two features I'm most excited about:

1. Auto-captions -- whisper.cpp transcription, burns styled subtitles (hormozi word-highlight, karaoke, classic, minimal). No API key, no cloud.

2. Auto jump cuts -- detects silence, cuts it, adds alternating punch-in zoom. One command.

Plus 14 other tools: compress, voice cleanup (DeepFilterNet), silence removal, GIF, seamless loops, etc. Node.js CLI, runs in WSL, adds right-click menu to Windows Explorer.

    npm i -g @spark-apps/vidlet
    vidlet caption video.mp4
    vidlet jumpcut video.mp4

MIT. https://github.com/muammar-yacoob/VidLet

---

### r/commandline

**Title:** `I built a CLI that auto-captions and jump-cuts videos locally (whisper.cpp + FFmpeg)`

`vidlet caption video.mp4` -- whisper.cpp transcription, 4 caption styles (hormozi, karaoke, classic, minimal). No cloud, no API keys.

`vidlet jumpcut video.mp4 --pace tight` -- silence detection, cuts dead air, alternating punch-in zoom.

Also: compress, neural denoising (DeepFilterNet), silence removal, GIF, loop detection. Runs in WSL, hooks into Windows right-click menu.

```
npm i -g @spark-apps/vidlet
```

https://github.com/muammar-yacoob/VidLet

---

### r/ffmpeg

**Title:** `Built a CLI on top of FFmpeg: auto-captions (whisper.cpp), jump cuts with zoom, neural denoising`

Under the hood:
- **Captions**: 16kHz WAV extraction → whisper.cpp word timestamps → ASS subtitles (hormozi `\1c` overlay, karaoke `\kf`, classic, minimal) → `ass=` burn
- **Jump cuts**: `silencedetect` → speech segments → alternating `crop`+`scale` zoom → concat demuxer
- **Voice cleanup**: DeepFilterNet > RNNoise > afftdn fallback, two-pass loudnorm + compressor + limiter
- **Loops**: PNG frame extraction, pixelmatch comparison

```
npm i -g @spark-apps/vidlet
vidlet caption video.mp4 --style karaoke --color cyan
vidlet jumpcut video.mp4 --pace tight --zoom 5
```

https://github.com/muammar-yacoob/VidLet

---

### r/videography

**Title:** `Free alternative to CapCut/Descript for auto-captions -- runs 100% locally, no subscription`

What CapCut Pro ($10/mo) and Descript ($24/mo) charge for:
- **Auto-captions** -- 4 styles including hormozi word-highlight
- **Auto jump cuts** -- silence removal + punch-in zoom
- **Voice cleanup** -- neural denoising
- Compression, GIF, silence removal, etc.

Everything local. whisper.cpp for transcription. CLI with GUI (`-g` flag).

```
npm i -g @spark-apps/vidlet
```

MIT: https://github.com/muammar-yacoob/VidLet

---

## Submission Links

- alternativeto.com -- list as alternative to: CapCut, Descript, Opus Clip, Kapwing
- Product Hunt -- use OG image at `vidlet-web/public/og-image.png`
