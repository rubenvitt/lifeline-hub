# Spec Delta

## MODIFIED Requirements

### Requirement: Ein gekoppelter ELW nimmt keine Einwürfe an

Meldet sich eine Instanz für eine Org bei einem Hub (aktive Standardkopplung, meldende Seite, Org
zugeordnet), SHALL sie für diese Org keine Einwurf-Zugänge anlegen, keinen Schlüssel wechseln und
keinen Einwurf eines Zugangs dieser Org annehmen. Das Paneel MUST den Grund nennen. Widerrufen
bleibt möglich. Eine Direktkopplung vor Ort mit einem zweiten ELW MUST NOT sperren.

#### Scenario: Anlegen am ELW
- **WHEN** ein Admin an einem ELW, der sich für seine Org bei einem Hub meldet, einen Einwurf-Zugang anlegen will
- **THEN** ist das Anlegen gesperrt, das Paneel nennt den Hub als Ort für Anbindungen, und der Server antwortet auf die Anlage mit 409

#### Scenario: Einwurf am ELW
- **WHEN** ein Zugang angelegt wurde, bevor die Org gekoppelt wurde, und danach ein Einwurf kommt
- **THEN** antwortet der Server mit 401 und speichert nichts

#### Scenario: Direktkopplung vor Ort sperrt nicht
- **WHEN** ein ELW sich für seine Org nur per Direktkopplung vor Ort bei einem zweiten ELW meldet und ein Einwurf eines Zugangs der Org kommt
- **THEN** nimmt der Server ihn an, das Paneel nennt keinen Sperrgrund, und ein Admin kann Einwurf-Zugänge anlegen und Schlüssel wechseln
