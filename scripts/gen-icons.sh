#!/usr/bin/env bash
# Regenerate every raster icon from the SVG masters in src/icons/.
#
# The SVGs are the source of truth; nothing here should be hand-edited. Chrome
# does the rasterising (it is the only renderer on hand that gets the rounded
# stroke joins right at 16px), ImageMagick assembles the multi-size .ico.
#
# Output lands in res/ (a working directory, not shipped) - copy the sizes you
# need from there into src/icons, icons/, and the sibling web/desktop repos.
#
#   ./scripts/gen-icons.sh [outdir]     # default: res/icons
#
# Requires: google-chrome (or chromium-browser) and ImageMagick 7 (`magick`).
set -euo pipefail

cd "$(dirname "$0")/.."
ICONS=src/icons
OUT="${1:-res/icons}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CHROME="$(command -v google-chrome || command -v chromium-browser || true)"
[ -n "$CHROME" ] || { echo "need google-chrome or chromium-browser" >&2; exit 1; }
command -v magick >/dev/null || { echo "need ImageMagick 7 (magick)" >&2; exit 1; }

# Rasterise <svg> at <size>px square, transparent where the art is.
render() {
  local svg="$1" size="$2" out="$3"
  { echo '<!doctype html><meta charset="utf-8"><style>'
    echo 'html,body{margin:0;padding:0;background:transparent}'
    echo 'svg{display:block;width:100vw;height:100vh}</style>'
    cat "$svg"
  } > "$TMP/page.html"
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$size,$size" --screenshot="$out" "$TMP/page.html" 2>/dev/null
}

mkdir -p "$OUT"

# App icon: rendered at every target size rather than downscaled, so the small
# ones keep their edges.
for s in 16 24 32 48 64 128 180 192 256 512 1024; do
  render "$ICONS/vidlet.svg" "$s" "$OUT/vidlet-$s.png"
done

render "$ICONS/vidlet-maskable.svg" 512 "$OUT/vidlet-maskable-512.png"
render "$ICONS/vidlet-mark.svg" 512 "$OUT/vidlet-mark-512.png"
render "$ICONS/vidlet-mark.svg" 1024 "$OUT/vidlet-mark-1024.png"

# Windows wants one .ico carrying every size Explorer might ask for. Pillow
# rather than ImageMagick: it PNG-compresses the big frames, which is the
# difference between a 100KB icon and a 370KB one.
python3 - "$OUT" <<'PY'
import sys
from PIL import Image

out = sys.argv[1]
sizes = [256, 128, 64, 48, 32, 24, 16]
# Largest first: Pillow drops any requested size bigger than the base image.
frames = [Image.open(f"{out}/vidlet-{s}.png").convert("RGBA") for s in sizes]
frames[0].save(
    f"{out}/vidlet.ico",
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=frames[1:],
)
PY

echo "wrote $(ls "$OUT" | wc -l) files to $OUT"
