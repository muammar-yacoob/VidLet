# VidLet Roadmap — toward a full AI video editing + recording suite

Where VidLet already is: record-agnostic editing (captions, jump cuts, denoise),
AI Shorts (highlight picking + action-tracking crop), voiceover with local
voice cloning, MCP server for agent-driven editing, plus the browser app
(vidlet.app) with in-browser recording and the same AI Short pipeline.

Shipped since first draft: `vidlet demo` (the quiet-creator pipeline: silent
recording → idle-trim → AI-written narration → TTS → full video + Short) and
NVENC GPU encoding with automatic fallback.

Note on vision: keyframe understanding uses whichever multimodal model the
Groq org has enabled (see VISION_CANDIDATES in src/tools/demo.ts) and degrades
gracefully to --about-only scripting. Web-app demo parity waits on the same.

Prioritized next steps (impact ÷ effort, top first):

## Near term (each ≤ a day)
1. **Batch Shorts (`vidlet short -n 3`)** — one long video → several distinct
   Shorts. The LLM already sees the whole transcript; ask for N non-overlapping
   clip groups and loop the existing renderer. This is Opus Clip's entire
   $20/mo product.
2. **Virality score per clip** — have the highlight prompt also return a 0-100
   hook-strength score; name files `short-1-score87.mp4` so the best one is
   obvious. Zero extra API calls.
3. **B-roll aware jump cuts** — jumpcut currently zooms on every segment;
   alternate zoom targets using the motion centroid (already computed in
   lib/motion.ts) so punch-ins land where the action is.
4. **`vidlet resize`** — one command for all platform aspect ratios
   (9:16, 1:1, 4:5, 16:9) reusing the portrait crop path.
5. **Web: per-clip crop preview** — after AI Short picks clips, show them on
   the timeline with draggable crop handles (the sidecar-edit flow, but visual).

## Medium term
6. **Auto B-roll / screenshot insertion** — detect long static talking spans
   (motion tracker returns null) and offer cutaways from a folder of stills.
7. **Silence-aware background music** — port the web app's music-with-ducking
   into the CLI voiceover (needs a small bundled/CC music set).
8. **Multi-speaker diarization** — whisper.cpp tinydiarize or pyannote in the
   Chatterbox venv; enables per-speaker caption colors and speaker-aware crops.
9. **`vidlet record`** — native screen/webcam capture. On Windows the clean
   path is a tiny helper invoking ffmpeg gdigrab/dshow from the Windows side
   (WSL cannot see the desktop); the browser recorder covers this today.
10. **dots.tts side-by-side** — trial the Apache-2.0, watermark-free cloner
    against Chatterbox on the owner's voice sample; swap if it wins.

## Long term / product bets
11. **Template packs** — hook text overlays, progress bars, end cards as
    ffmpeg drawtext/overlay presets (`--template hormozi`).
12. **Auto-chaptering + YouTube description timestamps** from the transcript.
13. **Direct publish** — pipe finished Shorts into ViralCat's scheduler via its
    MCP (`create_draft`), closing the record → edit → post loop end to end.
14. **Eye-contact / face-tracking crop** — swap the pixel-diff centroid for a
    lightweight face detector when a webcam face is present (talking-head
    Shorts should track the face, not the cursor).

Rejected for now: cloud rendering (against the local-first promise), Electron
app (the CLI + web pair covers it), speech-to-speech dubbing (license/VRAM
heavy — revisit when a permissive model lands).
