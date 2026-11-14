---
id: ADR-0046
titel: Webhooks sind mit dem Instanzschlüssel signiert und gehen nur an geprüfte Adressen
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/public_api/webhook/**
  - src/routes/anbindungen_webhook.rs
herleitung:
  - openspec/changes/archive/2026-11-13-z6ds0ed9-webhooks-outbox/design.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
---

# ADR-0046: Webhooks sind mit dem Instanzschlüssel signiert und gehen nur an geprüfte Adressen

## Regeln

- MUST: Eine Webhook-Zustellung trägt im Kopf `Lifeline-Signature` ein JWS mit `typ`
  `lifeline-event+jwt`, signiert mit dem Instanzschlüssel; `aud` ist die Kennung des Webhooks,
  `exp` liegt höchstens 300 s nach `iat`, `bh` ist der SHA-256 des Bodys.
- MUST NOT: Ein Webhook trägt ein geteiltes Geheimnis (HMAC) oder ein Token des Empfängers.
- MUST: Der Body einer Zustellung ist genau ein Ereignis des Abrufs `GET /api/v1/events`; der
  Webhook liest nur die Zeilen seines Zugangs und schreibt nie in `maschine_ereignis` (ADR-0038).
- MUST: Der Client der Webhooks folgt keiner Weiterleitung, nimmt keinen Proxy aus der Umgebung
  und verbindet sich nur mit Adressen, die sein eigener Resolver geprüft hat.
- MUST: Loopback, Link-Local, Multicast, Broadcast und unbestimmte Adressen sind immer gesperrt;
  private Netze nur, wenn der Admin am Webhook die LAN-Ausnahme gesetzt hat.
- MUST NOT: Die Antwort eines Ziels wird gespeichert; festgehalten werden nur Status, Fehlerart
  und Dauer.
- MUST: Über ein zuzustellendes Ereignis rückt der Cursor nur nach einer `2xx`-Antwort vor; ein
  Fehlschlag hält die folgenden zurück. Über nicht gewählte oder nicht erlaubte Arten rückt er
  hinweg, über ein gelöschtes wartendes Ereignis springt er auf den Höchststand und hält den
  Verlust fest, auch wenn der Zugang gerade ruht.
- MUST: Ein Ergebnis gilt nur für den Stand, mit dem der Versuch begann; hat ein Admin den Webhook
  inzwischen geändert, steht es nur im Verlauf.

## Prüfung

```sh
verlange '\.no_proxy\(\)' src/public_api/webhook/ziel.rs
verlange 'redirect::Policy::none\(\)' src/public_api/webhook/ziel.rs
verlange 'dns_resolver\(Arc::new\(WebhookResolver' src/public_api/webhook/ziel.rs
verlange 'pub const EVENT_TYP: &str = "lifeline-event\+jwt"' src/instanz/signatur.rs
verbiete '[Hh]mac' 'src/public_api/webhook/**/*.rs'
verbiete 'INSERT (OR [A-Z]+ )?INTO maschine_ereignis' 'src/public_api/webhook/**/*.rs'
```

## Kontext

Fremdsysteme sollen Ereignisse zugestellt bekommen, ohne selbst abzurufen. Ein Webhook schickt
Daten aus dem Einsatz an eine Adresse, die ein Admin eintippt; ohne Schutz wäre das ein Weg in
interne Netze (DNS-Rebinding, Weiterleitung, Proxy). Ein HMAC-Geheimnis müsste die Instanz
speichern und der Empfänger geheim halten; der Instanzschlüssel liegt dem Empfänger schon seit
dem Einlösen vor.

## Konsequenzen

Der Empfänger prüft mit dem Schlüssel, den er ohnehin hat, und kann eine Zustellung nicht an
einen anderen Empfänger weiterreichen. Ein Ziel im LAN mit selbstsigniertem Zertifikat scheitert
an TLS, bis Zertifikats-Pinning kommt (LLH-1872). Zugestellt wird mindestens einmal; der
Empfänger entdoppelt über `id`.
