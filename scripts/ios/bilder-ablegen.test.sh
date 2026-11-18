#!/usr/bin/env bash
# Selbsttest für scripts/ios/bilder-ablegen.sh (LLH-1978, Spec `ios-auslieferung`, „Ein PR mit
# iOS-Änderungen baut die App im Simulator“).
#
# Ein Fehler fiele erst auf dem macOS-Runner auf: `actions/upload-artifact` lehnt das ganze
# Artefakt ab, sobald ein Dateiname " : < > | * ? oder ein Steuerzeichen trägt, und die
# Debug-Beschreibungen roter UI-Tests (.txt) sind keine Bilder. Gefahren gegen ein nachgebautes
# manifest.json von `xcresulttool export attachments`, ohne Xcode.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/bilder-ablegen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

ROH="$ARBEIT/roh"
BILDER="$ARBEIT/bilder"
mkdir -p "$ROH" "$BILDER"

png() { printf '\211PNG\r\n\032\n%s' "$2" > "$ROH/$1"; }
jpeg() { printf '\377\330\377\340%s' "$2" > "$ROH/$1"; }
png A.png web
png B.png serverliste
printf 'Query chain:\n' > "$ROH/C.txt"
png D.png sonderzeichen
jpeg E.jpeg foto
printf 'kein Bild' > "$ROH/F"
printf '\000\000\000\030ftypmp42' > "$ROH/G.mp4"
# H.png steht im Manifest, fehlt aber im Export.
# I.png trägt die Endung eines Bildes, ist aber eine Debug-Beschreibung.
printf 'Query chain:\n' > "$ROH/I.png"

# Wie `xcresulttool export attachments` es schreibt: je Test die exportierten Anhänge.
cat > "$ROH/manifest.json" << 'JSON'
[
  { "testIdentifier": "ScreenshotTests/testDieWebansichtFuehltSichNativAn()",
    "attachments": [
      { "exportedFileName": "A.png", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "web_0_9DA22A38.png" },
      { "exportedFileName": "B.png", "deviceName": "iPad Pro 13-inch (M5)",
        "suggestedHumanReadableName": "serverliste_0_FFBA60FD.png" } ] },
  { "testIdentifier": "ScreenshotTests/testEineRueckfrageDerSeiteErscheintNativ()",
    "attachments": [
      { "exportedFileName": "C.txt", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "Debug description for `\"elw.local:8443\" Alert`_0_4A14DA75.txt" },
      { "exportedFileName": "D.png", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "a\"b:c<d>e|f*g?h\\i/j\tk\rl\nm_0_1.png" },
      { "exportedFileName": "E.jpeg", "suggestedHumanReadableName": "foto_0_2.jpeg" },
      { "exportedFileName": "F", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "Synthesized Event 2026-11-18 at 10.41.09 PM" },
      { "exportedFileName": "G.mp4", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "Screen Recording 2026-11-18 at 10.40.42 PM.mp4" },
      { "exportedFileName": "H.png", "deviceName": "iPhone 17 Pro",
        "suggestedHumanReadableName": "fehlt_0_3.png" },
      { "exportedFileName": "I.png", "deviceName": "iPad Pro 13-inch (M5)",
        "suggestedHumanReadableName": "App UI hierarchy for dev.rubeen.lifeline_0_4.png" } ] },
  { "testIdentifier": "LinkTests/testMailtoOeffnetDasSystem()" }
]
JSON

echo "==> ios/bilder-ablegen.sh"
rc=0
"$SKRIPT_UNTER_TEST" "$ROH" "$BILDER" > "$ARBEIT/log" 2>&1 || rc=$?
pruefe "Exit 0" 0 "$rc"
namen="$(cd "$BILDER" && LC_ALL=C ls -1)"
pruefe "nur echte Bilder, fortlaufend nummeriert, mit Gerät" \
  "01-iPhone 17 Pro-web_0_9DA22A38.png
02-iPad Pro 13-inch (M5)-serverliste_0_FFBA60FD.png
03-iPhone 17 Pro-a_b_c_d_e_f_g_h_i_j_k_l_m_0_1.png
04-foto_0_2.jpg" "$namen"
pruefe "Inhalt unverändert kopiert" ja \
  "$(cmp -s "$ROH/A.png" "$BILDER/01-iPhone 17 Pro-web_0_9DA22A38.png" && echo ja || echo nein)"
pruefe "kein Name mit \" : < > | * ? \\ oder Steuerzeichen" 0 \
  "$(printf '%s\n' "$namen" | LC_ALL=C grep -c '["\\:<>|*?[:cntrl:]]' || true)"
pruefe "keine Debug-Beschreibung als Bild" 0 "$(printf '%s\n' "$namen" | grep -c 'Debug description' || true)"

# Ohne Manifest (kein Ergebnisbündel) bleibt das Verzeichnis leer, ohne Fehler.
leer="$ARBEIT/leer"
mkdir -p "$leer/roh" "$leer/bilder"
rc=0
"$SKRIPT_UNTER_TEST" "$leer/roh" "$leer/bilder" > "$ARBEIT/log" 2>&1 || rc=$?
pruefe "ohne Manifest: Exit 0" 0 "$rc"
pruefe "ohne Manifest: keine Bilder" 0 "$(find "$leer/bilder" -type f | wc -l | tr -d ' ')"

if [ "$fehler" -gt 0 ]; then
  echo "FEHLER: $fehler Prüfung(en) in ios/bilder-ablegen.test.sh rot." >&2
  exit 1
fi
echo "ios/bilder-ablegen.sh: alle Prüfungen grün."
