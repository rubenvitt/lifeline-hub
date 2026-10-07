#!/usr/bin/env bash
# Netzabhängiger CI-Schritt mit Zeitgrenze je Versuch und Wiederholung (LFH-1101).
#
# Ein hängender Paketspiegel hielt `apt-get update` am 07.10.2026 bis zum Job-Timeout fest
# (Schnellprüfungen: 30 min, dann „The operation was canceled“), auf allen PRs zugleich. apts
# eigene Zeitgrenzen greifen nur, solange GAR NICHTS kommt; ein Spiegel, der tröpfelt, hält sie
# ewig offen. Die Frist hier zählt die Wanduhr. Ein abgebrochener Versuch kostet die Frist, ein
# neuer landet oft auf einem anderen Spiegelknoten, und erst der letzte Fehlschlag macht den
# Schritt rot — mit Grund, nicht als stummer Abbruch durch das Job-Timeout.
#
# `timeout` schickt das Signal an die ganze Prozessgruppe: `sudo`, `mise`, `pnpm` und das
# apt-get darunter enden mit. Wer nach dem Signal noch läuft, bekommt nach 30 s SIGKILL.
#
# AUFRUF:  scripts/wiederholen.sh <versuche> <frist-sek> -- <kommando> [arg …]
# Exit:    0, sobald ein Versuch gelingt; sonst der Exit-Code des letzten Versuchs
#          (124: Frist überschritten); 2 bei falschem Aufruf.
# Pause zwischen den Versuchen: WIEDERHOLEN_PAUSE_SEK (Vorgabe 15; der Selbsttest setzt 0).
set -euo pipefail

if [ $# -lt 4 ] || [ "$3" != "--" ] || ! [[ "$1" =~ ^[1-9][0-9]*$ && "$2" =~ ^[1-9][0-9]*$ ]]; then
  echo "AUFRUF: $0 <versuche> <frist-sek> -- <kommando> [arg …]" >&2
  exit 2
fi
versuche="$1"
frist="$2"
shift 3
pause="${WIEDERHOLEN_PAUSE_SEK:-15}"

for ((n = 1; ; n++)); do
  rc=0
  timeout --kill-after=30 "$frist" "$@" || rc=$?
  [ "$rc" -eq 0 ] && exit 0
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    grund="nach ${frist} s abgebrochen"
  else
    grund="Exit ${rc}"
  fi
  if [ "$n" -ge "$versuche" ]; then
    echo "::error::$* scheiterte auch im ${n}. von ${versuche} Versuchen (${grund})." >&2
    exit "$rc"
  fi
  echo "::warning::Versuch ${n} von ${versuche}: $* ${grund}; nächster in ${pause} s." >&2
  sleep "$pause"
done
