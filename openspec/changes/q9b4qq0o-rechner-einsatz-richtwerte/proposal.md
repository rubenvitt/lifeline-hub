# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/q9b4qq0o5gzcuogpolrwtbt4 (LLH-1856)

## Why

Die Rechner-API Unterkunft (LLH-1524) rechnet mit Anfrage → Organisation → Basis. Die Werte, die ein
Einsatz für sich gesetzt hat, blieben draußen, weil es am 12.11.2026 keine Einsatz-Freigabe für
Maschinenzugänge gab (Change `p4h3v7q9-rechner-api-unterkunft`, `design.md` D1). Diese Freigabe
gibt es seit LLH-1638 (ADR-0035, `public_api::freigabe`). Ein Fremdsystem, das für einen laufenden
Einsatz plant, rechnet heute mit anderen Werten als die Einsatzleitung im Unterkunftsrechner.

## What Changes

- Optionales Feld `einsatz_id` im Body von `POST /api/v1/rechner/unterkunft` und optionaler
  Abfrageparameter `einsatz_id` an `GET /api/v1/rechner/unterkunft/richtwerte`.
- Mit `einsatz_id` gelten die Ebenen Anfrage → Einsatz → Organisation → Basis; neue Herkunft
  `einsatz` im v1-Enum `RichtwertEbene` (additiv, Stabilitätszusage v1 bleibt).
- Die Einsatz-Werte bekommt nur ein Zugang mit `rechner:use`, für den die Einsatzleitung genau
  diesen Einsatz freigegeben hat (wirksame Freigabe nach ADR-0035). Sonst, auch bei einem fremden,
  abgeschlossenen oder unbekannten Einsatz, 404 `not_found` mit stets derselben Antwort.
- Das Freigabemodell bleibt: freigeben lässt sich ein Zugang weiter nur mit `lage:read` oder
  `einsaetze:read`. Die Doku empfiehlt einem Rechner-Zugang, der Einsatz-Werte braucht,
  `einsaetze:read` dazu; darüber findet er die `einsatz_id` (`GET /api/v1/einsaetze`).
- Ohne `einsatz_id` bleibt alles wie heute. **Kein Bruch** für bestehende Clients: `einsatz_id`
  war bisher 400 (unbekanntes Feld), jetzt ist es ein gültiges Feld.
- Doku: `docs/api/maschinenzugang.md`, Anwenderkapitel „Anbindungen“ und „Betreuung“,
  `frontend/src/betreuung/AGENTS.md`, Bausteinsicht.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `rechner-api-unterkunft`: Die Ebenen bekommen den Einsatz (nur für einen freigegebenen Einsatz),
  Antwort und Auskunft die Herkunft `einsatz`, die Auskunft den Abfrageparameter `einsatz_id`;
  das Beispiel „unbekanntes Feld“ trägt nicht mehr `einsatz_id`.

## Impact

- Backend: `src/public_api/rechner.rs` (Wire-Formen, Ebenen, beide Handler),
  `src/public_api/freigabe.rs` (Prüfung „dieser Einsatz ist für den Zugang lesbar“),
  `src/unterkunft/repo.rs` (`einsatz_werte`, unverändert genutzt).
- Tests: `tests/rechner_api.rs`, `src/public_api/rechner/tests.rs`, `tests/enum_wire_kontrakt.rs`.
- Generiert: `docs/api/public-v1.json` (OpenAPI v1). Das Frontend nutzt die v1-Typen nicht.
- Doku: `docs/api/maschinenzugang.md`, `docs/anwender/kapitel/anbindungen.md`,
  `docs/anwender/kapitel/betreuung.md`, `frontend/src/betreuung/AGENTS.md`,
  `docs/architektur/05-bausteinsicht.md`.
- Keine Migration, keine Änderung an Freigabe, Paneel „Anbindungen“ oder Spec `maschinenzugang`.
