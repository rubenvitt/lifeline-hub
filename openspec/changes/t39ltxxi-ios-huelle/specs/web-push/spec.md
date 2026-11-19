# Spec Delta

## MODIFIED Requirements

### Requirement: Schalter je Gerät

Die Seite „Benachrichtigungen“ SHALL einen Schalter für Push auf diesem Gerät zeigen, wenn der
Server Push anbietet und der Browser es kann. In jeder App-Hülle (Desktop-App und iOS-App) MUST der Schalter fehlen.
Hat der Nutzer Push eingeschaltet, MUST das Frontend das Abo nach einer neuen Anmeldung auf
diesem Gerät von selbst wieder anmelden.

#### Scenario: Neue Anmeldung nach Ablauf
- **WHEN** die Sitzung von Person A auf dem Handy nach 7 Tagen abläuft und A sich dort neu anmeldet
- **THEN** ist Push auf dem Handy wieder an, ohne dass A den Schalter erneut betätigt

#### Scenario: iPhone im Browser
- **WHEN** Person A die Seite in Safari auf dem iPhone öffnet, ohne die App installiert zu haben
- **THEN** zeigt die Seite keinen Push-Schalter

#### Scenario: iOS-App
- **WHEN** Person A die Seite „Benachrichtigungen“ in der iOS-App öffnet
- **THEN** zeigt die Seite keinen Push-Schalter
