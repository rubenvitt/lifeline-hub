#!/usr/bin/env bash
# Signierte Release-APK der Android-Hülle bauen (LLH-1989, Entwurf D9). Aufgerufen von
# `.github/workflows/android.yml`, auf jedem Rechner mit JDK und Android-SDK genauso.
#
#   scripts/android/release-apk.sh --tag <vX.Y.Z | vX.Y.Z-beta.N | vX.Y.Z-alpha.N> \
#     --ausgabe <verzeichnis> [-- <gradle-argument>…]
#
# Umgebung (Secrets des Repositorys, docs/betrieb/android-app.md):
#   ANDROID_KEYSTORE_BASE64     der Keystore (PKCS12 oder JKS) in Base64
#   ANDROID_KEYSTORE_PASSWORD   Passwort des Keystores
#   ANDROID_KEY_ALIAS           Alias des Schlüssels
#   ANDROID_KEY_PASSWORD        Passwort des Schlüssels
#   ANDROID_HOME                Android-SDK mit den Build-Tools aus scripts/android/sdk-version.sh
#
# Ablauf: Tag prüfen (Kanäle `alpha`, `beta`, `main`) → Geheimnisse prüfen (fehlt eins: rot, nie
# eine unsignierte APK) → Version aus scripts/android/version.sh, gegen den Tag → Keystore in
# einen Wegwerf-Ordner (Rechte 600, gelöscht auch nach Rot) → `:app:assembleRelease` signiert →
# `apksigner verify` und Version in der APK gegen den Tag (`aapt2 dump badging`) → in die Ausgabe:
# `lifeline-hub-android-<version>.apk` und `.sha256`. Steht `GITHUB_OUTPUT` in der Umgebung, gehen
# `version_code` und `sha256` dorthin (für das Manifest in android.yml).
#
# Ein Schlüssel für immer: eine APK mit anderem Schlüssel installiert Android nicht über die
# vorhandene App. Der Fingerabdruck des Zertifikats steht deshalb im Log. Gradle-Argumente nach
# `--` gehen an den Bau (lokal etwa ein `--init-script`). Selbsttest: release-apk.test.sh daneben.
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
TAG=""
AUSGABE=""

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || fehler "--tag braucht einen Tag."; TAG="$2"; shift 2 ;;
    --ausgabe) [ $# -ge 2 ] || fehler "--ausgabe braucht ein Verzeichnis."; AUSGABE="$2"; shift 2 ;;
    --) shift; break ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --tag, --ausgabe, -- <gradle-argument>…)." ;;
  esac
done

[ -n "$TAG" ] || fehler "--tag fehlt."
[ -n "$AUSGABE" ] || fehler "--ausgabe fehlt."
# Nur die drei Release-Kanäle; ein anderer Vorabkanal (`-rc.1`) gehört in keinen Update-Kanal.
# Erst gegen das Muster prüfen, dann verwenden: bei einem Handstart ist der Tag freie Eingabe.
if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$ ]]; then
  fehler "'$TAG' gehört in keinen Android-Kanal: gebaut werden nur Tags der Kanäle alpha (vX.Y.Z-alpha.N), beta (vX.Y.Z-beta.N) und main (vX.Y.Z)."
fi
VERSION="${TAG#v}"

fehlt=()
for v in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  [ -n "${!v:-}" ] || fehlt+=("$v")
done
if [ "${#fehlt[@]}" -gt 0 ]; then
  fehler "Secrets für die Signatur fehlen: ${fehlt[*]}. Anleitung: docs/betrieb/android-app.md."
fi

[ -n "${ANDROID_HOME:-}" ] || fehler "ANDROID_HOME ist nicht gesetzt (Android-SDK)."
# Erst die Ausgabe, dann `eval`: in `eval "$(…)"` ginge ein Fehler des Skripts verloren.
werte="$("$WURZEL/scripts/android/sdk-version.sh")"
eval "$werte"
WERKZEUGE="$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS"
for werkzeug in apksigner aapt2; do
  [ -x "$WERKZEUGE/$werkzeug" ] \
    || fehler "$WERKZEUGE/$werkzeug fehlt (scripts/android/sdk-installieren.sh)."
done

# Version aus [workspace.package]; sie muss die des Tags sein, sonst trüge die APK eine andere
# Version als das Release, und der Updater verglich falsch.
werte="$("$WURZEL/scripts/android/version.sh")"
eval "$werte"
[ "$LIFELINE_VERSION" = "$VERSION" ] \
  || fehler "Workspace-Version $LIFELINE_VERSION passt nicht zum Tag $TAG (erwartet $VERSION)."
export LIFELINE_VERSION LIFELINE_VERSION_CODE

# Der Keystore nur in einem eigenen Wegwerf-Ordner, nie in der Ausgabe oder im Repo.
geheim="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/android-signatur.XXXXXX")"
trap 'rm -rf "$geheim"' EXIT
chmod 700 "$geheim"
export ANDROID_KEYSTORE_PATH="$geheim/release.keystore"
( umask 077; printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$ANDROID_KEYSTORE_PATH" ) \
  || fehler "ANDROID_KEYSTORE_BASE64 ist kein Base64 (docs/betrieb/android-app.md)."
[ -s "$ANDROID_KEYSTORE_PATH" ] || fehler "ANDROID_KEYSTORE_BASE64 ergibt einen leeren Keystore."
unset ANDROID_KEYSTORE_BASE64
export ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD

APKS="$WURZEL/android/app/build/outputs/apk/release"
rm -rf "$APKS"
echo "==> Release-APK bauen ($VERSION, versionCode $LIFELINE_VERSION_CODE)"
# Der Kotlin-Compiler legt Klassen mit Umlauten im Namen an; unter der Locale C scheitert das.
LC_ALL=C.UTF-8 "$WURZEL/android/gradlew" -p "$WURZEL/android" :app:assembleRelease --console=plain "$@"

# Ohne Signatur hieße die Datei `app-release-unsigned.apk`: dann hat Gradle die Umgebung nicht
# gesehen, und das darf nie ans Release.
APK="$APKS/app-release.apk"
[ -f "$APK" ] || fehler "$APK fehlt; gebaut wurde: $(ls "$APKS" 2> /dev/null | tr '\n' ' ')"

echo "==> Signatur prüfen"
"$WERKZEUGE/apksigner" verify --verbose --print-certs "$APK" > "$geheim/verify.txt" \
  || { cat "$geheim/verify.txt" >&2; fehler "apksigner verify lehnt die APK ab."; }
grep -E '^Verified using|^Signer #1 certificate (DN|SHA-256)' "$geheim/verify.txt" || true

# `sed` statt `head`: head endete früh, und pipefail wertete das SIGPIPE von aapt2 als Fehler.
badging="$("$WERKZEUGE/aapt2" dump badging "$APK" | sed -n '1p')"
[[ "$badging" == *"name='dev.rubeen.lifeline.android'"* ]] \
  || fehler "Die APK trägt nicht das Paket dev.rubeen.lifeline.android: $badging"
[[ "$badging" == *"versionName='$VERSION'"* ]] \
  || fehler "Die APK trägt nicht versionName $VERSION: $badging"
[[ "$badging" == *"versionCode='$LIFELINE_VERSION_CODE'"* ]] \
  || fehler "Die APK trägt nicht versionCode $LIFELINE_VERSION_CODE: $badging"

NAME="lifeline-hub-android-$VERSION.apk"
mkdir -p "$AUSGABE"
cp "$APK" "$AUSGABE/$NAME"
# Auf macOS fehlt `sha256sum`; `shasum -a 256` schreibt dasselbe Format („<hex>  <name>“).
( cd "$AUSGABE" && if command -v sha256sum > /dev/null 2>&1; then sha256sum "$NAME"; else shasum -a 256 "$NAME"; fi > "$NAME.sha256" )
SHA256="$(cut -d' ' -f1 "$AUSGABE/$NAME.sha256")"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version_code=$LIFELINE_VERSION_CODE"
    echo "sha256=$SHA256"
  } >> "$GITHUB_OUTPUT"
fi
echo "Gebaut: $NAME (versionCode $LIFELINE_VERSION_CODE, sha256 $SHA256)."
