# Spec Delta

## MODIFIED Requirements

### Requirement: Eine Change entsteht genau auf der Route „Entwurf“
Das Routing von `dev-zunder-ausfuehren` kennt fünf Routen mit festen Schlüsseln: `trivial`
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
- **THEN** wechselt er auf „Entwurf“, `/opsx:propose` läuft im Main-Loop, der Task steht bis zur
  Freigabe auf `blocked`, und `/opsx:apply` beginnt erst nach der Freigabe

#### Scenario: Neue Projektregel in einem Subsystem
- **WHEN** ein Task nur `.claude/` und `CLAUDE.md` ändert, dabei aber eine neue Regel festlegt
- **THEN** ist die Route „Entwurf“ (E2) und der Task bekommt eine Change

#### Scenario: Unklare Anforderung
- **WHEN** die Scope-Map für einen Task die Route „unklar“ meldet
- **THEN** läuft für ihn im Main-Loop `/opsx:explore`, und erst die danach gewählte Route
  entscheidet, ob eine Change entsteht

### Requirement: Die Scope-Map ist die Eingabe der Change
Für jeden Task auf der Route „Entwurf“ MUST der Main-Loop `/opsx:propose` mit dem Namen
`<kurz>-<slug>` aufrufen, `<kurz>` sind die ersten 8 Hex-Zeichen der Zunder-UUID des Tasks
(Beispiel `60638201-status-filter-einheiten`). Er MUST
dabei den Map-Eintrag übergeben: Zusammenfassung, berührte Dateien, Entwurfsgründe und die am
Checkpoint beantworteten Fragen. `/opsx:propose` MUST den Eintrag als Ausgangspunkt nehmen und die
Stellen trotzdem selbst lesen. Grundsatz ist eine Change je Task. Ändern zwei oder mehr Subtasks
**auf der Route „Entwurf“** desselben Parents dieselbe Fähigkeit (gleicher Eintrag unter
`openspec/specs/` oder dieselbe neue Fähigkeit, deren Anforderungen sie ändern oder anlegen), MUST
es eine gemeinsame Change geben. Sie trägt den `<kurz>` des Parents, und ihre `tasks.md`
gliedert nach Subtask samt `<kurz>`. Ein Subtask auf einer anderen Route MUST ohne Change
bleiben, auch wenn er dieselbe Fähigkeit berührt. Subtasks einer gemeinsamen Change MUST NOT
parallel im autonomen Dev-Modus laufen, weil sie dieselbe `tasks.md` abhaken.

Ruft der Orchestrierungs-Skill `dev-zunder-ausfuehren` für einen Task auf, MUST die bestätigte
Route der Scope-Map gelten. Ein Task mit freigegebener Change MUST direkt in `/opsx:apply`
einsteigen, ohne zweites `/opsx:propose`.

#### Scenario: Einzelner Subtask
- **WHEN** Subtask `60638201` „Status-Filter Einheiten“ auf „Entwurf“ steht und keine Fähigkeit
  mit einem anderen Subtask teilt
- **THEN** entsteht die Change `openspec/changes/60638201-status-filter-einheiten/`

#### Scenario: Zwei Subtasks, dieselbe Fähigkeit
- **WHEN** die Map für `60638201` und `7fe1f0cf` (Parent `6f0058a8`), beide auf „Entwurf“, dieselbe
  Fähigkeit `modul-zaehler` nennt
- **THEN** entsteht genau eine Change `6f0058a8-<slug>`, deren `tasks.md` Abschnitte für
  `60638201` und `7fe1f0cf` hat, und beide Subtasks laufen in Phase 3 nicht parallel autonom

#### Scenario: Gleiche Fähigkeit, nur einer auf „Entwurf“
- **WHEN** `60638201` auf „Entwurf“ und `23c3f2b7` auf „klare Spec“ dieselbe Fähigkeit nennen
- **THEN** bekommt nur `60638201` eine Change, und `23c3f2b7` bleibt ohne Change

#### Scenario: Freigegebene Change im sequenziellen Dev-Modus
- **WHEN** der Orchestrierungs-Skill `dev-zunder-ausfuehren` für einen Task aufruft, dessen
  Change in Phase 2 freigegeben wurde
- **THEN** beginnt die Arbeit mit `/opsx:apply`, ohne erneute Routenschätzung und ohne zweites
  `/opsx:propose`

### Requirement: Kein Workflow überfährt den Freigabe-Checkpoint
Ein Workflow oder Subagent MUST NOT `/opsx:explore`, `/opsx:propose`, `/opsx:update`,
`/opsx:apply` oder `/opsx:archive` aufrufen. Ebenso MUST NOT ein Workflow oder Subagent eine Datei
unter `openspec/changes/` anlegen oder ändern, außer beim Abhaken von Aufgaben einer freigegebenen
Change im autonomen Dev-Modus.
Nach `/opsx:propose` MUST der Main-Loop anhalten und die Changes des Laufs gesammelt vorlegen.
Bis zur Freigabe MUST der Task auf `blocked` stehen; erst mit der Freigabe des Menschen MUST er
auf `in_progress` und in `/opsx:apply` gehen. Autonome Dev-Agents MUST nur an Changes arbeiten,
die bereits freigegeben sind. Zeigt die
Umsetzung, dass Proposal, Spec oder Design nicht tragen, MUST der Agent abbrechen und das als
Blocker zurückgeben, statt die Artefakte selbst zu ändern.

#### Scenario: Mehrere Proposals in einem Lauf
- **WHEN** der Main-Loop in Phase 2 zwei Changes über `/opsx:propose` erzeugt hat
- **THEN** legt er beide gemeinsam vor, beide Tasks stehen auf `blocked`, und `/opsx:apply`
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

### Requirement: Subagents und Workflows nach Bedarf
Bei der Umsetzung eines Tasks vom Entwicklungsboard MUST der Main-Loop Subagents und Workflows
nach eigenem Ermessen starten dürfen, ohne Opt-in des Menschen im Auftrag. Er MUST sie starten,
wo sie Zeit sparen oder die Güte heben, und MUST NOT sie für Arbeit starten, die ein einzelner
Lese- oder Suchschritt erledigt. Gesprächsschritte, Checkpoints und Nachrichten an den Menschen
MUST im Main-Loop bleiben.

#### Scenario: Auftrag ohne Opt-in
- **WHEN** ein Ticket-Thread mit dem Auftrag „Bearbeite die Zunder-Aufgabe
  `https://zunder.rubeen.dev/#/aufgabe/<uuid>`“ startet und
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
