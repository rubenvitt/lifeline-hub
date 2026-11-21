---
id: ADR-0075
titel: Die schweren Suiten laufen bei Push in Wegwerf-Containern auf dem eigenen Server, PR-Läufe nie
status: akzeptiert
datum: 2026-11-21
gilt_fuer:
  - scripts/runner/**
  - .github/workflows/ci.yml
  - .github/workflows/pr.yml
  - .github/workflows/suiten.yml
  - .github/workflows/e2e.yml
ersetzt: ADR-0025
herleitung:
  - docs/superpowers/specs/2026-11-21-swahunsm-suiten-eigener-server-design.md
  - LLH-2014 (mit Ruben am 21.11.2026 abgestimmt)
  - openspec/changes/archive/2026-11-12-igjd7nm7-e2e-eigener-runner/design.md
---

# ADR-0075: Die schweren Suiten laufen bei Push in Wegwerf-Containern auf dem eigenen Server, PR-Läufe nie

## Regeln

- MUST: Welcher Runner die Rust-Suite, die Frontend-Anteile, `e2e-Binary` und die e2e-Anteile
  fährt, entscheidet allein `scripts/runner/select-runner.sh` im Job `runner` von `suiten.yml`,
  bei einem PR in der Fassung des Ziel-Branches; die Jobs lesen die Wahl mit `ubuntu-latest` als
  Rückfall.
- MUST: Die Weiche gibt das Label des eigenen Runners nur bei `push` aus; jeder PR-Lauf, auch mit
  dem Label `voll`, bleibt auf GitHub.
- MUST NOT: Ein Workflow trägt das Label des eigenen Runners oder `self-hosted` fest in `runs-on`.
- MUST: In den Repo-Einstellungen gilt „Require approval for all external contributors“.
- MUST: Ein Container nimmt genau einen Job (JIT-Registrierung) und endet mit `--rm`; der Platz
  meldet den Runner danach und beim Stopp bei GitHub ab.
- MUST NOT: Ein Runner-Container bekommt Docker-Socket, `--privileged`, das Host-Netz, `sudo`
  oder das Token für die Registrierung. Geteilt ist nur das Volume des Compiler-Caches.
- MUST: Schritte, die `sudo` oder Caches der gehosteten Runner brauchen, tragen
  `runner.environment == 'github-hosted'` (Wächter: `scripts/runner/ci-schritte.test.sh`).
- MUST NOT: iOS-Kern, Schnellprüfungen, Berichte und Release laufen auf dem eigenen Server.

## Prüfung

```sh
verlange 'runner="\$\("\$weiche" "\$EREIGNIS" "\$LABEL"\)"' .github/workflows/suiten.yml
verlange 'git show HEAD\^1:scripts/runner/select-runner\.sh' .github/workflows/suiten.yml
verlange "runs-on: [$][{][{] needs\.runner\.outputs\.runner [|][|] 'ubuntu-latest' [}][}]" .github/workflows/suiten.yml
verlange "runs-on: [$][{][{] inputs\.runner [|][|] 'ubuntu-latest' [}][}]" .github/workflows/e2e.yml
verlange '^\[ "\$ereignis" = push \] \|\| gehostet$' scripts/runner/select-runner.sh
verbiete 'runs-on:.*(self-hosted|lifeline-e2e)' '.github/workflows/*.yml'
verlange 'docker run --rm' scripts/runner/runner-loop.sh
verlange 'github_api DELETE' scripts/runner/runner-loop.sh
verbiete 'lifeline-cargo-registry|\.cargo/registry' scripts/runner/runner-loop.sh
verbiete 'docker\.sock|--privileged|--network host|--network=host|TOKEN_FILE.*docker run' scripts/runner/runner-loop.sh
verlange 'purge -y sudo' scripts/runner/Dockerfile
verlange "runner[.]environment == 'github-hosted'" .github/workflows/e2e.yml .github/workflows/suiten.yml
# Schritte mit `sudo` im Detail: scripts/runner/ci-schritte.test.sh, die Job-Form:
# scripts/ci-stufen.test.sh (beide Schritt 11). Die Fork-Freigabe ist eine Repo-Einstellung und
# nicht maschinell prüfbar (scripts/runner/README.md).
```

## Kontext

ADR-0025 brachte nur die e2e-Jobs auf den eigenen Server, und auf Kanal-Branches warteten Rust-
und Frontend-Suite weiter auf GitHub-Runner, während der Server kaum ausgelastet war. PR-Läufe
mit `voll` liefen dort ungemergten Code. Und gestoppte Plätze ließen Runner-Registrierungen
zurück, die im Repo als „offline“ stehen blieben.

## Konsequenzen

Die Kanal-Läufe hängen an der Kapazität des Servers: mehr Jobs als Plätze warten. Läuft die
Rust-Suite dort, pflegen die Schnellprüfungen den Cargo-Cache bei GitHub für die PR-Läufe. Das
Image muss die Desktop-Pakete der Rust-Suite tragen, und nach einem Merge an `scripts/runner/`
ist der Neubau und Neustart der Plätze Handarbeit (README). Ein leeres `E2E_RUNNER` bringt
weiterhin alles auf GitHub. Die Regel aus ADR-0048, Runner-Wahl und Fork-Sperre blieben in
`e2e.yml`, präzisiert diese ADR: die Wahl steht in `suiten.yml`, und eine Fork-Sperre entfällt,
weil kein PR-Lauf auf den Server geht.
