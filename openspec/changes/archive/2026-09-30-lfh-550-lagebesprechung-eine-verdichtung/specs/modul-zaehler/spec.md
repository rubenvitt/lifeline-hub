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

Für andere Module MUST die Antwort keinen Zähler enthalten.

Die Bedeutung von „offen“, „in Arbeit“, „überfällig“, „fällig“ und „ungelesen“ MUST mit den gleichnamigen Angaben der jeweiligen Listen-Endpunkte übereinstimmen.

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

#### Scenario: Leerer Einsatz
- **WHEN** ein Modul erlaubt ist, aber keine Datensätze hat
- **THEN** ist sein Zähler vorhanden und steht auf 0
