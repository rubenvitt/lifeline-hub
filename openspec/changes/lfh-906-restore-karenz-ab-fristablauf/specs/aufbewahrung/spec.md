# Spec Delta

## MODIFIED Requirements

### Requirement: Löschvormerkung nach Fristablauf

Das System SHALL einen abgeschlossenen Einsatz, dessen Frist abgelaufen ist, zur Löschung
vormerken (`geloescht_at`). Als Zeitpunkt der Vormerkung MUST nicht der Purge-Lauf gelten, der
sie setzt, sondern der späteste dieser Zeitpunkte, höchstens der Lauf selbst: der Ablauf der
Frist, das Setzen der Frist (bei einer Frist in die Vergangenheit) und der Abschluss des
Einsatzes (bei einer Frist, die am aktiven Einsatz ablief). Ist nicht bekannt, wann die Frist
gesetzt wurde, MUST der Purge-Lauf selbst gelten. Die Vormerkung beginnt die Karenz.
Ein aktiver Einsatz MUST nie vorgemerkt werden. Die Vormerkung MUST idempotent sein: Ein bereits
vorgemerkter Einsatz bleibt bei seinem ersten Zeitpunkt und erhält keinen zweiten ETB-Eintrag.
Die Vormerkung MUST bis zum Ende der Karenz umkehrbar sein (siehe `aufbewahrung-archiv`,
Wiederherstellen).

#### Scenario: Fällig
- **WHEN** der Purge-Lauf nach Ablauf der Frist eines abgeschlossenen Einsatzes läuft
- **THEN** ist der Einsatz vorgemerkt, und das ETB enthält einen System-Eintrag zur Vormerkung

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf ein zweites Mal läuft
- **THEN** bleibt der Zeitpunkt der Vormerkung unverändert, und es entsteht kein weiterer Eintrag

#### Scenario: Erster Lauf lange nach dem Fristablauf
- **WHEN** die Frist eines Einsatzes beim Abschluss gesetzt wurde und der erste Purge-Lauf danach zehn Tage nach ihrem Ablauf läuft, etwa nach einem Stillstand des Servers
- **THEN** ist der Einsatz mit dem Ablauf der Frist als Zeitpunkt vorgemerkt
- **AND** nennt der ETB-Eintrag zur Vormerkung diesen Zeitpunkt als Beginn der Karenz

#### Scenario: Frist am aktiven Einsatz abgelaufen
- **WHEN** die Frist eines Einsatzes abläuft, während er noch aktiv ist, und er 50 Tage später abgeschlossen wird
- **THEN** ist er nach dem nächsten Purge-Lauf mit dem Abschluss als Zeitpunkt vorgemerkt
- **AND** ist er erst 30 Tage nach dem Abschluss geschwärzt

#### Scenario: Frist in die Vergangenheit verkürzt
- **WHEN** die Einsatzleitung die Frist bestätigt auf einen Zeitpunkt vor 60 Tagen setzt und danach der Purge-Lauf läuft
- **THEN** ist der Einsatz mit dem Zeitpunkt des Setzens vorgemerkt
- **AND** ist er erst 30 Tage danach geschwärzt

### Requirement: Karenz von 30 Tagen vor der Schwärzung

Das System SHALL einen vorgemerkten Einsatz frühestens 30 Tage nach dem Zeitpunkt seiner
Vormerkung schwärzen. Die Karenz ist systemweit fest und nicht je Einsatz einstellbar.
Maßgeblich MUST allein der Zeitpunkt der Vormerkung sein, nicht die Frist: Eine spätere
Änderung von `retention_bis` verschiebt die Schwärzung nicht. Ausgenommen ist der Vollzug eines
Schwärzungsantrags; für ihn gilt die Karenz von 24 Stunden der Capability
`aufbewahrung-loeschersuchen`. Liegt der Zeitpunkt der Vormerkung schon bei ihrem Setzen 30 Tage
oder mehr zurück, MUST derselbe Purge-Lauf den Einsatz schwärzen.

#### Scenario: Innerhalb der Karenz
- **WHEN** der Purge-Lauf 29 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz nicht geschwärzt

#### Scenario: Karenz abgelaufen
- **WHEN** der Purge-Lauf genau 30 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz geschwärzt

#### Scenario: Frist ändert die Karenz nicht
- **WHEN** an einem vorgemerkten Einsatz `retention_bis` in der Datenbank auf einen späteren Zeitpunkt steht und die Karenz abgelaufen ist
- **THEN** schwärzt der Purge-Lauf den Einsatz trotzdem

#### Scenario: Antrag während der Karenz
- **WHEN** ein seit 3 Tagen vorgemerkter Einsatz einen vor 24 Stunden gestellten Einsatz-Antrag trägt
- **THEN** schwärzt der Purge-Lauf den Einsatz, obwohl seine Karenz noch läuft

#### Scenario: Vormerkung mit schon abgelaufener Karenz
- **WHEN** der Purge-Lauf einen Einsatz vormerkt, dessen Frist seit 40 Tagen abgelaufen ist
- **THEN** ist der Einsatz nach diesem Lauf geschwärzt

### Requirement: Rückspielen einer Sicherung von vor der Schwärzung

Wird eine Sicherung zurückgespielt, in der ein inzwischen geschwärzter Einsatz bereits zur
Löschung vorgemerkt, aber noch ungeschwärzt ist, MUST das System ihn ohne Eingriff erneut
schwärzen, spätestens im nächsten Purge-Lauf nach Ablauf seiner Karenz. Die Vormerkung aus der
Sicherung MUST dabei gelten, die Karenz beginnt nicht neu. Stammt die Sicherung aus der Zeit vor
der Vormerkung, MUST der Einsatz spätestens im ersten Purge-Lauf geschwärzt sein, der 30 Tage
nach dem Ablauf seiner Frist läuft, auch wenn die Sicherung vor diesem Verhalten entstand.

#### Scenario: Restore nach Ablauf der Karenz
- **WHEN** eine Sicherung zurückgespielt wird, in der ein vorgemerkter Einsatz mit inzwischen abgelaufener Karenz noch ungeschwärzt ist
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf geschwärzt

#### Scenario: Restore von vor der Vormerkung, Karenz abgelaufen
- **WHEN** eine Sicherung zurückgespielt wird, in der ein Einsatz noch nicht vorgemerkt ist und seine Frist seit mehr als 30 Tagen abgelaufen ist
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf geschwärzt

#### Scenario: Restore von vor der Vormerkung, Karenz läuft noch
- **WHEN** eine Sicherung zurückgespielt wird, in der ein Einsatz noch nicht vorgemerkt ist und seine Frist seit 10 Tagen abgelaufen ist
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf vorgemerkt, mit dem Ablauf der Frist als Zeitpunkt
- **AND** ist er 20 Tage danach geschwärzt
- **AND** kann der Org-Admin ihn bis dahin wiederherstellen, und eine Friständerung liefert 422
