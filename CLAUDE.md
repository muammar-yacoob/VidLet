# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VidLet is a Windows video utility toolkit that adds right-click context menu options for common video operations. It consists of batch scripts that wrap FFmpeg commands, with optional Python scripts for advanced features.

## Architecture

### Installation Structure
- `install_vidlet.bat` - Installs to `C:\Program Files\VidLet\` and imports registry entries
- `uninstall_vidlet.bat` - Removes installation directory and registry entries
- `src/vidlet.reg` - Registry entries for Windows shell context menu integration

### Core Components
All tools follow the same pattern:
1. Batch script in `src/` handles CLI invocation and FFmpeg execution
2. Optional `.ini` file provides configuration (loaded via `findstr` parsing)
3. FFmpeg binary at `libs/ffmpeg.exe` does the actual video processing

### Video Tools
| Tool | Input | Purpose |
|------|-------|---------|
| `compress.bat` | MP4 | Reduce file size with configurable bitrate/preset |
| `mkv2mp4.bat` | MKV | Convert MKV to MP4 (stream copy or re-encode) |
| `shrink.bat` | MP4 | Speed up video to fit target duration (default 59.5s for shorts) |
| `thumb.bat` | MP4 | Set custom thumbnail from video frame |
| `loop.bat` | MP4 | Create seamless loops using frame similarity detection |
| `togif.bat` | MP4 | Convert to optimized GIF with palette generation |

### Python Dependencies
`src/scripts/find_loop.py` requires OpenCV (`cv2`) and NumPy for frame comparison in the loop tool.

## Configuration Pattern

Each tool reads from a corresponding `.ini` file (e.g., `compress.ini`). Settings are loaded by parsing non-comment, non-empty lines as direct variable assignments:
```batch
for /f "tokens=*" %%a in ('type "!INI_FILE!" ^| findstr /v "^#" ^| findstr /v "^$"') do (
    set "%%a"
)
```

Common settings across tools:
- `hidden_mode=1` - Run minimized (for background processing)
- Tool-specific quality/preset/bitrate settings

## Release Process

Uses semantic-release on the `main` branch via GitHub Actions. Configuration in `.releaserc` packages the release as `VidLet.zip`.

## Testing

No automated tests. Manual testing requires:
1. Run `install_vidlet.bat` as Administrator
2. Right-click video files in Windows Explorer to access context menu options
3. Verify output files are created correctly
