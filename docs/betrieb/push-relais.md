# Betrieb: Push-Relais für iOS (LLH-2039)

Die iOS-App ([ios-app.md](ios-app.md)) bekommt Alarme und Hinweise über Apples Push-Dienst (APNs).
APNs nimmt Pushes nur mit dem Schlüssel des Apple-Entwicklerkontos an, und dieser Schlüssel gehört
nicht auf jeden Einsatzserver. Deshalb gibt es das **Push-Relais** (`push-relais/`): ein kleiner
Dienst, den Ruben betreibt, hält den Schlüssel und reicht die Pushes der Lifeline-Server an APNs
weiter. Es läuft unter **`https://push.rubeen.dev`**; das ist auch die Standardadresse, die die
Server ansprechen (`--ios-push-relais` / `LIFELINE_IOS_PUSH_RELAIS`). Server schalten den Weg mit
`--ios-push` / `LIFELINE_IOS_PUSH` ein, standardmäßig ist er aus. Regeln für den Code:
[`push-relais/AGENTS.md`](../../push-relais/AGENTS.md).

## Was das Relais erfährt

- **Inhalt: nichts.** Die Nutzlast ist für das Gerät verschlüsselt; das Relais reicht sie durch
  und liest sie nie. Es loggt weder Geräte-Token noch Schlüssel noch Nutzlast, nur `server_id` und
  Zähler je Aufruf (zugestellt, Token ungültig, gedrosselt, Fehler).
- **Wohl aber:** welcher Server wann wie viele Pushes schickt. Dazu je Server die Zeile in der
  Datenbank (Kennung, Hash des Geheimnisses, optionaler Kontakt, Version, Sperre, letzter Aufruf).

## Apple-Schlüssel anlegen

Einmalig, im Apple-Entwicklerkonto:

1. Unter „Certificates, Identifiers & Profiles“ → „Keys“ einen Schlüssel mit der Fähigkeit
   **Apple Push Notifications service (APNs)** anlegen.
2. Die `.p8`-Datei laden. **Apple gibt sie nur einmal heraus**; sie sicher ablegen (Passwortmanager).
3. Die **Key ID** (10 Zeichen, steht am Schlüssel) und die **Team ID** (oben rechts unter
   „Membership“) notieren.
4. Die App-ID `dev.rubeen.lifeline.ios` muss die Fähigkeit „Push Notifications“ haben.

Der Schlüssel gilt für Sandbox und Produktion zugleich; welche Seite ein Push erreicht, steht je
Nachricht in der Anfrage (Debug-Builds der App melden sich in der Sandbox, TestFlight- und
Release-Builds in der Produktion).

## Umgebung

| Variable | Standard | Bedeutung |
|---|---|---|
| `PUSH_RELAIS_BIND` | `0.0.0.0:8089` | Adresse und Port, auf dem das Relais lauscht. |
| `PUSH_RELAIS_DATENBANK` | `push-relais.sqlite` | Pfad der SQLite-Datei (Server, Geheimnis-Hashes, Sperren). Im Abbild `/data/push-relais.sqlite`. |
| `PUSH_RELAIS_APNS_SCHLUESSEL` | `AuthKey.p8` | Pfad der `.p8`-Datei. Im Abbild `/geheimnisse/AuthKey.p8`. |
| `PUSH_RELAIS_APNS_KEY_ID` | leer | Key ID des Schlüssels. **Pflicht**, sonst weist Apple das Anbieter-Token ab. |
| `PUSH_RELAIS_APNS_TEAM_ID` | leer | Team ID des Entwicklerkontos. **Pflicht.** |
| `PUSH_RELAIS_BUNDLE_ID` | `dev.rubeen.lifeline.ios` | Bundle-ID der App; geht als `apns-topic` an Apple, wenn eine Nachricht kein `thema` nennt. |
| `PUSH_RELAIS_WEITERE_BUNDLE_IDS` | ungesetzt | Weitere erlaubte Bundle-IDs als Komma-Liste, z. B. `dev.rubeen.lifeline.helfer` für Aufträge an die Helfer-App (ADR-0105). Eine Nachricht wählt sie mit `thema`; ein anderes Thema weist `senden` mit 422 ab. Derselbe `.p8`-Schlüssel gilt für alle Apps des Teams. **Vor** einem Server mit Helfer-Aufträgen ausrollen: ein älteres Relais sendet sonst mit dem Hauptbundle, und Apple lehnt ab. |
| `PUSH_RELAIS_LIMIT_MINUTE` | `600` | Nachrichten je Server und Minute; darüber antwortet das Relais mit 429. |
| `PUSH_RELAIS_REGISTRIERUNGEN_STUNDE` | `10` | Registrierungen (`POST /v1/server`) je IP und Stunde; IPv6 zählt je /64. |
| `PUSH_RELAIS_HINTER_PROXY` | `false` | Hinter genau einem TLS-Proxy ohne CDN davor `true`: dann zählt der letzte (rechte) Eintrag von `X-Forwarded-For` als Client-IP, den der Proxy anhängt, sonst die Peer-Adresse. Nicht zusammen mit `PUSH_RELAIS_TRUSTED_PROXIES`. |
| `PUSH_RELAIS_TRUSTED_PROXIES` | ungesetzt | Vertraute Proxys als Komma-Liste aus Netzen (CIDR) und Adressen, z. B. das Docker-Netz von Traefik. Liegt die Gegenstelle darin, wird `X-Forwarded-For` von rechts gelesen, und der erste Eintrag außerhalb der Liste ist die Client-IP; sonst zählt die Gegenstelle. Regeln wie `LIFELINE_TRUSTED_PROXIES`: ein Hostname, ein leerer Eintrag (auch leer gesetzt) oder ein IPv4-gemapptes Netz bricht den Start ab, ebenso zusammen mit `PUSH_RELAIS_HINTER_PROXY`. Die Bereiche eines CDN gehören nicht hierher. |
| `PUSH_RELAIS_CDN_PROXIES` | ungesetzt | Bereiche eines CDN vor dem Proxy, nur zusammen mit `PUSH_RELAIS_TRUSTED_PROXIES` (sonst bricht der Start ab). Ein Eintrag daraus wird **einmal** übersprungen, der nächste ist die Client-IP. Siehe [Hinter einem CDN](#hinter-einem-cdn-r-server-cloudflare). |
| `RUST_LOG` | `info` | Log-Stufe. |

Zwei weitere Variablen (`PUSH_RELAIS_APNS_BASIS_PRODUCTION`, `PUSH_RELAIS_APNS_BASIS_SANDBOX`)
setzen die APNs-Adressen (`https://api.push.apple.com`, `https://api.sandbox.push.apple.com`);
sie sind für Tests mit einem Doppel gedacht und bleiben im Betrieb ungesetzt. `push-relais --help`
zeigt die übrigen.

**Hinter einem Proxy zwingend `PUSH_RELAIS_HINTER_PROXY=true` oder `PUSH_RELAIS_TRUSTED_PROXIES`**,
und das Relais nie am Proxy vorbei veröffentlichen: sonst zählt die Registrierungsgrenze nur die
Adresse des Proxys, und zehn Registrierungen von irgendwo sperren sie für alle. Umgekehrt darf der
Schalter ohne Proxy nicht gesetzt sein, weil dann jeder Client seine Adresse selbst wählt.

**Der Schalter nimmt genau einen Proxy an, der die Adresse seines Gegenübers an
`X-Forwarded-For` anhängt** (Traefik und nginx mit `proxy_add_x_forwarded_for` tun das). Das
Relais nimmt den rechten Eintrag; alles links davon kann der Client selbst mitschicken und zählt
nicht. Steht ein zweiter Proxy davor (etwa ein CDN), wäre der rechte Eintrag dessen Adresse und
die Grenze zählte dessen Knoten: dann statt des Schalters die Liste nehmen, siehe
[Hinter einem CDN](#hinter-einem-cdn-r-server-cloudflare).

Weitere Grenzen der Registrierung: der Körper höchstens 4 KiB (sonst 413), `version` 1 bis 64
sichtbare ASCII-Zeichen und `kontakt` höchstens 200 Zeichen ohne Steuerzeichen (sonst 400). Ein
`senden`-Aufruf ist auf 512 KiB begrenzt (413); eine Nachricht, deren Push bei Apple über
4096 Byte käme oder deren `kollaps` länger als 64 Byte oder kein sichtbares ASCII ist, weist das
Relais mit 400 ab, ein Token über 200 Hex-Zeichen wird `token_ungueltig`.

## Start per Abbild

Mit jedem Release erscheint das Abbild `ghcr.io/<eigentümer>/<repo>-push-relais:<version>`
(gleiche Tags wie das Hauptabbild; Plattformen `linux/amd64` und `linux/arm64`).

```bash
docker run -d --name push-relais --restart unless-stopped \
  -p 127.0.0.1:8089:8089 \
  -v push-relais-daten:/data \
  -v /srv/push-relais/AuthKey.p8:/geheimnisse/AuthKey.p8:ro \
  -e PUSH_RELAIS_APNS_KEY_ID=ABC123DEFG \
  -e PUSH_RELAIS_APNS_TEAM_ID=TEAM123456 \
  -e PUSH_RELAIS_TRUSTED_PROXIES=<Netz des Proxys> \
  -e PUSH_RELAIS_CDN_PROXIES=<Bereiche des CDN, falls eins davor steht> \
  ghcr.io/<eigentümer>/<repo>-push-relais:<version>
```

- Steht ein CDN vor dem Proxy (auf r-server Cloudflare), gehören seine Bereiche in
  `PUSH_RELAIS_CDN_PROXIES`, siehe [Hinter einem CDN](#hinter-einem-cdn-r-server-cloudflare); ohne
  CDN die Zeile weglassen.
- Das Abbild läuft als `nonroot` (UID 65532); die `.p8`-Datei muss für diesen Nutzer lesbar sein
  (`chmod 644` oder Besitzer 65532, Modus 400).
- `/data` ist ein Volume mit der SQLite-Datei. Ohne Volume verliert ein neuer Container alle
  Registrierungen, und jeder Lifeline-Server müsste sich neu registrieren.
- Der Start bricht ab, wenn die `.p8`-Datei fehlt oder kein PEM ist.
- Ausgehend braucht das Relais HTTPS (Port 443) zu `api.push.apple.com` und
  `api.sandbox.push.apple.com`.
- Prüfung: `curl https://push.rubeen.dev/v1/status` liefert `{"version":"…"}`.
- Ein `senden`-Aufruf stellt bis zu 16 Nachrichten zugleich zu, wartet je Nachricht höchstens 5 s
  auf Apple und endet spätestens nach 20 s; was bis dahin nicht zugestellt ist, meldet er als
  `fehler`. Der Lifeline-Server wartet 30 s. Ein Proxy davor darf eine Anfrage also nicht vor 20 s
  abbrechen.

## Domain und TLS

`push.rubeen.dev` zeigt über Cloudflare auf den Reverse-Proxy (wie die übrigen Dienste hinter
Traefik), der TLS beendet und an `127.0.0.1:8089` bzw. das Docker-Netz des Relais weiterreicht.
Das Relais spricht selbst kein TLS. Wie die Client-Adresse durch beide Proxys kommt, steht im
nächsten Abschnitt.

## Hinter einem CDN (r-server: Cloudflare)

Auf r-server stehen zwei Proxys vor dem Relais: Cloudflare (orange Wolke, die Adresse von
r-server bleibt verborgen) und Traefik. Ohne weitere Einstellung verwirft Traefik das
`X-Forwarded-For` von Cloudflare und setzt die Adresse des Cloudflare-Knotens ein; die
Registrierungsgrenze zählte dann Knoten statt Clients (LLH-2080). Gewählt ist deshalb: **Traefik
vertraut den Cloudflare-Bereichen, das Relais überspringt einen Cloudflare-Eintrag genau
einmal.** „DNS only“ (graue Wolke) schied aus, weil es die Adresse von r-server und damit aller
Dienste dort offenlegt; ein Traefik-Plugin für `CF-Connecting-IP` wäre ein Fremdbaustein mehr.

So kommt die Adresse an: Cloudflare hängt die Adresse des Clients an `X-Forwarded-For` an,
Traefik behält den Header (die Gegenstelle ist ein Cloudflare-Knoten, also vertraut) und hängt
den Knoten an. Das Relais sieht Traefik als Gegenstelle und liest
`<vom Client mitgeschickt>, <Client>, <Knoten>` von rechts: Traefik ist vertraut, der Knoten
wird als CDN-Eintrag einmal übersprungen, der nächste Eintrag ist der Client. Wer r-server direkt
anspricht statt über Cloudflare, dessen mitgeschicktes `X-Forwarded-For` verwirft Traefik weiter;
es zählt seine eigene Adresse.

**Warum zwei Listen:** Auch Anfragen von Cloudflare Workers kommen aus Cloudflare-Bereichen
(etwa `2a06:98c0:3600::103`), und ein Worker setzt `X-Forwarded-For` selbst. Stünden die Bereiche
in der Proxy-Liste, würden sie beliebig oft übersprungen, und ein eigener Worker schickte eine frei
gewählte Adresse vor: Registrierungen ohne Grenze. Weil ein CDN-Eintrag nur einmal zählt, gilt im
Worker-Fall die Adresse des Workers; alle Worker teilen sich damit eine Grenze (IPv6 je /64), echte
Clients bleiben unberührt.

1. **Traefik**, am Einstiegspunkt für HTTPS (Name wie in der Traefik-Konfiguration, meist
   `websecure`):

   ```text
   --entrypoints.websecure.forwardedHeaders.trustedIPs=<Cloudflare-Bereiche, kommagetrennt>
   ```

   **Das gilt für jeden Dienst hinter diesem Einstiegspunkt**, nicht nur für das Relais: Was ein
   Client an `X-Forwarded-*` und `X-Real-Ip` an Cloudflare schickt, reicht Traefik dann durch.
   Ein Dienst, der den linken `X-Forwarded-For`-Eintrag, `X-Real-Ip` oder `X-Forwarded-Host` liest,
   bekommt einen Wert, den der Client gewählt hat. Lifeline-Server und Relais lesen nur
   `X-Forwarded-For` von rechts und `X-Forwarded-Proto`. Für die übrigen Dienste auf r-server
   prüfen; sonst die Köpfe in einer Cloudflare-Transform-Rule („Modify Request Header“, entfernen)
   löschen oder Relais und Lifeline-Server über einen eigenen Einstiegspunkt führen.

2. **Relais** (`~/server/push-relais/docker-compose.yml`): `PUSH_RELAIS_HINTER_PROXY` entfernen
   (zusammen mit der Liste bricht der Start ab) und setzen:

   ```text
   PUSH_RELAIS_TRUSTED_PROXIES=<Docker-Netz zwischen Traefik und Relais>
   PUSH_RELAIS_CDN_PROXIES=<Cloudflare-Bereiche>
   ```

   Das Docker-Netz zeigt `docker network inspect <netz>` (Feld `Subnet`).

3. **Lifeline-Server auf demselben Traefik** (`lifeline-hub.rubeen.dev`) haben dasselbe Problem
   für Anmelde-Bremse, Passkey- und SSO-Drossel (LFH-604):

   ```text
   LIFELINE_TRUSTED_PROXIES=10.0.1.0/24
   LIFELINE_CDN_PROXIES=<Cloudflare-Bereiche>
   ```

   ([env-registry](env-registry.md)).

**Die Cloudflare-Bereiche nie in `…_TRUSTED_PROXIES`**, nur in `…_CDN_PROXIES`.

**Cloudflare-Bereiche**, Stand 23.11.2026, Quelle <https://www.cloudflare.com/ips/>
(`ips-v4`, `ips-v6`):

```text
173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

Die Liste ändert sich selten, aber sie ändert sich. Fehlt ein neuer Bereich, zählen Anfragen über
ihn wieder je Knoten; also bei jedem Update von r-server mit der Quelle abgleichen und an allen
drei Stellen gleich halten. Im Code steht keine Cloudflare-Adresse.

**Prüfen:** Die Adresse steht nicht im Log. Dass der Client und nicht der Knoten zählt, belegen
die Tests `hinter_cloudflare_zaehlt_die_adresse_des_clients` und
`worker_kann_die_grenze_nicht_umgehen` in `push-relais/tests/registrierung.rs`. Auf r-server
genügt: Das Relais startet (eine falsche Liste bricht den Start ab), und
`curl https://push.rubeen.dev/v1/status` antwortet.

## Server sperren und entsperren

Ein Server, der das Relais missbraucht oder dessen Geheimnis abgeflossen ist, wird gesperrt: seine
weiteren Aufrufe weist das Relais mit 403 ab. Die Sperre gibt es nur als Unterbefehl, mit Zugriff
auf dieselbe Datenbank:

```bash
docker exec push-relais /usr/local/bin/push-relais sperren   <server_id>
docker exec push-relais /usr/local/bin/push-relais entsperren <server_id>
```

Die `server_id` steht im Log jeder `senden`-Zeile. Ist sie nicht registriert, endet der Befehl mit
Fehler. Die Sperre wirkt sofort, ein Neustart ist nicht nötig.

Der gesperrte Lifeline-Server merkt sich die Sperre (Spalte `gesperrt_at` in `ios_push_relais`),
warnt im Log und nimmt 24 Stunden keinen Kontakt auf. Die Seite „Benachrichtigungen“ zeigt dort
statt des Schalters „Der Push-Dienst nimmt diesen Server nicht an. Bitte den Betreiber
informieren.“, die Seite „Instanzkopplung“ der Verwaltung „iOS-Push: Das Relais nimmt diesen
Server nicht an (gesperrt seit …). Bitte den Betreiber des Relais informieren.“ **Entsperren wirkt
dort mit bis zu einem Tag Verzug:** nach 24 Stunden versucht der nächste Versand es einmal mit
demselben Zugang; nimmt das Relais ihn an, fällt die Sperre, antwortet es wieder 403, gilt sie ab
dann weitere 24 Stunden. Löscht der Betreiber des Lifeline-Servers die Zeile, meldet sich der Server
beim nächsten Versand mit neuer `server_id` an. **Eine Sperre gilt nur für diese eine
`server_id`**: ein Betreiber, der sich neu registriert, bekommt eine neue, begrenzt nur durch die
Registrierungen je IP (IPv6: je /64) und Stunde
([Risiko R54](../architektur/11-risiken-und-technische-schulden.md)).

## Sicherung

Gesichert wird die **SQLite-Datei** (`/data/push-relais.sqlite`) und separat die **`.p8`-Datei**
(Passwortmanager, nie in dasselbe Archiv). Für die Datenbank ein konsistentes Abbild ziehen, nicht
die Datei im Betrieb kopieren:

```bash
docker run --rm -v push-relais-daten:/data -v "$PWD":/sicherung debian:13-slim \
  sh -c 'apt-get update -qq && apt-get install -y -qq sqlite3 \
    && sqlite3 /data/push-relais.sqlite ".backup /sicherung/push-relais.sqlite"'
```

Geht die Datenbank verloren, kennt das Relais keinen Server mehr und antwortet mit 401
`unbekannt`; jeder Lifeline-Server muss sich dann neu registrieren, und Sperren fehlen und sind neu
zu setzen. Im Einsatz selbst geht dabei nichts verloren, nur der iOS-Push fällt bis dahin aus.

## Gerätetest (Debug-Build gegen Sandbox)

Ein Push lässt sich nur auf einem echten iPhone prüfen, nicht im Simulator.

1. Das Relais läuft (siehe oben) und `GET /v1/status` antwortet.
2. Einen Lifeline-Server mit `LIFELINE_IOS_PUSH=true` starten (Relais-Adresse bei Bedarf mit
   `LIFELINE_IOS_PUSH_RELAIS` auf das Testrelais setzen).
3. Die App als **Debug-Build** aus Xcode auf das Gerät installieren; Debug-Builds tragen die
   APNs-Umgebung „development“ und melden das Gerät bei der **Sandbox** an. TestFlight-Builds
   gehören zur Produktion.
4. In der App am Server anmelden, unter Benutzermenü → „Benachrichtigungen“ den Schalter „Auch
   bei geschlossener App“ einschalten und die Mitteilungen erlauben.
5. Die App schließen und auf dem Server einen Alarm auslösen (Benachrichtigung mit Stufe Alarm).
   Erwartet: Der Push erscheint bei gesperrtem Gerät mit Titel und Detail wie im Browser; steht
   nur „Alarm“ bzw. „Neue Benachrichtigung“ mit „Öffnen, um die Meldung zu sehen“, hat die
   Extension die Nutzlast nicht geöffnet (Schlüsselbund oder App Group). Im Relais-Log steht eine
   `senden`-Zeile mit `zugestellt=1`. Tippen öffnet die Seite der Meldung.
6. Bleibt der Push aus: `token_ungueltig` heißt, Sandbox und Produktion passen nicht zum
   Build (Debug gegen Produktion oder umgekehrt); `fehler` heißt, Key ID, Team ID oder Schlüssel
   stimmen nicht; `gedrosselt` kommt von Apple.
