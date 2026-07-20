# VidLet

Free auto-captions + auto-jump-cuts + 16 video tools. Runs locally. No subscription. No cloud.

[![npm](https://img.shields.io/npm/v/@spark-apps/vidlet)](https://www.npmjs.com/package/@spark-apps/vidlet)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

```bash
npm i -g @spark-apps/vidlet    # adds Windows right-click menu automatically
```

## Auto-Captions

Transcribes your video locally with [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and burns styled captions in. No API key needed.

```bash
vidlet caption video.mp4                          # hormozi style (default)
vidlet caption video.mp4 -s karaoke -c cyan       # karaoke fill, cyan
vidlet caption video.mp4 -s classic --srt mine.srt # your own subtitles
vidlet caption video.mp4 -g                        # open GUI
```

## Jump Cuts — Auto-Edit Like a Pro

Cut all dead air and add alternating punch-in zoom — the editing style behind every fast-paced YouTube video.

```bash
vidlet jumpcut video.mp4                        # normal pace, 3% zoom
vidlet jumpcut video.mp4 --pace tight           # aggressive cuts
vidlet jumpcut video.mp4 --pace loose --zoom 0  # gentle, no zoom
```

**Pace:** `tight` (podcast/vlog) · `normal` (default) · `loose` (interview)
**Zoom:** `0` (off) to `8` (dramatic punch-in)

**Styles:** `hormozi` (word-by-word color pop) · `karaoke` (smooth fill) · `classic` (white + outline) · `minimal` (small, boxed)
**Colors:** `yellow` · `cyan` · `red` · `green` · `white`
**Models:** `tiny.en` (fast) · `base.en` (default) · `small.en` (accurate)

## Voiceover — Free TTS or Clone Your Own Voice

Turn a script into narration. Default engine is Microsoft Edge neural TTS — free, no API key, 14 languages. Pass a ~10 second recording of yourself and VidLet clones your voice locally with [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT, beats ElevenLabs in blind tests).

```bash
vidlet voiceover script.txt                        # free neural TTS (Edge)
vidlet voiceover "Quick line of narration" -l es   # literal text, Spanish
vidlet voiceover script.txt -m                     # male voice
vidlet voiceover script.txt --clone me.wav         # YOUR voice (local, one-time ~3GB setup)
vidlet voiceover script.txt --video raw.mp4        # mix over video, auto-ducks its audio
```

Narration is loudness-normalized to -16 LUFS. Cloning runs on CPU (slow, fine for short scripts) or CUDA automatically. Everything stays on your machine.

## AI Short — Full Video to YouTube Short, One Command

Point it at any talking video or screen recording. VidLet transcribes it locally (whisper.cpp), asks Groq AI to pick the most engaging moments, stitches them into a ≤60s 9:16 Short, and the crop follows the on-screen action/cursor automatically via motion tracking.

```bash
export GROQ_API_KEY=gsk_...        # free key: console.groq.com/keys
vidlet short demo.mp4               # highlights → 9:16 short
vidlet short demo.mp4 -c            # + hormozi captions burned in
vidlet short demo.mp4 -d 30         # tighter 30s cut
```

Every run writes a `*.segments.json` next to the output — edit any clip's `startTime`/`endTime`/`cropX` (0 = left edge, 1 = right edge) and re-render instantly without re-running the AI:

```bash
vidlet short demo.mp4 --from-segments VidLet/demo_short.mp4.segments.json
```

Only the highlight picking touches an API (Groq free tier); transcription, motion tracking and rendering are all local.

## Produce a Video End to End

Script → voiceover → edit → captions → publish, all local:

```bash
vidlet voiceover script.txt --clone me.wav --video screen-recording.mp4
                                    # 1. narration in your voice, ducked over footage
vidlet jumpcut VidLet/screen-recording_voiceover.mp4
                                    # 2. cut dead air + punch-in zooms
vidlet caption VidLet/..._jumpcut.mp4 -s hormozi
                                    # 3. styled auto-captions
vidlet portrait VidLet/..._captioned.mp4
                                    # 4. 9:16 for Shorts/Reels/TikTok
vidlet compress VidLet/..._portrait.mp4
                                    # 5. final size for upload
```

Or record a talking-head take instead and start with `vidlet autocleanup` (denoise + silence-cut + compress) before captions.

### vs. Paid Tools

| | **VidLet** | CapCut Pro | Descript | Opus Clip |
|---|---|---|---|---|
| Auto-captions | Yes | Yes | Yes | Yes |
| **Price** | **Free** | $10/mo | $24/mo | $20/mo |
| **Runs locally** | **Yes** | No | No | No |
| CLI / batch | Yes | No | No | No |
| Open source | MIT | No | No | No |

## All Tools

```
vidlet <file>                    # GUI with everything
vidlet caption <file>            # auto-transcribe + styled captions
vidlet jumpcut <file>            # auto-edit: cut silence + zoom
vidlet voiceover <script>        # narration: free TTS or clone your voice
vidlet short <file>              # AI highlights → 9:16 Short, crop follows action
vidlet autocleanup <file>        # denoise + remove silence + compress
vidlet compress <file>           # H.264/HEVC compression
vidlet cleanvoice <file>         # neural voice denoising
vidlet removesilence <file>      # cut dead air
vidlet togif <file>              # optimized GIF
vidlet shrink <file>             # speed up for Shorts (< 60s)
vidlet extractaudio <file>       # pull audio track
vidlet mkv2mp4 <file>            # container conversion
vidlet thumb <file>              # set thumbnail
vidlet loop <file>               # seamless loop via frame matching
vidlet optimize <file>           # compress Lottie/GIF
```

Every command supports `-g` (GUI) and `-y` (skip prompts, use defaults).

## Requirements

WSL + Node 18+ + FFmpeg (`sudo apt install ffmpeg`). whisper.cpp auto-downloads on first caption use.

## Windows Context Menu

```bash
vidlet install     # adds VidLet to the right-click menu (registry import, needs Admin)
vidlet uninstall    # removes it
```

## Configuration

Config location: `~/.config/vidlet/config.json`

```bash
vidlet config show   # view current config
vidlet config reset  # reset to defaults
vidlet config path   # show config file path
```

## Development

```bash
git clone https://github.com/muammar-yacoob/VidLet.git
cd VidLet
npm install

npm run build      # build
npm run check      # lint & format
npm run typecheck  # type check

node dist/cli.js --help   # test locally
```

## MCP Server

VidLet ships an MCP server (`vidlet-mcp`) so an AI agent can call the tools directly, no shelling out to the CLI.

```json
{
  "mcpServers": {
    "vidlet": {
      "command": "npx",
      "args": ["-y", "--package=@spark-apps/vidlet", "vidlet-mcp"]
    }
  }
}
```

Tools: `list_capabilities`, `probe_video` (read-only), `generate_captions`, `auto_jump_cut`, `trim_video`, `compress_video`, `extract_audio`, `convert_to_gif`, `generate_voiceover`, `create_short`. Every write tool defaults to a `VidLet/` subfolder beside the source and never overwrites an existing file (numbered `-1`, `-2`, ... on collision). No delete or move tools, by design.

## Support

Star the repo, report bugs, or open a PR: [github.com/muammar-yacoob/VidLet](https://github.com/muammar-yacoob/VidLet)

## License

MIT — [sparkbrain.app](https://sparkbrain.app)
