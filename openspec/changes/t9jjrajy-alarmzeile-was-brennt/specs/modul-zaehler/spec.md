## ADDED Requirements

### Requirement: Sofort- und dringende Meldungen im Zähler
Der Zähler `meldungen` SHALL zusätzlich `sofort_offen` und `dringend_offen` liefern. `sofort_offen`
MUST die offenen, unbestätigten Meldungen zählen, die den Sofortalarm auslösen, nach derselben
Regel wie die Zahl des Lagemonitors. `dringend_offen` MUST die offenen, unbestätigten Meldungen mit Priorität
„dringend“ zählen, die keine Sofortmeldungen sind.

#### Scenario: Eine Sofortmeldung und eine dringende
- **WHEN** der Einsatz eine offene, unbestätigte Sofortmeldung, eine offene, unbestätigte dringende
  Meldung und eine bestätigte Sofortmeldung hat
- **THEN** ist `meldungen.sofort_offen: 1` und `meldungen.dringend_offen: 1`

#### Scenario: Gleich wie der Lagemonitor
- **WHEN** der Lagemonitor „Sofortmeldungen offen 2“ zeigt
- **THEN** liefert der Modulzähler desselben Einsatzes `meldungen.sofort_offen: 2`

#### Scenario: Sofortmeldung mit Priorität dringend
- **WHEN** eine Meldung der Art „Sofortmeldung“ die Priorität „dringend“ trägt
- **THEN** zählt sie in `sofort_offen` und nicht in `dringend_offen`

### Requirement: Alarm der ältesten offenen Sofortmeldung
Gibt es offene Sofortmeldungen, SHALL der Zähler `meldungen` in `sofort_aelteste_at` den frühesten
Sofortalarm unter ihnen tragen (UTC): bei einer heraufgestuften Meldung den Zeitpunkt ihres
Alarms, sonst ihren Eingang. Ohne offene Sofortmeldung MUST das Feld fehlen.

#### Scenario: Älteste offene Sofortmeldung
- **WHEN** zwei offene, unbestätigte Sofortmeldungen um 14:02 und 14:05 UTC eingegangen sind
- **THEN** trägt `meldungen.sofort_aelteste_at` den Zeitpunkt 14:02 UTC

#### Scenario: Heraufgestufte Meldung zählt ab dem Alarm
- **WHEN** eine Meldung um 13:30 UTC als „normal“ einging, um 14:20 UTC zur Sofortmeldung heraufgestuft wurde und eine zweite Sofortmeldung um 14:02 UTC einging
- **THEN** trägt `meldungen.sofort_aelteste_at` den Zeitpunkt 14:02 UTC

#### Scenario: Keine offene Sofortmeldung
- **WHEN** alle Sofortmeldungen bestätigt sind
- **THEN** fehlt `meldungen.sofort_aelteste_at`
