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
    sha="${pfad#repos/test/repo/commits/}"; sha="${sha%%/*}"
    if [ -f "$F/checks-$sha.json" ]; then aus < "$F/checks-$sha.json"; else echo '{"total_count":0,"check_runs":[]}' | aus; fi ;;
  "POST repos/test/repo/check-runs")
    n=$(( $(cat "$F/naechste-id" 2> /dev/null || echo 900) + 1 )); echo "$n" > "$F/naechste-id"
    echo "POST ${feld[head_sha]} ${feld[status]} ${feld[name]}" >> "$F/log"
    printf '%s\n' "${feld[output_summary]:-}" > "$F/text-$n"
    printf '{"id":%s}\n' "$n" | aus ;;
  "PATCH repos/test/repo/check-runs/"*)
    id="${pfad##*/}"
    echo "PATCH $id ${feld[conclusion]:-${feld[status]:-}}" >> "$F/log"
    printf '%s\n%s\n' "${feld[output_summary]:-}" "${feld[output_text]:-}" > "$F/text-$id"
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
        head: {sha: $kopf, repo: {full_name: $repo}}, base: {ref: "alpha"}}')"
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
lauf() { # <fake> <args…>  → stdout nach $ARBEIT/ausgabe
  local f="$1" code=0
  shift
  ZBB_FAKE="$f" "$SKRIPT_UNTER_TEST" "$@" > "$ARBEIT/ausgabe" 2> "$ARBEIT/fehler" || code=$?
  [ "$code" = 0 ] || { echo "  FEHL Lauf endete mit Exit $code:" >&2; sed 's/^/       /' "$ARBEIT/fehler" >&2; fehler=$((fehler + 1)); }
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

echo "==> Baut mit Ziel-Branch: Auswahl nach einem Push auf alpha"

# 1 — Fertig ist, wer Auto-Merge oder das Label e2e hat. Entwürfe und Forks rechnen nie.
f="$(neu push)"
printf '%s\n' \
  '1|k1|false|false|true|' \
  '2|k2|false|false|false|e2e' \
  '3|k3|false|false|false|' \
  '4|k4|false|false|false|anderes' \
  '5|k5|true|false|false|e2e' \
  '6|k6|false|true|true|' | prs "$f"
hat_check "$f" k3 completed
lauf "$f" auswahl alpha zielsha
pruefe "1 fertige PRs rechnen, in Nummernfolge" "1:k1:901 2:k2:902" "$(liste)"
pruefe "1 läuft an den fertigen, wartet am nicht fertigen mit Check" \
  "POST k1 in_progress Baut mit Ziel-Branch;POST k2 in_progress Baut mit Ziel-Branch;POST k3 queued Baut mit Ziel-Branch" \
  "$(log "$f")"

# 2 — Wartet schon: kein zweiter Eintrag.
f="$(neu wartetschon)"
printf '%s\n' '3|k3|false|false|false|' | prs "$f"
hat_check "$f" k3 queued
lauf "$f" auswahl alpha zielsha
pruefe "2 wartet schon: nichts" "" "$(log "$f")"
pruefe "2 nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"

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

# 5 — Fork, fertig markiert: nie.
f="$(neu prfork)"
printf '%s\n' '7|k7|false|true|true|' | prs "$f"
lauf "$f" auswahl alpha zielsha 7
pruefe "5 Fork: nichts zu rechnen" "[]" "$(jq -c . "$ARBEIT/ausgabe")"

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
pruefe "8 Konflikt als Grund" 1 "$(grep -c 'Konflikt' "$f/text-901")"

# 9 — Der Ziel-Branch ist inzwischen weiter: das Ergebnis ist überholt, nicht grün.
f="$(neu zielweiter)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo neuerezielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "9 Ziel-Branch weiter: überholt" "PATCH 901 cancelled" "$(log "$f")"

# 10 — Der PR hat einen neuen Kopf: überholt.
f="$(neu kopfweiter)"
printf '%s\n' '7|k7neu|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha gruen "$ARBEIT/ausgabe-baut"
pruefe "10 PR-Kopf weiter: überholt" "PATCH 901 cancelled" "$(log "$f")"

# 11 — Kein Ergebnis (Kompilierlauf abgebrochen oder ohne Ausgabe): rot, nie grün.
f="$(neu ohneergebnis)"
printf '%s\n' '7|k7|false|false|true|' | prs "$f"
echo zielsha > "$f/ref-alpha"
lauf "$f" melden 7 k7 901 alpha zielsha "" "$ARBEIT/gibtsnicht"
pruefe "11 ohne Ergebnis: rot" "PATCH 901 failure" "$(log "$f")"

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
K="$(job kompilieren)" A="$(job auswahl)" M="$(job melden)"
pruefe "F1 kompilieren darf nur lesen" "contents: read" "$(rechte kompilieren | tr '\n' ' ' | sed 's/ $//')"
form "F2 kompilieren ohne Secrets" 1 hat "$K" 'secrets\.'
form "F3 rust-cache in kompilieren speichert nie" 0 hat "$K" 'save-if: false'
form "F4 kein speichernder actions/cache in kompilieren" 1 hat "$K" 'actions/cache@'
form "F4 mise ohne Cache in kompilieren" 0 hat "$K" 'cache: false'
form "F5 Checkout in kompilieren ohne Zugangsdaten" 0 hat "$K" 'persist-credentials: false'
pruefe "F6 das Token sieht in kompilieren nur der Fetch" 1 "$(grep -c 'github.token' <<< "$K")"
for j in auswahl melden; do
  b="$(job "$j")"
  form "F7 $j kompiliert nichts" 1 hat "$b" 'check-all\.sh'
  form "F7 $j holt keinen PR-Kopf" 1 hat "$b" 'refs/pull/'
  form "F7 $j mergt nichts" 1 hat "$b" 'git merge'
done
form "F8 melden läuft auch nach rotem Kompilieren" 0 hat "$M" "if: .*!cancelled\(\)"
form "F9 Einschalten von Auto-Merge löst aus" 0 hat "$(cat "$WF")" 'types: \[.*auto_merge_enabled'
form "F9 Label löst aus" 0 hat "$(cat "$WF")" 'types: \[.*labeled'
form "F10 ältere Läufe brechen ab" 0 hat "$(cat "$WF")" 'cancel-in-progress: true'

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest von ziel-branch-build.sh." >&2
  exit 1
fi
echo "==> OK: Selbsttest von ziel-branch-build.sh."
