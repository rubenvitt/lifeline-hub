#!/usr/bin/env bash
# Selbsttest für scripts/ios/fehlgruende.sh (LLH-1978, Spec `ios-auslieferung`, „Ein PR mit
# iOS-Änderungen baut die App im Simulator“).
#
# Ein Fehler fiele erst auf dem macOS-Runner auf, und dann ohne Grund: Laufen die Tests auf einem
# iPhone und einem iPad, hängt `xcresulttool get test-results tests` die Fehlermeldungen nicht
# an den Testfall, sondern an je einen Knoten des Geräts darunter (Lauf 44419406791 nannte nur die
# Namen). Gefahren gegen nachgebaute Ausgaben, ohne Xcode.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/fehlgruende.sh"
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    printf '  FEHL %s\n--- erwartet\n%s\n--- gemessen\n%s\n' "$1" "$2" "$3" >&2
    fehler=$((fehler + 1))
  fi
}

# Ein Gerät: die Meldung hängt direkt am Testfall.
ein_geraet='{"testNodes":[{"nodeType":"Test Plan","name":"LifelineHub","result":"Failed","children":[
  {"nodeType":"Unit test bundle","name":"LifelineHubTests","result":"Failed","children":[
    {"nodeType":"Test Suite","name":"LinkTests","result":"Failed","children":[
      {"nodeType":"Test Case","nodeIdentifier":"LinkTests/testA()","name":"testA()","result":"Failed",
       "children":[{"nodeType":"Failure Message","name":"LinkTests.swift:44: failed - keine Navigation"}]},
      {"nodeType":"Test Case","nodeIdentifier":"LinkTests/testB()","name":"testB()","result":"Passed"}]}]}]}]}'
pruefe "ein Gerät: Name und Grund" \
  "FEHLGESCHLAGEN: LinkTests/testA()
  LinkTests.swift:44: failed - keine Navigation" \
  "$(printf '%s' "$ein_geraet" | "$SKRIPT_UNTER_TEST")"

# Zwei Geräte: je ein Knoten des Geräts mit der Meldung darunter; das Gerät steht vor dem Grund.
zwei_geraete='{"testNodes":[{"nodeType":"Test Plan","name":"LifelineHub","result":"Failed","children":[
  {"nodeType":"UI test bundle","name":"LifelineHubUITests","result":"Failed","children":[
    {"nodeType":"Test Suite","name":"ScreenshotTests","result":"Failed","children":[
      {"nodeType":"Test Case","nodeIdentifier":"ScreenshotTests/testC()","name":"testC()","result":"Failed",
       "children":[
         {"nodeType":"Device","name":"iPhone 17 Pro","result":"Failed","children":[
           {"nodeType":"Failure Message","name":"ScreenshotTests.swift:87: XCTAssertTrue failed"}]},
         {"nodeType":"Device","name":"iPad Pro 13-inch (M5)","result":"Passed"}]}]}]}]}]}'
pruefe "zwei Geräte: Gerät und Grund" \
  "FEHLGESCHLAGEN: ScreenshotTests/testC()
  iPhone 17 Pro: ScreenshotTests.swift:87: XCTAssertTrue failed" \
  "$(printf '%s' "$zwei_geraete" | "$SKRIPT_UNTER_TEST")"

# Keine Testfälle mit Fehler: keine Ausgabe.
pruefe "alles grün: nichts" "" \
  "$(printf '%s' '{"testNodes":[{"nodeType":"Test Plan","name":"P","result":"Passed"}]}' | "$SKRIPT_UNTER_TEST")"

# Unlesbare Eingabe: Exit ungleich 0, damit der Aufrufer auf das Ergebnisbündel verweist.
if printf 'kein json' | "$SKRIPT_UNTER_TEST" > /dev/null 2>&1; then
  pruefe "unlesbar: Exit ungleich 0" "rot" "grün"
else
  pruefe "unlesbar: Exit ungleich 0" "rot" "rot"
fi

if [ "$fehler" != 0 ]; then
  echo "fehlgruende.test.sh: $fehler Prüfung(en) rot." >&2
  exit 1
fi
echo "fehlgruende.test.sh: alles grün."
