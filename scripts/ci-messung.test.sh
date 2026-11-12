#!/usr/bin/env bash
# Selbsttest für scripts/ci-messung.sh (LLH-1662). Die Messung vergleicht die PR-CI vor und nach
# der Zweiteilung; zählt sie falsch (übersprungene Jobs mit, abgebrochene Läufe nicht), belegt der
# Vergleich das Gegenteil dessen, was passiert ist.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/ci-messung.sh"
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

# Attrappe für `gh api`: Läufe je Workflow aus laeufe-<datei>.json, Jobs je Lauf aus
# jobs-<id>.json; ein fehlender Workflow antwortet wie GitHub mit 404. Jeder Aufruf landet im Log.
cat > "$ARBEIT/gh" << 'ATTRAPPE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || exit 1
pfad="$2"
echo "$pfad" >> "$MESSUNG_FAKE/log"
case "$pfad" in
  repos/test/repo/actions/workflows/*/runs*)
    wf="${pfad#repos/test/repo/actions/workflows/}"; wf="${wf%%/*}"
    [ -f "$MESSUNG_FAKE/laeufe-$wf.json" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }
    cat "$MESSUNG_FAKE/laeufe-$wf.json" ;;
  repos/test/repo/actions/runs/*/jobs*)
    id="${pfad#repos/test/repo/actions/runs/}"; id="${id%%/*}"
    cat "$MESSUNG_FAKE/jobs-$id.json" ;;
  *) echo "Attrappe: unbekannt $pfad" >&2; exit 1 ;;
esac
ATTRAPPE
chmod +x "$ARBEIT/gh"
mkdir -p "$ARBEIT/fake"
: > "$ARBEIT/fake/log"

lauf_json() { # <id> <branch> <status> <conclusion|null>
  local c='null'
  [ "$4" = null ] || c="\"$4\""
  printf '{"id":%s,"head_branch":"%s","status":"%s","conclusion":%s,"event":"pull_request"}' "$1" "$2" "$3" "$c"
}
job_json() { # <name> <conclusion|null> <start|null> <ende|null>
  local c='null' a='null' e='null'
  [ "$2" = null ] || c="\"$2\""
  [ "$3" = null ] || a="\"$3\""
  [ "$4" = null ] || e="\"$4\""
  printf '{"name":"%s","conclusion":%s,"started_at":%s,"completed_at":%s}' "$1" "$c" "$a" "$e"
}

# ci.yml: PR-Branch a mit einem abgebrochenen und einem grünen Lauf, Branch b mit einem roten.
# Zwei Seiten (`--paginate` hängt sie aneinander).
{
  printf '{"total_count":3,"workflow_runs":[%s,%s]}\n' "$(lauf_json 1 a completed cancelled)" "$(lauf_json 2 a completed success)"
  printf '{"total_count":3,"workflow_runs":[%s]}\n' "$(lauf_json 3 b completed failure)"
} > "$ARBEIT/fake/laeufe-ci.yml.json"
# e2e.yml: Branch a einmal grün, Branch b noch laufend.
printf '{"total_count":2,"workflow_runs":[%s,%s]}\n' "$(lauf_json 4 a completed success)" "$(lauf_json 5 b in_progress null)" \
  > "$ARBEIT/fake/laeufe-e2e.yml.json"

# Lauf 1: zwei Jobs gestartet (10 + 20 min), einer übersprungen (zählt nicht).
printf '{"jobs":[%s,%s,%s]}\n' \
  "$(job_json Schnellprüfungen success 2026-11-12T10:00:00Z 2026-11-12T10:10:00Z)" \
  "$(job_json Rust-Suite cancelled 2026-11-12T10:00:00Z 2026-11-12T10:20:00Z)" \
  "$(job_json 'e2e ${{ matrix.shard }}/4' skipped 2026-11-12T10:00:00Z 2026-11-12T10:00:00Z)" > "$ARBEIT/fake/jobs-1.json"
# Lauf 2: ein Job, 30 min.
printf '{"jobs":[%s]}\n' "$(job_json Rust-Suite success 2026-11-12T11:00:00Z 2026-11-12T11:30:00Z)" > "$ARBEIT/fake/jobs-2.json"
# Lauf 3: ein Job, 5 min.
printf '{"jobs":[%s]}\n' "$(job_json Schnellprüfungen failure 2026-11-12T12:00:00Z 2026-11-12T12:05:00Z)" > "$ARBEIT/fake/jobs-3.json"
# Lauf 4: fünf Jobs à 60 min.
printf '{"jobs":[%s,%s,%s,%s,%s]}\n' \
  "$(job_json e2e-Binary success 2026-11-12T13:00:00Z 2026-11-12T14:00:00Z)" \
  "$(job_json 'e2e 1/4' success 2026-11-12T13:00:00Z 2026-11-12T14:00:00Z)" \
  "$(job_json 'e2e 2/4' success 2026-11-12T13:00:00Z 2026-11-12T14:00:00Z)" \
  "$(job_json 'e2e 3/4' success 2026-11-12T13:00:00Z 2026-11-12T14:00:00Z)" \
  "$(job_json 'e2e 4/4' success 2026-11-12T13:00:00Z 2026-11-12T14:00:00Z)" > "$ARBEIT/fake/jobs-4.json"
# Lauf 5: ein laufender Job (zählt als gestartet, ohne Minuten) und ein wartender (zählt nicht).
printf '{"jobs":[%s,%s]}\n' \
  "$(job_json e2e-Binary null 2026-11-12T15:00:00Z null)" \
  "$(job_json 'e2e 1/4' null null null)" > "$ARBEIT/fake/jobs-5.json"

messen() {
  MESSUNG_GH="$ARBEIT/gh" MESSUNG_FAKE="$ARBEIT/fake" GITHUB_REPOSITORY=test/repo \
    "$SKRIPT_UNTER_TEST" --von 2026-11-12T00:00:00Z --bis 2026-11-13T00:00:00Z "$@"
}

echo "==> ci-messung"
aus="$(messen)"
zeile() { printf '%s\n' "$aus" | grep -F "| $1 |" | head -1 | tr -s ' '; }
pruefe "1 Branch a: Läufe, abgebrochen, rot, grün, laufend, Jobs, Job-Minuten" \
  "| a | 3 | 1 | 0 | 2 | 0 | 8 | 360 |" "$(zeile a)"
pruefe "2 Branch b: laufender Lauf und laufender Job" \
  "| b | 2 | 0 | 1 | 0 | 1 | 2 | 5 |" "$(zeile b)"
pruefe "3 Summe" "| Summe (2 PRs) | 5 | 1 | 1 | 2 | 1 | 10 | 365 |" "$(zeile 'Summe (2 PRs)')"
pruefe "4 Zeitraum steht in der Abfrage" 2 "$(grep -c 'created=2026-11-12T00:00:00Z\.\.2026-11-13T00:00:00Z' "$ARBEIT/fake/log")"
pruefe "5 nur PR-Läufe" 2 "$(grep -c 'event=pull_request' "$ARBEIT/fake/log")"

# Vor der Zweiteilung gibt es e2e.yml nicht: die Messung läuft mit ci.yml allein weiter.
mv "$ARBEIT/fake/laeufe-e2e.yml.json" "$ARBEIT/fake/weg.json"
aus="$(messen 2> "$ARBEIT/fehler")"
pruefe "6 ohne e2e.yml: nur ci.yml" "| Summe (2 PRs) | 3 | 1 | 1 | 1 | 0 | 4 | 65 |" "$(zeile 'Summe (2 PRs)')"
pruefe "6b und sagt es" 1 "$(grep -c 'e2e.yml' "$ARBEIT/fehler")"
mv "$ARBEIT/fake/weg.json" "$ARBEIT/fake/laeufe-e2e.yml.json"

code=0
MESSUNG_GH="$ARBEIT/gh" MESSUNG_FAKE="$ARBEIT/fake" GITHUB_REPOSITORY=test/repo \
  "$SKRIPT_UNTER_TEST" --von 2026-11-12T00:00:00Z > /dev/null 2>&1 || code=$?
pruefe "7 ohne --bis: Aufruffehler" 2 "$code"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ci-messung." >&2
  exit 1
fi
echo "==> OK: Selbsttest ci-messung."
