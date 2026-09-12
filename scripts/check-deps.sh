#!/usr/bin/env bash
# LFH-253/G01: Abhängigkeiten gegen Advisory-Datenbanken prüfen.
#
# Die Lockfiles (Cargo.lock, frontend/pnpm-lock.yaml) sind committet und machen Builds
# reproduzierbar — genau deshalb frieren sie verwundbare Versionen aber auch dauerhaft ein.
# Ohne diesen Scan erzeugt ein neues RUSTSEC-/GHSA-Advisory kein Signal und landet still im
# ausgelieferten Binary eines Einsatzführungssystems.
#
# Zwei Bäume, nicht drei: karten-service ist Workspace-Member unter einem gemeinsamen
# Cargo.lock, ein `cargo audit` im Root deckt alle Rust-Crates ab.
#
# Netzabhängig und nicht-deterministisch — anders als die übrigen Gates. Ein neu
# veröffentlichtes Advisory macht diesen Schritt über Nacht rot, ohne dass sich eine Zeile
# Code geändert hat. Das ist gewollt (es ist ja das Signal), aber der Grund, warum der Scan
# NICHT im Release-Pfad (build-release.sh) hängt: ein Offline-Build soll nicht daran
# scheitern.
#
# NICHT-DETERMINISTISCH HEISST „ÜBER DIE ZEIT", NICHT „ÜBER DIE MASCHINE" (LFH-316). Für
# denselben Commit muss dieses Gate auf jedem Rechner dieselbe Antwort geben — sonst ist
# das Ergebnis nicht die Aussage über den ausgelieferten Stand, für die es gebaut wurde.
# Die Vorkehrungen dafür stehen unten bei Schritt 2; der Selbsttest dazu ist
# scripts/check-deps.test.sh (Schritt 9 von check-all.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FE="$ROOT/frontend"
# NODE MITGEPINNT WIE IN check-all.sh (LFH-316). Vorher stand hier nur die pnpm-Version,
# Node kam aus der globalen mise-Konfiguration der jeweiligen Maschine — für ein Gate, das
# überall dasselbe sagen soll, ist das genau die falsche Hälfte. Die Zahl ist dieselbe wie
# im Sammel-Gate; wer sie dort ändert, ändert sie hier mit.
PNPM="mise exec node@26.7.0 pnpm@11.10.0 -- pnpm"

fehlend=()

echo "==> [1/2] Rust-Abhängigkeiten (cargo audit, RUSTSEC)"
if command -v cargo-audit >/dev/null 2>&1 || cargo audit --version >/dev/null 2>&1; then
  cargo audit
else
  fehlend+=("cargo-audit  →  cargo install cargo-audit")
  echo "    ÜBERSPRUNGEN: cargo-audit ist nicht installiert."
fi

echo "==> [2/2] Frontend-Abhängigkeiten (pnpm audit, GHSA)"
# GEPRÜFT WIRD DAS LOCKFILE, NICHT DER INSTALLIERTE BAUM (LFH-316).
#
# Der Befund, der das ausgelöst hat: zwei Arbeitsbäume desselben Commits gaben
# verschiedene Antworten — der lang gewachsene Haupt-Checkout meldete Entwarnung, der
# frische Worktree zwei Funde. Ein falsch-grünes Sicherheits-Gate ist schlechter als gar
# keines, es erzeugt begründetes Vertrauen.
#
# `pnpm audit` liest in 11.10.0 nachweislich die *wanted lockfile*
# (plugin-commands-audit/lib/audit.js ruft `readWantedLockfile`) und nicht node_modules —
# ein nachgebautes stale node_modules ändert das Ergebnis heute gemessen NICHT. Genau
# darauf ruht die Zusicherung aber, und nichts pinnt sie: die Hilfe desselben Aufrufs sagt
# „Checks for known security issues with the installed packages", und frontend/mise.toml
# führt pnpm als `latest`. Eine Eigenschaft, die man sich von einer Bibliotheksversion
# leiht, ist keine Zusicherung, sondern ein Zufall mit gutem Ruf.
#
# Deshalb wird sie hier STRUKTURELL hergestellt statt geerbt: der Audit läuft in einem
# Wegwerf-Verzeichnis AUSSERHALB des Arbeitsbaums, das ausschließlich die committeten
# Manifest-Dateien enthält. Was dort nicht liegt, kann das Ergebnis nicht färben — auch
# dann nicht, wenn eine künftige pnpm-Version wieder in node_modules schaut.
AUDIT_DIR="$(mktemp -d)"
trap 'rm -rf "$AUDIT_DIR"' EXIT

# pnpm-workspace.yaml MUSS mit: dort stehen seit pnpm 10 die Overrides und der
# auditConfig-Ignoreblock. Ohne die Datei liefe das Gate nicht falsch grün, sondern falsch
# ROT — und ein Gate, das grundlos rot ist, wird abgeschaltet statt befolgt.
for datei in package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  if [ ! -f "$FE/$datei" ]; then
    echo "FEHLER: $FE/$datei fehlt — der Audit kann nicht hermetisch laufen." >&2
    echo "        (Lieber laut abbrechen als eine Teilmenge prüfen und OK melden.)" >&2
    exit 1
  fi
  cp "$FE/$datei" "$AUDIT_DIR/$datei"
done

# SELBSTPRÜFUNG DER KOPIERLISTE. Die Liste oben trägt genau einen Importer („."). Bekommt
# das Frontend echte Workspace-Pakete, fehlen deren package.json im Wegwerf-Verzeichnis,
# und der Audit-Baum wäre still unvollständig — also wieder falsch grün, nur aus einem
# anderen Grund. Dann ist die Liste zu erweitern, nicht dieser Riegel zu entfernen.
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
