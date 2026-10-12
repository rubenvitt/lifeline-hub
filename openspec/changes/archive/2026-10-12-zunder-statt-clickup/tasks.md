# Tasks

## 1. Skills

- [x] 1.1 `clickup-task-anlegen`, `dev-clickup-ausfuehren`, `dev-clickup-orchestrieren` per `git mv` nach `zunder-task-anlegen`, `dev-zunder-ausfuehren`, `dev-zunder-orchestrieren` umbenennen und auf die Zunder-Werkzeuge umschreiben
- [x] 1.2 Status-Spur nur in `dev-zunder-ausfuehren` („Board-Status mitführen“), Codes und Kennungen nur in `AGENTS.md`, Abschnitt „Zunder“

## 2. Repo-Konventionen

- [x] 2.1 PR-Vorlage auf die `Zunder:`-Zeile umstellen, Hinweis in `release.yml`, KI-Vorlage und Kommentare in `release.config.mjs` und `scripts/release/pr-kommentare.mjs` nachziehen

## 3. Abschluss

- [x] 3.1 `openspec validate zunder-statt-clickup --strict` grün
- [x] 3.2 Selbsttest `scripts/release/pr-kommentare.test.mjs` und `scripts/check-openspec-archiv.sh` grün; der volle `check-all.sh` läuft in der CI des PRs
