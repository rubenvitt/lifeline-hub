#!/usr/bin/env bash
# Selbsttest für die Form der zweistufigen PR-CI (LLH-1662): `.github/workflows/ci.yml` und
# `.github/workflows/e2e.yml`. Ob ein PR ohne e2e-Lauf mergen kann, entscheidet allein die Form
# der Workflows: ein Job-`if` an der falschen Stelle meldet einen Pflicht-Check leer grün statt
# ihn fehlen zu lassen, und das fiele erst am ersten ungeprüft gemergten PR auf. Regeln:
# `scripts/AGENTS.md`, „Zwei Stufen im PR“; Herleitung in der Change `k133wmg6-zweistufige-ci`.
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

# DIE ZWEI AUSDRÜCKE, die über Start und Abbruch der zweiten Stufe entscheiden, stehen hier im
# Wortlaut (Leerraum zählt nicht). Eine Teilzeichenkette fängt keine logische Umkehrung (`&&` zu
# `||`, eine gestrichene Klausel); wer einen Ausdruck ändert, ändert ihn hier mit (Regel:
# `scripts/AGENTS.md`, „Zwei Stufen im PR“; Herleitung im design.md der Change
# `k133wmg6-zweistufige-ci`).
#   Fertig:  Auto-Merge an oder Label `e2e`, im Zustand NACH dem Ereignis.
#   Start:   Push (Aufruf aus ci.yml); neuer Commit an einem fertigen PR; Auto-Merge an, wenn das
#            Label fehlte; Label `e2e`, wenn Auto-Merge aus war.
#   Gruppe:  gemeinsam für jeden Start und für das Zurücknehmen der letzten Markierung; ein
#            Commit-Ereignis an einem nicht fertigen PR teilt sie NICHT (seine Nutzlast kann
#            veraltet sein und bräche sonst einen gerade gestarteten Lauf ab).
ERWARTET_START="$(cat << 'AUSDRUCK'
${{ github.event_name != 'pull_request'
  || (contains(fromJSON('["opened","synchronize","reopened"]'), github.event.action)
      && (github.event.pull_request.auto_merge != null
          || contains(github.event.pull_request.labels.*.name, 'e2e')))
  || (github.event.action == 'auto_merge_enabled'
      && !contains(github.event.pull_request.labels.*.name, 'e2e'))
  || (github.event.action == 'labeled' && github.event.label.name == 'e2e'
      && github.event.pull_request.auto_merge == null) }}
AUSDRUCK
)"
ERWARTET_GRUPPE="$(cat << 'AUSDRUCK'
${{ (github.event_name == 'pull_request' && (
      (contains(fromJSON('["opened","synchronize","reopened"]'), github.event.action)
       && (github.event.pull_request.auto_merge != null
           || contains(github.event.pull_request.labels.*.name, 'e2e')))
      || (github.event.action == 'auto_merge_enabled'
          && !contains(github.event.pull_request.labels.*.name, 'e2e'))
      || (github.event.action == 'labeled' && github.event.label.name == 'e2e'
          && github.event.pull_request.auto_merge == null)
      || ((github.event.action == 'auto_merge_disabled'
           || (github.event.action == 'unlabeled' && github.event.label.name == 'e2e'))
          && github.event.pull_request.auto_merge == null
          && !contains(github.event.pull_request.labels.*.name, 'e2e'))))
    && format('e2e-pr-{0}', github.event.pull_request.number)
    || format('e2e-lauf-{0}', github.run_id) }}
AUSDRUCK
)"
# Der Ausdruck nach `group:` (Block-Skalar `>-`) bis `cancel-in-progress:`.
gruppe() {
  awk '/^  group:/ { an = 1; sub(/^  group:[ ]*(>-)?/, ""); print; next }
       an && /^  cancel-in-progress:/ { exit }
       an { print }' "$1"
}
fehlt() { ! grep -qF -- "$2" <<< "$1"; }

echo "==> ci-stufen: e2e.yml"
k="$(kopf "$E2E")"
pruefe "e2e.yml lässt sich aus ci.yml aufrufen (workflow_call)" enthaelt "$k" "workflow_call:"
for typ in opened synchronize reopened auto_merge_enabled auto_merge_disabled labeled unlabeled; do
  pruefe "e2e.yml hört auf pull_request/$typ" enthaelt "$k" "$typ"
done
pruefe "Nebenläufigkeit: Gruppe im Wortlaut" gleich "$(gruppe "$E2E")" "$ERWARTET_GRUPPE"
pruefe "Nebenläufigkeit: Abbruch nur im PR" enthaelt "$k" "cancel-in-progress: \${{ github.event_name == 'pull_request' }}"

a="$(job "$E2E" aenderungen)"; a_if="$(job_if "$E2E" aenderungen)"
pruefe "Auswahl heißt e2e-Auswahl" enthaelt "$a" "name: e2e-Auswahl"
pruefe "Auswahl fragt ci-auswahl.sh zwei" enthaelt "$a" "scripts/ci-auswahl.sh zwei"
pruefe "Start der Auswahl im Wortlaut" gleich "$a_if" "$ERWARTET_START"

b="$(job "$E2E" binaer)"; b_if="$(job_if "$E2E" binaer)"
pruefe "e2e-Binary heißt über eine Matrix (fehlt, wenn übersprungen)" enthaelt "$b" "name: \${{ matrix.check }}"
pruefe "e2e-Binary: Matrix mit genau diesem Namen" enthaelt "$b" "check: [e2e-Binary]"
pruefe "e2e-Binary hängt an der Auswahl" enthaelt "$b" "needs: aenderungen"
pruefe "e2e-Binary läuft nur, wenn die Auswahl lief" enthaelt "$b_if" "needs.aenderungen.result != 'skipped'"
pruefe "e2e-Binary: „betroffen“ steht nicht am Job (sonst fehlte er statt leer grün)" fehlt "$b_if" "outputs.e2e"
pruefe "e2e-Binary: „betroffen“ steht an den Schritten" enthaelt "$b" "if: env.E2E != 'false'"

e="$(job "$E2E" e2e)"; e_if="$(job_if "$E2E" e2e)"
pruefe "e2e-Anteile heißen e2e k/4" enthaelt "$e" "name: e2e \${{ matrix.shard }}/4"
pruefe "e2e-Anteile: vier" enthaelt "$e" "shard: [1, 2, 3, 4]"
pruefe "e2e-Anteile laufen nur, wenn die Auswahl lief" enthaelt "$e_if" "needs.aenderungen.result != 'skipped'"
pruefe "e2e-Anteile laufen nur nach grünem Binary" enthaelt "$e_if" "needs.binaer.result == 'success'"
pruefe "e2e-Anteile: „betroffen“ steht nicht am Job" fehlt "$e_if" "outputs.e2e"
pruefe "e2e-Anteile: „betroffen“ steht an den Schritten" enthaelt "$e" "if: env.E2E != 'false'"

r="$(job "$E2E" berichte)"
# Bei Push wartet der Release auf den Aufruf von e2e.yml, und ein Aufruf ist nur grün, wenn jeder
# seiner Jobs grün ist: ein Aussetzer im Bericht (pnpm install, Checkout) hielte sonst einen
# Release über grünen Suiten auf.
pruefe "e2e-Bericht hält den Release nicht auf (continue-on-error am Job)" grep -qx "    continue-on-error: true" <<< "$r"

echo "==> ci-stufen: ci.yml"
pruefe "ci.yml hat keinen Job e2e-Binary" fehlt "$(cat "$CI")" "e2e-Binary"
pruefe "ci.yml hat keine e2e-Anteile" fehlt "$(cat "$CI")" "name: e2e \${{ matrix.shard }}/4"
k="$(kopf "$CI")"
pruefe "ci.yml startet nicht auf Auto-Merge (Abbruch des laufenden Laufs)" fehlt "$k" "auto_merge"
pruefe "ci.yml startet nicht auf Labels" fehlt "$k" "labeled"
a="$(job "$CI" aenderungen)"
pruefe "ci.yml fragt ci-auswahl.sh eins" enthaelt "$a" "scripts/ci-auswahl.sh eins"
c="$(job "$CI" e2e)"; c_if="$(job_if "$CI" e2e)"
pruefe "ci.yml ruft e2e.yml auf" enthaelt "$c" "uses: ./.github/workflows/e2e.yml"
pruefe "ci.yml ruft e2e.yml nur bei Push" enthaelt "$c_if" "github.event_name == 'push'"
r="$(job "$CI" release)"
for n in schnell rust frontend e2e; do
  pruefe "release wartet auf $n" grep -qE "^    needs: \[.*\b$n\b.*\]" <<< "$r"
done

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ci-stufen." >&2
  exit 1
fi
echo "==> OK: Selbsttest ci-stufen."
