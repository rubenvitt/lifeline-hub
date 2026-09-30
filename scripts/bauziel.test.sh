#!/usr/bin/env bash
# Selbsttest für das Build-Ziel je Checkout (LFH-520): `.cargo/config.toml` und
# `scripts/lib/bauziel.sh`.
#
# Der Fehler, gegen den beides schützt, ist still: Cargo bildet den Artefakt-Hash eines
# Workspace-Mitglieds aus dem Pfad RELATIV zur Workspace-Wurzel und prüft die Frische per mtime.
# Zwei Worktrees in einem gemeinsamen Ziel teilen sich deshalb Fingerprints und Binaries. Sind
# die Quellen des einen älter als der letzte Bau des anderen, meldet Cargo „Fresh“ und führt
# fremden Code aus — ein grünes Gate über den falschen Stand.
#
# Hermetisch: Die „globale“ Nutzerkonfiguration mit gemeinsamem Ziel steht als
# `.cargo/config.toml` ÜBER den Wegwerf-Checkouts. Sie schlägt `~/.cargo`, verliert aber gegen
# die Repo-Datei im Checkout — dieselbe Rangfolge wie die globale. Kein eigenes CARGO_HOME:
# Toolchain-Manager (mise) richteten Rust sonst bei jedem Lauf neu ein, mit Netz. Die Checkouts
# sind Crates ohne Abhängigkeiten (Sekunden).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_CONFIG="$ROOT/.cargo/config.toml"
LIB="$ROOT/scripts/lib/bauziel.sh"
ARBEIT="$(mktemp -d)"
# Scheitert ein Kommando unerwartet (set -e), zeigt der Trap dessen Ausgabe, bevor er aufräumt —
# ein roter Selbsttest ohne Grund wäre dieselbe Stille, gegen die er prüft.
aufraeumen() {
  local rc=$?
  if [ "$rc" != 0 ] && [ -s "$ARBEIT/aus" ]; then
    echo "bauziel.test.sh: abgebrochen (Exit $rc), letzte Ausgabe:" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
  fi
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT
fehler=0

# Die Umgebung des Aufrufers darf das Ergebnis nicht färben.
unset CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR
mkdir -p "$ARBEIT/.cargo"
printf '[build]\ntarget-dir = "%s"\n' "$ARBEIT/geteilt" > "$ARBEIT/.cargo/config.toml"

ok() { echo "ok   $1"; }
fail() {
  echo "FAIL $1" >&2
  [ -f "$ARBEIT/aus" ] && sed 's/^/     | /' "$ARBEIT/aus" >&2
  fehler=1
}

# Legt einen Checkout <name> an, dessen Binary „Quellstand <name>“ ausgibt. Mit <config>=ja
# bekommt er die ECHTE Repo-Konfiguration: Wer sie ändert oder löscht, macht diesen Test rot.
checkout() { # <name> <config:ja|nein>   (<name> darf einen Unterpfad tragen)
  local d="$ARBEIT/$1"
  rm -rf "$d"
  mkdir -p "$d/src"
  printf '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n' > "$d/Cargo.toml"
  printf 'fn main() { println!("Quellstand %s"); }\n' "$(basename "$1")" > "$d/src/main.rs"
  if [ "$2" = ja ]; then
    mkdir -p "$d/.cargo"
    cp "$REPO_CONFIG" "$d/.cargo/config.toml"
  fi
}

# Quellen von b älter als der Bau von a — genau die Lage, in der Cargo fremde Artefakte für frisch hält.
b_aelter_machen() {
  find "$ARBEIT/b" -exec touch -h -t 202001010000 {} +
}

# Beide Helfer scheitern nie selbst: Ein Cargo-Fehler landet in $ARBEIT/aus, und der Aufrufer
# meldet ihn über fail — nicht set -e, das den Test stumm abbräche.
laeuft() { # <checkout> → Ausgabe des Binarys
  (cd "$ARBEIT/$1" && cargo run -q 2> "$ARBEIT/aus") || true
}

ziel() { # <checkout> → target_directory laut Cargo
  { (cd "$ARBEIT/$1" && cargo metadata --no-deps --format-version 1 2> "$ARBEIT/aus") || true; } |
    sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p'
}

# ── 1. Das Build-Ziel gehört dem Checkout ────────────────────────────────────────────

if [ ! -f "$REPO_CONFIG" ]; then
  : > "$ARBEIT/aus"
  fail "Repo-Konfiguration $REPO_CONFIG fehlt"
else
  # Gegenprobe: Ohne Repo-Konfiguration tritt der Fehler auf. Bleibt sie aus, belegt der
  # Positivfall unten nichts.
  checkout a nein
  checkout b nein
  b_aelter_machen
  laeuft a > /dev/null
  if [ "$(laeuft b)" = "Quellstand a" ]; then
    ok "Gegenprobe: ohne Repo-Konfiguration führt b den Code von a aus"
  else
    # Die Gegenprobe hängt an einem Cargo-Verhalten (Hash relativ zur Workspace-Wurzel). Ändert
    # Cargo das, wird sie rot, obwohl die Isolation weiter trägt.
    fail "Gegenprobe: ohne Repo-Konfiguration hätte b den Code von a ausführen müssen — trennt Cargo Fingerprints inzwischen nach Workspace-Pfad? Dann Gegenprobe und LFH-520 neu bewerten"
  fi

  rm -rf "$ARBEIT/geteilt"
  checkout a ja
  checkout b ja
  b_aelter_machen
  laeuft a > /dev/null
  aus_b="$(laeuft b)"
  if [ "$aus_b" = "Quellstand b" ]; then
    ok "mit Repo-Konfiguration baut und startet b seinen eigenen Stand"
  else
    fail "mit Repo-Konfiguration gab b '$aus_b' aus, erwartet 'Quellstand b'"
  fi

  ist="$(ziel b)"
  soll="$(cd "$ARBEIT/b" && pwd -P)/target"
  soll_logisch="$ARBEIT/b/target"
  if [ "$ist" = "$soll" ] || [ "$ist" = "$soll_logisch" ]; then
    ok "cargo metadata meldet <checkout>/target trotz globalem Ziel"
  else
    fail "cargo metadata meldet '$ist', erwartet '$soll'"
  fi

  ist="$(CARGO_TARGET_DIR="$ARBEIT/eigen" ziel b)"
  if [ "$ist" = "$ARBEIT/eigen" ]; then
    ok "CARGO_TARGET_DIR übersteuert die Repo-Konfiguration"
  else
    fail "CARGO_TARGET_DIR: cargo metadata meldet '$ist', erwartet '$ARBEIT/eigen'"
  fi
fi

# ── 2. bauziel_pruefen im Sammel-Gate ────────────────────────────────────────────────

pruefen() { # <checkout> [VAR=wert …] → Exit-Code; Ausgabe nach $ARBEIT/aus
  local d="$ARBEIT/$1"
  shift
  set +e
  env "$@" bash -c '. "$1" && bauziel_pruefen "$2"' _ "$LIB" "$d" > "$ARBEIT/aus" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

if [ ! -f "$LIB" ]; then
  : > "$ARBEIT/aus"
  fail "$LIB fehlt"
else
  checkout eigen ja
  checkout geerbt nein
  # Übergangsfall: Ein Checkout OHNE die Datei unter einem Checkout MIT ihr (alter Worktree unter
  # dem Main-Checkout) erbt deren relatives Ziel, also `<eltern>/target`. Endet auf `/target`
  # und fällt nur einem echten Pfadvergleich auf.
  checkout eltern ja
  checkout eltern/kind nein

  rc=0; pruefen eigen || rc=$?
  if [ "$rc" = 0 ] && [ ! -s "$ARBEIT/aus" ]; then
    ok "eigenes Ziel: still, Exit 0"
  else
    fail "eigenes Ziel: Exit $rc, erwartet 0 ohne Ausgabe"
  fi

  rc=0; pruefen geerbt || rc=$?
  if [ "$rc" != 0 ] && grep -qF "$ARBEIT/geteilt" "$ARBEIT/aus" && grep -qF ".cargo/config.toml" "$ARBEIT/aus"; then
    ok "geerbtes fremdes Ziel: rot, nennt Ziel und Repo-Konfiguration"
  else
    fail "geerbtes fremdes Ziel: Exit $rc, erwartet rot mit Ziel und Hinweis auf .cargo/config.toml"
  fi

  rc=0; pruefen eltern/kind || rc=$?
  if [ "$rc" != 0 ] && grep -qF "$ARBEIT/eltern/target" "$ARBEIT/aus"; then
    ok "vom übergeordneten Checkout geerbtes Ziel: rot, nennt <eltern>/target"
  else
    fail "vom übergeordneten Checkout geerbtes Ziel: Exit $rc, erwartet rot mit $ARBEIT/eltern/target"
  fi

  for var in CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR; do
    rc=0; pruefen geerbt "$var=$ARBEIT/ausdruecklich" || rc=$?
    if [ "$rc" = 0 ] && grep -qF "ausdrücklich gewählt" "$ARBEIT/aus" && grep -qF "$ARBEIT/ausdruecklich" "$ARBEIT/aus"; then
      ok "$var: ausdrücklich gewählt, Exit 0 mit Ausgabe des Ziels"
    else
      fail "$var: Exit $rc, erwartet 0 mit 'ausdrücklich gewählt' und dem Ziel"
    fi
  done
fi

if [ "$fehler" != 0 ]; then
  echo "bauziel.test.sh: ROT" >&2
  exit 1
fi
echo "bauziel.test.sh: alle Fälle grün"
