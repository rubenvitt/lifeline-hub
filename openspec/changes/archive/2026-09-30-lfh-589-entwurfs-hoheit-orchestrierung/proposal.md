# Proposal

## Why

`dev-clickup-orchestrieren` beantwortet „was berührt der Task?“ (Phase 1, Scope-Fan-out) und
„wie bauen wir ihn?“ (Phase 2, Plan je Subtask oder Judge-Panel) mit eigenen Workflows. Seit
LFH-588 beantworten `/opsx:explore` und `/opsx:propose` dieselben zwei Fragen. Die Texte
widersprechen sich nicht, aber keiner sagt, wem der Entwurf gehört. Der nächste
Orchestrierungs-Lauf muss das im Lauf entscheiden, und dann entscheidet der Zufall: mal
entsteht ein Plan nur im Workflow-Ergebnis, mal eine Change unter `openspec/changes/`, mal
beides nebeneinander.

Dazu kommt: Workflows laufen im Hintergrund und können den Menschen nicht fragen. `/opsx:explore`
ist ein Gespräch, und `/opsx:propose` fragt bei wesentlicher Mehrdeutigkeit zurück und hält
danach für die Freigabe an. Beide gehören deshalb in den Main-Loop. Ohne Regel liegt der
Versuch nahe, sie in einen Workflow zu wickeln, und der Pflicht-Checkpoint aus LFH-588 wird
überfahren.

## What Changes

- **Entscheidung: Schnitt 2 aus dem Ticket, mit dem Kriterium aus Schnitt 3.** Der Workflow
  besitzt die **Menge** (paralleles Lesen über alle Subtasks und Subsysteme, Scope-Map, Bewertung
  konkurrierender Entwürfe). OpenSpec besitzt den **einzelnen Datensatz** (die Change eines
  Tasks mit `proposal.md`, Delta-Spec, `design.md`, `tasks.md`). Schnitt 1 („OpenSpec besitzt
  beides“) ist verworfen, weil er den parallelen Scan aufgibt. Begründung in `design.md`.
- **Kriterium, wann eine Change entsteht**, festgemacht an genau einer Stelle: der Route
  „Entwurf“ im Routing von `dev-clickup-ausfuehren` (heute „Multi-Step / mehrere Files“).
  Eine Change entsteht genau dann, wenn diese Route gewählt wird, und ausdrücklich nicht für
  die Routen „trivial“, „Bug, Ursache unklar“ und „klare Spec“.
- **Phase 1** bleibt der Scope-Fan-out. Neu legt jeder Reader für seinen Task die Route nach
  diesem Kriterium fest. Tasks mit Route „unklar“ gehen im Main-Loop in `/opsx:explore`.
- **Phase 2** gehört je Task `/opsx:propose` im Main-Loop. Das Muster „Plan je Subtask“ als
  Workflow entfällt, weil `tasks.md` diesen Plan trägt. Das Judge-Panel bleibt als reine
  Bewertungshilfe vor `/opsx:propose`, wenn der Lösungsraum weit ist. Es schreibt keine Datei.
- **Schnittstelle Scope-Map → Proposal** benannt: welcher Eintrag der Map in welche
  Change eingeht, wie die Change heißt und wann mehrere Subtasks eine gemeinsame Change bekommen.
- **Pflicht-Checkpoint bleibt**: kein Workflow ruft `/opsx:explore`, `/opsx:propose`,
  `/opsx:apply` oder `/opsx:archive` auf und kein Workflow legt eine Change an. Autonome
  Dev-Agents (Phase 3) arbeiten nur an bereits freigegebenen Changes.
- Die Skelette in `references/workflow-bausteine.md` (Abschnitte 1 und 2) werden angepasst.
  `CLAUDE.md` bekommt im Abschnitt „Planung und Ausführung“ eine Zeile mit der Regel.

## Capabilities

### New Capabilities
- `entwurfs-hoheit`: Wer bei der Orchestrierung eines Board-Tasks Scope und Entwurf besitzt
  (Workflow oder OpenSpec), wann eine OpenSpec-Change entsteht und wie der Freigabe-Checkpoint
  gegen Workflows gesichert ist.

### Modified Capabilities
<!-- keine -->

## Impact

- Geändert: `.claude/skills/dev-clickup-orchestrieren/SKILL.md` (Phasen 1–3, Checkpoints,
  Don'ts), `.claude/skills/dev-clickup-orchestrieren/references/workflow-bausteine.md`
  (Abschnitte 1 und 2), `.claude/skills/dev-clickup-ausfuehren/SKILL.md` (Schritt 3: Route
  „Entwurf“ mit Kriterium), `CLAUDE.md` (eine Zeile).
- Kein Projektcode, keine Tests, keine CI-Schritte. Die bestehende Wache
  `scripts/check-openspec-archiv.sh` bleibt unverändert und gilt für diese Change wie für jede.
- Laufende Arbeit: keine. Unter `openspec/changes/` liegt heute keine aktive Change.
- **Bewusst nicht angefasst:** der Codex-Spiegel unter `.agents/skills/dev-clickup-*`. Er lag
  schon vor diesem Ticket hinter LFH-588 zurück (kein OpenSpec, Basis `main`) und beschreibt
  noch „Plan je Subtask“ und `complexity`. Das Nachziehen ist der Folgetask LFH-853 auf dem
  Entwicklungsboard.
