#!/usr/bin/env bash
# Selbsttest für scripts/android/sdk-version.sh (LLH-1989, Entwurf D10): die CI installiert die
# Plattform aus dem Skript, Gradle übersetzt gegen `compileSdk` aus android/app/build.gradle.kts.
# Laufen beide auseinander, scheitert der App-Bau erst auf dem Runner (fehlende Plattform) oder
# lädt AGP still eine andere nach. Ohne Netz, ohne SDK.
set -euo pipefail

HIER="$(cd "$(dirname "$0")" && pwd)"
WURZEL="$(cd "$HIER/../.." && pwd)"
GRADLE="$WURZEL/android/app/build.gradle.kts"
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

aus="$("$HIER/sdk-version.sh")"
wert() { awk -F= -v k="$1" '$1 == k { print substr($0, length(k) + 2); exit }' <<< "$aus"; }

pruefe "drei Werte, sonst nichts" "ANDROID_BUILD_TOOLS ANDROID_JDK ANDROID_PLATTFORM" \
  "$(cut -d= -f1 <<< "$aus" | sort | tr '\n' ' ' | sed 's/ $//')"
pruefe "JDK ist eine Hauptversion ab 17" "ja" \
  "$( [[ "$(wert ANDROID_JDK)" =~ ^[0-9]+$ ]] && [ "$(wert ANDROID_JDK)" -ge 17 ] && echo ja || echo nein)"
pruefe "Build-Tools als MAJOR.MINOR.PATCH" "ja" \
  "$( [[ "$(wert ANDROID_BUILD_TOOLS)" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && echo ja || echo nein)"
pruefe "eval setzt die Variablen" "$(wert ANDROID_PLATTFORM)" \
  "$(eval "$aus"; printf '%s' "$ANDROID_PLATTFORM")"

# `compileSdk { version = release(37) { minorApiLevel = 1 } }` → android-37.1, ohne Nebenstufe
# `release(36)` → android-36.
gradle_plattform="$(sed -n 's/.*version = release(\([0-9]*\))\( { minorApiLevel = \([0-9]*\) }\)\{0,1\}.*/android-\1.\3/p' "$GRADLE" | sed 's/\.$//')"
pruefe "Plattform passt zu compileSdk in android/app/build.gradle.kts" "$(wert ANDROID_PLATTFORM)" "$gradle_plattform"

pruefe "unbekanntes Argument bricht ab" "1" "$("$HIER/sdk-version.sh" --quatsch > /dev/null 2>&1 && echo 0 || echo $?)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest android/sdk-version." >&2
  exit 1
fi
echo "==> OK: Selbsttest android/sdk-version."
