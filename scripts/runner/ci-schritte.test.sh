#!/usr/bin/env bash
# Wächter für `.github/workflows/e2e.yml` (LLH-1666, Spec `ci-eigener-runner`, ADR-0025): In den
# Jobs, die auf dem eigenen Runner laufen können (`binaer`, `e2e`), trägt jeder Schritt, der
# `sudo`, apt oder einen Cache nur der gehosteten Runner braucht, die Bedingung
# `runner.environment == 'github-hosted'`.
#
# Ohne ihn fiel genau das nicht auf: die Bedingung landete am gleichnamigen Schritt eines anderen
# Jobs, der auf dem Server `sudo` gerufen hätte. Rot wäre erst der erste echte Lauf geworden, und
# die übersprungenen e2e-Shards hätten jeden PR gesperrt.
#
# Zweite Prüfung: Die Caches für Browser und .deb-Pakete (`ms-playwright`, `apt-playwright`) tragen
# die Systemversion im Schlüssel (`steps.betriebssystem.outputs.kennung`). Playwright legt den
# WebKit-Build jeder Ubuntu-Version unter demselben Verzeichnis ab; mit `runner.os` allein bekam das
# Image ubuntu-26.04 den Build für 24.04, und WebKit startete in keinem Shard (Lauf 43535205929).
#
#   ci-schritte.test.sh [workflow-datei]    Vorgabe: .github/workflows/e2e.yml (seit LLH-1662
#                                           stehen `binaer` und `e2e` dort, nicht in ci.yml)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATEI="${1:-$ROOT/.github/workflows/e2e.yml}"
JOBS="binaer e2e"
# Was nur auf einem gehosteten Runner geht oder nur dort Sinn hat.
GEHOSTET='sudo |apt-pakete\.sh|install-deps|apt-get|Swatinem/rust-cache|ms-playwright|apt-playwright|AGENT_TOOLSDIRECTORY'
BEDINGUNG="runner.environment == 'github-hosted'"

# Zerlegt die Datei in Schritte: Job-Name, Kopfzeile und ganzer Block je Schritt, getrennt durch
# ein Steuerzeichen. Jobs stehen mit zwei Leerzeichen Einzug, Schritte mit sechs und `- `.
# Kommentarzeilen zählen nicht: sie stehen vor dem Schritt, den sie meinen, also im Block davor.
schritte() {
  awk -v jobs=" $JOBS " '
    function ausgeben() { if (block != "" && index(jobs, " " job " ")) printf "%s\037%s\036", job, block; block = "" }
    /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { ausgeben(); job = $1; sub(":", "", job); next }
    /^[^ #]/ { ausgeben(); job = ""; next }
    /^      - / { ausgeben(); block = $0 "\n"; next }
    /^[[:space:]]*#/ { next }
    block != "" { block = block $0 "\n" }
    END { ausgeben() }
  ' "$DATEI"
}

# Caches, deren Inhalt zu genau einer Ubuntu-Version gehört: ein `actions/cache`-Schritt, der einen
# der beiden Pfade nennt, gleich in welcher Schreibweise von `path:`.
SYSTEMCACHE='~/\.cache/(ms|apt)-playwright'
SYSTEMKENNUNG='steps.betriebssystem.outputs.kennung'
# Der Schritt, der die Kennung schreibt. Fehlt er, steht er hinter den Caches oder heißt anders,
# setzt GitHub für den Ausdruck still einen leeren Text ein, und alle Versionen teilen den Eintrag.
KENNUNGSSCHRITT='id: betriebssystem'

fehler=0
geprueft=0
ms_caches=0
apt_caches=0
kennung_job=""
while IFS=$'\037' read -r -d $'\036' job block; do
  if grep -Eq "$GEHOSTET" <<< "$block"; then
    geprueft=$((geprueft + 1))
    kopf="$(sed -n '1s/^ *- //p' <<< "$block")"
    if grep -qF "$BEDINGUNG" <<< "$block"; then
      echo "ok   $job: $kopf"
    else
      echo "ROT  $job: $kopf — braucht \`if: … $BEDINGUNG\`" >&2
      fehler=1
    fi
  fi
  if grep -qF "$KENNUNGSSCHRITT" <<< "$block" && grep -qF 'kennung=' <<< "$block"; then
    kennung_job="$job"
  fi
  if grep -q 'actions/cache' <<< "$block" && grep -Eq "$SYSTEMCACHE" <<< "$block"; then
    grep -q 'ms-playwright' <<< "$block" && ms_caches=$((ms_caches + 1))
    grep -q 'apt-playwright' <<< "$block" && apt_caches=$((apt_caches + 1))
    kopf="$(sed -n '1s/^ *- //p' <<< "$block")"
    if [ "$kennung_job" != "$job" ]; then
      echo "ROT  $job: $kopf — kein Schritt mit \`$KENNUNGSSCHRITT\` (schreibt \`kennung=\`) davor im selben Job" >&2
      fehler=1
    fi
    while IFS= read -r zeile; do
      case "$zeile" in
        *cache-primary-key*) ;;
        *"$SYSTEMKENNUNG"*) ;;
        *)
          echo "ROT  $job: $kopf — Schlüssel ohne Systemversion: ${zeile#"${zeile%%[![:space:]]*}"}" >&2
          fehler=1
          ;;
      esac
    done < <(grep -E '^[[:space:]]+(key|restore-keys):' <<< "$block")
  fi
done < <(schritte)

# Ein Wächter, der nichts findet, prüft nichts: in beiden Jobs gibt es solche Schritte.
if [ "$geprueft" -lt 5 ]; then
  echo "ROT  nur $geprueft betroffene Schritte gefunden — passt die Zerlegung noch zu $(basename "$DATEI")?" >&2
  fehler=1
fi
# Beide Caches stehen im Job `e2e`; findet die Prüfung einen nicht, prüft sie ihn nicht.
if [ "$ms_caches" -lt 1 ] || [ "$apt_caches" -lt 1 ]; then
  echo "ROT  Caches gefunden: ms-playwright $ms_caches, apt-playwright $apt_caches — passt das Muster noch zu $(basename "$DATEI")?" >&2
  fehler=1
fi
exit "$fehler"
