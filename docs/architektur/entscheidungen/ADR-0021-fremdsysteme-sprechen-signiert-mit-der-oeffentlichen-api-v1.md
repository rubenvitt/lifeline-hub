---
id: ADR-0021
titel: Fremdsysteme sprechen signiert und mit festen Zwecken mit der öffentlichen API unter /api/v1
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

# ADR-0021: Fremdsysteme sprechen signiert und mit festen Zwecken mit der öffentlichen API unter /api/v1

## Regeln

- MUST: Routen für Fremdsysteme liegen unter `/api/v1/`; nur sie tragen eine Stabilitätszusage
  (innerhalb von v1 nur hinzufügen), die übrige API keine.
- MUST: Ein Fremdsystem meldet sich nach ADR-0014 an: eigenes Ed25519-Paar, Einstieg per
  Einmal-Code eines Org-Admins, je Anfrage ein JWS mit `typ` `lifeline-maschine+jwt` im Kopf
  `Authorization: Maschine`, Claims `iss`, `aud` (öffentliche Basis-URL), `iat`, `exp`, `jti`,
  `htm`, `htu`, `bh`.
- MUST NOT: Eine Route unter `/api/v1/` nimmt ein Bearer-Token, ein Sitzungs-Cookie oder ein
  geteiltes Geheimnis an; einzige Ausnahme ist der Einwurf nach ADR-0022.
- MUST: Ein Maschinenzugang gehört genau einer Org und trägt feste Zwecke; ein Extractor prüft
  Signatur, Widerruf, Ablauf, Zweck und Org vor dem Handler. Einsatzbezogenes Lesen braucht die
  Freigabe der Einsatzleitung.
- MUST: Anlegen, Schlüsselbindung, Änderung und Widerruf eines Zugangs stehen in `admin_audit`;
  jeder Abruf zählt im Abrufprotokoll je Zugang, Route und Tag.
- MUST: Jeder Zugang ist gedrosselt (429 mit `Retry-After`); unbekannter Schlüssel und falsche
  Signatur zählen in die IP-Sperre (`src/auth/rate_limit.rs`). Nach außen bleibt jede Ablehnung
  ein 401 ohne Grund, der Grund steht am Zugang im Admin-Bereich.
- MUST: Die Pfade unter `/api/v1/` stehen in einem eigenen OpenAPI-Dokument mit Drift-Test;
  `src/api_doc.rs` bleibt ohne Pfade (ADR-0004).
- MUST: Fehler unter `/api/v1/` tragen neben `error` einen stabilen `code`.
- MUST NOT: Eine Antwort unter `/api/v1/` enthält Namen, Personenkennungen, freie Notizen oder
  Gesundheitsdaten.
- MUST: Hinaus geht v1 als Abruf (`/api/v1/ereignisse`); ein späterer Webhook wird mit dem
  Instanzschlüssel signiert, nie per HMAC.
- SHOULD: Ein Token-Endpunkt (OAuth2 `private_key_jwt`) kommt nur mit eigener ADR.

## Prüfung

```sh
verbiete '[Bb]earer' 'src/maschine/**'
verlange 'impl FromRequestParts<AppState> for Maschine' 'src/maschine/**'
verlange 'lifeline-maschine\+jwt' 'src/maschine/**'
verbiete 'utoipa::path|paths\(' src/api_doc.rs
```

## Kontext

Bis November 2026 kannte Lifeline Hub als Maschinen nur gekoppelte Instanzen (ADR-0014), daneben
zwei Bearer-Lesewege (Lagemonitor, Lagebild-Link). Alarmübernahme, Lagemonitor, Rechner und
Einsatzbuch der iuk-suite brauchen eine Anmeldung für Fremdsysteme und einen festen Vertrag. Ruben
hat am 11.11.2026 Zwecke je Zugang, `/api/v1` mit eigenem Dokument und Abruf statt Webhook gewählt
und für die Anmeldung „möglichst zugänglich, vor allem sicher“ vorgegeben.

## Konsequenzen

Kein Geheimnis ist im Umlauf, jede Anfrage ist an Methode, Pfad und Body gebunden. Ein Client
braucht Ed25519 und etwa 40 Zeilen Code; Referenz-Clients, Testvektoren und `GET /api/v1/ich`
fangen das ab. Der Lagemonitor zieht um (LLH-1638); der Lagebild-Link ist kein Maschinenzugang und
bleibt.
