#!/usr/bin/env bash
# Selbsttest für scripts/android/version.sh (LLH-1989, Entwurf D4 „Version“).
#
# Ein Fehler fiele erst am Gerät auf: ein `versionCode`, der nicht steigt, installiert Android
# nicht über die vorhandene App, und eine falsche `versionName` meldete die App der Seite und
# dem Updater als eigene Version. Gefahren gegen Wegwerf-Dateien, ohne Netz.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/version.sh"
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

cargo_mit() { # <version> → Pfad einer Cargo.toml mit dieser Workspace-Version
  local datei="$ARBEIT/cargo-$RANDOM.toml"
  printf '[package]\nname = "x"\nversion = "0.0.1"\n\n[workspace.package]\nversion = "%s"\n\n[workspace]\nmembers = ["."]\n' "$1" > "$datei"
  printf '%s\n' "$datei"
}

# Wert eines Schlüssels aus der Ausgabe des letzten Laufs.
wert() { # <schlüssel>
  awk -F= -v k="$1" '$1 == k { print substr($0, length(k) + 2); exit }' "$ARBEIT/aus"
}

laufe() { # [<arg>…] → Exit-Code des Skripts, stdout in $ARBEIT/aus, stderr in $ARBEIT/err
  local rc=0
  "$SKRIPT_UNTER_TEST" "$@" > "$ARBEIT/aus" 2> "$ARBEIT/err" || rc=$?
  printf '%s\n' "$rc"
}

echo "==> android/version.sh: versionCode in Minuten seit 2026-01-01T00:00Z"
fall_code() { # <name> <jetzt> <code>
  pruefe "$1: Exit 0" 0 "$(laufe --cargo "$(cargo_mit 1.0.0)" --jetzt "$2")"
  pruefe "$1: LIFELINE_VERSION_CODE" "$3" "$(wert LIFELINE_VERSION_CODE)"
}
fall_code 'Beginn 2026-01-01T00:00Z' 1767225600 0
fall_code 'eine Minute später' 1767225660 1
fall_code '59 Sekunden später zählt nicht' 1767225659 0
fall_code '2026-11-22T12:34:56Z' 1795350896 468754

echo "==> android/version.sh: Ausgabe"
pruefe "genau zwei Zeilen: Exit 0" 0 "$(laufe --cargo "$(cargo_mit 1.0.0)" --jetzt 1767225660)"
pruefe "genau zwei Zeilen" 'LIFELINE_VERSION=1.0.0|LIFELINE_VERSION_CODE=1' "$(paste -sd'|' "$ARBEIT/aus")"

echo "==> android/version.sh: versionName ist die volle Workspace-Version"
fall_version() { # <name> <workspace-version>
  pruefe "$1: Exit 0" 0 "$(laufe --cargo "$(cargo_mit "$2")" --jetzt 1767225600)"
  pruefe "$1: LIFELINE_VERSION" "$2" "$(wert LIFELINE_VERSION)"
}
fall_version alpha 1.0.0-alpha.195
fall_version beta 1.0.0-beta.3
fall_version stabil 1.2.0
fall_version 'beta mit Punkten im Suffix' 2.10.4-beta.12

echo "==> android/version.sh: ohne --jetzt die Uhr"
vorher=$((($(date -u +%s) - 1767225600) / 60))
pruefe "ohne --jetzt: Exit 0" 0 "$(laufe --cargo "$(cargo_mit 1.0.0)")"
nachher=$((($(date -u +%s) - 1767225600) / 60))
code="$(wert LIFELINE_VERSION_CODE)"
pruefe "ohne --jetzt: Minuten des Laufs" ja \
  "$([ "$code" = "$vorher" ] || [ "$code" = "$nachher" ] && echo ja || echo nein)"

echo "==> android/version.sh: Ablehnungen"
fall_rot() { # <name> [<arg>…]
  local name="$1"
  shift
  local rc
  rc="$(laufe "$@")"
  pruefe "$name: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
  pruefe "$name: keine Ausgabe" '' "$(cat "$ARBEIT/aus")"
  pruefe "$name: Meldung beginnt mit FEHLER" ja "$(grep -q '^FEHLER:' "$ARBEIT/err" && echo ja || echo nein)"
}
fall_rot 'vor 2026-01-01' --cargo "$(cargo_mit 1.0.0)" --jetzt 1767225599
fall_rot '--jetzt keine Zahl' --cargo "$(cargo_mit 1.0.0)" --jetzt morgen
fall_rot '--jetzt leer' --cargo "$(cargo_mit 1.0.0)" --jetzt ''
fall_rot 'Version ohne Patch' --cargo "$(cargo_mit 1.0)" --jetzt 1767225600
fall_rot 'Version mit Build-Metadaten' --cargo "$(cargo_mit 1.0.0+abc)" --jetzt 1767225600
ohne="$ARBEIT/ohne.toml"
printf '[package]\nname = "x"\nversion = "9.9.9"\n' > "$ohne"
fall_rot 'nur [package], kein [workspace.package]' --cargo "$ohne" --jetzt 1767225600
fall_rot 'Cargo.toml fehlt' --cargo "$ARBEIT/gibt-es-nicht.toml" --jetzt 1767225600
fall_rot 'unbekanntes Argument' --cargo "$(cargo_mit 1.0.0)" --build 202611181930

echo "==> android/version.sh: das Repository"
soll="$(awk '/^\[/ { im = ($0 == "[workspace.package]") }
  im && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }' "$WURZEL/Cargo.toml")"
pruefe "Cargo.toml der Wurzel als Vorgabe: Exit 0" 0 "$(laufe --jetzt 1767225600)"
pruefe "Cargo.toml der Wurzel: LIFELINE_VERSION" "$soll" "$(wert LIFELINE_VERSION)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest android/version." >&2
  exit 1
fi
echo "==> OK: Selbsttest android/version."
