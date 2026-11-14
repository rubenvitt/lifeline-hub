# Spec Delta

## ADDED Requirements

### Requirement: Kollidierende PRs werden umnummeriert und leicht neu geprüft
Lässt sich ein roter Status `Migrationsnummern` eines PRs aus diesem Repository durch
Umnummerieren beheben, MUST die CI seine neuen Migrationen auf die nächsten freien Nummern über
dem Ziel-Branch legen, Verweise mitziehen und das als eigenen Commit auf den PR-Branch pushen.
Auf dem neuen Kopf MUST `Migrationsnummern` und die Schnellprüfungen neu laufen, mit Label `voll`
zusätzlich alle Suiten.

#### Scenario: Kollision nach fremdem Merge
- **WHEN** PR B `0143_b.sql` mitbringt und auf `alpha` gerade PR A mit `0143_a.sql` gemergt wurde
- **THEN** trägt der Branch von B danach einen Bot-Commit, der `0143_b.sql` in `0144_b.sql` umbenennt, und auf diesem Commit laufen `Migrationsnummern` und die Schnellprüfungen neu

#### Scenario: PR wird schon kollidierend geöffnet
- **WHEN** ein PR geöffnet wird, dessen neue Migration eine Nummer trägt, die auf dem Ziel-Branch schon vergeben ist
- **THEN** bekommt er denselben Autofix-Commit wie nach einem fremden Merge

#### Scenario: Bestandsmigration verändert
- **WHEN** ein PR eine Migration ändert, umbenennt oder löscht, die es an seiner Abzweigung schon gab
- **THEN** bleibt der Status rot und die CI pusht nichts auf den Branch

#### Scenario: Fremde Migration auf dem Ziel-Branch verträgt sich nicht
- **WHEN** PR B nur umnummeriert wurde und die inzwischen gemergte Migration von PR A dieselbe Spalte anlegt wie die von B
- **THEN** ist nach dem Merge von B die Rust-Suite auf `alpha` rot, und der alpha-rot-Ablauf greift; mit Label `voll` zeigt es schon die Rust-Suite am PR

## REMOVED Requirements

### Requirement: Kollidierende PRs werden automatisch umnummeriert
**Reason**: Im PR laufen keine schweren Suiten mehr, die Übernahme grüner Suiten nach einer reinen Umnummerierung (`scripts/nur-umnummeriert.sh`) hat nichts mehr zu sparen (LLH-1889).
**Migration**: „Kollidierende PRs werden umnummeriert und leicht neu geprüft“. Der Autofix selbst (`scripts/migrationen-autofix.sh`) bleibt unverändert.
