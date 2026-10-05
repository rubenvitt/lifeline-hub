# Design

## Context

Befund und Motivation: proposal.md, „Why“. Zwei Vorgaben bremsen heute jeden Ticket-Thread,
beide kommen aus der Sitzungsumgebung, nicht aus dem Repo:

- Das Workflow-Tool verlangt ein ausdrückliches Opt-in. Als Opt-in zählt unter anderem ein Skill,
  dessen Anweisungen den Workflow aufrufen, aber nur, wenn der Mensch den Skill aufgerufen hat.
  Die Threads rufen den Skill selbst auf, der Coordinator-Auftrag nennt ihn nicht.
- Das Agent-Tool ist „nur für echte Parallelarbeit“ vorgesehen.

`dev-clickup-orchestrieren` setzt den Workflow für Scope, Judge-Panel und Review voraus;
`dev-clickup-ausfuehren` (das jeder Thread liest) erwähnt weder Agents noch Workflows.

## Goals / Non-Goals

**Goals:**
- Die Freigabe steht als Festlegung des Users mit Datum in der Datei, die jeder Thread liest, und
  trägt damit als Opt-in für Workflows und als Erweiterung von „nur echte Parallelarbeit“.
- Ein Thread weiß, wann ein Agent sich lohnt und was der Worker-Prompt mitbringen muss.

**Non-Goals:**
- Keine Pflicht, Agents zu starten; kein fester Fan-out je Phase.
- Keine Änderung am Coordinator, an Hooks oder an `.claude/settings.json`.
- Die Workflow-Skelette in `references/workflow-bausteine.md` bleiben inhaltlich, wie sie sind.

## Decisions

**D1 — Die Freigabe steht in `dev-clickup-ausfuehren`, `orchestrieren` verweist.** Alle acht
geprüften Threads lasen `ausfuehren`, nur drei `orchestrieren`. Eine Regel steht genau einmal
(Wurzel-`AGENTS.md`). Verworfen: in beiden Skills (Doppelung), in der Wurzel-`AGENTS.md` (betrifft
nur den ClickUp-Ablauf, die Datei soll nur Querschnitt tragen).

**D2 — „Nach Bedarf“ heißt Ermessen mit Beispielen, keine Schwelle.** Lohnt sich: Scope über mehr
als ein Subsystem oder mehrere Subtasks, Review parallel zu laufenden Gates, Ursachensuche über
viel Code, unabhängige Subtasks im autonomen Modus, Gegenlesen eines Entwurfs. Lohnt sich nicht:
was ein Grep beantwortet, Route `trivial`, alles Interaktive. Verworfen: feste Regel „ab N
Dateien“ (lässt sich nicht prüfen und trifft die Fälle schlecht).

**D3 — Agent-Tool für wenige Jobs, Workflow ab mehrstufig oder mehr als drei Agents.** Das
Agent-Tool braucht kein Skript und liefert sofort; der Workflow lohnt bei Pipelines
(finden → verifizieren) und breitem Fan-out. Größenrichtwert der Umgebung (unter zehn Agents je
Workflow) gilt weiter.

**D4 — Pflichtinhalt jedes Worker-Prompts.** Kein `mcp__hearthbot__`-Tool (nur der Main-Loop
spricht mit dem Menschen), kein `/opsx:*`, nichts unter `openspec/changes/` außer im autonomen
Modus, kein Push und kein PR, Blocker strukturiert zurückgeben statt raten, die Regeln des
geteilten Ordners, wenn er ihn nutzt. Grund: Worker sehen den Systemprompt nicht.

**D5 — Spec-Anforderungen erweitern statt umbenennen.** Die Überschriften der zwei geänderten
Anforderungen bleiben, damit Verweise und `/opsx:archive` sie sicher treffen. Neu ist eine
Anforderung „Subagents und Workflows nach Bedarf“.

## Risks / Trade-offs

- [Mehr Token je Thread] → D2 begrenzt auf Fälle mit Zeit- oder Gütegewinn; kein Default-Fan-out.
- [Die Sitzungsumgebung wertet eine Repo-Regel nicht als Opt-in] → Die Freigabe ist als
  Festlegung des Users mit Datum und Ticket formuliert; zusätzlich steht sie im Projekt-Memory,
  damit der Coordinator sie in Aufträge übernehmen kann. Zeigt sich, dass Workflows trotzdem
  blockiert werden, bleibt das Agent-Tool als Weg, und der Punkt geht als Folge-Ticket aufs Board.
- [Worker schreibt in den Thread oder ruft `/opsx:*`] → D4 und der Checkpoint-Schutz der Spec.
