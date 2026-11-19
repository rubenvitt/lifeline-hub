#!/usr/bin/env bash
# Selbsttest für scripts/ios/xcodegen-installieren.sh (LLH-1978). Ohne Netz: geprüft wird, dass
# die Pinnung lesbar ist und ein Zip mit falscher Prüfsumme nie installiert wird. Ob die gepinnte
# Prüfsumme zum echten Release passt, zeigt der erste Lauf von `ios-pruefung.yml`.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/xcodegen-installieren.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
unset GITHUB_PATH

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}
ja_nein() { if "$@"; then echo ja; else echo nein; fi; }

echo "==> ios/xcodegen-installieren.sh"
version="$("$SKRIPT_UNTER_TEST" --version)"
pruefe "--version ist MAJOR.MINOR.PATCH" ja "$(ja_nein grep -qxE '[0-9]+\.[0-9]+\.[0-9]+' <<< "$version")"
pruefe "Prüfsumme hat 64 Hex-Zeichen" ja \
  "$(ja_nein grep -qxE 'XCODEGEN_SHA256="[0-9a-f]{64}"' "$SKRIPT_UNTER_TEST")"
pruefe "die Version steht genau einmal (eine Stelle)" 1 \
  "$(grep -cE '^XCODEGEN_VERSION=' "$SKRIPT_UNTER_TEST")"

# Ein Zip mit der Form des echten Releases, aber anderem Inhalt: die Prüfsumme muss es abweisen.
mkdir -p "$ARBEIT/quelle/xcodegen/bin"
printf '#!/bin/sh\necho untergeschoben\n' > "$ARBEIT/quelle/xcodegen/bin/xcodegen"
chmod +x "$ARBEIT/quelle/xcodegen/bin/xcodegen"
(cd "$ARBEIT/quelle" && zip -qr "$ARBEIT/fremd.zip" xcodegen)
rc=0
XCODEGEN_URL="file://$ARBEIT/fremd.zip" GITHUB_PATH="$ARBEIT/pfad" \
  "$SKRIPT_UNTER_TEST" "$ARBEIT/ziel" > "$ARBEIT/log" 2>&1 || rc=$?
pruefe "fremdes Zip: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "fremdes Zip: Meldung zur Prüfsumme" ja "$(ja_nein grep -q 'Prüfsumme' "$ARBEIT/log")"
pruefe "fremdes Zip: nichts entpackt" nein "$([ -e "$ARBEIT/ziel" ] && echo ja || echo nein)"
pruefe "fremdes Zip: nichts im PATH" nein "$([ -e "$ARBEIT/pfad" ] && echo ja || echo nein)"

rc=0
XCODEGEN_URL="file://$ARBEIT/gibt-es-nicht.zip" "$SKRIPT_UNTER_TEST" "$ARBEIT/ziel2" > "$ARBEIT/log" 2>&1 || rc=$?
pruefe "Quelle fehlt: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
pruefe "Quelle fehlt: nichts entpackt" nein "$([ -e "$ARBEIT/ziel2" ] && echo ja || echo nein)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ios/xcodegen-installieren." >&2
  exit 1
fi
echo "==> OK: Selbsttest ios/xcodegen-installieren."
