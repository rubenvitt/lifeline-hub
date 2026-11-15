# Tasks

## 1. Gate lokal: `--ohne-e2e`

- [x] 1.1 `scripts/check-all.test.sh`: Fall für `--ohne-e2e` (mit `--geaendert` und allein), der e2e-Schritt erscheint in `--auswahl` als übersprungen. Rot, dann in `scripts/check-all.sh` umsetzen und den Kopf ergänzen. Selbsttest grün.

## 2. „Fertig“ heißt Auto-Merge an

- [x] 2.1 `scripts/ziel-branch-build.test.sh`: Ein PR nur mit Label `e2e` oder `voll` gilt als nicht fertig (rot). Danach `pr_zeilen`, Texte und Kopf in `scripts/ziel-branch-build.sh` sowie in `.github/workflows/ziel-branch-build.yml` umstellen, ohne `labeled` (Formtest F9 nachziehen). Selbsttest grün.

## 3. Stau-Wächter ohne `ohne-e2e`

- [x] 3.1 `scripts/stau-waechter.test.sh`:
  - Fälle zu `ohne-e2e` entfernen.
  - Neuer Fall: ein Hinweis `ohne-e2e`, der noch am PR steht, wird auf „behoben“ gesetzt.
  - Neuer Fall: Bei „alpha rot“ wird ein abgebrochener jüngster alpha-Lauf übersprungen.
  - Die Fälle sind rot, wo das Verhalten fehlt.
  - Danach `scripts/stau-waechter.sh` bereinigen (Befund, `E2E_CHECKS`, `E2E_AUSWAHL`, `automerge_seit`, Kopf).
  - Selbsttest grün.

## 4. Workflows

- [x] 4.1 `scripts/ci-stufen.test.sh` neu als Formtest des neuen Ablaufs. Er prüft:
  - Im PR läuft nur `schnell` ohne Bedingung.
  - `rust`, `frontend`, `e2e` und `berichte` tragen am Job `push || voll`.
  - Auslöser `labeled`, aber kein `auto_merge`.
  - Concurrency auf Workflow-Ebene: im PR je Ref mit Abbruch, beim Push je Lauf.
  - Testjobs mit Gruppe je Branch und Abbruch, Frontend je Shard.
  - `release` mit eigener Gruppe ohne Abbruch und `needs: [schnell, rust, frontend, e2e]`.
  - `e2e.yml` nur noch `workflow_call`.
  - Kein Verweis mehr auf `ci-auswahl.sh`.
  - Der Test ist rot.
- [x] 4.2 `.github/workflows/ci.yml` umbauen (D1–D3, D5: Job `aenderungen` und Bedingungen an jedem Schritt entfallen, Kopf neu). `.github/workflows/e2e.yml` auf `workflow_call` zurückschneiden (D4, Kopf neu). Kopf von `coverage.yml` und `release.yml` nachziehen. `ci-stufen.test.sh` grün.
- [x] 4.3 `scripts/runner/ci-schritte.test.sh`, `scripts/runner/select-runner.sh`, `scripts/runner/README.md`, `scripts/e2e-anteile.mjs`, `frontend/playwright.config.ts` (Verweise) und `scripts/ci-messung.sh` nachziehen. Ihre Selbsttests grün.
- [x] 4.4 `scripts/ci-auswahl.sh`, `scripts/ci-auswahl.test.sh`, `scripts/nur-umnummeriert.sh` und `scripts/nur-umnummeriert.test.sh` entfernen. Aufrufe in `scripts/check-all.sh` (Selbsttests), Kommentare in `scripts/bereiche.sh` und weitere Verweise per grep bereinigen. `check-all.sh --nur schnell` grün.

## 5. Regeln, Doku, Architektur

- [x] 5.1 `scripts/AGENTS.md`:
  - „Zwei Stufen im PR“ und „Im PR laufen nur die betroffenen Suiten“ werden durch „Leichte PR-Prüfung“ ersetzt: PR nur Pflicht-Checks, `voll`, Kanal mit Abbruch, Release nie abbrechen, Ruleset-Liste.
  - Nachziehen: Stau-Wächter, Baut mit Ziel-Branch („fertig“), Umnummerierung, e2e-Shards.
  - Ebenso Wurzel-`AGENTS.md` (Gates), `frontend/e2e/AGENTS.md`, `README.md` (Gate), `.github/pull_request_template.md` („Geprüft“).
  - Prettier ist grün für `frontend/`.
- [x] 5.2 Skill `dev-zunder-ausfuehren`:
  - vor dem PR lokal `check-all.sh --geaendert --ohne-e2e`
  - Label `voll` statt `e2e`
  - „fertig“ heißt Auto-Merge an
  - Kästchen „check-all.sh grün“ gilt mit dem lokalen Lauf als belegt
  - „Baut mit Ziel-Branch rot“ unverändert
  - Belegt durch einen grep, der das Label `e2e` und „Zwei Stufen“ unter `.claude/` nicht mehr findet.
- [x] 5.3 Neue ADR (nächste freie Nummer über `origin/alpha`, `scripts/check-adr-nummern.sh`) „Ein PR prüft leicht, die Suiten laufen auf den Kanal-Branches“ mit `ersetzt: ADR-0026` und Prüfblock. ADR-0026 auf `status: ersetzt`, `ersetzt_durch`. ADR-0025 bleibt unverändert (Job-Id `aenderungen` bleibt in `e2e.yml`). `docs/architektur/07-verteilungssicht.md` mit Diagramm, Text und `Stand`. Architektur-Wächter in `check-all.sh --nur schnell` grün.

## 6. Gesamtprüfung

- [x] 6.1 `./scripts/check-all.sh --nur schnell` lokal grün (enthält alle Selbsttests der Gate-Skripte und den Architektur-Wächter). Ein grep über das Repo (ohne Archive) findet `ci-auswahl`, `nur-umnummeriert`, das Label `e2e` als „fertig“ und die „zweite Stufe“ nur noch als Rückblick (ADR-0026, Kopfkommentare mit „früher“), nicht als geltende Regel.

## Workflow follow-up

- Review vor dem PR, `/opsx:archive` (Purpose von `pr-pruefstufen` in der Haupt-Spec neu fassen), dann `alpha` hineinmergen und pushen.
- In der PR-Beschreibung steht der Ruleset-Handgriff für Ruben als Merge-Bedingung.
- Nach dem Merge: zwei Merges kurz hintereinander auf `alpha` beobachten (design.md, Risiken).
