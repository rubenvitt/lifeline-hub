---
id: ADR-0078
titel: Alle CI-Jobs laufen auf den gehosteten Runnern von GitHub, ein eigener Server ist zurückgebaut
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - .github/workflows/ci.yml
  - .github/workflows/pr.yml
  - .github/workflows/suiten.yml
  - .github/workflows/e2e.yml
ersetzt: ADR-0075
herleitung:
  - Entscheidung Ruben 22.11.2026 (Rückbau nach „alpha rot“, PR #1551)
  - LLH-2014, LLH-2016 (der zurückgebaute Stand)
---

# ADR-0078: Alle CI-Jobs laufen auf den gehosteten Runnern von GitHub, ein eigener Server ist zurückgebaut

## Regeln

- MUST: Jeder Job in `ci.yml`, `pr.yml`, `suiten.yml` und `e2e.yml` läuft auf `ubuntu-latest`.
- MUST NOT: Ein Workflow wählt seinen Runner aus einer Repo-Variablen, einer Eingabe oder einem
  anderen Job, oder trägt `self-hosted` bzw. das Label eines eigenen Runners in `runs-on`.
- MUST NOT: Ein Schritt hängt an `runner.environment`.
- MUST: Wer wieder einen selbst betriebenen Runner einführt, schreibt dafür eine neue ADR, die
  diese ersetzt.

## Prüfung

```sh
verbiete 'runs-on:.*(self-hosted|lifeline-e2e|vars\.|inputs\.|needs\.)' '.github/workflows/*.yml'
verbiete 'runner\.environment|E2E_RUNNER' '.github/workflows/*.yml'
test ! -e scripts/runner
# Die Job-Form im Detail: scripts/ci-stufen.test.sh (Schritt 11), „läuft auf GitHub“.
```

## Kontext

Seit LLH-1666 liefen die e2e-Jobs, seit LLH-2014 auch die Rust-Suite bei Push auf einem eigenen
Server. Der Betrieb kostete mehr, als er sparte: ein Image mit Toolchain und Browsern, das nach
jedem Bump neu gebaut werden musste, Toolchain-Updates, die im Container scheiterten (LLH-2015),
und eine Rust-Suite, die mit 6 GB je Container nie durchlief (rustc braucht für `lifeline_hub`
gemessen rund 13 GB Spitze, PR #1551).

## Konsequenzen

Die CI hängt nur an GitHub; Laufzeit und Plattenplatz der gehosteten Runner sind die Grenze.
`scripts/runner/`, die Runner-Wahl in `suiten.yml`, die Eingabe `runner` von `e2e.yml` und die
Repo-Variable `E2E_RUNNER` entfallen. Ersetzt ADR-0075 und damit ADR-0076, die nur deren
Runner-Wahl präzisierte.
