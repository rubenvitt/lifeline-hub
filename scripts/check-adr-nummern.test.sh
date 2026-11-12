#!/usr/bin/env bash
# Selbsttest für scripts/check-adr-nummern.sh (LLH-1660). Das Skript ist die einzige Stelle, die
# eine doppelt vergebene ADR-Nummer VOR dem Merge bemerkt, seit Kapitel 9 keine Tabelle mehr
# führt. Es irrt in beide Richtungen still: es sperrte jeden PR mit ADR oder ließe `alpha` rot
# werden.
#
# Gefahren gegen echte Repositories im Temp-Verzeichnis (Merge-Base, Diff-Status, Umbenennung).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-adr-nummern.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
ORDNER=docs/architektur/entscheidungen

# Ein Repository mit `alpha` als Ziel-Branch und ADR-0001, ADR-0002, ADR-0004 (0003 ist frei).
repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad/$ORDNER"
  git -C "$pfad" init -q -b alpha
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  for n in 0001-a 0002-b 0004-d; do echo "# $n" > "$pfad/$ORDNER/ADR-$n.md"; done
  echo "# Vorlage" > "$pfad/$ORDNER/VORLAGE.md"
  git -C "$pfad" add -A
  git -C "$pfad" commit -q -m basis
  git -C "$pfad" branch feature
  printf '%s\n' "$pfad"
}

datei() { # <repo> <branch> <pfad>
  git -C "$1" checkout -q "$2"
  mkdir -p "$(dirname "$1/$3")"
  echo "# inhalt $RANDOM$RANDOM" > "$1/$3"
  git -C "$1" add -A
  git -C "$1" commit -q -m "$3"
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

enthaelt() { # <name> <text>
  if grep -qF -- "$2" "$ARBEIT/ausgabe"; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — '$2' fehlt in der Ausgabe:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}

lauf() { # <repo>
  local code=0
  ( cd "$1" && "$SKRIPT_UNTER_TEST" alpha feature ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
  printf '%s\n' "$code"
}

echo "==> ADR-Nummern-Selbsttest"

# 1 — Branch ohne neue ADR, auch wenn `alpha` inzwischen eine bekommen hat.
r="$(repo_neu ohne)"
datei "$r" alpha "$ORDNER/ADR-0005-e.md"
datei "$r" feature src/x.rs
pruefe "1 Branch ohne ADR besteht" 0 "$(lauf "$r")"

# 2 — Freie Nummer über der höchsten.
r="$(repo_neu frei)"
datei "$r" feature "$ORDNER/ADR-0005-x.md"
pruefe "2 freie Nummer besteht" 0 "$(lauf "$r")"

# 3 — Kollision: `alpha` hat die Nummer inzwischen unter anderem Namen vergeben.
r="$(repo_neu kollision)"
datei "$r" feature "$ORDNER/ADR-0005-a.md"
datei "$r" alpha "$ORDNER/ADR-0005-b.md"
pruefe "3 Kollision schlägt fehl" 1 "$(lauf "$r")"
enthaelt "3 nennt die eigene Datei" "ADR-0005-a.md"
enthaelt "3 nennt die fremde Datei" "ADR-0005-b.md"
enthaelt "3 nennt die nächste freie Nummer" "ADR-0006"

# 4 — Eine Lücke zu füllen ist erlaubt (anders als bei Migrationen).
r="$(repo_neu luecke)"
datei "$r" feature "$ORDNER/ADR-0003-x.md"
pruefe "4 gefüllte Lücke besteht" 0 "$(lauf "$r")"

# 5 — Zwei neue ADRs mit derselben Nummer im Branch.
r="$(repo_neu doppelt)"
datei "$r" feature "$ORDNER/ADR-0005-x.md"
datei "$r" feature "$ORDNER/ADR-0005-y.md"
pruefe "5 doppelt im Branch schlägt fehl" 1 "$(lauf "$r")"
enthaelt "5 sagt mehrfach" "mehrfach im Branch"

# 6 — Der Branch benennt eine bestehende ADR um: ihr alter Name auf `alpha` ist nicht fremd.
r="$(repo_neu umbenannt)"
git -C "$r" checkout -q feature
git -C "$r" mv "$ORDNER/ADR-0002-b.md" "$ORDNER/ADR-0002-neuer-titel.md"
git -C "$r" commit -q -m umbenannt
pruefe "6 eigene Umbenennung besteht" 0 "$(lauf "$r")"

# 7 — Dieselbe Datei auf beiden Seiten (alpha in den Branch gemergt) ist keine Kollision.
r="$(repo_neu gemergt)"
datei "$r" alpha "$ORDNER/ADR-0005-e.md"
datei "$r" feature "$ORDNER/ADR-0006-x.md"
git -C "$r" merge -q --no-edit alpha
pruefe "7 nach Merge von alpha besteht" 0 "$(lauf "$r")"

# 8 — Die Vorlage und andere Dateien im Ordner zählen nicht.
r="$(repo_neu vorlage)"
datei "$r" feature "$ORDNER/NOTIZ.md"
pruefe "8 andere Dateien zählen nicht" 0 "$(lauf "$r")"

# 9 — Unbekannte Basis ist ein Umgebungsfehler, kein Verstoß.
r="$(repo_neu basisfehlt)"
code=0
( cd "$r" && "$SKRIPT_UNTER_TEST" gibtsnicht feature ) > "$ARBEIT/ausgabe" 2>&1 || code=$?
pruefe "9 fehlende Basis ist Exit 2" 2 "$code"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im ADR-Nummern-Selbsttest." >&2
  exit 1
fi
echo "==> OK: ADR-Nummern-Selbsttest."
