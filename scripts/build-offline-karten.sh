#!/usr/bin/env bash
set -euo pipefail
# LFH-183 — Eigen-Extract der DACH-Offline-Karten aus dem OFFIZIELLEN Protomaps-Daily-Build.
# Ersetzt die Abhängigkeit vom Community-Repo (Project N.O.M.A.D.) durch projektkontrollierte,
# selbst gebaute PMTiles. Erzeugt je Region eine .pmtiles + berechnet den SHA256 für den Katalog-Pin.
#
# Voraussetzung: `pmtiles` CLI (github.com/protomaps/go-pmtiles) im PATH:
#   brew install protomaps/tap/pmtiles   ODER   go install github.com/protomaps/go-pmtiles@latest
#
# Usage: build-offline-karten.sh <planet-pmtiles-url> <geojson-dir> <out-dir>
#   <planet-pmtiles-url>  Volle URL des aktuellen Daily-Builds. Der Build-Channel liegt unter
#                         https://maps.protomaps.com/builds (Datei datums-volatil, ~7 Tage Retention)
#                         — die EXAKTE URL zur Build-Zeit aus https://docs.protomaps.com/basemaps/downloads
#                         ziehen. Das ist die „Version 4 Protomaps basemap" (z0–15) — DASSELBE Schema,
#                         das unser offlineStyle() rendert (kein Shortbread).
#   <geojson-dir>         Verzeichnis mit <slug>.geojson je Region (Bundesland-/Länder-Grenzen,
#                         OSM admin_level=4 für DE-Bundesländer; AT/CH als Landesgrenze).
#   <out-dir>             Zielverzeichnis für die .pmtiles + catalog-snippet.txt
#
# WICHTIG — Schema-Gate VOR dem Massen-Build (siehe Runbook): erst EINE kleine Region (z. B. Bremen)
# extrahieren, `pmtiles show` prüfen (vector_layers earth/water/roads/buildings/landuse vorhanden)
# und lokal rendern lassen. Erst danach alle Regionen bauen.

PLANET="${1:?planet-pmtiles-url (aus docs.protomaps.com/basemaps/downloads)}"
GEO="${2:?geojson-dir}"
OUT="${3:?out-dir}"
MAXZOOM="${MAXZOOM:-15}"  # Parität zu N.O.M.A.D. (z0–15); MAXZOOM=14 setzen für kleinere Dateien.

command -v pmtiles >/dev/null || { echo "FEHLER: pmtiles CLI nicht im PATH"; exit 1; }
mkdir -p "$OUT"
: > "$OUT/catalog-snippet.txt"

shopt -s nullglob
gjs=("$GEO"/*.geojson)
[ ${#gjs[@]} -gt 0 ] || { echo "FEHLER: keine *.geojson in $GEO"; exit 1; }

for gj in "${gjs[@]}"; do
  slug="$(basename "$gj" .geojson)"
  ziel="$OUT/${slug}.pmtiles"
  echo ">> extract $slug  (region=$gj, maxzoom=$MAXZOOM)  aus $PLANET"
  # HTTP-Range gegen den Planet — lädt nur die Kacheln der Region (kein 120-GB-Vollabzug).
  pmtiles extract "$PLANET" "$ziel" --region="$gj" --maxzoom="$MAXZOOM"
  sha="$(shasum -a 256 "$ziel" | awk '{print $1}')"
  bytes="$(wc -c < "$ziel" | tr -d ' ')"
  printf '%s\tgroesse=%s\tsha256=%s\n' "$slug" "$bytes" "$sha" >> "$OUT/catalog-snippet.txt"
  echo "   fertig: $bytes Bytes, sha256=$sha"
done

echo
echo "Fertig. Snippet: $OUT/catalog-snippet.txt"
echo "Nächste Schritte: Dateien auf projektkontrollierten Storage hochladen, dann BASIS-URL +"
echo "je Eintrag sha256 in src/config.rs (default_offline_katalog) eintragen (LFH-183 Task 5)."
