#!/usr/bin/env bash
# Architekturdokumentation bleibt vollständig und ihre Entscheidungen gelten (LLH-1435).
# Regeln und Form: docs/architektur/AGENTS.md.
#
# Rot ist:
#   - ein fehlendes oder doppeltes arc42-Kapitel `docs/architektur/NN-*.md` (01 bis 12);
#   - ein Modul unter `src/` (Verzeichnis oder `*.rs`), ein Verzeichnis unter `frontend/src/`,
#     ein Crate unter `crates/` oder ein Teilprojekt (`src-tauri`, `karten-service`,
#     `karten-build`, `website`), das Kapitel 5 nicht als Pfad nennt — die Bausteinsicht
#     veraltet sonst still, sobald jemand ein Modul anlegt;
#   - eine ADR (`entscheidungen/ADR-*.md`) mit falschem Kopf (Pflichtschlüssel, `id` passend
#     zum Dateinamen und eindeutig, bekannter `status`, `ersetzt_durch` bei `ersetzt`), ohne
#     Pflichtabschnitte, ohne MUST-/SHOULD-Regel, ohne Prüfung, über 80 Zeilen, oder mit einem
#     `gilt_fuer`-Muster, das keine versionierte Datei trifft;
#   - eine akzeptierte ADR, deren Prüfblock scheitert — die Entscheidung gilt im Code nicht mehr:
#     Code zurückführen oder die Abkehr als neue ADR festhalten;
#   - eine ADR, die Kapitel 9 nicht nennt;
#   - ein relativer Link in `docs/architektur/`, der nicht auflöst.
#
# Geprüft werden versionierte und neue, nicht ignorierte Dateien (wie check-schreibweisen.sh).
#
# Aufruf: scripts/check-architektur.sh [<repo-wurzel>]   (Selbsttest: *.test.sh daneben)
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(cd "$SKRIPTE/.." && pwd)}"
ROOT="$(cd "$ROOT" && pwd)"
# shellcheck source=lib/adr.sh
. "$SKRIPTE/lib/adr.sh"

DOKU="$ROOT/docs/architektur"
fehler=0
melde() { echo "FEHLER: $*" >&2; fehler=$((fehler + 1)); }

if [ ! -d "$DOKU" ]; then
  echo "FEHLER: $DOKU fehlt." >&2
  exit 1
fi

dateien="$(git -C "$ROOT" -c core.quotePath=false ls-files --cached --others --exclude-standard)"

# ── Kapitel ─────────────────────────────────────────────────────────────────────────
for nr in 01 02 03 04 05 06 07 08 09 10 11 12; do
  anzahl="$(find "$DOKU" -maxdepth 1 -name "$nr-*.md" | wc -l | tr -d ' ')"
  [ "$anzahl" = 1 ] || melde "docs/architektur/$nr-*.md: $anzahl Dateien, erwartet genau eine (arc42-Kapitel $nr)."
done

# ── Bausteinsicht vollständig ───────────────────────────────────────────────────────
kap5="$(find "$DOKU" -maxdepth 1 -name '05-*.md' | head -1)"
if [ -n "$kap5" ]; then
  # Erwartete Pfade: Module direkt unter src/, Verzeichnisse direkt unter frontend/src/,
  # Crates, Teilprojekte.
  erwartet="$(printf '%s\n' "$dateien" | awk -F/ '
    $1 == "src" && NF == 2 && $2 ~ /\.rs$/ { print "src/" $2 }
    $1 == "src" && NF > 2 { print "src/" $2 }
    $1 == "frontend" && $2 == "src" && NF > 3 { print "frontend/src/" $3 }
    $1 == "crates" && NF > 2 { print "crates/" $2 }
    ($1 == "src-tauri" || $1 == "karten-service" || $1 == "karten-build" || $1 == "website") && NF > 1 { print $1 }
  ' | sort -u)"
  while IFS= read -r pfad; do
    [ -n "$pfad" ] || continue
    # Grenzen: davor kein Pfadzeichen (sonst träfe `frontend/src/etb` auch `src/etb`), danach
    # kein Namenszeichen (sonst träfe `src/etb_baustein` auch `src/etb`).
    muster="$(printf '%s' "$pfad" | sed 's/[.[\*^$]/\\&/g')"
    if ! grep -qE "(^|[^A-Za-z0-9_./-])$muster([^A-Za-z0-9_-]|$)" "$kap5"; then
      melde "${kap5#"$ROOT"/} nennt \`$pfad\` nicht. Neuer oder umbenannter Baustein: eine Zeile in die Bausteinsicht (docs/architektur/AGENTS.md, Mitänderungsregel)."
    fi
  done <<< "$erwartet"
fi

# ── Entscheidungen ──────────────────────────────────────────────────────────────────
kap9="$(find "$DOKU" -maxdepth 1 -name '09-*.md' | head -1)"
ids=""
gefahren=0
manuell=0
for adr in "$DOKU"/entscheidungen/ADR-*.md; do
  [ -e "$adr" ] || continue
  rel="${adr#"$ROOT"/}"
  name="$(basename "$adr" .md)"
  soll_id="$(printf '%s' "$name" | cut -d- -f1-2)"
  if ! head -1 "$adr" | grep -qx -- '---'; then
    melde "$rel: Kopf fehlt (erste Zeile '---')."
    continue
  fi
  for k in id titel status datum; do
    [ -n "$(adr_kopf_wert "$adr" "$k")" ] || melde "$rel: Kopfschlüssel '$k' fehlt oder ist leer."
  done
  id="$(adr_kopf_wert "$adr" id)"
  [ "$id" = "$soll_id" ] || melde "$rel: id '$id' passt nicht zum Dateinamen ($soll_id)."
  case " $ids " in *" $id "*) melde "$rel: id '$id' ist doppelt vergeben." ;; esac
  ids="$ids $id"
  status="$(adr_kopf_wert "$adr" status)"
  case "$status" in
    vorgeschlagen | akzeptiert | verworfen) ;;
    ersetzt)
      durch="$(adr_kopf_wert "$adr" ersetzt_durch)"
      if [ -z "$durch" ] || ! compgen -G "$DOKU/entscheidungen/$durch-*.md" > /dev/null; then
        melde "$rel: status 'ersetzt' braucht ersetzt_durch mit einer bestehenden ADR (ist: '$durch')."
      fi
      ;;
    *) melde "$rel: status '$status' unbekannt (vorgeschlagen, akzeptiert, ersetzt, verworfen)." ;;
  esac
  muster_liste="$(adr_kopf_liste "$adr" gilt_fuer)"
  if [ -z "$muster_liste" ]; then
    melde "$rel: gilt_fuer fehlt oder ist leer."
  else
    while IFS= read -r m; do
      if [ -z "$(git -C "$ROOT" ls-files --cached --others --exclude-standard -- ":(glob)$m" | head -1)" ]; then
        melde "$rel: gilt_fuer '$m' trifft keine Datei (verschoben? Pfad nachziehen)."
      fi
    done <<< "$muster_liste"
  fi
  for abschnitt in '## Regeln' '## Prüfung' '## Kontext' '## Konsequenzen'; do
    grep -qx -- "$abschnitt" "$adr" || melde "$rel: Abschnitt '$abschnitt' fehlt."
  done
  if ! awk '/^## / { a = $0; next } a == "## Regeln" && /^- \**(MUST|SHOULD)/ { f = 1 } END { exit !f }' "$adr"; then
    melde "$rel: '## Regeln' hat keine Zeile '- MUST …', '- MUST NOT …' oder '- SHOULD …'."
  fi
  zeilen="$(wc -l < "$adr" | tr -d ' ')"
  [ "$zeilen" -le 80 ] || melde "$rel: $zeilen Zeilen, höchstens 80 (Begründung in die Herleitung)."
  block="$(adr_pruefung "$adr")"
  if [ -z "$block" ]; then
    if [ -n "$(adr_manuell "$adr")" ]; then
      manuell=$((manuell + 1))
    else
      melde "$rel: '## Prüfung' braucht einen \`\`\`sh-Block oder eine Zeile 'manuell: <warum>'."
    fi
  elif [ "$status" = akzeptiert ]; then
    gefahren=$((gefahren + 1))
    if ! ausgabe="$(cd "$ROOT" && bash -euo pipefail -c "$ADR_PRUEF_HILFEN$block" 2>&1)"; then
      melde "$rel: Prüfung scheitert — die Entscheidung gilt im Code nicht mehr. Code zurückführen oder die Abkehr als neue ADR festhalten."
      printf '%s\n' "$ausgabe" | head -20 | sed 's/^/         /' >&2
    fi
  fi
  if [ -n "$kap9" ] && [ -n "$id" ] && ! grep -qF -- "$id" "$kap9"; then
    melde "${kap9#"$ROOT"/} nennt $id nicht."
  fi
done

# ── Relative Links ──────────────────────────────────────────────────────────────────
while IFS= read -r md; do
  [ -n "$md" ] || continue
  verz="$(dirname "$ROOT/$md")"
  # Codeblöcke auslassen: dort stehen Beispiele, keine Links.
  ziele="$(awk '/^```/ { code = !code; next } !code' "$ROOT/$md" | grep -oE '\]\([^) ]+\)' | sed -E 's/^\]\(//; s/\)$//' || true)"
  while IFS= read -r ziel; do
    [ -n "$ziel" ] || continue
    case "$ziel" in http://* | https://* | mailto:* | '#'*) continue ;; esac
    pfad="${ziel%%#*}"
    [ -e "$verz/$pfad" ] || melde "$md: Link '$ziel' löst nicht auf."
  done <<< "$ziele"
done <<< "$(printf '%s\n' "$dateien" | grep -E '^docs/architektur/.*\.md$' || true)"

if [ "$fehler" -gt 0 ]; then
  echo "Architekturdoku: $fehler Fehler (Regeln: docs/architektur/AGENTS.md)." >&2
  exit 1
fi
echo "OK: Architekturdoku vollständig; $gefahren ADR-Prüfungen grün, $manuell manuell."
