# Tasks

## 1. Regel an einer Stelle

- [x] 1.1 `scripts/AGENTS.md`, „Leichte PR-Prüfung“: Kriterien für `voll` (D1) als eigener Punkt; prüfen per Lesen, dass „riskant“ dort nicht mehr als Grund steht
- [x] 1.2 Skill `dev-zunder-ausfuehren` („Vor dem PR lokal testen“) und PR-Vorlage („Geprüft“) auf Verweis umstellen; ein grep über das Repo (ohne Archive und `docs/superpowers/`) findet „riskant“ nicht mehr als Grund für `voll` (außer in den unveränderlichen ADR-0047/0048, die ADR-0050 präzisiert)
- [x] 1.3 Neue ADR (nächste freie Nummer über `origin/alpha`), die ADR-0048 im SHOULD präzisiert, mit Prüfblock; Architektur-Wächter und ADR-Nummern grün

## 2. Gesamtprüfung

- [x] 2.1 `./scripts/check-all.sh --nur schnell` lokal grün (12 Schritte; nach den Review-Behebungen Architektur-Wächter erneut grün)

## Workflow follow-up

- Review vor dem PR, `/opsx:archive`, PR gegen `alpha` ohne `voll`.
