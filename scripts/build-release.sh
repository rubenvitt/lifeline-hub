#!/usr/bin/env bash
# Baut das Frontend, bettet es in die Rust-Binary ein und erzeugt die Single-Binary.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/3 Alten Embed-Inhalt entfernen"
# Der Platzhalter .gitkeep bleibt stehen (LFH-242/F19): rust-embed braucht den
# Ordner zur Compile-Zeit, und ohne ihn ist der Arbeitsbaum hinterher dirty.
find frontend/dist -mindepth 1 ! -name '.gitkeep' -delete

echo "==> 2/3 Frontend bauen (frontend/dist)"
( cd frontend && pnpm install --frozen-lockfile && pnpm run build )

# Fail-closed: lieber hier abbrechen als eine Binary mit leerem Frontend ausliefern.
if [ ! -f frontend/dist/index.html ]; then
  echo "FEHLER: frontend/dist/index.html fehlt nach dem Frontend-Build." >&2
  echo "Ohne sie entstünde eine Binary ohne eingebettetes Frontend." >&2
  exit 1
fi

echo "==> 3/3 Backend im Release-Modus bauen (bettet frontend/dist ein)"
# Cargo kennt die Dateien unter frontend/dist NICHT als Abhängigkeit (rust-embed
# taucht in der Dep-Info nicht auf). Nach einer reinen Frontend-Änderung würde
# cargo das Modul deshalb gar nicht neu übersetzen und still den alten Stand
# einbetten — genau der Versions-Skew aus LFH-242/F19. Das touch erzwingt es.
touch src/static_files.rs
cargo build --release

# Cargo baut nicht zwingend nach ./target — ein globales build.target-dir (z. B. ein
# gemeinsames Verzeichnis über alle Worktrees, ~/.cargo/config.toml) verschiebt es.
# Deshalb den Pfad von Cargo selbst erfragen statt ihn zu raten.
# JSON mit dem ohnehin benötigten Node lesen; jq ist keine Projektvoraussetzung.
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps | mise exec node@26.7.0 -- node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).target_directory')"
BINARY="$TARGET_DIR/release/lifeline-hub"

echo "==> SBOM erzeugen (LFH-253/G01)"
# Wozu: ohne Inventar des ausgelieferten Artefakts lässt sich im Advisory-Fall nicht
# beantworten, ob und wo man betroffen ist. Deterministisch und offline — deshalb darf
# das hier am Release hängen, anders als der netzabhängige Advisory-Scan
# (scripts/check-deps.sh), der bewusst NICHT im Release-Pfad steht.
SBOM_DIR="$TARGET_DIR/release/sbom"
mkdir -p "$SBOM_DIR"
sbom_fehlend=()

if command -v cargo-cyclonedx >/dev/null 2>&1; then
  cargo cyclonedx --format json --all >/dev/null
  # cargo-cyclonedx legt die Dateien neben den Manifesten ab — einsammeln.
  find . -name 'bom.json' -not -path './target/*' -exec mv {} "$SBOM_DIR"/ \; 2>/dev/null || true
else
  sbom_fehlend+=("cargo-cyclonedx  →  cargo install cargo-cyclonedx")
fi

if mise exec pnpm@11.10.0 -- pnpm -C frontend exec cyclonedx-npm --version >/dev/null 2>&1; then
  mise exec pnpm@11.10.0 -- pnpm -C frontend exec cyclonedx-npm \
    --output-file "$SBOM_DIR/bom-frontend.json"
else
  sbom_fehlend+=("@cyclonedx/cyclonedx-npm  →  pnpm -C frontend add -D @cyclonedx/cyclonedx-npm")
fi

# Die eingebackene SQLite-Version (LFH-233/G02): sie steckt als C-Amalgamation im Binary
# und wird von KEINEM System-Update erreicht — im Advisory-Fall ist sie die Zahl, die man
# braucht. Aus dem laufenden Binary gelesen, nicht aus einer gepflegten Konstante.
if SQLITE_VERSION="$("$BINARY" sqlite-version 2>/dev/null)"; then
  echo "$SQLITE_VERSION" > "$SBOM_DIR/eingebettete-sqlite-version.txt"
  echo "    eingebettetes SQLite: $SQLITE_VERSION"
fi

if [ ${#sbom_fehlend[@]} -gt 0 ]; then
  echo "    WARNUNG: SBOM unvollständig, folgende Werkzeuge fehlen:" >&2
  for w in "${sbom_fehlend[@]}"; do echo "      - $w" >&2; done
else
  echo "    SBOM: $SBOM_DIR"
fi

echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
