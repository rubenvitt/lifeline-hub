#!/usr/bin/env bash
# Selbsttest für scripts/gate-dateien.sh (LLH-2090). Das Skript meldet, wenn ein PR die Prüfungen
# ändert, die ihn bewerten. Es irrt in beide Richtungen still: übersieht es eine Gate-Datei, ändert
# ein PR seine eigene Prüfung unbemerkt; meldet es jede Datei, liest niemand mehr hin.
#
# Gefahren gegen ein echtes Repository im Temp-Verzeichnis (Merge-Base, Umbenennung, Löschung).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/gate-dateien.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/scripts/lib" "$pfad/frontend/lint" "$pfad/src" "$pfad/.github/workflows"
  git -C "$pfad" init -q -b alpha
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  for d in scripts/check-all.sh scripts/check-fmt.sh scripts/lib/schritte.sh src/main.rs \
    frontend/playwright.config.ts frontend/lint/riegel-plugin.js .github/workflows/ci.yml; do
    echo "# $d" > "$pfad/$d"
  done
  git -C "$pfad" add -A
  git -C "$pfad" commit -q -m basis
  git -C "$pfad" checkout -q -b feature
  printf '%s\n' "$pfad"
}

aendern() { # <repo> <pfad>…
  local r="$1"
  shift
  for d in "$@"; do
    mkdir -p "$(dirname "$r/$d")"
    echo "# neu $RANDOM" >> "$r/$d"
  done
  git -C "$r" add -A
  git -C "$r" commit -q -m aenderung
}

lauf() { # <repo> → Ausgabe in $ARBEIT/ausgabe, Exit-Code auf stdout
  local code=0
  (cd "$1" && GITHUB_STEP_SUMMARY="$ARBEIT/summary" "$SKRIPT_UNTER_TEST" alpha feature) \
    > "$ARBEIT/ausgabe" 2>&1 || code=$?
  printf '%s\n' "$code"
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

enthaelt() { # <name> <datei> <text>
  if grep -qF -- "$3" "$2"; then echo "  ok   $1"; else
    echo "  FEHL $1 — '$3' fehlt:" >&2
    sed 's/^/         /' "$2" >&2
    fehler=$((fehler + 1))
  fi
}

fehlt() { # <name> <datei> <text>
  if grep -qF -- "$3" "$2"; then
    echo "  FEHL $1 — '$3' steht in der Ausgabe:" >&2
    sed 's/^/         /' "$2" >&2
    fehler=$((fehler + 1))
  else echo "  ok   $1"; fi
}

echo "==> Gate-Dateien-Selbsttest"

# 1 — nur Anwendungscode: keine Meldung, Exit 0, keine Zusammenfassung.
r="$(repo_neu ohne)"
aendern "$r" src/main.rs frontend/src/App.tsx
pruefe "ohne Gate-Datei: Exit 0" 0 "$(lauf "$r")"
fehlt "ohne Gate-Datei: kein Hinweis" "$ARBEIT/ausgabe" "::warning"
pruefe "ohne Gate-Datei: keine Zusammenfassung" no "$([ -s "$ARBEIT/summary" ] && echo yes || echo no)"

# 2 — Gate-Dateien jeder Art: je eine Warnung, trotzdem Exit 0 (beobachten, nicht sperren).
rm -f "$ARBEIT/summary"
r="$(repo_neu mit)"
aendern "$r" scripts/check-fmt.sh scripts/lib/schritte.sh frontend/playwright.config.ts \
  frontend/lint/riegel-plugin.js .github/workflows/ci.yml frontend/.oxlintrc.json \
  .claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md src/main.rs
pruefe "mit Gate-Dateien: Exit 0" 0 "$(lauf "$r")"
for d in scripts/check-fmt.sh scripts/lib/schritte.sh frontend/playwright.config.ts \
  frontend/lint/riegel-plugin.js .github/workflows/ci.yml frontend/.oxlintrc.json \
  .claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md; do
  enthaelt "meldet $d" "$ARBEIT/ausgabe" "::warning file=$d::"
done
fehlt "meldet keinen Anwendungscode" "$ARBEIT/ausgabe" "src/main.rs"
enthaelt "Zusammenfassung nennt die Zahl" "$ARBEIT/summary" "7 Gate-Dateien"

# 3 — gelöscht und umbenannt zählt auch: ein entfernter Schritt ist die stillste Änderung.
r="$(repo_neu weg)"
git -C "$r" rm -q scripts/check-fmt.sh
git -C "$r" mv scripts/lib/schritte.sh scripts/lib/anders.sh
git -C "$r" commit -q -m weg
pruefe "gelöscht/umbenannt: Exit 0" 0 "$(lauf "$r")"
enthaelt "meldet gelöschte Datei" "$ARBEIT/ausgabe" "scripts/check-fmt.sh"
enthaelt "meldet umbenannte Datei (alter Name)" "$ARBEIT/ausgabe" "scripts/lib/schritte.sh"

# 4 — Änderungen nur auf der Basis seit der Abzweigung zählen nicht.
r="$(repo_neu basis)"
git -C "$r" checkout -q alpha
aendern "$r" scripts/check-all.sh
git -C "$r" checkout -q feature
pruefe "nur Basis geändert: Exit 0" 0 "$(lauf "$r")"
fehlt "nur Basis geändert: kein Hinweis" "$ARBEIT/ausgabe" "::warning"

# 5 — kaputter Ref: Exit 2 mit Grund, nie ein stilles „nichts geändert“.
r="$(repo_neu kaputt)"
code=0
(cd "$r" && "$SKRIPT_UNTER_TEST" gibtsnicht feature) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "kaputter Ref: Exit 2" 2 "$code"
enthaelt "kaputter Ref: Grund" "$ARBEIT/ausgabe" "kein Commit"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle rot." >&2
  exit 1
fi
echo "==> OK: Gate-Dateien-Selbsttest grün."
