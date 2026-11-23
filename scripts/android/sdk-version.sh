#!/usr/bin/env bash
# Werkzeugversionen des App-Baus der Android-Hülle (LLH-1989, Entwurf D10: „Versionen stehen je
# an einer Stelle; die Workflows lesen sie“). Gradle steht im Wrapper, AGP und Kotlin in
# `android/gradle/libs.versions.toml`; JDK, SDK-Plattform und Build-Tools stehen hier.
#
#   scripts/android/sdk-version.sh            → Zeilen KEY=VALUE, etwa für "$GITHUB_ENV"
#   eval "$(scripts/android/sdk-version.sh)"  → dieselben Werte als Variablen
#
#   ANDROID_JDK=<major>          Temurin-JDK des Baus; der Kern (Schritt 20 von check-all.sh)
#                                braucht nur 17+, die App baut und testet mit diesem
#   ANDROID_PLATTFORM=<name>     SDK-Plattform für compileSdk (`sdkmanager "platforms;<name>"`);
#                                muss zu `compileSdk` in android/app/build.gradle.kts passen
#   ANDROID_BUILD_TOOLS=<ver>    Build-Tools (`sdkmanager "build-tools;<ver>"`, `apksigner`)
#
# compileSdk 37.1 statt 36: Compose ab BOM 2026.11 verlangt es (Bericht zu Task 10). Wer einen
# Wert ändert, ändert die Gradle-Datei mit; `sdk-version.test.sh` (Schritt 8) vergleicht.
set -euo pipefail

case "${1:-}" in
  "") ;;
  -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
  *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 1 ;;
esac

echo "ANDROID_JDK=21"
echo "ANDROID_PLATTFORM=android-37.1"
echo "ANDROID_BUILD_TOOLS=36.0.0"
