# Proposal

## Why

Die Lagekarte und das Meldebild zeichnen taktische Zeichen über `taktische-zeichen-react@0.10.0`.
Das Paket ist auf npm als veraltet markiert und gehört einem fremden Projekt. Die eigene Bibliothek
`@einsatzzeichen` steht seit 2.1.0 (29.09.2026) so weit, dass sie alle Zeichen komponiert, die der
Hub selbst an Fachobjekte vergibt. Das ist der erste Schnitt von LFH-505 (ClickUp LFH-835). Die
freien Zeichen und ihr Picker folgen in Schnitt 2 (LFH-836), sobald die Bibliothek ihre Lücken
schließt (LFH-829 bis LFH-834).

## What Changes

- Die Zeichen der Fachobjekte werden mit `@einsatzzeichen/core` 2.1 gezeichnet. Das gilt für
  Einheit, Fahrzeug, Führungskraft, Einsatzabschnitt, Einsatzort, Schaden, Unfallhilfsstelle und
  Betreuungsstelle, und zwar auf der Karte, in der Symbolkachel des Inspectors und in der Spalte
  „TZ“ des Meldebilds.
- Das fachliche Vokabular des Hubs bleibt unverändert: die gespeicherten Werte `tz_fachaufgabe`,
  `tz_organisation`, der Organisations-Vorgabewert und die Ableitung aus Fahrzeugtyp und Funktion.
  Ein Adapter übersetzt es beim Lesen in eine Zeichenbeschreibung der neuen Bibliothek. Es gibt
  keine Datenmigration.
- Diese fachlichen Abbildungen sind entschieden (29.09.2026):
  - Eine Führungskraft trägt keine Fachaufgabe.
  - Unfallhilfsstelle und Betreuungsstelle werden als Stelle der Hilfsorganisation gezeichnet.
  - Die Schadensfarbe wird auf die Farbpalette der Bibliothek gerundet.
  - Der Einsatzabschnitt ist neutral, also Führung/Leitung ohne eingebackenes Kürzel.
  - Ein Krad wird zum Landfahrzeug.
- Wenn eine Kombination nicht komponiert, fällt das Zeichen stufenweise zurück bis auf den nackten
  Körper. Es verschwindet nie und bringt keine Seite zum Absturz.
- Die Kartensymbole werden als Rasterbild direkt aus der Zeichnung erzeugt, in der Schärfe des
  Bildschirms. Sie laufen nicht mehr über ein SVG-Bild.
- Die freien taktischen Zeichen bleiben unverändert auf dem Altpaket. Das Altpaket wird deshalb
  in diesem Schnitt noch nicht entfernt.

## Capabilities

### New Capabilities
- `lagekarte-taktische-zeichen`: Darstellung der Fachobjekt-Zeichen auf der Lagekarte, im
  Inspector und im Meldebild. Das umfasst die fachliche Abbildung je Objekttyp, die Lesbarkeit
  gespeicherter Werte ohne Migration, den definierten Rückfall und die Kartenschärfe.

### Modified Capabilities
<!-- keine: `betreuung-lagekarte` fordert „Stelle/Betreuung“, das bleibt erfüllt;
     `lagekarte-zeichenwahl` (freie Zeichen) ändert sich in diesem Schnitt nicht. -->

## Impact

- **Frontend:** `pages/lagekarte/taktischesZeichen.ts`, `marker.ts`, `markerIcons.ts`,
  `markerLayer.ts`, `Kartenflaeche.tsx` und `Inspector.tsx`; `kraefte/EinheitZeichen.tsx`;
  neues Modul `frontend/src/zeichen/` für Adapter, Zeichnen und Komponente.
- **Abhängigkeiten:** neu `@einsatzzeichen/core`, `schema`, `react` und `maplibre`, alle exakt
  3.0.0 (Planung auf 2.1.0, vor dem Merge nachgezogen). `taktische-zeichen-react` bleibt bis
  LFH-836. `@einsatzzeichen/catalog` (deprecated) und `conformance` (nur Node) kommen nicht hinein.
- **Bundle:** Die Lagekarte und die Kräfteübersicht, beide Lazy-Routen, bekommen einen
  gemeinsamen Chunk von etwa 146 kB gzip dazu. Dieser Chunk wird vorgehalten (Precache). Eine
  Schrift ist nicht nötig, weil keines der Fachobjekt-Zeichen Text zeichnet.
- **Backend:** keine Änderung. `ERLAUBTE_ORG` und die Spalten `tz_*` bleiben, die Schwärzung
  ist nicht betroffen.
- **Optik:** Die Zeichen sehen nach der neuen Bibliothek aus (BABZ 2025). Das zeigt sich etwa an
  der Polizeifarbe, an der Stelle als kleiner Kreis (F.3) und daran, dass das Fahrwerk am Kfz
  sichtbar wird. Der Dunkelmodus bleibt wie heute (schwarz auf dunklem Grund); gelöst wird er in
  der Bibliothek (LFH-833).
