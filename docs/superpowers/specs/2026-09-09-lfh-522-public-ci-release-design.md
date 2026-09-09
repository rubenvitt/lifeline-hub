# LFH-522 — Projekt public setzen, CI und Release-Flow einrichten

Stand: 2026-09-09 · Status: Design freigegeben · Umsetzung in vier Subtasks (Abschnitt 9)

## 1. Ziel und Entscheidung

Das Repo `rubenvitt/lifeline-hub` wird auf GitHub **öffentlich**, bekommt ein CI-Gate,
einen automatisierten Release-Flow (0.x auf `main`, Kanäle `beta`/`alpha` vorbereitet) und Release-Artefakte
für Linux (x86_64, arm64), macOS (arm64), Windows (x86_64, `.exe`) sowie ein Multi-Arch-
Docker-Image. Bis heute gibt es **kein CI**; das Gate ist `scripts/check-all.sh` lokal.

**Warum GitHub und nicht das eigene Forgejo.** Beide Wege wurden geprüft. Forgejo mit dem
laufenden Ubuntu-Runner trägt Linux, Windows (Cross-Build, siehe Abschnitt 5) und Docker,
aber **kein macOS**: Cross-Compilation braucht das Apple-SDK, dessen Lizenz die Nutzung auf
Nicht-Apple-Hardware ausschließt. Ein öffentliches GitHub-Repo bekommt kostenlos native
Linux-, arm64-, Windows- und macOS-Runner, und die gewünschten Integrationen (Dependabot,
Codecov, ClickUp-GitHub) hängen an GitHub. Entscheidung des Auftraggebers: GitHub public.

**Nicht-Ziele.** Kein Forgejo-Mirror, kein Nightly-Kanal, kein `cargo clippy -D warnings`
im Gate (Bestand hat ~27 Warnungen — ein rot geborenes Gate wird abgeschaltet, CLAUDE.md).
Keine Signierung/Notarisierung der Binaries (eigenes Ticket, wenn gebraucht).

## 2. Vorbedingungen für „public“

- **Secret-Scan der gesamten Historie ist grün**: `gitleaks git .` über 1888 Commits,
  0 Funde (2026-09-09). Die Historie bleibt, kein Rewrite, kein frisches Repo.
- **Lizenz: keine.** Das Repo trägt keine LICENSE-Datei; damit gilt „alle Rechte
  vorbehalten“. Das README sagt das **ausdrücklich**, damit niemand aus der Sichtbarkeit eine
  Nutzungserlaubnis herausliest. Eine spätere Öffnung (z. B. AGPL-3.0) bleibt jederzeit
  möglich, solange keine Fremdbeiträge ohne CLA gemergt wurden — ohne Lizenz sind keine zu
  erwarten.
- **README** (heute nicht vorhanden): Zweck (Lagehaltung/Führungsunterstützung für den
  Einsatz, single binary), Build (`scripts/build-release.sh`), Betrieb (Verweis auf
  `docs/betrieb/packaging.md`), Lizenzhinweis, CI-Badge.
- **dev-seeds** enthalten Testpasswörter; das sind Testdaten und dürfen sichtbar sein.
- **Das Umschalten selbst** (`gh repo edit --visibility public`) ist outward-facing und wird
  nur mit ausdrücklichem Go des Auftraggebers im Moment des Befehls ausgeführt.

## 3. Repo-Einstellungen nach dem Umschalten

Per `gh api`, in Subtask 4:

- Branch-Protection (Ruleset) auf `main` — und per Namensmuster gleich auf `beta`/`alpha`,
  damit die Kanäle beim Anlegen geschützt sind: PR-Pflicht, Required Check
  `gate`, keine Force-Pushes. Der Release-Bot committet den Version-Bump auf die geschützten
  Branches — deshalb bekommt er eine **Bypass-Regel** (GitHub App oder PAT, s. Abschnitt 4).
- Dependabot-Alerts und Security-Updates an; Workflow-Token standardmäßig read-only, Rechte
  je Job explizit.
- **Actions-Berechtigung: „GitHub-eigene + verifizierte + Allowlist“**, nicht „nur
  verifizierte“ (Korrektur am ersten Entwurf dieser Spec, gemessen beim Schreiben der
  Workflows): `dtolnay/rust-toolchain`, `Swatinem/rust-cache` und `jdx/mise-action` sind
  nicht verifiziert, die strikte Einstellung hätte das eigene Gate blockiert. Die
  wirksame Absicherung ist ohnehin eine andere und ist umgesetzt: **jede** Action ist per
  Commit-SHA gepinnt (Tag nur im Kommentar), Dependabot hält die Pins aktuell. Ein
  verschobener Tag erreicht die Workflows damit nicht.
- Secret Scanning + Push Protection an (kostenlos für public).

## 4. Gate-Workflow `.github/workflows/ci.yml`

**Auslöser:** `pull_request` (alle Ziele) und `push` auf `main`, `beta`, `alpha` (die
beiden letzten greifen erst, wenn die Branches existieren).

**Job `gate`** (ubuntu-latest) fährt **`scripts/check-all.sh` unverändert**. Grund: CI und
lokales Gate dürfen nie auseinanderlaufen; das Skript ist die eine Durchsetzungsinstanz
(LFH-235). Damit die gepinnten `mise exec node@26.7.0 pnpm@11.10.0`-Aufrufe der Skripte
identisch laufen, installiert der Job **mise** (`jdx/mise-action`) — keine parallele
Node-Installation über `actions/setup-node`. Weitere Schritte:

- stable Rust (`dtolnay/rust-toolchain@stable`), `Swatinem/rust-cache`,
- `cargo-audit` (sonst warnt `check-deps.sh` nur; im CI soll es prüfen),
- System-Pakete für den Build: `cmake`, `nasm` (aws-lc-sys), `perl` (OpenSSL vendored),
- pnpm-Store-Cache über `mise`-Pfad, Playwright: `pnpm exec playwright install --with-deps
  chromium` (Browser-Cache über `~/.cache/ms-playwright`).
- Env-Hygiene erledigt `scripts/lib/dev-env.sh` selbst; der Runner setzt keine
  `LIFELINE_*`-Variablen.

**Job `coverage`** (parallel, ubuntu-latest, `continue-on-error: false`, aber **kein**
Required Check): `cargo llvm-cov --workspace --lcov` und `vitest run --coverage`
(`@vitest/coverage-v8` kommt als Dev-Dependency dazu), Upload mit `codecov/codecov-action`
und `CODECOV_TOKEN` aus den Repo-Secrets. Bewusst vom Gate getrennt: Coverage-Tooling darf
das Gate nie rot färben, und `cargo llvm-cov` ersetzt `cargo test` durch einen
instrumentierten Lauf — ein zweiter Lauf im selben Job verdoppelte die Zeit.

**Playwright-Parallelität:** der Gate-Job setzt `PW_WORKERS: 2`. Die Config sieht diese
Schraube vor (`Number(process.env.PW_WORKERS ?? 3)`); drei Worker überzeichnen einen
2-vCPU-Runner, und Überlast ist die bekannte Flake-Quelle dieser Suite. Das ist eine
Env-Belegung im Workflow, **keine** Änderung an der Config — lokal bleiben es drei.

**Nicht enthalten:** e2e-Retries, Matrix über Betriebssysteme (das Gate läuft nur auf
Linux; die Cross-Plattform-Frage beantworten die Artefakt-Builds pro Release).

## 5. Build-Änderungen (Subtask 2)

Grundlage ist ein **Spike vom 2026-09-09** (macOS-Host, `x86_64-pc-windows-gnu` mit
MinGW-w64 14, cmake, nasm, perl): die `.exe` baut und linkt, hängt nur an Windows-System-DLLs
(UCRT, `ws2_32`, `bcrypt`, `crypt32`), also **keine** MinGW-Laufzeit-DLLs — „Datei
kopieren, starten“ gilt ab Windows 10. Laufzeit wurde lokal **nicht** verifiziert (kein
Wine); das übernimmt der Smoke-Test in Abschnitt 7.

Vier Änderungen, jede mit Begründung:

1. **OpenSSL `vendored`, global.** `openssl = { version = "0.10", features = ["vendored"] }`
   als direkte Dependency in `Cargo.toml`. Cargo-Feature-Unifikation aktiviert `vendored`
   für den unvermeidbaren `openssl-sys`-Pull aus `webauthn-rs` (Kommentar in `Cargo.toml`
   und `docs/betrieb/packaging.md`). Damit binden **alle** Binaries OpenSSL statisch — die in
   `packaging.md` offen gelassene „Option (b)“ ist eingelöst, die dortigen Abschnitte
   „System-OpenSSL-Abhängigkeit“ und die Autarkie-Anmerkung werden **umgeschrieben**, nicht
   ergänzt. Build-Voraussetzung wird Perl + C-Compiler (statt pkg-config + `libssl-dev`);
   kalter Build +~2 min, gecacht. `otool -L`/`ldd`/`objdump -p` zeigen danach kein
   `libssl`/`libcrypto` mehr — das wird in Subtask 2 gemessen und in `packaging.md`
   festgehalten.
2. **`cfg(unix)`-Gate am clamd-Unix-Socket** (`src/anhang/mod.rs`, ausgelagert in zwei
   cfg-Varianten von `clamd_verbinden`, damit `clamd_scan` selbst plattformfrei bleibt):
   `clamav_client::tokio::Socket` existiert nur unter `#[cfg(unix)]`. Unter Windows bleibt
   der TCP-Zweig; eine `unix:`-Adresse führt dort zu `ScannerNichtErreichbar` mit
   `tracing::warn!` — dieselbe fail-closed-Politik wie bei jedem anderen Verbindungsfehler,
   kein neuer Fehlerpfad. Bestand hat `cfg(unix)`/`cfg(not(unix))` bereits in `main.rs`
   (Signal-Handling) und `tls/mod.rs`.
3. **`scripts/build-release.sh` bekommt einen Target-Parameter** (`--target <triple>`,
   Vorgabe: Host). Der Binary-Pfad wird `$TARGET_DIR/<triple>/release/lifeline-hub[.exe]`,
   der SBOM-Schritt und `sqlite-version`-Aufruf laufen nur, wenn das Binary auf dem Host
   ausführbar ist (Cross-Build: übersprungen mit Hinweis, der Smoke-Test in Abschnitt 7
   liefert die Zahl). Linker/CC für das Windows-GNU-Target kommen über
   `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER` etc. aus dem Workflow, nicht aus einer
   committeten `.cargo/config.toml` — eine committete Linker-Angabe bräche lokale Builds
   ohne MinGW.
4. **Dockerfile** (neu, Repo-Root): kein Multi-Stage-Build, sondern **Binary rein**. Das
   Image nimmt das im Artefakt-Workflow gebaute Linux-Binary je `TARGETARCH` aus einem
   Build-Kontext (`amd64`/`arm64`) und legt es in `gcr.io/distroless/cc-debian12` (glibc +
   libgcc, kein Shell, kein OpenSSL nötig dank vendored). Entry: `lifeline-hub`, Volume
   `/data`, `LIFELINE_DB_PATH=/data/lifeline.db`, `LIFELINE_BIND=0.0.0.0:8080`, `EXPOSE 8080`.
   Der Docker-Build baut **nicht** selbst aus Quelle — das verdoppelte die Rust-Build-Zeit
   je Architektur unter QEMU.

## 6. Release-Flow `.github/workflows/release.yml`

**Werkzeug:** `semantic-release` (Node, über pnpm im Repo-Root als Dev-Dependency, keine
globale Installation). Dafür entsteht eine **Root-`package.json`** — reines Werkzeug, `private`,
Version dauerhaft `0.0.0`, mit eigenem Lockfile. Sie ist ausdrücklich **nicht** die
Versionsquelle: die Anwendung versioniert in `Cargo.toml` und `frontend/package.json`.
Deshalb fehlt `@semantic-release/npm` in der Plugin-Liste — es würde die Werkzeugdatei bumpen
und einen npm-Publish versuchen. Die Konfiguration liegt in **`release.config.mjs`**, nicht
in `.releaserc.json`: die drei nicht offensichtlichen Entscheidungen (0.x-Regel, vorbereitete
Kanäle, zwei Versionsdateien) brauchen ihre Begründung am Ort, und JSON trägt keine Kommentare. Conventional Commits sind im Repo Bestand (`feat(etb): …`,
`fix(LFH-462): …`).

**Das Projekt ist in früher Alpha: es gibt noch nichts, was ein stabiler Kanal schützen
müsste.** Deshalb ein Branch und ein Kanal: `main` released **0.x**-Versionen ohne
Prerelease-Suffix — SemVer definiert 0.x als „alles darf sich ändern“, das ist der
Alpha-Stand, und er braucht kein `-alpha.N` obendrauf. Default-Branch bleibt `main`;
Dependabot, ClickUp und `gh pr create` zielen damit ohne weitere Einstellung richtig.

**Kanäle vorbereitet, nicht angelegt** (`.releaserc.json`): `main` → Release-Branch;
`beta` → `X.Y.Z-beta.N`; `alpha` → `X.Y.Z-alpha.N`. semantic-release ignoriert
konfigurierte Branches, die im Repo nicht existieren („If `name` doesn't match to any branch
existing in the repository, the definition will be ignored“, Workflow-Konfiguration), und
verlangt mindestens einen Release-Branch — beides erfüllt. Die Kanäle werden aktiv, sobald
der Auftraggeber die Branches anlegt, typischerweise mit der Entscheidung für 1.0. Dann
kommt der Fluss `alpha → beta → main` und die Frage nach dem Default-Branch (der Kanal, in
den neue Arbeit fließt) — heute nicht.

**0.x-Regel:** `@semantic-release/commit-analyzer` bekommt `releaseRules` mit
`{ "breaking": true, "release": "minor" }`, damit ein `BREAKING CHANGE` in der Alpha
0.x → 0.(x+1) zählt statt auf 1.0.0 zu springen. Die Zeile wird mit der bewussten
1.0-Freigabe entfernt; ein Kommentar in `.releaserc.json` sagt das.

**Erstversion:** vor dem ersten Lauf wird `v0.1.0` auf den aktuellen `main`-Stand getaggt
(passend zu `Cargo.toml`). semantic-release zählt dann ab `0.2.0`; ein Breaking Change springt
regelkonform auf `1.0.0`.

**Ablauf des Jobs `release`** (nach grünem `gate` über `workflow_run` oder als `needs`
im selben Workflow — Entscheidung: **eigener Workflow mit `workflow_run` auf `ci.yml`**,
damit `ci.yml` für PRs schlank bleibt):

1. `@semantic-release/commit-analyzer` → Version.
2. `@semantic-release/exec` (`prepareCmd`): `cargo set-version -p lifeline-hub
   ${nextRelease.version}` (cargo-edit) — bumpt `Cargo.toml` **und** `Cargo.lock`; `-p`,
   weil `karten-katalog`/`karten-service` eigene Versionen führen. Fürs Frontend
   **`pnpm -C frontend pkg set version=…`**, nicht `pnpm version`: letzteres bricht mit
   `ERR_PNPM_UNCLEAN_WORKING_TREE`, sobald der Baum Änderungen trägt — und das ist hier
   immer der Fall, weil `@semantic-release/changelog` in derselben `prepare`-Phase vorher
   läuft und CHANGELOG.md schon geschrieben hat. Gemessen beim Umsetzen; der naheliegende
   Befehl hätte jeden Release zerrissen, und zwar nach Analyse und Changelog mitten im Lauf.
3. `@semantic-release/changelog` → `CHANGELOG.md`.
4. `@semantic-release/git` committet `Cargo.toml`, `Cargo.lock`, `frontend/package.json`,
   `CHANGELOG.md` mit `chore(release): vX.Y.Z [skip ci]` und taggt.
5. `@semantic-release/github` legt das GitHub-Release an (Prerelease-Flag für
   beta/alpha) — **ohne** Assets; die kommen aus Abschnitt 7.

**Identität des Bots:** Ein Push auf den geschützten Kanal-Branch braucht Bypass. Träger ist
eine **GitHub App** des Auftraggebers (App-ID + Private Key als Secrets,
`actions/create-github-app-token`) — kein persönlicher PAT, weil der abläuft und an der
Person hängt. Die Bypass-Regel im Ruleset zeigt auf die App.

**`[skip ci]`** im Release-Commit verhindert die Schleife `release → push → ci → release`.
Der Artefakt-Workflow hängt am Release-Event, nicht am Push, und läuft trotzdem.

## 7. Artefakt-Workflow `.github/workflows/artefakte.yml`

**Auslöser:** `release: published` (Tag ist dann gesetzt, Checkout auf `${{ github.event.release.tag_name }}`).
Zusätzlich `workflow_dispatch` mit Tag-Eingabe für Nachbauten.

| Job | Runner | Target | Weg |
|---|---|---|---|
| `linux-x86_64` | ubuntu-latest | `x86_64-unknown-linux-gnu` | nativ, `build-release.sh` |
| `linux-arm64` | ubuntu-24.04-arm | `aarch64-unknown-linux-gnu` | nativ, `build-release.sh` |
| `macos-arm64` | macos-latest | `aarch64-apple-darwin` | nativ, `build-release.sh` |
| `windows-x86_64` | ubuntu-latest | `x86_64-pc-windows-gnu` | **Cross** mit `mingw-w64` (gespikt), `build-release.sh --target …` |
| `windows-smoke` | windows-latest | — | lädt die `.exe`, führt `lifeline-hub.exe sqlite-version` und `--help` aus; erst danach Upload |
| `docker` | ubuntu-latest | amd64 + arm64 | lädt beide Linux-Binaries, `docker/build-push-action` mit `platforms`, Tags `X.Y.Z`, `latest` (nur `main`), `beta`/`alpha` je Kanal, nach `ghcr.io/rubenvitt/lifeline-hub` |

**Warum Windows als Cross-Build und nicht nativ MSVC:** der GNU-Weg ist gemessen; MSVC
wäre Neuland mit eigenen OpenSSL-/NASM-Fragen. Der Windows-Runner wird stattdessen für den
**nativen Smoke-Test** genutzt, was mehr belegt als ein Build. Wer später auf MSVC will,
hat mit dem Smoke-Test schon die Abnahme dafür.

**Asset-Namen:** `lifeline-hub-<version>-<triple>[.exe]`, dazu je Binary `sha256`, und
das SBOM-Verzeichnis als `lifeline-hub-<version>-sbom.zip` (aus dem Linux-x86_64-Job, der
das Binary nativ ausführen kann). Upload per `gh release upload`.

**Frontend im Cross-Build:** `build-release.sh` baut `frontend/dist` vor `cargo build`;
`rust-embed` bettet zur Compile-Zeit ein — das gilt je Job, jeder baut das Frontend selbst
(deterministisch, ~1 min, keine Artefakt-Weitergabe nötig).

## 8. Integrationen

- **Dependabot** (`.github/dependabot.yml`): `cargo` (Root), `npm` (`/frontend`),
  `github-actions`; wöchentlich; kein `target-branch` (Default `main`); Gruppen
  `minor-und-patch` je Ökosystem, damit nicht 30 Einzel-PRs entstehen. Major-Updates einzeln. Ergänzt `check-deps.sh` (Advisories),
  ersetzt es nicht.
- **Codecov**: Token als Repo-Secret `CODECOV_TOKEN` (legt der Auftraggeber an);
  `codecov.yml` mit `informational: true` für den Status — Coverage meldet, blockiert nicht.
- **ClickUp-GitHub**: Einrichtung in ClickUp durch den Auftraggeber. Repo-seitig:
  `.github/pull_request_template.md` mit Zeile „ClickUp: LFH-NNN“ und der dokumentierten
  Branch-Konvention `<typ>/lfh-<nnn>-<slug>` (schon Skill-Standard), über die ClickUp
  Branches/PRs dem Task zuordnet.

## 9. Zerlegung in Subtasks (Reihenfolge ist Abhängigkeit)

1. **Gate-Workflow + README** — Repo bleibt privat (Actions laufen auch privat, Minuten
   sind bei einem Ein-Personen-Repo unkritisch für die kurze Phase). Enthält `ci.yml`,
   Coverage-Job, `@vitest/coverage-v8`, README. Abnahme: grüner Lauf auf einem PR.
2. **Build-Änderungen** — OpenSSL vendored global, `cfg(unix)`, Target-Parameter,
   Dockerfile, `packaging.md`-Umschreibung, Messung „kein libssl mehr gelinkt“.
   Abnahme: `./scripts/build-release.sh --target x86_64-pc-windows-gnu` lokal grün,
   `cargo test --workspace` grün.
3. **Public + Integrationen** (LFH-528) — Umschalten (mit Go), Rulesets, Dependabot,
   Codecov-Token, GitHub App. Abnahme: Repo öffentlich, Rulesets greifen (Test-Push auf
   `main` ohne PR wird abgelehnt), erster Dependabot-Lauf sichtbar.
4. **Erster Release** (LFH-527) — Tag `v0.1.0` setzen, dann einen `fix:`-Commit auf `main`.
   Abnahme: `v0.1.1` mit allen sechs Assets und dem Container-Abbild.

**Die Reihenfolge 3 vor 4 ist eine Korrektur** (Review, 09.09.2026). Der erste Entwurf hatte
den Release-Test vor dem Umschalten — und begründete den dann fehlschlagenden arm64-Job als
„erwartbar". Erwartbar wäre er, folgenlos nicht: `veroeffentlichen` und `docker` hängen per
`needs` am Matrix-Job, `fail-fast: false` schützt nur die Geschwister. Ein fehlgeschlagener
arm64-Build liefert damit **null** Artefakte und kein Abbild, nicht „alles außer arm64". Der
erste Release-Test hätte also einen Durchlauf beurteilt, der strukturell ein anderer ist als
der echte. Deshalb: erst public (die arm64-Runner sind nur dort kostenlos), dann releasen.

## 9b. Mitgenommen: zwei Advisory-Nachzüge

Der erste vollständige Gate-Lauf war **rot** — nicht wegen dieser Arbeit, sondern weil
`pnpm audit` zwei Bestandsbefunde im Frontend-Lockfile meldet, das dieser Vorgang gar nicht
anfasst. Beide sind hier trotzdem behoben, und der Grund ist derselbe, aus dem CLAUDE.md
`cargo clippy` aus dem Gate hält: **eine CI, die von Tag eins rot ist, wird abgeschaltet
statt befolgt.** Ein Ticket dafür anzulegen und die CI rot zu starten, hätte das Ziel dieses
Vorgangs verfehlt.

- **js-yaml** (GHSA-2883-xcg3-v3hh, high): der Override in `frontend/pnpm-workspace.yaml`
  stand auf `<4.3.1: ^4.3.1`, das Advisory ist auf 4.3.2 gewandert. Das ist zum **dritten
  Mal** dasselbe Muster (nach `nanoid` und `fast-uri`, beide dort dokumentiert): der
  Override pinnt eine Zahl, das Advisory bewegt sich darunter weg. Beide Grenzen nachgezogen.
- **maplibre-gl** (GHSA-jrc7-96c5-q579, critical, XSS-Sanitizer-Bypass): direkte
  Abhängigkeit, `^6.0.0` im Lockfile auf 6.0.0 festgehalten, gepatcht ab 6.4.1. Auf `^6.4.1`
  gehoben, pnpm löst 6.8.0 auf. Ein Override wäre hier das falsche Werkzeug — die Datei
  trägt ausdrücklich *transitive* Fixes, und dies ist eine direkte Laufzeitabhängigkeit.
  Der Sprung über acht Minor-Versionen in der Kartenbibliothek ist durch die Playwright-Suite
  gegangen (143 Tests, Lagekarte inbegriffen).

Die verbleibenden zwei `moderate`-Funde brechen das Gate per Konvention nicht
(`--audit-level=high`) und bleiben liegen.

## 10. Risiken und offene Punkte

- **Der Engpass ist der Plattenplatz, nicht die Rechenzeit** — gemessen im ersten CI-Lauf
  (09.09.2026, PR #26), nicht vermutet. Beide Jobs starben mitten im Rust-Build an
  `No space left on device`; zuletzt konnte der Runner nicht einmal mehr sein eigenes Log
  schreiben, weshalb der Job ohne fehlgeschlagenen Schritt als `failure` dastand. Ein
  `ubuntu-latest`-Runner hat rund 14 GB frei, und der Debug-Build des Workspace samt
  Integrationstests, OpenSSL aus Quelle, `aws-lc-sys`, gebündeltem SQLite, `node_modules`
  und Chromium passt dort nicht hinein. Zwei Hebel, beide in `ci.yml`: die ungenutzten
  vorinstallierten Toolchains werden vor dem Build entfernt (das Android-SDK allein trägt
  zweistellige GB), und `CARGO_PROFILE_DEV_DEBUG=line-tables-only` nimmt die
  Variablen-Debuginfo heraus. **Wer einen dritten Job ergänzt, übernimmt beides.** Der
  Aufräumschritt steht bewusst doppelt in der Datei statt in einer eigenen Composite-Action —
  zwei Vorkommen rechtfertigen den Umweg nicht, drei vielleicht.
- **Die Playwright-Flakiness unter Last** (Memory: Vitest/Playwright unter Last flaky) bleibt
  auf 2-vCPU-Runnern zu beobachten. `PW_WORKERS: 2` ist die Vorsorge; falls e2e dort trotzdem
  flakt, ist die Antwort ein `retries: 1` **nur unter `CI=true`**, nicht ein abgeschalteter
  Schritt.
- **`ubuntu-24.04-arm`** ist nur für öffentliche Repos kostenlos. Deshalb steht der erste
  Release-Test hinter dem Umschalten (siehe Reihenfolge oben) — im privaten Zustand fiele
  nicht nur das arm64-Binary aus, sondern die gesamte Artefaktkette.
- **semantic-release + `[skip ci]`** überspringt das Gate für den Release-Commit. Der
  Commit ändert nur Versionsfelder und Changelog; das ist akzeptiert.
- **Signierung** (Windows SmartScreen, macOS Gatekeeper) ist nicht Teil dieses Tickets.
  Unsignierte Binaries werden beim Start gewarnt; wer das braucht, öffnet ein Ticket.
