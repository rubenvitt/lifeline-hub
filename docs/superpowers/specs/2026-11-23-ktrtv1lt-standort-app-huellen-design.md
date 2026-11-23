# Standort in den App-Hüllen (iOS, Android) — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/ktrtv1lt7wantd31ono0ztqd (LLH-2071) · Stand 23.11.2026

## Warum

Die Oberfläche fragt den Standort an drei Stellen ab. Die Hüllen geben ihn heute nicht weiter,
im Browser dagegen geht es:

| Stelle | Aufruf | Wohin der Standort geht |
| --- | --- | --- |
| Lagekarte, „Position“ (`pages/lagekarte/useEigenposition.ts`) | `watchPosition` | nirgends, er bleibt auf dem Gerät |
| Ortsfeld, „Eigene Position“ (`anzeige/Ortsfeld.tsx`) | `getCurrentPosition` | ins Feld, gespeichert erst mit dem Formular |
| Gerät, „Mein Standort“ (`geraet/StandortFeld.tsx`) | `getCurrentPosition` | in die Meldung, gesendet erst mit ihr |

In den Apps läuft das heute ins Leere. Android kennt weder das Recht noch
`onGeolocationPermissionsShowPrompt`. iOS hat keinen `NSLocationWhenInUseUsageDescription`.
Wer mit dem Handy draußen steht, hat damit gerade dort keine Eigenposition, wo sie am meisten
nützt.

**Entscheidung des Menschen (23.11.2026):** Beide Apps bieten den Standort an. Die iOS-App
liefert ihn über die Brücke, und der Hinweis bei verweigertem Zugriff verweist in der App auf die
Einstellungen der App.

## Ziele

- In der iOS- und der Android-App liefern die drei Stellen den Standort wie im Browser.
- Den Standort bekommt nur die Seite des **aktiven Servers** im **Hauptframe**. Es gilt dieselbe
  Regel wie für Brücke und Kamera (`Bruecke.accepts`).
- Gefragt wird **nur im Vordergrund** („When in Use“ bzw. ohne `ACCESS_BACKGROUND_LOCATION`), und
  zwar erst, wenn die Seite den Standort wirklich abfragt, nie beim Start.
- Ob eine Anfrage durchgeht, entscheidet der Kern, und ein Test hält das fest
  (`ios/AGENTS.md`, `android/AGENTS.md`: „Logik im Kern“).
- Verweigert die Person den Zugriff, nennt der Hinweis in der App den richtigen Weg.

## Nicht-Ziele

- Keine Ortung im Hintergrund, kein eigenes Senden des Standorts durch die Hülle, keine Ablage
  in der Hülle.
- Keine Änderung daran, wohin die Oberfläche den Standort gibt (Tabelle oben).
- Die Desktop-Hüllen (`src-tauri/`) bleiben, wie sie sind.

## Anti-Ziele

Wäre eines davon so, wäre die Änderung misslungen, auch wenn sie technisch läuft:

- Eine fremde Origin (Identitätsanbieter, verlinkte Seite, iframe) bekommt den Standort.
- Die App fragt beim Start, ohne Anlass, oder bei jedem Seitenladen erneut.
- Nach einem Serverwechsel liefert eine laufende Beobachtung weiter Positionen an die alte Seite.

## Ansätze

**Grundsatz.** Zur Wahl standen anbieten und bewusst sperren. Gewählt ist anbieten: Der Nutzen im
Einsatz ist hoch, und der Datenschutz ist gewahrt. Der Standort bleibt im Vordergrund, gilt nur
für den eigenen Server und ist für die Eigenposition gar nicht gespeichert. „Sperren“ hätte die
App gegenüber dem Browser schlechter gestellt.

**iOS, gewählt: Brücke.** Das Init-Skript `huelle.js` stellt `navigator.geolocation` selbst
bereit, die Hülle holt die Position über `CLLocationManager`. Das verlangt eine Systemfrage und
ist an den aktiven Server gebunden, weil es dieselbe Brücke ist. Den Preis zahlen ein neuer
Rückkanal für fortlaufende Positionen und mehr Code.

**iOS, verworfen: WebKit-eigen.** Dafür hätte nur der Plist-Text nötig sein müssen. WKWebView
fragt dann aber zusätzlich je Origin und App-Lauf mit einem eigenen Dialog. Es gibt keine
öffentliche `WKUIDelegate`-Methode, die das abnimmt oder auf eine Origin beschränkt. Das verletzt
zwei der Anti-Ziele.

**Android, der einzige Weg:** Er folgt dem Muster der Kamera. Der WebView liefert
`navigator.geolocation` selbst, und die App entscheidet in
`WebChromeClient.onGeolocationPermissionsShowPrompt`. Ein Polyfill wie unter iOS brächte keinen
Gewinn, denn Android hat den Haken, der unter iOS fehlt.

## Entwurf

### Gemeinsame Regel (beide Kerne)

`Seitenzugriff.standort(origin, aktiverServer) -> Bool` in `android/kern` bzw. eine gleichnamige
Entscheidung im iOS-Kern. Ergebnis: `true` genau dann, wenn
`Bruecke.accepts(isMainFrame = true, origin, aktiverServer)` gilt. Unter iOS prüft der
Brückenempfang Hauptframe und Origin schon heute für **jede** Nachricht, also auch für die neuen
Befehle. Die neue Kern-Entscheidung betrifft dort vor allem die laufende Beobachtung, siehe unten.

### Android

- **Manifest:** `ACCESS_FINE_LOCATION` und `ACCESS_COARSE_LOCATION` (ab Android 12 gehören beide
  zusammen, die Person darf „ungefähr“ wählen), kein `ACCESS_BACKGROUND_LOCATION`, dazu
  `uses-feature android.hardware.location` mit `required="false"`.
- **`Webzugriffe.standort(fertig: (Boolean) -> Unit)`**, nach dem Vorbild von `kamera`: Die App
  prüft das Recht und fragt sonst. „Erlaubt“ heißt dabei: fein **oder** grob.
  `dienste/Activityzugriffe.kt` setzt das um.
- **`HuellenChromeClient.onGeolocationPermissionsShowPrompt(origin, callback)`:**
  `Seitenzugriff.standort(SeitenOrigin.parse(origin), aktiverServer())` ist falsch → sofort
  `callback.invoke(origin, false, false)`. Ist es wahr, folgt `zugriffe.standort { erlaubt -> … }`.
  Danach wird **erneut** geprüft, weil der Server inzwischen gewechselt sein kann, und dann
  `callback.invoke(origin, erlaubt && freigabe, false)`. `retain` ist immer `false`: Der WebView
  merkt sich nichts, und das Recht der App steht nicht doppelt.
- **`onGeolocationPermissionsHidePrompt`:** nichts nötig, die App zeigt keinen eigenen Dialog.
- **`WebviewFabrik`:** `settings.setGeolocationEnabled(true)` ausdrücklich setzen.
  `GeolocationPermissions` je Profil bleiben leer, denn `retain` ist `false`.
- **Tests:** `SeitenzugriffTest` (Kern) für aktiven Server, fremde Origin, `http`, anderen Port,
  `null`, ohne aktiven Server. `SeitenzugriffeTest` (App, Robolectric) für den Rückruf mit einer
  Attrappe von `Webzugriffe`: verweigert, erlaubt, Server dazwischen gewechselt.

### iOS

**Plist** (`ios/project.yml`):
`NSLocationWhenInUseUsageDescription: "Lifeline zeigt deinen Standort auf der Lagekarte und
übernimmt ihn auf Wunsch in Ortsfelder. Er bleibt auf dem Gerät, bis du ihn selbst speicherst."`
Kein `Always`, kein `UIBackgroundModes location`. Das Privacy-Manifest bleibt unverändert, weil
der Standort nicht gesammelt wird.

**Wire-Format** (Kopf von `huelle.js`, englisch und danach fest):

- `location_current` `{ id, high_accuracy }` liefert genau eine Antwort. Erfüllt mit
  `{ latitude, longitude, accuracy, altitude, altitude_accuracy, heading, speed, timestamp }`
  (Zahlen; `null`, wo das Gerät nichts weiß; `timestamp` in ms seit 1970). Abgelehnt mit
  `denied` | `unavailable`.
- `location_watch` `{ id, high_accuracy }` startet eine Beobachtung mit dem Schlüssel `id`. Es
  gibt keine Antwort über `__LIFELINE_REPLY__`. Positionen und Fehler kommen fortlaufend über
  `window.__LIFELINE_LOCATION__(id, fehler, position)` (`fehler` `null` oder `denied` |
  `unavailable`, `position` wie oben). Nach `denied` endet die Beobachtung in der Hülle.
- `location_clear` `{ watch }` beendet die Beobachtung `watch`, ohne Antwort.

**Polyfill in `huelle.js`:** Er ersetzt `navigator.geolocation` per `Object.defineProperty` auf
`navigator` durch ein Objekt mit `getCurrentPosition`, `watchPosition` und `clearWatch` nach der
Web-API:

- Rückgabewerte haben die Form von `GeolocationPosition` und `GeolocationPositionError` (`code`
  1/2/3 samt Konstanten `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`, dazu `message`).
  `denied` wird 1, `unavailable` wird 2.
- `options.timeout` setzt der Polyfill selbst mit `setTimeout` um (Code 3). Eine Antwort, die
  danach kommt, verwirft er.
- `options.maximumAge`: Ist die letzte Position dieses Seitenlaufs jung genug, kommt sie sofort.
- `options.enableHighAccuracy` wird zu `high_accuracy`.
- `watchPosition` gibt eine eigene Zahl zurück, und `clearWatch` schickt `location_clear`.
  Unbekannte Kennungen tun nichts.
- Ohne Message-Handler (Browser) bleibt `navigator.geolocation` unangetastet, wie heute schon
  für das ganze Skript.

**Kern (`ios/LifelineKern`):**

- `Brueckenbefehl` bekommt `.locationCurrent(id:highAccuracy:)`, `.locationWatch(id:highAccuracy:)`
  und `.locationClear(watch:)`. `Bruecke.parse` prüft die Felder, ein fehlendes
  `high_accuracy` gilt als `false`.
- `Antwortwert` bekommt einen Fall für Positionen (Zahlen und `null`). Das heutige
  `objekt([String: String])` reicht dafür nicht.
- `Bruecke.locationScript(id:fehler:position:)` erzeugt den Aufruf
  `window.__LIFELINE_LOCATION__?.(…)`, analog zu `replyScript`.
- Ein Protokoll `Standortdienst` in `Huellendienste`, in der App umgesetzt mit
  `CLLocationManager`: Freigabe lesen und erfragen sowie Position einmal und fortlaufend.
  `Brueckenausfuehrung` entscheidet: Ist die Freigabe `offen`, wird erst gefragt; `verweigert`
  wird `denied`; ohne Ortungsdienst des Geräts heißt es `unavailable`.
- **`Standortbeobachtung`** im Kern verwaltet die laufenden Beobachtungen je WebView und den
  Server, für den sie gestartet wurden. Sie entscheidet, ob eine Position noch an die Seite darf
  (`Seitenzugriff.standort` mit dem **jetzt** aktiven Server und der **jetzigen** Seite, wie
  `Linkregeln.belongsToServer` beim Antworten). Bei `seiteGeladen` (neue Navigation), Wechsel des
  aktiven Servers, Ende des Web-Prozesses oder `location_clear` beendet sie alles für diesen
  WebView. Ohne Beobachtung läuft `CLLocationManager` nicht.

**App (`ios/App`):**

- `Systemdienste` setzt `Standortdienst` um: ein `CLLocationManager`, `requestWhenInUseAuthorization`
  erst beim ersten Befehl, `requestLocation` für `current`, `startUpdatingLocation` für `watch`.
  Die Genauigkeit richtet sich nach `high_accuracy`: `kCLLocationAccuracyBest` oder
  `kCLLocationAccuracyHundredMeters`. Gibt es mehrere Beobachtungen, gilt die genaueste.
- `Brueckenempfang` leitet `watch`/`clear` an die `Standortbeobachtung` und schickt Positionen
  per `evaluateJavaScript(Bruecke.locationScript…)`. Dort gilt dieselbe Schranke wie bei Antworten.
- Den Hintergrund behandelt die App nicht eigens. Ohne Hintergrund-Modus liefert iOS dort keine
  Positionen, und danach geht es weiter.

**Tests:** `BrueckenbefehlTests` (Parse, Skripte), neue Tests für `Standortbeobachtung` (Wechsel,
Navigation, Ende, `clear`) und für `Brueckenausfuehrung` mit einer Attrappe des Dienstes. Das
Init-Skript prüft Vitest (`frontend/src/test/huelle.ts` und ein neuer Testfall):
`getCurrentPosition` erfüllt und abgelehnt, Timeout, `maximumAge`, `watchPosition`/`clearWatch`,
Browser ohne Handler unverändert. App-Code prüft `ios-pruefung.yml` (Simulator). Ein UI-Test
mit echtem Standort ist dort nicht nötig, siehe „Dem Bauenden überlassen“.

### Frontend

- `huelle/faehigkeiten.ts`: `huelleIstApp(): boolean` gibt `true` für `platform` `'ios'` oder
  `'android'` zurück. Die Kennung wird weiterhin nur dort gelesen.
- `useEigenposition.ts`: `MELDUNG_VERWEIGERT` wird `meldungVerweigert()`. In der App lautet sie
  „Standortzugriff verweigert – in den Einstellungen des Geräts für Lifeline freigeben, dann
  erneut einschalten.“, im Browser bleibt der heutige Text. `StandortFeld` zieht mit.
  `Ortsfeld` hat den neutralen Text „Standortzugriff verweigert“ und bleibt so.
- `huelle.js` ändert sich nicht. Der Polyfill liegt allein im iOS-Skript.

### Doku und Regeln

- `ios/AGENTS.md` und `android/AGENTS.md` bekommen je einen Spiegelstrich: Standort nur für
  den aktiven Server und nur im Vordergrund, wobei die Entscheidung im Kern liegt. Unter iOS
  kommen die Befehle der Brücke dazu, unter Android der Satz zur Kamera wird um den Standort
  erweitert.
- `docs/betrieb/ios-app.md` und `docs/betrieb/android-app.md` bekommen einen Absatz Standort:
  wann gefragt wird, wohin der Standort geht (Tabelle oben) und wie man ihn wieder entzieht. Dazu
  kommt die Prüfliste.
- **ADR-0093** (Nummer vorläufig, der Wächter vergibt): „Die App-Hüllen geben den Standort nur
  der Seite des aktiven Servers und nur im Vordergrund“. Sie hält die Abwägung zwischen anbieten
  und sperren sowie zwischen Brücke und WebKit-eigen fest.
- Anwenderdoku `lagekarte.md`: Prüfen, ob dort steht, wie man den Standort im Browser freigibt.
  Wenn ja, einen Satz für die App ergänzen.

## Dem Bauenden überlassen

- Namen innerhalb der Kerne, solange sie `AGENTS.md` (Bezeichner-Sprache) folgen.
- Ob `Standortdienst` ein eigenes Protokoll oder Teil von `Huellendienste` ist.
- Wie `requestLocation` und laufende Updates sich einen Manager teilen.
- Ob es einen Simulator-Test mit simulierter Position gibt. Pflicht ist nur der grüne Lauf von
  `ios-pruefung.yml` und `android-pruefung.yml`. Bilder der Änderung: Da keine native Seite neu
  ist, zeigen die Bilder die Lagekarte mit Eigenposition, aufgenommen im Browser-Bildlauf. Dazu
  kommt der neue Hinweistext für die App.
