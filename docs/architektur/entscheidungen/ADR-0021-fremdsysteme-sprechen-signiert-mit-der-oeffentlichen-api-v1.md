---
id: ADR-0021
titel: Fremdsysteme sprechen signiert und mit festen Scopes mit der öffentlichen API unter /api/v1
status: vorgeschlagen
datum: 2026-11-11
gilt_fuer:
  - src/app.rs
  - src/api_doc.rs
  - src/instanz/signatur.rs
  - src/lagemonitor_zugang/**
  - src/routes/lagemonitor_v1.rs
herleitung:
  - docs/konzepte/2026-11-11-oeffentliche-api.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0021: Fremdsysteme sprechen signiert und mit festen Scopes mit der öffentlichen API unter /api/v1

## Regeln

- MUST: Routen für Fremdsysteme liegen unter `/api/v1/`; nur sie tragen eine Stabilitätszusage
  (innerhalb von v1 nur hinzufügen), die übrige API keine.
- MUST: Namen auf dem Wire unter `/api/v1/` (Pfade, Felder, Werte, Scopes, Ereignisarten,
  Fehlercodes, Kopfzeilen) folgen der Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
- MUST: Ein Fremdsystem meldet sich nach ADR-0014 an: eigenes Ed25519-Paar, Einstieg per
  Einmal-Code eines Org-Admins, je Anfrage ein JWS mit `typ` `lifeline-machine+jwt` im Kopf
  `Authorization: Machine`, Claims `iss`, `aud` (Instanz-UUID), `iat`, `exp`, `jti`, `htm`, `htu`,
  `bh`; geprüft in einem Extractor vor dem Handler.
- MUST NOT: Eine Route unter `/api/v1/` nimmt ein Bearer-Token, ein Sitzungs-Cookie oder ein
  geteiltes Geheimnis an; Ausnahme ist allein der Einwurf nach ADR-0022.
- MUST: Ein Zugang gehört genau einer Org und trägt feste Scopes; der Extractor prüft Signatur,
  Widerruf, Ablauf, Scope und Org. Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung.
- MUST: Eine gescheiterte Anmeldung antwortet 401 ohne Grund; der Grund steht am Zugang im
  Admin-Bereich.
- MUST: Anlegen, Schlüsselbindung, Änderung und Widerruf eines Zugangs stehen in `admin_audit`;
  jeder Abruf zählt im Abrufprotokoll je Zugang, Route und Tag.
- MUST: Jeder Zugang ist gedrosselt (429 mit `Retry-After`). Unbekannte Schlüssel zählen je IP in
  einem eigenen Zähler für Maschinen, nie in der Anmeldesperre (`src/auth/rate_limit.rs`).
- MUST: Die Pfade unter `/api/v1/` stehen mit eigenen Schemas in einem eigenen OpenAPI-Dokument
  mit Drift-Test; `src/api_doc.rs` bleibt ohne Pfade.
- MUST: Fehler unter `/api/v1/` tragen neben `error` einen stabilen `code`.
- MUST NOT: Eine Antwort, ein Ereignis oder ein Webhook unter v1 enthält Namen,
  Personenkennungen, freie Notizen oder Gesundheitsdaten.
- MUST: Ausgangsereignisse entstehen in derselben Transaktion wie die Änderung in einer Outbox;
  Abruf und Webhooks lesen aus ihr. Ein Webhook ist mit dem Instanzschlüssel signiert und an das
  Abo gebunden (`aud`), nie per HMAC; interne Ziele lehnt er ab.
- SHOULD: Ein Token-Endpunkt (OAuth2 `private_key_jwt`) kommt nur mit eigener ADR.

## Prüfung

```sh
verbiete '[Bb]earer' 'src/public_api/**'
verlange 'impl FromRequest<AppState> for MachineClient' 'src/public_api/**'
verlange 'lifeline-machine\+jwt' 'src/public_api/**'
verbiete 'utoipa::path|paths\(' src/api_doc.rs
```

## Kontext

Bis November 2026 kannte Lifeline Hub als Maschinen nur gekoppelte Instanzen (ADR-0014), daneben
zwei Bearer-Lesewege (Lagemonitor, Lagebild-Link). Alarmübernahme, Lagemonitor, Rechner und
Einsatzbuch der iuk-suite brauchen eine Anmeldung für Fremdsysteme und einen festen Vertrag. Ruben
hat am 11.11.2026 Scopes je Zugang, `/api/v1` mit eigenem Dokument, eine Outbox mit Abruf vor
Webhooks und die Bezeichner-Sprache auch auf dem Wire gewählt und für die Anmeldung „möglichst
zugänglich, vor allem sicher“ vorgegeben.

## Konsequenzen

Kein Geheimnis ist im Umlauf, jede Anfrage ist an Methode, Pfad und Body gebunden; Referenz-Clients,
Testvektoren und `GET /api/v1/me` fangen den Aufwand im Client ab. Ein Gerät mit falscher Uhr sperrt
niemanden aus, es sieht nur 401 und der Admin den Grund. Der Lagemonitor zieht um (LLH-1638); der
Lagebild-Link ist kein Maschinenzugang und bleibt.
