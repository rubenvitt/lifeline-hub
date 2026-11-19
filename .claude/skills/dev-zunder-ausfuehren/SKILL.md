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

**Eine Quelle für Zyklus und Disziplin: Superpowers** (`superpowers:*`, seit 18.11.2026,
LLH-1967, ADR-0065). Es besitzt den **Änderungszyklus** — klären (`brainstorming`), entwerfen
(Design-Doc aus `brainstorming`), Aufgabenschnitt (`writing-plans`), abarbeiten
(`subagent-driven-development` oder `executing-plans`) — und die **Arbeitsdisziplin** —
Worktree, Debugging, TDD, Verifikation, Review, Branch-Abschluss. Dieser Skill legt die
Zunder-Spur darüber. OpenSpec (`openspec/`) ist eingefrorenes Archiv: lesen ja, nichts Neues
anlegen (Wächter: Schritt 13 von `check-all.sh`).

`brainstorming` und `writing-plans` fassen keinen Projektcode an. Umgesetzt wird erst mit
`subagent-driven-development` oder `executing-plans`, und dort jede Aufgabe per
`superpowers:test-driven-development`; vor „fertig" stehen unverändert Schritt 4 unten.

## Wann benutzen

- User nennt einen konkreten Task (Zunder-Link `…/#/aufgabe/<id>`, ID, Kennung `LLH-<n>`, Titel
  oder eine alte Kennung `LFH-<n>`)
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
| Ein Review, wenn der Diff einen Anlass aus „Review nach Ermessen“ trifft | Route `trivial` |
| Ursachensuche über viel unbekannten Code (`bug-unklar`) | Alles Interaktive: Checkpoint, Rückfrage, Freigabe |
| Unabhängige Subtasks im autonomen Modus (`dev-zunder-orchestrieren`, Phase 3) | `brainstorming`, `writing-plans`, TDD-Zyklus des Main-Loops |
| Gegenlesen eines Entwurfs | Ein Review ohne Anlass aus „Review nach Ermessen“ |

**Agent oder Workflow:** Für einen bis drei unabhängige Jobs das Agent-Tool (kein Skript,
gleich im Hintergrund). Ein Workflow, wenn es mehrstufig wird (finden → verifizieren) oder mehr
als drei Agents braucht; Skelette in `dev-zunder-orchestrieren/references/workflow-bausteine.md`.
Der Größenrichtwert der Umgebung für Workflows gilt weiter.

**Jeder Worker-Prompt bringt mit**, denn Worker sehen weder Systemprompt noch Skill:

- Keine `mcp__hearthbot__`-Tools: nur der Main-Loop spricht mit dem Menschen.
- Kein `brainstorming`, kein `writing-plans`, kein Design-Doc und kein Plan unter
  `docs/superpowers/` anlegen oder ändern (Ausnahme: der autonome Dev-Agent hakt Aufgaben eines
  freigegebenen Plans ab). Nichts unter `openspec/` anlegen.
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
| Route gewählt (Schritt 3) | — | `plan`: Route, bei `entwurf` der Pfad des Design-Docs |
| Lösungsweg liegt zur Abstimmung vor („Gemeinsam ausarbeiten“) | `blocked` | Kommentar: was zur Entscheidung steht |
| Mensch stimmt dem Lösungsweg zu | `in_progress` | `plan`: der abgestimmte Weg |
| Design-Doc liegt zur Freigabe vor (Route `entwurf`) | `blocked` | `plan`: „Entwurf `<pfad>` wartet auf Freigabe“ |
| Freigabe erteilt, `writing-plans` beginnt | `in_progress` | `plan`: Pfad des Plans, sobald er steht |
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

`get_task` des Zunder-Connectors mit der ID (aus dem Link `…/#/aufgabe/<id>`) oder der Kennung
`LLH-<n>`. Bei einem
Titel oder einer alten Kennung `LFH-<n>` erst per `search` die Aufgabe finden (Verfahren in
`AGENTS.md`, Abschnitt „Zunder“). Daraus ziehen:

- **`id`** — für Zunder-Link und Commit-Referenz; **`<kurz>`** = die ersten 8 Zeichen der ID,
  für Branch-Namen und die Dateinamen von Design-Doc und Plan
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

Branch-Name bilden: **`<typ>/<kurz>-<slug>`**, `<kurz>` = erste 8 Zeichen der ID, Slug
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

## Gemeinsam ausarbeiten, bevor Code entsteht

**Festlegung des Users vom 08.11.2026: „vor Implementierung gern mit mir gemeinsam
ausarbeiten“.** Auf jeder Route außer `trivial` legst du den Lösungsweg dem Menschen vor,
**bevor die erste Zeile Projektcode entsteht**, und baust erst nach seiner Antwort. Nicht allein
nach eigener Empfehlung losbauen, auch wenn der Weg klar scheint.

- **Was vorher ohne Halt läuft:** lesen, Scope klären, reproduzieren, messen, die Ursache eines
  Bugs suchen. Das ist Vorarbeit für den Entwurf, kein Bauen.
- **Was du vorlegst, kurz:** was sich aus Bediensicht ändert, die Varianten mit Empfehlung und
  Begründung, die offenen Fragen. Fragen mit konkreten Optionen stellen, nicht offen, und
  gesammelt statt einzeln nacheinander. Bei `bug-unklar` kommt die gefundene Ursache dazu.
- **Währenddessen** steht der Task auf `blocked` (Tabelle „Board-Status mitführen“). Erst mit
  der Zustimmung zurück auf `in_progress`, der abgestimmte Weg kommt in `plan`. Eine Rückfrage
  oder ein anderer Wunsch lässt ihn auf `blocked`, bis ihr euch einig seid.
- **Route `entwurf`:** Die Abstimmung **ist** das Gespräch in `superpowers:brainstorming`; das
  Design-Doc hält den gemeinsamen Weg fest. Der Freigabe-Checkpoint danach bleibt Pflicht.
- **Ändert sich der Weg beim Bauen** (neue Variante, verworfene Annahme, größerer Schnitt),
  wieder vorlegen, bevor du ihn verlässt. Kleinigkeiten innerhalb des abgestimmten Wegs nicht.
- **Ruft `dev-zunder-orchestrieren` auf,** zählt dessen Phase-1-Checkpoint als diese
  Abstimmung, sofern dort der Weg je Task vorlag. Kein zweiter Halt je Subtask, außer bei
  `bug-unklar`: Die Ursache findet erst Phase 3, also legst du Ursache und Fix nach der Suche
  erneut vor, bevor der Fix entsteht.

## Schritt 3: Komplexität einschätzen → Routing

Komplexität aus Task-Beschreibung selbst einschätzen und den passenden Skill wählen. Der Task
steht dabei auf `in_progress`; die Route kommt in `plan` (Tabelle „Board-Status mitführen“). Die
Spalte „Route“ ist der Schlüssel, den auch die Scope-Map von `dev-zunder-orchestrieren` führt
(`route`):

| Route | Komplexität | Skill |
|---|---|---|
| `trivial` | Trivial (Typo, Text/Copy-Change) | Direkt, kein Sub-Skill |
| `unklar` | Anforderung unklar | **`superpowers:brainstorming`** zum Klären, danach neu routen |
| `bug-unklar` | Bug, Ursache unklar | **`superpowers:systematic-debugging`** |
| `klar` | Feature/Bugfix, klare Spec | **`superpowers:test-driven-development`** |
| `entwurf` | Entwurf nötig (E1–E3, s. u.) | **`superpowers:brainstorming`** → Design-Doc → ⟨Checkpoint, `blocked`⟩ → **`superpowers:writing-plans`** → **`superpowers:subagent-driven-development`** oder **`superpowers:executing-plans`** |

Vor TDD, Fix oder Design-Doc steht auf allen Routen außer `trivial` die Abstimmung aus
„Gemeinsam ausarbeiten, bevor Code entsteht“.

**Wann ein Entwurf (Design-Doc und Plan) entsteht — genau auf der Route `entwurf`** (LFH-589,
Spec `entwurfs-hoheit`, im Archiv). Die Route `entwurf` gilt, sobald **mindestens einer** dieser Gründe
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

Auf den Routen `trivial`, `bug-unklar` und `klar` entsteht **ausdrücklich kein** Design-Doc und
kein Plan. Das gilt auch, wenn mehrere Dateien berührt sind. `unklar` entscheidet noch nichts:
erst `brainstorming` klärt, danach neu routen. Führt `bug-unklar` nach dem Finden der Ursache auf
E1 oder E2, wechselt der Task auf `entwurf`. Dann `brainstorming` im Main-Loop bis zum Design-Doc,
und der Freigabe-Checkpoint gilt wie auf jeder Route `entwurf`: `writing-plans` erst nach
Freigabe.

**Aufruf durch `dev-zunder-orchestrieren`:** Dann schätzt dieser Skill die Route **nicht**
selbst. Es gilt die am Phase-1-Checkpoint bestätigte `route` der Scope-Map. Liegt für den Task
schon ein in Phase 2 freigegebenes Design-Doc vor, steigt er direkt bei `writing-plans` ein
(oder, steht der Plan schon, bei der Umsetzung), ohne zweites `brainstorming`. Ein in Phase 1
geklärter `unklar`-Task bekommt kein zweites `brainstorming`. Einzige Ausnahme ist der Wechsel
`bug-unklar` → `entwurf` oben.

**Der Checkpoint auf der Route `entwurf` ist Pflicht, kein Stilmittel.** `brainstorming` trägt
ihn selbst (HARD-GATE: nichts wird gebaut, bevor der Mensch das Design-Doc freigibt). Das
Design-Doc dem Menschen vorlegen, der Task steht dabei auf `blocked`; **erst mit seiner Freigabe**
zurück auf `in_progress` und `writing-plans`. Nicht umgehen, nicht im selben Zug weiterbauen.
(Dieselbe Reihenfolge wie in `dev-zunder-orchestrieren`, Phase 2. Dort werden mehrere
Design-Docs eines Laufs gesammelt vorgelegt, aber auch dann gilt: kein Workflow schreibt sie.)

**Projektregeln gehen den Superpowers-Skills vor** (deren eigene Regel: Anweisungen aus
`AGENTS.md` haben Vorrang). Für die Umsetzung heißt das: Standard ist `executing-plans`
(Main-Loop setzt selbst um); `subagent-driven-development` nur, wenn der Mensch es wählt oder
der Plan so lang ist, dass späte Aufgaben auf verdichtetem Kontext liefen. In beiden Fällen ist
der Abschlussreview des Skills der Review aus „Review nach Ermessen“: er läuft nur bei einem
Anlass von dort, als ein Agent mit `references/review-pruefliste.md`; ohne Anlass genügt die
Selbstprüfung des Skills, im Ledger vermerkt. Unter `subagent-driven-development` entfallen die
Reviewer je Aufgabe (keine Gegenprüfer), und jeder Implementer-Prompt trägt die Pflichtpunkte aus
„Agenten nach Bedarf“.

Den Plan legt `writing-plans` dem Menschen mit der Frage nach der Ausführungsart vor
(`subagent-driven-development` oder `executing-plans`); das ist kein zweiter Freigabe-Halt für
den Weg, nur die Wahl der Art. Die **Art zu arbeiten** bleibt: jede Aufgabe per
`superpowers:test-driven-development`, und Schritt 4 gilt unverändert.

**Ablage:** Design-Docs unter `docs/superpowers/specs/YYYY-MM-DD-<kurz>-<slug>-design.md`, Pläne
unter `docs/superpowers/plans/YYYY-MM-DD-<kurz>-<slug>.md` (`<kurz>` wie im Branch-Namen,
`AGENTS.md`, „Zunder“). Beide werden committet und bleiben liegen; einen Archivschritt gibt es
nicht. Neue verbindliche Regeln stehen in der Bereichs-`AGENTS.md` oder einer ADR, nicht in
`openspec/specs/` (eingefroren).

## Schritt 4: Abschluss

- **`superpowers:verification-before-completion`** — vor jeder „fertig"-Aussage
- **Review nach Ermessen** (Abschnitt unten): prüfen, ob der Diff einen Anlass trifft; wenn ja,
  den Review selbst starten, er darf parallel zu den Gates laufen
- Gates, CI und Merge abwarten nach „Warten ohne Wecken“ (Abschnitt unten)
- **Route `entwurf`: Plan vollständig abgehakt, bevor der PR entsteht.** Design-Doc, Plan und
  Umsetzung gehen zusammen in einen PR. Kästchen wie „`check-all.sh` grün“ belegt der lokale Lauf
  `./scripts/check-all.sh --geaendert --ohne-e2e` (unten); was erst die CI des PRs zeigt, wird mit
  Verweis auf diesen Lauf abgehakt, nicht offen gelassen.
- **Bilder der Änderung** in PR-Beschreibung und Meldung an den Menschen (Abschnitt „Bilder der
  Änderung“ unten)
- Commit-Body und PR-Beschreibung tragen die Zeile
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>` (Konvention: `AGENTS.md`, Abschnitt „Zunder“)
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
- **Vor dem PR lokal testen** (LLH-1889, Regel: `scripts/AGENTS.md`, „Leichte PR-Prüfung“): Im PR
  prüft die CI nur leicht (Schnellprüfungen, Migrations- und ADR-Nummern), die Suiten
  laufen erst auf `alpha`. Deshalb fährst du vor dem PR `./scripts/check-all.sh --geaendert
  --ohne-e2e` (die Suiten, die dein Diff berührt, ohne e2e) und nennst das Ergebnis im PR unter
  „Geprüft“. Das Label `voll` (alle Suiten im PR, ohne Pflicht) setzt du nur nach den Kriterien
  in `scripts/AGENTS.md`, „Leichte PR-Prüfung“, „Wann `voll`“: selten, nicht weil eine Änderung
  riskant scheint. Das frühere Label `e2e` bedeutet nichts mehr. Ist ein Lauf auf `alpha` rot und willst
  du einen Job neu starten, nur am jüngsten Lauf: der Neustart eines älteren bricht die Tests des
  jüngeren ab.
- **Mit `alpha` zusammen bauen** (seit LLH-1899 kein Pflicht-Check mehr): Liegt dein PR länger
  offen und wurde inzwischen viel gemergt, `alpha` in den Branch mergen (kein Rebase) und
  `./scripts/check-all.sh --nur baut` fahren, bevor Auto-Merge an geht. Kompiliert es zusammen
  nicht, wird sonst `alpha` rot.
- Wird der Task verworfen statt umgesetzt → **Status: `dropped`**, `release_task`
- Danach: **Abschlussmeldung an den Menschen** (s. u.) — letzter Schritt, nach Merge und
  Board-Status.

## alpha rot: wenn der Stau-Wächter weckt (LLH-1849)

Schlägt die CI auf `alpha` fehl, schreibt der Stau-Wächter an jeden offenen PR gegen `alpha` einen
Hinweis (Marke `stau-waechter-alpha`). Er bestimmt **höchstens einen** Zuständigen, damit nicht mehrere
Sitzungen denselben Fix bauen: Am 12.11.2026 waren es vier, und ihre Varianten kollidierten danach
in jedem PR. Mechanik: `scripts/AGENTS.md`, „Stau-Wächter“.

- **Dein PR ist zuständig** (Hinweis „dieser PR ist zuständig“): Erst prüfen, ob der Fehler im
  Code liegt. Ist es ein Ausfall oder ein wackliger Test, den fehlgeschlagenen Job neu starten;
  ein grüner Lauf beendet den Befund. Sonst **sofort** einen eigenen Branch von `alpha` anlegen
  und einen PR gegen `alpha` mit dem Label **`alpha-rot`** öffnen, als Entwurf genügt, noch vor
  dem Fix. Das Label belegt den Fix: der Wächter und die übrigen PRs erkennen ihn daran, und der
  Auftrag wandert nicht nach einer Stunde weiter, während du auf die Antwort des Menschen
  wartest (Entscheidung 12.11.2026). Dann den Fix in diesem PR bauen, nicht im eigenen. Er stellt
  Bestehendes wieder her: Route `bug-unklar` bzw. `klar`, kein Entwurf. Die Abstimmung aus
  „Gemeinsam ausarbeiten“ gilt auch hier; leg Ursache und Fix knapp in einer Nachricht vor, weil
  alle PRs warten.
- **Dein Auftrag ist weitergewandert** (der Hinweis zeigt jetzt „`alpha` ist rot“): Hast du den
  Label-PR noch nicht geöffnet, hörst du auf; ein anderer PR baut den Fix.
- **Dein PR wartet** (Hinweis „`alpha` ist rot“): den Bruch **nicht** im eigenen PR reparieren,
  auch wenn deine CI deswegen rot ist. Weiterarbeiten an der eigenen Aufgabe geht. Ist `alpha`
  wieder grün, mergt der Wächter `alpha` in deinen PR, falls dessen CI rot ist; danach vor dem
  nächsten Push den Branch holen.
- **Dein PR ist doppelt** (du hast selbst einen Fix mit `alpha-rot` geöffnet, ein älterer
  existiert): deinen PR schließen, oder das Label entfernen, wenn er etwas anderes repariert.

## Review nach Ermessen

**Festlegung des Users vom 17.11.2026:** kein Pflicht-Review vor jedem PR, aber auch keiner auf
Zuruf. Du entscheidest nach dem Diff, ob einer nötig ist, und startest ihn dann selbst, ohne zu
fragen (Spec `review-vor-dem-pr`, Herleitung:
`openspec/changes/archive/2026-11-17-review-vor-dem-pr-ausbauen/proposal.md`).

**Nötig**, wenn der Diff mindestens eins davon trifft:

- Berechtigung, Org-Isolation oder Geltungsbereich (wer darf was sehen oder ändern)
- Eingaben von außen: öffentliche API v1, Instanzkopplung, gekoppelte Geräte, Importe
- Daten können still verloren gehen oder halb geschrieben werden: Migration, Löschen,
  Zusammenführen, mehrere Schreibvorgänge ohne gemeinsame Transaktion
- Schreiben ohne Netz, Sitzung und Anmeldung, Live-Verteilung
- Größe: über etwa 600 geänderte Codezeilen (ohne Erzeugtes, Lockfiles, Bilder, Doku), oder
  Backend und Frontend zugleich mit neuer oder geänderter Schnittstelle

**Nicht nötig:** Doku, Anleitungen und Specs; reine Darstellung, Layout und Texte; eine kleine
Änderung, deren Verhalten die neuen Tests vollständig festhalten; Route `trivial`.

**Form:** ein Agent (Agent-Tool) mit frischem Kontext, nie der Main-Loop selbst, kein Workflow,
keine Gegenprüfer. Er bekommt nicht, warum der Code so gebaut wurde, sondern: Diff
`git diff origin/alpha...HEAD`, die geltenden `AGENTS.md`, die zutreffenden Klassen aus
`references/review-pruefliste.md`, auf der Route `entwurf` Design-Doc und Plan, dazu die Pflichtpunkte
jedes Worker-Prompts (Abschnitt „Agenten nach Bedarf“). Er liefert je Befund Datei, Zeile und den
konkreten Fall und ändert nichts. Jeden Befund prüfst du selbst kurz an der Stelle; bestätigte
behebst du mit eigenem Commit, mehrere vertretbare Auswege mit Wirkung für Anwender gehen an den
Menschen, ein Fehler außerhalb des Diffs wird eine Aufgabe (`zunder-task-anlegen`).

**Nachweis:** im PR unter „Geprüft“ eine Zeile: Review gelaufen (Anlass, Befunde und Verbleib)
oder nicht nötig (warum).

## Warten ohne Wecken

**Festlegung des Users vom 17.11.2026.** Jede Runde liest den ganzen Kontext neu; in einer langen
Sitzung (400.000 bis 800.000 Tokens) kostet schon ein „ich warte“ 0,10 bis 0,60 $, das Wecken
nach mehr als einer Stunde Pause 3 bis 8 $. Geweckt wird, wenn etwas zu tun ist, nicht um
nachzusehen.

- **Gates in einem Aufruf.** `check-all.sh` läuft als ein Bash-Aufruf: im Vordergrund, wenn er
  ins Zeitlimit passt, sonst einmal mit `run_in_background`, und du wartest auf die eine
  Abschlussmeldung. Mehrere Bündel oder Portionen (etwa die Rust-Suite wegen des
  Plattenkontingents) laufen hintereinander im selben Aufruf, nicht je Portion ein eigener.
- **Kein Nachsehen:** kein Monitor, der Zwischenstände meldet, keine Abfrage-Schleife, kein
  Wecker (`send_later`, `ScheduleWakeup`) als Rückfallnetz, solange das PR-Abo Ereignisse
  liefert — auch wenn die Umgebung einen verlangt.
- **Eine Meldung, die nichts verlangt** (Vorschau gebaut, Check läuft noch, Bot-Kommentar ohne
  Befund): ohne Werkzeugaufruf und mit höchstens einem Satz beenden.
- **Das PR-Abo bleibt** bis zum Merge: Konflikte und Hinweise des Stau-Wächters sollen die
  Sitzung erreichen. **Weckt der Merge sie:** `done` setzen, falls noch reserviert
  `release_task`, dann die Abschlussmeldung. Keine erneuten Gates, keine CI-Abfrage, kein
  weiterer Schritt.

## Bilder der Änderung

**Festlegung des Users vom 08.11.2026: „am Ende Screenshots, damit ich verstehe, was gemacht
wurde“.** Jede Entwicklung endet mit Bildern der geänderten Stellen, und zwar an zwei Orten:
im PR (Abschnitt „Bilder“ der Vorlage) und in der Meldung an den Menschen, sobald der PR offen
ist. Die Abschlussmeldung nach dem Merge zeigt dann keine neuen Bilder mehr, außer der PR hat
die sichtbare Wirkung seither geändert.

- **Was:** jede sichtbar geänderte Stelle im echten Zustand, mit den Daten, an denen der
  Unterschied auffällt. Vorher und nachher nebeneinander, wo sich Bestehendes ändert. Weitere
  Zustände (leer, Fehler, Druck, schmal) nur, wenn die Änderung sie betrifft.
- **Ohne sichtbare Wirkung** (reines Backend, Tests, Gates, Anleitungen): kein Ersatzbild,
  sondern ein Satz, warum es keins gibt.
- **Aufnehmen** per Wegwerf-Spec im Bildlauf, die nie committet wird:
  `frontend/e2e/doku-bilder/zz-<kurz>.bilder.ts` mit den Helfern aus `kern.ts`
  (`anmelden`, `uhrAnhalten`, `demoEinsatz`, `fuelle`), aber `page.screenshot`/
  `locator.screenshot` mit Pfad **außerhalb** von `docs/anwender/bilder/`. Lauf in `frontend/`:
  `mise exec -- pnpm exec playwright test -c playwright.doku.config.ts e2e/doku-bilder/zz-<kurz>.bilder.ts`.
  Der Lauf startet das Backend-Binary, baut es aber nicht: vorher `cargo build` im
  Repo-Wurzelverzeichnis auf dem Stand des Branches, sonst zeigen die Bilder ein altes Backend
  (bei gesetztem `PW_BINAER` muss dieses Binary zum Stand passen). Die Demo-Daten sind dort
  schon eingespielt. Für Druckansichten
  `page.emulateMedia({ media: 'print' })`, sonst verdecken Kopfleiste und Devtools-Knopf das Bild.
  Danach die Spec löschen.
- **Im PR:** GitHub nimmt Bilder nicht per API an. Deshalb die Bilder in einem eigenen Commit
  unter `pr-bilder/<kurz>/` pushen, in der Beschreibung mit
  `https://github.com/<owner>/<repo>/blob/<sha>/pr-bilder/<kurz>/<name>.png?raw=true` (SHA
  dieses Commits) einbinden und im nächsten Commit wieder entfernen.
- **In der Meldung:** die Bilder als Dateien mitschicken, nicht nur verlinken.

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
- Keine Agents für Interaktives, `brainstorming`/`writing-plans` oder Triviales, und kein Worker-Prompt ohne die
  Pflichtpunkte aus „Agenten nach Bedarf“.
- Keinen Review ohne Anlass aus „Review nach Ermessen“, keinen Review-Workflow, keine
  Gegenprüfer-Agenten; den Review nicht selbst im Main-Loop machen.
- Nicht wecken lassen, um nachzusehen („Warten ohne Wecken“).
- Keinen neuen Task anlegen — das ist `zunder-task-anlegen`.
- Nicht an einer Aufgabe arbeiten, die ein anderer Agent per `claim_task` hält.
- Status nicht rückwärts oder redundant setzen — nur vorwärts entlang der Spur.
- Abschlussmeldung **nicht** als Commit-Liste oder mit Dateinamen — Bediensicht und
  Klickweg, nicht Code. Und **nicht** ausgeben, wenn `dev-zunder-orchestrieren` aufruft.
