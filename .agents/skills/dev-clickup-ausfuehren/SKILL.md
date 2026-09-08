---
name: dev-clickup-ausfuehren
description: Execute one concrete task from the Lifeline-Hub ClickUp Entwicklungsboard through implementation, verification, and a published pull request. Keep its board status current. Usually invoked by dev-clickup-orchestrieren. Not for capturing new work; use clickup-task-anlegen for that.
---

# Einzelnen ClickUp-Task ausführen (Lifeline Hub)

## Zweck und Abgrenzung

Setze genau einen Task vom **Entwicklungsboard** (`901523554968`, Workspace
`9015920204`) um. Dieser Skill besitzt die Statusspur, die Workspace-Prüfung und das
Komplexitäts-Routing. Bei Parent-Tasks, Subtasks oder ausdrücklich gewünschter
Mehragenten-Orchestrierung verwende `dev-clickup-orchestrieren` als Einstieg.

**Ziel jeder Umsetzung ist ein veröffentlichter PR.** Commit, Push und PR-Erstellung gehören
zum Auftrag und benötigen keine zusätzliche Nachfrage. Eine ausdrückliche Einschränkung des
Users geht vor. Ein Merge gehört erst mit gesondertem Auftrag dazu.

Neue, außerhalb des Scopes entdeckte Arbeit gehört zu `clickup-task-anlegen`.

## 1. Task laden

Rufe `mcp__codex_apps__clickup_clickup_get_task` mit der genannten ID oder Custom-ID auf:

- `workspace_id`: `9015920204`;
- `task_id`: die genannte Task-ID bzw. Custom-ID;
- `detail_level`: `detailed`;
- `subtasks`: `false`.

Ermittle `custom_id` (zum Beispiel `LFH-42`), Name, Beschreibung, Akzeptanzkriterien,
Abhängigkeiten und aktuellen Status. Ist nur ein Name genannt und nicht eindeutig, suche mit
`mcp__codex_apps__clickup_clickup_search`, eingegrenzt auf Tasks und das Entwicklungsboard.
Bleibt das Ergebnis mehrdeutig, frage kurz nach; rate nicht.

## 2. Board-Status nur vorwärts führen

Aktualisiere den Status mit `mcp__codex_apps__clickup_clickup_update_task` und
`workspace_id: 9015920204`. Die Statusspur lautet:

`backlog → scoping → in design → ready for development → in development → in review → testing → shipped → done`

Sonderstatus: `cancelled`.

Regeln:

- Setze einen Status automatisch, wenn der zugehörige Arbeitsschritt wirklich begonnen hat.
- Setze niemals zurück und schreibe denselben Status nicht redundant erneut.
- Prüfe den aktuellen Status aus der Task-Antwort, bevor du aktualisierst.
- Verwende `cancelled` nur, wenn der Task tatsächlich verworfen wird, nicht bei einer Pause.
- Statusmeldungen ersetzen keine echte Verifikation.

## 3. Workspace prüfen

Leite einen Branch-Namen `<typ>/<custom-id-klein>-<slug>` ab. Nutze `feat`, `fix`,
`refactor`, `chore` oder `docs`; bilde den Slug aus drei bis fünf ASCII-Wörtern des
Task-Titels. Beispiel: `feat/lfh-42-personal-status`.

Prüfe mit `rtk git branch --show-current` und `rtk git status --short` den aktuellen
Checkout. Bestehende Änderungen gehören dem User und werden nicht überschrieben.

| Aktueller Branch | Vorgehen |
|---|---|
| Branch enthält die Custom-ID oder passt eindeutig zum Thema | im aktuellen Checkout weiterarbeiten |
| `main`/`master`, generischer Branch oder erkennbar andere Aufgabe | Lage und vorgeschlagenen Branch nennen; vor Branch-/Worktree-Anlage fragen |

Nach Zustimmung verwende den in der aktuellen Codex-Umgebung vorgesehenen Worktree-Weg.
Falls kein sicherer Worktree-Weg verfügbar ist, frage, ob im aktuellen Checkout fortgefahren
werden soll. Lege nicht ungefragt einen Branch oder Worktree an und führe keine destruktiven
Git-Befehle aus.

## 4. Komplexität routen und umsetzen

Wähle den kleinsten belastbaren Ablauf:

| Lage | Ablauf | Startstatus |
|---|---|---|
| Trivialer Text-/Typo-Fix | direkt ändern und gezielt prüfen | `in development` |
| Anforderungen unklar | Code und Nachbarschaft lesen, Optionen mit Empfehlung formulieren, nötigen Checkpoint einholen | `scoping`, danach `in design` oder `in development` |
| Bug, Ursache unklar | reproduzieren, tiefste Ursache bestimmen, Regressionstest schreiben, dann reparieren | `in development` |
| Feature/Bugfix mit klarer Spec | Test zuerst oder mindestens gleichzeitig mit der Änderung; kleinsten grünen Schritt implementieren | `in development` |
| Mehrere Schritte oder Dateien | Codex-Plan anlegen, Tests und Risiken je Schritt nennen, dann schrittweise ausführen | `in design` → `ready for development` → `in development` |

Beziehe `CLAUDE.md` als bestehende Projektkonvention ein, weil es die fachlichen und
UI-bezogenen Entscheidungen dieses Repositories enthält. Verwende weitere projektlokale
Skills, sobald deren Beschreibung passt, etwa `antd` bei Ant-Design-Arbeit.

## 5. Verifikation, Review und Abschluss

Bevor du „fertig“ sagst:

1. Prüfe den Diff gegen Taskbeschreibung und Akzeptanzkriterien.
2. Führe die kleinsten relevanten Tests mit frischen Exit-Codes aus; bei höherem Risiko auch
   die betroffenen größeren Test-/Build-Gates.
3. Prüfe `rtk git diff --check` und den abschließenden Status des Worktrees.
4. Führe einen gezielten Review-Pass auf Logik, Berechtigungen/Org-Isolation,
   Projektkonventionen und Testlücken aus.

Nach implementierter und selbst geprüfter Änderung darf der Task auf `in review`. Nutzt der
Ablauf eine getrennte Abnahme, setze danach `testing`.

Führe die Umsetzung anschließend bis zum PR:

1. Committe die Änderungen des Tasks mit seiner `custom_id` und pushe den Arbeitsbranch.
2. Erstelle einen PR gegen den Zielbranch des Projekts oder aktualisiere den bestehenden PR
   dieses Arbeitsbranches. Beschreibe Ergebnis, Prüfbelege und verbleibende Grenzen.
3. Prüfe den veröffentlichten PR samt Head-Commit und verfügbarem Check-Status. Hinterlege
   PR-Link, geprüften Commit, Gate-Ergebnisse und Review-Stand in ClickUp.
4. Berichte den PR-Link und den tatsächlichen Prüf-/Boardstatus. Ein offener PR ist noch
   nicht `shipped` oder `done`.

Bei noch offenen Prüfungen oder Befunden veröffentliche den vorhandenen, reviewbaren Stand
als Draft-PR und benenne die Blocker. Ist schon die Veröffentlichung technisch blockiert,
melde den konkreten Blocker und den gesicherten lokalen Stand; behaupte keinen PR-Abschluss.
Setze `shipped` erst nach nachweislich erfolgreicher Integration und `done` erst, wenn nichts
mehr offen ist. Merge nur bei gesonderter Beauftragung.

## Grenzen

- Kein neuer Task: dafür `clickup-task-anlegen`.
- Keine Statussprünge aufgrund bloßer Absicht.
- Kein Rückwärtssetzen oder redundantes Status-Update.
- Keine ungefragte Branch-/Worktree-Anlage.
- Kein Abschluss nur mit lokalen Änderungen, einem Commit oder Push: Ziel bleibt der PR,
  sofern der User den Auftrag nicht ausdrücklich einschränkt.
- Keine „fertig“-Aussage allein aufgrund vorhandener Änderungen; aktuelle Prüfbelege nennen.
