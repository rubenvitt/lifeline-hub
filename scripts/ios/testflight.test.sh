#!/usr/bin/env bash
# Selbsttest für scripts/ios/testflight.sh (LLH-1978; seit LLH-1988 jeder Kanal, ADR-0080).
#
# Ein Fehler fiele erst an einem echten Release auf: ein fremder Vorabkanal in TestFlight, ein Build mit
# einer anderen Version als der Tag, ein API-Schlüssel, der im Log steht oder auf dem Runner liegen
# bleibt, oder ExportOptions, die nur exportieren statt hochzuladen. Gefahren in einer
# Wegwerf-Wurzel mit Attrappen für `xcodebuild` und `xcodegen`, ohne Netz und ohne macOS. Ob Apple
# die Aufrufe annimmt, zeigt erst der Handstart von `ios.yml` (Aufgabe 10.2).
set -euo pipefail

QUELLE="$(cd "$(dirname "$0")/../.." && pwd)"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}
ja_nein() { if "$@"; then echo ja; else echo nein; fi; }

GEHEIM="-----BEGIN PRIVATE KEY-----geheim-$RANDOM-----END PRIVATE KEY-----"

# Attrappen: protokollieren ihre Argumente; `xcodebuild -exportArchive` hält zusätzlich fest,
# ob die Schlüsseldatei in diesem Moment da ist, welche Rechte sie hat und was drinsteht.
mkdir -p "$ARBEIT/bin"
cat > "$ARBEIT/bin/xcodebuild" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "xcodebuild $*" >> "$ATTRAPPEN_LOG"
pfad=""
vorher=""
for a in "$@"; do
  [ "$vorher" = -authenticationKeyPath ] && pfad="$a"
  vorher="$a"
done
if [ -n "$pfad" ]; then
  echo "schluessel-rechte $(stat -c %a "$pfad" 2> /dev/null || stat -f %Lp "$pfad")" >> "$ATTRAPPEN_LOG"
  [ "$(cat "$pfad")" = "$ERWARTETER_SCHLUESSEL" ] && echo "schluessel-inhalt ok" >> "$ATTRAPPEN_LOG"
  echo "schluessel-pfad $pfad" >> "$ATTRAPPEN_LOG"
fi
case " $* " in
  *" archive "*) [ "${ARCHIV_SCHEITERT:-0}" = 1 ] && exit 65 ;;
esac
exit 0
ATTRAPPE
cat > "$ARBEIT/bin/xcodegen" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "xcodegen $*" >> "$ATTRAPPEN_LOG"
ATTRAPPE
chmod +x "$ARBEIT/bin/xcodebuild" "$ARBEIT/bin/xcodegen"

# Eine Wurzel mit Workspace-Version, Projekt und den beiden Skripten.
wurzel_mit() { # <version> → Pfad
  local w="$ARBEIT/wurzel-$RANDOM"
  mkdir -p "$w/scripts/ios" "$w/ios/App"
  cp "$QUELLE/scripts/ios/testflight.sh" "$QUELLE/scripts/ios/version.sh" \
    "$QUELLE/scripts/ios/helfer-version.sh" "$w/scripts/ios/"
  cp "$QUELLE/ios/project.yml" "$w/ios/project.yml"
  printf '[workspace.package]\nversion = "%s"\n' "$1" > "$w/Cargo.toml"
  printf '%s\n' "$w"
}

laufe() { # <wurzel> [<arg>…] → Exit-Code; Ausgabe in $ARBEIT/log, Attrappen in $ARBEIT/aufrufe
  local w="$1"
  shift
  : > "$ARBEIT/aufrufe"
  local rc=0
  PATH="$ARBEIT/bin:$PATH" ATTRAPPEN_LOG="$ARBEIT/aufrufe" ERWARTETER_SCHLUESSEL="$GEHEIM" \
    IOS_BUILD_NUMMER=202611181200 GITHUB_OUTPUT="${AUSGABE_DATEI-}" \
    APP_STORE_CONNECT_KEY_ID="${KEY_ID-ABC123XYZ9}" \
    APP_STORE_CONNECT_ISSUER_ID="${ISSUER_ID-11111111-2222-3333-4444-555555555555}" \
    APP_STORE_CONNECT_KEY_P8="${KEY_P8-$GEHEIM}" \
    "$w/scripts/ios/testflight.sh" "$@" > "$ARBEIT/log" 2>&1 || rc=$?
  echo "$rc"
}
aufrufe_mit() { grep -c -- "$1" "$ARBEIT/aufrufe" || true; }

echo "==> ios/testflight.sh: Beta-Tag"
w="$(wurzel_mit 1.0.0-beta.3)"
pruefe "Beta: Exit 0" 0 "$(laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Beta: Projekt erzeugt" 1 "$(aufrufe_mit "xcodegen generate --spec $w/ios/project.yml")"
pruefe "Beta: Marketing-Version ohne Suffix" "MARKETING_VERSION = 1.0.0" \
  "$(grep '^MARKETING_VERSION' "$w/ios/App/Version.xcconfig")"
pruefe "Beta: volle Version in der App" "LIFELINE_VERSION = 1.0.0-beta.3" \
  "$(grep '^LIFELINE_VERSION' "$w/ios/App/Version.xcconfig")"
archiv="$(grep '^xcodebuild archive' "$ARBEIT/aufrufe" || true)"
for teil in "-project $w/ios/LifelineHub.xcodeproj" "-scheme LifelineHub" "-configuration Release" \
  "-destination generic/platform=iOS" "-archivePath $w/aus/LifelineHub.xcarchive" \
  "-allowProvisioningUpdates" "-authenticationKeyID ABC123XYZ9" \
  "-authenticationKeyIssuerID 11111111-2222-3333-4444-555555555555" "-authenticationKeyPath "; do
  pruefe "Archiv: $teil" ja "$(ja_nein grep -qF -- "$teil" <<< "$archiv")"
done
export_="$(grep '^xcodebuild -exportArchive' "$ARBEIT/aufrufe" || true)"
for teil in "-archivePath $w/aus/LifelineHub.xcarchive" "-exportPath $w/aus/export" \
  "-exportOptionsPlist $w/aus/ExportOptions.plist" "-allowProvisioningUpdates" \
  "-authenticationKeyID ABC123XYZ9" "-authenticationKeyPath "; do
  pruefe "Export: $teil" ja "$(ja_nein grep -qF -- "$teil" <<< "$export_")"
done
pruefe "Export kommt nach dem Archiv" "archive -exportArchive" \
  "$(grep -oE '^xcodebuild (archive|-exportArchive)' "$ARBEIT/aufrufe" | awk '{ print $2 }' | tr '\n' ' ' | sed 's/ $//')"
pruefe "Schlüssel nur für den Besitzer lesbar" "600 600" \
  "$(awk '$1 == "schluessel-rechte" { print $2 }' "$ARBEIT/aufrufe" | tr '\n' ' ' | sed 's/ $//')"
pruefe "Schlüssel trägt den Inhalt des Secrets" 2 "$(aufrufe_mit 'schluessel-inhalt ok')"
schluessel="$(awk '$1 == "schluessel-pfad" { print $2; exit }' "$ARBEIT/aufrufe")"
pruefe "Schlüssel heißt AuthKey_<ID>.p8" AuthKey_ABC123XYZ9.p8 "$(basename "${schluessel:-leer}")"
pruefe "Schlüssel liegt danach nicht mehr auf der Platte" nein "$([ -e "$schluessel" ] && echo ja || echo nein)"
pruefe "Schlüssel liegt nicht in der Ausgabe" nein \
  "$(ja_nein grep -rqF -- "$GEHEIM" "$w/aus")"
pruefe "Schlüssel steht nicht im Log" nein "$(ja_nein grep -qF -- "$GEHEIM" "$ARBEIT/log")"
plist="$w/aus/ExportOptions.plist"
plist_wert() { # <schlüssel> → Wert der folgenden Zeile ohne Tags
  awk -v k="<key>$1</key>" 'gefunden { gsub(/^[[:space:]]*<[^>]*>|<[^>]*>[[:space:]]*$/, ""); print; exit } index($0, k) { gefunden = 1 }' "$plist"
}
pruefe "ExportOptions: method" app-store-connect "$(plist_wert method)"
pruefe "ExportOptions: destination" upload "$(plist_wert destination)"
pruefe "ExportOptions: signingStyle" automatic "$(plist_wert signingStyle)"
team="$(awk '$1 == "DEVELOPMENT_TEAM:" { print $2; exit }' "$QUELLE/ios/project.yml")"
pruefe "ExportOptions: teamID wie ios/project.yml" "$team" "$(plist_wert teamID)"
pruefe "ExportOptions: Build-Nummer bleibt die des Skripts" "<false/>" \
  "$(awk 'gefunden { gsub(/[[:space:]]/, ""); print; exit } /<key>manageAppVersionAndBuildNumber<\/key>/ { gefunden = 1 }' "$plist")"

echo "==> ios/testflight.sh: stabiler Tag"
w="$(wurzel_mit 1.2.0)"
pruefe "stabil: Exit 0" 0 "$(laufe "$w" --tag v1.2.0 --ausgabe "$w/aus")"
pruefe "stabil: hochgeladen" 1 "$(aufrufe_mit '^xcodebuild -exportArchive')"

echo "==> ios/testflight.sh: Alpha-Tag (LLH-1988, ADR-0080)"
w="$(wurzel_mit 1.0.0-alpha.200)"
pruefe "Alpha: Exit 0" 0 "$(laufe "$w" --tag v1.0.0-alpha.200 --ausgabe "$w/aus")"
pruefe "Alpha: hochgeladen" 1 "$(aufrufe_mit '^xcodebuild -exportArchive')"
pruefe "Alpha: Marketing-Version ohne Suffix" "MARKETING_VERSION = 1.0.0" \
  "$(grep '^MARKETING_VERSION' "$w/ios/App/Version.xcconfig")"

echo "==> ios/testflight.sh: Build-Nummer für den Verteilschritt"
w="$(wurzel_mit 1.0.0-beta.3)"
ausgabe="$ARBEIT/github-output"
: > "$ausgabe"
pruefe "Ausgabe: Exit 0" 0 "$(AUSGABE_DATEI="$ausgabe" laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Ausgabe: build= mit der Nummer aus version.sh" "build=202611181200" "$(cat "$ausgabe")"
w="$(wurzel_mit 1.0.0-beta.3)"
pruefe "ohne GITHUB_OUTPUT: Exit 0" 0 "$(laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"

echo "==> ios/testflight.sh: Helfer-App (ADR-0098, ios-helfer.yml)"
w="$(wurzel_mit 1.0.0-alpha.200)"
ausgabe="$ARBEIT/github-output-helfer"
: > "$ausgabe"
pruefe "Helfer: Exit 0" 0 "$(AUSGABE_DATEI="$ausgabe" laufe "$w" --app helfer --build 1042 --ausgabe "$w/aus")"
pruefe "Helfer: Projekt erzeugt" 1 "$(aufrufe_mit "xcodegen generate --spec $w/ios/project.yml")"
pruefe "Helfer: Version der Hülle trotzdem geschrieben (XcodeGen braucht sie)" ja \
  "$([ -f "$w/ios/App/Version.xcconfig" ] && echo ja || echo nein)"
pruefe "Helfer: eigene Marketing-Version" "MARKETING_VERSION = $(awk -F'"' '/^HELFER_VERSION=/ { print $2 }' "$QUELLE/scripts/ios/helfer-version.sh")" \
  "$(grep '^MARKETING_VERSION' "$w/ios/Helfer/App/Version.xcconfig")"
pruefe "Helfer: Build-Nummer aus --build" "CURRENT_PROJECT_VERSION = 1042" \
  "$(grep '^CURRENT_PROJECT_VERSION' "$w/ios/Helfer/App/Version.xcconfig")"
archiv="$(grep '^xcodebuild archive' "$ARBEIT/aufrufe" || true)"
for teil in "-scheme LifelineHelfer" "-archivePath $w/aus/LifelineHelfer.xcarchive" \
  "-allowProvisioningUpdates" "-authenticationKeyID ABC123XYZ9" "-authenticationKeyPath "; do
  pruefe "Helfer-Archiv: $teil" ja "$(ja_nein grep -qF -- "$teil" <<< "$archiv")"
done
pruefe "Helfer-Archiv: nicht das Schema der Hülle" nein "$(ja_nein grep -qF -- "-scheme LifelineHub" <<< "$archiv")"
pruefe "Helfer: hochgeladen" 1 "$(aufrufe_mit '^xcodebuild -exportArchive')"
pruefe "Helfer: build= mit der Nummer aus --build" "build=1042" "$(cat "$ausgabe")"
pruefe "Helfer: Schlüssel steht nicht im Log" nein "$(ja_nein grep -qF -- "$GEHEIM" "$ARBEIT/log")"

w="$(wurzel_mit 1.0.0-beta.3)"
rc="$(laufe "$w" --app helfer --ausgabe "$w/aus")"
pruefe "Helfer ohne --build: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "Helfer ohne --build: kein xcodebuild" 0 "$(aufrufe_mit '^xcodebuild')"
rc="$(laufe "$w" --app helfer --build 0 --ausgabe "$w/aus")"
pruefe "Helfer mit Build 0: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
rc="$(laufe "$w" --app helfer --build '12;id' --ausgabe "$w/aus")"
pruefe "Helfer mit Build-Unsinn: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
rc="$(laufe "$w" --app helfer --build 1042 --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Helfer mit --tag: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
rc="$(laufe "$w" --tag v1.0.0-beta.3 --build 1042 --ausgabe "$w/aus")"
pruefe "Hülle mit --build: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
rc="$(laufe "$w" --app andere --build 1042 --ausgabe "$w/aus")"
pruefe "unbekannte App: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "unbekannte App: kein xcodebuild" 0 "$(aufrufe_mit '^xcodebuild')"

echo "==> ios/testflight.sh: abgewiesen"

w="$(wurzel_mit 1.0.0-rc.1)"
rc="$(laufe "$w" --tag v1.0.0-rc.1 --ausgabe "$w/aus")"
pruefe "anderer Vorabkanal: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "anderer Vorabkanal: kein xcodebuild" 0 "$(aufrufe_mit '^xcodebuild')"
pruefe "anderer Vorabkanal: Meldung nennt die Kanäle" ja "$(ja_nein grep -q 'alpha.*beta' "$ARBEIT/log")"

rc="$(laufe "$w" --tag 'v1.0.0;id' --ausgabe "$w/aus")"
pruefe "kein Release-Tag: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
rc="$(laufe "$w" --ausgabe "$w/aus")"
pruefe "ohne --tag: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"

w="$(wurzel_mit 1.0.0-beta.4)"
rc="$(laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Tag ≠ Workspace-Version: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "Tag ≠ Workspace-Version: kein xcodebuild" 0 "$(aufrufe_mit '^xcodebuild')"
pruefe "Tag ≠ Workspace-Version: Meldung nennt beide" ja \
  "$(ja_nein grep -q '1.0.0-beta.4.*1.0.0-beta.3\|1.0.0-beta.3.*1.0.0-beta.4' "$ARBEIT/log")"

w="$(wurzel_mit 1.0.0-beta.3)"
rc="$(KEY_ID='' KEY_P8='' laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Secrets fehlen: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "Secrets fehlen: kein xcodebuild" 0 "$(aufrufe_mit '^xcodebuild')"
pruefe "Secrets fehlen: beide genannt" ja \
  "$(ja_nein grep -q 'APP_STORE_CONNECT_KEY_ID.*APP_STORE_CONNECT_KEY_P8' "$ARBEIT/log")"
pruefe "Secrets fehlen: der vorhandene nicht" nein \
  "$(ja_nein grep -q 'APP_STORE_CONNECT_ISSUER_ID' "$ARBEIT/log")"

echo "==> ios/testflight.sh: Archiv scheitert"
w="$(wurzel_mit 1.0.0-beta.3)"
rc="$(ARCHIV_SCHEITERT=1 laufe "$w" --tag v1.0.0-beta.3 --ausgabe "$w/aus")"
pruefe "Archiv rot: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "Archiv rot: kein Upload" 0 "$(aufrufe_mit '^xcodebuild -exportArchive')"
schluessel="$(awk '$1 == "schluessel-pfad" { print $2; exit }' "$ARBEIT/aufrufe")"
pruefe "Archiv rot: Schlüssel trotzdem gelöscht" nein \
  "$([ -n "$schluessel" ] && [ -e "$schluessel" ] && echo ja || echo nein)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ios/testflight." >&2
  exit 1
fi
echo "==> OK: Selbsttest ios/testflight."
