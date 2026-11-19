#!/usr/bin/env bash
# Fehlgeschlagene Tests mit Grund aus `xcrun xcresulttool get test-results tests --format json`
# (stdin) als Zeilen fürs Job-Protokoll (LLH-1978; aufgerufen von scripts/ios/simulator-pruefung.sh,
# Selbsttest: fehlgruende.test.sh).
#
#   FEHLGESCHLAGEN: <Suite>/<Test>()
#     [<Gerät>: ]<Datei>:<Zeile>: <Meldung>
#
# Mit einem Gerät hängt die Meldung direkt am Testfall, mit iPhone und iPad an je einem Knoten des
# Geräts darunter; die Namen der Knoten dazwischen stehen deshalb vor dem Grund. Unlesbare
# Eingabe: Exit ungleich 0 (von `jq`).
set -euo pipefail

jq -r '
  def gruende($vor):
    (.children // [])[]
    | if .nodeType == "Failure Message" then "  \($vor)\(.name)"
      else gruende($vor + "\(.name): ")
      end;
  .. | objects | select(.nodeType? == "Test Case" and .result? == "Failed")
  | "FEHLGESCHLAGEN: \(.nodeIdentifier // .name)", gruende("")'
