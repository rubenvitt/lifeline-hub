#!/usr/bin/env bash
# LFH-837: Alle Symbole der App aus den Quellen der Bildmarke „Lebenslinie“ neu erzeugen.
#
#   scripts/marke/erzeuge-symbole.sh
#
# Quellen (nur Pfade, kein <text>; Geometrie = frontend/src/marke/bildmarkeGeometrie.ts):
#   symbol.svg           vollflächig, eckig     → favicon.svg, pwa-192/512, apple-touch-icon,
#                                                 Hüllensymbole außer icon.icns
#   symbol-macos.svg     Raster von macOS       → nur src-tauri/icons/icon.icns
#   symbol-maskable.svg  Marke im sicheren Kreis → pwa-maskable-512.png
#
# Gerendert wird allein mit `cargo tauri icon` (resvg), damit alle Größen aus demselben
# Renderer kommen. In src-tauri/icons/ landet nur, was dort schon versioniert ist; die
# Standardausgabe android/ und ios/ fällt weg. Die Ergebnisse werden eingecheckt;
# frontend/src/marke/marke.guard.test.ts prüft Nenngrößen, Geometrie und den Stempel
# scripts/marke/quellen.sha256 (Quellen seit dem letzten Lauf unverändert).
set -euo pipefail

wurzel="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
quellen="$wurzel/scripts/marke"
oeffentlich="$wurzel/frontend/public"
huelle="$wurzel/src-tauri/icons"

command -v cargo >/dev/null || { echo "cargo fehlt" >&2; exit 2; }
# Dieselbe Version wie der Release-Build (artefakte.yml), sonst weichen die Bytes ab.
TAURI_CLI='tauri-cli 2.12.0'
cargo tauri --version 2>/dev/null | grep -qx "$TAURI_CLI" \
  || { echo "$TAURI_CLI nötig (cargo install tauri-cli --locked --version ${TAURI_CLI#tauri-cli })" >&2; exit 2; }

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT

# Die tauri-cli meldet jede Datei auf stderr; nur im Fehlerfall zeigen.
render() {
  local protokoll
  if ! protokoll="$(cargo tauri icon "$@" 2>&1)"; then
    echo "$protokoll" >&2
    return 1
  fi
}

# 1. Hüllensymbole aus der eckigen Quelle, nur die versionierten Dateien übernehmen.
render "$quellen/symbol.svg" -o "$arbeit/huelle"
versioniert=()
while IFS= read -r datei; do versioniert+=("$datei"); done \
  < <(git -C "$wurzel" ls-files -- src-tauri/icons | sed 's#^src-tauri/icons/##')
[[ ${#versioniert[@]} -gt 0 ]] || { echo "keine versionierten Hüllensymbole gefunden" >&2; exit 2; }
for datei in "${versioniert[@]}"; do
  [[ "$datei" == icon.icns ]] && continue
  cp "$arbeit/huelle/$datei" "$huelle/$datei"
done

# 2. macOS nach dem Raster der Plattform: nur icon.icns. Die tauri-cli ordnet die Einträge
#    nicht stabil; bei gleichen Bildern bleibt die Datei stehen, sonst gäbe jeder Lauf einen Diff.
render "$quellen/symbol-macos.svg" -o "$arbeit/macos"
icns_gleich() {
  command -v iconutil >/dev/null || return 1
  iconutil -c iconset "$1" -o "$arbeit/a.iconset" && iconutil -c iconset "$2" -o "$arbeit/b.iconset" \
    && diff -rq "$arbeit/a.iconset" "$arbeit/b.iconset" >/dev/null
}
if [[ ! -f "$huelle/icon.icns" ]] || ! icns_gleich "$arbeit/macos/icon.icns" "$huelle/icon.icns"; then
  cp "$arbeit/macos/icon.icns" "$huelle/icon.icns"
fi

# 3. PWA und Startbildschirm von iPad/iPhone.
render "$quellen/symbol.svg" -p 192 -p 512 -p 180 -o "$arbeit/pwa"
cp "$arbeit/pwa/192x192.png" "$oeffentlich/pwa-192.png"
cp "$arbeit/pwa/512x512.png" "$oeffentlich/pwa-512.png"
cp "$arbeit/pwa/180x180.png" "$oeffentlich/apple-touch-icon.png"
render "$quellen/symbol-maskable.svg" -p 512 -o "$arbeit/maskable"
cp "$arbeit/maskable/512x512.png" "$oeffentlich/pwa-maskable-512.png"

# 4. Favicon ist die eckige Quelle selbst.
cp "$quellen/symbol.svg" "$oeffentlich/favicon.svg"

# 5. Stempel: Prüfsummen der Quellen, gegen die der Guard prüft, ob das Skript nach der letzten
#    Quelländerung gelaufen ist.
(cd "$quellen" && shasum -a 256 symbol.svg symbol-maskable.svg symbol-macos.svg) > "$quellen/quellen.sha256"

echo "Symbole erzeugt. Prüfen: mise exec -- pnpm -C \"$wurzel/frontend\" vitest run src/marke"
