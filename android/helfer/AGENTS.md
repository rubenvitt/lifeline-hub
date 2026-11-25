# Helfer-App Android — Regeln

Gilt für `android/helfer/` und den Kern `android/helferkern/`, zusätzlich zu `android/AGENTS.md`
und der Wurzel. Entscheidung: ADR-0098; Herleitung: `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

- **Eigene native App** (`dev.rubeen.lifeline.helfer`, Compose), kein WebView. „Keine
  Anwendungslogik in der Hülle“ aus `android/AGENTS.md` gilt hier nicht; die Lifeline-Hülle
  bleibt davon unberührt.
- **Logik im Kern:** was ohne Android-SDK geht, steht in `android/helferkern` mit Tests (nur ein
  JDK nötig). `android/helfer` bleibt dünn: Oberfläche, Dienst, Systemdienste.
- **Nur der Server der Kopplung:** die App sendet an keinen anderen Server und nur mit der
  Sitzung dieser Kopplung.
- **Ortung** (ADR-0098): nur ein Vordergrund-Dienst vom Typ `location`, nie
  `ACCESS_BACKGROUND_LOCATION`; nur solange eine Kopplung besteht, Start nur aus dem Vordergrund;
  sichtbar durch die Benachrichtigung des Dienstes. Kein Verlauf, nur die letzte Position, nur im
  Speicher.
- **Design-Tokens** nur aus dem Generator `scripts/design/tokens-nativ.mjs`, nie von Hand in
  `Tokens.kt`.
- **Seite und Wirkung aus dem Kern:** welche Seite gilt, entscheidet `Anmeldung`, was der
  Ortungsdienst wann sendet `Sendeplan` (Takt, Puffer, Wiederholung), die Wire-Bodies stehen in
  `Wire.kt`, feste Texte in `Anzeige`. `HelferModell.kt` und `dienste/OrtungsDienst.kt` führen nur
  aus; ein Dienst nach einem Neustart des Prozesses startet nicht von selbst (`START_NOT_STICKY`).
- **Sitzung verschlüsselt:** das Cookie `lifeline_sid` liegt nur AES/GCM-verschlüsselt mit einem
  Schlüssel aus dem Android Keystore in den privaten Einstellungen (`dienste/Sitzungsablage.kt`),
  keine Sicherung (`allowBackup="false"`), Anfragen nur über `dienste/Serververbindung.kt` (ohne
  Weiterleitungen).
- **Bildschirmbilder:** jede Seite hat einen `Testzustand` im Kern (Intent-Extra
  `lifeline.helfer.testzustand`, nur in Debug-Bauten) und ein Bild in
  `android/helfer/src/test/…/BilderTest.kt` (Roborazzi, hell und dunkel, nach
  `android/helfer/build/bilder/`); `android-pruefung.yml` lädt sie als `android-helfer-bilder` hoch.
- **Ausliefern:** derselbe Signierschlüssel wie die Lifeline-App (`android/AGENTS.md`,
  „Signierschlüssel wechselt nie“). `android-helfer.yml` baut die signierte APK per Handstart oder
  mit dem Label `apk-helfer` am PR als Workflow-Artefakt; einen Update-Kanal hat die Helfer-App noch
  nicht. Version: `HELFER_VERSION` in `scripts/ios/helfer-version.sh` (eine Zählung für beide
  Plattformen), `versionCode` aus der Laufnummer.
- **Lokal bauen** (mit SDK): `LC_ALL=C.UTF-8 android/gradlew -p android :helfer:testDebugUnitTest
  :helfer:assembleDebug`; der Kern allein ohne SDK: `LC_ALL=C.UTF-8 android/gradlew -p
  android/helferkern test`.
