# Spec Delta

## Purpose

Der Server liefert Zähler je Modul für den Navigationsrahmen eines Einsatzes. Die Antwort enthält nur die Module, die der anfragende Benutzer sehen darf. Jede Zahl hat eine festgelegte, aus dem Entwurf belegte Bedeutung, damit das Modulpanel keine Zahl zeigt, die niemand definiert hat.

## ADDED Requirements

### Requirement: Modulzähler mit festgelegter Bedeutung
Das System SHALL unter `GET /api/einsaetze/{id}/modul-zaehler` für die folgenden Module je einen Zähler liefern. Die Bedeutung ist genau diese:

| Modul | Werte |
|---|---|
| `etb` | `gesamt`: alle ETB-Einträge des Einsatzes |
| `personen` | `gesamt`: alle nicht stornierten Betroffenen, unabhängig von ihrem Status |
| `einheiten` | `gesamt`: alle dem Einsatz zugeordneten Einheiten |
| `einsatzabschnitte` | `gesamt`: alle Einsatzabschnitte |
| `meldungen` | `offen`: Meldungen mit Status ungleich „erledigt“; `ungesehen`: davon Status „neu“ |
| `auftraege` | `offen`: Aufträge mit Bearbeitungsstatus „offen“ oder „in Arbeit“; `ueberfaellig`: davon überfällig |
| `erinnerungen` | `faellig`: fällige Erinnerungen mit Status „offen“ |
| `chat` | `ungelesen`: für den anfragenden Benutzer ungelesene Nachrichten über alle Kanäle |

Für andere Module MUST die Antwort keinen Zähler enthalten.

Die Bedeutung von „offen“, „überfällig“, „fällig“ und „ungelesen“ MUST mit den gleichnamigen Angaben der jeweiligen Listen-Endpunkte übereinstimmen.

#### Scenario: Zähler eines Einsatzes
- **WHEN** ein Mitglied mit Zugriff auf alle Module den Endpunkt aufruft und der Einsatz 4 Betroffene hat, davon 1 storniert
- **THEN** antwortet das System mit HTTP 200 und `personen.gesamt: 3`

#### Scenario: Übereinstimmung mit der Meldungsliste
- **WHEN** die Meldungsliste des Einsatzes 5 Meldungen mit `ist_offen = true` liefert, davon 2 mit Status „neu“
- **THEN** ist `meldungen.offen: 5` und `meldungen.ungesehen: 2`

#### Scenario: Chat zählt je Benutzer
- **WHEN** zwei Benutzer denselben Kanal unterschiedlich weit gelesen haben
- **THEN** erhält jeder seinen eigenen Wert für `chat.ungelesen`

#### Scenario: Leerer Einsatz
- **WHEN** ein Modul erlaubt ist, aber keine Datensätze hat
- **THEN** ist sein Zähler vorhanden und steht auf 0

### Requirement: Nur erlaubte Module werden gezählt
Der Endpunkt MUST Lesezugriff auf den Einsatz verlangen und gehört selbst keinem Modul. Ein Zähler MUST nur für Module enthalten sein, auf die der Benutzer nach denselben Regeln zugreifen darf wie auf den Listen-Endpunkt des Moduls: Sichtbarkeit, Rollensperre aus dem Einsatz-Override, sonst aus der Org-Vorgabe, und die Ausnahme für System-Admins.
- Ein nicht erlaubtes Modul MUST in der Antwort **fehlen**. Es DARF NICHT als 0 erscheinen.
- Für einen unbekannten Einsatz antwortet das System mit HTTP 404, ohne Lesezugriff mit HTTP 403.

#### Scenario: Ausgeblendetes Modul
- **WHEN** das Modul `meldungen` für den Einsatz ausgeblendet ist und ein Mitglied ohne Admin-Rechte anfragt
- **THEN** enthält die Antwort keinen Eintrag `meldungen`; die übrigen erlaubten Module sind enthalten

#### Scenario: Rollengesperrtes Modul
- **WHEN** die Org-Vorgabe das Modul `personen` auf Führungskräfte beschränkt und ein Mitglied ohne diese Berechtigung anfragt
- **THEN** enthält die Antwort keinen Eintrag `personen`

#### Scenario: System-Admin
- **WHEN** ein System-Admin anfragt und Module ausgeblendet sind
- **THEN** enthält die Antwort Zähler für alle Module der Tabelle

#### Scenario: Kein Lesezugriff
- **WHEN** ein Benutzer ohne Lesezugriff auf den Einsatz anfragt
- **THEN** antwortet das System mit HTTP 403

### Requirement: Der Navigationsrahmen zeigt die Modulzähler
Der Navigationsrahmen des Einsatzes (Modulpanel und Akkordeon) SHALL die Zähler dieses Endpunkts an den Modulen ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen und Chat anzeigen.
- Die Werte kommen aus **einer** Abfrage. Der Rahmen lädt dafür keine Modullisten.
- Jeder Zähler MUST seine Bedeutung als zweiten Kanal tragen: Tooltip und zugänglichen Namen des Modulziels. Für die vier Kommunikationsmodule bleibt der bisherige Wortlaut erhalten.
- Ein Zähler von 0 und ein fehlender Zähler werden nicht angezeigt.
- Solange die Abfrage lädt oder fehlgeschlagen ist, zeigt kein Modul eine Zahl.

#### Scenario: Betroffene im Modulpanel
- **WHEN** der Endpunkt `personen.gesamt: 248` liefert
- **THEN** zeigt das Modul „Betroffene“ die Zahl 248, und sein zugänglicher Name nennt „248 Betroffene“

#### Scenario: Bisheriger Wortlaut bleibt
- **WHEN** der Endpunkt `meldungen.offen: 3` und `meldungen.ungesehen: 1` liefert
- **THEN** lautet die Beschreibung „3 offene Meldungen, davon 1 ungesehen“

#### Scenario: Keine Listenabfragen
- **WHEN** der Navigationsrahmen eines Einsatzes angezeigt wird, ohne dass ein Kommunikationsmodul geöffnet ist
- **THEN** stellt er keine Anfrage an die Listen-Endpunkte von Meldungen, Aufträgen, Erinnerungen oder Chat-Kanälen

### Requirement: Die Modulzähler aktualisieren sich live
Die Modulzähler SHALL sich aktualisieren, sobald sich die gezählte Menge eines der Module ändert:
- über den Live-Feed des Einsatzes für ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen und Chat;
- für den Chat außerdem, sobald der Benutzer selbst einen Kanal als gelesen markiert.

#### Scenario: Neue Meldung
- **WHEN** ein anderer Benutzer eine Meldung erfasst
- **THEN** steigt der Zähler „Meldungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Kanal gelesen
- **WHEN** der Benutzer einen Chat-Kanal mit ungelesenen Nachrichten öffnet und dieser als gelesen markiert wird
- **THEN** sinkt der Chat-Zähler entsprechend
