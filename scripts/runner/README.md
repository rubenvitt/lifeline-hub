# Eigener Runner

Bei einem Push auf `alpha`, `beta` oder `main` laufen die schweren Suiten der CI auf einem
eigenen Server statt auf GitHub-Runnern, sobald die Repo-Variable `E2E_RUNNER` gesetzt ist:
Rust-Suite, `e2e-Binary` und die vier e2e-Anteile (LLH-1666, LLH-2014, ADR-0075). Die vier
Frontend-Anteile laufen immer bei GitHub (LLH-2016, ADR-0076). Die Wahl trifft der Job `runner` in `.github/workflows/suiten.yml`. Jeder
Job bekommt einen frischen Container, der nach dem Job gelöscht wird. **PR-Läufe laufen nie
hier**, auch nicht mit dem Label `voll`. iOS-Kern, Schnellprüfungen, Berichte und Release bleiben
bei GitHub.

## Wenn der Server ausfällt

**Settings → Secrets and variables → Actions → Variables → `E2E_RUNNER` leeren.** Ab dem nächsten
Lauf ist alles wieder auf GitHub. Jobs, die schon auf den Server warten, abbrechen und neu
starten.

## Was hier liegt

| Datei | Zweck |
| --- | --- |
| `Dockerfile` | Runner-Image: Runner, Playwright-Browser samt Systempaketen, Build-Werkzeuge, GTK/WebKit für die Desktop-Hülle, `sccache`, kein `sudo` |
| `build-image.sh` | baut `lifeline-runner:latest` mit der Playwright-Version aus dem Lockfile, löscht alte Images; `--update` holt vorher `alpha` und baut ohne Cache |
| `runner-loop.sh` | ein Platz: JIT-Registrierung holen, Container für einen Job starten, Runner abmelden, von vorn |
| `select-runner.sh` | Runner-Wahl in `suiten.yml` (Job `runner`, bei PRs aus dem Ziel-Branch gelesen): Label nur bei Push |
| `*.test.sh` | Selbsttests im Sammel-Gate (Schritt 11), auch der Wächter über die `sudo`-Schritte in `e2e.yml` |
| `systemd/` | `lifeline-runner@.service` je Platz, Timer für den wöchentlichen Neubau |
| `runner.env.beispiel` | Vorlage für `/etc/lifeline-runner/runner.env` |

## Einrichten

Voraussetzungen: Linux mit systemd, Docker Engine, `git` und `curl`; für vier Plätze 12 Kerne,
rund 62 GB Speicher und rund 110 GB Platte (Image 6–7 GB, Compiler-Cache bis 20 GB, die
Rust-Suite rund 60 GB, jeder andere laufende Job einige GB); Größenregel unter „Plätze und
Größe“. Am besten liegt `/var/lib/docker` auf einer eigenen Partition: ein Job, der die Platte
füllt, trifft dann nur die Runner, nicht den Host.

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

4. **Konfiguration.** Die Grenzen sind Deckel je Container, keine Reservierung; den Speicher
   bestimmt die Rust-Suite (Abschnitt „Plätze und Größe“).

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
   Job; ein neuer nimmt seinen Platz ein. Ein gestoppter Platz meldet seinen wartenden Runner
   ab, und beim Start löscht er Offline-Runner, die ein früherer Lauf desselben Platzes
   hinterlassen hat (etwa nach einem Stromausfall). Fremde Plätze und Hosts fasst er nicht an.

## Im Repo einstellen

1. **Fork-Freigabe (Pflicht, ADR-0075).** Settings → Actions → General → *Approval for running
   fork pull request workflows from contributors* → **Require approval for all external
   contributors**. Die Weiche hält jeden PR vom Server fern und wird bei PRs aus dem Ziel-Branch
   gelesen, ein PR kann sie also nicht für sich umstellen. Eine Sicherheitsgrenze ist sie trotzdem
   nicht: ein Fork kann die Workflows unter `.github/` ändern und das Label selbst eintragen. Vor
   jeder Freigabe deshalb die Änderungen unter `.github/` lesen.
2. **Einschalten.** Settings → Secrets and variables → Actions → Variables → `E2E_RUNNER` =
   `lifeline-e2e` (derselbe Wert wie `RUNNER_LABEL`), etwa mit
   `gh variable set E2E_RUNNER --repo rubenvitt/lifeline-hub --body lifeline-e2e`. Der nächste Push
   auf `alpha` zeigt in der Zusammenfassung des Jobs „Suiten-Runner“, wohin die Suiten gingen.

## Nach einem Merge an `scripts/runner/`

Der Timer zieht Klon und Image nur einmal die Woche nach. Nach einem Merge, der das Dockerfile
oder `runner-loop.sh` ändert, beides von Hand: das Image neu bauen (holt vorher `alpha`) und die
Plätze neu starten, damit sie das neue Skript laden. Ein laufender Job wird dabei abgebrochen;
also wenn gerade nichts läuft.

```bash
sudo systemctl start lifeline-runner-image.service
```

```bash
sudo systemctl restart 'lifeline-runner@*'
```

Fehlen dem Image die GTK/WebKit-Pakete, bricht die Rust-Suite auf dem Server früh mit einem
Hinweis auf diesen Abschnitt ab.

Die Rust-Toolchain kommt auf dem Server aus dem Image und wird im Job nicht aktualisiert: ein
Update an Ort und Stelle scheitert im Container an overlayfs („Invalid cross-device link“,
LLH-2015). Ist ein neues Rust-Stable erschienen, warnt der Schritt „Rust-Toolchain (eigener
Runner)“, und die Jobs laufen bis zum nächsten Neubau mit dem älteren weiter. Wer das neue sofort
will, baut das Image wie oben neu.

## Plätze und Größe

Ein Push bringt bis zu sechs Jobs auf den Server: Rust-Suite und `e2e-Binary` zuerst, danach die
vier e2e-Anteile. Mehr Jobs als Plätze warten. Je Platz gelten `RUNNER_CPUS` Kerne und
`RUNNER_MEMORY` Speicher als Deckel, keine Reservierung.

- **Kerne nicht überbuchen:** Plätze × `RUNNER_CPUS` höchstens so viele wie `nproc`. Überbucht
  bremsen sich die e2e-Anteile gegenseitig aus und reißen das Zeitlimit von 75 min.
- **Speicher:** den Bedarf setzt die Rust-Suite. rustc übersetzt das Crate `lifeline_hub` als
  Bibliothek (gemessen rund 6 GB Spitze) und zugleich als Testbibliothek (rund 10 GB), zusammen
  rund 13 GB; ohne Debuginfo und mit einem Job sind es immer noch 9,8 GB. Mit 6 GB brach sie mit
  „Compiler killed by signal 9“ ab (alpha, 21.11.2026). Vorgabe ist deshalb `14g`. Plätze ×
  `RUNNER_MEMORY` plus einige GB für den Host: die Grenze ist ein Deckel, und reicht der Host
  nicht, beendet der Kernel denselben Compiler.
- **Platte:** die Testbinaries der Rust-Suite belegen im Container rund 50 GB, der
  Inkrementalcache weitere 8 GB.
- **Beispiel** (12 Kerne, 62 GB): vier Plätze, `RUNNER_CPUS=3`, `RUNNER_MEMORY=14g`.

Einen Platz abschalten: `sudo systemctl disable --now lifeline-runner@5`; einen dazu:
`sudo systemctl enable --now lifeline-runner@5`. Nach einer Änderung an `runner.env` die Plätze
neu starten.

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

Geteilt ist nur der Compiler-Cache. Ihn erreicht seit ADR-0075 nur noch gemergter Code (Push auf
einen Kanal-Branch), kein offener PR mehr; ein gemergtes Dependabot-Update mit vergiftetem
Fremdcode träfe aber die Suiten späterer Läufe, nicht die Release-Artefakte, die GitHub baut.

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
