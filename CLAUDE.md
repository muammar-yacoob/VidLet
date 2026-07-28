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

### AI Tools
| Tool | Purpose |
|------|---------|
| `caption` | Auto-transcribe (whisper.cpp) + burn styled captions (hormozi/karaoke/classic/minimal) |
| `jumpcut` | Auto-edit: cut silence + alternating punch-in zoom |

### Video Tools
| Tool | Purpose |
|------|---------|
| `render` | Render a `.vidlet` project (CC0 spec: `docs/vidlet-format.md` + `res/vidlet-1.schema.json`) to MP4 — main-track cuts, overlays, subtitles, audio mixdown with narration ducking |
| `compress` | Reduce file size with H.264/HEVC encoding |
| `togif` | Convert to optimized GIF with palette generation |
| `mkv2mp4` | Convert MKV containers to MP4 |
| `shrink` | Speed up video to fit target duration |
| `thumb` | Set custom thumbnail from frame or image |
| `trim` | Cut video segments with optional re-encoding |
| `loop` | Create seamless loops using frame similarity |
| `portrait` | Convert landscape to 9:16 portrait |
| `audio` | Add/mix audio tracks |

### Audio Tools
| Tool | Purpose |
|------|---------|
| `cleanvoice` | Multi-engine neural denoising (DeepFilterNet/RNNoise/FFmpeg) |
| `removesilence` | Cut silent segments with configurable threshold |
| `extractaudio` | Pull audio track to MP3/WAV/AAC/FLAC |
| `autocleanup` | Pipeline: denoise + remove silence + contrast + compress |

### Key Modules
| Module | Location | Purpose |
|--------|----------|---------|
| `whisper.ts` | `src/lib/` | whisper.cpp binary/model management + transcription |
| `ffmpeg.ts` | `src/lib/` | FFmpeg wrapper (execute, analyze, extract frames) |
| `vidlet-project.ts` | `src/lib/` | `.vidlet` format v1: zod schema (unknown fields preserved), parse/validate, media resolution (sha256 verify) |
| `project-create.ts` | `src/lib/` | Build projects from .srt/.vtt/.txt/.md/QuickPeek-plan sources |
| `gui-server.ts` | `src/lib/` | Express server for GUI with API endpoints |
| `config.ts` | `src/lib/` | Zod-validated tool configuration |

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

## MCP Server

`mcp.js` (repo root, bin `vidlet-mcp`) is a thin stdio bootstrap (transport, protocol-stdout proxy,
dispatch); the 17 tool schemas/handlers live in `src/mcp/` — `shared.ts` (plumbing: silenced stdout,
never-overwrite reservation, URL-length guard), `tools-core.ts` (probe/caption/jumpcut/trim/
compress/audio/gif), `tools-studio.ts` (setup_recording, voiceover, short, demo), `tools-project.ts`
(.vidlet suite: create_project, validate_project, render_project, open_in_editor,
add_voiceover_to_project), assembled by `src/mcp/index.ts` and bundled as `dist/mcp-tools.js` (a
tsup entry, like `dist/mcp-lib.js`) — real tool functions, no shelling out to the CLI.
`setup_recording`/`open_in_editor` hand data to vidlet.app via `#prompter=`/`#project=` base64url
hashes, auto-opening the browser only when the URL fits the platform launcher (cmd.exe caps at 8191
chars on Windows/WSL). No delete/move tools by design; every write defaults to the `VidLet/`
subdirectory and never overwrites an existing file (numbered `-1`, `-2`, ... via an atomic
reserve-then-write, since a plain existsSync check races under concurrent tool calls).

## Code Rules

- **500-line cap per source file** — split modules before they cross it.
- `res/vidlet-1.schema.json` and the spec section of `docs/vidlet-format.md` are vendored from the
  CC0 `.vidlet` format spec (https://vidlet.app/schema/vidlet-1.json) — update them only from the
  published spec, never fork the format locally.

## Release Process

Uses semantic-release on the `main` branch via GitHub Actions. Published to npm as `@spark-apps/vidlet`.
