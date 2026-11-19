#!/usr/bin/env bash
# iOS-App archivieren, signieren und zu TestFlight hochladen (LLH-1978, design.md D9, Spec
# `ios-auslieferung`, „TestFlight erhält Beta- und stabile Stände“). Läuft nur auf macOS mit Xcode;
# aufgerufen von `.github/workflows/ios.yml`, auf einem Mac genauso.
#
#   scripts/ios/testflight.sh --tag <vX.Y.Z | vX.Y.Z-beta.N> [--ausgabe <verzeichnis>]
#
# Umgebung (Secrets des Repositorys, docs/betrieb/ios-app.md):
#   APP_STORE_CONNECT_KEY_ID      Schlüssel-ID des App-Store-Connect-API-Schlüssels
#   APP_STORE_CONNECT_ISSUER_ID   Issuer-ID
#   APP_STORE_CONNECT_KEY_P8      Inhalt der .p8-Datei
#
# Ablauf: Tag prüfen (nur die Kanäle `beta` und `main`; Alpha-Tags nie, Spec) → Version schreiben
# (scripts/ios/version.sh) und gegen den Tag prüfen → Projekt erzeugen (`xcodegen`, gepinnt über
# scripts/ios/xcodegen-installieren.sh, muss im PATH stehen) → `xcodebuild archive` → `xcodebuild
# -exportArchive` mit `destination` `upload`: der Export lädt den Build selbst zu App Store Connect
# hoch, TestFlight übernimmt ihn nach Apples Verarbeitung.
#
# Signiert wird automatisch über den API-Schlüssel (`-allowProvisioningUpdates` mit
# `-authenticationKey*`): Xcode holt Zertifikat und Profil selbst, auf dem Runner liegt kein
# Zertifikat. Der Schlüssel liegt nur während des Laufs mit Rechten 600 in einem Wegwerf-Ordner
# und steht nie im Log. Die Build-Nummer setzt version.sh (Zeitstempel), nicht Xcode.
# Selbsttest: testflight.test.sh daneben (Attrappen für xcodebuild und xcodegen).
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
AUSGABE="$WURZEL/ios/build/testflight"
TAG=""
# Team der App; dieselbe Angabe wie `DEVELOPMENT_TEAM` in ios/project.yml (der Selbsttest
# vergleicht beide).
TEAM_ID="H95J852PKP"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || fehler "--tag braucht einen Tag."; TAG="$2"; shift 2 ;;
    --ausgabe) [ $# -ge 2 ] || fehler "--ausgabe braucht ein Verzeichnis."; AUSGABE="$2"; shift 2 ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --tag, --ausgabe)." ;;
  esac
done

[ -n "$TAG" ] || fehler "--tag fehlt."
# Nur stabile und Beta-Tags (Spec: Alpha-Tags werden nie hochgeladen). Erst gegen das Muster
# prüfen, dann verwenden: bei einem Handstart ist der Tag freie Eingabe.
if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]]; then
  fehler "'$TAG' gehört in keinen TestFlight-Kanal: hochgeladen werden nur Tags der Kanäle beta (vX.Y.Z-beta.N) und main (vX.Y.Z), nie Alpha."
fi
VERSION="${TAG#v}"

fehlt=()
for v in APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_P8; do
  [ -n "${!v:-}" ] || fehlt+=("$v")
done
if [ "${#fehlt[@]}" -gt 0 ]; then
  fehler "Secrets für Signierung und Upload fehlen: ${fehlt[*]} (docs/betrieb/ios-app.md)."
fi
[[ "$APP_STORE_CONNECT_KEY_ID" =~ ^[A-Za-z0-9]+$ ]] \
  || fehler "APP_STORE_CONNECT_KEY_ID ist keine Schlüssel-ID (nur Buchstaben und Ziffern)."

for werkzeug in xcodebuild xcodegen; do
  command -v "$werkzeug" > /dev/null 2>&1 || fehler "$werkzeug fehlt im PATH."
done

# Version aus [workspace.package]; sie muss die des Tags sein, sonst trüge der Build in TestFlight
# eine andere Version als das Release.
"$WURZEL/scripts/ios/version.sh"
ist="$(awk '$1 == "LIFELINE_VERSION" && $2 == "=" { print $3; exit }' "$WURZEL/ios/App/Version.xcconfig")"
[ "$ist" = "$VERSION" ] \
  || fehler "Workspace-Version $ist passt nicht zum Tag $TAG (erwartet $VERSION)."

xcodegen generate --spec "$WURZEL/ios/project.yml"

rm -rf "$AUSGABE"
mkdir -p "$AUSGABE"
ARCHIV="$AUSGABE/LifelineHub.xcarchive"
OPTIONEN="$AUSGABE/ExportOptions.plist"

# Der Schlüssel nur in einem eigenen Wegwerf-Ordner, nie in der Ausgabe (die lädt ein Workflow
# womöglich als Artefakt hoch). Gelöscht auch nach einem roten Schritt.
geheim="$(mktemp -d)"
trap 'rm -rf "$geheim"' EXIT
chmod 700 "$geheim"
SCHLUESSEL="$geheim/AuthKey_$APP_STORE_CONNECT_KEY_ID.p8"
( umask 077; printf '%s\n' "$APP_STORE_CONNECT_KEY_P8" > "$SCHLUESSEL" )
unset APP_STORE_CONNECT_KEY_P8

anmeldung=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$SCHLUESSEL"
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID"
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"
)

# `app-store-connect` ist der Name der Methode seit Xcode 15.3 (vorher `app-store`);
# `destination upload` lädt beim Export hoch. Die Build-Nummer bleibt die von version.sh.
cat > "$OPTIONEN" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

echo "==> Archivieren ($VERSION)"
xcodebuild archive \
  -project "$WURZEL/ios/LifelineHub.xcodeproj" \
  -scheme LifelineHub \
  -configuration Release \
  -destination generic/platform=iOS \
  -archivePath "$ARCHIV" \
  "${anmeldung[@]}"

echo "==> Exportieren und zu App Store Connect hochladen"
xcodebuild -exportArchive \
  -archivePath "$ARCHIV" \
  -exportPath "$AUSGABE/export" \
  -exportOptionsPlist "$OPTIONEN" \
  "${anmeldung[@]}"

echo "Hochgeladen: Lifeline $VERSION. TestFlight zeigt den Build nach Apples Verarbeitung."
