# Spec Delta

## MODIFIED Requirements

### Requirement: Angaben der eigenen Führungsstelle
Ein Einsatz SHALL genau eine eigene Führungsstelle tragen. Sie hat eine Art (`mobil` oder
`ortsfest`) und sieben optionale Angaben: Bezeichnung, Standort (Adresse und Koordinate), Rufname,
Sprechgruppen (TMO und DMO), Kommunikationsmittel, Erreichbarkeit und Führungsfahrzeuge (null oder
mehr disponierte Fahrzeuge dieses Einsatzes, die die Führungsstelle tragen). Ist keine der sieben
Angaben gesetzt, gilt die Führungsstelle als nicht erfasst; die Art allein macht sie nicht
erfasst. Die Führungsstelle je Person (Einsatzmitgliedschaft) MUST davon unberührt bleiben.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird
- **THEN** liefert der Abruf der Führungsstelle die Art `mobil` und alle sieben Angaben leer, und sie gilt als nicht erfasst

#### Scenario: Nur Rufname
- **WHEN** nur der Rufname „Florian Musterstadt 10/1“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Sprechgruppen, Kommunikationsmittel und Erreichbarkeit bleiben leer

#### Scenario: Nur ein Fahrzeug
- **WHEN** der Führungsstelle nur der disponierte ELW 2 „Florian Musterstadt 10/1“ zugeordnet ist
- **THEN** gilt sie als erfasst, und Rufname, Sprechgruppen, Kommunikationsmittel und Erreichbarkeit bleiben leer

#### Scenario: Nur Bezeichnung
- **WHEN** nur die Bezeichnung „TEL Rathaus“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Standort, Rufname und Führungsfahrzeuge bleiben leer

#### Scenario: Nur die Art geändert
- **WHEN** an einem neuen Einsatz nur die Art auf `ortsfest` gesetzt wird
- **THEN** liefert der Abruf die Art `ortsfest`, und die Führungsstelle gilt weiter als nicht erfasst

#### Scenario: Fahrzeug wird entlassen
- **WHEN** ein der Führungsstelle zugeordnetes Fahrzeug aus dem Einsatz entlassen wird
- **THEN** ist es der Führungsstelle nicht mehr zugeordnet

### Requirement: Bearbeitung auf der Seite Einsatzdaten
Die Seite Einsatzdaten SHALL ein Paneel „Eigene Führungsstelle“ mit Art, Bezeichnung, Standort,
Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Führungsfahrzeugen zeigen. Jede
Angabe MUST einzeln in der Leseansicht bearbeitbar sein und beim Speichern genau ihr eigenes Feld
senden; der Standort sendet Adresse und Koordinate zusammen. Ein unveränderter Wert sendet nichts.
Ohne Schreibrecht MUST keine Angabe eine Aufforderung tragen, leere Angaben zeigen „—“. Ein
Speicherfehler MUST an der Zeile stehen.

#### Scenario: Sprechgruppen zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Sprechgruppen“ die Sprechgruppen „TMO 311“ und „DMO 505“ wählt und speichert
- **THEN** zeigt die Zeile beide nach Betriebsart, und die Anfrage trug nur die Sprechgruppen

#### Scenario: ELW 2 zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Führungsfahrzeuge“ den ELW 2 „Florian Musterstadt 10/1“ wählt und speichert
- **THEN** zeigt die Zeile „Florian Musterstadt 10/1 (ELW 2)“, und die Anfrage trug nur die Fahrzeuge

#### Scenario: Fahrzeuge nicht freigegeben
- **WHEN** eine Person ohne Freigabe für Fahrzeuge das Paneel öffnet
- **THEN** zeigt die Zeile „Führungsfahrzeuge“ „nicht freigegeben“ ohne Aufforderung, und die übrigen Angaben bleiben bedienbar

#### Scenario: Beobachter sieht die Angaben
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** zeigt das Paneel die Angaben ohne Bearbeiten- oder Eintragen-Aufforderung

#### Scenario: Art wählen
- **WHEN** eine schreibberechtigte Person an der Zeile „Art“ „ortsfest“ wählt und speichert
- **THEN** zeigt die Zeile „ortsfest“, und die Anfrage trug nur die Art

### Requirement: Erreichbarkeit wird geschwärzt
Die Erreichbarkeit der Führungsstelle ist personenbezogen und MUST bei der Schwärzung des Einsatzes
entfernt werden. Adresse und Koordinate ihres Standorts können eine Privatadresse verraten und MUST
ebenfalls entfernt werden. Art, Bezeichnung, Rufname, Kommunikationsmittel und
Sprechgruppen-Zuordnung SHALL als Führungsstruktur erhalten bleiben.

#### Scenario: Schwärzung nach Fristablauf
- **WHEN** ein Einsatz mit erfasster Führungsstelle geschwärzt wird
- **THEN** ist ihre Erreichbarkeit leer, und Rufname, Kommunikationsmittel und Sprechgruppen sind unverändert

#### Scenario: Standort wird mitgeschwärzt
- **WHEN** ein Einsatz geschwärzt wird, dessen Führungsstelle „ELW 2 Musterstadt“ mit Adresse und Koordinate trägt
- **THEN** sind Adresse und Koordinate leer, und Art und Bezeichnung „ELW 2 Musterstadt“ sind unverändert

## ADDED Requirements

### Requirement: Art der Führungsstelle
Die Art SHALL `mobil` oder `ortsfest` sein und ohne gespeicherte Angabe `mobil` lauten (Vorgabe).
Sie MUST sich wie jede Angabe einzeln ändern lassen, aber nicht leeren: `null`, leerer Text oder
ein unbekannter Wert ergeben 400, ohne eine Angabe des Aufrufs zu speichern.

#### Scenario: Unbekannte Art
- **WHEN** als Art „stationaer“ gesendet wird
- **THEN** antwortet der Server mit 400, und keine Angabe des Aufrufs ist gespeichert

#### Scenario: Art leeren
- **WHEN** als Art `null` gesendet wird
- **THEN** antwortet der Server mit 400, und die gespeicherte Art bleibt

### Requirement: Standort der Führungsstelle
Der Standort SHALL aus einer Adresse (Freitext) und einer Koordinate (Breite und Länge) bestehen;
beide Teile sind einzeln optional. Die Koordinate MUST als Paar gesetzt oder geleert werden und
Breite −90 bis 90 sowie Länge −180 bis 180 einhalten; jede Verletzung ergibt 422, geprüft am Stand
nach der Änderung, ohne eine Angabe des Aufrufs zu speichern.

#### Scenario: Adresse und Koordinate
- **WHEN** Adresse „Hauptstraße 1, Musterstadt“, Breite 52,1 und Länge 9,9 gespeichert werden
- **THEN** liefert der Abruf alle drei Werte, und die Führungsstelle gilt als erfasst

#### Scenario: Halbe Koordinate
- **WHEN** nur die Breite gesendet wird und keine Länge gespeichert ist
- **THEN** antwortet der Server mit 422, und keine Angabe des Aufrufs ist gespeichert

#### Scenario: Breite außerhalb
- **WHEN** als Breite 95 und als Länge 9,9 gesendet werden
- **THEN** antwortet der Server mit 422

### Requirement: Längengrenzen von Bezeichnung und Adresse
Die Bezeichnung MUST höchstens 200 Zeichen und die Adresse höchstens 500 Zeichen lang sein; ein
längerer Wert ergibt 400, ohne eine Angabe des Aufrufs zu speichern. Führende und folgende
Leerzeichen MUST vor dem Speichern entfernt werden.

#### Scenario: Bezeichnung zu lang
- **WHEN** eine Bezeichnung mit 201 Zeichen gesendet wird
- **THEN** antwortet der Server mit 400

### Requirement: Standort im Paneel erfassen
Die Zeile „Standort“ SHALL eine Adresse als Text und eine Koordinate über die Koordinateneingabe
annehmen. Trägt der Einsatz einen Einsatzort, SHALL sie „wie Einsatzort“ anbieten: das übernimmt
Adresse und Koordinate des Einsatzorts einmalig in die Eingabe. Eine spätere Änderung des
Einsatzorts MUST NOT den Standort der Führungsstelle ändern.

#### Scenario: Wie Einsatzort übernehmen
- **WHEN** der Einsatzort „Industriestraße 4“ mit Koordinate trägt und eine schreibberechtigte Person an der Zeile „Standort“ „wie Einsatzort“ wählt und speichert
- **THEN** zeigt die Zeile „Industriestraße 4“ mit der Koordinate, und die Anfrage trug nur Adresse und Koordinate

#### Scenario: Einsatzort ändert sich danach
- **WHEN** nach der Übernahme der Einsatzort auf „Industriestraße 8“ geändert wird
- **THEN** zeigt der Standort der Führungsstelle weiter „Industriestraße 4“

### Requirement: Führungsfahrzeuge bei ortsfester Führungsstelle
Bei der Art `ortsfest` SHALL die Zeile „Führungsfahrzeuge“ eingeklappt stehen und sich aufklappen
lassen; zugeordnete Fahrzeuge MUST dabei erhalten bleiben und eingeklappt als Anzahl genannt
werden. Keine Art MUST ein Führungsfahrzeug verlangen.

#### Scenario: Ortsfest ohne Fahrzeug
- **WHEN** die Führungsstelle `ortsfest` ist und kein Fahrzeug trägt
- **THEN** steht die Zeile „Führungsfahrzeuge“ eingeklappt, und das Paneel verlangt keine Angabe

#### Scenario: Ortsfest mit Fahrzeug
- **WHEN** eine ortsfeste Führungsstelle ein Fernmeldefahrzeug trägt
- **THEN** nennt die eingeklappte Zeile „1 Führungsfahrzeug“, und das Fahrzeug bleibt zugeordnet
