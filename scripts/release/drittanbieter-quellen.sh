#!/usr/bin/env bash
# Hinweis und Quelltext der LGPL-Bibliotheken fürs Release (LFH-1000).
#
#   drittanbieter-quellen.sh <ausgabe-verzeichnis> <version>
#
# Legt zwei Dateien ab:
#   lifeline-hub-<version>-DRITTANBIETER.txt   der Hinweis (frontend/public/lizenzen/HEIC-DECODER.txt)
#   lifeline-hub-<version>-drittanbieter.zip   lizenzen/ (Hinweis, LGPL- und GPL-Texte) und
#                                              quellen/ (je Bibliothek ein Archiv des gepinnten Stands)
# Die Stände stehen in drittanbieter-quellen.txt (DRITTANBIETER_LISTE ersetzt die Liste, nur für
# den Selbsttest). Weicht ein Tag vom gepinnten Commit ab, bricht das Skript ab: dann wäre das
# Archiv nicht mehr die Quelle dessen, was im Binary steckt.
set -euo pipefail

ziel="${1:?Ausgabeverzeichnis fehlt}"
version="${2:?Version fehlt}"
wurzel="$(cd "$(dirname "$0")/../.." && pwd)"
liste="${DRITTANBIETER_LISTE:-$wurzel/scripts/release/drittanbieter-quellen.txt}"
lizenzen="$wurzel/frontend/public/lizenzen"

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT
mkdir -p "$ziel" "$arbeit/paket/lizenzen" "$arbeit/paket/quellen"
ziel="$(cd "$ziel" && pwd)"

anzahl=0
while read -r name repo tag commit; do
  case "$name" in '' | '#'*) continue ;; esac
  [ -n "$commit" ] || { echo "FEHLER: Zeile für $name ohne Commit in $liste" >&2; exit 1; }
  echo "==> $name $tag"
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" "$repo" "$arbeit/$name"
  ist="$(git -C "$arbeit/$name" rev-parse HEAD)"
  if [ "$ist" != "$commit" ]; then
    echo "FEHLER: $name $tag zeigt auf $ist, gepinnt ist $commit" >&2
    exit 1
  fi
  git -C "$arbeit/$name" archive --format=tar.gz --prefix="$name-$tag/" \
    -o "$arbeit/paket/quellen/$name-$tag.tar.gz" HEAD
  anzahl=$((anzahl + 1))
done < "$liste"
[ "$anzahl" -gt 0 ] || { echo "FEHLER: keine Bibliothek in $liste" >&2; exit 1; }

cp "$lizenzen"/*.txt "$arbeit/paket/lizenzen/"
cp "$lizenzen/HEIC-DECODER.txt" "$ziel/lifeline-hub-$version-DRITTANBIETER.txt"
rm -f "$ziel/lifeline-hub-$version-drittanbieter.zip"
( cd "$arbeit/paket" && zip -qr "$ziel/lifeline-hub-$version-drittanbieter.zip" lizenzen quellen )
echo "==> $anzahl Quellarchive in lifeline-hub-$version-drittanbieter.zip"
