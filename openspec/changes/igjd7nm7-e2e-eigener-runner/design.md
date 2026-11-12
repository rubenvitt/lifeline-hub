# Design

## Context

Abgestimmt mit Ruben am 12.11.2026 (Zunder LLH-1666): ephemere Container, ein Server mit mindestens
8 Kernen und 16 GB, vier Plätze parallel, Fork-PRs auf GitHub-Runnern, Umfang `e2e-Binary` plus
die vier e2e-Shards. Motivation steht in `proposal.md`.

Heutiger Stand, auf den die Entscheidungen antworten:

- `binaer` und `e2e` in `.github/workflows/ci.yml` setzen einen gehosteten Runner voraus: `sudo`
  für Plattenplatz, `scripts/apt-pakete.sh nasm`, `playwright install-deps` und das Bereitlegen
  des apt-Caches. Sonst rufen beide nur `scripts/check-all.sh` bzw. `cargo build`.
- Beide Jobs hängen an `aenderungen` (Bereichs-Erkennung). Die Shard-Namen sind Required Checks im
  Ruleset 17017911, die Bedingung `E2E` steht deshalb an jedem Schritt statt am Job (Kopf von
  `ci.yml`).
- `frontend/playwright.config.ts` und `frontend/playwright.doku.config.ts` legen je Lauf ein
  `mkdtemp`-Verzeichnis an (DB und, über `default_karten_dir` in `src/config.rs`, `karten/`) und
  reichen den Pfad über eine Umgebungsvariable an die Worker weiter. Gelöscht wird es nie.
- `@playwright/test` ist in `.github/dependabot.yml` von Hand gepinnt, die Browserversion ändert
  sich also nur mit einem bewussten PR.
- Parallel arbeitet LLH-1662 (zweistufige CI) am selben Job: dort geht es darum, wann e2e läuft,
  hier darum, wo.

## Goals / Non-Goals

**Goals:**
- Der Server führt Jobs aus dem eigenen Repository aus, und ein Job lässt dort nichts zurück.
- Zurück auf GitHub-Runner kommt man ohne Codeänderung, mit einer Repo-Variablen.
- Die Pflege auf dem Server läuft von selbst: Neubau des Images und Größengrenze des Caches.

**Non-Goals:**
- Rust-Suite, Vitest und Schnellprüfungen bleiben auf `ubuntu-latest`.
- Mehr Shards oder mehr Playwright-Worker je Shard: das misst LLH-1664, die Shard-Zahl ist ein
  Pin im Ruleset.
- Wann e2e läuft (LLH-1662) und Merge-Reihenfolge (LLH-1663).
- Ein Monitoring des Servers über den Job-Stau hinaus.

## Decisions

### D1 Ein frischer Container je Job, registriert per JIT-Konfiguration

Je Platz läuft eine Schleife (`scripts/runner/runner-loop.sh`, als systemd-Dienst
`lifeline-runner@<platz>`). Sie holt über die REST-API
(`POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig`) eine Einmal-Registrierung mit
dem Label aus der Konfiguration und startet `docker run --rm` mit dem Runner-Image und
`run.sh --jitconfig`. Der Runner nimmt genau einen Job, beendet sich, Docker löscht den Container,
die Schleife beginnt von vorn. Schlägt die API fehl, wartet die Schleife mit wachsender Pause
(30 s bis 5 min) statt im Takt zu hämmern. `systemctl stop` beendet den laufenden Container mit.

- **Statt eines Runners als Dienst direkt auf dem Host:** Arbeitsverzeichnis, `/tmp`, verwaiste
  Prozesse und `sudo` blieben Aufgabe des Workflows, und jeder vergessene Fall sammelte sich an.
  Am Gespräch abgewählt.
- **Statt eines fertigen Images mit `restart: always`** (etwa `myoung34/github-runner`): Docker
  startet beim Neustart denselben Container mit seiner beschriebenen Schicht, der Stand ist also
  nicht frisch. Erst `--rm` plus neuer `run` erfüllt „leerer Stand“.
- **Statt Actions Runner Controller:** braucht Kubernetes, für einen Server mit vier Plätzen zu
  schwer.
- **JIT statt Registrierungs-Token:** eine JIT-Konfiguration gilt für genau einen Runner und
  verfällt; es bleibt kein wiederverwendbares Geheimnis im Container. Der Fine-grained Token
  (Repository `lifeline-hub`, „Administration: Read and write“) liegt nur auf dem Host, in einer
  Datei mit Modus 600, und geht nie in den Container.

### D2 Ein eigenes Image ohne `sudo`

`scripts/runner/Dockerfile` baut auf dem offiziellen `ghcr.io/actions/actions-runner` (Tag
gepinnt, Dependabot hebt ihn über ein `docker`-Ökosystem in `.github/dependabot.yml`). Dazu
kommen: Playwright-Browser samt Systempaketen in genau der Version aus `frontend/pnpm-lock.yaml`
(Build-Argument, `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, Eigentümer `runner`), `nasm`,
`build-essential`, `pkg-config`, rustup mit stable für den Nutzer `runner`, `sccache`. Am Ende
verliert der Nutzer `runner` seine `sudo`-Rechte. Die Version steht als Umgebungsvariable
`LIFELINE_RUNNER_PLAYWRIGHT` im Image.

`scripts/runner/build-image.sh` liest die Playwright-Version aus dem Lockfile und baut
`lifeline-runner:latest`. Ein systemd-Timer (`lifeline-runner-image.timer`, wöchentlich) holt den
Stand von `alpha` in einen Klon auf dem Server und baut mit `--pull` neu; so bleiben
Runner-Version und Systempakete frisch, ohne dass jemand daran denkt. Die Runner-eigene
Selbstaktualisierung bleibt an: ist das Image älter als die Mindestversion von GitHub,
aktualisiert sich der Runner vor dem Job selbst, langsamer, aber ohne Ausfall.

- **Statt des Playwright-Images als Basis:** dort fehlt der Runner, und den von Hand
  nachzuinstallieren hieße, dessen Abhängigkeiten selbst zu pflegen. Der umgekehrte Weg
  (Runner-Image plus `playwright install --with-deps` beim Bau) nutzt Playwrights eigene
  Paketliste.

### D3 Die Workflow-Schritte fragen die Runner-Art, nicht ein eigenes Flag

Schritte, die nur auf gehosteten Runnern Sinn haben (Plattenplatz, `apt-pakete.sh`,
`install-deps`, apt-Cache, `rust-cache`, Browser-Cache), bekommen
`runner.environment == 'github-hosted'` in ihre Bedingung. Auf dem eigenen Runner bleibt
`playwright install chromium firefox webkit` ohne `--with-deps`: bei passender Version ein
Leerlauf, sonst lädt es die neuen Browser. Weicht `LIFELINE_RUNNER_PLAYWRIGHT` von der Version in
`frontend/node_modules/@playwright/test/package.json` ab, schreibt der Schritt ein
`::warning::` mit dem Hinweis auf `build-image.sh`.

### D4 Die Runner-Wahl rechnet `aenderungen` aus, ein Skript entscheidet

`scripts/runner/select-runner.sh <ereignis> <kopf-repo> <repo> <label>` gibt das Label aus oder
`ubuntu-latest`: das Label nur, wenn es nicht leer ist und das Ereignis kein `pull_request` aus
einem fremden Repository ist. `aenderungen` ruft es und gibt das Ergebnis als Ausgabe `runner`
weiter; `binaer` und `e2e` setzen
`runs-on: ${{ needs.aenderungen.outputs.runner || 'ubuntu-latest' }}`. Ein roter
`aenderungen`-Job fällt damit auf GitHub-Runner zurück, wie „im Zweifel wird geprüft“ es
verlangt. Selbsttest `scripts/runner/select-runner.test.sh` in Schritt 11 von `check-all.sh`.

- **Statt des Ausdrucks direkt an beiden `runs-on`:** zweimal derselbe Ausdruck ohne Test, und
  ein Tippfehler schickte Fork-PRs auf den Server.

**Die Weiche ist keine Sicherheitsgrenze.** Ein Fork-PR kann `ci.yml` selbst ändern und das Label
eintragen. Die Grenze ist die Repo-Einstellung „Require approval for all external contributors“
(Actions → General): Workflows aus Forks laufen erst nach Freigabe durch Ruben. Die ADR macht sie
zur Regel samt der Pflicht, vor der Freigabe die Änderungen unter `.github/` zu lesen.

### D5 Isolation auf dem Host

Container ohne `--privileged`, ohne Docker-Socket, ohne Host-Netz, in einem eigenen
Docker-Netz; Grenzen je Container (`--cpus`, `--memory`, Vorgabe 3 Kerne und 6 GB, in
`/etc/lifeline-runner/runner.env` änderbar). Geteilt über Volumes werden nur der
`sccache`-Cache (`SCCACHE_CACHE_SIZE`, Vorgabe 20 GB, räumt selbst nach LRU) und das
Cargo-Registry-Verzeichnis (Cargo sperrt es selbst, entfernt alte Einträge selbst). Kein
geteiltes `target/`: Spec `worktree-bauziel` verlangt, dass verschiedene Quellstände keine
Fingerprints teilen; der inhaltsadressierte Compiler-Cache tut das nicht.

### D6 Aufräumen im Lauf selbst, nicht im Workflow

`frontend/e2e/lauf-kern.ts` bekommt zwei Helfer: `createRunDir(praefix)` legt das
Verzeichnis an und löscht vorher verwaiste gleichen Präfixes älter als 24 h (Fehler nur als
Warnung), `deleteRunDir(envKey)` löscht das Verzeichnis des Laufs aus der vererbten
Umgebungsvariablen. Beide Konfigurationen rufen den ersten im Hauptprozess und tragen ein
`globalTeardown`, das den zweiten ruft. Playwright führt `globalTeardown` auch nach roten Tests
aus und beendet die Webserver erst danach; unter Linux und macOS schadet das Löschen der offenen
DB dem noch laufenden Backend nicht.

- **Statt eines `rm` in `check-all.sh` oder im Workflow:** ein alleinstehendes `pnpm e2e` und der
  Bildlauf blieben ungeräumt.
- **Statt die DB ins Repo-Verzeichnis zu legen** (räumt `actions/checkout` mit): der Kommentar an
  der Stelle verlangt bewusst kein Cleanup im Repo-Baum, und lokal bliebe es liegen.

### D7 Dokumentation

ADR mit der nächsten freien Nummer („Die e2e-Jobs laufen in Wegwerf-Containern auf dem eigenen
Server“), `gilt_fuer` `scripts/runner/**` und `.github/workflows/ci.yml`. Prüfung: `verlange` die
Runner-Wahl über `needs.aenderungen.outputs.runner` und `--rm` in der Schleife, `verbiete`
`docker.sock` und `--privileged` unter `scripts/runner/`; manuell die Fork-Freigabe. Kapitel 7
(neuer Abschnitt zum CI-Runner), Kapitel 9 nach der dann gültigen Form (LLH-1660 streicht die
Tabelle), `scripts/AGENTS.md` (Abschnitt „Eigener Runner“: Schritte mit `sudo` nur für
`github-hosted`, Image-Neubau nach einem Playwright-Bump).

## Risks / Trade-offs

- [Server aus, Jobs hängen bis zu 24 h in der Warteschlange] → `E2E_RUNNER` leeren; das README
  nennt den Handgriff als Erstes. Der Stau-Wächter aus LLH-1660 zeigt hängende PRs.
- [Fork-PR mit verändertem `ci.yml` landet auf dem Server] → Freigabepflicht für Fork-Workflows
  (D4), Container ohne Privilegien und Socket (D5), keine Secrets in Fork-Läufen.
- [Ein vertrauter PR vergiftet den geteilten Compiler- oder Registry-Cache] → nur Läufe aus dem
  eigenen Repository erreichen den Server; Leeren des Volumes steht im README.
- [Playwright-Bump ohne Image-Neubau] → Shard lädt die Browser selbst und warnt (D3); der Timer
  baut spätestens nach einer Woche neu.
- [Teardown läuft nicht, weil der Prozess hart beendet wird] → die 24-h-Regel beim nächsten Start
  räumt nach; auf dem Server verschwindet der Container ohnehin.
- [Merge-Konflikt mit LLH-1662 in `ci.yml`] → wer später merged, löst auf; die Änderungen
  betreffen verschiedene Zeilen (Runner und sudo-Schritte hier, Auslöser und Job-Bedingung dort).

## Migration Plan

1. PR mergen: ohne `E2E_RUNNER` ändert sich nichts, alles läuft wie bisher auf GitHub.
2. Ruben richtet den Server nach `scripts/runner/README.md` ein und setzt die Fork-Freigabe.
3. Ein PR mit gesetztem `E2E_RUNNER` als Probelauf; danach bleibt die Variable gesetzt.
4. Rückweg jederzeit: Variable leeren.
