# Spec Delta

## ADDED Requirements

### Requirement: Ein gekoppelter ELW pusht über den Hub

Ist die Org eines Einsatzes mit einem Hub gekoppelt, der Hinweise annimmt und Web Push anbietet,
MUST der ELW für diesen Einsatz keinen Push senden; den Push sendet der Hub an die Abos seiner
Empfänger (Spec `benachrichtigungen`, „Hinweise zu einem Einsatz des ELW entstehen auch am Hub“).
Bietet der Hub keinen Push an oder kennt er Hinweise nicht, SHALL der ELW pushen wie ohne
Kopplung. Hinweis, Live-Ereignis und Ton am ELW bleiben.

#### Scenario: Hub mit Push
- **WHEN** der ELW mit Push läuft, seine Org mit einem Hub mit Push gekoppelt ist und eine Sofortmeldung an Person A geht
- **THEN** geht vom ELW kein Push an A's Abos, A's Tab am ELW zeigt den Alarm, und der Hub pusht an A's Abos am Hub

#### Scenario: Hub ohne Push
- **WHEN** der Hub ohne Push läuft und am ELW eine Sofortmeldung an Person A geht
- **THEN** pusht der ELW an A's Abos am ELW wie ohne Kopplung

#### Scenario: Älterer Hub
- **WHEN** der Hub einen Softwarestand hat, der Hinweise nicht annimmt
- **THEN** pusht der ELW wie ohne Kopplung

#### Scenario: Einsatz einer ungekoppelten Org
- **WHEN** der ELW zwei Orgs hat, nur eine davon gekoppelt ist und ein Einsatz der anderen eine Sofortmeldung erhält
- **THEN** pusht der ELW für diesen Einsatz selbst

### Requirement: Push-Einstellung am gekoppelten ELW verweist auf den Hub

Bietet der ELW Push an und ist die Org eines Nutzers mit einem Hub mit Push gekoppelt, SHALL die
Seite „Benachrichtigungen“ am ELW statt des Schalters den Hinweis „Push läuft über ‹Name des
Hubs›“ mit einem Link zum Hub zeigen. Ein neues Abo dieses Nutzers am ELW MUST der Server mit 422
ablehnen. Bestehende Abos MUST gespeichert bleiben und nach dem Entkoppeln wieder Pushs erhalten.

#### Scenario: Seite am ELW
- **WHEN** Person A am gekoppelten ELW die Seite „Benachrichtigungen“ öffnet
- **THEN** sieht sie „Push läuft über ‹Name des Hubs›“ mit einem Link zum Hub und keinen Push-Schalter

#### Scenario: Neues Abo am ELW
- **WHEN** ein Browser am gekoppelten ELW ein Abo anmelden will
- **THEN** antwortet der Server mit 422 und speichert nichts

#### Scenario: Entkoppelt
- **WHEN** Person A vor der Kopplung Push am ELW eingeschaltet hatte und die Kopplung widerrufen wird
- **THEN** erhält A's Gerät wieder Pushs vom ELW, ohne dass A Push erneut einschaltet
