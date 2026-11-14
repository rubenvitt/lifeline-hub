## MODIFIED Requirements

### Requirement: Meldung und Lage heißen überall gleich

Die Übernahme einer Meldung in die Lage SHALL an jeder Stelle „In die Lage übernehmen“ heißen
(Aktion der Meldung, Titel des Dialogs) und nach dem Speichern „In die Lage übernommen“
(Rückmeldung, Hinweis, ETB-Eintrag); eine Meldung in der Lage SHALL das Etikett „In der Lage ✓“
tragen. Das Wort „übergeben“ MUST NOT für diesen Vorgang stehen. Der ETB-Typ „Lage“ SHALL in der
Mehrzahl „Lagefeststellungen“ heißen und MUST NOT „Lagemeldungen“ heißen; „Lagemeldungen“ ist nur
das Modul. Das Paneel des Lagebilds mit den jüngsten ETB-Einträgen SHALL „Jüngste ETB-Einträge“
heißen, nicht „Meldungsstrom“.

#### Scenario: Rückmeldung in die Lage übernehmen

- **WHEN** eine Person an einer Rückmeldung „In die Lage übernehmen“ wählt und im Dialog „In die Lage übernehmen“ „Übernehmen“ bestätigt
- **THEN** meldet die App „In die Lage übernommen“, die Karte trägt „In der Lage ✓“, und keine dieser Stellen nennt „übergeben“

#### Scenario: Schnellknopf im Meldungsformular

- **WHEN** eine Person im Meldungsformular „Lagemeldung an übergeordnete Stelle“ wählt
- **THEN** stehen Art „Lagemeldung“ und Richtung „Extern“ im Formular

#### Scenario: Bilanz des ETB

- **WHEN** das ETB zwei Einträge vom Typ „Lage“ zählt
- **THEN** heißen sie in der Lageentwicklung und im Titel ihres Typ-Segments „Lagefeststellungen“, nicht „Lagemeldungen“; das Segment selbst trägt das Typwort „Lage“

#### Scenario: Paneel im Lagebild

- **WHEN** eine Person das Lagebild öffnet
- **THEN** heißt das Paneel mit den jüngsten Einträgen des Einsatztagebuchs „Jüngste ETB-Einträge“, und die Zeile unter „Lagebild“ im Menü lautet „Lage in Zahlen, jüngste ETB-Einträge“
