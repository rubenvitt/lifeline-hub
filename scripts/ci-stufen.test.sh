#!/usr/bin/env bash
# Selbsttest für die Form der leichten PR-Prüfung (LLH-1889, LLH-1896; ADR „Ein Workflow je
# Ereignis“): was ein PR prüft, was nur auf einem Kanal-Branch läuft, wann ein Kanal-Lauf abbricht
# und dass der Release dabei nie abbricht, entscheidet allein die Form der Workflows. Ein Fehler
# fiele erst am ersten ungeprüft gemergten PR oder am ersten Tag ohne Release auf. Regeln:
# `scripts/AGENTS.md`, „Leichte PR-Prüfung“.
#
#   scripts/ci-stufen.test.sh [<workflow-ordner>]   (Vorgabe: .github/workflows des Repositories)
#
# Gelesen wird ohne YAML-Parser (keiner ist überall da, wo das Gate läuft): ein Job ist der Block
# ab `  <id>:` unter `jobs:` bis zum nächsten Job, sein `if` die Zeile `    if:` samt tiefer
# eingerückten Folgezeilen.

set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
WF="${1:-$SKRIPTE/../.github/workflows}"
CI="$WF/ci.yml"
PR="$WF/pr.yml"
SUITEN="$WF/suiten.yml"
E2E="$WF/e2e.yml"
MIG="$WF/migrationen.yml"
MIGK="$WF/migrationen-kanal.yml"
RULESET="$WF/ruleset.yml"
IOS="$WF/ios-pruefung.yml"
IOSREL="$WF/ios.yml"
ART="$WF/artefakte.yml"
fehler=0

ok() { echo "  ok   $1"; }
fehl() { echo "  FEHL $1" >&2; fehler=$((fehler + 1)); }
pruefe() { # <name> <bedingung …>
  local name="$1"; shift
  if "$@"; then ok "$name"; else fehl "$name"; fi
}

for datei in "$CI" "$PR" "$SUITEN" "$E2E" "$MIG" "$MIGK" "$RULESET" "$IOS" "$IOSREL" "$ART"; do
  [ -f "$datei" ] || { echo "FEHLER: $datei fehlt." >&2; fehler=$((fehler + 1)); }
done
[ "$fehler" = 0 ] || { echo "==> FEHLER: $fehler Datei(en) fehlen im Selbsttest ci-stufen." >&2; exit 1; }

# Block eines Jobs (ohne die Kopfzeile `  <id>:`), leer, wenn es ihn nicht gibt.
job() { # <datei> <id>
  awk -v id="$2" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^ #]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[ ]*$/ { aktiv = ($0 == "  " id ":"); next }
    in_jobs && aktiv { print }
  ' "$1"
}
# Die Ids aller Jobs einer Datei, je Zeile eine.
job_ids() { # <datei>
  awk '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^ #]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[ ]*$/ { sub(/^  /, ""); sub(/:[ ]*$/, ""); print }
  ' "$1"
}
# Das Job-`if` als eine Zeile, leer ohne. awk liest bis zum Ende statt mit `exit` abzubrechen:
# sonst bekäme `job` vor der Pipe SIGPIPE, und unter `pipefail` endete der Test mit Exit 141
# (so geschehen auf dem Runner, lokal nicht).
job_if() { # <datei> <id>
  job "$1" "$2" | awk '
    fertig { next }
    /^    if:/ { im_if = 1; sub(/^    if:[ ]*(>-)?/, ""); printf "%s ", $0; next }
    im_if && /^      / { sub(/^ +/, ""); printf "%s ", $0; next }
    im_if { fertig = 1 }
  '
}
# Kopf bis `jobs:` (Auslöser, Rechte, Nebenläufigkeit), ohne Kommentarzeilen: ein gleichlautender
# Kommentar darf keinen Schlüssel vortäuschen.
kopf_code() { awk '/^jobs:/ { exit } { print }' "$1" | grep -Ev '^[[:space:]]*#'; }
# Die Auslöser unter `on:`, je Zeile einer (`push`, `pull_request` …).
ausloeser() { # <datei>
  awk '/^on:/ { im = 1; next } im && /^[^ #]/ { exit } im && /^  [a-z_]+:/ { sub(/^  /, ""); sub(/:.*/, ""); print }' "$1"
}
code_ohne_kommentar() { grep -Ev '^[[:space:]]*#' "$1"; }

enthaelt() { grep -qF -- "$2" <<< "$1"; }
fehlt() { ! grep -qF -- "$2" <<< "$1"; }
ohne_leerraum() { tr -d ' \n\t'; }
gleich() { [ "$(ohne_leerraum <<< "$1")" = "$(ohne_leerraum <<< "$2")" ]; }
nur_ausloeser() { [ "$(ausloeser "$1" | tr '\n' ' ')" = "$2" ]; }
# Die Concurrency eines Jobs: Gruppe und Abbruch als „<gruppe>|<abbruch>“, leer ohne.
job_gruppe() { # <datei> <id>
  job "$1" "$2" | awk '
    /^    concurrency:/ { im = 1; next }
    im && /^      group:/ { sub(/^      group:[ ]*/, ""); g = $0; next }
    im && /^      cancel-in-progress:/ { sub(/^      cancel-in-progress:[ ]*/, ""); c = $0; next }
    im && !/^      / { im = 0 }
    END { if (g != "" || c != "") print g "|" c }
  '
}
# Auf einem Kanal-Branch eine Gruppe je Branch, im PR je Lauf. Im aufgerufenen `suiten.yml` ist
# `github.event_name` der des Aufrufers.
JE_BRANCH="\${{ github.event_name == 'push' && github.ref || github.run_id }}"

echo "==> ci-stufen: ein Workflow je Ereignis"
# Ein Job mit falschem `if` erscheint am PR als übersprungener Eintrag: Was nur bei Push läuft,
# steht in einem Workflow, den ein PR gar nicht startet (LLH-1896).
pruefe "ci.yml hört nur auf push" nur_ausloeser "$CI" "push "
pruefe "pr.yml hört nur auf pull_request" nur_ausloeser "$PR" "pull_request "
pruefe "suiten.yml startet nur als Aufruf" nur_ausloeser "$SUITEN" "workflow_call "
pruefe "e2e.yml startet nur als Aufruf" nur_ausloeser "$E2E" "workflow_call "
pruefe "migrationen.yml hört nur auf pull_request" nur_ausloeser "$MIG" "pull_request "
pruefe "migrationen-kanal.yml hört nur auf push" nur_ausloeser "$MIGK" "push "
# Ein `if` auf `push` hieße: der Job erwartet ein Ereignis, das dieser Workflow nicht hat.
for datei in "$PR" "$MIG"; do
  for id in $(job_ids "$datei"); do
    pruefe "$(basename "$datei"): Job $id fragt nicht nach push" fehlt "$(job_if "$datei" "$id")" "'push'"
  done
done
# LLH-1899: „Baut mit Ziel-Branch“ ist abgeschafft; nach einem Merge startet keine Kette von
# Kompilierläufen mehr.
pruefe "ziel-branch-build.yml gibt es nicht mehr" test ! -e "$WF/ziel-branch-build.yml"
pruefe "ziel-branch-verteilen.yml gibt es nicht mehr" test ! -e "$WF/ziel-branch-verteilen.yml"
pruefe "kein Workflow erzeugt den Check „Baut mit Ziel-Branch“" \
  test -z "$(grep -lE '^[^#]*Baut mit Ziel-Branch|ziel-branch-build\.sh' "$WF"/*.yml 2> /dev/null || true)"
pruefe "offene-prs steht nur in migrationen-kanal.yml" test -z "$(job "$MIG" offene-prs)"
pruefe "offene-prs läuft in migrationen-kanal.yml" test -n "$(job "$MIGK" offene-prs)"

echo "==> ci-stufen: pr.yml"
k="$(kopf_code "$PR")"
pruefe "PR-Lauf hört auf labeled (Label voll)" enthaelt "$k" "types: [opened, synchronize, reopened, labeled]"
pruefe "kein Start auf Auto-Merge" fehlt "$k" "auto_merge"
# Ein fremdes Label an einem PR OHNE `voll` läuft in einer eigenen Gruppe: es bricht keinen
# laufenden Lauf ab und startet nur die Schnellprüfungen (Dependabot setzt mehrere Labels). An
# einem PR mit `voll` startet es in der Ref-Gruppe alles neu: ein übersprungener gleichnamiger
# Check wäre sonst der jüngste und verdeckte eine rote Suite (Review LLH-1889).
pruefe "Workflow-Gruppe: je Ref, fremdes Label ohne voll je Lauf" \
  enthaelt "$k" "group: pr-\${{ !(github.event.action == 'labeled' && github.event.label.name != 'voll' && !contains(github.event.pull_request.labels.*.name, 'voll')) && github.ref || github.run_id }}"
pruefe "PR-Lauf bricht den älteren ab" enthaelt "$k" "cancel-in-progress: true"
pruefe "pr.yml: nur die Jobs schnell, binaer und suiten" gleich "$(job_ids "$PR" | tr '\n' ' ')" "schnell binaer suiten"
pruefe "schnell läuft immer (kein if: ein übersprungener jüngster Check zählte grün)" \
  test -z "$(job_if "$PR" schnell)"
pruefe "schnell heißt Schnellprüfungen (Pflicht-Check)" enthaelt "$(job "$PR" schnell)" "    name: Schnellprüfungen"
# Server-Binary ohne Dev-Abhängigkeiten (LLH-2033): Pflicht-Check neben `schnell`, nicht darin.
pruefe "binaer läuft immer (Pflicht-Check)" test -z "$(job_if "$PR" binaer)"
pruefe "binaer heißt Server-Binary (Pflicht-Check)" enthaelt "$(job "$PR" binaer)" "    name: Server-Binary"
pruefe "binaer über check-all.sh" enthaelt "$(job "$PR" binaer)" "run: ./scripts/check-all.sh --nur binaer"
pruefe "binaer wartet nicht auf schnell" fehlt "$(job "$PR" binaer)" "needs:"
pruefe "binaer läuft auf GitHub" enthaelt "$(job "$PR" binaer)" "    runs-on: ubuntu-latest"
pruefe "Suiten nur mit Label voll" \
  gleich "$(job_if "$PR" suiten)" "\${{ contains(github.event.pull_request.labels.*.name, 'voll') }}"
pruefe "pr.yml ruft suiten.yml" enthaelt "$(job "$PR" suiten)" "uses: ./.github/workflows/suiten.yml"
pruefe "pr.yml hat keinen Release" test -z "$(job "$PR" release)"

echo "==> ci-stufen: ci.yml"
k="$(kopf_code "$CI")"
pruefe "Workflow-Gruppe je Lauf ohne Abbruch (der Release hängt am Lauf)" enthaelt "$k" "group: ci-\${{ github.run_id }}"
pruefe "kein Workflow-Abbruch" enthaelt "$k" "cancel-in-progress: false"
pruefe "ci.yml: Jobs schnell, suiten, release" gleich "$(job_ids "$CI" | tr '\n' ' ')" "schnell suiten release"
pruefe "schnell läuft immer" test -z "$(job_if "$CI" schnell)"
pruefe "suiten läuft immer" test -z "$(job_if "$CI" suiten)"
pruefe "ci.yml ruft suiten.yml" enthaelt "$(job "$CI" suiten)" "uses: ./.github/workflows/suiten.yml"
# Wortgleich, weil der Pflicht-Check im PR als `Schnellprüfungen` ohne Präfix erscheinen muss und
# deshalb nicht in einem aufgerufenen Workflow stehen kann (design.md, D2).
# Kommentare auf Job-Ebene (`  # …`) gehören zum NÄCHSTEN Job und zählen nicht mit.
job_rumpf() { job "$1" "$2" | grep -v '^  #' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; }
pruefe "schnell in ci.yml und pr.yml wortgleich" test "$(job_rumpf "$CI" schnell)" = "$(job_rumpf "$PR" schnell)"
# Gegenprobe: der Vergleich sieht eine Abweichung (sonst wäre er wertlos).
pruefe "Gegenprobe: eine geänderte Zeile fällt auf" \
  test "$(job_rumpf "$CI" schnell)" != "$(job_rumpf "$PR" schnell | sed 's/timeout-minutes: 30/timeout-minutes: 31/')"
pruefe "env in ci.yml und pr.yml gleich" \
  test "$(awk '/^env:/ { im = 1; print; next } im && /^[^ ]/ { exit } im { print }' "$CI")" \
  = "$(awk '/^env:/ { im = 1; print; next } im && /^[^ ]/ { exit } im { print }' "$PR")"
pruefe "keine Auswahl nach Bereichen in der CI" fehlt "$(cat "$CI" "$PR" "$SUITEN" "$E2E")" "ci-auswahl.sh"

echo "==> ci-stufen: suiten.yml"
pruefe "suiten.yml: Jobs rust, frontend, e2e, ios, berichte" \
  gleich "$(job_ids "$SUITEN" | tr '\n' ' ')" "rust frontend e2e ios berichte"
for id in runner rust frontend e2e ios; do
  pruefe "$id: kein if (der Aufrufer entscheidet)" test -z "$(job_if "$SUITEN" "$id")"
done
pruefe "berichte nur ohne Abbruch" gleich "$(job_if "$SUITEN" berichte)" "\${{ !cancelled() }}"
# Der Release wartet auf den ganzen Aufruf, also auch auf die Berichte; ein gescheiterter Bericht
# darf ihn nicht verhindern (design.md, D2).
pruefe "berichte scheitert, ohne den Aufruf rot zu machen (Job-Ebene, nicht nur ein Schritt)" \
  grep -qx '    continue-on-error: true' <<< "$(job "$SUITEN" berichte)"
pruefe "rust: Gruppe je Branch ohne Abbruch (läuft zu Ende)" gleich "$(job_gruppe "$SUITEN" rust)" "ci-rust-$JE_BRANCH|false"
pruefe "frontend: Gruppe je Anteil und Branch ohne Abbruch (läuft zu Ende)" \
  gleich "$(job_gruppe "$SUITEN" frontend)" "ci-frontend-\${{ matrix.shard }}-$JE_BRANCH|false"
pruefe "e2e: Gruppe je Branch ohne Abbruch (läuft zu Ende)" gleich "$(job_gruppe "$SUITEN" e2e)" "ci-e2e-$JE_BRANCH|false"
pruefe "berichte: Gruppe je Branch ohne Abbruch (läuft zu Ende)" gleich "$(job_gruppe "$SUITEN" berichte)" "ci-berichte-$JE_BRANCH|false"
pruefe "ios: Gruppe je Branch ohne Abbruch (läuft zu Ende)" gleich "$(job_gruppe "$SUITEN" ios)" "ci-ios-$JE_BRANCH|false"
# Der Swift-Kern der iOS-Hülle (LLH-1978): in der CI ist eine fehlende Toolchain rot, nie eine
# Lücke, und die Swift-Version ist dieselbe wie lokal.
pruefe "ios: Swift-Kern über check-all.sh" enthaelt "$(job "$SUITEN" ios)" "run: ./scripts/check-all.sh --nur ios"
pruefe "ios: Toolchain Pflicht" enthaelt "$(job "$SUITEN" ios)" 'IOS_SWIFT_PFLICHT: "1"'
pruefe "ios: Swift gepinnt (Image per Digest)" enthaelt "$(job "$SUITEN" ios)" 'image: swift@sha256:'
pruefe "ios: keine Fremd-Action für Swift" fehlt "$(job "$SUITEN" ios)" 'setup-swift'
pruefe "e2e ruft e2e.yml" enthaelt "$(job "$SUITEN" e2e)" "uses: ./.github/workflows/e2e.yml"
# Nur GitHub (ADR-0078): jeder Job der Suiten läuft auf `ubuntu-latest`, keine Runner-Wahl.
for id in rust frontend ios berichte; do
  pruefe "$id: läuft auf GitHub" enthaelt "$(job "$SUITEN" "$id")" "    runs-on: ubuntu-latest"
done
pruefe "keine Runner-Wahl mehr" test -z "$(job "$SUITEN" runner)"
pruefe "suiten.yml: kein eigener Runner" fehlt "$(code_ohne_kommentar "$SUITEN")" "runner.environment"
pruefe "suiten.yml kennt das Label voll nicht (der Aufrufer entscheidet)" fehlt "$(code_ohne_kommentar "$SUITEN")" "'voll'"
for datei in "$CI" "$PR"; do
  pruefe "$(basename "$datei"): Aufruf der Suiten darf checks lesen (e2e.yml)" enthaelt "$(job "$datei" suiten)" "checks: read"
done

echo "==> ci-stufen: Release"
r="$(job "$CI" release)"
for n in schnell suiten; do
  pruefe "release wartet auf $n" grep -qE "^    needs: \[.*\b$n\b.*\]" <<< "$r"
done
pruefe "release nur bei Push" gleich "$(job_if "$CI" release)" "github.event_name == 'push'"
# Nie abbrechen: ein Abbruch zwischen Versions-Commit und GitHub-Release hinterließe ein Tag ohne
# Release (Kopf von ci.yml).
pruefe "release: eigene Gruppe je Branch ohne Abbruch" \
  gleich "$(job_gruppe "$CI" release)" "release-\${{ github.ref }}|false"

echo "==> ci-stufen: e2e.yml"
pruefe "e2e.yml hat keine eigene Nebenläufigkeit, auch an keinem Job (die steuert der Aufrufer)" \
  fehlt "$(code_ohne_kommentar "$E2E")" "concurrency:"
pruefe "e2e.yml kennt das Label e2e nicht mehr" fehlt "$(code_ohne_kommentar "$E2E")" "'e2e'"
pruefe "Binary heißt e2e-Binary" enthaelt "$(job "$E2E" binaer)" "name: e2e-Binary"
pruefe "Anteile heißen e2e k/4" enthaelt "$(job "$E2E" e2e)" "name: e2e \${{ matrix.shard }}/4"
pruefe "Anteile nur nach grünem Binary" enthaelt "$(job_if "$E2E" e2e)" "needs.binaer.result == 'success'"
for id in binaer e2e; do
  pruefe "e2e.yml: $id läuft auf GitHub" enthaelt "$(job "$E2E" "$id")" "    runs-on: ubuntu-latest"
done
pruefe "e2e.yml: kein eigener Runner" fehlt "$(code_ohne_kommentar "$E2E")" "runner.environment"

echo "==> ci-stufen: ios-pruefung.yml"
# Der macOS-Lauf der iOS-Hülle (LLH-1978): nur am PR, nur bei Änderungen an der Hülle oder den
# gemeinsamen Fällen, und nie Pflicht (Spec `ios-auslieferung`).
pruefe "ios-pruefung.yml hört nur auf pull_request" nur_ausloeser "$IOS" "pull_request "
for pfad in '"ios/**"' '"src-tauri/faelle/**"' '"scripts/ios/**"' '".github/workflows/ios-pruefung.yml"'; do
  pruefe "ios-pruefung.yml: Pfadfilter $pfad" enthaelt "$(kopf_code "$IOS")" "      - $pfad"
done
pruefe "ios-pruefung.yml liest nur" test "$(code_ohne_kommentar "$IOS" | grep -cE ': write')" = 0
pruefe "ios-pruefung.yml fährt scripts/ios/simulator-pruefung.sh" \
  enthaelt "$(job "$IOS" simulator)" "run: ./scripts/ios/simulator-pruefung.sh"
pruefe "ios-pruefung.yml installiert XcodeGen nur über das Skript" \
  fehlt "$(code_ohne_kommentar "$IOS")" "brew install"
pruefe "simulator-pruefung.sh testet die Simulatoren nacheinander" \
  enthaelt "$(code_ohne_kommentar "$SKRIPTE/ios/simulator-pruefung.sh")" "-disable-concurrent-destination-testing"
pruefe "iOS-Simulator ist kein Pflicht-Check" fehlt "$(cat "$SKRIPTE/ruleset-pruefen.sh")" "iOS-Simulator"

echo "==> ci-stufen: ios.yml (TestFlight)"
# Der Upload der iOS-App (LLH-1978, Spec `ios-auslieferung`, „TestFlight erhält Beta- und stabile
# Stände“): aus artefakte.yml nach der Freigabe, nur für beta und main, oder per Handstart; ein
# roter Upload hält das Release nicht auf. Ein Fehler fiele erst am nächsten Beta-Tag auf.
pruefe "ios.yml: Aufruf und Handstart" nur_ausloeser "$IOSREL" "workflow_call workflow_dispatch "
pruefe "ios.yml: Eingabe tag bei beiden Auslösern" test \
  "$(kopf_code "$IOSREL" | grep -cE '^      tag:')" = 2
pruefe "ios.yml liest nur" test "$(code_ohne_kommentar "$IOSREL" | grep -cE ': write')" = 0
pruefe "ios.yml fährt scripts/ios/testflight.sh" \
  enthaelt "$(job "$IOSREL" testflight)" "./scripts/ios/testflight.sh --tag"
pruefe "ios.yml installiert XcodeGen nur über das Skript" \
  enthaelt "$(job "$IOSREL" testflight)" "run: ./scripts/ios/xcodegen-installieren.sh"
pruefe "ios.yml: kein brew install" fehlt "$(code_ohne_kommentar "$IOSREL")" "brew install"
for geheim in APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_P8; do
  pruefe "ios.yml reicht $geheim an das Skript" \
    enthaelt "$(job "$IOSREL" testflight)" "$geheim: \${{ secrets.$geheim }}"
done
pruefe "artefakte.yml: Job ios ruft ios.yml" enthaelt "$(job "$ART" ios)" "uses: ./.github/workflows/ios.yml"
pruefe "artefakte.yml: ios erbt die Secrets" enthaelt "$(job "$ART" ios)" "secrets: inherit"
pruefe "artefakte.yml: ios nach freigeben" enthaelt "$(job "$ART" ios)" "needs: [vorbereiten, freigeben]"
ios_if="$(job_if "$ART" ios)"
for teil in "!cancelled()" "inputs.freigeben" "needs.freigeben.result == 'success'"; do
  pruefe "artefakte.yml: ios nur wenn $teil" enthaelt "$ios_if" "$teil"
done
# Seit LLH-1988 (ADR-0080) jeder Kanal: welche Gruppe ein Kanal bekommt, entscheidet erst
# testflight-verteilen.mjs, nicht die Bedingung des Jobs.
pruefe "artefakte.yml: ios für jeden Kanal" fehlt "$ios_if" "needs.vorbereiten.outputs.vorab"
pruefe "ios.yml: verteilen nach dem Upload" enthaelt "$(job "$IOSREL" verteilen)" "needs: testflight"
pruefe "ios.yml: verteilen auf Ubuntu" enthaelt "$(job "$IOSREL" verteilen)" "runs-on: ubuntu-latest"
pruefe "ios.yml: verteilen fährt testflight-verteilen.mjs" \
  enthaelt "$(job "$IOSREL" verteilen)" "node scripts/ios/testflight-verteilen.mjs"
pruefe "ios.yml: verteilen bekommt die Build-Nummer" \
  enthaelt "$(job "$IOSREL" verteilen)" "needs.testflight.outputs.build"
pruefe "ios.yml: verteilen löscht den Schlüssel immer" \
  enthaelt "$(job "$IOSREL" verteilen)" "if: \${{ always() }}"
pruefe "artefakte.yml: freigeben wartet nicht auf ios" \
  fehlt "$(job "$ART" freigeben | grep -E '^    needs:')" "ios"

echo "==> ci-stufen: ruleset.yml"
pruefe "ruleset.yml: Push auf alpha, Zeitplan, Anstoß" nur_ausloeser "$RULESET" "push schedule workflow_dispatch "
pruefe "ruleset.yml: nur auf alpha" enthaelt "$(kopf_code "$RULESET")" "branches: [alpha]"
pruefe "ruleset.yml liest nur" test "$(code_ohne_kommentar "$RULESET" | grep -cE ': write')" = 0
pruefe "ruleset.yml prüft mit ruleset-pruefen.sh" enthaelt "$(job "$RULESET" pruefen)" "scripts/ruleset-pruefen.sh"
pruefe "ruleset.yml liest die Regeln von alpha" enthaelt "$(job "$RULESET" pruefen)" "rules/branches/alpha"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ci-stufen." >&2
  exit 1
fi
echo "==> OK: Selbsttest ci-stufen."
