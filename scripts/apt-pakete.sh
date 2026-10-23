#!/usr/bin/env bash
# Systempakete für die CI-Jobs, ohne am Paketspiegel bis zum Job-Timeout zu hängen (LFH-1101).
#
# `apt-get update` und `install` laufen als EIN Versuch unter `scripts/wiederholen.sh`: ein
# abgebrochenes `update` hinterlässt halbe Listen, also beginnt jeder Versuch von vorn. Ein
# Abbruch mitten in dpkg hinterließe halb konfigurierte Pakete; `dpkg --configure -a` räumt
# das vor dem nächsten Versuch auf und ist sonst ein Nichts.
#
# Die Schleife samt `timeout` läuft UNTER `sudo`, nicht darüber (LLH-1420). Darüber traf das
# Signal der Frist nur `sudo`: Ubuntus sudo legt den Befehl in eine eigene Sitzung (`use_pty`)
# und reicht ein Signal aus der eigenen Prozessgruppe nicht weiter. SIGKILL beendete dann `sudo`,
# das verwaiste apt-get lud weiter und hielt den dpkg-Lock; Versuch 2 und 3 scheiterten sofort.
# `DPkg::Lock::Timeout` wartet zusätzlich auf einen Lock, den noch jemand hält.
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
apt_optionen='-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=120'

# `sudo` setzt die Umgebung zurück: die Pause zwischen den Versuchen ausdrücklich mitgeben.
exec sudo env "WIEDERHOLEN_PAUSE_SEK=${WIEDERHOLEN_PAUSE_SEK:-15}" \
  "$(dirname "$0")/wiederholen.sh" "${APT_VERSUCHE:-3}" "${APT_FRIST_SEK:-300}" -- \
  sh -c "dpkg --configure -a \
    && apt-get $apt_optionen update \
    && apt-get $apt_optionen install --no-install-recommends -y \"\$@\"" apt-pakete "$@"
