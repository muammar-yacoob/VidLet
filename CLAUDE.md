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
- `src/cli/` - CLI command handlers. `tool-defs.ts` is the registry (metadata +
  CLI entry point + optional GUI); `gui-runner.ts` builds each tool's `runGUI`
  from a small spec so no tool repeats the probe/defaults/logs plumbing;
  `tools.ts` is the lookup surface.
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
| `gui-server.ts` | `src/lib/` | Express server lifecycle for the GUI (static assets, listen, shutdown) |
| `gui-api.ts` | `src/lib/` | The `GuiServerOptions` callback contract + every `/api/*` route |
| `frames.ts` | `src/lib/` | Temp-dir scratch, downscaled frame extraction, pixel similarity |
| `config.ts` | `src/lib/` | Zod-validated tool configuration |
| `spark-pay/` | `src/lib/` | Plan catalog (`plans.json`) + poll-mode entitlement client + daily usage meter |

### GUI Assets

`src/gui/vidlet.html` is a shell of `<!--#include partials/x.html -->` markers,
expanded at build time by `scripts/assemble-html.mjs` (tsup `onSuccess`) into a
single `dist/gui/vidlet.html`; `partials/` is a build input and is not shipped.
Markers sit at column 0 and are replaced whole, so partials keep the exact
indentation they have in the assembled page.

Styles are split under `src/gui/css/app/` and linked in cascade order —
`base → preview → options → timeline → player → portrait → overlays → modals`.
Reordering the `<link>` tags changes the cascade.

The app layer is `src/gui/js/app/` (`state.js` holds the shared state the other
three mutate: `init.js`, `tools.js`, `process.js`), with `js/vidlet-app.js` as
the single table of globals the markup's inline `onclick=` handlers call. The
portrait editor follows the same shape: `portrait-state.js` owns the segment
list and the redraw, with `portrait-crop.js`, `portrait-segments.js`,
`portrait-timeline.js` and the `portrait-tool.js` facade on top. Script load
order in `partials/scripts.html` matters — state before its consumers, facade
last.

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
dispatch, `resources/list` + `resources/read`); the 27 tool schemas/handlers live in `src/mcp/` —
`shared.ts` (plumbing: silenced stdout, never-overwrite reservation, URL-length guard),
`tools-core.ts` (probe/caption/jumpcut/trim/
compress/audio/gif), `tools-studio.ts` (setup_recording, voiceover, short, demo), `tools-project.ts`
(.vidlet suite: create_project, validate_project, render_project, open_in_editor,
add_voiceover_to_project), assembled by `src/mcp/index.ts` and bundled as `dist/mcp-tools.js` (a
tsup entry, like `dist/mcp-lib.js`) — real tool functions, no shelling out to the CLI.
`setup_recording`/`open_in_editor` hand data to vidlet.app via `#prompter=`/`#project=` base64url
hashes, auto-opening the browser only when the URL fits the platform launcher (cmd.exe caps at 8191
chars on Windows/WSL). No delete/move tools by design; every write defaults to the `VidLet/`
subdirectory and never overwrites an existing file (numbered `-1`, `-2`, ... via an atomic
reserve-then-write, since a plain existsSync check races under concurrent tool calls).

Every write tool returns through `fileResult`, which emits a `resource_link` for the output (plus
any extra artifact, e.g. the `.vidlet`). That link is only renderable as a file card if the client
can fetch it, so the server declares the `resources` capability and `src/mcp/resources.ts` serves
those bytes on demand — a session registry of paths the server itself produced, never an arbitrary
path, since `resources/read` over any file:// URI would be an arbitrary-file-read primitive.
Text-ish outputs (`.vidlet`, `.srt`, `.txt`) come back as text, everything else as a base64 blob
capped at 32 MB (stdio carries it in one JSON-RPC line, inflated 4/3).

## No Groq from MCP tools

**An MCP tool never calls Groq.** The caller is already a model and a stronger
one than the llama tiers in `src/lib/groq.ts`, so generation belongs to it. The
CLI and GUI are unaffected — they have no client to delegate to, and Groq stays
correct there.

Enforced at runtime, not by convention: `src/mcp/gate.ts` wraps every handler in
`runInMcpTool` (`src/lib/ai-context.ts`), and `groqChatJSON` refuses inside that
context — checked *before* the response cache, since a cached Groq answer is
still a Groq answer. A new tool cannot ship exempt by omission.

The handshake, two calls:

1. The tool runs, reaches generation, and returns a **brief** per step it needs
   (`src/mcp/delegate.ts`) — the original prompt verbatim, plus the `ai` field to
   answer on. Vision steps attach their frames as MCP image content. Nothing is
   encoded.
2. The caller calls again with `ai: {narration: "...", frame_descriptions: [...]}`.
   `groqChatJSON` returns those verbatim and the run completes.

Notes for anyone touching this:

- **All briefs are collected in one pass**, not one per round trip. The AI call
  sites swallow failures and carry on with a fallback, so a single run reaches
  every step; `abortBeforeExpensiveWork()` (in `autoshort-voice.ts`, after
  alignment and before TTS) stops it before anything costly. Do not "fix" those
  swallowing catches — the collection depends on them.
- **Briefs are keyed on the step, not the tool.** `preview_short` needs
  narration, frame descriptions and an assignment; keying on the tool told the
  caller to resupply what it had just supplied, which loops.
- Adding a Groq call means passing a `GenerationStep` as its third argument and
  adding that step to `STEPS` in `delegate.ts` and to `AI_PROPERTY`
  (`src/mcp/ai-param.ts`). An unlabelled call briefs as an unanswerable
  `unknown` field.
- MCP sampling would be the obvious mechanism and is not available: no Anthropic
  client implements it, and it is deprecated protocol-wide as of spec
  2026-07-28 (SEP-2577).

## Plan Gating

`src/lib/spark-pay/` holds the SparkPay integration (poll mode, ported from
still-applying's kit). `plans.json` is the catalog snapshot — `features`,
`limits` and `compare` per tier — regenerated by `npm run plans:sync` from the
live catalog; edit plans on SparkPay, never here. Tier names and limit keys
must match what is registered there.

`src/mcp/gate.ts` wraps **every** MCP handler in `src/mcp/index.ts`, so a new
tool cannot ship ungated by omission. Two checks: a feature gate
(`youtube_publish`, `ai_hashtags` are Studio-only) and the `mcp_calls_daily`
meter (10/day on Free, unlimited on paid). `list_capabilities` is never
metered — an agent that cannot enumerate tools cannot discover why it failed.

Scope, deliberately: the CLI is AGPL and the local tools call local binaries,
so these gates are honest metering for the things that cost money, not copy
protection. Don't obfuscate them. Entitlements resolve by account email
(`VIDLET_EMAIL`, else `app.accountEmail` in config.json) and fall back to the
last known good answer for 14 days offline rather than dropping a paying user
to free-tier limits on a plane.

## Cost & Performance

- `getVideoInfo` (`src/lib/ffmpeg.ts`) memoizes probes by path + mtime + size.
  Chained tools (`autocleanup`, `demo`, `short`) and the GUI probe the same
  file repeatedly; the key doubles as the invalidation.
- `frames.ts` decodes each PNG once (`DecodedFrame`) instead of inside every
  comparison — loop detection compares O(n²) pairs, so this cut ~10,000 PNG
  decodes to ~120 on a 30s clip.
- The GUI's Spark AI helper (`js/modules/ai-features.js`) asks for the
  filename and the social caption in **one** round trip, and memoizes replies
  per prompt in `sessionStorage`. Both are pure functions of the video
  metadata, so re-processing the same file costs nothing.
- whisper.cpp binaries/models and the dots-tts venv are already cached on disk
  by `existsSync` guards — don't add a second layer.

## Code Rules

- **500-line cap per source file** — split modules before they cross it.
- `res/vidlet-1.schema.json` and the spec section of `docs/vidlet-format.md` are vendored from the
  CC0 `.vidlet` format spec (https://vidlet.app/schema/vidlet-1.json) — update them only from the
  published spec, never fork the format locally.

## Release Process

Uses semantic-release on the `main` branch via GitHub Actions. Published to npm as `@spark-apps/vidlet`.
