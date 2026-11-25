#!/usr/bin/env bash
# Version der Helfer-App (ADR-0098, Regeln ios/Helfer/AGENTS.md): eigene Zählung, unabhängig von
# `[workspace.package]`, weil die Helfer-App eine eigene App in App Store Connect ist.
#
#   scripts/ios/helfer-version.sh [--build <nummer>] [--ausgabe <datei.xcconfig>]
#
# Schreibt das xcconfig, das `ios/project.yml` für App und Erweiterung der Helfer-App einbindet:
#
#   MARKETING_VERSION        → CFBundleShortVersionString: HELFER_VERSION unten (einzige Stelle)
#   CURRENT_PROJECT_VERSION  → CFBundleVersion: `--build` (in ios-helfer.yml die Laufnummer + 1000),
#                              sonst 1 (Simulator und lokale Builds)
#
# Vorgabe für `--ausgabe`: ios/Helfer/App/Version.xcconfig (nicht versioniert). Selbsttest in
# testflight.test.sh.
set -euo pipefail

# Version der Helfer-App; steigt von Hand mit einer Änderung, die eine neue Version in TestFlight
# braucht.
HELFER_VERSION="0.1.0"

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
AUSGABE="$WURZEL/ios/Helfer/App/Version.xcconfig"
BUILD="1"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --build) [ $# -ge 2 ] || fehler "--build braucht eine Nummer."; BUILD="$2"; shift 2 ;;
    --ausgabe) [ $# -ge 2 ] || fehler "--ausgabe braucht einen Pfad."; AUSGABE="$2"; shift 2 ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --build, --ausgabe)." ;;
  esac
done

[[ "$BUILD" =~ ^[1-9][0-9]{0,17}$ ]] || fehler "Build-Nummer '$BUILD' ist keine positive ganze Zahl."

mkdir -p "$(dirname "$AUSGABE")"
tmp="$AUSGABE.tmp.$$"
{
  echo "// Erzeugt von scripts/ios/helfer-version.sh — nicht von Hand ändern, nicht einchecken."
  echo "MARKETING_VERSION = $HELFER_VERSION"
  echo "CURRENT_PROJECT_VERSION = $BUILD"
} > "$tmp"
mv "$tmp" "$AUSGABE"
echo "Helfer-Version: $HELFER_VERSION (Build $BUILD) → $AUSGABE"
