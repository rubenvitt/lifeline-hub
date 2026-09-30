---
name: dev-clickup-orchestrieren
description: Use as the primary entry point whenever the user wants to implement, pick up, "umsetzen", or work through a task from the Lifeline-Hub ClickUp Entwicklungsboard — including epics/parent tasks with subtasks, and any request phrased "mit subagents", "ultracode", "als Workflow", "automode", or "mach alle Subtasks". This skill orchestrates the whole task (and its subtasks) with Workflow-backed fan-out (scope scan, design-option judging, review), OpenSpec changes per task in the main loop, and human checkpoints in between. It supersedes and internally invokes dev-clickup-ausfuehren for per-(sub)task execution. NOT for capturing/creating new tasks — that's clickup-task-anlegen.
---

# ClickUp-Task umsetzen — Orchestrierung (Lifeline Hub)

## Überblick

Primärer Einstieg, um einen Task vom **Entwicklungsboard** (`901523554968`) — und **alle
seine Subtasks** — umzusetzen. Dieser Skill ist eine **Orchestrierungs-Schicht**: er treibt
den Ablauf im Main-Loop, nutzt das **Workflow-Tool** für die Fan-out-Phasen (Scope,
Bewertung von Entwurfsoptionen, Review) und präsentiert **Zwischenstände vor der Dev**. Die
eigentliche Pro-(Sub)Task-Ausführung — Status-Spur, Komplexitäts-Routing, Worktree — delegiert er an
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

„Immer ultracode/Workflow" heißt deshalb: **Workflow für Scope, Entwurfsbewertung und Review**
(den Entwurf selbst schreibt `/opsx:propose` im Main-Loop, s. „Entwurfs-Hoheit“) — nicht,
jede einzelne Subtask-Code-Änderung in einen Workflow zu wickeln (das ist Zeremonie). Die
Ausnahme ist der autonome Dev-Modus (s. Phase 3), der bewusst worktree-isolierte Agents
fan-out.

Lege zu Beginn eine **TodoWrite-Phasenliste** an (Laden → Scope → Design → Dev → Review →
Abschluss), damit der Mehrphasen-Lauf nachvollziehbar bleibt.

## Phasenüberblick

| Phase | Wer | Werkzeug | Checkpoint? |
|---|---|---|---|
| 0 Laden & Statuskontext | Main-Loop | ClickUp-MCP, ggf. Worktree | — |
| 1 Scope/Verstehen | **Workflow** (Scan) + Main-Loop (`/opsx:explore` bei `unklar`) | parallele Reader über Subtasks/Subsysteme → Scope-Map mit `route` | **ja, bei Unklarheit; Route bestätigen** |
| 2 Entwurf | **Main-Loop** (`/opsx:propose` je Task auf `entwurf`), optional Judge-Panel-**Workflow** als Zulieferer | eine Change je Task (bzw. je geteilter Fähigkeit) | **ja, Pflicht: Freigabe der Changes** |
| 3 Dev (umsetzen) | Main-Loop **oder** Workflow | Moduswahl: sequenziell-interaktiv vs. autonom | nur bei Blocker |
| 4 Review | **Workflow** + Main-Loop | Dimensionen→finden→verifizieren, dann Review-Anfrage | bei Findings |
| 5 Abschluss & Status | Main-Loop | Merge, Board-Status | — |

Konkrete, adaptierbare Workflow-Skripte für Phase 1/2/4 stehen in
`references/workflow-bausteine.md` — von dort kopieren und anpassen, nicht neu erfinden.

## Entwurfs-Hoheit: der Workflow besitzt die Menge, OpenSpec den Datensatz (LFH-589)

Scope und Entwurf beantworten der Workflow und OpenSpec, aber **nie beide dieselbe Frage**
(Spec `entwurfs-hoheit`, Herleitung in der archivierten Change
`lfh-589-entwurfs-hoheit-orchestrierung`, `design.md`):

- **Workflow = die Menge.** Er liest und bewertet parallel über viele Subtasks: den Scope-Scan
  (Phase 1) und das Judge-Panel (Phase 2, nur Zulieferer). Er schreibt keine Datei unter
  `openspec/changes/` und ruft kein `/opsx:*`.
- **OpenSpec = der einzelne Datensatz.** Er entwirft einen Task als Change
  (`/opsx:propose`), klärt eine unklare Anforderung (`/opsx:explore`) und setzt nach Freigabe um
  (`/opsx:apply`). Alle drei laufen **im Main-Loop**, weil sie den Menschen brauchen.
- **Ob ein Task eine Change bekommt**, entscheidet allein seine Route: Change genau bei
  `entwurf` (Gründe E1–E3 in `dev-clickup-ausfuehren`, Schritt 3), ausdrücklich keine bei
  `trivial`, `bug-unklar` und `klar`.

## Phase 0 — Laden & Statuskontext

1. **Parent-Task + Subtasks laden** (`mcp__claude_ai_ClickUp__clickup_get_task`). Subtasks
   über die `subtasks` der Antwort bzw. `clickup_filter_tasks` ermitteln. Pro (Sub)Task
   ziehen: `custom_id`, Name/Beschreibung, **aktueller Status**, Abhängigkeiten.
2. **Statuskontext bilden:** Wo steht jeder (Sub)Task auf der Spur? (Spur und Regeln:
   `dev-clickup-ausfuehren`.) Das bestimmt, wo der Lauf einsteigt — schon `in development`
   stehende Subtasks nicht zurücksetzen.
3. **Workspace/Branch:** für den Parent einen Branch/Worktree wählen. Delegiere die
   Anlage an `dev-clickup-ausfuehren` (das wiederum `superpowers:using-git-worktrees` nutzt) —
   die Wahl läuft dort **automatisch** und wird nur gemeldet, nicht erfragt.

Task mehrdeutig oder keine Subtasks auffindbar → kurz beim User rückfragen, nicht raten.

## Phase 1 — Scope/Verstehen (Workflow + Main-Loop)

**Mechanismus: der Scope-Workflow.** Er lässt pro Subtask (und pro berührtem Subsystem) einen
Reader-Agent parallel laufen: was berührt der Subtask, welche Files, welche Abhängigkeiten zu
anderen Subtasks, welche offenen Fragen, welche Fähigkeiten unter `openspec/specs/`. Jeder
Reader **schlägt eine Route vor** (`trivial` · `klar` · `bug-unklar` · `unklar` · `entwurf`,
bei `entwurf` mit den zutreffenden Gründen E1–E3). Ergebnis ist eine **strukturierte Map**
(Skelett in `references/workflow-bausteine.md` → „Scope-Fan-out“). `/opsx:explore` läuft hier
**nicht** im Workflow, denn es ist ein Gespräch.

**Erkennungsmerkmal: das Feld `route` je Map-Eintrag.**

- `route: unklar` → für **diesen** Task im Main-Loop `/opsx:explore`, danach neu routen. Die
  anderen Tasks behalten ihre Route.
- Jede andere Route → kein `/opsx:explore`.

**Checkpoint.** Die Route ist ein Vorschlag des Readers, also bestätigst oder korrigierst du
sie hier. E3 prüfst du an den Pfaden der Map nach. Gibt es offene Fragen, widersprüchliche
Annahmen, mehrere sinnvolle Schnitte oder eine strittige Route → Map kompakt präsentieren und
**den User fragen**, gern mit konkreten Optionen (s. „Checkpoints & Entscheidungen“). Ist alles
klar → ohne Stopp weiter, aber die Map samt Routen in 2–3 Zeilen zusammenfassen.

**Status:** raus aus `backlog`. Bei `unklar` `scoping`; sonst die Routing-Regeln aus
`dev-clickup-ausfuehren` greifen lassen.

## Phase 2 — Entwurf (Main-Loop mit `/opsx:propose`)

**Mechanismus: `/opsx:propose` im Main-Loop, je Task mit `route: entwurf`.** Tasks auf
`trivial`, `klar` oder `bug-unklar` bekommen in Phase 2 **keinen** Planungsschritt und keine
Change. Sie gehen direkt in Phase 3 (TDD bzw. Debugging über `dev-clickup-ausfuehren`). Einen
Plan-Workflow „je Subtask“ gibt es nicht mehr, denn die `tasks.md` der Change ist der Plan.

**Erkennungsmerkmal:** Phase 2 läuft genau für die Map-Einträge mit bestätigter Route
`entwurf`. Gibt es keinen, entfällt Phase 2.

**Schnittstelle Scope-Map → Proposal:**

- **Name:** `<custom_id klein>-<slug>`, z. B. `lfh-701-status-filter-einheiten`.
- **Eingabe:** Der Map-Eintrag geht als Argument an `/opsx:propose`: Zusammenfassung, Files,
  Entwurfsgründe und die am Phase-1-Checkpoint beantworteten Fragen. `/opsx:propose` nimmt ihn
  als Ausgangspunkt und liest die Stellen trotzdem selbst.
- **Eine Change je Task.** Nennen zwei oder mehr Subtasks desselben Parents dieselbe
  Fähigkeit (`faehigkeiten` der Map: gleicher Pfad unter `openspec/specs/` oder dieselbe neue
  Fähigkeit), gibt es **eine** gemeinsame Change mit der `custom_id` des Parents. Ihre
  `tasks.md` gliedert nach Subtask samt `custom_id`.

**Judge-Panel nur als Zulieferer.** Ist der Lösungsraum weit (E1 mit mehr als zwei ernsthaften
Wegen), bewertet vorher ein Workflow konkurrierende Entwürfe (Skelett:
`references/workflow-bausteine.md` → „Design-Judge-Panel“). Das Panel liest nur. Den Sieger
übergibst du `/opsx:propose` als Entscheidung, die übrigen als verworfene Alternativen, und
beides landet in `design.md`. Zwischen Panel und Proposal hältst du **nicht** an. Die Wahl
trifft der Mensch am Freigabe-Checkpoint, und will er einen anderen Weg, läuft `/opsx:update`.

**Checkpoint — Pflicht (LFH-588).** Nach den `/opsx:propose`-Läufen hältst du an und legst
**alle Changes des Laufs gesammelt** vor, samt offenen Optionen und Empfehlung. Die Tasks
bleiben auf `in design`. Erst die Freigabe des Menschen führt auf `ready for development`, und
erst danach beginnt Phase 3 mit `/opsx:apply`. Kein Workflow darf diesen Halt ersetzen.

**Status:** `entwurf` → `in design` → nach Freigabe `ready for development`.

## Phase 3 — Dev / umsetzen (Moduswahl)

**Wähle den Modus selbst** und nenne dem User die Wahl + Begründung (er darf overriden):

- **Sequenziell-interaktiv (Default, sicher):** Subtasks nacheinander. Pro Subtask rufst du
  **`dev-clickup-ausfuehren`** auf — das routet im Main-Loop in die Arbeitsdisziplin von
  Superpowers (TDD/Debugging/…) und in den OpenSpec-Änderungszyklus (`/opsx:explore`,
  `/opsx:propose`, `/opsx:apply`) und führt den Board-Status pro Subtask mit. Die Route aus
  Phase 1 gilt dabei weiter, sie wird nicht neu geschätzt. Ein Subtask auf `entwurf`, dessen
  Change in Phase 2 freigegeben wurde, steigt direkt bei `/opsx:apply` ein und bekommt **kein
  zweites** `/opsx:propose`. Ein in Phase 1 geklärter `unklar`-Task bekommt kein zweites
  `/opsx:explore`. Wähle das,
  wenn Subtasks **gemeinsame Files** berühren, voneinander abhängen, oder während der
  Umsetzung interaktive Entscheidungen zu erwarten sind.
- **Autonom / „automode":** nur wenn die Subtasks **nachweislich unabhängig** sind
  (disjunkte File-Mengen, keine Reihenfolge-Abhängigkeit) **und** die Spec eindeutig ist.
  Dann fan-out per **Workflow mit `isolation: 'worktree'`**: jeder Agent implementiert+testet
  einen Subtask autonom. Schnell, aber ohne interaktives TDD/Review und mit Konfliktrisiko
  bei geteilten Files — deshalb die harte Unabhängigkeits-Bedingung. Ein Subtask auf
  `entwurf` darf nur hinein, wenn seine Change **schon freigegeben** ist. Der Agent arbeitet
  dann deren `tasks.md` ab und hakt ab, ändert aber weder Proposal noch Spec noch Design. Trägt
  das Design nicht, ist das ein Blocker, den der Agent zurückgibt. Du klärst ihn mit dem
  Menschen und passt die Change per `/opsx:update` an.

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

- **OpenSpec-Changes vor dem PR archivieren**, im selben Branch (`/opsx:archive`, Einzelheiten
  in `dev-clickup-ausfuehren`, Schritt 4). Kein Archiv-PR nach dem Merge; Schritt 13 von
  `check-all.sh` hält eine abgehakte, nicht archivierte Change rot.
- Integration → `superpowers:finishing-a-development-branch`, und zwar **ohne Menü mit der
  stehenden Wahl „Push + PR gegen `alpha`"** (Festlegung des Users, 22.09.2026; Details in
  `dev-clickup-ausfuehren`). Worktree/Branch dem Harness überlassen (nicht manuell removen).
- Pro (Sub)Task Board-Status vorwärts: nach Merge `shipped`; ist nichts mehr offen → `done`.
  Parent erst auf `shipped`/`done`, wenn alle Subtasks es sind.
- Commits/PR auf die jeweilige `custom_id` referenzieren.
- **Eine** Abschlussmeldung an den Menschen für den ganzen Task — Inhalt/Form und der
  Startbefehl für den Dev-Stack stehen in `dev-clickup-ausfuehren` (Abschnitt
  „Abschlussmeldung an den Menschen"), hier nicht duplizieren. `dev-clickup-ausfuehren`
  gibt pro Subtask **keine eigene** Meldung aus, wenn es von hier aufgerufen wird — die
  Bediensicht/Klickweg-Angaben je Subtask sammelst du während Phase 3 ein (frisch, nicht
  aus git rekonstruiert) und fügst sie hier zu **einer zusammenhängenden** Meldung
  zusammen. Ein Epic mit acht Subtasks bekommt **eine** Meldung, nicht acht
  aneinandergereihte.

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
  (Scope-Map mit Routen, Changes, Findings), kompakt — nicht nur „bin fertig mit Phase X".
- **Der Freigabe-Checkpoint nach `/opsx:propose` ist nie „sparsam“ auszulassen.** Er gilt,
  sobald in Phase 2 eine Change entstanden ist.

## Don'ts

- Status-Spur, Routing, Task-Laden, Worktree-Logik **nicht** hier kopieren → an
  `dev-clickup-ausfuehren` delegieren.
- **Kein** Interaktives (Checkpoint, Worktree-Frage, TDD, Review) in einen Workflow stecken —
  Workflows können nicht fragen.
- **Kein `/opsx:*` im Workflow** (`explore`, `propose`, `update`, `apply`, `archive`) und kein
  Anlegen oder Ändern unter `openspec/changes/`. Einzige Ausnahme: Ein autonomer Dev-Agent hakt
  Aufgaben einer freigegebenen Change ab. Ein Workflow-Agent, der `/opsx:propose` ausführt,
  endet einfach an dessen Halt, und das sähe aus wie ein Erfolg.
- Keinen Plan-Workflow „je Subtask“ neben einer Change laufen lassen, denn die `tasks.md` ist
  der Plan.
- Einzelne Subtask-Code-Änderungen **nicht** zwanghaft in Workflows wickeln (Zeremonie) —
  Workflow für Scope/Design/Review und für echten autonomen Fan-out.
- Autonomen Modus **nicht** bei geteilten Files / Abhängigkeiten wählen.
- Bei jedem Status-Übergang fragen — nur an den drei Verzweigungen oben.
- Keinen neuen Task anlegen — das ist `clickup-task-anlegen`.
- Am Ende **nicht** acht Einzelmeldungen aneinanderreihen — eine gebündelte
  Gesamt-Abschlussmeldung (s. Phase 5).
