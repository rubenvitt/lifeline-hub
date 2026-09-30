# Tasks

## 1. Kriterium im Routing (`dev-clickup-ausfuehren`)

- [x] 1.1 `.claude/skills/dev-clickup-ausfuehren/SKILL.md`, Schritt 3: Zeile „Multi-Step /
  mehrere Files“ zu „Entwurf“ umbenennen und E1–E3 samt Subsystemliste und Bugfix-Ausnahme
  (Spec „Eine Change entsteht genau auf der Route ‚Entwurf‘“) darunter festhalten. Außerdem den
  Satz ergänzen, dass auf den übrigen Routen ausdrücklich keine Change entsteht und „unklar“
  nach `/opsx:explore` neu geroutet wird. Prüfen: `grep -n "Entwurf" …/SKILL.md` zeigt Tabelle
  und Kriterium, und `grep -n "Multi-Step" .claude/` findet keinen Treffer mehr.

## 2. Phasen im Orchestrierungs-Skill (`dev-clickup-orchestrieren`)

- [x] 2.1 `SKILL.md`, Phase 1: Workflow besitzt den Scan. Die Map trägt `route`,
  `entwurfsgruende` und `faehigkeiten`. `/opsx:explore` läuft nur im Main-Loop für Route „unklar“.
  Die Route wird am Checkpoint bestätigt. Prüfen: Der Abschnitt nennt genau einen Mechanismus je
  Frage und das Erkennungsmerkmal (`route`).
- [x] 2.2 `SKILL.md`, Phase 2: `/opsx:propose` im Main-Loop je Task auf „Entwurf“, Name
  `<custom_id>-<slug>`, Map-Eintrag als Eingabe, gemeinsame Change bei gleicher Fähigkeit.
  „Plan je Subtask“ fällt weg, das Judge-Panel wird Zulieferer ohne eigenen Halt (design.md
  D4). Ein gesammelter Freigabe-Checkpoint. Tasks ohne „Entwurf“ bekommen keinen
  Planungsschritt. Prüfen: `grep -n "Plan je Subtask" .claude/` findet keinen Treffer mehr, und
  Phase 2 nennt den Checkpoint.
- [x] 2.3 `SKILL.md`, Phasenüberblick, Phase 3, „Checkpoints & Entscheidungen“ und Don'ts
  nachziehen. Tabelle: Phase 2 = Main-Loop + optional Workflow. Autonome Agents nur an
  freigegebenen Changes, Design-Lücke = Blocker. Neues Don't: kein `/opsx:*` und kein Schreiben
  unter `openspec/changes/` im Workflow. Prüfen: Lesen gegen die Spec-Anforderung „Kein Workflow
  überfährt den Freigabe-Checkpoint“, jedes Szenario hat eine Textstelle.

## 3. Skelette (`references/workflow-bausteine.md`)

- [x] 3.1 Abschnitt 1 (Scope-Fan-out): Schema `complexity` durch `route`, `entwurfsgruende` und
  `faehigkeiten` ersetzen. Der Reader-Prompt nennt E1–E3 samt Subsystemliste. Den Text „Im
  Main-Loop danach“ um `/opsx:explore` für „unklar“ und die Bestätigung der Route ergänzen.
  Prüfen: Das Skript im Codeblock parst, eingewickelt wie im Workflow-Tool (Körper in
  `async function lauf(args) { … }`, `export` entfernt, dann `node --check`). Gegenprobe: Der
  Bestand parst mit derselben Methode, und eine kaputte Klammer macht sie rot.
- [x] 3.2 Abschnitt 2 (Design-Judge-Panel): Einleitung und Nachsatz auf „Zulieferer für
  `/opsx:propose`, schreibt nichts“ umstellen. Der Entwurfs-Prompt sagt „nur lesen“. Der Hinweis
  auf „Plan je Subtask“ entfällt. Kopfzeile der Datei: kein Workflow ruft `/opsx:*`. Prüfen:
  Parsen wie in 3.1, und `grep -n "opsx" …/workflow-bausteine.md` zeigt die Grenze.

## 4. Projektregel

- [x] 4.1 `CLAUDE.md`, Abschnitt „Planung und Ausführung“: eine Zeile zur Entwurfs-Hoheit
  (LFH-589) mit Verweis auf die archivierte Change und die Spec `entwurfs-hoheit`. Prüfen: Der
  Verweis zeigt nach der Archivierung auf einen existierenden Pfad (`ls`).

## 5. Abschluss

- [x] 5.1 `npx @fission-ai/openspec validate lfh-589-entwurfs-hoheit-orchestrierung --strict`
  grün. Querlesen der vier geänderten Dateien auf Widersprüche zueinander (Routennamen gleich
  geschrieben, Subsystemliste gleich).
- [x] 5.2 `/opsx:archive` im selben Branch (Spec-Sync nach `openspec/specs/entwurfs-hoheit/`,
  Verweis in `CLAUDE.md` auf den Archivpfad), danach `scripts/check-openspec-archiv.sh` grün.
