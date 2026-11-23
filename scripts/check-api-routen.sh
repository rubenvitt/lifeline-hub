#!/usr/bin/env bash
# API-Routen sind englisch, nach Glossar (LLH-1979, ADR-0085, Wurzel-`AGENTS.md`,
# „Bezeichner-Sprache“). Herleitung:
# `docs/superpowers/specs/2026-11-22-demuxo3r-api-routen-englisch-design.md`.
#
# Gelesen werden die registrierten Pfade:
#   - `src/app.rs`: `.route("/api…"` irgendwo in der Zeile (auch `router.route(…)`) und Zeilen,
#     die mit `"/api…"` beginnen (die mehrzeilige Form), bis zur ersten Zeile `#[cfg(test)]`;
#   - `src/public_api/**/*.rs`: `path = "/api…"` (utoipa);
#   - `src/**/*.rs`: Konstanten `…_PFAD: &str = "/api…"`.
# Jedes feste Segment (nicht `{…}`) wird im Glossar `scripts/api-routen-woerter.tsv`
# nachgeschlagen (Spalten `segment<TAB>deutsch`).
#
# Rot ist:
#   - ein registrierter Pfad mit einem Segment außerhalb des Glossars, der nicht im Bestand
#     `scripts/api-routen-bestand.txt` steht;
#   - ein Bestandseintrag, der nicht mehr registriert ist oder nur noch Glossar-Segmente hat
#     (veraltet: Zeile löschen; so schrumpft der Bestand mit jedem Paket);
#   - ein Bestand mit mehr Zeilen als an der Merge-Base mit der Basis (Vorgabe `origin/alpha`)
#     oder mit einer neuen Zeile, die keine weggefallene übersetzt (gleich viele Segmente, jedes
#     abweichende steht im Glossar): der Bestand wächst nicht. So darf sich eine Zeile ändern,
#     wenn ein Paket Segmente unter einem Präfix übersetzt, das erst ein späteres umstellt
#     (`/api/einsaetze/{id}/…`, LLH-2060). Merge-Base statt Spitze, damit ein Paket, das auf der
#     Basis schon Zeilen gestrichen hat, einen älteren Branch nicht rot macht. Ohne den Ref
#     (flacher Checkout, so im Bündel `schnell` der CI) laut übersprungen; durchgesetzt wird der
#     Vergleich im Workflow `migrationen.yml`, der die Basis holt. Trägt die Merge-Base die Datei
#     noch nicht, entfällt er;
#   - ein Glossar, das nicht nach `segment` sortiert ist, ein Segment oder einen deutschen
#     Begriff doppelt führt (`-` darf mehrfach stehen) oder ein Segment außerhalb von
#     `[a-z0-9]+([.-][a-z0-9]+)*` hat. Leerzeilen und Zeilen mit `#` sind Kommentar.
#
# Grenze: Eine Route, deren Pfad weder als Literal noch als `…_PFAD`-Konstante steht (etwa aus
# `format!`), sieht der Wächter nicht. `src/app.rs` hat heute keine.
#
# Abhilfe: das Segment englisch benennen und, falls neu, mit dem deutschen Begriff ins Glossar
# eintragen. Nach einem Umbenennungspaket den Bestand neu schreiben:
#   scripts/check-api-routen.sh --bestand > scripts/api-routen-bestand.txt
#
# Aufruf: scripts/check-api-routen.sh [<repo-wurzel>] [--bestand] [--basis <ref>]
#         (Selbsttest: *.test.sh daneben)
set -euo pipefail
export LC_ALL=C

modus=pruefen
ROOT=""
BASIS="origin/alpha"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --bestand) modus=bestand ;;
    --basis)
      BASIS="${2:?--basis braucht einen Ref}"
      shift
      ;;
    *) ROOT="$1" ;;
  esac
  shift
done
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
GLOSSAR="$ROOT/scripts/api-routen-woerter.tsv"
BESTAND_REL="scripts/api-routen-bestand.txt"
BESTAND="$ROOT/$BESTAND_REL"

registrierte_pfade() {
  {
    awk '
      /^[[:space:]]*#\[cfg\(test\)\]/ { exit }
      match($0, /\.route\([[:space:]]*"\/api[^"]*"/) || match($0, /^[[:space:]]*"\/api[^"]*"/) {
        s = substr($0, RSTART, RLENGTH)
        sub(/^[^"]*"/, "", s)
        sub(/"$/, "", s)
        print s
      }
    ' "$ROOT/src/app.rs"
    if [ -d "$ROOT/src/public_api" ]; then
      grep -rhoE 'path = "/api[^"]*"' --include='*.rs' "$ROOT/src/public_api" || true
    fi
    grep -rhoE '_PFAD: &str = "/api[^"]*"' --include='*.rs' "$ROOT/src" || true
  } | sed -E 's/^[^"]*"(\/api[^"]*)"$/\1/' | sort -u
}

glossar_zeilen() { # Glossar ohne Kommentare und Leerzeilen
  awk '!/^[[:space:]]*(#|$)/' "$GLOSSAR"
}

# Pfade mit mindestens einem Segment außerhalb des Glossars, je Zeile `<pfad><TAB><segment>`.
unbekannte_segmente() {
  registrierte_pfade | awk -F'\t' -v glossar="$1" '
    BEGIN {
      while ((getline zeile < glossar) > 0) {
        if (zeile ~ /^[[:space:]]*(#|$)/) continue
        split(zeile, f, "\t")
        bekannt[f[1]] = 1
      }
    }
    {
      n = split($0, seg, "/")
      for (i = 1; i <= n; i++) {
        if (seg[i] == "" || seg[i] ~ /^\{.*\}$/) continue
        if (!(seg[i] in bekannt)) print $0 "\t" seg[i]
      }
    }
  '
}

if [ "$modus" = bestand ]; then
  unbekannte_segmente "$GLOSSAR" | cut -f1 | sort -u
  exit 0
fi

fehler=0
melde() {
  echo "check-api-routen: $*" >&2
  fehler=$((fehler + 1))
}

# 1. Das Glossar selbst.
glossar_befunde="$(glossar_zeilen | awk -F'\t' -v q="'" '
  NF != 2 { print "Glossarzeile ohne genau zwei Spalten: " $0; next }
  $1 !~ /^[a-z0-9]+([.-][a-z0-9]+)*$/ { print "Segment " q "" $1 "" q " ist nicht klein, mit - oder . verbunden" }
  vorher != "" && $1 <= vorher { print "Glossar nicht nach segment sortiert oder doppelt: " q "" $1 "" q " nach " q "" vorher "" q "" }
  { vorher = $1 }
  $2 != "-" && ($2 in deutsch) { print "deutscher Begriff " q "" $2 "" q " doppelt: " deutsch[$2] " und " $1 }
  $2 != "-" { deutsch[$2] = $1 }
')"
if [ -n "$glossar_befunde" ]; then
  while IFS= read -r z; do melde "$z"; done <<< "$glossar_befunde"
fi

# 2. Registrierte Pfade gegen Glossar und Bestand.
unbekannt="$(unbekannte_segmente "$GLOSSAR")"
deutsch_pfade="$(printf '%s\n' "$unbekannt" | cut -f1 | awk 'NF' | sort -u)"
bestand="$(awk 'NF' "$BESTAND" 2> /dev/null | sort -u || true)"

# Mengenvergleich mit `comm`, nicht je Zeile `grep -q`: unter `pipefail` zählte ein `grep -q`,
# das die Pipe vor dem Ende schließt, als Fehlschlag (SIGPIPE beim `printf`).
ohne_bestand="$(comm -23 <(printf '%s\n' "$deutsch_pfade" | awk 'NF') <(printf '%s\n' "$bestand" | awk 'NF'))"
if [ -n "$ohne_bestand" ]; then
  while IFS="$(printf '\t')" read -r pfad seg; do
    melde "$pfad: Segment '$seg' steht nicht im Glossar (scripts/api-routen-woerter.tsv)." \
      "Englisch benennen und den Begriff eintragen (ADR-0085)."
  done <<< "$(printf '%s\n' "$unbekannt" | awk -F'\t' 'NR == FNR { neu[$0] = 1; next } ($1 in neu)' \
    <(printf '%s\n' "$ohne_bestand") -)"
fi

veraltet="$(comm -13 <(printf '%s\n' "$deutsch_pfade" | awk 'NF') <(printf '%s\n' "$bestand" | awk 'NF'))"
if [ -n "$veraltet" ]; then
  while IFS= read -r pfad; do
    melde "$pfad: Bestandseintrag veraltet (nicht registriert oder schon englisch);" \
      "Zeile aus $BESTAND_REL löschen."
  done <<< "$veraltet"
fi

# 3. Der Bestand wächst nicht gegenüber der Merge-Base mit der Basis.
if git -C "$ROOT" rev-parse --verify --quiet "$BASIS^{commit}" > /dev/null; then
  merge_base="$(git -C "$ROOT" merge-base HEAD "$BASIS")"
  if alt="$(git -C "$ROOT" show "$merge_base:$BESTAND_REL" 2> /dev/null)"; then
    alt="$(printf '%s\n' "$alt" | awk 'NF' | sort -u)"
    alt_n="$(printf '%s\n' "$alt" | awk 'NF' | wc -l | tr -d ' ')"
    neu_n="$(printf '%s\n' "$bestand" | awk 'NF' | wc -l | tr -d ' ')"
    neu_zeilen="$(comm -13 <(printf '%s\n' "$alt") <(printf '%s\n' "$bestand" | awk 'NF'))"
    # a) Die Zahl der Zeilen wächst nicht. Eine Zeile darf sich ändern: Ein Paket übersetzt
    #    Segmente unter einem Präfix, das erst ein späteres Paket umstellt (LLH-2060).
    if [ "$neu_n" -gt "$alt_n" ]; then
      while IFS= read -r pfad; do
        melde "$pfad: neu im Bestand gegenüber $BASIS (Merge-Base), der Bestand wächst" \
          "($neu_n statt $alt_n Zeilen); er darf nur schrumpfen (ADR-0085). Die Route englisch benennen."
      done <<< "$neu_zeilen"
    fi
    # b) Jede neue Zeile übersetzt eine weggefallene: gleich viele Segmente, und wo sie sich
    #    unterscheiden, steht das neue Segment im Glossar (`{…}` gilt als gleich). So kommt
    #    weder ein deutsches Wort noch eine neue deutsche Route hinzu, auch nicht aus Wörtern,
    #    die der Bestand schon kennt, während eine andere Zeile wegfällt. Die Zahl hält a).
    if [ -n "$neu_zeilen" ]; then
      weg_zeilen="$(comm -23 <(printf '%s\n' "$alt") <(printf '%s\n' "$bestand" | awk 'NF'))"
      ohne_vorbild="$(printf '%s\n' "$neu_zeilen" | awk -v glossar="$GLOSSAR" -v wegdatei=<(printf '%s\n' "$weg_zeilen") '
        function feste(s) { return s ~ /^\{.*\}$/ ? "{}" : s }
        BEGIN {
          while ((getline zeile < glossar) > 0) {
            if (zeile ~ /^[[:space:]]*(#|$)/) continue
            split(zeile, f, "\t")
            bekannt[f[1]] = 1
          }
          w = 0
          while ((getline zeile < wegdatei) > 0) if (zeile != "") weg[++w] = zeile
        }
        NF {
          n = split($0, neu, "/")
          gefunden = 0
          for (j = 1; j <= w && !gefunden; j++) {
            if (split(weg[j], vor, "/") != n) continue
            passt = 1
            for (i = 1; i <= n && passt; i++) {
              if (feste(neu[i]) != feste(vor[i]) && !(neu[i] in bekannt)) passt = 0
            }
            if (passt) gefunden = 1
          }
          if (!gefunden) print $0
        }
      ')"
      if [ -n "$ohne_vorbild" ]; then
        while IFS= read -r pfad; do
          melde "$pfad: neu im Bestand gegenüber $BASIS (Merge-Base) und keine Übersetzung einer" \
            "weggefallenen Zeile; der Bestand darf nur schrumpfen (ADR-0085). Die Route englisch benennen."
        done <<< "$ohne_vorbild"
      fi
    fi
  fi
else
  echo "check-api-routen: Bestandsvergleich übersprungen: $BASIS fehlt."
fi

if [ "$fehler" -gt 0 ]; then
  echo "FEHLER: $fehler Befund(e) zu englischen API-Routen (ADR-0085)." >&2
  exit 1
fi
echo "OK: $(registrierte_pfade | wc -l | tr -d ' ') API-Routen geprüft, $(printf '%s\n' "$bestand" | awk 'NF' | wc -l | tr -d ' ') im deutschen Bestand."
