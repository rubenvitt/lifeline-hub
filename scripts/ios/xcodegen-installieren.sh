#!/usr/bin/env bash
# XcodeGen in gepinnter Version installieren (LLH-1978, design.md D9). EINZIGE Stelle der
# XcodeGen-Version: `ios-pruefung.yml` und der Upload-Workflow rufen dieses Skript, niemand
# installiert XcodeGen anders (kein `brew install xcodegen`: Homebrew läge eine andere Version hin).
#
#   scripts/ios/xcodegen-installieren.sh [<ziel-verzeichnis>]
#   scripts/ios/xcodegen-installieren.sh --version      (nur die gepinnte Version ausgeben)
#
# Lädt das Release-Zip von GitHub, prüft seine SHA-256 und entpackt es nach <ziel> (Vorgabe:
# `${RUNNER_TEMP:-${TMPDIR:-/tmp}}/xcodegen-<version>`). Das Binary braucht `share/xcodegen`
# neben `bin/`, deshalb bleibt die Form des Zips stehen. In der CI kommt `bin/` nach
# `$GITHUB_PATH`; ausgegeben wird der Pfad des Binaries. Eine neue Version: Version und Prüfsumme
# hier gemeinsam ändern (`shasum -a 256 xcodegen.zip` des Releases). `XCODEGEN_URL` ersetzt nur
# für den Selbsttest die Quelle (xcodegen-installieren.test.sh); die Prüfsumme gilt immer.
set -euo pipefail

XCODEGEN_VERSION="2.46.0"
XCODEGEN_SHA256="4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806"

if [ "${1:-}" = --version ]; then
  echo "$XCODEGEN_VERSION"
  exit 0
fi

ZIEL="${1:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/xcodegen-$XCODEGEN_VERSION}"
URL="${XCODEGEN_URL:-https://github.com/yonaskolb/XcodeGen/releases/download/$XCODEGEN_VERSION/xcodegen.zip}"

sha256() {
  if command -v shasum > /dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | awk '{ print $1 }'
}

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT
# Frist je Versuch und Wiederholung (scripts/AGENTS.md, Netz-Schritte in Workflows).
curl --fail --silent --show-error --location --retry 3 --retry-all-errors --max-time 120 \
  --output "$arbeit/xcodegen.zip" "$URL"
ist="$(sha256 "$arbeit/xcodegen.zip")"
if [ "$ist" != "$XCODEGEN_SHA256" ]; then
  echo "FEHLER: Prüfsumme von XcodeGen $XCODEGEN_VERSION weicht ab (ist $ist, soll $XCODEGEN_SHA256)." >&2
  exit 1
fi

rm -rf "$ZIEL"
mkdir -p "$ZIEL"
unzip -q "$arbeit/xcodegen.zip" -d "$ZIEL"
bin="$ZIEL/xcodegen/bin"
[ -x "$bin/xcodegen" ] || { echo "FEHLER: $bin/xcodegen fehlt im Zip." >&2; exit 1; }
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$bin" >> "$GITHUB_PATH"
fi
echo "$bin/xcodegen"
