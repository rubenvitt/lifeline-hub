# Design

## Context

Ausgangslage im Code (12.11.2026, `origin/alpha` 7e5c39e5):

- **OpenAPI:**
  - `src/api_doc.rs` ist ein `#[derive(OpenApi)]` mit `components(schemas(…))` und ohne Pfade.
    Daraus erzeugt das Frontend seine Typen (ADR-0004, LFH-120).
  - `tests/openapi_spec_aktuell.rs` schreibt `frontend/src/api/openapi.json` neu und scheitert, wenn
    die Datei veraltet war. `scripts/check-typ-codegen.sh` ruft diesen Test auf und prüft danach mit
    `git diff --exit-code`.
  - Die Abhängigkeiten sind utoipa 6.0 und axum 0.8.
- **Fehler:** `AppError::into_response` (`src/error.rs`) liefert `{"error": "<Text>"}`.
  - Abgelehnte Eingaben laufen über `crate::extract::JsonBody` und `PfadParam` in dieselbe Form.
  - Einen unbekannten Pfad unter `/api/` beantwortet `static_files::serve` mit 404 `{"error":
    "Nicht gefunden"}`.
  - Eine falsche Methode beantwortet `methode_nicht_erlaubt` (`src/app.rs`) mit 405.
  - Eine Handler-Panik wird zu 500 über `CatchPanicLayer`, Lastabwurf zu 503 über
    `zulassung::zulassung`.
- **Schichten in `build_router_mit`** (`.layer()` hängt nach außen):
  `DefaultBodyLimit(JSON_BODY_MAX)` → Kompression → CatchPanic → Stammdaten-Live → Spiegel-Anträge
  → Zulassung → Trace → Request-ID → `X-Content-Type-Options`.
- **Unter `/api/v1/` gibt es keine Route.** LLH-1652 baut parallel den Maschinenzugang und hängt
  `MachineClient`, `me`, `zugang/redeem` und `instanz/jwks.json` in das Gerüst dieser Change. Der
  Schnitt ist ihm mitgeteilt.

Abgestimmt mit Ruben am 12.11.2026 (Zunder-Kommentar an LLH-1653). Motivation: proposal.md.

## Goals / Non-Goals

**Goals:**

- Ein Gerüst, in dem eine v1-Route nicht ohne Dokumenteintrag entstehen kann.
- Jede Fehlerantwort unter `/api/v1/` trägt `code`, auch wenn kein v1-Handler sie erzeugt hat.
- Folgeaufgaben bauen nur noch Handler; Grenze, Köpfe und Fehlerform gibt es schon.

**Non-Goals:**

- Anmeldung, Scopes, Drosselung und `GET /api/v1/me` gehören zu LLH-1652.
- Fachrouten (`lage`, `einsaetze`, `events`, `einwurf`, `rechner`) kommen mit ihren Aufgaben.
- Die interne API bekommt keinen `code`. Ihre Fehlerform und das Frontend bleiben unberührt.
- `servers`, Sicherheitsschemata und Beispiele im Dokument kommen mit LLH-1652, sobald es eine
  Anmeldung gibt.

## Decisions

### D1 Router und Dokument entstehen zusammen (utoipa-axum)

`src/public_api/mod.rs` baut die v1-Routen mit `utoipa_axum::router::OpenApiRouter` über
`.routes(routes!(handler))`. Jeder Handler trägt `#[utoipa::path]`, sonst baut `routes!` nicht.

- `public_api::router()` gibt den `OpenApiRouter<AppState>` zurück, angelegt mit
  `OpenApiRouter::with_openapi(PublicApiDoc::openapi())`.
- `split_for_parts()` trennt Router und Dokument.
- `public_api::dokument()` liefert das fertige Dokument, einmal gebaut und in einem `OnceLock`
  gehalten. Daraus lesen die Route `openapi.json` und der Drift-Test.
- Pfade im Dokument sind vollständig (`/api/v1/openapi.json`). Die Handler tragen den vollen Pfad,
  oder der Router ist mit `nest("/api/v1", …)` gebaut; beides ergibt dieselben Pfade, die Wahl
  trifft die Umsetzung.
- `app.rs` hängt den Router einmal per `.merge(…)` ein.

**Alternative verworfen:** `#[derive(OpenApi)]` mit `paths(…)` und daneben der Router in
`app.rs`. Der Drift-Test fängt dann nur Änderungen an Routen, die schon dokumentiert sind. Eine
vergessene Route bliebe unsichtbar, außer ein Quelltext-Wächter wie `tests/zulassung_guard.rs`
fängt sie.

**Preis:** eine neue Abhängigkeit. `utoipa-axum` 0.3 kommt vom Autor von utoipa, verlangt utoipa
6 und axum 0.8.4 und zieht nur `pastey` und `tower-layer`/`tower-service` nach, die schon im Baum
sind. ADR-0001 verbietet ein zweites Web-Framework; das hier ist kein Framework, sondern eine
Bindung an axum. ADR-0004 verbietet einen zweiten Generator; `utoipa-axum` erzeugt nichts, es
sammelt nur Pfade für utoipa.

### D2 Fehler: eigener `ApiError` und eine Schicht, die den Code ergänzt

**`ErrorCode`** (`src/public_api/error.rs`) ist ein `wire_enum!` mit den Codes aus der Spec und je
einem Vorgabe-Status. `ErrorCode::fuer_status(StatusCode)` gibt den Vorgabe-Code eines Status:

- 403 ergibt `missing_scope`, 409 ergibt `conflict`;
- ein 4xx-Status ohne eigenen Code ergibt `unprocessable`, ein 5xx-Status ohne eigenen Code
  ergibt `internal_error`.

**`ApiError { status, code, message }`** ist der Fehler der v1-Handler und antwortet mit
`{error, code}`.

- `From<AppError>` übernimmt Status und Text von `AppError` und nimmt den Vorgabe-Code.
  Ausnahme: der Schreibschutz eines Spiegels. Er ist heute ein 409 aus
  `AppError::constraint_violation` und wird zu `fuehrung_elsewhere`.
- Interne Fehler (500) behalten den generischen Text von `AppError`, damit nichts aus SQL oder
  Pfaden nach außen gelangt. Dafür läuft die Umwandlung über `AppError::into_response` und liest
  den Text aus dem Body, statt `Display` zu nehmen.
- Ein Konstruktor je Code, etwa `ApiError::missing_scope(text)` und `ApiError::tls_required(text)`.

**Schicht `public_api::schicht`** ist eine Middleware im äußeren Teil von `build_router_mit`,
außerhalb der Zulassung und innerhalb von Trace. Für Pfade, die mit `/api/v1/` beginnen, gilt:

- `Cache-Control: no-store` wird gesetzt, bei Erfolg und bei Fehler.
- Bei Status ≥ 400 ohne `Content-Encoding`:
  - Der Body wird gelesen, höchstens 64 KiB; v1-Fehler sind klein.
  - Ist er ein JSON-Objekt mit `error` und ohne `code`, kommt `code` nach `fuer_status` dazu.
  - Ist er kein solches Objekt, wird er durch `{error: <Vorgabetext des Status>, code}` ersetzt.
  - `Content-Length` wird neu gesetzt.
- Eine Antwort, die `code` schon trägt (aus `ApiError`), bleibt unverändert.

So bekommen abgelehnte Eingaben (`JsonBody` und `PfadParam` antworten mit `AppError`), der
404-Fallback, die 405-Antwort, die 413-Antwort der Body-Grenze, die Panik-500 und der Lastabwurf-503
einen Code, ohne dass diese Stellen von v1 wissen.

**Alternativen verworfen:**

- *Nur die Schicht.* Zwei 403 (`missing_scope` und `tls_required`) und zwei 409 ließen sich nicht
  unterscheiden.
- *Nur `ApiError`.* Abgelehnte Eingaben und Fallbacks entstehen vor dem Handler oder außerhalb
  von ihm und kämen ohne `code` an.

**Annahme:** `conflict` steht nicht in der abgestimmten Liste. Er ist der Vorgabe-Code für 409.
Sonst trüge jeder 409 unter v1 `fuehrung_elsewhere`, und der Code behauptete etwas, das nicht
stimmt. Er liegt beim Freigabe-Checkpoint mit vor.

### D3 Body-Grenze 64 KiB als Konstante in `app.rs`

Die Grenze ist `PUBLIC_API_BODY_MAX: usize = 64 * 1024`, als Konstante in `app.rs` wie die
übrigen Grenzen (`src/AGENTS.md`, Eingabegrenzen). `DefaultBodyLimit::max(PUBLIC_API_BODY_MAX)`
liegt am v1-Router, bevor `app.rs` ihn einhängt, also innen, und gilt damit vor `JSON_BODY_MAX`.

64 KiB liegen unter `GROSSER_BODY`. Deshalb braucht es keinen Eintrag in `OHNE_ZULASSUNGSGRENZE`
und keine Änderung an `tests/zulassung_guard.rs`; die Zeile in der Aufgabe entfällt laut
Kommentar vom 11.11.2026.

Damit die Grenze und die Schicht mit einer Proberoute prüfbar sind, montiert `app.rs` den
v1-Router über eine Funktion, etwa `public_api::montieren(OpenApiRouter) -> Router<AppState>`.
Ein Test hängt darüber eine Proberoute mit Body an. Bis LLH-1652 gibt es keine echte v1-Route
mit Body.

### D4 Dokumentkopf und Drift-Test

**Kopf von `PublicApiDoc`:**

- `info(title = "Lifeline Hub, öffentliche API", version = "1")`. Die Version ist fest, wie in
  `api_doc.rs`, damit `cargo set-version` das Dokument nicht ändert.
- `description` ist ein `include_str!` aus `src/public_api/beschreibung.md` und enthält:
  - die Stabilitätszusage;
  - die Namensregel als Kurzfassung der Tabelle „Namen auf dem Wire“ aus dem Konzept;
  - Zeitpunkte in UTC;
  - die Fehlerform und die Code-Tabelle.
- `components(schemas(ApiErrorBody, ErrorCode))`.

Ein Unit-Test prüft, dass die Code-Tabelle der Beschreibung genau die Werte von `ErrorCode`
nennt. Sonst driftet die Prosa still.

**Drift-Test `tests/public_api_spec_aktuell.rs`:** nach dem Muster von
`openapi_spec_aktuell.rs`. Er schreibt `docs/api/public-v1.json` neu, wenn sie veraltet ist, und
scheitert dann. Die Datei wird `dokument().to_pretty_json()` plus ein Zeilenende.

`scripts/check-typ-codegen.sh` bekommt einen Schritt dafür und nimmt `docs/api/public-v1.json` in
das `git diff --exit-code` auf. Der Test prüft nicht `frontend/`; ein reiner v1-Lauf braucht kein
pnpm.

**Frontend-Dokument ohne Pfade:** `tests/openapi_spec_aktuell.rs` bekommt die Zusicherung, dass
`ApiDoc::openapi().paths.paths` leer ist. Das ADR-0022-Muster `verbiete 'utoipa::path|paths\('
src/api_doc.rs` greift erst, wenn die ADR akzeptiert ist.

### D5 Regeln und Doku

- `src/AGENTS.md` bekommt den Abschnitt „Backend — Öffentliche API v1 (LLH-1653)“:
  - Routen nur über `public_api::router()` mit `#[utoipa::path]`;
  - v1-Handler geben `ApiError` zurück;
  - eigene Schemas, kein Typ aus `api_doc.rs`;
  - Drift-Datei mitcommitten;
  - Fehlercodes nur hinzufügen.
- Die Wurzel-`AGENTS.md` bekommt keinen Eintrag; die Bereichstabelle nennt `src/AGENTS.md` schon.
- Architektur:
  - Kapitel 5: Zeile für `src/public_api/`, die der Wächter verlangt.
  - Kapitel 8: kurzer Querschnitt „Öffentliche API v1“ mit Verweis auf ADR-0022.
- In ADR-0022 kommt nur `src/public_api/**` in `gilt_fuer`. Regeln und Status bleiben;
  akzeptiert wird die ADR mit LLH-1652.

## Risks / Trade-offs

- **Konflikt mit LLH-1652:** Beide Aufgaben berühren `src/public_api/mod.rs`, `src/app.rs`,
  `src/lib.rs`, `Cargo.toml` und ADR-0022 (`gilt_fuer`). → Der Schnitt ist mitgeteilt, die
  Berührung in `app.rs` ist eine Zeile. Wer später merged, setzt auf.
- **Ein komprimierter Fehler-Body bekäme keinen Code:** Die Kompression liegt innen und packt
  JSON ab 1 KiB. → v1-Fehler sind kurz. `ApiError` setzt den Code selbst; ein Test prüft, dass
  der Code auch bei `Accept-Encoding: br` ankommt.
- **Lesen des Bodies in der Schicht:** Ein großer Fehler-Body würde gepuffert. → Die Schicht liest
  nur bei Status ≥ 400 und nur bis 64 KiB; darüber ersetzt sie den Body durch die Vorgabe.
- **Prosa und Enum driften:** Die Code-Tabelle der Beschreibung ist Text. → Ein Unit-Test
  vergleicht sie mit `ErrorCode`.
- **Die neue Abhängigkeit:** `cargo deny` oder Advisories schlagen an. → Prüfen im Gate-Lauf.
  utoipa-axum hat keine bekannten Advisories, und seine Lizenz (MIT/Apache-2.0) passt.
