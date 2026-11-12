#!/usr/bin/env bash
# LLH-1662: Was kostet die PR-CI? Läufe und Jobs je PR-Branch über einen Zeitraum.
#
#   scripts/ci-messung.sh --von <zeit> --bis <zeit> [--workflow <datei>]…
#       <zeit> als ISO 8601 in UTC (2026-11-12T00:00:00Z). Vorgabe für --workflow: ci.yml und
#       e2e.yml. Gibt eine Markdown-Tabelle aus: je Kopf-Branch Läufe, davon abgebrochen, rot,
#       grün, laufend, gestartete Jobs, Job-Minuten und Läufe ohne gestarteten Job, darunter die
#       Summe.
#   Exit 2 = Aufruf- oder Umgebungsfehler
#   Umgebung: GITHUB_REPOSITORY (<owner>/<repo>)
#             MESSUNG_GH  Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#
# WARUM: Die Grenze der CI ist die Zahl gleichzeitiger Jobs, nicht Geld. Die zweistufige PR-CI
# (`e2e.yml`) soll Läufe und vor allem Jobs je PR senken; vorher und nachher werden mit demselben
# Skript gemessen (Change `k133wmg6-zweistufige-ci`).
#
# GEZÄHLT: nur Läufe mit Ereignis `pull_request`, deren Start im Zeitraum liegt. Ein Job zählt als
# gestartet, wenn er einen Runner hatte (`runner_name`; `started_at` setzt die API auch für Jobs,
# die vor dem Start abgebrochen wurden oder noch warten). Ein Job, der nur leer durchläuft, belegt
# auch einen Runner und zählt mit. Job-Minuten nur von fertigen Jobs. Ein fertiger Lauf, dessen
# Jobs alle keinen Runner hatten (`e2e.yml` an einem nicht fertigen PR), zählt nur in der Spalte
# „ohne Job“, nicht als Lauf; ein Lauf ganz ohne Jobs (`startup_failure`) zählt nach seinem
# Abschluss. Nur `e2e.yml` darf in der Vorgabe fehlen (404, vor der Zweiteilung), mit Hinweis.
# Jeder andere Abruffehler, ein ausdrücklich genannter Workflow, den es nicht gibt, und eine
# Liste, die GitHub abschneidet (höchstens 1000 Läufe mit diesen Filtern), brechen mit Exit 2 ab:
# eine Tabelle, der still Läufe fehlen, belegte im Vergleich einen Rückgang, den es nicht gab.
set -euo pipefail

von="" bis="" workflows=()
nutzung() { sed -n '4,10p' "$0" >&2; exit 2; }
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] && [ -n "$2" ] || nutzung
  case "$1" in
    --von) von="$2" ;;
    --bis) bis="$2" ;;
    --workflow) workflows+=("$2") ;;
    *) nutzung ;;
  esac
  shift 2
done
[ -n "$von" ] && [ -n "$bis" ] || nutzung
[ -n "${GITHUB_REPOSITORY:-}" ] || { echo "FEHLER: GITHUB_REPOSITORY ist nicht gesetzt." >&2; exit 2; }
command -v jq > /dev/null || { echo "FEHLER: jq fehlt." >&2; exit 2; }
vorgabe=0
[ "${#workflows[@]}" -gt 0 ] || { workflows=(ci.yml e2e.yml); vorgabe=1; }

gh_api() { "${MESSUNG_GH:-gh}" api "$@"; }
REPO="$GITHUB_REPOSITORY"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Je Lauf eine Zeile: <branch> <status> <conclusion> <jobs gestartet> <job-sekunden> <jobs gesamt>
: > "$tmp/laeufe"
for wf in "${workflows[@]}"; do
  if ! gh_api "repos/$REPO/actions/workflows/$wf/runs?event=pull_request&created=$von..$bis&per_page=100" \
    --paginate > "$tmp/seiten" 2> "$tmp/fehler"; then
    if [ "$vorgabe" = 1 ] && [ "$wf" = e2e.yml ] && grep -q '404' "$tmp/fehler"; then
      echo "Hinweis: $wf gibt es im Repository (noch) nicht, wird ausgelassen." >&2
      continue
    fi
    echo "FEHLER: Läufe von $wf nicht abrufbar: $(head -1 "$tmp/fehler")" >&2
    exit 2
  fi
  jq -r -s '.[].workflow_runs[] | [.id, .head_branch, .status, (.conclusion // "-")] | @tsv' \
    "$tmp/seiten" > "$tmp/liste"
  erwartet="$(jq -s '.[0].total_count // 0' "$tmp/seiten")"
  gelesen="$(wc -l < "$tmp/liste" | tr -d ' ')"
  if [ "$gelesen" -lt "$erwartet" ]; then
    echo "FEHLER: $wf meldet $erwartet Läufe, geliefert hat GitHub $gelesen (höchstens 1000 je" >&2
    echo "        Abfrage). Den Zeitraum teilen." >&2
    exit 2
  fi
  while IFS=$'\t' read -r id branch status ergebnis; do
    gh_api "repos/$REPO/actions/runs/$id/jobs?filter=all&per_page=100" --paginate > "$tmp/jobs" \
      || { echo "FEHLER: Jobs von Lauf $id nicht abrufbar." >&2; exit 2; }
    jq -r -s --arg b "$branch" --arg s "$status" --arg e "$ergebnis" '
      def zeit: sub("\\.[0-9]+"; "") | fromdateiso8601;
      [.[].jobs[]] as $alle
      | [$alle[] | select((.runner_name // "") != "" and .conclusion != "skipped")] as $gestartet
      | [$gestartet[] | select(.completed_at != null)
          | (.completed_at | zeit) - (.started_at | zeit)] as $dauer
      | [$b, $s, $e, ($gestartet | length), ($dauer | add // 0), ($alle | length)] | @tsv' \
      "$tmp/jobs" >> "$tmp/laeufe"
  done < "$tmp/liste"
done

awk -F'\t' '
  function zeile(name, k) {
    printf "| %s | %d | %d | %d | %d | %d | %d | %d | %d |\n", name, n[k], ab[k], rot[k], gruen[k], \
      laeuft[k], jobs[k], sek[k] / 60, leer[k]
  }
  {
    k = $1
    if (!(k in gesehen)) { reihe[++zahl] = k; gesehen[k] = 1 }
    # Fertig, Jobs angelegt, aber keiner hatte einen Runner. Ein wartender Lauf zählt als laufend,
    # ein Lauf ganz ohne Jobs (startup_failure) nach seinem Abschluss.
    if ($4 == 0 && $6 > 0 && $2 == "completed") { leer[k]++; leer[""]++; next }
    n[k]++; n[""]++
    if ($2 != "completed") { laeuft[k]++; laeuft[""]++ }
    else if ($3 == "cancelled") { ab[k]++; ab[""]++ }
    else if ($3 == "success") { gruen[k]++; gruen[""]++ }
    else if ($3 == "failure" || $3 == "timed_out" || $3 == "startup_failure") { rot[k]++; rot[""]++ }
    jobs[k] += $4; jobs[""] += $4; sek[k] += $5; sek[""] += $5
  }
  END {
    print "| Branch | Läufe | abgebrochen | rot | grün | laufend | Jobs | Job-Minuten | ohne Job |"
    print "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    for (i = 1; i <= zahl; i++) zeile(reihe[i], reihe[i])
    zeile("Summe (" zahl + 0 " PRs)", "")
  }' "$tmp/laeufe"
