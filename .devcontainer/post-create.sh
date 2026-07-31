#!/usr/bin/env bash
# Einmaliges Setup nach dem Erstellen des Dev Containers.
set -euo pipefail

echo "==> System-OpenSSL-Dev-Header (Build-Voraussetzung von openssl-sys)"
# webauthn-rs zieht `openssl`/`openssl-sys` unconditional herein — nicht per Feature
# abwählbar (Cargo.toml:73-82, docs/betrieb/packaging.md:33-69). Ohne die Dev-Header
# bricht der erste `cargo build`. pkg-config bringt das Rust-Image mit, libssl-dev nicht
# zuverlässig; apt-get ist idempotent, ein bereits installiertes Paket kostet nichts.
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends pkg-config libssl-dev

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
