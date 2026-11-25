#!/usr/bin/env bash
# iOS-App archivieren, signieren und zu TestFlight hochladen (LLH-1978, design.md D9; seit LLH-1988
# jeder Kanal, ADR-0080). Läuft nur auf macOS mit Xcode; aufgerufen von `.github/workflows/ios.yml`,
# auf einem Mac genauso. An die TestFlight-Gruppen verteilt danach testflight-verteilen.mjs.
#
#   scripts/ios/testflight.sh --tag <vX.Y.Z | vX.Y.Z-beta.N | vX.Y.Z-alpha.N> [--ausgabe <verzeichnis>]
#   scripts/ios/testflight.sh --app helfer --build <nummer> [--ausgabe <verzeichnis>]
#
# `--app` wählt die App: `hub` (Vorgabe) ist die Lifeline-Hülle mit Tag und Workspace-Version,
# `helfer` die Helfer-App (ADR-0098, `.github/workflows/ios-helfer.yml`): Schema
# `LifelineHelfer`, kein Tag, Version aus scripts/ios/helfer-version.sh und die Build-Nummer aus
# `--build`. Signierung und Upload sind dieselben.
#
# Umgebung (Secrets des Repositorys, docs/betrieb/ios-app.md):
#   APP_STORE_CONNECT_KEY_ID      Schlüssel-ID des App-Store-Connect-API-Schlüssels
#   APP_STORE_CONNECT_ISSUER_ID   Issuer-ID
#   APP_STORE_CONNECT_KEY_P8      Inhalt der .p8-Datei
#
# Ablauf: Tag prüfen (die Kanäle `alpha`, `beta` und `main`, sonst kein Vorabkanal) → Version schreiben
# (scripts/ios/version.sh) und gegen den Tag prüfen → Projekt erzeugen (`xcodegen`, gepinnt über
# scripts/ios/xcodegen-installieren.sh, muss im PATH stehen) → `xcodebuild archive` → `xcodebuild
# -exportArchive` mit `destination` `upload`: der Export lädt den Build selbst zu App Store Connect
# hoch, TestFlight übernimmt ihn nach Apples Verarbeitung. Steht `GITHUB_OUTPUT` in der Umgebung,
# geht die Build-Nummer als `build=…` dorthin (für den Verteilschritt in ios.yml).
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
APP="hub"
HELFER_BUILD=""
# Team der App; dieselbe Angabe wie `DEVELOPMENT_TEAM` in ios/project.yml (der Selbsttest
# vergleicht beide).
TEAM_ID="H95J852PKP"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || fehler "--tag braucht einen Tag."; TAG="$2"; shift 2 ;;
    --ausgabe) [ $# -ge 2 ] || fehler "--ausgabe braucht ein Verzeichnis."; AUSGABE="$2"; shift 2 ;;
    --app) [ $# -ge 2 ] || fehler "--app braucht hub oder helfer."; APP="$2"; shift 2 ;;
    --build) [ $# -ge 2 ] || fehler "--build braucht eine Nummer."; HELFER_BUILD="$2"; shift 2 ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --tag, --ausgabe, --app, --build)." ;;
  esac
done

case "$APP" in
  hub)
    SCHEMA="LifelineHub"
    [ -z "$HELFER_BUILD" ] || fehler "--build gilt nur mit --app helfer (die Hülle zählt über version.sh)."
    [ -n "$TAG" ] || fehler "--tag fehlt."
    # Nur die drei Release-Kanäle (ADR-0080); ein anderer Vorabkanal wie `-rc.1` gehört in keinen.
    # Erst gegen das Muster prüfen, dann verwenden: bei einem Handstart ist der Tag freie Eingabe.
    if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$ ]]; then
      fehler "'$TAG' gehört in keinen TestFlight-Kanal: hochgeladen werden nur Tags der Kanäle alpha (vX.Y.Z-alpha.N), beta (vX.Y.Z-beta.N) und main (vX.Y.Z)."
    fi
    VERSION="${TAG#v}"
    ;;
  helfer)
    SCHEMA="LifelineHelfer"
    [ -z "$TAG" ] || fehler "--tag gilt nur für die Hülle; die Helfer-App zählt eigene Versionen."
    [[ "$HELFER_BUILD" =~ ^[1-9][0-9]{0,17}$ ]] \
      || fehler "--build braucht eine positive ganze Zahl (die Build-Nummer der Helfer-App)."
    ;;
  *) fehler "unbekannte App '$APP' (erlaubt: hub, helfer)." ;;
esac

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
# eine andere Version als das Release. XcodeGen erzeugt immer das ganze Projekt und bricht ab, wenn
# eine eingebundene xcconfig fehlt: beide Apps brauchen deshalb beide Dateien (ios/App und
# ios/Helfer/App, beide nicht versioniert). Die Hülle schreibt die der Helfer-App mit Build 1; sie
# baut das Schema `LifelineHub` und lädt nur dieses hoch.
"$WURZEL/scripts/ios/version.sh"
if [ "$APP" = hub ]; then
  ist="$(awk '$1 == "LIFELINE_VERSION" && $2 == "=" { print $3; exit }' "$WURZEL/ios/App/Version.xcconfig")"
  [ "$ist" = "$VERSION" ] \
    || fehler "Workspace-Version $ist passt nicht zum Tag $TAG (erwartet $VERSION)."
  BUILD_NUMMER="$(awk '$1 == "CURRENT_PROJECT_VERSION" && $2 == "=" { print $3; exit }' "$WURZEL/ios/App/Version.xcconfig")"
  "$WURZEL/scripts/ios/helfer-version.sh"
else
  "$WURZEL/scripts/ios/helfer-version.sh" --build "$HELFER_BUILD"
  VERSION="$(awk '$1 == "MARKETING_VERSION" && $2 == "=" { print $3; exit }' "$WURZEL/ios/Helfer/App/Version.xcconfig")"
  BUILD_NUMMER="$HELFER_BUILD"
fi

xcodegen generate --spec "$WURZEL/ios/project.yml"

rm -rf "$AUSGABE"
mkdir -p "$AUSGABE"
ARCHIV="$AUSGABE/$SCHEMA.xcarchive"
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
  -scheme "$SCHEMA" \
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

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "build=$BUILD_NUMMER" >> "$GITHUB_OUTPUT"
fi
echo "Hochgeladen: $SCHEMA $VERSION (Build $BUILD_NUMMER). TestFlight zeigt den Build nach Apples Verarbeitung."
