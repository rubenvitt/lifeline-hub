# Proposal

## Why

Ein neuer Einsatz startet mit einem leeren Überblick, der nur „Abschnitt anlegen“ (führt bloß
auf die Seite, dort ein zweiter Klick) und „Eintrag erfassen“ anbietet. Einsatzort,
Einsatzleiter, Kräfte und die erste Lagefeststellung fragt niemand ab: Im Test stand „EL nicht
erfasst“ bis in den Einsatzbericht, und die Lagekarte meldete „0 verortet“ ohne Hinweis auf den
fehlenden Einsatzort. Thema 11 der UI/UX-Analyse vom 12.11.2026 (LLH-1811, LLH-1815) nennt den
geführten Start einen der größten Hebel.

## What Changes

- Im Überblick eines aktiven Einsatzes steht für Personen mit Schreibrecht ein Paneel
  **„Einsatz starten“** mit fünf Punkten: Einsatzort, Einsatzleiter, Einsatzabschnitte, Kräfte,
  erste Lagefeststellung. Jeder Punkt zeigt erledigt (Haken, beim Einsatzort und Einsatzleiter
  mit dem Wert) oder offen; ein offener Punkt springt direkt in seine Erfassung.
- Das Paneel leitet sich aus vorhandenen Daten ab und **verschwindet**, sobald alle Punkte
  erledigt sind. Zusätzlich kann jede Person es **je Browser ausblenden**.
- Der Einsatzort gilt mit Text als erledigt; fehlt die Koordinate, steht der Zusatz „nicht
  verortet“. Kräfte gelten mit einer Einheit oder einer Einsatzkraft als erledigt; die erste
  Lagefeststellung mit einem ETB-Eintrag vom Typ „Lage“.
- Ein Punkt, dessen Modul für die Person gesperrt ist, steht mit Grund und gilt nicht als offen.
- Die Einsatzdaten nehmen den Sprung zum Paneel „Einsatzort“ und „Eigene Führungsstelle“ an
  (`?paneel=`), und die Leeraktion „Abschnitt anlegen“ im Überblick öffnet die Erfassung direkt.
- Nicht Teil dieser Änderung: der Hinweis auf den fehlenden Einsatzort auf der Lagekarte
  (Folgeaufgabe, entschieden am 17.11.2026).

## Capabilities

### New Capabilities

- `ueberblick-startliste`: Startliste im Überblick eines Einsatzes — Punkte, Regel „erledigt“
  je Punkt, Sprungziele, Sichtbarkeit, Verschwinden und Ausblenden.

### Modified Capabilities

- `lage-verdichtung`: Requirement „Überblick führt, Lagebild zeigt die Lage“ — die Startliste
  gehört zum Überblick und zeigt Haken, keine Kennzahl.

## Impact

- Frontend: `pages/fuehrung/UeberblickPage.tsx`, neuer reiner Kern `pages/fuehrung/startliste.ts`,
  `routing/deeplinks.ts` (`einsatzdatenPfad`), `pages/EinsatzdatenPage.tsx` (Sprungauftrag),
  `offline/geraetRaeumung.ts` (`GERAETESPEICHER`, neuer Speicherort). Kein neuer Baustein: das
  Paneel ist ein `ListenPaneel`.
- Regeln: `frontend/AGENTS.md`, „Dashboard-Baukasten“ und „Rollen der Übersichten“.
- Tests: Vitest für Kern und Seiten, e2e für Erscheinen ohne Layoutsprung und Verschwinden.
- Doku: `docs/anwender/kapitel/ueberblick.md` samt Bildlauf.
- Kein Backend, keine Migration, keine Typänderung.
