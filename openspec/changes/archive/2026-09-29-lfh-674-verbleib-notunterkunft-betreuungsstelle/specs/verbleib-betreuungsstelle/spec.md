# Spec Delta

## Purpose

Ein Verbleib „Notunterkunft“ einer betroffenen Person kann auf eine Betreuungsstelle des
Einsatzes verweisen. Die Stelle zeigt, wie viele Personen namentlich zu ihr verbracht
wurden. Diese Zahl ergänzt die Mengenmeldung der Stelle, ersetzt sie aber nicht und geht
in keine Summe ein.

## ADDED Requirements

### Requirement: Verweis eines Notunterkunft-Verbleibs auf eine Betreuungsstelle

Das System SHALL beim Erfassen eines Verbleibs optional die Kennung einer Betreuungsstelle
annehmen (`betreuungsstelle_id`) und am Verbleib-Ereignis speichern. Der Verweis MUST nur
bei der Verbleib-Art `notunterkunft` zulässig sein. Die Stelle MUST zum selben Einsatz
gehören und darf nicht storniert sein. Eine geschlossene Stelle MUST zulässig sein. Das
Verbleib-Ereignis MUST den Verweis in seiner Anzeige tragen, wenn einer gesetzt ist, und
das Feld sonst weglassen. Das Ziel (`ziel`) MUST unabhängig vom Verweis so gespeichert
werden, wie es mitgeschickt wurde. Der Server MUST keinen Stellennamen in Ziel, Kurzform
oder ETB-Text einsetzen.

#### Scenario: Notunterkunft mit Stelle
- **WHEN** eine Person mit Schreibrecht und Lesezugriff auf das Modul Betreuung für eine Person den Verbleib `{ "art": "notunterkunft", "betreuungsstelle_id": 7, "ziel": "NU Turnhalle Nord" }` erfasst und Stelle 7 zum Einsatz gehört
- **THEN** antwortet das System mit 201, und das Verbleib-Ereignis trägt `betreuungsstelle_id: 7` und `ziel: "NU Turnhalle Nord"`

#### Scenario: Stelle ohne Ziel
- **WHEN** ein Verbleib `{ "art": "notunterkunft", "betreuungsstelle_id": 7 }` ohne Ziel erfasst wird
- **THEN** trägt das Ereignis den Verweis, aber kein Ziel, und die Kurzform lautet „Notunterkunft“ ohne Stellennamen

#### Scenario: Verweis bei anderer Art
- **WHEN** ein Verbleib `{ "art": "transport", "betreuungsstelle_id": 7 }` erfasst wird
- **THEN** antwortet das System mit 422 und legt kein Ereignis an

#### Scenario: Stelle eines anderen Einsatzes
- **WHEN** der Verweis auf eine Stelle zeigt, die es nicht gibt oder die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404 und legt kein Ereignis an

#### Scenario: Stornierte Stelle
- **WHEN** der Verweis auf eine stornierte Stelle zeigt
- **THEN** antwortet das System mit 409 und legt kein Ereignis an

#### Scenario: Geschlossene Stelle
- **WHEN** der Verweis auf eine Stelle im Status „geschlossen“ zeigt
- **THEN** antwortet das System mit 201 und legt das Ereignis mit Verweis an

#### Scenario: Ohne Verweis wie bisher
- **WHEN** ein Verbleib `{ "art": "notunterkunft", "ziel": "Turnhalle Ost" }` ohne Verweis erfasst wird
- **THEN** verhält sich das System wie vor dieser Änderung, und die Anzeige des Ereignisses enthält kein Feld `betreuungsstelle_id`

### Requirement: Verweis nur mit Lesezugriff auf das Modul Betreuung

Das System MUST das Setzen eines Verweises mit 403 ablehnen, wenn die erfassende Person das
Modul Betreuung in diesem Einsatz nicht lesen darf. Diese Prüfung MUST vor der Prüfung
der Stelle stattfinden, damit eine Antwort nicht verrät, ob eine Stelle existiert. Ein
Verbleib ohne Verweis MUST ohne dieses Recht erfassbar bleiben.

#### Scenario: Kein Betreuungsrecht
- **WHEN** eine Person mit Schreibrecht auf das Modul Personen, aber ohne Lesezugriff auf das Modul Betreuung einen Verbleib mit `betreuungsstelle_id` erfasst
- **THEN** antwortet das System mit 403 und legt kein Ereignis an

#### Scenario: Kein Betreuungsrecht, unbekannte Stelle
- **WHEN** dieselbe Person einen Verweis auf eine Stelle schickt, die es nicht gibt
- **THEN** antwortet das System mit 403, nicht mit 404

#### Scenario: Kein Betreuungsrecht, kein Verweis
- **WHEN** dieselbe Person einen Verbleib `notunterkunft` ohne Verweis erfasst
- **THEN** antwortet das System mit 201

### Requirement: Verweis im Verbleib-Cache der Person

Das System SHALL an jeder Person den Verweis ihres jüngsten Verbleib-Ereignisses als Feld
`aktuelle_verbleib_betreuungsstelle_id` ausliefern, neben Art, Ziel und Status. Das Feld
MUST in derselben Transaktion wie das Ereignis gepflegt werden. Ein späteres Ereignis ohne
Verweis MUST das Feld leeren. Ohne Verweis MUST das Feld in der Anzeige fehlen.

#### Scenario: Cache folgt dem jüngsten Ereignis
- **WHEN** eine Person zuerst den Verbleib `notunterkunft` mit Stelle 7 und danach den Verbleib `entlassung` erhält
- **THEN** trägt die Person kein Feld `aktuelle_verbleib_betreuungsstelle_id` mehr, und der Verlauf enthält beide Ereignisse, das erste weiterhin mit Stelle 7

### Requirement: „davon namentlich“ an der Betreuungsstelle

Die Betreuungsübersicht SHALL je nicht stornierter Stelle die Zahl der Personen ausliefern,
die nicht storniert sind und deren jüngster Verbleib `notunterkunft` mit Verweis auf diese
Stelle ist. Die Zahl MUST nur dann in der Antwort stehen, wenn die lesende Person
zusätzlich das Modul Personen sehen darf. Ohne dieses Recht MUST sie fehlen und darf nicht
als 0 erscheinen. Die Zahl MUST NOT in die Belegung einer Stelle, die Kopfzahl „in
Betreuung“, deren Summe, den Evakuiert-Stand oder einen gesicherten Lagestand eingehen. Die
Oberfläche MUST sie als „davon namentlich n“ neben der Belegung zeigen und darf sie nicht
aufsummieren.

#### Scenario: Zählung an der Stelle
- **WHEN** drei Personen den jüngsten Verbleib `notunterkunft` mit Stelle 7 haben, eine davon storniert ist und eine vierte zuletzt mit Stelle 7 und danach mit `entlassung` erfasst wurde
- **THEN** meldet die Übersicht für Stelle 7 die Zahl 2

#### Scenario: Ohne Personenrecht
- **WHEN** eine Person mit Lesezugriff auf das Modul Betreuung, aber ohne Zugriff auf das Modul Personen die Übersicht abruft
- **THEN** enthält die Antwort für keine Stelle eine namentliche Zahl

#### Scenario: Mengenmeldung bleibt führend
- **WHEN** an Stelle 7 die Belegung 40 gemeldet ist und zwei Personen namentlich dorthin verbracht wurden
- **THEN** bleibt die Belegung der Stelle 40, die Kopfzahl „in Betreuung“ zählt für Stelle 7 weiterhin 40, und die Oberfläche zeigt „40 belegt · davon namentlich 2“

#### Scenario: Gesicherter Lagestand
- **WHEN** ein Lagestand gesichert wird, während Personen namentlich einer Stelle zugeordnet sind
- **THEN** enthält das gesicherte Dokument keine namentliche Zahl

### Requirement: Live-Aktualisierung der namentlichen Zahl

Erfasst jemand einen Verbleib oder storniert eine Person, SHALL eine geöffnete
Betreuungsübersicht bei Personen mit Zugriff auf beide Module die namentliche Zahl ohne
Neuladen der Seite nachführen.

#### Scenario: Verbleib während geöffneter Betreuungsseite
- **WHEN** Person A die Betreuungsseite geöffnet hat und Person B einer betroffenen Person den Verbleib `notunterkunft` mit Stelle 7 gibt
- **THEN** zeigt die Seite von Person A für Stelle 7 die um eins erhöhte namentliche Zahl

### Requirement: Schwärzung des Verweises

Die Schwärzung eines Einsatzes MUST den Verweis am Verbleib-Ereignis und im Cache der Person
erhalten, weil er eine Kennung ohne Personenbezug ist. Das Ziel bleibt wie bisher
geschwärzt.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit einem Verbleib `notunterkunft`, Stelle 7 und Ziel „NU Turnhalle Nord“ geschwärzt wird
- **THEN** tragen Ereignis und Person weiterhin Stelle 7, und das Ziel ist leer
