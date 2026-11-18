#!/usr/bin/env bash
# iOS-App im Simulator bauen und testen (LLH-1978, Spec `ios-auslieferung`, „Ein PR mit
# iOS-Änderungen baut die App im Simulator“). Läuft nur auf macOS mit Xcode; aufgerufen von
# `.github/workflows/ios-pruefung.yml`, lokal genauso.
#
#   scripts/ios/simulator-pruefung.sh [<ausgabe-verzeichnis>]   (Vorgabe: ios/build/pruefung)
#
# Ablauf: Version schreiben (scripts/ios/version.sh) → Projekt erzeugen (`xcodegen`, gepinnt über
# scripts/ios/xcodegen-installieren.sh, muss im PATH stehen) → je ein iPhone und ein iPad der
# neuesten iOS-Laufzeit wählen → `xcodebuild test` mit dem Schema `LifelineHub`: App-Tests
# (ios/AppTests), UI-Tests (ios/AppUITests) und die Suite des Swift-Kerns auf iOS → die
# Bildschirmbilder der UI-Tests (XCTAttachment) aus dem Ergebnisbündel nach <ausgabe>/bilder
# (scripts/ios/bilder-ablegen.sh: nur Bilder, Namen ohne Zeichen, die das Artefakt abweist).
#
# Der Simulator braucht keine Signatur (CODE_SIGNING_ALLOWED=NO); signiert wird erst beim
# Archivieren für TestFlight. Die Bilder werden auch nach roten Tests exportiert; der Exit-Code
# ist der von `xcodebuild`, ohne Bilder ist der Lauf rot.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
AUSGABE="${1:-$WURZEL/ios/build/pruefung}"
ERGEBNIS="$AUSGABE/LifelineHub.xcresult"

for werkzeug in xcodebuild xcrun xcodegen jq; do
  command -v "$werkzeug" > /dev/null 2>&1 || { echo "FEHLER: $werkzeug fehlt im PATH." >&2; exit 2; }
done

rm -rf "$AUSGABE"
mkdir -p "$AUSGABE/bilder"

"$WURZEL/scripts/ios/version.sh"
xcodegen generate --spec "$WURZEL/ios/project.yml"

# Das erste verfügbare Gerät einer Art (`iPhone`, `iPad`) auf der neuesten iOS-Laufzeit.
geraet() { # <namensanfang>
  xcrun simctl list devices available --json | jq -r --arg art "$1" '
    .devices | to_entries
    | map(select(.key | test("SimRuntime\\.iOS-")))
    | map({ v: (.key | capture("iOS-(?<v>[0-9-]+)$").v | split("-") | map(tonumber)), d: .value })
    | sort_by(.v) | reverse
    | map(.d[] | select(.name | startswith($art))) | .[0].udid // empty'
}
iphone="$(geraet iPhone)"
ipad="$(geraet iPad)"
[ -n "$iphone" ] || { echo "FEHLER: kein verfügbarer iPhone-Simulator." >&2; xcrun simctl list devices available >&2; exit 2; }
ziele=(-destination "id=$iphone")
if [ -n "$ipad" ]; then
  ziele+=(-destination "id=$ipad")
fi
echo "Simulatoren: iPhone $iphone${ipad:+, iPad $ipad}"

rc=0
xcodebuild test \
  -project "$WURZEL/ios/LifelineHub.xcodeproj" \
  -scheme LifelineHub \
  "${ziele[@]}" \
  -resultBundlePath "$ERGEBNIS" \
  CODE_SIGNING_ALLOWED=NO || rc=$?

if [ -d "$ERGEBNIS" ]; then
  # `export attachments` gibt es ab Xcode 16.3; die Namen stehen in manifest.json.
  xcrun xcresulttool export attachments --path "$ERGEBNIS" --output-path "$AUSGABE/roh"
  # Nur echte Bilder, mit Namen, die `actions/upload-artifact` annimmt (bilder-ablegen.sh).
  "$WURZEL/scripts/ios/bilder-ablegen.sh" "$AUSGABE/roh" "$AUSGABE/bilder"
fi

anzahl="$(find "$AUSGABE/bilder" -type f \( -name '*.png' -o -name '*.jpg' \) | wc -l | tr -d ' ')"
echo "Bildschirmbilder: $anzahl in $AUSGABE/bilder"
if [ "$rc" = 0 ] && [ "$anzahl" = 0 ]; then
  echo "FEHLER: keine Bildschirmbilder im Ergebnis (ios/AppUITests/ScreenshotTests.swift)." >&2
  rc=1
fi
exit "$rc"
