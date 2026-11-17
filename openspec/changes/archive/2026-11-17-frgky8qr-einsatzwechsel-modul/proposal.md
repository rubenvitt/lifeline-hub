# Proposal

## Why

Wer im Kopf von einem Einsatz in einen anderen wechselt, landet immer auf dessen Startseite,
auch wenn er gerade in „Fahrzeuge“ arbeitet und dort weitermachen will. In der Wechselliste
unterscheiden sich gleich benannte Einsätze nur in der Nummer; die Einsatzart fehlt, und ohne
gepflegte Nummer sind sie gar nicht zu unterscheiden. Thema 11 der UI/UX-Analyse vom 12.11.2026
(LLH-1811, LLH-1821).

## What Changes

- Der Einsatzwechsel im Kopf und der Einsatzwechsel der Sprungpalette führen in **dasselbe Modul**
  des Ziel-Einsatzes, auf dessen Startseite. Detail, Auswahl und Filter des alten Einsatzes fallen
  weg.
- Ist das Modul im Ziel nicht freigegeben (Vorlage, Rolle, nicht fertig), öffnet der Ziel-Einsatz
  wie bisher sein Standardmodul, still.
- Die Nebenzeile jedes Eintrags der Wechselliste lautet „Einsatzart · Nummer · Ort“. Bei einer
  Übung entfällt die Art (sie trägt schon die Marke „ÜBUNG“); fehlt jede Nummer, steht dort das
  Beginndatum.
- Die Ankunft im Modul zählt nicht als Wahl für „Zuletzt besucht“.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `seiten-orientierung`: Requirement „Einsatzwechsler zeigt den eigenen Einsatz und keine
  Verwaltung“ — Nebenzeile mit Einsatzart und Ersatz durch das Beginndatum; neues Requirement für
  den Erhalt des Moduls beim Wechsel.
- `navigation-zuletzt-besucht`: Requirement „Ankünfte zeichnen nicht auf“ — der Einsatzwechsel
  kann jetzt im selben Modul ankommen; auch das zeichnet nicht auf.

## Impact

- Frontend: `routing/deeplinks.ts` (Modul-Hinweis an der Index-Route),
  `einsatz/DefaultModulRedirect.tsx`, `einsatz/EinsatzSwitcher.tsx`,
  `command-palette/befehle.ts` (Einsatzwechsel), `einsatz/zuletztModule.ts` (Tabelle der
  Ankünfte, falls dort geführt).
- Tests: Vitest für Wechsler, Weiche und Palette.
- Doku: `docs/anwender/kapitel/einsatz-oberflaeche.md`, „Zwischen Einsätzen wechseln“ (ohne Bild).
- Kein Backend.
