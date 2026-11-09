## ADDED Requirements

### Requirement: Gebündelte Aktionen eines Abschnitts

Im Bearbeiten SHALL der Kopf jedes Abschnitts ein ⋮-Menü tragen, benannt mit dem Namen des
Abschnitts, mit „Text kopieren“, „In der Lesefassung zeigen“ und rot hinter einem Trenner
„Abschnitt leeren“. Auf Papier MUST es nicht stehen.

#### Scenario: Menü eines Abschnitts
- **WHEN** eine Person im Lagebericht-Entwurf das ⋮ „Aktionen zu Abschnitt Auftrag“ öffnet
- **THEN** stehen darin „Text kopieren“, „In der Lesefassung zeigen“, ein Trenner und rot
  „Abschnitt leeren“, und der Fokus liegt im Menü

### Requirement: Text eines Abschnitts kopieren

„Text kopieren“ SHALL den Text des Abschnitts, wie er im Feld steht, auch ungespeichert, in die
Zwischenablage legen und Erfolg oder Fehlschlag melden. Bei leerem Abschnitt oder ohne
Zwischenablage MUST der Eintrag gesperrt stehen.

#### Scenario: Kopieren
- **WHEN** im Abschnitt „Lage“ ungespeichert „Lage ruhig“ steht und jemand „Text kopieren“ wählt
- **THEN** liegt „Lage ruhig“ in der Zwischenablage, und eine Meldung nennt den Abschnitt

#### Scenario: Leerer Abschnitt
- **WHEN** jemand das Menü eines leeren Abschnitts öffnet
- **THEN** stehen „Text kopieren“ und „Abschnitt leeren“ gesperrt darin, „In der Lesefassung
  zeigen“ bleibt wählbar

### Requirement: Abschnitt in der Lesefassung zeigen

„In der Lesefassung zeigen“ SHALL das ganze Dokument auf die Lesefassung schalten und den
gewählten Abschnitt an den Anfang des sichtbaren Bereichs rollen. Der Fokus MUST danach auf diesem
Abschnitt der Lesefassung stehen, nicht im Leeren.

#### Scenario: Aus dem Bearbeiten
- **WHEN** jemand im Bearbeiten beim Abschnitt „Durchführung“ „In der Lesefassung zeigen“ wählt
- **THEN** ist „Lesefassung“ gewählt, „Durchführung“ steht oben, und der Fokus liegt dort

### Requirement: Abschnitt nach Rückfrage leeren

„Abschnitt leeren“ SHALL erst nach einer Rückfrage im Dialog wirken, deren Knopf „Abschnitt
leeren“ heißt. Bestätigt, MUST der Abschnitt so leer werden wie nach Löschen von Hand:
Leer-Marke und Füllstand folgen, und die Änderung zählt als ungespeichert. An einem leeren
Abschnitt MUST der Eintrag gesperrt stehen.

#### Scenario: Leeren bestätigt
- **WHEN** jemand beim gefüllten Abschnitt „Auftrag“ „Abschnitt leeren“ wählt und im Dialog „Abschnitt leeren“ bestätigt
- **THEN** ist das Feld leer, „Auftrag“ trägt in Gliederung und Kopf „leer“, und das Verlassen der
  Seite fragt nach ungespeicherten Änderungen

#### Scenario: Leeren abgebrochen
- **WHEN** jemand die Rückfrage mit „Abbrechen“ schließt
- **THEN** bleibt der Text unverändert

#### Scenario: Stand der Übernahme
- **WHEN** im Lagevortrag ein übernommener Abschnitt geleert wird
- **THEN** verliert er seinen Stand der Übernahme wie beim Löschen von Hand

### Requirement: Kontextmenü an Gliederung und Abschnittskopf

Ein Rechtsklick, ein langer Druck oder die Kontextmenü-Taste/Umschalt+F10 auf einem
Gliederungseintrag SHALL ein Menü öffnen mit „Zum Abschnitt springen“ zuoberst, danach den
Einträgen des Abschnitts. Auf dem Abschnittskopf SHALL es die Einträge seines ⋮ zeigen. Im
Textfeld MUST das Browsermenü bleiben.

#### Scenario: Rechtsklick in der Gliederung
- **WHEN** jemand mit der rechten Maustaste auf „Auftrag“ in der Gliederung klickt
- **THEN** öffnet am Zeiger ein Menü mit „Zum Abschnitt springen“, „Text kopieren“, „In der
  Lesefassung zeigen“, einem Trenner und rot „Abschnitt leeren“

#### Scenario: Rechtsklick im Textfeld
- **WHEN** jemand mit der rechten Maustaste in das Textfeld eines Abschnitts klickt
- **THEN** erscheint das Browsermenü mit „Einfügen“ und kein eigenes Menü

#### Scenario: Gliederung in der Lesefassung
- **WHEN** die Lesefassung gewählt ist und jemand das Kontextmenü eines Gliederungseintrags öffnet
- **THEN** fehlt „In der Lesefassung zeigen“, und „Zum Abschnitt springen“ rollt zum Abschnitt der
  Lesefassung
