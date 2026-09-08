---
name: dev-clickup-orchestrieren
description: Orchestrate Lifeline-Hub ClickUp development tasks through scope, implementation, review, and published pull requests, especially parent tasks with subtasks or requested subagents. Invoke dev-clickup-ausfuehren per concrete task and keep board status moving forward. Not for capturing new work; use clickup-task-anlegen.
---

# ClickUp-Task orchestrieren (Lifeline Hub)

## Zweck

Dies ist der primäre Einstieg für die Umsetzung eines Tasks vom Entwicklungsboard
(`901523554968`, Workspace `9015920204`), einschließlich seiner Subtasks. Der Main-Agent
besitzt Entscheidungen, User-Checkpoints, Workspace und Integration. Codex-Subagenten
übernehmen klar begrenzte Lese-, Entwurfs- und Review-Aufträge. Die Ausführung eines einzelnen
(Sub-)Tasks folgt `dev-clickup-ausfuehren`; Statusspur und Branchregeln werden nicht dupliziert.

**Die Orchestrierung endet mit veröffentlichten PRs für den beauftragten Umfang.** Commit,
Push und PR-Erstellung sind Teil der Umsetzung und werden ohne zusätzliche Nachfrage vom
Main-Agent ausgeführt. Nur eine ausdrückliche Einschränkung des Users ändert dieses Ziel;
ein Merge braucht weiterhin einen gesonderten Auftrag.

Lies für konkrete Prompts und Koordination
`references/codex-agent-bausteine.md`, sobald eine Fan-out-Phase beginnt.

## Leitplanken für Codex-Agenten

- Subagenten arbeiten parallel nur an voneinander unabhängigen, konkret begrenzten Aufgaben.
- Alle Agenten teilen standardmäßig denselben Checkout. Parallele Implementierungs-Edits sind
  deshalb verboten, solange nicht ausdrücklich getrennte Worktrees eingerichtet wurden.
- Lese-, Scope-, Design- und Review-Agenten dürfen parallel laufen, weil sie keine Dateien
  verändern.
- Der Main-Agent liest und synthetisiert die Ergebnisse; er reicht Agentenantworten nicht
  ungeprüft durch.
- Wenn keine Agentenslots verfügbar sind, führe dieselbe Phase nacheinander aus. Erfinde kein
  nicht vorhandenes `Workflow`-Tool.
- Interaktive Fragen bleiben im Main-Agent. Ein Subagent meldet Blocker strukturiert zurück.

## Phasenplan

Lege zu Beginn mit dem Codex-Planwerkzeug diese Phasen an und halte sie aktuell:

`Laden → Scope → Design → Entwicklung → Review → PR und Abschluss`

Es darf höchstens eine Phase `in_progress` sein. Ein Plan ist Fortschrittsanzeige, kein Ersatz
für Boardstatus oder Prüfbelege.

## Phase 0: Laden und Statuskontext

1. Lade den Parent-Task über `mcp__codex_apps__clickup_clickup_get_task` mit
   `workspace_id: 9015920204`, `detail_level: detailed` und `subtasks: true`.
2. Ermittle pro Parent/Subtask: `custom_id`, Name, Beschreibung, Akzeptanzkriterien,
   aktuellen Status, Abhängigkeiten und eventuell bereits abgeschlossene Arbeit.
3. Ordne alle Stati in die Vorwärtsspur aus `dev-clickup-ausfuehren` ein. Setze nichts zurück.
4. Prüfe Branch und Worktree nach `dev-clickup-ausfuehren`. Die Frage nach einer neuen
   Arbeitsumgebung bleibt im Main-Agent.

Wenn die Task-ID oder Subtask-Zuordnung mehrdeutig bleibt, frage kurz nach und rate nicht.

## Phase 1: Scope und Verstehen

Fan-out je Subtask oder berührtem Subsystem mit read-only Subagenten. Jeder Auftrag liefert:

- betroffene Dateien und bestehende Muster;
- Abhängigkeiten zu anderen Subtasks;
- Komplexität und Risiken;
- offene Fragen;
- eine knappe Scope-Zusammenfassung.

Fasse danach Überschneidungen und Reihenfolgeabhängigkeiten zusammen. Gibt es echte
Unklarheiten oder widersprüchliche Anforderungen, zeige die Scope-Map und frage mit konkreten
Optionen plus Empfehlung. Ist alles eindeutig, gib nur einen kurzen Zwischenstand und fahre
fort.

Status: Bei unklarer Anforderung `scoping`; ansonsten übernimmt
`dev-clickup-ausfuehren` das Routing.

## Phase 2: Design und Plan

Für klare, unabhängige Subtasks entwirft je ein read-only Agent einen knappen Plan samt
Teststrategie. Bei einem weiten Lösungsraum können zwei oder drei Agenten konkurrierende
Entwürfe aus unterschiedlichen Blickwinkeln erstellen; ein weiterer Review-Pass bewertet sie
gegen Codebestand, Risiken und Akzeptanzkriterien.

Ein User-Checkpoint ist nur nötig, wenn mehrere vertretbare Wege mit materiell anderem Ergebnis
bestehen. Präsentiere dann Optionen, Trade-offs und eine Empfehlung. Multi-Step-Arbeit geht auf
`in design` und erst nach belastbarem Plan auf `ready for development`.

## Phase 3: Entwicklung

Wähle den Modus anhand der Scope-Map und nenne ihn kurz:

- **Sequenziell im Main-Agent (Standard):** bei gemeinsamen Dateien, Abhängigkeiten,
  interaktiven Entscheidungen oder nur einem Checkout. Führe jeden (Sub-)Task nach
  `dev-clickup-ausfuehren` aus.
- **Parallel in getrennten Worktrees:** nur wenn der User Mehragentenarbeit wünscht, die
  Subtasks nachweislich unabhängig sind und jeder schreibende Agent einen eigenen, zuvor
  bestätigten Worktree besitzt. Weise jedem Agenten exakte Dateien, Tests und Outputgrenzen zu.
- **Gemischt:** unabhängige Lese-/Vorarbeiten parallel, Änderungen mit Dateikollisionen
  sequenziell.

Autonome Agenten dürfen bei Unklarheit nicht raten. Sie stoppen ihre Teilaufgabe und liefern
`Blocker`, `benötigte Entscheidung` und `sichere nächste Schritte`. Der Main-Agent bündelt das
für den User.

## Phase 4: Review

Lass die Änderung read-only entlang sinnvoller Dimensionen prüfen: Logik/Boundary Cases,
Sicherheit und Org-Isolation, Projektkonventionen sowie Tests. Ein Finding zählt erst, wenn ein
zweiter Prüfschritt es am konkreten Diff und Codepfad bestätigt; bei Unsicherheit wird es nicht
als Fehler ausgegeben.

Bestätigte Findings gehen zurück in die Entwicklungsphase. Danach führt der Main-Agent die
frischen Verifikationsbefehle aus und entscheidet anhand realer Ergebnisse über `in review`
und gegebenenfalls `testing`.

## Phase 5: PR und Abschluss

- Führe jeden beauftragten Teil nach dem PR-Abschluss aus `dev-clickup-ausfuehren` bis zu
  einem veröffentlichten PR. Zusammengehörige Änderungen dürfen einen gemeinsamen PR
  tragen; unabhängige Arbeitsbranches bekommen eigene PRs. Vorhandene PRs werden aktualisiert.
- Der Main-Agent committet, pusht und erstellt die PRs. Ein Agenten-Handoff, lokale Änderungen
  oder grüne Tests allein beenden die Orchestrierung nicht. Offene Befunde/Prüfungen gehören
  mit konkreten Blockern in einen Draft-PR; technische Veröffentlichungsblocker werden klar
  als unvollständiger Abschluss gemeldet.
- Prüfe PR-Link, Head-Commit und verfügbaren Check-Status. Hinterlege die zugehörigen Links,
  Gate-Ergebnisse und Review-Stände in den ClickUp-Tasks und gegebenenfalls im Parent.
- Merge nur bei gesondertem Auftrag des Users.
- Setze einzelne Subtasks erst nach erfolgreicher Integration auf `shipped` und anschließend
  auf `done`, wenn wirklich nichts offen ist.
- Setze den Parent erst auf `shipped`/`done`, wenn alle erforderlichen Subtasks diesen Stand
  erreicht haben.
- Referenziere die jeweilige `custom_id` in Commits und PRs.
- Berichte PR-Links, geänderte Dateien, ausgeführte Prüfungen, verbleibende Risiken und
  Boardstatus.

## Checkpoints

Frage nur an echten Verzweigungen:

| Entscheidung | Wann |
|---|---|
| Scope/Routing | Anforderungen bleiben nach Repository- und Task-Lektüre unklar |
| Design | mehrere Lösungen ändern Architektur, Verhalten oder Aufwand materiell |
| Workspace | neuer Branch/Worktree wäre nötig |
| Abnahme | unklar, ob nach Review noch eine getrennte Testrunde gefordert ist |
| Verwerfen | der Task soll tatsächlich `cancelled` werden |

Zeige am Checkpoint immer das produzierte Artefakt (Scope-Map, Plan oder bestätigte Findings),
nicht nur einen Phasenstatus.

## Grenzen

- Statusspur und Einzel-Task-Logik bleiben in `dev-clickup-ausfuehren`.
- Keine schreibenden Parallelagenten im selben Checkout.
- Kein Agenten-Fan-out für triviale Arbeit ohne unabhängige Teilaufgaben.
- Kein neuer Task: dafür `clickup-task-anlegen`.
- Kein Abschluss ohne veröffentlichte PRs für den beauftragten Umfang, außer bei einer
  ausdrücklichen Einschränkung des Users oder einem benannten Veröffentlichungsblocker.
- Kein `shipped`/`done` ohne erfolgreiche Integration und aktuelle Prüfbelege.
