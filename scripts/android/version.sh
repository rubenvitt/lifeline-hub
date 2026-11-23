#!/usr/bin/env bash
# Version der Android-App aus `[workspace.package]` (LLH-1989, Entwurf D4 „Version“).
#
#   scripts/android/version.sh [--cargo <Cargo.toml>] [--jetzt <epoch-sekunden>]
#
# Gibt zwei Zeilen für die Umgebung des Gradle-Baus aus (`android/app/build.gradle.kts` liest
# beide, ohne sie gilt `0.0.0-dev` und `1`):
#
#   LIFELINE_VERSION=<workspace-version>   → versionName: die volle Workspace-Version mit
#                                            Vorab-Suffix (Android nimmt es an); die Hülle meldet
#                                            sie der Seite und vergleicht sie im Updater
#   LIFELINE_VERSION_CODE=<minuten>        → versionCode: ganze Minuten seit 2026-01-01T00:00Z
#                                            zum Bauzeitpunkt. Er steigt mit jedem Lauf, auch
#                                            zwischen Beta und stabil derselben Version, und passt
#                                            noch Jahrtausende in einen Int.
#
# Der Zeitpunkt kommt aus `--jetzt` (Sekunden seit 1970, UTC), sonst aus der Uhr. Vorgabe für
# `--cargo` ist die Cargo.toml der Wurzel (`android/` pflegt keine eigene Versionsangabe).
# Selbsttest: version.test.sh daneben.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
CARGO="$WURZEL/Cargo.toml"
JETZT=""
JETZT_GESETZT=""
# 2026-01-01T00:00:00Z
BEGINN=1767225600

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --cargo) [ $# -ge 2 ] || fehler "--cargo braucht einen Pfad."; CARGO="$2"; shift 2 ;;
    --jetzt) [ $# -ge 2 ] || fehler "--jetzt braucht Sekunden seit 1970."; JETZT="$2"; JETZT_GESETZT=1; shift 2 ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --cargo, --jetzt)." ;;
  esac
done

[ -f "$CARGO" ] || fehler "$CARGO fehlt."
# Nur `[workspace.package]`: die einzige Stelle der Anwendungsversion (wie
# scripts/ios/version.sh), nie die `version` eines einzelnen Pakets.
VOLL="$(awk '
  /^\[/ { im = ($0 == "[workspace.package]") }
  im && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }' "$CARGO")"
[ -n "$VOLL" ] || fehler "keine Version in [workspace.package] von $CARGO."
# SemVer ohne Build-Metadaten: Kern aus drei Zahlen, optional ein Vorab-Suffix.
[[ "$VOLL" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
  || fehler "Workspace-Version '$VOLL' ist nicht MAJOR.MINOR.PATCH[-VORAB]."

if [ -z "$JETZT_GESETZT" ]; then
  JETZT="$(date -u +%s)"
fi
[[ "$JETZT" =~ ^[0-9]+$ ]] || fehler "Zeitpunkt '$JETZT' ist keine Zahl von Sekunden seit 1970."
[ "$JETZT" -ge "$BEGINN" ] || fehler "Zeitpunkt '$JETZT' liegt vor 2026-01-01T00:00Z."
CODE=$(((JETZT - BEGINN) / 60))

echo "LIFELINE_VERSION=$VOLL"
echo "LIFELINE_VERSION_CODE=$CODE"
