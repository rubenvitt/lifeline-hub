---
name: dev-zunder-ausfuehren
description: Per-single-(sub)task execution layer for the Lifeline-Hub Zunder Entwicklungsboard (project "Dev: Lifeline-Hub") — owns the board-status spur, the claim, complexity routing, and worktree handoff for ONE task. Primarily invoked by dev-zunder-orchestrieren, which orchestrates whole tasks (incl. subtasks) and is the entry point for "umsetzen"/"implementiere"/"mit subagents"/"ultracode". Use this directly only for a single, standalone task with no subtasks. NOT for capturing new tasks (use zunder-task-anlegen).
---

# Zunder-Aufgabe implementieren (Lifeline Hub)

## Überblick

Einen Task vom **Entwicklungsboard** (Zunder-Projekt „Dev: Lifeline-Hub“, IDs und Status in
`AGENTS.md`, Abschnitt „Zunder“) umsetzen. Dieser Skill macht wenige **eigene
Entscheidungen** — Workspace (Branch/Worktree), Komplexitäts-Routing, Reservierung und das
**Mitführen des Board-Status** — und delegiert alles andere weiter. Nichts davon
reimplementieren. Subagents und Workflows startest du dabei nach eigenem Ermessen (Abschnitt
„Agenten nach Bedarf“).

**Zwei Quellen, die ineinandergreifen:** **OpenSpec** (`/opsx:*`) besitzt den
**Änderungszyklus** — klären, entwerfen, Spec und Aufgabenschnitt, Aufgabenliste abarbeiten,
archivieren. **Superpowers** (`superpowers:*`) besitzt die **Arbeitsdisziplin** — Worktree,
Debugging, TDD, Verifikation, Review, Branch-Abschluss.

Die *planning boundary* gilt für **fünf** der sechs OpenSpec-Workflows (`explore`, `propose`,
`update`, `sync`, `archive`): sie fassen keinen Projektcode an. **`/opsx:apply` ist die
Ausnahme** — es setzt um („Implement tasks from an OpenSpec change"). Es bringt dabei aber
**keine eigene Arbeitsdisziplin** mit: weder TDD noch Review stehen in seinem Skill. *Wie*
eine einzelne Aufgabe entsteht, sagt weiterhin `superpowers:test-driven-development`, und vor
„fertig" stehen unverändert Schritt 4 unten. Wer `/opsx:apply` als Ersatz dafür liest,
verliert die Zusicherung, ohne dass ein Test rot wird.

## Wann benutzen

- User nennt einen konkreten Task (Zunder-Link `…/#/aufgabe/<uuid>`, UUID, Titel oder eine alte
  Kennung `LFH-<n>`)
- Bevor Code-Arbeit für einen bekannten Board-Task beginnt

**Nicht** zum Anlegen neuer Tasks → `zunder-task-anlegen`.
**Ganzer Task mit Subtasks / „mit subagents" / „ultracode"** → `dev-zunder-orchestrieren`
orchestriert und ruft diesen Skill pro (Sub)Task auf.

## Agenten nach Bedarf (LFH-1032)

**Festlegung des Users vom 04.10.2026: „Agenten dürfen nach Bedarf selbst erstellt werden.“**
Wer einen Task vom Entwicklungsboard umsetzt, startet Subagents (Agent-Tool) und Workflows
(Workflow-Tool) nach eigenem Ermessen — ohne „ultracode“, „mit subagents“ oder ein anderes
Opt-in im Auftrag. Diese Festlegung **ist** das ausdrückliche Opt-in, das das Workflow-Tool
verlangt, und sie reicht über „Agent-Tool nur für echte Parallelarbeit“ hinaus: Ein Agent ist
auch dann recht, wenn er den Main-Loop von breitem Lesen entlastet. Herleitung:
`openspec/changes/archive/2026-10-05-lfh-1032-agenten-nach-bedarf/design.md`.

**Nach Bedarf heißt: wo es Zeit spart oder die Güte hebt, sonst nicht.**

| Lohnt sich | Lohnt sich nicht |
|---|---|
| Scope über mehr als ein Subsystem oder mehrere Subtasks | Was ein Grep oder ein Read beantwortet |
| Review parallel zu laufenden Gates (`check-all.sh`, Vitest) | Route `trivial` |
| Ursachensuche über viel unbekannten Code (`bug-unklar`) | Alles Interaktive: Checkpoint, Rückfrage, Freigabe |
| Unabhängige Subtasks im autonomen Modus (`dev-zunder-orchestrieren`, Phase 3) | `/opsx:*`, TDD-Zyklus des Main-Loops |
| Gegenlesen eines Entwurfs oder eines heiklen Diffs | |

**Agent oder Workflow:** Für einen bis drei unabhängige Jobs das Agent-Tool (kein Skript,
gleich im Hintergrund). Ein Workflow, wenn es mehrstufig wird (finden → verifizieren) oder mehr
als drei Agents braucht; Skelette in `dev-zunder-orchestrieren/references/workflow-bausteine.md`.
Der Größenrichtwert der Umgebung für Workflows gilt weiter.

**Jeder Worker-Prompt bringt mit**, denn Worker sehen weder Systemprompt noch Skill:

- Keine `mcp__hearthbot__`-Tools: nur der Main-Loop spricht mit dem Menschen.
- Kein `/opsx:*` und nichts unter `openspec/changes/` anlegen oder ändern (Ausnahme: der autonome
  Dev-Agent hakt Aufgaben einer freigegebenen Change ab).
- Kein Push, kein PR, kein Zunder-Aufruf (Status, Felder, Reservierung) — das bleibt beim
  Main-Loop.
- Bei einer Frage, die nur der Mensch beantworten kann: abbrechen und den Blocker strukturiert
  zurückgeben, nicht raten.
- Nutzt er `/mnt/project-files`: die Regeln des geteilten Ordners, wie sie im Systemprompt der
  Sitzung stehen.

Ergebnisse fließen in den Main-Loop zurück; dort fallen Entscheidung und Meldung.

## Board-Status mitführen

Der Task soll auf dem Board zeigen, wo die Arbeit gerade steht. Status **automatisch** (keine
Rückfrage) mit `update_task` des Zunder-Connectors setzen — `task_id` und `status` als Code
(Codes und Spur: `AGENTS.md`, Abschnitt „Zunder“). Diese Tabelle ist die einzige Stelle, die
sagt, **wann** welcher Status gilt; `dev-zunder-orchestrieren` verweist hierher.

| Moment | Status | Felder per `update_task`, Kommentar per `add_comment` |
|---|---|---|
| Arbeit beginnt (Schritt 1, nach `claim_task`) | `in_progress` | — |
| Branch steht (Schritt 2) | — | `branch` |
| Route gewählt (Schritt 3) | — | `plan`: Route, bei `entwurf` der Change-Name |
| Change liegt zur Freigabe vor (Route `entwurf`) | `blocked` | `plan`: „Change `<name>` wartet auf Freigabe“ |
| Freigabe erteilt, `/opsx:apply` beginnt | `in_progress` | `plan` nachziehen |
| PR gegen `alpha` offen (Schritt 4) | `review` | `pr_url` |
| PR gemergt | `done` | — |
| Task wird verworfen | `dropped` | Kommentar: Grund |
| Harter Blocker, Session endet mit offener Frage | `blocked` | Kommentar: die Frage |
| Arbeit wartet sonst auf etwas oder jemanden (anderer Task, Mensch, Dienst) | `blocked` | Kommentar: worauf |

Regeln dazu:

- **Nur vorwärts** entlang `open → in_progress → review → done`. Steht der Task schon weiter
  (oder genau auf dem Ziel-Status), nicht zurücksetzen und nicht redundant neu schreiben.
  `blocked` verlassen ist kein Rückschritt.
- **`blocked`** darf jederzeit gesetzt werden, wenn es nötig ist, nicht nur an den Stellen der
  Tabelle; immer mit Kommentar, worauf gewartet wird. Löst sich der Blocker, zurück auf den
  Status davor.
- **Unabhängig vom Workspace.** Auch wenn der User den Branch-Switch (Schritt 2) ablehnt und
  ihr wo-ihr-seid weiterarbeitet, wird der Status gesetzt.
- **`dropped`** nur, wenn der Task verworfen wird — nicht beim bloßen Pausieren/Abbrechen
  einer Session. Nie `delete_task`.
- **Merge nachtragen:** Kein Dienst setzt nach dem Merge `done`. Steht ein Task beim Laden
  (Schritt 1) auf `review` und zeigt `gh pr view <pr_url> --json state` `MERGED`, zuerst auf
  `done` setzen.
- Zwischenstände, Gründe und Fragen als Kommentar (`add_comment`), nie in die Beschreibung
  (`AGENTS.md`, Abschnitt „Zunder“).

## Schritt 1: Task laden

`get_task` des Zunder-Connectors mit der UUID (aus dem Link `…/#/aufgabe/<uuid>`). Bei einem
Titel oder einer alten Kennung `LFH-<n>` erst per `search` die Aufgabe finden (Verfahren in
`AGENTS.md`, Abschnitt „Zunder“). Daraus ziehen:

- **`id`** (UUID) — für Zunder-Link und Commit-Referenz; **`<kurz>`** = die ersten 8
  Hex-Zeichen, für Branch- und Change-Namen
- **Titel + Beschreibung** — für Slug, Typ und Komplexität
- **`status`, `branch`, `pr_url`, `plan`** — wo die Arbeit steht (Merge nachtragen, s. o.)
- **Conventional-Typ** aus `type` (`bug` → `fix`) und Inhalt ableiten: `feat` / `fix` /
  `refactor` / `chore` / `docs` …

Task unklar oder mehrdeutig → kurz beim User rückfragen, nicht raten.

**Reservieren:** `claim_task` mit `agent` = Sitzungsname (z. B. `claude-code@<rechner>`) und
`ttl_minutes` passend zur Arbeit (Standard 120). Scheitert er, weil ein anderer Agent die Aufgabe
gültig hält, **nicht** weiterarbeiten, sondern melden. Bei langen Läufen denselben Aufruf
wiederholen, um zu verlängern. `release_task` nach dem PR (Schritt 4), beim Verwerfen und wenn
die Session ohne Ergebnis endet. Danach Status laut Tabelle oben.

## Schritt 2: Workspace prüfen (Branch / Worktree)

**Integrationsbasis ist `alpha`, nicht `main`.** Ein Feature-Branch wird von
`origin/alpha` abgezweigt, dorthin gemergt und dorthin rebased, wenn der Branch
zurückfällt. `main` ist die Release-Linie und wird von diesem Skill nie als Basis
genommen — auch dann nicht, wenn `origin/HEAD` weiter auf `main` zeigt und ein
Worktree-Helfer deshalb von dort abzweigt. Nach einem `EnterWorktree` deshalb
**prüfen**, worauf der Branch zeigt (`git rev-list --left-right --count HEAD...origin/alpha`),
und bei Bedarf auf `origin/alpha` umsetzen, bevor die erste Zeile Code entsteht.

Branch-Name bilden: **`<typ>/<kurz>-<slug>`**, `<kurz>` = erste 8 Hex-Zeichen der UUID, Slug
aus dem Titel (ASCII, kebab-case, Umlaute auflösen, 3–5 Wörter).
Beispiel: `feat/a1b2c3d4-personal-status`.

`git branch --show-current` prüfen und **ohne Rückfrage** handeln (Festlegung des
Users vom 21.09.2026: „mach das immer automatisch"):

| Aktueller Branch | Gilt als passend? | Aktion (automatisch) |
|---|---|---|
| Gehört erkennbar zu **dieser** Task (ID oder Thema passt) | Ja | Hier weiterarbeiten (Basis gegen `origin/alpha` prüfen, s. o.) |
| Generischer **Harness-/Worktree-Branch** (`claude/…`, `dev`, `wip`, `test`), sauber und ohne eigene Commits gegenüber `origin/alpha` | Nein | Im selben Worktree per `git branch -m <neuer-name>` umbenennen; Basis ggf. auf `origin/alpha` setzen |
| `alpha` / `main` / `master`, oder Branch mit **fremder** Arbeit (andere Task, eigene Commits, dreckiger Baum) | Nein | Neuen Worktree mit dem Branch-Namen anlegen → **REQUIRED SUB-SKILL:** `superpowers:using-git-worktrees` |

Die Wahl dem User in **einem Satz** melden („Branch `feat/a1b2c3d4-…` angelegt"), nicht
erfragen. Fremde Arbeit wird dabei nie umbenannt oder überschrieben — im Zweifel neuer
Worktree.

## Schritt 3: Komplexität einschätzen → Routing

Komplexität aus Task-Beschreibung selbst einschätzen und den passenden Skill wählen. Der Task
steht dabei auf `in_progress`; die Route kommt in `plan` (Tabelle „Board-Status mitführen“). Die
Spalte „Route“ ist der Schlüssel, den auch die Scope-Map von `dev-zunder-orchestrieren` führt
(`route`):

| Route | Komplexität | Skill |
|---|---|---|
| `trivial` | Trivial (Typo, Text/Copy-Change) | Direkt, kein Sub-Skill |
| `unklar` | Anforderung unklar | **`/opsx:explore`** zuerst, danach neu routen |
| `bug-unklar` | Bug, Ursache unklar | **`superpowers:systematic-debugging`** |
| `klar` | Feature/Bugfix, klare Spec | **`superpowers:test-driven-development`** |
| `entwurf` | Entwurf nötig (E1–E3, s. u.) | **`/opsx:propose`** → ⟨Checkpoint, `blocked`⟩ → **`/opsx:apply`** |

**Wann eine OpenSpec-Change entsteht — genau auf der Route `entwurf`** (LFH-589, Spec
`entwurfs-hoheit`). Die Route `entwurf` gilt, sobald **mindestens einer** dieser Gründe
zutrifft, und geht dann den übrigen Zeilen vor:

- **E1 Entscheidung:** Es gibt mehr als einen vertretbaren Weg, und die Wahl soll begründet
  nachlesbar bleiben.
- **E2 Regel:** Der Task führt eine Regel ein oder ändert eine, die über ihn hinaus gilt:
  eine Anforderung einer Fähigkeit, eine Projektregel in einer `AGENTS.md` oder eine Regel in einer
  Arbeitsanleitung unter `.claude/`.
- **E3 Breite:** Der Task berührt mehr als ein Subsystem. Subsysteme sind: Backend (`src/`,
  `migrations/`, `tests/`), Frontend (`frontend/`), Desktop-Hülle (`src-tauri/`), Gate und CI
  (`scripts/`, `.github/`), Arbeitsanleitungen (`.claude/`, die `AGENTS.md`-Dateien). Pfade außerhalb
  dieser Liste (etwa `docs/`, `openspec/`, Wurzeldateien wie `Cargo.toml` oder `mise.toml`)
  zählen zu keinem Subsystem. **Ausnahmen:** Ein Bugfix, der vorhandenes Verhalten
  wiederherstellt, und eine reine Text- oder Tippfehlerkorrektur lösen E3 nicht aus, auch wenn
  sie über mehrere Subsysteme reichen.

Auf den Routen `trivial`, `bug-unklar` und `klar` entsteht **ausdrücklich keine** Change. Das
gilt auch, wenn mehrere Dateien berührt sind. `unklar` entscheidet noch nichts: erst
`/opsx:explore`, danach neu routen. Führt `bug-unklar` nach dem Finden der Ursache auf E1 oder
E2, wechselt der Task auf `entwurf`. Dann `/opsx:propose` im Main-Loop, und der Freigabe-Checkpoint
gilt wie auf jeder Route `entwurf`: `/opsx:apply` erst nach Freigabe.

**Aufruf durch `dev-zunder-orchestrieren`:** Dann schätzt dieser Skill die Route **nicht**
selbst. Es gilt die am Phase-1-Checkpoint bestätigte `route` der Scope-Map. Liegt für den Task
schon eine in Phase 2 freigegebene Change vor, steigt er direkt bei `/opsx:apply` ein, ohne
zweites `/opsx:propose`. Ein in Phase 1 geklärter `unklar`-Task bekommt kein zweites
`/opsx:explore`. Einzige Ausnahme ist der Wechsel `bug-unklar` → `entwurf` oben.

**Der Checkpoint auf der Route `entwurf` ist Pflicht, kein Stilmittel.** `/opsx:propose` trägt
die *planning boundary*: es erzeugt `proposal.md`, Delta-Spec, `design.md` und `tasks.md`
und **hält dann an** — „Do not start implementation in the same response, even if the initial
request asks for it. Wait for a new user request after the artifacts are presented; then
start the apply workflow." Der Stopp ist das erwartete Verhalten und **kein Fehler**: nicht
umgehen, nicht im selben Zug weiterimplementieren. Die Artefakte dem Menschen vorlegen, der Task steht
dabei auf `blocked`; **erst mit seiner Freigabe** zurück auf `in_progress` und `/opsx:apply`.
(Dieselbe Reihenfolge wie in `dev-zunder-orchestrieren`, Phase 2. Dort werden mehrere Changes
eines Laufs gesammelt vorgelegt, aber auch dann gilt: kein Workflow ruft `/opsx:*`.)

`/opsx:apply` arbeitet die `tasks.md` ab — die **Art zu arbeiten** bleibt davon unberührt:
Aufgaben mit klarer Spec entstehen weiter per `superpowers:test-driven-development`, und
Schritt 4 gilt unverändert.

Die Planungsartefakte landen in **`openspec/changes/<name>/`**. `docs/superpowers/plans/`
ist eingefrorenes Archiv — dort wird nichts Neues angelegt.

## Schritt 4: Abschluss

- **`superpowers:verification-before-completion`** — vor jeder „fertig"-Aussage
- **OpenSpec-Change archivieren, BEVOR der PR entsteht** (Entscheidung 30.09.2026): Ist die
  `tasks.md` der Change abgehakt, läuft **`/opsx:archive <name>` im selben Branch** — Spec-Sync
  nach `openspec/specs/`, Verschieben nach `openspec/changes/archive/<datum>-<name>/`, Verweise
  auf den alten Pfad (`AGENTS.md`-Dateien, Code-Kommentare, `docs/`) im selben Commit nachziehen. Nicht
  „nach dem Merge“: das braucht einen zweiten PR, und der bleibt aus (am 30.09.2026 lagen zwölf
  umgesetzte Changes aktiv). Schritt 13 von `check-all.sh` (`scripts/check-openspec-archiv.sh`)
  macht eine abgehakte, nicht archivierte Change rot. Kästchen, die erst die CI des PRs belegt
  („`check-all.sh` grün“), werden mit Verweis auf diesen Lauf abgehakt, nicht offen gelassen.
- **`superpowers:requesting-code-review`** vor dem Mergen
- Commit-Body und PR-Beschreibung tragen die Zeile
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/<uuid>` (Konvention: `AGENTS.md`, Abschnitt „Zunder“)
- Integration → **`superpowers:finishing-a-development-branch`**, **Ziel `alpha`** (PR-Base
  `alpha`, nicht `main`) → PR offen: **Status `review`** samt `pr_url`, dann `release_task`;
  nach dem Merge **`done`**
- **Stehende Wahl im Integrationsmenü: Option 2 — pushen und PR gegen `alpha` öffnen**
  (Festlegung des Users, 22.09.2026). Das Menü von `finishing-a-development-branch` wird
  **nicht** mehr vorgelegt, sondern diese Wahl direkt ausgeführt; kein lokaler Merge, der
  Worktree bleibt für PR-Feedback stehen. Der Board-Status bleibt bis zum Merge auf
  `review`, erst der gemergte PR führt auf `done` (wer ihn zuerst gemergt sieht, setzt ihn;
  „Merge nachtragen“ oben). Abweichen nur, wenn der User im
  laufenden Task ausdrücklich etwas anderes sagt.
- Wird der Task verworfen statt umgesetzt → **Status: `dropped`**, `release_task`
- Danach: **Abschlussmeldung an den Menschen** (s. u.) — letzter Schritt, nach Merge und
  Board-Status.

## Abschlussmeldung an den Menschen

Nach Merge und Board-Status bekommt der Mensch eine kurze Meldung, was er jetzt in der
Anwendung sehen und ausprobieren kann — keine Commit-Liste (steht in git), keine
Wiederholung des Tickets, keine Dateinamen statt Bedienwegen. Inhalt:

1. **Was ist neu — aus Bediensicht.** Was sieht/kann jemand jetzt beim Benutzen? Rein
   interne Änderungen ohne sichtbare Wirkung als solche benennen, nicht zum Feature aufblasen.
2. **Wo man es findet.** Route bzw. Klickweg (bei einem Einsatzmodul: welcher Einsatz,
   welches Modul, welche Stelle der Seite).
3. **Wie man es ausprobiert.** Der Handgriff, an dem der Unterschied sichtbar wird — nicht
   „Seite öffnen". Braucht es dafür bestimmte Daten (überfälliger Auftrag, >8 Einsätze o.ä.),
   gehört das dazu.
4. **Was sich bewusst NICHT geändert hat**, wo jemand es erwarten könnte.
5. **Offene Nachzüge** mit Zunder-Link, falls beim Umsetzen welche entstanden sind.

**Dev-Stack starten** (damit die Meldung nicht ins Leere zeigt): das Frontend ist per
`rust-embed` **zur Compile-Zeit** ins Backend-Binary eingebettet — wer nur `cargo run`
startet, sieht ein **altes** Frontend. Für die Ansicht während der Entwicklung läuft das
Frontend über den **Vite-Dev-Server**, nicht über das eingebettete Bundle:

- Backend (Repo-Root): `cargo run` (Default-Bind `127.0.0.1:8080`; mit Testdaten
  `cargo run --features dev-seeds`).
- Frontend (im Repo aufgerufen, damit mise die `mise.toml` findet):
  `mise exec -- pnpm -C <absoluter-frontend-pfad> dev` — dann die von Vite ausgegebene URL öffnen (Default-Port 5173, aber nicht garantiert:
  `strictPort` ist aus, und ein `pnpm run setup` im Frontend-Ordner vergibt bei parallelen
  Workspaces andere Ports über `.env.local` und nennt dabei auch den passenden
  `cargo run --bind …`-Befehl).

**Wird dieser Skill von `dev-zunder-orchestrieren` aufgerufen, entfällt diese Meldung
hier** — der Orchestrator sammelt Bediensicht/Klickweg je Subtask ein und gibt am Ende
**eine** Gesamtmeldung aus (s. dort, Phase 5).

## Don'ts

- Worktree-/Branch-Logik **nicht** selbst bauen — an `using-git-worktrees` delegieren.
- Einen Branch mit fremder Arbeit **nicht** umbenennen oder zurücksetzen — dann neuer Worktree.
- Komplexität nicht überspringen — auch „kleine" Features brauchen TDD.
- Keine Agents für Interaktives, `/opsx:*` oder Triviales, und kein Worker-Prompt ohne die
  Pflichtpunkte aus „Agenten nach Bedarf“.
- Keinen neuen Task anlegen — das ist `zunder-task-anlegen`.
- Nicht an einer Aufgabe arbeiten, die ein anderer Agent per `claim_task` hält.
- Status nicht rückwärts oder redundant setzen — nur vorwärts entlang der Spur.
- Abschlussmeldung **nicht** als Commit-Liste oder mit Dateinamen — Bediensicht und
  Klickweg, nicht Code. Und **nicht** ausgeben, wenn `dev-zunder-orchestrieren` aufruft.
