# Spec Delta

## Purpose

Zeigt die Fundorte betroffener Personen als eigene, standardmäßig ausgeschaltete Ebene
„Betroffene“ auf der Lagekarte, ausschließlich für Benutzer mit Zugriff auf das Modul
„Personen“ und ohne Namen, damit die Führung Fundorte und Kräfte auf einem Blatt sieht.

## ADDED Requirements

### Requirement: Ebene „Betroffene“ auf der Lagekarte
Die Lagekarte SHALL eine Ebene „Betroffene“ führen. Ist sie eingeschaltet, MUST jede Person
des Einsatzes als Marker an ihrer Fundort-Koordinate erscheinen, sofern sie nicht storniert
ist, als angetroffen gilt (Status erfasst, betroffen oder verstorben) und ein vollständiges
Koordinatenpaar trägt. Vermisste und abgemeldete Personen sowie Personen ohne Koordinate
MUST NOT erscheinen. Die Auswahl MUST dieselbe sein wie in der Kartenansicht der
Betroffenen-Seite. Die Ebenen-Zeile MUST die Zahl der gezeichneten Personen zeigen.

#### Scenario: Eingeschaltete Ebene zeigt angetroffene Personen
- **WHEN** ein Benutzer mit Zugriff auf „Personen“ die Ebene „Betroffene“ einschaltet und der Einsatz eine betroffene Person mit Koordinate, eine vermisste Person mit Koordinate und eine betroffene Person ohne Koordinate hat
- **THEN** zeigt die Karte genau einen Personen-Marker, und die Ebenen-Zeile nennt die Anzahl 1

#### Scenario: Verstorbene erscheinen
- **WHEN** die Ebene an ist und eine Person mit Status „verstorben“ und Koordinate existiert
- **THEN** erscheint sie als Marker mit dem Sichtungskürzel für „tot“

#### Scenario: Live-Aktualisierung
- **WHEN** die Ebene an ist und an anderer Stelle eine Fundort-Koordinate gesetzt wird
- **THEN** erscheint der Marker ohne Neuladen der Seite

### Requirement: Vorgabe „aus“
Die Ebene „Betroffene“ MUST ausgeschaltet sein, solange niemand sie ausdrücklich
eingeschaltet hat. Das gilt für neue und für bestehende gespeicherte Kartenansichten, die
den Schalter noch nicht kennen. Das Einschalten MUST wie jeder andere Ebenen-Schalter die
Ansicht als geändert markieren und mit ihr gespeichert werden.

#### Scenario: Bestehende Ansicht ohne Schalterwert
- **WHEN** eine Kartenansicht geöffnet wird, die vor dieser Änderung gespeichert wurde
- **THEN** ist die Ebene „Betroffene“ aus, und die übrigen Ebenen behalten ihren gespeicherten Zustand

#### Scenario: Einschalten wird mit der Ansicht gespeichert
- **WHEN** ein Benutzer die Ebene einschaltet und die Ansicht speichert
- **THEN** ist die Ebene beim nächsten Öffnen dieser Ansicht an

### Requirement: Zugriffsgrenze am Modul „Personen“
Personen MUST auf der Lagekarte ausschließlich für Benutzer sichtbar sein, denen das Modul
„Personen“ im Einsatz freigegeben ist. Die Grenze MUST am Datenzugriff liegen, nicht am
Schalter: auch eine gespeicherte Ansicht mit eingeschalteter Ebene MUST für einen Benutzer
ohne Zugriff keinen Personen-Marker, keine Anzahl und keine Cluster-Zahl aus Personen
erzeugen. Eine abgelehnte Anfrage wegen fehlender Berechtigung MUST NOT als Ausfall einer
Lagebild-Quelle gemeldet werden. Ist das Modul im Einsatz ausgeblendet, MUST die
Ebenen-Zeile fehlen. Ist es für den Benutzer gesperrt oder lehnt der Server den Zugriff ab,
MUST die Zeile gesperrt dastehen, mit dem Grund „Keine Berechtigung“ und ohne Anzahl. Der
Zustand des Schalters in der geteilten Ansicht MUST für Benutzer ohne Zugriff unverändert
bleiben.

#### Scenario: Geteilte Ansicht mit eingeschalteter Ebene, Benutzer ohne Zugriff
- **WHEN** eine Führungskraft eine Ansicht mit eingeschalteter Ebene „Betroffene“ speichert und ein Benutzer, dem das Modul „Personen“ gesperrt ist, diese Ansicht öffnet
- **THEN** sieht er keinen Personen-Marker und keine Anzahl, die Zeile steht gesperrt mit „Keine Berechtigung“, und es erscheint kein Ausfallhinweis

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul „Personen“ im Einsatz ausgeblendet ist
- **THEN** zeigt die Lagekarte keine Ebenen-Zeile „Betroffene“ und keine Personen-Marker

#### Scenario: Server lehnt trotz Freigabe im Client ab
- **WHEN** der Client das Modul für freigegeben hält, der Server die Personenliste aber mit 403 ablehnt
- **THEN** werden keine Personen gezeichnet, die Zeile steht gesperrt, und es erscheint kein Ausfallhinweis

#### Scenario: Echter Ausfall der Quelle
- **WHEN** das Modul freigegeben ist und die Personenliste mit einem Serverfehler (5xx) scheitert
- **THEN** meldet der Ausfallhinweis die Quelle „Betroffene“

#### Scenario: Schalter bleibt für Berechtigte erhalten
- **WHEN** ein Benutzer ohne Zugriff eine geteilte Ansicht mit eingeschalteter Ebene öffnet und eine andere Ebene umschaltet und speichert
- **THEN** bleibt die Ebene „Betroffene“ in der gespeicherten Ansicht eingeschaltet

### Requirement: Beschriftung ohne Namen
Plakette und Inspector-Titel eines Personen-Markers MUST ausschließlich die Registriernummer
und die Sichtung zeigen (z. B. „R-042 · SK II“, ohne Sichtung „R-042 · ohne Sichtung“).
Name, Vorname und andere personenbezogene Angaben MUST NOT auf der Lagekarte erscheinen,
auch dann nicht, wenn sie an der Person erfasst sind. Die Sichtung MUST zusätzlich zur Farbe
als Kürzel im Marker stehen (SK I–IV als I–IV, tot als T, unverletzt als U, ohne Sichtung
als –).

#### Scenario: Erfasster Name erscheint nicht
- **WHEN** eine Person mit Name „Kowalski“, Vorname „Anna“, Registriernummer 42 und Sichtung SK II auf der Lagekarte erscheint und ausgewählt wird
- **THEN** lautet die Beschriftung „R-042 · SK II“, der Inspector-Titel ebenso, und weder „Kowalski“ noch „Anna“ steht auf der Karte oder im Inspector

### Requirement: Eigenes Clustering der Betroffenen
Personen-Marker MUST nur untereinander clustern. Ein Cluster MUST NOT Personen und andere
Marker (Einheiten, Fahrzeuge, Führung, Schäden, UHS, Abschnitte, Lagemeldungen, freie
Zeichen) zusammenfassen. Personen-Marker und ihre Cluster MUST unterhalb der übrigen Marker
gezeichnet werden. Ein Personen-Cluster MUST sich wie die übrigen Cluster auffächern lassen,
und aufgefächerte Personen MUST wie Einzelmarker anwählbar sein.

#### Scenario: Personen verdecken keine Kräfte
- **WHEN** auf engem Raum 30 Personen und ein Fahrzeug stehen und die Ebene „Betroffene“ an ist
- **THEN** bleibt das Fahrzeug als eigener Marker sichtbar, und die Personen erscheinen als Personen-Cluster

#### Scenario: Personen-Cluster auffächern
- **WHEN** ein Personen-Cluster mit wenigen Personen angeklickt wird
- **THEN** fächert er auf, und ein Klick auf eine aufgefächerte Person wählt sie im Inspector aus

### Requirement: Sichtungslegende
Ist die Ebene „Betroffene“ an und für den Benutzer zugänglich, MUST die Lagekarte eine
Legende zeigen, die jede Sichtungskategorie mit ihrer Farbe, ihrem Kürzel und ihrem Wort
nennt: SK I bis SK IV, tot, unverletzt und ohne Sichtung. Ist die Ebene aus oder nicht
zugänglich, MUST die Legende fehlen.

#### Scenario: Legende bei eingeschalteter Ebene
- **WHEN** ein Benutzer mit Zugriff die Ebene „Betroffene“ einschaltet
- **THEN** erscheint die Sichtungslegende mit sieben Einträgen

#### Scenario: Keine Legende ohne Ebene
- **WHEN** die Ebene aus ist
- **THEN** ist keine Sichtungslegende zu sehen

### Requirement: Inspector für Personen
Wird ein Personen-Marker ausgewählt, MUST das Paneel „Ausgewählt“ die Person als
„Person“ ausweisen und einen Link „Im Fachmodul öffnen“ auf die Personen-Detailseite
dieser Person anbieten. Für schreibberechtigte Benutzer MUST „Verortung löschen“ die
Fundort-Koordinate der Person entfernen; danach MUST der Marker verschwinden und die Person
MUST ohne Koordinate weiter bestehen.

#### Scenario: Link auf die Detailseite
- **WHEN** ein Personen-Marker ausgewählt ist und „Im Fachmodul öffnen“ betätigt wird
- **THEN** öffnet sich die Detailseite `/einsaetze/{id}/personen/{personId}` dieser Person

#### Scenario: Verortung löschen
- **WHEN** ein schreibberechtigter Benutzer an einem Personen-Marker „Verortung löschen“ wählt
- **THEN** wird nur die Fundort-Koordinate der Person geleert, der Marker verschwindet, und alle übrigen Angaben der Person bleiben erhalten

### Requirement: Betroffene beeinflussen Startausschnitt und Kopfzahl nicht
Der Startausschnitt der Lagekarte und die Kopfzahl „verortet“ MUST ohne Personen berechnet
werden, unabhängig davon, ob die Ebene „Betroffene“ an ist oder der Benutzer Zugriff hat.

#### Scenario: Gleiche Kopfzahl mit und ohne Zugriff
- **WHEN** zwei Benutzer, einer mit und einer ohne Zugriff auf „Personen“, dieselbe Lagekarte öffnen
- **THEN** zeigen beide dieselbe Zahl „verortet“ und denselben Startausschnitt

### Requirement: Historien-Modus ohne Betroffene
Gesicherte Lagestände MUST keine Personen enthalten. Im Historien-Modus MUST die Lagekarte
keine Personen zeichnen, und die Ebenen-Zeile „Betroffene“ MUST gesperrt dastehen, mit dem
Grund, dass Betroffene nicht in gesicherte Lagestände übernommen werden, und ohne Anzahl.

#### Scenario: Rückblick auf einen gesicherten Stand
- **WHEN** ein Benutzer mit Zugriff und eingeschalteter Ebene einen gesicherten Lagestand öffnet
- **THEN** zeigt die Karte keine Personen, und die Zeile „Betroffene“ ist gesperrt mit Begründung und ohne Anzahl
