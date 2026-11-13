# Spec Delta

## MODIFIED Requirements

### Requirement: Kein Bearer-Token und keine Sitzung unter /api/v1/

Eine Route unter `/api/v1/` MUST NOT ein Bearer-Token, ein Sitzungs-Cookie oder ein geteiltes
Geheimnis als Anmeldung annehmen. Eine Anmelderoute der eigenen Oberfläche MUST NOT
`Authorization: Machine` annehmen. Einzige Ausnahme ist der Einwurf (Spec `einwurf-zugang`): Die
Routen unter `/api/v1/einwurf/` nehmen einen Schlüssel im Pfad an, schreiben nur und lesen
nichts. Ein Einwurf-Schlüssel MUST NOT an einer anderen Route als Anmeldung gelten.

#### Scenario: Bearer
- **WHEN** eine Anfrage an `GET /api/v1/me` `Authorization: Bearer …` trägt, auch mit einem gültigen Lagemonitor-Schlüssel
- **THEN** antwortet der Server mit 401

#### Scenario: Sitzung
- **WHEN** ein angemeldeter Admin `GET /api/v1/me` mit seinem Sitzungs-Cookie aufruft
- **THEN** antwortet der Server mit 401

#### Scenario: Einwurf-Schlüssel an einer anderen Route
- **WHEN** eine Anfrage an `GET /api/v1/me` einen gültigen Einwurf-Schlüssel im Kopf `Authorization` oder in der Abfrage trägt
- **THEN** antwortet der Server mit 401

### Requirement: Fehlversuche von Maschinen sperren nie die Anmeldung von Menschen

Der Server SHALL je Quelle in einem eigenen Zähler für Maschinen nur unbekannte Zugangs-IDs,
gescheiterte Einlösungen und unbekannte Einwurf-Schlüssel zählen. Nach 10 Fehlversuchen in 5
Minuten MUST er sie auf den Maschinenwegen, auch beim Einwurf, mit 429 abweisen. Der Zähler MUST
NOT die Anmeldesperre für Passwort, Passkey oder Gerätekopplung berühren. Falsche Signatur oder
Uhr eines bekannten Zugangs und ein widerrufener, abgelaufener oder abgelöster Einwurf-Schlüssel
MUST NOT zählen.

#### Scenario: Falsche Uhr hinter NAT
- **WHEN** ein bekannter Zugang hinter derselben IP wie eine Wache mehr als zehnmal mit falscher Uhr signiert
- **THEN** bleibt die Passwort-Anmeldung von dieser IP möglich, und die Maschinenwege dieser IP sind nicht gesperrt

#### Scenario: Durchprobieren von Zugangs-IDs
- **WHEN** eine Quelle in 5 Minuten zehn Anfragen mit unbekannten Zugangs-IDs schickt
- **THEN** antwortet der Server auf weitere Maschinen-Anfragen dieser Quelle mit 429, und die Passwort-Anmeldung von dort bleibt möglich

#### Scenario: Durchprobieren von Einwurf-Schlüsseln
- **WHEN** eine Quelle in 5 Minuten zehn Einwürfe mit unbekannten Schlüsseln schickt
- **THEN** antwortet der Server auf weitere Einwürfe dieser Quelle mit 429, auch mit gültigem Schlüssel, und die Passwort-Anmeldung von dort bleibt möglich

#### Scenario: Abgelöster Einwurf-Schlüssel hinter NAT
- **WHEN** ein Admin den Schlüssel eines Einwurf-Zugangs wechselt und der Absender hinter derselben IP wie eine Wache weiter mehr als zehnmal mit dem alten Schlüssel einwirft
- **THEN** bekommt er jedes Mal 401, und der neue Schlüssel wird von dieser IP angenommen

#### Scenario: Widerrufener Einwurf-Schlüssel hinter NAT
- **WHEN** ein Absender hinter derselben IP wie eine Wache mehr als zehnmal mit einem widerrufenen Einwurf-Schlüssel einwirft
- **THEN** bekommt er jedes Mal 401, und die Maschinenwege dieser IP sind nicht gesperrt
