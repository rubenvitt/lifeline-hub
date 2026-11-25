# Helfer-App Android — Regeln

Gilt für `android/helfer/` und den Kern `android/helferkern/`, zusätzlich zu `android/AGENTS.md`
und der Wurzel. Entscheidung: ADR-0101; Herleitung: `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

- **Eigene native App** (`dev.rubeen.lifeline.helfer`, Compose), kein WebView. „Keine
  Anwendungslogik in der Hülle“ aus `android/AGENTS.md` gilt hier nicht; die Lifeline-Hülle
  bleibt davon unberührt.
- **Logik im Kern:** was ohne Android-SDK geht, steht in `android/helferkern` mit Tests (nur ein
  JDK nötig). `android/helfer` bleibt dünn: Oberfläche, Dienst, Systemdienste.
- **Nur der Server der Kopplung:** die App sendet an keinen anderen Server und nur mit der
  Sitzung dieser Kopplung.
- **Ortung** (ADR-0101): nur ein Vordergrund-Dienst vom Typ `location`, nie
  `ACCESS_BACKGROUND_LOCATION`; nur solange eine Kopplung besteht, Start nur aus dem Vordergrund;
  sichtbar durch die Benachrichtigung des Dienstes. Kein Verlauf, nur die letzte Position, nur im
  Speicher.
- **Ruhe statt Ende** (403 `no_role`/`tracking_off`): Phase `Ruht` im Kern, der Dienst stoppt
  (Benachrichtigung weg), Kopplung und Sitzung bleiben; die App prüft jede Minute
  (`Ruhegrund.PRUEFABSTAND_S`: Zustand, bei `pruefeMitFortsetzen` dazu `{paused: false}`) und ortet
  wieder, wenn der Kern es entscheidet, gestartet nur im Vordergrund (sonst beim nächsten Öffnen).
  Ohne Ortungsgerät und Person startet sie gar nicht erst. Nur 401, 404 und ein 403 ohne
  `Ruhegrund` beenden die Kopplung.
- **Design-Tokens** nur aus dem Generator `scripts/design/tokens-nativ.mjs`, nie von Hand in
  `Tokens.kt`.
- **Seite und Wirkung aus dem Kern:** welche Seite gilt, entscheidet `Anmeldung`, was der
  Ortungsdienst wann sendet `Sendeplan` (Takt, Puffer, Wiederholung), die Wire-Bodies stehen in
  `Wire.kt`, feste Texte in `Anzeige`. `HelferModell.kt` und `dienste/OrtungsDienst.kt` führen nur
  aus; ein Dienst nach einem Neustart des Prozesses startet nicht von selbst (`START_NOT_STICKY`).
- **Sitzung verschlüsselt:** das Cookie `lifeline_sid` liegt nur AES/GCM-verschlüsselt mit einem
  Schlüssel aus dem Android Keystore in den privaten Einstellungen (`dienste/Sitzungsablage.kt`),
  keine Sicherung (`allowBackup="false"`), Anfragen nur über `dienste/Serververbindung.kt`, ohne
  Weiterleitungen (`instanceFollowRedirects = false` an jeder Anfrage; eine 3xx-Antwort gilt als
  Serverfehler), der Code der Einladung nie in der Adresse (`POST …/helpers/targets` mit `{code}`).
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

## Aufträge (Stufe 2, ADR-0106)

- **Ein Dienst für Ortung und Empfang** mit einer Benachrichtigung, Typen
  `location|remoteMessaging`. Er startet beim Einlösen immer aus dem Vordergrund, ohne Ortung nur
  mit `remoteMessaging`; kein FCM, kein Selbstneustart.
- **Empfang** über `GET /api/incidents/{id}/live` (Ereignis `helfer_auftrag`) ab `aktiv`; SSE-Lesen,
  Wiederverbinden, Ordnung, Quittungsstand und „Mitteilung ja/nein“ entscheidet `helferkern`
  (`Livestrom`, `Empfang`, `Auftraege`) mit den Fällen `src-tauri/faelle/helfer-auftrag.json`.
- **Mitteilungen** im Kanal „Aufträge“, `VISIBILITY_PRIVATE`, öffentliche Fassung „Neuer Auftrag“.
  Ohne Mitteilungsrecht Hinweis in „Angemeldet“. Aufträge nie auf die Platte.
