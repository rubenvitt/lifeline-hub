#!/usr/bin/env bash
# Selbsttest für scripts/android/apk-ablegen.sh (LLH-1989, Entwurf D9).
#
# Ein Fehler fiele erst an einem echten Release auf, und dann an jedem Gerät: ein zweiter Bau
# desselben Tags (Handstart, „Re-run all jobs“) hat eine andere Bauminute als `versionCode` und
# damit eine andere `sha256`. Überschriebe er die versionierte APK, zeigten die Kanal-Manifeste
# weiter auf dieselbe Adresse mit der alten Prüfsumme, und jede App verwürfe das Update. Gefahren
# gegen eine Attrappe von `gh`, die Releases als Verzeichnisse hält, ohne Netz.
set -euo pipefail

QUELLE="$(cd "$(dirname "$0")/../.." && pwd)"
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
ja_nein() { if "$@"; then echo ja; else echo nein; fi; }
sha256_von() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# `gh`-Attrappe: ein Release ist ein Verzeichnis unter $GH_RELEASES; `upload` ohne `--clobber`
# scheitert an einer vorhandenen Datei wie das echte `gh`. Jeder Aufruf steht im Log.
mkdir -p "$ARBEIT/bin"
cat > "$ARBEIT/bin/gh" << 'ATTRAPPE'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_LOG"
[ "$1" = release ] || exit 2
befehl="$2" tag="$3"
shift 3
rel="$GH_RELEASES/$tag"
[ "${GH_NETZ_WEG:-0}" = 1 ] && { echo "error connecting to api.github.com" >&2; exit 1; }
[ -d "$rel" ] || { echo "release not found" >&2; exit 1; }
case "$befehl" in
  view)
    [ "$*" = "--json assets --jq .assets[].name" ] || { echo "unerwartet: view $*" >&2; exit 2; }
    ls "$rel"
    ;;
  download)
    [ "$1" = --pattern ] && [ "$3" = --dir ] || { echo "unerwartet: download $*" >&2; exit 2; }
    mkdir -p "$4" && cp "$rel/$2" "$4/"
    ;;
  upload)
    clobber=0
    for a in "$@"; do [ "$a" = --clobber ] && clobber=1; done
    for a in "$@"; do
      [ "$a" = --clobber ] && continue
      n="${a##*/}"
      if [ -e "$rel/$n" ] && [ "$clobber" = 0 ]; then
        echo "HTTP 422: Validation Failed (asset $n already exists)" >&2
        exit 1
      fi
      cp "$a" "$rel/$n"
    done
    ;;
  *) exit 2 ;;
esac
ATTRAPPE
chmod +x "$ARBEIT/bin/gh"

TAG=v1.2.0-beta.3
APK=lifeline-hub-android-1.2.0-beta.3.apk

# Versand wie release-apk.sh ihn hinterlässt: APK und Prüfsumme im Format von sha256sum.
versand_mit() { # <inhalt> → Pfad
  local v="$ARBEIT/versand-$RANDOM"
  mkdir -p "$v"
  printf '%s' "$1" > "$v/$APK"
  printf '%s  %s\n' "$(sha256_von "$v/$APK")" "$APK" > "$v/$APK.sha256"
  printf '%s\n' "$v"
}

# Ein Release mit den Dateien aus <versand> (leer: ohne APK).
release_mit() { # [<versand>] [nur-apk]
  rm -rf "$ARBEIT/releases" && mkdir -p "$ARBEIT/releases/$TAG"
  echo notizen > "$ARBEIT/releases/$TAG/lifeline-hub-x86_64-linux.tar.gz"
  [ -n "${1:-}" ] || return 0
  cp "$1/$APK" "$ARBEIT/releases/$TAG/"
  [ "${2:-}" = nur-apk ] || cp "$1/$APK.sha256" "$ARBEIT/releases/$TAG/"
}

laufe() { # <versand> → Exit-Code; Ausgabe in $ARBEIT/aus, GITHUB_OUTPUT in $ARBEIT/gh-output
  local rc=0
  : > "$ARBEIT/gh-log"
  : > "$ARBEIT/gh-output"
  PATH="$ARBEIT/bin:$PATH" GH_LOG="$ARBEIT/gh-log" GH_RELEASES="$ARBEIT/releases" \
    GITHUB_OUTPUT="$ARBEIT/gh-output" \
    "$QUELLE/scripts/android/apk-ablegen.sh" --tag "$TAG" --versand "$1" > "$ARBEIT/aus" 2>&1 || rc=$?
  printf '%s\n' "$rc"
}

ERSTER="$(versand_mit "apk-bau-1")"
ZWEITER="$(versand_mit "apk-bau-2")"

echo "==> apk-ablegen: erstes Mal"
release_mit
pruefe "legt ab" 0 "$(laufe "$ERSTER")"
pruefe "GITHUB_OUTPUT: abgelegt=ja" "abgelegt=ja" "$(cat "$ARBEIT/gh-output")"
pruefe "APK am Release" "apk-bau-1" "$(cat "$ARBEIT/releases/$TAG/$APK")"
pruefe "Prüfsumme am Release" "$(cat "$ERSTER/$APK.sha256")" "$(cat "$ARBEIT/releases/$TAG/$APK.sha256")"
pruefe "die APK nie mit --clobber" nein "$(ja_nein grep -q "upload .*$APK .*--clobber\|upload .*--clobber.*$APK\$" "$ARBEIT/gh-log")"
pruefe "die APK vor ihrer Prüfsumme" "$APK $APK.sha256" \
  "$(sed -n 's/^gh release upload [^ ]* \([^ ]*\).*/\1/p' "$ARBEIT/gh-log" | sed 's#.*/##' | tr '\n' ' ' | sed 's/ $//')"

echo "==> apk-ablegen: zweiter Bau desselben Tags"
release_mit "$ERSTER"
pruefe "ein anderer Bau ist kein Fehler" 0 "$(laufe "$ZWEITER")"
pruefe "GITHUB_OUTPUT: abgelegt=nein" "abgelegt=nein" "$(cat "$ARBEIT/gh-output")"
pruefe "die APK am Release bleibt die erste" "apk-bau-1" "$(cat "$ARBEIT/releases/$TAG/$APK")"
pruefe "die Prüfsumme am Release bleibt die erste" "$(cat "$ERSTER/$APK.sha256")" "$(cat "$ARBEIT/releases/$TAG/$APK.sha256")"
pruefe "nichts hochgeladen" "" "$(grep '^gh release upload' "$ARBEIT/gh-log" || true)"
pruefe "Hinweis im Lauf" ja "$(ja_nein grep -q "^::notice::.*$APK liegt schon am Release $TAG" "$ARBEIT/aus")"

echo "==> apk-ablegen: derselbe Bau noch einmal (Re-run nach halbem Lauf)"
release_mit "$ERSTER"
pruefe "derselbe Bau legt nicht neu ab" 0 "$(laufe "$ERSTER")"
pruefe "GITHUB_OUTPUT: abgelegt=ja (Kanäle dürfen fortschreiben)" "abgelegt=ja" "$(cat "$ARBEIT/gh-output")"
pruefe "nichts hochgeladen" "" "$(grep '^gh release upload' "$ARBEIT/gh-log" || true)"

echo "==> apk-ablegen: APK ohne Prüfsumme am Release (halber Upload)"
release_mit "$ERSTER" nur-apk
pruefe "unklarer Stand ist kein Fehler" 0 "$(laufe "$ERSTER")"
pruefe "GITHUB_OUTPUT: abgelegt=nein" "abgelegt=nein" "$(cat "$ARBEIT/gh-output")"
pruefe "nichts hochgeladen" "" "$(grep '^gh release upload' "$ARBEIT/gh-log" || true)"

echo "==> apk-ablegen: rot"
release_mit
kaputt="$(versand_mit "apk-bau-3")"
printf '%s  %s\n' "$(printf '0%.0s' $(seq 64))" "$APK" > "$kaputt/$APK.sha256"
pruefe "Prüfsumme passt nicht zur APK: rot" 1 "$(laufe "$kaputt")"
pruefe "… und lädt nichts hoch" "" "$(grep '^gh release upload' "$ARBEIT/gh-log" || true)"
rm "$kaputt/$APK.sha256"
pruefe "ohne Prüfsumme: rot" 1 "$(laufe "$kaputt")"
pruefe "Netzfehler beim Lesen des Release: rot, nicht „leer“" 1 "$(GH_NETZ_WEG=1 laufe "$ERSTER")"
pruefe "… und kein abgelegt" "" "$(cat "$ARBEIT/gh-output")"
rm -rf "$ARBEIT/releases"
pruefe "Release fehlt: rot" 1 "$(laufe "$ERSTER")"
release_mit
pruefe "Tag ohne v: rot" 1 "$(PATH="$ARBEIT/bin:$PATH" GH_LOG="$ARBEIT/gh-log" GH_RELEASES="$ARBEIT/releases" \
  "$QUELLE/scripts/android/apk-ablegen.sh" --tag 1.2.0-beta.3 --versand "$ERSTER" > /dev/null 2>&1; echo $?)"

if [ "$fehler" -gt 0 ]; then
  echo "==> FEHLER: $fehler Fall/Fälle im Selbsttest android/apk-ablegen." >&2
  exit 1
fi
echo "==> OK: Selbsttest android/apk-ablegen."
