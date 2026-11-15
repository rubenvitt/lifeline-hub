## ADDED Requirements

### Requirement: Ein Treffer braucht Wortanfang oder Teilwort
Bei aktiver Suche SHALL ein Befehl nur dann Treffer sein, wenn jedes Suchwort in seinem Namen
oder einem seiner Schlagworte einen Wortanfang trifft oder, ab drei Zeichen, als Teilwort darin
vorkommt. Eine bloße Folge einzelner Buchstaben MUST NOT treffen. Umlaute und ß MUST ihrer
Umschrift gleichgelten, Groß- und Kleinschreibung MUST egal sein.

#### Scenario: Buchstabenfolge trifft nicht
- **WHEN** jemand im Einsatz „rtw“ tippt
- **THEN** stehen weder „Lagekarte“ noch „Gefahrengebiet zeichnen“ noch „Benutzerverwaltung“ unter den Treffern

#### Scenario: Kurzes Wort ohne Wortanfang
- **WHEN** jemand „funk“ tippt
- **THEN** steht keine Darstellungs- oder Helligkeitszeile unter den Treffern, und „Fernmeldewesen“ ist der erste Treffer, wenn es freigegeben ist

#### Scenario: Umschrift findet Umlaut
- **WHEN** jemand „kraefte“ tippt
- **THEN** ist „Kräfteübersicht“ der erste Treffer

#### Scenario: Teilwort ab drei Zeichen
- **WHEN** jemand „hilfsstelle“ tippt
- **THEN** steht „Unfallhilfsstellen“ unter den Treffern

#### Scenario: Mehrere Wörter
- **WHEN** jemand „neuer etb“ tippt
- **THEN** steht „ETB-Eintrag schreiben“ unter den Treffern, weil beide Wörter ein Schlagwort am Wortanfang treffen

### Requirement: Module sind über Synonyme auffindbar
Jedes Modul SHALL neben Namen und Beschreibung eine Liste von Synonymen tragen können, über die
die Palette es findet. Ein Synonym MUST NOT sichtbar unter dem Modul stehen. Ein früherer
Modulname MUST als Synonym weiter treffen.

#### Scenario: Früherer Name
- **WHEN** jemand „meldebild“ tippt
- **THEN** steht „Kräfteübersicht“ unter den Treffern

#### Scenario: Abkürzung
- **WHEN** jemand mit Freigabe der Unfallhilfsstellen „bhp“ tippt
- **THEN** steht „Unfallhilfsstellen“ unter den Treffern

#### Scenario: Alltagswort
- **WHEN** jemand „tagebuch“ tippt
- **THEN** steht „ETB“ unter den Treffern

#### Scenario: Stärke
- **WHEN** jemand „stärke“ tippt
- **THEN** steht „Kräfteübersicht“ unter den Treffern

### Requirement: Fahrzeuge und Personal über ihre Merkmale
Die Palette SHALL ein Fahrzeug auch über seinen Fahrzeugtyp und sein Kennzeichen finden und eine
Person des Personals auch über ihre Funktion. Der Treffer MUST weiter Funkrufname bzw. Namen als
Beschriftung tragen und das getroffene Merkmal zeigen.

#### Scenario: Fahrzeugtyp
- **WHEN** im Einsatz ein Fahrzeug „Rotkreuz Uelzen 83/1“ vom Typ „RTW“ steht und jemand mit Freigabe der Fahrzeuge „rtw“ tippt
- **THEN** steht „Rotkreuz Uelzen 83/1“ unter den Treffern, mit dem Hinweis „RTW“

#### Scenario: Kennzeichen
- **WHEN** jemand den Anfang des Kennzeichens eines Fahrzeugs tippt
- **THEN** steht das Fahrzeug unter den Treffern

#### Scenario: Funktion beim Personal
- **WHEN** eine Person des Personals die Funktion „Gruppenführer“ trägt und jemand „gruppenf“ tippt
- **THEN** steht diese Person unter den Treffern

### Requirement: Die Hilfe steht in der Palette
Die Palette SHALL eine Zeile „Hilfe“ führen, die die Anwenderhilfe öffnet. Sie MUST auch
außerhalb eines Einsatzes stehen.

#### Scenario: Hilfe suchen
- **WHEN** jemand „hilfe“ tippt
- **THEN** ist „Hilfe“ der erste Treffer, vor „Unfallhilfsstelle anlegen“

### Requirement: Meldung, Auftrag, Nachforderung und Fahrzeugstatus aus der Palette
Mit Schreibrecht im Einsatz SHALL die Palette die Schnellaktionen „Meldung erfassen“,
„Lagemeldung erfassen“, „Auftrag erteilen“, „Nachforderung stellen“ und „Fahrzeugstatus setzen“
führen, jede nur bei Freigabe ihres Trägermoduls; „Lagemeldung erfassen“ MUST zusätzlich die
Freigabe der Meldungen verlangen. Die Erfassungen MUST das Formular ihres Moduls öffnen,
„Fahrzeugstatus setzen“ MUST das FMS-Tableau der Fahrzeuge zeigen.

#### Scenario: Meldung erfassen
- **WHEN** eine Person mit Schreibrecht und Freigabe der Meldungen „Meldung erfassen“ wählt
- **THEN** zeigt die Seite Meldungen das Meldungsformular

#### Scenario: Lagemeldung erfassen
- **WHEN** eine Person mit Schreibrecht und Freigabe der Lagemeldungen „Lagemeldung erfassen“ wählt
- **THEN** zeigt die Seite Lagemeldungen das Meldungsformular mit der Art „Lagemeldung“

#### Scenario: Auftrag erteilen
- **WHEN** eine Person mit Schreibrecht und Freigabe der Aufträge „Auftrag erteilen“ wählt
- **THEN** zeigt die Seite Aufträge/Befehle den Dialog zum Erteilen eines Auftrags

#### Scenario: Nachforderung stellen
- **WHEN** eine Person mit Schreibrecht und Freigabe der Nachforderungen „Nachforderung stellen“ wählt
- **THEN** zeigt die Seite Nachforderungen das Formular einer neuen Nachforderung

#### Scenario: Fahrzeugstatus setzen
- **WHEN** eine Person mit Schreibrecht und Freigabe der Fahrzeuge „Fahrzeugstatus setzen“ wählt
- **THEN** zeigt die Seite Fahrzeuge das FMS-Tableau

#### Scenario: Meldungen gesperrt
- **WHEN** das Modul Meldungen für die Person gesperrt ist
- **THEN** fehlt „Meldung erfassen“

### Requirement: Schnellaktionen nach Nutzung geordnet
Die Palette SHALL ihre Schnellaktionen je Benutzer danach ordnen, wie oft er sie ausgeführt hat,
die häufigste zuerst. Bei gleicher Zahl MUST die feste Folge gelten: Person erfassen,
ETB-Eintrag schreiben, Meldung erfassen, Auftrag erteilen, Nachforderung stellen,
Fahrzeugstatus setzen, dann die übrigen in ihrer bisherigen Folge. Die Zahlen MUST am Benutzer
auf dem Server liegen, nicht im Browser. Während die Palette offen ist, MUST die Folge stehen
bleiben.

#### Scenario: Neuer Benutzer
- **WHEN** ein Benutzer ohne gezählte Ausführungen die Palette im Einsatz öffnet
- **THEN** stehen die Schnellaktionen in der festen Folge, „Person erfassen“ zuerst

#### Scenario: Häufige Aktion rückt vor
- **WHEN** ein Benutzer „Anruf erfassen“ dreimal und keine andere Schnellaktion ausgeführt hat
- **THEN** steht „Anruf erfassen“ als erste Schnellaktion

#### Scenario: Anderes Gerät
- **WHEN** derselbe Benutzer sich an einem anderen Rechner anmeldet
- **THEN** stehen seine Schnellaktionen in derselben Folge

#### Scenario: Schichtwechsel am selben Rechner
- **WHEN** nach ihm ein anderer Benutzer am selben Rechner die Palette öffnet
- **THEN** gilt dessen eigene Folge

#### Scenario: Zählen schlägt fehl
- **WHEN** das Speichern der Zahl scheitert
- **THEN** wird die Aktion trotzdem ausgeführt, und die Palette meldet keinen Fehler

## MODIFIED Requirements

### Requirement: Gefahrengebiet zeichnen aus der Palette
Die Sprungpalette SHALL im Einsatz die Schnellaktion „Gefahrengebiet zeichnen“ anbieten. Ausgeführt
MUST sie auf die Lagekarte dieses Einsatzes springen und dort den Zeichenmodus für ein
Gefahrengebiet betreten. Die Zeile MUST nur erscheinen, wenn die Person im Einsatz schreiben darf
und die Lagekarte für sie freigegeben ist; auf die Freigabe des Moduls Gefahren MUST sie nicht
warten, weil das Zeichnen auf der Lagekarte geschieht. Sie MUST wie jede Schnellaktion im neuen Tab
öffnen können. Ihren Platz unter den Schnellaktionen bestimmt die Anforderung „Schnellaktionen
nach Nutzung geordnet“.

Jede Schnellaktion MUST auf eine Seite ihres Trägermoduls zeigen, die den Auftrag ihres Ziels
wirklich liest: eine Erfassungsaktion den Auftrag `neu=1`, eine Zeichen-Aktion den Auftrag
`zeichnen`, eine Ansichts-Aktion den Auftrag `ansicht`. Eine Zeile, deren Zielseite den Auftrag
nicht liest, MUST es nicht geben.

#### Scenario: Zeile ausführen
- **WHEN** eine Person mit Schreibrecht im Einsatz „Gefahrengebiet zeichnen“ wählt
- **THEN** zeigt die Lagekarte des Einsatzes den Zeichenmodus für ein Gefahrengebiet

#### Scenario: Ohne Schreibrecht
- **WHEN** eine beobachtende Person oder ein abgeschlossener Einsatz die Palette öffnet
- **THEN** fehlt die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Lagekarte nicht freigegeben
- **WHEN** die Lagekarte im Einsatz nicht freigegeben ist
- **THEN** fehlt die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Gefahren-Modul nicht freigegeben
- **WHEN** die Lagekarte freigegeben ist, das Modul Gefahren aber nicht
- **THEN** erscheint die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Im neuen Tab
- **WHEN** die Zeile mit Strg/⌘+↵ ausgeführt wird
- **THEN** öffnet ein neuer Tab die Lagekarte im Zeichenmodus für ein Gefahrengebiet

#### Scenario: Reihenfolge der Schnellaktionen
- **WHEN** ein Benutzer ohne gezählte Ausführungen alle Schnellaktionen angeboten bekommt
- **THEN** stehen sie in der festen Folge der Anforderung „Schnellaktionen nach Nutzung geordnet“

### Requirement: Schnellaktionen nennen ihr Modul
Jede Schnellaktion SHALL Icon und Namen ihres Trägermoduls zeigen, den Namen als Kontext rechts.
Ihre Beschriftung MUST dem Muster Objekt + Verb folgen („Person erfassen“, „ETB-Eintrag
schreiben“, „Meldung erfassen“, „Lagemeldung erfassen“, „Auftrag erteilen“, „Nachforderung
stellen“, „Fahrzeugstatus setzen“, „Unfallhilfsstelle anlegen“, „Schaden erfassen“,
„Lagebesprechung abschließen“, „Dokument ablegen“, „Tier erfassen“, „Bereitstellungsraum
anlegen“, „Einsatzabschnitt anlegen“, „Gefahrengebiet zeichnen“, „Anruf erfassen“). Die bisherige
Beschriftung MUST als Suchwort weiter treffen.

#### Scenario: Zeile mit Modul
- **WHEN** die Palette im Einsatz mit Schreibrecht geöffnet wird
- **THEN** zeigt „Unfallhilfsstelle anlegen“ das Icon der Unfallhilfsstellen und rechts „Unfallhilfsstellen“

#### Scenario: Alte Beschriftung findet
- **WHEN** jemand „neuer etb“ tippt
- **THEN** steht „ETB-Eintrag schreiben“ unter den Treffern

#### Scenario: Neue Zeile mit Modul
- **WHEN** die Palette im Einsatz mit Schreibrecht und Freigabe der Meldungen geöffnet wird
- **THEN** zeigt „Meldung erfassen“ das Icon der Meldungen und rechts „Meldungen“
