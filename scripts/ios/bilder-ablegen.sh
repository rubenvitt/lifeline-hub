#!/usr/bin/env bash
# Legt die Bildschirmbilder der UI-Tests aus dem Export von `xcresulttool export attachments`
# ab (LLH-1978, Spec `ios-auslieferung`, „Ein PR mit iOS-Änderungen baut die App im Simulator“).
# Aufgerufen von scripts/ios/simulator-pruefung.sh; Selbsttest: bilder-ablegen.test.sh.
#
#   scripts/ios/bilder-ablegen.sh <roh-verzeichnis> <bilder-verzeichnis>
#
# Nur echte Bilder (PNG oder JPEG nach den ersten Bytes, nicht nach der Endung): rote UI-Tests
# hängen Debug-Beschreibungen, Bildschirmaufnahmen und UI-Hierarchien an, die keine Bilder sind.
# Je Bild ein sprechender Name mit laufender Nummer und Gerät (iPhone und iPad liefern gleiche
# Namen). `actions/upload-artifact` weist das ganze Artefakt ab, sobald ein Name " : < > | * ?
# oder ein Steuerzeichen trägt; diese Zeichen, `/` und `\` werden zu `_`.
set -euo pipefail

ROH="${1:?roh-verzeichnis fehlt}"
BILDER="${2:?bilder-verzeichnis fehlt}"
MANIFEST="$ROH/manifest.json"

[ -f "$MANIFEST" ] || exit 0
mkdir -p "$BILDER"

# Endung nach den ersten Bytes; leer, wenn die Datei kein PNG oder JPEG ist.
bildendung() { # <datei>
  local kopf
  kopf="$(LC_ALL=C od -An -tx1 -N4 "$1" | tr -d ' \n')"
  case "$kopf" in
    89504e47) echo png ;;
    ffd8ff*) echo jpg ;;
    *) ;;
  esac
}

nr=0
while IFS="$(printf '\t')" read -r datei name; do
  [ -n "$datei" ] && [ -f "$ROH/$datei" ] || continue
  endung="$(bildendung "$ROH/$datei")"
  [ -n "$endung" ] || continue
  nr=$((nr + 1))
  cp "$ROH/$datei" "$BILDER/$(printf '%02d' "$nr")-$name.$endung"
done <<< "$(jq -r '.[] | .attachments[]?
  | [.exportedFileName,
     ((.deviceName // "") + (if .deviceName then "-" else "" end)
       + (.suggestedHumanReadableName // .exportedFileName)
       | sub("\\.(png|jpe?g)$"; ""; "i")
       | gsub("[\"\\\\:<>|*?/[:cntrl:]]"; "_"))]
  | @tsv' "$MANIFEST")"
