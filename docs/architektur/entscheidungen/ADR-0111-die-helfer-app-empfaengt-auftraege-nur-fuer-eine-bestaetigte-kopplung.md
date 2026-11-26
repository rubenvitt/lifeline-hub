---
id: ADR-0111
titel: Die Helfer-App empfängt Aufträge nur für eine bestätigte Kopplung, iOS über das Relais ohne Inhalt, Android über die eigene Verbindung zum Server
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - ios/Helfer/**
  - ios/HelferKern/**
  - android/helfer/**
  - android/helferkern/**
  - src/helfer/**
  - push-relais/src/**
herleitung:
  - docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md
  - https://zunder.rubeen.dev/#/aufgabe/c19brpvf22lzcfr0i43vcl4q
---

# ADR-0111: Die Helfer-App empfängt Aufträge nur für eine bestätigte Kopplung, iOS über das Relais ohne Inhalt, Android über die eigene Verbindung zum Server

## Regeln

- MUST: Der Server stellt Aufträge nur an bestätigte, nicht beendete Helfer-Kopplungen eines
  aktiven Einsatzes zu und prüft das bei jeder Zustellung frisch (`src/helfer/pager.rs`).
- MUST: Unter iOS geht ein Auftrag nur über das Push-Relais an APNs, die Nutzlast ist
  Ende-zu-Ende verschlüsselt wie in ADR-0090. Die Push-Anmeldung gehört der Kopplung und endet
  mit ihr (`helfer_push_anmeldung`).
- MUST: Unter Android empfängt die App nur über eine Verbindung zum Server ihrer Kopplung im
  sichtbaren Vordergrund-Dienst (`remoteMessaging`). Kein FCM und kein anderer Pushdienst. Der
  Dienst startet nur aus dem Vordergrund.
- MUST: Die Quittung läuft über die Quittung der Empfängerzeile (`auftrag_empfaenger`), nicht über
  einen eigenen Speicher.
- MUST NOT: Aufträge auf dem Gerät auf die Platte schreiben.
- Ergänzt ADR-0101: „sendet nur an den Server ihrer Kopplung“ gilt weiter für alles, was die App
  sendet; APNs ist unter iOS der einzige zusätzliche Weg, und nur hinein.

## Prüfung

```sh
# Kein Google-Push in der Android-Helfer-App.
verbiete 'firebase' 'android/helfer/**/*.kts' 'android/helfer/**/*.kt' 'android/helfer/**/*.xml'
# iOS empfängt über APNs (nur das Ziel der Helfer-App), Android über einen Dienst vom Typ
# remoteMessaging neben location.
verlange 'aps-environment' 'ios/Helfer/App/LifelineHelfer.entitlements'
verlange 'foregroundServiceType="location[|]remoteMessaging"' 'android/helfer/src/main/AndroidManifest.xml'
```

## Kontext

Die Helfer-App (ADR-0101) ist am Einsatz angemeldet und soll im laufenden Einsatz Aufträge mit
Quittung empfangen, auch bei geschlossener App (LLH-2111). Unter iOS geht das nur über APNs. Die
Android-App wird ohne Play-Dienste verteilt; FCM fällt damit aus.

## Konsequenzen

iOS-Aufträge kommen auch bei beendeter App an; das Relais lernt eine zweite Bundle-ID, sieht aber
keinen Inhalt. Unter Android hängt der Empfang am laufenden Vordergrund-Dienst: Beendet das System
den Prozess, kommt nichts an, und die fehlende Benachrichtigung zeigt das. Die Leitung sieht an
der fehlenden Quittung, dass sie über Funk nachfassen muss.
