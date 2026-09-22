# Spec Delta

## Purpose

Jeder neu angelegte Einsatz trägt eine vom System erzeugte, unveränderliche Einsatznummer.
Sie ist je Organisation und Jahr fortlaufend und dient als Aktenzeichen. Die frei
pflegbare Leitstellen-Nr. bleibt davon getrennt.

## ADDED Requirements

### Requirement: Vergabe beim Anlegen
Das System SHALL jedem über `POST /api/einsaetze` angelegten Einsatz eine Einsatznummer im
Format `<Präfix><JJJJ>-<NNNN>` vergeben. `JJJJ` ist das Kalenderjahr des Anlegezeitpunkts,
`NNNN` die laufende Nummer, mindestens 4-stellig mit führenden Nullen. Die laufende Nummer
MUST je Organisation und Jahr bei 1 beginnen und um 1 steigen. Nummern anderer Organisationen
und anderer Jahre MUST NOT die Zählung beeinflussen.

#### Scenario: Erster und zweiter Einsatz im Jahr
- **WHEN** eine Organisation ohne eigenes Präfix im Jahr 2026 zwei Einsätze anlegt
- **THEN** trägt der erste `E-2026-0001` und der zweite `E-2026-0002`

#### Scenario: Zählung je Organisation getrennt
- **WHEN** Organisation 2 im Jahr 2026 schon Nummern bis `E-2026-0009` hat und Organisation 1 ihren ersten Einsatz des Jahres anlegt
- **THEN** trägt der Einsatz von Organisation 1 die laufende Nummer `0001`

#### Scenario: Mehr als 9999 Einsätze
- **WHEN** die laufende Nummer 10000 erreicht
- **THEN** wird sie ungekürzt fünfstellig geschrieben (`E-2026-10000`)

### Requirement: Präfix als Org-Nummernkreis-Einstellung
Das System SHALL eine org-weite Einstellung `einsatz_nummer_praefix` führen. Sie wird mit
denselben Regeln geprüft wie die übrigen Nummernkreis-Präfixe: höchstens 8 Zeichen, nur
`A-Z a-z 0-9 - _ /` und Leerzeichen, äußere Leerzeichen werden entfernt. Ein ungültiger Wert
wird mit 400 abgewiesen. Ist die Einstellung leer, gilt `E-`. Das zum Anlegezeitpunkt gültige
Präfix MUST Teil der gespeicherten Nummer werden.

#### Scenario: Eigenes Präfix
- **WHEN** eine Organisation das Präfix `WF-` einstellt und danach einen Einsatz anlegt
- **THEN** beginnt dessen Einsatznummer mit `WF-` und trägt die nächste laufende Nummer des Jahres

#### Scenario: Präfixwechsel trifft nur neue Einsätze
- **WHEN** ein Einsatz mit `E-2026-0003` besteht und die Organisation das Präfix danach auf `WF-` ändert
- **THEN** behält der bestehende Einsatz `E-2026-0003`, und der nächste neue Einsatz erhält `WF-2026-0004`

#### Scenario: Ungültiges Präfix
- **WHEN** ein Admin `einsatz_nummer_praefix` auf einen Wert mit mehr als 8 Zeichen oder mit unerlaubten Zeichen setzt
- **THEN** antwortet `PUT /api/org-einstellungen` mit 400, und der gespeicherte Wert bleibt unverändert

### Requirement: Unveränderlichkeit
Die Einsatznummer MUST nach der Vergabe unverändert bleiben. `PATCH /api/einsaetze/{id}`
SHALL einen Body, der das Feld `einsatznummer_intern` enthält, mit 400 abweisen, egal ob mit
Wert oder `null`. Andere Felder dieses Requests werden dann nicht übernommen. Die
Leitstellen-Nr. (`leitstellen_nr`) bleibt über denselben Endpunkt frei setzbar und leerbar.

#### Scenario: Überschreiben abgewiesen
- **WHEN** ein PATCH `einsatznummer_intern: "EN-4711"` schickt
- **THEN** antwortet der Server mit 400, und die Einsatznummer bleibt unverändert

#### Scenario: Leeren abgewiesen
- **WHEN** ein PATCH `einsatznummer_intern: null` schickt
- **THEN** antwortet der Server mit 400, und die Einsatznummer bleibt unverändert

#### Scenario: Leitstellen-Nr. bleibt frei
- **WHEN** ein PATCH nur `leitstellen_nr` setzt oder auf `null` leert
- **THEN** wird das übernommen, und die Einsatznummer bleibt unverändert

### Requirement: Bestand
Einsätze, die vor dieser Änderung ohne Einsatznummer angelegt wurden, SHALL ohne Nummer
bleiben. Bereits vergebene Nummern im Format `JJJJ-NNN` SHALL ihren sichtbaren Text behalten
und in der laufenden Zählung ihres Jahres mitzählen.

#### Scenario: Zählung setzt hinter Bestandsnummern fort
- **WHEN** eine Organisation 2026 schon die Bestandsnummern `2026-001` bis `2026-003` hat und einen neuen Einsatz anlegt
- **THEN** erhält der neue Einsatz `E-2026-0004`, und die drei Bestandsnummern bleiben wörtlich erhalten

#### Scenario: Altbestand ohne Nummer
- **WHEN** ein Einsatz aus der Zeit vor der automatischen Vergabe keine Einsatznummer hat
- **THEN** bleibt `einsatznummer_intern` leer, und die Kopfzeile zeigt die Leitstellen-Nr. oder keine Nummer

### Requirement: Bedienoberfläche
Die Einsatzdaten-Bearbeitung SHALL kein Eingabefeld für die Einsatznummer anbieten. Die
Einsatznummer SHALL in den Einsatzdaten als Text angezeigt werden. Die Einsatz-Defaults der
Administration SHALL das Feld „Präfix Einsatznummer“ neben den übrigen Nummernkreis-Präfixen
anbieten. Ein Speichern der Einsatz-Defaults MUST das Feld im Vollersatz mitschicken, sonst
würde ein Speichern in einer anderen Sektion es leeren.

#### Scenario: Keine Eingabe in den Einsatzdaten
- **WHEN** jemand mit Schreibrecht die Einsatzdaten bearbeitet
- **THEN** gibt es kein Eingabefeld „Einsatznummer“, das Feld „Leitstellen-Nr.“ ist editierbar, und beim Speichern enthält der Request kein `einsatznummer_intern`

#### Scenario: Präfix in den Einsatz-Defaults
- **WHEN** ein Admin unter den Einsatz-Defaults „Präfix Einsatznummer“ auf `WF-` setzt und speichert
- **THEN** enthält der PUT `einsatz_nummer_praefix: "WF-"` und alle übrigen Felder mit ihrem Bestandswert
