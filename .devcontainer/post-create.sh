#!/usr/bin/env bash
# Einmaliges Setup nach dem Erstellen des Dev Containers.
set -euo pipefail

echo "==> corepack/pnpm aktivieren"
corepack enable
# Aktiviert exakt die in frontend/package.json gepinnte pnpm-Version (packageManager-Feld).
corepack prepare --activate

echo "==> bacon installieren (Backend-Auto-Reload, vgl. bacon.toml)"
# Vorgebautes Binary statt langem cargo-install-Build, mit Fallback.
cargo install cargo-binstall --locked 2>/dev/null || true
cargo binstall -y bacon 2>/dev/null || cargo install bacon --locked

echo "==> Frontend-Abhängigkeiten installieren"
pnpm --dir frontend install --frozen-lockfile

echo "==> Frontend bauen (rust-embed erwartet frontend/dist)"
# Sorgt dafür, dass der erste 'cargo build' im Repo-Root sofort kompiliert.
pnpm --dir frontend run build

echo "==> Rust-Build vorwärmen"
cargo fetch

cat <<'EOF'

Setup fertig. Loslegen:

  Backend (Auto-Reload):   bacon            # oder: cargo run --features dev-seeds
  Frontend (HMR):          pnpm --dir frontend dev

  Tests Backend:           cargo test
  Tests Frontend:          pnpm --dir frontend test
  E2E (einmalig Browser):  pnpm --dir frontend exec playwright install --with-deps

EOF
