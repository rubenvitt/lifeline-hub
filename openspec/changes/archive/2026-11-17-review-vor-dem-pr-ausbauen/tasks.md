# Tasks

Die Change ändert nur Anleitungen und die PR-Vorlage; es gibt keinen Code, an dem ein Test rot
werden könnte. Jede Aufgabe nennt, woran ihr Ergebnis zu prüfen ist.

## 1. Skills

- [x] 1.1 `dev-zunder-ausfuehren/SKILL.md`: Tabellenzeile und Ausnahme zum Review in „Agenten nach Bedarf“, Punkt in Schritt 4, Abschnitt „Review vor dem PR“ (ersetzt durch kurzen Abschnitt „Review auf Wunsch“) und Don't streichen. Prüfung: `grep -n "Review vor dem PR" .claude/skills/dev-zunder-ausfuehren/SKILL.md` ist leer
- [x] 1.2 `review-pruefliste.md`: Kopf auf „Review auf Wunsch“ umstellen. Prüfung: der Kopf nennt keinen Pflicht-Review
- [x] 1.3 `dev-zunder-orchestrieren/SKILL.md`: Einleitung, Phasentabelle, Phase 4 und Don'ts ohne Pflicht-Review; `workflow-bausteine.md` ohne Skelett 3. Prüfung: `grep -rn "Review-find-verify\|Review vor dem PR" .claude` ist leer

## 1b. Nachgeschärft (17.11.2026)

- [x] 1b.1 „Review auf Wunsch“ → „Review nach Ermessen“ mit Anlässen, Form und Nachweis; Orchestrator Phase 4 nachgezogen. Prüfung: `grep -rn "Review auf Wunsch" .claude AGENTS.md .github` ist leer
- [x] 1b.2 Abschnitt „Warten ohne Wecken“ in `dev-zunder-ausfuehren`, Verweis in Schritt 4 und Orchestrator Phase 4, Spec `warten-ohne-wecken`. Prüfung: Abschnitt nennt Gates in einem Aufruf, kein Nachsehen, Meldung ohne Handlungsbedarf, Merge-Wecken

## 2. Projektregel und PR-Vorlage

- [x] 2.1 `AGENTS.md`, „Planung und Ausführung“: Pflicht-Review durch einen Punkt „Review nach Ermessen, Warten ohne Wecken“ ersetzen. Prüfung: `wc -l AGENTS.md` unter 200
- [x] 2.2 `.github/pull_request_template.md`: Abschnitt „Review“ streichen, eine Zeile „Review“ unter „Geprüft“. Prüfung: kein Abschnitt „Review“, die Zeile steht unter „Geprüft“

## 3. Abschluss

- [x] 3.1 Verweise prüfen: `grep -rn "Review vor dem PR\|Review-find-verify" AGENTS.md .claude .github docs` ist leer (außer Archiv)
