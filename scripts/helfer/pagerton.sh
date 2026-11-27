#!/usr/bin/env bash
# Erzeugt den Pagerton der Helfer-App neu (LLH-2157) und legt ihn für Android und iOS ab.
# Braucht python3 und ffmpeg. Aufruf: scripts/helfer/pagerton.sh
set -euo pipefail
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
python3 "$WURZEL/scripts/helfer/pagerton.py" "$tmp/pagerton.wav"
mkdir -p "$WURZEL/android/helfer/src/main/res/raw"
cp "$tmp/pagerton.wav" "$WURZEL/android/helfer/src/main/res/raw/pagerton.wav"
ffmpeg -loglevel error -y -i "$tmp/pagerton.wav" -c:a pcm_s16le -bitexact "$WURZEL/ios/Helfer/App/Pagerton.caf"
echo "Pagerton abgelegt: android/helfer/src/main/res/raw/pagerton.wav, ios/Helfer/App/Pagerton.caf"
