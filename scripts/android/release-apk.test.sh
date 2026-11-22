#!/usr/bin/env bash
# Selbsttest für scripts/android/release-apk.sh (LLH-1989, Entwurf D9).
#
# Ein Fehler fiele erst an einem echten Release auf: eine unsignierte APK am Release, eine APK mit
# einer anderen Version als der Tag (der Updater vergliche falsch), ein Keystore, der auf dem
# Runner liegen bleibt oder dessen Passwort im Log steht. Gefahren in einer Wegwerf-Wurzel mit
# Attrappen für `gradlew`, `apksigner` und `aapt2`, ohne Netz und ohne SDK. Dass Gradle mit echtem
# Keystore signiert, belegt der Handstart von `android.yml`.
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
# Auf macOS fehlt `sha256sum` (scripts/check-deps.test.sh), dort rechnet `shasum -a 256`.
sha256_von() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

PASSWORT="passwort-$RANDOM-geheim"
KEYSTORE_INHALT="keystore-$RANDOM"

# SDK-Attrappe: `apksigner` scheitert auf Wunsch, `aapt2` meldet Paket und Version aus der
# Umgebung (wie die APK sie trüge).
SDK="$ARBEIT/sdk"
mkdir -p "$SDK/build-tools/$("$QUELLE/scripts/android/sdk-version.sh" | sed -n 's/^ANDROID_BUILD_TOOLS=//p')"
WERKZEUGE="$(echo "$SDK"/build-tools/*)"
cat > "$WERKZEUGE/apksigner" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "apksigner $*" >> "$ATTRAPPEN_LOG"
[ "${SIGNATUR_UNGUELTIG:-0}" = 1 ] && { echo "DOES NOT VERIFY"; exit 1; }
echo "Verified using v2 scheme (APK Signature Scheme v2): true"
echo "Signer #1 certificate SHA-256 digest: 00ff"
ATTRAPPE
cat > "$WERKZEUGE/aapt2" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "package: name='dev.rubeen.lifeline.android' versionCode='${APK_CODE:-$LIFELINE_VERSION_CODE}' versionName='${APK_VERSION:-$LIFELINE_VERSION}' platformBuildVersionName='17'"
echo "sdkVersion:'29'"
ATTRAPPE
chmod +x "$WERKZEUGE/apksigner" "$WERKZEUGE/aapt2"

# Eine Wurzel mit Workspace-Version, den drei Skripten und einer gradlew-Attrappe, die festhält,
# ob der Keystore während des Baus da ist, mit welchen Rechten und welchem Inhalt.
wurzel_mit() { # <version> → Pfad
  local w="$ARBEIT/wurzel-$RANDOM"
  mkdir -p "$w/scripts/android" "$w/android"
  cp "$QUELLE/scripts/android/release-apk.sh" "$QUELLE/scripts/android/version.sh" \
    "$QUELLE/scripts/android/sdk-version.sh" "$w/scripts/android/"
  printf '[workspace.package]\nversion = "%s"\n' "$1" > "$w/Cargo.toml"
  cat > "$w/android/gradlew" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "gradlew $*" >> "$ATTRAPPEN_LOG"
echo "keystore-rechte $(stat -c %a "$ANDROID_KEYSTORE_PATH" 2> /dev/null || stat -f %Lp "$ANDROID_KEYSTORE_PATH")" >> "$ATTRAPPEN_LOG"
echo "keystore-inhalt $(cat "$ANDROID_KEYSTORE_PATH")" >> "$ATTRAPPEN_LOG"
echo "keystore-pfad $ANDROID_KEYSTORE_PATH" >> "$ATTRAPPEN_LOG"
echo "passwort-da $([ "$ANDROID_KEYSTORE_PASSWORD" = "$ERWARTETES_PASSWORT" ] && echo ja || echo nein)" >> "$ATTRAPPEN_LOG"
echo "locale $LC_ALL" >> "$ATTRAPPEN_LOG"
apks="$(dirname "$0")/app/build/outputs/apk/release"
mkdir -p "$apks"
if [ "${UNSIGNIERT:-0}" = 1 ]; then echo apk > "$apks/app-release-unsigned.apk"; else echo apk > "$apks/app-release.apk"; fi
ATTRAPPE
  chmod +x "$w/android/gradlew"
  printf '%s\n' "$w"
}

laufe() { # <wurzel> [<arg>…] → Exit-Code; Ausgabe in $ARBEIT/aus (stdout und stderr)
  local w="$1" rc=0
  shift
  : > "$ARBEIT/log"
  : > "$ARBEIT/gh-output"
  ATTRAPPEN_LOG="$ARBEIT/log" ERWARTETES_PASSWORT="$PASSWORT" ANDROID_HOME="$SDK" \
    GITHUB_OUTPUT="$ARBEIT/gh-output" RUNNER_TEMP="$ARBEIT" \
    "$w/scripts/android/release-apk.sh" "$@" > "$ARBEIT/aus" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

export ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
ANDROID_KEYSTORE_BASE64="$(printf '%s' "$KEYSTORE_INHALT" | base64)"
ANDROID_KEYSTORE_PASSWORD="$PASSWORT"
ANDROID_KEY_ALIAS="lifeline"
ANDROID_KEY_PASSWORD="$PASSWORT"

W="$(wurzel_mit 1.2.0-beta.3)"

echo "==> release-apk: Erfolg"
pruefe "Beta-Tag baut" 0 "$(laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/versand" -- --offline)"
pruefe "APK unter dem Release-Namen" ja "$(ja_nein test -f "$ARBEIT/versand/lifeline-hub-android-1.2.0-beta.3.apk")"
pruefe "Prüfsumme stimmt" "$(sha256_von "$ARBEIT/versand/lifeline-hub-android-1.2.0-beta.3.apk")  lifeline-hub-android-1.2.0-beta.3.apk" \
  "$(cat "$ARBEIT/versand/lifeline-hub-android-1.2.0-beta.3.apk.sha256")"
pruefe "Gradle baut assembleRelease mit den Zusatzargumenten" ja \
  "$(ja_nein grep -q "^gradlew -p $W/android :app:assembleRelease --console=plain --offline$" "$ARBEIT/log")"
pruefe "Gradle unter UTF-8" "locale C.UTF-8" "$(grep '^locale ' "$ARBEIT/log")"
pruefe "Keystore während des Baus mit Rechten 600" "keystore-rechte 600" "$(grep '^keystore-rechte ' "$ARBEIT/log")"
pruefe "Keystore aus Base64 entpackt" "keystore-inhalt $KEYSTORE_INHALT" "$(grep '^keystore-inhalt ' "$ARBEIT/log")"
pruefe "Passwörter erreichen Gradle" "passwort-da ja" "$(grep '^passwort-da ' "$ARBEIT/log")"
keystore="$(sed -n 's/^keystore-pfad //p' "$ARBEIT/log")"
pruefe "Keystore danach gelöscht" nein "$(ja_nein test -e "$(dirname "$keystore")")"
pruefe "Keystore nie in der Ausgabe" "" "$(ls "$ARBEIT/versand" | grep -v '^lifeline-hub-android-' || true)"
pruefe "Passwort nie im Log" nein "$(ja_nein grep -q "$PASSWORT" "$ARBEIT/aus")"
pruefe "apksigner prüft die APK" ja "$(ja_nein grep -q '^apksigner verify .*app-release.apk$' "$ARBEIT/log")"
pruefe "Fingerabdruck im Log" ja "$(ja_nein grep -q 'certificate SHA-256 digest' "$ARBEIT/aus")"
sha="$(cut -d' ' -f1 "$ARBEIT/versand/lifeline-hub-android-1.2.0-beta.3.apk.sha256")"
pruefe "GITHUB_OUTPUT: sha256" "sha256=$sha" "$(grep '^sha256=' "$ARBEIT/gh-output")"
pruefe "GITHUB_OUTPUT: version_code als Zahl" ja "$(ja_nein grep -qE '^version_code=[0-9]+$' "$ARBEIT/gh-output")"

echo "==> release-apk: ohne sha256sum (macOS)"
# Der PATH dieses Rechners ohne `sha256sum`, wie auf einem Mac ohne GNU coreutils; `shasum` ist
# dort da. Jeder Eintrag wird einzeln nachgebildet, damit Hüllen, die das nächste gleichnamige
# Programm im PATH suchen (etwa ein `rm`-Wächter), es weiter finden.
OHNE_SHA=""
i=0
IFS=: read -ra pfade <<< "$PATH"
for d in "${pfade[@]}"; do
  i=$((i + 1))
  kopie="$ARBEIT/ohne-sha256sum/$i"
  mkdir -p "$kopie"
  for f in "$d"/*; do
    n="${f##*/}"
    if [ "$n" != sha256sum ] && [ -x "$f" ] && [ ! -d "$f" ]; then ln -s "$f" "$kopie/$n"; fi
  done
  OHNE_SHA="${OHNE_SHA:+$OHNE_SHA:}$kopie"
done
if ! command -v shasum > /dev/null 2>&1; then
  # Ohne Perl-`shasum` hier eine Attrappe, die wie auf macOS rechnet.
  printf '#!/usr/bin/env bash\n[ "$1 $2" = "-a 256" ] || exit 2\nshift 2\nexec %q "$@"\n' \
    "$(command -v sha256sum)" > "$ARBEIT/ohne-sha256sum/1/shasum"
  chmod +x "$ARBEIT/ohne-sha256sum/1/shasum"
fi
pruefe "ohne sha256sum: baut" 0 \
  "$(PATH="$OHNE_SHA" laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/mac")"
pruefe "ohne sha256sum: Prüfsumme im Format von sha256sum" \
  "$(cat "$ARBEIT/versand/lifeline-hub-android-1.2.0-beta.3.apk.sha256")" \
  "$(cat "$ARBEIT/mac/lifeline-hub-android-1.2.0-beta.3.apk.sha256" 2> /dev/null || true)"

echo "==> release-apk: rot"
for geheim in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  # Die Ersetzung läuft in einer Subshell: `unset` gilt nur für diesen Lauf.
  rc="$(unset "$geheim"; laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
  pruefe "ohne $geheim: rot" 1 "$rc"
  pruefe "ohne $geheim: Meldung nennt es und die Anleitung" ja \
    "$(ja_nein grep -q "Secrets für die Signatur fehlen: $geheim.*docs/betrieb/android-app.md" "$ARBEIT/aus")"
  pruefe "ohne $geheim: kein Bau" "" "$(cat "$ARBEIT/log")"
done
pruefe "rc-Tag gehört in keinen Kanal" 1 "$(laufe "$W" --tag v1.2.0-rc.1 --ausgabe "$ARBEIT/rot")"
pruefe "Tag ohne v" 1 "$(laufe "$W" --tag 1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "Workspace-Version weicht vom Tag ab: rot" 1 "$(laufe "$W" --tag v1.2.0-beta.4 --ausgabe "$ARBEIT/rot")"
pruefe "… nennt beide Versionen" ja "$(ja_nein grep -q '1.2.0-beta.3 passt nicht zum Tag v1.2.0-beta.4' "$ARBEIT/aus")"
pruefe "… und baut nicht" "" "$(cat "$ARBEIT/log")"
pruefe "kaputtes Base64: rot" 1 \
  "$(ANDROID_KEYSTORE_BASE64='%%%' laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "unsignierte APK: rot" 1 "$(UNSIGNIERT=1 laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "apksigner lehnt ab: rot" 1 "$(SIGNATUR_UNGUELTIG=1 laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "APK mit fremder versionName: rot" 1 "$(APK_VERSION=1.2.0 laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "APK mit fremdem versionCode: rot" 1 "$(APK_CODE=1 laufe "$W" --tag v1.2.0-beta.3 --ausgabe "$ARBEIT/rot")"
pruefe "nach Rot nichts in der Ausgabe" "" "$(ls "$ARBEIT/rot" 2> /dev/null || true)"
pruefe "nach Rot kein Keystore übrig" "" "$(ls -d "$ARBEIT"/android-signatur.* 2> /dev/null || true)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest android/release-apk." >&2
  exit 1
fi
echo "==> OK: Selbsttest android/release-apk."
