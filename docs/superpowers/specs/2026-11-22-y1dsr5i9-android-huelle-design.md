# Android-App als native Hülle um die Weboberfläche des Servers (LLH-1989)

Zunder: https://zunder.rubeen.dev/#/aufgabe/y1dsr5i98hhgl5s3tvlwedmz

Abgestimmt mit Ruben am 22.11.2026. Markiert ist, was Ruben entschieden hat **(R)** und was ein
Vorschlag des Entwurfs ist **(V)**, den die Freigabe mit abdeckt. Vorbild in allem ist die
iOS-Hülle (LLH-1978): Design `openspec/changes/archive/2026-11-19-t39ltxxi-ios-huelle/design.md`
(im Folgenden „iOS-Design“, Abschnitte D1–D10), Spec `openspec/specs/ios-huelle/spec.md`,
ADR-0068, `ios/AGENTS.md`.

## Absicht

Nach der iOS-App soll es eine Android-App geben, die **genauso funktioniert wie die iOS-App**
(R): ein nativer Rahmen, der die Weboberfläche des jeweils gewählten Servers lädt, mehrere
Server verwaltet, nur verträgliche Server lädt und native Wege (Anmeldung, Haptik, Meldung,
Downloads, Druck) über eine auf den Server begrenzte Brücke anbietet, ohne eigene Fachlogik.

Die Organisation hat **viele Samsung Galaxy Tabs** (Modell unbekannt, „nicht uralt“), auf denen
die App laufen muss, dazu Android-Handys von Helfern (R). Die Tablets laufen oft als
gekoppeltes Gerät (UHS-Tablet), die Kopplung läuft in der Weboberfläche. Es gibt **kein MDM**
(R).

## Ziele

- Verhalten wie die iOS-App: jede Anforderung der Spec `ios-huelle` gilt sinngemäß, mit den
  Abweichungen, die dieses Dokument nennt (R).
- Läuft auf Handys und Tablets, im Hoch- und Querformat (R).
- Auslieferung **nur als APK** über die GitHub-Releases, **nicht** über Google Play (R).
- Updates **so automatisch wie möglich** ohne MDM (R): eingebauter Updater, der nie mitten in
  der Arbeit installiert (Form V, D9).
- Start ohne Server mit dem letzten Stand des Servers über den Service Worker (V, D5): auf
  Android geht das ohne eigenen Mechanismus, also gleich mit.
- Prüfung auf Linux ohne Emulator; diese Cloud-Umgebung kann die App bauen und testen (V).

## Nicht-Ziele

- Alarm bei geschlossener App (Push im Hintergrund), wie auf iOS (R: „genauso wie iOS“). Weder
  Web Push (im Android-WebView nicht vorhanden) noch FCM (bräuchte das Firebase-Geheimnis der
  App auf jedem selbst betriebenen Server oder ein eigenes Relay).
- Google Play, auch nicht als interner Test (R).
- Passkeys im WebView (wie iOS: Anmeldung im Browser).
- Kiosk-Betrieb, Bildschirm-an-Halten oder andere Sonderwege für gekoppelte Tablets (V): nicht
  verlangt, die Oberfläche regelt die Kopplung.
- Änderungen am Server. Die Server-Seite (`/api/shell`, App-Code-Anmeldung, Bestätigungsseite
  „Lifeline-App“) ist plattformneutral und bleibt unverändert.
- Ein Kanalwechsel in der App (Alpha ↔ Beta ↔ Stabil).

## Anti-Ziele

- Stilles Umlenken auf einen anderen Server; vermischte Sitzungen oder Offline-Daten zweier
  Server — auch nicht als Rückfall, wenn der WebView getrennte Speicher nicht kann.
- Ein Update, das die App mitten in der Arbeit beendet.
- Android-Sonderwege im Frontend, die nicht über die Kennung laufen.
- Fachlogik oder nachgebaute Bildschirme in Kotlin.

## Rahmenbedingungen

- Plattformfakten Android (gegenüber dem iOS-Design geändert):
  1. **Service Worker laufen im Android-WebView** (auch je Profil, `Profile.getServiceWorkerController`).
     Precache und Offline-Logik des Frontends tragen also, wenn die Seite unter ihrer Origin
     geladen wird.
  2. **Push API und Notification API gibt es im WebView nicht.** Das Frontend bietet Web Push in
     jeder Hülle ohnehin nicht an (`inHuelle()`, Spec `web-push`).
  3. **Getrennte Datenspeicher** gibt es über die Multi-Profile-API von `androidx.webkit`
     (`ProfileStore`, `WebViewCompat.setProfile`, Feature `MULTI_PROFILE`). Das Profil muss vor
     der ersten Nutzung des WebViews gesetzt werden; `ProfileStore.deleteProfile` scheitert,
     solange ein WebView es benutzt. Die Fähigkeit hängt an der Version des System-WebViews
     (über Google Play aktualisiert), nicht an der Android-Version.
  4. **Brücke:** `WebViewCompat.addWebMessageListener` mit Origin-Regeln (meldet `isMainFrame`
     und Origin je Nachricht, antwortet über `JavaScriptReplyProxy`) und
     `WebViewCompat.addDocumentStartJavaScript` mit denselben Origin-Regeln. Beides per
     `WebViewFeature` prüfen.
  5. **Nutzer-CAs** gelten für Apps ab Android 7 nur, wenn die `networkSecurityConfig` es
     erlaubt; der WebView folgt dieser Konfiguration.
  6. **Selbst-Update ohne Rückfrage:** Ab Android 12 (API 31) darf eine App per
     `PackageInstaller` mit `setRequireUserAction(USER_ACTION_NOT_REQUIRED)` ohne Rückfrage
     installieren, wenn sie `REQUEST_INSTALL_PACKAGES` hat, die Person ihr „Unbekannte Apps
     installieren“ erlaubt hat und sie selbst der Installateur des zu ersetzenden Pakets ist.
     Nach der Erstinstallation aus dem Browser oder Dateimanager ist sie das erst nach dem
     ersten eigenen Update; bis dahin (und unter Android 12 immer) fragt das System.
  7. Ein Update ersetzt die App und beendet ihren Prozess.
  8. Ab `targetSdk` 35 erzwingt Android randlose Darstellung (edge-to-edge); die App muss die
     Systemränder selbst einhalten.
  9. Android hat eine System-Zurück-Geste/-Taste; iOS nicht.
  10. Eine Zahl am App-Symbol gibt es auf Android nur über Benachrichtigungen (Samsung zählt sie
      selbst); eine API wie `setBadgeCount` fehlt.
- Diese Cloud-Umgebung hat JDK 21 und Gradle 8.14; `dl.google.com` und `maven.google.com` sind
  erreichbar, das Android-SDK lässt sich laden. GitHubs `ubuntu-latest` bringt ein Android-SDK
  mit (`/usr/local/lib/android`).
- Gemeinsame Fälle `src-tauri/faelle/{adresse,deeplink,links}.json` sind die Quelle für
  Adressprüfung, Deeplink und Linkregeln (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“).
- Specs unter `openspec/specs/` werden nicht mehr fortgeschrieben (ADR-0069); neue Regeln
  stehen in `android/AGENTS.md` und einer ADR.

## Ansätze

| Ansatz | Bewertung |
| --- | --- |
| **A. Eigene Kotlin-App (Jetpack Compose + Android-WebView) — gewählt (R)** | gleicher Aufbau wie iOS (reiner Kern + dünne App), volle Kontrolle über WebView, Profile und Brücke; zweite Implementierung der Hüllenregeln, zusammengehalten von den gemeinsamen Fällen |
| B. Tauri 2 um ein Android-Ziel erweitern | ein Crate mit der Desktop-Hülle, aber Profile je Server und die Feinsteuerung des WebViews gingen nur über Umwege; aus demselben Grund für iOS verworfen (ADR-0068) |
| C. Trusted Web Activity (Chrome) | brächte Web Push und Passkeys, aber keine Brücke (keine Kennung, keine Haptik, keine nativen Status-Seiten, keine Vertragsprüfung vor dem Laden) — nicht „wie iOS“, verworfen |
| D. Capacitor | in der Roadmap ausgeschlossen |

Ruben wollte das Verhalten der iOS-App; damit blieb A als einziger Weg, der Brücke, Profile je
Server und native Seiten trägt.

## Entscheidungen

### D1 Ort, Aufbau, Kennung (V)

- Code unter **`android/`**, ein Gradle-Projekt mit Wrapper (Gradle-Version im Wrapper,
  Bibliotheksversionen in `android/gradle/libs.versions.toml`).
- **`android/kern`**: reines Kotlin/JVM ohne Android-Abhängigkeit, Gegenstück zu
  `ios/LifelineKern` (Adresse, Deeplink, Linkregeln, Serverliste, Vertrag, Ablauf/Onboarding,
  Brückenausführung, Statustexte, Testzustand, Update-Entscheidung). Seine Tests MUST ohne
  Android-SDK laufen (nur JDK); der Builder richtet den Build so ein, dass das Konfigurieren des
  Kerns kein SDK verlangt (etwa als eigenständiger Build, den die App einbindet).
- **`android/app`**: dünne App-Schicht (Compose-Seiten, WebView, Brücke, Systemdienste,
  Updater-Ausführung). Neue Entscheidungen kommen mit Test in den Kern, nicht in eine Ansicht
  (wie `ios/AGENTS.md`, „Seite und Wirkung aus dem Kern“).
- **Paketname `dev.rubeen.lifeline.android`** (V, Symmetrie zu `dev.rubeen.lifeline.ios`). Er
  ist nach der ersten Auslieferung für immer fest.
- **`minSdk` 29 (Android 10)** (V): deckt „nicht uralt“ ab und passt zu
  `docs/betrieb/endgeraete.md` („Android ab 10“). `targetSdk` und `compileSdk` auf dem aktuellen
  stabilen API-Level (Builder).
- Handys und Tablets, beide Ausrichtungen, keine feste Orientierung. Native Seiten auf Tablets
  mit begrenzter Inhaltsbreite statt über die volle Breite gezogen.
- Neue Bereichsdatei `android/AGENTS.md` mit den Regeln aus „Regeln und Doku“ (D11) und neue
  ADR (nächste freie Nummer, vor dem Commit gegen offene PRs prüfen): „Die Android-Hülle ist eine
  eigene Kotlin-App ohne Anwendungslogik, die die Serveroberfläche lädt, und wird nur als
  signierte APK verteilt, die sich selbst aktualisiert“.

### D2 Onboarding, Serverliste, Deeplink (R: wie iOS)

Wie iOS-Design D2: ohne Server nur Onboarding (Adresse eingeben, QR-Code scannen, per Deeplink
vorbelegt), Adressprüfung nach den gemeinsamen Fällen mit denselben Meldungstexten, nur nach
verträglichem `/api/shell` speichern. Serverliste mit Name (Vorgabe Hostname, änderbar),
Adresse, zuletzt verbunden, Zustand; wechseln, umbenennen, hinzufügen, entfernen; der aktive
Server erst nach einem Wechsel entfernbar, Hinweis auf verlorene, nicht übertragene Einträge.
Zugang über einen kleinen nativen Knopf am Rand, der die Oberfläche nicht verdeckt.
Deeplink `lifeline://verbinden?server=…` per Intent-Filter, Verhalten nach den gemeinsamen
Fällen.

QR-Code: Kamera mit einem eingebauten Barcode-Leser, der ohne unsere App im Play Store
funktioniert (Bibliothek: Builder; die Kameraberechtigung wird erst beim Scannen erfragt).

### D2a Zertifikate (V)

Die App vertraut **System-CAs und vom Nutzer installierten CAs** (`networkSecurityConfig` mit
`<certificates src="system"/>` und `src="user"`), ohne eigene Ausnahmen und ohne Pinning. Das
entspricht dem iOS-Verhalten, wo ein installiertes, eingeschaltetes CA-Profil genügt; ohne
diese Erlaubnis liefe ein mkcert-Server im Einsatz-LAN auf Android nicht. Bei einem
Zertifikatsfehler (Vertragsabruf oder `onReceivedSslError` des WebViews → immer abbrechen) zeigt
die App die native Seite „Zertifikat nicht vertrauenswürdig“ mit Android-Anleitung
(Einstellungen → Sicherheit → Weitere Sicherheitseinstellungen → Zertifikat installieren →
CA-Zertifikat; Menüpfad je Hersteller leicht verschieden), getrennt von „nicht erreichbar“.

### D3 Ein Profil je Server (V)

- Jeder Servereintrag trägt eine UUID; der WebView läuft im Profil mit diesem Namen.
- Beim Wechsel wird der WebView mit dem neuen Profil neu gebaut (das Profil lässt sich an einem
  benutzten WebView nicht tauschen).
- Entfernen: erst den WebView des Profils zerstören, dann `ProfileStore.deleteProfile`, Fehler
  melden.
- **Kann der System-WebView keine Profile (`MULTI_PROFILE` fehlt) oder fehlt eine andere
  Pflichtfähigkeit (Brücke, Start-Skript),** lädt die App keine Oberfläche und zeigt die native
  Seite „System-WebView aktualisieren“ (mit Knopf zur Play-Store-Seite von „Android System
  WebView“, falls ein Store da ist). Nie Rückfall auf ein gemeinsames Profil.

### D4 Versionen, Vertrag, Kennung (R: wie iOS; V: Form)

- Vertrag wie iOS-Design D4: `GET /api/shell` beim Start, beim Wechsel, im Onboarding und beim
  Neuladen nach Rückkehr in den Vordergrund; 404 heißt „Server ist zu alt“ (mit `version` aus
  `/api/health`); unbekannter größerer Vertrag „App aktualisieren“, kleinerer „Server ist zu
  alt“; ohne Netz gilt der zuletzt bestätigte Vertrag.
- „App aktualisieren“ bietet direkt den Updater an (D9).
- **Kennung** `window.__LIFELINE_HUELLE__` mit `platform: 'android'`, `version` (volle
  Workspace-Version), `passkey: false`, `anmeldungImBrowser`, `haptics`,
  `benachrichtigungZeigen`. **`setAppBadge` fehlt** auf Android (V, Fakt 10): ohne das Feld
  nimmt das Frontend den Weg wie bisher; die Zahl am Symbol entsteht auf Samsung aus den
  Meldungen.
- **Init-Skript** als reines JS unter `android/app/src/main/assets/huelle.js` mit demselben
  Wire-Format wie `ios/App/Huelle/huelle.js` (Befehle `sign_in_with_browser`,
  `show_notification` `{ title, body }`, `print`, `haptics` `{ kind }`, Antworten mit `id`),
  aber eigenem Transport (`addWebMessageListener`-Objekt `lifeline`, Antworten über den
  Reply-Proxy). Eigene Datei statt gemeinsamer (V): das iOS-Skript ist Grenzwert mit eigenen
  Tests, ein gemeinsames Skript koppelte beide Transporte. `frontend/src/test/huelle.ts` führt
  auch das Android-Skript per Vitest aus.
- **Frontend:** `platform: 'android'` dokumentieren (`faehigkeiten.ts`) und in der Rückmeldung
  als „Android-App“ ausweisen (`frontend/src/rueckmeldung/adresse.ts`). Sonst keine
  Frontend-Änderung.
- **Version:** `versionName` = volle Workspace-Version (Android erlaubt das Vorab-Suffix);
  `versionCode` = Minuten seit 2026-01-01 00:00 UTC zum Bauzeitpunkt der CI (steigt immer, passt
  in `Int`). Geschrieben aus `[workspace.package]` und dem Tag, keine eigene Versionsquelle in
  `android/`. Ein lokaler Bau (Entwicklung) prüft keine Updates.
- **Kanal** (`alpha`, `beta`, `stabil`) wie `src-tauri/src/kanal.rs`: beim ersten Start aus der
  eigenen Version abgeleitet (`-alpha.` → `alpha`, `-beta.` → `beta`, ohne Vorab-Suffix →
  `stabil`) und gespeichert; ein Update ändert ihn nie. Eine Alpha-App bleibt also Alpha, auch
  wenn ihr Kanal sie auf ein stabiles Release hebt. Die APK trägt keinen Kanal, je Tag gibt es
  genau einen Bau.

### D5 Start ohne Server (V)

Der Service Worker trägt (Fakt 1). Ablauf:

- Ist der Server nicht erreichbar (Netzfehler, kein Zertifikatsfehler) und wurde **dieser**
  Server in **diesem** Profil schon einmal erfolgreich geladen, lädt die App trotzdem die
  Startadresse unter seiner Origin; der Service Worker liefert die Oberfläche, die
  Offline-Logik des Frontends greift (Lagebild aus IndexedDB, Schreib-Queue).
- Scheitert dabei die Hauptnavigation (kein Precache, `onReceivedError` für den Hauptframe),
  zeigt die App „nicht erreichbar“, prüft regelmäßig und lädt von selbst, sobald der Server
  antwortet (wie iOS).
- Kommt der Server zurück, während die Oberfläche offline läuft, prüft die App den Vertrag
  erneut; neu laden muss sie nicht (das Frontend verbindet sich selbst). Ein jetzt
  unverträglicher Vertrag führt auf die Status-Seite.
- Ein nie geladener Server zeigt ohne Netz „nicht erreichbar“.

### D6 Natives Gefühl, Haptik, Meldung (R: wie iOS; V: Form)

- WebView innerhalb der Systemränder (Insets für Statusleiste, Navigationsleiste, Ausschnitt,
  Tastatur), Hintergrund Kopf-Schwarz, helle Symbole der Statusleiste; kein Nachfedern
  (`overScrollMode = NEVER`), kein Ziehen-zum-Neuladen; außerhalb von Eingaben kein Textmenü bei
  langem Drücken (eingespielter Stil wie `Huellenstil` auf iOS).
- Status-Seiten, Onboarding, Serverliste und Einstellungen sind Compose.
- **Haptik** über `View.performHapticFeedback` (respektiert die Systemeinstellung):
  `success` → `CONFIRM`, `error` → `REJECT`, `warning` → ein deutlich spürbares Muster (etwa
  `LONG_PRESS` oder ein kurzes Doppelmuster), `selection` → `CLOCK_TICK` bzw. `SEGMENT_TICK`,
  `tap` → `KEYBOARD_TAP`; unter API 30 mit den nächsten verfügbaren Konstanten. Unbekannte Art:
  nichts. Schalter „Haptik“ in den Einstellungen (Vorgabe an). Auf Tablets ohne
  Vibrationsmotor wirkungslos. Genaue Zuordnung: Builder, im Kern als Tabelle mit Test.
- **Meldung** (`benachrichtigungZeigen`): native Benachrichtigung, Berechtigung
  `POST_NOTIFICATIONS` beim ersten Aufruf (Android 13+), nur bei laufender App.
- **Zurück** (Fakt 9, V): System-Zurück geht im WebView zurück, solange er zurück kann; sonst
  schiebt es die App in den Hintergrund (beendet sie nicht und führt nicht ins Onboarding).
  Auf nativen Seiten über der Oberfläche schließt Zurück die Seite.
- Steht der WebView auf einer fremden Seite (Identitätsanbieter), bietet die App „Zur
  Oberfläche“ an, wie iOS.
- Nach `onRenderProcessGone` und bei Rückkehr in den Vordergrund mit nicht antwortender Seite
  baut die App den WebView neu und lädt neu.

### D7 Anmeldung (V)

Gegen den bestehenden Server-Weg (`POST /api/auth/app-code[/einloesen]`, Bestätigungsseite
`/app-anmeldung`). Die App öffnet die Bestätigungsseite in einem Custom Tab (Auth Tab von
`androidx.browser`, wo der Browser es kann, sonst Custom Tab), Rücksprung
`lifeline://anmeldung?code=…`. Der `verifier` bleibt in der App; ein Rücksprung zählt nur,
solange eine von der App gestartete Anmeldung offen ist, sonst bleibt er wirkungslos (PKCE
bindet den Code zusätzlich an den `verifier`). Eingelöst per `fetch` im WebView gegen denselben
Server, gemeldet per Ereignis `lifeline:app-anmeldung`. Abbruch lässt die Anmeldeseite stehen.

### D8 Links, Downloads, Drucken (R: wie iOS; V: Form)

Linkregeln nach den gemeinsamen Fällen (`links.json`, Ziel „nebenfenster“ = derselbe WebView
wie auf iOS). Downloads (`/api/` außer `/api/auth/`, auch `blob:`) mit der Sitzung des Profils
laden und über das Teilen-Blatt anbieten; `blob:` liest das Init-Skript aus und übergibt es der
Brücke (Builder). `window.print()` ersetzt das Init-Skript; die App druckt über `PrintManager`
mit dem Druckadapter des WebViews.

### D9 Auslieferung und Updater (R: nur APK, so automatisch wie möglich; V: Form)

**Bauen und Ablegen:**

- Nach der Freigabe jedes Tags der Kanäle `alpha`, `beta` und `main` baut die CI eine
  signierte Release-APK und hängt sie samt `.sha256` ans versionierte Release
  (`lifeline-hub-android-<version>.apk`). Wie `ios` in `artefakte.yml`: hängt an `freigeben`,
  steht in keinem `needs` davor; ein roter Bau hält weder Release noch Deployment auf.
- Ein Manifest `android.json` `{ version, version_code, url, sha256 }` (`url` zeigt auf die
  APK des versionierten Release) liegt:
  - für stabile Tags als Asset am Release, also unter
    `…/releases/latest/download/android.json`;
  - für Alpha und Beta im Kanal-Release `android-alpha` bzw. `android-beta` (Vorabversion, nie
    „latest“), fortgeschrieben nach denselben Regeln wie `scripts/release/desktop-kanal.mjs`
    (jeder Vorabkanal nur seine eigenen, stabile schreiben beide fort, nur vorwärts). Dort liegt
    zusätzlich die APK unter festem Namen (`lifeline-hub-android.apk`), damit ein QR-Code an
    der Wand immer zu einer Fassung dieses Kanals führt. **Diese Datei ersetzen nur Tags des
    eigenen Kanals**, ein stabiles Release schreibt nur das Manifest fort: Wer nach einem
    stabilen Release über den Alpha-Code installiert, bekommt die letzte Alpha, legt damit den
    Kanal `alpha` fest und wird danach über das Manifest auf das stabile Release gehoben.
  - Für stabile Tags liegt die APK zusätzlich unter festem Namen am Release, also unter
    `…/releases/latest/download/lifeline-hub-android.apk`.
- **Signieren:** ein Schlüssel für immer (Fakt: ein anderer Schlüssel kann die App nicht
  ersetzen). Keystore und Passwörter als GitHub-Geheimnisse; ohne Geheimnisse scheitert der
  Job sichtbar, das Release bleibt. Ruben legt den Schlüssel einmal an; die Anleitung steht in
  `docs/betrieb/android-app.md`. Den Schlüssel sichert er zusätzlich außerhalb von GitHub.

**Updater in der App:**

- Prüft beim Start und bei Rückkehr in den Vordergrund, höchstens alle 4 Stunden (Builder darf
  den Abstand begründet anders wählen), das Manifest seines Kanals; nur wenn die Version nach
  SemVer neuer ist **und** `version_code` größer als der eigene.
- Lädt die APK im Hintergrund, nur von `github.com` (und GitHubs Download-Hosts), prüft
  `sha256`; das System prüft die Signatur.
- **Installiert nie mitten in der Arbeit:** automatisch nur (a) beim Start, bevor die
  Oberfläche lädt, oder (b) wenn die App länger im Hintergrund liegt (Richtwert 15 Minuten,
  Builder; Hintergrundarbeit z. B. über WorkManager). Sonst zeigt sie einen kleinen nativen
  Hinweis „Update bereit“ (am Knopf zur Serverliste und in den Einstellungen), über den die
  Person sofort installieren kann.
- **Fall (a) sichtbar machen:** Die App kann sich nach dem Update nicht verlässlich selbst
  starten (Android sperrt Starts aus dem Hintergrund). Sie zeigt deshalb vor dem Installieren
  eine native Seite „Lifeline wird aktualisiert“; nach dem Update meldet sie sich
  (`ACTION_MY_PACKAGE_REPLACED`) mit einer Benachrichtigung „Lifeline aktualisiert – zum Öffnen
  tippen“, sofern Meldungen erlaubt sind.
- **Fall (b) nur ohne Rückfrage:** Im Hintergrund installiert die App nur, wenn das System
  keine Rückfrage braucht (Fakt 6). Braucht es eine (erstes Update, Android unter 12), bleibt
  es beim Hinweis „Update bereit“ und bei Fall (a) mit der Rückfrage des Systems.
- Fehlt die Erlaubnis „Unbekannte Apps installieren“, führt der Hinweis in die
  Systemeinstellung. Blockiert das Gerät die Installation (etwa Samsungs „Auto Blocker“, der
  Apps außerhalb der Stores sperrt), zeigt der Updater „Installation blockiert“ mit Verweis auf
  die Anleitung in `docs/betrieb/android-app.md`, statt es still erneut zu versuchen.
- Ohne Internet (Einsatz-LAN) bleibt alles, wie es ist; Fehler des Updaters stören die
  Oberfläche nie.
- Einstellungen zeigen Version, Kanal, Stand des Updaters und „Jetzt prüfen“.

### D10 Prüfen (V)

- **`scripts/check-all.sh`, neuer Schritt „android“** (Bündel `android`, in `alle`): Tests des
  Kerns (`android/kern`) inklusive der gemeinsamen Fälle, nur JDK nötig. Ohne JDK lokal „OK mit
  Lücke“; in der CI erzwingt eine Pflicht-Variable (wie `IOS_SWIFT_PFLICHT`) die Toolchain.
  `scripts/bereiche.sh` kennt `android/*` und den Querbezug `src-tauri/faelle/*`;
  `android/app/src/main/assets/huelle.js` löst zusätzlich das Frontend aus (Vitest).
- **`suiten.yml`**: Job `android` mit dem neuen Schritt.
- **`android-pruefung.yml`** (`pull_request`, Pfadfilter `android/**`, `src-tauri/faelle/**`;
  dazu auf `alpha`): auf `ubuntu-latest` mit Android-SDK die App bauen (Release-Bau ohne
  Signatur), Robolectric-Tests der App, **Bildschirmbilder jeder nativen Seite** per
  Robolectric-Screenshot (z. B. Roborazzi) als Artefakt, für die Bilder der Änderung. Jede
  Seite ist über einen Testzustand erreichbar (wie `LifelineKern.Testzustand`), in dem die App
  kein Netz fragt und nichts speichert. Kein Pflicht-Check. Ohne grünen Lauf ist App-Code nicht
  fertig.
- **`android.yml`** (`workflow_call` aus `artefakte.yml` nach `freigeben`, dazu
  `workflow_dispatch`): bauen, signieren, ablegen (D9).
- Versionen von JDK, Gradle, AGP, Kotlin und SDK stehen je an einer Stelle; die Workflows lesen
  sie (Builder).

### D11 Regeln und Doku (V)

- `android/AGENTS.md`: keine Anwendungslogik in der Hülle; Logik im Kern mit Tests (ohne SDK);
  Brücke und Start-Skript nur für die Origin des aktiven Servers, nur Hauptframe; ein Profil je
  Server, nie gemeinsames Profil; Wire-Format im Init-Skript, Vitest zieht mit; gemeinsame Fälle
  nur in der JSON; Seite und Wirkung aus dem Kern; Bildschirmbilder je nativer Seite; Marke nie
  von Hand; Signierschlüssel nie wechseln; Updater installiert nie bei laufender Oberfläche im
  Vordergrund.
- Wurzel-`AGENTS.md`: Zeile in der Tabelle (heute 174 Zeilen, Platz ist da).
- **Marke:** adaptives App-Symbol und Startfarbe aus der Bildmarke (Spec `app-marke`), erzeugt
  von einem Skript `scripts/android/erzeuge-symbol.sh`, gerufen aus
  `scripts/marke/erzeuge-symbole.sh`, geprüft im Marken-Wächter
  (`frontend/src/marke/marke.guard.test.ts`).
- Architektur-Wächter (`scripts/check-architektur.sh`) lernt das Teilprojekt `android`; arc42
  Kapitel 5, 7, 8 und 11 nachziehen.
- `docs/betrieb/android-app.md`: Installation (APK-Link und QR-Code je Kanal, „Unbekannte Apps
  installieren“, Samsung „Auto Blocker“), Prüfliste für die erste Alpha am Gerät, Updates und ihr Verhalten, CA-Zertifikat installieren, Signierschlüssel
  anlegen und sichern, Grenzen (kein Alarm bei geschlossener App, kein Passkey im WebView,
  System-WebView muss aktuell sein). `docs/betrieb/endgeraete.md` nennt die Android-App neben
  der iOS-App. Anwenderdoku nur mit Ist-Stand.

## Was dem Builder bleibt

Bibliotheken und ihre Versionen (QR-Leser, Screenshot-Werkzeug), die genaue Haptik-Zuordnung,
Gradle-Aufbau so, dass der Kern ohne SDK testet, die Form des `blob:`-Downloads, die genauen
Abstände des Updaters, Layout der nativen Seiten im Stil der iOS-Seiten, die Reihenfolge der
Arbeit. Alles mit Tests im Kern, wo es eine Entscheidung ist.

## Risiken

- [Selbst-Update ohne Rückfrage hängt an Installateur-Status und Android-Version] → Hinweis
  „Update bereit“ als Rückfall; das erste Update fragt immer; Doku sagt es ehrlich.
- [Alter System-WebView ohne Profile] → eigene Seite statt Datenmischung; Doku nennt das.
  Der System-WebView aktualisiert sich über Google Play, sobald ein Gerät ab und zu online ist;
  ein Tablet, das nur im Einsatz-LAN lebt, muss vor dem ersten Einsatz einmal online
  aktualisiert werden (Prüfliste in der Betriebsdoku). Der genaue Stand der Galaxy Tabs ist
  unbekannt (R: „nicht uralt“); die Prüfliste der ersten Alpha erfasst Android-, One-UI- und
  WebView-Version und ob Auto Blocker an ist.
- [Samsung Auto Blocker sperrt Installation und Selbst-Update] → Anleitung zum Abschalten für
  die Erstinstallation, Zustand „Installation blockiert“ im Updater.
- [Verlust des Signierschlüssels] → keine Updates mehr möglich, nur Neuinstallation (Daten
  weg); Sicherung außerhalb von GitHub ist Teil der Anleitung.
- [Doppelte Regeln in Rust, Swift und Kotlin] → gemeinsame JSON-Fälle in allen drei Suiten.
- [Robolectric bildet den echten WebView nicht ab] → WebView-Verhalten (Profile, Brücke,
  Service Worker) bleibt ungetestet bis zum Gerät; Ruben prüft die erste Alpha auf einem
  Galaxy Tab nach einer Prüfliste in `docs/betrieb/android-app.md`.
- [Nutzer-CAs vertrauen öffnet die App für vom Nutzer installierte Abfang-CAs] → gleiches
  Niveau wie iOS (eingeschaltetes Profil); bewusst gewählt.
- [ADR-Nummer kollidiert mit einem offenen PR] → vor dem Commit prüfen.

## Rückweg

Neu und additiv: Server, Browser, Desktop- und iOS-Hülle ändern sich nicht (nur die
Rückmeldungs-Zeile „Android-App“). Rückweg: Job `android` in `artefakte.yml` abschalten.
