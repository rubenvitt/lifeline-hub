#!/usr/bin/env bash
# Selbsttest für scripts/ci-auswahl.sh (LLH-1662). Das Skript entscheidet in beiden Stufen der
# PR-CI, welche schweren Suiten laufen. Irrt es zur einen Seite, mergt Ungeprüftes; zur anderen
# kostet jeder Push wieder alle Suiten. Beide Richtungen stehen hier.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
SKRIPT_UNTER_TEST="$SKRIPTE/ci-auswahl.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
TRAILER="Migrationsnummern-Autofix: LFH-1014"

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$(printf '%s' "$2" | tr '\n' ' ')', gemessen '$(printf '%s' "$3" | tr '\n' ' ')'" >&2
    fehler=$((fehler + 1))
  fi
}

# Attrappe für `gh api …/commits/<sha>/check-runs`: liefert $ARBEIT/checks/<sha>.json oder
# scheitert, wenn es die Datei nicht gibt.
mkdir -p "$ARBEIT/checks"
cat > "$ARBEIT/gh" << 'ATTRAPPE'
#!/usr/bin/env bash
set -euo pipefail
pfad="$2"
sha="${pfad#*/commits/}"; sha="${sha%%/*}"
datei="$CHECKS_VERZEICHNIS/$sha.json"
[ -f "$datei" ] || { echo "attrappe: keine Check-Runs für $sha" >&2; exit 1; }
cat "$datei"
ATTRAPPE
chmod +x "$ARBEIT/gh"

# Check-Runs als JSON aus Zeilen "<name>|<conclusion>".
laeufe() {
  local name ergebnis id=0 erster=1
  printf '{"check_runs":['
  while IFS='|' read -r name ergebnis; do
    [ "$erster" = 1 ] || printf ','
    erster=0
    id=$((id + 1))
    printf '{"id":%d,"name":"%s","status":"completed","conclusion":"%s"}' "$id" "$name" "$ergebnis"
  done
  printf ']}\n'
}
FRONTEND_GRUEN="$(printf 'Frontend-Suite %d/4|success\n' 1 2 3 4)"
E2E_GRUEN="$(printf 'e2e-Binary|success\n'; printf 'e2e %d/4|success\n' 1 2 3 4)"

# Repo mit Basis-Commit; jede Stufe vergleicht gegen ihn wie die CI gegen den Ziel-Branch.
repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/migrations" "$pfad/src" "$pfad/frontend/src" "$pfad/src-tauri" "$pfad/docs"
  git -C "$pfad" init -q -b feature
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  echo "CREATE TABLE a (id INTEGER);" > "$pfad/migrations/0001_a.sql"
  echo "fn main() {}" > "$pfad/src/main.rs"
  git -C "$pfad" add -A
  git -C "$pfad" commit -q -m basis
  git -C "$pfad" tag basis
  printf '%s\n' "$pfad"
}

commit() { # <repo> <nachricht> [trailer]
  git -C "$1" add -A
  if [ -n "${3:-}" ]; then
    git -C "$1" commit -q -m "$2" -m "$3"
  else
    git -C "$1" commit -q -m "$2"
  fi
}

# Ruft das Skript im Repo auf. <ereignis> <stufe> [kopf]
auswahl() {
  local repo="$1" ereignis="$2" stufe="$3" kopf="${4:-}"
  ( cd "$repo" \
    && CI_EREIGNIS="$ereignis" CI_KOPF="$kopf" CI_GH="$ARBEIT/gh" CI_REMOTE=keins \
      CI_DIFF_BASIS="${DIFF_BASIS:-basis}" GITHUB_REPOSITORY=test/repo \
      CHECKS_VERZEICHNIS="$ARBEIT/checks" GITHUB_STEP_SUMMARY="$ARBEIT/zusammenfassung" \
      "$SKRIPT_UNTER_TEST" "$stufe" 2> /dev/null )
}

echo "==> ci-auswahl: Push und Diff"

r="$(repo_neu diff)"
pruefe "1 Push, Stufe eins: alles" "rust=true
frontend=true" "$(auswahl "$r" push eins)"
pruefe "2 Push, Stufe zwei: alles" "e2e=true" "$(auswahl "$r" push zwei)"

echo "export const x = 1;" > "$r/frontend/src/x.ts"
commit "$r" frontend
pruefe "3 Frontend geändert, Stufe eins" "rust=false
frontend=true" "$(auswahl "$r" pull_request eins "$(git -C "$r" rev-parse HEAD)")"
pruefe "4 Frontend geändert, Stufe zwei" "e2e=true" "$(auswahl "$r" pull_request zwei "$(git -C "$r" rev-parse HEAD)")"

r="$(repo_neu doku)"
echo "Notiz" > "$r/docs/notiz.md"
commit "$r" doku
pruefe "5 nur Doku, Stufe eins" "rust=false
frontend=false" "$(auswahl "$r" pull_request eins "$(git -C "$r" rev-parse HEAD)")"
pruefe "6 nur Doku, Stufe zwei" "e2e=false" "$(auswahl "$r" pull_request zwei "$(git -C "$r" rev-parse HEAD)")"
# Ein Push auf einen Kanal-Branch prüft voll, auch wenn der Diff keine Suite verlangt.
pruefe "6b nur Doku, aber Push: alles" "rust=true
frontend=true" "$(auswahl "$r" push eins)"
pruefe "6c nur Doku, aber Push, Stufe zwei: alles" "e2e=true" "$(auswahl "$r" push zwei)"

r="$(repo_neu huelle)"
echo "fn huelle() {}" > "$r/src-tauri/lib.rs"
commit "$r" huelle
pruefe "7 Hülle, Stufe eins" "rust=true
frontend=true" "$(auswahl "$r" pull_request eins "$(git -C "$r" rev-parse HEAD)")"
pruefe "8 Hülle, Stufe zwei: e2e nicht betroffen" "e2e=false" "$(auswahl "$r" pull_request zwei "$(git -C "$r" rev-parse HEAD)")"

pruefe "9 Diff nicht bestimmbar: alles" "rust=true
frontend=true" "$(DIFF_BASIS=gibtesnicht auswahl "$r" pull_request eins "$(git -C "$r" rev-parse HEAD)")"
pruefe "10 Diff nicht bestimmbar, Stufe zwei: alles" "e2e=true" \
  "$(DIFF_BASIS=gibtesnicht auswahl "$r" pull_request zwei "$(git -C "$r" rev-parse HEAD)")"

echo "==> ci-auswahl: Umnummerierung je Suite"

# Arbeits-Commit mit Frontend und neuer Migration, darauf ein Autofix, der nur umbenennt.
r="$(repo_neu umnummeriert)"
echo "export const y = 2;" > "$r/frontend/src/y.ts"
echo "CREATE TABLE b (id INTEGER);" > "$r/migrations/0002_b.sql"
commit "$r" arbeit
vorgaenger="$(git -C "$r" rev-parse HEAD)"
git -C "$r" mv migrations/0002_b.sql migrations/0005_b.sql
commit "$r" "fix(migrationen): Nummern über alpha legen" "$TRAILER"
kopf="$(git -C "$r" rev-parse HEAD)"

{ printf '%s\n' "$FRONTEND_GRUEN" "$E2E_GRUEN"; echo "Rust-Suite|success"; } | laeufe > "$ARBEIT/checks/$vorgaenger.json"
pruefe "11 beide grün, Stufe eins: Rust neu, Frontend übernommen" "rust=true
frontend=false" "$(auswahl "$r" pull_request eins "$kopf")"
pruefe "12 beide grün, Stufe zwei: e2e übernommen" "e2e=false" "$(auswahl "$r" pull_request zwei "$kopf")"
grep -q "übernommen von ${vorgaenger:0:8}" "$ARBEIT/zusammenfassung" \
  && pruefe "13 Zusammenfassung nennt den Vorgänger" ja ja \
  || pruefe "13 Zusammenfassung nennt den Vorgänger" ja nein

# Ein PR, der nie fertig markiert war: am Vorgänger lief e2e nicht.
{ printf '%s\n' "$FRONTEND_GRUEN"; echo "Rust-Suite|success"; } | laeufe > "$ARBEIT/checks/$vorgaenger.json"
pruefe "14 e2e fehlt am Vorgänger, Stufe eins: Frontend trotzdem übernommen" "rust=true
frontend=false" "$(auswahl "$r" pull_request eins "$kopf")"
pruefe "15 e2e fehlt am Vorgänger, Stufe zwei: e2e läuft" "e2e=true" "$(auswahl "$r" pull_request zwei "$kopf")"

# Übersprungen unter dem unexpandierten Namen zählt nicht als gelaufen.
{ printf '%s\n' "$FRONTEND_GRUEN"; echo 'e2e ${{ matrix.shard }}/4|skipped'; echo '${{ matrix.check }}|skipped'; } \
  | laeufe > "$ARBEIT/checks/$vorgaenger.json"
pruefe "16 e2e nur unexpandiert übersprungen: e2e läuft" "e2e=true" "$(auswahl "$r" pull_request zwei "$kopf")"

{ printf '%s\n' "$FRONTEND_GRUEN" | sed 's#^Frontend-Suite 3/4|success#Frontend-Suite 3/4|failure#'; printf '%s\n' "$E2E_GRUEN"; } \
  | laeufe > "$ARBEIT/checks/$vorgaenger.json"
pruefe "17 Frontend rot am Vorgänger: Frontend läuft" "rust=true
frontend=true" "$(auswahl "$r" pull_request eins "$kopf")"
pruefe "18 Frontend rot, e2e grün: e2e übernommen" "e2e=false" "$(auswahl "$r" pull_request zwei "$kopf")"

rm -f "$ARBEIT/checks/$vorgaenger.json"
pruefe "19 Abfrage scheitert, Stufe eins: alles, was der Diff verlangt" "rust=true
frontend=true" "$(auswahl "$r" pull_request eins "$kopf")"
pruefe "20 Abfrage scheitert, Stufe zwei" "e2e=true" "$(auswahl "$r" pull_request zwei "$kopf")"

# Ohne Kopf im Ereignis (etwa ein fremder Aufruf) wird nichts übernommen.
{ printf '%s\n' "$FRONTEND_GRUEN" "$E2E_GRUEN"; } | laeufe > "$ARBEIT/checks/$vorgaenger.json"
pruefe "21 Kopf fehlt: nichts übernommen" "rust=true
frontend=true" "$(auswahl "$r" pull_request eins "")"

echo "==> ci-auswahl: Aufruf"
code=0
( cd "$r" && CI_EREIGNIS=push "$SKRIPT_UNTER_TEST" drei > /dev/null 2>&1 ) || code=$?
pruefe "22 unbekannte Stufe" 2 "$code"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ci-auswahl." >&2
  exit 1
fi
echo "==> OK: Selbsttest ci-auswahl."
