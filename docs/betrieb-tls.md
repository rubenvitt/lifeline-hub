# Betrieb: HTTPS/TLS (`--tls`)

Standardmäßig bedient `lifeline-hub` HTTP (Dev/localhost). `--tls`
(`LIFELINE_TLS=true`) schaltet auf HTTPS um und aktiviert `Secure`-Cookies
(Session-Cookie wird nur noch über eine verschlüsselte Verbindung gesendet).

## Hinter einem TLS-Proxy (LFH-603)

Terminiert ein Reverse-Proxy (Traefik o. Ä.) TLS und spricht die App selbst
HTTP, entscheidet jede Anfrage selbst: Kommt sie mit
`X-Forwarded-Proto: https`, tragen Sitzungs-, MFA-, OIDC- und
WebAuthn-Cookies `Secure` wie unter `--tls`. Traefik setzt diesen Kopf von
sich aus, es ist nichts zu konfigurieren. Ein direkter http-Aufruf (LAN,
Dev) bekommt die Cookies weiter ohne `Secure`, sonst legte der Browser sie
nicht ab und die Anmeldung schlüge fehl.

Setzt ein Proxy den Kopf nicht, erzwingt `--cookie-secure`
(`LIFELINE_COOKIE_SECURE=true`) `Secure` für jede Antwort.

## Einwurf nur über TLS (LLH-1654, ADR-0023)

Der Schlüssel eines Einwurf-Zugangs steht in der URL (`/api/v1/einwurf/<schlüssel>/…`,
`docs/api/einwurf.md`). Der Server nimmt einen Einwurf deshalb nur an, wenn er
verschlüsselt ankam, sonst antwortet er mit `403 tls_required`
(`src/public_api/einwurf/routen.rs`, `is_tls_nachgewiesen` in `src/extract.rs`):

- **Eigenes TLS:** mit `--tls` gilt jede Anfrage als verschlüsselt.
- **Hinter einem Reverse-Proxy:** `X-Forwarded-Proto: https` zählt nur, wenn die
  Gegenstelle in `--trusted-proxies` (`LIFELINE_TRUSTED_PROXIES`) steht. Ohne diese
  Liste lehnt der Server jeden Einwurf ab. Anders als bei den Cookies oben reicht der
  Kopf allein nicht: Hier ist er eine Zugangsbedingung, und jeder könnte ihn setzen.
- **Der Proxy setzt den Kopf, er hängt ihn nicht an.** Jeder Wert des Kopfes muss
  `https` lauten. Reicht ein Proxy einen mitgeschickten Wert weiter und hängt seinen
  an (`https, http`), lehnt der Server ab. Traefik ersetzt den Kopf, solange der
  Einstiegspunkt keinen vorgelagerten Stellen traut (`forwardedHeaders`).
- **Ohne TLS nur mit Schalter:** `--einwurf-allow-http`
  (`LIFELINE_EINWURF_ALLOW_HTTP=true`) nimmt Einwürfe auch unverschlüsselt an. Er ist
  für ein Netz gedacht, das selbst verschlüsselt (Tailnet, WireGuard). Ohne `--tls`
  schreibt der Server dann beim Start eine Warnzeile, und die Seite „Anbindungen“
  warnt. Mit `--tls` hat der Schalter keine Wirkung, weil nichts unverschlüsselt
  ankommt.

Die Seite „Anbindungen“ zeigt im Paneel „Einwurf-Zugänge“ auch den Fall, dass die
Instanz weder TLS terminiert noch einen vertrauten Proxy kennt: Dann werden Einwürfe
abgelehnt.

### Der Proxy protokolliert unter `/api/v1/einwurf/` nichts

Der Server selbst schreibt den Schlüssel in kein Protokoll
(`docs/betrieb/observability.md`, „Request-Log“). Das Zugriffsprotokoll und die Traces
eines Reverse-Proxys enthalten aber den Pfad und meist die Abfrage, bei GET also den
Schlüssel und den Alarmtext. Der Betreiber stellt beides für diese Routen ab.

Mit Traefik ab 3.3 geht das je Router. Ein eigener Router für den Einwurf, ohne
Zugriffsprotokoll und ohne Traces, zeigt auf denselben Dienst:

```yaml
labels:
  - 'traefik.http.routers.lifeline-einwurf.rule=Host(`hub.example`) && PathPrefix(`/api/v1/einwurf/`)'
  - 'traefik.http.routers.lifeline-einwurf.service=lifeline'
  - 'traefik.http.routers.lifeline-einwurf.observability.accesslogs=false'
  - 'traefik.http.routers.lifeline-einwurf.observability.tracing=false'
```

Bei anderen Proxys gilt dasselbe Ziel: kein Eintrag im Zugriffsprotokoll für Pfade
unter `/api/v1/einwurf/`, auch nicht bei Fehlern.

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
explizit `--bind 127.0.0.1:8443 --tls` angeben. Für Zugriff aus dem LAN
zusätzlich `--tls-hostname` setzen (oder direkt an eine konkrete LAN-IP
binden, z.B. `--bind 192.168.1.10:8443`) — sonst deckt das Zertifikat nur
`localhost`/`127.0.0.1` ab und andere Geräte bekommen eine Zertifikatswarnung.

## Direktkopplung vor Ort (LLH-1497)

Zwei Instanzen im selben Netz (etwa zwei ELW) koppeln sich auch mit selbst signiertem oder
mkcert-Zertifikat, ohne dass eine Seite der anderen vertraut: Die ausstellende Seite nennt beim
Koppeln den Fingerabdruck ihres Zertifikats in einer signierten Antwort, die einlösende pinnt
ihn. Nach einem neuen Zertifikat (etwa neu erzeugt nach einem IP-Wechsel) holt die einlösende
Seite zuerst eine signierte Aussage ein, bevor sie wieder Daten schickt
([ADR-0029](architektur/entscheidungen/ADR-0029-eine-direktkopplung-beglaubigt-das-tls-zertifikat-per-signierter-aussage.md)).
Voraussetzung: **`--tls` an der ausstellenden Instanz**; hinter einem TLS-Proxy kennt die Instanz
ihr Zertifikat nicht, dort gibt es keinen Code „vor Ort“. Für die Bedienung im Browser bleibt das
Vertrauen ins Zertifikat nötig wie oben beschrieben.

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

## `--tls` hebt das Multi-Tab-Verbindungslimit auf (HTTP/2, F21/LFH-264)

`--tls` handelt per ALPN **HTTP/2** aus. HTTP/2 multiplext alle Requests über
**eine** TCP-Verbindung — damit entfällt das Browser-Limit von ~6 HTTP/1.1-
Verbindungen je Origin.

Warum das im Lagezentrum wichtig ist: im Klartext-HTTP-Betrieb (ohne `--tls`)
spricht der Browser nur HTTP/1.1. Öffnet ein Profil mehrere App-Fenster
(Lagekarte am Beamer, ETB, Kräfteübersicht, ggf. ein zweiter Einsatz), hält
jedes Fenster eine langlebige SSE-Verbindung. Ab dem ~6.–7. Fenster sind alle
Origin-Slots belegt und **jeder weitere Request (Mutation, Refetch, auch der
von SSE-Events ausgelöste Invalidate-Refetch) hängt** — genau unter Last kippt
das Live-System in den Totalstau.

**Empfehlung:** Für Setups mit mehreren gleichzeitigen App-Fenstern `--tls`
betreiben (oder einen Reverse-Proxy mit HTTP/2-Terminierung vorschalten). Dann
teilen sich beliebig viele Tabs/Fenster dieselbe multiplexte h2-Verbindung.

**Rest-Lücke (offen, LFH-264):** Für reine **Klartext-HTTP-LAN**-Deployments
ohne TLS greift diese Mitigation nicht. Dort bleibt als Ausbaustufe das
Tab-übergreifende Teilen EINER `EventSource` (SharedWorker bzw. Leader-Election
via Web Locks API + BroadcastChannel) offen — siehe `useEinsatzLiveStream`.
Intra-Tab ist bereits auf genau eine EventSource konsolidiert (LFH-207/122),
sodass ein einzelnes Fenster nie mehr als eine SSE-Verbindung hält.
