# iOS-App: Start ohne Server — Umsetzungsplan (LLH-1980)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die iOS-Hülle startet ohne erreichbaren Server mit der zuletzt geladenen Oberfläche desselben Servers und arbeitet mit ihm weiter, sobald er zurück ist.

**Architecture:** Der Server nennt in `GET /api/shell` die Assets, die die Oberfläche offline braucht. Die Hülle wärmt sie nach jedem Online-Laden im Webview in den HTTP-Cache des Datenspeichers vor und legt erst danach die `index.html` je Server ab. Ohne Server lädt sie diese per `loadSimulatedRequest` unter der Server-URL. Welche Seite gilt und was zu tun ist, entscheidet `Ablauf` im Kern; die App führt nur aus.

**Tech Stack:** Rust (axum, rust-embed, utoipa), Swift 6 (`ios/LifelineKern`, XCTest unter Linux), WKWebView (iOS 17.4), Network.framework (Testserver), Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-22-ny0d22bl-ios-start-ohne-server-design.md`

## Global Constraints

- `/api/shell` bleibt anonym und ohne Datenbank; `SHELL_CONTRACT` bleibt `1`; das neue Feld heißt auf dem Draht `assets`.
- `assets` = alle Pfade unter `assets/` des eingebetteten Bundles, **ohne `assets/doku/`**, sortiert, ohne führenden `/`.
- Nur Oberfläche **desselben** Servers (Datenspeicher und Ablage je `ServerEintrag.id`).
- Kein Start ohne Server bei Zertifikatsfehler oder „nicht verträglich“.
- Reihenfolge: andere Version online → alte Ablage verwerfen → vorwärmen → nur wenn **alle** Assets ok, `index.html` speichern.
- Rückkehr des Servers: gleiche Version → Seite `web` **ohne** Laden; andere Version → Laden vom Server.
- Startprüfung gescheitert → in diesem App-Lauf keine gespeicherte Oberfläche mehr für diesen Server (nur im Speicher), nichts löschen.
- Zertifikate prüft die App ohne Ausnahme (kein Challenge-Delegat in `ios/App`); Vertrauen für den Testserver nur im Test-Target.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“); Prosa, Kommentare, Testnamen deutsch.
- Logik mit Entscheidung in `ios/LifelineKern` mit Test; `ios/App` bleibt dünn (`ios/AGENTS.md`).
- Nach der DTO-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten.

## Review Focus

1. Server liefert in `assets` einen bösen Pfad (`../`, absolute URL, `//host`) → die Hülle verwirft die ganze Liste, wärmt nichts vor und speichert nichts (Test in Task 2).
2. Älterer Server ohne Feld `assets` → keine Ablage, kein Start ohne Server, alles wie bisher (Test in Task 2 und 3).
3. Web-Prozess endet auf der Seite „ohne Server“ (Speicherdruck) → gespeicherte Oberfläche erneut laden, nicht `reload()` (Test in Task 3).
4. Antwort auf den `index.html`-Abruf ist keine HTML-Seite (Captive Portal, Proxy-Fehlerseite) → nicht speichern (Test in Task 2, `isIndexAntwort`).
5. Server wird entfernt → seine gespeicherte Oberfläche verschwindet mit (Test in Task 2, `ServerentfernungTests`).

---

### Task 1: Backend — Feld `assets` in `/api/shell`

**Files:**
- Modify: `src/static_files.rs` (neue Funktionen, Tests im bestehenden `mod tests`)
- Modify: `src/routes/shell.rs`
- Modify: `tests/shell.rs`
- Regenerate: `docs/api/openapi.json` (bzw. die Datei, die `openapi_spec_aktuell` prüft), `frontend/src/api/types.generated.ts`

**Interfaces:**
- Produces: `pub fn offline_assets() -> Vec<String>` (in `static_files`), Feld `ShellInfo.assets: Vec<String>`.

- [ ] **Step 1: Failing Unit-Test** in `src/static_files.rs`, `mod tests`:
  `offline_assets_nimmt_nur_assets_ohne_doku_und_sortiert`:
  `filter_offline_assets(["index.html","assets/index-b.js","assets/doku/bild.png","assets/a.css","bibliotheken/libheif/libheif.js","sw.js"])` == `["assets/a.css","assets/index-b.js"]`.
- [ ] **Step 2:** `cargo test --lib static_files` → FAIL (Funktion fehlt).
- [ ] **Step 3:** `fn filter_offline_assets<'a>(pfade: impl IntoIterator<Item = impl AsRef<str>>) -> Vec<String>` (Präfix `assets/`, nicht `assets/doku/`, sortiert) und `pub fn offline_assets() -> Vec<String>` über `Asset::iter()`.
- [ ] **Step 4:** Test grün.
- [ ] **Step 5: Failing Integrationstest** in `tests/shell.rs`: `assets_nennt_nur_pfade_unter_assets_ohne_doku`: `json["assets"]` ist ein Array; jeder Eintrag ist String, beginnt mit `assets/`, nicht mit `assets/doku/`; die Liste ist sortiert. Ein Abruf ohne Cookie reicht.
- [ ] **Step 6:** `cargo test --test shell` → FAIL.
- [ ] **Step 7:** `ShellInfo` um `pub assets: Vec<String>` mit Doc-Kommentar (Zweck: Vorwärmen der iOS-Hülle, Herleitung LLH-1980) ergänzen; `load_shell` füllt es aus einem `static LazyLock<Vec<String>>` mit `offline_assets()`. Modulkopf um einen Satz ergänzen.
- [ ] **Step 8:** `cargo test --test shell` grün; `scripts/check-typ-codegen.sh` grün, generierte Dateien aktualisiert.
- [ ] **Step 9: Commit** `feat: /api/shell nennt die Assets für den Start ohne Server (LLH-1980)`.

### Task 2: Kern — `ShellInfo.assets`, `Vorrat`, `Vorratsablage`, Entfernen

**Files:**
- Modify: `ios/LifelineKern/Sources/LifelineKern/Vertrag.swift` (`ShellInfo`)
- Create: `ios/LifelineKern/Sources/LifelineKern/Vorrat.swift`
- Create: `ios/LifelineKern/Sources/LifelineKern/Vorratsablage.swift`
- Modify: `ios/LifelineKern/Sources/LifelineKern/Serverentfernung.swift`
- Create: `ios/LifelineKern/Tests/LifelineKernTests/VorratTests.swift`, `VorratsablageTests.swift`
- Modify: `ios/LifelineKern/Tests/LifelineKernTests/VertragTests.swift`, `ServerentfernungTests.swift`
- Modify: `ios/LifelineKern/Package.swift` (Kopfkommentar: Vorrat)

**Interfaces:**
- Produces:
  - `ShellInfo.assets: [String]?`, `init(version: String, shellContract: Int, assets: [String]? = nil)`; Decoding mit `decodeIfPresent`, CodingKey `assets`.
  - `public enum Vorrat { static let startpruefungFrist: Duration = .seconds(10); static let gleichzeitig = 4; static func offlineAssets(_ info: ShellInfo) -> [String]?; static func isIndexAntwort(status: Int, contentType: String?) -> Bool; static func plan(gespeichert: String?, server: ShellInfo) -> Vorwaermplan }`
  - `public struct Vorwaermplan: Equatable, Sendable { public let verwerfen: Bool; public let assets: [String]? }`
  - `public struct GespeicherteOberflaeche: Codable, Equatable, Sendable { version: String; html: String; gespeichertAm: Date }`
  - `public struct Vorratsablage: Sendable { init(verzeichnis: URL); func load(_ id: UUID) -> GespeicherteOberflaeche?; func save(_ o: GespeicherteOberflaeche, fuer id: UUID) throws; func remove(_ id: UUID) }` — eine Datei `<verzeichnis>/<uuid>.json`, `.atomic`, legt das Verzeichnis an; unlesbare Datei → `nil`; `remove` ohne Datei ist kein Fehler.
  - `Entfernungsdienste.removeVorrat(_ id: UUID)` (wirft nicht).

- [ ] **Step 1: Failing Tests** (`VertragTests`): `testAssetsSindOptional` (JSON ohne `assets` → `nil`), `testAssetsWerdenGelesen`.
- [ ] **Step 2: Failing Tests** (`VorratTests`):
  - `testOhneAssetsGibtEsKeinenVorrat`: `offlineAssets(ShellInfo(…, assets: nil))` und `assets: []` → `nil`.
  - `testGueltigeAssetsBleibenUnveraendert`: `["assets/a.css","assets/sub/b-1.js"]` → gleich.
  - `testEinBoeserPfadVerwirftDieGanzeListe`: je eine Liste mit `"assets/../x.js"`, `"/assets/a.js"`, `"https://evil.example/a.js"`, `"//evil/a.js"`, `"assets/doku/a.png"`, `"index.html"`, `"assets/a b.js"` → `nil`.
  - `testIndexAntwortNurHtmlMit200`: `(200,"text/html; charset=utf-8")` true; `(200,"application/json")`, `(302,"text/html")`, `(200,nil)` false.
  - `testGleicheVersionPlantNichts`: `plan(gespeichert: "1.0", server: v1.0 mit assets)` == `Vorwaermplan(verwerfen: false, assets: nil)`.
  - `testAndereVersionVerwirftZuerst`: `plan(gespeichert: "1.0", server: v1.1 mit ["assets/a.js"])` == `(verwerfen: true, assets: ["assets/a.js"])`.
  - `testOhneAblageNurVorwaermen`: `plan(gespeichert: nil, …)` == `(verwerfen: false, assets: […])`.
  - `testAndereVersionOhneAssetsVerwirftTrotzdem`: `plan(gespeichert: "1.0", server: v1.1, assets nil)` == `(verwerfen: true, assets: nil)`.
- [ ] **Step 3: Failing Tests** (`VorratsablageTests`, Temp-Verzeichnis): speichern und lesen; je Server getrennt; `remove` löscht nur den einen; unlesbare Datei → `nil`; `remove` ohne Datei wirft nicht.
- [ ] **Step 4: Failing Tests** (`ServerentfernungTests`): Reihenfolge der Attrappe ist `closeWebView, removeDatenspeicher, removeVorrat, removeEintrag`; scheitert `removeDatenspeicher`, kommt `removeVorrat` nicht.
- [ ] **Step 5:** `swift test` in `ios/LifelineKern` → FAIL (Kompilierfehler).
- [ ] **Step 6:** Umsetzen. Pfadregel in `offlineAssets`: jedes Element passt auf `^assets/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, kein Segment `..`, nicht unter `assets/doku/`; ein Verstoß → `nil`.
- [ ] **Step 7:** `swift test` grün.
- [ ] **Step 8: Commit** `feat(ios): Kern legt die Oberfläche je Server für den Start ohne Server ab (LLH-1980)`.

### Task 3: Kern — `Ablauf` mit Seite „ohne Server“

**Files:**
- Modify: `ios/LifelineKern/Sources/LifelineKern/Ablauf.swift`
- Modify: `ios/LifelineKern/Tests/LifelineKernTests/AblaufTests.swift`

**Interfaces:**
- Consumes: `ShellInfo.version`.
- Produces:
  - `Seite.ohneServer(ServerEintrag, version: String)` (in `eintrag`).
  - `Event.vorratGescheitert(fuer: UUID)`.
  - `Effect.loadVorrat(ServerEintrag)`, `Effect.vorwaermen(ServerEintrag, ShellInfo)`.
  - `Ablauf.next(_ seite: Seite, _ event: Event, vorrat: String? = nil) -> Step` — `vorrat` ist die Version einer nutzbaren gespeicherten Oberfläche für `seite.eintrag` (App: `nil`, wenn keine oder in diesem Lauf gescheitert).
  - `Seite.zeigtWebview: Bool` (`web`, `ohneServer`), `Seite.wiederholt: Bool` (`status(_, .nichtErreichbar)`, `ohneServer`).
  - `bietetZurOberflaeche` ist auch für `ohneServer` wahr.

- [ ] **Step 1: Bestehende Erwartungen anpassen:** jedes verträgliche Laden (`loaded`) endet jetzt auf `[.markVerbunden(id, vertrag: 1), .load(e), .vorwaermen(e, info)]`; `web` + verträglich auf `[.markVerbunden(…), .vorwaermen(e, info)]`.
- [ ] **Step 2: Failing Tests**, je ein Test:
  - `testOhneServerMitVorratStartetDieGespeicherteOberflaeche`: `pruefung(elw)` + `nichtErreichbar(.nichtErreichbar)`, `vorrat: "1.0"` → `ohneServer(elw, version: "1.0")`, `[.loadVorrat(elw), .scheduleRetry]`.
  - `testOhneVorratBleibtEsBeiNichtErreichbar`: wie oben mit `vorrat: nil` → `status(elw, .nichtErreichbar)`.
  - `testZertifikatsfehlerStartetNieOhneServer`: `nichtErreichbar(.zertifikat)`, `vorrat: "1.0"` → `status(elw, .zertifikat)`.
  - `testNichtVertraeglichStartetNieOhneServer`: `nichtVertraeglich(.zuAlt, server: nil)`, `vorrat: "1.0"` → `status(elw, .nichtVertraeglich(.zuAlt, serverVersion: nil))`.
  - `testAusNichtErreichbarGehtEsZurGespeichertenOberflaeche`: `status(elw, .nichtErreichbar)` + `nichtErreichbar`, `vorrat: "1.0"` → `ohneServer`.
  - `testOhneServerPrueftWeiter`: `ohneServer` + `wiederholen` → `[.check(elw)]`; + `vordergrund(…)` → `[.check(elw)]`; + `nichtErreichbar(.nichtErreichbar)` → bleibt, `[.scheduleRetry]`.
  - `testServerZurueckMitGleicherVersionLaedtNichtNeu`: `ohneServer(elw, "1.0.0-alpha.320")` + `vertraeglich(info)` → `web(elw, vertrag: 1)`, `[.markVerbunden(elw.id, vertrag: 1), .vorwaermen(elw, info)]`.
  - `testServerZurueckMitAndererVersionLaedtVomServer`: `ohneServer(elw, "0.9")` + `vertraeglich(info)` → `web`, `[.markVerbunden(…), .load(elw), .vorwaermen(elw, info)]`.
  - `testOhneServerZertifikatOderUnvertraeglichZeigtDieStatusSeite`.
  - `testWebProzessEndeOhneServerLaedtDieGespeicherteOberflaeche`: → `[.loadVorrat(elw)]`.
  - `testGescheiterteNavigationOhneServerLaedtDieGespeicherteOberflaeche`: eigener Server → `[.loadVorrat(elw)]`; fremde URL und `.cancelled` → nichts.
  - `testGescheiterterStartFaelltAufNichtErreichbar`: `ohneServer` + `vorratGescheitert(fuer: elw.id)` → `status(elw, .nichtErreichbar)`, `[.scheduleRetry]`; mit fremder ID → unverändert.
  - `testZurOberflaecheOhneServerLaedtDieGespeicherteOberflaeche`: → `[.hideZurOberflaeche, .loadVorrat(elw)]`.
  - `testErgebnisEinesAnderenServersAendertOhneServerNicht`.
  - `testZeigtWebviewUndWiederholt` für alle Seiten.
- [ ] **Step 3:** `swift test --filter AblaufTests` → FAIL.
- [ ] **Step 4:** Umsetzen.
- [ ] **Step 5:** `swift test` grün.
- [ ] **Step 6: Commit** `feat(ios): Ablauf startet ohne Server mit der gespeicherten Oberfläche (LLH-1980)`.

### Task 4: Vorwärm-Skript

**Files:**
- Create: `ios/App/Huelle/vorwaermen.js` (Funktionsrumpf für `callAsyncJavaScript`, Argumente `pfade: string[]`, `gleichzeitig: number`; Rückgabe `{ ok: number, fehler: string[] }`)
- Create: `frontend/src/huelle/vorwaermen.ios.test.ts`
- Modify: `ios/project.yml` (Ressource wie `huelle.js`)

**Interfaces:**
- Produces: Skriptdatei `vorwaermen.js`; jeder Pfad als `fetch('/' + pfad, { cache: 'force-cache', credentials: 'same-origin' })`, Körper ganz gelesen (`arrayBuffer()`), höchstens `gleichzeitig` offen, `!res.ok` oder Ausnahme → Pfad in `fehler`.

- [ ] **Step 1: Failing Tests** (Skript per `new AsyncFunction('pfade','gleichzeitig', skript)` mit gestubtem `fetch`):
  `holt jeden Pfad unter der Wurzel mit force-cache`; `hält höchstens die erlaubte Zahl gleichzeitig offen` (gleichzeitig 2, sechs Pfade, Zähler max 2); `meldet fehlgeschlagene und nicht ok beantwortete Pfade`; `leere Liste ergibt ok 0`.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/huelle/vorwaermen.ios.test.ts` → FAIL.
- [ ] **Step 3:** Skript schreiben, Ressource in `project.yml` eintragen.
- [ ] **Step 4:** Test grün; Prettier/ESLint für die neue Testdatei grün.
- [ ] **Step 5: Commit** `feat(ios): Skript zum Vorwärmen der Assets (LLH-1980)`.

### Task 5: App — `Vorratsdienst` und Verdrahtung

**Files:**
- Create: `ios/App/Vorratsdienst.swift`
- Modify: `ios/App/AppModell.swift`, `ios/App/Seiten/RootView.swift`

**Interfaces:**
- Consumes: Task 2 (`Vorratsablage`, `Vorrat`), Task 3 (`Ablauf`), Task 4 (`vorwaermen.js`).
- Produces: `@MainActor final class Vorratsdienst`:
  - `init(ablage: Vorratsablage, holeIndex: @escaping @Sendable (URL) async -> ShellAbruf = Vorratsdienst.standardAbruf, skript: String = Vorratsdienst.vorwaermskript())`
  - `func version(fuer id: UUID) -> String?` (nil bei gescheitert in diesem Lauf oder ohne Ablage)
  - `func markGescheitert(_ id: UUID)`
  - `func loadVorrat(_ eintrag: ServerEintrag, in webView: WKWebView) -> Bool` (`loadSimulatedRequest(URLRequest(url: eintrag.adresse.url), responseHTML:)`)
  - `func isGestartet(_ webView: WKWebView) async -> Bool` (alle 0,5 s `document.getElementById('root')?.childElementCount > 0`, bis `Vorrat.startpruefungFrist`)
  - `func vorwaermen(_ eintrag: ServerEintrag, info: ShellInfo, in webView: WKWebView) async` (Plan aus `Vorrat.plan`; verwerfen → `ablage.remove`; `callAsyncJavaScript(skript, arguments: ["pfade": …, "gleichzeitig": Vorrat.gleichzeitig], in: nil, contentWorld: .page)`; nur bei `fehler.isEmpty` `holeIndex(eintrag.adresse.url)`, `Vorrat.isIndexAntwort`, `ablage.save`)
  - `standardAbruf` nutzt eine ephemere `URLSession` mit `Umleitungssperre` (aus `Vertragsabruf.swift`), Zeitlimit 8 s.
  - Protokoll: `Logger(subsystem: "dev.rubeen.lifeline.ios", category: "ohne-server")` für Vorwärmen (ok/Fehler/Dauer), Laden ohne Server, Startprüfung (Dauer, Ergebnis).

- [ ] **Step 1:** `Vorratsdienst` schreiben; Ablage unter `URL.applicationSupportDirectory/Lifeline/Oberflaechen`.
- [ ] **Step 2:** `AppModell`: `send` ruft `Ablauf.next(seite, event, vorrat: seite.eintrag.flatMap { vorratsdienst?.version(fuer: $0.id) })`; Webview schließen bei `!seite.zeigtWebview`, Wiederholung abbrechen bei `!seite.wiederholt`, Hinweis weg bei `!seite.zeigtWebview`.
- [ ] **Step 3:** `perform`: `.loadVorrat` (Webview neu bauen, laden, dann `isGestartet`; bei `false` oder fehlender Ablage `markGescheitert` und `send(.vorratGescheitert(fuer:))`, nur wenn der Webview noch derselbe ist); `.vorwaermen` (warten, bis `webView.isLoading == false`, höchstens 60 s, nur derselbe Webview, dann `vorwaermen`). Im Testzustand nichts (bestehende Sperre).
- [ ] **Step 4:** `Entfernungsdienste.removeVorrat` im `AppModell` → `vorratsablage.remove`.
- [ ] **Step 5:** `RootView`: `.ohneServer` zeigt denselben Webview-Host wie `.web`.
- [ ] **Step 6:** Bestehende App-Tests, die `AppModell` bauen, kompilieren lassen (keine Verhaltensänderung). Prüfung erst in Task 6 (Simulator).
- [ ] **Step 7: Commit** `feat(ios): App startet ohne Server mit der gespeicherten Oberfläche (LLH-1980)`.

### Task 6: Simulator-Test mit https-Testserver

**Files:**
- Create: `ios/AppTests/Testserver.swift` (NWListener mit TLS auf `127.0.0.1`, Port vom System, Routen aus einem Wörterbuch Pfad → (Status, Content-Type, Cache-Control, Körper), `start()`, `stop()`, Zähler der Abrufe je Pfad)
- Create: `ios/AppTests/testserver.p12` (selbst signiert für `localhost`/`127.0.0.1`, 20 Jahre, nur Test; Passwort im Test als Konstante) und `ios/AppTests/LIESMICH-testserver.md` (wie erzeugt)
- Create: `ios/AppTests/OhneServerTests.swift`

**Interfaces:**
- Consumes: `Vorratsdienst`, `Webviewfabrik.make`, `Vorratsablage`.

- [ ] **Step 1:** Testserver mit einer Oberfläche: `index.html` (lädt `assets/haupt-1.js`, `Cache-Control: no-cache`), `assets/haupt-1.js` (schreibt `<p id="haupt">` in `#root` und lädt per `import()` `assets/spaet-1.js` erst auf `window.__ladeSpaet()`), `assets/spaet-1.js` (setzt `window.__spaet = true`), beide `public, max-age=31536000, immutable`.
- [ ] **Step 2: Tests** (eigener Navigationsdelegat im Test, der nur `127.0.0.1` mit der Testidentität vertraut; `holeIndex` des Dienstes über eine Test-`URLSession` mit demselben Vertrauen):
  - `testDieGespeicherteOberflaecheStartetOhneServerAuchMitNieGeladenemChunk`: online laden, `vorwaermen` mit `["assets/haupt-1.js","assets/spaet-1.js"]` → Ablage vorhanden; Server stoppen; neuer Webview mit demselben Datenspeicher, `loadVorrat` → `isGestartet` true, `__ladeSpaet()` → `__spaet == true`.
  - `testOhneVorgewaermtenChunkStartetSieNicht`: Ablage mit `index.html`, die auf ein nie geholtes `assets/fehlt-1.js` zeigt, Server gestoppt → `isGestartet` false.
  - `testEinFehlendesAssetVerhindertDasSpeichern`: Asset-Liste mit einem 404-Pfad → keine Ablage.
  - `testAndereVersionVerwirftDieAlteAblageVorDemVorwaermen`: Ablage `0.9`, Vorwärmen mit Version `1.0` und 404-Asset → Ablage weg.
- [ ] **Step 3:** In `ios-pruefung.yml` laufen lassen (Push), bis grün; Ergebnis im PR unter „Geprüft“.
- [ ] **Step 4: Commit** `test(ios): Start ohne Server im Simulator gegen einen https-Testserver (LLH-1980)`.

### Task 7: Doku, Regeln, ADR, Messprotokoll

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-<nächste>-ios-start-ohne-server-ueber-gespeicherte-oberflaeche-und-http-cache.md` (Vorlage `VORLAGE.md`; Nummer nach `docs/architektur/AGENTS.md`)
- Modify: `ios/AGENTS.md`, `frontend/src/offline/AGENTS.md`, Architektur Kapitel 6, `docs/anwender/kapitel/ohne-netz.md`

- [ ] **Step 1:** ADR: Kontext, Entscheidung (Kandidat 1), verworfene (2, 3, App-Bound Domains), `## Regeln` (MUST: nur derselbe Server; MUST NOT bei Zertifikatsfehler; MUST verwerfen vor Vorwärmen bei anderer Version; MUST speichern nur nach vollständigem Vorwärmen; `assets` ohne `assets/doku/`), `## Prüfung` (`verbiete`/grep: `shell.rs` bzw. `static_files.rs` schließt `assets/doku/` aus; kein `didReceive challenge` in `ios/App`), Abschnitt „Messung auf dem Gerät“ mit Protokoll (Tabelle: Fall, Erwartung, Ergebnis — Flugmodus-Kaltstart, Server weg/zurück gleiche Version, Server zurück neue Version, Speicherdruck, Gerät neu gestartet, mehrere Tage nicht geöffnet, nie geöffnete Seite ohne Netz) mit „Ergebnis: steht aus“.
- [ ] **Step 2:** `ios/AGENTS.md` Regel „Start ohne Server“ mit Verweis auf die ADR; `frontend/src/offline/AGENTS.md` ein Satz; Kapitel 6 Ablauf; Anwenderkapitel Abschnitt „iOS-App ohne Server“ (Form nach `docs/anwender/AGENTS.md`).
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Swift-Kern mit `swift` im PATH).
- [ ] **Step 4: Commit** `docs: Start ohne Server der iOS-App in ADR, Regeln und Anwenderdoku (LLH-1980)`.
