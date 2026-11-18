# Design: iOS-App als native Hülle um die Weboberfläche des Servers

Zunder: https://zunder.rubeen.dev/#/aufgabe/t39ltxxi3nvvqcoupqrae1do (LLH-1978)

Entstanden im Brainstorming mit Ruben am 18.11.2026 und berichtigt nach einer Vermessung des
Repos und der iOS-Plattform (sechs Leser, Quellen in den Abschnitten). Markiert ist, was Ruben
entschieden hat **(R)** und was ein Vorschlag des Entwurfs ist **(V)**, den die Freigabe mit
abdeckt. Motivation: `proposal.md`, „Why“.

## Context

- Die Desktop-Hülle (`src-tauri/`, Variante A, LLH-612) lädt die https-Adresse des Servers in
  einen Webview, meldet ihre Fähigkeiten über `window.__LIFELINE_HUELLE__` und bietet die
  Anmeldung im Systembrowser (`POST /api/auth/app-code[/einloesen]`, Spec
  `anmeldung-systembrowser`). Dieser Server-Weg ist plattformneutral; nur die
  Bestätigungsseite `/app-anmeldung` und das Zugangsprotokoll sprechen von der „Mac-App“.
- Die Weboberfläche spricht die interne API ohne Zusage (`src/AGENTS.md`). Die öffentliche
  API v1 ist klein und für Fremdsysteme gedacht.
- `GET /api/health` liefert anonym `version`. Die Workspace-Version ist `1.0.0-alpha.N`; es gibt
  nur Alphas.
- Ohne Netz liest das Frontend das Lagebild aus IndexedDB (LFH-723) und sammelt Einträge in
  einer Schreib-Queue (LFH-705). Die Oberfläche selbst kommt heute aus dem Precache des
  Service Workers.
- `src/static_files.rs` liefert `assets/*` mit `public, max-age=31536000, immutable`, alles
  andere (auch `index.html`) mit `no-cache` ohne ETag. Der Build erzeugt kein Vite-Manifest;
  `App.tsx` hat zehn per `lazy()` geladene Routen.
- `frontend/index.html` setzt **kein** `viewport-fit=cover`; nur zwei Stellen polstern Safe
  Areas.
- Im Linux-Container gibt es weder `swift` noch `xcodebuild`. `ubuntu-latest` bringt Swift mit,
  macOS-Runner bringen Xcode.

**Plattformfakten (belegt):**

1. **Service Worker laufen im WKWebView einer App nicht** (Apple Frameworks Engineer, Developer
   Forum 773539, Feb. 2025: „no supported way … service workers in iOS WKWebView“). Der Weg über
   App-Bound Domains ist ebenfalls zu: höchstens 10 feste Domains, und er sperrt
   Skript-Injektion und Message-Handler, also die Brücke. Precache, Web Push und der
   Alarm-Klick über den Service Worker fallen in der Hülle aus.
2. `WKWebsiteDataStore(forIdentifier:)` (ab iOS 17) trennt Cookies, IndexedDB, Local Storage und
   Disk-Cache. `WKWebsiteDataStore.remove(forIdentifier:)` scheitert, solange ein Webview den
   Speicher benutzt.
3. `loadSimulatedRequest(_:responseHTML:)` bzw. `(_:response:responseData:)` (ab iOS 15) setzt
   die URL des Requests als Basis und Origin; Unterressourcen laden normal über den
   Datenspeicher, also auch aus dessen HTTP-Cache, solange der Eintrag frisch ist (WebKit
   `NetworkCache.cpp`). Erfahrungsberichte für genau dieses Muster fehlen.
4. Passkeys im eingebetteten WKWebView gibt es nur für Associated Domains (Apple, „Supporting
   passkeys“). Frei eingetragene Server lassen sich nicht eintragen, also scheitert es wie auf
   dem Mac.
5. `ASWebAuthenticationSession` mit eigenem Schema geht; die Form
   `ASWebAuthenticationSession.Callback.customScheme` gibt es ab iOS 17.4.
6. Eine von Hand installierte Root-CA gilt nach dem Einschalten in den
   Zertifikatsvertrauenseinstellungen für WKWebView und URLSession ohne eigenen Code.
7. iOS hält eine App kurz nach dem Wechsel in den Hintergrund an; SSE läuft dann nicht weiter,
   und der Web-Prozess kann beendet werden (`webViewWebContentProcessDidTerminate`).
8. Haptik spielt nur auf iPhones; auf dem iPad nicht (HIG „Playing haptics“). Die HIG verlangt,
   dass Haptik abschaltbar ist.

## Goals / Non-Goals

**Goals (R):** Onboarding mit Pflicht-Server; mehrere Server; möglichst viele Server-Versionen,
Bruch nur über die Vertragsgrenze; Start ohne Server mit dem letzten Stand (nach Spike);
natives Gefühl und Haptik; Verteilung über TestFlight.

**Non-Goals:** Geräte untereinander ohne Server (R). Eigene Fachlogik oder nachgebaute
Bildschirme in Swift (R). App Store, vorerst (R). Push über APNs; im Hintergrund meldet die App
nichts (V). Android (V). Nutzung von `/api/shell` durch die Desktop-Hülle (V, später möglich).

**Anti-Goals:** stilles Umlenken auf einen anderen Server; vermischte Sitzungen oder
Offline-Daten zweier Server; iOS-Sonderwege im Frontend, die nicht über die Kennung laufen.

## Decisions

### Ansatz (R)

| Ansatz | Bewertung |
| --- | --- |
| A. Tauri-2-Hülle um ein iOS-Ziel erweitern | ein Crate, aber Tauri-iOS ist jung, und die nötige Feinsteuerung des WKWebView (Datenspeicher je Server, Ausliefern der gespeicherten Oberfläche) geht nur über Umwege |
| **B. Eigene Swift-App (SwiftUI + WKWebView) — gewählt** | volle Kontrolle über den Webview, natives SwiftUI, erprobte TestFlight-Pipeline (Vault Cockpit); dafür zweite Sprache und doppelte Adress-/Linkregeln, die gemeinsame Testfälle zusammenhalten |
| C. Native Oberfläche gegen eine stabile API | doppelte Oberfläche, und eine API mit Zusage für alle Fachdaten fehlt — verworfen |
| D. Capacitor | in der Roadmap ausgeschlossen |

### D1 Ort, Plattform, Kennung (V)

- Code unter `ios/`: Projekt per **XcodeGen** (`ios/project.yml`, keine `.xcodeproj` im Repo),
  testbare Logik im Swift-Paket **`ios/LifelineKern`** (ohne UIKit/WebKit, läuft auch unter
  Linux), App-Target `ios/App` mit SwiftUI und WebKit. Neue Bereichsdatei `ios/AGENTS.md`.
- iPhone und iPad, **ab iOS 17.4** (Datenspeicher je Server ab 17, Callback-Form der
  Anmeldesitzung ab 17.4; fast alle iOS-17-Geräte sind auf 17.4+).
- Bundle-ID `dev.rubeen.lifeline.ios`, Team `H95J852PKP`.
- Version: `CFBundleShortVersionString` = Workspace-Version ohne Vorab-Suffix (Apple lässt keins
  zu), eigener Info.plist-Schlüssel `LifelineVersion` = volle Workspace-Version,
  `CFBundleVersion` = Zeitstempel `JJJJMMTTHHMM` der CI (steigt immer, auch zwischen Beta und
  stabil derselben Marketing-Version). Geschrieben von einem Skript aus `[workspace.package]`,
  keine eigene Versionsquelle.
- `ITSAppUsesNonExemptEncryption = false`, `NSCameraUsageDescription` (QR-Code),
  `NSLocalNetworkUsageDescription` (`elw.local`), URL-Schema `lifeline`.
- ADR-0065 „Die iOS-Hülle ist eine eigene Swift-App ohne Anwendungslogik, die die
  Serveroberfläche lädt“ (eine ADR; der Vertrag steht in der Spec `huellen-vertrag`).

### D2 Onboarding und Serverliste (R, Form V)

- Ohne gespeicherten Server nur das Onboarding: Adresse eingeben, QR-Code scannen
  (`DataScannerViewController`; Inhalt Deeplink oder https-Adresse), oder per Deeplink
  vorbelegt.
- Ablauf: Adresse prüfen → `GET /api/shell` → nur bei verträglichem Server speichern und laden.
  Die Adressprüfung folgt `src-tauri/src/adresse.rs` Regel für Regel, mit denselben
  Meldungstexten. Die Fälle stehen als JSON unter `src-tauri/faelle/` und werden von Rust und
  Swift geprüft (Quelle bleibt die Desktop-Hülle).
- Serverliste (SwiftUI-Sheet): Name (Vorgabe Hostname, änderbar), Adresse, zuletzt verbunden,
  Zustand. Wechseln, umbenennen, entfernen; der aktive Server lässt sich erst nach einem Wechsel
  entfernen. Zugang über einen kleinen nativen Knopf am Rand, der die Oberfläche nicht verdeckt.
- Deeplink `lifeline://verbinden?server=…`: neuer Server → Onboarding vorbelegt, bekannter
  anderer Server → Wechsel nach Bestätigung, aktiver Server → nichts (wie
  `src-tauri/src/deeplink.rs`, gemeinsame Fälle).

### D2a Server mit eigenem Zertifikat (R)

Prüfung wie das System, ohne Ausnahmen und ohne Pinning. Ein Server im Einsatz-LAN braucht auf
dem Gerät das installierte und eingeschaltete CA-Profil (mkcert oder eigene CA, wie LLH-31). Bei
einem Zertifikatsfehler (Onboarding, Prüfung, Laden — `NSURLErrorServerCertificate*` aus
URLSession und aus `didFailProvisionalNavigation`) zeigt die App eine native Seite
„Zertifikat nicht vertrauenswürdig“ mit Anleitung (Profil laden, Einstellungen → Allgemein →
Info → Zertifikatsvertrauenseinstellungen), getrennt von „nicht erreichbar“. Das
selbst signierte Rückfall-Zertifikat des Servers (`src/tls/mod.rs`) taugt dafür nicht; die
Betriebsdoku setzt mkcert oder ein eigenes Zertifikat voraus.

### D3 Ein Datenspeicher je Server (V)

Jeder Servereintrag trägt eine UUID; die App lädt ihn in `WKWebsiteDataStore(forIdentifier:)`.
Beim Wechsel wird der Webview mit dem neuen Speicher neu gebaut. Entfernen: erst den Webview
des Speichers schließen, dann `remove(forIdentifier:)`, Fehler melden. Vorher eine Rückfrage mit
dem allgemeinen Hinweis, dass noch nicht übertragene Einträge dieses Servers verloren gehen
(die Hülle liest die Schreib-Queue nicht aus — keine zweite Kopplung an Frontend-Interna).

### D4 Versionen und Vertrag (R: Ziel und Mindestversion; V: Form)

- **Server → App:** `GET /api/shell` liefert anonym `{ version, shell_contract }`
  (OpenAPI-Schema `ShellInfo`, Typ-Codegen). `shell_contract` ist eine ganze Zahl, anfangs `1`,
  und steigt nur bei einem Bruch zwischen Hülle und Server; neue Felder kommen nur hinzu. Keine
  Datenbank, also auch bei gestörter DB 200 — Erreichbarkeit prüft die App über das Laden, nicht
  über diesen Endpunkt.
- **Mindestversion (R):** die erste Server-Version mit `/api/shell`. Ein 404 heißt „Server ist
  zu alt für diese App“; die Seite nennt `version` aus `GET /api/health`.
- **App prüft** bei jedem Start, Wechsel und Neuladen nach Rückkehr in den Vordergrund, nicht nur
  im Onboarding. Kennt sie den Vertrag nicht, lädt sie die Oberfläche nicht und zeigt die
  Richtung: Server-Vertrag größer → „App aktualisieren“, kleiner → „Server ist zu alt“. Ohne
  Netz gilt der zuletzt bestätigte Vertrag dieses Servers.
- **App → Seite:** Die Kennung `__LIFELINE_HUELLE__` bekommt `platform` (`'ios'`), `version`
  (volle Workspace-Version) und `haptics(kind)`. Die Desktop-Hüllen setzen `platform` und `version`
  vorerst nicht; `platform` fehlt dort, und das Frontend fällt auf „Desktop-App“ zurück.
  Feldnamen nach der Bezeichner-Sprache (Technik englisch, Fachwort `haptics` deutsch); als Grenzwert
  danach fest. Gelesen wird die Kennung weiter nur in `frontend/src/huelle/faehigkeiten.ts`.
- Das Init-Skript der iOS-Hülle liegt als reines JS unter `ios/App/Huelle/huelle.js`, damit
  `frontend/src/test/huelle.ts` es per vitest ausführt wie die Tauri-Skripte (kein driftender
  Stub). Message-Handler: `lifeline`.

### D5 Start ohne Server (R: Ziel; Mechanismus nach Spike)

Der Precache des Service Workers trägt in der Hülle nicht (Fakt 1); die Hülle muss die Oberfläche
selbst ausliefern. Anforderung: Ist der Server nicht erreichbar, lädt die App die zuletzt
erfolgreich geladene Oberfläche **desselben** Servers unter dessen Origin, sodass Cookies,
IndexedDB und die Offline-Logik des Frontends greifen; kommt der Server wieder, lädt sie neu.

Kandidaten in Vorzugsreihenfolge, gemessen in einem **Spike auf echtem Gerät** (Flugmodus,
Kaltstart, Server weg und wieder da, Speicherdruck):

1. Gespeicherte `index.html` per `loadSimulatedRequest(_:responseHTML:)` unter der Server-URL;
   die gehashten Assets kommen aus dem HTTP-Cache des Datenspeichers. Nach jedem Online-Laden
   wärmt die Hülle den Cache mit allen Assets vor (auch nie geöffnete `lazy()`-Seiten); die Liste
   kommt dann aus einem **neuen Feld von `/api/shell`** (entschieden im Spike, additiv).
2. Wie 1, aber die Hülle hält die Assets selbst in Application Support vor, falls iOS den
   Disk-Cache räumt.
3. Eigenes URL-Schema mit Vermittlung von Oberfläche und `/api` — nur nach neuer Entscheidung
   durch Ruben (andere Origin, Cookie- und SSE-Weg in Swift, eigene Sicherheitsprüfung).

Der Spike hält den Rest nicht auf. Der erste TestFlight-Build läuft nur online und zeigt ohne
Server die native Seite „nicht erreichbar“. Der Offline-Start kommt als **eigene Change** nach
dem Spike; diese Change baut nur die Seite und die Erreichbarkeitsprüfung.

### D6 Natives Gefühl und Haptik (R: Ziel; V: Form)

- **Nativ in der Hülle, nicht im Frontend-CSS:** Webview in der Safe Area
  (`contentInsetAdjustmentBehavior`, Hintergrund in Kopf-Schwarz), kein Nachfedern
  (`scrollView.bounces = false`), kein Pull-to-Refresh, Lupe und Textmenü außerhalb von
  Eingaben per eingespieltem Stil der Hülle. `viewport-fit=cover` bleibt aus — sonst rutschte im
  Browser die Kopfleiste unter die Notch, und ältere Server hätten es ohnehin nicht.
- Status-Seiten der Hülle (kein Server, nicht erreichbar, Zertifikat, nicht verträglich) sind
  SwiftUI.
- **Haptik:** `__LIFELINE_HUELLE__.haptics(kind)` mit dem Vokabular
  `'success' | 'warning' | 'error' | 'selection' | 'tap'` →
  `UINotificationFeedbackGenerator` (`.success/.warning/.error`),
  `UISelectionFeedbackGenerator`, `UIImpactFeedbackGenerator(.light)`. Unbekannte Art: nichts.
  Abschaltbar über einen Schalter in den Einstellungen der Hülle (Vorgabe an). Auf dem iPad
  wirkungslos.
- **Auslöser im Frontend** über `huelleHaptics(kind)` in `faehigkeiten.ts` (feuern und vergessen,
  wirft nie, ohne Hülle nichts):
  - Erfassung vom Server angenommen → `success`; ohne Netz nur vorgemerkt → `tap` (kein
    „gespeichert“-Gefühl); vom Server abgelehnt → `error`. Gilt für die gemeinsame
    Erfassungs-Hülle und die ETB-Schnellerfassung.
  - Eingehender Alarm der Stufe `alarm` (auch Unwetter) → `warning`, nur beim ersten Eintreffen,
    nicht beim Nachspielen, und nicht bei stummgeschaltetem Alarm.
  - Wechsel in einem Segment → `selection` (zentral in der Segmentleiste, nicht im Aufrufer).
  - Die übrigen rund 200 Erfolgsmeldungen bleiben ohne Haptik.
- Native Meldung (`benachrichtigungZeigen`, `UNUserNotificationCenter`, Berechtigung beim ersten
  Aufruf) und App-Badge (`setAppBadge`, `setBadgeCount`) mit denselben Kennungsfeldern wie die
  Desktop-Hülle, wirksam nur bei laufender App.
- **Brücke:** Der Message-Handler nimmt Aufrufe nur aus dem Hauptframe und nur von der Origin des
  aktiven Servers an (`frameInfo.isMainFrame`, `securityOrigin`); nach einem Serverwechsel gilt
  die neue Origin sofort.
- Nach `webViewWebContentProcessDidTerminate` und bei Rückkehr in den Vordergrund nach einer
  Pause lädt die Hülle neu, statt eine weiße Seite zu zeigen.

### D7 Anmeldung (V)

`ASWebAuthenticationSession` mit Callback-Schema `lifeline` gegen den bestehenden Server-Weg,
`verifier` bleibt in der App, Rücksprung nur aus der Sitzung; ein `lifeline://anmeldung` von
außen bleibt wirkungslos. Eingelöst per `fetch` im Webview gegen denselben Server, gemeldet per
Ereignis `lifeline:app-anmeldung` wie auf dem Mac. Die iOS-Hülle setzt `passkey: false` und
`anmeldungImBrowser` (Fakt 4). Serverseitig ändert sich nur der Text der Bestätigungsseite und
des Zugangsprotokolls („Lifeline-App“); das Audit bleibt `systembrowser`.

### D8 Links, Downloads, Drucken (V)

Linkregeln aus `src-tauri/src/links.rs` (gemeinsame Fälle): eigene Origin bleibt im Webview,
`target=_blank` und `window.open` der eigenen Origin laden im selben Webview
(`createWebViewWith`), `/api/` außer `/api/auth/` → Download, fremde `http(s)`, `mailto`, `tel`
→ System. Downloads über `WKDownload` (mit den Cookies des Datenspeichers, auch `blob:`) und
danach das Teilen-Blatt. Drucken: das Init-Skript ersetzt `window.print` wie `druck.js` der
Desktop-Hülle; die Hülle druckt über `UIPrintInteractionController` mit dem Druckformat des
Webviews.

### D9 Prüfen und Verteilen (R: TestFlight; V: Form)

Nach ADR-0048 ein Auslöser je Workflow:

- **`scripts/check-all.sh`, neuer Schritt „ios“** (Bündel `ios`, in `alle`): `swift test` des
  Pakets `LifelineKern` und Prüfung der gemeinsamen Fälle. Ohne Swift lokal „OK mit Lücke“; in
  der CI erzwingt `IOS_SWIFT_PFLICHT=1` die Toolchain. `scripts/bereiche.sh` kennt `ios/*` und
  den Querbezug `src-tauri/faelle/*`.
- **`suiten.yml`**: Job `ios` auf `ubuntu-latest` mit dem neuen Schritt (Kanal-Branches und PR
  mit Label `voll`).
- **`ios-pruefung.yml`** (`pull_request`, Pfadfilter `ios/**`, `src-tauri/faelle/**`): auf
  `macos-latest` XcodeGen, Simulatorbau, Swift-Tests auf iOS, Simulator-Bilder als Artefakt (für
  die Bilder der Änderung). Kein Pflicht-Check.
- **`ios.yml`** (`workflow_call` aus `artefakte.yml` nach `freigeben`, nur Tags der Kanäle `beta`
  und `main`; dazu `workflow_dispatch`): archivieren, signieren (automatisch per API-Schlüssel mit
  Rolle App Manager), zu TestFlight hochladen. Ein roter Upload hält das Release nicht auf.
- XcodeGen-Version an einer Stelle unter `scripts/` gepinnt, von beiden Workflows gelesen.

### D10 Regeln und Doku (V)

- Die Wurzel-`AGENTS.md` hat 207 Zeilen (Grenze 200). Vor der neuen Tabellenzeile wandern die
  zwei Abschnitte „Backend — Migrationsvergabe“ und „Backend — Tabellenumbau“ nach
  `src/AGENTS.md` (eigener `refactor`-Commit, Verweise gegreppt).
- Architektur-Wächter lernt das Teilprojekt `ios`; arc42 Kapitel 5 (Bausteine), 7 (Verteilung),
  8 (Konzepte, Hüllen-Vertrag), 11 (Risiken) nachziehen.
- `docs/betrieb/ios-app.md` (TestFlight, CA-Profil, Grenzen: kein Push im Hintergrund, kein
  Passkey im Webview, Start ohne Netz noch nicht); Anwenderkapitel nur mit Ist-Stand.

## Risks / Trade-offs

- [Swift lässt sich im Container nicht bauen] → Kern unter Linux in der CI testbar, App-Teil
  nur auf dem macOS-Runner; kein „fertig“ ohne grünen Lauf von `ios-pruefung.yml`.
- [Foundation unter Linux parst URLs in Randfällen anders als auf iOS] → die gemeinsamen Fälle
  laufen in beiden Umgebungen.
- [Doppelte Regeln in Rust und Swift] → gemeinsame JSON-Fälle; eine Änderung macht beide Suiten
  rot, `bereiche.sh` kennt den Querbezug.
- [Kein Alarm bei geschlossener App] → ehrlich in Betriebs- und Anwenderdoku; APNs als eigene
  Aufgabe.
- [Ohne Netz startet der erste Build nicht] → native Seite „nicht erreichbar“; Offline-Start als
  eigene Change nach dem Spike.
- [iPad-WKWebView meldet sich als macOS] → Kennung trägt `platform: 'ios'`; die Sitzungsliste
  bleibt kosmetisch ungenau (kein Server-Umbau dafür).
- [API-Schlüssel der Notarisierung hat nur die Rolle Entwickler] → Übergabe an Ruben vor dem
  ersten Upload.
- [macOS-Minuten] → macOS nur im PR mit Pfadfilter und an Beta-/Stabil-Tags.
- [ADR-Nummer kollidiert mit einem offenen PR] → vor dem Commit gegen offene PRs prüfen.

## Migration Plan

Neu und additiv: Browser und Desktop-Hülle ändern sich nur in Texten. Rückweg: Workflows
abschalten, App in TestFlight zurückziehen; `/api/shell` bleibt harmlos stehen.

## Open Questions

- Mechanismus des Starts ohne Server (D5) — nach dem Spike, eigene Change; ändert diese Specs
  nur additiv.
