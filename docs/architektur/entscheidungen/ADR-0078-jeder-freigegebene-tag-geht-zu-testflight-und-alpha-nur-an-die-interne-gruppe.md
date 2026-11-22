---
id: ADR-0078
titel: Jeder freigegebene Tag geht zu TestFlight, und die CI verteilt je Kanal, Alpha nur an die interne Gruppe
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - scripts/ios/**
  - .github/workflows/ios.yml
  - .github/workflows/artefakte.yml
herleitung:
  - docs/superpowers/specs/2026-11-22-x9i4shzk-ios-testflight-kanaele-design.md
  - LLH-1988 (mit Ruben am 22.11.2026 abgestimmt)
---

# ADR-0078: Jeder freigegebene Tag geht zu TestFlight, und die CI verteilt je Kanal, Alpha nur an die interne Gruppe

## Regeln

- MUST: Nach der Freigabe eines Tags der Kanäle `alpha`, `beta` oder `main` wird die iOS-App
  archiviert und zu TestFlight hochgeladen. Ein anderer Vorabkanal (`-rc.1`) MUST NOT hochgeladen
  werden.
- MUST: Nach Apples Verarbeitung hängt die CI den Build an die Gruppen seines Kanals: `alpha` an
  „Intern“, `beta` und `main` an „Intern“ und „Extern“. Ein Alpha-Build MUST NOT einer externen
  Gruppe zugewiesen werden.
- MUST: Für „Extern“ reicht die CI den Build zur Beta-Prüfung ein, sofern für ihn noch keine läuft.
- MUST: „Was testen“ beginnt mit der vollen Version (`Lifeline 1.0.0-alpha.196`).
- MUST: Upload und Verteilung halten weder Release noch Deployment auf.
- SHOULD: Fehlende Gruppen legt die CI selbst an, „Intern“ als interne Gruppe ohne Zugriff auf
  alle Builds, „Extern“ ohne öffentlichen Link.

## Prüfung

```sh
verlange '[(]alpha[|]beta[)]' scripts/ios/testflight.sh
verlange "alpha: \['Intern'\]" scripts/ios/testflight-verteilen.mjs
verlange '^  verteilen:' .github/workflows/ios.yml
verbiete "contains\(needs\.vorbereiten\.outputs\.tag, '-beta\.'\)" .github/workflows/artefakte.yml
# Verhalten im Detail: scripts/ios/testflight.test.sh und testflight-verteilen.test.mjs (Schritt 8).
```

## Kontext

Die Spec `ios-auslieferung` (LLH-1978, eingefroren) ließ nur Beta- und stabile Tags zu TestFlight.
Eine Begründung stand im Entwurf nicht. Bisher gibt es nur Alphas, der erste Build hätte also auf
einen Beta-Tag gewartet. Ruben will die Alpha-Stände auf dem Gerät haben, aber nur intern. In
TestFlight sehen alle Kanäle gleich aus („1.0.0 (Build)“), deshalb verteilt die CI selbst und
schreibt die volle Version nach „Was testen“.

## Konsequenzen

Jeder Alpha-Tag kostet einen macOS-Lauf und bis zu 45 Minuten Warten auf Ubuntu; das Repository
ist öffentlich, die Minuten sind frei. Tester und die Testinformationen für das externe Testen
pflegt weiter ein Mensch in App Store Connect. Diese ADR löst die Alpha-Regel der Spec
`ios-auslieferung` ab; deren übrige Anforderungen gelten unverändert.
