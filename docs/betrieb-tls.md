# Betrieb: HTTPS/TLS (`--tls`)

Standardmäßig bedient `lifeline-hub` HTTP (Dev/localhost). `--tls`
(`LIFELINE_TLS=true`) schaltet auf HTTPS um und aktiviert `Secure`-Cookies
(Session-Cookie wird nur noch über eine verschlüsselte Verbindung gesendet).

## Cert-Beschaffung (Präzedenz)

Beim Start mit `--tls` wird ein Server-Zertifikat in dieser Reihenfolge
beschafft:

1. **BYO** — `--tls-cert`/`LIFELINE_TLS_CERT` + `--tls-key`/`LIFELINE_TLS_KEY`
   (PEM-Pfade). Beide müssen zusammen gesetzt sein; ist nur einer gesetzt oder
   die Datei nicht lesbar, bricht der Start **fail-fast** ab (kein stiller
   Fallback bei explizitem BYO).
2. **Cache** — ein gültiges Cert/Key-Paar liegt bereits neben der DB-Datei
   (`lifeline-tls-cert.pem` / `lifeline-tls-key.pem` im selben Verzeichnis wie
   `--db-path`). Erneuerung erzwingen: diese beiden Dateien löschen, Server neu
   starten.
3. **mkcert** — ist `mkcert` im `PATH` verfügbar, wird damit ein lokal
   vertrauenswürdiges Zertifikat erzeugt (Cache-Pfade wie oben) und die SANs
   `localhost` + Bind-IP + optional `--tls-hostname`/`LIFELINE_TLS_HOSTNAME`
   eingetragen.
4. **rcgen-Fallback** — ist `mkcert` nicht installiert oder schlägt fehl, wird
   ein self-signed Zertifikat via `rcgen` erzeugt und gecacht. Browser zeigen
   dafür eine Zertifikatswarnung — das ist erwartbar, kein Fehler.

## mkcert für Dev/LAN einrichten

`mkcert -install` einmalig auf dem Rechner ausführen, der den Server betreibt
— das trägt mkcerts lokale Root-CA in den System-/Browser-Trust-Store ein,
damit vom Server erzeugte Zertifikate ohne Warnung akzeptiert werden. Das
passiert beim Server-Start automatisch (`--tls-mkcert-install`, Default an;
`LIFELINE_TLS_MKCERT_INSTALL=false` schaltet das ab), kann aber `sudo`
erfordern und ist deshalb auch manuell vorab sinnvoll.

**LAN-Tablets/weitere Geräte:** Die Root-CA gilt nur auf dem Gerät, auf dem
sie installiert wurde. Damit Tablets/andere Geräte im Einsatz-LAN den Server
ohne Zertifikatswarnung erreichen, muss die Root-CA von dort ausgerollt
werden — Pfad ermitteln mit:

```bash
mkcert -CAROOT
```

Die Datei `rootCA.pem` aus diesem Verzeichnis auf jedes Gerät verteilen und
dort als vertrauenswürdige CA installieren. **Ohne diesen Rollout bekommen
LAN-Geräte Zertifikatswarnungen — und WebAuthn/Passkeys funktionieren dort
nicht**, da die meisten Browser WebAuthn nur in einem als sicher eingestuften
Kontext (vertrauenswürdiges TLS) erlauben.

## `--bind` unter `--tls`

Der HTTP-Pfad löst `--bind` als Hostname auf (`TcpListener::bind`); unter
`--tls` erwartet `axum-server` dagegen eine `SocketAddr` — **`--bind` muss
daher IP:Port sein, kein Hostname** (z.B. `127.0.0.1:8443` oder
`0.0.0.0:8443`), sonst bricht der Start mit einem Fehler ab. Der Default
(`127.0.0.1:8080`) bleibt unverändert; für HTTPS auf dem gebräuchlichen Port
explizit `--bind 127.0.0.1:8443 --tls` angeben.

## Manueller Smoke-Test

```bash
lifeline-hub --tls --bind 127.0.0.1:8443
# in einem zweiten Terminal:
curl -k https://127.0.0.1:8443/api/health
```

Erwartet: HTTP 200. `-k` unterdrückt die Zertifikatswarnung des `curl`-Clients
bei einem rcgen-self-signed-Cert (nicht nötig, wenn mkcert bzw. dessen Root-CA
lokal vertrauenswürdig ist). Der automatisierte Test-Doku-Platzhalter dazu
liegt in `tests/tls_smoke.rs` (`#[ignore]`, da er einen laufenden `--tls`-
Prozess + Port + Cert braucht und daher nicht Teil der Unit-Suite ist).
