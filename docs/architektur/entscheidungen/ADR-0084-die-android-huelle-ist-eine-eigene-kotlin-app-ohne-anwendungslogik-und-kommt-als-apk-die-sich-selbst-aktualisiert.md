---
id: ADR-0084
titel: Die Android-Hülle ist eine eigene Kotlin-App ohne Anwendungslogik und kommt als APK, die sich selbst aktualisiert
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - android/**
  - scripts/android/**
  - .github/workflows/android*.yml
herleitung:
  - docs/superpowers/specs/2026-11-22-y1dsr5i9-android-huelle-design.md
  - LLH-1989 (mit Ruben am 22.11.2026 abgestimmt)
---

# ADR-0084: Die Android-Hülle ist eine eigene Kotlin-App ohne Anwendungslogik und kommt als APK, die sich selbst aktualisiert

## Regeln

- MUST: Die Android-App ist eine eigene Kotlin-App (Jetpack Compose und Android-WebView) unter
  `android/`; sie lädt die Weboberfläche des gewählten Servers und trägt keine Fachlogik. Kein
  Tauri-Android-Ziel, keine Trusted Web Activity, kein Capacitor.
- MUST: Entscheidungen stehen mit Tests im Kern `android/kern`, der ohne Android-SDK baut und
  testet; `android/app` führt nur aus (`android/AGENTS.md`).
- MUST: Jeder Server läuft in einem eigenen WebView-Profil mit der UUID seines Eintrags.
  MUST NOT: ein Rückfall auf ein gemeinsames Profil, auch wenn der System-WebView keine Profile
  kann.
- MUST: Brücke und Start-Skript gelten nur für die Origin des aktiven Servers und nur im
  Hauptframe; Zertifikatsfehler brechen immer ab.
- MUST NOT: Der Updater installiert von selbst, solange die Oberfläche im Vordergrund ist.
- MUST: Die App wird nur als signierte APK über die GitHub-Releases verteilt und lädt Updates
  nur von GitHub; nicht über Google Play.
- MUST NOT: Der Signierschlüssel wechselt; er liegt nie im Repo.

## Prüfung

```sh
# Der Kern bleibt ohne Android-SDK.
verbiete '^import android' 'android/kern/**/*.kt'
verbiete 'com\.android' android/kern/build.gradle.kts android/kern/settings.gradle.kts
# Ein Profil je Server, nie das gemeinsame.
verlange 'WebViewCompat\.setProfile\(webView, eintrag\.id\)' android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/WebviewFabrik.kt
verbiete 'DEFAULT_PROFILE_NAME|CookieManager\.getInstance' 'android/app/src/main/**/*.kt'
# Brücke nur mit der Origin-Regel des aktiven Servers, Zertifikatsfehler ohne Ausnahme.
verlange 'addWebMessageListener\(webView, Bruecke\.OBJEKT_NAME, regel' android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/WebviewFabrik.kt
verlange 'if \(!isMainFrame' android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Bruecke.kt
verbiete '\.proceed\(' 'android/app/src/main/**/*.kt'
# Im Vordergrund nur ein Hinweis; Downloads nur von GitHub.
verlange 'Lage\.VORDERGRUND -> Weg\.HINWEIS' android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Update.kt
verlange 'ERLAUBTE_HOSTS = setOf\("github\.com", "objects\.githubusercontent\.com", "release-assets\.githubusercontent\.com"\)' android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Update.kt
# Signiert wird nur in der CI mit den Geheimnissen; kein Schlüssel im Repo.
verlange 'ANDROID_KEYSTORE_BASE64: \$\{\{ secrets\.ANDROID_KEYSTORE_BASE64 \}\}' .github/workflows/android.yml
verbiete '.' 'android/**/*.jks' 'android/**/*.keystore' 'android/**/*.p12'
```

## Kontext

Nach der iOS-App (ADR-0068) soll es eine Android-App geben, die sich genauso verhält; laufen muss
sie vor allem auf vielen Samsung Galaxy Tabs ohne MDM. Tauri-Android und eine Trusted Web
Activity tragen weder Profile je Server noch eine auf den Server begrenzte Brücke. Google Play
scheidet aus, Updates sollen trotzdem so automatisch wie möglich kommen, ohne die Arbeit zu
unterbrechen.

## Konsequenzen

Eine dritte Sprache kommt ins Repo; die gemeinsamen JSON-Fälle halten Adress-, Deeplink- und
Linkregeln über Rust, Swift und Kotlin zusammen. Das echte WebView-Verhalten (Profile, Brücke,
Service Worker, Installation) prüft Robolectric nicht; es steht auf der Prüfliste der ersten
Alpha (`docs/betrieb/android-app.md`). Geht der Signierschlüssel verloren, gibt es keine Updates
mehr, nur eine Neuinstallation mit Datenverlust.
