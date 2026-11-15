# Spec Delta

## MODIFIED Requirements

### Requirement: Ein gekoppelter ELW nimmt keine Fremdsysteme an

Meldet sich eine Instanz für eine Org bei einem Hub (aktive Standardkopplung, meldende Seite, Org
zugeordnet), SHALL sie für diese Org keine Maschinenzugänge anlegen und keine Anfrage eines
Maschinenzugangs dieser Org annehmen. Die Seite „Anbindungen“ MUST den Grund nennen. Eine
Direktkopplung vor Ort mit einem zweiten ELW MUST NOT sperren.

#### Scenario: Anlegen am ELW
- **WHEN** ein Admin an einem ELW, der sich für seine Org bei einem Hub meldet, einen Zugang anlegen will
- **THEN** ist das Anlegen gesperrt, die Seite nennt den Hub als Ort für Anbindungen, und der Server antwortet auf die Anlage mit 409

#### Scenario: Anfrage am ELW
- **WHEN** ein Zugang angelegt wurde, bevor die Org gekoppelt wurde, und danach eine Anfrage schickt
- **THEN** antwortet der Server mit 401, und am Zugang steht der Grund „Instanz meldet sich bei einem Hub“

#### Scenario: Direktkopplung vor Ort sperrt nicht
- **WHEN** ein ELW sich für seine Org nur per Direktkopplung vor Ort bei einem zweiten ELW meldet und ein Zugang der Org eine gültig signierte Anfrage schickt
- **THEN** nimmt der Server sie an, die Seite „Anbindungen“ nennt keinen Sperrgrund, und ein Admin kann Zugänge anlegen

#### Scenario: Hub und Direktkopplung zugleich
- **WHEN** ein ELW sich für seine Org per Direktkopplung vor Ort bei einem zweiten ELW und per Standardkopplung bei einem Hub meldet
- **THEN** bleibt die Sperre, und die Seite nennt den Hub, nicht den zweiten ELW
