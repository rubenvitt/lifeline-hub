#!/usr/bin/env bash
# App-Symbol der iOS-Hülle aus der Bildmarke erzeugen (LLH-1978, Spec `app-marke`, „iOS-Symbol aus
# der Bildmarke“).
#
#   scripts/ios/erzeuge-symbol.sh
#
# Quelle ist dieselbe eckige, vollflächige Bildmarke wie Favicon und PWA (`scripts/marke/symbol.svg`,
# Grund Kopf-Schwarz). iOS verlangt ein Symbol von 1024 × 1024 px ohne Transparenz und rundet die
# Ecken selbst. Gerendert mit `rsvg-convert`, die Transparenz entfernt ImageMagick (`magick` oder
# `convert`) auf Kopf-Schwarz; Metadaten mit Zeitstempel fallen weg, damit ein neuer Lauf bei
# gleicher Quelle dieselbe Datei ergibt. Ergebnis und Stempel werden eingecheckt;
# frontend/src/marke/marke.guard.test.ts prüft Größe, Farbtyp, Eckfarbe und den Stempel
# `scripts/ios/symbol.sha256`. `scripts/marke/erzeuge-symbole.sh` ruft dieses Skript am Ende auf.
set -euo pipefail

wurzel="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
quelle="$wurzel/scripts/marke/symbol.svg"
ziel="$wurzel/ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
KOPF_SCHWARZ="#0c0e11"

command -v rsvg-convert > /dev/null || { echo "rsvg-convert fehlt (librsvg)" >&2; exit 2; }
if command -v magick > /dev/null; then
  im=(magick)
elif command -v convert > /dev/null; then
  im=(convert)
else
  echo "ImageMagick fehlt (magick oder convert)" >&2
  exit 2
fi

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT
rsvg-convert --width 1024 --height 1024 --background-color "$KOPF_SCHWARZ" \
  --output "$arbeit/roh.png" "$quelle"
"${im[@]}" "$arbeit/roh.png" -background "$KOPF_SCHWARZ" -alpha remove -alpha off -strip \
  -define png:exclude-chunks=date,time,tIME "PNG24:$arbeit/symbol.png"
mkdir -p "$(dirname "$ziel")"
cp "$arbeit/symbol.png" "$ziel"

(cd "$wurzel/scripts/marke" && shasum -a 256 symbol.svg 2> /dev/null || sha256sum symbol.svg) \
  > "$wurzel/scripts/ios/symbol.sha256"
echo "iOS-Symbol erzeugt: $ziel"
