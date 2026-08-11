# VidLet

Free auto-captions + auto-jump-cuts + 16 video tools. Runs locally. No subscription. No cloud.

[![npm](https://img.shields.io/npm/v/@spark-apps/vidlet)](https://www.npmjs.com/package/@spark-apps/vidlet)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

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

Turn a script into narration. Default engine is Microsoft Edge neural TTS — free, no API key, 14 languages. Pass a ~10 second recording of yourself and VidLet clones your voice locally with [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT, beats ElevenLabs in blind tests) — or with [dots.tts](https://github.com/rednote-hilab/dots.tts) (Apache-2.0, watermark-free, best speaker similarity, wants an NVIDIA GPU).

```bash
vidlet voiceover script.txt                        # free neural TTS (Edge)
vidlet voiceover "Quick line of narration" -l es   # literal text, Spanish
vidlet voiceover script.txt -m                     # male voice
vidlet voiceover script.txt --clone me.wav         # YOUR voice (local, one-time ~3GB setup)
vidlet voiceover script.txt --clone me.wav --clone-engine dots   # best-quality clone (GPU)
vidlet voiceover script.txt --video raw.mp4        # mix over video, auto-ducks its audio
```

Narration is loudness-normalized to -16 LUFS. Chatterbox runs on CPU (slow, fine for short scripts) or CUDA automatically; dots.tts auto-transcribes your sample with whisper for maximum similarity. Everything stays on your machine.

## AI Demo — For People Who Hate Editing (and Microphones)

Record your screen. That's it — that's your whole job. `vidlet demo` trims the idle spans (motion-based, no audio needed), an AI **watches** keyframes and writes the narration itself, a natural TTS voice speaks it (or your cloned voice), and you get **both** the full 16:9 demo and a 9:16 Short with captions.

```bash
vidlet demo recording.mp4                          # fully automatic
vidlet demo recording.mp4 -a "Bottled, email for indie makers"   # sharper script
vidlet demo recording.mp4 --clone me.wav -c -p     # your voice + captions + post copy
vidlet demo recording.mp4 --no-short               # full video only
```

The generated script lands in `*.script.txt` — edit a line and re-voice without re-rendering: `vidlet voiceover script.txt --video demo.mp4`. Renders use your NVIDIA GPU automatically when available.

## AI Short — Full Video to YouTube Short, One Command

Point it at any talking video or screen recording. VidLet transcribes it locally (whisper.cpp), asks Groq AI to pick the most engaging moments, stitches them into a ≤60s 9:16 Short, and the crop follows the on-screen action/cursor automatically via motion tracking.

```bash
export GROQ_API_KEY=gsk_...        # free key: console.groq.com/keys
vidlet short demo.mp4               # highlights → 9:16 short
vidlet short demo.mp4 -c            # + hormozi captions burned in
vidlet short demo.mp4 -d 30         # tighter 30s cut
vidlet short demo.mp4 -c -p         # + title/description/hashtags sidecar
vidlet short talk.mp4 -n 3          # 3 DISTINCT shorts, virality-scored filenames
```

Every run writes a `*.segments.json` next to the output — edit any clip's `startTime`/`endTime`/`cropX` (0 = left edge, 1 = right edge) and re-render instantly without re-running the AI:

```bash
vidlet short demo.mp4 --from-segments VidLet/demo_short.mp4.segments.json
```

Only the highlight picking touches an API (Groq free tier); transcription, motion tracking and rendering are all local.

## The `.vidlet` Project Format — Edit as Text, Render Natively

A `.vidlet` file is a plain-JSON layered edit — main video track, overlays, voice/music/sfx, subtitles — that references media by relative path + sha256 instead of embedding it. The format is an open **CC0** spec ([docs/vidlet-format.md](docs/vidlet-format.md), schema vendored at `res/vidlet-1.schema.json`), so it diffs in git and any human or AI agent can edit it as text. The same file opens in the [vidlet.app](https://vidlet.app/app) browser editor.

```bash
vidlet render project.vidlet                # full render (NVENC when available)
vidlet render project.vidlet --draft        # fast preview: ultrafast x264, ≤720p
vidlet render project.vidlet --resolution 720p -o out.mp4
```

The renderer cuts the main track (gaps become the background color), composites overlays (free position/scale/opacity or full-frame cover cutaways, looped or last-frame-held), burns the subtitle block, and mixes audio — narration clips with `ducking: true` sidechain-compress everything else.

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
| Open source | AGPL-3.0 | No | No | No |

## All Tools

```
vidlet <file>                    # GUI with everything
vidlet caption <file>            # auto-transcribe + styled captions
vidlet jumpcut <file>            # auto-edit: cut silence + zoom
vidlet voiceover <script>        # narration: free TTS or clone your voice
vidlet short <file>              # AI highlights → 9:16 Short, crop follows action
vidlet render <project.vidlet>   # render a .vidlet project (open CC0 format)
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

**23 tools.** Every write tool defaults to a `VidLet/` subfolder beside the source, never overwrites an existing file (numbered `-1`, `-2`, ... on collision), and returns the output `name`, a clickable `url`, `elapsedSeconds` and a `thumbnail`. No delete or move tools, by design.

### Make a Short from whatever you have

`generate_short` is the one that does everything. Attach recordings (plus optionally an `.srt`/`.vtt`, a `.txt` script, or a music file) and ask:

> Generate a YouTube Short from these two screen recordings.

It denoises voiced clips, cuts dead air, drops duplicate retakes, stitches, computes the speed needed to land under 59s, matches contrast across clips, frames 9:16, writes and speaks the narration, burns karaoke captions and mixes a ducked music bed.

It asks before it renders, rather than guessing. When something is yours to decide it returns a `questions` array instead of encoding anything, so a decision costs seconds and not a render:

1. **Music** — which bed, with audible previews
2. **Narration** — what the footage shows, when there is no voice on it
3. **Script** — the written narration, for approval before it is spoken

```jsonc
// First call: returns questions, renders nothing (~10s)
{ "paths": ["modelling.mp4", "rigging.mp4"] }

// Final call: renders (~25s)
{
  "paths": ["modelling.mp4", "rigging.mp4"],
  "intro": "logo.gif",          // plays at natural speed, not swept into the timelapse
  "music": "lofi",
  "voiceover": "tts",
  "title": "duck-rig",          // becomes duck-rig.mp4
  "final_script": "First we block out the shape.\n---\nThen the armature goes in."
}
```

**Pin narration to a clip with `---`.** Lines before the marker are spoken over the first video, lines after it over the second. Without it, lines are spread in proportion to how long each clip runs, which is a guess: a script saying "then I rig it" can start while modelling footage is still on screen. The marker is exact and costs nothing.

### Pick the music by ear

> Let me hear the background music options first.

`preview_music` renders short loudness-matched samples of each bundled CC0 bed and returns a `url` per mood, so a bed is chosen by ear rather than by label.

### Change your mind cheaply

> Swap the music for something calmer.

`add_music` scores an **already rendered** video with `-c:v copy`. Around 1.4 seconds, and the video packets come out bit-identical, so changing the bed does not mean redoing the cut, grade, narration and captions.

```jsonc
{ "path": "duck-rig.mp4", "music": "calm", "volume": 0.12 }
```

### Hide anything sensitive

> Check that recording for anything I should not be publishing.

`mask_sensitive` finds card numbers (Luhn-validated, so a sequential `1234 5678 9012 3456` is ignored), emails, phone numbers, IBANs, SSNs, API keys, street addresses and postcodes, then covers them with a pixel mosaic. It runs automatically inside `generate_short`.

```jsonc
{ "path": "recording.mp4", "dry_run": true }   // list what WOULD be covered
{ "path": "recording.mp4", "regions": [{ "x": 60, "y": 900, "width": 420, "height": 90 }] }
```

Detection needs `tesseract` (`sudo apt install tesseract-ocr`). Without it the tool says so explicitly rather than quietly masking nothing; `regions` works either way.

### Timelapse a long recording

> Turn this 40-minute recording into a 15x timelapse.

`create_timelapse_short` is the no-questions version: cut idle, speed up, 9:16, progress bar and a clock showing the real elapsed time of the original.

```jsonc
{ "path": "session.mp4", "speed": 15, "music": "none" }
```

### The rest

`list_capabilities`, `probe_video` (read-only), `generate_captions`, `auto_jump_cut`, `speed_up_video`, `trim_video`, `compress_video`, `extract_audio`, `convert_to_gif`, `setup_recording`, `generate_voiceover`, `create_short`, `create_demo`, plus the `.vidlet` project suite: `create_project` (builds a project from an `.srt`/`.vtt`, script, or QuickPeek-style JSON plan), `validate_project`, `render_project`, `open_in_editor` and `add_voiceover_to_project`.

### What runs where

Everything heavy is local: ffmpeg, whisper.cpp, RNNoise, tesseract, and the bundled music. Edge TTS is a free keyless endpoint. The only paid-capable call is one small Groq chat per render, to rewrite the narration, and it degrades to the raw script without a key.

Speech recognition is used only on audio that was actually **recorded** — deciding whether footage has a voice, and de-duplicating retakes. Captions for synthesised narration are timed from the script itself, since the words and each line's measured duration are already known.

## Support

Star the repo, report bugs, or open a PR: [github.com/muammar-yacoob/VidLet](https://github.com/muammar-yacoob/VidLet)

## License

AGPL-3.0 — [sparkbrain.app](https://sparkbrain.app)
