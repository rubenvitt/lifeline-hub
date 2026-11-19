# Superpowers statt OpenSpec — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenSpec verschwindet als Werkzeug, Superpowers ist im Repo als Standard verankert, die Zunder-Spur bleibt.

**Architecture:** Werkzeug raus, Ablage einfrieren: `openspec/` bleibt als Archiv, ein umgebauter Wächter (Schritt 13) hält es eingefroren. Die Skills `dev-zunder-*` führen durch `superpowers:*`; Regeln stehen in Wurzel-`AGENTS.md` und ADR-0069.

**Tech Stack:** Bash-Wächter (`scripts/`), Claude-Code-Settings, Markdown (Skills, `AGENTS.md`, arc42, ADR).

**Spec:** `docs/superpowers/specs/2026-11-18-superpowers-statt-openspec-design.md`

**Zunder:** LLH-1967, `https://zunder.rubeen.dev/#/aufgabe/sv47amf1u9yob6xlk4ic5p3r`

## Global Constraints

- Nichts unter `openspec/changes/archive/` oder `openspec/specs/` ändern oder löschen; kein Verweis auf diese Pfade umschreiben.
- Keine Migration anfassen (`migrations/`).
- Gate-Schritte nicht umnummerieren: Schritt 13 bleibt Schritt 13, Bündel `schnell`.
- Prosa deutsch; Commit-Body mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/sv47amf1u9yob6xlk4ic5p3r`.
- ADR-0013 ist `akzeptiert` und damit unveränderlich bis auf `status`, `ersetzt_durch`, Pfadnachzüge in `gilt_fuer`/Prüfung.
- Neue ADR: `ADR-0069` (nächste freie auf `origin/alpha`; ursprünglich 0065, nach dem Merge von alpha am 19.11.2026 umnummeriert), unter 80 Zeilen.
- Plugin-Eintrag: `superpowers@superpowers-marketplace`, Marktplatz-Quelle GitHub `obra/superpowers-marketplace`.

## Review Focus

- Ein Agent legt aus Gewohnheit wieder `openspec/changes/<name>/` an → Schritt 13 wird rot (Task 1, Fall „neue aktive Change“).
- `check-architektur.sh` stolpert über ADR-0013, weil `gilt_fuer` auf das gelöschte Skript zeigt → Pfadnachzug (Task 4, Verifikation).
- Reste von `/opsx:` in Skills oder Regeln schicken Agenten ins Leere → `git grep` auf `opsx` außerhalb des Archivs ist leer (Task 3/4).
- `mise` verlangt nach dem Entfernen des CLI noch einen Lock-Eintrag → `check-toolversionen` grün (Task 2).
- Freigabe-Halt auf der Route `entwurf` geht beim Umschreiben verloren → Skill nennt Halt mit `blocked` vor `writing-plans` (Task 3).

---

### Task 1: Wächter „OpenSpec bleibt eingefroren“ (Schritt 13)

**Files:**
- Create: `scripts/check-openspec-eingefroren.sh`, `scripts/check-openspec-eingefroren.test.sh`
- Delete: `scripts/check-openspec-archiv.sh`, `scripts/check-openspec-archiv.test.sh`
- Modify: `scripts/check-all.sh` (Kopf Zeile 29, `schritt_13`)
- Move: `openspec/changes/neuigkeiten-versionshinweise/` → `openspec/changes/archive/2026-11-18-neuigkeiten-versionshinweise/`

**Interfaces:**
- Produces: `scripts/check-openspec-eingefroren.sh [<repo-wurzel>]`, Exit 0 grün, 1 rot mit `FEHLER:` und den Fundstellen auf stderr.

Rot ist: ein Verzeichnis unter `openspec/changes/` außer `archive/`; `openspec/config.yaml`; `.claude/commands/opsx/`; ein Verzeichnis `.claude/skills/openspec-*`.

- [x] **Step 1: Selbsttest schreiben** (Muster von `check-openspec-archiv.test.sh`: Miniaturbaum je Fall). Fälle: „nur Archiv und Specs“ gruen · „kein openspec/“ gruen · „neue aktive Change“ rot, Ausgabe nennt `openspec/changes/lfh-9-neu` · „config.yaml zurück“ rot · „opsx-Befehle zurück“ rot, nennt `.claude/commands/opsx` · „openspec-Skill zurück“ rot, nennt `openspec-propose`.
- [x] **Step 2:** `scripts/check-openspec-eingefroren.test.sh` → FAIL (Skript fehlt).
- [x] **Step 3: Wächter schreiben**, Bash 3.2, `set -euo pipefail`, Kopf mit Zweck und Verweis auf Wurzel-`AGENTS.md`, „Planung und Ausführung“, Abhilfe-Zeile „Planung über superpowers:brainstorming/writing-plans, Ablage docs/superpowers/“.
- [x] **Step 4:** Selbsttest → alle `ok`; `scripts/check-openspec-eingefroren.sh` im Repo → rot (laufende Change).
- [x] **Step 5:** `git mv` der Change ins Archiv; Wächter meldet nur noch die Werkzeuge (Task 2). Alte Skripte löschen, `schritt_13` und Kopfzeile 29 auf die neuen Skripte und den Text „OpenSpec bleibt eingefrorenes Archiv (LLH-1967)“.
- [x] **Step 6:** Kopfzeile „fertige OpenSpec-Changes archiviert“ im Bündel `schnell` (Z. 29) mitziehen; Selbsttest grün (Schritt 13 im Repo wird erst mit Task 2 grün).
- [x] **Step 7: Commit** `chore(gate): OpenSpec-Wächter hält das Archiv eingefroren`.

### Task 2: Werkzeug raus, Plugin rein

**Files:**
- Delete: `.claude/skills/openspec-*` (6), `.claude/commands/opsx/`, `openspec/config.yaml`
- Modify: `mise.toml` (Zeilen 34–40, OpenSpec-Block), ggf. `mise.lock`; `.claude/settings.json`

**Interfaces:**
- Produces: `.claude/settings.json` mit `extraKnownMarketplaces.superpowers-marketplace.source = {"source":"github","repo":"obra/superpowers-marketplace"}` und `enabledPlugins["superpowers@superpowers-marketplace"] = true`; bestehende `hooks` bleiben.

- [x] **Step 1:** `scripts/check-openspec-eingefroren.sh` → rot, nennt `.claude/commands/opsx`, `openspec/config.yaml` und die `openspec-*`-Skills (die Werkzeuge liegen noch).
- [x] **Step 2:** Löschen, `mise.toml`-Block entfernen; Wächter → grün.
- [x] **Step 3:** `settings.json` ergänzen; `python3 -m json.tool .claude/settings.json` → gültig.
- [x] **Step 4:** `scripts/check-toolversionen.test.sh && scripts/check-toolversionen.sh` → grün; `./scripts/check-all.sh --nur schnell` → Schritt 13 grün.
- [x] **Step 5: Commit** `chore: OpenSpec-Werkzeug entfernt, Superpowers als Plugin im Repo`.

### Task 3: Zunder-Skills auf Superpowers umhängen

**Files:**
- Modify: `.claude/skills/dev-zunder-ausfuehren/SKILL.md`, `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` (§7, §10), `.claude/skills/dev-zunder-orchestrieren/SKILL.md` (inkl. `description`), `.claude/skills/dev-zunder-orchestrieren/references/workflow-bausteine.md`

Abbildung (aus dem Entwurf, Tabelle „Ablauf je Route“):
- `/opsx:explore` → `superpowers:brainstorming` (klären), danach neu routen.
- `/opsx:propose` → `superpowers:brainstorming` bis zum Design-Doc `docs/superpowers/specs/YYYY-MM-DD-<kurz>-<slug>-design.md`, dann **Halt** (`blocked`, Freigabe), dann `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<kurz>-<slug>.md`, Plan-Pfad ins Zunder-Feld `plan`.
- `/opsx:apply` → `superpowers:subagent-driven-development` oder `superpowers:executing-plans`, jede Aufgabe per TDD.
- `/opsx:update` → Design-Doc bzw. Plan im Main-Loop überarbeiten, erneut vorlegen.
- `/opsx:archive` und Archivschritt in Schritt 4/Phase 5 → entfällt; PR enthält Design-Doc, Plan, Umsetzung.
- „Change“ → „Entwurf“ (Design-Doc + Plan); `openspec/specs/` nur noch als lesbare, eingefrorene Quelle; Scope-Map-Feld `faehigkeiten` → bleibt, Bedeutung: berührte Specs/`AGENTS.md`-Regeln.
- Verbot für Workflows/Subagents: kein Design-Doc und kein Plan unter `docs/superpowers/` schreiben, kein `brainstorming`/`writing-plans` im Workflow.
- Route-`entwurf`-Gründe E1–E3, Zunder-Status-Tabelle, Checkpoints bleiben inhaltlich.

- [x] **Step 1:** `git grep -nE 'opsx|openspec/changes|OpenSpec' -- .claude/` → Trefferliste als Ausgangsstand.
- [x] **Step 2:** Abschnitte umschreiben (Überblick, Agenten-Tabelle, Board-Status, Gemeinsam ausarbeiten, Schritt 3, Schritt 4, Don'ts; Orchestrierung Phasen 1–5, Entwurfs-Hoheit, Checkpoints, Don'ts; Bausteine).
- [x] **Step 3:** `git grep -nE 'opsx|openspec/changes/<|/opsx' -- .claude/` → leer; `git grep -n 'openspec' -- .claude/` zeigt nur Archiv-Verweise (`changes/archive/`, `openspec/specs/`).
- [x] **Step 4: Commit** `docs(skills): Zunder-Skills führen durch Superpowers`.

### Task 4: Regeln, ADR, arc42

**Files:**
- Modify: `AGENTS.md` (Abschnitt Z. 111–155 neu: „Planung und Ausführung — Superpowers (LLH-1967)“; Kopfzeile 4 bleibt), `scripts/AGENTS.md` (Z. 11 Schrittliste, Z. 128–129 CLI-Absatz streichen), `docs/architektur/AGENTS.md` (Mitänderungstabelle „Route `entwurf`“, `herleitung` nennt Design-Doc), `docs/architektur/entscheidungen/VORLAGE.md` (`herleitung`-Beispiel → `docs/superpowers/specs/<datum>-<name>-design.md`), `docs/architektur/01-einfuehrung-und-ziele.md:62`, `docs/architektur/04-loesungsstrategie.md:71`, `docs/architektur/08-querschnittliche-konzepte.md:8`
- Create: `docs/architektur/entscheidungen/ADR-0069-superpowers-traegt-den-aenderungszyklus.md`
- Modify: `docs/architektur/entscheidungen/ADR-0013-…md` (nur `status: ersetzt`, `ersetzt_durch: ADR-0069`, `gilt_fuer`/Prüfung: Skriptpfad auf `scripts/check-openspec-eingefroren.sh`)

ADR-0069 Regeln (Kern):
- MUST: Route `entwurf` → Design-Doc unter `docs/superpowers/specs/`, Plan unter `docs/superpowers/plans/`, Halt vor dem Plan; Ablauf Wurzel-`AGENTS.md`.
- MUST NOT: Neues unter `openspec/` (Archiv; Wächter Schritt 13).
- MUST: Superpowers als Plugin in `.claude/settings.json`.
- Prüfung: `test -x scripts/check-openspec-eingefroren.sh`, `verlange 'check-openspec-eingefroren\.sh' scripts/check-all.sh`, `verlange 'superpowers@superpowers-marketplace' .claude/settings.json`, `test ! -e openspec/config.yaml`.
- `gilt_fuer`: `openspec/**`, `docs/superpowers/**`, `.claude/settings.json`, `scripts/check-openspec-eingefroren.sh`. `herleitung`: der Entwurf.

Neuer `AGENTS.md`-Abschnitt trägt: Superpowers besitzt Zyklus und Disziplin; Routen-Abbildung (Verweis `dev-zunder-ausfuehren`, Schritt 3); Pflicht-Halt nach Design-Doc; Entwurfs-Hoheit (Workflows liefern zu, schreiben nicht unter `docs/superpowers/`); Ablageorte: `docs/superpowers/specs|plans` (lebendig), `openspec/` (eingefroren, lesbar); „Ein Plan allein bekommt keinen PR“ unverändert ohne Archivschritt; Review/Mit-dem-Menschen-Absätze unverändert; Skills nur unter `.claude/`.

- [x] **Step 1:** `scripts/check-architektur.test.sh && scripts/check-architektur.sh` → Ausgangsstand (rot erwartet wegen ADR-0013 `gilt_fuer`, falls Task 1 schon gelöscht hat).
- [x] **Step 2:** ADR-0069 anlegen, ADR-0013 nachziehen, Kapitel und `AGENTS.md`-Dateien ändern.
- [x] **Step 3:** `scripts/check-architektur.sh` → grün; `scripts/adr-fuer.sh .claude/settings.json` nennt ADR-0069.
- [x] **Step 4:** `git grep -nE '/opsx|opsx:' -- . ':!openspec/changes/archive' ':!docs/superpowers'` → leer.
- [x] **Step 5: Commit** `docs: Superpowers trägt den Änderungszyklus (ADR-0069)`.

### Task 5: Abschluss

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (ohne `| tail`).
- [x] **Step 2:** Push, PR gegen `alpha` mit Entwurf, Plan, Umsetzung; Zunder: `pr_url`, `plan`, Status `review`.
