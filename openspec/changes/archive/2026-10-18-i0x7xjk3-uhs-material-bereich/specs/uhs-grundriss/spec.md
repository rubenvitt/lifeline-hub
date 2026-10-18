## ADDED Requirements

### Requirement: Die UHS-Seite gliedert sich in Bereiche

Die Detailseite einer UHS SHALL direkt unter dem Seitenkopf eine Bereichsleiste mit „Belegung“,
„Material“, „Kräfte“, „Bewegungen“ und „Dateien“ tragen. „Belegung“ (der Grundriss) MUST die
Vorgabe sein. Jeder Bereich MUST dieselbe Fläche bis zur Fensterhöhe einnehmen, statt unter einem
anderen zu hängen. Der gewählte Bereich MUST in der Adresse stehen, damit ein Link ihn direkt
öffnet. Bei 1440 × 900 und 1280 × 800 MUST jeder Bereich ohne Bildlauf erreichbar sein.

#### Scenario: Material ohne Bildlauf
- **WHEN** die Detailseite der UHS „Turnhalle“ bei 1440 × 900 geöffnet wird
- **THEN** steht die Bereichsleiste über dem Grundriss, und „Material“ ist ohne Bildlauf wählbar

#### Scenario: Direkter Link
- **WHEN** die Detailseite mit `?bereich=material` geöffnet wird
- **THEN** ist der Bereich „Material“ gewählt

#### Scenario: Kopfzahl springt
- **WHEN** jemand im Kopf der UHS auf „3 Posten · 1 Ausfall“ tippt
- **THEN** ist der Bereich „Material“ gewählt
