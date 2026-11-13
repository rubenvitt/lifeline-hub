# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/f658d8o6lb9iyedtr5c7wgx0 (LLH-1638)

## Why

Externe Lagemonitore lesen seit LLH-1484 mit einem Bearer-Schlüssel `llh_lm_…`, der nie abläuft,
nicht gedrosselt ist und über Menschen und die Suite-Datenbank zum Monitor wandert (R33). Seit
LLH-1652 gibt es den Maschinenzugang nach ADR-0022: eigenes Schlüsselpaar, signierte Anfragen,
feste Scopes. Der Lagemonitor zieht dorthin um, bevor seine Gegenseite (LGM-14) gebaut wird, und
ist zugleich der erste Lesefall der öffentlichen API.

## What Changes

- **Neue Route `GET /api/v1/lage`** mit Scope `lage:read`: das Lagebild des Einsatzes, den die
  Einsatzleitung für die Anbindung freigegeben hat. Inhalt wie die bisherige Schnittstelle, in
  einem eigenen v1-Schema und mit den Wire-Namen der öffentlichen API.
- **Freigabe der Einsatzleitung für Anbindungen:** Auf der Seite „Geräte“ eines Einsatzes steht
  ein Paneel „Anbindungen“ mit einem Schalter je Anbindung, die Lage lesen darf. Eine Anbindung
  liest höchstens einen Einsatz. Die Freigabe geht auch an einem Einsatz, den die Instanz nur
  als Spiegel hält, weil Fremdsysteme am Hub ankommen.
- **Die Freigabe endet** mit dem Abschluss des Einsatzes, dem Widerruf oder Ablauf der Anbindung
  und dem Entzug des Rechts „Lage lesen“.
- **Die Seite „Anbindungen“** zeigt je Anbindung, welchen Einsatz sie gerade liest.
- **BREAKING: Der alte Weg entfällt ohne Übergangszeit** (Entscheidung Ruben, 12.11.2026,
  abweichend von D6 des Konzepts, weil die Gegenseite noch nicht gebaut ist):
  `GET /api/lagemonitor/v1/lage`, die Schlüssel `llh_lm_…`, die Verwaltungsseite „Lagemonitore“,
  das Paneel „Externe Lagemonitore“ und die Tabellen `lagemonitor_zugang` und
  `lagemonitor_freigabe`. Bestehende Schlüssel gelten nach dem Update nicht mehr.
- **Referenz-Client:** Der Rust-Client und das Kommando `lifeline-hub zugang` lesen die Lage;
  darauf baut der Lagemonitor auf.
- **Entscheidung als ADR-0035** festgehalten: einsatzbezogenes Lesen eines Maschinenzugangs
  läuft immer über die Freigabe, an der Instanz des Zugangs.

## Capabilities

### New Capabilities

- `lage-schnittstelle`: `GET /api/v1/lage` für Fremdsysteme: Inhalt des Lagebilds, kein
  Personenbezug, Karte mit Fassung, Verhalten ohne Freigabe und an einem Spiegel.

### Modified Capabilities

- `maschinenzugang`: neue Anforderungen zur Freigabe eines Einsatzes durch die Einsatzleitung
  (ein Einsatz je Zugang, auch am Spiegel, Ende der Freigabe, Anzeige am Zugang); das Szenario
  „Bearer“ nennt keinen Lagemonitor-Schlüssel mehr.
- `lagemonitor`: Die Anforderung „Hilfeleistungen in der Reihe ‚Sanitätsdienst‘“ verweist für
  externe Anzeigen auf `GET /api/v1/lage` statt auf die entfallene Schnittstelle mit
  `api_version`.

## Impact

- **Backend:** `src/public_api/` (neue Route, Schema, Freigabe-Repo), neue Admin-Routen am
  Einsatz, `src/routes/anbindungen.rs`, `src/einsatz/repo.rs` (Abschluss),
  `src/einsatz/schwaerzung_registry.rs`, `src/instanz/spiegel/art.rs`; entfernt werden
  `src/lagemonitor_zugang/`, `src/routes/lagemonitor_zugang.rs` und `src/routes/lagemonitor_v1.rs`
  (was das Lagebild für Externe davon nutzt, zieht nach `src/routes/lagemonitor.rs`).
- **Datenbank:** zwei Migrationen (neue Tabelle `maschinenzugang_freigabe`; die beiden
  Lagemonitor-Tabellen entfallen samt Inhalt).
- **Öffentliche API:** neuer Pfad und neue Schemas in `docs/api/public-v1.json`; die interne
  Typquelle (`frontend/src/api/openapi.json`) verliert `LagemonitorLage`, `LagemonitorEinsatz` und
  die `Lesezugang…`-Typen.
- **Frontend:** neues Paneel `EinsatzAnbindungen`, Anzeige des gelesenen Einsatzes in
  „Anbindungen“; entfernt werden `LagemonitorZugaenge`, `EinsatzLagemonitore`, ihr API-Client und
  ihre Query-Keys.
- **Client-Crate:** `crates/lifeline-machine-client` bekommt den Abruf der Lage.
- **Doku:** `docs/api/maschinenzugang.md`, Anwenderkapitel „Externe Lagemonitore“,
  „Anbindungen“, „Verwaltung“, „Zugangsprotokoll“, „Lagebild für Externe“; arc42 Kapitel 5 und
  11 (R33); ADR-0022 (`gilt_fuer`), neue ADR-0035; Nachtrag im Konzept
  `docs/konzepte/2026-11-11-oeffentliche-api.md`.
- **Andere Projekte:** LGM-13 trägt nur noch Adresse und Widget-Schalter, LGM-14 liest
  `GET /api/v1/lage` mit dem Referenz-Client. Beides liegt außerhalb dieses Repos.
