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
Stand von `alpha` in einen Klon auf dem Server und baut mit `--pull --no-cache` neu (ohne
`--no-cache` kämen apt, rustup und Browser aus der Schicht der Vorwoche); so bleiben Systempakete
und Toolchain frisch, ohne dass jemand daran denkt. Das Basisimage selbst ist per Digest gepinnt
und kommt mit Dependabot. Die Prüfsumme von `sccache` steht fest im Dockerfile, nicht vom
Release-Server geladen. Die Runner-eigene
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
einem fremden Repository ist. `aenderungen` ruft es, bei einem PR in der Fassung des Ziel-Branches
(`git show HEAD^1:…`, sonst stellte ein Fork die Weiche mit einer Zeile um, ohne `.github/`
anzufassen), mit `continue-on-error` (eine kaputte Weiche reißt die Bereichs-Erkennung nicht mit)
und gibt das Ergebnis als Ausgabe `runner` weiter; `binaer` und `e2e` setzen
`runs-on: ${{ needs.aenderungen.outputs.runner || 'ubuntu-latest' }}`. Ein roter
`aenderungen`-Job fällt damit auf GitHub-Runner zurück, wie „im Zweifel wird geprüft“ es
verlangt. Selbsttest `scripts/runner/select-runner.test.sh` in Schritt 11 von `check-all.sh`, dazu
der Wächter `scripts/runner/ci-schritte.test.sh`: in `binaer` und `e2e` trägt jeder Schritt mit
`sudo`, apt oder gehostetem Cache die Bedingung aus D3 (das Review fand genau diese Lücke).

- **Statt des Ausdrucks direkt an beiden `runs-on`:** zweimal derselbe Ausdruck ohne Test, und
  ein Tippfehler schickte Fork-PRs auf den Server.

**Die Weiche ist keine Sicherheitsgrenze.** Ein Fork-PR kann `ci.yml` selbst ändern und das Label
eintragen. Die Grenze ist die Repo-Einstellung „Require approval for all external contributors“
(Actions → General): Workflows aus Forks laufen erst nach Freigabe durch Ruben. Die ADR macht sie
zur Regel samt der Pflicht, vor der Freigabe die Änderungen unter `.github/` zu lesen.

### D5 Isolation auf dem Host

Container ohne `--privileged`, ohne Docker-Socket, ohne Host-Netz, in einem eigenen
Docker-Netz ohne Verkehr zwischen den Containern (`enable_icc=false`); Grenzen je Container
(`--cpus`, `--memory`, Vorgabe 3 Kerne und 6 GB, in `/etc/lifeline-runner/runner.env` änderbar).
Geteilt über ein Volume wird nur der `sccache`-Cache (`SCCACHE_CACHE_SIZE`, Vorgabe 20 GB, räumt
selbst nach LRU). Kein geteiltes `target/`: Spec `worktree-bauziel` verlangt, dass verschiedene
Quellstände keine Fingerprints teilen; der inhaltsadressierte Compiler-Cache tut das nicht.

- **Statt auch die Cargo-Registry zu teilen** (so im ersten Wurf): ihre Sperre und ihre
  Aufräumdaten liegen in `CARGO_HOME` selbst, also je Container; zwei Container, die dieselbe Crate
  entpacken, zerstörten sich das Verzeichnis, und gewachsen wäre es ohne Grenze. Das Review fand
  es; die Registry kommt nun je Job frisch.
- **Vertrauen (Ruben, 12.11.2026):** den Cache teilen alle Läufe des eigenen Repos, auch
  Dependabot-PRs mit neuem Fremdcode; ein vergifteter Eintrag träfe nur das e2e-Binary, nicht die
  Release-Artefakte. Angenommen statt getrennter Plätze je Vertrauensstufe. Ebenso angenommen: der
  Server-Klon folgt `alpha`, jeder Merge ist Code auf dem Host mit dem Admin-Token (D2).

Die Schleife wertet einen Container, der nach weniger als 60 s ohne Fehlercode endet, als Fehler
(der Runner gibt auch bei eigenen Fehlern 0 zurück) und pausiert so, dass SIGTERM sofort greift.

### D6 Aufräumen im Lauf selbst, nicht im Workflow

Ein eigenes Modul `frontend/e2e/run-dir.ts` (ohne Playwright-Import, damit der Selbsttest
`scripts/e2e-run-dir.test.mjs` es mit nacktem Node lädt): `createRunDir(prefix, { deleteOnExit })`
legt das Verzeichnis an und löscht vorher verwaiste gleichen Präfixes älter als 24 h (Fehler nur
als Warnung). Beide Konfigurationen rufen es im Hauptprozess mit `deleteOnExit`; der löscht genau
das Verzeichnis, das er angelegt hat, synchron im `exit`-Ereignis, nachdem Playwright die
Webserver beendet hat. Die Worker erben nur den Pfad.

- **Statt `globalTeardown`** (so im ersten Wurf): Playwright meldet einen Teardown erst an, wenn
  es ihn erreicht. Startet schon der Webserver nicht, wirft die Config oder läuft nur `--list`,
  bliebe das Verzeichnis liegen; dazu stand der Name der Lauf-Variablen doppelt, und ein
  vertippter Name hätte still nichts gelöscht. Das Review fand beides.

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
- [Ein Lauf des eigenen Repos, etwa ein Dependabot-PR, vergiftet den Compiler-Cache] → trifft nur
  das e2e-Binary; angenommen (D5), Leeren des Volumes steht im README.
- [Ein Job erreicht Dienste des Hosts oder des LANs über das Gateway des Docker-Netzes] → README
  nennt Firewall-Regeln; zwischen den Containern sperrt `enable_icc=false`.
- [Fonts: das Image bringt die Schriften von `playwright install-deps`, `ubuntu-latest` womöglich
  mehr] → Layout-Gates könnten je Runner-Art abweichen; prüft der Probe-PR (Migration Plan).
- [Playwright-Bump ohne Image-Neubau] → Shard lädt die Browser selbst und warnt (D3); der Timer
  baut spätestens nach einer Woche neu.
- [Das Löschen beim Ende läuft nicht, weil der Prozess hart getötet wird (SIGKILL)] → die
  24-h-Regel beim nächsten Start räumt nach; auf dem Server verschwindet der Container ohnehin.
- [Merge-Konflikt mit LLH-1662 in `ci.yml`] → wer später merged, löst auf; die Änderungen
  betreffen verschiedene Zeilen (Runner und sudo-Schritte hier, Auslöser und Job-Bedingung dort).

## Migration Plan

1. PR mergen: ohne `E2E_RUNNER` ändert sich nichts, alles läuft wie bisher auf GitHub.
2. Ruben richtet den Server nach `scripts/runner/README.md` ein und setzt die Fork-Freigabe.
3. Ein PR mit gesetztem `E2E_RUNNER` als Probelauf; danach bleibt die Variable gesetzt.
4. Rückweg jederzeit: Variable leeren.
