#!/usr/bin/env bash
# Systempakete für die CI-Jobs, ohne am Paketspiegel bis zum Job-Timeout zu hängen (LFH-1101).
#
# `apt-get update` und `install` laufen als EIN Versuch unter `scripts/wiederholen.sh`: ein
# abgebrochenes `update` hinterlässt halbe Listen, also beginnt jeder Versuch von vorn. Ein
# Abbruch mitten in dpkg hinterließe halb konfigurierte Pakete; `dpkg --configure -a` räumt
# das vor dem nächsten Versuch auf und ist sonst ein Nichts.
#
# AUFRUF:  scripts/apt-pakete.sh <paket> [paket …]
# Versuche und Frist: APT_VERSUCHE (Vorgabe 3), APT_FRIST_SEK (Vorgabe 300). Ein gesunder
# Spiegel braucht für nasm unter 30 s, für die GTK-/WebKit-Pakete der Rust-Suite rund eine Minute.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "AUFRUF: $0 <paket> [paket …]" >&2
  exit 2
fi

# Kommt pro Verbindung gar nichts mehr, bricht apt selbst nach 30 s ab und versucht die Datei
# erneut; die Wanduhr-Frist darüber fängt den tröpfelnden Spiegel.
apt_optionen='-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30'

# `sudo` steht VOR `wiederholen.sh`, nicht dahinter: als Nutzer erreicht `timeout` den
# root-Prozess apt-get nicht, und sudo reicht ein Signal aus der Prozessgruppe seines Befehls
# nicht weiter. So lief ein abgebrochenes apt-get am 23.10.2026
# weiter, hielt die dpkg-Sperre, und die Versuche 2 und 3 scheiterten sofort daran (LLH-1434).
# Als root beendet `timeout` apt-get selbst. `env` reicht die Pause durch das `env_reset` von sudo.
exec sudo env WIEDERHOLEN_PAUSE_SEK="${WIEDERHOLEN_PAUSE_SEK:-15}" \
  "$(dirname "$0")/wiederholen.sh" "${APT_VERSUCHE:-3}" "${APT_FRIST_SEK:-300}" -- \
  sh -c "dpkg --configure -a \
    && apt-get $apt_optionen update \
    && apt-get $apt_optionen install --no-install-recommends -y \"\$@\"" apt-pakete "$@"
