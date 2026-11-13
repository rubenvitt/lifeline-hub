## RENAMED Requirements

- FROM: `### Requirement: Richtwerte gelten in den Ebenen Anfrage, Organisation, Basis`
- TO: `### Requirement: Richtwerte gelten in den Ebenen Anfrage, Einsatz, Organisation, Basis`

## MODIFIED Requirements

### Requirement: Richtwerte gelten in den Ebenen Anfrage, Einsatz, Organisation, Basis

Wirksam MUST je Schlüssel der Wert der Anfrage sein, sonst, wenn die Anfrage mit `einsatz_id` einen
für den Zugang freigegebenen Einsatz nennt, der Wert dieses Einsatzes, sonst der Wert der
Organisation des Zugangs, sonst die Basis. Ein Wert der Anfrage MUST einen bekannten Schlüssel
tragen und in den Grenzen der Basis liegen, bei Ganzzahl-Werten ohne Nachkommastellen; sonst 400
mit dem Schlüssel. Ohne `einsatz_id` gehören Werte eines Einsatzes nicht zu den Ebenen.

#### Scenario: Wert der Anfrage
- **WHEN** ein Zugang 100 Personen mit `richtwerte.wasser_je_person_l = 15` rechnet
- **THEN** nennt das Ergebnis 1 500 l Wasser je Tag und für diesen Schlüssel die Herkunft `anfrage`

#### Scenario: Wert des Einsatzes
- **WHEN** die Einsatzleitung den Einsatz E für den Zugang freigegeben hat, E `wasser_je_person_l` auf 40 gesetzt hat, die Organisation auf 30, und der Zugang 100 Personen mit `einsatz_id` E rechnet
- **THEN** nennt das Ergebnis 4 000 l Wasser je Tag und für diesen Schlüssel den Wert 40 mit der Herkunft `einsatz`

#### Scenario: Anfrage vor Einsatz
- **WHEN** der Zugang mit `einsatz_id` des freigegebenen Einsatzes E rechnet, der `wasser_je_person_l` auf 40 gesetzt hat, und die Anfrage `richtwerte.wasser_je_person_l = 15` trägt
- **THEN** rechnet der Server mit 15 und nennt die Herkunft `anfrage`

#### Scenario: Einsatz ohne eigenen Wert
- **WHEN** der Zugang mit `einsatz_id` des freigegebenen Einsatzes E rechnet, E `flaeche_je_person_m2` nicht gesetzt hat und die Organisation den Schlüssel auf 5 gesetzt hat
- **THEN** rechnet der Server mit 5 m² und nennt die Herkunft `org`

#### Scenario: Ohne `einsatz_id`
- **WHEN** die Einsatzleitung den Einsatz E für den Zugang freigegeben hat, E `wasser_je_person_l` auf 40 gesetzt hat und der Zugang ohne `einsatz_id` rechnet
- **THEN** rechnet der Server ohne den Wert des Einsatzes und nennt für den Schlüssel die Herkunft `org` oder `basis`

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

### Requirement: Ein ungültiges Feld ist 400 und nennt das Feld

Der Server MUST mit 400 und dem Code `invalid_field` antworten, wenn ein Feld für sich ungültig
ist, und das Feld im Text nennen. Das gilt für ein unbekanntes oder doppeltes Feld, einen falschen
Typ, eine Liste an Stelle eines Objekts, einen unbekannten Wert von `weg` oder `belegung`, einen
unbekannten Zelttyp, eine Zahl, die negativ, nicht darstellbar oder bei Personen und Zelten nicht
ganz ist, und für jede überschrittene Grenze.

#### Scenario: Unbekanntes Feld
- **WHEN** die Anfrage das Feld `einsatz` trägt
- **THEN** antwortet der Server mit 400, Code `invalid_field`, und der Text nennt `einsatz`

#### Scenario: Einsatz-Kennung mit falschem Typ
- **WHEN** die Anfrage `einsatz_id` als Zeichenkette `"7"` oder als Zahl `7.5` trägt
- **THEN** antwortet der Server mit 400, Code `invalid_field`, und der Text nennt `einsatz_id`

#### Scenario: Gebrochene Personenzahl
- **WHEN** `personen.gesamt` 10,5 ist
- **THEN** antwortet der Server mit 400 und nennt `personen.gesamt`

#### Scenario: Falscher Typ
- **WHEN** `personen.gesamt` die Zeichenkette `"100"` ist
- **THEN** antwortet der Server mit 400 und nennt `personen.gesamt`

#### Scenario: Nicht darstellbare Zahl
- **WHEN** `personen.gesamt` den Wert `1e999` trägt
- **THEN** antwortet der Server mit 400 und nennt `personen.gesamt`

#### Scenario: Doppelter Schlüssel
- **WHEN** `richtwerte` den Schlüssel `wasser_je_person_l` zweimal trägt, mit 4 und mit 15
- **THEN** antwortet der Server mit 400 und nennt den Schlüssel, statt mit dem letzten Wert zu rechnen

#### Scenario: Liste statt Objekt
- **WHEN** `personen` die Liste `[100, null, null]` ist
- **THEN** antwortet der Server mit 400 und nennt `personen`

#### Scenario: Kein JSON
- **WHEN** der Body leer oder kein gültiges JSON ist
- **THEN** antwortet der Server mit 400 und dem Code `invalid_field`

### Requirement: Die Antwort nennt Ergebnis, wirksame Richtwerte und Stand

Die Antwort der Rechnung SHALL das Ergebnis in der Form des Felds `erwartet` der Fallsammlung
tragen, dazu jeden Richtwert mit wirksamem Wert und Herkunft (`basis`, `org`, `einsatz`,
`anfrage`) und den Stand der Basis.

#### Scenario: Vollständige Richtwerte
- **WHEN** ein Zugang eine Rechnung mit einem eigenen Wert anfragt
- **THEN** nennt die Antwort jeden Schlüssel der Basis genau einmal, den eigenen mit Herkunft `anfrage`, und den Stand der Basis

#### Scenario: Vollständige Richtwerte mit Einsatz
- **WHEN** ein Zugang mit `einsatz_id` des freigegebenen Einsatzes rechnet, der einen Wert gesetzt hat
- **THEN** nennt die Antwort jeden Schlüssel der Basis genau einmal, den Wert des Einsatzes mit Herkunft `einsatz`

### Requirement: Die Auskunft nennt jeden Richtwert mit seinen Angaben

`GET /api/v1/rechner/unterkunft/richtwerte` SHALL je Richtwert Schlüssel, Bezeichnung, Gruppe,
Einheit, Grenzen, Ganzzahl-Merkmal, Basiswert, wirksamen Wert und Herkunft (`basis`, `org`,
`einsatz`) nennen, dazu den Stand der Basis und die Zelttypen mit Bezeichnung. Mit dem
Abfrageparameter `einsatz_id` eines für den Zugang freigegebenen Einsatzes MUST der wirksame Wert
die Werte dieses Einsatzes einschließen; ein Wert, der keine ganze Zahl ist, ergibt 400 mit
`einsatz_id`.

#### Scenario: Wert der Organisation in der Auskunft
- **WHEN** die Organisation des Zugangs `wasser_je_person_l` auf 30 gesetzt hat
- **THEN** nennt die Auskunft für den Schlüssel Basis 25, Wert 30, Herkunft `org`, Einheit `l` und die Grenzen 5 und 500

#### Scenario: Wert des Einsatzes in der Auskunft
- **WHEN** der freigegebene Einsatz E `wasser_je_person_l` auf 40 gesetzt hat und der Zugang die Auskunft mit `?einsatz_id=E` abruft
- **THEN** nennt die Auskunft für den Schlüssel Basis 25, Wert 40, Herkunft `einsatz`

#### Scenario: Einsatz-Kennung keine Zahl
- **WHEN** der Zugang die Auskunft mit `?einsatz_id=abc` abruft
- **THEN** antwortet der Server mit 400, Code `invalid_field`, und der Text nennt `einsatz_id`

#### Scenario: Zelttypen
- **WHEN** ein Zugang die Auskunft abruft
- **THEN** nennt sie die Zelttypen `sg20`, `sg30`, `sg40` und `sg50` mit ihrer Bezeichnung

## ADDED Requirements

### Requirement: Einsatz-Werte gibt es nur für einen freigegebenen Einsatz

Rechnung und Auskunft MUST die Werte eines Einsatzes nur nehmen, wenn die Einsatzleitung genau
diesen Einsatz für den Zugang freigegeben hat und die Freigabe wirksam ist (Spec `maschinenzugang`).
In jedem anderen Fall MUST der Server mit 404 und dem Code `not_found` antworten, stets mit
derselben Antwort, die nicht verrät, ob es den Einsatz gibt. Eine ungültige Anfrage MUST zuerst
mit 400 oder 422 abgelehnt werden.

#### Scenario: Ohne Freigabe
- **WHEN** ein Zugang mit `rechner:use` und `einsaetze:read` mit `einsatz_id` eines laufenden Einsatzes seiner Organisation rechnet, den die Einsatzleitung nicht für ihn freigegeben hat
- **THEN** antwortet der Server mit 404 und dem Code `not_found`

#### Scenario: Anderer Einsatz freigegeben
- **WHEN** der Zugang den Einsatz A liest und mit `einsatz_id` B rechnet
- **THEN** antwortet der Server mit 404 und dem Code `not_found`

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Einsatzleitung den freigegebenen Einsatz abgeschlossen hat und der Zugang danach mit dessen `einsatz_id` rechnet
- **THEN** antwortet der Server mit 404 und dem Code `not_found`

#### Scenario: Unbekannte Kennung
- **WHEN** der Zugang mit einer `einsatz_id` rechnet, die es an der Instanz nicht gibt
- **THEN** antwortet der Server mit 404 und derselben Antwort wie ohne Freigabe

#### Scenario: Nur das Recht `rechner:use`
- **WHEN** ein Zugang nur `rechner:use` trägt und mit `einsatz_id` rechnet
- **THEN** antwortet der Server mit 404, denn ein solcher Zugang lässt sich nicht freigeben

#### Scenario: Auskunft ohne Freigabe
- **WHEN** der Zugang die Auskunft mit `?einsatz_id` eines Einsatzes abruft, der nicht für ihn freigegeben ist
- **THEN** antwortet der Server mit 404 und dem Code `not_found`

#### Scenario: Ungültige Anfrage mit fremdem Einsatz
- **WHEN** eine Anfrage `weg` `personen` ohne den Block `personen` nennt und eine nicht freigegebene `einsatz_id` trägt
- **THEN** antwortet der Server mit 422, nicht mit 404
