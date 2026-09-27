# Spec Delta

## Purpose

Personenbezogene Daten abgeschlossener Einsätze werden nach einer festgelegten Frist gesperrt
und nach einer Karenz unwiderruflich geschwärzt. Die rechtsverbindliche Einsatzdokumentation
bleibt dabei als pseudonymes Skelett erhalten, und jeder Schritt steht nachvollziehbar im
Einsatztagebuch.

## ADDED Requirements

### Requirement: Datenkategorien über eine zentrale Klassifikation

Das System SHALL für jede Spalte jeder Tabelle, die an einem Einsatz hängt, genau eine
Klassifikation führen: **Scrub** (personenbezogen, wird geschwärzt, mit einer Strategie:
leeren, Platzhalter, Platzhalter nur wenn gesetzt, Platzhalter mit Zeilenkennung, Zeile
löschen) oder **Retain** (bleibt erhalten, mit Begründung). Diese Klassifikation MUST die
einzige Quelle sein, aus der die Schwärzung ihre Anweisungen bildet. Eine einsatzbezogene
Spalte oder Tabelle ohne Klassifikation MUST die Testsuite scheitern lassen. Ein
Klassifikationseintrag ohne zugehörige Spalte MUST die Testsuite ebenfalls scheitern lassen.

#### Scenario: Neue Spalte ohne Klassifikation
- **WHEN** eine Migration einer einsatzbezogenen Tabelle eine Spalte hinzufügt und die Klassifikation sie nicht führt
- **THEN** scheitert die Testsuite und nennt Tabelle und Spalte

#### Scenario: Schwärzung folgt der Klassifikation
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** ist jede als Scrub geführte Spalte nach ihrer Strategie behandelt
- **AND** trägt jede als Retain geführte Spalte ihren vorherigen Wert

### Requirement: Frist aus der Aufbewahrungsdauer beim Abschluss

Beim Abschluss eines Einsatzes SHALL das System die Aufbewahrungsfrist `retention_bis` als
Abschlusszeitpunkt plus wirksamer Aufbewahrungsdauer in Tagen setzen. Die Dauer des Einsatzes
MUST dabei vor der Vorgabe der Organisation stehen. Ist keine Dauer festgelegt, MUST keine
Frist entstehen. Eine bereits gesetzte Frist MUST der Abschluss unverändert lassen. Setzt der
Abschluss eine Frist, MUST im selben Vorgang ein System-Eintrag im ETB entstehen, der Frist
und Dauer nennt.

#### Scenario: Dauer am Einsatz
- **WHEN** ein Einsatz mit Aufbewahrungsdauer 30 Tage abgeschlossen wird
- **THEN** liegt seine Frist 30 Tage nach dem Abschlusszeitpunkt
- **AND** enthält das ETB einen System-Eintrag mit Frist und Dauer

#### Scenario: Keine Dauer
- **WHEN** ein Einsatz ohne Dauer abgeschlossen wird und auch die Organisation keine Vorgabe hat
- **THEN** hat er keine Frist

#### Scenario: Manuelle Frist bleibt
- **WHEN** ein Einsatz mit bereits gesetzter Frist abgeschlossen wird
- **THEN** bleibt die gesetzte Frist unverändert

### Requirement: Manuelle Frist

Einsatzleitung und System-Admin SHALL die Frist eines Einsatzes setzen, ändern und aufheben
können, vor und nach dem Abschluss. Andere Personen MUST 403 erhalten. Eine Verkürzung MUST
ausdrücklich bestätigt werden, sonst antwortet das System mit 409. Als Verkürzung gilt ein
früherer Zeitpunkt oder das erstmalige Setzen einer Frist an einem Einsatz ohne Frist. Eine
unveränderte Frist MUST ohne Schreibvorgang und ohne ETB-Eintrag bleiben. Jede wirksame
Änderung MUST einen System-Eintrag im ETB mit altem und neuem Wert schreiben. An einem zur
Löschung vorgemerkten Einsatz, dessen Karenz noch läuft, MUST die Änderung mit 422 abgewiesen
werden, mit dem Hinweis auf das Wiederherstellen. Ist die Karenz abgelaufen, der Einsatz aber
noch nicht geschwärzt, MUST sie mit 409 abgewiesen werden, ohne Hinweis auf das
Wiederherstellen, denn auch das ist dann ausgeschlossen. An einem geschwärzten Einsatz MUST sie
mit 409 abgewiesen werden.

#### Scenario: Verlängern ohne Bestätigung
- **WHEN** die Einsatzleitung die Frist eines abgeschlossenen Einsatzes auf einen späteren Zeitpunkt setzt
- **THEN** gilt die neue Frist, und das ETB nennt alten und neuen Wert

#### Scenario: Verkürzen ohne Bestätigung
- **WHEN** eine Frist auf einen früheren Zeitpunkt gesetzt wird, ohne Bestätigung
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Vorgemerkter Einsatz
- **WHEN** an einem zur Löschung vorgemerkten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 422, und Frist und Vormerkung bleiben unverändert

#### Scenario: Karenz abgelaufen, noch nicht geschwärzt
- **WHEN** an einem vorgemerkten Einsatz, dessen Karenz abgelaufen ist, die Frist geändert werden soll
- **THEN** antwortet das System mit 409, und Frist und Vormerkung bleiben unverändert

#### Scenario: Geschwärzter Einsatz
- **WHEN** an einem geschwärzten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 409

### Requirement: Lesesperre nach Fristablauf

Ein abgeschlossener Einsatz, dessen Frist abgelaufen ist oder der zur Löschung vorgemerkt
ist, SHALL über die regulären Einsatz-Routen für niemanden lesbar sein, auch nicht für den
System-Admin. Die Antwort MUST 403 sein. Ein aktiver Einsatz MUST durch eine Frist nie
gesperrt werden. Einzige Leseausnahme ist die Archivakte der Capability
`aufbewahrung-archiv`.

#### Scenario: Frist abgelaufen, noch nicht vorgemerkt
- **WHEN** der System-Admin einen abgeschlossenen Einsatz mit abgelaufener Frist über die Einsatz-Detailroute abruft
- **THEN** antwortet das System mit 403

#### Scenario: Vorgemerkt
- **WHEN** der System-Admin Detail, Personen-Export oder Live-Strom eines vorgemerkten Einsatzes abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Aktiver Einsatz mit Frist in der Vergangenheit
- **WHEN** ein aktiver Einsatz eine Frist in der Vergangenheit trägt
- **THEN** bleibt er für seine Mitglieder lesbar

### Requirement: Löschvormerkung nach Fristablauf

Das System SHALL einen abgeschlossenen Einsatz, dessen Frist abgelaufen ist, zur Löschung
vormerken (`geloescht_at`). Die Vormerkung beginnt die Karenz. Ein aktiver Einsatz MUST nie
vorgemerkt werden. Die Vormerkung MUST idempotent sein: Ein bereits vorgemerkter Einsatz
bleibt bei seinem ersten Zeitpunkt und erhält keinen zweiten ETB-Eintrag. Die Vormerkung MUST
bis zum Ende der Karenz umkehrbar sein (siehe `aufbewahrung-archiv`, Wiederherstellen).

#### Scenario: Fällig
- **WHEN** der Purge-Lauf nach Ablauf der Frist eines abgeschlossenen Einsatzes läuft
- **THEN** ist der Einsatz vorgemerkt, und das ETB enthält einen System-Eintrag zur Vormerkung

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf ein zweites Mal läuft
- **THEN** bleibt der Zeitpunkt der Vormerkung unverändert, und es entsteht kein weiterer Eintrag

### Requirement: Karenz von 30 Tagen vor der Schwärzung

Das System SHALL einen vorgemerkten Einsatz frühestens 30 Tage nach dem Zeitpunkt seiner
Vormerkung schwärzen. Die Karenz ist systemweit fest und nicht je Einsatz einstellbar.
Maßgeblich MUST allein der Zeitpunkt der Vormerkung sein, nicht die Frist: Eine spätere
Änderung von `retention_bis` verschiebt die Schwärzung nicht.

#### Scenario: Innerhalb der Karenz
- **WHEN** der Purge-Lauf 29 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz nicht geschwärzt

#### Scenario: Karenz abgelaufen
- **WHEN** der Purge-Lauf genau 30 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz geschwärzt

#### Scenario: Frist ändert die Karenz nicht
- **WHEN** an einem vorgemerkten Einsatz `retention_bis` in der Datenbank auf einen späteren Zeitpunkt steht und die Karenz abgelaufen ist
- **THEN** schwärzt der Purge-Lauf den Einsatz trotzdem

### Requirement: Unwiderrufliche Schwärzung

Nach Ablauf der Karenz SHALL das System die personenbezogenen Daten eines Einsatzes nach der
Klassifikation schwärzen, und zwar in einem einzigen atomaren Vorgang zusammen mit dem
Zeitstempel `geschwaerzt_at` und einem System-Eintrag im ETB. Stornierte Zeilen MUST
eingeschlossen sein. Scheitert ein Teil, MUST nichts geschwärzt sein. Die Schwärzung MUST
idempotent sein. Erhalten bleiben MUST das operative Skelett: Einsatzkopf ohne Meldebild und
Ort, ETB im Wortlaut mit intakten Verweisen, Registriernummern, Triage- und
Statuskategorien. Eine Rücknahme MUST es nicht geben.

#### Scenario: Skelett nach der Schwärzung
- **WHEN** ein Einsatz mit Personen, Tieren und Schäden geschwärzt ist
- **THEN** tragen die Personen keine Namen, Kontakte, Adressen oder Notizen mehr
- **AND** tragen sie weiter Registriernummer, Status und Sichtungskategorie
- **AND** sind alle ETB-Einträge mit laufender Nummer und Berichtigungsverweis erhalten
- **AND** meldet die Fremdschlüsselprüfung der Datenbank keinen Verstoß

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf einen bereits geschwärzten Einsatz erneut antrifft
- **THEN** ändert er nichts und schreibt keinen Eintrag

### Requirement: Auslöser der Aufbewahrung

Das System SHALL die Aufbewahrung ausschließlich über diese Auslöser bewegen: den Abschluss
(Frist aus der Dauer), die manuelle Frist, einen periodischen Purge-Lauf höchstens alle
10 Minuten (Vormerkung und Schwärzung) und das Wiederherstellen durch den Org-Admin. Einen
manuellen Sofort-Auslöser für die Schwärzung MUST es in dieser Fassung nicht geben.

#### Scenario: Fristablauf ohne Eingriff
- **WHEN** die Frist eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf vorgemerkt

### Requirement: Lückenloser Audit im ETB

Jede Mutation der Aufbewahrung (Frist aus Dauer, manuelle Frist, Vormerkung, Schwärzung,
Wiederherstellen) SHALL im selben atomaren Vorgang einen System-Eintrag im ETB des Einsatzes
schreiben. Bei einer handelnden Person MUST sie als Erfasser stehen. Beim Purge-Lauf MUST der
Erfasser in dieser Reihenfolge bestimmt werden: die Person, die den Einsatz abgeschlossen hat,
dann eine Einsatzleitung des Einsatzes, dann ein System-Admin der Organisation des Einsatzes.
Ist keiner auffindbar, MUST die Mutation unterbleiben, als Fehler protokolliert und im
nächsten Lauf erneut versucht werden. Eine Aufbewahrungs-Mutation ohne ETB-Eintrag MUST es
nicht geben.

#### Scenario: Ersatzakteur
- **WHEN** ein fälliger Einsatz keine abschließende Person und keine Einsatzleitung hat, seine Organisation aber einen System-Admin
- **THEN** wird er vorgemerkt, und der System-Eintrag trägt den System-Admin als Erfasser

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz unvorgemerkt, und kein ETB-Eintrag entsteht
- **AND** wird der Einsatz im nächsten Lauf vorgemerkt, sobald ein Akteur auffindbar ist

### Requirement: Pseudonyme Spur im ETB

System-Einträge im ETB, die Personen, Tiere oder Schäden betreffen, SHALL diese über ihre
Registriernummer bezeichnen (`R-042`, `T-007`, `S-003`). Die Identitäts- und Kontaktangaben
der Personenzeile (Name, Vorname, Geburtsdatum, Herkunftsadresse, Antreffort, Melderkontakt,
Zustand, Notiz), die Kontakte von Haltern und Geschädigten sowie die Tier-Kennzeichnung MUST
in keinem System-Eintrag stehen. Übernimmt ein System-Eintrag einen anderen Wert, den die
Klassifikation als Scrub führt, in seinen Wortlaut, MUST diese Stelle in einer
abschließenden Ausnahmeliste stehen, die ein Test pinnt. Der Wert bleibt dann als
Führungsdokumentation im ETB erhalten, auch über die Schwärzung hinweg. Eine neue solche
Stelle ohne Eintrag in der Liste ist ein Fehler.

#### Scenario: Person angelegt und gesichtet
- **WHEN** eine Person mit Name und Kontakt erfasst und gesichtet wird
- **THEN** nennen die System-Einträge nur ihre Registriernummer und die Kategorie

#### Scenario: Ausnahmeliste ist gepinnt
- **WHEN** der Ende-zu-Ende-Test die System-Einträge eines geschwärzten Einsatzes nach den gepflanzten Werten durchsucht
- **THEN** findet er einen Scrub-Wert nur an den Stellen, die die Ausnahmeliste führt

#### Scenario: Dokumentierte Ausnahme Schadensort
- **WHEN** ein Schaden mit Ort angelegt und der Einsatz später geschwärzt wird
- **THEN** ist der Ort in der Schadenszeile geschwärzt
- **AND** steht die Ortskurzform weiter im System-Eintrag der Anlage
