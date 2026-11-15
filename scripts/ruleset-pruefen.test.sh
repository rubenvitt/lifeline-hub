#!/usr/bin/env bash
# Selbsttest für scripts/ruleset-pruefen.sh (LLH-1895). Am 14.11.2026 bekam `Migrationsnummern` im
# Ruleset von `alpha` die Quelle „GitHub Actions“; der Status zählte nicht mehr, und alle grünen PRs
# hingen über Nacht. Das Skript ist die eine Stelle, die so etwas bemerkt. Es irrt in beide
# Richtungen still: übersieht es eine Abweichung, hängen wieder alle PRs; meldet es eine, die keine
# ist, mailt jeder Lauf grundlos.
#
# Gelesen wird die Antwort von `GET repos/{repo}/rules/branches/alpha`, hier als Attrappe.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/ruleset-pruefen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

[ -x "$SKRIPT_UNTER_TEST" ] || { echo "FEHLER: $SKRIPT_UNTER_TEST fehlt oder ist nicht ausführbar." >&2; exit 1; }

# Ein Eintrag der Pflichtliste im Ruleset: <context> [<integration_id>]
eintrag() {
  if [ -n "${2:-}" ]; then
    jq -cn --arg c "$1" --argjson i "$2" '{context: $c, integration_id: $i}'
  else
    jq -cn --arg c "$1" '{context: $c}'
  fi
}
# Eine Regel `required_status_checks` aus Einträgen; strict als erstes Argument.
regel() { # <strict> <eintrag>…
  local strict="$1"; shift
  printf '%s\n' "$@" | jq -cs --argjson s "$strict" '{type: "required_status_checks",
    ruleset_source_type: "Repository", ruleset_id: 17017911,
    parameters: {strict_required_status_checks_policy: $s, do_not_enforce_on_create: false,
      required_status_checks: .}}'
}
# Die Antwort der API: Regeln als Array, dazu eine fremde Regel wie im echten Ruleset.
antwort() { printf '%s\n' "$@" '{"type":"non_fast_forward","ruleset_id":17017911}' | jq -cs '.'; }

# Der Stand vom 15.11.2026 nach dem Fix: in Ordnung.
GUT_SCHNELL="$(eintrag Schnellprüfungen 15368)"
GUT_MIGR="$(eintrag Migrationsnummern)"
GUT_ADR="$(eintrag ADR-Nummern)"
GUT_BAUT="$(eintrag 'Baut mit Ziel-Branch')"

lauf() { # <json>
  code=0
  printf '%s' "$1" | "$SKRIPT_UNTER_TEST" > "$ARBEIT/ausgabe" 2>&1 || code=$?
}
pruefe_code() { # <name> <erwartet>
  if [ "$code" = "$2" ]; then
    echo "  ok   $1 (Exit $code)"
  else
    echo "  FEHL $1 — Exit erwartet $2, gemessen $code" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}
enthaelt() { # <name> <text>
  if grep -qF -- "$2" "$ARBEIT/ausgabe"; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — '$2' fehlt in der Ausgabe:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}
fehlt_text() { # <name> <text>
  if grep -qF -- "$2" "$ARBEIT/ausgabe"; then
    echo "  FEHL $1 — '$2' steht unerwartet in der Ausgabe:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  else
    echo "  ok   $1"
  fi
}

echo "==> ruleset-pruefen: in Ordnung"
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR" "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "Stand nach dem Fix vom 15.11." 0
lauf "$(antwort "$(regel false "$(eintrag Schnellprüfungen)" "$GUT_MIGR" "$GUT_ADR" "$(eintrag 'Baut mit Ziel-Branch' 15368)")")"
pruefe_code "Checks ohne Quelle oder mit GitHub Actions" 0

echo "==> ruleset-pruefen: der Fall vom 14.11. (Quelle an einem Status)"
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$(eintrag Migrationsnummern 15368)" "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "Quelle an Migrationsnummern ist rot" 1
enthaelt "nennt den Status" "Migrationsnummern"
enthaelt "nennt die Abhilfe" "Any source"
fehlt_text "nennt die übrigen nicht" "ADR-Nummern"

echo "==> ruleset-pruefen: fremde App an einem Check"
lauf "$(antwort "$(regel false "$(eintrag Schnellprüfungen 99999)" "$GUT_MIGR" "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "fremde App an Schnellprüfungen ist rot" 1
enthaelt "nennt den Check" "Schnellprüfungen"
enthaelt "nennt die App" "99999"

echo "==> ruleset-pruefen: Liste weicht ab"
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR" "$GUT_BAUT")")"
pruefe_code "fehlende Pflicht ist rot" 1
enthaelt "nennt die fehlende" "ADR-Nummern"
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR" "$GUT_ADR" "$GUT_BAUT" "$(eintrag 'e2e 1/4' 15368)")")"
pruefe_code "überzählige alte Suite ist rot" 1
enthaelt "nennt die überzählige" "e2e 1/4"
lauf "$(antwort '{"type":"deletion","ruleset_id":1}')"
pruefe_code "ohne jede Pflicht ist rot" 1
enthaelt "nennt alle als fehlend" "Baut mit Ziel-Branch"

echo "==> ruleset-pruefen: up to date"
lauf "$(antwort "$(regel true "$GUT_SCHNELL" "$GUT_MIGR" "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "strict ist rot" 1
enthaelt "nennt die Einstellung" "up to date"

echo "==> ruleset-pruefen: zwei Rulesets"
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR")" "$(regel false "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "Pflichten aus zwei Rulesets ergeben zusammen die Liste" 0
lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR" "$GUT_ADR" "$GUT_BAUT")" "$(regel false "$(eintrag ADR-Nummern 15368)")")"
pruefe_code "Quelle in einem zweiten Ruleset ist rot" 1
enthaelt "nennt den Status aus dem zweiten" "ADR-Nummern"

lauf "$(antwort "$(regel false "$GUT_SCHNELL" "$GUT_MIGR")" "$(regel true "$GUT_ADR" "$GUT_BAUT")")"
pruefe_code "strict nur im zweiten Ruleset ist rot" 1
enthaelt "nennt die Einstellung aus dem zweiten" "up to date"

echo "==> ruleset-pruefen: nicht lesbar"
lauf 'kein json'
pruefe_code "kaputtes JSON" 2
lauf '{"message":"Not Found"}'
pruefe_code "Fehlerantwort statt Regeln" 2
lauf ''
pruefe_code "leere Antwort" 2
lauf '[{"type":"required_status_checks","parameters":{"required_status_checks":["Schnellprüfungen"]}}]'
pruefe_code "Pflicht-Checks in falscher Form" 2
lauf '[{"type":"required_status_checks","parameters":"kaputt"}]'
pruefe_code "Parameter in falscher Form" 2

echo "==> ruleset-pruefen: Liste"
code=0
"$SKRIPT_UNTER_TEST" --liste > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe_code "--liste" 0
enthaelt "Liste trägt Migrationsnummern als Status" "$(printf 'Migrationsnummern\tstatus')"
enthaelt "Liste trägt Schnellprüfungen als Check" "$(printf 'Schnellprüfungen\tcheck')"
[ "$(wc -l < "$ARBEIT/ausgabe" | tr -d ' ')" = 4 ] && echo "  ok   genau vier Pflicht-Checks" \
  || { echo "  FEHL Liste hat nicht genau vier Einträge" >&2; fehler=$((fehler + 1)); }

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ruleset-pruefen." >&2
  exit 1
fi
echo "==> OK: Selbsttest ruleset-pruefen."
