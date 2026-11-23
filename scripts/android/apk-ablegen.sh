#!/usr/bin/env bash
# Die versionierte APK ans Release hängen, nie überschreiben (LLH-1989, Entwurf D9). Aufgerufen
# von `.github/workflows/android.yml` (Job `ablegen`).
#
#   scripts/android/apk-ablegen.sh --tag <vX.Y.Z[-alpha.N|-beta.N]> --versand <verzeichnis>
#
# Erwartet in <versand> `lifeline-hub-android-<version>.apk` und `.sha256` aus release-apk.sh und
# `gh` mit GH_TOKEN und GH_REPO. Schreibt `abgelegt=ja` oder `abgelegt=nein` nach GITHUB_OUTPUT
# (ohne GITHUB_OUTPUT auf stdout); nur bei `ja` schreibt der Lauf danach die Kanäle fort.
#
# NIE ÜBERSCHREIBEN: `versionCode` ist die Bauminute (scripts/android/version.sh), ein zweiter Bau
# desselben Tags (Handstart, „Re-run all jobs“, ein Handstart neben dem automatischen Lauf) ergibt
# also eine andere Datei mit anderer `sha256`. Die Kanal-Manifeste, die schon auf die Adresse der
# versionierten APK zeigen, behielten aber die alte Prüfsumme (gleiche Version ist „nicht neuer“),
# und jede App verwürfe das Update bis zum nächsten Release. Liegt die APK schon am Release:
#
# - mit derselben Prüfsumme (`.sha256` am Release gleich): derselbe Bau, etwa „Re-run failed jobs“
#   nach halbem Lauf. Nichts wird hochgeladen, `abgelegt=ja`: die Kanäle zeigen damit auf genau
#   diese Datei.
# - sonst (anderer Bau, oder die Prüfsumme fehlt am Release): ein Hinweis, `abgelegt=nein`; Upload,
#   Manifest und Kanäle bleiben für diesen Lauf aus. Eine kaputte Datei am Release ersetzt nur,
#   wer sie von Hand löscht (docs/betrieb/android-app.md).
#
# Die APK geht ohne `--clobber` hoch: kommt ein paralleler Lauf zwischen Prüfung und Upload
# zuvor, scheitert dieser Lauf, statt dessen Datei zu ersetzen. Selbsttest: apk-ablegen.test.sh.
set -euo pipefail

TAG=""
VERSAND=""

fehler() { echo "FEHLER: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) [ $# -ge 2 ] || fehler "--tag braucht einen Tag."; TAG="$2"; shift 2 ;;
    --versand) [ $# -ge 2 ] || fehler "--versand braucht ein Verzeichnis."; VERSAND="$2"; shift 2 ;;
    -h | --help) sed -n '2,26p' "$0"; exit 0 ;;
    *) fehler "unbekanntes Argument '$1' (erlaubt: --tag, --versand)." ;;
  esac
done

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta)\.[0-9]+)?$ ]] \
  || fehler "'$TAG' ist kein Tag der Kanäle alpha, beta oder main."
[ -n "$VERSAND" ] || fehler "--versand fehlt."
APK="lifeline-hub-android-${TAG#v}.apk"

ausgabe() { # <wert>
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "abgelegt=$1" >> "$GITHUB_OUTPUT"; else echo "abgelegt=$1"; fi
}

# Auf macOS fehlt `sha256sum`; `shasum -a 256` rechnet dasselbe.
sha256_von() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

[ -f "$VERSAND/$APK" ] || fehler "$VERSAND/$APK fehlt."
[ -f "$VERSAND/$APK.sha256" ] || fehler "$VERSAND/$APK.sha256 fehlt."
SHA256="$(sha256_von "$VERSAND/$APK")"
[ "$(cut -d' ' -f1 "$VERSAND/$APK.sha256")" = "$SHA256" ] \
  || fehler "$APK.sha256 passt nicht zur APK (sha256 $SHA256)."

# Kein `|| true`: ein Netzfehler hieße sonst „noch nichts da“, und der Lauf lüde hoch.
namen="$(gh release view "$TAG" --json assets --jq '.assets[].name')"
if grep -qxF "$APK" <<< "$namen"; then
  am_release=""
  if grep -qxF "$APK.sha256" <<< "$namen"; then
    alt="$(mktemp -d)"
    trap 'rm -rf "$alt"' EXIT
    gh release download "$TAG" --pattern "$APK.sha256" --dir "$alt"
    am_release="$(cut -d' ' -f1 "$alt/$APK.sha256")"
  fi
  if [ "$am_release" = "$SHA256" ]; then
    echo "::notice::$APK liegt schon am Release $TAG, derselbe Bau (sha256 $SHA256); nichts neu hochgeladen."
    ausgabe ja
    exit 0
  fi
  echo "::notice::$APK liegt schon am Release $TAG (sha256 ${am_release:-unbekannt}), dieser Bau hat $SHA256. Die versionierte APK wird nie überschrieben; Upload, Manifest und Kanäle bleiben für diesen Lauf aus."
  ausgabe nein
  exit 0
fi

gh release upload "$TAG" "$VERSAND/$APK"
# Die APK dieses Laufs liegt jetzt am Release, ihre Prüfsumme gehört dazu (auch gegen einen Rest).
gh release upload "$TAG" "$VERSAND/$APK.sha256" --clobber
echo "::notice::$APK liegt am Release $TAG (sha256 $SHA256)."
ausgabe ja
