#!/usr/bin/env bash
# Bereichs-Erkennung (LFH-1115): Welche der drei schweren Suiten braucht eine Änderung?
#
# Liest geänderte Pfade (relativ zur Repo-Wurzel, einer je Zeile) von stdin und schreibt
#   rust=true|false
#   frontend=true|false
#   e2e=true|false
# im Format von $GITHUB_OUTPUT. Die Schnellprüfungen laufen immer und stehen hier nicht.
# `ci.yml` (Job `aenderungen`) und `check-all.sh --geaendert` fragen beide dieses Skript; die
# Zuordnung steht nur hier.
#
# IM ZWEIFEL ALLES: Ein Pfad, den keine Regel kennt, fordert alle drei Suiten, ebenso eine leere
# Liste. Gespart wird nur, wo eine Regel ausdrücklich sagt, dass eine Suite die Datei nicht sieht.
#
# QUERBEZÜGE stehen vor den Bereichsregeln: Rust-Tests lesen einzelne Frontend-Dateien
# (`include_bytes!`, `read_to_string`), Vitest liest Backend- und Hüllen-Dateien. Der Selbsttest
# `scripts/bereiche.test.sh` (Schritt 11) sucht solche Verweise im Quelltext und wird rot, wenn
# einer hier fehlt: ein vergessener Querbezug ließe eine Suite still aus, die rot geworden wäre.
set -euo pipefail

# Die Suiten, die eine einzelne Datei braucht (Wörter rust, frontend, e2e; leer = keine).
bereiche_von() {
  case "$1" in
    # ── Querbezüge ────────────────────────────────────────────────────────────────────
    # Rust liest: openapi.json und eingabegrenzen.ts (Drift-Tests), die HEIC-Fixtures
    # (tests/anhang_vorschau.rs), die Modul-Registry (tests/modul_override.rs).
    frontend/src/api/* | frontend/src/heic/__fixtures__/* | frontend/src/einsatz/modulRegistry.ts)
      echo "rust frontend e2e" ;;
    # Vitest liest: die Fachebenen-Quellen (fachebenen.test.ts) und das gemeinsame Fixture der
    # Zählregeln (verdichtungFixture.test.ts).
    src/karte/quellen.rs | tests/fixtures/verdichtung/*)
      echo "rust frontend e2e" ;;
    # Die Hilfe bündelt die Anwenderdokumentation (`frontend/vite.config.ts`, LFH-1096).
    docs/anwender/*)
      echo "frontend e2e" ;;
    # ── Keine schwere Suite ───────────────────────────────────────────────────────────
    # Marketing-Seite (eigener Build, LFH-1111), Doku, Pläne, Agenten-Werkzeug. Markdown
    # liest keine Suite; Prettier über `frontend/**/*.md` läuft in den Schnellprüfungen.
    website/* | docs/* | openspec/* | .claude/* | *.md)
      echo "" ;;
    # ── Bereiche ─────────────────────────────────────────────────────────────────────
    # Vitest liest auch `frontend/e2e/` (Dateinamen- und Kopfzeilen-Guards): kein eigener Fall.
    frontend/*)
      echo "frontend e2e" ;;
    # Die Hülle testet `cargo test -p lifeline-desktop`; Vitest lädt ihr Init-Skript
    # (src/test/huelle.ts) und prüft ihre Symbole (marke.guard.test.ts). e2e fährt den Server.
    src-tauri/*)
      echo "rust frontend" ;;
    src/* | tests/* | migrations/* | crates/* | .cargo/* | Cargo.toml | Cargo.lock | build.rs)
      echo "rust e2e" ;;
    # Gate-Skripte, Workflows, Werkzeugversionen, Wurzel-Konfiguration und alles Neue.
    *)
      echo "rust frontend e2e" ;;
  esac
}

# Liest Pfade von stdin, schreibt die drei Zeilen.
bereiche_ausgeben() {
  local rust=false frontend=false e2e=false pfad wort gelesen=0
  while IFS= read -r pfad || [ -n "$pfad" ]; do
    [ -n "$pfad" ] || continue
    gelesen=1
    for wort in $(bereiche_von "$pfad"); do
      case "$wort" in
        rust) rust=true ;;
        frontend) frontend=true ;;
        e2e) e2e=true ;;
      esac
    done
  done
  if [ "$gelesen" -eq 0 ]; then
    rust=true frontend=true e2e=true
  fi
  printf 'rust=%s\nfrontend=%s\ne2e=%s\n' "$rust" "$frontend" "$e2e"
}

# Als Bibliothek eingebunden (`. scripts/bereiche.sh`) nur die Funktionen, sonst der Filter.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    "") bereiche_ausgeben ;;
    -h | --help) sed -n '2,10p' "$0" ;;
    *) echo "FEHLER: bereiche.sh nimmt keine Argumente, die Pfade kommen über stdin." >&2; exit 2 ;;
  esac
fi
