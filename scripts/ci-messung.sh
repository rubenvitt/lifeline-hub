#!/usr/bin/env bash
# LLH-1662: Was kostet die PR-CI? Läufe und Jobs je PR-Branch über einen Zeitraum.
#
#   scripts/ci-messung.sh --von <zeit> --bis <zeit> [--workflow <datei>]…
#       <zeit> als ISO 8601 in UTC (2026-11-12T00:00:00Z). Vorgabe für --workflow: ci.yml und
#       e2e.yml. Gibt eine Markdown-Tabelle aus: je Kopf-Branch Läufe, davon abgebrochen, rot,
#       grün, laufend, gestartete Jobs und Job-Minuten, darunter die Summe.
#   Exit 2 = Aufruf- oder Umgebungsfehler
#   Umgebung: GITHUB_REPOSITORY (<owner>/<repo>)
#             MESSUNG_GH  Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#
# WARUM: Die Grenze der CI ist die Zahl gleichzeitiger Jobs, nicht Geld. Die zweistufige PR-CI
# (`e2e.yml`) soll Läufe und vor allem Jobs je PR senken; vorher und nachher werden mit demselben
# Skript gemessen (Change `k133wmg6-zweistufige-ci`).
#
# GEZÄHLT: nur Läufe mit Ereignis `pull_request`, deren Start im Zeitraum liegt. Ein Job zählt als
# gestartet, wenn er einen Startzeitpunkt hat und nicht übersprungen ist; ein Job, der nur leer
# durchläuft, belegt auch einen Runner und zählt mit. Job-Minuten nur von fertigen Jobs. Ein
# Workflow, den es im Zeitraum noch nicht gab (vor der Zweiteilung `e2e.yml`), fehlt mit Hinweis.
set -euo pipefail

von="" bis="" workflows=()
while [ $# -gt 0 ]; do
  case "$1" in
    --von) von="${2:-}"; shift 2 ;;
    --bis) bis="${2:-}"; shift 2 ;;
    --workflow) workflows+=("${2:-}"); shift 2 ;;
    *) sed -n '4,9p' "$0" >&2; exit 2 ;;
  esac
done
[ -n "$von" ] && [ -n "$bis" ] || { sed -n '4,9p' "$0" >&2; exit 2; }
[ -n "${GITHUB_REPOSITORY:-}" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
command -v jq > /dev/null || { echo "FEHLER: jq fehlt." >&2; exit 2; }
[ "${#workflows[@]}" -gt 0 ] || workflows=(ci.yml e2e.yml)

gh_api() { "${MESSUNG_GH:-gh}" api "$@"; }
REPO="$GITHUB_REPOSITORY"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Je Lauf eine Zeile: <branch> <status> <conclusion> <jobs gestartet> <job-sekunden>
: > "$tmp/laeufe"
for wf in "${workflows[@]}"; do
  if ! gh_api "repos/$REPO/actions/workflows/$wf/runs?event=pull_request&created=$von..$bis&per_page=100" \
    --paginate > "$tmp/seiten" 2> "$tmp/fehler"; then
    echo "Hinweis: keine Läufe von $wf abrufbar ($(head -1 "$tmp/fehler")), wird ausgelassen." >&2
    continue
  fi
  jq -r -s '.[].workflow_runs[] | [.id, .head_branch, .status, (.conclusion // "-")] | @tsv' \
    "$tmp/seiten" > "$tmp/liste"
  while IFS=$'\t' read -r id branch status ergebnis; do
    gh_api "repos/$REPO/actions/runs/$id/jobs?filter=all&per_page=100" --paginate > "$tmp/jobs"
    jq -r -s --arg b "$branch" --arg s "$status" --arg e "$ergebnis" '
      def zeit: sub("\\.[0-9]+"; "") | fromdateiso8601;
      [.[].jobs[] | select(.started_at != null and .conclusion != "skipped")] as $gestartet
      | [$gestartet[] | select(.completed_at != null)
          | (.completed_at | zeit) - (.started_at | zeit)] as $dauer
      | [$b, $s, $e, ($gestartet | length), ($dauer | add // 0)] | @tsv' "$tmp/jobs" >> "$tmp/laeufe"
  done < "$tmp/liste"
done

awk -F'\t' '
  function zeile(name, k) {
    printf "| %s | %d | %d | %d | %d | %d | %d | %d |\n", name, n[k], ab[k], rot[k], gruen[k], \
      laeuft[k], jobs[k], sek[k] / 60
  }
  {
    k = $1
    if (!(k in n)) { reihe[++zahl] = k }
    n[k]++; n[""]++
    if ($2 != "completed") { laeuft[k]++; laeuft[""]++ }
    else if ($3 == "cancelled") { ab[k]++; ab[""]++ }
    else if ($3 == "success") { gruen[k]++; gruen[""]++ }
    else if ($3 == "failure" || $3 == "timed_out" || $3 == "startup_failure") { rot[k]++; rot[""]++ }
    jobs[k] += $4; jobs[""] += $4; sek[k] += $5; sek[""] += $5
  }
  END {
    print "| Branch | Läufe | abgebrochen | rot | grün | laufend | Jobs | Job-Minuten |"
    print "| --- | --- | --- | --- | --- | --- | --- | --- |"
    for (i = 1; i <= zahl; i++) zeile(reihe[i], reihe[i])
    zeile("Summe (" zahl " PRs)", "")
  }' "$tmp/laeufe"
