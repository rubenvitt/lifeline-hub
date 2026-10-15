# Spec Delta

## ADDED Requirements

### Requirement: Zahl der offenen Sofortmeldungen

Der Lagemonitor SHALL bei den Kopfzahlen die Zahl der offenen, noch nicht bestätigten
Sofortmeldungen zeigen. Er MUST sie als verdichtete Zahl vom Server erhalten, ohne Meldungstext,
Absender oder Empfänger.

#### Scenario: Zwei offene Sofortmeldungen
- **WHEN** im Einsatz zwei Sofortmeldungen unbestätigt sind
- **THEN** zeigt der Lagemonitor „Sofortmeldungen offen 2“

### Requirement: Neue Dringlichkeit sichtbar hervorheben

Steigt die Zahl der offenen Sofortmeldungen oder der Personen der Sichtungskategorie I, SHALL der
Lagemonitor die betroffene Zahl 60 Sekunden lang sichtbar hervorheben, ohne Ton, ohne Blinken und
ohne Inhalt oder Personenbezug der Meldung. Sinkt oder bleibt die Zahl, MUST keine Hervorhebung
entstehen.

#### Scenario: Neue Sofortmeldung
- **WHEN** die Zahl der offenen Sofortmeldungen von 0 auf 1 steigt
- **THEN** hebt der Lagemonitor die Zahl 60 Sekunden lang hervor und spielt keinen Ton
- **AND** enthält die Antwort des Servers keinen Meldungstext

#### Scenario: Sofortmeldung bestätigt
- **WHEN** die Zahl der offenen Sofortmeldungen von 2 auf 1 sinkt
- **THEN** entsteht keine Hervorhebung
