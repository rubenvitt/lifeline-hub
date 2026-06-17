---
name: dev-clickup-orchestrieren
description: Use as the primary entry point whenever the user wants to implement, pick up, "umsetzen", or work through a task from the Lifeline-Hub ClickUp Entwicklungsboard — including epics/parent tasks with subtasks, and any request phrased "mit subagents", "ultracode", "als Workflow", "automode", or "mach alle Subtasks". This skill orchestrates the whole task (and its subtasks) with Workflow-backed fan-out (scope, design, review) and human checkpoints in between. It supersedes and internally invokes dev-clickup-ausfuehren for per-(sub)task execution. NOT for capturing/creating new tasks — that's clickup-task-anlegen.
---

# ClickUp-Task umsetzen — Orchestrierung (Lifeline Hub)

## Überblick

Primärer Einstieg, um einen Task vom **Entwicklungsboard** (`901523554968`) — und **alle
seine Subtasks** — umzusetzen. Dieser Skill ist eine **Orchestrierungs-Schicht**: er treibt
den Ablauf im Main-Loop, nutzt das **Workflow-Tool** für die Fan-out-Phasen
(Scope, Design, Review) und präsentiert **Zwischenstände vor der Dev**. Die eigentliche
Pro-(Sub)Task-Ausführung — Status-Spur, Komplexitäts-Routing, Worktree — delegiert er an
`dev-clickup-ausfuehren`. Diese Logik **nicht** hier reimplementieren; es gibt eine Quelle der
Wahrheit.

## Kernprinzip: Hybrid, nicht ein großer Workflow

Das **Workflow-Tool läuft im Hintergrund und kann den User nicht mitten im Lauf fragen.**
Daraus folgt die ganze Architektur:

- **Der Main-Loop (du) besitzt alles Interaktive**: Checkpoints, Entscheidungen,
  Worktree-Anlage, interaktives TDD, Code-Review-Anfragen. Diese Dinge dürfen **nie** in
  einem Workflow stecken.
- **Workflows besitzen das parallele Schwerlast-Lesen/Bewerten**: viele Subtasks/Subsysteme
  gleichzeitig scannen, konkurrierende Entwürfe bewerten, Review-Dimensionen adversarial
  verifizieren.

„Immer ultracode/Workflow" heißt deshalb: **Workflow für Scope, Design und Review** — nicht,
jede einzelne Subtask-Code-Änderung in einen Workflow zu wickeln (das ist Zeremonie). Die
Ausnahme ist der autonome Dev-Modus (s. Phase 3), der bewusst worktree-isolierte Agents
fan-out.

Lege zu Beginn eine **TodoWrite-Phasenliste** an (Laden → Scope → Design → Dev → Review →
Abschluss), damit der Mehrphasen-Lauf nachvollziehbar bleibt.

## Phasenüberblick

| Phase | Wer | Werkzeug | Checkpoint? |
|---|---|---|---|
| 0 Laden & Statuskontext | Main-Loop | ClickUp-MCP, ggf. Worktree | — |
| 1 Scope/Verstehen | **Workflow** | parallele Reader über Subtasks/Subsysteme | **ja, bei Unklarheit** |
| 2 Design/Plan | **Workflow** | Plan je Subtask / Judge-Panel bei Optionen | **ja, bei Unklarheit/Optionen** |
| 3 Dev (umsetzen) | Main-Loop **oder** Workflow | Moduswahl: sequenziell-interaktiv vs. autonom | nur bei Blocker |
| 4 Review | **Workflow** + Main-Loop | Dimensionen→finden→verifizieren, dann Review-Anfrage | bei Findings |
| 5 Abschluss & Status | Main-Loop | Merge, Board-Status | — |

Konkrete, adaptierbare Workflow-Skripte für Phase 1/2/4 stehen in
`references/workflow-bausteine.md` — von dort kopieren und anpassen, nicht neu erfinden.

## Phase 0 — Laden & Statuskontext

1. **Parent-Task + Subtasks laden** (`mcp__claude_ai_ClickUp__clickup_get_task`). Subtasks
   über die `subtasks` der Antwort bzw. `clickup_filter_tasks` ermitteln. Pro (Sub)Task
   ziehen: `custom_id`, Name/Beschreibung, **aktueller Status**, Abhängigkeiten.
2. **Statuskontext bilden:** Wo steht jeder (Sub)Task auf der Spur? (Spur und Regeln:
   `dev-clickup-ausfuehren`.) Das bestimmt, wo der Lauf einsteigt — schon `in development`
   stehende Subtasks nicht zurücksetzen.
3. **Workspace/Branch:** für den Parent einen Branch/Worktree wählen. Delegiere die
   Anlage an `dev-clickup-ausfuehren` (das wiederum `superpowers:using-git-worktrees` nutzt) —
   diese Phase ist interaktiv und fragt vor der Anlage.

Task mehrdeutig oder keine Subtasks auffindbar → kurz beim User rückfragen, nicht raten.

## Phase 1 — Scope/Verstehen (Workflow)

Starte einen **Workflow**, der pro Subtask (und pro berührtem Subsystem) einen Reader-Agent
fan-out: was berührt der Subtask, welche Files, welche Abhängigkeiten zu anderen Subtasks,
welche offenen Fragen, geschätzte Komplexität. Ergebnis: eine **strukturierte Map**
(Skelett in `references/workflow-bausteine.md` → „Scope-Fan-out").

**Checkpoint — nur bei Unklarheit.** Liefert die Map offene Fragen, widersprüchliche
Annahmen oder mehrere sinnvolle Schnitte → präsentiere die Map kompakt und **frag den
User**, gern mit konkreten Optionen (s. „Checkpoints & Entscheidungen"). Ist alles klar →
ohne Stopp weiter, aber die Map in 2–3 Zeilen zusammenfassen.

**Status:** raus aus `backlog`. Bei unklarer Anforderung `scoping`; sonst die Routing-Regeln
aus `dev-clickup-ausfuehren` greifen lassen.

## Phase 2 — Design/Plan (Workflow)

Starte einen **Workflow** für den Plan. Zwei Muster, je nach Lage:

- **Plan je Subtask** (Standard): pro Subtask ein Agent, der einen knappen Umsetzungsplan +
  Test-Strategie schreibt (pipeline über die Subtasks).
- **Judge-Panel** (wenn der Lösungsraum weit/mehrdeutig ist): mehrere konkurrierende
  Entwürfe für denselben Task generieren, parallel bewerten, den besten synthetisieren.
  Skelett: `references/workflow-bausteine.md` → „Design-Judge-Panel".

**Checkpoint — bei Unklarheit oder echten Optionen.** Gibt es mehr als einen vertretbaren
Weg (Architektur, Schnitt, Reihenfolge, Build-vs-Buy) → präsentiere die Optionen mit
Trade-offs und **lass den User entscheiden**. Sonst kurzer Plan-Abriss und weiter.

**Status:** Multi-Step → `in design` → nach Plan-Freigabe `ready for development`.

## Phase 3 — Dev / umsetzen (Moduswahl)

**Wähle den Modus selbst** und nenne dem User die Wahl + Begründung (er darf overriden):

- **Sequenziell-interaktiv (Default, sicher):** Subtasks nacheinander. Pro Subtask rufst du
  **`dev-clickup-ausfuehren`** auf — das routet in die interaktiven superpowers-Skills
  (TDD/Debugging/…) im Main-Loop und führt den Board-Status pro Subtask mit. Wähle das,
  wenn Subtasks **gemeinsame Files** berühren, voneinander abhängen, oder während der
  Umsetzung interaktive Entscheidungen zu erwarten sind.
- **Autonom / „automode":** nur wenn die Subtasks **nachweislich unabhängig** sind
  (disjunkte File-Mengen, keine Reihenfolge-Abhängigkeit) **und** die Spec eindeutig ist.
  Dann fan-out per **Workflow mit `isolation: 'worktree'`**: jeder Agent implementiert+testet
  einen Subtask autonom. Schnell, aber ohne interaktives TDD/Review und mit Konfliktrisiko
  bei geteilten Files — deshalb die harte Unabhängigkeits-Bedingung.

**„Bei Fragen melde dich":** Autonome Agents können mitten im Lauf **nicht** fragen. Instruiere
sie, bei einem harten Blocker abzubrechen und den Blocker strukturiert zurückzugeben; du
sammelst diese ein und legst sie dem User vor, statt zu raten.

Im Zweifel sequenziell. Bei gemischter Lage: unabhängige Subtasks autonom bündeln, abhängige
sequenziell — aber das nur, wenn der Schnitt sauber ist.

## Phase 4 — Review (Workflow + Main-Loop)

1. **Workflow:** Review über Dimensionen (Bugs, Sicherheit, Konventionen, Tests) →
   Findings finden → **adversarial verifizieren** (Skelett: „Review-find-verify"). Nur
   bestätigte Findings übernehmen.
2. Bestätigte Findings abarbeiten (zurück in Phase 3, sequenziell).
3. **Interaktiv:** `superpowers:requesting-code-review` vor dem Mergen.
   `superpowers:verification-before-completion` vor jeder „fertig"-Aussage.

**Status:** `in review`; läuft danach noch eine Abnahme/Testrunde → `testing`.

## Phase 5 — Abschluss & Status

- Integration → `superpowers:finishing-a-development-branch`. Worktree/Branch dem Harness
  überlassen (nicht manuell removen).
- Pro (Sub)Task Board-Status vorwärts: nach Merge `shipped`; ist nichts mehr offen → `done`.
  Parent erst auf `shipped`/`done`, wenn alle Subtasks es sind.
- Commits/PR auf die jeweilige `custom_id` referenzieren.

## Status durchgehen — Entscheidungspunkte

Der Board-Status wird grundsätzlich **automatisch und nur vorwärts** geführt (Spur + Regeln:
`dev-clickup-ausfuehren`). Den User **nur an echten Verzweigungen** entscheiden lassen — nicht bei
jedem Übergang:

| Verzweigung | Wann fragen | Optionen |
|---|---|---|
| Routing nach Scope | Komplexität/Anforderung unklar | `scoping` · `in design` · direkt `in development` |
| Nach der Dev | unklar, ob noch eine Abnahme/Testrunde nötig ist | `in review → testing` · direkt `shipped` |
| Verwerfen | Task soll fallen gelassen werden | `cancelled` |

Alles andere: ohne Rückfrage setzen, niemals rückwärts oder redundant.

## Checkpoints & Entscheidungen

- **Sparsam, aber echt.** Checkpoint nur, wenn die Phase eine Unklarheit, einen Konflikt
  oder mehrere vertretbare Optionen aufwirft („da wo es Sinn macht"). Sonst kurz
  zusammenfassen und weiterlaufen.
- **Optionen anbieten, nicht offene Fragen stellen.** Wenn du fragst, leg konkrete Optionen
  mit Trade-offs vor und gib eine Empfehlung. Nutze dafür den interaktiven Frage-Mechanismus.
- **Zwischenstand = Artefakt zeigen.** Präsentiere das, was die Phase produziert hat
  (Scope-Map, Plan, Findings), kompakt — nicht nur „bin fertig mit Phase X".

## Don'ts

- Status-Spur, Routing, Task-Laden, Worktree-Logik **nicht** hier kopieren → an
  `dev-clickup-ausfuehren` delegieren.
- **Kein** Interaktives (Checkpoint, Worktree-Frage, TDD, Review) in einen Workflow stecken —
  Workflows können nicht fragen.
- Einzelne Subtask-Code-Änderungen **nicht** zwanghaft in Workflows wickeln (Zeremonie) —
  Workflow für Scope/Design/Review und für echten autonomen Fan-out.
- Autonomen Modus **nicht** bei geteilten Files / Abhängigkeiten wählen.
- Bei jedem Status-Übergang fragen — nur an den drei Verzweigungen oben.
- Keinen neuen Task anlegen — das ist `clickup-task-anlegen`.
