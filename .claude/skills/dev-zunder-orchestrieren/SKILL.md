---
name: dev-zunder-orchestrieren
description: Use as the primary entry point whenever the user wants to implement, pick up, "umsetzen", or work through a task from the Lifeline-Hub Zunder Entwicklungsboard (project "Dev: Lifeline-Hub") — including epics/parent tasks with subtasks, and any request phrased "mit subagents", "ultracode", "als Workflow", "automode", or "mach alle Subtasks". This skill orchestrates the whole task (and its subtasks) with fan-out via Workflow or subagents, started at its own discretion without opt-in (scope scan, design-option judging, review), Superpowers design docs and plans per task in the main loop, and human checkpoints in between. It supersedes and internally invokes dev-zunder-ausfuehren for per-(sub)task execution. NOT for capturing/creating new tasks — that's zunder-task-anlegen.
---

# Zunder-Aufgabe umsetzen — Orchestrierung (Lifeline Hub)

## Überblick

Primärer Einstieg, um einen Task vom **Entwicklungsboard** (Zunder, `AGENTS.md` Abschnitt „Zunder“) — und **alle
seine Subtasks** — umzusetzen. Dieser Skill ist eine **Orchestrierungs-Schicht**: er treibt
den Ablauf im Main-Loop, nutzt **Workflows oder parallele Subagents** für die Fan-out-Phasen
(Scope, Bewertung von Entwurfsoptionen, Review) und präsentiert **Zwischenstände vor der Dev**. Die
eigentliche Pro-(Sub)Task-Ausführung — Status-Spur, Reservierung, Komplexitäts-Routing, Worktree — delegiert er an
`dev-zunder-ausfuehren`. Diese Logik **nicht** hier reimplementieren; es gibt eine Quelle der
Wahrheit.

## Kernprinzip: Hybrid, nicht ein großer Workflow

Das **Workflow-Tool und Subagents laufen im Hintergrund und können den User nicht mitten im
Lauf fragen.** Daraus folgt die ganze Architektur:

- **Der Main-Loop (du) besitzt alles Interaktive**: Checkpoints, Entscheidungen,
  Worktree-Anlage, interaktives TDD, die Entscheidung über Review-Befunde. Diese Dinge dürfen
  **nie** in einem Workflow oder Subagent stecken.
- **Workflows und Subagents besitzen das parallele Schwerlast-Lesen/Bewerten**: viele
  Subtasks/Subsysteme gleichzeitig scannen, konkurrierende Entwürfe bewerten.

**Ob und wie viel Fan-out, entscheidest du selbst** — ein Opt-in wie „ultracode“ braucht es
nicht (Festlegung des Users, 04.10.2026; Regeln, Abwägung Agent oder Workflow und Pflichtinhalt
jedes Worker-Prompts in `dev-zunder-ausfuehren`, Abschnitt „Agenten nach Bedarf“). Fan-out
lohnt sich für Scope, Entwurfsbewertung und Review (den Entwurf selbst schreibt
`superpowers:brainstorming` im Main-Loop, s. „Entwurfs-Hoheit“) — nicht dafür, jede einzelne
Subtask-Code-Änderung in einen Workflow zu wickeln (das ist Zeremonie). Die
Ausnahme ist der autonome Dev-Modus (s. Phase 3), der bewusst worktree-isolierte Agents
fan-out.

Lege zu Beginn eine **TodoWrite-Phasenliste** an (Laden → Scope → Design → Dev → Review →
Abschluss), damit der Mehrphasen-Lauf nachvollziehbar bleibt.

## Phasenüberblick

| Phase | Wer | Werkzeug | Checkpoint? |
|---|---|---|---|
| 0 Laden & Statuskontext | Main-Loop | Zunder-Connector, ggf. Worktree | — |
| 1 Scope/Verstehen | **Fan-out** (Workflow oder Subagents) + Main-Loop (`brainstorming` bei `unklar`) | parallele Reader über Subtasks/Subsysteme → Scope-Map mit `route` | **ja, Pflicht: Lösungsweg gemeinsam ausarbeiten** |
| 2 Entwurf | **Main-Loop** (`brainstorming` je Task auf `entwurf`), optional Judge-Panel (**Workflow** oder Subagents) als Zulieferer | ein Design-Doc je Task (bzw. je geteilter Fähigkeit) | **ja, Pflicht: Freigabe der Design-Docs** |
| 3 Dev (umsetzen) | Main-Loop **oder** Workflow | Moduswahl: sequenziell-interaktiv vs. autonom | nur bei Blocker |
| 4 Review | nach Ermessen: ein Agent (bei sehr großem Diff zwei) | Prüfliste, Befunde zurück in Phase 3 | — |
| 5 Abschluss & Status | Main-Loop | Merge, Board-Status | — |

Konkrete, adaptierbare Workflow-Skripte für Phase 1/2 stehen in
`references/workflow-bausteine.md` — von dort kopieren und anpassen, nicht neu erfinden.

## Entwurfs-Hoheit: der Workflow besitzt die Menge, der Main-Loop den Entwurf (LFH-589)

Scope und Entwurf beantworten der Workflow und der Main-Loop, aber **nie beide dieselbe Frage**
(Spec `entwurfs-hoheit` und Herleitung `lfh-589-entwurfs-hoheit-orchestrierung` im
OpenSpec-Archiv; seit LLH-1967 mit Superpowers statt OpenSpec):

- **Workflow = die Menge.** Er liest und bewertet parallel über viele Subtasks: den Scope-Scan
  (Phase 1) und das Judge-Panel (Phase 2, nur Zulieferer). Er schreibt kein Design-Doc und
  keinen Plan unter `docs/superpowers/` und ruft weder `brainstorming` noch `writing-plans`.
  Dasselbe gilt, wenn Subagents statt eines Workflows den Fan-out tragen.
- **Main-Loop = der einzelne Entwurf.** Er klärt eine unklare Anforderung und entwirft einen
  Task in `superpowers:brainstorming` (Design-Doc), schneidet ihn nach Freigabe mit
  `superpowers:writing-plans` und setzt ihn mit `subagent-driven-development` oder
  `executing-plans` um. `brainstorming` und `writing-plans` laufen **im Main-Loop**, weil sie
  den Menschen brauchen.
- **Ob ein Task einen Entwurf bekommt**, entscheidet allein seine Route: Design-Doc und Plan
  genau bei `entwurf` (Gründe E1–E3 in `dev-zunder-ausfuehren`, Schritt 3), ausdrücklich keine
  bei `trivial`, `bug-unklar` und `klar`.

## Phase 0 — Laden & Statuskontext

1. **Parent-Task + Subtasks laden** (`get_task` des Zunder-Connectors; liefert den Baum der
   Unteraufgaben und den Fortschritt immer mit). Pro (Sub)Task ziehen: `id` und `<kurz>` (erste
   8 Zeichen der ID), Titel/Beschreibung, **aktueller Status**, `branch`/`pr_url`/`plan`,
   Abhängigkeiten.
2. **Statuskontext bilden:** Wo steht jeder (Sub)Task auf der Spur? (Spur und Regeln:
   `dev-zunder-ausfuehren`, „Board-Status mitführen“.) Das bestimmt, wo der Lauf einsteigt —
   schon `in_progress` stehende Subtasks nicht zurücksetzen. Hält ein anderer Agent eine
   Aufgabe per `claim_task`, bleibt sie draußen und wird gemeldet. Reserviert und freigegeben
   wird immer im Main-Loop, auch für Subtasks, die ein autonomer Agent umsetzt.
3. **Workspace/Branch:** für den Parent einen Branch/Worktree wählen. Delegiere die
   Anlage an `dev-zunder-ausfuehren` (das wiederum `superpowers:using-git-worktrees` nutzt) —
   die Wahl läuft dort **automatisch** und wird nur gemeldet, nicht erfragt.

Task mehrdeutig oder keine Subtasks auffindbar → kurz beim User rückfragen, nicht raten.

## Phase 1 — Scope/Verstehen (Fan-out + Main-Loop)

**Mechanismus: der Scope-Fan-out**, als Workflow oder als parallel gestartete Subagents. Er lässt
pro Subtask (und pro berührtem Subsystem) einen
Reader-Agent parallel laufen: was berührt der Subtask, welche Files, welche Abhängigkeiten zu
anderen Subtasks, welche offenen Fragen, welche Fähigkeiten er ändert oder neu anlegt
(`faehigkeiten`: Spec unter `openspec/specs/` oder Regel einer Bereichs-`AGENTS.md`; bloßes
Berühren zählt nicht). Jeder
Reader **schlägt eine Route vor** (`trivial` · `klar` · `bug-unklar` · `unklar` · `entwurf`,
bei `entwurf` mit den zutreffenden Gründen E1–E3). Ergebnis ist eine **strukturierte Map**
(Skelett in `references/workflow-bausteine.md` → „Scope-Fan-out“). `brainstorming` läuft hier
**nicht** im Workflow oder Subagent, denn es ist ein Gespräch.

**Erkennungsmerkmal: das Feld `route` je Map-Eintrag.**

- `route: unklar` → für **diesen** Task im Main-Loop `brainstorming` zum Klären, danach neu
  routen. Die anderen Tasks behalten ihre Route.
- Jede andere Route → kein Klärgespräch in Phase 1.

**Checkpoint — Pflicht (08.11.2026).** Die Route ist ein Vorschlag des Readers, also bestätigst
oder korrigierst du sie hier. E3 prüfst du an den Pfaden der Map nach. Dann legst du die Map
kompakt vor, je Task mit Route und Lösungsweg, dazu offene Fragen, Varianten und Schnitte mit
Empfehlung (s. „Checkpoints & Entscheidungen“), und **wartest auf die Antwort**, auch wenn alles
klar scheint. Das ist die Abstimmung aus `dev-zunder-ausfuehren`, „Gemeinsam ausarbeiten, bevor
Code entsteht“; Tasks nur auf `trivial` brauchen sie nicht.

**Zerlegen:** Zeigt der Scope, dass ein Task ohne Subtasks in Teile gehört, und stimmt der
Mensch am Checkpoint zu, legt `decompose_task` die Subtasks in einem Schritt an (alles oder
nichts).

**Status:** `in_progress`, Route in `plan`; am Checkpoint `blocked`, erst mit der Zustimmung zurück
auf `in_progress` (`dev-zunder-ausfuehren`, „Board-Status mitführen“).

## Phase 2 — Entwurf (Main-Loop mit `brainstorming`)

**Mechanismus: `superpowers:brainstorming` im Main-Loop, je Task mit `route: entwurf`, bis zum
Design-Doc.** Tasks auf `trivial`, `klar` oder `bug-unklar` bekommen in Phase 2 **keinen**
Planungsschritt und kein Design-Doc. Sie gehen direkt in Phase 3 (TDD bzw. Debugging über
`dev-zunder-ausfuehren`). Den Plan schreibt `writing-plans` erst nach der Freigabe, zu Beginn
von Phase 3; einen Plan-Workflow „je Subtask“ gibt es nicht.

**Erkennungsmerkmal:** Phase 2 läuft genau für die Map-Einträge mit bestätigter Route
`entwurf`. Gibt es keinen, entfällt Phase 2.

**Schnittstelle Scope-Map → Design-Doc:**

- **Name:** `docs/superpowers/specs/YYYY-MM-DD-<kurz>-<slug>-design.md`, z. B.
  `2026-11-20-a1b2c3d4-status-filter-einheiten-design.md` (`<kurz>` = erste 8 Zeichen der ID);
  der Plan später gleich benannt unter `docs/superpowers/plans/` ohne `-design`.
- **Eingabe:** Der Map-Eintrag ist der Ausgangspunkt für `brainstorming`: Zusammenfassung, Files,
  Entwurfsgründe und die am Phase-1-Checkpoint beantworteten Fragen. Was dort geklärt ist, fragt
  `brainstorming` nicht erneut ab („Look Before You Ask“); es liest die Stellen trotzdem selbst.
- **Ein Design-Doc je Task.** Nennen zwei oder mehr Subtasks **auf `entwurf`** desselben Parents
  dieselbe Fähigkeit (`faehigkeiten` der Map), gibt es **ein** gemeinsames Design-Doc und einen
  gemeinsamen Plan mit dem `<kurz>` des Parents. Der Plan gliedert seine Aufgaben nach Subtask
  samt `<kurz>`. Ein Subtask auf einer anderen Route bleibt ohne Entwurf, auch wenn er dieselbe
  Fähigkeit nennt.

**Judge-Panel nur als Zulieferer.** Ist der Lösungsraum weit (E1 mit mehr als zwei ernsthaften
Wegen), bewertet vorher ein Workflow oder eine Handvoll Subagents konkurrierende Entwürfe
(Skelett: `references/workflow-bausteine.md` → „Design-Judge-Panel“). Das Panel liest nur. Den Sieger
nimmst du in `brainstorming` als Empfehlung, die übrigen als verworfene Alternativen, und
beides landet im Abschnitt „Ansätze“ des Design-Docs. Zwischen Panel und Design-Doc hältst du
**nicht** an, solange der
Sieger dem in Phase 1 abgestimmten Weg folgt; weicht er davon ab, legst du die Abweichung vorher
erneut vor. Die Wahl
trifft der Mensch am Freigabe-Checkpoint, und will er einen anderen Weg, überarbeitest du das
Design-Doc im Main-Loop und legst es erneut vor.

**Größere UI:** Regel und Pflichten (Entwurf mit `/design`, Design System neu erzeugen und nach
dem Merge veröffentlichen): `frontend/AGENTS.md`, „Größere UI-Entwürfe über das Design System“.

**`brainstorming` im Orchestrator:** Die Ansatzwahl, die `brainstorming` vor dem Design-Doc
verlangt, hat der Phase-1-Checkpoint schon getroffen (Lösungsweg je Task); weicht der Weg davon
ab, legst du ihn wie oben erneut vor. `brainstorming` **endet je Task mit dem geschriebenen
Design-Doc**, ohne dessen eigene Freigabefrage und ohne Übergang in `writing-plans`: die
Freigabe holt der gesammelte Checkpoint unten, `writing-plans` folgt erst in Phase 3. Bei nur
einem Task auf `entwurf` ist die Freigabe in `brainstorming` dieser Checkpoint.

**Checkpoint — Pflicht (LFH-588).** Nach den Design-Docs hältst du an und legst **alle
Design-Docs des Laufs gesammelt** vor, samt offenen Optionen und Empfehlung. Die Tasks stehen
dabei auf `blocked`. Erst die Freigabe des Menschen führt zurück auf `in_progress`, und erst
danach beginnt Phase 3 mit `writing-plans`. Kein Workflow darf diesen Halt ersetzen.

**Status:** Route `entwurf` → `blocked` am Checkpoint → nach Freigabe `in_progress`.

## Phase 3 — Dev / umsetzen (Moduswahl)

**Wähle den Modus selbst** und nenne dem User die Wahl + Begründung (er darf overriden):

- **Sequenziell-interaktiv (Default, sicher):** Subtasks nacheinander. Pro Subtask rufst du
  **`dev-zunder-ausfuehren`** auf — das routet im Main-Loop in die Arbeitsdisziplin von
  Superpowers (TDD/Debugging/…) und in dessen Änderungszyklus (`brainstorming`,
  `writing-plans`, `subagent-driven-development`/`executing-plans`) und führt den Board-Status
  pro Subtask mit. Die Route aus
  Phase 1 gilt dabei weiter, sie wird nicht neu geschätzt. Die einzige Ausnahme ist der
  Wechsel `bug-unklar` → `entwurf`, wenn die gefundene Ursache auf E1 oder E2 führt. Dann folgt
  `brainstorming` im Main-Loop und ein eigener Halt vor `writing-plans` (Status `blocked` bis
  zur Freigabe). Ein Subtask auf `entwurf`, dessen Design-Doc in Phase 2 freigegeben wurde,
  steigt direkt bei `writing-plans` ein und bekommt **kein zweites** `brainstorming`. Ein in
  Phase 1 geklärter `unklar`-Task bekommt kein zweites Klärgespräch. Wähle das,
  wenn Subtasks **gemeinsame Files** berühren, voneinander abhängen, oder während der
  Umsetzung interaktive Entscheidungen zu erwarten sind.
- **Autonom / „automode":** nur wenn die Subtasks **nachweislich unabhängig** sind
  (disjunkte File-Mengen, keine Reihenfolge-Abhängigkeit) **und** die Spec eindeutig ist.
  Subtasks **desselben gemeinsamen Plans** gelten immer als abhängig, weil sie denselben
  Plan abhaken. Sie laufen nie parallel autonom.
  Dann fan-out per **Workflow mit `isolation: 'worktree'`**: jeder Agent implementiert+testet
  einen Subtask autonom. Schnell, aber ohne interaktives TDD/Review und mit Konfliktrisiko
  bei geteilten Files — deshalb die harte Unabhängigkeits-Bedingung. Ein Subtask auf
  `entwurf` darf nur hinein, wenn sein Design-Doc **freigegeben** und sein Plan geschrieben
  ist. Der Agent arbeitet dann den Plan ab und hakt ab, ändert aber weder Design-Doc noch Plan.
  Trägt der Entwurf nicht, ist das ein Blocker, den der Agent zurückgibt. Du klärst ihn mit dem
  Menschen und überarbeitest Design-Doc und Plan im Main-Loop.

**„Bei Fragen melde dich":** Autonome Agents können mitten im Lauf **nicht** fragen. Instruiere
sie, bei einem harten Blocker abzubrechen und den Blocker strukturiert zurückzugeben; du
sammelst diese ein und legst sie dem User vor, statt zu raten.

Im Zweifel sequenziell. Bei gemischter Lage: unabhängige Subtasks autonom bündeln, abhängige
sequenziell — aber das nur, wenn der Schnitt sauber ist.

## Phase 4 — Review (nach Ermessen)

Höchstens **ein** Review über den ganzen Branch, nicht je Subtask. Ob er nötig ist und wie er
läuft, entscheidest du nach `dev-zunder-ausfuehren`, Abschnitt „Review nach Ermessen“, ohne zu
fragen. Ist der Diff so groß, dass ein Agent ihn nicht überblickt, dürfen es zwei sein, getrennt
nach Backend und Frontend; kein Workflow, keine Gegenprüfer. Befunde arbeitest du in Phase 3 ab.
`superpowers:verification-before-completion` vor jeder „fertig"-Aussage. Gates, CI und Merge
wartest du ab wie in „Warten ohne Wecken“ dort.

## Phase 5 — Abschluss & Status

- **Pläne vor dem PR vollständig abgehakt**; Design-Doc, Plan und Umsetzung gehen in einen PR
  (Einzelheiten in `dev-zunder-ausfuehren`, Schritt 4). Einen Archivschritt gibt es nicht.
- Integration → `superpowers:finishing-a-development-branch`, und zwar **ohne Menü mit der
  stehenden Wahl „Push + PR gegen `alpha`"** (Festlegung des Users, 22.09.2026; Details in
  `dev-zunder-ausfuehren`). Worktree/Branch dem Harness überlassen (nicht manuell removen).
- Pro (Sub)Task Board-Status vorwärts: PR offen → `review` samt `pr_url`, nach Merge `done`.
  Parent erst auf `done`, wenn alle Subtasks es sind (`progress` aus `get_task`). Danach
  `release_task` für jede reservierte Aufgabe.
- Commit-Body und PR-Beschreibung tragen je (Sub)Task die Zeile
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>`.
- **Bilder der Änderung** je Subtask in PR und Meldung (Regel und Technik:
  `dev-zunder-ausfuehren`, „Bilder der Änderung“).
- **Eine** Abschlussmeldung an den Menschen für den ganzen Task — Inhalt/Form und der
  Startbefehl für den Dev-Stack stehen in `dev-zunder-ausfuehren` (Abschnitt
  „Abschlussmeldung an den Menschen"), hier nicht duplizieren. `dev-zunder-ausfuehren`
  gibt pro Subtask **keine eigene** Meldung aus, wenn es von hier aufgerufen wird — die
  Bediensicht/Klickweg-Angaben je Subtask sammelst du während Phase 3 ein (frisch, nicht
  aus git rekonstruiert) und fügst sie hier zu **einer zusammenhängenden** Meldung
  zusammen. Ein Epic mit acht Subtasks bekommt **eine** Meldung, nicht acht
  aneinandergereihte.

## Status durchgehen — Entscheidungspunkte

Der Board-Status wird grundsätzlich **automatisch und nur vorwärts** geführt (Spur + Regeln:
`dev-zunder-ausfuehren`, „Board-Status mitführen“). Den User **nur an echten Verzweigungen**
entscheiden lassen — nicht bei jedem Übergang. Die Route bestätigt er am Phase-1-Checkpoint,
das Design-Doc am Freigabe-Checkpoint; als eigene Status-Frage bleibt nur:

| Verzweigung | Wann fragen | Optionen |
|---|---|---|
| Verwerfen | Task soll fallen gelassen werden | `dropped` (nie `delete_task`) |

Alles andere: ohne Rückfrage setzen, niemals rückwärts oder redundant.

## Checkpoints & Entscheidungen

- **Zwei feste Halte:** nach Phase 1 (Lösungsweg gemeinsam ausarbeiten; entfällt nur, wenn alle
  Tasks auf `trivial` stehen) und nach Phase 2 (Freigabe, sobald dort ein Design-Doc entstanden
  ist).
  Weitere Checkpoints sparsam, nur wenn eine Phase eine Unklarheit,
  einen Konflikt oder mehrere vertretbare Optionen aufwirft; sonst kurz zusammenfassen und
  weiterlaufen.
- **Optionen anbieten, nicht offene Fragen stellen.** Wenn du fragst, leg konkrete Optionen
  mit Trade-offs vor und gib eine Empfehlung. Nutze dafür den interaktiven Frage-Mechanismus.
- **Zwischenstand = Artefakt zeigen.** Präsentiere das, was die Phase produziert hat
  (Scope-Map mit Routen, Design-Docs, Findings), kompakt — nicht nur „bin fertig mit Phase X".
- **Der Freigabe-Checkpoint nach dem Design-Doc ist nie „sparsam“ auszulassen.** Er gilt,
  sobald in Phase 2 ein Design-Doc entstanden ist.

## Don'ts

- Status-Spur, Routing, Task-Laden, Reservierung, Worktree-Logik **nicht** hier kopieren → an
  `dev-zunder-ausfuehren` delegieren.
- **Kein** Interaktives (Checkpoint, Worktree-Frage, TDD, Entscheidung über Review-Befunde) in
  einen Workflow oder Subagent stecken — beide können nicht fragen.
- **Kein `brainstorming` und kein `writing-plans` im Workflow oder Subagent**, und kein
  Design-Doc oder Plan, den ein Workflow oder Subagent unter `docs/superpowers/` anlegt oder
  ändert. Einzige Ausnahme: Ein autonomer Dev-Agent hakt Aufgaben eines freigegebenen Plans ab.
  Ein Workflow-Agent oder Subagent, der `brainstorming` ausführt, kann nicht fragen und baut
  einen Entwurf auf Vermutungen, der aussieht wie ein abgestimmter.
- Keinen Plan-Workflow „je Subtask“ neben dem Plan aus `writing-plans` laufen lassen.
- Nichts unter `openspec/` anlegen; es ist eingefrorenes Archiv.
- Einzelne Subtask-Code-Änderungen **nicht** zwanghaft in Workflows wickeln (Zeremonie) —
  Workflow für Scope/Design/Review und für echten autonomen Fan-out.
- Autonomen Modus **nicht** bei geteilten Files / Abhängigkeiten wählen.
- Bei jedem Status-Übergang fragen — nur an der Verzweigung oben.
- Keinen neuen Task anlegen — das ist `zunder-task-anlegen`.
- Am Ende **nicht** acht Einzelmeldungen aneinanderreihen — eine gebündelte
  Gesamt-Abschlussmeldung (s. Phase 5).
