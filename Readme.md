[//]: # (Constants)
[privacy-link]: ./PRIVACY.md
[coffee-link]: https://buymeacoffee.com/spark88
[issues-link]: https://github.com/muammar-yacoob/VidLet/issues
[fork-link]: https://github.com/muammar-yacoob/VidLet/fork

<div align="center">

```
 _    ___     ____         __
| |  / (_)___/ / /   ___  / /_
| | / / / __  / /   / _ \/ __/
| |/ / / /_/ / /___/  __/ /_
|___/_/\__,_/_____/\___/\__/  🎬
```

# Video Utility Toolkit

**Right-click context menu tools for Windows • Powered by WSL & FFmpeg**

[![npm version](https://img.shields.io/npm/v/@spark-apps/vidlet?color=cb3837&logo=npm)](https://www.npmjs.com/package/@spark-apps/vidlet)
[![Buy Me Coffee](https://img.shields.io/badge/Buy%20Me-☕%20Coffee-green?logo=buy-me-a-coffee&logoColor=white)][coffee-link]
[![Report Bug](https://img.shields.io/badge/Report-🐞%20Bug-red?logo=github&logoColor=white)][issues-link]

</div>

---

## ✨ Features

| Command | Description |
|---------|-------------|
| `compress` | Reduce video file size with H.264 encoding |
| `togif` | Convert MP4 to optimized GIF with palette generation |
| `mkv2mp4` | Convert MKV containers to MP4 (fast remux or re-encode) |
| `shrink` | Speed up video to fit target duration (YouTube Shorts) |
| `thumb` | Set custom video thumbnail from any frame |
| `loop` | Create seamless looping videos with frame detection |

---

## 🚀 Quick Start

### Prerequisites

- **WSL** (Windows Subsystem for Linux)
- **Node.js 18+** in WSL
- **FFmpeg** in WSL: `sudo apt install ffmpeg`

### Install

```bash
npm install -g @spark-apps/vidlet
```

### Add Windows Context Menu

```bash
vidlet install
```

Follow the on-screen instructions to import the registry file (requires Admin).

---

## 💻 CLI Usage

```bash
# Show help with gradient banner
vidlet --help

# Compress video
vidlet compress video.mp4
vidlet compress video.mp4 --bitrate 2000 --preset fast

# Convert to GIF
vidlet togif video.mp4
vidlet togif video.mp4 --fps 20 --width 640

# Convert MKV to MP4
vidlet mkv2mp4 video.mkv
vidlet mkv2mp4 video.mkv --no-copy  # Re-encode

# Shrink for Shorts (default: 59.5s)
vidlet shrink video.mp4
vidlet shrink video.mp4 --target 30

# Set thumbnail
vidlet thumb video.mp4 --timestamp 00:00:05

# Create seamless loop
vidlet loop video.mp4
vidlet loop video.mp4 --threshold 0.95 --crossfade 0.3
```

---

## ⚙️ Configuration

Config location: `~/.config/vidlet/config.json`

```bash
vidlet config show   # View current config
vidlet config reset  # Reset to defaults
vidlet config path   # Show config file path
```

### Default Settings

```json
{
  "compress": { "bitrate": 2500, "preset": "medium" },
  "togif": { "fps": 15, "width": 480, "dither": "sierra2_4a" },
  "loop": { "searchDuration": 5, "minLength": 1, "maxLength": 3, "threshold": 0.98 },
  "shrink": { "targetDuration": 59.5 },
  "mkv2mp4": { "copyStreams": true, "crf": 23 },
  "thumb": { "timestamp": "00:00:01" }
}
```

---

## 🔧 How It Works

```
Windows Explorer → Right-click → VidLet
       ↓
Registry calls: wsl.exe -e vidlet <command> "$(wslpath '%1')"
       ↓
WSL converts path: C:\Videos\clip.mp4 → /mnt/c/Videos/clip.mp4
       ↓
FFmpeg processes video
       ↓
Output saved alongside original file
```

- **No batch files** - Pure TypeScript/Node.js
- **Automatic path conversion** - Windows ↔ WSL
- **JSON config** - Easy customization

---

## 🗑️ Uninstall

```bash
vidlet uninstall                    # Remove context menu
npm uninstall -g @spark-apps/vidlet # Remove package
```

---

## 🛠️ Development

```bash
git clone https://github.com/muammar-yacoob/VidLet.git
cd VidLet
npm install

npm run build      # Build
npm run check      # Lint & format
npm run typecheck  # Type check

# Test locally
node dist/cli.js --help
npm link && vidlet --help
```

---

## 🌱 Support

Star the repo ⭐ & I power up like Mario 🍄<br>
Devs run on [coffee][coffee-link] ☕<br>
[Contributions][fork-link] are welcome!

---

<div align="center">
<sub>Released under MIT License | <a href="./PRIVACY.md">Privacy Policy</a></sub>
</div>
