---
name: dev-clickup-ausfuehren
description: Per-single-(sub)task execution layer for the Lifeline-Hub ClickUp Entwicklungsboard — owns the board-status spur, complexity routing, and worktree handoff for ONE task. Primarily invoked by dev-clickup-orchestrieren, which orchestrates whole tasks (incl. subtasks) and is the entry point for "umsetzen"/"implementiere"/"mit subagents"/"ultracode". Use this directly only for a single, standalone task with no subtasks. NOT for capturing new tasks (use clickup-task-anlegen).
---

# ClickUp-Task implementieren (Lifeline Hub)

## Überblick

Einen Task vom **Entwicklungsboard** (`901523554968`) umsetzen. Dieser Skill macht wenige
**eigene Entscheidungen** — Workspace (Branch/Worktree), Komplexitäts-Routing und das
**Mitführen des Board-Status** — und delegiert alles andere weiter. Nichts davon
reimplementieren.

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

- User nennt einen konkreten Task ("implementiere ClickUp #123", "mach Task LH-42", URL/Name)
- Bevor Code-Arbeit für einen bekannten Board-Task beginnt

**Nicht** zum Anlegen neuer Tasks → `clickup-task-anlegen`.
**Ganzer Task mit Subtasks / „mit subagents" / „ultracode"** → `dev-clickup-orchestrieren`
orchestriert und ruft diesen Skill pro (Sub)Task auf.

## Board-Status mitführen

Der Task soll auf dem Board zeigen, wo die Arbeit gerade steht. Status **automatisch**
(keine Rückfrage) mit `mcp__claude_ai_ClickUp__clickup_update_task` setzen — `task_id` und
`status` wörtlich (case-sensitive).

Status-Spur des Boards:
`backlog → scoping → in design → ready for development → in development → in review → testing → shipped → done` (Sonderfall: `cancelled`).

**Wann welcher Status** ergibt sich aus den `→`-Markern in Schritt 3 (Routing) und Schritt 4
(Abschluss). Regeln dazu:

- **Nur vorwärts.** Steht der Task schon weiter (oder genau auf dem Ziel-Status), nicht
  zurücksetzen und nicht redundant neu schreiben.
- **Unabhängig vom Workspace.** Auch wenn der User den Branch-Switch (Schritt 2) ablehnt und
  ihr wo-ihr-seid weiterarbeitet, wird der Status gesetzt.
- **`cancelled`** nur, wenn der Task verworfen wird — nicht beim bloßen Pausieren/Abbrechen
  einer Session.

## Schritt 1: Task laden

`mcp__claude_ai_ClickUp__clickup_get_task` mit der genannten ID/URL. Daraus ziehen:

- **`custom_id`** (z.B. `LH-42`) — für Branch-Name und Commit-Referenzen
- **Name + Beschreibung** — für Slug, Typ und Komplexität
- **Conventional-Typ** selbst ableiten (der Space hat keine Tags): `feat` / `fix` /
  `refactor` / `chore` / `docs` …

Task unklar oder mehrdeutig → kurz beim User rückfragen, nicht raten.

## Schritt 2: Workspace prüfen (Branch / Worktree)

**Integrationsbasis ist `alpha`, nicht `main`.** Ein Feature-Branch wird von
`origin/alpha` abgezweigt, dorthin gemergt und dorthin rebased, wenn der Branch
zurückfällt. `main` ist die Release-Linie und wird von diesem Skill nie als Basis
genommen — auch dann nicht, wenn `origin/HEAD` weiter auf `main` zeigt und ein
Worktree-Helfer deshalb von dort abzweigt. Nach einem `EnterWorktree` deshalb
**prüfen**, worauf der Branch zeigt (`git rev-list --left-right --count HEAD...origin/alpha`),
und bei Bedarf auf `origin/alpha` umsetzen, bevor die erste Zeile Code entsteht.

Branch-Name bilden: **`<typ>/<custom_id>-<slug>`**, custom_id klein, Slug aus dem
Task-Namen (ASCII, kebab-case, Umlaute auflösen, 3–5 Wörter).
Beispiel: `feat/lh-42-personal-status`.

`git branch --show-current` prüfen und **ohne Rückfrage** handeln (Festlegung des
Users vom 21.09.2026: „mach das immer automatisch"):

| Aktueller Branch | Gilt als passend? | Aktion (automatisch) |
|---|---|---|
| Gehört erkennbar zu **dieser** Task (ID oder Thema passt) | Ja | Hier weiterarbeiten (Basis gegen `origin/alpha` prüfen, s. o.) |
| Generischer **Harness-/Worktree-Branch** (`claude/…`, `dev`, `wip`, `test`), sauber und ohne eigene Commits gegenüber `origin/alpha` | Nein | Im selben Worktree per `git branch -m <neuer-name>` umbenennen; Basis ggf. auf `origin/alpha` setzen |
| `alpha` / `main` / `master`, oder Branch mit **fremder** Arbeit (andere Task, eigene Commits, dreckiger Baum) | Nein | Neuen Worktree mit dem Branch-Namen anlegen → **REQUIRED SUB-SKILL:** `superpowers:using-git-worktrees` |

Die Wahl dem User in **einem Satz** melden („Branch `feat/lh-42-…` angelegt"), nicht
erfragen. Fremde Arbeit wird dabei nie umbenannt oder überschrieben — im Zweifel neuer
Worktree.

## Schritt 3: Komplexität einschätzen → Routing

Komplexität aus Task-Beschreibung selbst einschätzen und den passenden Skill wählen. Beim
Start in den jeweiligen **Board-Status** wechseln (raus aus `backlog`):

| Komplexität | Skill | Board-Status |
|---|---|---|
| Trivial (Typo, Text/Copy-Change) | Direkt, kein Sub-Skill | `in development` |
| Anforderung unklar | **`/opsx:explore`** zuerst | `scoping` → danach `in design`/`in development` |
| Bug, Ursache unklar | **`superpowers:systematic-debugging`** | `in development` |
| Feature/Bugfix, klare Spec | **`superpowers:test-driven-development`** | `in development` |
| Multi-Step / mehrere Files | **`/opsx:propose`** → ⟨Checkpoint⟩ → **`/opsx:apply`** | `in design` → `ready for development` → `in development` |

**Der Checkpoint in der letzten Zeile ist Pflicht, kein Stilmittel.** `/opsx:propose` trägt
die *planning boundary*: es erzeugt `proposal.md`, Delta-Spec, `design.md` und `tasks.md`
und **hält dann an** — „Do not start implementation in the same response, even if the initial
request asks for it. Wait for a new user request after the artifacts are presented; then
start the apply workflow." Der Stopp ist das erwartete Verhalten und **kein Fehler**: nicht
umgehen, nicht im selben Zug weiterimplementieren. Die Artefakte dem Menschen vorlegen und
auf `in design` stehen bleiben; **erst mit seiner Freigabe** auf `ready for development`, dann
`/opsx:apply` und `in development`. (Dieselbe Reihenfolge wie in `dev-clickup-orchestrieren`,
Phase 2: „nach Plan-Freigabe `ready for development`".)

`/opsx:apply` arbeitet die `tasks.md` ab — die **Art zu arbeiten** bleibt davon unberührt:
Aufgaben mit klarer Spec entstehen weiter per `superpowers:test-driven-development`, und
Schritt 4 gilt unverändert.

Die Planungsartefakte landen in **`openspec/changes/<name>/`**. `docs/superpowers/plans/`
ist eingefrorenes Archiv — dort wird nichts Neues angelegt.

## Schritt 4: Abschluss

- **`superpowers:verification-before-completion`** — vor jeder „fertig"-Aussage
- **`superpowers:requesting-code-review`** vor dem Mergen → **Status: `in review`** (läuft
  danach noch eine Abnahme-/Testrunde → `testing`)
- Commits/PR auf die `custom_id` referenzieren (z.B. `LH-42` im Body)
- Integration → **`superpowers:finishing-a-development-branch`**, **Ziel `alpha`** (PR-Base
  `alpha`, nicht `main`) → nach erfolgreichem Merge **Status: `shipped`**; ist damit nichts
  mehr offen → `done`
- **Stehende Wahl im Integrationsmenü: Option 2 — pushen und PR gegen `alpha` öffnen**
  (Festlegung des Users, 22.09.2026). Das Menü von `finishing-a-development-branch` wird
  **nicht** mehr vorgelegt, sondern diese Wahl direkt ausgeführt; kein lokaler Merge, der
  Worktree bleibt für PR-Feedback stehen. Der Board-Status bleibt bis zum Merge auf
  `in review`, erst der gemergte PR führt auf `shipped`. Abweichen nur, wenn der User im
  laufenden Task ausdrücklich etwas anderes sagt.
- Wird der Task verworfen statt umgesetzt → **Status: `cancelled`**
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
5. **Offene Nachzüge** mit Ticketnummer, falls beim Umsetzen welche entstanden sind.

**Dev-Stack starten** (damit die Meldung nicht ins Leere zeigt): das Frontend ist per
`rust-embed` **zur Compile-Zeit** ins Backend-Binary eingebettet — wer nur `cargo run`
startet, sieht ein **altes** Frontend. Für die Ansicht während der Entwicklung läuft das
Frontend über den **Vite-Dev-Server**, nicht über das eingebettete Bundle:

- Backend (Repo-Root): `cargo run` (Default-Bind `127.0.0.1:8080`; mit Testdaten
  `cargo run --features dev-seeds`).
- Frontend: `mise exec pnpm@11.10.0 -- pnpm -C <absoluter-frontend-pfad> dev` — dann die
  von Vite ausgegebene URL öffnen (Default-Port 5173, aber nicht garantiert:
  `strictPort` ist aus, und ein `pnpm run setup` im Frontend-Ordner vergibt bei parallelen
  Workspaces andere Ports über `.env.local` und nennt dabei auch den passenden
  `cargo run --bind …`-Befehl).

**Wird dieser Skill von `dev-clickup-orchestrieren` aufgerufen, entfällt diese Meldung
hier** — der Orchestrator sammelt Bediensicht/Klickweg je Subtask ein und gibt am Ende
**eine** Gesamtmeldung aus (s. dort, Phase 5).

## Don'ts

- Worktree-/Branch-Logik **nicht** selbst bauen — an `using-git-worktrees` delegieren.
- Einen Branch mit fremder Arbeit **nicht** umbenennen oder zurücksetzen — dann neuer Worktree.
- Komplexität nicht überspringen — auch „kleine" Features brauchen TDD.
- Keinen neuen Task anlegen — das ist `clickup-task-anlegen`.
- Status nicht rückwärts oder redundant setzen — nur vorwärts entlang der Spur.
- Abschlussmeldung **nicht** als Commit-Liste oder mit Dateinamen — Bediensicht und
  Klickweg, nicht Code. Und **nicht** ausgeben, wenn `dev-clickup-orchestrieren` aufruft.
