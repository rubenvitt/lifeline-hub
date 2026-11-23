#!/usr/bin/env bash
# SDK-Plattform und Build-Tools für den App-Bau nachinstallieren (LLH-1989, Entwurf D10). Die
# Versionen stehen in scripts/android/sdk-version.sh; GitHubs `ubuntu-latest` bringt das SDK samt
# `sdkmanager` mit, aber nicht jede Plattform. Aufgerufen von `android-pruefung.yml` und
# `android.yml`; lokal genauso.
#
#   scripts/android/sdk-installieren.sh
#
# Braucht ANDROID_HOME und ein JDK für `sdkmanager`. Was schon da ist, lädt es nicht. Der
# Download hat eine Frist je Versuch und drei Versuche (scripts/wiederholen.sh, LFH-1101).
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

[ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || fehler "ANDROID_HOME zeigt auf kein Android-SDK."
werte="$("$WURZEL/scripts/android/sdk-version.sh")"
eval "$werte"

pakete=()
[ -f "$ANDROID_HOME/platforms/$ANDROID_PLATTFORM/android.jar" ] || pakete+=("platforms;$ANDROID_PLATTFORM")
[ -x "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS/apksigner" ] || pakete+=("build-tools;$ANDROID_BUILD_TOOLS")
if [ "${#pakete[@]}" -eq 0 ]; then
  echo "SDK vollständig: $ANDROID_PLATTFORM, Build-Tools $ANDROID_BUILD_TOOLS."
  exit 0
fi

sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
[ -x "$sdkmanager" ] || sdkmanager="$(command -v sdkmanager || true)"
[ -n "$sdkmanager" ] || fehler "sdkmanager fehlt (weder unter \$ANDROID_HOME/cmdline-tools/latest noch im PATH)."

echo "==> SDK nachinstallieren: ${pakete[*]}"
# `yes` bestätigt die Lizenzen; in `sh -c` ohne pipefail, sonst zählte sein SIGPIPE als Fehler.
"$WURZEL/scripts/wiederholen.sh" 3 600 -- sh -c 'yes | "$0" --install "$@" > /dev/null' "$sdkmanager" "${pakete[@]}"
[ -f "$ANDROID_HOME/platforms/$ANDROID_PLATTFORM/android.jar" ] || fehler "Plattform $ANDROID_PLATTFORM fehlt nach der Installation."
[ -x "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS/apksigner" ] || fehler "Build-Tools $ANDROID_BUILD_TOOLS fehlen nach der Installation."
echo "SDK vollständig: $ANDROID_PLATTFORM, Build-Tools $ANDROID_BUILD_TOOLS."
