#!/usr/bin/env bash
# Selbsttest für scripts/lib/backend-binaer.sh — wo Schritt 7 des Sammel-Gates das Backend-Binary
# sucht und was er meldet, wenn es dort nicht liegt (LFH-518).
#
# Die Suche irrt still: schaut sie nach `./target`, obwohl Cargo per `CARGO_TARGET_DIR` oder
# `build.target-dir` woanders baut, überspringt das Gate die Browsertests und meldet trotzdem OK
# (mit Lücke). Gefahren gegen das echte `cargo metadata`, nicht gegen eine Attrappe: die Frage
# ist, ob die Funktion Cargo folgt, und das weiß nur Cargo.
#
# HERMETISCH (LFH-847): Cargo liest `.cargo/config.toml` in JEDEM Elternverzeichnis, und das
# schlägt `$CARGO_HOME/config.toml`; die Datei im Checkout schlägt beide. Die „globale“
# `build.target-dir` aus LFH-518 steht deshalb als `.cargo/config.toml` ÜBER den Wegwerf-Crates,
# und eine nutzereigene in `~/.cargo` färbt keinen Fall. Kein eigenes CARGO_HOME: Toolchain-
# Manager (mise) richteten Rust sonst bei jedem Lauf darin neu ein, mit Netz — Muster
# `scripts/bauziel.test.sh` (LFH-520). Gegen den echten Workspace läuft nur der Fall
# `CARGO_TARGET_DIR`, der jede Config schlägt.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SKRIPTE/.." && pwd)"
LIB="$SKRIPTE/lib/backend-binaer.sh"
# Physischer Pfad: Cargo meldet ihn aufgelöst (macOS: /var → /private/var).
ARBEIT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Ein Verzeichnis ohne Cargo.toml: hier scheitert jede Cargo-Abfrage.
LEER="$ARBEIT/leer"
mkdir -p "$LEER"
# Die „globale“ `build.target-dir` außerhalb der Crates, als Eltern-Konfiguration.
mkdir -p "$ARBEIT/.cargo"
printf '[build]\ntarget-dir = "%s"\n' "$ARBEIT/geteilt" > "$ARBEIT/.cargo/config.toml"

# Wegwerf-Crate <name>: eigener Workspace, damit Cargo nicht nach einem umgebenden sucht. Mit
# <config>=ja bekommt sie die ECHTE Repo-Konfiguration, wie jeder Checkout seit LFH-520.
crate() { # <name> <config:ja|nein>
  local d="$ARBEIT/$1"
  mkdir -p "$d/src"
  printf '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\n\n[workspace]\n' \
    > "$d/Cargo.toml"
  : > "$d/src/lib.rs"
  if [ "$2" = ja ]; then
    mkdir -p "$d/.cargo"
    cp "$ROOT/.cargo/config.toml" "$d/.cargo/config.toml"
  fi
}
crate checkout ja
crate global nein

# Ruft <funktion> <argumente…> in einer frischen Shell unter `set -euo pipefail` auf, wie
# check-all.sh, und mit sauberer Cargo-Umgebung: kein CARGO_TARGET_DIR, kein PW_BINAER. Der
# Aufrufer setzt nur, was der Fall braucht (<VAR=wert…> vor dem `--`). stdout nach
# $ARBEIT/aus (der Pfad, wie check-all.sh ihn liest), stderr nach $ARBEIT/meldung — ein Hinweis
# von Cargo oder mise färbt den Pfad nicht. Exit-Code als Rückgabe.
sauber() { # <VAR=wert…> -- <funktion> <argumente…>
  local vars=() rc
  while [ "$1" != -- ]; do
    vars+=("$1")
    shift
  done
  shift
  set +e
  env -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET_DIR -u PW_BINAER \
    ${vars[@]+"${vars[@]}"} bash -c '
      set -euo pipefail
      . "$1"
      shift
      "$@"
    ' _ "$LIB" "$@" > "$ARBEIT/aus" 2> "$ARBEIT/meldung"
  rc=$?
  set -e
  return "$rc"
}

zeige() {
  sed 's/^/     | /' "$ARBEIT/aus" "$ARBEIT/meldung" >&2
}

pruefe() { # <name> <soll-exit> <ist-exit>
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: Exit $3, erwartet $2" >&2
    zeige
    fehler=1
  fi
}

ausgabe_ist() { # <name> <soll>
  local ist
  ist="$(cat "$ARBEIT/aus")"
  if [ "$ist" = "$2" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: Ausgabe '$ist', erwartet '$2'" >&2
    zeige
    fehler=1
  fi
}

enthaelt() { # <name> <muster>   (Meldungen stehen auf stderr)
  if grep -qE -- "$2" "$ARBEIT/meldung"; then
    echo "ok   $1"
  else
    echo "FAIL $1: '$2' fehlt in der Ausgabe" >&2
    zeige
    fehler=1
  fi
}

# ── backend_binaer_pfad ─────────────────────────────────────────────────────────────

# 1 — Vorgabe: mit der Repo-Konfiguration baut der Checkout nach <Workspace>/target, auch unter
# einer globalen `build.target-dir`.
rc=0; sauber -- backend_binaer_pfad "$ARBEIT/checkout" || rc=$?
pruefe "1 Vorgabe → Exit 0" 0 "$rc"
ausgabe_ist "1 Vorgabe → <Workspace>/target/debug/lifeline-hub" "$ARBEIT/checkout/target/debug/lifeline-hub"

# 2 — CARGO_TARGET_DIR außerhalb des Worktrees, gegen den echten Workspace.
rc=0; sauber CARGO_TARGET_DIR="$ARBEIT/extern" -- backend_binaer_pfad "$ROOT" || rc=$?
pruefe "2 CARGO_TARGET_DIR → Exit 0" 0 "$rc"
ausgabe_ist "2 CARGO_TARGET_DIR wird befolgt" "$ARBEIT/extern/debug/lifeline-hub"

# 3 — der Befund aus LFH-518: globale `build.target-dir` in der Cargo-Config, hier ohne
# Repo-Konfiguration (ein Checkout vor LFH-520).
rc=0; sauber -- backend_binaer_pfad "$ARBEIT/global" || rc=$?
pruefe "3 build.target-dir → Exit 0" 0 "$rc"
ausgabe_ist "3 globale build.target-dir wird befolgt" "$ARBEIT/geteilt/debug/lifeline-hub"

# 4 — PW_BINAER gewinnt, Cargo wird gar nicht erst gefragt (die Wurzel hat kein Cargo.toml;
# eine Abfrage scheiterte).
rc=0; sauber PW_BINAER=/opt/bin/lifeline-hub -- backend_binaer_pfad "$LEER" || rc=$?
pruefe "4 PW_BINAER → Exit 0 ohne Cargo" 0 "$rc"
ausgabe_ist "4 PW_BINAER wird unverändert übernommen" "/opt/bin/lifeline-hub"

# 5 — relatives PW_BINAER wird gegen das Arbeitsverzeichnis des Gates aufgelöst: Playwright
# läuft unter `pnpm -C frontend` und läse denselben relativen Pfad sonst von dort aus.
rc=0; (cd "$ARBEIT" && sauber PW_BINAER=bin/lifeline-hub -- backend_binaer_pfad "$ROOT") || rc=$?
pruefe "5 relatives PW_BINAER → Exit 0" 0 "$rc"
ausgabe_ist "5 relatives PW_BINAER wird absolut" "$ARBEIT/bin/lifeline-hub"

# 6 — scheitert die Cargo-Abfrage, gibt es keinen Pfad, sondern einen Fehler.
rc=0; sauber -- backend_binaer_pfad "$LEER" || rc=$?
pruefe "6 kein Workspace → Exit 1" 1 "$rc"
enthaelt "6 Meldung nennt cargo metadata" 'cargo metadata'

# ── backend_binaer_pruefen ──────────────────────────────────────────────────────────

mkdir -p "$ARBEIT/bin"
printf '#!/bin/sh\n' > "$ARBEIT/bin/bereit"
chmod +x "$ARBEIT/bin/bereit"
printf '#!/bin/sh\n' > "$ARBEIT/bin/ohne-bit"
chmod -x "$ARBEIT/bin/ohne-bit"
ln -s "$ARBEIT/bin/weg" "$ARBEIT/bin/toter-link"

# 7 — ausführbar: bereit.
rc=0; sauber -- backend_binaer_pruefen "$ARBEIT/bin/bereit" || rc=$?
pruefe "7 ausführbar → Exit 0" 0 "$rc"

# 8 — fehlt ohne PW_BINAER: übersprungen, ausdrücklich als solches und mit dem gefragten Pfad.
rc=0; sauber -- backend_binaer_pruefen "$ARBEIT/bin/gibt-es-nicht" || rc=$?
pruefe "8 fehlt → übersprungen (75)" 75 "$rc"
enthaelt "8 Meldung sagt ÜBERSPRUNGEN" 'ÜBERSPRUNGEN'
enthaelt "8 Meldung nennt den Pfad" "$ARBEIT/bin/gibt-es-nicht"

# 9 — fehlt MIT PW_BINAER: rot. Wer den Pfad setzt, erwartet dort ein Binary.
rc=0; sauber PW_BINAER="$ARBEIT/bin/gibt-es-nicht" -- backend_binaer_pruefen "$ARBEIT/bin/gibt-es-nicht" || rc=$?
pruefe "9 fehlt trotz PW_BINAER → Exit 1" 1 "$rc"
enthaelt "9 Meldung sagt existiert nicht" 'existiert nicht'

# 10 — liegt da, aber ohne Ausführbar-Bit: rot, in beiden Herkünften. Früher meldete die
# Cargo-Herkunft das als „fehlt" und übersprang.
rc=0; sauber -- backend_binaer_pruefen "$ARBEIT/bin/ohne-bit" || rc=$?
pruefe "10 ohne Bit (Cargo) → Exit 1" 1 "$rc"
enthaelt "10 Meldung nennt das Ausführbar-Bit" 'Ausführbar-Bit'
rc=0; sauber PW_BINAER="$ARBEIT/bin/ohne-bit" -- backend_binaer_pruefen "$ARBEIT/bin/ohne-bit" || rc=$?
pruefe "10 ohne Bit (PW_BINAER) → Exit 1" 1 "$rc"

# 11 — ein toter Symlink ist kein fehlendes Binary, sondern ein kaputter Pfad: rot.
rc=0; sauber -- backend_binaer_pruefen "$ARBEIT/bin/toter-link" || rc=$?
pruefe "11 toter Symlink → Exit 1" 1 "$rc"
enthaelt "11 Meldung nennt den toten Verweis" 'Verweis'

if [ "$fehler" -ne 0 ]; then
  echo "backend-binaer.test.sh: ROT" >&2
  exit 1
fi
echo "backend-binaer.test.sh: alle Fälle grün"
