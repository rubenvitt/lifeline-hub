# Proposal

## Why

Ruben hat am 04.10.2026 festgelegt: „Agenten dürfen nach Bedarf selbst erstellt werden.“ Die
Ticket-Threads folgen dem Ablauf von `dev-clickup-ausfuehren` und `dev-clickup-orchestrieren`
(acht von acht geprüften Threads, LFH-855 bis LFH-886), starten aber praktisch nie Subagents
oder Workflows: Das Workflow-Tool lief in keinem Thread, auch nicht in den drei
Orchestrierungs-Läufen, deren Skill den Scope-Scan als Workflow vorschreibt. Eine Scope-Map
entstand nirgends. Nur LFH-867 startete einen Agent (Review parallel zu Vitest). Die
Sitzungsvorgabe erlaubt Workflows nur mit ausdrücklichem Opt-in und das Agent-Tool nur „für echte
Parallelarbeit“, und die Skills geben keine stehende Freigabe, die dagegen trägt.

## What Changes

- `dev-clickup-ausfuehren` bekommt einen Abschnitt „Agenten nach Bedarf“: die stehende Freigabe
  des Users, Subagents (Agent-Tool) und Workflows nach eigenem Ermessen zu starten, ohne
  „ultracode“ oder sonstiges Opt-in. Dazu, wann es sich lohnt, wann nicht, Agent oder Workflow,
  und was jeder Worker-Prompt mitbekommt. Eine Quelle der Wahrheit; der Abschnitt steht dort,
  weil jeder Ticket-Thread diese Datei liest.
- `dev-clickup-orchestrieren` verweist auf diesen Abschnitt. Die Fan-out-Phasen (Scope, Judge-Panel,
  Review) dürfen als Workflow **oder** als parallel gestartete Subagents laufen.
- Spec `entwurfs-hoheit`: Der Scope-Fan-out ist nicht mehr an das Workflow-Tool gebunden, und
  die Grenzen für Workflows (kein `/opsx:*`, nichts unter `openspec/changes/`) gelten genauso für
  Subagents. Neue Anforderung: Subagents und Workflows nach Bedarf, ohne Opt-in.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `entwurfs-hoheit`: Scope-Fan-out als Workflow oder Subagents; Checkpoint-Schutz gilt für beide;
  neue Anforderung zur stehenden Freigabe für Subagents und Workflows.

## Impact

- `.claude/skills/dev-clickup-ausfuehren/SKILL.md`, `.claude/skills/dev-clickup-orchestrieren/SKILL.md`,
  `.claude/skills/dev-clickup-orchestrieren/references/workflow-bausteine.md`
- `openspec/specs/entwurfs-hoheit/spec.md` (über `/opsx:archive`)
- Kein Projektcode, kein Gate-Schritt. Mehr Token je Thread, wo Agents tatsächlich laufen.
