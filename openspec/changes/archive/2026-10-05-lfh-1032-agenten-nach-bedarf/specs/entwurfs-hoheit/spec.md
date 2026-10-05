# Spec Delta

## ADDED Requirements

### Requirement: Subagents und Workflows nach Bedarf
Bei der Umsetzung eines Tasks vom Entwicklungsboard MUST der Main-Loop Subagents und Workflows
nach eigenem Ermessen starten dürfen, ohne Opt-in des Menschen im Auftrag. Er MUST sie starten,
wo sie Zeit sparen oder die Güte heben, und MUST NOT sie für Arbeit starten, die ein einzelner
Lese- oder Suchschritt erledigt. Gesprächsschritte, Checkpoints und Nachrichten an den Menschen
MUST im Main-Loop bleiben.

#### Scenario: Auftrag ohne Opt-in
- **WHEN** ein Ticket-Thread mit dem Auftrag „Bearbeite das ClickUp-Ticket LFH-900“ startet und
  der Task Frontend und Backend berührt
- **THEN** darf der Main-Loop für den Scope-Fan-out Subagents oder einen Workflow starten, ohne
  vorher zu fragen

#### Scenario: Review parallel zu den Gates
- **WHEN** die Umsetzung fertig ist und `check-all.sh` läuft
- **THEN** darf der Main-Loop das Review gleichzeitig als Subagent oder Workflow starten

#### Scenario: Kleiner Task
- **WHEN** ein Task auf der Route „trivial“ nur einen Anzeigetext ändert
- **THEN** startet der Main-Loop keinen Subagent und keinen Workflow

#### Scenario: Subagent will den Menschen fragen
- **WHEN** ein Subagent auf eine Frage stößt, die nur der Mensch beantworten kann
- **THEN** gibt er sie als Blocker an den Main-Loop zurück, und der Main-Loop fragt den Menschen

## MODIFIED Requirements

### Requirement: Phase 1 gehört dem Workflow, die Klärung dem Main-Loop
Der Scope eines Tasks mit Subtasks MUST als ein Fan-out erhoben werden, der alle Subtasks
parallel liest und eine Scope-Map zurückgibt. Der Fan-out MUST als Workflow oder als parallel
gestartete Subagents laufen; die Wahl trifft der Main-Loop nach Bedarf. Jeder Eintrag der Map
MUST die vorgeschlagene Route und bei „Entwurf“ die zutreffenden Gründe (E1–E3) nennen.
`/opsx:explore` MUST NOT in einem Workflow oder Subagent laufen. Es MUST im Main-Loop für jeden
Task laufen, dessen Route „unklar“ ist, weil es ein Gespräch mit dem Menschen ist. Die Route in
der Map ist ein Vorschlag. Der Main-Loop MUST sie am Checkpoint bestätigen oder korrigieren.

#### Scenario: Klare Subtasks
- **WHEN** die Scope-Map für alle Subtasks eine Route außer „unklar“ meldet und keine offenen
  Fragen enthält
- **THEN** fasst der Main-Loop die Map zusammen und läuft ohne `/opsx:explore` weiter

#### Scenario: Ein Subtask ist unklar
- **WHEN** die Map für einen von drei Subtasks die Route „unklar“ meldet
- **THEN** läuft `/opsx:explore` im Main-Loop nur für diesen Subtask, die beiden anderen behalten
  ihre Route

#### Scenario: Scope-Fan-out über Subagents
- **WHEN** ein Parent zwei Subtasks hat und der Main-Loop dafür zwei Subagents statt eines
  Workflows startet
- **THEN** liefern beide je einen Map-Eintrag mit Route, und die Map gilt wie eine aus dem
  Workflow

### Requirement: Kein Workflow überfährt den Freigabe-Checkpoint
Ein Workflow oder Subagent MUST NOT `/opsx:explore`, `/opsx:propose`, `/opsx:update`,
`/opsx:apply` oder `/opsx:archive` aufrufen. Ebenso MUST NOT ein Workflow oder Subagent eine Datei
unter `openspec/changes/` anlegen oder ändern, außer beim Abhaken von Aufgaben einer freigegebenen
Change im autonomen Dev-Modus.
Nach `/opsx:propose` MUST der Main-Loop anhalten und die Changes des Laufs gesammelt vorlegen.
Erst mit der Freigabe des Menschen MUST ein Task auf `ready for development` und in `/opsx:apply`
gehen. Autonome Dev-Agents MUST nur an Changes arbeiten, die bereits freigegeben sind. Zeigt die
Umsetzung, dass Proposal, Spec oder Design nicht tragen, MUST der Agent abbrechen und das als
Blocker zurückgeben, statt die Artefakte selbst zu ändern.

#### Scenario: Mehrere Proposals in einem Lauf
- **WHEN** der Main-Loop in Phase 2 zwei Changes über `/opsx:propose` erzeugt hat
- **THEN** legt er beide gemeinsam vor, beide Tasks bleiben auf `in design`, und `/opsx:apply`
  beginnt erst nach der Freigabe

#### Scenario: Autonomer Agent trifft auf eine Lücke im Design
- **WHEN** ein Agent im autonomen Dev-Modus feststellt, dass die `design.md` seiner Change eine
  nötige Entscheidung nicht trifft
- **THEN** bricht er ab und meldet den Blocker, und der Main-Loop klärt ihn mit dem Menschen und
  passt die Change über `/opsx:update` an

#### Scenario: Subagent soll einen Entwurf schreiben
- **WHEN** ein Task auf „Entwurf“ steht und der Main-Loop einen Subagent mit Lesearbeit dafür
  startet
- **THEN** liefert der Subagent nur Befunde zurück, und `/opsx:propose` läuft im Main-Loop
