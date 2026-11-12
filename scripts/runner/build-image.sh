#!/usr/bin/env bash
# Baut das Runner-Image `lifeline-runner:latest` für den eigenen Server (LLH-1666, ADR-0025,
# `scripts/runner/README.md`).
#
#   build-image.sh            baut aus dem Stand dieses Checkouts
#   build-image.sh --update   holt vorher `origin/alpha` in diesen Checkout (nur im Server-Klon,
#                             den nichts anderes benutzt: verwirft lokale Änderungen) und baut
#                             ohne Build-Cache
#   build-image.sh --no-cache baut ohne Build-Cache aus dem Stand dieses Checkouts
#
# Die Playwright-Version kommt aus `frontend/pnpm-lock.yaml`: die Browser im Image müssen zu der
# Version passen, die der Job installiert, sonst lädt jeder Job sie neu (Warnung im Job-Log).
# `--pull` holt das Basisimage frisch (es ist per Digest gepinnt, neu wird es mit einem
# Dependabot-Bump). Mit `--update`, also im wöchentlichen Timer (`lifeline-runner-image.timer`),
# baut es ohne Build-Cache: sonst kämen apt-Pakete, rustup und Browser aus der Schicht von letzter
# Woche, und der Neubau änderte nichts. Danach löscht es die alten, nun namenlosen Images dieses
# Typs, damit der Server nicht mit jedem Neubau voller wird.
set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HIER/../.." && pwd)"
IMAGE="${RUNNER_IMAGE:-lifeline-runner:latest}"

cache_arg=""
case "${1:-}" in
  --no-cache) cache_arg="--no-cache" ;;
  --update)
    git -C "$ROOT" fetch --quiet origin alpha
    git -C "$ROOT" reset --quiet --hard origin/alpha
    # Neu einlesen: das Skript selbst kann sich mit dem Stand geändert haben.
    exec "$HIER/build-image.sh" --no-cache
    ;;
  "") ;;
  *)
    echo "Aufruf: $0 [--update | --no-cache]" >&2
    exit 2
    ;;
esac

version="$(sed -nE "s/^  '@playwright\/test@([0-9][^']*)':.*/\1/p" "$ROOT/frontend/pnpm-lock.yaml" | head -n 1)"
if [ -z "$version" ]; then
  echo "FEHLER: keine Version von @playwright/test in frontend/pnpm-lock.yaml gefunden." >&2
  exit 1
fi

echo "==> Baue $IMAGE (Playwright $version, Stand $(git -C "$ROOT" rev-parse --short HEAD))"
docker build --pull $cache_arg \
  --build-arg "PLAYWRIGHT_VERSION=$version" \
  --tag "$IMAGE" \
  "$HIER"

# Nur die eigenen, nicht mehr benannten Images; fremde Images auf dem Server bleiben unberührt.
docker image prune --force --filter "label=de.lifeline-hub.runner=1" > /dev/null
echo "==> Fertig. Laufende Jobs nehmen das neue Image ab dem nächsten Job."
