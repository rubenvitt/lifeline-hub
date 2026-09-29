#!/usr/bin/env bash
# Abhängigkeiten gegen Advisory-Datenbanken prüfen (RUSTSEC, GHSA). Die committeten Lockfiles
# frieren verwundbare Versionen ein; ohne diesen Scan landete ein neues Advisory still im
# ausgelieferten Binary. Ein `cargo audit` im Root deckt alle Workspace-Crates ab.
#
# Netzabhängig: ein neues Advisory macht den Schritt über Nacht rot — gewollt, und der Grund,
# warum er nicht im Release-Pfad (build-release.sh) hängt. Nicht-deterministisch heißt „über
# die Zeit", nicht „über die Maschine": für denselben Commit gibt das Gate überall dieselbe
# Antwort (Selbsttest: scripts/check-deps.test.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FE="$ROOT/frontend"
# Node und pnpm aus `[tools]` in mise.toml (LFH-773). Der Audit läuft mit `-C` im
# Wegwerf-Verzeichnis, mise selbst aber hier im Repo — sonst fände es die mise.toml nicht.
PNPM="mise exec -- pnpm"

fehlend=()

echo "==> [1/2] Rust-Abhängigkeiten (cargo audit, RUSTSEC)"
if command -v cargo-audit >/dev/null 2>&1 || cargo audit --version >/dev/null 2>&1; then
  cargo audit
else
  fehlend+=("cargo-audit  →  cargo install cargo-audit")
  echo "    ÜBERSPRUNGEN: cargo-audit ist nicht installiert."
fi

echo "==> [2/2] Frontend-Abhängigkeiten (pnpm audit, GHSA)"
# GEPRÜFT WIRD DAS LOCKFILE, NICHT DER INSTALLIERTE BAUM: zwei Arbeitsbäume desselben Commits
# gaben sonst verschiedene Antworten, und ein falsch-grünes Sicherheits-Gate ist schlechter als
# keines. `pnpm audit` liest heute zwar die *wanted lockfile*, aber nichts pinnt das (pnpm
# läuft als `latest`, die Hilfe spricht von „installed packages"). Deshalb strukturell: der
# Audit läuft in einem Wegwerf-Verzeichnis AUSSERHALB des Arbeitsbaums, das nur die
# committeten Manifest-Dateien enthält.
AUDIT_DIR="$(mktemp -d)"
trap 'rm -rf "$AUDIT_DIR"' EXIT

# pnpm-workspace.yaml MUSS mit: dort stehen die Overrides. Ohne sie liefe das Gate falsch
# ROT — und ein grundlos rotes Gate wird abgeschaltet.
for datei in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  if [ ! -f "$FE/$datei" ]; then
    echo "FEHLER: $FE/$datei fehlt — der Audit kann nicht hermetisch laufen." >&2
    echo "        (Lieber laut abbrechen als eine Teilmenge prüfen und OK melden.)" >&2
    exit 1
  fi
  cp "$FE/$datei" "$AUDIT_DIR/$datei"
done

# SELBSTPRÜFUNG DER KOPIERLISTE: bekommt das Frontend echte Workspace-Pakete (Importer neben
# „."), fehlten deren package.json, und der Audit wäre still unvollständig. Dann die Liste
# erweitern, nicht diesen Riegel entfernen.
fremde_importer="$(awk '
  /^importers:/ { drin = 1; next }
  drin && /^[^[:space:]]/ { drin = 0 }
  drin && /^  [^[:space:]]/ {
    zeile = $0
    sub(/^  /, "", zeile)
    sub(/:[[:space:]]*$/, "", zeile)
    if (zeile != ".") print zeile
  }
' "$FE/pnpm-lock.yaml")"
if [ -n "$fremde_importer" ]; then
  echo "FEHLER: das Lockfile führt Importer neben '.':" >&2
  printf '%s\n' "$fremde_importer" | sed 's/^/        - /' >&2
  echo "        Deren package.json werden nicht mitkopiert, der Audit-Baum wäre" >&2
  echo "        unvollständig. Kopierliste in scripts/check-deps.sh erweitern." >&2
  exit 1
fi

# --audit-level=high bricht; moderate/low werden gemeldet, brechen aber nicht — sonst wäre
# das Gate durch Dev-Tooling-Rauschen dauerrot und würde abgeschaltet.
$PNPM -C "$AUDIT_DIR" audit --audit-level=high

if [ ${#fehlend[@]} -gt 0 ]; then
  echo
  echo "WARNUNG: Dieser Scan lief UNVOLLSTÄNDIG — folgende Werkzeuge fehlen:" >&2
  for w in "${fehlend[@]}"; do echo "  - $w" >&2; done
  echo "         Das Gate meldet deshalb keinen Fund, hat aber auch nicht vollständig gesucht." >&2
  echo "         (Bewusst kein harter Fehler: sonst wäre check-all.sh auf jeder Maschine rot," >&2
  echo "          auf der das Werkzeug fehlt — und ein rotes Gate wird abgeschaltet.)" >&2
  exit 0
fi

echo "==> OK: keine bekannten Schwachstellen in den gepinnten Abhängigkeiten."
