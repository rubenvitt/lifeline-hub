#!/usr/bin/env bash
# karten-build/gen-assets.sh — einmalige, schema-fixe Offline-Assets nach ../assets/karten.
#
# Bezieht die echten Offline-Style-Assets aus reproduzierbaren, GEPINNTEN Upstream-Releases
# (kein Selbstbau, analog zum Tile-Build in der Makefile):
#   - Glyphs (OFL): SDF-Glyphs "Noto Sans Regular" aus dem versatiles-fonts-Release. Es werden
#     nur die für DE/europäisch-latein relevanten Unicode-Ranges übernommen (Latin, Latin-Ext-A/B,
#     General Punctuation) — der volle Fontstack (~36 MB, inkl. CJK) wäre für rust-embed zu groß.
#     Der Fontstack-Ordner wird auf "Noto Sans Regular" umbenannt (so verlangt es basemapStil.ts
#     und offline_fonts serviert pfad-basiert).
#   - Sprite (CC0): das "basics"-Icon-Set aus dem versatiles-style-Sprite-Release, umbenannt auf
#     basemap.{json,png} (+ @2x). Der aktuelle Offline-Style referenziert zwar noch keine
#     icon-image-Layer, aber ein echtes, gültiges CC0-Sprite ist Voraussetzung für die spätere
#     §9-Live-Demo-Stilwahl (POI-Icons).
#
# Nach dem Lauf die erzeugten Dateien unter ../assets/karten/{fonts,sprites} einchecken und das
# Backend neu bauen — rust-embed bettet sie zur Compile-Zeit ein (KartenAssets).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$SCRIPT_DIR/../assets/karten}"

# --- Gepinnte Quellen (bei Update: Tag anheben, Assets neu erzeugen, Provenienz notieren) ---
FONTS_REPO="versatiles-org/versatiles-fonts"
FONTS_TAG="v2.2.0"
FONTS_ASSET="noto_sans.tar.gz"       # enthält Fontstack-Ordner noto_sans_regular/ (+ _bold)
FONTS_STACK_SRC="noto_sans_regular"  # Quell-Ordnername im Archiv
FONTS_STACK_DEST="Noto Sans Regular" # von basemapStil.ts/text-font erwarteter Name

SPRITE_REPO="versatiles-org/versatiles-style"
SPRITE_TAG="v5.13.0"
SPRITE_ASSET="sprites.tar.gz"        # enthält basics/ + markers/ (sprites.{json,png} + @Nx)
SPRITE_SET="basics"                  # allgemeines CC0-Icon-Set

# DE/europäisch-latein relevante Glyph-Ranges (Rest wäre unnötiger Ballast im Binary):
#   0-255      Basic Latin + Latin-1 Supplement (A-Z a-z, äöüß, é à …)
#   256-511    Latin Extended-A (č ł ś ž ā, poln./sorb./türk. Namen)
#   512-767    Latin Extended-B
#   8192-8447  General Punctuation (En-/Em-Dash, typograf. Anführungszeichen in Namen)
FONT_RANGES=(0-255 256-511 512-767 8192-8447)

FONTS_URL="https://github.com/${FONTS_REPO}/releases/download/${FONTS_TAG}/${FONTS_ASSET}"
SPRITE_URL="https://github.com/${SPRITE_REPO}/releases/download/${SPRITE_TAG}/${SPRITE_ASSET}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Provenienz-Hash portabel (Linux: sha256sum, macOS: shasum) und UNKRITISCH — nur ein Info-Echo,
# darf den Asset-Lauf nie abbrechen, wenn kein Hash-Tool da ist.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo "(kein sha256-Tool)"; fi
}

echo "→ Lade Glyphs: $FONTS_URL"
curl -fsSL -o "$work/fonts.tar.gz" "$FONTS_URL"
echo "  sha256(fonts): $(sha256_of "$work/fonts.tar.gz")"

echo "→ Lade Sprite: $SPRITE_URL"
curl -fsSL -o "$work/sprites.tar.gz" "$SPRITE_URL"
echo "  sha256(sprite): $(sha256_of "$work/sprites.tar.gz")"

# --- Glyphs: kuratierte Ranges extrahieren + Fontstack umbenennen ---
font_dest="$DEST/fonts/$FONTS_STACK_DEST"
rm -rf "$font_dest"
mkdir -p "$font_dest"
for r in "${FONT_RANGES[@]}"; do
  tar xzf "$work/fonts.tar.gz" -C "$work" "$FONTS_STACK_SRC/$r.pbf"
  mv "$work/$FONTS_STACK_SRC/$r.pbf" "$font_dest/$r.pbf"
  echo "  glyph: $FONTS_STACK_DEST/$r.pbf ($(wc -c < "$font_dest/$r.pbf") Bytes)"
done

# --- Sprite: basics-Set als basemap.{json,png} (+ @2x) ---
sprite_dest="$DEST/sprites"
mkdir -p "$sprite_dest"
tar xzf "$work/sprites.tar.gz" -C "$work" \
  "$SPRITE_SET/sprites.json" "$SPRITE_SET/sprites.png" \
  "$SPRITE_SET/sprites@2x.json" "$SPRITE_SET/sprites@2x.png"
cp "$work/$SPRITE_SET/sprites.json"     "$sprite_dest/basemap.json"
cp "$work/$SPRITE_SET/sprites.png"      "$sprite_dest/basemap.png"
cp "$work/$SPRITE_SET/sprites@2x.json"  "$sprite_dest/basemap@2x.json"
cp "$work/$SPRITE_SET/sprites@2x.png"   "$sprite_dest/basemap@2x.png"
echo "  sprite: basemap.png ($(wc -c < "$sprite_dest/basemap.png") Bytes), +@2x"

cat <<EOF

Fertig. Provenienz für den Release-Text / Commit festhalten:
  Glyphs: $FONTS_REPO $FONTS_TAG ($FONTS_ASSET → $FONTS_STACK_DEST, Ranges: ${FONT_RANGES[*]}) — OFL (SIL Open Font License)
  Sprite: $SPRITE_REPO $SPRITE_TAG ($SPRITE_ASSET, Set: $SPRITE_SET → basemap) — CC0
Dateien unter $DEST/{fonts,sprites} einchecken + Backend neu bauen (rust-embed).
EOF
