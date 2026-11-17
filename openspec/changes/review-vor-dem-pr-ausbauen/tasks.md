# Tasks

Die Change ändert nur Anleitungen und die PR-Vorlage; es gibt keinen Code, an dem ein Test rot
werden könnte. Jede Aufgabe nennt, woran ihr Ergebnis zu prüfen ist.

## 1. Skills

- [ ] 1.1 `dev-zunder-ausfuehren/SKILL.md`: Tabellenzeile und Ausnahme zum Review in „Agenten nach Bedarf“, Punkt in Schritt 4, Abschnitt „Review vor dem PR“ (ersetzt durch kurzen Abschnitt „Review auf Wunsch“) und Don't streichen. Prüfung: `grep -n "Review vor dem PR" .claude/skills/dev-zunder-ausfuehren/SKILL.md` ist leer
- [ ] 1.2 `review-pruefliste.md`: Kopf auf „Review auf Wunsch“ umstellen. Prüfung: der Kopf nennt keinen Pflicht-Review
- [ ] 1.3 `dev-zunder-orchestrieren/SKILL.md`: Einleitung, Phasentabelle, Phase 4 und Don'ts ohne Pflicht-Review; `workflow-bausteine.md` ohne Skelett 3. Prüfung: `grep -rn "Review-find-verify\|Review vor dem PR" .claude` ist leer

## 2. Projektregel und PR-Vorlage

- [ ] 2.1 `AGENTS.md`, „Planung und Ausführung“: Pflicht-Review durch einen Satz „nur auf Wunsch“ ersetzen. Prüfung: `wc -l AGENTS.md` unter 200
- [ ] 2.2 `.github/pull_request_template.md`: Abschnitt „Review“ streichen. Prüfung: die Vorlage hat keinen Abschnitt „Review“

## 3. Abschluss

- [ ] 3.1 Verweise prüfen: `grep -rn "Review vor dem PR\|Review-find-verify" AGENTS.md .claude .github docs` ist leer (außer Archiv)
