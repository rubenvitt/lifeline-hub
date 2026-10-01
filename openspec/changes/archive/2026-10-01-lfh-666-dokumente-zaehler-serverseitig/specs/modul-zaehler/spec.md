# Spec Delta

## MODIFIED Requirements

### Requirement: Modulzähler mit festgelegter Bedeutung
Das System SHALL unter `GET /api/einsaetze/{id}/modul-zaehler` für die folgenden Module je einen Zähler liefern. Die Bedeutung ist genau diese:

| Modul | Werte |
|---|---|
| `etb` | `gesamt`: alle ETB-Einträge des Einsatzes |
| `personen` | `gesamt`: alle nicht stornierten Betroffenen, unabhängig von ihrem Status |
| `einheiten` | `gesamt`: alle dem Einsatz zugeordneten Einheiten |
| `einsatzabschnitte` | `gesamt`: alle Einsatzabschnitte |
| `meldungen` | `offen`: Meldungen mit Status ungleich „erledigt“; `ungesehen`: davon Status „neu“ |
| `auftraege` | `offen`: Aufträge mit Bearbeitungsstatus „offen“ oder „in Arbeit“; `in_arbeit`: davon mit Bearbeitungsstatus „in Arbeit“; `ueberfaellig`: davon überfällig |
| `erinnerungen` | `faellig`: fällige Erinnerungen mit Status „offen“ |
| `chat` | `ungelesen`: für den anfragenden Benutzer ungelesene Nachrichten über alle Kanäle |
| `dokumente` | `gesamt`: alle nicht gelöschten Dokumente der Dokumentenablage des Einsatzes |

Für andere Module MUST die Antwort keinen Zähler enthalten.

Die Bedeutung von „offen“, „in Arbeit“, „überfällig“, „fällig“ und „ungelesen“ MUST mit den gleichnamigen Angaben der jeweiligen Listen-Endpunkte übereinstimmen. `dokumente.gesamt` MUST der Zahl der Einträge entsprechen, die der Listen-Endpunkt der Dokumente liefert.

#### Scenario: Zähler eines Einsatzes
- **WHEN** ein Mitglied mit Zugriff auf alle Module den Endpunkt aufruft und der Einsatz 4 Betroffene hat, davon 1 storniert
- **THEN** antwortet das System mit HTTP 200 und `personen.gesamt: 3`

#### Scenario: Übereinstimmung mit der Meldungsliste
- **WHEN** die Meldungsliste des Einsatzes 5 Meldungen mit `ist_offen = true` liefert, davon 2 mit Status „neu“
- **THEN** ist `meldungen.offen: 5` und `meldungen.ungesehen: 2`

#### Scenario: Aufträge in Arbeit
- **WHEN** der Einsatz je einen Auftrag mit Bearbeitungsstatus „offen“, „in Arbeit“ und „vollzogen“ hat
- **THEN** ist `auftraege.offen: 2` und `auftraege.in_arbeit: 1`

#### Scenario: Vollzogener Auftrag ist nicht überfällig im Zähler
- **WHEN** ein vollzogener Auftrag eine abgelaufene Frist und einen unquittierten Empfänger hat
- **THEN** zählt er weder in `auftraege.offen` noch in `auftraege.ueberfaellig`

#### Scenario: Chat zählt je Benutzer
- **WHEN** zwei Benutzer denselben Kanal unterschiedlich weit gelesen haben
- **THEN** erhält jeder seinen eigenen Wert für `chat.ungelesen`

#### Scenario: Gelöschte Dokumente zählen nicht
- **WHEN** im Einsatz 3 Dokumente abgelegt wurden und eines davon gelöscht ist
- **THEN** ist `dokumente.gesamt: 2`, und die Dokumentliste des Einsatzes liefert 2 Einträge

#### Scenario: Leerer Einsatz
- **WHEN** ein Modul erlaubt ist, aber keine Datensätze hat
- **THEN** ist sein Zähler vorhanden und steht auf 0

### Requirement: Der Navigationsrahmen zeigt die Modulzähler
Der Navigationsrahmen des Einsatzes (Modulpanel und Akkordeon) SHALL die Zähler dieses Endpunkts an den Modulen ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen, Chat und Dokumente anzeigen.
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

#### Scenario: Keine Listenabfragen
- **WHEN** der Navigationsrahmen eines Einsatzes angezeigt wird, ohne dass ein Kommunikationsmodul oder die Dokumentenablage geöffnet ist
- **THEN** stellt er keine Anfrage an die Listen-Endpunkte von Meldungen, Aufträgen, Erinnerungen, Chat-Kanälen oder Dokumenten

### Requirement: Die Modulzähler aktualisieren sich live
Die Modulzähler SHALL sich aktualisieren, sobald sich die gezählte Menge eines der Module ändert:
- über den Live-Feed des Einsatzes für ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen, Chat und Dokumente;
- für den Chat außerdem, sobald der Benutzer selbst einen Kanal als gelesen markiert.

#### Scenario: Neue Meldung
- **WHEN** ein anderer Benutzer eine Meldung erfasst
- **THEN** steigt der Zähler „Meldungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Neues Dokument
- **WHEN** ein Benutzer im Einsatz ein Dokument ablegt oder löscht
- **THEN** ändert sich der Zähler „Dokumente“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Kanal gelesen
- **WHEN** der Benutzer einen Chat-Kanal mit ungelesenen Nachrichten öffnet und dieser als gelesen markiert wird
- **THEN** sinkt der Chat-Zähler entsprechend
