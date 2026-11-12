# Eigener e2e-Runner

`e2e-Binary` und die vier e2e-Shards der CI laufen auf einem eigenen Server statt auf
GitHub-Runnern, sobald die Repo-Variable `E2E_RUNNER` gesetzt ist (LLH-1666, ADR-0025, Spec
`ci-eigener-runner`). Jeder Job bekommt einen frischen Container, der nach dem Job gelöscht
wird. Fork-PRs laufen immer auf GitHub.

## Wenn der Server ausfällt

**Settings → Secrets and variables → Actions → Variables → `E2E_RUNNER` leeren.** Ab dem nächsten
Lauf ist alles wieder auf GitHub. Jobs, die schon auf den Server warten, abbrechen und neu
starten.

## Was hier liegt

| Datei | Zweck |
| --- | --- |
| `Dockerfile` | Runner-Image: Runner, Playwright-Browser samt Systempaketen, Build-Werkzeuge, `sccache`, kein `sudo` |
| `build-image.sh` | baut `lifeline-runner:latest` mit der Playwright-Version aus dem Lockfile, löscht alte Images |
| `runner-loop.sh` | ein Platz: JIT-Registrierung holen, Container für einen Job starten, von vorn |
| `select-runner.sh` | Runner-Wahl in `ci.yml` (Job `aenderungen`) |
| `systemd/` | `lifeline-runner@.service` je Platz, Timer für den wöchentlichen Neubau |
| `runner.env.beispiel` | Vorlage für `/etc/lifeline-runner/runner.env` |

## Einrichten

Voraussetzungen: Linux mit systemd, Docker Engine, `git` und `curl`; für vier Plätze mindestens
8 Kerne, 16 GB Speicher und rund 60 GB Platte (Image, Compiler-Cache, Registry).

1. **Dienstnutzer.** Mitglied der Gruppe `docker` heißt auf diesem Host root-gleich; deshalb ein
   eigener Systemnutzer, der sonst nichts tut. Die Jobs selbst sehen den Docker-Socket nie.

   ```bash
   sudo useradd --system --home-dir /opt/lifeline-runner --create-home --shell /usr/sbin/nologin lifeline-runner
   ```

   ```bash
   sudo usermod -aG docker lifeline-runner
   ```

2. **Klon.** Units, Skripte und Dockerfile kommen aus diesem Klon; der Timer setzt ihn jede Woche
   hart auf `origin/alpha`. Nichts darin von Hand ändern.

   ```bash
   sudo -u lifeline-runner git clone --branch alpha https://github.com/rubenvitt/lifeline-hub.git /opt/lifeline-runner/repo
   ```

3. **Token.** Ein Fine-grained Personal Access Token unter GitHub → Settings → Developer
   settings: Resource owner `rubenvitt`, Repository access *Only select repositories* →
   `lifeline-hub`, Permission **Administration: Read and write**, sonst nichts. Ablauf höchstens
   ein Jahr, Erinnerung im Kalender. Es dient nur dazu, Einmal-Registrierungen (JIT) zu holen, und
   verlässt den Host nie.

   ```bash
   sudo install -d -m 750 -o root -g lifeline-runner /etc/lifeline-runner
   ```

   Token einfügen, mit Enter und Strg-D abschließen:

   ```bash
   sudo install -m 600 -o lifeline-runner -g lifeline-runner /dev/stdin /etc/lifeline-runner/token
   ```

   `runner-loop.sh` startet nicht, wenn die Datei für andere lesbar ist.

4. **Konfiguration.** Vorgaben passen für 8 Kerne und 16 GB; die Grenzen sind Deckel je
   Container, keine Reservierung.

   ```bash
   sudo install -m 640 -o root -g lifeline-runner /opt/lifeline-runner/repo/scripts/runner/runner.env.beispiel /etc/lifeline-runner/runner.env
   ```

5. **Units und erstes Image.** Der erste Bau dauert einige Minuten.

   ```bash
   sudo cp /opt/lifeline-runner/repo/scripts/runner/systemd/* /etc/systemd/system/
   ```

   ```bash
   sudo systemctl daemon-reload
   ```

   ```bash
   sudo systemctl start lifeline-runner-image.service
   ```

   ```bash
   sudo systemctl enable --now lifeline-runner-image.timer lifeline-runner@1 lifeline-runner@2 lifeline-runner@3 lifeline-runner@4
   ```

   Unter Repo → Settings → Actions → Runners stehen danach vier Runner mit dem Label
   `lifeline-e2e` auf *Idle*. Jeder heißt `<host>-p<platz>-<zeit>` und verschwindet nach seinem
   Job; ein neuer nimmt seinen Platz ein.

## Im Repo einstellen

1. **Fork-Freigabe (Pflicht, ADR-0025).** Settings → Actions → General → *Approval for running
   fork pull request workflows from contributors* → **Require approval for all external
   contributors**. Die Weiche in `ci.yml` hält Fork-PRs vom Server fern, ist aber keine
   Sicherheitsgrenze: ein Fork kann `ci.yml` ändern und das Label selbst eintragen. Vor jeder
   Freigabe deshalb die Änderungen unter `.github/` lesen.
2. **Einschalten.** Settings → Secrets and variables → Actions → Variables → `E2E_RUNNER` =
   `lifeline-e2e` (derselbe Wert wie `RUNNER_LABEL`). Ein Probe-PR zeigt in der Zusammenfassung
   des Jobs „Geänderte Bereiche“, wohin die e2e-Jobs gingen.

## Betrieb

- **Logs:** `journalctl -u 'lifeline-runner@*' -f`, Neubau `journalctl -u lifeline-runner-image`.
- **Image neu bauen** (nach einem Playwright-Bump; der Job warnt dann im Log und lädt die Browser
  bis dahin selbst): `sudo systemctl start lifeline-runner-image.service`. Laufende Jobs bleiben
  unberührt, der nächste Job nimmt das neue Image.
- **Units geändert** (im Repo unter `systemd/`): nach dem nächsten Neubau erneut nach
  `/etc/systemd/system/` kopieren, `daemon-reload`, Plätze neu starten. Skripte zieht der Neubau
  selbst nach.
- **Caches leeren** (Verdacht auf kaputten Build-Cache): Plätze stoppen, Volumes löschen, Plätze
  starten.

  ```bash
  sudo systemctl stop 'lifeline-runner@*'
  ```

  ```bash
  docker volume rm lifeline-sccache lifeline-cargo-registry
  ```

  ```bash
  sudo systemctl start lifeline-runner@1 lifeline-runner@2 lifeline-runner@3 lifeline-runner@4
  ```

- **Platte:** `docker system df`. Alte Images räumt `build-image.sh` selbst; den Build-Cache von
  Docker gelegentlich mit `docker builder prune` kürzen. Der Compiler-Cache hält sich an
  `RUNNER_SCCACHE_SIZE`.
- **Token erneuern:** neue Datei wie oben anlegen, Plätze neu starten.

## Was auf dem Server isoliert ist

Container ohne Docker-Socket, ohne `--privileged`, ohne Host-Netz, mit `no-new-privileges`,
eigenem Docker-Netz und Grenzen für Kerne, Speicher, Prozesse. Im Image gibt es kein `sudo`. Die
JIT-Konfiguration gilt für genau einen Job und geht über eine Env-Datei mit Modus 600 hinein, das
Token gar nicht. Geteilt sind nur der Compiler-Cache und die Cargo-Registry; beide erreicht nur,
wer aus dem eigenen Repository läuft. Das Netz des Servers selbst (andere Dienste, LAN) schützt das
nicht: wer dort Dienste ohne Anmeldung betreibt, sperrt das Docker-Netz `lifeline-runner` per
Firewall davon ab.
