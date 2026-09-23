#!/usr/bin/env bash
# LFH-658: Migrationsnummern gegen den AKTUELLEN Ziel-Branch prüfen.
#
#   scripts/check-migrationen.sh [--umnummerieren] [<basis>] [<kopf>]
#     <basis>  Ziel-Branch, gegen den geprüft wird   (Vorgabe: origin/alpha)
#     <kopf>   geprüfter Stand                        (Vorgabe: HEAD)
#   Exit 0 = in Ordnung · 1 = Verstoß · 2 = Aufruf- oder Umgebungsfehler
#
# WARUM: jeder Branch nimmt beim Anlegen die nächste freie Nummer. Zwei parallele Branches
# greifen zur selben, Git mergt das konfliktfrei (die Dateinamen sind verschieden), und rot
# wird erst `alpha` — in jedem Test, der eine Datenbank anlegt (22.09.2026: dreimal `0106`).
# `db::tests::migrationsnummern_sind_eindeutig` sieht nur den eigenen Stand; zwei PRs, die je
# für sich grün sind, machen `alpha` zusammen rot. Dieses Skript sieht beide.
#
# DIE REGELN (Begründung in CLAUDE.md, „Backend — Migrationsvergabe"):
#   1. Unveränderlich: eine Migration, die es an der ABZWEIGUNG (merge-base) schon gab, wird
#      weder geändert noch umbenannt noch gelöscht — eingespielte Datenbanken scheitern sonst
#      an der Prüfsumme bzw. an der fehlenden Version. Maßstab ist die Abzweigung und nicht
#      die Basis: was die Basis seit der Abzweigung neu hat, fehlt dem Branch nur, er löscht
#      es nicht.
#   2. Anhängen, nicht einschieben: jede Migration, die der Branch seit der Abzweigung neu
#      mitbringt, trägt eine Nummer GRÖSSER als jede Nummer auf der BASIS — nicht bloß eine
#      freie. sqlx 0.9 spielt eine kleinere, fehlende Version still nach
#      (`db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`): eine DB, die
#      schon 0118 hat, nähme ein später gemergtes 0117 ohne Meldung mit, eine frische DB
#      spielte beide in Nummernfolge. Bei den Tabellen-Rebuilds dieses Projekts ist das ein
#      stiller Schemaunterschied.
#   3. Die neuen Nummern eines Branches sind untereinander verschieden und vierstellig.
#
# Geprüft wird, was COMMITTET ist (Diff Abzweigung..Kopf), nicht der Arbeitsbaum.
#
# --umnummerieren (nur mit Kopf = HEAD): legt die neuen Migrationen des Branches in ihrer
# Reihenfolge auf die nächsten freien Nummern über der Basis und ersetzt in allen
# versionierten Dateien jeden Verweis auf den alten Dateinamen (`include_str!`, Doku). Beides
# läuft über einen Zwischennamen, weil das Ziel der einen Datei der heutige Platz einer
# anderen sein kann. Committet wird nicht. Bestands-Migrationen fasst es nie an — liegt ein
# Verstoß gegen Regel 1 vor, bricht es ab.
set -euo pipefail

UMNUMMERIEREN=0
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --umnummerieren) UMNUMMERIEREN=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    -*) echo "FEHLER: unbekannte Option '$1'." >&2; exit 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
BASIS="${POSITIONAL[0]:-origin/alpha}"
KOPF="${POSITIONAL[1]:-HEAD}"
[ "${#POSITIONAL[@]}" -le 2 ] || { echo "FEHLER: höchstens <basis> und <kopf>." >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

commit_von() { # <ref> <rolle>
  git rev-parse --verify --quiet "$1^{commit}" || {
    echo "FEHLER: $2 '$1' ist kein Commit (fehlt ein 'git fetch'?)." >&2
    exit 2
  }
}
B="$(commit_von "$BASIS" Basis)"
K="$(commit_von "$KOPF" Kopf)"
M="$(git merge-base "$K" "$B")" || {
  echo "FEHLER: '$KOPF' und '$BASIS' haben keine gemeinsame Abzweigung." >&2
  exit 2
}

if [ "$UMNUMMERIEREN" = 1 ] && [ "$K" != "$(git rev-parse HEAD)" ]; then
  echo "FEHLER: --umnummerieren arbeitet im Arbeitsbaum und braucht Kopf = HEAD." >&2
  exit 2
fi

# Nummer einer Migrationsdatei (Pfad oder Name); leer, wenn das Präfix nicht vierstellig ist.
nummer() {
  local name="${1##*/}"
  local praefix="${name%%_*}"
  if [[ "$praefix" =~ ^[0-9]{4}$ ]] && [ "$praefix" != "$name" ]; then
    printf '%d\n' "$((10#$praefix))"
  fi
}

# Höchste Nummer auf der Basis.
max_basis=0
while IFS= read -r pfad; do
  n="$(nummer "$pfad")"
  [ -n "$n" ] && [ "$n" -gt "$max_basis" ] && max_basis="$n"
done < <(git ls-tree --name-only "$B" migrations/ | grep '\.sql$' || true)

verstoesse=()
neue=()
# --no-renames: eine Umbenennung erscheint als D (alt) + A (neu) — das D ist der Verstoß.
while IFS=$'\t' read -r status pfad; do
  case "$pfad" in *.sql) ;; *) continue ;; esac
  case "$status" in
    A) neue+=("$pfad") ;;
    D) verstoesse+=("bestehende Migration gelöscht oder umbenannt: $pfad") ;;
    *) verstoesse+=("bestehende Migration geändert: $pfad") ;;
  esac
done < <(git diff --no-renames --name-status "$M" "$K" -- migrations/)

bestand_verletzt=${#verstoesse[@]}

# Neue Dateien in Nummernfolge (bei gleicher Nummer nach Name) — dieselbe Reihenfolge, in der
# `--umnummerieren` sie ablegt.
sortierte_neue=()
if [ "${#neue[@]}" -gt 0 ]; then
  while IFS= read -r pfad; do sortierte_neue+=("$pfad"); done \
    < <(printf '%s\n' "${neue[@]}" | sort)
fi

gesehen=" "
for pfad in ${sortierte_neue[@]+"${sortierte_neue[@]}"}; do
  n="$(nummer "$pfad")"
  if [ -z "$n" ]; then
    verstoesse+=("keine vierstellige Nummer vor dem ersten '_': $pfad")
    continue
  fi
  if [ "$n" -le "$max_basis" ]; then
    verstoesse+=("$(printf '%s: Nummer %04d liegt nicht über %04d, der höchsten auf %s' \
      "$pfad" "$n" "$max_basis" "$BASIS")")
  fi
  case "$gesehen" in
    *" $n "*) verstoesse+=("$(printf 'Nummer %04d mehrfach im Branch: %s' "$n" \
      "$(printf '%s\n' "${sortierte_neue[@]}" | while IFS= read -r p; do
          [ "$(nummer "$p")" = "$n" ] && printf '%s ' "$p"; done)")") ;;
  esac
  gesehen="$gesehen$n "
done

if [ "${#verstoesse[@]}" -eq 0 ]; then
  if [ "$UMNUMMERIEREN" = 1 ]; then
    echo "==> Nichts umzunummerieren: die neuen Migrationen liegen schon über $BASIS."
  else
    printf '==> OK: %d neue Migration(en), alle über %04d (%s).\n' \
      "${#sortierte_neue[@]}" "$max_basis" "$BASIS"
  fi
  exit 0
fi

# Vorschlag: die neuen Dateien in ihrer Reihenfolge auf max+1, max+2, …
vorschlag=()
naechste=$((max_basis + 1))
for pfad in ${sortierte_neue[@]+"${sortierte_neue[@]}"}; do
  name="${pfad##*/}"
  beschreibung="${name#*_}"
  [ "$beschreibung" = "$name" ] && beschreibung="$name"
  vorschlag+=("$pfad|migrations/$(printf '%04d' "$naechste")_$beschreibung")
  naechste=$((naechste + 1))
done

if [ "$UMNUMMERIEREN" = 0 ] || [ "$bestand_verletzt" -gt 0 ]; then
  echo "==> FEHLER: Migrationsnummern gegen $BASIS verletzt:" >&2
  for v in "${verstoesse[@]}"; do echo "    - $v" >&2; done
  if [ "$bestand_verletzt" -gt 0 ]; then
    echo "    Eine eingespielte Migration wird nie geändert — die Änderung gehört in eine" >&2
    echo "    NEUE Migration. Das lässt sich nicht wegnummerieren." >&2
  fi
  if [ "${#vorschlag[@]}" -gt 0 ]; then
    echo "    Nächste freie Nummern für die neuen Migrationen:" >&2
    for v in "${vorschlag[@]}"; do echo "      ${v%%|*}  ->  ${v#*|}" >&2; done
    if [ "$bestand_verletzt" -eq 0 ]; then
      echo "    Umlegen samt Verweisen: scripts/check-migrationen.sh --umnummerieren $BASIS" >&2
    fi
  fi
  exit 1
fi

# ── Umnummerieren ────────────────────────────────────────────────────────────────────
# Zwei Phasen, für Dateien wie für Verweise: erst alles auf einen Zwischennamen, dann auf
# das Ziel. Sonst träfe `0003_x -> 0004_x` die Datei `0004_y`, die selbst noch umzieht.
ersetze_ueberall() { # <alt> <neu> — ersetzt den Text in allen versionierten Dateien
  local datei
  # `|| true`: ohne Fundstelle endet git grep mit 1, und pipefail beendete das Skript.
  { git grep -l -F -z -e "$1" -- . || true; } | while IFS= read -r -d '' datei; do
    ALT="$1" NEU="$2" perl -pi -e 's/\Q$ENV{ALT}\E/$ENV{NEU}/g' "$datei"
  done
}

i=0
for v in "${vorschlag[@]}"; do
  alt="${v%%|*}"
  zwischen="migrations/.lfh658-umzug-$i.sql"
  git mv "$alt" "$zwischen"
  ersetze_ueberall "${alt##*/}" "${zwischen##*/}"
  i=$((i + 1))
done
i=0
for v in "${vorschlag[@]}"; do
  alt="${v%%|*}"
  neu="${v#*|}"
  zwischen="migrations/.lfh658-umzug-$i.sql"
  git mv "$zwischen" "$neu"
  ersetze_ueberall "${zwischen##*/}" "${neu##*/}"
  if [ "$alt" = "$neu" ]; then
    echo "    bleibt  $neu"
  else
    echo "    $alt  ->  $neu"
  fi
  i=$((i + 1))
done

echo "==> Umnummeriert (nicht committet). Dateinamen-Verweise sind ersetzt; die alte Nummer"
echo "    kann noch in Bezeichnern stehen (etwa Testnamen wie migration_0117_…):"
for v in "${vorschlag[@]}"; do
  alt="${v%%|*}"
  n="$(nummer "$alt")"
  [ -n "$n" ] || continue
  git grep -n -E "migration_$(printf '%04d' "$n")_" -- . || true
done
