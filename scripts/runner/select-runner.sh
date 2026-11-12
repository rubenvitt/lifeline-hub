#!/usr/bin/env bash
# Runner-Wahl für `e2e-Binary` und die e2e-Shards (LLH-1666, Spec `ci-eigener-runner`, ADR zum
# eigenen Runner). Aufruf aus dem Job `aenderungen` in `.github/workflows/e2e.yml`:
#
#   select-runner.sh <ereignis> <kopf-repo> <repo> <label>
#
# Gibt das Label des eigenen Runners aus (Repo-Variable `E2E_RUNNER`) oder `ubuntu-latest`.
# Das Label nur, wenn es gesetzt ist und der Lauf kein Pull Request aus einem anderen Repository
# ist; jedes andere oder unbekannte Ereignis als `push` und `pull_request` bleibt auf GitHub.
#
# KEINE SICHERHEITSGRENZE: Ein Fork-PR kann `e2e.yml` ändern und das Label selbst eintragen. Die
# Grenze ist die Fork-Freigabe im Repo („Require approval for all external contributors“). Die
# Weiche sorgt nur dafür, dass das Repo selbst nie fremden Code auf den Server schickt.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Aufruf: $0 <ereignis> <kopf-repo> <repo> <label>" >&2
  exit 2
fi
ereignis="$1"
kopf_repo="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
repo="$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')"
# Leerzeichen drumherum aus der Variablen-Oberfläche verzeihen; alles andere als ein schlichtes
# Label (Komma, Klammer, Ausdruck) abweisen: `runs-on` nähme sonst mehr, als gemeint ist.
label="$(printf '%s' "$4" | tr -d '[:space:]')"

gehostet() {
  echo ubuntu-latest
  exit 0
}

[ -n "$label" ] || gehostet
if ! printf '%s' "$label" | grep -Eq '^[A-Za-z0-9._-]+$'; then
  echo "::warning::E2E_RUNNER='$4' ist kein schlichtes Runner-Label; e2e läuft auf GitHub." >&2
  gehostet
fi

case "$ereignis" in
  push) ;;
  pull_request)
    [ -n "$kopf_repo" ] && [ "$kopf_repo" = "$repo" ] || gehostet
    ;;
  *) gehostet ;;
esac
echo "$label"
