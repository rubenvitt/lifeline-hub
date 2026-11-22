# iOS-App: Alarme bei geschlossener App über Apple Push (LLH-1981)

Zunder: https://zunder.rubeen.dev/#/aufgabe/mbbk7iwoaarmf1z57qc8ffwo

Subtasks: LLH-2039 (Push-Relais), LLH-2040 (Kanal im Server), LLH-2041 (iOS-App), LLH-2042
(Frontend und Doku). Ein Entwurf, ein Plan, ein Branch, ein PR.

Voller Entwurf. Lösungsweg abgestimmt mit Ruben am 22.11.2026 (Phase-1-Checkpoint, zwei
Fragerunden). Was mit „(Claude)“ markiert ist, hat Claude festgelegt; es steht zur Prüfung bei
der Freigabe.

## Absicht

Seit LLH-1978 gibt es die iOS-App als Swift-Hülle um die Weboberfläche. iOS hält sie kurz nach
dem Wechsel in den Hintergrund an, der Live-Kanal (SSE) ruht, und Web Push gibt es im WKWebView
nicht (Entwurf LLH-1978, Fakt 1 und Fakt 7). Eine Sofortmeldung oder Vermisstenmeldung erreicht
ein iPhone deshalb erst, wenn jemand die App öffnet (Risiko R45). Für eine Einsatzkraft, die das
iPhone in der Tasche hat, ist die App damit als Alarmweg unbrauchbar.

Ziel ist, dass Alarme und Hinweise ein iPhone mit geschlossener App so erreichen wie heute einen
Browser mit Web Push: mit Titel und Detail auf dem Sperrbildschirm, ohne dass Apple oder ein
Dritter den Inhalt lesen kann, und ein Tippen führt in den richtigen Einsatz auf dem richtigen
Server.

## Ausgangslage (Fakten aus dem Code)

- **Web Push** ist selbst gebaut (`src/web_push/`, `openssl` für RFC 8291 und VAPID-ES256,
  `reqwest`). Einziger Sendeort ist `benachrichtigung::ausliefern`
  (`src/benachrichtigung/mod.rs`), Empfänger und Stufen kommen aus `aufloesung::empfaenger`. Die
  Nutzlast trägt nur IDs (`BenachrichtigungEreignis`), der Service Worker holt Titel, Detail und
  Pfad über `GET /api/benachrichtigungen/{id}` mit der Sitzung.
- Abos (`web_push_abo`, Migration 0203, 0266, 0267) hängen an Konto **und** Sitzung
  (`ON DELETE CASCADE`), tragen `inhalt` („Mit Absender und Wortlaut“) und `stumm` (stumme
  Hinweis-Arten je Gerät). Ein 404/410 des Push-Dienstes löscht das Abo. Betreiber-Opt-in über
  `--web-push`, ohne es keine ausgehende Verbindung und 404 auf den Routen.
- **Kopplung** (ADR-0027, `src/instanz/spiegel/hinweis.rs`): Jede Instanz hat ihren eigenen
  Schlüssel. Für Konten, die vom Hub stammen, schickt das ELW den Anlass an den Hub, der pusht;
  das ELW nimmt für solche Konten kein neues Abo an (422, „Push läuft über ‹Hub›“). Fähigkeit
  `MeldenAntwort.web_push`.
- **iOS-Hülle**: Brücke `window.webkit.messageHandlers.lifeline` mit `{cmd,id,…}`, Antwort über
  `window.__LIFELINE_REPLY__`, Wire-Vertrag im Kopf von `ios/App/Huelle/huelle.js`; Kennung
  `window.__LIFELINE_HUELLE__`, im Frontend nur über `frontend/src/huelle/faehigkeiten.ts`. Lokale
  Meldungen nur bei laufender App (`Systemdienste.swift`); kein `didReceive`, kein
  `aps-environment`, keine Entitlements-Datei, kein AppDelegate. Die Hülle lädt immer die
  Startseite eines Servers, Sprünge in einen Pfad gibt es nicht. Jeder Server hat einen eigenen
  `WKWebsiteDataStore`; nur der aktive hat einen WebView.
- Bundle `dev.rubeen.lifeline.ios`, Team `H95J852PKP`. TestFlight-Builds werden mit
  `app-store-connect` exportiert, laufen also gegen APNs-Production; Debug-Builds aus Xcode gegen
  Sandbox.
- Lifeline-Server werden von verschiedenen Betreibern selbst betrieben
  (`LIFELINE_BETREIBER_KONTAKT`), die App gibt es aber nur einmal. Den APNs-Schlüssel (`.p8`)
  vergibt Apple nur an Rubens Team.
- Präzedenz für einen eigenen Dienst im Repo: `karten-service/` (Workspace-Mitglied, eigene
  Binary, eigenes `Dockerfile`, gebaut in `.github/workflows/artefakte.yml`).

## Ziele

1. Ein Alarm oder Hinweis erscheint auf einem iPhone mit geschlossener, verdeckter oder beendeter
   App, sofern die Person in der App Push eingeschaltet hat — mit denselben Regeln wie Web Push:
   Alarm immer, Hinweis nicht bei einer auf diesem Gerät stummen Art, Still nie, Ablauf nach
   12 Stunden.
2. Titel und Detail stehen wie beim Web Push auf dem Sperrbildschirm, mit „Mit Absender und
   Wortlaut“ auch der Wortlaut. Apple und das Relais sehen davon nichts.
3. Alarme sind **zeitkritisch** (`interruption-level: time-sensitive`) und kommen durch den
   Fokus, sofern die Person das für die App nicht abgeschaltet hat.
4. Wer mehrere Server in der App hat, bekommt Meldungen von **jedem** Server, bei dem sie
   Push eingeschaltet hat, auch wenn die Sitzung dort inzwischen abgelaufen ist. Bei mehr als einem Server nennt die Meldung den
   Server.
5. Tippen auf die Meldung öffnet den richtigen Server und dort den Pfad der Benachrichtigung
   (wie `alarm-sw.js`). Ist ein anderer Server aktiv, wechselt die App sichtbar.
6. Betreiber brauchen keinen Kontakt zu Ruben: Ein Server mit eingeschaltetem iOS-Push
   registriert sich selbst beim Relais.
7. Ruben betreibt einen eigenen Dienst, das **Push-Relais**, der als einziger den `.p8` hält.

## Nicht-Ziele

- Kritische Warnungen (Critical Alerts, klingen trotz Stumm). Brauchen einen Antrag bei Apple;
  eigene Folgeaufgabe, wenn gewünscht.
- Zurückziehen einer zugestellten Meldung, wenn sie anderswo quittiert wird. Web Push schließt
  sie nur beim nächsten Push oder wenn ein Tab offen ist; für iOS wäre das ein Hintergrund-Push
  mit eigener Logik. Folgeaufgabe.
- Zahl am App-Symbol aus dem Push. Bleibt wie heute bei laufender App.
- Push für Android oder die Desktop-Hülle.
- Ein Relais für Web Push. Web Push bleibt direkt.
- Hochverfügbarkeit des Relais (ein Prozess, eine SQLite-Datei). Fällt es aus, kommen keine
  iOS-Pushes; Web Push und die offene App sind davon unberührt.

## Anti-Ziele

- Apple, das Relais oder ein Mitleser sieht Titel, Detail, Wortlaut, Einsatz-ID oder Namen.
- Ein Betreiber kommt an den `.p8`-Schlüssel oder kann Geräte erreichen, die sich nicht bei
  seinem Server angemeldet haben.
- Ein Fehler beim iOS-Push verzögert oder scheitert die auslösende Anfrage (wie bei Web Push).
- Die App wechselt still auf einen anderen Server (Anti-Ziel aus LLH-1978); ein Wechsel nach dem
  Tippen ist sichtbar und folgt einer Handlung der Person.
- Anwendungslogik in der Hülle (ADR-0068): die App meldet Token und Schlüssel über die Brücke,
  den Schalter, die Abstimmung mit dem Server und die Stumm-Wahl macht die Weboberfläche.
- Das Token oder die Nutzlast landet in einem Log (Relais oder Server).

## Ansätze

- **A: Schlüssel bei jedem Betreiber.** Jeder Server bekommt `.p8`, Key-ID und Team-ID
  (age-verschlüsselt nach ADR-0077) und schickt direkt an Apple. Wenig Code, aber jeder Betreiber
  hält Rubens Team-Schlüssel; ein Leck trifft alle, sperren lässt sich kein einzelner.
- **B: Relais als eigener Dienst, den Ruben betreibt (gewählt).** Das Relais hält den Schlüssel,
  Server schicken nur Token und verschlüsselte Nutzlast. Schlüssel bleibt bei einem, einzelne
  Server sind sperrbar. Kostet einen zweiten Dienst samt Betrieb. Gewählt von Ruben: „ich sehe
  hier einen dienst, der entwickelt werden muss zusätzlich, den ich betreibe“.
- **C: Relais-Modus in der Server-Binary.** Ein Lifeline-Server mit `.p8` nimmt Aufträge anderer
  an. Kein eigener Dienst, aber Relais-Rolle und Einsatzdaten in einem Prozess, und Rubens
  Produktivserver würde zur Infrastruktur fremder Betreiber. Verworfen zugunsten von B.

Zum Inhalt:

- **Verschlüsselte Nutzlast, Notification Service Extension entschlüsselt (gewählt).** Gleiche
  Aussage wie Web Push auf dem Sperrbildschirm, Ende-zu-Ende.
- Nur die Stufe zeigen („Alarm“), Rest nach dem Tippen. Ohne Extension, aber auf dem
  Sperrbildschirm wenig Aussage. Verworfen.
- Extension holt den Text vom Server nach. Bräuchte eine Anmeldung außerhalb des WebViews
  (Cookies liegen im per-Server-`WKWebsiteDataStore`, den die Extension nicht erreicht) und Netz
  im Moment der Zustellung. Verworfen.

## Entscheidungen (Ruben, 22.11.2026)

- Eigener Push-Dienst (Relais), betrieben von Ruben, hält den `.p8`.
- Das Relais liegt als **eigene Crate in diesem Repo** (Workspace-Mitglied wie
  `karten-service`), eigene Binary, eigenes Image.
- Server **registrieren sich selbst** beim Relais; Ruben kann einzelne sperren; Mengenlimit.
- Inhalt **verschlüsselt**, eine **Notification Service Extension** entschlüsselt.
- Alarme **zeitkritisch**.
- **Alle Server, bei denen Push eingeschaltet wurde,** behalten das Token; Meldung nennt den Server bei mehreren; Tippen
  wechselt sichtbar.
- **Ein Entwurf, vier Subtasks**, ein Branch, ein PR.
- Die Anmeldung hängt an **Konto und Gerät**, nicht an der Sitzung: sie überlebt den Ablauf der
  Sitzung (fest 7 Tage, `SITZUNG_TAGE`) und endet erst durch Ausschalten, Abmelden in der App,
  Entfernen des Servers, „Sitzungen beenden“ oder Sperren/Löschen des Kontos (Nachfrage des
  Reviewers, Antwort Ruben).
- **Apple-Einrichtung vor dem Merge**: Ruben richtet App Group, App-IDs, Capabilities, `.p8` und
  das Relais ein; der PR wartet auf seinen Gerätetest (Debug-Build gegen Sandbox).

## Entwurf

### Überblick

```
iPhone (App)                 Lifeline-Server (je Betreiber)          Push-Relais (Ruben)        Apple
 ├─ Brücke: push_register ─► PUT /api/ios-push/anmeldung
 │   {token, umgebung,          speichert Token+Geräteschlüssel
 │    schluessel, kennung}      an Konto+Gerät
 │                            Benachrichtigung entsteht
 │                            ausliefern() → Web Push (wie heute)
 │                                        → iOS-Push: Nutzlast mit
 │                                          Geräteschlüssel verschlüsseln
 │                                          POST /v1/senden ───────────► prüft Server, Limit
 │                                                                       signiert JWT (.p8)
 │                                                                       HTTP/2 ────────────────► APNs
 ◄──────────────────────────────────────────────────────────────────────────────────────────────┘
 NSE: Schlüssel zu `kennung` aus App-Group-Keychain, entschlüsselt, setzt Titel/Detail/Thread
 Tippen: kennung → Server, Pfad → sichtbarer Wechsel + Pfad laden
```

### 1. Push-Relais (LLH-2039) — `push-relais/`

Eigene Crate `push-relais` im Workspace (`Cargo.toml` `members`), Binary `push-relais`,
`push-relais/Dockerfile`, Bau des Images in `.github/workflows/artefakte.yml` wie
`karten-service`. axum, tokio, clap mit `env`, SQLite (sqlx wie im Server). Eine Bereichsdatei
`push-relais/AGENTS.md` trägt seine Regeln; Zeile in der Tabelle der Wurzel-`AGENTS.md`.

**Konfiguration** (Umgebung, kein Geheimnis in Dateien im Repo):

- `PUSH_RELAIS_APNS_SCHLUESSEL` (Pfad zur `.p8`-Datei), `PUSH_RELAIS_APNS_KEY_ID`,
  `PUSH_RELAIS_APNS_TEAM_ID`, `PUSH_RELAIS_BUNDLE_ID` (Standard `dev.rubeen.lifeline.ios`).
- `PUSH_RELAIS_DATENBANK`, `PUSH_RELAIS_BIND`.
- Limits: `PUSH_RELAIS_LIMIT_MINUTE` je Server (Standard 600, Claude), Registrierungen je
  Quell-IP und Stunde (Standard 10, Claude).

**API v1** (JSON, nur HTTPS hinter dem Proxy des Betreibers, Wire-Namen deutsch wie die übrigen
Server-APIs, Claude):

- `POST /v1/server` — Selbstregistrierung. Body `{ kontakt?: string, version: string }`.
  Antwort `{ server_id, geheimnis }`; das Relais speichert nur `sha256(geheimnis)`. Mengenlimit je
  Quell-IP.
- `POST /v1/senden` — `Authorization: Bearer <server_id>.<geheimnis>`. Body
  `{ nachrichten: [ { token, umgebung: "sandbox"|"production", stufe: "alarm"|"hinweis",
  kollaps?: string, nutzlast: string (base64url, ≤ 3 KB) } ] }`, höchstens 100 je Aufruf.
  Antwort je Nachricht in Reihenfolge `{ ergebnis: "zugestellt" | "token_ungueltig" |
  "gedrosselt" | "fehler" }`. 403 für gesperrte Server, 429 bei überschrittenem Limit.
- `GET /v1/status` — `{ version }`, für Überwachung.

**APNs-Aufruf** je Nachricht: `POST https://api.push.apple.com` bzw.
`api.sandbox.push.apple.com` `/3/device/<token>`, HTTP/2, Kopf `authorization: bearer <JWT>`
(ES256 mit dem `.p8`, Gültigkeit 50 Minuten, im Speicher zwischengespeichert), `apns-topic` =
Bundle-ID, `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration` = jetzt + 12 h,
`apns-collapse-id` = `kollaps` (wenn gesetzt). Rumpf:

```json
{ "aps": { "alert": { "title": "Alarm" }, "sound": "default", "mutable-content": 1,
           "interruption-level": "time-sensitive" },
  "l": "<nutzlast>" }
```

Für `hinweis`: Titel „Neue Benachrichtigung“, `interruption-level: active`. Die Titel sind der
Rückfall, falls die Extension nicht läuft, und dieselben wie im Service Worker. Apple-Antwort
`410` oder `400 BadDeviceToken`/`Unregistered` → `token_ungueltig`; `429` → `gedrosselt`; Rest →
`fehler`. Kein Wiederholen im Relais (wie Web Push); der Server entscheidet.

**Sperren**: Unterbefehl `push-relais sperren <server_id>` und `entsperren`, direkt auf der
Datenbank. Kein Web-Admin.

**Speicher**: Tabelle `server (id, geheimnis_hash, kontakt, version, erstellt_at, zuletzt_at,
gesperrt_at)`. Keine Tokens, keine Nutzlasten, keine Zähler je Gerät. Logs: Server-ID, Anzahl,
Ergebnis-Zählung, nie Token oder Nutzlast.

**HTTP/2 zu Apple**: `reqwest` mit Feature `http2` oder direkt `h2`/`hyper` (Claude: `reqwest`,
`h2` steht schon im Lockfile). JWT mit `p256`/`openssl` wie `vapid_kopf` — dem Bauenden
überlassen, welche Crate; keine neue Kryptobibliothek, wenn eine vorhandene reicht.

**Betrieb**: neue Seite `docs/betrieb/push-relais.md` (Schlüssel aus Apple Developer anlegen,
Umgebung, Sperren, Sicherung der SQLite-Datei, Domain). Die öffentliche Adresse ist
`https://push.rubeen.dev` (Claude; Ruben setzt die Domain, im Server ist sie nur der
Standardwert).

### 2. Kanal im Server (LLH-2040) — `src/ios_push/`

Neues Modul neben `src/web_push/`, gleicher Aufbau (`mod.rs` Versand, `repo.rs`, `krypto.rs`,
Routen `src/routes/ios_push.rs`).

**Konfiguration**: `--ios-push` / `LIFELINE_IOS_PUSH` (Standard aus, Betreiber-Opt-in wie Web
Push), `--ios-push-relais` / `LIFELINE_IOS_PUSH_RELAIS` (Standard `https://push.rubeen.dev`).
Ohne `--ios-push`: keine ausgehende Verbindung, Routen 404. Einträge in
`docs/betrieb/env-registry.md`. `--web-push` ist **nicht** Voraussetzung (Claude).

**Registrierung beim Relais**: Beim ersten Versand (nicht beim Start, damit ein Server ohne
iOS-Nutzer nie Kontakt aufnimmt; Claude) `POST /v1/server` mit `LIFELINE_BETREIBER_KONTAKT`;
`server_id` und `geheimnis` liegen in einer Einzeilentabelle `ios_push_relais` (wie
`web_push_schluessel`, Klartext in der DB, Begründung: das Geheimnis erlaubt nur, als dieser
Server Pushes an Tokens zu schicken, die man ohnehin kennen müsste; Claude). Antwortet das
Relais 401/403 auf `senden`, wird die Zeile gelöscht und beim nächsten Versand neu registriert;
bei 403 mit Kennung „gesperrt“ nicht neu, sondern Warnung im Log und in der Verwaltung
(Claude).

**Migration** (Nummer nach `migrations/AGENTS.md`): Tabelle `ios_push_anmeldung`

| Spalte | Inhalt |
|---|---|
| `id` | Primärschlüssel |
| `kennung` | UUID, von der App erzeugt, `UNIQUE`; steht verschlüsselt **und** im Klartext-Feld `k` der Nutzlast, damit die Extension den Schlüssel findet |
| `benutzer_id` | FK `benutzer`, CASCADE |
| `session_token_hash` | FK `session(token_hash)`, **ON DELETE SET NULL**; die Sitzung, über die zuletzt angemeldet wurde. Nur für „diese Sitzung“ in `GET` und für das Abmelden beim Logout, nie Voraussetzung für den Versand |
| `token` | APNs-Gerätetoken (hex), `UNIQUE` |
| `umgebung` | `sandbox` / `production` |
| `schluessel` | 32 Byte AES-256-GCM, base64url |
| `inhalt` | 0/1, „Mit Absender und Wortlaut“ |
| `stumm` | JSON-Array der stummen Arten wie `web_push_abo.stumm` |
| `erstellt_at` | Zeitpunkt |

Ausschluss aus dem Spiegel neben `web_push_abo` (`src/instanz/spiegel/art.rs`). Upsert auf
`token`: eine neue Anmeldung mit demselben Token ersetzt die alte (Konto- oder Sitzungswechsel
am selben Gerät).

**Routen** (Gerätekonten 403 wie Web Push):

- `GET /api/ios-push?kennung=<uuid>` → `{ eingeschaltet: bool (Betreiber), angemeldet: bool (zu
  dieser Kennung und diesem Konto gibt es eine Anmeldung), inhalt, stumm, ueber_hub? }`. Die
  Kennung kommt aus der Hülle (`push_state`), denn nach einer neuen Sitzung ist die alte nicht
  mehr „diese“ (Claude).
- `PUT /api/ios-push/anmeldung` → Body `{ kennung, token, umgebung, schluessel, inhalt, stumm }`.
  Prüft Längen und Formate (Token 64–200 Hex-Zeichen, Schlüssel genau 32 Byte, `umgebung` aus
  der Liste). 422 bei Push über den Hub.
- `DELETE /api/ios-push/anmeldung` → Body `{ kennung }`, meldet die Anmeldung dieses Kontos mit
  dieser Kennung ab, idempotent.
- `POST /api/ios-push/abmelden` → **ohne Sitzung**, Body `{ kennung, nachweis }` mit
  `nachweis = base64url(HMAC-SHA256(schluessel, "abmelden:" + kennung))`. Für die App, wenn
  jemand einen Server aus der App-Liste entfernt (dann gibt es keinen WebView mehr für ihn).
  Antwortet immer 204 (keine Auskunft, ob es die Kennung gab; Claude).

**Lebensdauer** (Konto + Gerät): Die Anmeldung endet durch

- Ausschalten in der Oberfläche (`DELETE`),
- **Logout**: der Logout-Handler löscht vor dem Löschen der Sitzung die Anmeldungen mit diesem
  `session_token_hash` (wer sich in der App abmeldet, will dort nichts mehr bekommen); der
  bloße Ablauf der Sitzung löscht nichts,
- **„Sitzungen beenden“** (LFH-1092, `frontend/src/auth/AGENTS.md`): löscht alle
  iOS-Anmeldungen des Kontos (verlorenes Gerät),
- Sperren oder Löschen des Kontos (Sperren: explizit löschen; Löschen: CASCADE über
  `benutzer_id`),
- Entfernen des Servers in der App (`abmelden` ohne Sitzung, unten),
- `token_ungueltig` vom Relais.

Eine Anmeldung eines Kontos, das sich inzwischen nicht mehr anmelden darf (Rolle entzogen,
Mitgliedschaft beendet), bekommt nichts, weil die Empfängerauflösung es nicht mehr nennt.

Response-DTOs bekommen Typ-Codegen (`scripts/check-typ-codegen.sh`).

**Versand** in `benachrichtigung::ausliefern`, direkt neben dem Web-Push-Aufruf und mit
denselben Filtern (Still raus, `ueber_hub`-Konten raus, Stumm je Anmeldung, Alarm immer). Für
jede Anmeldung der Empfänger:

1. Klartext bauen, JSON:
   `{ v: 1, s: <Servername>, e: einsatz_id, b: benachrichtigung_id, stufe, titel, detail?,
   pfad, absender?, wortlaut? }`. Titel, Detail und Pfad aus denselben Funktionen wie
   `GET /api/benachrichtigungen/{id}` (`benachrichtigung::text`); `absender` und `wortlaut` nur
   bei `inhalt = 1` und **nur, wenn der Empfänger die Meldung lesen dürfte**: dieselbe Prüfung
   wie `GET /api/einsaetze/{id}/meldungen/{mid}` (`EinsatzLesezugriff<Meldungen>` samt Filter in
   `laden_im_einsatz`), je Empfänger auf dem Server wiederholt. Wo die Route 404/403 gäbe, fehlen
   beide Felder. Den Titel „‹Art› · ‹Absender›“ baut die Extension wie `pushInhalt` in
   `alarm-sw.js`. Der Wortlaut wird gekürzt, sodass der verschlüsselte Teil 3 KB nicht
   überschreitet. `s` ist der Anzeigename der Instanz (Claude: der Name, den die
   Instanz in der Kopplung führt bzw. der Hostname).
2. AES-256-GCM mit dem Schlüssel der Anmeldung, 12 Byte zufällige Nonce, AAD = `kennung`.
   Nutzlast an das Relais: base64url von `{ k: kennung, n: nonce, c: chiffrat }` als kompaktes
   JSON.
3. `kollaps` = `sha256(server_id + benachrichtigung_id)` gekürzt auf 32 Zeichen (Claude), damit
   eine erneute Zustellung (Umadressieren) die alte ersetzt, ohne IDs preiszugeben.
4. Bündeln je 100, `POST /v1/senden`, im abgekoppelten Task (`spawn`, nie awaited, Nebenläufig
   wie Web Push). `token_ungueltig` → Anmeldung löschen (nur wenn das Token unverändert ist, wie
   `erloschen`). Kein Wiederholen. Gedrosselte Log-Zeile ohne Token.

Ausgehender Client über `ausgehend::client_builder` mit neuem `Zweck::IosPush` (Kennung,
Zeitlimit 10 s, keine Weiterleitung, nur HTTPS).

**Kopplung**: Wie Web Push, aber **je Kanal getrennt** (Claude). `MeldenAntwort` bekommt
additiv `ios_push: bool`, der Hub füllt es aus seinem Zustand, das ELW speichert es bei den
Fähigkeiten (`instanz_kopplung` bekommt dafür eine Spalte `gegenueber_ios_push`, Migration).
`pusht_ueber_hub`/`konten_am_hub`/`push_hub_fuer` werden nach Kanal parametrisiert, und
`ausliefern` führt zwei `ueber_hub`-Mengen, eine je Kanal. Für Konten aus dem Hub überspringt
das ELW iOS-Push **nur, wenn der Hub `ios_push` meldet**; kann der Hub kein iOS-Push, pusht das
ELW diese Konten selbst (so wie heute, wenn das Einreihen beim Hub scheitert). Gleiches gilt
umgekehrt für Web Push. Das ELW antwortet auf `PUT` nur dann mit 422, und `GET` liefert
`ueber_hub` mit dem Hub-Namen. Der Hub-Pfad über `hinweis::ausfuehren` → `melden` →
`ausliefern` deckt iOS dann ohne Sonderweg ab. Damit ein Hub-Konto Pushes bekommt, muss die
Person den Hub in der App haben und dort Push einschalten; die Oberfläche des ELW sagt das
(„Push läuft über ‹Hub›: Hub in der App hinzufügen und dort einschalten“).

### 3. iOS-App (LLH-2041) — `ios/`

**Capabilities und Ziele** in `ios/project.yml`:

- Entitlements-Datei für die App: `aps-environment` (Debug `development`, Release `production`),
  `com.apple.developer.usernotifications.time-sensitive`, App Group
  `group.dev.rubeen.lifeline.ios`, Keychain-Access-Group für die gemeinsame Ablage.
- Neues Target `Benachrichtigungsdienst` (Notification Service Extension), gleiche App Group und
  Keychain-Group, Bundle `dev.rubeen.lifeline.ios.benachrichtigung`. `scripts/ios/testflight.sh`
  und der Bau in `ios-pruefung.yml` müssen das zweite Target signieren (automatische Signierung,
  `-allowProvisioningUpdates` legt das Profil an).

**Kern (`ios/LifelineKern`, Linux-testbar)**:

- `PushNutzlast` — dekodiert `{k,n,c}`, entschlüsselt mit CryptoKit-kompatibler AES-GCM-Logik
  (unter Linux `swift-crypto`, falls der Kern noch keine Abhängigkeit hat: Claude, prüft der
  Bauende; sonst die Entschlüsselung ins Extension-Target und im Kern nur Parsen und Abbilden),
  liefert `Meldung { titel, untertitel?, text?, thread, pfad, kennung }`. Untertitel = `s`, wenn
  mehr als ein Server in der Liste steht; die App legt dafür die Zahl der Server bei jeder
  Änderung der Liste in den `UserDefaults` der App Group, denn die Serverliste selbst liegt im
  Speicher der App, den die Extension nicht sieht (Claude). Thread = `<kennung>-<e>` (Meldungen eines Einsatzes
  gruppiert, ohne die Einsatz-ID im Klartext an Apple zu geben: der Thread wird erst auf dem
  Gerät gesetzt).
- `PushAnmeldungen` — Zuordnung `kennung → ServerEintrag.id` samt Schlüssel-Verweis, persistiert
  wie `Serverliste`; entfernt einen Server → liefert die Kennungen zum Abmelden.
- `Ablauf`: neues Ereignis `meldungAngetippt(kennung, pfad?)` → Effekte: Server zur Kennung
  suchen; unbekannt → nichts tun; anderer als der aktive → sichtbarer Wechsel (bestehender
  Wechselweg) und danach `ladePfad(server, pfad)`; gleicher → `ladePfad`. Neuer Effekt
  `ladePfad(ServerEintrag, String)`; der Pfad muss mit `/` beginnen und nach `Linkregeln` zum
  Server gehören, sonst Startseite. Fall in `src-tauri/faelle/deeplink.json` ergänzen, damit
  beide Hüllen denselben Pfadfilter teilen.
- `Brueckenbefehl`: neue Befehle (Wire englisch, im Kopf von `huelle.js` dokumentiert):
  - `push_register {}` → Antwort `{ registration_id, token, environment, key }` oder Fehler
    `denied` / `unavailable`. Fragt die Berechtigung (alert, sound, badge, timeSensitive), holt
    das Token, erzeugt pro Server einmalig Kennung und Schlüssel (oder liefert die vorhandenen).
  - `push_unregister {}` → entfernt Kennung und Schlüssel dieses Servers lokal.
  - `push_state {}` → `{ permission: "granted"|"denied"|"undetermined", registered: bool }`.
- Kennung `__LIFELINE_HUELLE__` bekommt additiv `push: true`.

**App (`ios/App`)**:

- `UIApplicationDelegateAdaptor` für `didRegisterForRemoteNotificationsWithDeviceToken` /
  `didFail…`; das Token wartet in `Systemdienste` auf die offene Brückenanfrage.
- Schlüssel liegen in der Keychain der App Group (`kSecAttrAccessibleAfterFirstUnlock`, damit
  die Extension auch bei gesperrtem Gerät nach dem ersten Entsperren entschlüsseln kann).
- `userNotificationCenter(_:didReceive:)` → `Ablauf.meldungAngetippt`. `willPresent` für
  Remote-Meldungen des **aktiven** Servers: keine Anzeige (die laufende Oberfläche meldet selbst
  über den Live-Kanal, sonst doppelt); für andere Server Banner wie heute.
- Server entfernen: für jede Kennung des Servers `POST /api/ios-push/abmelden` mit Nachweis,
  einmal, ohne Wiederholen (URLSession, nicht der WebView; einzige native Netzanfrage an einen
  Server, die keine Seite lädt — Claude; Begründung: ohne WebView gibt es keinen anderen Weg, und
  sie trägt keine Anwendungslogik), danach Schlüssel löschen.
- Token-Wechsel durch iOS: Beim nächsten Abgleich der Oberfläche (siehe Frontend) wird das neue
  Token gemeldet; nicht aktive Server behalten das alte, bis Apple es ablehnt (dann löscht der
  Server die Anmeldung) oder der Server wieder aktiv wird.

**Extension (`ios/Benachrichtigungsdienst`)**: dünn. Liest `l`, ruft `PushNutzlast` mit dem
Schlüssel zur Kennung, setzt `title`, `subtitle`, `body`, `threadIdentifier`, `userInfo`
(`kennung`, `pfad`). Kein Schlüssel oder Entschlüsselung scheitert → Rückfalltitel bleibt,
Text „Öffnen, um die Meldung zu sehen“ (Claude). Kein Netz.

**Screenshots** (`ios/AGENTS.md`): neue native Ansichten gibt es nicht; die Berechtigungsabfrage
ist Systemdialog. Ein `-LifelineTestzustand` für „nach dem Tippen auf eine Meldung eines anderen
Servers“ wird ergänzt, wenn der Wechsel einen sichtbaren Zwischenzustand hat.

### 4. Frontend und Doku (LLH-2042)

**Frontend**:

- `frontend/src/huelle/faehigkeiten.ts`: `huellePush()` liest `__LIFELINE_HUELLE__.push` und
  bietet `register`/`unregister`/`state` über die Brücke an. Einzige Stelle mit Hüllenwissen.
- `frontend/src/alarm/iosPush.ts` neben `webPush.ts`, gleiche Außenform (`moeglich`,
  `einschalten`, `ausschalten`, `abgleichen`, Stand). `einschalten`: Brücke `push_register` →
  `PUT /api/ios-push/anmeldung` mit `inhalt` und `stumm` des Geräts. `abgleichen` wird an
  denselben Stellen gerufen wie `pushAbgleichen` (Anmeldung, `EingaengeKnopf`) und meldet ein
  geändertes Token neu.
- Eine gemeinsame Schnittstelle „Push-Kanal“ wählt in `PushSchalter`
  (`BenachrichtigungenPage.tsx`) zwischen Web Push und iOS-Push; der Schalter, „Mit Absender und
  Wortlaut“ und die Stumm-Wahl sind dieselben. Der Schalter erscheint in der iOS-App nur, wenn
  der Server `eingeschaltet` meldet und die Hülle `push` kann; bei `ueber_hub` der Hinweis wie
  bei Web Push. In der Desktop-Hülle bleibt er weg.
- Test `frontend/src/huelle/iosStart.test.tsx`, der heute „kein Push in der iOS-Hülle“ prüft,
  wird umgedreht; Vitest für `huelle.js` deckt die neuen Befehle.

**Regeln und Doku** (OpenSpec ist eingefroren; die Regeln wandern in ADR und `AGENTS.md`):

- Neue ADR (nächste freie Nummer, derzeit 0082): „iOS-Push läuft über ein Relais, das Ruben
  betreibt, mit Ende-zu-Ende-verschlüsselter Nutzlast“. Sie hebt für iOS die Aussage aus der
  Spec `web-push` auf, der Push-Schalter fehle in jeder Hülle, und die Aussage der Spec
  `ios-huelle`, die App verspreche keine Meldung im Hintergrund.
- `src/AGENTS.md`: Abschnitt „iOS-Push“ (Opt-in, Relais-Registrierung, Versandregeln, Kopplung).
- `ios/AGENTS.md`: Push-Befehle der Brücke, Extension bleibt dünn, einzige native Netzanfrage
  (Abmelden).
- `push-relais/AGENTS.md` neu; Zeile in der Tabelle der Wurzel-`AGENTS.md`.
- `docs/betrieb/ios-app.md`, „Grenzen“: Abschnitt „Keine Meldung im Hintergrund“ ersetzt durch
  „Meldungen im Hintergrund“ samt Voraussetzungen (Betreiber schaltet `--ios-push` ein, Person
  schaltet in der App ein, Relais erreichbar).
- `docs/architektur/11-risiken-und-technische-schulden.md`: R45 schließen bzw. umschreiben auf
  das verbleibende Risiko (Relais ist ein einzelner Dienst; keine kritischen Warnungen); neues
  Risiko für den Ausfall des Relais. Weitere arc42-Kapitel nach der Mitänderungsregel in
  `docs/architektur/AGENTS.md` (Kontextabgrenzung: neuer externer Dienst; Verteilungssicht).
- `docs/anwender/`: Kapitel zu Benachrichtigungen um „In der iOS-App“ ergänzen (nach
  `docs/anwender/AGENTS.md`).
- `docs/betrieb/push-relais.md` neu (siehe 1.).

## Voraussetzungen und Merge

Der PR wird erst gemergt, wenn Ruben das Folgende eingerichtet und einen Gerätetest gemacht hat
(Entscheidung Ruben). Der Plan endet mit dieser Checkliste; die Umsetzung kann vorher fertig und
geprüft sein.

1. Apple Developer: App-ID `dev.rubeen.lifeline.ios` mit Push Notifications, Time Sensitive
   Notifications, App Groups; App-ID `dev.rubeen.lifeline.ios.benachrichtigung` mit App Groups;
   App Group `group.dev.rubeen.lifeline.ios`. (Ob die automatische Signierung über den API-Schlüssel
   das selbst anlegt, ist offen; von Hand ist sicher.)
2. APNs-Schlüssel (`.p8`) anlegen, Key-ID und Team-ID notieren.

   Schritte 1 und 2 übernimmt Claude im Browser auf Rubens Rechner (Remote Control), Ruben meldet
   sich dort selbst an (Wunsch Ruben, 22.11.2026). Den `.p8` liest Claude nicht: er landet im
   Download-Ordner, und Ruben bringt ihn auf den Relais-Host.
3. Relais deployen (Image aus `artefakte.yml`), Domain `push.rubeen.dev` mit TLS, Umgebung
   setzen, `GET /v1/status` erreichbar.
4. Gerätetest: Debug-Build aus Xcode (Sandbox) gegen einen Server mit `--ios-push`, Akzeptanz 1–6.
5. Danach Merge; der nächste TestFlight-Build läuft gegen Production.

## Tests

- **Relais**: Integrationstests mit einem APNs-Doppel (lokaler HTTP/2-Server): Registrierung,
  Bearer-Prüfung, Sperre (403), Limit (429), Abbildung der Apple-Antworten auf `ergebnis`,
  Kopfzeilen und Rumpf je Stufe, kein Token im Log.
- **Server**: Repo-Tests für Upsert, Sitzungsablauf lässt die Anmeldung stehen (SET NULL),
  Logout und „Sitzungen beenden“ löschen sie, Sperren des Kontos löscht sie, `erloschen`; Routen-Tests (404 ohne
  Opt-in, 403 Gerätekonto, 422 über Hub, Validierung, `abmelden` mit falschem Nachweis ändert
  nichts und antwortet 204); Versandtest gegen ein Relais-Doppel: Filter wie Web Push, Stumm,
  Alarm trotz Stumm, `token_ungueltig` löscht, Nutzlast ≤ 3 KB mit langem Wortlaut,
  Entschlüsselung im Test ergibt Titel/Detail/Pfad wie `GET /api/benachrichtigungen/{id}`;
  Kopplung: ELW überspringt Hub-Konten nur für den Kanal, den der Hub kann (Hub mit Web Push ohne
  iOS-Push → ELW pusht iOS selbst, und umgekehrt).
- **Krypto-Vertrag**: ein gemeinsamer Testfall (Schlüssel, Nonce, Kennung, Klartext, Chiffrat)
  als JSON unter `src-tauri/faelle/` (oder neben dem Kern, Claude: `faelle/push-nutzlast.json`),
  den Rust und Swift-Kern beide lesen.
- **Kern**: `PushNutzlast` (gültig, falscher Schlüssel, kaputtes JSON, Untertitel nur bei
  mehreren Servern), `Ablauf.meldungAngetippt` (unbekannte Kennung, anderer Server → Wechsel +
  Pfad, Pfad außerhalb der Linkregeln → Startseite), `Brueckenbefehl`-Parsen der neuen Befehle.
- **Frontend**: Vitest für `iosPush.ts` und `PushSchalter` mit Hüllen-Attrappe; `huelle.js`
  Vitest für die neuen Befehle.
- **iOS-App**: Simulator-Prüfung baut beide Targets. Echte Zustellung lässt sich nur auf einem
  Gerät prüfen; dazu eine Prüfanleitung in `docs/betrieb/push-relais.md` (Debug-Build gegen
  Sandbox).

## Akzeptanz

1. Server mit `--ios-push`, App mit eingeschaltetem Push, App beendet: eine Sofortmeldung
   erscheint auf dem Sperrbildschirm mit Titel und Detail wie im Browser und kommt durch einen
   Fokus.
2. Ein Hinweis einer auf dem Gerät stummen Art kommt nicht; ein Alarm kommt trotz Stumm.
3. Tippen öffnet den Einsatz auf dem richtigen Server; war ein anderer aktiv, ist der Wechsel
   sichtbar.
4. Ausschalten in der Oberfläche, Logout in der App, „Sitzungen beenden“, Sperren des Kontos oder
   Entfernen des Servers
   aus der App beendet die Zustellung.
5. Relais-Log und Server-Log enthalten kein Token und keinen Inhalt; ein Mitschnitt der
   Relais-Anfrage enthält keinen Titel.
6. Ein gesperrter Server bekommt 403; die Verwaltung des Servers zeigt die Warnung.
7. Ohne `--ios-push` nimmt der Server keinen Kontakt zum Relais auf.
8. `./scripts/check-all.sh --geaendert --ohne-e2e` grün; `ios-pruefung.yml` grün.

## Dem Bauenden überlassen

- Wahl der HTTP/2- und JWT-Bausteine im Relais (vorhandene Crates bevorzugt).
- Genaue Limits und deren Standardwerte.
- Ob die AES-GCM-Entschlüsselung im Kern (mit `swift-crypto`) oder nur im Extension-Target lebt.
- Aufteilung der Routen-Handler und Repo-Funktionen; Namen nach der Bezeichner-Regel.
- Form des Hinweises bei gesperrtem Server in der Verwaltung.
