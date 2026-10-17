# AGENTS.md

Verbindliche Projektregeln für jeden Coding-Agenten. Begründungen, Messwerte und Prüfspuren
stehen in den genannten Herleitungen (`docs/…`, `openspec/…`); hier und in den Bereichsdateien
steht nur, was gilt und wo es getragen wird.

## Wo die Regeln stehen (LFH-556)

Die Regeln liegen bei dem Code, den sie betreffen. **Bevor du eine Datei änderst, lies jede
`AGENTS.md` auf dem Weg von der Wurzel bis zu ihrem Verzeichnis.** Claude Code lädt eine
Bereichsdatei selbst, sobald es eine Datei darunter liest. Pfade ohne Präfix sind im
Frontend relativ zu `frontend/src/`, im Backend relativ zu `src/`.

| Datei | Inhalt |
| --- | --- |
| `frontend/AGENTS.md` | Gestaltungssprache, UI-Form, Bedien-Leitlinie, Erfassung, Deeplinks, Query-Keys, Lint, Browserspeicher |
| `frontend/src/etb/AGENTS.md` | ETB: Zeitachse, Erfassung, Kopfzahl und Modulzähler, Entwurfsspeicher |
| `frontend/src/pages/lagekarte/AGENTS.md` | Lagekarte, Zeichnen und Messen |
| `frontend/src/offline/AGENTS.md` | Lagebild ohne Netz (LFH-723), Schreiben ohne Netz (LFH-705) |
| `frontend/src/auth/AGENTS.md` | Sitzung über mehrere Tabs (LFH-387), Sitzungen beenden (LFH-1092), Client und Server |
| `frontend/src/betreuung/AGENTS.md` | Betreuung und Verpflegung, Client und Server |
| `frontend/src/command-palette/AGENTS.md` | Sprungpalette |
| `frontend/src/druck/AGENTS.md` | Druck (LFH-71/LFH-22) |
| `frontend/src/entwurf/AGENTS.md` | Entwürfe, Lagebericht-Akkordeon |
| `frontend/src/personen/AGENTS.md` | Personen und Sichtung |
| `frontend/src/stab/AGENTS.md` | Stab und Fernmeldewesen: eigenes Modul für Funkplan, Skizze und Kommunikationsplan (S6), Stab-Weiche, Checkliste Arbeitsaufnahme, Presse S5 |
| `frontend/src/lagebesprechung/AGENTS.md` | Lagebesprechung: eigenes Modul, ein Termin mit einem Schreibweg, Vorbereitung, überfälliger Termin, Client und Server |
| `frontend/src/fuehrung/AGENTS.md` | Führungsfunktionen (Katalog, Codespalte, Besetzung), Client und Server |
| `frontend/src/kraefte/AGENTS.md` | Kräfte-Zeitachse (Ereignisse, Perioden, Einsatzdauer), Ablösung (Rangfolge, Vorwarnung, Schichtmodelle), Client und Server |
| `frontend/src/geraet/AGENTS.md` | Gekoppelte Geräte: Hülle, Funktionsansichten, Stellenbindung, Lagemonitor, Client und Server |
| `frontend/e2e/AGENTS.md` | e2e-Suite |
| `docs/anwender/AGENTS.md` | Anwenderdokumentation: Kapitelform, Bilder und Bildlauf, Wächter, Mitänderungsregel, Kapitelpakete, Hilfe in der App |
| `src/AGENTS.md` | Statuscodes, Typ-Codegen, Anhänge, Schutzköpfe, Admin-Schreibwege am Einsatz, Org-Ereignisse, Benachrichtigungen, Demo-Daten, Aufbewahrung, ClamAV |
| `src-tauri/AGENTS.md` | Desktop-Hülle |
| `website/AGENTS.md` | Marketing-Seite (Astro), Kopien aus dem Frontend |
| `scripts/AGENTS.md` | Sammel-Gate im Detail, Werkzeugversionen, Bauziel, Advisories, Release |

- **Eine Regel steht genau einmal**, in der Datei des Bereichs, der sie trägt; eine neue
  Bereichsdatei kommt in diese Tabelle. Diese Datei bleibt unter 200 Zeilen: was nur einen
  Bereich betrifft, gehört nicht hierher.
- **Es gibt keine `CLAUDE.md`.** Claude Code liest `AGENTS.md` ab v2.1.277 direkt (alle
  Sitzungsarten ab v2.1.281), aber nur, solange auf dem Pfad keine `CLAUDE.md`,
  `.claude/CLAUDE.md` oder `CLAUDE.local.md` liegt — eine solche Datei, auch eine lokale,
  verdrängt alle `AGENTS.md`.
- Code-Kommentare verweisen auf Regeln mit Datei und Abschnitt („`src/AGENTS.md`,
  Statuscode-Konvention“). Wer eine Regel verschiebt, greppt die Verweise.

## Bezeichner-Sprache (LFH-1312)

- **Fachbegriffe deutsch, Technik englisch.** Ein Wort, das eine Einsatzkraft so benutzt oder die
  Oberfläche so zeigt, bleibt deutsch (`einsatz`, `lagemeldung`, `kraefte`, `sichtung`,
  `geraetekonto`). Alles, was nur Programmierer sagen, ist englisch: Abläufe (`load`, `fetch`,
  `save`, `create`, `update`, `delete`, `check`, `parse`, `build`, `render`), Wahrheitswerte
  (`is`, `has`, `can`), Strukturwörter (`Props`, `State`, `Hook`, `Handler`, `Repo`, `Error`,
  `List`, `Count`). Also `load_einsatz`, `isGeraetekonto`, `EinsatzKopfProps`, nicht
  `lade_einsatz`, `istGeraetekonto`. Im Zweifel deutsch, wenn die Oberfläche dasselbe Wort zeigt.
  Umlaute werden umschrieben (`kraefte`); Dateinamen folgen den Bezeichnern, die sie tragen.
- **Prosa bleibt deutsch:** Kommentare, Commit-Nachrichten, UI-Texte, Testbeschreibungen (auch
  Rust-Testnamen als Satz), Doku.
- **Grenzwerte bleiben:** Wire-Felder und -Werte, Tabellen und Spalten, Migrationen, generierte
  Typen, gespeicherte Schlüssel, Routen und Ereignisnamen nicht wegen dieser Regel umbenennen,
  auch nicht per `#[serde(rename)]`; dafür braucht es eine eigene Change mit Übergangsweg.
- **Bestand beim Anfassen umstellen, nie in einem Zug:** Neue Bezeichner folgen der Regel sofort.
  Ein bestehender wird umgestellt, wenn der Task Code ändert, der ihn deklariert, und seine
  Verwendungen im Diff liegen oder sich mechanisch mitziehen lassen; eine Namensfamilie in
  derselben Datei (`lade_a`, `lade_b`) zusammen. Die Umbenennung kommt als eigener
  `refactor`-Commit in denselben Branch.
- Die Vorgabe „Bezeichner auf Deutsch“ in älteren Plänen unter `docs/superpowers/plans/` ist
  überholt. Herleitung:
  `openspec/changes/archive/2026-10-11-lfh-1312-bezeichner-sprache/design.md`.

## Zunder (Aufgabenverwaltung)

Seit 12.10.2026 liegen die Aufgaben in **Zunder** (`https://zunder.rubeen.dev`), nicht mehr in
ClickUp. Dieser Abschnitt ist die **eine** Stelle für IDs, Status und Kennungen; die Skills
`zunder-task-anlegen`, `dev-zunder-ausfuehren` und `dev-zunder-orchestrieren` verweisen hierher.

- **Stellen:** Bereich **Lifeline Hub** (`c6748f09-39fb-500e-875b-e0e8a68ad2e6`). Das
  Dev-Projekt **„Dev: Lifeline-Hub“** (`aafceb07-f9e9-5e8b-8ffe-a38afadd7067`, Repo
  `rubenvitt/lifeline-hub`) ist das Entwicklungsboard, das **Feedbackboard**
  (`c28e466d-5525-5777-95c9-5d52bcb4d0f8`) sammelt Feedback. Im Zweifel `list_structure`.
- **Werkzeuge:** Zunder-Connector des claude.ai-Kontos, kein `.mcp.json` im Repo. Skills nennen
  die Werkzeuge ohne Präfix (`update_task`); im lokalen CLI heißen sie
  `mcp__claude_ai_Zunder__…`.
- **Status** (Werkzeuge erwarten und liefern den Code): `open` (Offen) · `in_progress` (In
  Arbeit) · `review` (PR offen) · `blocked` (wartet auf etwas oder jemanden) · `done`
  (Erledigt) · `dropped` (Verworfen). Spur: `open → in_progress → review → done`, nur vorwärts;
  `blocked` und `dropped` sind Seitenzustände. Wann welcher Status gilt, steht in
  `dev-zunder-ausfuehren`, Abschnitt „Board-Status mitführen“. Erledigte und verworfene
  Aufgaben fehlen nach 3 Tagen in `filter_tasks` (`include_closed: true`).
- **Typen:** `aufgabe`, `bug`, `feature`. Keine Tags, Prioritäten, Zuständigen.
- **Kennung einer Aufgabe:** die UUID. Branch `<typ>/<kurz>-<slug>` und Change-Name
  `<kurz>-<slug>`, wobei `<kurz>` die ersten 8 Hex-Zeichen der UUID sind (Beispiel
  `feat/60638201-release-flow`). Commit-Body und PR-Beschreibung tragen die Zeile
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/<uuid>`. Ergebnisse stehen an der Aufgabe in
  `branch`, `pr_url` und `plan`.
- **Alte Kennungen `LFH-<n>`** in Commits, Changes und Doku bleiben gültig und werden nicht
  umgeschrieben. Zunder kennt sie nicht als Feld: die importierte Aufgabe per `search` nach dem
  Titel finden (aus `git log --grep 'LFH-<n>'`); ihr Link lautet
  `https://zunder.rubeen.dev/#/clickup/<clickup_id>`.
- **Kommentare statt Beschreibung bearbeiten:** Zwischenstände, Gründe, offene Fragen und
  Notizen kommen per `add_comment` an die Aufgabe, nie in die `description`. Die Beschreibung
  bleibt der Auftrag und ändert sich nur, wenn sich der Auftrag ändert. Ältere
  `## Notizen`-Abschnitte bleiben stehen.
- **Nie `delete_task`** (nicht rückgängig zu machen) — stattdessen `dropped`.

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
  vorlegen (Aufgabe auf `blocked`), Freigabe abwarten, dann `in_progress` und `/opsx:apply`.
- **Entwurfs-Hoheit** (LFH-589, Spec `entwurfs-hoheit`,
  `openspec/changes/archive/2026-09-30-lfh-589-entwurfs-hoheit-orchestrierung/design.md`):
  Workflows besitzen die Menge (Scope-Scan, Judge-Panel als Zulieferer), OpenSpec den einzelnen
  Task. Eine Change entsteht **genau** auf der Route `entwurf` (E1 Entscheidung · E2 Regel ·
  E3 mehr als ein Subsystem, nicht bei einem Bugfix, der Bestehendes wiederherstellt, oder
  einer reinen Textkorrektur; Liste in
  `dev-zunder-ausfuehren`, Schritt 3), nie bei `trivial`/`klar`/`bug-unklar`. **Kein
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
- Skills und OpenSpec-Befehle liegen nur unter `.claude/`; Codex ist entfernt (LFH-853). Bei
  `openspec init`/`openspec update` nur das Werkzeug Claude Code wählen, keinen `.agents/`-Spiegel.

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
  `Migrationsnummern` im Ruleset 17017911; fehlt er, warnt der Push-Lauf auf `alpha`); Netz
  `db::tests::migrationsnummern_sind_eindeutig`.
- **Autofix nur auf dem PR-Branch** (LFH-1014): ein reiner Nummernkonflikt wird per Bot-Commit
  umgelegt (`scripts/migrationen-autofix.sh`), nie auf `alpha`. Danach vor dem nächsten Push
  den Branch holen. Herleitung:
  `openspec/changes/archive/2026-10-03-lfh-1014-migrationsnummern-autofix/design.md`.
- **Falle: sqlx spielt eine kleinere, noch nicht eingespielte Migration still nach**
  (`db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`).
- **Migrationen entstehen nur über `alpha`**; Freigaben als Merge-Commit, nicht Squash.
  Herleitung: `openspec/changes/archive/2026-09-29-lfh-658-migrationsnummern-vor-dem-merge/design.md`.
