# iOS-Hülle (LLH-1978) — Regeln

Gilt für `ios/`, zusätzlich zur `AGENTS.md` der Wurzel. Entscheidung: ADR-0068; Anforderungen in
den Specs `ios-huelle`, `huellen-vertrag` und `ios-auslieferung`; Herleitung im `design.md` der
Change `t39ltxxi-ios-huelle`.

- **Keine Anwendungslogik in der Hülle:** der Webview lädt die Oberfläche des Servers. Native
  Seiten nur für Onboarding, Serverliste, Einstellungen der Hülle und Status (kein Server, nicht
  erreichbar, Zertifikat, nicht verträglich). Abhilfen für Grenzen des Webviews gehören in die
  Hülle (Init-Skript, Brücke), nicht ins Frontend; das Frontend unterscheidet nur über die Kennung
  (`frontend/src/huelle/faehigkeiten.ts`).
- **Logik im Kern:** was ohne UIKit, WebKit und SwiftUI geht, steht in `ios/LifelineKern` mit
  Tests (`swift test`, auch unter Linux, Schritt 18 von `scripts/check-all.sh`). `ios/App` bleibt
  dünn: Ansichten, WKWebView, Brücke, Systemdienste.
- **Brücke nur für den aktiven Server:** der Message-Handler `lifeline` nimmt Aufrufe nur aus dem
  Hauptframe und von der Origin des aktiven Servers an; nach einem Wechsel gilt sofort die neue.
  Jeder Server hat seinen eigenen Datenspeicher (`WKWebsiteDataStore(forIdentifier:)` mit der
  UUID des Eintrags).
- **Wire-Format im Init-Skript:** Kennung `__LIFELINE_HUELLE__` und Befehle der Brücke stehen im
  Kopf von `ios/App/Huelle/huelle.js`. Wire-Namen sind englisch und danach fest; Vitest führt das
  Skript aus (`frontend/src/test/huelle.ts`), eine Änderung zieht die Tests dort mit.
- **Start ohne Server** (LLH-1980, ADR-0082): ohne erreichbaren Server lädt die App die
  gespeicherte `index.html` **desselben** Servers per `loadSimulatedRequest` unter seiner
  Adresse; die Assets kommen aus dem HTTP-Cache seines Datenspeichers. Vorgewärmt wird nach jedem
  Laden vom Server mit `ios/App/Huelle/vorwaermen.js` und der Liste `assets` aus `/api/shell`;
  was zu tun ist, entscheiden `Vorrat` und `Ablauf` im Kern, die Ablage hält `Vorratsablage`
  (eine Datei je Server, gelöscht mit dem Server). Fährt die Oberfläche nicht hoch, gilt sie für
  diesen App-Lauf nicht mehr. Die App-Tests prüfen das gegen einen https-Testserver, dessen CA
  `scripts/ios/simulator-pruefung.sh` in jeden Simulator einträgt; der App-Code bekommt keine
  Ausnahme bei der Zertifikatsprüfung.
- **Gemeinsame Fälle:** Adressprüfung, Deeplink, Linkregeln und Vertragsprüfung prüft der Kern
  gegen `src-tauri/faelle/` (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“). Ein neuer Fall kommt in
  die JSON, nie nur in einen Swift-Test.
- **Bauen nur auf macOS:** keine `.xcodeproj` und keine Versionsangabe im Repo. Ablauf:
  `scripts/ios/version.sh` (Version aus `[workspace.package]`) → `xcodegen generate --spec
  ios/project.yml` → Xcode. Die XcodeGen-Version steht nur in
  `scripts/ios/xcodegen-installieren.sh`. Im Linux-Container läuft nur der Kern; App-Code,
  `ios/AppTests` und `ios/AppUITests` prüft `scripts/ios/simulator-pruefung.sh` in
  `ios-pruefung.yml`. Ohne grünen Lauf dort ist App-Code nicht fertig.
- **Bildschirmbilder:** jede native Seite bekommt ein Bild in
  `ios/AppUITests/ScreenshotTests.swift`; der Lauf lädt sie als Artefakt hoch (Bilder der
  Änderung für den PR). Erreicht wird die Seite über das Startargument `-LifelineTestzustand`
  (`LifelineKern.Testzustand`, je Seite ein Wert); in diesem Zustand fragt die App kein Netz und
  speichert nichts.
- **Seite und Wirkung aus dem Kern:** welche Seite die App zeigt, entscheiden `Ablauf` und
  `Onboarding`, was die Brücke tut, `Brueckenausfuehrung`; `ios/App/AppModell.swift` führt nur
  deren Wirkungen aus. Eine neue Entscheidung kommt mit Test in den Kern, nicht in eine Ansicht.
- **Marke:** App-Symbol (`ios/App/Assets.xcassets/AppIcon.appiconset`) und Startfarbe
  `Kopfschwarz` kommen aus der Bildmarke (Spec `app-marke`); neu erzeugt mit
  `scripts/ios/erzeuge-symbol.sh` (auch aus `scripts/marke/erzeuge-symbole.sh` gerufen), geprüft in
  `frontend/src/marke/marke.guard.test.ts`. Nie von Hand ändern.

## Push über APNs (LLH-1981)

Entscheidung ADR-0090; Server-Seite in `src/AGENTS.md`, „iOS-Push“, Relais in
`push-relais/AGENTS.md`.

- **Brücke:** `push_register` (fragt die Berechtigung, holt das Token, legt je Server einmal
  Kennung und Schlüssel an; Antwort `{ registration_id, token, environment, key }`, Fehler
  `denied` oder `unavailable`), `push_unregister`, `push_state` (`{ permission, registration_id? }`,
  die Kennung, sobald es eine gibt, auch ohne Schlüssel: nur mit ihr meldet die Seite am Server ab);
  die Kennung trägt `push: true`. Am Server meldet nur die Oberfläche an und ab
  (`frontend/src/alarm/iosPush.ts`): Schalter, Abgleich und Stumm-Wahl liegen dort, nie in der Hülle.
- **Kennung und Schlüssel je Server:** die Zuordnung Kennung → Server liegt in `push.json` neben
  der Serverliste (`PushAnmeldungen`, Kern), der Schlüssel im gemeinsamen Schlüsselbund von App und
  Extension (`ios/Gemeinsam/Schluesselbund.swift`, lesbar nach dem ersten Entsperren). Token und
  Schlüssel stehen in keinem Log. Eine unlesbare `push.json` legt die App beim Start als
  `push.defekt.json` beiseite (`Pushablage.recoverIfUnreadable`); der nächste Abgleich der Seite
  meldet mit neuer Kennung an, der Server ersetzt die alte am selben Token.
- **Die Extension bleibt dünn** (`ios/Benachrichtigungsdienst`): Schlüssel lesen, öffnen
  (`ios/Gemeinsam/Entschluesseler.swift`), Inhalt setzen; was angezeigt wird, entscheidet
  `PushNutzlast` im Kern. Kein Netz, keine Ablage. Scheitert etwas, bleibt der Rückfalltitel des
  Relais mit „Öffnen, um die Meldung zu sehen“. AES-GCM steht in `ios/Gemeinsam`, weil es unter
  Linux kein CryptoKit gibt; Server und App hält der gemeinsame Fall
  `src-tauri/faelle/push-nutzlast.json` zusammen (Klartext: `push-inhalt.json`).
- **Native Anfragen an einen Server** gibt es nur drei: `GET /api/shell`, `GET /` für die
  `index.html` des Starts ohne Server (`Vorratsdienst`, ADR-0082) und
  `POST /api/ios-push/unregister` beim Entfernen eines Servers (`Vertragsabruf.meldePushAb`, ohne
  Sitzung). Die Abmeldung liegt in `PushAnmeldungen.ausstehend`, bis sie erledigt ist
  (`AusstehendeAbmeldung.isErledigt`: 2xx oder ein 4xx außer 408/429); erst dann fällt der
  Schlüssel. Versucht wird sie nach dem Entfernen, beim Start und bei jeder Rückkehr in den
  Vordergrund je einmal, nie in einer Schleife. Eine vierte Anfrage braucht eine neue
  Entscheidung.
- **Tippen auf eine Meldung** entscheidet `Ablauf` (`meldungAngetippt`): eine unbekannte Kennung
  tut nichts, ein anderer Server wird sichtbar aktiv wie bei einem Wechsel in der Serverliste, der
  Pfad geht durch `Linkregeln.sichererPfad` (Abschnitt `push_pfad` in
  `src-tauri/faelle/deeplink.json`), sonst die Startseite. Auf der gespeicherten Oberfläche
  (`ohneServer`) gilt dasselbe wie auf einer Status-Seite: erst prüfen, dann den Pfad laden;
  antwortet der Server nicht, startet sie ohne den Pfad neu. Eine Push-Meldung des Servers, dessen
  Oberfläche gerade vom Server läuft (`.web`), zeigt die App nicht als Banner; die Oberfläche
  meldet sie selbst. Die gespeicherte Oberfläche hat keinen Live-Kanal, dort erscheint das Banner.
- **Umgebung und Berechtigungen:** `aps-environment` steht in `ios/App/LifelineHub.entitlements`
  fest auf `development`, der Export für App Store Connect setzt `production`; dem Server meldet
  die App die Umgebung über `#if DEBUG` (`ios/App/Systemdienste.swift`). Push gegen die Sandbox
  also nur mit Debug: ein Release-Build mit Entwicklungsprofil (Xcode „Run“ oder Profiling in
  Release) meldet `production` zu einem Sandbox-Token, APNs lehnt ab, der Server löscht die
  Anmeldung. App und Extension teilen App Group und Schlüsselbund-Gruppe; die Zahl der Server legt
  die App für den Untertitel in die `UserDefaults` der App Group (Privacy-Manifest: Grund 1C8F.1).
