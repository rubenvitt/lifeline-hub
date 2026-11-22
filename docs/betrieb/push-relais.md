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
| `PUSH_RELAIS_BUNDLE_ID` | `dev.rubeen.lifeline.ios` | Bundle-ID der App; geht als `apns-topic` an Apple. |
| `PUSH_RELAIS_LIMIT_MINUTE` | `600` | Nachrichten je Server und Minute; darüber antwortet das Relais mit 429. |
| `PUSH_RELAIS_REGISTRIERUNGEN_STUNDE` | `10` | Registrierungen (`POST /v1/server`) je IP und Stunde. |
| `PUSH_RELAIS_HINTER_PROXY` | `false` | Hinter einem TLS-Proxy `true`: dann zählt der erste Eintrag von `X-Forwarded-For` als Client-IP, sonst die Peer-Adresse. |
| `RUST_LOG` | `info` | Log-Stufe. |

Zwei weitere Variablen (`PUSH_RELAIS_APNS_BASIS_PRODUCTION`, `PUSH_RELAIS_APNS_BASIS_SANDBOX`)
setzen die APNs-Adressen (`https://api.push.apple.com`, `https://api.sandbox.push.apple.com`);
sie sind für Tests mit einem Doppel gedacht und bleiben im Betrieb ungesetzt. `push-relais --help`
zeigt die übrigen.

**Hinter dem Proxy zwingend `PUSH_RELAIS_HINTER_PROXY=true`**, und das Relais nie am Proxy vorbei
veröffentlichen: sonst zählt die Registrierungsgrenze nur die Adresse des Proxys, und zehn
Registrierungen von irgendwo sperren sie für alle. Umgekehrt darf der Schalter ohne Proxy nicht
gesetzt sein, weil dann jeder Client seine Adresse selbst wählt.

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
  -e PUSH_RELAIS_HINTER_PROXY=true \
  ghcr.io/<eigentümer>/<repo>-push-relais:<version>
```

- Das Abbild läuft als `nonroot` (UID 65532); die `.p8`-Datei muss für diesen Nutzer lesbar sein
  (`chmod 644` oder Besitzer 65532, Modus 400).
- `/data` ist ein Volume mit der SQLite-Datei. Ohne Volume verliert ein neuer Container alle
  Registrierungen, und jeder Lifeline-Server müsste sich neu registrieren.
- Der Start bricht ab, wenn die `.p8`-Datei fehlt oder kein PEM ist.
- Ausgehend braucht das Relais HTTPS (Port 443) zu `api.push.apple.com` und
  `api.sandbox.push.apple.com`.
- Prüfung: `curl https://push.rubeen.dev/v1/status` liefert `{"version":"…"}`.

## Domain und TLS

`push.rubeen.dev` zeigt auf den Reverse-Proxy (wie die übrigen Dienste hinter Traefik), der TLS
beendet und an `127.0.0.1:8089` bzw. das Docker-Netz des Relais weiterreicht. Das Relais spricht
selbst kein TLS. Der Proxy setzt `X-Forwarded-For`; dazu `PUSH_RELAIS_HINTER_PROXY=true`.

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
beim nächsten Versand mit neuer `server_id` an; eine Sperre lässt sich so umgehen, begrenzt nur
durch die Registrierungen je IP und Stunde
([Risiko R48](../architektur/11-risiken-und-technische-schulden.md)).

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
