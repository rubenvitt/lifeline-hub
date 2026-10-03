#!/usr/bin/env bash
# LFH-1014: kollidierende Migrationsnummern eines PRs per Bot-Commit auf dem PR-Branch umlegen.
#
#   scripts/migrationen-autofix.sh <basis> <kopf-branch> <kopf-sha>
#     <basis>        Ziel-Branch, gegen den umnummeriert wird (z. B. origin/alpha)
#     <kopf-branch>  Branch des PRs im Remote, auf den gepusht wird
#     <kopf-sha>     der geprüfte Kopf-Commit; gepusht wird nur, solange der Branch dort steht
#   Exit 0 = Autofix gepusht · 1 = nicht behebbar (Bestandsmigration verletzt)
#        2 = Aufruf- oder Umgebungsfehler · 3 = verweigert (Ziel-Branch, Schleifenbremse)
#        4 = Push abgewiesen, weil der Branch sich bewegt hat · 5 = nichts umzunummerieren
#   Umgebung: AUTOFIX_REMOTE  (Vorgabe origin)
#             AUTOFIX_BERICHT Datei für den PR-Kommentar (Markdown), nur nach Exit 0 geschrieben
#             AUTOFIX_PRUEFER Prüfskript (Vorgabe: check-migrationen.sh neben diesem Skript)
#
# DIE GRENZEN (Begründung: openspec/…/lfh-1014-migrationsnummern-autofix/design.md):
#   1. Nie auf `alpha`, `beta`, `main` oder die Basis selbst. Das Token des Workflows hat auf
#      `alpha` Bypass-Rechte; diese Sperre ist die erste von zwei.
#   2. Nur Fast-Forward, nie Force: der Commit sitzt direkt auf <kopf-sha>. Hat jemand
#      inzwischen gepusht, weist das Remote den Push ab, und sein Commit bekommt einen eigenen
#      Lauf. Das ist auch die zweite Sperre gegen einen Ziel-Branch.
#   3. Schleifenbremse: tragen die letzten drei Commits den Autofix-Trailer, setzt er aus.
#
# Gearbeitet wird in einem eigenen, losgelösten Arbeitsbaum; der des Aufrufers bleibt, wie er
# ist. PR-Code wird nie ausgeführt: umbenannt und Text ersetzt wird durch das Prüfskript.
set -euo pipefail

TRAILER_SCHLUESSEL="Migrationsnummern-Autofix"
TRAILER_WERT="LFH-1014"
SCHLEIFE_MAX=3

[ $# -eq 3 ] || { sed -n '2,13p' "$0" >&2; exit 2; }
BASIS="$1"
KOPF_BRANCH="$2"
KOPF_SHA="$3"
REMOTE="${AUTOFIX_REMOTE:-origin}"
PRUEFER="${AUTOFIX_PRUEFER:-$(cd "$(dirname "$0")" && pwd)/check-migrationen.sh}"
git() { command git -c core.quotePath=false "$@"; }

git rev-parse --verify --quiet "$BASIS^{commit}" > /dev/null || {
  echo "FEHLER: Basis '$BASIS' ist kein Commit (fehlt ein 'git fetch'?)." >&2; exit 2; }
K="$(git rev-parse --verify --quiet "$KOPF_SHA^{commit}")" || {
  echo "FEHLER: Kopf '$KOPF_SHA' ist kein Commit (fehlt ein 'git fetch'?)." >&2; exit 2; }
git check-ref-format --branch "$KOPF_BRANCH" > /dev/null 2>&1 || {
  echo "FEHLER: '$KOPF_BRANCH' ist kein gültiger Branch-Name." >&2; exit 2; }
[ -x "$PRUEFER" ] || { echo "FEHLER: Prüfskript '$PRUEFER' fehlt." >&2; exit 2; }

basis_kurz="${BASIS#refs/remotes/}"
basis_kurz="${basis_kurz#"$REMOTE"/}"
case "$KOPF_BRANCH" in
  alpha|beta|main|"$basis_kurz")
    echo "VERWEIGERT: '$KOPF_BRANCH' ist ein Ziel-Branch; der Autofix schreibt nur auf PR-Branches." >&2
    exit 3 ;;
esac

autofixe=0
while IFS= read -r wert; do
  [ -n "$wert" ] && autofixe=$((autofixe + 1))
done < <(git log -"$SCHLEIFE_MAX" --first-parent \
  --format="%(trailers:key=$TRAILER_SCHLUESSEL,valueonly,separator=%x2C)" "$K")
if [ "$autofixe" -ge "$SCHLEIFE_MAX" ]; then
  echo "VERWEIGERT: die letzten $SCHLEIFE_MAX Commits auf '$KOPF_BRANCH' sind schon Autofixes." >&2
  echo "    Die Kollision löst sich so offenbar nicht; bitte von Hand umnummerieren." >&2
  exit 3
fi

TMP="$(mktemp -d)"
WT="$TMP/arbeitsbaum"
aufraeumen() {
  git worktree remove --force "$WT" > /dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap aufraeumen EXIT
git worktree add -q --detach "$WT" "$K"

code=0
( cd "$WT" && "$PRUEFER" --umnummerieren "$BASIS" ) > "$TMP/ausgabe" 2>&1 || code=$?
cat "$TMP/ausgabe"
case "$code" in
  0) ;;
  1) echo "==> Nicht behebbar: der Verstoß lässt sich nicht wegnummerieren." >&2; exit 1 ;;
  *) echo "FEHLER: Prüfskript endete mit Exit $code." >&2; exit 2 ;;
esac
if [ -z "$(git -C "$WT" status --porcelain)" ]; then
  echo "==> Nichts umzunummerieren."
  exit 5
fi

# Umbenennungen aus der Ausgabe des Prüfskripts: „    migrations/alt  ->  migrations/neu".
umbenennungen=()
while IFS= read -r zeile; do
  umbenennungen+=("$zeile")
done < <(sed -n -E 's#^    migrations/([^ ]+)  ->  migrations/([^ ]+)$#\1|\2#p' "$TMP/ausgabe")
# Restfundstellen der alten Nummer: alles nach dem Hinweis des Prüfskripts.
sed -n '/kann noch in Bezeichnern stehen/,$p' "$TMP/ausgabe" | tail -n +2 > "$TMP/hinweise"

{
  printf 'fix(migrationen): Nummern über %s legen (LFH-1014)\n\n' "$basis_kurz"
  printf 'Auf %s ist inzwischen eine Migration mit derselben oder einer höheren\n' "$basis_kurz"
  printf 'Nummer gemergt. Automatisch umgelegt von migrationen.yml:\n\n'
  for u in ${umbenennungen[@]+"${umbenennungen[@]}"}; do printf -- '- %s -> %s\n' "${u%%|*}" "${u#*|}"; done
  printf '\n%s: %s\n' "$TRAILER_SCHLUESSEL" "$TRAILER_WERT"
} > "$TMP/nachricht"
git -C "$WT" add -A
git -C "$WT" commit -q -F "$TMP/nachricht"
neu="$(git -C "$WT" rev-parse HEAD)"

# Ohne Force: nur ein Fast-Forward von <kopf-sha> wird angenommen (Grenze 2).
if ! git -C "$WT" push -q "$REMOTE" "$neu:refs/heads/$KOPF_BRANCH"; then
  # Bewegt oder verweigert? Nur ein bewegter Branch ist der erwartete Fall; ein Push, der bei
  # stehendem Branch scheitert (Rechte, falscher Token), ist ein Fehler und muss so heißen.
  jetzt="$(git -C "$WT" ls-remote "$REMOTE" "refs/heads/$KOPF_BRANCH" | cut -f1)" || jetzt=""
  if [ -n "$jetzt" ] && [ "$jetzt" != "$K" ]; then
    echo "==> Push abgewiesen: '$KOPF_BRANCH' steht nicht mehr auf ${K:0:12}. Der neue Stand wird" >&2
    echo "    von seinem eigenen Lauf bewertet." >&2
    exit 4
  fi
  echo "FEHLER: Push fehlgeschlagen, obwohl '$KOPF_BRANCH' noch auf ${K:0:12} steht" >&2
  echo "    (Rechte des Tokens? Ausgabe von git push oben)." >&2
  exit 2
fi
echo "==> Autofix gepusht: $KOPF_BRANCH ${K:0:12} -> ${neu:0:12}"

if [ -n "${AUTOFIX_BERICHT:-}" ]; then
  {
    printf '**Migrationsnummern automatisch umgelegt** (LFH-1014)\n\n'
    printf 'Auf `%s` ist inzwischen eine Migration mit derselben oder einer höheren Nummer gemergt. ' "$basis_kurz"
    printf 'Commit %s legt die neuen Migrationen dieses PRs dahinter:\n\n' "${neu:0:12}"
    for u in ${umbenennungen[@]+"${umbenennungen[@]}"}; do
      printf -- '- `%s` → `%s`\n' "${u%%|*}" "${u#*|}"
    done
    if [ -s "$TMP/hinweise" ]; then
      printf '\nDie alte Nummer steht noch in Bezeichnern (nicht ersetzt, bitte prüfen):\n\n```\n'
      cat "$TMP/hinweise"
      printf '```\n'
    fi
    printf '\nWer lokal auf diesem Branch weiterarbeitet: vor dem nächsten Push `git pull` '
    printf '(ein Merge genügt, die Umbenennung kollidiert nicht).\n'
  } > "$AUTOFIX_BERICHT"
fi
