# Spec Delta

## MODIFIED Requirements

### Requirement: Runner-Wahl über eine Repo-Variable
Nennt die Repo-Variable `E2E_RUNNER` ein Runner-Label, MUST die CI `e2e-Binary` und die vier
e2e-Shards auf Runnern mit diesem Label starten. Ist sie leer oder fehlt sie, MUST die CI sie auf
`ubuntu-latest` starten. Zum Umschalten MUST keine Codeänderung nötig sein. Alle anderen Jobs
bleiben auf `ubuntu-latest`.

#### Scenario: Eigener Runner eingeschaltet
- **WHEN** `E2E_RUNNER` den Wert `lifeline-e2e` hat und ein PR aus dem eigenen Repository mit dem
  Label `voll` einen Lauf startet
- **THEN** laufen `e2e-Binary` und `e2e 1/4` bis `e2e 4/4` auf Runnern mit dem Label
  `lifeline-e2e`, die übrigen Jobs auf `ubuntu-latest`

#### Scenario: Server ausgefallen
- **WHEN** der Server nicht erreichbar ist und jemand `E2E_RUNNER` leert
- **THEN** laufen die nächsten Läufe vollständig auf `ubuntu-latest`

### Requirement: Gleiche Checks auf beiden Runner-Arten
Job-Namen, Check-Namen und das Ergebnis der Prüfung MUST nicht davon abhängen, auf welcher
Runner-Art ein Job lief. Beide Arten MUST dieselbe e2e-Suite über `scripts/check-all.sh` fahren,
mit denselben drei Browser-Projekten.

#### Scenario: Required Checks
- **WHEN** ein Lauf auf `alpha` einmal auf dem eigenen Runner und einmal auf GitHub-Runnern geprüft wurde
- **THEN** tragen die e2e-Checks beider Läufe dieselben Namen; Pflicht im Ruleset sind sie nicht mehr (`pr-pruefstufen`)
