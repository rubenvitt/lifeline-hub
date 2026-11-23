---
id: ADR-0093
titel: Die App-Hüllen geben den Standort nur der Seite des aktiven Servers und nur im Vordergrund
status: akzeptiert
datum: 2026-11-23
gilt_fuer:
  - ios/App/Standortdienst.swift
  - ios/App/Webview.swift
  - ios/App/Huelle/**
  - ios/LifelineKern/Sources/LifelineKern/Standort.swift
  - ios/project.yml
  - android/app/src/main/AndroidManifest.xml
  - android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/HuellenChromeClient.kt
  - android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Seitenzugriff.kt
herleitung:
  - docs/superpowers/specs/2026-11-23-ktrtv1lt-standort-app-huellen-design.md
  - https://zunder.rubeen.dev/#/aufgabe/ktrtv1lt7wantd31ono0ztqd
---

# ADR-0093: Die App-Hüllen geben den Standort nur der Seite des aktiven Servers und nur im Vordergrund

## Regeln

- MUST: Den Standort (`navigator.geolocation`) bekommt nur die Origin des aktiven Servers, nach
  derselben Regel wie die Brücke (`ios/AGENTS.md` und `android/AGENTS.md`, „Standort“); die
  Entscheidung steht im Kern mit Test.
- MUST: Gefragt wird erst, wenn die Seite den Standort abfragt, und nur für den Vordergrund
  (iOS „When in Use“; Android fein oder grob, ohne Hintergrund).
- MUST NOT: `ACCESS_BACKGROUND_LOCATION`, `NSLocationAlways…`, `UIBackgroundModes` `location`
  oder ein Nachfragen nach dem genauen Standort, wenn die Person „ungefähr“ gewählt hat.
- MUST NOT: Die Hülle speichert oder sendet den Standort selbst; was die Oberfläche damit tut,
  entscheidet sie.
- MUST: iOS liefert den Standort über die Brücke (`location_current`, `location_watch`,
  `location_clear`); Unterframes bekommen keinen (`ios/App/Huelle/unterframe-standort.js`).
- MUST: Android merkt sich keine Freigabe im WebView (`retain` immer `false`).

## Prüfung

```sh
verbiete 'uses-permission[^>]*ACCESS_BACKGROUND_LOCATION' 'android/app/src/main/**'
verbiete 'NSLocationAlways|NSLocationTemporaryUsageDescriptionDictionary' 'ios/project.yml'
verlange 'NSLocationWhenInUseUsageDescription' 'ios/project.yml'
verlange 'callback\.invoke\(origin, false, false\)' 'android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/HuellenChromeClient.kt'
verbiete 'callback\.invoke\(.*,[[:space:]]*true[[:space:]]*\)' 'android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/HuellenChromeClient.kt'
verlange 'forMainFrameOnly: false' 'ios/App/Webview.swift'
```

## Kontext

Die Oberfläche nutzt den Standort für die Eigenposition auf der Lagekarte, für „Eigene Position“
im Ortsfeld und für „Mein Standort“ am gekoppelten Gerät. Im Browser geht das, in den Apps lief
es ins Leere. Der WKWebView hat keine öffentliche Schnittstelle, die seine eigene Abfrage je
Origin ersetzt oder auf eine Origin beschränkt; der Android-WebView hat sie
(`onGeolocationPermissionsShowPrompt`).

## Konsequenzen

Die Apps stehen beim Standort dem Browser gleich, und über die Hülle erreicht der Standort nie
eine fremde Seite. Eine fremde Seite, die den Ersatz im Skript umgeht, landet unter iOS bei der
WebKit-eigenen Abfrage; die fragt je Origin und nennt den Host, wie im Browser (dafür gibt es
keine öffentliche Schnittstelle). iOS trägt dafür einen Polyfill im Init-Skript und einen Rückkanal der Brücke, die bei jeder
Änderung des Wire-Formats mitzuziehen sind. Im Privacy-Manifest gilt der genaue Standort als
erhoben (App-Funktion, mit dem Konto verknüpft, kein Tracking), weil die Oberfläche ihn auf
Knopfdruck an den Server schickt.
