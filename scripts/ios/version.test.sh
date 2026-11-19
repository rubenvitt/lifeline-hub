#!/usr/bin/env bash
# Selbsttest für scripts/ios/version.sh (LLH-1978, Spec `ios-auslieferung`, „Die Version der App
# kommt aus dem Workspace“).
#
# Ein Fehler fiele erst bei Apple auf: eine Marketing-Version mit Vorab-Suffix lehnt der Upload
# ab, eine falsche volle Version meldete die App der Seite als `version`, und eine Build-Nummer,
# die nicht steigt, nimmt TestFlight nicht an. Gefahren gegen Wegwerf-Dateien, ohne Netz.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/version.sh"
WURZEL="$(cd "$(dirname "$0")/../.." && pwd)"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0
unset IOS_BUILD_NUMMER

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
  printf '[package]\nname = "x"\nversion.workspace = true\n\n[workspace.package]\nversion = "%s"\n\n[workspace]\nmembers = ["."]\n' "$1" > "$datei"
  printf '%s\n' "$datei"
}

# Wert eines Schlüssels aus dem erzeugten xcconfig.
wert() { # <datei> <schlüssel>
  awk -v k="$2" '$1 == k && $2 == "=" { print $3; exit }' "$1"
}

laufe() { # <cargo> <ausgabe> [<arg>…] → Exit-Code des Skripts, Ausgabe in $ARBEIT/log
  local cargo="$1" ausgabe="$2"
  shift 2
  local rc=0
  "$SKRIPT_UNTER_TEST" --cargo "$cargo" --ausgabe "$ausgabe" "$@" > "$ARBEIT/log" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

echo "==> ios/version.sh: Kanäle"
fall_kanal() { # <name> <workspace-version> <marketing>
  local x="$ARBEIT/$1.xcconfig"
  pruefe "$1: Exit 0" 0 "$(laufe "$(cargo_mit "$2")" "$x" --build 202611181930)"
  pruefe "$1: Marketing-Version ohne Vorab-Suffix" "$3" "$(wert "$x" MARKETING_VERSION)"
  pruefe "$1: LifelineVersion voll" "$2" "$(wert "$x" LIFELINE_VERSION)"
  pruefe "$1: Build-Nummer wie übergeben" 202611181930 "$(wert "$x" CURRENT_PROJECT_VERSION)"
}
fall_kanal alpha 1.0.0-alpha.195 1.0.0
fall_kanal beta 1.0.0-beta.3 1.0.0
fall_kanal stabil 1.2.0 1.2.0
fall_kanal 'beta mit Punkten im Suffix' 2.10.4-beta.12 2.10.4

echo "==> ios/version.sh: Build-Nummer"
x="$ARBEIT/env.xcconfig"
rc="$(IOS_BUILD_NUMMER=202701020304 laufe "$(cargo_mit 1.0.0)" "$x")"
pruefe "IOS_BUILD_NUMMER: Exit 0" 0 "$rc"
pruefe "IOS_BUILD_NUMMER gilt" 202701020304 "$(wert "$x" CURRENT_PROJECT_VERSION)"
rc="$(IOS_BUILD_NUMMER=202701020304 laufe "$(cargo_mit 1.0.0)" "$x" --build 202801020304)"
pruefe "--build schlägt IOS_BUILD_NUMMER" 202801020304 "$(wert "$x" CURRENT_PROJECT_VERSION)"

x="$ARBEIT/uhr.xcconfig"
vorher="$(date -u +%Y%m%d%H%M)"
pruefe "ohne Vorgabe: Exit 0" 0 "$(laufe "$(cargo_mit 1.0.0)" "$x")"
nachher="$(date -u +%Y%m%d%H%M)"
nummer="$(wert "$x" CURRENT_PROJECT_VERSION)"
pruefe "ohne Vorgabe: zwölf Ziffern" ja "$([[ "$nummer" =~ ^[0-9]{12}$ ]] && echo ja || echo nein)"
pruefe "ohne Vorgabe: UTC-Zeitstempel des Laufs" ja \
  "$([ "$nummer" = "$vorher" ] || [ "$nummer" = "$nachher" ] && echo ja || echo nein)"

echo "==> ios/version.sh: Ablehnungen"
fall_rot() { # <name> <cargo> [<arg>…]
  local name="$1" cargo="$2" x="$ARBEIT/rot.xcconfig"
  shift 2
  rm -f "$x"
  local rc
  rc="$(laufe "$cargo" "$x" "$@")"
  pruefe "$name: Exit ≠ 0" ja "$([ "$rc" != 0 ] && echo ja || echo nein)"
  pruefe "$name: keine Datei" nein "$([ -e "$x" ] && echo ja || echo nein)"
  pruefe "$name: Meldung beginnt mit FEHLER" ja "$(grep -q '^FEHLER:' "$ARBEIT/log" && echo ja || echo nein)"
}
fall_rot 'Build-Nummer zu kurz' "$(cargo_mit 1.0.0)" --build 2026111819
fall_rot 'Build-Nummer keine Zahl' "$(cargo_mit 1.0.0)" --build 2026-11-18T1
fall_rot 'Build-Nummer leer' "$(cargo_mit 1.0.0)" --build ''
IOS_BUILD_NUMMER=morgen fall_rot 'IOS_BUILD_NUMMER ungültig' "$(cargo_mit 1.0.0)"
fall_rot 'Version ohne Patch' "$(cargo_mit 1.0)"
fall_rot 'Version mit Build-Metadaten' "$(cargo_mit 1.0.0+abc)"
ohne="$ARBEIT/ohne.toml"
printf '[package]\nname = "x"\nversion = "9.9.9"\n' > "$ohne"
fall_rot 'nur [package], kein [workspace.package]' "$ohne"
fall_rot 'Cargo.toml fehlt' "$ARBEIT/gibt-es-nicht.toml"
fall_rot 'unbekanntes Argument' "$(cargo_mit 1.0.0)" --version 1.0.0

echo "==> ios/version.sh: das Repository"
x="$ARBEIT/repo.xcconfig"
soll="$(awk '/^\[/ { im = ($0 == "[workspace.package]") }
  im && /^version[[:space:]]*=/ { gsub(/^version[[:space:]]*=[[:space:]]*"|".*$/, ""); print; exit }' "$WURZEL/Cargo.toml")"
pruefe "Cargo.toml der Wurzel: Exit 0" 0 "$(laufe "$WURZEL/Cargo.toml" "$x" --build 202611181930)"
pruefe "Cargo.toml der Wurzel: LifelineVersion" "$soll" "$(wert "$x" LIFELINE_VERSION)"
pruefe "Cargo.toml der Wurzel: Marketing-Version" "${soll%%-*}" "$(wert "$x" MARKETING_VERSION)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest ios/version." >&2
  exit 1
fi
echo "==> OK: Selbsttest ios/version."
