# Gate- und Release-Skripte — Regeln

Gilt für `scripts/` und `.github/workflows/`, zusätzlich zur `AGENTS.md` der Wurzel.

## Sammel-Gate (LFH-235/F17)

`./scripts/check-all.sh` (voller Lauf; vor dem PR genügt `--geaendert --ohne-e2e`, s. „Leichte PR-Prüfung“): `check-fmt.sh` (rustfmt + Prettier) → `pnpm lint` →
`check-typ-codegen.sh` + `check-api-clients.sh` → `cargo test` (Workspace, Hülle getrennt) → Vitest → `check-deps.sh` + `check-karenzzeit.sh` → `pnpm e2e` →
`release-ruhefenster.test.sh` + `ki-notizen.test.mjs` + `desktop-manifest.test.mjs` + `desktop-kanal.test.mjs` + `android-kanal.test.mjs` + `kanal-nachziehen.test.sh` + `abbild-kanal.test.mjs` + `pr-kommentare.test.mjs` + `drittanbieter-quellen.test.sh` + `rueckmeldung/einwurf.test.mjs` + `ios/version.test.sh` + `ios/xcodegen-installieren.test.sh` + `ios/testflight.test.sh` + `ios/testflight-verteilen.test.mjs` + `ios/bilder-ablegen.test.sh` + `ios/fehlgruende.test.sh` + `android/version.test.sh` + `android/sdk-version.test.sh` + `android/release-apk.test.sh` → `check-deps.test.sh` + `check-karenzzeit.test.sh` →
`check-migrationen.sh` + `migrationen-autofix.test.sh` + `stau-waechter.test.sh` → `check-all.test.sh` + `bauziel.test.sh` + `wiederholen.test.sh` + `bereiche.test.sh` + `ci-stufen.test.sh` + `ruleset-pruefen.test.sh` + `ci-messung.test.sh` → `check-toolversionen.sh` →
`check-openspec-eingefroren.sh` → `check-schreibweisen.sh` → `cargo test` mit `dev-seeds` (Dev-Seed) →
`check-architektur.sh` + `check-adr-nummern.sh` (Architekturdoku, Regeln in `docs/architektur/AGENTS.md`) →
`swift test` in `ios/LifelineKern` (Schritt 18, Bündel `ios`, LLH-1978; ohne Swift im PATH eine
Lücke, mit `IOS_SWIFT_PFLICHT=1` wie in der CI rot) →
`cargo build --bin lifeline-hub` (Schritt 19, Bündel `rust` und allein `binaer`, LLH-2033) →
`gradlew -p android/kern test` (Schritt 20, Bündel `android`, LLH-1989; ohne Java 17+ eine
Lücke, mit `ANDROID_KERN_PFLICHT=1` rot).
Außerhalb des vollen Laufs: Schritt 17 (`--nur baut`, nur kompilieren) als schneller lokaler
Kompilierlauf; Schritt 3, 4 und 15 übersetzen dasselbe und testen es.
- **Server-Binary ohne Dev-Abhängigkeiten** (LLH-2033): Jeder Rust-Schritt mit Testzielen, auch
  `--nur baut` (`--all-targets`), übersetzt mit den Features der Dev-Abhängigkeiten
  (`webauthn-rs/danger-credential-internals`, `tokio/test-util`, …). Was ein Feature nur über sie
  hat, ist dort grün und bricht im Release. Schritt 19 baut deshalb nur das Binary, ohne
  Testziele; nie `--all-targets`, `--tests` oder `cargo test` dort (`check-all.test.sh`, Fall 17).
- **Leichte PR-Prüfung** (LLH-1889/LLH-1896, ADR-0048; ersetzt die zwei Stufen von LLH-1662):
  - **Ein Workflow je Ereignis:** `pr.yml` läuft nur am PR, `ci.yml` nur bei Push auf `alpha`,
    `beta`, `main`; was nur bei Push läuft (`migrationen-kanal.yml`, `ruleset.yml`), hat keinen
    PR-Auslöser. Ein Job mit falschem `if`
    stünde sonst als übersprungener Eintrag an jedem PR. Die Suiten stehen einmal in
    `suiten.yml` (am Commit `Suiten / …`); ein Pflicht-Check-Job darf dort nicht stehen, weil er
    sonst den Präfix trägt. Deshalb steht `schnell` in `ci.yml` und `pr.yml` **wortgleich**: wer
    ihn ändert, ändert beide (`ci-stufen.test.sh` vergleicht).
  - **Pflicht-Checks:** genau die Liste in `scripts/ruleset-pruefen.sh`, sonst nichts; dort mit
    Art (`status` aus der Status-API: im Ruleset ohne Quelle; `check`: ohne Quelle oder GitHub
    Actions). `ruleset.yml` prüft das Ruleset von `alpha` nach jedem Push, alle sechs Stunden und
    auf Anstoß dagegen und wird bei Abweichung rot (LLH-1895). Wer eine Pflicht ändert, ändert
    Liste und Ruleset zusammen.
  - **Im PR** laufen `schnell` und daneben `binaer` (Pflicht-Check `Server-Binary`, Schritt 19; eigener
    Job, damit der Bau die Schnellprüfungen nicht verlängert) aus `pr.yml`. Ein fremdes Label startet an einem PR ohne `voll` nur diese beiden neu, in
    eigener Gruppe, ohne einen laufenden Lauf abzubrechen; an einem PR mit `voll` startet es alle
    Suiten neu (ein übersprungener gleichnamiger Check verdeckte sonst eine rote Suite). Rust-, Frontend-, e2e-Suite, der Swift-Kern (`ios`) und der Kotlin-Kern (`android`) laufen im PR nur mit dem **Label `voll`**, dann ganz
    und ohne Pflicht (eine rote Suite steht sichtbar am PR, sperrt aber nicht). Das frühere Label
    `e2e` bedeutet nichts mehr.
  - **Wann `voll`** (LLH-1898, ADR-0050), selten und nur, wenn mindestens eines zutrifft:
    (1) der PR ändert eine dieser Stellen (abschließend): `suiten.yml`, `e2e.yml`, den Job
    `suiten` in `pr.yml` oder `ci.yml`, `frontend/playwright.config.ts` oder
    den Block `test:` in `frontend/vite.config.ts`; (2) der Mensch verlangt es ausdrücklich.
    **Kein Grund** sind „riskant“, Backend-Verhalten, UI-Abläufe, Migrationen und alle übrigen
    CI- und Gate-Änderungen. Dafür lokal: immer `--geaendert --ohne-e2e`; bei UI-Abläufen dazu die
    betroffene e2e-Spec (`cargo build`, dann
    `mise exec -- pnpm -C frontend exec playwright test e2e/<datei>.spec.ts`); ändert der PR das
    Gate-Skript (`check-all.sh`, `scripts/lib/`) oder den e2e-Unterbau (`frontend/e2e/*.ts` außer
    Specs), das betroffene Bündel ganz (`--nur rust|frontend|e2e`). Den Rest fängt „alpha rot“.
  - **Vor dem PR lokal:** `./scripts/check-all.sh --geaendert --ohne-e2e`. `scripts/bereiche.sh`
    ordnet jede geänderte Datei den Suiten Rust, Frontend, e2e und iOS zu (**im Zweifel alles**; ein
    Querbezug aus einem fremden Bereich braucht eine Regel dort, `bereiche.test.sh` sucht
    fehlende). `--auswahl` zeigt die Schritte nur an; ohne Argument läuft alles. Die CI wählt
    nicht mehr nach Bereichen.
  - **Auf `alpha`, `beta`, `main`** laufen bei jedem Push alle Suiten. Ein neuer Push bricht die
    **Testjobs** des laufenden Laufs ab (Concurrency je Job: `rust`, `frontend` je Anteil, `e2e`,
    `ios`, `android`, `berichte`), der jüngste Lauf deckt alle früheren mit ab. Der **Release** hat eine eigene
    Gruppe ohne Abbruch: ein laufender Release endet nie mittendrin (Tag ohne Release), und ein
    Lauf mit abgebrochenen oder roten Tests released nicht (`needs`). Nie
    `cancel-in-progress` für den ganzen Workflow auf einem Kanal-Branch. **Neu starten nur den
    jüngsten Lauf** eines Kanal-Branches: ein neu gestarteter Job eines älteren Laufs tritt in
    dieselbe Gruppe und bricht die Tests des jüngeren ab.
  - **Label-Ereignisse:** `pr.yml` hört auf `labeled`; die Schnellprüfungen laufen dabei
    immer neu, nie übersprungen (ein übersprungener jüngster Check zählte grün). Auto-Merge-
    Ereignisse gehören nicht nach `pr.yml`.
  - `suiten.yml` und `e2e.yml` sind nur `workflow_call` (`suiten.yml` ruft `e2e.yml`: Binary,
    Anteile, Bericht, Runner-Wahl). Der Release wartet auf den ganzen Aufruf; der Vitest-Bericht
    darin scheitert, ohne ihn rot zu machen (`continue-on-error`).
  - Die Form hält `scripts/ci-stufen.test.sh` (Schritt 11) fest.
  - **iOS-Prüfung** (LLH-1978): `ios-pruefung.yml` baut und testet die iOS-App auf einem
    macOS-Runner nur an PRs, die `ios/`, `scripts/ios/` oder `src-tauri/faelle/` ändern, und ist
    kein Pflicht-Check. Ablauf in `scripts/ios/simulator-pruefung.sh`, XcodeGen nur über
    `scripts/ios/xcodegen-installieren.sh` (einzige Stelle der Version, mit Prüfsumme).
  - **TestFlight** (LLH-1978): `ios.yml` lädt die iOS-App hoch, aufgerufen aus `artefakte.yml`
    (Job `ios`, nach `freigeben`, nur Tags der Kanäle `beta` und `main`) oder per Handstart. Der
    Job steht in keinem `needs` von `freigeben`: ein roter Upload hält das Release nicht auf.
    Archiv, Signierung und Upload stehen in `scripts/ios/testflight.sh`, das Alpha-Tags und eine
    vom Tag abweichende Workspace-Version selbst abweist (Selbsttest in Schritt 8). Betrieb und
    Secrets: `docs/betrieb/ios-app.md`.
  - **Android-Prüfung** (LLH-1989): `android-pruefung.yml` fährt an PRs und nach Pushes auf
    `alpha`, die `android/`, `scripts/android/` oder `src-tauri/faelle/` ändern, die App-Tests
    (Robolectric, Bilder als Artefakt `android-bilder`), die Release-APK ohne Signatur und den
    Kern; kein Pflicht-Check. Den Push fängt `android-pruefung-alpha.yml` und ruft dieselben Jobs
    (ein Workflow je Ereignis, ADR-0048). JDK, SDK-Plattform
    und Build-Tools stehen nur in `scripts/android/sdk-version.sh` (Selbsttest gegen `compileSdk`
    in Schritt 8), fehlende SDK-Pakete lädt `scripts/android/sdk-installieren.sh`.
  - **APK** (LLH-1989, Entwurf D9): `android.yml` baut und signiert die APK
    (`scripts/android/release-apk.sh`: fehlt ein Geheimnis `ANDROID_KEY*`, rot statt unsigniert;
    Version gegen den Tag; Selbsttest in Schritt 8), aufgerufen aus `artefakte.yml` (Job
    `android`, nach `freigeben`, jeder Kanal, in keinem `needs` davor) oder per Handstart. Manifest
    `android.json` und feste APK in den Kanal-Releases `android-alpha`/`android-beta` nach
    `scripts/release/android-kanal.mjs` (nur vorwärts, jeder Vorabkanal nur seine eigenen, die
    feste APK nur aus dem eigenen Kanal), ein Job je Kanal mit eigener Gruppe; stabile Tags legen
    beides ans versionierte Release (`releases/latest/download/`). Betrieb und Secrets:
    `docs/betrieb/android-app.md`.
  - Folge: Testbrüche landen auf `alpha` und gehen über „alpha rot“ (Stau-Wächter, unten).
  - Herleitung: `openspec/changes/archive/2026-11-14-p4avye3q-pr-checks-leicht/design.md`,
    `openspec/changes/archive/2026-11-15-czjhc4qq-ci-pr-schlank/design.md`.
- **Stau-Wächter** (LLH-1660, `scripts/stau-waechter.sh`, `.github/workflows/stau-waechter.yml`:
  Push auf einen Ziel-Branch, stündlich, von Hand): bewertet jeden offenen PR, der kein Entwurf
  ist. Was er tut und warum, steht im Skriptkopf; die Grenzen belegt `stau-waechter.test.sh`.
  - **Konflikt:** ein Hinweis am PR mit den betroffenen Dateien. Gelöst wird er von der Sitzung,
    die den PR betreut (der Kommentar weckt sie), oder vom Menschen: Ziel-Branch in den PR-Branch
    mergen, kein Rebase, kein Force-Push. Der Wächter löst nie selbst.
  - **Kein CI-Lauf** (`Schnellprüfungen` fehlt 20 Minuten nach dem ersten Check des
    Kopf-Commits, ohne jeden Check nach der letzten Änderung am PR): die Release-App mergt den Ziel-Branch in den PR-Branch. Grenzen wie beim
    Migrations-Autofix: nur PRs aus diesem Repository, nie `alpha`/`beta`/`main`, nur
    Fast-Forward auf genau den bewerteten Kopf (Push mit Lease), kein zweiter Versuch auf einem Wächter-Merge (Trailer
    `Stau-Waechter`; gilt nur hier, „alpha rot“ hat seine eigene Bremse). **Nach einem Wächter-Merge vor dem nächsten Push den Branch holen.**
  - **Grün, Auto-Merge an, nicht gemergt** (20 Minuten): ein Hinweis; gemergt wird von Hand. Je
    Name zählt wie bei den Required Checks der jüngste Check-Run. Weicht das Ruleset von `alpha`
    von der Pflichtliste ab (`ruleset-pruefen.sh`), nennt der Hinweis das als wahrscheinliche
    Ursache (LLH-1895). Hinweise einer Art, die es
    nicht mehr gibt (`ohne-e2e`, bis LLH-1889), gehen ohne Befund auf „behoben“.
  - **alpha rot** (LLH-1849; zusätzlich ausgelöst, wenn ein CI-Lauf auf `alpha` fertig ist):
    schlägt im jüngsten abgeschlossenen Push-Lauf von `ci.yml` auf `alpha` ein Job außer dem
    Release fehl (dessen Jobs heißen „Release / …“, die der Suiten „Suiten / …“), ist **höchstens ein** offener PR zuständig:
    der mit Label `alpha-rot` (bei mehreren die kleinste Nummer, die übrigen `doppelt`; ein
    Entwurf mit Label zählt), sonst ein PR ohne Entwurf, Fork und Dependabot. Der Auftrag haftet
    eine volle Stunde ab seinem Hinweis an diesem PR und geht erst dann an den nächsten (größere
    Nummer, dann von vorn); eine neue oder gemergte PR, neue rote Jobs oder ein nicht lesbarer
    Halter verschieben ihn nicht. Alle übrigen bekommen
    den Hinweis, nicht selbst zu reparieren (den Fix-PR nennen sie erst, wenn es einen gibt: ein
    Wechsel des Auftrags soll keine wartende Sitzung wecken). Das Label legt der Wächter an, wenn
    es fehlt. Ein neu gestarteter roter Lauf, der noch läuft, oder nicht lesbare Jobs machen den
    Zustand unbestimmt: dann schreibt der Wächter nichts. Ist `alpha` wieder grün, mergt die
    Release-App `alpha` in jeden PR mit Hinweis, dessen jüngster CI-Lauf rot ist (Hinweis
    „angestoßen“; nicht bei Konflikt, Entwurf, Fork oder wenn der grüne Stand schon im Branch ist,
    das ist die Schleifenbremse), sonst wird er „behoben“. Sind die Checks nicht lesbar, läuft die
    CI noch oder scheitert der Push, bleibt er offen. Was die Sitzung tut:
    `dev-zunder-ausfuehren`, „alpha rot“.
  - **Ein Hinweis je PR und Marke** (`<!-- stau-waechter:<art>:<kennung> -->` zum PR,
    `<!-- stau-waechter-alpha:<art>:<kennung> -->` zu „alpha rot“, die beiden verdrängen sich
    nicht): gleicher Befund schreibt nichts, neuer löscht und legt neu an, behobener ändert auf
    „behoben“. Wer eine Art hinzufügt, ergänzt Skriptkopf, Selbsttest und die Spec `merge-stau`.
  - Kein Schritt führt PR-Code aus. `--nur-zeigen` nennt Befund und Aktion, ohne zu schreiben,
    auch lokal: `GITHUB_REPOSITORY=<owner>/<repo> scripts/stau-waechter.sh --nur-zeigen alle`
    (oder `alpha` für nur diesen Befund).
  - Herleitung: `openspec/changes/archive/2026-11-12-p31gqvln-merge-stau/design.md`, für
    „alpha rot“ `openspec/changes/archive/2026-11-12-g10eo9co-alpha-rot-schutz/design.md`.
- **Kein Pflicht-Check „Baut mit Ziel-Branch“** (LLH-1899, ADR-0049, ersetzt LLH-1849): Nach einem
  Merge auf einen Kanal-Branch kompiliert kein Workflow die offenen PRs neu (die Migrations- und
  ADR-Nummern bewertet `migrationen-kanal.yml` weiter neu). Kompilieren zwei einzeln
  grüne PRs zusammen nicht, wird `alpha` rot, und „alpha rot“ (Stau-Wächter, oben) bestimmt einen
  Zuständigen. Lokal prüft `check-all.sh --nur baut` nach einem Merge von `alpha` schnell, ob ein
  Stand übersetzt. Herleitung:
  `openspec/changes/archive/2026-11-15-ihwpo4ik-baut-mit-ziel-branch-entfernen/design.md`.
- **Ein roter Schritt hält die folgenden nicht auf** (LFH-386, `scripts/lib/schritte.sh`): alle
  laufen, am Ende Gesamtstatus je Schritt und EIN Exit-Code; `--abbrechen` ist das Opt-in für
  den schnellen Abbruch. Schritte laufen als eigenes Kommando in einer Subshell mit `set -e`,
  **nie** in einer Bedingung (`if`/`||` schaltet errexit im ganzen Körper ab). Übersprungen
  meldet ein Schritt mit `return "$UEBERSPRUNGEN_RC"`, nicht mit 0.
- Prettier prüft `frontend/` und `website/` (diese mit dem Prettier des Frontends, LLH-1529);
  nicht idempotent (nach `--write` noch rot → nochmal). Ausnahmen nur mit Begründung in der
  `.prettierignore` des Bereichs. Kein `.git-blame-ignore-revs`.
- **Node und pnpm stehen nur in `[tools]` von `mise.toml`** (LFH-773): Skripte rufen
  `mise exec -- …`, Workflows `jdx/mise-action` ohne `install_args`. `packageManager`,
  `engines.node` (Wurzel, `frontend/`, `website/`), `website/.node-version` (Cloudflare Pages) und
  der Devcontainer spiegeln die Zahl; `scripts/check-toolversionen.sh`
  prüft das und bricht an jedem harten `node@…`/`pnpm@…` in `scripts/`, `.github/`, README, Skills.
- Env-Hygiene über `scripts/lib/dev-env.sh`, keine handgepflegte `env -u`-Liste; Isolation wo
  möglich im Test (`config::tests::parse_hermetisch`).
- **Jeder Checkout baut in sein eigenes `target/`** (LFH-520, `.cargo/config.toml`, schlägt
  das globale `build.target-dir`; `CARGO_TARGET_DIR` schlägt beide). In einem geteilten Ziel
  teilen sich Worktrees Fingerprints und Binaries (Hash aus dem Pfad relativ zur
  Workspace-Wurzel, Frische per mtime), und Tests liefen still gegen einen fremden Stand.
  Schritt 3, 4, 7 und 15 prüfen das vorab (`scripts/lib/bauziel.sh`, rot bei fremdem Ziel ohne
  Umgebungsvariable), Selbsttest `scripts/bauziel.test.sh`; Gate und Playwright nennen das
  gestartete `Backend-Binary:`. Kosten: ~3 min kalt, bis 19 GB je voll gebautem Worktree
  (Mac, vor LFH-845), frei mit dem Worktree. Seit LFH-845 trägt nur der eigene Code
  Zeilentabellen, Abhängigkeiten keine Debuginfo (`Cargo.toml`, `[profile.dev]`); unter Linux
  belegt ein voller Testbau 21,6 GB statt hochgerechnet über 60
  (`openspec/changes/archive/2026-10-03-lfh-845-debuginfo-testbinaries/design.md`). Ein älterer
  Worktree ohne die Datei erbt unter einem Main-Checkout mit ihr dessen Ziel, bis er auf
  `alpha` vorgezogen ist
  (`openspec/changes/archive/2026-09-30-lfh-520-cargo-artefakte-isolieren/design.md`).
- **Playwright fährt drei Projekte** (LFH-729): `chromium` alles, `firefox` und `webkit` nur die
  Druck-Specs (`frontend/playwright.config.ts`). Die vier Shards `e2e k/4` fahren alle
  drei und installieren alle drei Browser. `PW_PROJEKTE=chromium` wählt lokal eine Teilmenge. Schritt 7 bricht vorab
  ab, wenn ein Browser fehlt, und überspringt nie still
  (`openspec/changes/archive/2026-10-01-lfh-729-druck-firefox-webkit-pdf-nachweis/design.md`, D1/D2).
- **Die e2e-Anteile teilen nach gemessener Laufzeit, nicht nach Testzahl** (LFH-1117):
  `PW_SHARD=k/n` geht an `frontend/playwright.config.ts`, die mit `scripts/e2e-anteile.mjs` und
  `frontend/e2e/laufzeiten.json` die Dateien des Anteils wählt; nie zusätzlich `--shard` (die
  Config bricht ab). Eine neue Spec zählt bis zur nächsten Messung mit dem Median. Auffrischen:
  das Artefakt `e2e-laufzeiten` eines vollen Laufs einchecken; die Zusammenfassung des Jobs
  „e2e-Bericht“ (`e2e.yml`) zeigt, wie weit der langsamste Anteil über dem Mittel liegt.
- **Keine Namen, die sich nur in der Groß-/Kleinschreibung unterscheiden** (LFH-1053, Schritt 14,
  `scripts/check-schreibweisen.sh`): je Verzeichnis weder ganze Namen noch Modulnamen (ohne
  TS/JS-Endung, Verzeichnisse zählen mit). Die CI läuft nur unter Linux; den Konflikt sah erst
  der macOS-Build nach dem Release (LFH-1050)
  (`openspec/changes/archive/2026-10-05-lfh-1053-schreibweisen-waechter/design.md`).
- **Der Dev-Seed läuft mit seinem Feature** (LFH-912, Schritt 15, Bündel `rust`): Schritt 4
  baut ohne Features und sieht `src/dev/`, `/api/dev/users`, `tests/dev_present.rs` und den
  Seed-Aufruf in `src/main.rs` nicht. Schritt 15 baut sie mit `dev-seeds` und fährt nur die
  Tests unter `dev::` und `dev_present`; ein neuer Test hinter dem Feature gehört dorthin. Er
  wählt dieselben Pakete wie Schritt 4, nie `-p lifeline-hub`, sonst baut Cargo die
  Abhängigkeiten mit anderen Features ein zweites Mal. Beim Verlassen legt er das Binary ohne
  Feature nach `target/debug/lifeline-hub` zurück: das Dev-Binary seedet beim Start und bräche
  jeden Admin-Login der e2e-Suite
  (`openspec/changes/archive/2026-10-05-lfh-912-gate-dev-seed/design.md`).
- **Netz-Schritte in Workflows haben eine Frist je Versuch und Wiederholung** (LFH-1101):
  Systempakete nur über `scripts/apt-pakete.sh`, nie `apt-get` direkt; andere Netz-Schritte,
  die selbst apt rufen (`playwright install-deps`), über `scripts/wiederholen.sh`, und zwar
  `sudo … wiederholen.sh`, nicht umgekehrt: sonst trifft `timeout` nur `sudo`, das apt-get als
  root lebt weiter und hält den apt-Lock (LLH-1420, LLH-1507). Ein
  hängender Ubuntu-Spiegel hielt sonst jeden Job bis zu seinem Timeout fest, auf allen PRs
  zugleich; apts eigene Zeitgrenzen fangen einen tröpfelnden Spiegel nicht. Selbsttest
  `scripts/wiederholen.test.sh` (Schritt 11).
- **Nur GitHub-Runner** ([ADR-0078](../docs/architektur/entscheidungen/ADR-0078-alle-ci-jobs-laufen-auf-github.md)):
  jeder Job läuft auf `ubuntu-latest`. Der eigene Server (LLH-1666, LLH-2014) ist zurückgebaut;
  ein neuer selbst betriebener Runner braucht eine neue ADR. Wächter: `scripts/ci-stufen.test.sh`.
- Optionaler pre-push-Hook: `git config core.hooksPath .githooks`.
- **Release je Arbeitsschub** (`scripts/release-ruhefenster.sh`, Aufruf in `release.yml`); ein übersprungener Release-Job
  ist Normalfall; `chore(release):` zählt nicht als neuer Commit. Notizen über
  `scripts/release/ki-notizen.mjs` (Rückfall auf konventionelle Notizen, `maxTurns: 1`, Vorlage
  `KI_PROMPT` in `release.config.mjs`). Claude meldet sich per Workload Identity Federation an
  (GitHub-OIDC, Schritt „Claude-Anmeldung“ in `release.yml`, IDs als Repo-Variablen), **kein
  `ANTHROPIC_API_KEY`**; dafür hebt ein Override in der Wurzel-`pnpm-workspace.yaml` das Agent
  SDK über die `^0.1`-Sperre des Plugins.
- **Release erst nach grünem Bau aller Plattformen** (LFH-1054): semantic-release legt einen
  Entwurf an (`draftRelease`), `release.yml` startet `artefakte.yml` per Dispatch, dessen Job
  `freigeben` veröffentlicht, den gleitenden Tag (`latest`, `alpha`, `beta`,
  `scripts/release/abbild-kanal.mjs`) an die Abbilder hängt, die PRs kommentiert
  (`scripts/release/pr-kommentare.mjs`, Selbsttest in Schritt 8) und das Deployment anstößt.
  **Beta** bekommt nur veröffentlichte Alpha-Tags über `scripts/release/kanal-nachziehen.sh`
  (Workflow „Beta nachziehen“, ADR-0019); Alpha zählt daneben weiter.
  Nichts darf mehr an `release: published` hängen: das Veröffentlichen mit `GITHUB_TOKEN`
  startet keinen Workflow. Ein neuer Artefakt-Job, der zum Release gehört, gehört in die
  `needs` und die Bedingung von `freigeben`. Betrieb bei rotem Bau: `docs/betrieb/desktop-app.md`,
  „Release-Ablauf“.
- **Drittanbieter-Quellen** (LFH-1000): `artefakte.yml` hängt an jedes Release den Hinweis und
  das Paket mit dem Quelltext der LGPL-Bibliotheken (`scripts/release/drittanbieter-quellen.sh`,
  Stände gepinnt mit Commit in `drittanbieter-quellen.txt`, Selbsttest in Schritt 8). Ein neuer
  Stand einer Bibliothek im Binary heißt: Liste nachziehen (Herleitung
  `frontend/src/heic/LIESMICH.md`).
- **Rückmeldungen** (LLH-1549): Tester melden über das Issue-Formular
  `.github/ISSUE_TEMPLATE/rueckmeldung.yml` (freie Issues sind abgeschaltet). Der Workflow
  `rueckmeldung.yml` (`issues: opened`) wirft jedes Formular-Issue über den Zunder-Eingang in das
  Projekt „Lifeline Hub Eingang“ ein (`scripts/rueckmeldung/einwurf.mjs`, Selbsttest in Schritt 8)
  und setzt `aufgenommen` bzw. `nicht-aufgenommen`. Wer ein Feld des Formulars umbenennt, zieht
  `FELDER` im Skript und, bei `version`/`oberflaeche`/`seite`, `frontend/src/rueckmeldung/adresse.ts`
  nach; der Selbsttest vergleicht die Labels. Secret `ZUNDER_EINGANG_TOKEN`, Variable `ZUNDER_URL`.
- **Eigene Lizenz** (LLH-1446): `LICENSE` ist die einzige Quelle. Das Binary bettet sie ein
  (`src/lizenz.rs`, Unterbefehl `lizenz`), das Abbild legt sie unter `/LICENSE` ab, `artefakte.yml`
  hängt sie als `lifeline-hub-<version>-LIZENZ.txt` ans Release und vergleicht im Starttest die
  Ausgabe des Abbilds mit der Datei. Kein Lizenztext an anderer Stelle, README und Doku verweisen.
- **Advisories** (`scripts/check-deps.sh`): Rust `.cargo/audit.toml` (Ignorierliste mit
  Begründung); Frontend nur `overrides` in `frontend/pnpm-workspace.yaml`, jeder `high`-Fund bricht
  (`--audit-level=high`).
  **Kein leerer `auditConfig.ignoreGhsas`-Block** (ein Eintrag ohne Verstoß gilt selbst als
  Verstoß). Overrides pflegen Bereich **und** Zielversion. Der Audit prüft das **Lockfile** in
  einem Wegwerf-Verzeichnis (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; nie
  `node_modules`; Node/pnpm aus `mise.toml`), Selbsttest `scripts/check-deps.test.sh`.
- **Karenzzeit** (LLH-1884, `scripts/check-karenzzeit.sh`, Schritt 6, Bündel `schnell`): kein
  Lockfile (`website/`, `frontend/`, Wurzelpaket) führt ein Paket, das jünger als 24 Stunden ist.
  `minimumReleaseAge: 1440` steht in jeder `pnpm-workspace.yaml` und wird nicht gesenkt; neue
  Einträge in `minimumReleaseAgeExclude` nur für eigene Bibliotheken (LFH-505). Das Urteil fällt
  pnpm selbst an einer Kopie wie beim Audit (`install --frozen-lockfile --lockfile-only`), mit
  derselben Regel, an der Cloudflare die Website baut. **Rot heißt warten:** die Meldung nennt,
  ab wann das Paket alt genug ist, danach den Lauf neu starten. Gilt auch für Sicherheits-Updates
  von Dependabot, die dessen `cooldown` umgehen. Selbsttest `scripts/check-karenzzeit.test.sh`.
  Scheitert in der CI schon der Frontend-Install daran, fährt der Job `schnell` (`pr.yml` und
  `ci.yml`) das Skript direkt danach (`if: failure()`), damit die Erklärung dasteht.
