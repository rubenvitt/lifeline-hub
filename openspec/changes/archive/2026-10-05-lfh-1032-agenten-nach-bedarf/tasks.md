# Tasks

## 1. Freigabe in `dev-clickup-ausfuehren`

- [x] 1.1 Abschnitt „Agenten nach Bedarf“ in `.claude/skills/dev-clickup-ausfuehren/SKILL.md` anlegen (Festlegung 04.10.2026, LFH-1032; Ermessen mit Beispielen nach D2; Agent oder Workflow nach D3; Pflichtinhalt Worker-Prompt nach D4) und prüfen, dass `grep -n "Agenten nach Bedarf" .claude/skills/dev-clickup-ausfuehren/SKILL.md` ihn findet
- [x] 1.2 Im „Überblick“ und in den Don'ts von `dev-clickup-ausfuehren` auf den Abschnitt verweisen, ohne den Inhalt zu doppeln; prüfen per Lesen, dass jede Aussage nur einmal steht

## 2. Orchestrierung angleichen

- [x] 2.1 In `.claude/skills/dev-clickup-orchestrieren/SKILL.md` Kernprinzip, Phasenüberblick, Phase 1 und Phase 4 auf „Workflow oder parallele Subagents“ umstellen und auf den Abschnitt aus 1.1 verweisen; Don'ts „Kein `/opsx:*` im Workflow“ auf Subagents erweitern; prüfen per `grep -n "Subagent" .claude/skills/dev-clickup-orchestrieren/SKILL.md`
- [x] 2.2 In `references/workflow-bausteine.md` die Grundregeln um den Hinweis ergänzen, dass die Skelette auch als einzelne Agent-Aufrufe laufen dürfen und dieselben Grenzen gelten; prüfen per Lesen

## 3. Abschluss

- [x] 3.1 `openspec validate lfh-1032-agenten-nach-bedarf --strict` grün
- [x] 3.2 `./scripts/check-all.sh --nur schnell` grün (Skills und Spec berühren keinen Code; der volle Lauf folgt in der CI des PRs). Lokal am 05.10.2026: Schritte 9, 10 und 13 (OpenSpec-Archiv) grün; 1, 2, 3, 6, 8, 11, 12 rot nur wegen `mise: command not found` in der Cloud-Sitzung. Beleg ist die CI des PRs.
- [x] 3.3 Freigabe als Projekt-Memory festhalten (für die Aufträge des Coordinators) und prüfen, dass die Datei im Memory-Verzeichnis liegt
