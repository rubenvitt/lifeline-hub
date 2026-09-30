# Spec Delta

## Purpose

Legt fest, wer bei der Umsetzung eines Tasks vom Entwicklungsboard den Scope und den Entwurf
besitzt: der Orchestrierungs-Workflow die Menge, OpenSpec den einzelnen Datensatz. Außerdem regelt
die Spec, wann eine Change unter `openspec/changes/` entsteht und wie die Freigabe des Menschen
gegen Hintergrund-Workflows gesichert ist.

## ADDED Requirements

### Requirement: Eine Change entsteht genau auf der Route „Entwurf“
Das Routing von `dev-clickup-ausfuehren` kennt fünf Routen mit festen Schlüsseln: `trivial`
(„trivial“), `unklar` („Anforderung unklar“), `bug-unklar` („Bug, Ursache unklar“), `klar`
(„klare Spec“) und `entwurf` („Entwurf“). Ein (Sub)Task MUST genau dann eine OpenSpec-Change
bekommen, wenn das Routing für ihn die Route „Entwurf“ wählt. Die Route „Entwurf“ MUST gewählt
werden, wenn mindestens einer dieser Gründe zutrifft:

- **E1 Entscheidung:** Es gibt mehr als einen vertretbaren Weg, und die Wahl soll begründet
  nachlesbar bleiben.
- **E2 Regel:** Der Task führt eine Regel ein oder ändert eine, die über ihn hinaus gilt. Das
  kann eine Anforderung einer Fähigkeit sein, eine Projektregel in `CLAUDE.md` oder eine Regel in
  einer Arbeitsanleitung unter `.claude/`.
- **E3 Breite:** Der Task berührt mehr als ein Subsystem. Subsysteme sind: Backend (`src/`,
  `migrations/`, `tests/`), Frontend (`frontend/`), Desktop-Hülle (`src-tauri/`), Gate und CI
  (`scripts/`, `.github/`), Arbeitsanleitungen (`.claude/`, `CLAUDE.md`). Pfade außerhalb dieser
  Liste zählen zu keinem Subsystem. E3 gilt nicht für einen Bugfix, der vorhandenes Verhalten
  wiederherstellt, und nicht für eine reine Text- oder Tippfehlerkorrektur.

Für die Routen „trivial“, „Bug, Ursache unklar“ und „klare Spec“ MUST keine Change entstehen.
Die Route „Anforderung unklar“ MUST zuerst `/opsx:explore` durchlaufen und danach neu geroutet
werden. Erst das Ergebnis entscheidet über eine Change. Führt die gefundene Ursache auf der
Route „Bug, Ursache unklar“ auf E1 oder E2, MUST der Task auf „Entwurf“ wechseln. Sein
Board-Status bleibt dabei vorwärts gerichtet, und der Freigabe-Checkpoint MUST trotzdem vor
`/opsx:apply` gelten.

#### Scenario: Feature über Backend und Frontend
- **WHEN** ein Task laut Scope-Map Dateien unter `src/` und `frontend/` ändert
- **THEN** ist die Route „Entwurf“ (E3) und der Task bekommt eine Change

#### Scenario: Bugfix über mehrere Subsysteme ohne neue Regel
- **WHEN** ein Bugfix ein dokumentiertes Verhalten wiederherstellt und dafür `src/` und
  `frontend/` ändert, ohne eine Entscheidung (E1) oder Regel (E2) zu brauchen
- **THEN** entsteht keine Change, der Fix läuft über `superpowers:systematic-debugging` bzw.
  `superpowers:test-driven-development`

#### Scenario: Textänderung
- **WHEN** ein Task nur einen Tippfehler oder einen Anzeigetext korrigiert, auch wenn der Text
  in `src/` und in `frontend/` steht
- **THEN** entsteht keine Change

#### Scenario: Bug, dessen Ursache eine Entscheidung verlangt
- **WHEN** ein Task auf `bug-unklar` beim Debuggen zeigt, dass die Behebung eine Wahl zwischen
  zwei vertretbaren Wegen verlangt (E1)
- **THEN** wechselt er auf „Entwurf“, `/opsx:propose` läuft im Main-Loop, der Status bleibt auf
  `in development`, und `/opsx:apply` beginnt erst nach der Freigabe

#### Scenario: Neue Projektregel in einem Subsystem
- **WHEN** ein Task nur `.claude/` und `CLAUDE.md` ändert, dabei aber eine neue Regel festlegt
- **THEN** ist die Route „Entwurf“ (E2) und der Task bekommt eine Change

#### Scenario: Unklare Anforderung
- **WHEN** die Scope-Map für einen Task die Route „unklar“ meldet
- **THEN** läuft für ihn im Main-Loop `/opsx:explore`, und erst die danach gewählte Route
  entscheidet, ob eine Change entsteht

### Requirement: Phase 1 gehört dem Workflow, die Klärung dem Main-Loop
Der Scope eines Tasks mit Subtasks MUST als ein Workflow erhoben werden, der alle Subtasks
parallel liest und eine Scope-Map zurückgibt. Jeder Eintrag der Map MUST die vorgeschlagene
Route und bei „Entwurf“ die zutreffenden Gründe (E1–E3) nennen. `/opsx:explore` MUST NOT in einem
Workflow laufen. Es MUST im Main-Loop für jeden Task laufen, dessen Route „unklar“ ist, weil es
ein Gespräch mit dem Menschen ist. Die Route in der Map ist ein Vorschlag. Der Main-Loop MUST sie
am Checkpoint bestätigen oder korrigieren.

#### Scenario: Klare Subtasks
- **WHEN** die Scope-Map für alle Subtasks eine Route außer „unklar“ meldet und keine offenen
  Fragen enthält
- **THEN** fasst der Main-Loop die Map zusammen und läuft ohne `/opsx:explore` weiter

#### Scenario: Ein Subtask ist unklar
- **WHEN** die Map für einen von drei Subtasks die Route „unklar“ meldet
- **THEN** läuft `/opsx:explore` im Main-Loop nur für diesen Subtask, die beiden anderen behalten
  ihre Route

### Requirement: Phase 2 gehört je Task `/opsx:propose` im Main-Loop
Für jeden Task auf der Route „Entwurf“ MUST der Entwurf über `/opsx:propose` im Main-Loop
entstehen, als Change mit `proposal.md`, Delta-Spec, `design.md` und `tasks.md`. Ein Workflow MUST
NOT für einen solchen Task einen eigenen Umsetzungsplan als Ersatz für `tasks.md` liefern. Ist der
Lösungsraum weit (E1 mit mehr als zwei ernsthaften Wegen), darf vor `/opsx:propose` ein
Judge-Panel-Workflow konkurrierende Entwürfe bewerten. Dessen Ergebnis MUST als Eingabe in
`/opsx:propose` gehen: Der Sieger wird die Entscheidung in `design.md`, die übrigen stehen dort als
verworfene Alternativen. Das Panel MUST NOT selbst Dateien schreiben. Tasks ohne Route „Entwurf“
MUST keinen eigenen Planungsschritt in Phase 2 bekommen.

#### Scenario: Zwei Subtasks brauchen einen Entwurf
- **WHEN** die bestätigte Map zwei Subtasks auf „Entwurf“ und einen auf „klare Spec“ führt
- **THEN** entstehen im Main-Loop zwei Changes über `/opsx:propose`, und für den dritten Subtask
  entsteht weder eine Change noch ein Plan-Workflow

#### Scenario: Weiter Lösungsraum
- **WHEN** ein Task auf „Entwurf“ drei ernsthafte Architekturwege hat
- **THEN** bewertet ein Judge-Panel-Workflow die Wege, und `/opsx:propose` schreibt den
  empfohlenen Weg als Entscheidung und die anderen als Alternativen in `design.md`

### Requirement: Die Scope-Map ist die Eingabe der Change
Für jeden Task auf der Route „Entwurf“ MUST der Main-Loop `/opsx:propose` mit dem Namen
`<custom_id klein>-<slug>` aufrufen (Beispiel `lfh-589-entwurfs-hoheit-orchestrierung`). Er MUST
dabei den Map-Eintrag übergeben: Zusammenfassung, berührte Dateien, Entwurfsgründe und die am
Checkpoint beantworteten Fragen. `/opsx:propose` MUST den Eintrag als Ausgangspunkt nehmen und die
Stellen trotzdem selbst lesen. Grundsatz ist eine Change je Task. Ändern zwei oder mehr Subtasks
**auf der Route „Entwurf“** desselben Parents dieselbe Fähigkeit (gleicher Eintrag unter
`openspec/specs/` oder dieselbe neue Fähigkeit, deren Anforderungen sie ändern oder anlegen), MUST
es eine gemeinsame Change geben. Sie trägt die `custom_id` des Parents, und ihre `tasks.md`
gliedert nach Subtask samt `custom_id`. Ein Subtask auf einer anderen Route MUST ohne Change
bleiben, auch wenn er dieselbe Fähigkeit berührt. Subtasks einer gemeinsamen Change MUST NOT
parallel im autonomen Dev-Modus laufen, weil sie dieselbe `tasks.md` abhaken.

Ruft der Orchestrierungs-Skill `dev-clickup-ausfuehren` für einen Task auf, MUST die bestätigte
Route der Scope-Map gelten. Ein Task mit freigegebener Change MUST direkt in `/opsx:apply`
einsteigen, ohne zweites `/opsx:propose`.

#### Scenario: Einzelner Subtask
- **WHEN** Subtask `LFH-701` „Status-Filter Einheiten“ auf „Entwurf“ steht und keine Fähigkeit
  mit einem anderen Subtask teilt
- **THEN** entsteht die Change `openspec/changes/lfh-701-status-filter-einheiten/`

#### Scenario: Zwei Subtasks, dieselbe Fähigkeit
- **WHEN** die Map für `LFH-701` und `LFH-702` (Parent `LFH-700`), beide auf „Entwurf“, dieselbe
  Fähigkeit `modul-zaehler` nennt
- **THEN** entsteht genau eine Change `lfh-700-<slug>`, deren `tasks.md` Abschnitte für
  `LFH-701` und `LFH-702` hat, und beide Subtasks laufen in Phase 3 nicht parallel autonom

#### Scenario: Gleiche Fähigkeit, nur einer auf „Entwurf“
- **WHEN** `LFH-701` auf „Entwurf“ und `LFH-703` auf „klare Spec“ dieselbe Fähigkeit nennen
- **THEN** bekommt nur `LFH-701` eine Change, und `LFH-703` bleibt ohne Change

#### Scenario: Freigegebene Change im sequenziellen Dev-Modus
- **WHEN** der Orchestrierungs-Skill `dev-clickup-ausfuehren` für einen Task aufruft, dessen
  Change in Phase 2 freigegeben wurde
- **THEN** beginnt die Arbeit mit `/opsx:apply`, ohne erneute Routenschätzung und ohne zweites
  `/opsx:propose`

### Requirement: Kein Workflow überfährt den Freigabe-Checkpoint
Ein Workflow MUST NOT `/opsx:explore`, `/opsx:propose`, `/opsx:update`, `/opsx:apply` oder
`/opsx:archive` aufrufen. Ebenso MUST NOT ein Workflow eine Datei unter `openspec/changes/` anlegen
oder ändern, außer beim Abhaken von Aufgaben einer freigegebenen Change im autonomen Dev-Modus.
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
