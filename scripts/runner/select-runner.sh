#!/usr/bin/env bash
# Runner-Wahl für die schweren Suiten (LLH-1666, LLH-2014, ADR-0075). Aufruf aus dem Job `runner`
# in `.github/workflows/suiten.yml`:
#
#   select-runner.sh <ereignis> <label>
#
# Gibt das Label des eigenen Runners aus (Repo-Variable `E2E_RUNNER`) oder `ubuntu-latest`. Das
# Label nur bei `push` (die Kanal-Branches `alpha`, `beta`, `main`) und nur, wenn es ein schlichtes
# Runner-Label ist. Jeder PR-Lauf bleibt auf GitHub, auch mit dem Label `voll` und auch aus dem
# eigenen Repo (Entscheidung 21.11.2026): auf den Server kommt nur gemergter Code.
#
# KEINE SICHERHEITSGRENZE: Ein Fork-PR kann die Workflows ändern und das Label selbst eintragen.
# Die Grenze ist die Fork-Freigabe im Repo („Require approval for all external contributors“).
# Die Weiche sorgt nur dafür, dass das Repo selbst nie ungemergten Code auf den Server schickt.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Aufruf: $0 <ereignis> <label>" >&2
  exit 2
fi
ereignis="$1"
# Leerzeichen drumherum aus der Variablen-Oberfläche verzeihen; alles andere als ein schlichtes
# Label (Komma, Klammer, Ausdruck) abweisen: `runs-on` nähme sonst mehr, als gemeint ist.
label="$(printf '%s' "$2" | tr -d '[:space:]')"

gehostet() {
  echo ubuntu-latest
  exit 0
}

[ -n "$label" ] || gehostet
if ! printf '%s' "$label" | grep -Eq '^[A-Za-z0-9._-]+$'; then
  echo "::warning::E2E_RUNNER='$2' ist kein schlichtes Runner-Label; die Suiten laufen auf GitHub." >&2
  gehostet
fi
[ "$ereignis" = push ] || gehostet
echo "$label"
