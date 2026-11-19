---
id: ADR-0068
titel: Die iOS-Hülle ist eine eigene Swift-App ohne Anwendungslogik, die die Serveroberfläche lädt
status: akzeptiert
datum: 2026-11-18
gilt_fuer:
  - ios/**
herleitung:
  - openspec/changes/t39ltxxi-ios-huelle/design.md
  - Zunder LLH-1978 (Brainstorming mit Ruben am 18.11.2026)
---

# ADR-0068: Die iOS-Hülle ist eine eigene Swift-App ohne Anwendungslogik, die die Serveroberfläche lädt

## Regeln

- MUST: Die iOS-App ist eine eigene Swift-App (SwiftUI und WKWebView) unter `ios/`; sie lädt die
  Weboberfläche des gewählten Servers. Kein Tauri-iOS-Ziel, kein Capacitor.
- MUST NOT: Die Hülle trägt Fachlogik oder baut Bildschirme der Oberfläche nach. Native Seiten
  gibt es nur für Onboarding, Serverliste, Einstellungen der Hülle und Status-Seiten.
- MUST: Logik ohne UIKit und WebKit steht im Swift-Paket `ios/LifelineKern` mit Tests, die auch
  unter Linux laufen; `ios/App` bleibt dünn (`ios/AGENTS.md`).
- MUST: Adressprüfung, Deeplink und Linkregeln prüft der Kern gegen die gemeinsamen Fälle der
  Desktop-Hülle (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“).
- MUST: Die Brücke `lifeline` nimmt Aufrufe nur aus dem Hauptframe und von der Origin des aktiven
  Servers an; ihr Wire-Format steht im Kopf von `ios/App/Huelle/huelle.js`.
- MUST: Die App lädt einen Server nur, wenn sie seinen `shell_contract` aus `GET /api/shell` kennt
  (Spec `huellen-vertrag`).
- MUST NOT: `ios/` pflegt eine eigene Versionsangabe oder eine `.xcodeproj`; die Version schreibt
  `scripts/ios/version.sh` aus `[workspace.package]`, das Projekt erzeugt XcodeGen aus
  `ios/project.yml`.

## Prüfung

```sh
# Der Kern bleibt ohne UIKit, WebKit und SwiftUI, damit er unter Linux läuft.
verbiete '^import (UIKit|WebKit|SwiftUI)' 'ios/LifelineKern/**/*.swift'
# Die Kernsuite liest die gemeinsamen Fälle der Desktop-Hülle.
verlange '"src-tauri/faelle"' 'ios/LifelineKern/Tests/**/*.swift'
# Die Brücke heißt `lifeline`.
verlange 'messageHandlers\?\.lifeline' ios/App/Huelle/huelle.js
# Keine Projektdatei im Repo, keine Versionsangabe im Projekt.
verbiete '.' 'ios/**/*.pbxproj'
verbiete '^[[:space:]]*(MARKETING_VERSION|CURRENT_PROJECT_VERSION|LIFELINE_VERSION):' ios/project.yml
verlange 'configFiles:' ios/project.yml
```

## Kontext

Die Mac-App ist eine Tauri-Hülle um die Serveroberfläche; für iPhone und iPad fehlte eine App.
Tauri-iOS ist jung und erreicht die nötige Feinsteuerung des WKWebView (Datenspeicher je Server,
Brücke nur für den aktiven Server) nur über Umwege, eine native Oberfläche bräuchte eine stabile
API für alle Fachdaten, die es nicht gibt. Swift lässt sich im Linux-Container nicht vollständig
bauen.

## Konsequenzen

Eine zweite Sprache kommt ins Repo; die doppelten Adress- und Linkregeln halten gemeinsame
JSON-Fälle zusammen, die beide Hüllen prüfen. Der Kern läuft in den Suiten unter Linux, die App
baut nur ein macOS-Runner (`ios-pruefung.yml`). Neue Fähigkeiten der Oberfläche kommen ohne
App-Update, solange der Hüllen-Vertrag gilt.
