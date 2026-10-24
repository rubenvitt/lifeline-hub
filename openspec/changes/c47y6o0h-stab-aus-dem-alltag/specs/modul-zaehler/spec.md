## MODIFIED Requirements

### Requirement: Der Navigationsrahmen zeigt die Modulzähler
Der Navigationsrahmen des Einsatzes (Modulpanel und Akkordeon) SHALL die Zähler dieses Endpunkts an den Modulen ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen, Chat, Dokumente, Lagemeldungen und Nachforderungen anzeigen.
- Die Werte kommen aus **einer** Abfrage. Der Rahmen lädt dafür keine Modullisten.
- Jeder Zähler MUST seine Bedeutung als zweiten Kanal tragen: Tooltip und zugänglichen Namen des Modulziels. Für die vier Kommunikationsmodule und die Dokumente bleibt der bisherige Wortlaut erhalten.
- Ein Zähler von 0 und ein fehlender Zähler werden nicht angezeigt.
- Solange die Abfrage lädt oder fehlgeschlagen ist, zeigt kein Modul eine Zahl.

#### Scenario: Betroffene im Modulpanel
- **WHEN** der Endpunkt `personen.gesamt: 248` liefert
- **THEN** zeigt das Modul „Betroffene“ die Zahl 248, und sein zugänglicher Name nennt „248 Betroffene“

#### Scenario: Bisheriger Wortlaut bleibt
- **WHEN** der Endpunkt `meldungen.offen: 3` und `meldungen.ungesehen: 1` liefert
- **THEN** lautet die Beschreibung „3 offene Meldungen, davon 1 ungesehen“

#### Scenario: Wortlaut der Dokumente
- **WHEN** der Endpunkt `dokumente.gesamt: 5` liefert
- **THEN** zeigt das Modul „Dokumente“ die Zahl 5 mit der Beschreibung „5 abgelegte Dokumente“; bei `dokumente.gesamt: 1` lautet sie „1 abgelegtes Dokument“

#### Scenario: Wortlaut der Lagemeldungen
- **WHEN** der Endpunkt `lagemeldungen.neu: 2` liefert
- **THEN** zeigt das Modul „Lagemeldungen“ die Zahl 2 mit der Beschreibung „2 neue Lagemeldungen“, und das Werkzeug „Lagemeldungen“ auf der Startseite des Fachzugangs S2 zeigt dieselbe Zahl

#### Scenario: Wortlaut der Nachforderungen
- **WHEN** der Endpunkt `nachforderungen.offen: 5` und `nachforderungen.unterwegs: 2` liefert
- **THEN** zeigt das Modul „Nachforderungen“ die Zahl 5 mit der Beschreibung „5 offene Nachforderungen, davon 2 unterwegs“, und die Werkzeuge „Nachforderungen“ auf den Startseiten der Fachzugänge S1 und S4 zeigen dieselbe Zahl

#### Scenario: Keine Listenabfragen
- **WHEN** der Navigationsrahmen eines Einsatzes angezeigt wird, ohne dass ein Kommunikationsmodul, die Dokumentenablage, die Lagemeldungen oder die Nachforderungen geöffnet sind
- **THEN** stellt er keine Anfrage an die Listen-Endpunkte von Meldungen, Aufträgen, Erinnerungen, Chat-Kanälen, Dokumenten, Lagemeldungen oder Nachforderungen

