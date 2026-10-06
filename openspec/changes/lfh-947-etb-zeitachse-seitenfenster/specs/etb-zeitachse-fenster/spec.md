# Spec Delta

## Purpose

Die ETB-Zeitachse hält bei beliebig langem Tagebuch einen begrenzten Ausschnitt im Browser, lädt
in beide Richtungen lückenlos nach und rendert ohne wiederholtes Parsen, damit ein über Tage
offener Tab bei jedem neuen Eintrag gleich wenig Last erzeugt.

## ADDED Requirements

### Requirement: Aufsteigender Cursor der ETB-Liste
`GET /api/einsaetze/{id}/etb` SHALL den Parameter `after_lfd_nr` annehmen. Mit ihm liefert der
Server die bis zu `limit` Einträge mit der kleinsten laufenden Nummer größer als `after_lfd_nr`,
die zum Filter passen, sortiert absteigend nach laufender Nummer wie jede andere Seite.
`before_lfd_nr` und `after_lfd_nr` zusammen MUST mit 422 abgewiesen werden.

#### Scenario: Seite direkt über dem Cursor
- **WHEN** ein Einsatz die Einträge Nr. 1 bis 250 hat und `after_lfd_nr=100&limit=100` abgefragt wird
- **THEN** liefert der Server die Einträge Nr. 200 bis 101 in dieser Reihenfolge

#### Scenario: Cursor am oberen Ende
- **WHEN** ein Einsatz die Einträge Nr. 1 bis 250 hat und `after_lfd_nr=200&limit=100` abgefragt wird
- **THEN** liefert der Server die Einträge Nr. 250 bis 201

#### Scenario: Cursor folgt dem Filter
- **WHEN** `after_lfd_nr` zusammen mit `typ=meldung` abgefragt wird
- **THEN** enthält die Seite nur Meldungen mit größerer laufender Nummer

#### Scenario: Beide Cursor zugleich
- **WHEN** `before_lfd_nr` und `after_lfd_nr` in derselben Abfrage stehen
- **THEN** antwortet der Server mit 422

#### Scenario: Zählungen unberührt
- **WHEN** `GET …/etb/zaehler` oder `GET …/etb/anzahl` mit `after_lfd_nr` abgefragt wird
- **THEN** zählt der Server wie ohne den Parameter

### Requirement: Begrenztes Seitenfenster
Die ETB-Zeitachse SHALL höchstens 5 Seiten zu je 100 Einträgen zugleich halten. Ein Live-Ereignis
oder ein erneutes Öffnen der Seite MUST höchstens so viele ETB-Listenabrufe auslösen, wie Seiten im
Fenster liegen.

#### Scenario: Tief geblättert, dann neuer Eintrag
- **WHEN** die Zeitachse durch einen Sprung 30 Seiten tief geblättert hat und danach ein `etb`-Ereignis eintrifft
- **THEN** löst das Ereignis höchstens 5 ETB-Listenabrufe aus

#### Scenario: Weiter blättern verdrängt das andere Ende
- **WHEN** 5 Seiten geladen sind und „Ältere laden“ eine sechste holt
- **THEN** fällt die neueste Seite aus dem Fenster, und die Zeitachse zeigt 500 Einträge

### Requirement: Neuere laden bis zum neuesten Eintrag
Liegt der neueste Eintrag nicht im Fenster, SHALL die Zeitachse über den Zeilen den Knopf „Neuere
laden“ zeigen. Er lädt die Seite direkt über dem jüngsten Eintrag des Fensters, ohne Lücke. Liegt
der neueste Eintrag im Fenster, MUST der Knopf fehlen.

#### Scenario: Zurück nach oben
- **WHEN** das Fenster 20 Seiten unter dem neuesten Eintrag liegt und „Neuere laden“ wiederholt gewählt wird
- **THEN** erscheinen die Einträge lückenlos in laufender Nummer, bis der neueste Eintrag da ist und der Knopf verschwindet

#### Scenario: Am Kopf kein Knopf
- **WHEN** die Seite frisch geöffnet ist
- **THEN** steht kein „Neuere laden“ da

### Requirement: Sprung auf einen Eintrag im Seitenfenster
Ein Sprung per `?eintrag=<id>` SHALL in die Richtung des Ziels nachladen (älter oder neuer), bis
der Eintrag im Fenster liegt, ihn hervorheben und ins Bild rollen. Das Ziel MUST nach dem Nachladen
im Fenster bleiben. Ohne Netz gilt dasselbe für die im Gerätespeicher liegenden Seiten.

#### Scenario: Sprung auf einen alten Eintrag
- **WHEN** ein Eintrag 30 Seiten unter dem neuesten per `?eintrag=` angesprungen wird
- **THEN** steht er hervorgehoben im Bild, und „Neuere laden“ ist erreichbar

#### Scenario: Sprung auf einen neueren Eintrag aus tiefem Fenster
- **WHEN** das Fenster tief geblättert ist und ein Eintrag über dem Fenster angesprungen wird
- **THEN** lädt die Zeitachse neuere Seiten nach, bis der Eintrag hervorgehoben im Bild steht

### Requirement: Keine Zahl des geladenen Fensters
Kopfzahl und Bilanz der ETB-Seite MUST weiterhin aus der Serverzählung stammen. Die Zahl der
geladenen Einträge oder Seiten SHALL nirgends als Menge des Tagebuchs erscheinen.

#### Scenario: Tiefes Fenster
- **WHEN** das Fenster 500 Einträge eines Tagebuchs mit 3 000 Einträgen hält
- **THEN** nennt der Kopf „3000 Einträge“

### Requirement: Rendern ohne erneutes Parsen
Ein erneutes Rendern der ETB-Seite, bei dem sich die geladenen Einträge nicht geändert haben,
MUST keinen Eintragstext neu als Markdown parsen und keine Zeile der Zeitachse neu rendern.

#### Scenario: Fremder Anlass
- **WHEN** sich nur der Einsatzkopf, die Einheitenliste oder der Fokus in der Zeitachse ändert
- **THEN** rendert keine Zeitachsenzeile neu, und kein Markdown wird geparst

#### Scenario: Neuer Eintrag
- **WHEN** ein neuer Eintrag in die Liste kommt
- **THEN** wird nur der Text des neuen Eintrags geparst
