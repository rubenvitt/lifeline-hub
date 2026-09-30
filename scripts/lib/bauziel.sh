# shellcheck shell=bash
# Prüft, ob das wirksame Cargo-Build-Ziel dem Checkout gehört (LFH-520).
#
# `.cargo/config.toml` legt das Ziel auf `<checkout>/target`. Diese Prüfung fängt den Fall, in
# dem das still nicht greift: Die Datei fehlt, oder eine Konfiguration außerhalb des Checkouts
# überstimmt sie. Dann teilen sich Worktrees Fingerprints und Binaries, und ein grünes Gate
# belegt einen fremden Stand. Herleitung: `.cargo/config.toml`, Selbsttest
# `scripts/bauziel.test.sh`.
#
# Die Quelle ist `cargo metadata`, dieselbe, die Schritt 7 und `frontend/playwright.config.ts`
# für das Backend-Binary befragen.

# Gibt das wirksame Build-Ziel des Checkouts <root> aus.
bauziel_ermitteln() { # <root>
  (cd "$1" && cargo metadata --no-deps --format-version 1) |
    sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p'
}

# Exit 0, wenn das Ziel `<root>/target` ist (still) oder ausdrücklich per Umgebung gewählt
# wurde (mit Ausgabe). Sonst Exit 1 mit Ziel und Ursache.
bauziel_pruefen() { # <root>
  local root="$1" ziel physisch
  ziel="$(bauziel_ermitteln "$root")"
  if [ -z "$ziel" ]; then
    echo "FEHLER: Das Cargo-Build-Ziel für $root ließ sich nicht ermitteln (cargo metadata)." >&2
    return 1
  fi
  # macOS: getcwd liefert /private/var, die Shell /var — beide Schreibweisen gelten.
  physisch="$(cd "$root" && pwd -P)"
  if [ "$ziel" = "$root/target" ] || [ "$ziel" = "$physisch/target" ]; then
    return 0
  fi
  local var
  for var in CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR; do
    if [ -n "${!var:-}" ]; then
      echo "    Cargo-Build-Ziel ausdrücklich gewählt ($var): $ziel"
      return 0
    fi
  done
  echo "FEHLER: Das Cargo-Build-Ziel liegt außerhalb dieses Checkouts: $ziel" >&2
  echo "        Erwartet: $root/target (aus .cargo/config.toml)." >&2
  echo "        Eine Konfiguration außerhalb des Checkouts überstimmt sie, oder die Datei fehlt —" >&2
  echo "        dann teilen sich Worktrees Fingerprints und Binaries, und Tests laufen still gegen" >&2
  echo "        einen fremden Stand (LFH-520). Ein eigenes Ziel ist per CARGO_TARGET_DIR erlaubt." >&2
  return 1
}
