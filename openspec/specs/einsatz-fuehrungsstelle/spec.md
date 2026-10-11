# einsatz-fuehrungsstelle Specification

## Purpose
Hält je Einsatz die eigene Führungsstelle (ELW, Einsatzleitung) als Gegenstelle für Funkplan und
Fernmeldeskizze fest: Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und die
Fahrzeuge, die sie tragen, samt Rechten, Live-Verhalten und Schwärzung.

## Requirements

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

### Requirement: Lesen mit dem Einsatz
Jede Person, die den Einsatz lesen darf, SHALL die Führungsstelle lesen können, unabhängig von
ihren Modulfreigaben. Wer den Einsatz nicht lesen darf, MUST eine Ablehnung erhalten wie beim
Einsatzkopf.

#### Scenario: Beobachter liest
- **WHEN** eine Person mit der Rolle Beobachter die Führungsstelle abruft
- **THEN** erhält sie die gespeicherten Angaben

#### Scenario: Fremde Person
- **WHEN** eine Person ohne Lesezugriff auf den Einsatz die Führungsstelle abruft
- **THEN** wird der Abruf abgelehnt, ohne Angaben preiszugeben

### Requirement: Ändern als Teil-Patch mit den Rechten der Kopfdaten
Die Führungsstelle SHALL sich mit denselben Rechten ändern lassen wie die Kopfdaten des Einsatzes.
Jede Angabe MUST einzeln änderbar sein: eine fehlende Angabe bleibt unverändert, `null` oder leerer
Text leert sie. Gesendete Sprechgruppen MUST die Zuordnung vollständig ersetzen. An einem nicht
aktiven Einsatz MUST jede Änderung abgelehnt werden.

#### Scenario: Zwei Angaben nacheinander
- **WHEN** Person A den Rufname und Person B danach aus einem älteren Stand die Erreichbarkeit speichert
- **THEN** trägt die Führungsstelle beide Angaben

#### Scenario: Beobachter ändert
- **WHEN** eine Person mit der Rolle Beobachter die Führungsstelle ändern will
- **THEN** wird die Änderung mit 403 abgelehnt

#### Scenario: Abgeschlossener Einsatz
- **WHEN** an einem abgeschlossenen Einsatz eine Angabe der Führungsstelle gesendet wird
- **THEN** wird die Änderung mit 409 abgelehnt

### Requirement: Prüfung der Angaben
Das Kommunikationsmittel MUST einer der Werte sein, die auch Abschnitt und Einheit annehmen; ein
unbekannter Wert ergibt 400. Eine Sprechgruppe MUST dem Katalog der Organisation oder den
einsatzlokalen Sprechgruppen dieses Einsatzes angehören; jede andere ergibt 422. Eine abgelehnte
Änderung MUST keine Angabe teilweise speichern.

#### Scenario: Fremde Sprechgruppe
- **WHEN** die Sprechgruppen einer anderen Organisation oder eines anderen Einsatzes zugeordnet werden sollen
- **THEN** antwortet der Server mit 422, und weder Sprechgruppen noch eine im selben Aufruf gesendete andere Angabe sind gespeichert

#### Scenario: Unbekanntes Kommunikationsmittel
- **WHEN** als Kommunikationsmittel ein unbekannter Wert gesendet wird
- **THEN** antwortet der Server mit 400

### Requirement: Fahrzeuge der Führungsstelle
Der Abruf SHALL die zugeordneten Fahrzeuge nur als IDs der Disposition liefern, nie mit
Funkrufname, Typ oder anderen Fahrzeugdaten. Gesendete Fahrzeuge MUST die Zuordnung vollständig
ersetzen. Ein Fahrzeug, das diesem Einsatz nicht disponiert ist, MUST mit 422 abgelehnt werden,
ohne eine Angabe teilweise zu speichern.

#### Scenario: Fremdes Fahrzeug
- **WHEN** zusammen mit einem Rufname ein Fahrzeug eines anderen Einsatzes gesendet wird
- **THEN** wird die Änderung mit 422 abgelehnt, und auch der Rufname bleibt unverändert

#### Scenario: Ohne Fahrzeug-Freigabe lesen
- **WHEN** eine Person ohne Freigabe für Fahrzeuge die Führungsstelle abruft
- **THEN** erhält sie die Fahrzeug-IDs, aber keine Fahrzeugdaten

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

### Requirement: Änderung erreicht jeden Schirm
Eine erfolgreiche Änderung der Führungsstelle SHALL nach dem Commit das Ereignis `einsatz`
verteilen. Jede Ansicht, die die Führungsstelle zeigt, MUST sie daraufhin ohne Neuladen der Seite
neu abrufen. Eine abgelehnte Änderung MUST kein Ereignis verteilen.

#### Scenario: Funkplan offen
- **WHEN** auf Schirm A der Rufname der Führungsstelle gespeichert wird und Schirm B den Funkplan offen hat
- **THEN** zeigt Schirm B die Zeile der Führungsstelle mit dem neuen Rufnamen ohne Neuladen

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
