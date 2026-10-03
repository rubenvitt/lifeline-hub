## ADDED Requirements

### Requirement: Kollidierende PRs werden automatisch umnummeriert
Wird der Status `Migrationsnummern` eines offenen PRs aus diesem Repository rot und lässt sich
der Verstoß durch Umnummerieren beheben, MUST die CI die neuen Migrationen des PRs auf die
nächsten freien Nummern über dem Ziel-Branch legen, Verweise auf die alten Dateinamen
mitziehen und das Ergebnis als eigenen Commit auf den Kopf-Branch des PRs pushen. Auf dem
neuen Kopf-Commit MUST die volle CI laufen.

#### Scenario: Kollision nach fremdem Merge
- **WHEN** PR B `0143_b.sql` mitbringt und auf `alpha` gerade PR A mit `0143_a.sql` gemergt wurde
- **THEN** trägt der Branch von B danach einen Bot-Commit, der `0143_b.sql` in `0144_b.sql` umbenennt, und auf diesem Commit laufen `Migrationsnummern` und die CI-Checks neu

#### Scenario: PR wird schon kollidierend geöffnet
- **WHEN** ein PR geöffnet wird, dessen neue Migration eine Nummer trägt, die auf dem Ziel-Branch schon vergeben ist
- **THEN** bekommt er denselben Autofix-Commit wie nach einem fremden Merge

#### Scenario: Bestandsmigration verändert
- **WHEN** ein PR eine Migration ändert, umbenennt oder löscht, die es an seiner Abzweigung schon gab
- **THEN** bleibt der Status rot und die CI pusht nichts auf den Branch

### Requirement: Der Autofix schreibt nur per Fast-Forward auf den PR-Branch
Der Autofix MUST ausschließlich auf den Kopf-Branch eines PRs schreiben, dessen Kopf in diesem
Repository liegt. Er MUST nie auf `alpha`, `beta` oder `main` schreiben und MUST nur per
Fast-Forward auf genau den geprüften Kopf-Commit pushen. Hat sich der Branch inzwischen bewegt,
MUST der Push unterbleiben. Nach mehr als zwei aufeinanderfolgenden Autofix-Commits an der
Spitze eines Branches MUST er aussetzen.

#### Scenario: Branch hat sich während des Laufs bewegt
- **WHEN** zwischen Prüfung und Push ein neuer Commit auf den PR-Branch kommt
- **THEN** wird der Autofix-Commit abgewiesen, der Branch bleibt unverändert, und der neue Commit wird von seinem eigenen Lauf bewertet

#### Scenario: PR aus einem Fork
- **WHEN** der Kopf eines kollidierenden PRs in einem Fork liegt
- **THEN** bleibt der Status rot und die CI pusht nichts

#### Scenario: Kopf-Branch heißt wie ein Ziel-Branch
- **WHEN** der Kopf-Branch eines PRs `alpha`, `beta` oder `main` heißt
- **THEN** pusht der Autofix nichts

#### Scenario: Wiederholte Autofixes
- **WHEN** die letzten drei Commits eines PR-Branches Autofix-Commits sind und der Status wieder rot wird
- **THEN** pusht der Autofix nichts und meldet das im Lauf

### Requirement: Der Autofix meldet sich am PR
Nach einem erfolgreichen Autofix-Push MUST am PR ein Kommentar stehen, der jede Umbenennung
(alt → neu) nennt, auf verbliebene Fundstellen der alten Nummer hinweist und daran erinnert,
dass lokale Arbeitsstände vor dem nächsten Push den Branch holen müssen.

#### Scenario: Kommentar nach Umbenennung
- **WHEN** der Autofix `0143_b.sql` in `0144_b.sql` umbenannt und gepusht hat
- **THEN** steht am PR ein Kommentar mit `0143_b.sql → 0144_b.sql` und dem Hinweis, vor dem nächsten Push zu pullen

## MODIFIED Requirements

### Requirement: Die Prüfung läuft gegen den aktuellen Ziel-Branch
Die Regeln MUST für jeden offenen Pull Request gegen `alpha`, `beta` oder `main` als
Commit-Status `Migrationsnummern` auf dem Kopf-Commit des PRs berichtet werden. Die Prüfung
MUST neu laufen, wenn der PR geöffnet oder aktualisiert wird **und** wenn sich der
Ziel-Branch bewegt. Ein PR MUST durch einen fremden Merge rot werden können, ohne selbst
einen neuen Commit zu bekommen. Der Status MUST auf `alpha` als Required Check eingetragen
sein; fehlt der Eintrag, MUST der Lauf nach einem Push auf den Ziel-Branch das sichtbar melden.

#### Scenario: Zwei parallel grüne PRs
- **WHEN** PR A und PR B beide `0117_*.sql` mitbringen, beide grün sind und A gemergt wird
- **THEN** trägt der Kopf-Commit von B danach den Status `Migrationsnummern` = failure, und
  B lässt sich nicht mergen, solange der Status required ist

#### Scenario: Fremder Merge ohne Migration
- **WHEN** ein PR ohne neue Migration gemergt wird
- **THEN** bleibt der Status aller offenen PRs unverändert gültig

#### Scenario: Pflicht-Eintrag fehlt
- **WHEN** auf `alpha` gepusht wird und das Ruleset `Migrationsnummern` nicht unter den Required Checks führt
- **THEN** trägt der Lauf eine Warnung und einen Hinweis in der Zusammenfassung, dass rote PRs trotzdem mergebar sind
