#!/usr/bin/env bash
# Selbsttest für scripts/stau-waechter.sh (LLH-1660). Der Wächter pusht mit einem Token, das auf
# `alpha` Bypass-Rechte hat, und schreibt Kommentare an jeden offenen PR. Irrt er, schreibt er
# auf fremde oder Ziel-Branches oder überschwemmt PRs mit Hinweisen; irrt er zur anderen Seite,
# bleibt der Stau so still wie vorher.
#
# Gefahren gegen echte Repositories im Temp-Verzeichnis mit einem Bare-Repo als `origin` (die
# Aussagen hängen an Merge und Push) und einer Attrappe für `gh` (STAU_GH), die Check-Runs,
# Status und Kommentare aus Dateien liefert und jeden Schreibzugriff mitschreibt.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/stau-waechter.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
TRAILER="Stau-Waechter: LLH-1660"
export GITHUB_REPOSITORY=test/repo

# ── Attrappe für gh ──────────────────────────────────────────────────────────────────
# Zustand unter $STAU_FAKE: checks/<sha>.json, status/<sha>, kommentare.json, zeitleiste.json, log.
cat > "$ARBEIT/gh" <<'ATTRAPPE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "Attrappe kennt nur 'api'" >&2; exit 1; }
shift
methode=GET pfad="" body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) methode="$2"; shift 2 ;;
    --paginate) shift ;;
    -f) body="${2#body=}"; shift 2 ;;
    *) pfad="$1"; shift ;;
  esac
done
F="$STAU_FAKE"
[ -f "$F/kommentare.json" ] || echo '[]' > "$F/kommentare.json"
art() { printf '%s' "$1" | sed -n -E '1s/^<!-- stau-waechter:([a-z0-9-]+):.*/\1/p'; }
case "$methode $pfad" in
  "GET repos/test/repo/commits/"*"/check-runs"*)
    sha="${pfad#repos/test/repo/commits/}"; sha="${sha%%/*}"
    if [ -f "$F/checks/$sha.json" ]; then cat "$F/checks/$sha.json"; else echo '{"check_runs":[]}'; fi ;;
  "GET repos/test/repo/commits/"*"/status")
    sha="${pfad#repos/test/repo/commits/}"; sha="${sha%%/*}"
    printf '{"state":"%s"}\n' "$(cat "$F/status/$sha" 2> /dev/null || echo success)" ;;
  "GET repos/test/repo/issues/"*"/comments"*)
    [ ! -e "$F/kommentare-kaputt" ] || { echo "HTTP 502" >&2; exit 1; }
    cat "$F/kommentare.json" ;;
  "GET repos/test/repo/pulls"*) cat "$F/pulls.json" ;;
  "GET repos/test/repo/issues/"*"/timeline"*)
    [ ! -e "$F/zeitleiste-kaputt" ] || { echo "HTTP 502" >&2; exit 1; }
    if [ -f "$F/zeitleiste.json" ]; then cat "$F/zeitleiste.json"; else echo '[]'; fi ;;
  "POST repos/test/repo/issues/"*"/comments")
    id=$(( $(jq 'map(.id) | max // 100' "$F/kommentare.json") + 1 ))
    jq --argjson id "$id" --arg body "$body" \
      '. + [{id: $id, body: $body, user: {login: "github-actions[bot]"}}]' "$F/kommentare.json" > "$F/k.neu"
    mv "$F/k.neu" "$F/kommentare.json"
    echo "POST $(art "$body")" >> "$F/log"
    echo '{}' ;;
  "PATCH repos/test/repo/issues/comments/"*)
    id="${pfad##*/}"
    jq --argjson id "$id" --arg body "$body" 'map(if .id == $id then .body = $body else . end)' \
      "$F/kommentare.json" > "$F/k.neu"
    mv "$F/k.neu" "$F/kommentare.json"
    echo "PATCH $(art "$body")" >> "$F/log"
    echo '{}' ;;
  "DELETE repos/test/repo/issues/comments/"*)
    id="${pfad##*/}"
    jq --argjson id "$id" 'map(select(.id != $id))' "$F/kommentare.json" > "$F/k.neu"
    mv "$F/k.neu" "$F/kommentare.json"
    echo "DELETE" >> "$F/log" ;;
  *) echo "Attrappe: unbekannter Aufruf '$methode $pfad'" >&2; exit 1 ;;
esac
ATTRAPPE
chmod +x "$ARBEIT/gh"
export STAU_GH="$ARBEIT/gh"

# ── Repositories ─────────────────────────────────────────────────────────────────────
einrichten() {
  git -C "$1" config user.email test@example.invalid
  git -C "$1" config user.name Test
  git -C "$1" config commit.gpgsign false
}

# Ein Remote (bare) mit `alpha` und `feature` und ein Klon davon, wie ihn der Workflow hat.
repo_neu() {
  local quelle="$ARBEIT/$1-quelle" klon="$ARBEIT/$1"
  mkdir -p "$quelle"
  git -C "$quelle" init -q -b alpha
  einrichten "$quelle"
  printf 'eins\nzwei\ndrei\n' > "$quelle/a.txt"
  printf 'eins\nzwei\ndrei\n' > "$quelle/b.txt"
  git -C "$quelle" add -A
  git -C "$quelle" commit -q -m basis
  git -C "$quelle" branch feature
  git clone -q --bare "$quelle" "$ARBEIT/$1.git"
  git clone -q "$ARBEIT/$1.git" "$klon"
  einrichten "$klon"
  mkdir -p "$ARBEIT/$1-fake/checks" "$ARBEIT/$1-fake/status"
  : > "$ARBEIT/$1-fake/log"
  printf '%s\n' "$klon"
}

# Schreibt <inhalt> nach <pfad> auf <branch>, committet und pusht.
aendere() { # <klon> <branch> <pfad> <inhalt>
  git -C "$1" checkout -q -B "$2" "origin/$2"
  printf '%s\n' "$4" > "$1/$3"
  git -C "$1" add -A
  git -C "$1" commit -q -m "$3 auf $2"
  git -C "$1" push -q origin "$2"
  git -C "$1" checkout -q --detach
  git -C "$1" fetch -q origin
}

kopf() { git -C "$1" rev-parse "origin/${2:-feature}"; }
fake() { printf '%s-fake\n' "$1"; }

# Check-Runs für den Kopf von `feature`: Zeilen "<name>|<status>|<conclusion>|<start>|<ende>".
checks() { # <klon>  (Zeilen auf stdin)
  local ziel
  ziel="$(fake "$1")/checks/$(kopf "$1").json"
  jq -R -s '{check_runs: [split("\n")[] | select(length > 0) | split("|")
      | {name: .[0], status: .[1], conclusion: (if .[2] == "" then null else .[2] end),
         started_at: .[3], completed_at: (if .[4] == "" then null else .[4] end)}]}' > "$ziel"
}
# Ein vollständiger grüner Lauf, begonnen 10:00, fertig 11:00 (UTC, 12.11.2026).
ci_gruen() {
  printf '%s\n' \
    'Schnellprüfungen|completed|success|2026-11-12T10:00:00Z|2026-11-12T10:07:00Z' \
    'Rust-Suite|completed|success|2026-11-12T10:00:05Z|2026-11-12T10:30:00Z' \
    'e2e 1/4|completed|success|2026-11-12T10:03:00Z|2026-11-12T11:00:00Z' \
    'Release|completed|skipped|2026-11-12T11:00:00Z|2026-11-12T11:00:00Z' | checks "$1"
}
UM_1005=1794477900 # 2026-11-12T10:05:00Z
UM_1200=1794484800 # 2026-11-12T12:00:00Z

# Bewertet PR #7 (`feature` → `alpha`). Weitere Argumente: entwurf, fork, auto-merge, branch.
# `updated_at` des PRs ist das Commit-Datum des Kopfes, außer GEAENDERT ist gesetzt.
lauf() { # <klon> [entwurf] [fork] [auto-merge] [kopf-branch] [vorab-option]
  local klon="$1" branch="${5:-feature}" code=0
  ( cd "$klon" && STAU_FAKE="$(fake "$klon")" "$SKRIPT_UNTER_TEST" ${6:+"$6"} bewerte 7 "$branch" \
      "$(kopf "$klon" "$branch")" "${BASIS:-alpha}" "${2:-false}" "${3:-false}" "${4:-false}" \
      "${GEAENDERT:-$(git -C "$klon" log -1 --format=%ct "origin/$branch")}" ) \
    > "$ARBEIT/ausgabe" 2>&1 || code=$?
  [ "$code" = 0 ] || { echo "  FEHL Lauf endete mit Exit $code:" >&2; sed 's/^/       /' "$ARBEIT/ausgabe" >&2; fehler=$((fehler + 1)); }
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}
log() { tr '\n' ' ' < "$(fake "$1")/log" | sed 's/ $//'; }
kommentar() { jq -r 'last | .body // ""' "$(fake "$1")/kommentare.json" 2> /dev/null || true; }
kommentare() { jq 'length' "$(fake "$1")/kommentare.json" 2> /dev/null || echo 0; }
kommentar_enthaelt() { # <name> <klon> <text>
  if kommentar "$2" | grep -qF -- "$3"; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — '$3' fehlt im Kommentar:" >&2
    kommentar "$2" | sed 's/^/         /' >&2
    fehler=$((fehler + 1))
  fi
}

echo "==> Stau-Wächter-Selbsttest"
export STAU_JETZT="$UM_1005"

# 1 — Konfliktfrei, CI läuft: kein Befund, kein Schreibzugriff.
r="$(repo_neu ruhig)"
aendere "$r" feature b.txt "feature"
aendere "$r" alpha a.txt "alpha"
ci_gruen "$r"
lauf "$r"
pruefe "1 ohne Befund kein Schreibzugriff" "" "$(log "$r")"

# 2 — Konflikt in einer Datei: ein Hinweis, der sie nennt.
r="$(repo_neu konflikt)"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
lauf "$r"
pruefe "2 Konflikt legt einen Hinweis an" "POST konflikt" "$(log "$r")"
kommentar_enthaelt "2 Hinweis nennt die Datei" "$r" '- `a.txt`'
kommentar_enthaelt "2 Hinweis nennt den Handgriff" "$r" 'git fetch origin alpha && git merge origin/alpha'

# 3 — Derselbe Befund noch einmal, auch wenn alpha sich weiterbewegt: kein zweiter Kommentar.
aendere "$r" alpha c.txt "neu auf alpha"
lauf "$r"
pruefe "3 gleicher Befund schreibt nichts" "POST konflikt" "$(log "$r")"

# 4 — Der Befund ändert sich (eine weitere Datei kollidiert): alter Hinweis weg, neuer da.
aendere "$r" feature b.txt "feature"
aendere "$r" alpha b.txt "alpha"
lauf "$r"
pruefe "4 geänderter Befund löscht und legt neu an" "POST konflikt DELETE POST konflikt" "$(log "$r")"
pruefe "4 es bleibt bei einem Hinweis" 1 "$(kommentare "$r")"
kommentar_enthaelt "4 neuer Hinweis nennt beide Dateien" "$r" '- `b.txt`'

# 5 — Konflikt behoben (alpha hineingemergt), CI läuft: der Hinweis zeigt es.
git -C "$r" checkout -q -B feature origin/feature
git -C "$r" merge -q -X ours --no-edit origin/alpha > /dev/null
git -C "$r" push -q origin feature
git -C "$r" checkout -q --detach && git -C "$r" fetch -q origin
ci_gruen "$r"
lauf "$r"
pruefe "5 behobener Befund ändert den Hinweis" "POST konflikt DELETE POST konflikt PATCH behoben" "$(log "$r")"
lauf "$r"
pruefe "5 behoben bleibt stehen" "POST konflikt DELETE POST konflikt PATCH behoben" "$(log "$r")"

# 6 — Der Konflikt kommt wieder: neuer Kommentar, der alte (behobene) ist weg.
aendere "$r" alpha a.txt "alpha zum zweiten"
aendere "$r" feature a.txt "feature zum zweiten"
lauf "$r"
pruefe "6 wiederkehrender Konflikt kommt als neuer Kommentar" 1 "$(kommentare "$r")"
kommentar_enthaelt "6 und ist wieder ein Konflikt-Hinweis" "$r" 'Konflikt mit `alpha`'

# 7 — Entwurf: weder Hinweis noch Commit.
r="$(repo_neu entwurf)"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
lauf "$r" true
pruefe "7 Entwurf schreibt nichts" "" "$(log "$r")"

# 8 — --nur-zeigen: Befund in der Ausgabe, kein Schreibzugriff.
lauf "$r" false false false feature --nur-zeigen
pruefe "8 nur-zeigen schreibt nichts" "" "$(log "$r")"
pruefe "8 nur-zeigen nennt den Befund" 1 "$(grep -c 'Befund: Konflikt' "$ARBEIT/ausgabe")"

echo "==> Stau-Wächter: fehlender CI-Lauf"

# Ein konfliktfreier PR ohne jeden Check-Run; `alpha` hat Neues. Uhr: <minuten> nach dem Commit.
ohne_ci() { # <name> <minuten>
  local r
  r="$(repo_neu "$1")"
  aendere "$r" feature b.txt "feature"
  aendere "$r" alpha a.txt "alpha"
  STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + $2 * 60 ))
  export STAU_JETZT
  printf '%s\n' "$r"
}

# 9 — CI nie angelaufen, alt genug, App eingerichtet: alpha wird hineingemergt und gepusht.
r="$(ohne_ci anstoss 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
vorher="$(kopf "$r")"
STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "9 der Branch trägt einen neuen Commit" "$vorher" "$(git -C "$r" rev-parse origin/feature^1)"
pruefe "9 zweiter Elternteil ist alpha" "$(kopf "$r" alpha)" "$(git -C "$r" rev-parse origin/feature^2)"
pruefe "9 der Commit trägt den Trailer" "LLH-1660" \
  "$(git -C "$r" log -1 --format='%(trailers:key=Stau-Waechter,valueonly)' origin/feature | tr -d '\n')"
pruefe "9 ein Hinweis nennt den Anstoß" "POST angestossen" "$(log "$r")"

# 10 — Schleifenbremse: der Wächter-Merge trägt weiter keinen CI-Lauf.
STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
aendere "$r" alpha d.txt "noch mehr auf alpha"
vorher="$(kopf "$r")"
STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "10 kein zweiter Wächter-Merge" "$vorher" "$(kopf "$r")"
kommentar_enthaelt "10 Hinweis sagt, dass schon gemergt wurde" "$r" 'schon hineingemergt'

# 11 — Der Anstoß-Hinweis bleibt stehen, wenn danach alles in Ordnung ist.
r="$(ohne_ci anstossbleibt 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
ci_gruen "$r"
STAU_JETZT="$UM_1005" lauf "$r"
pruefe "11 Anstoß-Hinweis wird nicht zu behoben" "POST angestossen" "$(log "$r")"

# 12 — Kopf zu jung: abwarten.
r="$(ohne_ci jung 5)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 300 ))
vorher="$(kopf "$r")"
STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "12 junger Kopf: kein Push" "$vorher" "$(kopf "$r")"
pruefe "12 junger Kopf: kein Hinweis" "" "$(log "$r")"

# 13 — Fremde Checks (Vorschau-Build) sind da, der CI-Lauf fehlt: das Alter zählt ab dem
# frühesten Check, nicht ab dem Commit-Datum.
r="$(ohne_ci fremdchecks 600)"
printf '%s\n' 'Cloudflare Pages|completed|success|2026-11-12T10:00:00Z|2026-11-12T10:00:30Z' | checks "$r"
vorher="$(kopf "$r")"
STAU_JETZT="$UM_1005" STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "13 fünf Minuten nach dem ersten Check: abwarten" "$vorher" "$(kopf "$r")"
STAU_JETZT="$UM_1200" STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "13 zwei Stunden danach: angestoßen" "$vorher" "$(git -C "$r" rev-parse origin/feature^1)"

# 14 — Nichts zu mergen (alpha steckt schon im Branch): Hinweis statt Push.
r="$(repo_neu nichtszumergen)"
aendere "$r" feature b.txt "feature"
STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
vorher="$(kopf "$r")"
STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "14 nichts zu mergen: kein Push" "$vorher" "$(kopf "$r")"
pruefe "14 nichts zu mergen: Hinweis" "POST ohne-ci" "$(log "$r")"
kommentar_enthaelt "14 Hinweis nennt den Grund" "$r" 'nichts hineinzumergen'

# 15 — Fork: Hinweis statt Push.
r="$(ohne_ci fork 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
vorher="$(kopf "$r")"
STAU_SCHREIBEN=1 lauf "$r" false true
git -C "$r" fetch -q origin
pruefe "15 Fork: kein Push" "$vorher" "$(kopf "$r")"
kommentar_enthaelt "15 Fork: Hinweis nennt den Grund" "$r" 'in einem Fork'

# 16 — Ohne Release-App: Hinweis statt Push.
r="$(ohne_ci ohneapp 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
vorher="$(kopf "$r")"
lauf "$r"
git -C "$r" fetch -q origin
pruefe "16 ohne App: kein Push" "$vorher" "$(kopf "$r")"
kommentar_enthaelt "16 ohne App: Hinweis nennt den Grund" "$r" 'Release-App ist nicht eingerichtet'

# 17 — Kopf-Branch heißt wie ein Ziel-Branch: nie ein Push.
r="$(repo_neu zielbranch)"
git -C "$r" checkout -q -b beta origin/alpha
printf 'beta\n' > "$r/b.txt"; git -C "$r" add -A; git -C "$r" commit -q -m beta
git -C "$r" push -q origin beta
git -C "$r" checkout -q --detach
aendere "$r" alpha a.txt "alpha"
STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/beta) + 2700 ))
vorher="$(kopf "$r" beta)"
STAU_SCHREIBEN=1 lauf "$r" false false false beta
git -C "$r" fetch -q origin
pruefe "17 Ziel-Branch als Kopf: kein Push" "$vorher" "$(kopf "$r" beta)"
kommentar_enthaelt "17 Hinweis nennt den Grund" "$r" 'heißt wie ein Ziel-Branch'

# 18 — Der Branch bewegt sich zwischen Bewertung und Push: abgewiesen, nichts überschrieben.
r="$(ohne_ci bewegt 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
alt="$(kopf "$r")"
# Ein zweiter Klon pusht einen Commit, den der erste noch nicht kennt.
git clone -q "$ARBEIT/bewegt.git" "$ARBEIT/bewegt-zweiter"
einrichten "$ARBEIT/bewegt-zweiter"
git -C "$ARBEIT/bewegt-zweiter" checkout -q feature
echo "fremd" > "$ARBEIT/bewegt-zweiter/fremd.txt"
git -C "$ARBEIT/bewegt-zweiter" add -A
git -C "$ARBEIT/bewegt-zweiter" commit -q -m fremd
git -C "$ARBEIT/bewegt-zweiter" push -q origin feature
fremd="$(git -C "$ARBEIT/bewegt-zweiter" rev-parse HEAD)"
code=0
( cd "$r" && STAU_FAKE="$(fake "$r")" STAU_SCHREIBEN=1 "$SKRIPT_UNTER_TEST" bewerte 7 feature "$alt" alpha false false false \
    "$(git -C "$r" log -1 --format=%ct "$alt")" ) \
  > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "18 bewegter Branch: Lauf bleibt grün" 0 "$code"
pruefe "18 bewegter Branch: fremder Commit bleibt Kopf" "$fremd" \
  "$(git -C "$ARBEIT/bewegt.git" rev-parse refs/heads/feature)"
pruefe "18 bewegter Branch: kein Hinweis" "" "$(log "$r")"

# 18a — Der Branch wurde inzwischen gelöscht (PR gemergt): er entsteht nicht neu.
r="$(ohne_ci geloescht 45)"; STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
alt="$(kopf "$r")"
git -C "$ARBEIT/geloescht.git" update-ref -d refs/heads/feature
code=0
( cd "$r" && STAU_FAKE="$(fake "$r")" STAU_SCHREIBEN=1 "$SKRIPT_UNTER_TEST" bewerte 7 feature "$alt" alpha false false false \
    "$(git -C "$r" log -1 --format=%ct "$alt")" ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "18a gelöschter Branch: Lauf bleibt grün" 0 "$code"
pruefe "18a gelöschter Branch entsteht nicht neu" "" \
  "$(git -C "$ARBEIT/geloescht.git" rev-parse --verify --quiet refs/heads/feature || true)"
pruefe "18a gelöschter Branch: kein Hinweis" "" "$(log "$r")"

# 18b — Der Branch wurde per Force auf einen Vorfahren zurückgesetzt: die entfernten Commits
# kommen nicht zurück (ein einfacher Push wäre hier ein Fast-Forward).
r="$(ohne_ci zurueck 45)"
aendere "$r" feature e.txt "zweiter Commit auf feature"
STAU_JETZT=$(( $(git -C "$r" log -1 --format=%ct origin/feature) + 2700 ))
alt="$(kopf "$r")"
vorfahr="$(git -C "$r" rev-parse "$alt^")"
git -C "$ARBEIT/zurueck.git" update-ref refs/heads/feature "$vorfahr"
code=0
( cd "$r" && STAU_FAKE="$(fake "$r")" STAU_SCHREIBEN=1 "$SKRIPT_UNTER_TEST" bewerte 7 feature "$alt" alpha false false false \
    "$(git -C "$r" log -1 --format=%ct "$alt")" ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "18b zurückgesetzter Branch: Lauf bleibt grün" 0 "$code"
pruefe "18b zurückgesetzter Branch bleibt, wo er ist" "$vorfahr" \
  "$(git -C "$ARBEIT/zurueck.git" rev-parse refs/heads/feature)"

# 18c — Alter Commit, eben erst gepusht (PR gerade geändert), noch kein Check: abwarten. Das
# Commit-Datum allein hätte hier sofort gemergt.
r="$(ohne_ci altercommit 600)"
vorher="$(kopf "$r")"
GEAENDERT=$((STAU_JETZT - 120)) STAU_SCHREIBEN=1 lauf "$r"
git -C "$r" fetch -q origin
pruefe "18c alter Commit, frischer PR-Stand: kein Push" "$vorher" "$(kopf "$r")"
pruefe "18c alter Commit, frischer PR-Stand: kein Hinweis" "" "$(log "$r")"

echo "==> Stau-Wächter: Hinweise und Liste"
export STAU_JETZT="$UM_1005"

# 24 — Kommentare nicht lesbar: kein zweiter Hinweis neben dem bestehenden.
r="$(repo_neu lesefehler)"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
lauf "$r"
touch "$(fake "$r")/kommentare-kaputt"
aendere "$r" feature b.txt "feature"
aendere "$r" alpha b.txt "alpha"
lauf "$r"
pruefe "24 Lesefehler schreibt nichts" "POST konflikt" "$(log "$r")"
rm "$(fake "$r")/kommentare-kaputt"

# 25 — Ein fremder Kommentar, der wie ein Hinweis beginnt, wird nicht angefasst.
r="$(repo_neu fremd)"
jq -n '[{id: 55, body: "<!-- stau-waechter:konflikt:abc123 -->\nvon Hand", user: {login: "jemand"}}]' \
  > "$(fake "$r")/kommentare.json"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
lauf "$r"
pruefe "25 fremder Kommentar bleibt, eigener kommt dazu" "POST konflikt" "$(log "$r")"
pruefe "25 beide Kommentare stehen" 2 "$(kommentare "$r")"

# 26 — Eine von Hand veränderte Marke im eigenen Hinweis: er wird ersetzt, nicht verdoppelt.
r="$(repo_neu marke)"
jq -n '[{id: 55, body: "<!-- stau-waechter:KAPUTT -->\nalt", user: {login: "github-actions[bot]"}}]' \
  > "$(fake "$r")/kommentare.json"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
lauf "$r"
pruefe "26 kaputte Marke wird ersetzt" "DELETE POST konflikt" "$(log "$r")"
pruefe "26 es bleibt bei einem Hinweis" 1 "$(kommentare "$r")"

# 27 — Ziel ist kein Kanal-Branch: übersprungen.
r="$(repo_neu fremdziel)"
aendere "$r" feature a.txt "feature"
aendere "$r" alpha a.txt "alpha"
BASIS=irgendwas lauf "$r"
pruefe "27 fremdes Ziel schreibt nichts" "" "$(log "$r")"

# 28 — `alle`: liest die PR-Liste, holt die Köpfe und leitet Entwurf, Fork und Auto-Merge aus
# der Antwort ab. Drei PRs mit demselben Konflikt: einer aus dem Repo, ein Entwurf, ein Fork
# ohne CI-Lauf (der bekäme einen Push, wäre er nicht als Fork erkannt).
r="$(repo_neu liste)"
aendere "$r" feature a.txt "feature"
git -C "$r" push -q origin origin/feature:refs/heads/entwurf origin/feature:refs/heads/ausfork
aendere "$r" ausfork z.txt "konfliktfrei im fork"
aendere "$r" feature b.txt "noch ein Commit"
aendere "$r" alpha a.txt "alpha"
for paar in 7:feature 8:entwurf 9:ausfork; do
  git -C "$ARBEIT/liste.git" update-ref "refs/pull/${paar%%:*}/head" "refs/heads/${paar#*:}"
done
git -C "$ARBEIT/liste.git" update-ref refs/pull/9/head "$(git -C "$r" rev-parse origin/alpha~1)"
jq -n --arg k7 "$(kopf "$r" feature)" --arg k8 "$(kopf "$r" entwurf)" \
  --arg k9 "$(git -C "$r" rev-parse origin/alpha~1)" '[
  {number: 7, draft: false, auto_merge: null, updated_at: "2026-11-12T08:00:00Z",
   head: {ref: "feature", sha: $k7, repo: {full_name: "test/repo"}}, base: {ref: "alpha"}},
  {number: 8, draft: true, auto_merge: null, updated_at: "2026-11-12T08:00:00Z",
   head: {ref: "entwurf", sha: $k8, repo: {full_name: "test/repo"}}, base: {ref: "alpha"}},
  {number: 9, draft: false, auto_merge: {merge_method: "merge"}, updated_at: "2026-11-12T08:00:00Z",
   head: {ref: "ausfork", sha: $k9, repo: {full_name: "jemand/repo"}}, base: {ref: "alpha"}}
]' > "$(fake "$r")/pulls.json"
vorher_fork="$(git -C "$ARBEIT/liste.git" rev-parse refs/heads/ausfork)"
code=0
( cd "$r" && STAU_FAKE="$(fake "$r")" STAU_SCHREIBEN=1 "$SKRIPT_UNTER_TEST" alle ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "28 alle: Lauf grün" 0 "$code"
pruefe "28 alle: drei PRs gesehen" 3 "$(grep -c '^==> PR #' "$ARBEIT/ausgabe")"
pruefe "28 alle: Konflikt an #7 erkannt" 1 "$(grep -c 'Befund: Konflikt' "$ARBEIT/ausgabe")"
pruefe "28 alle: Entwurf übersprungen" 1 "$(grep -c 'Entwurf, übersprungen' "$ARBEIT/ausgabe")"
pruefe "28 alle: Fork bekommt keinen Push" "$vorher_fork" "$(git -C "$ARBEIT/liste.git" rev-parse refs/heads/ausfork)"
pruefe "28 alle: Fork als Grund genannt" 1 "$(jq '[.[] | select(.body | contains("in einem Fork"))] | length' "$(fake "$r")/kommentare.json")"

echo "==> Stau-Wächter: grün, aber nicht gemergt"
export STAU_JETZT="$UM_1200"

# 19 — Alles grün seit einer Stunde, Auto-Merge an: Hinweis.
r="$(repo_neu haengt)"
aendere "$r" feature b.txt "feature"
ci_gruen "$r"
lauf "$r" false false true
pruefe "19 grün und Auto-Merge: Hinweis" "POST haengt" "$(log "$r")"

# 20 — Ohne Auto-Merge wartet der PR auf den Menschen: kein Befund.
r="$(repo_neu wartet)"
aendere "$r" feature b.txt "feature"
ci_gruen "$r"
lauf "$r" false false false
pruefe "20 grün ohne Auto-Merge: nichts" "" "$(log "$r")"

# 21 — Ein Commit-Status steht noch aus (Migrationsnummern): kein Befund.
r="$(repo_neu statusoffen)"
aendere "$r" feature b.txt "feature"
ci_gruen "$r"
echo pending > "$(fake "$r")/status/$(kopf "$r")"
lauf "$r" false false true
pruefe "21 offener Status: nichts" "" "$(log "$r")"

# 22 — Ein Check läuft noch: kein Befund.
r="$(repo_neu laeuft)"
aendere "$r" feature b.txt "feature"
printf '%s\n' \
  'Schnellprüfungen|completed|success|2026-11-12T10:00:00Z|2026-11-12T10:07:00Z' \
  'e2e 1/4|in_progress||2026-11-12T10:03:00Z|' | checks "$r"
lauf "$r" false false true
pruefe "22 laufender Check: nichts" "" "$(log "$r")"

# 23 — Gerade erst grün geworden: abwarten.
r="$(repo_neu frischgruen)"
aendere "$r" feature b.txt "feature"
ci_gruen "$r"
STAU_JETZT=$((UM_1005 + 3600)) lauf "$r" false false true # 11:05, fünf Minuten nach dem Ende
pruefe "23 frisch grün: nichts" "" "$(log "$r")"

echo "==> Stau-Wächter: Auto-Merge an, e2e fehlt (LLH-1662)"
export STAU_JETZT="$UM_1200"

# Erste Stufe grün, die zweite nie angelaufen: nur übersprungene Einträge unter den
# unexpandierten Namen und eine übersprungene Auswahl.
stufe_eins_gruen() {
  printf '%s\n' \
    'Schnellprüfungen|completed|success|2026-11-12T10:00:00Z|2026-11-12T10:07:00Z' \
    'Rust-Suite|completed|success|2026-11-12T10:00:05Z|2026-11-12T10:30:00Z' \
    'e2e-Auswahl|completed|skipped|2026-11-12T10:00:01Z|2026-11-12T10:00:01Z' \
    '${{ matrix.check }}|completed|skipped|2026-11-12T10:00:01Z|2026-11-12T10:00:01Z' \
    'e2e ${{ matrix.shard }}/4|completed|skipped|2026-11-12T10:00:01Z|2026-11-12T10:00:01Z' | checks "$1"
}
automerge_um() { # <klon> <zeit>
  printf '[{"event":"labeled","created_at":"2026-11-12T09:00:00Z"},{"event":"auto_merge_enabled","created_at":"%s"}]\n' \
    "$2" > "$(fake "$1")/zeitleiste.json"
}

# 29 — Auto-Merge seit 10:30, um 12:00 noch kein e2e-Lauf: Hinweis, nicht „grün, nicht gemergt“.
r="$(repo_neu ohnee2e)"
aendere "$r" feature b.txt "feature"
stufe_eins_gruen "$r"
automerge_um "$r" 2026-11-12T10:30:00Z
lauf "$r" false false true
pruefe "29 Auto-Merge ohne e2e-Lauf: Hinweis" "POST ohne-e2e" "$(log "$r")"
kommentar_enthaelt "29 Hinweis nennt den Handgriff" "$r" "Auto-Merge aus- und wieder einschalten"
pruefe "29 kein Push" "$(git -C "$ARBEIT/ohnee2e.git" rev-parse refs/heads/feature)" "$(kopf "$r")"

# 30 — Gleicher Befund beim nächsten Lauf: nichts Neues.
lauf "$r" false false true
pruefe "30 gleicher Befund: kein zweiter Hinweis" "POST ohne-e2e" "$(log "$r")"

# 31 — Die zweite Stufe läuft an: der Hinweis wird „behoben“.
printf '%s\n' \
  'Schnellprüfungen|completed|success|2026-11-12T10:00:00Z|2026-11-12T10:07:00Z' \
  'e2e-Auswahl|completed|success|2026-11-12T12:01:00Z|2026-11-12T12:02:00Z' \
  'e2e-Binary|in_progress||2026-11-12T12:02:00Z|' | checks "$r"
lauf "$r" false false true
pruefe "31 e2e läuft: behoben" "POST ohne-e2e PATCH behoben" "$(log "$r")"

# 32 — Ohne Auto-Merge (auch mit Label e2e) wartet der PR auf den Menschen: kein Befund.
r="$(repo_neu ohneautomerge)"
aendere "$r" feature b.txt "feature"
stufe_eins_gruen "$r"
lauf "$r" false false false
pruefe "32 ohne Auto-Merge: nichts" "" "$(log "$r")"

# 33 — Auto-Merge erst um 11:50 eingeschaltet, auf einem Kopf von 10:00: abwarten.
r="$(repo_neu frischautomerge)"
aendere "$r" feature b.txt "feature"
stufe_eins_gruen "$r"
automerge_um "$r" 2026-11-12T11:50:00Z
lauf "$r" false false true
pruefe "33 Auto-Merge vor 10 min: nichts" "" "$(log "$r")"

# 34 — Neuer Commit um 11:55 bei längst eingeschaltetem Auto-Merge: die Uhr läuft ab dem Kopf.
r="$(repo_neu frischerkopf)"
aendere "$r" feature b.txt "feature"
printf '%s\n' \
  'Schnellprüfungen|in_progress||2026-11-12T11:55:00Z|' | checks "$r"
automerge_um "$r" 2026-11-12T09:30:00Z
lauf "$r" false false true
pruefe "34 Kopf vor 5 min: nichts" "" "$(log "$r")"

# 35 — Zeitleiste nicht lesbar: die letzte Änderung am PR zählt (hier 11:55, also abwarten).
r="$(repo_neu ohnezeitleiste)"
aendere "$r" feature b.txt "feature"
stufe_eins_gruen "$r"
touch "$(fake "$r")/zeitleiste-kaputt"
GEAENDERT=$((UM_1200 - 300)) lauf "$r" false false true
pruefe "35 Zeitleiste kaputt, PR vor 5 min geändert: nichts" "" "$(log "$r")"
GEAENDERT=$((UM_1200 - 3600)) lauf "$r" false false true
pruefe "35b Zeitleiste kaputt, PR vor 60 min geändert: Hinweis" "POST ohne-e2e" "$(log "$r")"

# 36 — Ein grüner e2e-Lauf zählt, auch wenn Auto-Merge danach wieder eingeschaltet wurde.
r="$(repo_neu e2eda)"
aendere "$r" feature b.txt "feature"
ci_gruen "$r"
automerge_um "$r" 2026-11-12T10:30:00Z
echo pending > "$(fake "$r")/status/$(kopf "$r")"
lauf "$r" false false true
pruefe "36 e2e gelaufen: kein ohne-e2e" "" "$(log "$r")"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Stau-Wächter-Selbsttest." >&2
  exit 1
fi
echo "==> OK: Stau-Wächter-Selbsttest."
