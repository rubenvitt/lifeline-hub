# Tasks

Die Change ändert nur Anleitungen und die PR-Vorlage; es gibt keinen Code, an dem ein Test rot
werden könnte. Jede Aufgabe nennt deshalb, woran ihr Ergebnis zu prüfen ist.

## 1. Prüfliste (D8)

- [ ] 1.1 `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` anlegen: Kopf (Herkunft, Zweck, „kein Ersatz für das Lesen des Diffs“), zehn Klassen mit Prüffragen und „Trifft zu, wenn der Diff …“. Prüfung: jede Klasse aus design.md D8 steht darin, je mit mindestens einer Prüffrage
- [ ] 1.2 Je Klasse zwei bis drei Beispiele aus den Commits der Testphase eintragen (Kurz-Hash, ein Satz zum Fall). Prüfung: jeder genannte Hash löst sich mit `git cat-file -e <hash>` auf und sein Commit-Text passt zur Klasse

## 2. Review-Schritt in `dev-zunder-ausfuehren` (D1, D2, D4, D5, D10)

- [ ] 2.1 Abschnitt „Review vor dem PR“ in `SKILL.md`: wann (jede Route außer `trivial`, ein Review je PR), Reihenfolge in Schritt 4, Auftragsvorlage für den Reviewer, Gegenprüfung, Tabelle zum Verbleib, Regel zur Pflege der Prüfliste. Prüfung: jede Anforderung der Delta-Spec hat eine Stelle im Abschnitt
- [ ] 2.2 Schritt 4: Zeile `superpowers:requesting-code-review` durch den Verweis auf den neuen Abschnitt ersetzen und vor das Archivieren stellen; Hinweis, dass der Review entfällt, wenn `dev-zunder-orchestrieren` aufruft. Prüfung: `grep -n requesting-code-review .claude/skills/dev-zunder-ausfuehren/SKILL.md` ist leer
- [ ] 2.3 Tabelle „Agenten nach Bedarf“: Zeile „Review parallel zu laufenden Gates“ auf den neuen Abschnitt verweisen lassen; „Don'ts“ um „keinen PR ohne Review und Abschnitt „Review““ ergänzen. Prüfung: beide Stellen nennen den Abschnitt beim Namen

## 3. Orchestrator (D3, D7)

- [ ] 3.1 `dev-zunder-orchestrieren/SKILL.md`, Phase 4: ein Review über den ganzen Branch, Ablauf und Verbleib per Verweis auf `dev-zunder-ausfuehren`, Punkt 3 (`superpowers:requesting-code-review`) streichen. Prüfung: Phase 4 nennt die Prüfliste und keine eigene Dimensionsliste
- [ ] 3.2 `references/workflow-bausteine.md`, Skelett „Review-find-verify“: `DIMENSIONS` durch die vier Gruppen aus D3 ersetzen, jeder Agent bekommt den Pfad der Prüfliste und die Namen seiner Klassen; Schlusssatz ohne `superpowers:requesting-code-review`. Prüfung: das Skript bleibt syntaktisch gültig (`node --check` auf den herausgelösten Block) und enthält keine Kopie der Prüffragen

## 4. Projektregel und PR-Vorlage (D6, D9)

- [ ] 4.1 `AGENTS.md`, Abschnitt „Planung und Ausführung“: `requesting-code-review` an beiden Stellen ersetzen, ein Punkt zum Review vor dem PR mit Verweis auf Skill und Herleitung. Prüfung: `wc -l AGENTS.md` unter 200, `grep -n requesting-code-review AGENTS.md` leer
- [ ] 4.2 `.github/pull_request_template.md`: Abschnitt „Review“ zwischen „Bilder“ und „Geprüft“ wie in D6. Prüfung: die Vorlage zeigt den Abschnitt, der Kommentar nennt die drei Fälle (bestätigt, verworfen, kein Review)

## 5. Probelauf und Abschluss

- [ ] 5.1 Probelauf am echten Fall: den Reviewer nach der neuen Vorlage auf den Diff eines gemergten PRs der Testphase ansetzen, in dem CodeRabbit etwas fand, und zwar auf den Stand **vor** der Behebung (Vorschlag: #1243 vor `773b6b44`). Prüfung: Ergebnis als Tabelle in dieser Datei unter „Probelauf“: welche der dort von CodeRabbit gemeldeten Fehler der eigene Review findet, welche nicht. Fehlt eine ganze Klasse, Prüffrage schärfen und Lauf wiederholen
- [ ] 5.2 Verweise prüfen: `grep -rn "requesting-code-review" AGENTS.md .claude .github` ist leer; Verweise auf den Abschnitt „Review vor dem PR“ und auf `review-pruefliste.md` zeigen auf vorhandene Stellen
- [ ] 5.3 `./scripts/check-all.sh --nur schnell` grün (Prettier und der Archiv-Wächter betreffen die geänderten Dateien)
- [ ] 5.4 Der Review dieser Change selbst läuft nach dem neuen Abschnitt; der PR trägt den Abschnitt „Review“

## Workflow follow-up

- `/opsx:archive review-vor-dem-pr` vor dem PR, im selben Branch; danach den Verweis in `AGENTS.md` auf den Archivpfad nachziehen.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen.
- Außerhalb des Repos, bei Ruben: CodeRabbit-App am Repository abschalten oder auf Review nur auf Zuruf stellen.
