---
id: ADR-0090
titel: iOS-Push läuft über ein Relais mit Ende-zu-Ende-verschlüsselter Nutzlast
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - push-relais/**
  - src/ios_push/**
  - src/routes/ios_push.rs
  - ios/Benachrichtigungsdienst/**
  - ios/Gemeinsam/**
  - frontend/src/alarm/iosPush.ts
herleitung:
  - docs/superpowers/specs/2026-11-22-mbbk7iwo-ios-apns-alarme-design.md
  - https://zunder.rubeen.dev/#/aufgabe/mbbk7iwoaarmf1z57qc8ffwo
---

# ADR-0090: iOS-Push läuft über ein Relais mit Ende-zu-Ende-verschlüsselter Nutzlast

## Regeln

- MUST: Den APNs-Schlüssel (`.p8`) hält nur das Push-Relais (`push-relais/`); kein
  Lifeline-Server und keine App trägt ihn oder spricht APNs selbst an.
- MUST: Ein Lifeline-Server spricht das Relais nur mit `--ios-push` an (Vorgabe aus) und meldet
  sich dort erst beim ersten Versand selbst an.
- MUST: Titel, Detail, Pfad, Absender, Wortlaut, Einsatz und Servername gehen nur verschlüsselt
  an das Relais: AES-256-GCM mit dem Schlüssel des Geräts, je Nachricht eine frische Nonce,
  AAD = `kennung`. Unverschlüsselt sind nur Token, Umgebung, Stufe, `kennung` und die gehashte
  Kollaps-Kennung.
- MUST NOT: Das Relais entschlüsselt eine Nutzlast oder speichert Token oder Nutzlast.
- MUST NOT: Token, Geräteschlüssel, Geheimnis des Relais-Zugangs oder Nutzlast stehen in einem
  Log, weder am Server noch am Relais (`push-relais/AGENTS.md`, „Nie loggen“).
- MUST: Eine Anmeldung hängt an Konto und Gerät (`kennung`), nicht an der Sitzung; der Ablauf
  einer Sitzung lässt sie stehen. Wodurch sie endet: `src/AGENTS.md`, „iOS-Push“.
- MUST: Ein Fehler beim iOS-Push verzögert oder scheitert nie die auslösende Anfrage; der Versand
  läuft in einem eigenen Task und wird nie abgewartet.
- MUST: Die App bleibt Hülle (ADR-0068): sie liefert über die Brücke Kennung, Token, Umgebung und
  Schlüssel; Schalter, Abgleich und Stumm-Wahl trägt die Oberfläche, das Entschlüsseln die
  Extension ohne Netz (`ios/AGENTS.md`, „Push über APNs“).

## Prüfung

```sh
# Kein APNs-Schlüssel und kein APNs-Host außerhalb des Relais.
verbiete 'api(\.sandbox)?\.push\.apple\.com|AuthKey|\.p8' 'src/**/*.rs' 'ios/**/*.swift' 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'
# Der Server verschlüsselt, das Relais öffnet nichts und speichert kein Token.
verlange 'Cipher::aes_256_gcm\(\)' src/ios_push/krypto.rs
verbiete '(aes|Aes|AES|gcm|Gcm|GCM|decrypt)' 'push-relais/src/**/*.rs' push-relais/Cargo.toml
verbiete 'token' 'push-relais/migrations/*.sql'
# Opt-in, Versand im eigenen Task.
verlange 'env = "LIFELINE_IOS_PUSH", default_value_t = false' src/config.rs
verlange 'tokio::spawn\(async move \{ ios\.versenden_jetzt' src/ios_push/mod.rs
# Die Sitzung ist an der Anmeldung nur ein Merker.
verlange 'session_token_hash +TEXT REFERENCES session\(token_hash\) ON DELETE SET NULL' 'migrations/*.sql'
# Kein Token, Schlüssel, Geheimnis oder Inhalt im Log (Feld oder Text in einer Zeile).
verbiete 'tracing::[a-z]+!\(.*(token|schluessel|geheimnis|nutzlast|klartext)' 'src/ios_push/**/*.rs' src/routes/ios_push.rs 'push-relais/src/**/*.rs'
verbiete '(token|schluessel|geheimnis|nutzlast|klartext)[[:space:]]*=[[:space:]]*[%?][A-Za-z_&(]' 'src/ios_push/**/*.rs' src/routes/ios_push.rs 'push-relais/src/**/*.rs'
# Die Extension und ihr gemeinsamer Code gehen nicht ins Netz.
verbiete 'URLSession|URLRequest' 'ios/Benachrichtigungsdienst/**/*.swift' 'ios/Gemeinsam/**/*.swift'
```

## Kontext

Die iOS-App bekam im Hintergrund nichts: iOS hält sie an, und im WKWebView gibt es kein Web Push
(R45). APNs nimmt Pushes nur mit dem Schlüssel des Apple-Entwicklerkontos an, Lifeline-Server
betreiben aber viele Betreiber selbst; ein Schlüssel bei jedem von ihnen ließe sich weder schützen
noch je Server sperren. Absender, Wortlaut und Einsatz einer Meldung sollen weder Apple noch das
Relais erreichen.

## Konsequenzen

Betreiber brauchen keinen Kontakt zum Projekt: ihr Server meldet sich selbst am Relais an, und das
Relais sperrt einzelne Server. Dafür läuft ein zweiter Dienst, den das Projekt betreibt; fällt er
aus, kommt kein iOS-Push, Web Push und die offene App bleiben (R52). Für die iOS-App gelten die
Aussagen der eingefrorenen Specs `web-push` (kein Push-Schalter in einer Hülle) und `ios-huelle`
(keine Meldung im Hintergrund) nicht mehr; die Desktop-Hülle bleibt ohne Schalter.
