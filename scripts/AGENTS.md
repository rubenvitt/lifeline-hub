# Gate- und Release-Skripte — Regeln

Gilt für `scripts/` und `.github/workflows/`, zusätzlich zur `AGENTS.md` der Wurzel.

## Sammel-Gate (LFH-235/F17)

`./scripts/check-all.sh` vor dem Merge: `check-fmt.sh` (rustfmt + Prettier) → `pnpm lint` →
`check-typ-codegen.sh` → `cargo test` (Workspace, Hülle getrennt) → Vitest → `check-deps.sh` → `pnpm e2e` →
`release-ruhefenster.test.sh` + `ki-notizen.test.mjs` → `check-deps.test.sh` →
`check-migrationen.sh` → `check-all.test.sh` + `bauziel.test.sh` → `check-toolversionen.sh` →
`check-openspec-archiv.sh`.
- **Ein roter Schritt hält die folgenden nicht auf** (LFH-386, `scripts/lib/schritte.sh`): alle
  laufen, am Ende Gesamtstatus je Schritt und EIN Exit-Code; `--abbrechen` ist das Opt-in für
  den schnellen Abbruch. Schritte laufen als eigenes Kommando in einer Subshell mit `set -e`,
  **nie** in einer Bedingung (`if`/`||` schaltet errexit im ganzen Körper ab). Übersprungen
  meldet ein Schritt mit `return "$UEBERSPRUNGEN_RC"`, nicht mit 0.
- Prettier prüft nur `frontend/`; nicht idempotent (nach `--write` noch rot → nochmal).
  Ausnahmen nur mit Begründung in `frontend/.prettierignore`. Kein `.git-blame-ignore-revs`.
- **Node und pnpm stehen nur in `[tools]` von `mise.toml`** (LFH-773): Skripte rufen
  `mise exec -- …`, Workflows `jdx/mise-action` ohne `install_args`. `packageManager`,
  `engines.node` und der Devcontainer spiegeln die Zahl; `scripts/check-toolversionen.sh`
  prüft das und bricht an jedem harten `node@…`/`pnpm@…` in `scripts/`, `.github/`, README, Skills.
- Env-Hygiene über `scripts/lib/dev-env.sh`, keine handgepflegte `env -u`-Liste; Isolation wo
  möglich im Test (`config::tests::parse_hermetisch`).
- **Jeder Checkout baut in sein eigenes `target/`** (LFH-520, `.cargo/config.toml`, schlägt
  das globale `build.target-dir`; `CARGO_TARGET_DIR` schlägt beide). In einem geteilten Ziel
  teilen sich Worktrees Fingerprints und Binaries (Hash aus dem Pfad relativ zur
  Workspace-Wurzel, Frische per mtime), und Tests liefen still gegen einen fremden Stand.
  Schritt 3, 4 und 7 prüfen das vorab (`scripts/lib/bauziel.sh`, rot bei fremdem Ziel ohne
  Umgebungsvariable), Selbsttest `scripts/bauziel.test.sh`; Gate und Playwright nennen das
  gestartete `Backend-Binary:`. Kosten: ~3 min kalt, bis 19 GB je voll gebautem Worktree,
  frei mit dem Worktree. Ein älterer Worktree ohne die Datei erbt unter einem Main-Checkout
  mit ihr dessen Ziel, bis er auf `alpha` vorgezogen ist
  (`openspec/changes/archive/2026-09-30-lfh-520-cargo-artefakte-isolieren/design.md`).
- Optionaler pre-push-Hook: `git config core.hooksPath .githooks`.
- **Release je Arbeitsschub** (`scripts/release-ruhefenster.sh`, Aufruf in `release.yml`); ein übersprungener Release-Job
  ist Normalfall; `chore(release):` zählt nicht als neuer Commit. Notizen über
  `scripts/release/ki-notizen.mjs` (Rückfall auf konventionelle Notizen, `maxTurns: 1`, Vorlage
  `KI_PROMPT` in `release.config.mjs`).
- **Advisories** (`scripts/check-deps.sh`): Rust `.cargo/audit.toml` (Ignorierliste mit
  Begründung); Frontend nur `overrides` in `frontend/pnpm-workspace.yaml`, jeder `high`-Fund bricht
  (`--audit-level=high`).
  **Kein leerer `auditConfig.ignoreGhsas`-Block** (ein Eintrag ohne Verstoß gilt selbst als
  Verstoß). Overrides pflegen Bereich **und** Zielversion. Der Audit prüft das **Lockfile** in
  einem Wegwerf-Verzeichnis (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; nie
  `node_modules`; Node/pnpm aus `mise.toml`), Selbsttest `scripts/check-deps.test.sh`.
