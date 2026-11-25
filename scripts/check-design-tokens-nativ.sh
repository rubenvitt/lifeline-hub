#!/usr/bin/env bash
# Native Design-Tokens der Helfer-Apps (Helfer-App, Schritt 21 von check-all.sh): erzeugt
# `Tokens.swift` und `Tokens.kt` aus docs/design/design-system/project/tokens.json neu
# (scripts/design/tokens-nativ.mjs) und vergleicht sie Byte für Byte mit dem Stand im Repo.
# Rot, wenn eine Datei fehlt oder abweicht: dann `mise exec -- node scripts/design/tokens-nativ.mjs`
# laufen lassen und beide Dateien mitcommitten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATEIEN=(
  ios/HelferKern/Sources/HelferKern/Tokens.swift
  android/helferkern/src/main/kotlin/dev/rubeen/lifeline/helferkern/Tokens.kt
)

# Das Verzeichnis liegt im temporären Ordner des Systems; es wird beim Verlassen entfernt.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mise exec -- node scripts/design/tokens-nativ.mjs --nach "$TMP" > /dev/null

rot=0
for datei in "${DATEIEN[@]}"; do
  if [ ! -f "$datei" ]; then
    echo "FEHLER: $datei fehlt." >&2
    rot=1
  elif ! cmp -s "$TMP/$datei" "$datei"; then
    echo "FEHLER: $datei weicht von tokens.json ab:" >&2
    diff -u "$datei" "$TMP/$datei" | head -40 >&2 || true
    rot=1
  else
    echo "ok   $datei"
  fi
done

if [ "$rot" -ne 0 ]; then
  echo "Abhilfe: mise exec -- node scripts/design/tokens-nativ.mjs, dann beide Dateien mitcommitten." >&2
  exit 1
fi
