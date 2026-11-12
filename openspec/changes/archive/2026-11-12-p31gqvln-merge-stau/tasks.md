# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Fall im
Selbsttest, dann das Skript. Skripte folgen den Mustern von `scripts/migrationen-autofix.sh` und
`scripts/check-migrationen.sh` (Bash, `set -euo pipefail`, Exit-Codes im Kopf, Selbsttest
daneben, Schritt in `check-all.sh`, Bündel `schnell`). Actions per Commit-SHA gepinnt. Vor jeder
Änderung `scripts/adr-fuer.sh <pfad>…`.

## 1. ADR-Verzeichnis und ADR-Nummern (D5, D6)

- [x] 1.1 `scripts/check-adr-nummern.sh <basis> <kopf>` samt `scripts/check-adr-nummern.test.sh`: Fälle freie Nummer, Kollision (nennt Datei und nächste freie Nummer), gefüllte Lücke, doppelt im Branch, Branch ohne ADR; Selbsttest erst rot, dann grün
- [x] 1.2 `scripts/adr-fuer.sh --alle` gibt je ADR `id`, `status`, `titel` aus; Fall im bestehenden Selbsttest oder neuer Fall, Aufruf im Repo zeigt alle ADRs
- [x] 1.3 Tabelle 9.1 in `docs/architektur/09-architekturentscheidungen.md` durch den Verweis-Absatz ersetzen, `docs/architektur/README.md` (Zeile Kapitel 9) nachziehen, Verweise auf „Verzeichnis der ADRs“ per `git grep` geprüft
- [x] 1.4 Prüfung „Kapitel 9 nennt die ADR nicht“ aus `scripts/check-architektur.sh` und der Fall aus `scripts/check-architektur.test.sh` entfernen; beide Skripte laufen grün
- [x] 1.5 `.github/workflows/migrationen.yml`: beide Jobs setzen zusätzlich den Status `ADR-Nummern`, der Schritt „Sind die Status Pflicht?“ prüft beide Namen; YAML geparst und jeder `run`-Block mit `bash -n` geprüft (`actionlint` fehlt in der Umgebung), Logik im Skript durch 1.1 belegt
- [x] 1.6 Schritt für `check-adr-nummern.test.sh` und den Lauf gegen `origin/alpha` in `scripts/check-all.sh`; `scripts/check-all.sh --nur schnell` zeigt den Schritt grün
- [x] 1.7 Regeln nachziehen: `docs/architektur/AGENTS.md` (Zeile „Kapitel 9 listet jede ADR“ raus, Mitänderungsregel, Nummernregel mit Verweis auf den Status), `website/AGENTS.md` falls es die Tabelle nennt; Prettier über `website/` grün

## 2. Stau-Wächter (D1, D2, D3)

- [x] 2.1 `scripts/stau-waechter.sh`, Befund: Konfliktdateien per `git merge-tree` für Basis und Kopf; Selbsttest-Fälle konfliktfrei, Konflikt in einer Datei, Konflikt in mehreren
- [x] 2.2 Hinweis-Logik mit Attrappe für den GitHub-Zugriff: neuer Befund legt Kommentar an, gleicher Befund tut nichts, geänderter Befund löscht und legt neu an, behobener Befund ändert auf „behoben“, Entwurf wird übersprungen; je ein Selbsttest-Fall
- [x] 2.3 Fehlender CI-Lauf: Wartezeit 20 Minuten, Merge des Ziel-Branches im losgelösten Arbeitsbaum mit Trailer, Push nur Fast-Forward; Fälle Push erfolgt, Kopf zu jung, nichts zu mergen (Hinweis), Fork (Hinweis), Kopf-Branch heißt wie Ziel-Branch (verweigert), Branch hat sich bewegt (abgewiesen), Schleifenbremse, ohne App nur Hinweis
- [x] 2.4 `.github/workflows/stau-waechter.yml`: Auslöser `push` (alpha, beta, main), `schedule`, `workflow_dispatch`; Rechte `contents: read`, `pull-requests: write`, `checks: read`; App-Token nur für den Push; YAML geprüft wie in 1.5
- [x] 2.5 Schritt für `stau-waechter.test.sh` in `scripts/check-all.sh`; `--nur schnell` zeigt ihn grün
- [x] 2.6 Probe am echten Repository nach dem Merge vorbereiten: Notiz in `design.md` („Nachträge“), wie der erste Konflikt-Hinweis geprüft wird (kommt das Ereignis bei der Sitzung des PRs an?); bis zur Messung als offen benannt
- [x] 2.7 `scripts/AGENTS.md`: Abschnitt Stau-Wächter (was er tut, Grenzen, „nach einem Wächter-Merge vor dem nächsten Push holen“); Wurzel-`AGENTS.md` nur ein Verweis, Datei bleibt unter 200 Zeilen

## 3. Umnummerierung ohne schwere Suiten (D4)

- [x] 3.1 `scripts/nur-umnummeriert.sh <kopf>` samt Selbsttest: ein Autofix-Commit, zwei nacheinander, Commit mit mitgezogenem Verweis, Commit mit Trailer und Inhaltsänderung, Commit ohne Trailer, Merge-Commit, mehr als fünf Schritte
- [x] 3.2 Job `aenderungen` in `.github/workflows/ci.yml`: Kopf des PRs mit genug Tiefe holen, Skript fragen, Check-Runs des genannten Commits abfragen, bei vollständig grün `rust`/`frontend`/`e2e` auf `false`, Grund in der Zusammenfassung; Fehler der Abfrage lässt alles laufen. Die Auswertung der Check-Runs steht als Funktion im Skript und hat Selbsttest-Fälle (alle grün, einer rot, einer fehlt, einer `skipped`)
- [x] 3.3 Kopfkommentar von `ci.yml` und `scripts/AGENTS.md` („Im PR laufen nur die betroffenen Suiten“) um die Regel ergänzen; Wurzel-`AGENTS.md`, Migrationsvergabe: Halbsatz zum Autofix
- [x] 3.4 Schritt für `nur-umnummeriert.test.sh` in `scripts/check-all.sh`; `--nur schnell` zeigt ihn grün

## 4. Zusammen prüfen

- [x] 4.1 Die berührten Schritte einzeln grün (Selbsttests der drei Skripte, `check-architektur`, `check-migrationen`, `migrationen-autofix`, `bereiche`, `check-all.test`, `check-schreibweisen`); `check-toolversionen` scheitert in der Cloud-Sitzung am fehlenden `mise`, nicht am Diff; voller Lauf in der CI des PRs
- [x] 4.2 Trockenlauf des Wächters gegen das echte Repository ohne Schreibzugriff (`--nur-zeigen`): Ausgabe nennt für jeden offenen PR Befund und geplante Aktion
- [x] 4.3 `superpowers:requesting-code-review` über den ganzen Diff, Befunde eingearbeitet (design.md, „Nachträge“)

## Workflow follow-up

- `/opsx:archive p31gqvln-merge-stau` im selben Branch vor dem PR (Spec-Sync, Verweise auf den Archivpfad nachziehen).
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/p31gqvlnmqub8pufumm5hz19`; Abschnitt „Bilder“: keine sichtbare Wirkung.
- Nach dem Merge trägt Ruben `ADR-Nummern` im Ruleset 17017911 als Required Check ein.
