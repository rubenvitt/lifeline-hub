#!/usr/bin/env bash
# LLH-1662: Welche schweren Suiten braucht dieser CI-Lauf? Die eine Stelle für beide Stufen der
# PR-CI (Job `aenderungen` in ci.yml und in e2e.yml).
#
#   scripts/ci-auswahl.sh eins     → rust=true|false, frontend=true|false
#   scripts/ci-auswahl.sh zwei     → e2e=true|false
#   Ausgabe im Format von $GITHUB_OUTPUT auf stdout; ist $GITHUB_STEP_SUMMARY gesetzt, kommt
#   dort eine Tabelle mit Grund dazu. Exit 2 = Aufruffehler, sonst 0 (auch im Zweifel).
#   Umgebung: CI_EREIGNIS    `github.event_name`; alles außer `pull_request` prüft voll
#             CI_KOPF        Kopf-Commit des PRs (für die Umnummerierung)
#             CI_DIFF_BASIS  Vergleichsbasis (Vorgabe HEAD^1: bei `pull_request` ist HEAD der
#                            Merge-Commit, sein erster Elternteil die Spitze des Ziel-Branches)
#             CI_REMOTE      Remote, von dem die Kette hinter dem Kopf geholt wird (Vorgabe origin)
#             CI_GH          Kommando für GitHub-Zugriffe (Vorgabe gh; der Selbsttest setzt eine Attrappe)
#             GITHUB_REPOSITORY
#
# WIE: Bei einem PR legt das Skript die geänderten Dateien `scripts/bereiche.sh` vor (die
# Zuordnung steht nur dort). Ist der Kopf eine reine Umnummerierung des Migrations-Autofix
# (`scripts/nur-umnummeriert.sh vorgaenger`), übernimmt es jede Suite, die am Vorgänger grün war,
# JEDE FÜR SICH: die e2e-Suite läuft nur an fertig markierten PRs (Kopf von e2e.yml), ihr Fehlen
# darf die Übernahme der Frontend-Suite nicht verhindern. Die Rust-Suite läuft dann immer: der
# PR-Lauf prüft den Merge mit dem Ziel-Branch, auf dem die kollidierende Migration dazukam.
#
# IM ZWEIFEL ALLES: Kein PR, kein Diff, eine gescheiterte Abfrage oder ein Fehler in einem der
# beiden Skripte lässt die Suiten laufen. Nur ein ausdrückliches `false` spart.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"

case "${1:-}" in
  eins) SUITEN="rust frontend" ;;
  zwei) SUITEN="e2e" ;;
  *) sed -n '5,8p' "$0" >&2; exit 2 ;;
esac
[ $# -eq 1 ] || { sed -n '5,8p' "$0" >&2; exit 2; }

declare -A laeuft grund
for s in $SUITEN; do laeuft[$s]=true; grund[$s]="ja"; done

zusammenfassen() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "| Suite | läuft |"
    echo "| --- | --- |"
    for s in $SUITEN; do echo "| $s | ${grund[$s]} |"; done
  } >> "$GITHUB_STEP_SUMMARY"
}

ausgeben() {
  for s in $SUITEN; do printf '%s=%s\n' "$s" "${laeuft[$s]}"; done
  zusammenfassen
  exit 0
}

if [ "${CI_EREIGNIS:-}" != pull_request ]; then
  for s in $SUITEN; do grund[$s]="ja, Push-Lauf prüft voll"; done
  ausgeben
fi

# ── Bereiche aus dem Diff ────────────────────────────────────────────────────────────
dateien="$(git diff --name-only "${CI_DIFF_BASIS:-HEAD^1}" HEAD 2> /dev/null)" || {
  echo "Diff nicht bestimmbar: alles läuft." >&2
  for s in $SUITEN; do grund[$s]="ja, Diff nicht bestimmbar"; done
  ausgeben
}
printf '%s\n' "$dateien" >&2
bereiche="$(printf '%s\n' "$dateien" | "$SKRIPTE/bereiche.sh")" || {
  echo "bereiche.sh gescheitert: alles läuft." >&2
  ausgeben
}
for s in $SUITEN; do
  if grep -qx "$s=false" <<< "$bereiche"; then
    laeuft[$s]=false
    grund[$s]="nein, nicht betroffen"
  fi
done

# ── Reine Umnummerierung: je Suite vom Vorgänger übernehmen ──────────────────────────
kopf="${CI_KOPF:-}"
[ -n "$kopf" ] || ausgeben
# Der Kopf samt der Kette, die nur-umnummeriert.sh höchstens zurückgeht (5 + Rand). Scheitert
# der Fetch, fehlt die Kette, und es gibt keinen Vorgänger.
git fetch --no-tags --quiet --depth=8 "${CI_REMOTE:-origin}" "$kopf" 2> /dev/null || true
vorgaenger="$("$SKRIPTE/nur-umnummeriert.sh" vorgaenger "$kopf" 2> /dev/null || true)"
[ -n "$vorgaenger" ] || { echo "Kopf ist keine reine Umnummerierung." >&2; ausgeben; }
echo "Kopf unterscheidet sich von $vorgaenger nur durch Umnummerierung." >&2

# Die Rust-Suite läuft trotzdem (s. Kopf).
if [ -n "${laeuft[rust]+x}" ]; then
  laeuft[rust]=true
  grund[rust]="ja, läuft nach einer Umnummerierung immer"
fi
checks="$(mktemp)"
trap 'rm -f "$checks"' EXIT
# Erst holen, dann auswerten: eine gescheiterte Abfrage darf nicht als „grün“ enden.
if ! "${CI_GH:-gh}" api "repos/${GITHUB_REPOSITORY:-}/commits/$vorgaenger/check-runs?per_page=100" \
  --paginate > "$checks" 2> /dev/null; then
  echo "Check-Runs des Vorgängers nicht abrufbar: es läuft, was der Diff verlangt." >&2
  ausgeben
fi
for s in $SUITEN; do
  [ "$s" != rust ] || continue
  [ "${laeuft[$s]}" = true ] || continue
  if "$SKRIPTE/nur-umnummeriert.sh" gruen "$s" < "$checks"; then
    laeuft[$s]=false
    grund[$s]="nein, übernommen von ${vorgaenger:0:8} (nur umnummeriert, dort grün)"
  fi
done
ausgeben
