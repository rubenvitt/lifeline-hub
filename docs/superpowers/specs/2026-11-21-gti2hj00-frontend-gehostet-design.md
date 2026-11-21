# Frontend-Anteile wieder auf GitHub (LLH-2016)

Stand: 21.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/gti2hj004h9hl2qtg1feb6op ·
Freigabe: Ruben im Chat, 21.11.2026 („ja mach das. und automerge“)

**Absicht.** Der r-server (12 Kerne, 62 GB) fährt vier Plätze mit je 3 Kernen und 11 GB. Mit
ADR-0075 kamen je Push zehn Jobs dorthin; überbucht riss e2e das Zeitlimit, und die Rust-Suite
lief in den Speicherdeckel. Die Frontend-Anteile profitieren am wenigsten vom Server (kein
Rust-Build, den `sccache` warm hält) und gehen zurück zu GitHub.

**Ziele.** Auf dem Server nur Rust-Suite, `e2e-Binary`, vier e2e-Anteile. PR-Läufe bleiben bei
GitHub (ADR-0075). **Nicht-Ziel:** Plätze und Grenzen im Repo festschreiben; die stehen in
`/etc/lifeline-runner/runner.env` auf dem Server.

**Ansätze.** (1) Job `frontend` fest auf `ubuntu-latest` (gewählt: eine Zeile, kein neuer
Schalter). (2) Zweite Repo-Variable nur für Frontend: mehr Schalter, kein Bedarf. (3) Plätze
vermehren: der Server hat die Kerne nicht.

**Entwurf.** `suiten.yml`: `frontend` ohne `needs: runner`, `runs-on: ubuntu-latest`. Wächter
`ci-stufen.test.sh` und `ci-schritte.test.sh` nachziehen. ADR-0076 präzisiert ADR-0075. README
(„Plätze und Größe“ mit der Empfehlung für diesen Server), `scripts/AGENTS.md`, Kapitel 7.
