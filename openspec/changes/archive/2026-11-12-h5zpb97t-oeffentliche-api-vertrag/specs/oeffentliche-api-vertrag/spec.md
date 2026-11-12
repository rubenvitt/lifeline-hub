# Spec Delta

## Purpose

Legt den Vertrag der öffentlichen API unter `/api/v1/` fest, auf den sich Fremdsysteme verlassen:
das Dokument mit Pfaden und seinen Schutz vor Drift, die Stabilitätszusage, die Fehlerform mit
stabilem Code sowie Grenzen und Köpfe, die für jede v1-Route gelten.

## ADDED Requirements

### Requirement: Jede v1-Route steht im öffentlichen Dokument

Die Anwendung MUST unter `GET /api/v1/openapi.json` ohne Anmeldung ein OpenAPI-Dokument ausliefern.
Es nennt jede Route unter `/api/v1/` mit Methode, Pfad, Parametern, Antwortschemas und möglichen
Fehlercodes. Eine Route unter `/api/v1/` ohne Eintrag im Dokument MUST NOT erreichbar sein.

#### Scenario: Dokument abrufen
- **WHEN** ein Client ohne Anmeldung `GET /api/v1/openapi.json` aufruft
- **THEN** antwortet die Anwendung mit 200 und einem OpenAPI-Dokument im JSON-Format
- **AND** das Dokument enthält den Pfad `/api/v1/openapi.json`

#### Scenario: Route ohne Dokumenteintrag
- **WHEN** eine Route unter `/api/v1/` eingehängt wird
- **THEN** steht sie mit Methode und Pfad im ausgelieferten Dokument

### Requirement: Das öffentliche Dokument ist versioniert und gegen Drift geschützt

Das Dokument MUST versioniert unter `docs/api/public-v1.json` liegen. Weicht das Dokument aus dem
Code von der versionierten Datei ab, MUST das Typ-Gate (`scripts/check-typ-codegen.sh`) fehlschlagen.
Das OpenAPI-Dokument des Frontends (`frontend/src/api/openapi.json`) MUST ohne Pfade bleiben.

#### Scenario: Geänderte v1-Route ohne neu geschriebenes Dokument
- **WHEN** eine v1-Route oder ein v1-Schema geändert wird und `docs/api/public-v1.json` nicht neu
  geschrieben ist
- **THEN** scheitert `scripts/check-typ-codegen.sh`
- **AND** die Datei ist danach neu geschrieben, sodass ein zweiter Lauf nach dem Commit grün ist

#### Scenario: Frontend-Dokument bleibt ohne Pfade
- **WHEN** das Typ-Gate läuft
- **THEN** enthält `frontend/src/api/openapi.json` `"paths": {}`

### Requirement: Das Dokument trägt die Stabilitätszusage und die Regeln des Wire

Die Beschreibung des Dokuments MUST nennen:

- dass innerhalb von v1 nur Routen, optionale Felder, Scopes und Enum-Werte hinzukommen;
- dass Clients unbekannte Enum-Werte überspringen;
- dass ein Bruch `/api/v2/` heißt und v1 dann mindestens sechs Monate mit `Deprecation` und
  `Sunset` erreichbar bleibt;
- die Kurzfassung der Namensregel;
- Zeitpunkte als UTC im Format `JJJJ-MM-TT hh:mm:ss`;
- die Tabelle der Fehlercodes.

#### Scenario: Zusage im Dokument
- **WHEN** ein Client das Dokument liest
- **THEN** enthält `info.description` die Stabilitätszusage, die Namensregel, die Zeitzone UTC und
  jeden Fehlercode mit seinem Status

### Requirement: Fehler unter /api/v1 tragen einen stabilen Code

Jede Fehlerantwort (Status 4xx oder 5xx) unter `/api/v1/` MUST als JSON `{"error": <Text>, "code":
<Code>}` kommen. Der Text ist deutsche Prosa ohne Vertrag; Vertrag ist `code`. Das gilt auch für
abgelehnte Eingaben, unbekannte Pfade, falsche Methoden, zu große Bodies, Lastabwurf und interne
Fehler. Außerhalb von `/api/v1/` MUST die Fehlerform unverändert `{error}` bleiben.

#### Scenario: Unbekannter Pfad unter v1
- **WHEN** ein Client `GET /api/v1/gibt-es-nicht` aufruft
- **THEN** antwortet die Anwendung mit 404 und `{"error": …, "code": "not_found"}`

#### Scenario: Falsche Methode
- **WHEN** ein Client `DELETE /api/v1/openapi.json` aufruft
- **THEN** antwortet die Anwendung mit 405 und `code` `method_not_allowed`

#### Scenario: Kaputter JSON-Body an einer v1-Route
- **WHEN** ein Client an eine v1-Route mit Body syntaktisch kaputtes JSON schickt
- **THEN** antwortet die Anwendung mit 400 und `code` `invalid_field`

#### Scenario: Interne Route unverändert
- **WHEN** ein Client `GET /api/gibt-es-nicht` aufruft
- **THEN** antwortet die Anwendung mit 404 und einem Body ohne Feld `code`

### Requirement: Jeder Fehlerstatus hat einen Vorgabe-Code

Ein Fehler ohne ausdrücklichen Code MUST den Vorgabe-Code seines Status tragen: 400
`invalid_field`, 401 `unauthorized`, 403 `missing_scope`, 404 `not_found`, 405
`method_not_allowed`, 409 `conflict`, 410 `cursor_expired`, 413 `payload_too_large`, 422
`unprocessable`, 429 `rate_limited`, 500 `internal_error`, 503 `unavailable`. Jeder andere Status
ergibt `unprocessable` (4xx) oder `internal_error` (5xx).

#### Scenario: Status ohne eigenen Code
- **WHEN** eine v1-Route mit einem 4xx-Status antwortet, für den die Liste keinen Code nennt
- **THEN** trägt die Antwort `code` `unprocessable`

#### Scenario: Interner Fehler ohne Einzelheiten
- **WHEN** eine v1-Route an einem Datenbankfehler scheitert
- **THEN** antwortet die Anwendung mit 500 und `code` `internal_error`
- **AND** der Text nennt weder SQL noch Pfade

### Requirement: Die Liste der Fehlercodes wächst nur

Neben den Vorgabe-Codes MUST es genau zwei ausdrückliche Codes geben: `tls_required` (403) und
`fuehrung_elsewhere` (409, eine andere Instanz führt den Einsatz). Innerhalb von v1 MUST ein Code
nur hinzukommen, nie umbenannt, umgedeutet oder entfernt werden.

#### Scenario: Ausdrücklicher Code einer Route
- **WHEN** eine v1-Route einen Fehler mit einem bestimmten Code meldet, etwa 403 `tls_required`
- **THEN** trägt die Antwort genau diesen Code und nicht den Vorgabe-Code ihres Status

#### Scenario: Schreibweg an einem Spiegel
- **WHEN** ein v1-Schreibweg einen Einsatz trifft, den eine andere Instanz führt
- **THEN** antwortet die Anwendung mit 409 und `code` `fuehrung_elsewhere`

### Requirement: v1-Bodies sind auf 64 KiB begrenzt

Eine Route unter `/api/v1/` MUST einen Body über 64 KiB ablehnen, bevor ihr Handler läuft. Die
Antwort ist 413 mit `code` `payload_too_large`.

#### Scenario: Zu großer Body
- **WHEN** ein Client an eine v1-Route einen Body von 64 KiB plus ein Byte schickt
- **THEN** antwortet die Anwendung mit 413 und `code` `payload_too_large`

### Requirement: v1-Antworten werden nicht zwischengespeichert

Jede Antwort unter `/api/v1/` MUST den Kopf `Cache-Control: no-store` tragen, auch eine
Fehlerantwort.

#### Scenario: Erfolg und Fehler ohne Cache
- **WHEN** ein Client `GET /api/v1/openapi.json` und `GET /api/v1/gibt-es-nicht` aufruft
- **THEN** tragen beide Antworten `Cache-Control: no-store`
