#!/usr/bin/env bash
# Keine Namen, die sich nur in der Groß-/Kleinschreibung unterscheiden (LFH-1053, Spec
# `dateinamen-schreibweise`).
#
# Herkunft (LFH-1050): `stab/medienlageUebernahme.ts` lag neben `stab/MedienlageUebernahme.tsx`.
# Auf macOS und Windows, deren Dateisysteme die Schreibung nicht unterscheiden, löst
# `./MedienlageUebernahme` auf die `.ts`-Datei auf; `tsc` brach im macOS-Job des Artefakte-Laufs
# mit TS1149 ab. Das Gate läuft in der CI nur unter Linux und sah nichts — alpha.74 bis alpha.78
# erschienen ohne Artefakte, Images und Deployment.
#
# Rot ist, je Verzeichnis verglichen (Datei- und Verzeichnisnamen gleichermaßen):
#   - zwei Einträge, deren ganzer Name ohne Rücksicht auf die Schreibung gleich ist
#     (`README.md`/`readme.md`, `Stab/`/`stab/`, Datei `Src` neben Verzeichnis `src/`);
#   - zwei Modulnamen, oder ein Modulname und ein Verzeichnisname, die ohne Rücksicht auf die
#     Schreibung gleich sind, sich aber in ihr unterscheiden. Modulname = Dateiname ohne
#     `.d.ts`/`.ts`/`.tsx`/`.mts`/`.cts`/`.js`/`.jsx`/`.mjs`/`.cjs`; ein Verzeichnis zählt mit,
#     weil `./lagekarte` auf macOS sonst `Lagekarte.tsx` statt `lagekarte/index.ts` fände.
# Grün bleiben `X.tsx` neben `X.test.tsx` (anderer Modulname) und `X.tsx` neben `x.css`
# (Stylesheets werden mit Endung importiert).
#
# Geprüft werden versionierte und neue, nicht ignorierte Dateien (`git ls-files --cached
# --others --exclude-standard`): `node_modules/` und `target/` bleiben ohne eigene
# Ausschlussliste draußen, eine noch nicht hinzugefügte Datei fällt vor dem Commit auf.
# Grenze: `tolower` setzt nur ASCII sicher um; ein Nicht-ASCII-Name fällt höchstens durch,
# er erzeugt keinen Fehlalarm. Das Repo hat heute keinen.
#
# Abhilfe: eine Seite umbenennen (der Modulname folgt am besten dem Export) und die Importe
# anpassen.
#
# Aufruf: scripts/check-schreibweisen.sh [<repo-wurzel>]   (Selbsttest: *.test.sh daneben)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# `core.quotePath=false`: Pfade kommen roh, nicht als C-String in Anführungszeichen. Eine
# Zeile je Pfad statt `-z`: BSD-awk (macOS) liest keine NUL-getrennten Sätze.
liste="$(git -C "$ROOT" -c core.quotePath=false ls-files --cached --others --exclude-standard)"

kollisionen="$(printf '%s\n' "$liste" | awk '
  function eintrag(eltern, name, art,    voll, schluessel, modul) {
    voll = (eltern == "" ? name : eltern "/" name)
    if ((voll SUBSEP art) in gesehen) return
    gesehen[voll SUBSEP art] = 1
    schluessel = eltern "/" tolower(name)
    merke(schluessel, name, voll)
    if (art == "d") {
      modul = name
    } else if (match(name, /\.(d\.ts|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/)) {
      modul = substr(name, 1, RSTART - 1)
    } else {
      return
    }
    merke("modul:" eltern "/" tolower(modul), modul, voll)
  }
  function merke(schluessel, schreibung, voll) {
    if (!((schluessel SUBSEP schreibung) in schreibungen)) {
      schreibungen[schluessel SUBSEP schreibung] = 1
      anzahl[schluessel]++
    }
    # Erst fragen, dann lesen: schon der Lesezugriff legt das Element an.
    if (schluessel in mitglieder) mitglieder[schluessel] = mitglieder[schluessel] ", " voll
    else mitglieder[schluessel] = voll
  }
  $0 != "" {
    n = split($0, teil, "/")
    eltern = ""
    for (i = 1; i <= n; i++) {
      eintrag(eltern, teil[i], (i < n ? "d" : "f"))
      eltern = (eltern == "" ? teil[i] : eltern "/" teil[i])
    }
  }
  END {
    for (s in anzahl) {
      if (anzahl[s] > 1 && !(mitglieder[s] in gemeldet)) {
        gemeldet[mitglieder[s]] = 1
        print "         " mitglieder[s]
      }
    }
  }
' | sort)"

if [ -n "$kollisionen" ]; then
  echo "FEHLER: Namen, die sich nur in der Groß-/Kleinschreibung unterscheiden." >&2
  echo "       Auf macOS und Windows kollidieren sie (LFH-1050: der macOS-Build des Releases" >&2
  echo "       brach ab). Je Zeile eine Gruppe:" >&2
  printf '%s\n' "$kollisionen" >&2
  echo "       Abhilfe: eine Seite umbenennen (Modulname am besten nach dem Export) und die" >&2
  echo "       Importe anpassen." >&2
  exit 1
fi
echo "OK: keine Namen, die sich nur in der Schreibung unterscheiden."
