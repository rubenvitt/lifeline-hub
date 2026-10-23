# formularseiten Specification

## Purpose
Formularseiten in Verwaltung und Einstellungen speichern über genau einen sichtbaren Weg, melden
nur, was wirklich gespeichert wurde, und verlieren keine Eingabe still beim Verlassen. Ansichten
eines Datensatzes werden an Ort und Stelle bearbeitet, mit höchstens einer offenen Bearbeitung je
Seite (LLH-1139).

## Requirements

### Requirement: Ein Speicherweg je Formularseite
Eine Formularseite mit Speichern-Leiste SHALL genau einen primären Speicherweg haben. Er MUST
jedes bearbeitbare Feld der Seite erfassen. Ein Feld, das dieser Weg nicht speichert, MUST NOT
auf der Seite stehen. Wege, die sofort wirken (etwa ein Logo hochladen), sind kein Feld.

#### Scenario: Umbenannte Organisation über die Leiste gespeichert
- **WHEN** ein Admin auf der Organisationsseite den Namen ändert und die Leiste „Speichern“ auslöst
- **THEN** wird der neue Name gespeichert und steht nach dem Neuladen der Seite im Feld

#### Scenario: Name und DV-102-Organisation in einem Zug
- **WHEN** ein Admin Name und DV-102-Organisation ändert und einmal speichert
- **THEN** sind danach beide Werte gespeichert

#### Scenario: Kein zweiter Knopf für den Namen
- **WHEN** die Organisationsseite geladen ist
- **THEN** gibt es genau einen Knopf zum Speichern von Name und DV-102-Organisation

### Requirement: Erfolgsmeldung nennt nur Gespeichertes
Die Organisationsseite SHALL nur geänderte Felder senden. Die Erfolgsmeldung MUST genau die
gespeicherten Teile nennen. Ist nichts geändert, MUST kein Speicheraufruf erfolgen, und die
Seite MUST NOT einen Erfolg melden.

#### Scenario: Nur der Name geändert
- **WHEN** ein Admin nur den Namen ändert und speichert
- **THEN** enthält der Aufruf nur den Namen, und die Meldung nennt den Namen, nicht die DV-102-Organisation

#### Scenario: Nichts geändert
- **WHEN** ein Admin ohne Änderung speichert
- **THEN** geht kein Speicheraufruf raus, und es erscheint keine Erfolgsmeldung

### Requirement: Rückfrage vor dem Verlassen
Hat eine Formularseite mit Speichern-Leiste ungespeicherte Änderungen oder hat in einer Ansicht
ein offenes Einzelfeld einen geänderten, ungespeicherten Entwurf, SHALL jeder Wechsel auf
einen anderen Pfad innerhalb der App (Seitenmenü, Segmentleiste, Brotkrume, Link) angehalten
werden. Die Seite MUST nachfragen und „Bleiben“ und „Verwerfen“ anbieten. „Bleiben“ MUST die
Eingaben erhalten, „Verwerfen“ MUST den Wechsel ausführen.

#### Scenario: Reiterwechsel in den Einsatz-Einstellungen
- **WHEN** jemand mit Schreibrecht in „Allgemein“ ein Feld ändert und ohne Speichern den Reiter „Verhalten & Automatik“ wählt
- **THEN** erscheint die Rückfrage, und nach „Bleiben“ steht die Eingabe unverändert im Feld

#### Scenario: Verwerfen führt den Wechsel aus
- **WHEN** auf dem Fahrzeug-Detail das Kennzeichen geändert, ein anderer Menüpunkt gewählt und „Verwerfen“ bestätigt wird
- **THEN** wechselt die Seite zum gewählten Ziel

#### Scenario: Offenes Einzelfeld in einer Ansicht
- **WHEN** im Personen-Detail der Name geöffnet und geändert ist und jemand die Brotkrume „Betroffene“ wählt
- **THEN** erscheint die Rückfrage, und nach „Verwerfen“ wechselt die Seite in die Betroffenenliste

### Requirement: Warnung beim Schließen oder Neuladen
Hat eine Formularseite mit Speichern-Leiste ungespeicherte Änderungen, SHALL der Browser beim
Schließen oder Neuladen des Tabs warnen. Ohne ungespeicherte Änderungen MUST er das nicht.

#### Scenario: Tab schließen mit Änderung
- **WHEN** eine Formularseite ungespeicherte Änderungen hat und der Tab geschlossen wird
- **THEN** zeigt der Browser seine Rückfrage zum Verlassen

### Requirement: Keine Rückfrage ohne offene Änderung
Die Rückfrage und die Browser-Warnung MUST NOT erscheinen, wenn nichts geändert wurde, wenn die
letzte Änderung erfolgreich gespeichert ist, oder wenn die Person kein Schreibrecht hat.
Seiten, die jede Änderung sofort speichern (Einsatz-Einstellungen „Module“), MUST NOT nachfragen.

#### Scenario: Nach dem Speichern
- **WHEN** ein geändertes Feld erfolgreich gespeichert wurde und die Person die Seite verlässt
- **THEN** wechselt die Seite ohne Rückfrage

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht eine Formularseite öffnet und sie verlässt
- **THEN** erscheint keine Rückfrage

#### Scenario: Gescheitertes Speichern
- **WHEN** das Speichern einer Änderung scheitert und die Person die Seite verlassen will
- **THEN** erscheint die Rückfrage

### Requirement: Weitertippen während des Speicherns bleibt geschützt
Ändert die Person ein Feld, während ein Speichern läuft, SHALL der Schutz nach dessen Erfolg
bestehen bleiben, weil die neue Eingabe nicht gespeichert ist.

#### Scenario: Eingabe während des Speicherns
- **WHEN** ein Speichern läuft, die Person ein weiteres Feld ändert und das Speichern danach gelingt
- **THEN** fragt die Seite beim Verlassen weiterhin nach

### Requirement: Eine offene Bearbeitung je Ansicht
Eine Ansicht, deren Angaben paneelweise oder als Ganzes bearbeitet werden, SHALL höchstens eine
offene Bearbeitung zugleich zulassen (ein Paneel oder die ganze Ansicht; ein Einzelfeld mit
geändertem Entwurf zählt mit). Solange eine Bearbeitung offen ist, MUST jedes andere „Bearbeiten“
der Seite gesperrt sein und den Grund „Erst „<Titel>“ speichern oder abbrechen“ sichtbar am Element
tragen. Speichern MUST nur die geänderten Felder senden; ohne Änderung MUST kein Speicheraufruf
erfolgen. Hat sich der Datensatz seit dem Öffnen geändert (409), MUST die Seite nachfragen und
„Meine Änderung übernehmen“ und „Verwerfen und neu laden“ anbieten. Eine offene Bearbeitung mit
Änderung MUST die Rückfrage vor dem Verlassen auslösen; eine offene Bearbeitung ohne Änderung
MUST NOT nachfragen. Für eine solche Ansicht gilt „Ein Speicherweg je Formularseite“ nicht: ein
Paneel mit eigenem Speichern ist kein zweiter Speicherweg.

#### Scenario: Nur ein Paneel offen
- **WHEN** in einer Ansicht das Paneel „Funk“ im Bearbeiten-Zustand steht
- **THEN** ist „Bearbeiten“ am Paneel „Telefon“ gesperrt mit „Erst „Funk“ speichern oder abbrechen“, und nach „Abbrechen“ an „Funk“ ist es wieder bedienbar

#### Scenario: PATCH nur geänderter Felder
- **WHEN** im Paneel „Funk“ nur der Kanal von 41 auf 42 geändert und gespeichert wird
- **THEN** enthält der Aufruf nur den Kanal, und das Paneel zeigt danach wieder seine Werte

#### Scenario: Ohne Änderung kein Aufruf
- **WHEN** ein Paneel geöffnet und ohne Änderung gespeichert wird
- **THEN** geht kein Speicheraufruf raus, und das Paneel schließt

#### Scenario: Konflikt
- **WHEN** jemand anderes den Datensatz nach dem Öffnen gespeichert hat und das Speichern mit 409 abgelehnt wird
- **THEN** fragt die Seite „Zwischenzeitlich geändert“; „Meine Änderung übernehmen“ sendet die eigene Änderung ohne Basisstand, „Verwerfen und neu laden“ schließt das Paneel und lädt den Datensatz neu

#### Scenario: Verlassen-Schutz im Paneel
- **WHEN** im offenen Paneel ein Feld geändert ist und jemand einen Link auf eine andere Seite wählt
- **THEN** erscheint die Rückfrage, und nach „Bleiben“ steht die Eingabe unverändert im Feld

#### Scenario: Offenes Paneel ohne Änderung
- **WHEN** ein Paneel geöffnet, aber nichts geändert ist und jemand die Seite verlässt
- **THEN** wechselt die Seite ohne Rückfrage

#### Scenario: Enter speichert
- **WHEN** im offenen Paneel ein Feld geändert und Enter gedrückt wird
- **THEN** wird die Änderung gespeichert

#### Scenario: Escape bricht ab
- **WHEN** im offenen Paneel Escape gedrückt wird
- **THEN** schließt das Paneel ohne zu senden, und der Fokus steht wieder auf „Bearbeiten“
