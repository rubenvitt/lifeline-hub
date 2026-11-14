#!/usr/bin/env bash
# Selbsttest für scripts/ziel-branch-build.sh (LLH-1849), die Auswahl und Meldung des Checks
# „Baut mit Ziel-Branch“. Irrt die Auswahl, rechnet der Check an einem fertigen PR nicht neu, und
# ein veraltetes Grün mergt (der Fall vom 12.11.2026); irrt die Meldung, steht ein Ergebnis gegen
# einen alten Stand als jüngstes am PR, oder ein Fork bekommt den Check grün.
#
# Gefahren gegen eine Attrappe für `gh` (ZBB_GH), die PRs, Branch-Spitzen und Check-Runs aus
# Dateien liefert und jeden Schreibzugriff mitschreibt.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/ziel-branch-build.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
export GITHUB_REPOSITORY=test/repo
export ZBB_WARTEN=0 # `melden` wartet bei „überholt“ nicht wirklich auf einen Nachfolger

# ── Attrappe für gh ──────────────────────────────────────────────────────────────────
# Zustand unter $ZBB_FAKE: pulls.json, pull-<nr>.json, ref-<branch> (Spitze), checks-<sha>.json,
# log (eine Zeile je Schreibzugriff: "POST <sha> <status>" oder "PATCH <id> <conclusion>").
cat > "$ARBEIT/gh" <<'ATTRAPPE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "Attrappe kennt nur 'api'" >&2; exit 1; }
shift
methode=GET pfad="" filter="."
declare -A feld=()
while [ $# -gt 0 ]; do
  case "$1" in
    -X) methode="$2"; shift 2 ;;
    --paginate) shift ;;
    --jq) filter="$2"; shift 2 ;;
    # `output[summary]` heißt hier `output_summary`: Klammern im Schlüssel liest Bash falsch.
    -f) k="${2%%=*}"; k="${k//[/_}"; k="${k//]/}"; feld["$k"]="${2#*=}"; shift 2 ;;
    *) pfad="$1"; shift ;;
  esac
done
F="$ZBB_FAKE"
aus() { jq -r "$filter"; }
case "$methode $pfad" in
  "GET repos/test/repo/pulls?"*) cat "$F/pulls.json" | aus ;;
  "GET repos/test/repo/pulls/"*)
    nr="${pfad##*/}"
    [ -f "$F/pull-$nr.json" ] || { echo "HTTP 404" >&2; exit 1; }
    aus < "$F/pull-$nr.json" ;;
  "GET repos/test/repo/git/ref/heads/"*)
    b="${pfad#repos/test/repo/git/ref/heads/}"
    printf '{"object":{"sha":"%s"}}\n' "$(cat "$F/ref-$b")" | aus ;;
  "GET repos/test/repo/commits/"*"/check-runs"*)
    [ ! -e "$F/checkruns-kaputt" ] || { echo "HTTP 502" >&2; exit 1; }
    sha="${pfad#repos/test/repo/commits/}"; sha="${sha%%/*}"
    # Wie GitHub: ohne `filter=all` je Name nur der jüngste Run (alle Runs der Checks-API liegen in
    # einer Suite; LLH-1889, Review: ohne das prüfte Fall 16 nichts).
    if [ -f "$F/checks-$sha.json" ]; then
      case "$pfad" in
        *filter=all*) aus < "$F/checks-$sha.json" ;;
        *) jq '.check_runs |= [group_by(.name)[] | max_by(.id)]' "$F/checks-$sha.json" | aus ;;
      esac
    else echo '{"total_count":0,"check_runs":[]}' | aus; fi ;;
  "POST repos/test/repo/actions/workflows/ziel-branch-build.yml/dispatches")
    [ ! -e "$F/dispatch-kaputt" ] || { echo "HTTP 422 Workflow does not have 'workflow_dispatch' trigger" >&2; exit 1; }
    [ ! -e "$F/dispatch-502" ] || { echo "HTTP 502 Bad Gateway" >&2; exit 1; }
    echo "DISPATCH ${feld[ref]} ${feld[inputs_nr]} ${feld[inputs_kopf]} ${feld[inputs_check_id]} ${feld[inputs_ziel_sha]}" >> "$F/log" ;;
  "GET repos/test/repo/actions/workflows/ziel-branch-build.yml/runs?"*)
    if [ -f "$F/pushlaeufe.json" ]; then aus < "$F/pushlaeufe.json"; else echo '{"workflow_runs":[]}' | aus; fi ;;
  "GET repos/test/repo/compare/"*)
    if [ -f "$F/compare.json" ]; then aus < "$F/compare.json"; else
      echo '{"status":"ahead","commits":[{"commit":{"message":"feat: etwas"}}]}' | aus; fi ;;
  "POST repos/test/repo/check-runs")
    [ ! -e "$F/post-kaputt-${feld[head_sha]}" ] || { echo "HTTP 502" >&2; exit 1; }
    n=$(( $(cat "$F/naechste-id" 2> /dev/null || echo 900) + 1 )); echo "$n" > "$F/naechste-id"
    echo "POST ${feld[head_sha]} ${feld[status]} ${feld[name]}" >> "$F/log"
    printf '%s\n' "${feld[output_summary]:-}" > "$F/text-$n"
    printf '%s\n' "${feld[external_id]:-}" > "$F/ext-$n"
    printf '{"id":%s}\n' "$n" | aus ;;
  "PATCH repos/test/repo/check-runs/"*)
    id="${pfad##*/}"
    echo "PATCH $id ${feld[conclusion]:-${feld[status]:-}}" >> "$F/log"
    [ -z "${feld[external_id]+x}" ] || printf '%s\n' "${feld[external_id]}" > "$F/ext-$id"
    printf '%s\n%s\n%s\n' "${feld[output_title]:-}" "${feld[output_summary]:-}" "${feld[output_text]:-}" > "$F/text-$id"
    echo '{}' | aus ;;
  *) echo "Attrappe: unbekannter Aufruf '$methode $pfad'" >&2; exit 1 ;;
esac
ATTRAPPE
chmod +x "$ARBEIT/gh"
export ZBB_GH="$ARBEIT/gh"

neu() { # <name> → Verzeichnis der Attrappe
  local f="$ARBEIT/$1"
  mkdir -p "$f"; : > "$f/log"
  printf '%s\n' "$f"
}
# PRs gegen alpha: Zeilen "<nr>|<kopf>|<entwurf>|<fork>|<auto-merge true|false>|<labels>".
prs() { # <fake>
  local nr kopf entwurf fork am labels repo json='[]' eintrag
  while IFS='|' read -r nr kopf entwurf fork am labels; do
    repo=test/repo; [ "$fork" = true ] && repo=jemand/repo
    eintrag="$(jq -n --argjson nr "$nr" --arg kopf "$kopf" --argjson entwurf "$entwurf" \
      --arg repo "$repo" --argjson am "$am" --arg labels "$labels" \
      '{number: $nr, draft: $entwurf, auto_merge: (if $am then {merge_method: "merge"} else null end),
        labels: ($labels | split(",") | map(select(length > 0) | {name: .})),
        head: {ref: ("zweig" + ($nr | tostring)), sha: $kopf, repo: {full_name: $repo}}, base: {ref: "alpha"}}')"
    printf '%s\n' "$eintrag" > "$1/pull-$nr.json"
    json="$(jq --argjson e "$eintrag" '. + [$e]' <<< "$json")"
  done
  printf '%s\n' "$json" > "$1/pulls.json"
}
# Ein vorhandener Check-Run „Baut mit Ziel-Branch“ auf <sha> mit <status>.
hat_check() { # <fake> <sha> <status>
  printf '{"total_count":1,"check_runs":[{"id":1,"name":"Baut mit Ziel-Branch","status":"%s"}]}\n' "$3" \
    > "$1/checks-$2.json"
}
# Mehrere Check-Runs „Baut mit Ziel-Branch“ auf <sha>, je Argument
# "<id>:<status>[:<conclusion>:<external_id>[:<titel>]]" (external_id: der gerechnete Ziel-Stand).
checks_auf() { # <fake> <sha> <id:status[:conclusion:external_id[:titel]]>…
  local f="$1" sha="$2" json='[]' e id st fz ext titel
  shift 2
  for e in "$@"; do
    IFS=: read -r id st fz ext titel <<< "$e"
    json="$(jq -c --argjson id "$id" --arg st "$st" --arg fz "$fz" --arg ext "$ext" --arg titel "$titel" \
      '. + [{id: $id, name: "Baut mit Ziel-Branch", status: $st,
             conclusion: (if $fz == "" then null else $fz end), external_id: $ext,
             output: {title: (if $titel == "" then "Titel " + ($id | tostring) else $titel end),
                      summary: ("Text " + ($id | tostring)), text: ("Ausgabe " + ($id | tostring))}}]' <<< "$json")"
  done
  jq -n --argjson r "$json" '{total_count: ($r | length), check_runs: $r}' > "$f/checks-$sha.json"
}
lauf() { # <fake> <args…>  → stdout nach $ARBEIT/ausgabe; ZBB_EXIT: erwarteter Exit (Vorgabe 0)
  local f="$1" code=0
  shift
  ZBB_FAKE="$f" "$SKRIPT_UNTER_TEST" "$@" > "$ARBEIT/ausgabe" 2> "$ARBEIT/fehler" || code=$?
  [ "$code" = "${ZBB_EXIT:-0}" ] || { echo "  FEHL Lauf endete mit Exit $code:" >&2; sed 's/^/       /' "$ARBEIT/fehler" >&2; fehler=$((fehler + 1)); }
}
pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    sed 's/^/         /' "$ARBEIT/fehler" >&2 2> /dev/null || true
    fehler=$((fehler + 1))
  fi
}
log() { tr '\n' ';' < "$1/log" | sed 's/;$//'; }
liste() { jq -r -c '[.[] | "\(.nr):\(.kopf):\(.check_id)"] | join(" ")' "$ARBEIT/ausgabe"; }

echo "==> Baut mit Ziel-Branch: Verteilen nach einem Push auf alpha"

# 1 — Fertig ist, wer Auto-Merge oder das Label e2e hat. Ein fertiger PR bekommt den Check auf
# „läuft“ und einen eigenen Lauf auf seinem Branch (der Push-Lauf kompiliert nie selbst). Ein
# nicht fertiger mit Check wartet, auch ein Entwurf. Forks rechnen nie.
f="$(neu push)"
printf '%s\n' \
  '1|k1|false|false|true|' \
  '2|k2|false|false|false|e2e' \
  '3|k3|false|false|false|' \
  '4|k4|false|false|false|anderes' \
  '5|k5|true|false|false|e2e' \
  '6|k6|false|true|true|' | prs "$f"
hat_check "$f" k3 completed
hat_check "$f" k5 completed
lauf "$f" verteilen alpha zielsha
pruefe "1 verteilen: Check trägt den Ziel-Stand" "zielsha" "$(cat "$f/ext-901")"
pruefe "1 läuft und eigener Lauf an den fertigen, wartet an den übrigen mit Check" \
  "POST k1 in_progress Baut mit Ziel-Branch;DISPATCH zweig1 1 k1 901 zielsha;POST k2 in_progress Baut mit Ziel-Branch;DISPATCH zweig2 2 k2 902 zielsha;POST k3 queued Baut mit Ziel-Branch;POST k5 queued Baut mit Ziel-Branch" \
  "$(log "$f")"

# 1b — Der Branch kennt den Workflow noch nicht (kein Einzellauf möglich): Check rot mit Grund.
f="$(neu ohneworkflow)"
printf '%s\n' '1|k1|false|false|true|' | prs "$f"
touch "$f/dispatch-kaputt"
lauf "$f" verteilen alpha zielsha
pruefe "1b ohne Einzellauf: Check rot" "POST k1 in_progress Baut mit Ziel-Branch;PATCH 901 failure" "$(log "$f")"
pruefe "1b Grund nennt das Einmergen" 1 "$(grep -c 'hineinmergen' "$f/text-901")"

# 1d — Ein anderer Fehler beim Start (502): kein Rat zum Einmergen, Check abgebrochen, Lauf rot.
f="$(neu dispatch502)"
printf '%s\n' '1|k1|false|false|true|' | prs "$f"
touch "$f/dispatch-502"
ZBB_EXIT=1 lauf "$f" verteilen alpha zielsha
pruefe "1d 502 beim Start: Check abgebrochen" "POST k1 in_progress Baut mit Ziel-Branch;PATCH 901 cancelled" "$(log "$f")"
pruefe "1d kein Rat zum Einmergen" 0 "$(grep -c 'hineinmergen' "$f/text-901" || true)"

# 1e — „wartet“ lässt sich nicht setzen: nicht still, der Lauf endet rot.
f="$(neu wartetkaputt)"
printf '%s\n' '3|k3|false|false|false|' | prs "$f"
hat_check "$f" k3 completed
touch "$f/post-kaputt-k3"
ZBB_EXIT=1 lauf "$f" verteilen alpha zielsha
pruefe "1e wartet gescheitert: Warnung" 1 "$(grep -c 'warning::PR #3' "$ARBEIT/ausgabe")"

# 1f — Die Checks eines nicht fertigen PRs sind nicht lesbar: nicht still „ohne Check“.
f="$(neu checkskaputt)"
printf '%s\n' '3|k3|false|false|false|' | prs "$f"
touch "$f/checkruns-kaputt"
ZBB_EXIT=1 lauf "$f" verteilen alpha zielsha
pruefe "1f Checks nicht lesbar: Warnung" 1 "$(grep -c 'warning::PR #3' "$ARBEIT/ausgabe")"

# 1c — Ein API-Fehler an einem PR hält die übrigen nicht auf; der Lauf endet rot.
f="$(neu teilfehler)"
printf '%s\n' '1|k1|false|false|true|' '2|k2|false|false|true|' '3|k3|false|false|true|' | prs "$f"
touch "$f/post-kaputt-k2"
ZBB_EXIT=1 lauf "$f" verteilen alpha zielsha
pruefe "1c PR 1 und 3 bekommen ihren Lauf trotz Fehler an PR 2" \
  "POST k1 in_progress Baut mit Ziel-Branch;DISPATCH zweig1 1 k1 901 zielsha;POST k3 in_progress Baut mit Ziel-Branch;DISPATCH zweig3 3 k3 902 zielsha" \
  "$(log "$f")"

# 2 — Wartet schon: kein zweiter Eintrag.
f="$(neu wartetschon)"
printf '%s\n' '3|k3|false|false|false|' | prs "$f"
hat_check "$f" k3 queued
lauf "$f" verteilen alpha zielsha
pruefe "2 wartet schon: nichts" "" "$(log "$f")"

echo "==> Baut mit Ziel-Branch: Auswahl bei einem PR-Ereignis"

# 3 — PR wird fertig: genau er rechnet.
f="$(neu prfertig)"
printf '%s\n' '7|k7|false|false|true|' '8|k8|false|false|true|' | prs "$f"
lauf "$f" auswahl alpha zielsha 7
pruefe "3 nur der PR des Ereignisses" "7:k7:901" "$(liste)"

# 4 — PR in Arbeit: nichts, der Check fehlt.
f="$(neu prinarbeit)"
printf '%s\n' '7|k7|false|false|false|' | prs "$f"
lauf "$f" auswahl alpha zielsha 7
pruefe "4 PR in Arbeit: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"
pruefe "4 PR in Arbeit: kein Check" "" "$(log "$f")"

# 4b — Nicht fertig, trägt aber ein altes Grün (wieder geöffnet, aus dem Entwurf geholt): wartet.
f="$(neu prwieder)"
printf '%s\n' '7|k7|false|false|false|' | prs "$f"
hat_check "$f" k7 completed
lauf "$f" auswahl alpha zielsha 7
pruefe "4b altes Grün an nicht fertigem PR: wartet" "POST k7 queued Baut mit Ziel-Branch" "$(log "$f")"

# 5 — Fork, fertig markiert: nie.
f="$(neu prfork)"
printf '%s\n' '7|k7|false|true|true|' | prs "$f"
lauf "$f" auswahl alpha zielsha 7
pruefe "5 Fork: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"

echo "==> Baut mit Ziel-Branch: Einzellauf"

# 13 — Einzellauf auf dem Branch des PRs: ein frischer Check rechnet. Den von `verteilen` schließt
# er NICHT als abgebrochen (LLH-1889: das zeigte den PR rot); der jüngere frische Check löst ihn ab.
f="$(neu einzel)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "13 Einzellauf: frischer Check läuft, der alte bleibt offen" \
  "POST k7 in_progress Baut mit Ziel-Branch" "$(log "$f")"
pruefe "13 Einzellauf rechnet den PR" "7:k7:901" "$(liste)"

# 13b — Derselbe Ziel-Stand ist auf diesem Kopf schon gerechnet (der wartende Lauf las ihn, bevor
# `verteilen` dafür dispatchte; LLH-1889, Review): kein dritter Lauf, der Check von `verteilen`
# übernimmt das Ergebnis.
f="$(neu einzelschongerechnet)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
checks_auf "$f" k7 '700:completed:failure:altersha' '850:completed:success:zielsha' '800:in_progress'
lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "13b schon gerechnet: Ergebnis übernommen, nichts zu rechnen" "PATCH 800 success" "$(log "$f")"
pruefe "13b schon gerechnet: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"
pruefe "13b Titel übernommen" "Titel 850" "$(head -1 "$f/text-800")"
pruefe "13b Fehlerausgabe übernommen" 1 "$(grep -c 'Ausgabe 850' "$f/text-800")"
pruefe "13b Check trägt den Stand" "zielsha" "$(cat "$f/ext-800")"

# 13f — Ein Neustart des Laufs (Versuch 2) übernimmt nichts: wer neu startet, will neu rechnen.
f="$(neu einzelneustart)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
checks_auf "$f" k7 '850:completed:failure:zielsha:Baut nicht mit alpha zielsha' '800:in_progress'
GITHUB_RUN_ATTEMPT=2 lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "13f Neustart: rechnet" "POST k7 in_progress Baut mit Ziel-Branch" "$(log "$f")"

# 13c — Gerechnet nur gegen einen anderen Stand, oder abgebrochen: rechnen wie immer.
f="$(neu einzelanderstand)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
checks_auf "$f" k7 '850:completed:success:altersha' '860:completed:cancelled:zielsha' '800:in_progress'
lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "13c anderer Stand: rechnet" "POST k7 in_progress Baut mit Ziel-Branch" "$(log "$f")"

# 13d — Der PR hat seit `verteilen` einen neuen Kopf: der Check von `verteilen` steht am alten Kopf
# und bekommt kein fremdes Ergebnis; der neue Kopf rechnet.
f="$(neu einzelneuerkopf)"
printf '%s\n' '7|k7neu|false|false|true|' | prs "$f"
checks_auf "$f" k7neu '850:completed:success:zielsha'
lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "13d neuer Kopf: kein PATCH am alten Check" "" "$(grep '^PATCH' "$f/log" || true)"
pruefe "13d neuer Kopf: rechnet" "7:k7neu:901" "$(liste)"

# 13e — Der neue Check trägt den gerechneten Stand (external_id), damit 13b ihn findet.
pruefe "13e external_id ist der Ziel-Stand" "zielsha" "$(cat "$ARBEIT/einzel/ext-901")"

# 14 — Einzellauf auf einem Kanal-Branch (von Hand ohne --ref gestartet): nie rechnen.
f="$(neu einzelalpha)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
lauf "$f" einzellauf 7 alpha 800 k7 alpha zielsha
pruefe "14 Einzellauf auf alpha: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"

# 14b — Auch wenn der Kopf-Branch des PRs selbst ein Kanal-Branch ist (PR alpha → main).
f="$(neu einzelkanal)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
jq '.[0].head.ref = "alpha"' "$f/pulls.json" > "$f/p.neu" && mv "$f/p.neu" "$f/pulls.json"
jq '.head.ref = "alpha"' "$f/pull-7.json" > "$f/p.neu" && mv "$f/p.neu" "$f/pull-7.json"
lauf "$f" einzellauf 7 alpha 800 k7 alpha zielsha
pruefe "14b Kopf ist Kanal-Branch: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"
f="$(neu einzel)"

# 15 — Einzellauf auf einem fremden Branch oder für einen Fork: nie rechnen.
lauf "$f" einzellauf 7 anderer-zweig 800 k7 alpha zielsha
pruefe "15 Ref passt nicht zum PR: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"
f="$(neu einzelfork)"
printf '%s\n' '7|k7|false|true|true|' | prs "$f"
lauf "$f" einzellauf 7 zweig7 800 k7 alpha zielsha
pruefe "15 Fork: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"

echo "==> Baut mit Ziel-Branch: Meldung"

# 6 — Grün, Stand aktuell: der Check wird grün.
f="$(neu gruen)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
echo "alles kompiliert" > "$ARBEIT/ausgabe-baut"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "6 grün: Check grün" "PATCH 901 success" "$(log "$f")"

# 7 — Rot: der Check wird rot und trägt die Fehlerausgabe.
f="$(neu rot)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
printf 'error[E0061]: this function takes 5 arguments but 4 arguments were supplied\n' > "$ARBEIT/ausgabe-baut"
lauf "$f" melden 7 k7 901 alpha zielsha rot "$ARBEIT/ausgabe-baut"
pruefe "7 rot: Check rot" "PATCH 901 failure" "$(log "$f")"
pruefe "7 rot: Fehlerausgabe im Check" 1 "$(grep -c 'E0061' "$f/text-901")"

# 8 — Konflikt: rot mit Grund.
f="$(neu konflikt)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
: > "$ARBEIT/ausgabe-baut"
lauf "$f" melden 7 k7 901 alpha zielsha konflikt "$ARBEIT/ausgabe-baut"
pruefe "8 Konflikt: Check rot" "PATCH 901 failure" "$(log "$f")"
pruefe "8 Konflikt als Grund" 1 "$(sed -n 2p "$f/text-901" | grep -c 'Konflikt')"

# 9 — Der Ziel-Branch ist inzwischen weiter: das Ergebnis ist überholt, nicht grün. Der Check
# bleibt auf „läuft“, sobald ein jüngerer Check am Kopf steht (LLH-1889: abgebrochen zeigte den PR
# rot); GitHub wertet nur den jüngsten.
f="$(neu zielweiter)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
checks_auf "$f" k7 '901:in_progress' '950:in_progress'
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9 Ziel-Branch weiter, Nachfolger da: Check läuft weiter" "PATCH 901 in_progress" "$(log "$f")"
pruefe "9 überholt steht im Check" 1 "$(grep -c 'inzwischen steht einer davon weiter' "$f/text-901")"

# 9c — Überholt, aber es erscheint kein jüngerer Check (der Merge war nur ein Release-Commit und
# der Vergleich scheiterte, oder `verteilen` brach ab): nicht still „läuft“ für immer, sondern rot
# mit dem Rat, neu zu starten (Review LLH-1889). ZBB_WARTEN=0: nur einmal nachsehen.
f="$(neu ohnenachfolger)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
checks_auf "$f" k7 '850:in_progress' '901:in_progress'
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9c kein Nachfolger: rot" "PATCH 901 failure" "$(log "$f")"
pruefe "9c Rat: neu starten" 1 "$(grep -c 'neu starten' "$f/text-901")"
pruefe "9c Stand gelöscht" "" "$(cat "$f/ext-901" 2> /dev/null || echo fehlt)"

# 9d — Kein jüngerer Check, aber der Push-Lauf zum neuen Stand wartet noch auf einen Runner: nicht
# rot, der Lauf bringt den Nachfolger (Review LLH-1889).
f="$(neu verteilenwartet)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
checks_auf "$f" k7 '901:in_progress'
echo '{"workflow_runs":[{"status":"queued"}]}' > "$f/pushlaeufe.json"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9d verteilen wartet noch: Check läuft weiter" "PATCH 901 in_progress" "$(log "$f")"
f="$(neu nachfolgerkaputt)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
touch "$f/checkruns-kaputt"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9c Checks nicht lesbar: rot statt hängen" "PATCH 901 failure" "$(log "$f")"

# 9b — alpha ist nur um einen Release-Commit weiter ([skip ci], startet keinen Lauf): das Ergebnis
# gilt, sonst hinge der PR bis zum nächsten Merge.
f="$(neu nurrelease)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
echo '{"status":"ahead","commits":[{"commit":{"message":"chore(release): 1.0.0-alpha.189 [skip ci]\n\nNotizen"}}]}' > "$f/compare.json"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9b nur Release-Commit dazu: Ergebnis gilt" "PATCH 901 success" "$(log "$f")"

# 10 — Der PR hat einen neuen Kopf: überholt. Der Check steht am alten Kopf, den der PR nicht
# mehr zeigt; er bleibt auf „läuft“, ohne auf einen Nachfolger zu warten.
f="$(neu kopfweiter)"
printf '%s\n' '7|k7neu|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "10 PR-Kopf weiter: überholt, Check läuft weiter" "PATCH 901 in_progress" "$(log "$f")"

# 16 — Ein gültiges Ergebnis schließt nur den eigenen Check. Ältere offene bleiben offen: GitHub
# wertet je Name den jüngsten (alle Checks-API-Runs liegen in einer Suite), sie zählen nicht mehr
# (Review LLH-1889; das frühere Mitschließen fand sie ohne `filter=all` nie).
f="$(neu aeltereoffen)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
checks_auf "$f" k7 '800:queued' '850:in_progress' '901:in_progress'
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "16 grün: nur der eigene Check" "PATCH 901 success" "$(log "$f")"

# 11 — Kein Ergebnis (Kompilierlauf abgebrochen oder ohne Ausgabe): rot, nie grün.
f="$(neu ohneergebnis)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha "" "$ARBEIT/gibtsnicht"
pruefe "11 ohne Ergebnis: rot" "PATCH 901 failure" "$(log "$f")"
# Ohne Ergebnis ist der Stand nicht gerechnet: der Check verliert seinen Stand, sonst übernähme ihn
# ein Neustart (Review LLH-1889).
pruefe "11 ohne Ergebnis: Stand gelöscht" "" "$(cat "$f/ext-901" 2> /dev/null || echo fehlt)"

# 12 — Ein unbekanntes Ergebnis wird nie grün.
f="$(neu unbekannt)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha "success" "$ARBEIT/ausgabe-baut"
pruefe "12 unbekanntes Ergebnis: rot" "PATCH 901 failure" "$(log "$f")"

echo "==> Baut mit Ziel-Branch: Form des Workflows"
# Die Sicherheit hängt an der Form: PR-Code läuft in `kompilieren`, auch bei einem Push auf alpha.
# Ein Schreibrecht, ein Secret oder ein speichernder Cache dort, oder PR-Code in `auswahl` oder
# `melden`, fiele erst auf, wenn es jemand ausnutzt. Gelesen ohne YAML-Parser wie in
# scripts/ci-stufen.test.sh: ein Job ist der Block ab `  <id>:` bis zum nächsten Job.
WF="${ZBB_WORKFLOW:-$(cd "$(dirname "$0")/.." && pwd)/.github/workflows/ziel-branch-build.yml}"
job() { # <id>
  awk -v id="$1" '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^ #]/ { in_jobs = 0 }
    in_jobs && /^  [A-Za-z0-9_-]+:[ ]*$/ { aktiv = ($0 == "  " id ":"); next }
    in_jobs && aktiv { print }
  ' "$WF"
}
# Der `permissions:`-Block eines Jobs, eine Zeile je Recht.
rechte() { job "$1" | awk '/^    permissions:/ { p = 1; next } p && /^      [a-z-]+:/ { gsub(/^ +/, ""); print; next } p { p = 0 }'; }
form() { # <name> <0|1 erwartet> <bedingung …>
  local name="$1" soll="$2" ist=1
  shift 2
  if "$@"; then ist=0; fi
  pruefe "$name" "$soll" "$ist"
}
hat() { grep -qE -- "$2" <<< "$1"; }
K="$(job kompilieren)" V="$(job verteilen)" M="$(job melden)" W="$(cat "$WF")"
anzahl() { grep -cE -- "$2" <<< "$1" || true; }
# Der Block eines `uses:`-Schritts bis zum nächsten Schritt, je Schritt eine Zeile (ohne Umbrüche).
schritte_mit() { # <job-block> <uses-muster>
  awk -v m="$2" '/^      - /{ if (b != "" && b ~ m) print b; b = "" } { b = b " " $0 } END { if (b ~ m) print b }' <<< "$1"
}
pruefe "F1 kompilieren darf nur lesen" "contents: read" "$(rechte kompilieren | tr '\n' ' ' | sed 's/ $//')"
form "F2 kompilieren ohne Secrets" 1 hat "$K" 'secrets\.'
pruefe "F3 jeder rust-cache in kompilieren speichert nie" 0 \
  "$(schritte_mit "$K" 'Swatinem/rust-cache@' | grep -vc 'save-if: false' || true)"
form "F4 kein speichernder actions/cache in kompilieren" 1 hat "$K" 'actions/cache(/save)?@'
pruefe "F4 jede mise-Action in kompilieren ohne Cache" 0 \
  "$(schritte_mit "$K" 'jdx/mise-action@' | grep -vc 'cache: false' || true)"
form "F5 Checkout in kompilieren ohne Zugangsdaten" 0 hat "$K" 'persist-credentials: false'
pruefe "F6 das Token sieht in kompilieren nur der Fetch" 1 "$(anzahl "$K" 'github.token')"
form "F11 kompilieren läuft nie im Push-Lauf" 0 hat "$K" "github.event_name != 'push' && needs.vorbereiten"
form "F12 kompilieren läuft nie auf einem Kanal-Branch" 0 hat "$K" 'contains\(fromJSON\(.\["main", "beta", "alpha"\].\), github.ref_name\)'
form "F12 der Einzellauf prüft PR und Ref" 0 hat "$(job vorbereiten)" 'ziel-branch-build.sh einzellauf'
form "F11 melden läuft nie im Push-Lauf" 0 hat "$M" "if: .*github.event_name != 'push'"
form "F11 verteilen läuft nur im Push-Lauf" 0 hat "$V" "if: \\$\\{\\{ github.event_name == 'push' \\}\\}"
for j in verteilen vorbereiten melden; do
  b="$(job "$j")"
  form "F7 $j kompiliert nichts" 1 hat "$b" 'check-all\.sh'
  form "F7 $j holt keinen PR-Kopf" 1 hat "$b" 'refs/pull/'
  form "F7 $j mergt nichts" 1 hat "$b" 'git merge'
done
form "F8 melden läuft auch nach rotem Kompilieren" 0 hat "$M" "if: .*!cancelled\(\)"
pruefe "F13 melden liest Actions (ausstehender Push-Lauf)" 1 "$(rechte melden | grep -cx 'actions: read')"
form "F9 Einschalten von Auto-Merge löst aus" 0 hat "$W" 'types: \[.*auto_merge_enabled'
form "F9 Label löst aus" 0 hat "$W" 'types: \[.*labeled'
form "F9 Einzellauf je PR möglich" 0 hat "$W" '^  workflow_dispatch:'
# LLH-1889: ein abgebrochener Lauf hinterließ „Kompilieren“ und „Melden“ abgebrochen am PR (rot).
# Ein neuer Anstoß ersetzt nur den wartenden Lauf.
form "F10 kein Lauf bricht einen laufenden ab" 0 hat "$W" '^  cancel-in-progress: false$'
form "F10 nirgends cancel-in-progress: true" 1 hat "$W" 'cancel-in-progress: true'

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest von ziel-branch-build.sh." >&2
  exit 1
fi
echo "==> OK: Selbsttest von ziel-branch-build.sh."
