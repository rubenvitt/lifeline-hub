#!/usr/bin/env bash
# karten-build/gen-assets.sh — einmalige, schema-fixe Offline-Assets nach ../assets/karten.
#
# ACHTUNG — ENTWURF (LFH-197): Die unten genutzten Image-/Tool-Referenzen sind NOCH NICHT
# verifiziert (im Gegensatz zum Tile-Build in der Makefile, der das bestätigte
# versatiles/versatiles-planetiler-Image nutzt). Auf dem Build-Host finalisieren:
#   - Glyphs (OFL): bevorzugt die VersaTiles-Fonts-Release-Artefakte (Shortbread-passend,
#     fontstack u.a. "Noto Sans Regular") statt selbst zu bauen.
#   - Sprite (CC0): das Sprite-Release aus versatiles-style (basemap.{json,png} + @2x).
# Erst danach die Placeholder unter ../assets/karten/{fonts,sprites} durch die echten Dateien
# ersetzen, einchecken und das Backend neu bauen (rust-embed bettet zur Compile-Zeit ein).
set -euo pipefail
DEST="${1:-../assets/karten}"
mkdir -p "$DEST/fonts" "$DEST/sprites"

echo "TODO (LFH-197): echte Glyphs/Sprite beziehen — siehe Kommentar oben. Aktuell nur Placeholder."
echo "Ziel-Layout:"
echo "  $DEST/fonts/<fontstack>/{0-255,...}.pbf   (SDF-Glyphs, OFL)"
echo "  $DEST/sprites/basemap.{json,png} (+ @2x)  (CC0-Sprite)"
