---
id: ADR-0098
titel: Die Helfer-App ist eine eigene native App und ortet im Hintergrund nur für eine aktive Helfer-Kopplung
status: akzeptiert
datum: 2026-11-24
gilt_fuer:
  - ios/Helfer/**
  - ios/HelferKern/**
  - android/helfer/**
  - android/helferkern/**
herleitung:
  - docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md
  - https://zunder.rubeen.dev/#/aufgabe/vakwvkpgn0ivb1wpq8mlqwhx
---

# ADR-0098: Die Helfer-App ist eine eigene native App und ortet im Hintergrund nur für eine aktive Helfer-Kopplung

## Regeln

- MUST: Die Helfer-App ist je Plattform eine eigene native App (SwiftUI, Compose) mit Logik im
  Kern (`ios/HelferKern`, `android/helferkern`). Die Lifeline-Hüllen bleiben unverändert dünn;
  ADR-0093 gilt für sie weiter.
- MUST: Ortung im Hintergrund nur, solange eine Helfer-Kopplung besteht (`wartet`, `aktiv`). Sie
  startet nur aus dem Vordergrund.
- MUST: iOS nur „When in Use“ (`UIBackgroundModes location` erlaubt, `NSLocationAlways…`
  verboten). Android nur ein Vordergrund-Dienst vom Typ `location`
  (`ACCESS_BACKGROUND_LOCATION` verboten).
- MUST: Die Ortung ist sichtbar: unter iOS mit Standortanzeige und Live-Aktivität, unter Android
  mit der Benachrichtigung des Dienstes.
- MUST: Die App sendet nur an den Server ihrer Kopplung und nur mit deren Sitzung. 401, 403 und
  404 beenden den Dienst; 5xx, 429 und Netzfehler führen zu Wiederholung mit wachsendem Abstand.
- MUST NOT: Verlauf speichern, mehr als die letzte Position puffern, Positionen auf die Platte
  schreiben.

## Prüfung

```sh
# Task 11 (iOS) und Task 13 (Android) setzen die verlange-Zeilen scharf, sobald die Dateien
# existieren: verlange 'UIBackgroundModes' 'ios/project.yml' und
# verlange 'foregroundServiceType="location"' 'android/helfer/src/main/AndroidManifest.xml'.
verbiete 'NSLocationAlways' 'ios/Helfer/**/*.swift' 'ios/Helfer/**/*.plist' 'ios/project.yml'
# Der Kern bleibt ohne System: kein UIKit, CoreLocation oder SwiftUI (ios/Helfer/AGENTS.md).
verbiete '^import (UIKit|CoreLocation|SwiftUI)' 'ios/HelferKern/**/*.swift'
verbiete 'ACCESS_BACKGROUND_LOCATION' 'android/helfer/**/*.xml' 'android/helfer/**/*.kt' 'android/helfer/**/*.kts'
# Auch der Android-Kern bleibt ohne System: kein android.*-Import (android/helfer/AGENTS.md).
verbiete 'import android\.' 'android/helferkern/**/*.kt'
```

## Kontext

Die Lageführung braucht die Position von Helfern im Einsatz auch bei gesperrtem Bildschirm. Die
Lifeline-Hüllen (ADR-0068, ADR-0084) sind bewusst Webview-Hüllen ohne Anwendungslogik, und
ADR-0093 erlaubt ihnen Standort nur im Vordergrund. Beides trägt eine dauerhafte Ortung nicht.

## Konsequenzen

Es gibt zwei eigene native Apps mit eigener Kennung, eigenem Kern und eigener Auslieferung; die
Hüllen bleiben unverändert. Die Hintergrundortung ist auf die Dauer einer Kopplung begrenzt, für
die Person sichtbar und ohne gespeicherten Verlauf. Dafür fällt jede Ortung ohne Kopplung weg.
