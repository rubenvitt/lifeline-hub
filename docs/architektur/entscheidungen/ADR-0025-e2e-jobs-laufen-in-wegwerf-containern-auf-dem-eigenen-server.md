---
id: ADR-0025
titel: Die e2e-Jobs der CI laufen in Wegwerf-Containern auf dem eigenen Server
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - scripts/runner/**
  - .github/workflows/ci.yml
herleitung:
  - openspec/changes/archive/2026-11-12-igjd7nm7-e2e-eigener-runner/design.md
  - LLH-1666 (mit Ruben am 12.11.2026 abgestimmt)
---

# ADR-0025: Die e2e-Jobs der CI laufen in Wegwerf-Containern auf dem eigenen Server

## Regeln

- MUST: Welcher Runner `e2e-Binary` und die e2e-Shards fährt, entscheidet allein
  `scripts/runner/select-runner.sh` im Job `aenderungen`, bei einem PR in der Fassung des
  Ziel-Branches; die Jobs lesen es aus `needs.aenderungen.outputs.runner` mit `ubuntu-latest` als
  Rückfall.
- MUST NOT: Ein Workflow trägt das Label des eigenen Runners oder `self-hosted` fest in `runs-on`.
- MUST: Ein Lauf aus einem Fork bleibt auf GitHub-Runnern (Spec `ci-eigener-runner`).
- MUST: In den Repo-Einstellungen gilt „Require approval for all external contributors“; vor
  einer Freigabe werden die Änderungen des Forks unter `.github/` gelesen.
- MUST: Ein Container nimmt genau einen Job (JIT-Registrierung) und endet mit `--rm`.
- MUST NOT: Ein Runner-Container bekommt Docker-Socket, `--privileged`, das Host-Netz, `sudo`
  oder das Token für die Registrierung. Geteilt ist nur das Volume des Compiler-Caches.
- MUST: Schritte, die `sudo` oder Caches der gehosteten Runner brauchen, tragen
  `runner.environment == 'github-hosted'`.

## Prüfung

```sh
verlange "runs-on: .*needs\\.aenderungen\\.outputs\\.runner [|][|] 'ubuntu-latest'" .github/workflows/ci.yml
verlange 'git show HEAD\^1:scripts/runner/select-runner\.sh' .github/workflows/ci.yml
verbiete 'runs-on:.*(self-hosted|lifeline-e2e)' '.github/workflows/*.yml'
verlange 'docker run --rm' scripts/runner/runner-loop.sh
verbiete 'lifeline-cargo-registry|\.cargo/registry' scripts/runner/runner-loop.sh
verbiete 'docker\.sock|--privileged|--network host|--network=host|TOKEN_FILE.*docker run' scripts/runner/runner-loop.sh
verlange 'purge -y sudo' scripts/runner/Dockerfile
verlange "runner[.]environment == 'github-hosted'" .github/workflows/ci.yml
# Schritte mit `sudo` im Detail: scripts/runner/ci-schritte.test.sh (Schritt 11).
# Die Fork-Freigabe ist eine Repo-Einstellung und nicht maschinell prüfbar (scripts/runner/README.md).
```

## Kontext

Die e2e-Suite ist der Engpass jedes PR-Laufs, und GitHub begrenzt gleichzeitige Jobs. Ruben hat
einen eigenen Server; damit entfiel das Kostenargument. Ein dauerhafter Rechner verlangt aber,
dass kein fremder Code auf ihm läuft (das Repo ist öffentlich) und dass ein Job nichts für den
nächsten hinterlässt. Ein Runner direkt auf dem Host hätte beides dem Workflow aufgebürdet.

## Konsequenzen

Jeder Job beginnt leer; der geteilte Compiler-Cache hält den Debug-Build warm, kann aber von
jedem Lauf des eigenen Repos vergiftet werden, auch von Dependabot-PRs (betrifft nur e2e, die
Release-Artefakte baut GitHub). Der Server-Klon folgt `alpha`: jeder Merge ist Code auf dem Host
mit dem Admin-Token. Beides hat Ruben am 12.11.2026 angenommen. Leeres `E2E_RUNNER` heißt GitHub.
