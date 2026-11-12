# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Vor jeder Änderung `scripts/adr-fuer.sh <pfad>…`. Cargo-Läufe mit dem Bauziel des Checkouts
(`scripts/AGENTS.md`). Kein `| tail` um Gate-Kommandos.

## 1. Gerüst und Dokument (D1, D4)

- [x] 1.1 Abhängigkeit `utoipa-axum = "0.3"` in `Cargo.toml`. Prüfen: `cargo build`, im
  `Cargo.lock` steht genau ein `utoipa`, nämlich 6.0.
- [x] 1.2 `src/public_api/mod.rs` anlegen und in `src/lib.rs` eintragen.
  - Inhalt: `PublicApiDoc` mit festem `info`, `router()`, `dokument()` (`OnceLock`) und
    `montieren()`.
  - Route `GET /api/v1/openapi.json` mit `#[utoipa::path]`.
  - In `src/app.rs` einmal per `merge` einhängen.
  - Test in `tests/public_api.rs`: der Aufruf ohne Anmeldung gibt 200 und JSON mit
    `paths["/api/v1/openapi.json"]`. Erst rot, dann grün.
- [x] 1.3 `src/public_api/beschreibung.md` als `info.description` anlegen.
  - Inhalt: Stabilitätszusage, Namensregel (Kurzfassung), Zeitpunkte in UTC, Fehlerform,
    Code-Tabelle.
  - Unit-Test: die Tabelle nennt genau die Werte von `ErrorCode`. Entsteht zusammen mit 2.1; erst
    rot mit einem fehlenden Code.
- [x] 1.4 Drift-Test `tests/public_api_spec_aktuell.rs` schreibt `docs/api/public-v1.json`.
  - Probe: eine Änderung am Pfad oder an der Beschreibung macht den Test rot und schreibt die
    Datei neu; der zweite Lauf ist grün.
  - `docs/api/public-v1.json` committen.
- [x] 1.5 `scripts/check-typ-codegen.sh`: Schritt für `public_api_spec_aktuell` und
  `docs/api/public-v1.json` im `git diff --exit-code`; Schrittnummern im Skriptkopf nachziehen.
  - Prüfen: Der Lauf des Skripts ist grün.
  - Mit einer absichtlich veralteten `docs/api/public-v1.json` ist er rot (Probe, danach
    zurücksetzen).
- [x] 1.6 `tests/openapi_spec_aktuell.rs` sichert zu, dass `ApiDoc::openapi()` keine Pfade hat.
  - Probe: Ein vorübergehender `paths(…)`-Eintrag macht den Test rot.
  - `frontend/src/api/openapi.json` bleibt unverändert.

## 2. Fehlercode (D2)

- [x] 2.1 `src/public_api/error.rs`: `ErrorCode` als `wire_enum!` mit den Codes der Spec und
  `fuer_status`, dazu `ApiErrorBody` als Schema.
  - Unit-Tests: je Status der Vorgabe-Code; 4xx ohne eigenen Code ergibt `unprocessable`, 5xx
    ohne eigenen Code ergibt `internal_error`.
  - Einträge in `tests/enum_wire_kontrakt.rs`.
  - Schemas in `PublicApiDoc` aufnehmen.
- [x] 2.2 `ApiError` mit Konstruktoren je Code und `IntoResponse`; `{error, code}`.
  - `From<AppError>`: Status und Text übernehmen. Ein 500 behält den generischen Text, und der
    Schreibschutz des Spiegels wird zu `fuehrung_elsewhere`.
  - Unit-Tests: Datenbankfehler ergibt `internal_error` ohne SQL-Text; Spiegel-Schutz ergibt 409
    `fuehrung_elsewhere`; `tls_required` bleibt 403 `tls_required`.
- [x] 2.3 Schicht `public_api::schicht` in `build_router_mit`, außerhalb der Zulassung.
  - Wirkung: `Cache-Control: no-store` an jeder Antwort unter `/api/v1/`; `code` an jeder
    Fehlerantwort ohne `code`; ein Body, der kein JSON ist, wird ersetzt.
  - Tests in `tests/fehler_vertrag.rs`, erst rot:
    - `GET /api/v1/gibt-es-nicht` ergibt 404 `not_found`.
    - `DELETE /api/v1/openapi.json` ergibt 405 `method_not_allowed`.
    - `GET /api/gibt-es-nicht` bleibt ohne `code`.
    - Erfolg und Fehler unter v1 tragen `no-store`.
    - Ein Fehler mit `Accept-Encoding: br` trägt `code`.
  - Den Envelope-Helfer der Datei um eine Variante mit `code` ergänzen.
- [x] 2.4 Panik und Lastabwurf unter v1. Ein Unit-Test der Schicht (Proberouter mit panischem
  Handler über `montieren`, Zulassung mit kleinem Budget) zeigt:
  - Panik ergibt 500 `internal_error`;
  - Lastabwurf ergibt 503 `unavailable`.

## 3. Body-Grenze (D3)

- [x] 3.1 `PUBLIC_API_BODY_MAX = 64 * 1024` in `src/app.rs`, angewendet in `montieren`.
  - Test mit Proberoute (`JsonBody`) über `montieren` und die Schicht: genau 64 KiB werden
    angenommen; 64 KiB plus ein Byte ergeben 413 `payload_too_large`; kaputtes JSON ergibt 400
    `invalid_field`.
  - `tests/zulassung_guard.rs` bleibt grün und unverändert.

## 4. Regeln und Doku (D5)

- [x] 4.1 `src/AGENTS.md`: Abschnitt „Backend — Öffentliche API v1 (LLH-1653)“ nach D5; die Zeile
  für `src/AGENTS.md` in der Tabelle der Wurzel-`AGENTS.md` um „Öffentliche API v1“ ergänzen.
  Prüfen: Wurzeldatei unter 200 Zeilen.
- [ ] 4.2 Architektur:
  - Kapitel 5 bekommt eine Zeile für `src/public_api/`, Kapitel 8 einen kurzen Querschnitt mit
    Verweis auf ADR-0022.
  - In ADR-0022 kommt `src/public_api/**` in `gilt_fuer`.
  - Prüfen: `scripts/check-architektur.sh` ist grün, und `scripts/adr-fuer.sh src/public_api/mod.rs`
    nennt ADR-0022.

## 5. Zusammen prüfen

- [ ] 5.1 Verifikation (`superpowers:verification-before-completion`): `cargo fmt --check`,
  `cargo test` für die berührten Tests, `scripts/check-typ-codegen.sh`, `scripts/check-all.sh`
  in den Bündeln, die der Diff berührt. Rote Schritte, die nicht am Diff liegen, mit Grund
  festhalten; der volle Lauf geschieht in der CI des PRs.
- [ ] 5.2 Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde
  behandelt, Verbleib für den Abschnitt „Review“ im PR festgehalten.

## Workflow follow-up

- `/opsx:archive h5zpb97t-oeffentliche-api-vertrag` im selben Branch vor dem PR.
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/h5zpb97tswv8zkomby2gc5et`.
  Ohne sichtbare Wirkung in der Oberfläche statt Bildern ein Satz; Board-Status `review`.
