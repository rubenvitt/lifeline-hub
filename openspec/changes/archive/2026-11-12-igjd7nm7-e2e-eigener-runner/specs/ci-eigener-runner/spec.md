# Spec Delta

## Purpose

Legt fest, wann die e2e-Jobs der CI (`e2e-Binary`, `e2e 1/4` bis `e2e 4/4`) auf dem eigenen
Server laufen statt auf GitHub-Runnern, wer dort laufen darf und dass ein Job auf dem Server
keine Spuren für den nächsten hinterlässt.

## ADDED Requirements

### Requirement: Runner-Wahl über eine Repo-Variable
Nennt die Repo-Variable `E2E_RUNNER` ein Runner-Label, MUST die CI `e2e-Binary` und die vier
e2e-Shards auf Runnern mit diesem Label starten. Ist sie leer oder fehlt sie, MUST die CI sie auf
`ubuntu-latest` starten. Zum Umschalten MUST keine Codeänderung nötig sein. Alle anderen Jobs
bleiben auf `ubuntu-latest`.

#### Scenario: Eigener Runner eingeschaltet
- **WHEN** `E2E_RUNNER` den Wert `lifeline-e2e` hat und ein PR aus dem eigenen Repository einen
  Lauf startet
- **THEN** laufen `e2e-Binary` und `e2e 1/4` bis `e2e 4/4` auf Runnern mit dem Label
  `lifeline-e2e`, die übrigen Jobs auf `ubuntu-latest`

#### Scenario: Server ausgefallen
- **WHEN** der Server nicht erreichbar ist und jemand `E2E_RUNNER` leert
- **THEN** laufen die nächsten Läufe vollständig auf `ubuntu-latest`

### Requirement: Fork-PRs laufen nie auf dem eigenen Runner
Ein Lauf für einen Pull Request, dessen Kopf-Branch in einem anderen Repository liegt, MUST
alle Jobs auf GitHub-Runnern starten, auch wenn `E2E_RUNNER` gesetzt ist. Push-Läufe auf die
Kanal-Branches und PRs aus dem eigenen Repository dürfen den eigenen Runner nutzen.

#### Scenario: PR aus einem Fork
- **WHEN** `E2E_RUNNER` gesetzt ist und ein PR aus einem Fork einen Lauf startet
- **THEN** laufen `e2e-Binary` und die e2e-Shards auf `ubuntu-latest`

#### Scenario: Fork ändert die Weiche
- **WHEN** ein PR aus einem Fork das Skript der Runner-Wahl so ändert, dass es immer das Label
  ausgibt, und `ci.yml` unverändert lässt
- **THEN** laufen `e2e-Binary` und die e2e-Shards trotzdem auf `ubuntu-latest`, weil die Wahl der
  Fassung des Ziel-Branches folgt

#### Scenario: Push auf alpha
- **WHEN** `E2E_RUNNER` gesetzt ist und ein Merge auf `alpha` einen Push-Lauf startet
- **THEN** laufen `e2e-Binary` und die e2e-Shards auf dem eigenen Runner

### Requirement: Gleiche Checks auf beiden Runner-Arten
Job-Namen, Check-Namen und das Ergebnis der Prüfung MUST nicht davon abhängen, auf welcher
Runner-Art ein Job lief. Beide Arten MUST dieselbe e2e-Suite über `scripts/check-all.sh` fahren,
mit denselben drei Browser-Projekten.

#### Scenario: Required Checks
- **WHEN** ein PR auf dem eigenen Runner geprüft wurde
- **THEN** tragen seine Checks die Namen `e2e-Binary` und `e2e 1/4` bis `e2e 4/4`, und das
  Ruleset erkennt sie ohne Änderung

### Requirement: Ein Job auf dem eigenen Runner beginnt auf leerem Stand
Jeder Job auf dem eigenen Runner MUST in einer frischen Umgebung beginnen, die kein vorheriger
Job benutzt hat: kein Arbeitsverzeichnis, keine Temp-Dateien, keine Prozesse eines früheren
Jobs. Eine Runner-Registrierung MUST für genau einen Job gelten. Geteilt werden darf nur ein
inhaltsadressierter Compiler-Cache mit fester Obergrenze.

#### Scenario: Zwei Jobs nacheinander auf demselben Platz
- **WHEN** ein e2e-Shard abgebrochen wurde, während Backend und Vite liefen, und danach ein neuer
  Job auf demselben Server-Platz startet
- **THEN** findet der neue Job weder diese Prozesse noch deren Dateien vor

#### Scenario: Compiler-Cache wächst nicht ohne Grenze
- **WHEN** über Wochen Debug-Builds verschiedener Branches auf dem Server laufen
- **THEN** bleibt der Compiler-Cache unter seiner eingestellten Obergrenze

### Requirement: Der Job braucht auf dem eigenen Runner keine Root-Rechte
Auf dem eigenen Runner MUST ein Job ohne `sudo` auskommen: Browser, ihre Systempakete und die
Build-Werkzeuge MUST die Runner-Umgebung mitbringen. Passt die vorinstallierte Browser-Version
nicht zur Playwright-Version des Lockfiles, MUST der Job die passenden Browser selbst laden und
das im Log als Hinweis zum Neubau des Images melden, statt zu scheitern.

#### Scenario: Playwright im Lockfile aktualisiert
- **WHEN** ein PR `@playwright/test` hebt und das Image des Servers noch die alten Browser trägt
- **THEN** lädt der Shard die neuen Browser, die Suite läuft, und das Log nennt den Neubau des
  Images als nötig
