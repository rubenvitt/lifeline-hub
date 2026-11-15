# Tasks

## 1. Pflichtliste und Wächter

- [x] 1.1 `ruleset-pruefen.test.sh` auf drei Pflicht-Checks umstellen (`Baut mit Ziel-Branch` als überzählig erwartet) und rot sehen; dann die Liste in `scripts/ruleset-pruefen.sh` kürzen, bis der Selbsttest grün ist
- [x] 1.2 `stau-waechter.test.sh`: Regeln-Attrappe ohne `Baut mit Ziel-Branch`, die Fälle 37b (Check rechnet noch) auf einen beliebigen laufenden Check umstellen; Selbsttest grün

## 2. Workflows und Skript entfernen

- [x] 2.1 `ci-stufen.test.sh` zuerst auf „`ziel-branch-build.yml` und `ziel-branch-verteilen.yml` gibt es nicht“ umstellen und rot sehen; dann beide Workflows, `scripts/ziel-branch-build.sh` und `scripts/ziel-branch-build.test.sh` löschen und den Aufruf in `check-all.sh` (Schritt 11) entfernen; `ci-stufen`, `check-all.test.sh` grün
- [x] 2.2 Kommentare in `check-all.sh` (Kopf `--nur baut`, Schritt 17) und `check-all.test.sh` ohne Bezug auf den Check; Selbsttest grün

## 3. Doku und Regeln

- [x] 3.1 Neue ADR mit `ersetzt: ADR-0030` (übernimmt „alpha rot“), ADR-0030 auf `ersetzt`; Architektur-Wächter grün
- [x] 3.2 `scripts/AGENTS.md` (Abschnitt „Baut mit Ziel-Branch“ entfernen, Pflichtliste), Skill `dev-zunder-ausfuehren` („Baut mit Ziel-Branch rot“, Pflicht-Checks), Kapitel 7 (Diagramm, Text, `Stand`) und 11 (R41, R42) nachziehen; ein grep über das Repo (ohne Archive und `docs/superpowers/`) findet `Baut mit Ziel-Branch` nur noch als Rückblick

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh --nur schnell` lokal grün

## Workflow follow-up

- Review vor dem PR, `/opsx:archive`, PR gegen `alpha` (ohne `voll`).
- Nach dem Merge `ruleset.yml` per Hand starten und grün sehen; LLH-1890 auf `dropped`.
