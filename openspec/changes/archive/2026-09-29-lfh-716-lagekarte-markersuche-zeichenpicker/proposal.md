# Proposal

## Why

Die Kartenleiste der Lagekarte führt unter „Verortet“ nur UHS und Schäden. Einheiten,
Fahrzeuge, Führung, Abschnitte, Lagemeldungen, taktische Zeichen, Betreuungsstellen und
Betroffene findet man über die Leiste nicht, nur durch Absuchen der Karte. Taktische Zeichen
wählt man über Text-Selects mit 36, 42 und 84 Einträgen. Wer den DV-102-Begriff nicht kennt,
findet das Zeichen nicht. Beides ist der offene Rest aus dem C9-Abgleich (LFH-100, Kommentar
an LFH-344, Punkte 13 und 14); die Bausteine liegen auf dem nie gemergten C9-Branch.

## What Changes

- **Objektsuche statt „Verortet“-Teillisten:** Das Paneel „Verortet“ trägt ein Suchfeld über
  alle wählbaren verorteten Kartenobjekte. Treffer stehen nach Objektart gruppiert, ein Klick
  fliegt die Karte an und wählt das Objekt aus. Leere Gruppen entfallen, und der Leerzustand
  steht genau einmal da.
- **Modulsperren in der Suche:** Betreuungsstellen erscheinen nur bei freiem Modul
  Betreuung, Betroffene nur bei freiem Modul Personen und eingeschalteter Ebene. Ohne Recht
  steht kein Name eines gesperrten Moduls in der Suche.
- **Zeichen-Picker als Bildraster:** Grundzeichen und Symbol werden als Kacheln mit
  gezeichnetem Zeichen und Namen gewählt, jeweils mit Textsuche. Organisation, Fachaufgabe,
  Einheit, Funktion, Farbe und Bezeichnung stehen eingeklappt unter „Details“.
- **„Zuletzt verwendet“:** eine Leiste mit höchstens sechs zuletzt platzierten Zeichen, das
  jüngste vorn, ohne Dubletten. Sie wird beim erfolgreichen Platzieren geschrieben, nicht
  beim Blättern im Picker.
- **Enter platziert:** In der Leiste startet Enter im Picker das Platzieren wie der Knopf
  „Platzieren“.
- **Inspector schreibt entprellt:** Im Inspector eines bestehenden Zeichens führt nicht mehr
  jede Auswahl (jede Pfeiltaste im Raster) zu einem PATCH. Änderungen werden entprellt
  gesendet, das bloße Öffnen schreibt nichts, und eine fremde Änderung am Zeichen wird nicht
  mit dem alten Stand überschrieben.

## Capabilities

### New Capabilities

- `lagekarte-objektsuche`: Suche über die verorteten Objekte der Lagekarte, Gruppierung,
  Anspringen und die Modulsperren für Betreuung und Betroffene.
- `lagekarte-zeichenwahl`: Wahl, Platzieren und Ändern freier taktischer Zeichen:
  Bildraster mit Suche, „zuletzt verwendet“, Enter zum Platzieren und das entprellte
  Schreiben im Inspector.

### Modified Capabilities

(keine; die einzige bestehende Spec `lagekarte-fachebenen` ist nicht betroffen)

## Impact

- Frontend `pages/lagekarte/`: neue Dateien `MarkerSuche.tsx`, `objektsuche.ts`,
  `zuletztVerwendet.ts` samt Tests; Umbau von `FreiesZeichenPicker.tsx`,
  `FreiesZeichenInspector.tsx`, `Sidebar.tsx` (Paneel „Verortet“, Zeichnen-Paneel);
  `useKartenInteraktion.ts` merkt das platzierte Zeichen; `LagekartePage.tsx` reicht die
  Suchquelle durch.
- Kein Backend, keine API, keine Migration. `localStorage`-Schlüssel
  `lfh:lagekarte:zeichen-zuletzt` (neu, persönliche Bedienvorliebe).
- CLAUDE.md: kurzer Absatz zur Suchquelle und zum Inspector-Riegel; Prüfliste
  Einsatztauglichkeit im Change-Verzeichnis.
