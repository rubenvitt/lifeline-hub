# iOS-Hülle (LLH-1978) — Regeln

Gilt für `ios/`, zusätzlich zur `AGENTS.md` der Wurzel. Entscheidung: ADR-0065; Anforderungen in
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
- **Gemeinsame Fälle:** Adressprüfung, Deeplink und Linkregeln prüft der Kern gegen
  `src-tauri/faelle/` (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“). Ein neuer Fall kommt in die
  JSON, nie nur in einen Swift-Test.
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
