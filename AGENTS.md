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
| `frontend/src/entwurf/AGENTS.md` | Entwürfe, gegliederte Dokumente (`DokumentEntwurf`) |
| `frontend/src/personen/AGENTS.md` | Personen und Sichtung |
| `frontend/src/fernmeldewesen/AGENTS.md` | Fernmeldewesen: Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan (S6), Einsatzleiter |
| `frontend/src/infotelefon/AGENTS.md` | Informationstelefon: eigenes Modul, Fenster und Zählung, Funkprotokoll-Ordnung, Handschirm |
| `frontend/src/lagebesprechung/AGENTS.md` | Lagebesprechung: eigenes Modul, ein Termin mit einem Schreibweg, Vorbereitung, überfälliger Termin, Client und Server |
| `frontend/src/fuehrung/AGENTS.md` | Führungsfunktionen (Katalog, Codespalte, Besetzung), Client und Server |
| `frontend/src/kraefte/AGENTS.md` | Kräfte-Zeitachse (Ereignisse, Perioden, Einsatzdauer), Ablösung (Rangfolge, Vorwarnung, Schichtmodelle), Client und Server |
| `frontend/src/geraet/AGENTS.md` | Gekoppelte Geräte: Hülle, Funktionsansichten, Stellenbindung, Lagemonitor, Client und Server |
| `frontend/e2e/AGENTS.md` | e2e-Suite |
| `docs/architektur/AGENTS.md` | Architekturdokumentation (arc42): Kapitel, Mitänderungsregel, Entscheidungen (ADRs), ihre Nummern und Prüfungen |
| `docs/anwender/AGENTS.md` | Anwenderdokumentation: Kapitelform, Bilder und Bildlauf, Wächter, Mitänderungsregel, Kapitelpakete, Hilfe in der App |
| `src/AGENTS.md` | Statuscodes, Typ-Codegen, öffentliche API v1, Adapter (Geheimnisse, Abrufe), Anhänge, Schutzköpfe, Instanzkopplung, Admin-Schreibwege am Einsatz, Org-Ereignisse, ETB live verteilen, Präsenz, Benachrichtigungen, iOS-Push, Demo-Daten, Aufbewahrung, ClamAV |
| `migrations/AGENTS.md` | Migrationsvergabe (Nummern, Autofix, Stau-Wächter), Tabellenumbau und `-- no-transaction` |
| `src-tauri/AGENTS.md` | Desktop-Hülle |
| `ios/AGENTS.md` | iOS-Hülle: keine Anwendungslogik, Logik im Kern, Brücke nur für den aktiven Server, gemeinsame Fälle, Push über APNs, Bauen nur auf macOS |
| `website/AGENTS.md` | Marketing-Seite (Astro), Kopien aus dem Frontend |
| `push-relais/AGENTS.md` | APNs-Relais: keine Inhalte, nie Token/Nutzlast loggen, Wire deutsch und additiv, Sperren nur per Unterbefehl, APNs-Doppel in Tests |
| `scripts/AGENTS.md` | Sammel-Gate im Detail, Stau-Wächter, Werkzeugversionen, Bauziel, Advisories, Release |

- **Vor einer Änderung `scripts/adr-fuer.sh <pfad>…`**: nennt die Architekturentscheidungen
  (`docs/architektur/entscheidungen/`), die für die Dateien gelten, mit ihren Regeln.
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

- **Stellen:** Bereich **Meine Dev-Projekte** (`ztmeijtb2otuygda2xja3xss`). **„Dev: Lifeline-Hub“**
  (`eetrio0ldw4fe3ayr30s713o`, Schlüssel `LLH`) ist das Entwicklungsboard, das **Feedbackboard**
  (`ljbml1mwnbvh7itw7jtoe4u3`) sammelt Feedback, **„Lifeline Hub Eingang“**
  (`ll81adjdlutewvbrtznn28qk`) die GitHub-Rückmeldungen. Im Zweifel `list_structure`.
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
- **Kennung einer Aufgabe:** die ID; `get_task` nimmt auch die Kennung `LLH-<n>`. Branch
  `<typ>/<kurz>-<slug>` und Change-Name `<kurz>-<slug>`, `<kurz>` = erste 8 Zeichen der ID
  (`feat/f24jkokr-rahmen-kleinteile`). Commit-Body und PR-Beschreibung tragen die Zeile
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>`. Ergebnisse stehen an der Aufgabe in
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

## Planung und Ausführung — Superpowers (LLH-1967)

- **Superpowers** (`superpowers:*`, Plugin in `.claude/settings.json`) besitzt den
  **Änderungszyklus** (klären und entwerfen mit `brainstorming`, Aufgabenschnitt mit
  `writing-plans`, abarbeiten mit `subagent-driven-development` oder `executing-plans`) und die
  **Arbeitsdisziplin** (`using-git-worktrees`, `systematic-debugging`,
  `test-driven-development`, `verification-before-completion`,
  `finishing-a-development-branch`). Die Zunder-Skills legen Board-Spur und Routen darüber.
  Entscheidung: ADR-0069 (löst ADR-0013 ab, 18.11.2026).
- **OpenSpec ist eingefrorenes Archiv:** `openspec/changes/archive/` und `openspec/specs/`
  bleiben lesbar, weil Code, ADRs und Migrationen darauf verweisen; nichts Neues darunter, kein
  Werkzeug. Wächter: `scripts/check-openspec-eingefroren.sh` (Schritt 13 von `check-all.sh`,
  Bündel `schnell`).
- **Umsetzung bringt die Disziplin mit:** jede Aufgabe eines Plans per
  `test-driven-development`, vor jedem „fertig" `verification-before-completion`.
- **Review nach Ermessen, Warten ohne Wecken** (17.11.2026, Specs `review-vor-dem-pr`,
  `warten-ohne-wecken`): der Agent entscheidet am Diff, ob ein Review nötig ist, und startet ihn
  selbst; geweckt wird nur, wenn etwas zu tun ist. Ablauf: `dev-zunder-ausfuehren`.
- **Mit dem Menschen** (08.11.2026): vor dem ersten Code den Lösungsweg gemeinsam ausarbeiten
  (außer `trivial`), am Ende Bilder der Änderung in PR und Meldung. Ablauf:
  `dev-zunder-ausfuehren`, „Gemeinsam ausarbeiten, bevor Code entsteht“ und „Bilder der Änderung“.
- **Pflicht-Checkpoint:** nach dem Design-Doc aus `brainstorming` anhalten — vorlegen (Aufgabe
  auf `blocked`), Freigabe abwarten, dann `in_progress` und `writing-plans`.
- **Entwurfs-Hoheit** (LFH-589, Spec `entwurfs-hoheit`,
  `openspec/changes/archive/2026-09-30-lfh-589-entwurfs-hoheit-orchestrierung/design.md`):
  Workflows besitzen die Menge (Scope-Scan, Judge-Panel als Zulieferer), der Main-Loop den
  einzelnen Entwurf. Design-Doc und Plan entstehen **genau** auf der Route `entwurf`
  (E1 Entscheidung · E2 Regel · E3 mehr als ein Subsystem, nicht bei einem Bugfix, der
  Bestehendes wiederherstellt, oder einer reinen Textkorrektur; Liste in
  `dev-zunder-ausfuehren`, Schritt 3), nie bei `trivial`/`klar`/`bug-unklar`. **Kein Workflow
  ruft `brainstorming` oder `writing-plans` oder schreibt unter `docs/superpowers/`.**
- **Ablage:** Design-Docs unter `docs/superpowers/specs/YYYY-MM-DD-<kurz>-<slug>-design.md`,
  Pläne unter `docs/superpowers/plans/YYYY-MM-DD-<kurz>-<slug>.md`, beide committet; die
  Zunder-Aufgabe trägt den Plan-Pfad in `plan`. Einen Archivschritt gibt es nicht. Neue
  verbindliche Regeln stehen in der Bereichs-`AGENTS.md` oder einer ADR, nicht in
  `openspec/specs/`. Wer unter `docs/superpowers/` oder `openspec/` etwas verschiebt, greppt
  zuerst die Verweise (sie brechen still).
- **Ein Plan allein bekommt keinen PR** (Entscheidung 30.09.2026), außer der Mensch wünscht es
  ausdrücklich. Ablauf in EINEM Branch: Design-Doc → Commit → Freigabe → Plan → Umsetzung → erst
  dann der PR, mit Entwurf, Plan und Umsetzung zusammen. Den Branch zu pushen, um den Stand zu
  sichern, ist erlaubt; der PR wartet auf die Umsetzung — auch wenn die Umgebung (etwa eine
  Cloud-Sitzung) nach jedem Push einen PR verlangt.
- Eigene Skills liegen nur unter `.claude/skills/`; Superpowers kommt als Plugin, nicht als
  Kopie. Codex ist entfernt (LFH-853).

## Qualitäts-Gates — ein Kommando (LFH-235/F17)

Vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`; die vollen Suiten laufen auf `alpha`
oder im PR mit Label `voll` (LLH-1889; Schritte und Bündel im Skriptkopf, Mechanik in
`scripts/AGENTS.md`, „Leichte PR-Prüfung“).

- **Das Skript ist die Wahrheit**; die Workflows (`ci.yml`, `pr.yml`, `suiten.yml`) rufen es
  unverändert. Neue Schritte gehören ins Skript.
- **Ein rot geborenes Gate wird abgeschaltet statt befolgt** — erst sweepen, dann scharf schalten
  (deshalb nicht im Gate: `cargo clippy -D warnings`).
- **Kein `| tail` um Gate-Kommandos.** Testgüte belegen Mutationsproben, nicht Abdeckung.
- Node und pnpm kommen nur aus `[tools]` von `mise.toml` (`mise exec -- …`, LFH-773); jeder
  Checkout baut in sein eigenes `target/` (LFH-520). Einzelheiten: `scripts/AGENTS.md`.
- Prettier prüft ganz `frontend/` und `website/`, auch die `AGENTS.md` dort; rustfmt das
  Backend (`scripts/check-fmt.sh`).
- Nach jeder Response-DTO-/Enum-Änderung `scripts/check-typ-codegen.sh` und beide generierten
  Dateien mitcommitten (LFH-120, `src/AGENTS.md`).
