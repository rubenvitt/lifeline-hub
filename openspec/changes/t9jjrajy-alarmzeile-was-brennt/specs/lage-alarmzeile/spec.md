## Purpose

Die Alarmzeile „Was brennt“ sammelt ganz oben auf Überblick, Lagebild und Lagemonitor alles, was
die Einsatzleitung jetzt wissen muss, aus allen Quellen in einer Folge, damit niemand drei Seiten
nacheinander lesen muss.

## ADDED Requirements

### Requirement: Eine Zeile ganz oben auf drei Seiten
Überblick, Lagebild und Lagemonitor SHALL die Alarmzeile als erstes Element unter dem Seitenkopf
zeigen, vor jedem Kennzahlenband. Überblick und Lagebild MUST für denselben Einsatz zur selben
Minute dieselben Einträge in derselben Folge zeigen.

#### Scenario: Vermisste Person im Überblick
- **WHEN** im Einsatz eine Person den Status „vermisst“ trägt
- **THEN** zeigt die Alarmzeile im Überblick und im Lagebild den Eintrag „1 vermisst“ in der Alarmrolle

#### Scenario: Gleiche Zeile auf beiden Übersichten
- **WHEN** Überblick und Lagebild denselben Einsatz zur selben Minute zeigen
- **THEN** tragen beide Alarmzeilen dieselben Einträge in derselben Reihenfolge

### Requirement: Quellen in der Alarmrolle
Die Alarmzeile SHALL je Art einen Eintrag in der Alarmrolle zeigen, sobald die Art mindestens
einmal vorliegt:
- offene Sofortmeldungen, ab Eingang
- Meldungen mit überfälliger Bestätigung
- Einheiten mit überfälliger Rückmeldung
- Einheiten mit Ausfall
- Vermisste
- Abschnitte mit dem Lagezustand „kritisch“
- überfällige Aufträge

Jede Zahl MUST aus derselben Heimat kommen wie an ihrer Stelle im Modul.

#### Scenario: Frische Sofortmeldung
- **WHEN** vor einer Minute eine Sofortmeldung eingegangen ist und ihre Bestätigungsfrist noch läuft
- **THEN** steht „1 Sofortmeldung“ in der Alarmrolle in der Zeile, ohne auf den Ablauf der Frist zu warten

#### Scenario: Rückmeldung überfällig
- **WHEN** die Rückmeldung des Logistiktrupps seit 47 Minuten und die des Sanitätszugs seit 12 Minuten überfällig ist
- **THEN** zeigt die Zeile „Rückmeldung überfällig: Logistiktrupp, Sanitätszug · längste 47 min“ in der Alarmrolle

#### Scenario: Ausfall wie im Meldebild
- **WHEN** das Meldebild beim Logistiktrupp, und nur dort, einen Ausfall nennt
- **THEN** zeigt die Zeile „Ausfall: Logistiktrupp“ in der Alarmrolle

#### Scenario: Gepflegter Lagezustand planmäßig
- **WHEN** ein Abschnitt den Lagezustand „planmäßig“ trägt und eine Rückmeldung darin überfällig ist
- **THEN** nennt die Zeile die Rückmeldung, aber keinen kritischen Abschnitt

### Requirement: Quellen in der Achtungsrolle
Die Alarmzeile SHALL in der Achtungsrolle zeigen: offene dringende Meldungen, fällige
Erinnerungen und überfällige Nachforderungen. Abschnitte im Lagezustand „angespannt“ MUST NOT in
der Zeile stehen.

#### Scenario: Fällige Erinnerung
- **WHEN** eine Erinnerung fällig und noch offen ist
- **THEN** steht „1 Erinnerung fällig“ in der Achtungsrolle in der Zeile

#### Scenario: Angespannter Abschnitt
- **WHEN** ein Abschnitt den Lagezustand „angespannt“ trägt und sonst nichts vorliegt
- **THEN** zeigt die Zeile „Nichts brennt“

### Requirement: Folge nach Dringlichkeit
Die Alarmzeile SHALL alle Einträge der Alarmrolle vor allen Einträgen der Achtungsrolle zeigen.
Innerhalb einer Rolle MUST die Folge fest sein: Sofortmeldungen, Bestätigung überfällig, Vermisste,
kritische Abschnitte, Rückmeldung überfällig, Ausfall, Aufträge überfällig; dann dringende
Meldungen, fällige Erinnerungen, überfällige Nachforderungen.

#### Scenario: Rot vor Gelb
- **WHEN** eine fällige Erinnerung und ein überfälliger Auftrag vorliegen
- **THEN** steht der überfällige Auftrag vor der Erinnerung

#### Scenario: Feste Folge innerhalb der Alarmrolle
- **WHEN** ein überfälliger Auftrag, eine vermisste Person und eine offene Sofortmeldung vorliegen
- **THEN** lautet die Folge Sofortmeldung, vermisst, Auftrag überfällig

### Requirement: Feste Höhe ohne Sprung
Die Alarmzeile SHALL immer stehen und ihre Höhe nicht mit der Zahl der Einträge ändern. Einträge,
die nicht in die Zeile passen, MUST als „+n“ zusammengefasst werden; ein Klick auf „+n“ MUST alle
Einträge als Liste zeigen. Text MUST mindestens 16 px groß sein.

#### Scenario: Neuer Eintrag während der Betrachtung
- **WHEN** während der Betrachtung ein Eintrag hinzukommt
- **THEN** verschiebt sich der Inhalt unter der Zeile nicht

#### Scenario: Zu viele Einträge
- **WHEN** acht Arten vorliegen und in die Breite nur drei passen
- **THEN** zeigt die Zeile drei Einträge und „+5“, und ein Klick auf „+5“ zeigt alle acht

### Requirement: Ruhe nur bei vollständigen Quellen
Liegt kein Eintrag vor und sind alle Quellen geladen, SHALL die Zeile in neutraler Rolle „Nichts
brennt“ zeigen. Ist eine erlaubte Quelle noch nicht geladen oder gescheitert, MUST die Zeile das
nennen und MUST NOT „Nichts brennt“ zeigen. Quellen eines Moduls, das der Betrachter nicht lesen
darf oder das nicht freigegeben ist, MUST die Zeile weglassen, ohne den Stand als unvollständig zu
melden.

#### Scenario: Ruhige Lage
- **WHEN** alle Quellen geladen sind und keine Art vorliegt
- **THEN** zeigt die Zeile „Nichts brennt“ in der neutralen Rolle

#### Scenario: Rückmeldungen nicht geladen
- **WHEN** die Rückmeldungen nicht abrufbar sind und sonst nichts vorliegt
- **THEN** zeigt die Zeile nicht „Nichts brennt“, sondern dass der Stand unvollständig ist

#### Scenario: Modul nicht erlaubt
- **WHEN** der Betrachter das Modul Aufträge nicht lesen darf und sonst nichts vorliegt
- **THEN** zeigt die Zeile „Nichts brennt“ und keinen Eintrag zu Aufträgen

### Requirement: Sprung zur Stelle
Jeder Eintrag in Überblick und Lagebild SHALL ein Link zu der Stelle sein, an der die Art bearbeitet
wird: Meldungen, Meldebild, Personen mit Status „vermisst“, Einsatzabschnitte, Aufträge,
Erinnerungen oder Nachforderungen. Auf dem Lagemonitor MUST die Zeile ohne Bedienung bleiben.

#### Scenario: Sprung zu den Vermissten
- **WHEN** jemand im Lagebild auf „1 vermisst“ klickt
- **THEN** öffnet sich die Personenliste gefiltert auf den Status „vermisst“

### Requirement: Zeit läuft ohne neue Daten weiter
Die Alarmzeile SHALL Fristen gegen die laufende Uhr der Seite urteilen. Eine Rückmeldung, die ohne
neue Daten überfällig wird, MUST spätestens nach einer Minute in der Zeile stehen.

#### Scenario: Frist läuft ab
- **WHEN** die Rückmeldefrist einer Einheit abläuft, ohne dass neue Daten eintreffen
- **THEN** steht die Einheit innerhalb einer Minute in der Zeile
