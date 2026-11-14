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
| `build-image.sh` | baut `lifeline-runner:latest` mit der Playwright-Version aus dem Lockfile, löscht alte Images; `--update` holt vorher `alpha` und baut ohne Cache |
| `runner-loop.sh` | ein Platz: JIT-Registrierung holen, Container für einen Job starten, von vorn |
| `select-runner.sh` | Runner-Wahl in `e2e.yml` (Job `aenderungen`, bei PRs aus dem Ziel-Branch gelesen) |
| `*.test.sh` | Selbsttests im Sammel-Gate (Schritt 11), auch der Wächter über die `sudo`-Schritte in `e2e.yml` |
| `systemd/` | `lifeline-runner@.service` je Platz, Timer für den wöchentlichen Neubau |
| `runner.env.beispiel` | Vorlage für `/etc/lifeline-runner/runner.env` |

## Einrichten

Voraussetzungen: Linux mit systemd, Docker Engine, `git` und `curl`; für vier Plätze mindestens
8 Kerne, 16 GB Speicher und rund 60 GB Platte (Image 6–7 GB, Compiler-Cache bis 20 GB, je
laufendem Job einige GB). Am besten liegt `/var/lib/docker` auf einer eigenen Partition: ein Job,
der die Platte füllt, trifft dann nur die Runner, nicht den Host.

1. **Dienstnutzer.** Mitglied der Gruppe `docker` heißt auf diesem Host root-gleich; deshalb ein
   eigener Systemnutzer, der sonst nichts tut. Die Jobs selbst sehen den Docker-Socket nie.

   ```bash
   sudo useradd --system --home-dir /opt/lifeline-runner --create-home --shell /usr/sbin/nologin lifeline-runner
   ```

   ```bash
   sudo usermod -aG docker lifeline-runner
   ```

2. **Klon.** Units, Skripte und Dockerfile kommen aus diesem Klon; der Timer setzt ihn jede Woche
   hart auf `origin/alpha`. Nichts darin von Hand ändern. Damit gilt (ADR-0025, angenommen am
   12.11.2026): jeder Merge auf `alpha` ist Code auf diesem Host, mit Docker-Rechten und Zugriff
   auf das Token.

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
   contributors**. Die Weiche hält Fork-PRs vom Server fern und wird bei PRs aus dem Ziel-Branch
   gelesen, ein Fork kann sie also nicht umstellen. Eine Sicherheitsgrenze ist sie trotzdem
   nicht: ein Fork kann die Workflows unter `.github/` ändern und das Label selbst eintragen. Vor
   jeder Freigabe deshalb die Änderungen unter `.github/` lesen.
2. **Einschalten.** Settings → Secrets and variables → Actions → Variables → `E2E_RUNNER` =
   `lifeline-e2e` (derselbe Wert wie `RUNNER_LABEL`). Ein Probe-PR mit dem Label `voll` zeigt in der
   Zusammenfassung des Jobs „e2e-Runner“, wohin die e2e-Jobs gingen.

## Betrieb

- **Logs:** `journalctl -u 'lifeline-runner@*' -f`, Neubau `journalctl -u lifeline-runner-image`.
- **Image neu bauen** (nach einem Playwright-Bump; der Job warnt dann im Log und lädt die Browser
  bis dahin selbst): `sudo systemctl start lifeline-runner-image.service`. Laufende Jobs bleiben
  unberührt, der nächste Job nimmt das neue Image.
- **Units geändert** (im Repo unter `systemd/`): nach dem nächsten Neubau erneut nach
  `/etc/systemd/system/` kopieren, `daemon-reload`, Plätze neu starten. Skripte zieht der Neubau
  selbst nach.
- **Caches leeren** (Verdacht auf kaputten oder vergifteten Build-Cache, etwa nach einem
  zurückgezogenen Dependabot-Update): Plätze stoppen, Volume löschen, Plätze starten.

  ```bash
  sudo systemctl stop 'lifeline-runner@*'
  ```

  ```bash
  docker volume rm lifeline-sccache
  ```

  ```bash
  sudo systemctl start lifeline-runner@1 lifeline-runner@2 lifeline-runner@3 lifeline-runner@4
  ```

- **Platte:** `docker system df`. Alte Images räumt `build-image.sh` selbst; den Build-Cache von
  Docker gelegentlich mit `docker builder prune` kürzen. Der Compiler-Cache hält sich an
  `RUNNER_SCCACHE_SIZE`. Container und ihr Arbeitsverzeichnis verschwinden nach jedem Job.
- **Netz neu anlegen** (nach einer Änderung an seinen Optionen): Plätze stoppen,
  `docker network rm lifeline-runner`, Plätze starten; der erste Platz legt es neu an.
- **Token erneuern:** neue Datei wie oben anlegen, Plätze neu starten.

## Was auf dem Server isoliert ist

Container ohne Docker-Socket, ohne `--privileged`, ohne Host-Netz, mit `no-new-privileges` und
Grenzen für Kerne, Speicher, Prozesse. Im eigenen Docker-Netz erreichen sich gleichzeitige Jobs
nicht (`enable_icc=false`). Im Image gibt es kein `sudo`. Die JIT-Konfiguration gilt für genau
einen Job und geht über eine Env-Datei mit Modus 600 hinein, das Token gar nicht.

Geteilt ist nur der Compiler-Cache. Ihn erreicht jeder Lauf aus dem eigenen Repository, auch ein
Dependabot-PR mit neuem Fremdcode; ein vergifteter Eintrag träfe das e2e-Binary späterer Läufe,
nicht die Release-Artefakte, die GitHub baut (ADR-0025, angenommen).

Was Docker nicht abschirmt, sind der Host und das LAN: ein Job erreicht über das Gateway des
Netzes jeden Dienst des Hosts und jedes Gerät im LAN, auf einem Cloud-Server auch den
Metadaten-Endpunkt. Laufen dort Dienste ohne Anmeldung, das Netz per Firewall davon trennen,
etwa so (Subnetz aus `docker network inspect lifeline-runner`, LAN anpassen):

```bash
sudo iptables -I DOCKER-USER -s 172.18.0.0/16 -d 192.168.0.0/16,10.0.0.0/8,169.254.169.254 -j REJECT
```

```bash
sudo iptables -I INPUT -s 172.18.0.0/16 -j REJECT
```

Beide Regeln überdauern keinen Neustart; dauerhaft über das Firewall-Werkzeug des Servers.
