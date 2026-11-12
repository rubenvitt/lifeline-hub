# Proposal

## Why

Die e2e-Suite ist der Engpass jedes PR-Laufs (45 bis 65 Minuten je Shard), und GitHub begrenzt die
Zahl gleichzeitiger Jobs: stehen mehrere PRs an, warten ihre Shards hintereinander (LLH-1660,
LLH-1662). Ruben hat schon einen eigenen Server; damit entfällt das Kostenargument, das LLH-1666
vertagt hatte. Ein dauerhafter Rechner bringt aber zwei Bedingungen mit: kein fremder Code darf
auf ihm laufen (das Repo ist öffentlich), und die Tests MÜSSEN hinter sich aufräumen. Heute legt
jeder e2e-Lauf `/tmp/lifeline-e2e-*/` an (SQLite-DB samt `karten/`,
`frontend/playwright.config.ts`) und löscht es nie; auf den Wegwerf-Runnern von GitHub fällt das
nicht auf, auf einem Server läuft die Platte voll.

## What Changes

- **Die Läufe räumen auf:** Beide Playwright-Konfigurationen (Suite und Bildlauf der
  Anwenderdoku) löschen ihr Lauf-Verzeichnis am Ende, auch nach roten Tests, und beim Start
  verwaiste Verzeichnisse früherer, abgebrochener Läufe. Das gilt lokal genauso.
- **Eigener Runner für `e2e-Binary` und die vier e2e-Shards:** Sie laufen auf Rubens Server,
  wenn die Repo-Variable `E2E_RUNNER` ein Runner-Label nennt und der Lauf nicht aus einem Fork
  stammt; sonst wie bisher auf `ubuntu-latest`. Job- und Check-Namen bleiben unverändert (Required
  Checks im Ruleset 17017911).
- **Ein frischer Container je Job:** Auf dem Server startet je Platz eine Schleife einen
  Runner-Container mit Einmal-Registrierung (JIT), der nach genau einem Job endet und gelöscht
  wird. Das Image bringt Browser, ihre Systempakete und die Build-Werkzeuge mit; kein `sudo`
  im Job. Ein Compiler-Cache (`sccache`) auf einem Volume hält den Debug-Build warm und begrenzt
  seine Größe selbst.
- **Einrichtung im Repo:** Image, Schleife, systemd-Unit und Anleitung unter `scripts/runner/`,
  die Schleife mit Selbsttest im Sammel-Gate.
- **ADR** zur Entscheidung samt Sicherheitsauflagen (Freigabe für Fork-Workflows, kein
  Docker-Socket im Container).

## Capabilities

### New Capabilities
- `ci-eigener-runner`: Wo die e2e-Jobs der CI laufen, wer auf den eigenen Runner darf, wie man
  zurückschaltet und dass ein Job dort keine Spuren hinterlässt.
- `e2e-lauf-aufraeumen`: Ein e2e- oder Bildlauf hinterlässt kein Lauf-Verzeichnis.

### Modified Capabilities
- keine

## Impact

- `.github/workflows/ci.yml`: Jobs `binaer` und `e2e` (Runner-Wahl, Schritte für gehostete
  Runner nur dort). LLH-1662 ändert denselben Job (wann e2e läuft); Konflikte beim Mergen sind
  zu erwarten, inhaltlich überschneiden sie sich nicht.
- `frontend/playwright.config.ts`, `frontend/playwright.doku.config.ts`, `frontend/e2e/lauf-kern.ts`,
  neue globale Aufräumung.
- Neu: `scripts/runner/` (Dockerfile, Schleife, Unit, README), Selbsttest in `check-all.sh`.
- Doku: ADR unter `docs/architektur/entscheidungen/`, Kapitel 7 (Verteilung) und 9.
- Außerhalb des Repos, von Ruben: Server einrichten, Fine-grained Token mit
  „Administration: write“ auf dem Server, Repo-Variable `E2E_RUNNER`, Einstellung „Require
  approval for all external contributors“.
