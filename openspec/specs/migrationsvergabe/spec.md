# migrationsvergabe Specification

## Purpose
Legt fest, welche Nummer eine neue sqlx-Migration trägt und wann das geprüft wird. So
kann ein Merge den Ziel-Branch nicht durch eine doppelte oder eingeschobene Migrationsnummer
rot machen oder in eine andere Einspielreihenfolge bringen.

## Requirements

### Requirement: Neue Migrationen werden angehängt
Eine Migrationsdatei, die ein Branch gegenüber seiner Abzweigung vom Ziel-Branch neu
mitbringt, MUST eine Nummer tragen, die größer ist als jede Migrationsnummer auf dem
**aktuellen** Stand des Ziel-Branches. Die neuen Dateien eines Branches MUST untereinander
verschiedene Nummern tragen. Die Nummer MUST das vierstellige Präfix vor dem ersten `_` im
Dateinamen bleiben.

#### Scenario: Branch ohne Konkurrenz
- **WHEN** der Ziel-Branch als höchste Nummer `0116` trägt und der Branch `0117_x.sql` neu
  mitbringt
- **THEN** besteht die Prüfung

#### Scenario: Kollision mit einem inzwischen gemergten Branch
- **WHEN** ein Branch `0117_a.sql` mitbringt und auf dem Ziel-Branch inzwischen
  `0117_b.sql` gemergt wurde
- **THEN** schlägt die Prüfung fehl, nennt `0117_a.sql` und schlägt `0118` als nächste freie
  Nummer vor

#### Scenario: Einschub unter eine schon gemergte Nummer
- **WHEN** ein Branch `0117_a.sql` mitbringt und auf dem Ziel-Branch inzwischen
  `0118_b.sql` gemergt wurde, `0117` dort aber frei ist
- **THEN** schlägt die Prüfung fehl, weil eine Datenbank mit `0118` die `0117` sonst still
  nachträglich einspielt

#### Scenario: Doppelte Nummer innerhalb eines Branches
- **WHEN** ein Branch `0117_a.sql` und `0117_b.sql` neu mitbringt
- **THEN** schlägt die Prüfung fehl und nennt beide Dateien

#### Scenario: Branch ohne neue Migration
- **WHEN** ein Branch keine Datei unter `migrations/` hinzufügt oder ändert
- **THEN** besteht die Prüfung, gleich wie weit der Ziel-Branch vorausgelaufen ist

### Requirement: Bestehende Migrationen sind unveränderlich
Eine Migrationsdatei, die es an der Abzweigung vom Ziel-Branch schon gab, MUST auf dem
Branch unverändert bleiben. Sie wird weder inhaltlich geändert noch umbenannt oder gelöscht,
weil eingespielte Datenbanken sonst an der Prüfsumme oder an einer fehlenden Version
scheitern.

#### Scenario: Inhalt einer bestehenden Migration geändert
- **WHEN** ein Branch den Inhalt einer Migration ändert, die an der Abzweigung schon existierte
- **THEN** schlägt die Prüfung fehl und nennt die Datei

#### Scenario: Bestehende Migration umbenannt
- **WHEN** ein Branch eine Migration umbenennt, die an der Abzweigung schon existierte
- **THEN** schlägt die Prüfung fehl

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

### Requirement: Umnummerieren zieht Verweise mit
Das Werkzeug MUST die neuen Migrationen eines Branches auf Wunsch auf die nächsten freien
Nummern über dem Ziel-Branch legen. Dabei MUST es jeden Verweis auf den alten Dateinamen in
versionierten Dateien auf den neuen umschreiben, etwa `include_str!` in Tests oder Pfade in
der Doku. Bestehende Migrationen MUST es nicht anfassen.

#### Scenario: Umzug nach Kollision
- **WHEN** der Branch `0117_a.sql` mitbringt, der Ziel-Branch bis `0118` reicht und ein Test
  `include_str!("../migrations/0117_a.sql")` enthält
- **THEN** heißt die Datei danach `0119_a.sql`, der Test verweist auf `0119_a.sql`, und die
  anschließende Prüfung besteht

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

### Requirement: Einspielen bleibt bei der fortlaufenden Nummer
Das Schema der Migrationsversionen MUST unverändert bleiben (`0001`…, fortlaufend). Bereits
eingespielte Datenbanken MUST ohne Übergangsschritt weiter migrieren. Das Verhalten von sqlx,
eine fehlende kleinere Version still nachzuspielen, MUST durch einen Test festgehalten sein,
damit die Regel „anhängen, nicht einschieben“ neu bewertet wird, falls sqlx es ändert.

#### Scenario: sqlx spielt einen Einschub still nach
- **WHEN** eine Datenbank Version 2 eingespielt hat und der Migrator danach die Versionen 1
  und 2 kennt
- **THEN** läuft das Einspielen ohne Fehler durch und Version 1 ist danach angewendet
