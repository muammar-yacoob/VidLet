[//]: # (Constants)
[privacy-link]: ./PRIVACY.md
[coffee-link]: https://buymeacoffee.com/spark88
[issues-link]: https://github.com/spark88/VidLet/issues
[fork-link]: https://github.com/spark88/VidLet/fork

<div align="center">


# 🎬 VidLet - Video Tools for Windows

Handy right-click tools for everyday video tasks!

[![Buy Me Coffee](https://img.shields.io/badge/Buy%20Me-☕%20Coffee-green?logo=buy-me-a-coffee&logoColor=white)][coffee-link] 
[![Report Bug](https://img.shields.io/badge/Report-🐞%20Bug-red?logo=github&logoColor=white)][issues-link]
</div>

## ✨ Features

<div align="center">
<img src="res/imgs/menu.png" style="border: 1px solid #eee; border-radius: 8px; max-width: 500px;" alt="VidLet Menu">
</div>

<br>

### MKV Operations
- <img src="src/icons/mkv2mp4.ico" width="16" height="16" alt="Convert icon"> **Convert MKV to MP4**: Quick format conversion without quality loss (for OBS Recordings)

### MP4 Operations
- <img src="src/icons/compress.ico" width="16" height="16" alt="Compress icon"> **Compress Videos**: Reduce MP4 video size with customizable settings
- <img src="src/icons/shrink.ico" width="16" height="16" alt="Shrink icon"> **Shrink Videos**: Speed up videos to fit within 60 seconds (perfect for social media shorts)
- <img src="src/icons/thumb.ico" width="16" height="16" alt="Thumbnail icon"> **Set Thumbnail**: Set video thumbnail from any frame in the video

## 🚀 Quick Start
1. Download this repository
2. Run `install_vidlet.bat` as Administrator
3. Right-click on video files to access new context menu options!

## 💡 Usage
- **Compress Video** <img src="src/icons/compress.ico" width="12" height="12">: MP4 compression with adjustable quality settings
- **Convert to MP4** <img src="src/icons/mkv2mp4.ico" width="12" height="12">: Convert MKV files to MP4 format
- **Shrink** <img src="src/icons/shrink.ico" width="12" height="12">: Quick MP4 size reduction with preset settings
- **Set Thumbnail** <img src="src/icons/thumb.ico" width="12" height="12">: Choose any frame as your video's thumbnail

## ⚙️ Configuration
Create a `vidlet.ini` file in the same directory as the executable to customize VidLet's behavior:

### MKV Operations
```ini
[MKV2MP4]
use_copy=1          # 1: Fast copy (recommended), 0: Re-encode if needed
video_quality=23    # 18=high, 23=medium, 28=low (only used when re-encoding)
preset=medium       # Encoding speed: ultrafast, fast, medium, slow
```

### MP4 Operations
```ini
[Compress]
quality=medium      # Options: low, medium, high
crf=23             # Lower values = better quality (18-28 recommended)
preset=medium      # Encoding speed preset (slower = better compression)

[Shrink]
target_duration=59.5  # Target duration in seconds (default: 59.5s for shorts)
quality=18           # Video quality (lower = better)
preset=slow         # Encoding preset (slower = better quality)
audio_bitrate=192   # Audio bitrate in kbps

[Thumbnail]
frame_timestamp=-1   # -1: Prompt for frame, or set specific time in seconds
```

## 🌱 Support & Contributions
Star the repo ⭐ & I power up like Mario 🍄<br>
Devs run on [coffee][coffee-link] ☕<br>
[contributions][fork-link] are welcome.

---
<div align="center">
<sub>Released under MIT License | <a href="[privacy-link]">Privacy Policy</a></sub>
</div>