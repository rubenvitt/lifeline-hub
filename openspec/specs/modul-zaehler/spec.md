# modul-zaehler Specification

## Purpose
Der Server liefert Zähler je Modul für den Navigationsrahmen eines Einsatzes. Die Antwort enthält nur die Module, die der anfragende Benutzer sehen darf. Jede Zahl hat eine festgelegte, aus dem Entwurf belegte Bedeutung, damit das Modulpanel keine Zahl zeigt, die niemand definiert hat.

## Requirements

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
| `lagemeldungen` | `neu`: Lagemeldungen, die noch niemand als gesehen gekennzeichnet hat |
| `nachforderungen` | `offen`: Nachforderungen mit Status „angefordert“, „zugesagt“ oder „unterwegs“; `angefordert`, `zugesagt`, `unterwegs`: davon je Status; `ueberfaellig`: davon zugesagt oder unterwegs mit verstrichenem erwartetem Eintreffen |

Für andere Module MUST die Antwort keinen Zähler enthalten.

Die Bedeutung von „offen“, „in Arbeit“, „überfällig“, „fällig“, „ungelesen“ und „neu“ MUST mit den gleichnamigen Angaben der jeweiligen Listen-Endpunkte übereinstimmen. `dokumente.gesamt` MUST der Zahl der Einträge entsprechen, die der Listen-Endpunkt der Dokumente liefert. `lagemeldungen.neu` MUST der Zahl der Einträge mit `is_neu = true` entsprechen, die der Listen-Endpunkt der Lagemeldungen liefert. `nachforderungen.offen` MUST der Zahl der Einträge mit `ist_offen = true` entsprechen, die der Listen-Endpunkt der Nachforderungen liefert, und `offen` MUST die Summe aus `angefordert`, `zugesagt` und `unterwegs` sein. `nachforderungen.ueberfaellig` MUST nach derselben Regel zählen wie das Etikett „überfällig“ des Boards (Status „zugesagt“ oder „unterwegs“ und erwartetes Eintreffen echt vor dem Abrufzeitpunkt); ein gemeinsames Fixture hält Server und Browser gleich. Eingetroffene und abgelehnte Nachforderungen zählt der Zähler nicht.

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

#### Scenario: Neue Lagemeldungen
- **WHEN** der Einsatz 3 Lagemeldungen hat und eine davon als gesehen gekennzeichnet ist
- **THEN** ist `lagemeldungen.neu: 2`, für jeden anfragenden Benutzer gleich, und die Liste der Lagemeldungen liefert 2 Einträge mit `is_neu = true`

#### Scenario: Offene Nachforderungen
- **WHEN** der Einsatz zwei angeforderte, eine zugesagte, eine unterwegs befindliche, eine eingetroffene und eine abgelehnte Nachforderung hat
- **THEN** ist `nachforderungen` gleich `{ offen: 4, angefordert: 2, zugesagt: 1, unterwegs: 1, ueberfaellig: 0 }`, und die Nachforderungsliste liefert 4 Einträge mit `ist_offen = true`

#### Scenario: Überfällige Nachforderungen
- **WHEN** eine zugesagte Nachforderung ihr erwartetes Eintreffen vor einer Minute hatte, eine unterwegs befindliche es in einer Stunde hat und eine eingetroffene es vor einer Stunde hatte
- **THEN** ist `nachforderungen.ueberfaellig: 1`, und das Board trägt genau an der ersten Karte „überfällig“

#### Scenario: Leerer Einsatz
- **WHEN** ein Modul erlaubt ist, aber keine Datensätze hat
- **THEN** ist sein Zähler vorhanden und steht auf 0

### Requirement: Nur erlaubte Module werden gezählt
Der Endpunkt MUST Lesezugriff auf den Einsatz verlangen und gehört selbst keinem Modul. Ein Zähler MUST nur für Module enthalten sein, auf die der Benutzer nach denselben Regeln zugreifen darf wie auf den Listen-Endpunkt des Moduls: Sichtbarkeit, Rollensperre aus dem Einsatz-Override, sonst aus der Org-Vorgabe, und die Ausnahme für System-Admins.
- Ein nicht erlaubtes Modul MUST in der Antwort **fehlen**. Es DARF NICHT als 0 erscheinen.
- Für einen unbekannten Einsatz antwortet das System mit HTTP 404, ohne Lesezugriff mit HTTP 403.
- Ein gekoppeltes Gerät MUST den Zähler `nachforderungen` nicht erhalten: er zählt den ganzen Einsatz.

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
- **THEN** zeigt das Modul „Lagemeldungen“ die Zahl 2 mit der Beschreibung „2 neue Lagemeldungen“, und das Werkzeug „Lagemeldungen“ der Kachel S2 auf der Stab-Seite zeigt dieselbe Zahl

#### Scenario: Wortlaut der Nachforderungen
- **WHEN** der Endpunkt `nachforderungen.offen: 5` und `nachforderungen.unterwegs: 2` liefert
- **THEN** zeigt das Modul „Nachforderungen“ die Zahl 5 mit der Beschreibung „5 offene Nachforderungen, davon 2 unterwegs“, und die Werkzeuge „Nachforderungen“ der Kacheln S1 und S4 auf der Stab-Seite zeigen dieselbe Zahl

#### Scenario: Keine Listenabfragen
- **WHEN** der Navigationsrahmen eines Einsatzes angezeigt wird, ohne dass ein Kommunikationsmodul, die Dokumentenablage, die Lagemeldungen oder die Nachforderungen geöffnet sind
- **THEN** stellt er keine Anfrage an die Listen-Endpunkte von Meldungen, Aufträgen, Erinnerungen, Chat-Kanälen, Dokumenten, Lagemeldungen oder Nachforderungen

### Requirement: Die Modulzähler aktualisieren sich live
Die Modulzähler SHALL sich aktualisieren, sobald sich die gezählte Menge eines der Module ändert:
- über den Live-Feed des Einsatzes für ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen, Chat, Dokumente, Lagemeldungen und Nachforderungen;
- für den Chat außerdem, sobald der Benutzer selbst einen Kanal als gelesen markiert.

Live-Ereignisse frischen die Modulzähler gebündelt auf: Ein Tab MUST NOT die Zähler öfter als einmal je Sammelfenster von 1 s neu abrufen, gleich wie viele Ereignisse darin eintreffen. Das Markieren eines Kanals als gelesen wirkt ohne dieses Fenster.

#### Scenario: Neue Meldung
- **WHEN** ein anderer Benutzer eine Meldung erfasst
- **THEN** steigt der Zähler „Meldungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Neues Dokument
- **WHEN** ein Benutzer im Einsatz ein Dokument ablegt oder löscht
- **THEN** ändert sich der Zähler „Dokumente“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Lagemeldung gesehen
- **WHEN** ein anderer Benutzer eine neue Lagemeldung als gesehen kennzeichnet
- **THEN** sinkt der Zähler „Lagemeldungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Nachforderung fortgeschaltet
- **WHEN** ein anderer Benutzer eine zugesagte Nachforderung als unterwegs meldet
- **THEN** ändert sich die Beschreibung des Zählers „Nachforderungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Kanal gelesen
- **WHEN** der Benutzer einen Chat-Kanal mit ungelesenen Nachrichten öffnet und dieser als gelesen markiert wird
- **THEN** sinkt der Chat-Zähler entsprechend

#### Scenario: Burst von Live-Ereignissen
- **WHEN** ein sichtbarer Tab binnen 500 ms zehn Live-Ereignisse erhält, die gezählte Module betreffen
- **THEN** ruft er die Modulzähler genau einmal neu ab, und die betroffenen Listen laden weiter im Sammelfenster der Listen nach

### Requirement: Der Zählerabruf lädt keine Listen
Das System SHALL die Zähler eines Abrufs mit einer festen Zahl an Datenbankabfragen bilden: höchstens eine je erlaubtem Modul, unabhängig davon, wie viele Meldungen, Lagemeldungen, Aufträge, Auftragsempfänger, Erinnerungen, Nachforderungen oder Chat-Nachrichten der Einsatz hat. Der Abruf MUST NOT dafür Inhalte der gezählten Datensätze laden, insbesondere keine Meldungstexte, keine Texte von Lagemeldungen, keine Bezeichnungen von Nachforderungen und keine Auftragsempfänger.

#### Scenario: Großer Bestand
- **WHEN** ein Einsatz 200 Aufträge mit je drei Empfängern hat und ein Mitglied mit Zugriff auf alle Module die Zähler abruft
- **THEN** stellt der Server dafür höchstens elf Datenbankabfragen, so viele wie bei einem leeren Einsatz

#### Scenario: Werte wie bisher
- **WHEN** derselbe Bestand vor und nach dieser Änderung gezählt wird
- **THEN** sind alle bisherigen Zählwerte gleich, und jeder Kommunikationszähler stimmt mit den Angaben seines Listen-Endpunkts überein
