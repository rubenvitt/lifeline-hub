# AGENTS.md

Verbindliche Projektregeln für jeden Coding-Agenten. Begründungen, Messwerte und Prüfspuren
stehen in den genannten Herleitungen (`docs/…`, `openspec/…`); hier und in den Bereichsdateien
steht nur, was gilt und wo es getragen wird.

## Wo die Regeln stehen (LFH-556)

Die Regeln liegen bei dem Code, den sie betreffen. **Bevor du eine Datei änderst, lies jede
`AGENTS.md` auf dem Weg von der Wurzel bis zu ihrem Verzeichnis.** Claude Code lädt eine
Bereichsdatei selbst, sobald es eine Datei darunter liest; Codex lädt nur die Dateien von der
Wurzel bis zum Arbeitsverzeichnis, alles darunter liest du selbst. Pfade ohne Präfix sind im
Frontend relativ zu `frontend/src/`, im Backend relativ zu `src/`.

| Datei | Inhalt |
| --- | --- |
| `frontend/AGENTS.md` | Gestaltungssprache, UI-Form, Bedien-Leitlinie, Erfassung, Deeplinks, Query-Keys, Lint |
| `frontend/src/etb/AGENTS.md` | ETB: Zeitachse, Erfassung, Kopfzahl und Modulzähler, Entwurfsspeicher |
| `frontend/src/pages/lagekarte/AGENTS.md` | Lagekarte, Zeichnen und Messen |
| `frontend/src/offline/AGENTS.md` | Lagebild ohne Netz (LFH-723), Schreiben ohne Netz (LFH-705) |
| `frontend/src/auth/AGENTS.md` | Sitzung über mehrere Tabs, Client und Server (LFH-387) |
| `frontend/src/betreuung/AGENTS.md` | Betreuung und Verpflegung, Client und Server |
| `frontend/src/command-palette/AGENTS.md` | Sprungpalette |
| `frontend/src/druck/AGENTS.md` | Druck (LFH-71/LFH-22) |
| `frontend/src/entwurf/AGENTS.md` | Entwürfe, Lagebericht-Akkordeon |
| `frontend/src/personen/AGENTS.md` | Personen und Sichtung |
| `frontend/src/stab/AGENTS.md` | Stab: Funkplan S6, Checkliste Arbeitsaufnahme, Vorbereitung der Lagebesprechung |
| `frontend/src/fuehrung/AGENTS.md` | Führungsfunktionen (Katalog, Codespalte, Besetzung), Client und Server |
| `frontend/src/kraefte/AGENTS.md` | Kräfte-Zeitachse (Ereignisse, Perioden, Einsatzdauer), Client und Server |
| `frontend/e2e/AGENTS.md` | e2e-Suite |
| `src/AGENTS.md` | Statuscodes, Typ-Codegen, Anhänge, Schutzköpfe, Org-Ereignisse, Demo-Daten, Aufbewahrung, ClamAV |
| `src-tauri/AGENTS.md` | Desktop-Hülle |
| `scripts/AGENTS.md` | Sammel-Gate im Detail, Werkzeugversionen, Bauziel, Advisories, Release |

- **Eine Regel steht genau einmal**, in der Datei des Bereichs, der sie trägt; eine neue
  Bereichsdatei kommt in diese Tabelle. Diese Datei bleibt unter 200 Zeilen: was nur einen
  Bereich betrifft, gehört nicht hierher.
- **Es gibt keine `CLAUDE.md`.** Claude Code liest `AGENTS.md` ab v2.1.277 direkt (alle
  Sitzungsarten ab v2.1.281), aber nur, solange auf dem Pfad keine `CLAUDE.md`,
  `.claude/CLAUDE.md` oder `CLAUDE.local.md` liegt — eine solche Datei, auch eine lokale,
  verdrängt alle `AGENTS.md`. Codex liest je Lauf höchstens 32 KiB (`project_doc_max_bytes`).
- Code-Kommentare verweisen auf Regeln mit Datei und Abschnitt („`src/AGENTS.md`,
  Statuscode-Konvention“). Wer eine Regel verschiebt, greppt die Verweise.

## ClickUp

Dieses Projekt hat ein eigenes ClickUp-Projekt im Space **Lifeline Hub** (`901511065513`,
Workspace/Team `9015920204`). Das **Entwicklungsboard** (`901523554968`) ist das
Task-Board des Projekts, das **Feedbackboard** (`901523554969`) sammelt Feedback.
Tasks werden selbstständig über den ClickUp-Connector des claude.ai-Kontos angelegt — wie und
wann beschreibt der Skill `clickup-task-anlegen`. Das Repo bringt keinen eigenen ClickUp-Server
mit (kein `.mcp.json`): der Connector wirkt lokal wie in Cloud-Sitzungen, ein Projektserver
braucht OAuth je Rechner und scheitert in nicht-interaktiven Sitzungen. Skills nennen die
Werkzeuge ohne Präfix (`clickup_update_task`); der Präfix hängt an der Umgebung
(`mcp__claude_ai_ClickUp__…` im lokalen CLI, `mcp__ClickUp__…` in Cloud-Sitzungen).

## Planung und Ausführung — OpenSpec und Superpowers (LFH-588)

- **OpenSpec** (`/opsx:*`) besitzt den **Änderungszyklus** (klären, entwerfen, Spec und
  Aufgabenschnitt, abarbeiten, archivieren), **Superpowers** (`superpowers:*`) die
  **Arbeitsdisziplin** (Worktree, Debugging, TDD, Verifikation, Review, Branch-Abschluss).
  OpenSpec löst Superpowers nicht ab.
- `explore`, `propose`, `update`, `sync`, `archive` fassen keinen Projektcode an;
  **`/opsx:apply` setzt um**. Dispatches: `superpowers:brainstorming` → `/opsx:explore`,
  `superpowers:writing-plans` → `/opsx:propose`, `superpowers:executing-plans` → `/opsx:apply`.
  Bei Superpowers bleiben `using-git-worktrees`, `systematic-debugging`,
  `test-driven-development`, `verification-before-completion`, `requesting-code-review`,
  `finishing-a-development-branch`.
- **`/opsx:apply` bringt keine Disziplin mit:** jede Aufgabe per `test-driven-development`, vor
  jedem „fertig" `verification-before-completion` und `requesting-code-review`.
- **Pflicht-Checkpoint:** `/opsx:propose` hält nach den Artefakten an (kein Fehlschlag) —
  vorlegen, Freigabe abwarten, dann `ready for development` und `/opsx:apply`.
- **Entwurfs-Hoheit** (LFH-589, Spec `entwurfs-hoheit`,
  `openspec/changes/archive/2026-09-30-lfh-589-entwurfs-hoheit-orchestrierung/design.md`):
  Workflows besitzen die Menge (Scope-Scan, Judge-Panel als Zulieferer), OpenSpec den einzelnen
  Task. Eine Change entsteht **genau** auf der Route `entwurf` (E1 Entscheidung · E2 Regel ·
  E3 mehr als ein Subsystem, nicht bei einem Bugfix, der Bestehendes wiederherstellt, oder
  einer reinen Textkorrektur; Liste in
  `dev-clickup-ausfuehren`, Schritt 3), nie bei `trivial`/`klar`/`bug-unklar`. **Kein
  Workflow ruft `/opsx:*` oder schreibt unter `openspec/changes/`.**
- **Vier Ablageorte, keine Überschneidung:** `openspec/changes/<name>/` (laufende Änderung, hier
  landet Neues) · `openspec/changes/archive/` (nach `/opsx:archive`) · `openspec/specs/`
  (Fähigkeits-Specs, SHALL/MUST, über `/opsx:sync`/`/opsx:archive`) · `docs/superpowers/`
  (Herleitungen und Messprotokolle, **eingefrorenes Archiv**, wird nicht nach OpenSpec migriert).
  Wer dort etwas verschiebt, greppt zuerst die Verweise (sie brechen still).
- **Archiviert wird vor dem Merge, im selben Branch** (Entscheidung 30.09.2026): ist die
  `tasks.md` abgehakt, `/opsx:archive` samt Spec-Sync und Verweisen, dann erst der PR — kein
  Archiv-PR danach. Wächter: `scripts/check-openspec-archiv.sh` (Schritt 13 von `check-all.sh`,
  Bündel `schnell`) macht eine aktive Change ohne offenes Kästchen rot.
- **Ein Plan allein bekommt keinen PR** (Entscheidung 30.09.2026), außer der Mensch wünscht es
  ausdrücklich. Ablauf in EINEM Branch: Plan (`/opsx:propose`) → Commit → Freigabe →
  `/opsx:apply` → `/opsx:archive` → erst dann der PR, mit Plan, Umsetzung und Archiv zusammen.
  Den Branch zu pushen, um den Stand zu sichern, ist erlaubt; der PR wartet auf die Umsetzung —
  auch wenn die Umgebung (etwa eine Cloud-Sitzung) nach jedem Push einen PR verlangt.
- In Codex heißen die OpenSpec-Befehle `$openspec-propose`, `$openspec-apply-change` usw.
  (`.agents/skills/`, erzeugt von `openspec`); Claude Code liest nur `.claude/`.

## Qualitäts-Gates — ein Kommando (LFH-235/F17)

`./scripts/check-all.sh` vor dem Merge (Schritte und Bündel im Skriptkopf, Mechanik in
`scripts/AGENTS.md`).
- **Das Skript ist die Wahrheit**; `.github/workflows/ci.yml` ruft es unverändert. Neue Schritte
  gehören ins Skript.
- **Ein rot geborenes Gate wird abgeschaltet statt befolgt** — erst sweepen, dann scharf schalten
  (deshalb nicht im Gate: `cargo clippy -D warnings`).
- **Kein `| tail` um Gate-Kommandos.** Testgüte belegen Mutationsproben, nicht Abdeckung.
- Node und pnpm kommen nur aus `[tools]` von `mise.toml` (`mise exec -- …`, LFH-773); jeder
  Checkout baut in sein eigenes `target/` (LFH-520). Einzelheiten: `scripts/AGENTS.md`.
- Prettier prüft ganz `frontend/`, auch die `AGENTS.md` dort; rustfmt das Backend
  (`scripts/check-fmt.sh`).
- Nach jeder Response-DTO-/Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten
  Dateien mitcommitten (LFH-120, `src/AGENTS.md`).

## Backend — Migrationsvergabe (LFH-658)

- **Anhängen, nicht einschieben:** neue Migrationen tragen eine Nummer **größer als jede auf dem
  Ziel-Branch**; bestehende werden nie geändert, umbenannt oder gelöscht.
- `scripts/check-migrationen.sh` (gegen `origin/alpha`, vorher `git fetch`), Umlegen mit
  `--umnummerieren`. Durchgesetzt über `.github/workflows/migrationen.yml` (Required Check
  `Migrationsnummern`); Netz `db::tests::migrationsnummern_sind_eindeutig`.
- **Falle: sqlx spielt eine kleinere, noch nicht eingespielte Migration still nach**
  (`db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`).
- **Migrationen entstehen nur über `alpha`**; Freigaben als Merge-Commit, nicht Squash.
  Herleitung: `openspec/changes/archive/2026-09-29-lfh-658-migrationsnummern-vor-dem-merge/design.md`.
