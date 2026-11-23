#!/usr/bin/env bash
# JDK der Android-Hülle auf einem GitHub-Runner wählen (LLH-1989): `ubuntu-latest` bringt mehrere
# Temurin-JDKs mit und nennt sie in `JAVA_HOME_<major>_X64`. Gewählt wird die Hauptversion aus
# scripts/android/sdk-version.sh; fehlt sie auf dem Runner, endet der Schritt rot statt still mit
# dem Vorgabe-JDK weiterzubauen.
#
#   scripts/android/jdk-waehlen.sh   (in einem Workflow-Schritt; schreibt nach $GITHUB_ENV und
#                                     $GITHUB_PATH, die folgenden Schritte sehen das JDK)
#
# Keine Action (`actions/setup-java`): eine Action außerhalb der Freigabeliste ließe den ganzen
# aufrufenden Workflow nicht starten, und `suiten.yml` hängt an `ci.yml`, `android.yml` an
# `artefakte.yml` (startup_failure an PR #1483, Kopf des Jobs `ios` in suiten.yml).
set -euo pipefail

WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"

fehler() { echo "FEHLER: $*" >&2; exit 1; }

[ -n "${GITHUB_ENV:-}" ] && [ -n "${GITHUB_PATH:-}" ] \
  || fehler "GITHUB_ENV und GITHUB_PATH fehlen; das Skript gehört in einen Workflow-Schritt."
werte="$("$WURZEL/scripts/android/sdk-version.sh")"
eval "$werte"

variable="JAVA_HOME_${ANDROID_JDK}_X64"
jdk="${!variable:-}"
[ -n "$jdk" ] || fehler "$variable fehlt auf dem Runner: JDK $ANDROID_JDK ist nicht vorinstalliert (scripts/android/sdk-version.sh)."
[ -x "$jdk/bin/java" ] || fehler "$variable zeigt auf $jdk, dort fehlt bin/java."

echo "JAVA_HOME=$jdk" >> "$GITHUB_ENV"
echo "$jdk/bin" >> "$GITHUB_PATH"
"$jdk/bin/java" -version
