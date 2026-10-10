#!/usr/bin/env bash
# LFH-1124: Verschiebeprobe einmal komplett. Legt Harness in `frontend/`, startet Vite, misst beide
# Fälle in Firefox und Chromium, räumt danach auf.
# Aufruf aus der Repo-Wurzel: PUPPETEER_DIR=… FF_BIN=… CR_BIN=… werkzeug/lauf.sh <ausgabeverzeichnis>
# Braucht: PUPPETEER_DIR (Verzeichnis mit node_modules/puppeteer-core), pdftotext/pdfinfo (poppler), mise.
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
WURZEL="$(git -C "$HIER" rev-parse --show-toplevel)"
AUS="$(realpath -m "${1:?Ausgabeverzeichnis}")"
FE="$WURZEL/frontend"
PORT="${PORT:-5199}"

cp "$HIER/probe.tsx" "$FE/probe.tsx"
printf '<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/probe.tsx"></script></body></html>\n' >"$FE/probe.html"
aufraeumen() { rm -f "$FE/probe.tsx" "$FE/probe.html"; kill "${VITE:-0}" 2>/dev/null || true; }
trap aufraeumen EXIT

(cd "$WURZEL" && mise exec -- pnpm -C "$FE" exec vite --port "$PORT" --strictPort >"$AUS.vite.log" 2>&1) &
VITE=$!
for _ in $(seq 60); do curl -sf "http://localhost:$PORT/probe.html" >/dev/null && break; sleep 1; done

for b in firefox chrome; do
  for fall in etb personal; do
    node "$HIER/verschiebeprobe.mjs" "$b" "http://localhost:$PORT" "$fall" "$AUS" "${VON:-600}" "${BIS:-1100}" "${SCHRITT:-10}"
  done
done
