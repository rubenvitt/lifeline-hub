# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/h5zpb97tswv8zkomby2gc5et (LLH-1653, Unteraufgabe von
LLH-1148)

## Why

Das Konzept zur öffentlichen API (`docs/konzepte/2026-11-11-oeffentliche-api.md`, D3 und D9) und
ADR-0022 legen fest: Alles für Fremdsysteme liegt unter `/api/v1/` und hat einen festen Vertrag.
Dazu gehören ein eigenes OpenAPI-Dokument mit Pfaden und ein stabiler Fehlercode. Heute gibt es
unter `/api/v1/` keine Route. Das einzige OpenAPI-Dokument (`src/api_doc.rs`) kennt nur Schemas,
und Fehler tragen nur deutschen Text. Bevor LLH-1652 (Maschinenzugang), LLH-1638, LLH-1655,
LLH-1654 und LLH-1524 ihre Routen bauen, braucht es das Gerüst, in das sie sich einhängen. Die
Regeln des Vertrags müssen dort von Anfang an gelten, nicht erst nachträglich.

## What Changes

- Neues Modul `src/public_api/` mit einem Router unter `/api/v1`, bei dem jede Route zusammen mit
  ihrem Eintrag im OpenAPI-Dokument entsteht. Dafür kommt die neue Abhängigkeit `utoipa-axum` 0.3
  hinzu, passend zu utoipa 6 und axum 0.8.
- `GET /api/v1/openapi.json` ist ohne Anmeldung erreichbar und liefert das Dokument. Es liegt
  versioniert unter `docs/api/public-v1.json`.
- Ein Drift-Test schreibt das Dokument neu, wenn es veraltet ist, und schlägt dann fehl. Er läuft
  als eigener Schritt in `scripts/check-typ-codegen.sh`. `frontend/src/api/openapi.json` bleibt
  ohne Pfade.
- Fehler unter `/api/v1/` haben die Form `{"error": "<Text>", "code": "<code>"}` mit einem
  festen, englischen Code. Den Code setzen v1-Handler über einen eigenen `ApiError`. Eine Schicht
  ergänzt ihn bei jeder anderen Fehlerantwort unter `/api/v1/` aus dem Status, etwa bei abgelehnten
  Eingaben, unbekannten Pfaden, 405, 413, 500 und 503.
- Die Beschreibung des Dokuments (`info.description`) enthält:
  - die Stabilitätszusage;
  - die Kurzfassung der Namensregel;
  - die Zeitzone;
  - die Tabelle der Fehlercodes.
- Für v1 gelten eine Body-Grenze von 64 KiB und `Cache-Control: no-store` an jeder Antwort.
- Regeln für v1 in `src/AGENTS.md`; Architekturkapitel nach der Mitänderungsregel.

Nichts davon ist **BREAKING**: Unter `/api/v1/` gibt es bisher keine Route, und die interne API
bleibt unverändert.

## Capabilities

### New Capabilities

- `oeffentliche-api-vertrag`: der Vertrag der öffentlichen API unter `/api/v1/`. Dazu gehören
  das Dokument mit Pfaden und dessen Drift-Schutz, die Stabilitätszusage, die Fehlerform mit
  stabilem Code und die Grenzen und Köpfe, die für jede v1-Route gelten. Anmeldung, Scopes und die
  einzelnen Routen kommen mit den Folgeaufgaben dazu, LLH-1652 zuerst.

### Modified Capabilities

(keine)

## Impact

- **Code:**
  - `src/public_api/` (neu)
  - `src/app.rs` (Router einhängen, Fehlercode-Schicht)
  - `src/lib.rs`
  - `Cargo.toml`, `Cargo.lock` (`utoipa-axum`)
- **Tests:**
  - `tests/public_api_spec_aktuell.rs` (neu)
  - `tests/fehler_vertrag.rs` (v1-Fälle)
  - `tests/enum_wire_kontrakt.rs` (`ErrorCode`)
- **Gate:** `scripts/check-typ-codegen.sh` bekommt einen Schritt.
- **Dateien:** `docs/api/public-v1.json` (neu, erzeugt)
- **Regeln und Doku:**
  - `src/AGENTS.md`
  - Architekturkapitel 8 (Querschnitt) und 9 (Verweis auf ADR-0022), soweit
    `docs/architektur/AGENTS.md` es verlangt
- **Parallel:** LLH-1652 hängt `MachineClient` und seine Routen in `public_api::router()` ein. Ihm
  ist der Schnitt am 12.11.2026 mitgeteilt.
- **Bleibt unverändert:**
  - `src/api_doc.rs` und die Typ-Kette des Frontends (ADR-0004)
  - die Fehlerform `{error}` außerhalb von `/api/v1/`
  - ADR-0022 bleibt `vorgeschlagen`. Akzeptiert wird sie mit LLH-1652.
