# LFH-131 — Einsatz-Einstellungen Foundation (Darstellung & Einstieg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den gemeinsamen Einsatz-Einstellungen-Unterbau (1:1-Tabelle `einsatz_einstellungen` + echte Modul-Shell/Page + GET/PUT-API) anlegen und als erste echte Settings das **Default-Modul (Landing-Override)** und die **Karten-Defaults** (Basemap-Modus, Start-Zoom, sichtbare Fachebenen) end-to-end verdrahten.

**Architecture:** Backend folgt exakt dem LFH-130-Muster (Domain-Struct + Repo + Route mit `laden → rolle_von → Guard → repo`). Speichermodell ist die im LFH-55-Decision-Record beschlossene **Hybrid-Leaf-Tabelle**: skalare Spalten (`standard_modul`, `basemap_modus`, `karten_zoom_start`) + eine JSON-Spalte (`fachebenen_sichtbar`), Validierung in Rust statt DB-CHECK. Frontend ersetzt den `ModulStub`-Platzhalter durch eine echte Einstellungen-Seite und liest die Settings am Wirkungsort (`DefaultModulRedirect`, Lagekarte-Einstieg) per React Query.

**Tech Stack:** Rust (axum + sqlx-sqlite 0.8.6), React + TypeScript + antd + @tanstack/react-query, MapLibre, Vitest, Rust integration tests via `tower::ServiceExt::oneshot`.

## Global Constraints

- **Keine DB-CHECK-Constraints** auf neuen Spalten/Tabellen — Validierung in Rust. (sqlx-sqlite 0.8.6 kann CHECK nicht per Rebuild ändern; `einsatz` ist Nicht-Leaf mit 35 Inbound-FKs.)
- **Leaf-Tabelle** `einsatz_einstellungen` (1:1, PK `einsatz_id`) — bleibt rebuildbar.
- **Settings einfrieren bei Einsatzabschluss:** PUT erfordert aktiven Einsatz (`fordere_aktiv` → 409 bei abgeschlossen). Ausnahme Aufbewahrungsfrist bleibt bei LFH-130/135.
- **Default-Modul gegen `status==='fertig'` validieren**, Fallback auf `redirectZiel()` — Validierung im Frontend (Registry lebt dort), Backend speichert opak.
- **Einstellungs- + Einsatzdaten-Modul nicht ausblendbar** — gilt erst ab LFH-132 (Sichtbarkeits-Override); hier keine Ausblendung möglich, daher kein Guard nötig, aber nicht versehentlich einführen.
- **Feldabdeckung:** Jedes in der Spec aufgenommene Feld wird sowohl erhoben (Form) ALS AUCH am Wirkungsort angewandt. Display-Konventionen (Zeitzone/Zeitformat, Einheiten, Koordinatenformat) sind **bewusst nicht** Teil von LFH-131 → eigener Folge-Subtask (sonst write-only).
- **rust-embed:** Frontend-Änderungen wirken erst nach `pnpm --dir frontend build` + Backend-Neustart. Frontend-Tests laufen über Vitest gegen den Quellbaum.
- **Commit-Referenz:** `LFH-131` im Commit-Body.

---

## File Structure

**Backend:**
- Create `migrations/0064_einsatz_einstellungen.sql` — Leaf-Tabelle.
- Create `src/einsatz/einstellungen.rs` — `EinsatzEinstellungen`-Struct, gültige Werte-Konstanten, Repo-Fns (`laden_oder_default`, `speichern`), Unit-Tests.
- Modify `src/einsatz/mod.rs` — `pub mod einstellungen;` deklarieren.
- Modify `src/routes/einsatz.rs` — `einstellungen_laden` (GET) + `einstellungen_setzen` (PUT) Handler + `EinstellungenUpdate`-DTO + Validierung.
- Modify `src/app.rs` — zwei Routen registrieren (nach der `aufbewahrungsfrist`-Route).
- Modify `tests/einsatz.rs` — Integrationstests für GET/PUT inkl. Freeze (409) + Guard (403).

**Frontend:**
- Modify `frontend/src/api/types.ts` — `EinsatzEinstellungen` + `FachebenenSichtbar` Typ.
- Modify `frontend/src/api/einsaetze.ts` — `ladeEinstellungen`, `speichereEinstellungen`.
- Create `frontend/src/pages/EinsatzEinstellungenPage.tsx` — Einstellungs-Formular (Default-Modul, Karten-Defaults).
- Create `frontend/src/pages/EinsatzEinstellungenPage.test.tsx`.
- Modify `frontend/src/einsatz/modulRegistry.ts` — `einsatz-einstellungen` Status `'geplant' → 'fertig'`; neue Pure-Fn `aufloeseStandardModul`.
- Modify `frontend/src/einsatz/modulRegistry.test.ts` — Tests für `aufloeseStandardModul`.
- Modify `frontend/src/App.tsx` — `MODUL_ELEMENTE['einsatz-einstellungen']`.
- Modify `frontend/src/einsatz/DefaultModulRedirect.tsx` — Settings laden + Standard-Modul auflösen.
- Modify `frontend/src/einsatz/DefaultModulRedirect.test.tsx` — Override-Fälle.
- Modify `frontend/src/pages/lagekarte/basemapAuswahl.ts` — `waehleInitialeBasemap` um Einsatz-Default erweitern.
- Modify `frontend/src/pages/lagekarte/basemapAuswahl.test.ts` (oder neu) — Einsatz-Default-Fallback.
- Modify `frontend/src/pages/LagekartePage.tsx` — Settings laden, Einsatz-Default in Init einspeisen (Basemap, Zoom, Fachebenen).

---

## Task 1: Migration + Domain + Repo (`einsatz_einstellungen`)

**Files:**
- Create: `migrations/0064_einsatz_einstellungen.sql`
- Create: `src/einsatz/einstellungen.rs`
- Modify: `src/einsatz/mod.rs` (Modul-Deklaration)
- Test: Unit-Tests in `src/einsatz/einstellungen.rs`

**Interfaces:**
- Produces:
  - `struct EinsatzEinstellungen { einsatz_id: i64, standard_modul: Option<String>, basemap_modus: Option<String>, karten_zoom_start: Option<f64>, fachebenen_sichtbar: Option<String>, geaendert_at: Option<String>, geaendert_von: Option<i64> }` (`Serialize`, `sqlx::FromRow`, `Clone`, `Debug`)
  - `const BASEMAP_MODI: [&str; 3] = ["online", "offline", "blind"]`
  - `fn ist_gueltiger_basemap_modus(s: &str) -> bool`
  - `async fn laden_oder_default(pool, einsatz_id) -> Result<EinsatzEinstellungen, AppError>` — fehlt die Zeile, alle Felder `None`.
  - `struct EinstellungenDaten<'a> { standard_modul: Option<&'a str>, basemap_modus: Option<&'a str>, karten_zoom_start: Option<f64>, fachebenen_sichtbar: Option<&'a str> }`
  - `async fn speichern(pool, einsatz_id, erfasser_id, daten: EinstellungenDaten) -> Result<EinsatzEinstellungen, AppError>` — UPSERT, setzt `geaendert_at = datetime('now')`, `geaendert_von`.
  - `struct EinstellungenAnzeige { einsatz_id, standard_modul, basemap_modus, karten_zoom_start, fachebenen_sichtbar: Option<serde_json::Value>, geaendert_at, geaendert_von }` (`Serialize`) + `fn EinsatzEinstellungen::anzeige(&self) -> EinstellungenAnzeige` — parst den rohen `fachebenen_sichtbar`-String zu einem **Objekt**, damit GET und PUT symmetrisch ein Objekt liefern (das Muster erben LFH-133/134/135).

- [ ] **Step 1: Migration schreiben**

`migrations/0064_einsatz_einstellungen.sql`:
```sql
-- Einsatz-Einstellungen (LFH-55 / LFH-131) — 1:1-Leaf-Tabelle pro Einsatz.
-- Hybrid-Speichermodell (Decision Record LFH-55): skalare Spalten + JSON für
-- Mengen. KEINE CHECK-Constraints (Validierung in Rust) — Leaf-Tabelle bleibt
-- so trotz sqlx-sqlite-0.8.6-Rebuild-Limit wartbar.
CREATE TABLE einsatz_einstellungen (
    einsatz_id          INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Kat. 1: Landing-Override; Modul-Key (Registry-validiert im Frontend). NULL = redirectZiel().
    standard_modul      TEXT,
    -- Karten-Defaults: NULL = Verfügbarkeits-/Karten-Default.
    basemap_modus       TEXT,           -- 'online' | 'offline' | 'blind'
    karten_zoom_start   REAL,           -- 0..=28
    fachebenen_sichtbar TEXT,           -- JSON {"nina":bool,"dwd":bool,"pegelonline":bool,"kritis":bool}
    geaendert_at        TEXT,
    geaendert_von       INTEGER REFERENCES benutzer(id)
);
```

- [ ] **Step 2: Modul deklarieren**

In `src/einsatz/mod.rs` oben bei den `pub mod`-Zeilen ergänzen:
```rust
pub mod einstellungen;
```

- [ ] **Step 3: Failing test — `laden_oder_default` ohne Zeile liefert Defaults**

`src/einsatz/einstellungen.rs` (Test-Modul):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::repo::tests_support as _; // falls Helfer nötig; sonst inline
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer + Einsatz an; liefert (einsatz_id, benutzer_id).
    /// Benutzer ist nötig, weil `geaendert_von` ein FK auf `benutzer(id)` ist und
    /// sqlx `foreign_keys` per Default aktiviert (id=0 würde mit FK-Violation brechen).
    async fn fixture(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let bid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let eid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) \
             VALUES (1, 'Lage', '2026-001') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (eid, bid)
    }

    #[tokio::test]
    async fn laden_oder_default_ohne_zeile_ist_leer() {
        let pool = crate::db::test_pool().await;
        let (eid, _bid) = fixture(&pool).await;
        let e = laden_oder_default(&pool, eid).await.unwrap();
        assert_eq!(e.einsatz_id, eid);
        assert_eq!(e.standard_modul, None);
        assert_eq!(e.basemap_modus, None);
        assert_eq!(e.karten_zoom_start, None);
        assert_eq!(e.fachebenen_sichtbar, None);
    }
}
```

- [ ] **Step 4: Run test, expect FAIL** (`cargo test -p lifeline-hub einstellungen::tests::laden_oder_default` → fails: `laden_oder_default` nicht definiert)

- [ ] **Step 5: Struct + `laden_oder_default` implementieren**

`src/einsatz/einstellungen.rs` (oben):
```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Gültige Basemap-Modi (Validierung in Rust statt DB-CHECK).
pub const BASEMAP_MODI: [&str; 3] = ["online", "offline", "blind"];

pub fn ist_gueltiger_basemap_modus(s: &str) -> bool {
    BASEMAP_MODI.contains(&s)
}

/// Einsatz-Einstellungen (1:1 pro Einsatz). Alle Felder optional — `None` = Default.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EinsatzEinstellungen {
    pub einsatz_id: i64,
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<String>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

impl EinsatzEinstellungen {
    fn leer(einsatz_id: i64) -> Self {
        Self {
            einsatz_id,
            standard_modul: None,
            basemap_modus: None,
            karten_zoom_start: None,
            fachebenen_sichtbar: None,
            geaendert_at: None,
            geaendert_von: None,
        }
    }
}

/// Lädt die Einstellungen eines Einsatzes; existiert keine Zeile, werden Defaults
/// (alle `None`) zurückgegeben. Der Aufrufer hat den Einsatz bereits geladen (404/Guard).
pub async fn laden_oder_default(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<EinsatzEinstellungen, AppError> {
    let row = sqlx::query_as::<_, EinsatzEinstellungen>(
        "SELECT einsatz_id, standard_modul, basemap_modus, karten_zoom_start, \
                fachebenen_sichtbar, geaendert_at, geaendert_von \
         FROM einsatz_einstellungen WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_else(|| EinsatzEinstellungen::leer(einsatz_id)))
}

/// API-Darstellung: `fachebenen_sichtbar` als geparstes Objekt (symmetrisch zur
/// PUT-Eingabe). Ungültiges/leeres JSON → `None`.
#[derive(Debug, Clone, Serialize)]
pub struct EinstellungenAnzeige {
    pub einsatz_id: i64,
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

impl EinsatzEinstellungen {
    pub fn anzeige(&self) -> EinstellungenAnzeige {
        EinstellungenAnzeige {
            einsatz_id: self.einsatz_id,
            standard_modul: self.standard_modul.clone(),
            basemap_modus: self.basemap_modus.clone(),
            karten_zoom_start: self.karten_zoom_start,
            fachebenen_sichtbar: self
                .fachebenen_sichtbar
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok()),
            geaendert_at: self.geaendert_at.clone(),
            geaendert_von: self.geaendert_von,
        }
    }
}
```

- [ ] **Step 6: Run test, expect PASS**

- [ ] **Step 7: Failing test — `speichern` legt an und aktualisiert (UPSERT)**

```rust
#[tokio::test]
async fn speichern_upsert_und_laden() {
    let pool = crate::db::test_pool().await;
    let (eid, bid) = fixture(&pool).await;

    let gespeichert = speichern(
        &pool, eid, bid,
        EinstellungenDaten {
            standard_modul: Some("lagekarte"),
            basemap_modus: Some("offline"),
            karten_zoom_start: Some(12.0),
            fachebenen_sichtbar: Some(r#"{"nina":true,"dwd":false,"pegelonline":false,"kritis":false}"#),
        },
    ).await.unwrap();
    assert_eq!(gespeichert.standard_modul.as_deref(), Some("lagekarte"));
    assert_eq!(gespeichert.basemap_modus.as_deref(), Some("offline"));
    assert_eq!(gespeichert.karten_zoom_start, Some(12.0));
    assert!(gespeichert.geaendert_at.is_some());

    // Upsert: zweites Speichern überschreibt dieselbe Zeile (kein zweiter Insert).
    let zweite = speichern(
        &pool, eid, bid,
        EinstellungenDaten { standard_modul: None, basemap_modus: Some("online"),
                             karten_zoom_start: None, fachebenen_sichtbar: None },
    ).await.unwrap();
    assert_eq!(zweite.standard_modul, None);
    assert_eq!(zweite.basemap_modus.as_deref(), Some("online"));

    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einstellungen WHERE einsatz_id = ?")
        .bind(eid).fetch_one(&pool).await.unwrap();
    assert_eq!(anzahl, 1);
}
```

- [ ] **Step 8: Run test, expect FAIL** (`speichern` / `EinstellungenDaten` nicht definiert)

- [ ] **Step 9: `EinstellungenDaten` + `speichern` implementieren**

```rust
/// Eingabe für `speichern`; bereits vom Handler getrimmt/validiert.
#[derive(Debug)]
pub struct EinstellungenDaten<'a> {
    pub standard_modul: Option<&'a str>,
    pub basemap_modus: Option<&'a str>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<&'a str>,
}

/// Speichert die Einstellungen (UPSERT auf `einsatz_id`); setzt Audit-Felder.
pub async fn speichern(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EinstellungenDaten<'_>,
) -> Result<EinsatzEinstellungen, AppError> {
    sqlx::query(
        "INSERT INTO einsatz_einstellungen \
            (einsatz_id, standard_modul, basemap_modus, karten_zoom_start, \
             fachebenen_sichtbar, geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(einsatz_id) DO UPDATE SET \
             standard_modul = excluded.standard_modul, \
             basemap_modus = excluded.basemap_modus, \
             karten_zoom_start = excluded.karten_zoom_start, \
             fachebenen_sichtbar = excluded.fachebenen_sichtbar, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(einsatz_id)
    .bind(daten.standard_modul)
    .bind(daten.basemap_modus)
    .bind(daten.karten_zoom_start)
    .bind(daten.fachebenen_sichtbar)
    .bind(erfasser_id)
    .execute(pool)
    .await?;
    laden_oder_default(pool, einsatz_id).await
}
```

- [ ] **Step 10: Run tests, expect PASS** (`cargo test -p lifeline-hub einstellungen`)

- [ ] **Step 11: Commit**

```bash
git add migrations/0064_einsatz_einstellungen.sql src/einsatz/einstellungen.rs src/einsatz/mod.rs
git commit -m "feat(einsatz): einsatz_einstellungen-Tabelle + Repo (Foundation, LFH-131)"
```

---

## Task 2: GET/PUT-Route + Freeze + Validierung

**Files:**
- Modify: `src/routes/einsatz.rs` (Handler + DTO + Validierung)
- Modify: `src/app.rs` (2 Routen)
- Test: `tests/einsatz.rs` (Integrationstests)

**Interfaces:**
- Consumes: `einstellungen::{laden_oder_default, speichern, EinstellungenDaten, ist_gueltiger_basemap_modus}`, Guards `fordere_lesezugriff`, `fordere_schreibrecht_oder_admin`, `fordere_aktiv`.
- Produces:
  - `GET /api/einsaetze/{id}/einstellungen` → `Json<EinstellungenAnzeige>`
  - `PUT /api/einsaetze/{id}/einstellungen` (Body `EinstellungenUpdate`) → `Json<EinstellungenAnzeige>`
  - `struct EinstellungenUpdate { standard_modul: Option<String>, basemap_modus: Option<String>, karten_zoom_start: Option<f64>, fachebenen_sichtbar: Option<serde_json::Value> }`

- [ ] **Step 1: Failing integration test — GET liefert Defaults, PUT speichert**

In `tests/einsatz.rs` (am Ende, neuer Test). Nutzt vorhandene Helfer `setup_with_pool`, `login_cookie`. Einen Einsatz legt der Admin via POST `/api/einsaetze` an:
```rust
#[tokio::test]
async fn einstellungen_get_default_dann_put_speichert() {
    let (app, _pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Einsatz anlegen.
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/einsaetze")
            .header(header::CONTENT_TYPE, "application/json").header(header::COOKIE, &admin)
            .body(Body::from(r#"{"bezeichnung":"Lage"}"#)).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let eid = json_id(resp).await; // Helfer: liest .id aus Body

    // GET → Defaults (alle null).
    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(format!("/api/einsaetze/{eid}/einstellungen"))
            .header(header::COOKIE, &admin).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = json_body(resp).await;
    assert!(v["standard_modul"].is_null());

    // PUT.
    let resp = app.clone().oneshot(
        Request::builder().method("PUT").uri(format!("/api/einsaetze/{eid}/einstellungen"))
            .header(header::CONTENT_TYPE, "application/json").header(header::COOKIE, &admin)
            .body(Body::from(r#"{"standard_modul":"lagekarte","basemap_modus":"offline","karten_zoom_start":12,"fachebenen_sichtbar":{"nina":true,"dwd":false,"pegelonline":false,"kritis":false}}"#)).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let v = json_body(resp).await;
    assert_eq!(v["standard_modul"], "lagekarte");
    assert_eq!(v["basemap_modus"], "offline");
}
```
(Falls `json_id`/`json_body` noch nicht existieren: kleine lokale Helfer analog `to_bytes(...).await` + `serde_json::from_slice` ergänzen.)

- [ ] **Step 2: Failing tests — Validierung (ungültiger basemap_modus → 422) und Freeze (abgeschlossen → 409)**

```rust
#[tokio::test]
async fn einstellungen_put_ungueltiger_modus_ist_422() {
    let (app, _pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_via_api(&app, &admin).await; // Helfer
    let resp = app.clone().oneshot(
        Request::builder().method("PUT").uri(format!("/api/einsaetze/{eid}/einstellungen"))
            .header(header::CONTENT_TYPE, "application/json").header(header::COOKIE, &admin)
            .body(Body::from(r#"{"basemap_modus":"satellit"}"#)).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn einstellungen_put_auf_abgeschlossenem_ist_409() {
    let (app, _pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_via_api(&app, &admin).await;
    // abschließen
    app.clone().oneshot(Request::builder().method("POST")
        .uri(format!("/api/einsaetze/{eid}/abschliessen")).header(header::COOKIE, &admin)
        .body(Body::empty()).unwrap()).await.unwrap();
    let resp = app.clone().oneshot(
        Request::builder().method("PUT").uri(format!("/api/einsaetze/{eid}/einstellungen"))
            .header(header::CONTENT_TYPE, "application/json").header(header::COOKIE, &admin)
            .body(Body::from(r#"{"basemap_modus":"online"}"#)).unwrap()).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}
```

- [ ] **Step 3: Run tests, expect FAIL** (Route fehlt → 404)

- [ ] **Step 4: Handler + DTO implementieren** in `src/routes/einsatz.rs`

Use-Zeile ergänzen:
```rust
use crate::einsatz::einstellungen;
```
Am Dateiende:
```rust
#[derive(Debug, Deserialize)]
pub struct EinstellungenUpdate {
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    /// JSON-Objekt {nina,dwd,pegelonline,kritis}; wird als Text gespeichert.
    pub fachebenen_sichtbar: Option<serde_json::Value>,
}

/// GET /api/einsaetze/{id}/einstellungen — Einsatz-Einstellungen (LFH-131).
/// Lesezugriff gemäß DSGVO-Lese-Policy; existiert keine Zeile → Defaults.
pub async fn einstellungen_laden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<einstellungen::EinstellungenAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(einstellungen::laden_oder_default(&state.pool, id).await?.anzeige()))
}

/// PUT /api/einsaetze/{id}/einstellungen — Einstellungen setzen (Vollersatz).
/// Gate: Einsatz-Schreibrecht ODER System-Admin, plus aktiver Einsatz (Freeze → 409).
pub async fn einstellungen_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
    Json(req): Json<EinstellungenUpdate>,
) -> Result<Json<einstellungen::EinstellungenAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_schreibrecht_oder_admin(&benutzer, rolle)?;
    fordere_aktiv(&einsatz)?; // Freeze bei Abschluss

    let standard_modul = bereinige(req.standard_modul);
    let basemap_modus = bereinige(req.basemap_modus);
    if let Some(m) = basemap_modus.as_deref() {
        if !einstellungen::ist_gueltiger_basemap_modus(m) {
            return Err(AppError::Validation("Ungültiger basemap_modus".into()));
        }
    }
    if let Some(z) = req.karten_zoom_start {
        if !(0.0..=28.0).contains(&z) {
            return Err(AppError::Validation("karten_zoom_start muss zwischen 0 und 28 liegen".into()));
        }
    }
    // Fachebenen-JSON: muss Objekt sein; als kompakter String gespeichert.
    let fachebenen = match &req.fachebenen_sichtbar {
        Some(v) if v.is_object() => Some(v.to_string()),
        Some(serde_json::Value::Null) | None => None,
        Some(_) => return Err(AppError::Validation("fachebenen_sichtbar muss ein Objekt sein".into())),
    };

    let gespeichert = einstellungen::speichern(
        &state.pool, id, benutzer.id,
        einstellungen::EinstellungenDaten {
            standard_modul: standard_modul.as_deref(),
            basemap_modus: basemap_modus.as_deref(),
            karten_zoom_start: req.karten_zoom_start,
            fachebenen_sichtbar: fachebenen.as_deref(),
        },
    ).await?;
    Ok(Json(gespeichert.anzeige()))
}
```

- [ ] **Step 5: Routen registrieren** in `src/app.rs` direkt nach der `aufbewahrungsfrist`-Route (~Zeile 51):
```rust
.route(
    "/api/einsaetze/{id}/einstellungen",
    get(routes::einsatz::einstellungen_laden).put(routes::einsatz::einstellungen_setzen),
)
```

- [ ] **Step 6: Run tests, expect PASS** (`cargo test -p lifeline-hub --test einsatz einstellungen`)

- [ ] **Step 7: Verify full backend build + clippy**

Run: `cargo test -p lifeline-hub einstellungen` und `cargo clippy --all-targets -- -D warnings`
Expected: PASS, keine Warnings.

- [ ] **Step 8: Commit**

```bash
git add src/routes/einsatz.rs src/app.rs tests/einsatz.rs
git commit -m "feat(einsatz): GET/PUT /einstellungen mit Freeze + Validierung (LFH-131)"
```

---

## Task 3: Frontend-API + Typen

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/einsaetze.ts`

**Interfaces:**
- Produces:
  - `interface FachebenenSichtbar { nina: boolean; dwd: boolean; pegelonline: boolean; kritis: boolean }`
  - `interface EinsatzEinstellungen { einsatz_id: number; standard_modul: string | null; basemap_modus: string | null; karten_zoom_start: number | null; fachebenen_sichtbar: FachebenenSichtbar | null; geaendert_at: string | null; geaendert_von: number | null }`
  - `interface EinstellungenUpdate { standard_modul: string | null; basemap_modus: string | null; karten_zoom_start: number | null; fachebenen_sichtbar: FachebenenSichtbar | null }`
  - `ladeEinstellungen(id: number): Promise<EinsatzEinstellungen>`
  - `speichereEinstellungen(id: number, felder: EinstellungenUpdate): Promise<EinsatzEinstellungen>`

> Symmetrie: GET liefert `fachebenen_sichtbar` als **Objekt** (`EinstellungenAnzeige.anzeige()` parst den DB-String), PUT erwartet ein Objekt. Daher ist `fachebenen_sichtbar` im FE-Typ ein `FachebenenSichtbar | null` in beide Richtungen — **kein** `JSON.parse` im FE nötig.

- [ ] **Step 1: Typen in `types.ts` ergänzen**
```ts
export interface FachebenenSichtbar {
  nina: boolean; dwd: boolean; pegelonline: boolean; kritis: boolean;
}
export interface EinsatzEinstellungen {
  einsatz_id: number;
  standard_modul: string | null;
  basemap_modus: string | null;
  karten_zoom_start: number | null;
  /** Vom Backend (EinstellungenAnzeige) als Objekt geliefert; null = nicht gesetzt. */
  fachebenen_sichtbar: FachebenenSichtbar | null;
  geaendert_at: string | null;
  geaendert_von: number | null;
}
export interface EinstellungenUpdate {
  standard_modul: string | null;
  basemap_modus: string | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
}
```

- [ ] **Step 3: API-Funktionen in `einsaetze.ts`**
```ts
import type { /* ... */ EinsatzEinstellungen, EinstellungenUpdate } from './types';

export function ladeEinstellungen(id: number): Promise<EinsatzEinstellungen> {
  return apiGet<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`);
}
export function speichereEinstellungen(id: number, felder: EinstellungenUpdate): Promise<EinsatzEinstellungen> {
  return apiSend<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`, 'PUT', felder);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --dir frontend exec tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/types.ts frontend/src/api/einsaetze.ts
git commit -m "feat(einsatz): Frontend-API für Einsatz-Einstellungen (LFH-131)"
```

---

## Task 4: Default-Modul auflösen (Pure-Fn) + Registry auf `fertig`

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Test: `frontend/src/einsatz/modulRegistry.test.ts`

**Interfaces:**
- Produces: `aufloeseStandardModul(standardModul: string | null | undefined, register?: ModulEintrag[]): string` — liefert die Route des Standard-Moduls, **nur** wenn ein Eintrag mit diesem `key` existiert und `status === 'fertig'`; sonst `redirectZiel(register)`.

- [ ] **Step 1: Failing test**

In `modulRegistry.test.ts`:
```ts
import { aufloeseStandardModul, redirectZiel } from './modulRegistry';

describe('aufloeseStandardModul', () => {
  it('liefert Route des fertigen Standard-Moduls', () => {
    expect(aufloeseStandardModul('etb')).toBe('etb');
  });
  it('faellt auf redirectZiel zurueck bei null', () => {
    expect(aufloeseStandardModul(null)).toBe(redirectZiel());
  });
  it('faellt zurueck bei unbekanntem key', () => {
    expect(aufloeseStandardModul('gibtsnicht')).toBe(redirectZiel());
  });
  it('faellt zurueck bei nicht-fertigem Modul (status=geplant/wip)', () => {
    expect(aufloeseStandardModul('stab')).toBe(redirectZiel()); // stab = wip
  });
  it('beruecksichtigt verweistAuf via route (key!=route z.B. gefahrenzonen)', () => {
    expect(aufloeseStandardModul('gefahrenzonen')).toBe('gefahren');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (`aufloeseStandardModul` nicht exportiert)

- [ ] **Step 3: Implementieren** in `modulRegistry.ts`:
```ts
/**
 * Auflösung des Einsatz-Default-Moduls (LFH-131): liefert die Ziel-Route, wenn
 * `standardModul` auf einen existierenden Eintrag mit Status 'fertig' zeigt —
 * sonst den globalen `redirectZiel()`-Fallback (Pre-Mortem: kein Sprung auf
 * geplante/unbekannte Module).
 */
export function aufloeseStandardModul(
  standardModul: string | null | undefined,
  register: ModulEintrag[] = modulRegistry,
): string {
  const modul = register.find((m) => m.key === standardModul);
  if (modul && modul.status === 'fertig') return modulZielRoute(modul);
  return redirectZiel(register);
}
```

- [ ] **Step 4: Vor dem Flip greppen** — Run: `grep -rn "einsatz-einstellungen\|geplant\|ModulStub\|status === 'fertig'\|status: 'fertig'" frontend/src --include=*.test.* ` — prüfen, ob Tests auf den Stub/`geplant`-Status oder auf „Anzahl fertiger Module" zählen. Solche Erwartungen mit dem Flip mitziehen.

- [ ] **Step 5: Registry-Status flippen** — Zeile 85 `status: 'geplant'` → `status: 'fertig'` für `einsatz-einstellungen`. Gefundene Bestandstests (Step 4) anpassen.

- [ ] **Step 5: Run tests, expect PASS** (`pnpm --dir frontend exec vitest run src/einsatz/modulRegistry.test.ts`)

- [ ] **Step 6: Commit**
```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts
git commit -m "feat(einsatz): aufloeseStandardModul + Einstellungen-Modul auf fertig (LFH-131)"
```

---

## Task 5: Einstellungen-Seite (Modul-Shell ersetzt Platzhalter)

**Files:**
- Create: `frontend/src/pages/EinsatzEinstellungenPage.tsx`
- Create: `frontend/src/pages/EinsatzEinstellungenPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `ladeEinstellungen`, `speichereEinstellungen`, `modulRegistry`, `BASEMAP_MODI`-Äquivalent (im FE als Konstante), React Query.
- Produces: Default-Export `EinsatzEinstellungenPage` (gelesen via `useParams().id`).

- [ ] **Step 1: Failing test — rendert Felder + lädt Werte**

`EinsatzEinstellungenPage.test.tsx` (Muster: MemoryRouter + QueryClientProvider, API gemockt, `App.useApp` falls Modal/message genutzt — hier nur `message`, daher `antd`-`message` via statisch ok; bevorzugt `App`-Kontext). Test:
```tsx
// rendert "Standard-Modul"-Label, Karten-Defaults-Sektion; nach Laden ist
// der gespeicherte basemap_modus selektiert.
```
Konkret: `vi.mock('../api/einsaetze')` → `ladeEinstellungen` liefert `{ standard_modul: 'etb', basemap_modus: 'offline', karten_zoom_start: 12, fachebenen_sichtbar: { nina: true, dwd: false, pegelonline: false, kritis: false }, ... }` (Objekt). Assert: Text „Standard-Modul" vorhanden; Select zeigt „ETB"; Basemap-Select zeigt „Offline".

- [ ] **Step 2: Run test, expect FAIL** (Datei existiert nicht)

- [ ] **Step 3: Seite implementieren**

`EinsatzEinstellungenPage.tsx` — antd `Form`, `Select`, `InputNumber`, `Checkbox`, `Button`, `App.useApp()` für `message` (Memory: antd statisches Modal/message leakt in Tests). Inhalt:
- **Standard-Modul:** `Select` mit Optionen aus `modulRegistry.filter(m => m.status === 'fertig')` (Wert = `key`, Label = `label`), plus „— kein Override —" (Wert leer → `null`).
- **Karten-Defaults:** Basemap-Modus `Select` (`online`/`offline`/`blind` + „Karten-Default"), Start-Zoom `InputNumber` (min 0, max 28, leer erlaubt), Fachebenen `Checkbox`-Gruppe (nina/dwd/pegelonline/kritis).
- Laden via `useQuery(['einsatz-einstellungen', einsatzId], () => ladeEinstellungen(einsatzId))`; `fachebenen_sichtbar` ist bereits ein Objekt (`?? { nina:false, dwd:false, pegelonline:false, kritis:false }`).
- Speichern via `useMutation` → `speichereEinstellungen`, bei Erfolg `queryClient.invalidateQueries(['einsatz-einstellungen', einsatzId])` + `['einsatz', einsatzId]` + `message.success`.
- Leerer Select-Wert → `null` senden.

- [ ] **Step 4: In `App.tsx` registrieren**
```tsx
import EinsatzEinstellungenPage from './pages/EinsatzEinstellungenPage';
// in MODUL_ELEMENTE:
'einsatz-einstellungen': <EinsatzEinstellungenPage />,
```

- [ ] **Step 5: Run tests, expect PASS** + `tsc --noEmit`

- [ ] **Step 6: Commit**
```bash
git add frontend/src/pages/EinsatzEinstellungenPage.tsx frontend/src/pages/EinsatzEinstellungenPage.test.tsx frontend/src/App.tsx
git commit -m "feat(einsatz): Einstellungen-Seite ersetzt Platzhalter (LFH-131)"
```

---

## Task 6: Default-Modul-Override im Redirect verdrahten

**Files:**
- Modify: `frontend/src/einsatz/DefaultModulRedirect.tsx`
- Test: `frontend/src/einsatz/DefaultModulRedirect.test.tsx`

**Interfaces:**
- Consumes: `aufloeseStandardModul`, `ladeEinstellungen`, `useParams`, React Query.

- [ ] **Step 1: Bestehenden Test migrieren** — `DefaultModulRedirect` wird von sync zu async (useQuery). Der bestehende `DefaultModulRedirect.test.tsx` rendert ohne `QueryClientProvider` und wirft sonst. Alle bestehenden Render-Stellen in einen `QueryClientProvider` (frischer `QueryClient` mit `retry: false`) wickeln und `ladeEinstellungen` mocken (default: `standard_modul: null`), damit die Bestandserwartung (Fallback = `redirectZiel()`) grün bleibt.

- [ ] **Step 2: Failing test** — bei `standard_modul: 'etb'` navigiert der Redirect auf `etb`; ohne Override auf `redirectZiel()`; bei nicht-fertigem/unbekanntem Modul auf `redirectZiel()`. (`ladeEinstellungen` mocken, Routing über MemoryRouter + sichtbare Ziel-Komponente prüfen. Hinweis: Jeder Einsatz-Einstieg holt nun zuerst die Einstellungen — bewusster blockierender Fetch + kurzer Spinner auf dem Hot-Path.)

- [ ] **Step 3: Run test, expect FAIL**

- [ ] **Step 4: Implementieren**
```tsx
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { ladeEinstellungen } from '../api/einsaetze';
import { aufloeseStandardModul, redirectZiel } from './modulRegistry';

export default function DefaultModulRedirect() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { data, isLoading } = useQuery({
    queryKey: ['einsatz-einstellungen', einsatzId],
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  // Bis Settings geladen sind: kurzer Spinner statt Fehl-Redirect (sonst springt
  // er erst auf den Fallback und dann auf den Override → Doppel-Navigation).
  if (isLoading) return <Spin style={{ margin: 24 }} />;
  const ziel = data ? aufloeseStandardModul(data.standard_modul) : redirectZiel();
  return <Navigate to={ziel} replace />;
}
```

- [ ] **Step 5: Run tests, expect PASS** + `tsc --noEmit`

- [ ] **Step 6: Commit**
```bash
git add frontend/src/einsatz/DefaultModulRedirect.tsx frontend/src/einsatz/DefaultModulRedirect.test.tsx
git commit -m "feat(einsatz): Default-Modul-Override im Einstieg-Redirect (LFH-131)"
```

---

## Task 7: Karten-Defaults in den Lagekarte-Einstieg verdrahten

**Files:**
- Modify: `frontend/src/pages/lagekarte/basemapAuswahl.ts`
- Test: `frontend/src/pages/lagekarte/basemapAuswahl.test.ts` (neu, falls nicht vorhanden)
- Modify: `frontend/src/pages/LagekartePage.tsx`

**Interfaces:**
- `waehleInitialeBasemap(config, gespeichert, einsatzDefault?: BasemapModus | null)` — Priorität: gemerkte (localStorage) Wahl → **Einsatz-Default** → Verfügbarkeits-Default. Nur der Modus-Default wird ergänzt; `onlineView`-Logik bleibt.

- [ ] **Step 1: Failing test** — ohne gemerkte Wahl, aber mit `einsatzDefault='offline'` (und `pmtiles_verfuegbar=true`) liefert `waehleInitialeBasemap` `modus: 'offline'`; ist der Einsatz-Default ungültig (z.B. 'offline' ohne pmtiles), greift der Verfügbarkeits-Default.
```ts
it('nutzt Einsatz-Default wenn keine gemerkte Wahl', () => {
  const config = { online_styles: [{ name: 'std' }], pmtiles_verfuegbar: true } as KarteServerConfig;
  expect(waehleInitialeBasemap(config, null, 'offline').modus).toBe('offline');
});
it('ignoriert ungueltigen Einsatz-Default', () => {
  const config = { online_styles: [{ name: 'std' }], pmtiles_verfuegbar: false } as KarteServerConfig;
  expect(waehleInitialeBasemap(config, null, 'offline').modus).toBe(defaultModus(config));
});
it('gemerkte Wahl schlaegt Einsatz-Default', () => {
  const config = { online_styles: [{ name: 'std' }], pmtiles_verfuegbar: true } as KarteServerConfig;
  expect(waehleInitialeBasemap(config, { modus: 'blind', onlineView: null }, 'offline').modus).toBe('blind');
});
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: `waehleInitialeBasemap` erweitern** — Signatur + Modus-Auswahl:
```ts
export function waehleInitialeBasemap(
  config: KarteServerConfig,
  gespeichert: GespeicherteBasemap | null,
  einsatzDefault: BasemapModus | null = null,
): GespeicherteBasemap {
  const hatOnline = config.online_styles.length > 0;
  const modusGueltig = (m: BasemapModus): boolean =>
    m === 'blind' || (m === 'online' && hatOnline) || (m === 'offline' && config.pmtiles_verfuegbar);
  // Priorität: gemerkt → Einsatz-Default → Verfügbarkeits-Default.
  const modus =
    gespeichert && modusGueltig(gespeichert.modus) ? gespeichert.modus
    : einsatzDefault && modusGueltig(einsatzDefault) ? einsatzDefault
    : defaultModus(config);
  // onlineView unverändert …
}
```

- [ ] **Step 4: `LagekartePage.tsx` verdrahten** — Einsatz-Settings via `useQuery(['einsatz-einstellungen', einsatzId], …)` laden; `einsatzDefault = data?.basemap_modus` an `waehleInitialeBasemap` übergeben; analog `karten_zoom_start` als Fallback für den initialen Zoom und `fachebenen_sichtbar` (geparst) als Fallback für `liesFachebenenSichtbar(...)` (localStorage schlägt Einsatz-Default). Nur Fallback-Verdrahtung — keine Änderung am Speicherverhalten der localStorage-Wahl.

- [ ] **Step 5: Run tests, expect PASS** + `tsc --noEmit`

- [ ] **Step 6: Commit**
```bash
git add frontend/src/pages/lagekarte/basemapAuswahl.ts frontend/src/pages/lagekarte/basemapAuswahl.test.ts frontend/src/pages/LagekartePage.tsx
git commit -m "feat(einsatz): Karten-Defaults aus Einsatz-Einstellungen als Einstieg-Fallback (LFH-131)"
```

---

## Deferred (eigener Folge-Subtask, NICHT in LFH-131)

**Anzeige-Konventionen (Kat. 1 Rest):** Zeitzone/Zeitformat, Einheiten, Koordinatenformat (MGRS/UTM/WGS84). Begründung: erfordert Display-Plumbing quer durch viele Module (zentrale `formatZeit` ohne Einsatz-Kontext; MGRS/UTM-Transformationen + Koordinaten-Anzeigepunkte). Aufnahme in LFH-131 würde write-only-Felder erzeugen (verstößt gegen Feldabdeckungs-Regel). → Als neuer Subtask auf LFH-55 anlegen.

---

## Self-Review

**Spec coverage (LFH-131 = Kat. 1 „Darstellung & Einstieg"):**
- Default-Modul/Landing-Route-Override → Task 4 + 6 (mit `status==='fertig'`-Validierung + Fallback ✔ Pre-Mortem).
- Karten-Defaults (Basemap, Start-Zoom, aktive Lage-Layer) → Task 7.
- Anzeige-Konventionen → **bewusst deferred** (dokumentiert, Folge-Subtask).
- Foundation (Tabelle + Modul-Shell) → Task 1–5.
- Freeze bei Abschluss → Task 2 (`fordere_aktiv`).

**Placeholder scan:** Keine „TBD/TODO/handle edge cases". Tests mit konkretem Code; Page-Implementierung (Task 5) als präzise Bauanleitung statt Vollcode (antd-Formular-Standard) — bei Inline-Ausführung mit TDD ok.

**Type consistency:** `EinsatzEinstellungen.fachebenen_sichtbar: string | null` (roh) durchgängig; `EinstellungenUpdate.fachebenen_sichtbar: FachebenenSichtbar | null` (Objekt) beim Senden. `aufloeseStandardModul`/`waehleInitialeBasemap`-Signaturen über Tasks konsistent. `BASEMAP_MODI` Backend-Konstante; FE nutzt eigene `['online','offline','blind']`-Liste.
