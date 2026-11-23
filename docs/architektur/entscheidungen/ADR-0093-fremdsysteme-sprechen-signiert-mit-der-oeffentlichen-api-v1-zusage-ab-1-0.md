---
id: ADR-0093
titel: Fremdsysteme sprechen signiert mit der öffentlichen API unter /api/v1, deren Zusage ab 1.0.0 gilt
status: akzeptiert
datum: 2026-11-23
gilt_fuer:
  - src/app.rs
  - src/api_doc.rs
  - src/public_api/**
  - src/routes/anbindungen.rs
  - crates/lifeline-machine-client/**
  - src/instanz/signatur.rs
ersetzt: ADR-0022
herleitung:
  - docs/superpowers/specs/2026-11-22-demuxo3r-api-routen-englisch-design.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0093: Fremdsysteme sprechen signiert mit der öffentlichen API unter /api/v1, deren Zusage ab 1.0.0 gilt

## Regeln

- MUST: Routen für Fremdsysteme liegen unter `/api/v1/`; nur sie tragen eine Stabilitätszusage
  (innerhalb von v1 nur hinzufügen), die übrige API keine. Die Zusage gilt ab Version 1.0.0.
- MUST NOT: Ab 1.0.0 verschwindet kein Pfad unter `/api/v1/`, auch nicht nach der Alias-Frist
  von ADR-0085; Entfernen und Umbenennen gehen über `/api/v2/`.
- MUST: Pfade unter `/api/v1/` folgen ADR-0085; die übrigen Namen auf dem Wire (Felder, Werte,
  Scopes, Ereignisarten, Fehlercodes, Kopfzeilen) folgen der Wurzel-`AGENTS.md`,
  „Bezeichner-Sprache“.
- MUST: Ein Fremdsystem meldet sich nach ADR-0014 an: eigenes Ed25519-Paar, Einstieg per
  Einmal-Code eines Org-Admins, je Anfrage ein JWS mit `typ` `lifeline-machine+jwt` im Kopf
  `Authorization: Machine`, Claims `iss`, `aud` (Instanz-UUID), `iat`, `exp`, `jti`, `htm`, `htu`,
  `bh`; geprüft in einem Extractor vor dem Handler.
- MUST NOT: Eine Route unter `/api/v1/` nimmt ein Bearer-Token, ein Sitzungs-Cookie oder ein
  geteiltes Geheimnis an; Ausnahme ist allein der Einwurf nach ADR-0023.
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
verlange 'ab Version 1\.0\.0' src/public_api/description.md
```

## Kontext

ADR-0022 sagte v1 ab dem ersten Tag zu, „innerhalb von v1 nur hinzufügen“. Ruben hat am
22.11.2026 entschieden, dass auch die v1-Pfade englisch werden, weil noch nichts veröffentlicht
ist (ADR-0085). Die Umbenennung bricht v1, also beginnt die Zusage erst mit 1.0.0. Die übrigen
Regeln von ADR-0022 bleiben unverändert.

## Konsequenzen

Bis 1.0.0 darf v1 brechen, wenn ein Paket von LLH-1979 oder eine eigene Entscheidung das
verlangt. Ein Fremdsystem, das schon gegen die deutschen Pfade gebaut wurde, zieht einmal um.
Ab 1.0.0 gilt die Zusage wie zuvor, und eine Umbenennung braucht `/api/v2/`.
