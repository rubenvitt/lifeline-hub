#!/usr/bin/env bash
# karten-build/gen-assets.sh — einmalige, schema-fixe Offline-Assets (in ../assets/karten eingecheckt).
set -euo pipefail
DEST="${1:-../assets/karten}"
mkdir -p "$DEST/fonts" "$DEST/sprites"

# Glyphs: OFL-Fonts (Noto Sans/Open Sans) → {fontstack}/{range}.pbf (0-255 … 65280-65535)
docker run --rm -v "$PWD/glyph-src:/in" -v "$PWD/$DEST/fonts:/out" \
  ghcr.io/maplibre/font-maker generate /in /out

# Sprite: CC0-Icons → sprite.png/.json (+@2x)
docker run --rm -v "$PWD/icon-src:/in" -v "$PWD/$DEST/sprites:/out" \
  ghcr.io/flother/spreet /in /out/basemap
docker run --rm -v "$PWD/icon-src:/in" -v "$PWD/$DEST/sprites:/out" \
  ghcr.io/flother/spreet --retina /in /out/basemap@2x
echo "Assets in $DEST erzeugt."
