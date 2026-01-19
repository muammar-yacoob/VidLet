# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VidLet is a Windows video utility toolkit that adds right-click context menu options for common video operations. Built with TypeScript/Node.js, it runs in WSL and provides both CLI and GUI interfaces.

## Architecture

### Tech Stack
- **Runtime**: Node.js 18+ in WSL
- **Language**: TypeScript
- **Build**: tsup
- **FFmpeg**: System FFmpeg (installed via `apt install ffmpeg`)

### Core Components
- `src/cli/` - CLI command handlers
- `src/tools/` - Video processing tools (compress, trim, loop, etc.)
- `src/lib/` - Shared utilities (FFmpeg wrapper, config, paths, GUI server)
- `src/gui/` - HTML/CSS/JS for the GUI interface

### Video Tools
| Tool | Purpose |
|------|---------|
| `compress` | Reduce file size with H.264/HEVC encoding |
| `togif` | Convert to optimized GIF with palette generation |
| `mkv2mp4` | Convert MKV containers to MP4 |
| `shrink` | Speed up video to fit target duration |
| `thumb` | Set custom thumbnail from frame or image |
| `trim` | Cut video segments with optional re-encoding |
| `loop` | Create seamless loops using frame similarity |
| `portrait` | Convert landscape to 9:16 portrait |
| `audio` | Add/mix audio tracks |

### Output Directory
All processed videos are saved to a `VidLet` subdirectory next to the input file.

## Configuration

Config location: `~/.config/vidlet/config.json`

```bash
vidlet config show   # View current config
vidlet config reset  # Reset to defaults
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run check        # Lint & format (Biome)
npm run typecheck    # Type check

# Test locally
node dist/cli.js --help
npm link && vidlet --help
```

## Release Process

Uses semantic-release on the `main` branch via GitHub Actions. Published to npm as `@spark-apps/vidlet`.
