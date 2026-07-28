> Vendored from the CC0 .vidlet format spec
> (https://vidlet.app/schema/vidlet-1.json). The JSON Schema copy lives at
> `res/vidlet-1.schema.json`; the zod implementation is
> `src/lib/vidlet-project.ts`.

# The `.vidlet` project format — v1

> This specification and the accompanying JSON Schema
> (`/schema/vidlet-1.json`, published at `https://vidlet.app/schema/vidlet-1.json`)
> are dedicated to the public domain under **CC0 1.0**. Anyone may implement
> readers, writers or renderers for this format without restriction.

A `.vidlet` file is a **plain UTF-8 JSON document** describing a layered
video edit. It references media files by name — media bytes are never
embedded — so the file stays small, diffs in git, and can be read or edited
as text by humans and AI agents alike.

## Top-level shape

```jsonc
{
  "vidlet": 1,                              // format version (integer)
  "meta": {
    "title": "Untitled project",
    "createdAt": "2026-07-28T10:00:00Z",    // ISO 8601
    "modifiedAt": "2026-07-28T10:30:00Z",
    "generator": "vidlet-web/1.0"           // writer id, informational
  },
  "settings": {
    "width": 1920, "height": 1080,          // output canvas, pixels
    "fps": 30,
    "background": "#000000"                 // fill for gaps / letterboxing
  },
  "media": [
    { "id": "m1", "kind": "video", "name": "recording.webm",
      "bytes": 48211903, "duration": 93.4,
      "sha256": "ab3f…",                    // optional, full-file hex digest
      "path": "media/recording.webm" }      // optional, relative to this file
  ],
  "tracks": {
    "video":   [ /* VideoClip[]   — the main track, hard-cut sequence */ ],
    "overlay": [ /* OverlayClip[] — gifs, clips, images over the main */ ],
    "voice":   [ /* AudioClip[]   — narration; can duck other audio   */ ],
    "music":   [ /* AudioClip[]   — background music                  */ ],
    "sfx":     [ /* AudioClip[]   — sound effects                     */ ]
  },
  "subtitles": {
    "style": { "fontFamily": "Arial", "fontSize": 28, "color": "#FFFFFF",
               "position": "bottom", "outline": true },
    "entries": [ { "id": "s1", "start": 0.4, "end": 2.1, "text": "Hey!" } ]
  }
}
```

## Timing convention

Every clip uses the same three numbers, all in **seconds**:

| Field      | Meaning                                    | Default |
|------------|--------------------------------------------|---------|
| `start`    | position on the project timeline           | —       |
| `sourceIn` | offset into the source media               | `0`     |
| `duration` | length on the timeline                     | —       |

There is no `sourceOut` and no per-clip speed in v1 — the source range is
always `[sourceIn, sourceIn + duration]`.

**Project duration** = the maximum `start + duration` (or subtitle `end`)
across all tracks. Gaps on the main video track show `settings.background`.

## Clip fields

**VideoClip** (main track): `id`, `mediaId`, `start`, `sourceIn`,
`duration`, `gain` (linear multiplier on the clip's own audio, default `1`),
`muted` (default `false`). Main-track clips render full-frame,
aspect-fit onto the canvas.

**OverlayClip**: adds `x`, `y` (top-left corner as fractions of canvas
width/height, defaults `0`), `scale` (overlay width as a fraction of canvas
width, default `0.3`), `opacity` (default `1`), `loop` (default `false`),
`fit`: `"free"` (positioned by x/y/scale) or `"cover"` (full-frame cutaway,
scale-to-cover + center-crop; x/y/scale ignored). Overlays render in array
order — later entries on top.

**AudioClip** (voice/music/sfx): adds `gain` (default `1`), `fadeIn`,
`fadeOut` (seconds, default `0`), `loop` (music/sfx only, default `false`),
`ducking` (voice only, default `true`): while a ducking voice clip has
signal, all other audio (main-clip audio, music, sfx) is sidechain-
compressed under it.

**Loop semantics** (overlay video/gif and audio): `loop: true` with media
shorter than `duration` tiles the media; `loop: false` holds the last frame
(video) or goes silent (audio).

**Subtitles**: one global `style` (`position` is `"top" | "center" |
"bottom"`; `outline` draws a dark border) and flat, non-overlapping
`entries`. Renderers burn them last, above every video layer.

## Media matching (relink)

Media entries carry `name` + `bytes` (size) and optionally `sha256` and
`path`:

1. If both sides have `sha256`, it is **authoritative** — match or refuse.
2. Otherwise match on `name` **and** `bytes`; a mismatch means "ask the
   user to relink".
3. `path` is relative to the `.vidlet` file. CLI/desktop implementations
   read and write it; browser implementations ignore it on load (browsers
   have no real paths) but **must preserve it on save** so a project
   round-trips between environments.

Browsers may omit `sha256` for large files (no streaming digest in
WebCrypto); native implementations should always write it.

## Versioning & forward compatibility

1. `vidlet` is an integer, bumped **only on breaking changes**. New
   capabilities within a version are new *optional* fields with defined
   defaults.
2. Readers MUST ignore fields they don't understand and MUST refuse files
   whose `vidlet` is greater than the version they support (with a clear
   "made by a newer Vidlet" message).
3. Editors — human, AI or code — SHOULD preserve fields they don't
   understand when rewriting a file.

## Deliberately out of scope in v1

Keyframes, transitions/crossfades, per-clip speed, effect graphs, arbitrary
track counts, nested sequences, per-entry subtitle styling. Each can arrive
later as an optional field without a version bump.
