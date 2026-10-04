# http-schutzkoepfe Specification

## Purpose
Legt die Schutzköpfe fest, die der Server an jede HTTP-Antwort hängt, damit ein Browser keine
Antwort anders deutet als ihr Content-Type sagt — unabhängig davon, ob die einzelne Route daran
gedacht hat.

## Requirements

### Requirement: Jede Antwort trägt nosniff

Jede HTTP-Antwort des Servers MUST den Kopf `X-Content-Type-Options: nosniff` tragen: API-
Antworten, Fehlerantworten (auch 404, 405, 503 der Zulassung und 500 nach einer Handler-Panik),
Datei-Downloads und die eingebetteten Frontend-Dateien. Der Kopf MUST genau einmal vorkommen,
auch wenn die Route ihn selbst setzt.

#### Scenario: JSON-Antwort einer API-Route
- **WHEN** ein angemeldeter Client eine API-Route abruft, die JSON liefert
- **THEN** trägt die Antwort `X-Content-Type-Options: nosniff`

#### Scenario: Download des Karten-Hintergrundbilds
- **WHEN** ein berechtigter Client ein hochgeladenes Hintergrundbild der Lagekarte herunterlädt
- **THEN** trägt die Antwort `X-Content-Type-Options: nosniff`

#### Scenario: Route setzt den Kopf schon selbst
- **WHEN** ein Anhang-Download antwortet, dessen Route `nosniff` bereits setzt
- **THEN** steht `X-Content-Type-Options` genau einmal in der Antwort, mit dem Wert `nosniff`

#### Scenario: Unbekannte API-Route
- **WHEN** ein Client eine nicht vorhandene Route unter `/api/` abruft
- **THEN** antwortet der Server mit 404 und `X-Content-Type-Options: nosniff`

#### Scenario: Eingebettete Frontend-Datei
- **WHEN** ein Browser die Startseite oder eine Datei des eingebetteten Frontends abruft
- **THEN** trägt die Antwort `X-Content-Type-Options: nosniff` und einen zur Endung passenden Content-Type
