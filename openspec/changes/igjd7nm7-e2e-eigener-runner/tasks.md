# Tasks

## 1. Läufe räumen auf (Spec `e2e-lauf-aufraeumen`, D6)

- [ ] 1.1 `createRunDir(prefix)` in `frontend/e2e/lauf-kern.ts` per TDD: legt das Verzeichnis an, löscht gleichpräfixige älter als 24 h, lässt jüngere stehen, warnt bei nicht löschbaren; belegt durch einen Node-Test mit gesetzten mtimes, der vorher rot war
- [ ] 1.2 `deleteRunDir(envKey)` per TDD: löscht das Verzeichnis zum DB-Pfad aus der Umgebungsvariablen, ohne Variable kein Fehler; belegt durch denselben Test
- [ ] 1.3 `playwright.config.ts` und `playwright.doku.config.ts` auf `createRunDir` umstellen, je ein `globalTeardown` mit `deleteRunDir`; belegt durch einen e2e-Teillauf (eine Spec, grün und einmal absichtlich rot), nach dem kein `lifeline-e2e-*` im Temp-Verzeichnis übrig ist, und einen Bildlauf-Probelauf für `lifeline-doku-*`
- [ ] 1.4 Regel in `frontend/e2e/AGENTS.md` („Lauf-Verzeichnis nur über `createRunDir`“), Prettier grün

## 2. Runner-Wahl in der CI (Spec `ci-eigener-runner`, D3/D4)

- [ ] 2.1 `scripts/runner/select-runner.sh` per TDD mit `scripts/runner/select-runner.test.sh` (Label gesetzt/leer, PR eigenes Repo, PR aus Fork, Push), Selbsttest in Schritt 11 von `check-all.sh`; `check-all.sh --nur schnell` grün
- [ ] 2.2 `aenderungen` gibt `runner` aus; `binaer` und `e2e` mit `runs-on: ${{ needs.aenderungen.outputs.runner || 'ubuntu-latest' }}`; Schritte mit `sudo`, apt- und Rust-Cache nur bei `runner.environment == 'github-hosted'`; Browser-Schritt warnt bei abweichender Image-Version; belegt durch `actionlint` (falls vorhanden, sonst YAML-Parse) und Durchsicht, dass Job- und Check-Namen unverändert sind
- [ ] 2.3 Kopfkommentar von `ci.yml` um den Absatz zum eigenen Runner ergänzen

## 3. Server-Seite (Spec `ci-eigener-runner`, D1/D2/D5)

- [ ] 3.1 `scripts/runner/Dockerfile` (gepinntes `actions-runner`-Basisimage, Browser samt Systempaketen in der Lockfile-Version, nasm, build-essential, pkg-config, rustup, sccache, kein `sudo` für `runner`) und `scripts/runner/build-image.sh`; belegt durch `docker build` hier (falls ein Docker-Daemon läuft) und `sudo -n true` im Container, das scheitert
- [ ] 3.2 `scripts/runner/runner-loop.sh` per TDD mit `scripts/runner/runner-loop.test.sh` (gefälschte `curl`/`docker`: JIT-Abruf, `docker run --rm` ohne Socket und Privilegien mit Grenzen und Volumes, Pause wächst bei API-Fehlern, Token nie in der Kommandozeile des Containers), Selbsttest in Schritt 11
- [ ] 3.3 systemd-Units `lifeline-runner@.service`, `lifeline-runner-image.service`/`.timer`, Beispiel `runner.env`; `systemd-analyze verify`, falls vorhanden
- [ ] 3.4 `scripts/runner/README.md`: Server einrichten (Docker, Nutzer, Token mit Modus 600, Klon, Units für vier Plätze), Fork-Freigabe im Repo, `E2E_RUNNER` setzen und leeren, Caches leeren, Image neu bauen
- [ ] 3.5 Dependabot-Eintrag `docker` für `/scripts/runner`

## 4. Dokumentation der Entscheidung (D7)

- [ ] 4.1 ADR mit nächster freier Nummer (Regeln, Prüfung mit `verlange`/`verbiete`, manuell die Fork-Freigabe); `scripts/check-architektur.sh` grün
- [ ] 4.2 Kapitel 7 (Abschnitt CI-Runner), Kapitel 9 nach der auf `alpha` gültigen Form, Abschnitt „Eigener Runner“ in `scripts/AGENTS.md`; Wächter grün

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh --nur schnell` lokal grün, volle Suiten über die CI des PRs (ohne `E2E_RUNNER`, also unverändert auf GitHub)
- [ ] 5.2 Review (Fan-out über Sicherheit, Workflow-Logik, Aufräumen) und bestätigte Funde behoben

## Workflow follow-up

- `/opsx:archive` im selben Branch vor dem PR.
- Nach dem Merge (Ruben): Server nach README einrichten, Fork-Freigabe setzen, `E2E_RUNNER` für einen Probe-PR setzen.
