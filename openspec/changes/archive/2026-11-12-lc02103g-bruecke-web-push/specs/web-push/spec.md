# Spec Delta

## ADDED Requirements

### Requirement: Ein gekoppelter ELW pusht über den Hub

Ist die Org eines Einsatzes mit einem Hub gekoppelt, der Hinweise annimmt und Web Push anbietet,
MUST der ELW für diesen Einsatz an Konten, die vom Hub stammen, keinen Push senden; ihnen pusht
der Hub (Spec `benachrichtigungen`). Allen anderen Konten SHALL der ELW pushen wie ohne
Kopplung, ebenso allen, wenn der Hub keinen Push anbietet oder Hinweise nicht kennt.

#### Scenario: Hub mit Push
- **WHEN** der ELW mit Push läuft, seine Org mit einem Hub mit Push gekoppelt ist und eine Sofortmeldung an Person A geht
- **THEN** geht vom ELW kein Push an A's Abos, A's Tab am ELW zeigt den Alarm, und der Hub pusht an A's Abos am Hub

#### Scenario: Hub ohne Push
- **WHEN** der Hub ohne Push läuft und am ELW eine Sofortmeldung an Person A geht
- **THEN** pusht der ELW an A's Abos am ELW wie ohne Kopplung

#### Scenario: Älterer Hub
- **WHEN** der Hub einen Softwarestand hat, der Hinweise nicht annimmt
- **THEN** pusht der ELW wie ohne Kopplung

#### Scenario: Konto nur am ELW
- **WHEN** ein Spontanhelfer mit einem Konto nur am ELW Push eingeschaltet hat und eine Sofortmeldung an ihn geht
- **THEN** pusht der ELW an sein Abo, obwohl der Hub Push anbietet

#### Scenario: Einsatz einer ungekoppelten Org
- **WHEN** der ELW zwei Orgs hat, nur eine davon gekoppelt ist und ein Einsatz der anderen eine Sofortmeldung erhält
- **THEN** pusht der ELW für diesen Einsatz selbst

### Requirement: Push-Einstellung am gekoppelten ELW verweist auf den Hub

Bietet der ELW Push an und stammt das Konto eines Nutzers von einem Hub mit Push, SHALL die
Seite „Benachrichtigungen“ am ELW statt des Schalters den Hinweis „Push läuft über ‹Name des
Hubs›“ mit einem Link zum Hub zeigen. Ein neues Abo dieses Nutzers am ELW MUST der Server mit 422
ablehnen. Bestehende Abos MUST gespeichert bleiben und nach dem Entkoppeln wieder Pushs erhalten.

#### Scenario: Seite am ELW
- **WHEN** Person A am gekoppelten ELW die Seite „Benachrichtigungen“ öffnet
- **THEN** sieht sie „Push läuft über ‹Name des Hubs›“ mit einem Link zum Hub und keinen Push-Schalter

#### Scenario: Eigenes Konto des ELW
- **WHEN** ein Konto, das nur am ELW besteht, die Seite „Benachrichtigungen“ öffnet
- **THEN** sieht es den Push-Schalter wie ohne Kopplung

#### Scenario: Neues Abo am ELW
- **WHEN** ein Browser am gekoppelten ELW ein Abo anmelden will
- **THEN** antwortet der Server mit 422 und speichert nichts

#### Scenario: Entkoppelt
- **WHEN** Person A vor der Kopplung Push am ELW eingeschaltet hatte und die Kopplung widerrufen wird
- **THEN** erhält A's Gerät wieder Pushs vom ELW, ohne dass A Push erneut einschaltet
