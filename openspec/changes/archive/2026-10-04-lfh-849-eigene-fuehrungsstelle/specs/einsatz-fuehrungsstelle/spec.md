# Spec Delta

## Purpose

Hält je Einsatz die eigene Führungsstelle (ELW, Einsatzleitung) als Gegenstelle für Funkplan und
Fernmeldeskizze fest: Rufname, Sprechgruppen, Kommunikationsmittel und Erreichbarkeit, samt Rechten,
Live-Verhalten und Schwärzung.

## ADDED Requirements

### Requirement: Angaben der eigenen Führungsstelle
Ein Einsatz SHALL genau eine eigene Führungsstelle mit vier optionalen Angaben tragen: Rufname,
Sprechgruppen (TMO und DMO), Kommunikationsmittel und Erreichbarkeit. Ist keine Angabe gesetzt,
gilt die Führungsstelle als nicht erfasst. Die Führungsstelle je Person (Einsatzmitgliedschaft)
MUST davon unberührt bleiben.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird
- **THEN** liefert der Abruf der Führungsstelle alle vier Angaben leer, und sie gilt als nicht erfasst

#### Scenario: Nur Rufname
- **WHEN** nur der Rufname „Florian Musterstadt 10/1“ gespeichert ist
- **THEN** gilt die Führungsstelle als erfasst, und Sprechgruppen, Kommunikationsmittel und Erreichbarkeit bleiben leer

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

### Requirement: Bearbeitung auf der Seite Einsatzdaten
Die Seite Einsatzdaten SHALL ein Paneel „Eigene Führungsstelle“ mit den vier Angaben zeigen. Jede
Angabe MUST einzeln in der Leseansicht bearbeitbar sein und beim Speichern genau ihr eigenes Feld
senden; ein unveränderter Wert sendet nichts. Ohne Schreibrecht MUST keine Angabe eine Aufforderung
tragen, leere Angaben zeigen „—“. Ein Speicherfehler MUST an der Zeile stehen.

#### Scenario: Sprechgruppen zuordnen
- **WHEN** eine schreibberechtigte Person an der Zeile „Sprechgruppen“ die Sprechgruppen „TMO 311“ und „DMO 505“ wählt und speichert
- **THEN** zeigt die Zeile beide nach Betriebsart, und die Anfrage trug nur die Sprechgruppen

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
