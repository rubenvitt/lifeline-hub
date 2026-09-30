#!/usr/bin/env bash
# Wo liegt das Backend-Binary für die e2e-Suite, und ist es bereit (LFH-518)? Zum Sourcen
# gedacht, nicht zum Ausführen. Selbsttest: scripts/backend-binaer.test.sh.
#
# Cargo baut nicht zwingend nach `./target`: `CARGO_TARGET_DIR` oder eine (auch globale)
# `build.target-dir` legen es außerhalb des Worktrees ab. Ein fester Pfad fand das Binary dort
# nicht, Schritt 7 übersprang die Browsertests, und das Gate meldete trotzdem OK. Den Pfad weiß
# nur Cargo, deshalb wird Cargo gefragt.
#
# `frontend/playwright.config.ts` stellt dieselbe Frage für den alleinstehenden Lauf
# (`pnpm e2e`). Im Gate gibt Schritt 7 seine Antwort als `PW_BINAER` weiter: Gate und Suite
# nehmen dann denselben Pfad, statt zweimal zu fragen.

# Gibt den Pfad des Debug-Binarys aus.
#   PW_BINAER gesetzt → dieser Pfad, absolut gemacht gegen das Arbeitsverzeichnis — im Gate die
#                       Repo-Wurzel (ein e2e-Shard der CI lädt das Binary als Artefakt und hat
#                       kein Cargo-Target)
#   sonst             → <target_directory laut cargo metadata>/debug/lifeline-hub
# Scheitert die Cargo-Abfrage, gibt es keinen Pfad, sondern Exit 1.
backend_binaer_pfad() { # <repo-wurzel>
  if [ -n "${PW_BINAER:-}" ]; then
    case "$PW_BINAER" in
      /*) printf '%s\n' "$PW_BINAER" ;;
      *) printf '%s/%s\n' "$PWD" "$PW_BINAER" ;;
    esac
    return 0
  fi
  local json ziel
  if ! json="$(cd "$1" && cargo metadata --format-version 1 --no-deps)"; then
    echo "FEHLER: 'cargo metadata' in '$1' ist gescheitert — ohne Cargo kein Binary-Pfad." >&2
    echo "        Abhilfe: im Repo mit Rust-Toolchain aufrufen oder PW_BINAER setzen." >&2
    return 1
  fi
  # Das JSON liest Node (jq ist keine Voraussetzung).
  if ! ziel="$(printf '%s' "$json" | mise exec -- node -p \
    'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')" \
    || [ -z "$ziel" ]; then
    echo "FEHLER: 'cargo metadata' lieferte kein target_directory." >&2
    return 1
  fi
  printf '%s/debug/lifeline-hub\n' "$ziel"
}

# Prüft, ob unter <pfad> ein lauffähiges Binary liegt.
#   0                  bereit
#   $UEBERSPRUNGEN_RC  fehlt, und niemand hat es verlangt (kein PW_BINAER): laut übersprungen
#   1                  fehlt trotz PW_BINAER, oder liegt da ohne Ausführbar-Bit
# Meldungen auf stderr.
backend_binaer_pruefen() { # <pfad>
  local pfad="$1"
  if [ -x "$pfad" ] && [ -f "$pfad" ]; then
    return 0
  fi
  if [ -L "$pfad" ] && [ ! -e "$pfad" ]; then
    echo "FEHLER: '$pfad' ist ein Verweis ins Leere (toter Symlink)." >&2
    return 1
  fi
  if [ -d "$pfad" ]; then
    echo "FEHLER: '$pfad' ist ein Verzeichnis, kein Binary." >&2
    return 1
  fi
  if [ -e "$pfad" ]; then
    # Ein Binary ohne Bit ist kein fehlendes Binary: still zu überspringen meldete einen grünen
    # Schritt, der nie lief. actions/upload-artifact verliert das Bit immer.
    echo "FEHLER: '$pfad' ist nicht ausführbar." >&2
    echo "        Die Datei existiert, hat aber kein Ausführbar-Bit — nach einem" >&2
    echo "        Artefakt-Download fehlt es immer. Abhilfe: chmod +x." >&2
    return 1
  fi
  if [ -n "${PW_BINAER:-}" ]; then
    echo "FEHLER: '$pfad' existiert nicht (PW_BINAER ist gesetzt). Pfad prüfen." >&2
    return 1
  fi
  echo "    ÜBERSPRUNGEN: kein Backend-Binary unter $pfad" >&2
  echo "    (Pfad laut 'cargo metadata', CARGO_TARGET_DIR und build.target-dir sind befolgt)." >&2
  echo "    Die e2e-Suite startet das Backend selbst und setzt einen Debug-Build voraus." >&2
  echo "    Einmal 'cargo build' laufen lassen, dann deckt dieses Gate auch die Fehler-" >&2
  echo "    klassen ab, die nur der echte Browser sieht (Layout, WebGL, StrictMode)." >&2
  echo "    (Bewusst kein harter Fehler: auf einem frischen Checkout wäre das Gate sonst" >&2
  echo "     von Tag eins rot — und ein rotes Gate wird abgeschaltet statt befolgt.)" >&2
  return "${UEBERSPRUNGEN_RC:-75}"
}
