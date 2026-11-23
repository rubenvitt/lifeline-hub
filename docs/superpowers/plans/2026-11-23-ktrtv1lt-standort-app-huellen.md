# Standort in den App-Hüllen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS- und Android-App geben `navigator.geolocation` an die Oberfläche des aktiven Servers
weiter, nur im Vordergrund; der Hinweis bei verweigertem Zugriff nennt in der App den richtigen Weg.

**Architecture:** Android: der WebView liefert die Geolocation selbst, die App entscheidet in
`onGeolocationPermissionsShowPrompt` über `Seitenzugriff.standort` (Kern) und das Recht der App.
iOS: `huelle.js` ersetzt `navigator.geolocation` durch einen Polyfill über die Brücke
(`location_current`, `location_watch`, `location_clear`, Rückkanal `__LIFELINE_LOCATION__`); der
Kern parst, entscheidet und verwaltet Beobachtungen, die App führt `CLLocationManager` aus.

**Tech Stack:** Kotlin (JVM-Kern, Android-App, Robolectric), Swift 6 (LifelineKern, UIKit/WebKit/
CoreLocation), Vanilla-JS-Init-Skripte, TypeScript/React + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-ktrtv1lt-standort-app-huellen-design.md`

## Global Constraints

- Standort nur für die Origin des aktiven Servers (`Bruecke.accepts(isMainFrame = true, …)`), nie
  im Hintergrund: kein `ACCESS_BACKGROUND_LOCATION`, kein `NSLocationAlways…`, kein
  `UIBackgroundModes location`, kein `NSLocationTemporaryUsageDescriptionDictionary`.
- Android: `retain` in `GeolocationPermissions.Callback.invoke` immer `false`; „erlaubt“ = fein ODER grob.
- iOS-Plist-Text exakt: „Lifeline zeigt deinen Standort auf der Lagekarte und übernimmt ihn auf
  Wunsch in Ortsfelder. Er bleibt auf dem Gerät, bis du ihn selbst speicherst.“
- Wire-Namen englisch und danach fest: `location_current`, `location_watch`, `location_clear`,
  Felder `id`, `high_accuracy`, `timeout`, `watch`; Position `latitude, longitude, accuracy,
  altitude, altitude_accuracy, heading, speed, timestamp`; Fehler `denied`, `unavailable`, `timeout`;
  Rückkanal `window.__LIFELINE_LOCATION__(id, fehler, position)`.
- `timeout` zählt die iOS-Hülle erst ab erteilter Freigabe; der Polyfill stellt keine eigene Uhr.
- App-Text bei Verweigerung exakt: „Standortzugriff verweigert – in den Einstellungen des Geräts
  für Lifeline freigeben, dann erneut einschalten.“
- Privacy-Manifest: `NSPrivacyCollectedDataTypePreciseLocation`, Zweck
  `NSPrivacyCollectedDataTypePurposeAppFunctionality`, Linked `true`, Tracking `false`.
- Bezeichner nach `AGENTS.md` (Fachbegriffe deutsch, Technik englisch); Prosa deutsch.
- Hüllen-Regeln: `ios/AGENTS.md`, `android/AGENTS.md` (Logik im Kern mit Test; App-Code ist erst
  mit grünem `ios-pruefung.yml`/`android-pruefung.yml` fertig).

## Review Focus

1. Serverwechsel oder Navigation während einer laufenden Beobachtung (iOS) — danach keine Position
   mehr an die Seite; getestet in Task 4 (`Standortbeobachtung`).
2. Server wechselt, während Android die Person nach dem Recht fragt — Freigabe wird nach der
   Antwort erneut geprüft; getestet in Task 2.
3. `watchPosition` zweimal, eine davon `clearWatch` — die andere läuft weiter, `location_clear` nur
   für die eine; getestet in Task 3.
4. Antwort der Hülle für eine Kennung, die die Seite schon aufgegeben hat (`clearWatch` vor der
   ersten Position) — wird verworfen; getestet in Task 3.
5. Verweigerung im Browser bleibt beim heutigen Text (keine Hülle) — getestet in Task 6.

---

### Task 1: Android-Kern `Seitenzugriff.standort`

**Files:**
- Modify: `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Seitenzugriff.kt`
- Test: `android/kern/src/test/kotlin/dev/rubeen/lifeline/kern/SeitenzugriffTest.kt`

**Interfaces:**
- Produces: `Seitenzugriff.standort(origin: SeitenOrigin?, aktiverServer: ServerAdresse?): Boolean`

- [x] **Step 1: Failing test** `` `der Standort geht nur an die Seite des aktiven Servers` ``:
  `true` für `https://elw.local:8443` und `https://ELW.local:8443/`; `false` für
  `https://idp.example`, `https://elw.local`, `http://elw.local:8443`, `"null"`, `null`, aktiv `null`.
- [x] **Step 2:** `LC_ALL=C.UTF-8 android/gradlew -p android/kern test` → FAIL (unresolved `standort`).
- [x] **Step 3:** `standort` = `Bruecke.accepts(isMainFrame = true, origin, aktiverServer)`, KDoc
  wie `kamera` (Entwurf LLH-2071).
- [x] **Step 4:** Kern-Tests grün.
- [x] **Step 5:** Commit `feat(android): Kern entscheidet über den Standort der Seite (LLH-2071)`.

### Task 2: Android-App: Recht, Rückruf, Einstellungen

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml` (Rechte `ACCESS_FINE_LOCATION`,
  `ACCESS_COARSE_LOCATION`; `uses-feature android.hardware.location` `required="false"`)
- Modify: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/HuellenChromeClient.kt`
- Modify: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/dienste/Activityzugriffe.kt`
- Modify: `android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/WebviewFabrik.kt`
  (`setGeolocationEnabled(true)`)
- Test: `android/app/src/test/kotlin/dev/rubeen/lifeline/android/SeitenzugriffeTest.kt`

**Interfaces:**
- Consumes: `Seitenzugriff.standort` (Task 1)
- Produces: `Webzugriffe.standort(fertig: (Boolean) -> Unit)`;
  `HuellenChromeClient.onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback)`

- [x] **Step 1: Failing tests** (Attrappe bekommt `standortErlaubt`, `standortGefragt`):
  - `der aktive Server bekommt den Standort, wenn die App das Recht hat` → `invoke(origin, true, false)`, einmal gefragt.
  - `ohne Recht der App bleibt der Standort zu` → `invoke(origin, false, false)`.
  - `eine fremde Origin bekommt keinen Standort und die App fragt nicht` → `false`, `standortGefragt == 0`.
  - `wechselt der Server während der Rückfrage, bleibt der Standort zu` (Attrappe setzt
    `aktiverServer = null` vor `fertig(true)`) → `false`.
  - `ohne Zugriffe lehnt der WebView ab` (`zugriffe = null`) → `false`.
  - `Activityzugriffe meldet erlaubt, wenn fein oder grob gewährt ist` (Robolectric
    `shadowOf(app).grantPermissions(ACCESS_COARSE_LOCATION)` → `fertig(true)` ohne Launch).
- [x] **Step 2:** Lokal ohne SDK nicht lauffähig → Lauf in `android-pruefung.yml` (CI) nach Push.
- [x] **Step 3:** Umsetzen. `Activityzugriffe.standort`: sofort `true`, wenn FINE oder COARSE
  gewährt; sonst `RequestMultiplePermissions` mit beiden, Wartende sammeln wie `kameraFertig`,
  Ergebnis `any { it.value }`. Manifest-Kommentar wie bei der Kamera.
- [x] **Step 4:** CI `android-pruefung.yml` grün (wird mit dem PR-Push geprüft; vorher
  `LC_ALL=C.UTF-8 android/gradlew -p android :app:compileDebugKotlin`, falls ein SDK greifbar ist).
- [x] **Step 5:** Commit `feat(android): Standort für die Oberfläche des aktiven Servers (LLH-2071)`.

### Task 3: iOS-Init-Skript: Polyfill und Unterframe-Sperre

**Files:**
- Modify: `ios/App/Huelle/huelle.js` (Kopf: Befehle + Rückkanal; Polyfill)
- Create: `ios/App/Huelle/unterframe-standort.js`
- Modify: `frontend/src/test/huelle.ts` (`antworteIosStandort(id, fehler, position)`,
  `starteIosUnterframe(fenster)`)
- Test: `frontend/src/huelle/iosHuelle.test.ts`, neu `frontend/src/huelle/iosUnterframe.test.ts`

**Interfaces:**
- Produces (Wire, für Task 4): Nachrichten `{ cmd: 'location_current', id, high_accuracy: boolean, timeout: number|null }`,
  `{ cmd: 'location_watch', id, high_accuracy, timeout }`, `{ cmd: 'location_clear', watch }`;
  Antwort über `__LIFELINE_REPLY__(id, fehler, position)`; Beobachtung über
  `window.__LIFELINE_LOCATION__(id, fehler, position)`.

- [x] **Step 1: Failing tests** in `iosHuelle.test.ts`, Block „Standort (LLH-2071)“:
  - `getCurrentPosition fragt die Hülle und liefert eine GeolocationPosition` — Nachricht
    `{cmd:'location_current', id, high_accuracy:true, timeout:15000}`; Antwort
    `{latitude:52.1, longitude:9.9, accuracy:12, altitude:null, altitude_accuracy:null, heading:null, speed:null, timestamp:1700000000000}`
    → Erfolg mit `coords.latitude === 52.1`, `coords.accuracy === 12`, `timestamp === 1700000000000`.
  - `denied wird Code 1, unavailable Code 2, timeout Code 3` — inkl. `e.PERMISSION_DENIED === 1`.
  - `ohne timeout schickt der Polyfill null` (`Infinity` und fehlend).
  - `maximumAge liefert die letzte Position sofort ohne neue Nachricht` (zweiter Aufruf mit
    `maximumAge: 60000`, `Date.now` per `vi.setSystemTime`).
  - `watchPosition liefert fortlaufend und clearWatch schickt location_clear nur für diese Beobachtung`
    (zwei Beobachtungen, eine beendet, `__LIFELINE_LOCATION__` für die andere wirkt weiter).
  - `eine Position für eine beendete Beobachtung verwirft der Polyfill`.
  - `ohne Message-Handler bleibt navigator.geolocation unangetastet`.
  - `iosUnterframe.test.ts`: `im Unterframe meldet jede Abfrage Code 1` und `im Hauptframe tut das Skript nichts`
    (Skript per `new Function('window','navigator', skript)` mit Fenster-Attrappe `{top: other}`).
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/huelle/iosHuelle.test.ts src/huelle/iosUnterframe.test.ts` → FAIL.
- [x] **Step 3:** Polyfill: `Object.defineProperty(navigator, 'geolocation', { configurable: true, value: Object.freeze({...}) })`.
  Fehlerobjekt mit `code`, `message`, Konstanten `PERMISSION_DENIED=1`, `POSITION_UNAVAILABLE=2`,
  `TIMEOUT=3`; Position als `{ coords: {...}, timestamp }` (Getter-frei, eingefroren). Kennungen
  für `watchPosition` eigene Zahlen (Map Kennung → id der Brücke). `__LIFELINE_LOCATION__` wie
  `__LIFELINE_REPLY__` per `defineProperty` (nicht schreibbar). Unterframe-Skript: steigt aus,
  wenn `window.top === window`, sonst Attrappe mit Code 1 für alle drei Methoden
  (`clearWatch` tut nichts).
- [x] **Step 4:** Tests grün.
- [x] **Step 5:** Commit `feat(ios): Init-Skript liefert den Standort über die Brücke (LLH-2071)`.

### Task 4: iOS-Kern: Befehle, Antwortwert, Ausführung, Beobachtung

**Files:**
- Modify: `ios/LifelineKern/Sources/LifelineKern/Brueckenbefehl.swift`
- Create: `ios/LifelineKern/Sources/LifelineKern/Standort.swift`
- Test: `ios/LifelineKern/Tests/LifelineKernTests/BrueckenbefehlTests.swift`, neu `StandortTests.swift`

**Interfaces:**
- Produces:
  - `Brueckenbefehl.locationCurrent(id: Int, highAccuracy: Bool, timeout: Duration?)`,
    `.locationWatch(id: Int, highAccuracy: Bool, timeout: Duration?)`, `.locationClear(watch: Int)`
  - `public struct Standortposition: Equatable, Sendable { latitude, longitude, accuracy: Double; altitude, altitudeAccuracy, heading, speed: Double?; timestamp: Double /* ms */ }`
  - `Antwortwert.position(Standortposition)`
  - `public enum Standortfehler: String, Error { case denied, unavailable, timeout }`
  - `public enum Standortfreigabe { case offen, erlaubt, verweigert, aus /* Ortungsdienst des Geräts aus */ }`
  - `Huellendienste` + `loadStandortfreigabe() async -> Standortfreigabe`,
    `requestStandortfreigabe() async -> Bool`,
    `currentPosition(highAccuracy: Bool, timeout: Duration?) async throws -> Standortposition`
  - `Brueckenausfuehrung.isStandortErlaubt(_ dienste:) async throws` (wirft `denied`/`unavailable`)
  - `Bruecke.locationScript(id: Int, fehler: Standortfehler?, position: Standortposition?) -> String`
  - `public struct Standortbeobachtung` mit `mutating start(id:highAccuracy:timeout:server:jetzt:) -> Standortwirkung`,
    `mutating clear(watch:) -> Standortwirkung`, `mutating reset() -> Standortwirkung`,
    `mutating zustellen(aktiverServer: ServerAdresse?, seite: URL?, jetzt: Double) -> (ids: [Int], wirkung: Standortwirkung)`,
    `mutating abgelaufen(jetzt: Double) -> [Int]`, `var isLeer: Bool`;
    `public enum Standortwirkung: Equatable { case keine, starte(highAccuracy: Bool), stoppe }`

- [x] **Step 1: Failing tests**:
  - Parse: `location_current` mit `high_accuracy: true, timeout: 15000` → `.locationCurrent(id: 3, highAccuracy: true, timeout: .milliseconds(15000))`;
    fehlendes `high_accuracy` → `false`; `timeout: null` → `nil`; negatives/Text-`timeout` → `.ungueltig`;
    `location_clear` ohne `watch` → `nil` (keine id, keine Antwort); `location_watch` braucht `id`.
  - `locationScript` → exakt `window.__LIFELINE_LOCATION__?.(7, null, {"accuracy":12,"altitude":null,…,"timestamp":1700000000000});`
    (Schlüssel sortiert) bzw. `…(7, "denied", null);`; `replyScript` mit `.position` gleiches Objekt.
  - Ausführung mit Attrappe: `offen` → fragt einmal, dann Position; `verweigert` → `denied`, nie
    `currentPosition`; `aus` → `unavailable`; **Reihenfolge:** `currentPosition` wird erst nach
    `requestStandortfreigabe` aufgerufen (Protokoll der Attrappe), `timeout` unverändert durchgereicht.
  - `Standortbeobachtung`: erste Beobachtung → `.starte(false)`; zweite mit `highAccuracy` →
    `.starte(true)`; `clear` der letzten → `.stoppe`; `zustellen` mit gleichem Server und Seite
    des Servers → ids; mit anderem Server oder Seite einer fremden Origin → `([], .stoppe)` und
    danach `isLeer`; `reset` → `.stoppe`; `abgelaufen` meldet eine id genau einmal je Warten
    (nach `zustellen` beginnt das Warten neu), ohne `timeout` nie.
- [x] **Step 2:** `cd ios/LifelineKern && swift test` → FAIL (lokal nur mit Swift-Toolchain; sonst CI `ios-pruefung.yml`).
- [x] **Step 3:** Umsetzen. `ganzzahl`-Helfer für `timeout` (≥ 0). `Brueckenausfuehrung.run`:
  `.locationCurrent` → `antwort(id) { try await isStandortErlaubt(dienste); return .position(try await dienste.currentPosition(...)) }`
  mit `Standortfehler.rawValue` als Ablehnungstext; `.locationWatch`/`.locationClear` → `nil`
  (die App verwaltet sie über `Standortbeobachtung`, Task 5). `Linkregeln.belongsToServer` für
  die Seite in `zustellen`.
- [x] **Step 4:** Tests grün (lokal, falls Swift; sonst CI).
- [x] **Step 5:** Commit `feat(ios): Kern für Standortbefehle und Beobachtung (LLH-2071)`.

### Task 5: iOS-App: CoreLocation, Empfang, Plist, Manifest, Unterframe-Skript

**Files:**
- Create: `ios/App/Standortdienst.swift` (`CLLocationManager`-Hülle)
- Modify: `ios/App/Systemdienste.swift` (Protokollmethoden aus Task 4)
- Modify: `ios/App/Webview.swift` (`Brueckenempfang`: watch/clear an Beobachtung; `Webviewfabrik.make`:
  zweites `WKUserScript` `unterframe-standort.js`, `forMainFrameOnly: false`;
  `Navigationsbegleiter.didCommit`/`ProcessDidTerminate` → `reset`)
- Modify: `ios/App/AppModell.swift` (`closeWebView` → `reset`)
- Modify: `ios/project.yml` (Plist-Text; Ressource `App/Huelle/unterframe-standort.js`)
- Modify: `ios/App/PrivacyInfo.xcprivacy`

**Interfaces:**
- Consumes: alles aus Task 4; Wire aus Task 3.

- [x] **Step 1:** `Standortdienst` (`@MainActor final class`, `CLLocationManagerDelegate`):
  `freigabe`, `requestFreigabe() async -> Bool` (erst beim ersten Befehl), `einmal(highAccuracy:timeout:)`
  per `requestLocation` mit Frist ab Aufruf (Freigabe ist dann schon erteilt), `starte(highAccuracy:)`/`stoppe()`
  für `startUpdatingLocation`; Genauigkeit `kCLLocationAccuracyBest` bzw. `kCLLocationAccuracyHundredMeters`;
  Positionen an einen Rückruf. Fehler: `kCLErrorDenied` → `denied`, sonst `unavailable`.
- [x] **Step 2:** `Brueckenempfang`: bei `.locationWatch` erst `isStandortErlaubt` (Fehler als
  `locationScript(id, fehler, nil)`), dann `beobachtung.start(...)` und Wirkung ausführen; bei
  jeder Position `zustellen` und für jede id `locationScript`; Timer (1 s) nur bei nicht leerer
  Beobachtung für `abgelaufen` → `timeout`; `.locationClear` → `clear`.
- [x] **Step 3:** Plist, Ressource, Privacy-Manifest, Unterframe-`WKUserScript`.
- [x] **Step 4:** CI `ios-pruefung.yml` grün (Bauen, `AppTests`; kein neuer Bildschirm → keine neuen Bilder).
- [x] **Step 5:** Commit `feat(ios): App liefert den Standort über CoreLocation (LLH-2071)`.

### Task 6: Frontend-Hinweistext

**Files:**
- Modify: `frontend/src/huelle/faehigkeiten.ts` (+ `huelleIstApp(): boolean`)
- Modify: `frontend/src/pages/lagekarte/useEigenposition.ts` (`MELDUNG_VERWEIGERT` → `meldungVerweigert(): string`)
- Modify: `frontend/src/geraet/StandortFeld.tsx`
- Test: `frontend/src/huelle/faehigkeiten.test.ts`, `frontend/src/pages/lagekarte/useEigenposition.test.ts`,
  `frontend/src/geraet/StandortFeld.test.tsx`

**Interfaces:**
- Produces: `huelleIstApp()` — `true` für `platform` `'ios'`/`'android'`; `meldungVerweigert()`.

- [x] **Step 1: Failing tests:** `huelleIstApp` false ohne Kennung und für `'macos'`/`'windows'`, true
  für iOS/Android (über `starteIosHuelle`/`starteAndroidHuelle`); `meldungVerweigert()` im Browser =
  heutiger Text, in der App = App-Text (Global Constraints); `StandortFeld` zeigt bei Code 1 in der
  Android-Hülle den App-Text.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/huelle src/pages/lagekarte src/geraet` → FAIL.
- [x] **Step 3:** Umsetzen; alle Verwendungen von `MELDUNG_VERWEIGERT` umstellen (`grep -rn MELDUNG_VERWEIGERT frontend/src`).
- [x] **Step 4:** Tests grün, dazu `mise exec -- pnpm -C frontend exec tsc -b --noEmit` bzw. das Lint des Gates.
- [x] **Step 5:** Commit `feat(frontend): Hinweis bei verweigertem Standort nennt in der App die Einstellungen (LLH-2071)`.

### Task 7: Regeln, ADR, Betriebs- und Anwenderdoku

**Files:**
- Modify: `ios/AGENTS.md`, `android/AGENTS.md`
- Create: `docs/architektur/entscheidungen/ADR-0093-die-app-huellen-geben-den-standort-nur-dem-aktiven-server-im-vordergrund.md` (nach `VORLAGE.md`, < 80 Zeilen)
- Modify: `docs/betrieb/ios-app.md`, `docs/betrieb/android-app.md` (Absatz Standort + Prüfliste,
  iOS: App-Store-Angabe „Precise Location“)
- Modify: `docs/anwender/kapitel/lagekarte.md` nur, wenn es die Browser-Freigabe nennt

- [x] **Step 1:** Texte schreiben; `scripts/adr-fuer.sh ios/App/Webview.swift` zeigt die neue ADR.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Doku-/ADR-Wächter, Prettier, Vitest, Kern-Tests soweit Toolchain da).
- [x] **Step 3:** Commit `docs: Standort in den App-Hüllen – Regeln, ADR, Betrieb (LLH-2071)`.
