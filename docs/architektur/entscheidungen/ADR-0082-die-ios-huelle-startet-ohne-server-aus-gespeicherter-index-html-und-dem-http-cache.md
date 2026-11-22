---
id: ADR-0082
titel: Die iOS-Hülle startet ohne Server aus gespeicherter index.html und dem HTTP-Cache
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - ios/App/**
  - ios/LifelineKern/Sources/LifelineKern/Vorrat*.swift
  - ios/LifelineKern/Sources/LifelineKern/Ablauf.swift
  - src/routes/shell.rs
  - src/static_files.rs
herleitung:
  - docs/superpowers/specs/2026-11-22-ny0d22bl-ios-start-ohne-server-design.md
  - Zunder LLH-1980 (Abstimmung mit Ruben am 22.11.2026)
---

# ADR-0082: Die iOS-Hülle startet ohne Server aus gespeicherter index.html und dem HTTP-Cache

## Regeln

- MUST: Ohne erreichbaren Server lädt die Hülle nur die gespeicherte Oberfläche **desselben**
  Servers, per `loadSimulatedRequest` unter dessen Adresse und in dessen Datenspeicher.
- MUST NOT: kein Start ohne Server bei einem Zertifikatsfehler oder einem unverträglichen Server.
- MUST: Lief online eine andere Version, verwirft die Hülle die alte Ablage, bevor sie vorwärmt;
  die `index.html` legt sie erst ab, wenn jedes Asset aus `GET /api/shell` (Feld `assets`) ankam.
- MUST: `assets` nennt alles unter `assets/` des eingebetteten Frontends außer `assets/doku/`,
  wie der Precache des Service Workers.
- MUST NOT: kein eigener Delegat für Zertifikats-Challenges in `ios/App`; Testserver bekommen
  ihre CA im Simulator (`scripts/ios/testserver-zertifikat.sh`).
- SHOULD: Kommt der Server mit derselben Version zurück, lädt die Hülle nicht neu.

## Prüfung

```sh
# Die Liste lässt die Doku-Bilder aus.
verlange 'DOKU_BILDER_PRAEFIX: &str = "assets/doku/"' src/static_files.rs
# Kein Vertrauens-Override in der App.
verbiete 'didReceive challenge|URLAuthenticationChallenge' 'ios/App/**/*.swift'
# Ohne Server lädt die Hülle die gespeicherte Seite unter der Adresse des Servers.
verlange 'loadSimulatedRequest' ios/App/Vorratsdienst.swift
# Die Testzertifikate liegen nie im Repo.
verbiete '.' 'ios/**/*.p12'
```

## Kontext

Im WKWebView einer App läuft kein Service Worker, der Precache der Weboberfläche trägt also
nicht; ohne Server zeigte die App nur „nicht erreichbar“, obwohl Lagebild und Schreib-Queue auf
dem Gerät liegen. Verworfen wurden eine eigene Kopie der Assets in Application Support (ein
Webview beantwortet https-Anfragen nicht aus eigener Ablage), ein eigenes URL-Schema (andere
Origin, Cookies und Live-Strom durch Swift) und App-Bound Domains (fest in der `Info.plist`).

## Konsequenzen

Die Oberfläche läuft ohne Server unter derselben Origin; Cookies, IndexedDB und die
Offline-Logik des Frontends greifen ohne Änderung. Räumt iOS den HTTP-Cache, fährt die
Oberfläche nicht hoch, und die Hülle fällt auf „nicht erreichbar“ zurück; das misst Ruben auf
dem Gerät (Protokoll im Entwurf). `GET /api/shell` wächst um ein Feld, der Vertrag bleibt 1.
