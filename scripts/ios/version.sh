#!/usr/bin/env bash
# Version der iOS-App aus `[workspace.package]` (LLH-1978, design.md D1, Spec `ios-auslieferung`).
#
#   scripts/ios/version.sh [--cargo <Cargo.toml>] [--ausgabe <datei.xcconfig>] [--build <JJJJMMTTHHMM>]
#
# Schreibt ein xcconfig, das `ios/project.yml` für alle Konfigurationen der App einbindet:
#
#   MARKETING_VERSION        → CFBundleShortVersionString: Workspace-Version ohne Vorab-Suffix
#                              (Apple nimmt keins an; `1.0.0-beta.3` → `1.0.0`)
#   LIFELINE_VERSION         → Info.plist-Schlüssel `LifelineVersion`: die volle Workspace-Version,
#                              die die Hülle der Seite als `version` meldet
#   CURRENT_PROJECT_VERSION  → CFBundleVersion: Zeitstempel JJJJMMTTHHMM in UTC. Er steigt mit
#                              jedem Lauf, auch zwischen Beta und stabil derselben
#                              Marketing-Version; TestFlight verlangt eine steigende Nummer.
#
# Die Build-Nummer kommt aus `--build`, sonst aus `IOS_BUILD_NUMMER`, sonst aus der Uhr (UTC).
# Vorgaben: `--cargo` die Cargo.toml der Wurzel, `--ausgabe` `ios/App/Version.xcconfig` (nicht
# versioniert: `ios/` pflegt keine eigene Versionsangabe). Selbsttest: version.test.sh daneben.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
CARGO="$WURZEL/Cargo.toml"
AUSGABE="$WURZEL/ios/App/Version.xcconfig"
BUILD="${IOS_BUILD_NUMMER-}"
BUILD_GESETZT="${IOS_BUILD_NUMMER+1}"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --cargo) [ $# -ge 2 ] || fehler "--cargo braucht einen Pfad."; CARGO="$2"; shift 2 ;;
    --ausgabe) [ $# -ge 2 ] || fehler "--ausgabe braucht einen Pfad."; AUSGABE="$2"; shift 2 ;;
    --build) [ $# -ge 2 ] || fehler "--build braucht eine Nummer."; BUILD="$2"; BUILD_GESETZT=1; shift 2 ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --cargo, --ausgabe, --build)." ;;
  esac
done

[ -f "$CARGO" ] || fehler "$CARGO fehlt."
# Nur `[workspace.package]`: die einzige Stelle der Anwendungsversion (wie
# scripts/release/kanal-nachziehen.sh), nie die `version` eines einzelnen Pakets.
VOLL="$(awk '
  /^\[/ { im = ($0 == "[workspace.package]") }
  im && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }' "$CARGO")"
[ -n "$VOLL" ] || fehler "keine Version in [workspace.package] von $CARGO."
# SemVer ohne Build-Metadaten: Kern aus drei Zahlen, optional ein Vorab-Suffix.
[[ "$VOLL" =~ ^([0-9]+\.[0-9]+\.[0-9]+)(-[0-9A-Za-z.-]+)?$ ]] \
  || fehler "Workspace-Version '$VOLL' ist nicht MAJOR.MINOR.PATCH[-VORAB]."
MARKETING="${BASH_REMATCH[1]}"

if [ -z "$BUILD_GESETZT" ]; then
  BUILD="$(date -u +%Y%m%d%H%M)"
fi
[[ "$BUILD" =~ ^[0-9]{12}$ ]] || fehler "Build-Nummer '$BUILD' ist kein Zeitstempel JJJJMMTTHHMM."

mkdir -p "$(dirname "$AUSGABE")"
tmp="$AUSGABE.tmp.$$"
{
  echo "// Erzeugt von scripts/ios/version.sh aus [workspace.package] — nicht von Hand ändern,"
  echo "// nicht einchecken."
  echo "MARKETING_VERSION = $MARKETING"
  echo "LIFELINE_VERSION = $VOLL"
  echo "CURRENT_PROJECT_VERSION = $BUILD"
} > "$tmp"
mv "$tmp" "$AUSGABE"
echo "iOS-Version: $MARKETING (LifelineVersion $VOLL, Build $BUILD) → $AUSGABE"
