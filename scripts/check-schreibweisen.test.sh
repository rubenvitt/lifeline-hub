#!/usr/bin/env bash
# Selbsttest für scripts/check-schreibweisen.sh (LFH-1053). Der Wächter irrt in beide Richtungen
# still: ließe er eine Kollision durch, entstünde wieder ein Release ohne macOS-Artefakte
# (LFH-1050); schlüge er auf übliche Paare wie `X.tsx` neben `x.css` an, würde er abgeschaltet.
#
# Gefahren gegen ein Wegwerf-Git-Repo im Temp-Verzeichnis, je Fall frisch aufgebaut. Linux
# unterscheidet die Schreibung, deshalb lassen sich die Kollisionen hier überhaupt anlegen.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-schreibweisen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

anlegen() { # <pfad>… → leere Dateien samt Verzeichnissen
  local p
  for p in "$@"; do
    mkdir -p "$(dirname "$p")"
    : > "$p"
  done
}

baum_neu() { # <name> → Pfad eines grünen Repos mit den üblichen Paaren, alles versioniert
  local b="$ARBEIT/$1"
  mkdir -p "$b"
  (
    cd "$b"
    git init -q
    anlegen README.md .gitignore \
      src/EinsatzSeite.tsx src/EinsatzSeite.test.tsx src/EinsatzSeite.css \
      src/GefahrenMatrix.tsx src/gefahrenMatrix.css \
      src/stab/MedienlageUebernahme.tsx src/stab/MedienlageUebernahme.test.tsx \
      src/stab/medienlageQuelle.ts \
      src/lagekarte.ts src/lagekarte/index.ts
    printf 'build/\n' > .gitignore
    git add -A
  )
  printf '%s\n' "$b"
}

fall() { # <name> <erwartet: gruen|rot> <befehl, der das Repo $B verändert> [<muster>…]
  local B name="$1" soll="$2" befehl="$3"
  shift 3
  B="$(baum_neu "$(printf '%s' "$name" | tr -c '[:alnum:]' '_')")"
  (cd "$B" && eval "$befehl")
  local ist=gruen
  "$SKRIPT_UNTER_TEST" "$B" > "$ARBEIT/ausgabe" 2>&1 || ist=rot
  if [ "$ist" != "$soll" ]; then
    echo "  FEHL $name — erwartet $soll, gemessen $ist:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
    return 0
  fi
  local muster
  for muster in "$@"; do
    if ! grep -qF -- "$muster" "$ARBEIT/ausgabe"; then
      echo "  FEHL $name — '$muster' fehlt in der Ausgabe:" >&2
      sed 's/^/         /' "$ARBEIT/ausgabe" >&2
      fehler=$((fehler + 1))
      return 0
    fi
  done
  echo "  ok   $name"
}

echo "==> Selbsttest check-schreibweisen.sh"
fall "übliche Paare (Test, Stylesheet, Modul neben Verzeichnis gleicher Schreibung)" gruen ":" "OK"
fall "Stand vor LFH-1050: Modul .ts neben Komponente .tsx" rot \
  "anlegen src/stab/medienlageUebernahme.ts && git add -A" \
  "         src/stab/MedienlageUebernahme.tsx, src/stab/medienlageUebernahme.ts" "umbenennen"
fall "Deklaration .d.ts neben Modul .ts" rot \
  "anlegen src/Typen.ts src/typen.d.ts && git add -A" "src/Typen.ts" "src/typen.d.ts"
fall "Modul neben Verzeichnis in anderer Schreibung" rot \
  "anlegen src/Lagekarte.tsx && git add -A" "src/Lagekarte.tsx" "src/lagekarte"
fall "zwei Verzeichnisse, verschiedene Dateien darin" rot \
  "anlegen src/Stab/andere.ts && git add -A" "src/Stab" "src/stab"
fall "zwei Dateien gleichen Namens, keine Moduldateien" rot \
  "anlegen readme.md && git add -A" "README.md" "readme.md"
fall "Datei neben Verzeichnis in anderer Schreibung" rot \
  "anlegen Src && git add -A" "Src" "src"
fall "tief verschachtelt" rot \
  "anlegen src/a/b/C/x.rs src/a/b/c/y.rs && git add -A" "src/a/b/C" "src/a/b/c"
fall "neue, noch nicht hinzugefügte Datei" rot \
  "anlegen src/einsatzSeite.tsx" "src/einsatzSeite.tsx" "src/EinsatzSeite.tsx"
fall "ignorierte Datei zählt nicht" gruen \
  "anlegen build/README.md build/readme.md"
fall "Stylesheet in anderer Schreibung als ein Modul" gruen \
  "anlegen src/stab/medienlageUebernahme.css && git add -A"
fall "nur die kollidierende Gruppe wird genannt" rot \
  "anlegen src/stab/medienlageUebernahme.ts && git add -A" "medienlageUebernahme"
if grep -qF "EinsatzSeite" "$ARBEIT/ausgabe"; then
  echo "  FEHL nur die kollidierende Gruppe — EinsatzSeite steht in der Ausgabe:" >&2
  sed 's/^/         /' "$ARBEIT/ausgabe" >&2
  fehler=$((fehler + 1))
fi

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle falsch." >&2
  exit 1
fi
echo "==> OK: der Wächter trennt alle Fälle."
