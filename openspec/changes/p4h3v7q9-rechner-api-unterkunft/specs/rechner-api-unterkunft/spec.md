# Spec Delta

## Purpose

Fremdsysteme rechnen Unterkunft und Zelte über die öffentliche API v1 mit demselben Ergebnis wie
der Rechner der Oberfläche, mit den Richtwerten ihrer Organisation und eigenen Werten je Anfrage.

## ADDED Requirements

### Requirement: Die Rechnung steht Fremdsystemen mit dem Scope `rechner:use` offen

Das System SHALL unter `POST /api/v1/rechner/unterkunft` eine Unterkunft durchrechnen und unter
`GET /api/v1/rechner/unterkunft/richtwerte` die Richtwerte nennen. Beide Routen MUST eine
Maschinenanmeldung mit dem Scope `rechner:use` verlangen und ihre Antwort signieren. Einen Zugang
ohne Anmeldung MUST es nicht geben.

#### Scenario: Angemeldet mit Scope
- **WHEN** ein Zugang mit `rechner:use` eine gültige Rechnung anfragt
- **THEN** antwortet der Server mit 200, dem Ergebnis und dem Kopf `Lifeline-Signature`

#### Scenario: Ohne Scope
- **WHEN** ein Zugang nur mit `lage:read` eine der beiden Routen aufruft
- **THEN** antwortet der Server mit 403 und dem Code `missing_scope`

#### Scenario: Ohne Anmeldung
- **WHEN** eine Anfrage ohne `Authorization: Machine` eine der beiden Routen aufruft
- **THEN** antwortet der Server mit 401 und dem Code `unauthorized`

### Requirement: Die Rechnung speichert nichts

Eine Rechnung MUST weder Richtwerte noch Einsatzdaten noch die Eingabe speichern. Festgehalten
wird allein der Abruf im Abrufprotokoll des Zugangs.

#### Scenario: Eigener Wert bleibt in der Anfrage
- **WHEN** ein Zugang mit `richtwerte.wasser_je_person_l = 15` rechnet und danach die Richtwerte abruft
- **THEN** nennt die Auskunft für `wasser_je_person_l` weiter den Wert der Organisation oder der Basis

### Requirement: Die Eingabe hat die Form der gemeinsamen Fallsammlung

Die Anfrage SHALL `weg` (`personen`, `raeume`, `flaeche`, `zelte`), `trennung` und genau den Block
ihres Wegs tragen, optional `richtwerte`. Jede `eingabe` aus
`tests/fixtures/unterkunft/faelle.json` MUST eine gültige Anfrage sein.

#### Scenario: Personen ohne Trennung
- **WHEN** die Anfrage `{"weg": "personen", "trennung": false, "personen": {"gesamt": 100}}` lautet
- **THEN** rechnet der Server für 100 Personen

#### Scenario: Summe aus Gruppen ohne Trennung
- **WHEN** die Anfrage ohne Trennung nur `personen.maenner = 30` und `personen.frauen = 12` nennt
- **THEN** rechnet der Server für 42 Personen als eine Gruppe

#### Scenario: Räume mit Abzug
- **WHEN** die Anfrage zwei Räume 15 m × 13,5 m mit Abzug 4 m × 2,5 m und 12 m × 8 m mit Abzug 3 m × 2 m nennt
- **THEN** nennt das Ergebnis 48 und 22 Plätze je Raum und 70 Plätze gesamt

### Requirement: Ein ungültiges Feld ist 400 und nennt das Feld

Der Server MUST mit 400 und dem Code `invalid_field` antworten, wenn ein Feld für sich ungültig
ist, und das Feld im Text nennen. Das gilt für ein unbekanntes Feld, einen unbekannten Wert von
`weg` oder `belegung`, einen unbekannten Zelttyp, eine Zahl, die negativ, nicht endlich oder bei
Personen und Zelten nicht ganz ist, und für jede überschrittene Grenze.

#### Scenario: Unbekanntes Feld
- **WHEN** die Anfrage das Feld `einsatz_id` trägt
- **THEN** antwortet der Server mit 400, Code `invalid_field`, und der Text nennt `einsatz_id`

#### Scenario: Gebrochene Personenzahl
- **WHEN** `personen.gesamt` 10,5 ist
- **THEN** antwortet der Server mit 400 und nennt `personen.gesamt`

#### Scenario: Kein JSON
- **WHEN** der Body leer oder kein gültiges JSON ist
- **THEN** antwortet der Server mit 400 und dem Code `invalid_field`

### Requirement: Die Eingabe hat feste Grenzen

Der Server MUST Eingaben über diesen Grenzen mit 400 ablehnen: höchstens 200 Räume, je Raum
höchstens 20 Abzüge, Maße über 0 und höchstens 1000 m, Flächen höchstens 1 000 000 m², Personen
je Angabe höchstens 1 000 000, Zelte je Typ höchstens 1000, Bezeichnung eines Raums höchstens 80
Zeichen.

#### Scenario: Zu viele Räume
- **WHEN** die Anfrage 201 Räume nennt
- **THEN** antwortet der Server mit 400 und nennt `raeume`

#### Scenario: Maß über der Grenze
- **WHEN** ein Raum 1000,5 m lang ist
- **THEN** antwortet der Server mit 400 und nennt das Maß des Raums

#### Scenario: Personen an der Grenze
- **WHEN** `personen.gesamt` 1 000 000 ist
- **THEN** rechnet der Server; bei 1 000 001 antwortet er mit 400

### Requirement: Eine widersprüchliche Grundlage ist 422

Der Server MUST mit 422 und dem Code `unprocessable` antworten, wenn die Felder nicht
zusammenpassen: der Block des Wegs fehlt, ein Block eines anderen Wegs ist dabei, `gesamt` steht
neben `maenner` oder `frauen`, `gesamt` steht bei Trennung, bei Trennung fehlen beide Gruppen, ein
Raum trägt bei Trennung keine `belegung` oder ohne Trennung eine.

#### Scenario: Block passt nicht zum Weg
- **WHEN** die Anfrage `weg` `personen` nennt und zusätzlich `raeume` trägt
- **THEN** antwortet der Server mit 422 und dem Code `unprocessable`

#### Scenario: Gesamt bei Trennung
- **WHEN** die Anfrage mit Trennung `personen.gesamt = 100` nennt
- **THEN** antwortet der Server mit 422

#### Scenario: Raum ohne Belegung bei Trennung
- **WHEN** die Anfrage mit Trennung einen Raum ohne `belegung` nennt
- **THEN** antwortet der Server mit 422

### Requirement: Richtwerte gelten in den Ebenen Anfrage, Organisation, Basis

Wirksam MUST je Schlüssel der Wert der Anfrage sein, sonst der Wert der Organisation des Zugangs,
sonst die Basis. Ein Wert der Anfrage MUST einen bekannten Schlüssel tragen und in den Grenzen der
Basis liegen, bei Ganzzahl-Werten ohne Nachkommastellen; sonst 400 mit dem Schlüssel. Werte eines
Einsatzes gehören nicht zu den Ebenen.

#### Scenario: Wert der Anfrage
- **WHEN** ein Zugang 100 Personen mit `richtwerte.wasser_je_person_l = 15` rechnet
- **THEN** nennt das Ergebnis 1 500 l Wasser je Tag und für diesen Schlüssel die Herkunft `anfrage`

#### Scenario: Wert der Organisation
- **WHEN** die Organisation des Zugangs `flaeche_je_person_m2` auf 5 gesetzt hat und die Anfrage den Schlüssel nicht nennt
- **THEN** rechnet der Server mit 5 m² und nennt die Herkunft `org`

#### Scenario: Fremde Organisation
- **WHEN** nur eine andere Organisation einen Richtwert gesetzt hat
- **THEN** rechnet der Server mit der Basis und nennt die Herkunft `basis`

#### Scenario: Unbekannter Schlüssel
- **WHEN** die Anfrage `richtwerte.foo = 1` trägt
- **THEN** antwortet der Server mit 400, Code `invalid_field`, und der Text nennt `foo`

#### Scenario: Wert außerhalb der Grenzen
- **WHEN** die Anfrage `richtwerte.wasser_je_person_l = 4` trägt
- **THEN** antwortet der Server mit 400 und nennt den Schlüssel und seine Grenzen

### Requirement: Die Antwort nennt Ergebnis, wirksame Richtwerte und Stand

Die Antwort der Rechnung SHALL das Ergebnis in der Form des Felds `erwartet` der Fallsammlung
tragen, dazu jeden Richtwert mit wirksamem Wert und Herkunft (`basis`, `org`, `anfrage`) und den
Stand der Basis.

#### Scenario: Vollständige Richtwerte
- **WHEN** ein Zugang eine Rechnung mit einem eigenen Wert anfragt
- **THEN** nennt die Antwort jeden Schlüssel der Basis genau einmal, den eigenen mit Herkunft `anfrage`, und den Stand der Basis

### Requirement: Server und Oberfläche rechnen gleich

Der Server MUST für jeden Fall der gemeinsamen Fallsammlung dasselbe Ergebnis liefern wie der
Rechner der Oberfläche: jede Zahl gleich, jede Liste in derselben Reihenfolge.

#### Scenario: Fall der Fallsammlung
- **WHEN** die `eingabe` und die `richtwerte` eines Falls an die Rechnung gehen
- **THEN** ist das Ergebnis gleich dem Feld `erwartet` des Falls

#### Scenario: Rechnung geändert
- **WHEN** eine Seite ihre Rechnung ändert, ohne die Fallsammlung anzupassen
- **THEN** scheitert die Testsuite dieser Seite

### Requirement: Die Auskunft nennt jeden Richtwert mit seinen Angaben

`GET /api/v1/rechner/unterkunft/richtwerte` SHALL je Richtwert Schlüssel, Bezeichnung, Gruppe,
Einheit, Grenzen, Ganzzahl-Merkmal, Basiswert, wirksamen Wert und Herkunft (`basis`, `org`)
nennen, dazu den Stand der Basis und die Zelttypen mit Bezeichnung.

#### Scenario: Wert der Organisation in der Auskunft
- **WHEN** die Organisation des Zugangs `wasser_je_person_l` auf 30 gesetzt hat
- **THEN** nennt die Auskunft für den Schlüssel Basis 25, Wert 30, Herkunft `org`, Einheit `l` und die Grenzen 5 und 500

#### Scenario: Zelttypen
- **WHEN** ein Zugang die Auskunft abruft
- **THEN** nennt sie die Zelttypen `sg20`, `sg30`, `sg40` und `sg50` mit ihrer Bezeichnung
