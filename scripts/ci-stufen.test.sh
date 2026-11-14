#!/usr/bin/env bash
# Selbsttest für die Form der leichten PR-Prüfung (LLH-1889, ADR „Ein PR prüft leicht“, ersetzt
# die zwei Stufen von LLH-1662): `.github/workflows/ci.yml` und `.github/workflows/e2e.yml`. Was ein
# PR prüft, wann ein Kanal-Lauf abbricht und dass der Release dabei nie abbricht, entscheidet
# allein die Form der Workflows; ein Fehler fiele erst am ersten ungeprüft gemergten PR oder am
# ersten Tag ohne Release auf. Regeln: `scripts/AGENTS.md`, „Leichte PR-Prüfung“.
#
#   scripts/ci-stufen.test.sh [<ci.yml> <e2e.yml>]   (Vorgabe: die Dateien des Repositories)
#
# Gelesen wird ohne YAML-Parser (keiner ist überall da, wo das Gate läuft): ein Job ist der Block
# ab `  <id>:` unter `jobs:` bis zum nächsten Job, sein `if` die Zeile `    if:` samt tiefer
# eingerückten Folgezeilen.

set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
CI="${1:-$SKRIPTE/../.github/workflows/ci.yml}"
E2E="${2:-$SKRIPTE/../.github/workflows/e2e.yml}"
fehler=0

ok() { echo "  ok   $1"; }
fehl() { echo "  FEHL $1" >&2; fehler=$((fehler + 1)); }
pruefe() { # <name> <bedingung …>
  local name="$1"; shift
  if "$@"; then ok "$name"; else fehl "$name"; fi
}

for datei in "$CI" "$E2E"; do
  [ -f "$datei" ] || { echo "FEHLER: $datei fehlt." >&2; exit 1; }
done

# Block eines Jobs (ohne die Kopfzeile `  <id>:`), leer, wenn es ihn nicht gibt.
job() { # <datei> <id>
  awk -v id="$2" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^ #]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[ ]*$/ { aktiv = ($0 == "  " id ":"); next }
    in_jobs && aktiv { print }
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
# Kopf bis `jobs:` (Auslöser, Rechte, Nebenläufigkeit).
kopf() { awk '/^jobs:/ { exit } { print }' "$1"; }

enthaelt() { grep -qF -- "$2" <<< "$1"; }
ohne_leerraum() { tr -d ' \n\t'; }
gleich() { [ "$(ohne_leerraum <<< "$1")" = "$(ohne_leerraum <<< "$2")" ]; }

fehlt() { ! grep -qF -- "$2" <<< "$1"; }
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

# Bedingung der schweren Jobs: Push auf einen Kanal-Branch oder Label `voll`, aber nicht bei einem
# fremden Label an einem PR mit `voll` (das startete sonst alle Suiten neu, Review LLH-1889).
VOLL="github.event_name == 'push' || (contains(github.event.pull_request.labels.*.name, 'voll') && (github.event.action != 'labeled' || github.event.label.name == 'voll'))"
# Kopf ohne Kommentarzeilen: ein gleichlautender Kommentar darf keinen Schlüssel vortäuschen.
kopf_code() { kopf "$1" | grep -Ev '^[[:space:]]*#'; }
# Auf einem Kanal-Branch eine Gruppe je Branch, im PR je Lauf.
JE_BRANCH="\${{ github.event_name == 'push' && github.ref || github.run_id }}"

echo "==> ci-stufen: ci.yml, Kopf"
k="$(kopf_code "$CI")"
pruefe "PR-Lauf hört auf labeled (Label voll)" enthaelt "$k" "types: [opened, synchronize, reopened, labeled]"
pruefe "kein Start auf Auto-Merge" fehlt "$k" "auto_merge"
# Ein fremdes Label läuft in einer eigenen Gruppe: es bricht keinen laufenden Lauf ab (auch nicht die
# Suiten eines `voll`-Laufs) und startet nur die Schnellprüfungen; Dependabot setzt mehrere Labels.
pruefe "Workflow-Gruppe: im PR je Ref, bei Push und fremdem Label je Lauf" \
  enthaelt "$k" "group: ci-\${{ github.event_name == 'pull_request' && !(github.event.action == 'labeled' && github.event.label.name != 'voll') && github.ref || github.run_id }}"
pruefe "Workflow-Abbruch nur im PR" enthaelt "$k" "cancel-in-progress: \${{ github.event_name == 'pull_request' }}"

echo "==> ci-stufen: ci.yml, Jobs"
pruefe "schnell läuft immer (kein if: ein übersprungener jüngster Check zählte grün)" \
  test -z "$(job_if "$CI" schnell)"
pruefe "kein Job aenderungen mehr" test -z "$(job "$CI" aenderungen)"
pruefe "keine Auswahl nach Bereichen in der CI" fehlt "$(cat "$CI" "$E2E")" "ci-auswahl.sh"
for id in rust frontend e2e; do
  pruefe "$id läuft nur bei Push oder Label voll" gleich "$(job_if "$CI" "$id")" "\${{ $VOLL }}"
done
pruefe "berichte läuft nur bei Push oder Label voll" gleich "$(job_if "$CI" berichte)" "\${{ !cancelled() && ($VOLL) }}"
pruefe "rust: Gruppe je Branch mit Abbruch" gleich "$(job_gruppe "$CI" rust)" "ci-rust-$JE_BRANCH|true"
pruefe "frontend: Gruppe je Anteil und Branch mit Abbruch" \
  gleich "$(job_gruppe "$CI" frontend)" "ci-frontend-\${{ matrix.shard }}-$JE_BRANCH|true"
pruefe "e2e: Gruppe je Branch mit Abbruch" gleich "$(job_gruppe "$CI" e2e)" "ci-e2e-$JE_BRANCH|true"
pruefe "berichte: Gruppe je Branch mit Abbruch" gleich "$(job_gruppe "$CI" berichte)" "ci-berichte-$JE_BRANCH|true"
pruefe "e2e ruft e2e.yml" enthaelt "$(job "$CI" e2e)" "uses: ./.github/workflows/e2e.yml"
for id in rust frontend; do
  pruefe "$id: keine Schritt-Bedingung aus der alten Auswahl" fehlt "$(job "$CI" "$id")" "!= 'false'"
done

echo "==> ci-stufen: Release"
r="$(job "$CI" release)"
for n in schnell rust frontend e2e; do
  pruefe "release wartet auf $n" grep -qE "^    needs: \[.*\b$n\b.*\]" <<< "$r"
done
pruefe "release nur bei Push" gleich "$(job_if "$CI" release)" "github.event_name == 'push'"
# Nie abbrechen: ein Abbruch zwischen Versions-Commit und GitHub-Release hinterließe ein Tag ohne
# Release (Kopf von ci.yml).
pruefe "release: eigene Gruppe je Branch ohne Abbruch" \
  gleich "$(job_gruppe "$CI" release)" "release-\${{ github.ref }}|false"

echo "==> ci-stufen: e2e.yml"
pruefe "e2e.yml startet nur als Aufruf" gleich "$(awk '/^on:/ { im = 1; next } im && /^[^ ]/ { exit } im { print }' "$E2E")" "workflow_call:"
pruefe "e2e.yml hat keine eigene Nebenläufigkeit, auch an keinem Job (die steuert der Aufrufer)" \
  fehlt "$(grep -Ev '^[[:space:]]*#' "$E2E")" "concurrency:"
pruefe "e2e.yml kennt das Label e2e nicht mehr" fehlt "$(grep -Ev '^[[:space:]]*#' "$E2E")" "'e2e'"
pruefe "Binary heißt e2e-Binary" enthaelt "$(job "$E2E" binaer)" "name: e2e-Binary"
pruefe "Anteile heißen e2e k/4" enthaelt "$(job "$E2E" e2e)" "name: e2e \${{ matrix.shard }}/4"
pruefe "Anteile nur nach grünem Binary" enthaelt "$(job_if "$E2E" e2e)" "needs.binaer.result == 'success'"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ci-stufen." >&2
  exit 1
fi
echo "==> OK: Selbsttest ci-stufen."
