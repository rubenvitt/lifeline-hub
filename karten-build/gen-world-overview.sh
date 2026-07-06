#!/usr/bin/env bash
# gen-world-overview.sh — erzeugt die OPTIONALE, eingebettete Welt-Übersicht (Low-Zoom-Basis, LFH-207).
#
# Ergebnis: `../assets/karten/welt/welt-uebersicht.mbtiles` — eine kleine, grob aufgelöste Welt
# (Shortbread, z2–MAXZOOM). Ist sie eingecheckt, bettet rust-embed sie ins Backend-Binary ein
# (`KartenAssets`, src/karte/assets.rs) und die Lagekarte zeichnet sie IMMER offline als unterste
# Basis-Ebene — Regional-Packs (z2–14) legen sich mit Straßendetail darüber. Fehlt sie, ist die App
# voll funktionsfähig, nur ohne globale Basis.
#
# WARUM STRIPPEN statt selbst bauen: Das `versatiles/versatiles-planetiler`-Image (karten-build) kennt
# KEINEN --maxzoom, und ein Voll-Planet-Selbstbau wäre ~300 GB Arbeitsplatte / Stunden. Deshalb: aus
# einer FERTIGEN Planet-Shortbread-MBTiles die hohen Zoomstufen strippen (klein + schnell).
#
# Quelle (SRC): eine Planet-weite Shortbread-MBTiles. Bezugswege (Operator-Entscheidung, Provenienz
# im Commit festhalten — gleiches Ökosystem wie unser Bau-Image/Fonts):
#   - ein versatiles-Planet-Download (Shortbread) → nach .mbtiles konvertiert, ODER
#   - ein einmaliger `make tiles AREA=planet` auf einer großen Maschine (dann ist SRC dessen Ergebnis).
#
# Nutzung:
#   SRC=/pfad/zu/planet.shortbread.mbtiles bash gen-world-overview.sh
#   # optional: MAXZOOM (Default 6), OUT (Default ../assets/karten/welt/welt-uebersicht.mbtiles)
#
# Danach: die erzeugte Datei einchecken + das Backend neu bauen (rust-embed bettet sie zur Compile-Zeit
# ein). Der Cache-Bust-Token der Welt-Region leitet sich aus dem Embed-sha256 ab (assets.rs) → ein
# neues Asset invalidiert MapLibres Kachel-Cache automatisch.
set -euo pipefail

MAXZOOM="${MAXZOOM:-6}"
OUT="${OUT:-$(cd "$(dirname "$0")/.." && pwd)/assets/karten/welt/welt-uebersicht.mbtiles}"
SRC="${SRC:-}"

if [ -z "$SRC" ]; then
  echo "FEHLER: SRC (Pfad zu einer Planet-Shortbread-MBTiles) muss gesetzt sein." >&2
  echo "  Beispiel: SRC=/data/planet.shortbread.mbtiles bash gen-world-overview.sh" >&2
  exit 2
fi
if [ ! -f "$SRC" ]; then echo "FEHLER: SRC nicht gefunden: $SRC" >&2; exit 2; fi
command -v sqlite3 >/dev/null || { echo "FEHLER: sqlite3-CLI fehlt." >&2; exit 2; }

mkdir -p "$(dirname "$OUT")"
tmp="$OUT.tmp"
cp "$SRC" "$tmp"

echo "Strippe Zoomstufen > $MAXZOOM (flaches 'tiles'-Schema erwartet)…"
# Hinweis: Setzt die flache versatiles/planetiler-`tiles`-Tabelle voraus (kein normalisiertes
# map/images-Schema). Bei normalisiertem Schema stattdessen die map-Zeilen filtern + verwaiste
# images per VACUUM/GC entfernen.
sqlite3 "$tmp" "DELETE FROM tiles WHERE zoom_level > $MAXZOOM;"
sqlite3 "$tmp" "UPDATE metadata SET value='$MAXZOOM' WHERE name='maxzoom';"
sqlite3 "$tmp" "VACUUM;"

mv "$tmp" "$OUT"
groesse=$(du -h "$OUT" | cut -f1)
echo "Fertig: $OUT ($groesse). Einchecken + Backend neu bauen (rust-embed)."
echo "Verifikation: sqlite3 \"$OUT\" \"SELECT name,value FROM metadata WHERE name IN ('minzoom','maxzoom','format');\""
