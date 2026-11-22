#!/usr/bin/env bash
# App-Symbol der Android-Hülle aus der Bildmarke erzeugen (LLH-1989, Entwurf D11 „Marke“, Spec
# `app-marke`).
#
#   scripts/android/erzeuge-symbol.sh
#
# Android zeigt ein adaptives Symbol (ab API 26, die App verlangt 29): Hintergrund und Vordergrund
# getrennt, die Form der Maske wählt der Launcher. Der Hintergrund ist die Farbe Kopf-Schwarz
# (`@color/kopf_schwarz` in `res/values/colors.xml`), der Vordergrund die Marke aus derselben
# eckigen Quelle wie Favicon, PWA und iOS (`scripts/marke/symbol.svg`) ohne deren Grund,
# verkleinert in den sicheren Kreis: 66 dp Durchmesser auf der Ebene von 108 dp. Das Skript
# leitet die Vordergrund-Quelle aus `symbol.svg` ab (Grund weg, Maßstab `SKALA`) und rendert sie
# für xxxhdpi (108 dp × 4 = 432 px); kleinere Dichten rechnet Android herunter.
#
# Gerendert mit `rsvg-convert`, Metadaten mit Zeitstempel entfernt ImageMagick (`magick` oder
# `convert`), damit ein neuer Lauf bei gleicher Quelle dieselbe Datei ergibt. Ergebnisse und
# Stempel werden eingecheckt; frontend/src/marke/marke.guard.test.ts prüft Größe, Transparenz,
# den sicheren Kreis, die Hintergrundfarbe und den Stempel `scripts/android/symbol.sha256`.
# `scripts/marke/erzeuge-symbole.sh` ruft dieses Skript am Ende auf.
set -euo pipefail

wurzel="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
quelle="$wurzel/scripts/marke/symbol.svg"
res="$wurzel/android/app/src/main/res"
KOPF_SCHWARZ="#0c0e11"
# Die Ecken des Rahmens um die Marke (±198, ±189 um die Mitte, MARKE_RAHMEN) liegen bei 0,56 auf
# 153 von 156,4 Einheiten Radius (66/108 der halben Kante 256): ganz im sicheren Kreis.
SKALA="0.56"
KANTE=432

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

# Vordergrund: ohne den vollflächigen Grund, die Marke im sicheren Kreis. Greift eine der beiden
# Ersetzungen nicht (Quelle umgebaut), bricht das Skript ab, statt ein falsches Symbol zu bauen.
grund="<rect width=\"512\" height=\"512\" fill=\"$KOPF_SCHWARZ\"/>"
grep -qF "$grund" "$quelle" || { echo "Grund in $quelle nicht gefunden" >&2; exit 1; }
grep -qF "scale(1)" "$quelle" || { echo "Maßstab in $quelle nicht gefunden" >&2; exit 1; }
sed -e "s#$grund##" -e "s#scale(1)#scale($SKALA)#" "$quelle" > "$arbeit/vordergrund.svg"

rsvg-convert --width "$KANTE" --height "$KANTE" --output "$arbeit/roh.png" "$arbeit/vordergrund.svg"
"${im[@]}" "$arbeit/roh.png" -strip -define png:exclude-chunks=date,time,tIME \
  "PNG32:$arbeit/vordergrund.png"
mkdir -p "$res/mipmap-xxxhdpi" "$res/mipmap-anydpi-v26"
cp "$arbeit/vordergrund.png" "$res/mipmap-xxxhdpi/ic_launcher_vordergrund.png"

cat > "$res/mipmap-anydpi-v26/ic_launcher.xml" << 'XML'
<?xml version="1.0" encoding="utf-8"?>
<!-- Erzeugt von scripts/android/erzeuge-symbol.sh aus der Bildmarke — nicht von Hand ändern. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/kopf_schwarz" />
    <foreground android:drawable="@mipmap/ic_launcher_vordergrund" />
</adaptive-icon>
XML

(cd "$wurzel/scripts/marke" && shasum -a 256 symbol.svg 2> /dev/null || sha256sum symbol.svg) \
  > "$wurzel/scripts/android/symbol.sha256"
echo "Android-Symbol erzeugt: $res/mipmap-anydpi-v26/ic_launcher.xml"
