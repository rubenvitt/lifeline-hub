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

BINARY="target/release/lifeline-hub"
echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
