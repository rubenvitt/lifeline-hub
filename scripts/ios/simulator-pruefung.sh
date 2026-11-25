#!/usr/bin/env bash
# iOS-App im Simulator bauen und testen (LLH-1978, Spec `ios-auslieferung`, „Ein PR mit
# iOS-Änderungen baut die App im Simulator“). Läuft nur auf macOS mit Xcode; aufgerufen von
# `.github/workflows/ios-pruefung.yml`, lokal genauso.
#
#   scripts/ios/simulator-pruefung.sh [<ausgabe-verzeichnis>]   (Vorgabe: ios/build/pruefung)
#
# Ablauf: Kern der Helfer-App (`swift test` in ios/HelferKern) → Version schreiben
# (scripts/ios/version.sh) → Wegwerf-Zertifikate des https-Testservers
# (scripts/ios/testserver-zertifikat.sh, LLH-1980) → Projekt erzeugen (`xcodegen`, gepinnt über
# scripts/ios/xcodegen-installieren.sh, muss im PATH stehen) → je ein iPhone und ein iPad der
# neuesten iOS-Laufzeit wählen und ihnen die Test-CA als Wurzel geben → `xcodebuild test` mit
# dem Schema `LifelineHub`: App-Tests (ios/AppTests), UI-Tests (ios/AppUITests) und die Suite des
# Swift-Kerns auf iOS → danach dasselbe mit dem Schema `LifelineHelfer` auf dem iPhone (Helfer-App,
# ADR-0098: ios/HelferTests, ios/HelferUITests und die Suite von HelferKern; Version aus
# scripts/ios/helfer-version.sh) → die Bildschirmbilder der UI-Tests (XCTAttachment) aus beiden
# Ergebnisbündeln nach <ausgabe>/bilder
# (scripts/ios/bilder-ablegen.sh: nur Bilder, Namen ohne Zeichen, die das Artefakt abweist). Nach
# roten Tests stehen sie mit Grund und Gerät im Protokoll (scripts/ios/fehlgruende.sh).
#
# Der Simulator braucht keine Signatur (CODE_SIGNING_ALLOWED=NO); signiert wird erst beim
# Archivieren für TestFlight. Die Bilder werden auch nach roten Tests exportiert; der Exit-Code
# ist der von `xcodebuild`, ohne Bilder ist der Lauf rot.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
AUSGABE="${1:-$WURZEL/ios/build/pruefung}"
ERGEBNIS="$AUSGABE/LifelineHub.xcresult"
ERGEBNIS_HELFER="$AUSGABE/LifelineHelfer.xcresult"

for werkzeug in xcodebuild xcrun xcodegen jq swift; do
  command -v "$werkzeug" > /dev/null 2>&1 || { echo "FEHLER: $werkzeug fehlt im PATH." >&2; exit 2; }
done

rm -rf "$AUSGABE"
mkdir -p "$AUSGABE/bilder"

# Kern der Helfer-App (ADR-0098) mit dem Swift dieses Xcode auf macOS, vor dem Simulator: ein
# roter Kern bricht hier ab. Unter Linux fährt ihn Schritt 18 von check-all.sh (`suiten.yml`).
swift test --package-path "$WURZEL/ios/HelferKern"

"$WURZEL/scripts/ios/version.sh"
"$WURZEL/scripts/ios/helfer-version.sh"
# Wegwerf-CA und Zertifikat des https-Testservers (LLH-1980); vor `xcodegen`, damit
# testserver.p12 als Ressource ins Test-Target kommt.
TESTSERVER="$WURZEL/ios/AppTests/Testserver"
"$WURZEL/scripts/ios/testserver-zertifikat.sh" "$TESTSERVER"
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

# Die Test-CA als Wurzel in jeden Simulator: dann vertraut die App dem Testserver wie einem
# echten Server (ios/AppTests/OhneServerTests.swift). `simctl keychain` braucht ein gestartetes
# Gerät; danach wieder aus, die Tests starten es selbst.
for udid in "$iphone" ${ipad:+"$ipad"}; do
  xcrun simctl boot "$udid" 2> /dev/null || true
  # `-b` startet das Gerät, falls `boot` scheiterte; ohne wartete `bootstatus` unbegrenzt.
  xcrun simctl bootstatus "$udid" -b > /dev/null
  xcrun simctl keychain "$udid" add-root-cert "$TESTSERVER/ca.pem"
  xcrun simctl shutdown "$udid" 2> /dev/null || true
done

# Die Geräte nacheinander: nebeneinander auf dem Runner (eine VM mit 7 GB) brauchte der Start der
# App auf dem iPhone 34 bis 56 s und der erste Webinhalt über 80 s, rote Tests aus reiner Last;
# das iPad allein danach startete in 6 s (Lauf 44427089802).
rc=0
xcodebuild test \
  -project "$WURZEL/ios/LifelineHub.xcodeproj" \
  -scheme LifelineHub \
  "${ziele[@]}" \
  -disable-concurrent-destination-testing \
  -resultBundlePath "$ERGEBNIS" \
  CODE_SIGNING_ALLOWED=NO || rc=$?

# Helfer-App: nur iPhone (TARGETED_DEVICE_FAMILY 1). Ein roter Lauf der Hülle hält sie nicht auf;
# der Exit-Code bleibt rot, wenn einer der beiden rot ist.
rc_helfer=0
xcodebuild build test \
  -project "$WURZEL/ios/LifelineHub.xcodeproj" \
  -scheme LifelineHelfer \
  -destination "id=$iphone" \
  -resultBundlePath "$ERGEBNIS_HELFER" \
  CODE_SIGNING_ALLOWED=NO || rc_helfer=$?

nr=0
for buendel in "$ERGEBNIS" "$ERGEBNIS_HELFER"; do
  nr=$((nr + 1))
  [ -d "$buendel" ] || continue
  if { [ "$buendel" = "$ERGEBNIS" ] && [ "$rc" != 0 ]; } \
    || { [ "$buendel" = "$ERGEBNIS_HELFER" ] && [ "$rc_helfer" != 0 ]; }; then
    # Das Protokoll von `xcodebuild` nennt fehlgeschlagene Tests nicht mit Grund; ohne diese
    # Liste hilft nur das herunterzuladende Ergebnisbündel. Scheitert die Ausgabe, bleibt rc.
    echo "==> Fehlgeschlagene Tests in $(basename "$buendel") (xcresulttool get test-results tests)"
    xcrun xcresulttool get test-results tests --path "$buendel" --format json 2> /dev/null \
      | "$WURZEL/scripts/ios/fehlgruende.sh" \
      || echo "(Liste nicht lesbar; siehe Artefakt ios-xcresult)"
  fi
  # `export attachments` gibt es ab Xcode 16.3; die Namen stehen in manifest.json.
  xcrun xcresulttool export attachments --path "$buendel" --output-path "$AUSGABE/roh-$nr"
  # Nur echte Bilder, mit Namen, die `actions/upload-artifact` annimmt (bilder-ablegen.sh).
  "$WURZEL/scripts/ios/bilder-ablegen.sh" "$AUSGABE/roh-$nr" "$AUSGABE/bilder"
done
[ "$rc" != 0 ] || rc="$rc_helfer"

anzahl="$(find "$AUSGABE/bilder" -type f \( -name '*.png' -o -name '*.jpg' \) | wc -l | tr -d ' ')"
echo "Bildschirmbilder: $anzahl in $AUSGABE/bilder"
if [ "$rc" = 0 ] && [ "$anzahl" = 0 ]; then
  echo "FEHLER: keine Bildschirmbilder im Ergebnis (ios/AppUITests/ScreenshotTests.swift)." >&2
  rc=1
fi
exit "$rc"
