# Android-Hülle (LLH-1989) — Regeln

Gilt für `android/`, `scripts/android/` und `.github/workflows/android*.yml`, zusätzlich zur
`AGENTS.md` der Wurzel. Entscheidung: ADR-0084; Herleitung:
`docs/superpowers/specs/2026-11-22-y1dsr5i9-android-huelle-design.md` (D1–D11). Vorbild in allem
ist die iOS-Hülle (`ios/AGENTS.md`). Betrieb: `docs/betrieb/android-app.md`.

- **Keine Anwendungslogik in der Hülle:** der WebView lädt die Oberfläche des Servers. Native
  Seiten (Compose) nur für Onboarding, Serverliste, Einstellungen der Hülle, Status und „Lifeline
  wird aktualisiert“. Abhilfen für Grenzen des WebViews gehören in die Hülle (Init-Skript,
  Brücke), nicht ins Frontend; das Frontend unterscheidet nur über die Kennung
  (`platform: 'android'`, `frontend/src/huelle/faehigkeiten.ts`).
- **Logik im Kern, ohne SDK:** was ohne Android geht, steht in `android/kern` (Kotlin/JVM, eigener
  Gradle-Build, den die App per `includeBuild` einbindet) mit Tests, die nur ein JDK brauchen
  (Schritt 20 von `scripts/check-all.sh`). Kein `android.*`-Import, kein Android-Plugin im Kern.
  `android/app` bleibt dünn: Seiten, WebView, Brücke, Systemdienste, Updater-Ausführung.
- **Seite und Wirkung aus dem Kern:** welche Seite die App zeigt, entscheiden `Ablauf` und
  `Onboarding`, was die Brücke tut `Brueckenausfuehrung`, wann ein Update installiert wird
  `Installzeitpunkt`; `android/app/…/AppModell.kt` und `update/Updater.kt` führen nur aus. Eine
  neue Entscheidung kommt mit Test in den Kern, nicht in eine Seite.
- **Ein Profil je Server, nie gemeinsam:** jeder WebView läuft im `androidx.webkit`-Profil mit
  der UUID seines Eintrags, gesetzt vor jeder anderen Nutzung (`web/WebviewFabrik.kt`). Fehlt
  `MULTI_PROFILE`, Brücke oder Start-Skript, zeigt die App „System-WebView aktualisieren“; ein
  Rückfall auf das Standardprofil oder den globalen `CookieManager` ist verboten. Entfernen:
  erst den WebView zerstören, dann das Profil löschen.
- **Brücke und Start-Skript nur für den aktiven Server:** `addDocumentStartJavaScript` und
  `addWebMessageListener` bekommen nur die Origin-Regel des aktiven Servers
  (`Bruecke.allowedOriginRule`); die Start-Skripte steigen in Unterframes selbst aus
  (`window.top !== window`, der WebView spielt sie dort trotzdem ein); Nachrichten zählen nur
  aus dem Hauptframe (`Bruecke.accepts`), Antworten nur, solange derselbe WebView noch auf dieser
  Origin steht (`web/Brueckenempfang.kt`). Ebenso bekommt nur diese Origin die Kamera der Oberfläche
  (`getUserMedia`, nur Video, `Seitenzugriff.kamera`); die Dateiwahl (`<input type="file">`) geht
  über `web/HuellenChromeClient.kt` und `dienste/Activityzugriffe.kt`.
- **Vertrauen wie das System:** System- und Nutzer-CAs (`res/xml/network_security_config.xml`),
  keine Ausnahme, kein Pinning, kein Klartext; `onReceivedSslError` bricht immer ab. Nur die
  Download-Hosts des Updaters (`Updateentscheidung.ERLAUBTE_HOSTS`) vertrauen allein den CAs des
  Systems (`domain-config`, geprüft in `NetzvertrauenTest`).
- **Wire-Format im Init-Skript:** Kennung und Befehle stehen im Kopf von
  `android/app/src/main/assets/huelle.js`. Wire-Namen sind englisch und danach fest; Vitest
  führt das Skript aus (`frontend/src/test/huelle.ts`, `frontend/src/huelle/androidHuelle.test.ts`),
  eine Änderung zieht die Tests dort mit.
- **Gemeinsame Fälle:** Adressprüfung, Deeplink und Linkregeln prüft der Kern gegen
  `src-tauri/faelle/` (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“). Ein neuer Fall kommt in die
  JSON, nie nur in einen Kotlin-Test.
- **Bildschirmbilder:** jede native Seite hat einen `Testzustand` im Kern (Intent-Extra
  `lifeline.testzustand`, nur in Debug-Bauten ausgewertet, `Testzustand.fromStart`; die App
  fragt dann kein Netz und speichert nichts) und ein Bild in
  `android/app/src/test/…/BilderTest.kt` (Roborazzi, Handy und Tablet, nach
  `android/app/build/bilder/`). `android-pruefung.yml` lädt sie als Artefakt `android-bilder` hoch
  (Bilder der Änderung). Ohne grünen Lauf dort ist App-Code nicht fertig.
- **Marke:** adaptives App-Symbol und Startfarbe Kopf-Schwarz kommen aus der Bildmarke; neu
  erzeugt nur mit `scripts/android/erzeuge-symbol.sh` (auch aus `scripts/marke/erzeuge-symbole.sh`
  gerufen), geprüft in `frontend/src/marke/marke.guard.test.ts`. Nie von Hand ändern.
- **Updater:** installiert nie von selbst, solange die Oberfläche im Vordergrund ist (dort nur
  der Hinweis „Update bereit“, die Person entscheidet), sondern beim Start vor der Oberfläche
  oder nach 15 Minuten im Hintergrund ohne Rückfrage des Systems; lädt nur von GitHub
  (`Updateentscheidung.ERLAUBTE_HOSTS`) und prüft `sha256`. Der Kanal entsteht beim ersten Start
  aus der Version und ändert sich nie.
- **Signierschlüssel wechselt nie:** ein anderer Schlüssel kann die App nicht ersetzen. Kein
  Keystore im Repo; die vier Geheimnisse `ANDROID_KEY*` und ihre Sicherung beschreibt
  `docs/betrieb/android-app.md`.
- **Versionen an einer Stelle:** Bibliotheken und Plugins nur in `android/gradle/libs.versions.toml`,
  Gradle im Wrapper, JDK, SDK-Plattform und Build-Tools nur in `scripts/android/sdk-version.sh`
  (Selbsttest gegen `compileSdk`). App-Version und `versionCode` schreibt
  `scripts/android/version.sh` aus `[workspace.package]`; `android/` hat keine eigene.
  `compileSdk` ist 37.1 (die Compose-BOM verlangt es), `targetSdk` 36, `minSdk` 29.
- **Lokal bauen:** immer mit `LC_ALL=C.UTF-8` (unter Locale `C` scheitert der Kotlin-Compiler an
  Umlauten in Klassennamen der Tests). Kern: `LC_ALL=C.UTF-8 android/gradlew -p android/kern test`
  (kein SDK nötig). App (mit `ANDROID_HOME` oder `android/local.properties`):
  `LC_ALL=C.UTF-8 android/gradlew -p android :app:testDebugUnitTest :app:assembleDebug`.
