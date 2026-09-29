# Design: Messprotokoll Tauri-2-Hülle, Variante A (LFH-720)

## Kontext

LFH-128 Phase 1 verpackt Lifeline Hub als Desktop-App. Entschieden ist Variante A (25.09.2026):
Der Tauri-Webview lädt die https-Adresse des Servers, die Anwendung bleibt same-origin. Dieser
Spike misst, ob WKWebView (macOS) und WebView2 (Windows) dafür tragen. Gemessen wurde an den
sechs Punkten des Tickets plus drei Punkten, die beim Messen auffielen: Druck, neue Fenster und
Sitzungsdauer.

## Aufbau der Messung

**Prototyp** außerhalb des Repos: `~/dev/personal/lfh-720-tauri-spike`, eigenes Git-Repo, Stand
`d9af36f` (davor `cdf89a3`). Kein Produktcode auf `alpha`. Bestandteile:

- `src/main.rs`: Hülle mit Erststart-Maske (`ui/index.html`), Deeplink `lifeline-spike://`
  (Plugins `deep-link` + `single-instance`), `on_download`, `on_navigation`, `on_page_load`,
  Command `diag_melden`, Laufzeit-Capability für die konfigurierte Origin, nativer Druck.
- `src/probe.js`: per `initialization_script` in jede Seite injiziert. Misst Secure Context,
  Service Worker, Cache Storage, IndexedDB, Storage-Quota, WebAuthn-Fähigkeiten, WebGL und
  schneidet SSE-Ereignisse, Sichtbarkeit und Timer-Abstände mit. Meldet über `diag_melden`,
  das heißt jede abgelegte Probe belegt zugleich, dass die Remote-Origin die Brücke erreicht.
- Steuerkanal statt Klicks von außen: `<app_data_dir>/steuer/*.js` wird per `eval`
  ausgeführt, `*.q` per `eval_with_callback` ausgewertet, `*.cmd` sind Fensterbefehle.
  Skripte `steuer.sh`/`frage.sh` (macOS) und `win.sh` (Windows über `prlctl exec`).
- `LFH_DROSSELUNG=aus|drosseln|suspendieren` wählt `background_throttling` für die SSE-Läufe.

**Server:** `lifeline-hub` auf `alpha` `ba039d60` (1.0.0-alpha.48), Prod-Bundle mit Service
Worker, `--tls` mit mkcert, `--bind 0.0.0.0:8443`, `--tls-hostname elw.local`,
`LIFELINE_WEBAUTHN_RP_ID=elw.local`, OIDC gegen PocketID (`https://id.rubeen.dev`),
`--demo-daten` für den Übungseinsatz. `elw.local` per mDNS (`dns-sd -P`) auf die LAN-IP.
Offline-Basiskarte: MBTiles „Shortbread“ Norddeutschland, als Offline-Karte registriert.

**Plattformen:**

| | macOS | Windows |
|---|---|---|
| System | macOS 27.0 (26A428), Apple Silicon | Windows 11 ARM64 (Build 26200) in Parallels, das Binary x64 unter Emulation |
| Webview | WKWebView, AppleWebKit/605.1.15 | WebView2 153.0.4234.48 |
| Tauri | 2.12.0 (wry 0.57.0), Debug-Bundle `.app`, unsigniert | 2.12.0, Debug-Build `x86_64-pc-windows-gnu`, ohne Installer |
| Build-Stand | `d9af36f` | Stand vor `cdf89a3` (statische `remote.json`, ohne `drucken`, ohne Laufzeit-Capability) |
| Besonderheit | `NSAppSleepDisabled` für den Steuerkanal gesetzt (siehe SSE) | kein Windows Hello eingerichtet |

Belege liegen unter `belege/macos/` und `belege/windows/`. Ein Beleg nennt die Datei und, wo
nötig, das Feld. Zeiten sind Millisekunden.

## Messprotokoll

Verdikte: **trägt** · **eingeschränkt** (trägt mit Auflage) · **geht nicht** ·
**nicht gemessen**. Die letzte Spalte beantwortet, ob Variante B/C (lokal gebündeltes
Frontend) den Befund lösen würde.

| # | Punkt | macOS (WKWebView) | Windows (WebView2) | Löst B/C das? |
|---|---|---|---|---|
| 1 | Erreichbarkeit `https://elw.local:8443` | **eingeschränkt**: ohne Freigabe „Lokales Netzwerk“ hängt die mDNS-Auflösung (`resolver:dns_stall`, Abbruch nach 60 s), mit Freigabe und `NSLocalNetworkUsageDescription` lädt die Seite | **trägt**: `elw.local` löst per mDNS auf | Nein, der Server bleibt im LAN |
| 2 | Anmeldung Passwort | **trägt** | **trägt** | – |
| 3 | Anmeldung OIDC (PocketID) | **trägt**: Redirect, Callback, Sitzung; der Passkey *bei PocketID* erscheint nicht | **trägt** inkl. Passkey-Abfrage bei PocketID | Nein |
| 4 | Passkey für Lifeline (RP `elw.local`) | **geht nicht**: `NotAllowedError` nach 4 ms, ohne Abfrage, trotz Fokus und Nutzergeste | **trägt**: Systemdialog erscheint, Abbruch als `NotAllowedError` | Nein, B/C hätte dieselbe Webview-Sperre plus Origin-Mismatch |
| 5 | Sitzung über App-Neustart | **eingeschränkt**: Cookie ohne `Max-Age` verfällt | **eingeschränkt**: dasselbe (`/api/auth/me` → 401) | Nein, das ist eine Serverfrage |
| 6 | SSE sichtbar | nicht gemessen (Fenster blieb verdeckt) | **trägt**: Verzug unter 40 ms, Timer 15,0 s | – |
| 7 | SSE minimiert / verdeckt | **eingeschränkt**: WebKit suspendiert den Webview nach ~3 s, Ereignisse stauen sich bis zu 7 min. Mit `background_throttling(Disabled)` meist Echtzeit, Ausreißer bis 116 s, zwei Reconnects | **trägt**: minimiert Echtzeit, Timer ungedrosselt | Nein, dieselbe Engine |
| 8 | SSE nach Ruhezustand | nicht gemessen (Server läuft auf demselben Mac) | **trägt**: 2 min VM-Suspend, Reconnect ~10 s nach dem Fortsetzen, die App synchronisiert nach | – |
| 9 | Service Worker, Precache | **trägt**: `activated`, 21–22 Einträge | **trägt**: `activated`, 22 Einträge | – |
| 10 | Kaltstart ohne Server | **trägt**: App-Hülle aus dem SW (`localhost` und `elw.local`) | **trägt** | B/C bräuchte keinen SW, siehe Empfehlung |
| 11 | Offline-Schreibqueue (IndexedDB) | **trägt**: erfassen ohne Server → App-Neustart → nach Login nachgesendet (Nr. 165, 189) | **trägt** (Nr. 187) | – |
| 12 | MapLibre + Offline-Karte | **trägt**, aber nur im sichtbaren Fenster: WebGL2, 24 Layer, 808 Features. Im verdeckten Fenster feuert `requestAnimationFrame` nicht, der Stil lädt dann nicht | **trägt**: WebGL2, 596 Features | – |
| 13 | Upload per Dateidialog | **trägt** (`wip.drawio`, 4038 B) | **trägt** (JPG, 3,0 MB, als Nr. 188 erfasst) | – |
| 14 | Download `<a download>` | **trägt**: `~/Downloads`, Umlaute, Dubletten als „(1)“ | **trägt**: `Downloads\…`, Umlaute | – |
| 15 | Link ohne `download` auf eine Datei | **geht nicht**: die PDF ersetzt das App-Fenster, `on_download` feuert nicht | nicht gemessen | Nein |
| 16 | `window.open` / `target="_blank"` | **geht nicht**: `null`, der Link läuft still ins Leere | **geht nicht**: dasselbe | Nein |
| 17 | Druck | **geht nicht** mit `window.print()`, **trägt** mit `WebviewWindow::print()` | **trägt** mit `window.print()` (modaler Dialog) | Nein |
| 18 | Serveradresse beim Erststart (Eingabefeld) | **trägt** (per Steuerkanal bedient) | **trägt** (von Hand bedient) | – |
| 19 | Deeplink `lifeline-spike://verbinden?server=…` | **trägt**: laufende Instanz empfängt ihn, speichert, navigiert | **trägt**: Zweitstart wird an die Instanz gereicht | – |
| 20 | Native Brücke von der Remote-Origin | **trägt**, auch mit Laufzeit-Capability; eine fremde Origin wird abgewiesen | **trägt** (statische Capability) | – |

### Belege je Punkt

1. `macos/elw-local-dns-stall.log` (Verbindung C2: `resolver:dns_stall @11.967s`, danach
   `cancelled`), Gegenprobe `macos/elw-local-nscurl-gegenprobe.txt` (derselbe Name aus dem
   Terminal: 200), nach der Freigabe `macos/elw-local-nach-freigabe.json`.
2. macOS: Einsatzliste nach dem Formular-Login (Steuerkanal), Windows: `windows/offline-3-nachgesendet.json` (`url` nach Login).
3. `macos/oidc-pocketid-ohne-geste.json` (PocketID-Seite im Webview), `macos/oidc-angemeldet.json`
   (`/api/auth/me` 200, `rubeen`), `windows/oidc-angemeldet.json`.
4. `macos/passkey-mit-geste-elw-local.json`: `discoverable/start` 200, `get` mit
   `fokus: true`, `aktiv: true`, `rpId: elw.local`, 4 ms später `NotAllowedError: The request
   is not allowed by the user agent or the platform in the current context`. Ohne Geste:
   `macos/passkey-ohne-fokus.json`. Windows: `windows/passkey-mit-geste.json` (3982 ms bis zum
   Abbruch = Dialog stand da).
5. `windows/sitzung-nach-neustart.json` (401). macOS: nach jedem Neustart der Hülle stand der
   Login da. Der Server setzt `lifeline_sid=…; HttpOnly; SameSite=Lax; Secure; Path=/` ohne
   `Max-Age`/`Expires` (`src/routes/auth.rs`, `session_cookie`).
6. `windows/sse-lauf.txt`, Phase A.
7. `macos/sse-lauf1-standard.txt` mit `macos/sse-webkit-suspension.log`
   (`didChangeThrottleState(Suspended)` ~3 s nach dem Wechsel in den Hintergrund),
   `macos/sse-lauf2-drosselung-aus.txt`, `windows/sse-lauf.txt` Phase B.
8. `windows/sse-lauf.txt` Phasen D/E (`sse-fehler` 06:57:09, `sse-offen` 06:59:24).
   Nachsynchronisieren: `useEinsatzLiveStream.ts` ruft bei jedem Reconnect `invalAlle`.
9. `macos/probe-remote-localhost.json`, `windows/probe-remote-elw-local.json`.
10. `macos/offline-kaltstart-localhost.json`, `macos/elw-local-offline-2-kaltstart.json`,
    `windows/offline-2-kaltstart.json`.
11. `macos/elw-local-offline-1-erfasst.json` → `…-2-kaltstart.json` → `…-3-nachgesendet.json`,
    `macos/offline-nachsenden-localhost.json`, `windows/offline-1…3`.
12. `macos/karte-offline-gerendert.json`, `macos/raf-verdeckt.json` (`raf: 0`, `hidden`),
    `windows/karte-offline-gerendert.json`.
13. `macos/upload-dateidialog.json`, `windows/upload-dateidialog.json`.
14. `macos/download-start.json`, `macos/download-ende.json`, `windows/download-*.json`.
15. `macos/anhang-ohne-download-attribut.json` + `macos/target-blank-navigation.json`
    (die Hauptframe-Navigation auf `/api/…/anhaenge/1`, danach kein `download-start`).
16. `macos/window-open.json`, `windows/window-open.json` (`open=null`).
17. `macos/druck-window-print.json` (`blockiertMs: 0`, kein Dialog), `windows/druck-window-print.json`
    (`blockiertMs: 9618`, modaler Dialog). Nativer Druck: Steuerbefehl `drucken` → Dialog
    erschien (vom Nutzer bestätigt).
18. `windows/erststart-verbinden-*.json`.
19. `macos/deeplink.json`, `windows/deeplink-zweitstart.json`.
20. `macos/runtime-capability.json` und `macos/runtime-capability-negativ.json`
    (`diag_melden not allowed … allowed on: … https://elw.local:8443/*`).

## Befunde im Einzelnen

### SSE im Hintergrund (macOS)

WKWebView suspendiert den WebContent-Prozess, sobald das Fenster nicht sichtbar ist: verdeckt,
auf einem anderen Space oder minimiert. Im Log steht `WebProcess::prepareToSuspend` und
`didChangeThrottleState(Suspended)` rund 3 s nach dem Wechsel. Die TCP-Verbindung bleibt
bestehen. Die Ereignisse werden erst beim nächsten Aufwachen gebündelt ausgeliefert, im Lauf 1
mit bis zu 7 min Verzug. Timer standen bis zu 8 min.

`background_throttling(BackgroundThrottlingPolicy::Disabled)` (Tauri, ab macOS 14) verhindert
die Suspendierung. Im Lauf 2 kamen 7 von 10 Ereignissen in Echtzeit, drei mit 15 s, 30 s und
116 s Verzug, und die Verbindung baute zweimal neu auf. Ein Timer stand einmal 162 s. Der
Prozess bekommt dann nur eine Hintergrund-Zusicherung und wird vom System weiter gebremst.

**Messbedingung, ehrlich benannt:** Für den Steuerkanal war `NSAppSleepDisabled` gesetzt (App
Nap der Hülle aus). Das Produkt-Default kann schlechter sein als Lauf 1. Das Fenster war in
beiden Läufen durchgehend unsichtbar, „sichtbar“ ist auf macOS nicht gemessen.

**Folge:** Datenverlust entsteht nicht. Ein Reconnect löst ohnehin eine Vollsynchronisation
aus, und gestaute Ereignisse kommen an. Ein Alarm erreicht eine verdeckte Mac-Hülle aber nicht
zuverlässig in Sekunden. Soll die Hülle im Hintergrund alarmieren, braucht es einen nativen Weg
(Hülle hört selbst auf den Live-Stream und zeigt eine Systembenachrichtigung) oder die
Vorgabe „Lagefenster bleibt sichtbar“.

### Passkey (macOS)

Eingebettete WKWebViews stellen Passkeys nur für RP-IDs aus, mit denen die App verknüpft ist
(Associated Domains, `webcredentials:<domain>`) oder mit dem Browser-Entitlement
`com.apple.developer.web-browser.public-key-credential`, das nur echte Browser bekommen. Die
Verknüpfung prüft Apple über das eigene CDN, das die Datei
`/.well-known/apple-app-site-association` vom öffentlichen Internet abruft. `elw.local` ist
dort nicht erreichbar. Ausweichmodi gibt es zwei: `?mode=developer` (nur mit
Entwicklungsprofil signierte Apps, Opt-in je Gerät) und `?mode=managed` (nur MDM-verwaltete
Geräte mit Zustimmung des Administrators). Quellen: Apple Developer Documentation,
„Supporting associated domains“ und „Associated Domains Entitlement“; passkeys.dev, „macOS“.

Gemessen ist das Verhalten, nicht die Signierung: Unsigniert und ohne Entitlement kommt
`NotAllowedError` nach 4 ms, ohne Systemabfrage. Dasselbe trifft den Passkey beim IdP
(PocketID, RP `id.rubeen.dev`). Der Test mit Entitlement und MDM-Modus steht aus.

**B/C löst das nicht.** Ein lokal gebündeltes Frontend läuft im selben WKWebView. Die RP bliebe
`elw.local`, und die Origin wäre zusätzlich `tauri://localhost`. Innerhalb von A gibt es
einen Ausweg: die Anmeldung im Systembrowser (`ASWebAuthenticationSession` oder der
Standardbrowser mit Rücksprung per Deeplink). Safari darf Passkeys für jede RP. Die Sitzung
müsste dann per einmaligem Code in den Webview übergeben werden. Das ist nicht gemessen und
ein eigener Entwurf.

### Druck (macOS)

`window.print()` tut im WKWebView der Hülle nichts: keine Ausnahme, kein Dialog, 0 ms. Der
Browser-Druck aus LFH-22 (`useDrucken`, `DruckKnopf`) liefe auf dem Mac ins Leere.
`WebviewWindow::print()` öffnet den macOS-Druckdialog für die Seite. Die Abhilfe liegt in der
Hülle: Ein Init-Skript ersetzt `window.print` durch einen Aufruf eines Commands, der
`print()` ruft. Die `beforeprint`-/`afterprint`-Kette aus LFH-22 ist damit nicht gemessen.
Das Umschalten per `useDruckModus` muss mit diesem Weg erneut geprüft werden.

### Neue Fenster und Datei-Links

`window.open` gibt `null` zurück, ein `target="_blank"` löst eine Navigationsanfrage aus, die
nirgends landet. Betroffen im Bestand: Chat-Anhänge (`chat/NachrichtenStrom.tsx`, Link mit
`target="_blank"` auf `/api/einsaetze/{id}/anhaenge/{aid}`), die externen Links im
Fachebenen-Inspector und die Sprungpalette mit „in neuem Tab öffnen“ (`window.open`). Ein
Link ohne `download` auf eine Datei ersetzt im WKWebView die ganze App durch die Datei, ohne
Weg zurück. Abhilfe in der Hülle: `on_new_window` bzw. `on_navigation` fangen ab. Gleiche Origin
bleibt in der Hülle oder öffnet ein zweites Hüllenfenster, fremde Origins gehen an den
Systembrowser, Dateiantworten an `on_download`.

### Offline-Kette

Service Worker, Precache, IndexedDB-Queue und Nachsenden tragen auf beiden Plattformen, auch
über einen Neustart der Hülle ohne Server. Das war das größte vermutete Risiko und ist keins.
Zwei App-Befunde begleiten die Kette, beide in Chromium genauso:
- Beim Kaltstart ohne Server landet die App auf dem Login, weil `AuthContext` jeden
  `me()`-Fehler als „anonym“ behandelt. Die Queue bleibt erhalten und geht nach dem Login raus.
- Die Sitzung überlebt keinen Neustart der Hülle (Cookie ohne `Max-Age`). Eine Desktop-App,
  die bei jedem Start eine Anmeldung verlangt, ist im Einsatz lästig und offline unbrauchbar.

### Laufzeit-Capability

Die Serveradresse steht in Variante A erst zur Laufzeit fest, `remote.urls` in einer
Capability-Datei dagegen zur Build-Zeit. `tauri::ipc::CapabilityBuilder::new(…).remote(origin)`
plus `app.add_capability(…)` löst das: Die Hülle gibt genau die konfigurierte Origin frei, beim
Start und bei jedem Wechsel. Eine andere Origin wird abgewiesen (Beleg 20). Keine Wildcards.

### Weitere Beobachtungen

- Der Deeplink `…/verbinden?server=` stellt ohne Rückfrage auf einen anderen Server um. Jede
  Webseite könnte die Hülle so auf einen fremden Server lenken, der die Anmeldung abgreift.
  Das Produkt braucht eine Bestätigung, die die neue Adresse zeigt.
- Die Karte rendert ihren Offline-Stil nach dem ersten Laden nicht, erst nach einem Wechsel
  Blind → Offline. Gleich in Chromium, also ein App-Befund. Beim Stilwechsel meldet MapLibre
  `Invalid sprite URL "/api/karte/offline/sprites/basemap", must be absolute` und `There is no
  tile manager with ID 'marker-cluster'`.
- Der Server liest eine per Symlink ins Kartenverzeichnis gelegte MBTiles-Datei nicht (Kachel
  204). Hardlink geht. Spike-Randnotiz, kein Produktbefund.

## Empfehlung

**Variante A trägt.** Kein gemessener Punkt zwingt zu B oder C. Jeder harte Befund
(Passkey auf macOS, Druck, neue Fenster, Hintergrund-Drosselung) trifft ein lokal gebündeltes
Frontend im selben Webview genauso. Der eine Punkt, an dem B/C strukturell gewinnen könnte,
nämlich Assets ohne Service Worker, ist gemessen unkritisch: SW und Kaltstart tragen auf beiden
Plattformen.

Die Abhilfen liegen **in der Hülle**, nicht im Frontend: ein Init-Skript nach dem Muster von
`probe.js` plus wenige Commands. Damit bleibt die Vorgabe „keine zweite Anwendungslogik“
gewahrt. Die Auflagen für Phase 1 stehen als Anforderungen in `specs/desktop-huelle/spec.md`.

Offen und eine eigene Entscheidung: **Passkey auf macOS.** Entweder Associated Domains im
MDM-Modus für verwaltete Geräte, oder Anmeldung über den Systembrowser, oder Passkey auf dem
Mac nicht anbieten (Passwort und OIDC tragen).

## Nicht gemessen

- macOS: SSE bei sichtbarem Fenster, Ruhezustand des Macs (Ersatz: WebKit-Suspendierung, VM-Suspend unter Windows), Passkey mit Signierung/Entitlement/MDM-Modus, OIDC mit Systembrowser.
- Windows: Link ohne `download`, Passkey mit Windows Hello (keins in der VM), echte x64-Hardware, Installer und Signierung.
- Beide: `beforeprint`/`afterprint` im nativen Druckweg, Autostart, Auto-Update, Verhalten bei wechselnder Server-IP.

## Was ausdrücklich nicht behauptet wird

- Dass die Latenzen eine Produktzusage sind. Es sind Einzelläufe von 5–11 Minuten.
- Dass `background_throttling(Disabled)` auf macOS Echtzeit garantiert. Es verhindert die
  Suspendierung, nicht die Drosselung.
- Dass Passkey auf macOS mit Associated Domains im MDM-Modus funktioniert. Das ist Doku-Stand.

## Folgetickets

- LFH-779: Sitzung überlebt Neustart der Desktop-Hülle nicht (Sitzungscookie ohne `Max-Age`)
- LFH-780: Offline-Kaltstart zeigt Login statt letzter Sitzung (`AuthContext`)
- LFH-781: Lagekarte rendert die Offline-Basiskarte erst nach Basemap-Wechsel (dazu Sprite-URL und `marker-cluster`)
- LFH-782: Desktop-Hülle behandelt neue Fenster, externe Links und Datei-Links (Chat-Anhänge u. a.)
- LFH-783: Entscheidung Passkey in der macOS-Hülle
