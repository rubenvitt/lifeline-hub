#!/usr/bin/env bash
# Baut das Frontend, bettet es in die Rust-Binary ein und erzeugt die Single-Binary.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/2 Frontend bauen (frontend/dist)"
( cd frontend && pnpm install --frozen-lockfile && pnpm run build )

echo "==> 2/2 Backend im Release-Modus bauen (bettet frontend/dist ein)"
cargo build --release

BINARY="target/release/lifeline-hub"
echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
