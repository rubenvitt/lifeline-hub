# Tasks

## 1. Freigabe in `dev-clickup-ausfuehren`

- [ ] 1.1 Abschnitt „Agenten nach Bedarf“ in `.claude/skills/dev-clickup-ausfuehren/SKILL.md` anlegen (Festlegung 04.10.2026, LFH-1032; Ermessen mit Beispielen nach D2; Agent oder Workflow nach D3; Pflichtinhalt Worker-Prompt nach D4) und prüfen, dass `grep -n "Agenten nach Bedarf" .claude/skills/dev-clickup-ausfuehren/SKILL.md` ihn findet
- [ ] 1.2 Im „Überblick“ und in den Don'ts von `dev-clickup-ausfuehren` auf den Abschnitt verweisen, ohne den Inhalt zu doppeln; prüfen per Lesen, dass jede Aussage nur einmal steht

## 2. Orchestrierung angleichen

- [ ] 2.1 In `.claude/skills/dev-clickup-orchestrieren/SKILL.md` Kernprinzip, Phasenüberblick, Phase 1 und Phase 4 auf „Workflow oder parallele Subagents“ umstellen und auf den Abschnitt aus 1.1 verweisen; Don'ts „Kein `/opsx:*` im Workflow“ auf Subagents erweitern; prüfen per `grep -n "Subagent" .claude/skills/dev-clickup-orchestrieren/SKILL.md`
- [ ] 2.2 In `references/workflow-bausteine.md` die Grundregeln um den Hinweis ergänzen, dass die Skelette auch als einzelne Agent-Aufrufe laufen dürfen und dieselben Grenzen gelten; prüfen per Lesen

## 3. Abschluss

- [ ] 3.1 `openspec validate lfh-1032-agenten-nach-bedarf --strict` grün
- [ ] 3.2 `./scripts/check-all.sh --nur schnell` grün (Skills und Spec berühren keinen Code; der volle Lauf folgt in der CI des PRs)
- [ ] 3.3 Freigabe als Projekt-Memory festhalten (für die Aufträge des Coordinators) und prüfen, dass die Datei im Memory-Verzeichnis liegt
