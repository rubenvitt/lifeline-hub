# einsatz-fuehrungsstelle Specification

## Purpose
Hält je Einsatz die eigene Führungsstelle (ELW, Einsatzleitung) als Gegenstelle für Funkplan und
Fernmeldeskizze fest: Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und die
Fahrzeuge, die sie tragen, samt Rechten, Live-Verhalten und Schwärzung.

## Requirements

### Requirement: Angaben der eigenen Führungsstelle
Ein Einsatz SHALL genau eine eigene Führungsstelle mit fünf optionalen Angaben tragen: Rufname,
Sprechgruppen (TMO und DMO), Kommunikationsmittel, Erreichbarkeit und Fahrzeuge (null oder mehr
disponierte Fahrzeuge dieses Einsatzes, die die Führungsstelle tragen). Ist keine Angabe gesetzt,
gilt die Führungsstelle als nicht erfasst. Die Führungsstelle je Person (Einsatzmitgliedschaft)
MUST davon unberührt bleiben.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird
- **THEN** liefert der Abruf der Führungsstelle alle fünf Angaben leer, und sie gilt als nicht erfasst

#### Scenario: Nur Rufname
- **WHEN** nur der Rufname „Florian Musterstadt 10/1“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Sprechgruppen, Kommunikationsmittel und Erreichbarkeit bleiben leer

#### Scenario: Nur ein Fahrzeug
- **WHEN** der Führungsstelle nur der disponierte ELW 2 „Florian Musterstadt 10/1“ zugeordnet ist
- **THEN** gilt sie als erfasst, und Rufname, Sprechgruppen, Kommunikationsmittel und Erreichbarkeit bleiben leer

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
Die Seite Einsatzdaten SHALL ein Paneel „Eigene Führungsstelle“ mit den fünf Angaben zeigen. Jede
Angabe MUST einzeln in der Leseansicht bearbeitbar sein und beim Speichern genau ihr eigenes Feld
senden; ein unveränderter Wert sendet nichts. Ohne Schreibrecht MUST keine Angabe eine Aufforderung
tragen, leere Angaben zeigen „—“. Ein Speicherfehler MUST an der Zeile stehen.

#### Scenario: Sprechgruppen zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Sprechgruppen“ die Sprechgruppen „TMO 311“ und „DMO 505“ wählt und speichert
- **THEN** zeigt die Zeile beide nach Betriebsart, und die Anfrage trug nur die Sprechgruppen

#### Scenario: ELW 2 zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Fahrzeuge“ den ELW 2 „Florian Musterstadt 10/1“ wählt und speichert
- **THEN** zeigt die Zeile „Florian Musterstadt 10/1 (ELW 2)“, und die Anfrage trug nur die Fahrzeuge

#### Scenario: Fahrzeuge nicht freigegeben
- **WHEN** eine Person ohne Freigabe für Fahrzeuge das Paneel öffnet
- **THEN** zeigt die Zeile „Fahrzeuge“ „nicht freigegeben“ ohne Aufforderung, und die übrigen Angaben bleiben bedienbar

#### Scenario: Beobachter sieht die Angaben
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** zeigt das Paneel die Angaben ohne Bearbeiten- oder Eintragen-Aufforderung

### Requirement: Änderung erreicht jeden Schirm
Eine erfolgreiche Änderung der Führungsstelle SHALL nach dem Commit das Ereignis `einsatz`
verteilen. Jede Ansicht, die die Führungsstelle zeigt, MUST sie daraufhin ohne Neuladen der Seite
neu abrufen. Eine abgelehnte Änderung MUST kein Ereignis verteilen.

#### Scenario: Funkplan offen
- **WHEN** auf Schirm A der Rufname der Führungsstelle gespeichert wird und Schirm B den Funkplan offen hat
- **THEN** zeigt Schirm B die Zeile der Führungsstelle mit dem neuen Rufnamen ohne Neuladen

### Requirement: Erreichbarkeit wird geschwärzt
Die Erreichbarkeit der Führungsstelle ist personenbezogen und MUST bei der Schwärzung des Einsatzes
entfernt werden. Rufname, Kommunikationsmittel und Sprechgruppen-Zuordnung SHALL als
Führungsstruktur erhalten bleiben.

#### Scenario: Schwärzung nach Fristablauf
- **WHEN** ein Einsatz mit erfasster Führungsstelle geschwärzt wird
- **THEN** ist ihre Erreichbarkeit leer, und Rufname, Kommunikationsmittel und Sprechgruppen sind unverändert
