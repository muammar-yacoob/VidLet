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
- <img src="src/icons/loop.ico" width="16" height="16" alt="Loop icon"> **Perfect Loop**: Create seamless looping videos by finding matching frames
- <img src="src/icons/togif.ico" width="16" height="16" alt="GIF icon"> **Convert to GIF**: Convert MP4 videos to high-quality optimized GIFs

## 🚀 Quick Start
1. Download this repository
2. Run `install_vidlet.bat` as Administrator
3. Right-click on video files to access new context menu options!

## 💡 Usage
All tools run automatically with optimal settings. Just right-click and select the desired operation:
- **Compress Video** <img src="src/icons/compress.ico" width="12" height="12">: MP4 compression with optimal quality settings
- **Convert to MP4** <img src="src/icons/mkv2mp4.ico" width="12" height="12">: Convert MKV files to MP4 format
- **Shrink** <img src="src/icons/shrink.ico" width="12" height="12">: Quick MP4 size reduction to fit social media limits
- **Set Thumbnail** <img src="src/icons/thumb.ico" width="12" height="12">: Choose any frame as your video's thumbnail
- **Perfect Loop** <img src="src/icons/loop.ico" width="12" height="12">: Create seamless looping videos automatically
- **Convert to GIF** <img src="src/icons/togif.ico" width="12" height="12">: Create optimized GIFs with custom settings

## ⚙️ Configuration
Each tool has its own INI file for customization. By default, all tools run non-interactively with optimal settings. To customize behavior, edit the corresponding INI file:

### MKV to MP4 (mkv2mp4.ini)
```ini
# Use stream copy mode (1=yes, 0=no)
# Copy mode is faster but may have compatibility issues
#use_copy=1

# Video quality (CRF value from 0-51)
# Lower = better quality, 18-28 recommended
#video_quality=23

# Encoding preset
# Options: ultrafast, fast, medium, slow
# Slower = better compression but takes longer
#preset=medium
```

### Compression (compress.ini)
```ini
# Video bitrate in kb/s 
# Higher = better quality but larger file
# Recommended: 2000-4000 for HD, 1500-2500 for SD
#bitrate=2500

# Video quality (lower = better)
# 18 = high quality, 23 = medium, 28 = low
#crf=18

# Encoding speed preset
# Options: ultrafast, fast, medium, slow
# Slower = better compression but takes longer
#preset=medium
```

### Perfect Loop (loop.ini)
```ini
# Duration to search for loop points (in seconds)
#search_duration=5

# Minimum loop length (in seconds)
#min_loop_length=1

# Maximum loop length (in seconds)
#max_loop_length=3

# Similarity threshold (0.0-1.0)
# Higher values = more similar frames required
#threshold=0.98

# Crossfade duration (in seconds)
#crossfade=0.5
```

### Convert to GIF (togif.ini)
```ini
# Output framerate
#fps=15

# Output width in pixels (height will scale proportionally)
#width=480

# Dithering algorithm (floyd_steinberg, bayer, sierra2_4a, etc.)
#dither=sierra2_4a

# Palette generation mode (full or diff)
#stats_mode=full
```

### Shrink (shrink.ini)
```ini
# Target duration in seconds (default: 59.5s for shorts)
#target_duration=59.5

# Video quality (lower = better)
# 18 = high quality, 23 = medium, 28 = low
#quality=18

# Encoding speed preset
# Options: ultrafast, fast, medium, slow
# Slower = better compression but takes longer
#preset=medium

# Audio bitrate in kbps
#audio_bitrate=192
```

### Thumbnail (thumb.ini)
```ini
# Set to -1 to prompt for frame timestamp
# Set to any other value (in seconds) to use that frame directly
#frame_timestamp=-1

# Set to 1 to always use file browser for external image selection
# Set to 0 to prompt for frame timestamp
#use_file_browser=1

# Default frame timestamp (in seconds) to use if use_file_browser=0
# Format: HH:MM:SS or seconds (e.g., 00:01:30 or 90)
#default_frame=00:00:00
```

## 🌱 Support & Contributions
Star the repo ⭐ & I power up like Mario 🍄<br>
Devs run on [coffee][coffee-link] ☕<br>
[contributions][fork-link] are welcome.

---
<div align="center">
<sub>Released under MIT License | <a href="[privacy-link]">Privacy Policy</a></sub>
</div>