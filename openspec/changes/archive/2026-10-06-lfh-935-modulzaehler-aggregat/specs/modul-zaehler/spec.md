# Spec Delta

## ADDED Requirements

### Requirement: Der Zählerabruf lädt keine Listen
Das System SHALL die Zähler eines Abrufs mit einer festen Zahl an Datenbankabfragen bilden: höchstens eine je erlaubtem Modul, unabhängig davon, wie viele Meldungen, Aufträge, Auftragsempfänger, Erinnerungen oder Chat-Nachrichten der Einsatz hat. Der Abruf MUST NOT dafür Inhalte der gezählten Datensätze laden, insbesondere keine Meldungstexte und keine Auftragsempfänger.

#### Scenario: Großer Bestand
- **WHEN** ein Einsatz 200 Aufträge mit je drei Empfängern hat und ein Mitglied mit Zugriff auf alle Module die Zähler abruft
- **THEN** stellt der Server dafür höchstens neun Datenbankabfragen, so viele wie bei einem leeren Einsatz

#### Scenario: Werte wie bisher
- **WHEN** derselbe Bestand vor und nach dieser Änderung gezählt wird
- **THEN** sind alle Zählwerte gleich, und jeder Kommunikationszähler stimmt mit den Angaben seines Listen-Endpunkts überein

## MODIFIED Requirements

### Requirement: Die Modulzähler aktualisieren sich live
Die Modulzähler SHALL sich aktualisieren, sobald sich die gezählte Menge eines der Module ändert:
- über den Live-Feed des Einsatzes für ETB, Betroffene, Einheiten, Einsatzabschnitte, Meldungen, Aufträge, Erinnerungen, Chat und Dokumente;
- für den Chat außerdem, sobald der Benutzer selbst einen Kanal als gelesen markiert.

Live-Ereignisse frischen die Modulzähler gebündelt auf: Ein Tab MUST NOT die Zähler öfter als einmal je Sammelfenster von 1 s neu abrufen, gleich wie viele Ereignisse darin eintreffen. Das Markieren eines Kanals als gelesen wirkt ohne dieses Fenster.

#### Scenario: Neue Meldung
- **WHEN** ein anderer Benutzer eine Meldung erfasst
- **THEN** steigt der Zähler „Meldungen“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Neues Dokument
- **WHEN** ein Benutzer im Einsatz ein Dokument ablegt oder löscht
- **THEN** ändert sich der Zähler „Dokumente“ im Modulpanel, ohne dass die Seite neu geladen wird

#### Scenario: Kanal gelesen
- **WHEN** der Benutzer einen Chat-Kanal mit ungelesenen Nachrichten öffnet und dieser als gelesen markiert wird
- **THEN** sinkt der Chat-Zähler entsprechend

#### Scenario: Burst von Live-Ereignissen
- **WHEN** ein sichtbarer Tab binnen 500 ms zehn Live-Ereignisse erhält, die gezählte Module betreffen
- **THEN** ruft er die Modulzähler genau einmal neu ab, und die betroffenen Listen laden weiter im Sammelfenster der Listen nach
