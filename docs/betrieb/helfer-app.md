# Betrieb: Helfer-App „Lifeline Helfer“ (iPhone, Android)

Die Helfer-App ist eine **eigene native App** (SwiftUI, Compose), kein Webview und keine Hülle
([ADR-0101](../architektur/entscheidungen/ADR-0101-die-helfer-app-ist-eine-eigene-native-app-und-ortet-im-hintergrund-nur-fuer-eine-aktive-helfer-kopplung.md)).
Helfende melden damit ihre Position an die Einsatzleitung; die Bedienung steht im Anwenderkapitel
[Helfer anmelden](../anwender/kapitel/helfer-anmelden.md), die Datenschutzvorlage unter
[`docs/datenschutz/dsfa-vorlage-ortung.md`](../datenschutz/dsfa-vorlage-ortung.md). Neben ihr
bleiben die [iOS-App](ios-app.md) und die [Android-App](android-app.md) unverändert.

Quellcode und Regeln: `ios/Helfer/` ([`ios/Helfer/AGENTS.md`](../../ios/Helfer/AGENTS.md)),
`android/helfer/` ([`android/helfer/AGENTS.md`](../../android/helfer/AGENTS.md)) und die Kerne
`ios/HelferKern`, `android/helferkern`. Herleitung:
`docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`.

## Kennungen

| | iOS | Android |
|---|---|---|
| Bundle-ID / Application-ID | `dev.rubeen.lifeline.helfer` | `dev.rubeen.lifeline.helfer` |
| Erweiterung (Live-Aktivität) | `dev.rubeen.lifeline.helfer.aktivitaet` | – |
| Team | `H95J852PKP` | – |
| App Store Connect | „Lifeline Helfer“, App-ID 6838950939 | – |
| Verteilung | TestFlight, Gruppe „Intern“ | APK |
| Signierung | App-Store-Connect-API-Schlüssel (`APP_STORE_CONNECT_*`), automatisch | derselbe Keystore wie die Lifeline-App (`ANDROID_KEY*`) |
| Version | `scripts/ios/helfer-version.sh` (`HELFER_VERSION`, einzige Stelle) | dieselbe Quelle (`versionName` in `android/helfer/build.gradle.kts`) |

Der **Android-Signierschlüssel ist derselbe** wie der der Lifeline-App: Keystore und die vier
Geheimnisse `ANDROID_KEY*` werden mitbenutzt, ein zweiter Keystore entsteht nicht. Er wechselt nie
(`android/AGENTS.md`, „Signierschlüssel wechselt nie“); sonst lässt sich keine installierte App
mehr aktualisieren.

## Org-Schalter: Ortung einschalten

Ohne Schalter gibt es keine Ortung, auch mit installierter App nicht. Die Organisation schaltet in
der Verwaltung unter „Einsatz-Vorgaben“ im Bereich „Ortung“ **„Ortung im Einsatz“** ein. Der
Dialog verlangt die Bestätigung, dass eine Einwilligung der Helfenden bzw. eine
Betriebsvereinbarung vorliegt; der Server speichert, wer es wann bestätigt hat. „Auch Personen
orten“ ist ein zweiter Schalter und nur bei eingeschalteter Ortung frei. Vorher die Vorlage
`docs/datenschutz/dsfa-vorlage-ortung.md` durcharbeiten. Ausschalten geht ohne Rückfrage, nimmt
„Auch Personen orten“ mit und sperrt „Helfer einladen“.

## Bezug und Installation

- **iPhone:** über TestFlight. Der Bau lädt jeden Stand in die App „Lifeline Helfer“ in App Store
  Connect; die interne Gruppe **„Intern“** verteilt automatisch (Mitglieder des Teams, die dort
  eingetragen sind). Auf dem Gerät „TestFlight“ aus dem App Store laden und „Lifeline Helfer“
  installieren. Ein Build läuft in TestFlight nach 90 Tagen ab.
- **Android:** eine signierte APK. Sie entsteht zunächst als **Workflow-Artefakt**
  (`android-helfer-apk`) des Laufs `android-helfer.yml`; einen Release-Kanal und den
  Selbst-Updater der Lifeline-App hat die Helfer-App noch nicht. Die Datei auf das Gerät bringen,
  öffnen und „Unbekannte Apps installieren“ für die Quelle zulassen (Schritte wie in der
  [Android-App](android-app.md#erste-installation)).

## Bauen und Verteilen

Beide Workflows laufen **nicht bei jedem Push** und sind kein Pflicht-Check (ADR-0048):

| Wunsch | Auslöser |
|---|---|
| iPhone-Build zu TestFlight | PR mit Label **`testflight-helfer`** (beim Setzen und danach bei jedem Push, solange es hängt) oder „Run workflow“ an `ios-helfer.yml` |
| Android-APK | PR mit Label **`apk-helfer`** (ebenso) oder „Run workflow“ an `android-helfer.yml` |

- **iOS** (`ios-helfer.yml`): archiviert das Schema `LifelineHelfer` auf `macos-26` mit Xcode 26.6,
  signiert automatisch und lädt über `scripts/ios/testflight.sh --app helfer` hoch. Die
  Build-Nummer ist die Laufnummer plus 1000; App-ID, Erweiterung und App Group legt
  `-allowProvisioningUpdates` an. Ein eigener Verteilschritt entfällt, die Gruppe „Intern“
  verteilt selbst.
- **Android** (`android-helfer.yml`): `:helfer:assembleRelease` mit dem Keystore der
  Lifeline-App, prüft Signatur und Paket und legt die APK als Artefakt ab. `versionCode` ist die
  Laufnummer plus 1000. Fehlt ein Geheimnis, wird der Lauf rot; eine unsignierte APK entsteht
  nie.
- **PRs aus Forks** haben keine Secrets; dort bricht der Lauf mit einer Meldung ab.
- Die Prüfungen der Kerne (`swift test`, Kotlin-Tests, Bildschirmbilder `android-helfer-bilder`)
  laufen im Gate bzw. in `android-pruefung.yml`, nicht in diesen beiden Workflows.

## Erste Einrichtung (einmalig)

1. In App Store Connect die App „Lifeline Helfer“ mit der Bundle-ID `dev.rubeen.lifeline.helfer`
   anlegen (ist unter der ASC-App-ID 6838950939 geschehen).
2. In TestFlight die interne Gruppe **„Intern“** anlegen, **automatische Verteilung** einschalten
   und die Tester eintragen.
3. Die Secrets `APP_STORE_CONNECT_*` und `ANDROID_KEY*` sind dieselben wie für die Hüllen; für die
   Helfer-App kommen keine neuen hinzu.

## Berechtigungen am Gerät

- **iOS:** „Beim Verwenden der App“ für den Standort (nie „Immer“), dazu die Kamera für den
  QR-Scanner. Die Ortung im Hintergrund läuft über `UIBackgroundModes location` mit
  Standortanzeige und Live-Aktivität.
- **Android:** Standort „Nur während der Nutzung der App“ und Benachrichtigungen; die Ortung
  läuft als Vordergrund-Dienst vom Typ `location` mit dauerhafter Benachrichtigung („Pausieren“).
  `ACCESS_BACKGROUND_LOCATION` fordert die App nie an.

Wo die App sendet: nur an den Server ihrer Kopplung und nur mit deren Sitzung. Das Gerät hält nur
die letzte Position im Speicher, nie auf der Platte; ein Verlauf entsteht nirgends.
