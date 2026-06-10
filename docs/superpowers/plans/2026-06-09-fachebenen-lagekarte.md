# Fachebenen (Layer) für externe Lagedaten — Implementierungsplan (LFH-69)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Lagekarte um ein-/ausblendbare Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM) erweitern, deren Sichtbarkeit pro Einsatz gemerkt wird, mit definiertem Offline-Verhalten und dokumentierter Lizenz/Attribution.

**Architecture:** Ein **einheitlicher Backend-Aggregator** `GET /api/karte/fachebenen/{quelle}` ruft die externe Quelle ab, normalisiert sie zu einer GeoJSON-`FeatureCollection` und liefert einen einheitlichen Umschlag `{ quelle, status, attribution, stand, features }`. Bei Netzfehler antwortet er mit HTTP 200 + `status:"offline"` + leerer Collection (statt Fehler) → die Ebene wird im Frontend ausgegraut, nicht als Fehler gezeigt. Das Frontend rendert jede aktive Fachebene als eigene MapLibre-GeoJSON-Source/Layer nach dem bestehenden `kartenLayer.ts`-Muster und hängt sie in `reAnlegenAlles`/`planeReAnlegenNachStyle` ein (sonst verschwinden Overlays bei jedem Basemap-Wechsel). Sichtbarkeit pro Einsatz via `localStorage` (analog `basemapAuswahl.ts`).

**Tech Stack:** Backend: Rust, Axum 0.8, `reqwest` 0.12 (neu), `serde_json`, `tokio`. Frontend: React, TypeScript, MapLibre GL, TanStack Query, Ant Design, Vitest.

---

## Architektur-Vertrag (für alle Phasen verbindlich)

**Backend-Endpoint:** `GET /api/karte/fachebenen/{quelle}` mit `quelle ∈ {dwd, pegelonline, nina, kritis}`.
- Query-Param `bbox` (nur `kritis`, Format `west,sued,ost,nord` in WGS84) — fehlt er bei `kritis` → 400.
- Antwort-Umschlag (JSON):
  ```jsonc
  {
    "quelle": "dwd",
    "status": "ok" | "offline" | "leer",   // ok=Daten, leer=erreichbar aber 0 Features, offline=Quelle/Netz nicht erreichbar
    "attribution": "Datenbasis: Deutscher Wetterdienst",
    "stand": "2026-06-09T15:00:00Z" | null, // Zeitpunkt der Daten (best effort)
    "features": { "type": "FeatureCollection", "features": [ ... ] }
  }
  ```
- **Offline-Regel:** Externe Quelle nicht erreichbar (Timeout/DNS/5xx) → HTTP **200** mit `status:"offline"`, `features` = leere Collection, ggf. gecachte Daten als `status:"ok"` falls vorhanden. Niemals 5xx für eine reine Quell-Störung.
- **Caching:** In-Memory pro Quelle (bzw. pro gerundeter bbox bei `kritis`) mit TTL; bei Fetch-Fehler wird der letzte gültige Cache-Eintrag mit `status:"ok"` weitergereicht (stale-serving).

**Frontend-Typ (Spiegel des Umschlags):** in `frontend/src/api/fachebenen.ts`.

**Feature-Properties-Konvention (normalisiert):** jedes Feature trägt mindestens `{ titel: string, kategorie: string }`; warnstufenartige Quellen zusätzlich `{ schwere?: string }`.

---

## File Structure

**Backend (neu):**
- `src/karte/mod.rs` — Modul-Wurzel, Re-Exports, `FachebenenState` (HTTP-Client + Cache).
- `src/karte/typen.rs` — `FachebeneAntwort`, `FachebeneStatus`, `Bbox`, Envelope-Builder (`ok`, `offline`, `leer`).
- `src/karte/cache.rs` — `FachebenenCache` (`Mutex<HashMap<String, CacheEintrag>>` + TTL).
- `src/karte/normalisierung.rs` — **reine** Funktionen: `normalisiere_pegelonline`, `normalisiere_overpass`, `kombiniere_nina`. Unit-getestet mit Fixtures.
- `src/karte/quellen.rs` — Fetch-Logik je Quelle (`fetch_dwd`, `fetch_pegelonline`, `fetch_nina`, `fetch_kritis`), nutzt `reqwest` + Normalisierung.

**Backend (geändert):**
- `Cargo.toml` — `reqwest` Dependency.
- `src/lib.rs` — `pub mod karte;`.
- `src/app.rs` — `AppState` um `fachebenen: FachebenenState` erweitern; Route registrieren.
- `src/routes/karte.rs` — Handler `fachebenen(...)`.
- `src/main.rs` — `FachebenenState::neu()` beim Start in `AppState`.
- `tests/karte.rs` — Integrationstests für Validierung + Envelope.

**Frontend (neu):**
- `frontend/src/api/fachebenen.ts` — Typen + `ladeFachebene(quelle, bbox?)`.
- `frontend/src/pages/lagekarte/fachebenen.ts` — Registry (`FACHEBENEN`) + Konvertierung Umschlag→`FeatureCollection`.
- `frontend/src/pages/lagekarte/fachebenenAuswahl.ts` — Persistenz pro Einsatz (localStorage).
- `frontend/src/pages/lagekarte/fachebenenLayer.ts` — `sorgeFuerFachebeneLayer`, `entferneFachebeneLayer`.
- diverse `*.test.ts` dazu.

**Frontend (geändert):**
- `frontend/src/pages/lagekarte/kartenLayer.ts` — Fachebenen in `reAnlegenAlles`/`planeReAnlegenNachStyle` einhängen.
- `frontend/src/pages/lagekarte/Kartenflaeche.tsx` — neue Prop `fachebenen`, Source/Layer-Effekt + bbox-Callback.
- `frontend/src/pages/lagekarte/Sidebar.tsx` — neue „Fachebenen"-Card.
- `frontend/src/pages/LagekartePage.tsx` — Query-Hooks, Persistenz, Verdrahtung, Attribution.

---

# PHASE 1 — Backend-Framework + Offline-Contract

### Task 1: `reqwest`-Dependency + Modul-Skelett

**Files:**
- Modify: `Cargo.toml`
- Create: `src/karte/mod.rs`
- Modify: `src/lib.rs:16` (nach `pub mod katalog;`)

- [ ] **Step 1: `reqwest` in `Cargo.toml` ergänzen**

In `[dependencies]` (zu `serde_json = "1"` benachbart) einfügen:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 2: Modul-Wurzel anlegen** — `src/karte/mod.rs`:

```rust
//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM).
//! Holt externe Geodaten, normalisiert sie zu GeoJSON und liefert einen
//! einheitlichen Umschlag mit definiertem Offline-Verhalten.

pub mod cache;
pub mod normalisierung;
pub mod quellen;
pub mod typen;

use cache::FachebenenCache;
use std::sync::Arc;
use std::time::Duration;

/// Geteilter Zustand des Aggregators: ein wiederverwendeter HTTP-Client und der Cache.
#[derive(Clone)]
pub struct FachebenenState {
    pub client: reqwest::Client,
    pub cache: Arc<FachebenenCache>,
}

impl FachebenenState {
    pub fn neu() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("LifelineHub-Lagekarte/1.0 (+https://github.com/)")
            .build()
            .expect("reqwest-Client baubar");
        FachebenenState {
            client,
            cache: Arc::new(FachebenenCache::neu()),
        }
    }
}

impl Default for FachebenenState {
    fn default() -> Self {
        Self::neu()
    }
}
```

- [ ] **Step 3: Modul registrieren** — in `src/lib.rs` nach Zeile `pub mod katalog;` einfügen:

```rust
pub mod karte;
```

- [ ] **Step 4: Build prüfen**

Run: `cargo build`
Expected: kompiliert (es fehlen noch `cache`/`typen`/… → falls Build hier wegen fehlender Submodule scheitert, ist das erwartet; die nächsten Tasks legen sie an. Reihenfolge: Task 2 & 3 vor erneutem Build.)

> Hinweis: Lege Task 2 und Task 3 an, bevor du `cargo build` final erwartest. Die Submodul-`mod`-Zeilen in Step 2 verweisen auf noch nicht existierende Dateien.

- [ ] **Step 5: Commit** (zusammen mit Task 2+3, siehe Task 3 Step 5).

---

### Task 2: Envelope-Typen + Builder (`typen.rs`)

**Files:**
- Create: `src/karte/typen.rs`
- Test: `src/karte/typen.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Failing test schreiben** — `src/karte/typen.rs`:

```rust
//! Antwort-Umschlag des Fachebenen-Aggregators und Hilfsbuilder.

use serde::Serialize;
use serde_json::{json, Value};

/// Status einer Fachebenen-Antwort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FachebeneStatus {
    /// Daten vorhanden (frisch oder aus gültigem Cache).
    Ok,
    /// Quelle erreichbar, aber keine Features.
    Leer,
    /// Quelle/Netz nicht erreichbar; Ebene wird ausgegraut.
    Offline,
}

/// Einheitlicher Umschlag für jede Fachebene.
#[derive(Debug, Clone, Serialize)]
pub struct FachebeneAntwort {
    pub quelle: String,
    pub status: FachebeneStatus,
    pub attribution: String,
    pub stand: Option<String>,
    /// GeoJSON FeatureCollection.
    pub features: Value,
}

/// Leere FeatureCollection.
pub fn leere_collection() -> Value {
    json!({ "type": "FeatureCollection", "features": [] })
}

impl FachebeneAntwort {
    /// Erfolg mit Features. `status` wird automatisch `leer`, wenn 0 Features.
    pub fn ok(quelle: &str, attribution: &str, stand: Option<String>, features: Value) -> Self {
        let leer = features
            .get("features")
            .and_then(|f| f.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: if leer { FachebeneStatus::Leer } else { FachebeneStatus::Ok },
            attribution: attribution.to_string(),
            stand,
            features,
        }
    }

    /// Quelle nicht erreichbar → leer + Offline-Status (HTTP bleibt 200).
    pub fn offline(quelle: &str, attribution: &str) -> Self {
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: FachebeneStatus::Offline,
            attribution: attribution.to_string(),
            stand: None,
            features: leere_collection(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_mit_features_ist_ok() {
        let fc = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature" } ] });
        let a = FachebeneAntwort::ok("dwd", "X", None, fc);
        assert_eq!(a.status, FachebeneStatus::Ok);
    }

    #[test]
    fn ok_ohne_features_ist_leer() {
        let a = FachebeneAntwort::ok("dwd", "X", None, leere_collection());
        assert_eq!(a.status, FachebeneStatus::Leer);
    }

    #[test]
    fn offline_hat_leere_collection() {
        let a = FachebeneAntwort::offline("nina", "BBK");
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert_eq!(a.features["features"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn status_serialisiert_lowercase() {
        assert_eq!(serde_json::to_string(&FachebeneStatus::Offline).unwrap(), "\"offline\"");
    }
}
```

- [ ] **Step 2: Test failt erwartungsgemäß** (Datei neu → bis Task 1 `mod typen;` da ist).

Run: `cargo test --lib karte::typen`
Expected: kompiliert + Tests grün (reiner Code, keine externen Aufrufe).

- [ ] **Step 3: (Impl steht bereits in Step 1.)** Keine weitere Implementierung nötig.

- [ ] **Step 4: Tests laufen**

Run: `cargo test --lib karte::typen`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit** (mit Task 3).

---

### Task 3: Cache (`cache.rs`)

**Files:**
- Create: `src/karte/cache.rs`
- Test: `src/karte/cache.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Implementierung + Test** — `src/karte/cache.rs`:

```rust
//! Einfacher In-Memory-Cache mit TTL für Fachebenen-Antworten.
//! Schlüssel: `quelle` bzw. `quelle:bbox`. Kein await während des Lock-Haltens.

use crate::karte::typen::FachebeneAntwort;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct CacheEintrag {
    gespeichert: Instant,
    antwort: FachebeneAntwort,
}

pub struct FachebenenCache {
    eintraege: Mutex<HashMap<String, CacheEintrag>>,
}

impl FachebenenCache {
    pub fn neu() -> Self {
        FachebenenCache { eintraege: Mutex::new(HashMap::new()) }
    }

    /// Frischen Eintrag (jünger als `ttl`) liefern, sonst None.
    pub fn frisch(&self, schluessel: &str, ttl: Duration) -> Option<FachebeneAntwort> {
        let map = self.eintraege.lock().unwrap();
        map.get(schluessel)
            .filter(|e| e.gespeichert.elapsed() < ttl)
            .map(|e| e.antwort.clone())
    }

    /// Letzten (auch abgelaufenen) Eintrag liefern — für Stale-Serving bei Quell-Ausfall.
    pub fn stale(&self, schluessel: &str) -> Option<FachebeneAntwort> {
        let map = self.eintraege.lock().unwrap();
        map.get(schluessel).map(|e| e.antwort.clone())
    }

    pub fn setze(&self, schluessel: &str, antwort: FachebeneAntwort) {
        let mut map = self.eintraege.lock().unwrap();
        map.insert(schluessel.to_string(), CacheEintrag { gespeichert: Instant::now(), antwort });
    }
}

impl Default for FachebenenCache {
    fn default() -> Self {
        Self::neu()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte::typen::{leere_collection, FachebeneAntwort};

    fn antwort() -> FachebeneAntwort {
        FachebeneAntwort::ok("dwd", "X", None, leere_collection())
    }

    #[test]
    fn frisch_innerhalb_ttl() {
        let c = FachebenenCache::neu();
        c.setze("dwd", antwort());
        assert!(c.frisch("dwd", Duration::from_secs(60)).is_some());
    }

    #[test]
    fn nicht_frisch_nach_ttl_null() {
        let c = FachebenenCache::neu();
        c.setze("dwd", antwort());
        assert!(c.frisch("dwd", Duration::from_millis(0)).is_none());
        // aber stale liefert ihn weiterhin
        assert!(c.stale("dwd").is_some());
    }

    #[test]
    fn unbekannter_schluessel_ist_none() {
        let c = FachebenenCache::neu();
        assert!(c.frisch("x", Duration::from_secs(60)).is_none());
        assert!(c.stale("x").is_none());
    }
}
```

- [ ] **Step 2: Build + Test**

Run: `cargo test --lib karte::cache`
Expected: PASS (3 Tests). `cargo build` erfolgreich.

- [ ] **Step 3: Stub für `quellen.rs` + `normalisierung.rs`** (damit `mod.rs` baut, bis Phase 2ff. sie füllt) — `src/karte/normalisierung.rs`:

```rust
//! Reine Normalisierungs-Funktionen (rohe Quell-Antwort → GeoJSON-FeatureCollection).
//! Pro Quelle in den jeweiligen Phasen befüllt; hier zunächst leer.
```

`src/karte/quellen.rs`:

```rust
//! Fetch-Logik je Quelle. Wird in den Phasen 2–5 befüllt.
```

- [ ] **Step 4: Gesamtbuild**

Run: `cargo build`
Expected: kompiliert ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock src/lib.rs src/karte/
git commit -m "feat(be): Fachebenen-Aggregator-Gerüst (Cache, Envelope, reqwest) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `AppState` erweitern + Route + Handler-Skelett + Validierung

**Files:**
- Modify: `src/app.rs:13-16` (AppState), `:242` (Route)
- Modify: `src/main.rs` (AppState-Konstruktion)
- Modify: `src/routes/karte.rs` (Handler)
- Test: `tests/karte.rs`

- [ ] **Step 1: Failing integration test** — in `tests/karte.rs` ans Ende anfügen:

```rust
#[tokio::test]
async fn fachebenen_unbekannte_quelle_ist_400() {
    let pool = pool().await;
    let app = lifeline_hub::app::build_router(lifeline_hub::app::AppState {
        pool,
        live: lifeline_hub::live::LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    let req = Request::builder()
        .uri("/api/karte/fachebenen/gibtsnicht")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fachebenen_kritis_ohne_bbox_ist_400() {
    let pool = pool().await;
    let app = lifeline_hub::app::build_router(lifeline_hub::app::AppState {
        pool,
        live: lifeline_hub::live::LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    let req = Request::builder()
        .uri("/api/karte/fachebenen/kritis")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}
```

> Prüfe oben in `tests/karte.rs`, ob `AppState` dort schon mit zwei Feldern konstruiert wird; falls ja, ergänze in **allen** dortigen Konstruktionen das neue Feld `fachebenen: FachebenenState::neu()` (sonst Compile-Fehler). Importe ggf. ergänzen.

- [ ] **Step 2: `AppState` erweitern** — `src/app.rs`:

```rust
use crate::karte::FachebenenState;
```
und im Struct:
```rust
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub live: LiveHub,
    pub fachebenen: FachebenenState,
}
```

- [ ] **Step 3: Route registrieren** — in `src/app.rs` direkt nach Zeile 242 (`/api/karte/config`):

```rust
    let router = router.route(
        "/api/karte/fachebenen/{quelle}",
        get(routes::karte::fachebenen),
    );
```

- [ ] **Step 4: `main.rs` anpassen** — bei der `AppState`-Konstruktion das Feld ergänzen:

```rust
    let state = AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    };
```
(Feldnamen/Variablen an die vorhandene Stelle anpassen; `live`/`pool` wie bisher.)

- [ ] **Step 5: Handler mit Validierung** — in `src/routes/karte.rs` ergänzen:

```rust
use crate::app::AppState;
use crate::error::AppError;
use crate::karte::quellen;
use axum::extract::{Path, Query, State};
use std::collections::HashMap;

/// GET /api/karte/fachebenen/{quelle} — externe Lagedaten als GeoJSON-Umschlag.
pub async fn fachebenen(
    State(state): State<AppState>,
    Path(quelle): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<crate::karte::typen::FachebeneAntwort>, AppError> {
    let bbox = params.get("bbox").map(|s| s.as_str());
    let antwort = match quelle.as_str() {
        "dwd" => quellen::fetch_dwd(&state.fachebenen).await,
        "pegelonline" => quellen::fetch_pegelonline(&state.fachebenen).await,
        "nina" => quellen::fetch_nina(&state.fachebenen).await,
        "kritis" => {
            let bbox = bbox.ok_or_else(|| AppError::Validation("bbox-Parameter erforderlich".into()))?;
            quellen::fetch_kritis(&state.fachebenen, bbox).await?
        }
        _ => return Err(AppError::Validation(format!("Unbekannte Quelle: {quelle}"))),
    };
    Ok(Json(antwort))
}
```

> Hinweis Signaturen: `fetch_dwd/pegelonline/nina` geben `FachebeneAntwort` zurück (Offline-Fehler werden intern zu `status:"offline"`, daher **kein** `Result`). `fetch_kritis` gibt `Result<FachebeneAntwort, AppError>` zurück (bbox-Parse kann fehlschlagen → 400). Bis die Quellen in Phase 2–5 existieren, lege temporäre Stubs in `quellen.rs` an, die `FachebeneAntwort::offline(...)` zurückgeben, damit dieser Task allein baut:
>
> ```rust
> use crate::karte::typen::FachebeneAntwort;
> use crate::karte::FachebenenState;
> use crate::error::AppError;
> pub async fn fetch_dwd(_s: &FachebenenState) -> FachebeneAntwort { FachebeneAntwort::offline("dwd", "Datenbasis: Deutscher Wetterdienst") }
> pub async fn fetch_pegelonline(_s: &FachebenenState) -> FachebeneAntwort { FachebeneAntwort::offline("pegelonline", "PEGELONLINE / WSV") }
> pub async fn fetch_nina(_s: &FachebenenState) -> FachebeneAntwort { FachebeneAntwort::offline("nina", "BBK / MoWaS") }
> pub async fn fetch_kritis(_s: &FachebenenState, _bbox: &str) -> Result<FachebeneAntwort, AppError> { Ok(FachebeneAntwort::offline("kritis", "© OpenStreetMap-Beitragende")) }
> ```

- [ ] **Step 6: Tests laufen**

Run: `cargo test --test karte`
Expected: beide neuen Tests PASS (400 bei unbekannter Quelle und bei kritis ohne bbox).

- [ ] **Step 7: Commit**

```bash
git add src/app.rs src/main.rs src/routes/karte.rs src/karte/quellen.rs tests/karte.rs
git commit -m "feat(be): /api/karte/fachebenen/{quelle} Route + Validierung (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 2 — DWD-Adapter (offene Lizenz, Polygone direkt)

### Task 5: `fetch_dwd` (WFS-GeoJSON-Passthrough + Stale/Offline)

**Files:**
- Modify: `src/karte/quellen.rs` (`fetch_dwd` ersetzt Stub)
- Test: `tests/karte.rs` (Offline-/Envelope-Verhalten ohne echtes Netz nicht zuverlässig testbar → Smoke-Test optional, siehe Hinweis)

- [ ] **Step 1: Implementierung** — `fetch_dwd` in `src/karte/quellen.rs`:

```rust
use std::time::Duration;
use crate::karte::typen::{leere_collection, FachebeneAntwort};
use crate::karte::FachebenenState;

const DWD_ATTRIB: &str = "Datenbasis: Deutscher Wetterdienst";
const DWD_TTL: Duration = Duration::from_secs(300);
// Vereinigte Warngebiete (weniger Features, bundesweit), als GeoJSON.
const DWD_URL: &str = "https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden_vereinigt&outputFormat=application/json&srsName=EPSG:4326";

pub async fn fetch_dwd(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("dwd", DWD_TTL) {
        return a;
    }
    match hole_geojson(s, DWD_URL).await {
        Ok(fc) => {
            let a = FachebeneAntwort::ok("dwd", DWD_ATTRIB, None, fc);
            s.cache.setze("dwd", a.clone());
            a
        }
        Err(e) => {
            tracing::warn!("DWD-Fetch fehlgeschlagen: {e}");
            s.cache.stale("dwd").unwrap_or_else(|| FachebeneAntwort::offline("dwd", DWD_ATTRIB))
        }
    }
}

/// Holt eine externe URL und parst sie als GeoJSON-Value (FeatureCollection durchgereicht).
async fn hole_geojson(s: &FachebenenState, url: &str) -> Result<serde_json::Value, String> {
    let resp = s.client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // Defensiv: nur FeatureCollections akzeptieren, sonst leer.
    if v.get("type").and_then(|t| t.as_str()) == Some("FeatureCollection") {
        Ok(v)
    } else {
        Ok(leere_collection())
    }
}
```

> `hole_geojson` ist auch von späteren Quellen nutzbar — als `pub(crate)` markieren, wenn von anderen Modulen gebraucht.

- [ ] **Step 2: Build**

Run: `cargo build`
Expected: kompiliert.

- [ ] **Step 3: Manueller Smoke-Test (online, optional in CI überspringbar)**

Run (Backend starten, dann):
`curl -s "http://localhost:3000/api/karte/fachebenen/dwd" | head -c 300`
Expected: JSON mit `"quelle":"dwd"`, `"status":"ok"|"leer"|"offline"`, `"attribution":"Datenbasis: Deutscher Wetterdienst"`.

> Kein netzabhängiger Unit-Test im CI. Der hermetische Pfad (Validierung, Envelope) ist über Task 4 abgedeckt; das Normalisierungs-Verhalten testen wir bei Quellen mit eigener Normalisierung (Phase 3–5).

- [ ] **Step 4: Commit**

```bash
git add src/karte/quellen.rs
git commit -m "feat(be): DWD-Wetterwarnungen als Fachebene (WFS-GeoJSON) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 3 — PEGELONLINE-Adapter (Punkte → GeoJSON, eigene Normalisierung)

### Task 6: `normalisiere_pegelonline` (reine Funktion, unit-getestet)

**Files:**
- Modify: `src/karte/normalisierung.rs`
- Test: `src/karte/normalisierung.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Failing test + Impl** — in `src/karte/normalisierung.rs`:

```rust
use serde_json::{json, Value};

/// PEGELONLINE `stations.json` → GeoJSON-Points. Jede Station mit `longitude`/`latitude`
/// wird zu einem Punkt; aktueller Wasserstand (falls vorhanden) als `wert`/`einheit`.
pub fn normalisiere_pegelonline(roh: &Value) -> Value {
    let stationen = roh.as_array().cloned().unwrap_or_default();
    let features: Vec<Value> = stationen
        .iter()
        .filter_map(|st| {
            let lon = st.get("longitude")?.as_f64()?;
            let lat = st.get("latitude")?.as_f64()?;
            let name = st.get("longname").or_else(|| st.get("shortname")).and_then(|v| v.as_str()).unwrap_or("Pegel");
            let messung = st
                .get("currentMeasurement")
                .and_then(|m| m.get("value"))
                .and_then(|v| v.as_f64());
            let einheit = st.get("unit").and_then(|v| v.as_str()).unwrap_or("");
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": name,
                    "kategorie": "pegel",
                    "wert": messung,
                    "einheit": einheit
                }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baut_punkt_aus_station() {
        let roh = json!([
            { "longname": "KÖLN", "longitude": 6.96, "latitude": 50.94, "unit": "cm",
              "currentMeasurement": { "value": 320.0 } }
        ]);
        let fc = normalisiere_pegelonline(&roh);
        let f = &fc["features"][0];
        assert_eq!(f["geometry"]["coordinates"][0], 6.96);
        assert_eq!(f["properties"]["titel"], "KÖLN");
        assert_eq!(f["properties"]["kategorie"], "pegel");
        assert_eq!(f["properties"]["wert"], 320.0);
    }

    #[test]
    fn station_ohne_koordinate_wird_uebersprungen() {
        let roh = json!([{ "longname": "X" }]);
        let fc = normalisiere_pegelonline(&roh);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}
```

- [ ] **Step 2: Test failt/passt**

Run: `cargo test --lib karte::normalisierung::tests::baut_punkt_aus_station`
Expected: PASS.

- [ ] **Step 3: `fetch_pegelonline`** — in `src/karte/quellen.rs` Stub ersetzen:

```rust
use crate::karte::normalisierung::normalisiere_pegelonline;

const PEGEL_ATTRIB: &str = "PEGELONLINE / WSV";
const PEGEL_TTL: Duration = Duration::from_secs(300);
const PEGEL_URL: &str = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeCurrentMeasurement=true";

pub async fn fetch_pegelonline(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("pegelonline", PEGEL_TTL) {
        return a;
    }
    match hole_json(s, PEGEL_URL).await {
        Ok(roh) => {
            let fc = normalisiere_pegelonline(&roh);
            let a = FachebeneAntwort::ok("pegelonline", PEGEL_ATTRIB, None, fc);
            s.cache.setze("pegelonline", a.clone());
            a
        }
        Err(e) => {
            tracing::warn!("PEGELONLINE-Fetch fehlgeschlagen: {e}");
            s.cache.stale("pegelonline").unwrap_or_else(|| FachebeneAntwort::offline("pegelonline", PEGEL_ATTRIB))
        }
    }
}

/// Holt eine URL und parst sie als beliebigen JSON-Value (nicht zwingend GeoJSON).
pub(crate) async fn hole_json(s: &FachebenenState, url: &str) -> Result<serde_json::Value, String> {
    let resp = s.client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Build + Tests**

Run: `cargo test --lib karte::normalisierung && cargo build`
Expected: PASS, kompiliert.

- [ ] **Step 5: Commit**

```bash
git add src/karte/normalisierung.rs src/karte/quellen.rs
git commit -m "feat(be): PEGELONLINE-Pegel als Fachebene (Punkte) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 4 — NINA/MoWaS-Adapter (N+1 mapData→geojson, Attribution BBK)

### Task 7: `kombiniere_nina` (reine Funktion: Liste + Geometrien → FeatureCollection)

**Files:**
- Modify: `src/karte/normalisierung.rs`
- Test: `src/karte/normalisierung.rs`

- [ ] **Step 1: Test + Impl** — anfügen in `src/karte/normalisierung.rs`:

```rust
/// Kombiniert die NINA-`mapData`-Liste (Metadaten je `id`) mit den separat geladenen
/// Einzel-Geometrien (`id` → GeoJSON-Value von `/warnings/{id}.geojson`) zu einer
/// FeatureCollection. Jede Warnung kann mehrere Features (Polygone) tragen.
pub fn kombiniere_nina(map_data: &Value, geometrien: &[(String, Value)]) -> Value {
    use std::collections::HashMap;
    let meta: HashMap<&str, &Value> = map_data
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|w| w.get("id").and_then(|i| i.as_str()).map(|id| (id, w)))
                .collect()
        })
        .unwrap_or_default();

    let mut features: Vec<Value> = Vec::new();
    for (id, geo) in geometrien {
        let info = meta.get(id.as_str());
        let titel = info
            .and_then(|w| w.get("i18nTitle"))
            .and_then(|t| t.as_object())
            .and_then(|o| o.values().next())
            .and_then(|v| v.as_str())
            .unwrap_or("Warnung");
        let schwere = info.and_then(|w| w.get("severity")).and_then(|v| v.as_str()).unwrap_or("");
        if let Some(arr) = geo.get("features").and_then(|f| f.as_array()) {
            for f in arr {
                let geometry = f.get("geometry").cloned().unwrap_or(Value::Null);
                if geometry.is_null() {
                    continue;
                }
                features.push(json!({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": { "titel": titel, "kategorie": "warnung", "schwere": schwere, "id": id }
                }));
            }
        }
    }
    json!({ "type": "FeatureCollection", "features": features })
}

#[cfg(test)]
mod nina_tests {
    use super::*;

    #[test]
    fn kombiniert_meta_und_geometrie() {
        let map_data = json!([
            { "id": "abc", "severity": "Severe", "i18nTitle": { "de": "Hochwasser" } }
        ]);
        let geo = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]] } }
        ]});
        let fc = kombiniere_nina(&map_data, &[("abc".to_string(), geo)]);
        let f = &fc["features"][0];
        assert_eq!(f["properties"]["titel"], "Hochwasser");
        assert_eq!(f["properties"]["schwere"], "Severe");
        assert_eq!(f["geometry"]["type"], "Polygon");
    }

    #[test]
    fn ueberspringt_features_ohne_geometrie() {
        let map_data = json!([{ "id": "x" }]);
        let geo = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature", "geometry": null } ] });
        let fc = kombiniere_nina(&map_data, &[("x".to_string(), geo)]);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}
```

- [ ] **Step 2: Test laufen**

Run: `cargo test --lib karte::normalisierung`
Expected: PASS (alle Normalisierungs-Tests).

- [ ] **Step 3: `fetch_nina`** — Stub in `src/karte/quellen.rs` ersetzen:

```rust
use crate::karte::normalisierung::kombiniere_nina;
use futures::future::join_all;

const NINA_ATTRIB: &str = "Quelle: Bundesamt für Bevölkerungsschutz und Katastrophenhilfe (BBK) / MoWaS";
const NINA_TTL: Duration = Duration::from_secs(90);
const NINA_MAPDATA: &str = "https://warnung.bund.de/api31/mowas/mapData.json";
fn nina_geojson_url(id: &str) -> String {
    format!("https://warnung.bund.de/api31/warnings/{id}.geojson")
}

pub async fn fetch_nina(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("nina", NINA_TTL) {
        return a;
    }
    let map_data = match hole_json(s, NINA_MAPDATA).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("NINA-mapData-Fetch fehlgeschlagen: {e}");
            return s.cache.stale("nina").unwrap_or_else(|| FachebeneAntwort::offline("nina", NINA_ATTRIB));
        }
    };
    // IDs einsammeln und Geometrien parallel laden (N+1, begrenzt auf die aktuellen Warnungen).
    let ids: Vec<String> = map_data
        .as_array()
        .map(|a| a.iter().filter_map(|w| w.get("id").and_then(|i| i.as_str()).map(String::from)).collect())
        .unwrap_or_default();
    let geo_futs = ids.iter().map(|id| {
        let url = nina_geojson_url(id);
        let id = id.clone();
        async move {
            match hole_json(s, &url).await {
                Ok(v) => Some((id, v)),
                Err(_) => None,
            }
        }
    });
    let geometrien: Vec<(String, serde_json::Value)> = join_all(geo_futs).await.into_iter().flatten().collect();
    let fc = kombiniere_nina(&map_data, &geometrien);
    let a = FachebeneAntwort::ok("nina", NINA_ATTRIB, None, fc);
    s.cache.setze("nina", a.clone());
    a
}
```

- [ ] **Step 4: `futures`-Dependency prüfen/ergänzen**

Falls `futures` nicht in `Cargo.toml`: ergänzen mit `futures = "0.3"`. (Alternativ `join_all` über `futures-util`; prüfe vorhandene Deps mit `grep -n "futures" Cargo.toml`.)

Run: `cargo build`
Expected: kompiliert.

- [ ] **Step 5: Smoke-Test (online, optional)**

`curl -s "http://localhost:3000/api/karte/fachebenen/nina" | head -c 200`
Expected: `"quelle":"nina"`, `"attribution":"Quelle: Bundesamt...BBK / MoWaS"`.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock src/karte/normalisierung.rs src/karte/quellen.rs
git commit -m "feat(be): NINA/MoWaS-Warnungen als Fachebene (mapData+Geometrie, BBK-Quelle) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 5 — KRITIS/OSM-Adapter (Overpass, bbox-getrieben)

### Task 8: `Bbox`-Parsing + `normalisiere_overpass`

**Files:**
- Modify: `src/karte/typen.rs` (Bbox)
- Modify: `src/karte/normalisierung.rs` (overpass)
- Test: jeweils `#[cfg(test)]`

- [ ] **Step 1: `Bbox` in `typen.rs`** anfügen:

```rust
/// Bounding-Box in WGS84, Reihenfolge wie vom Frontend: west,sued,ost,nord.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bbox {
    pub west: f64,
    pub sued: f64,
    pub ost: f64,
    pub nord: f64,
}

impl Bbox {
    /// Parst "west,sued,ost,nord". Fehler → Err(Meldung).
    pub fn parse(s: &str) -> Result<Bbox, String> {
        let teile: Vec<f64> = s.split(',').map(|t| t.trim().parse::<f64>()).collect::<Result<_, _>>().map_err(|_| "bbox muss vier Zahlen sein".to_string())?;
        match teile.as_slice() {
            [west, sued, ost, nord] if west < ost && sued < nord => Ok(Bbox { west: *west, sued: *sued, ost: *ost, nord: *nord }),
            _ => Err("bbox ungültig (west,sued,ost,nord)".to_string()),
        }
    }
    /// Overpass erwartet sued,west,nord,ost.
    pub fn overpass(&self) -> String {
        format!("{},{},{},{}", self.sued, self.west, self.nord, self.ost)
    }
    /// Cache-Schlüssel: auf 2 Nachkommastellen gerundet (≈1 km), reduziert Cache-Streuung.
    pub fn cache_key(&self) -> String {
        format!("kritis:{:.2},{:.2},{:.2},{:.2}", self.west, self.sued, self.ost, self.nord)
    }
}

#[cfg(test)]
mod bbox_tests {
    use super::*;
    #[test]
    fn parst_gueltige_bbox() {
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert_eq!(b.overpass(), "50,6,51,7");
    }
    #[test]
    fn lehnt_vertauschte_grenzen_ab() {
        assert!(Bbox::parse("7.0,50.0,6.0,51.0").is_err());
    }
    #[test]
    fn lehnt_unvollstaendig_ab() {
        assert!(Bbox::parse("1,2,3").is_err());
    }
}
```

- [ ] **Step 2: `normalisiere_overpass`** in `src/karte/normalisierung.rs` anfügen:

```rust
/// Overpass-JSON (`elements` mit `lat`/`lon` bei Nodes bzw. `center` bei Ways/Relations,
/// dank `out center`) → GeoJSON-Points. `kategorie` wird aus den Tags abgeleitet.
pub fn normalisiere_overpass(roh: &Value) -> Value {
    let elemente = roh.get("elements").and_then(|e| e.as_array()).cloned().unwrap_or_default();
    let features: Vec<Value> = elemente
        .iter()
        .filter_map(|el| {
            let (lon, lat) = if let (Some(lon), Some(lat)) = (el.get("lon").and_then(|v| v.as_f64()), el.get("lat").and_then(|v| v.as_f64())) {
                (lon, lat)
            } else {
                let c = el.get("center")?;
                (c.get("lon")?.as_f64()?, c.get("lat")?.as_f64()?)
            };
            let tags = el.get("tags").and_then(|t| t.as_object());
            let kategorie = kritis_kategorie(tags);
            let titel = tags
                .and_then(|t| t.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or(kategorie_label(&kategorie));
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": { "titel": titel, "kategorie": kategorie }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

fn kritis_kategorie(tags: Option<&serde_json::Map<String, Value>>) -> String {
    let g = |k: &str| tags.and_then(|t| t.get(k)).and_then(|v| v.as_str());
    if g("amenity") == Some("hospital") || g("amenity") == Some("clinic") { return "krankenhaus".into(); }
    if g("amenity") == Some("nursing_home") || g("social_facility").is_some() { return "pflege".into(); }
    if g("amenity") == Some("school") || g("amenity") == Some("kindergarten") { return "schule".into(); }
    if g("man_made") == Some("water_works") || g("man_made") == Some("water_tower") { return "wasser".into(); }
    if g("power") == Some("substation") { return "strom".into(); }
    if g("amenity") == Some("fire_station") { return "feuerwehr".into(); }
    if g("amenity") == Some("police") { return "polizei".into(); }
    "kritis".into()
}

fn kategorie_label(k: &str) -> &'static str {
    match k {
        "krankenhaus" => "Krankenhaus",
        "pflege" => "Pflegeeinrichtung",
        "schule" => "Schule/Kita",
        "wasser" => "Wasserversorgung",
        "strom" => "Umspannwerk",
        "feuerwehr" => "Feuerwehr",
        "polizei" => "Polizei",
        _ => "KRITIS-Objekt",
    }
}

#[cfg(test)]
mod overpass_tests {
    use super::*;
    #[test]
    fn node_wird_punkt() {
        let roh = json!({ "elements": [ { "type": "node", "lon": 6.9, "lat": 50.9, "tags": { "amenity": "hospital", "name": "Uniklinik" } } ] });
        let fc = normalisiere_overpass(&roh);
        assert_eq!(fc["features"][0]["properties"]["kategorie"], "krankenhaus");
        assert_eq!(fc["features"][0]["properties"]["titel"], "Uniklinik");
    }
    #[test]
    fn way_mit_center_wird_punkt() {
        let roh = json!({ "elements": [ { "type": "way", "center": { "lon": 7.0, "lat": 51.0 }, "tags": { "power": "substation" } } ] });
        let fc = normalisiere_overpass(&roh);
        assert_eq!(fc["features"][0]["geometry"]["coordinates"][0], 7.0);
        assert_eq!(fc["features"][0]["properties"]["kategorie"], "strom");
        assert_eq!(fc["features"][0]["properties"]["titel"], "Umspannwerk");
    }
}
```

- [ ] **Step 3: Tests laufen**

Run: `cargo test --lib karte::`
Expected: PASS (typen + normalisierung inkl. bbox/overpass).

- [ ] **Step 4: Commit**

```bash
git add src/karte/typen.rs src/karte/normalisierung.rs
git commit -m "feat(be): Bbox-Parsing + Overpass-Normalisierung für KRITIS (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `fetch_kritis` (Overpass-Query + bbox-Cache)

**Files:**
- Modify: `src/karte/quellen.rs`

- [ ] **Step 1: Implementierung** — Stub `fetch_kritis` ersetzen:

```rust
use crate::karte::normalisierung::normalisiere_overpass;
use crate::karte::typen::Bbox;
use crate::error::AppError;

const KRITIS_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
const KRITIS_TTL: Duration = Duration::from_secs(3600);
const OVERPASS_URL: &str = "https://overpass-api.de/api/interpreter";

fn overpass_query(bbox_op: &str) -> String {
    format!(
        "[out:json][timeout:25];(\
nwr[amenity=hospital]({b});nwr[amenity=clinic]({b});nwr[amenity=nursing_home]({b});\
nwr[\"social_facility\"]({b});nwr[amenity=school]({b});nwr[amenity=kindergarten]({b});\
nwr[man_made=water_works]({b});nwr[man_made=water_tower]({b});nwr[power=substation]({b});\
nwr[amenity=fire_station]({b});nwr[amenity=police]({b}););out center tags;",
        b = bbox_op
    )
}

pub async fn fetch_kritis(s: &FachebenenState, bbox_roh: &str) -> Result<FachebeneAntwort, AppError> {
    let bbox = Bbox::parse(bbox_roh).map_err(AppError::Validation)?;
    let key = bbox.cache_key();
    if let Some(a) = s.cache.frisch(&key, KRITIS_TTL) {
        return Ok(a);
    }
    let query = overpass_query(&bbox.overpass());
    let resp = s.client.post(OVERPASS_URL).body(query).send().await;
    match resp {
        Ok(r) if r.status().is_success() => {
            let roh: serde_json::Value = r.json().await.map_err(|e| e.to_string()).unwrap_or(serde_json::Value::Null);
            let fc = normalisiere_overpass(&roh);
            let a = FachebeneAntwort::ok("kritis", KRITIS_ATTRIB, None, fc);
            s.cache.setze(&key, a.clone());
            Ok(a)
        }
        other => {
            tracing::warn!("Overpass-Fetch fehlgeschlagen: {other:?}");
            Ok(s.cache.stale(&key).unwrap_or_else(|| FachebeneAntwort::offline("kritis", KRITIS_ATTRIB)))
        }
    }
}
```

- [ ] **Step 2: Build + Validierungs-Test erneut**

Run: `cargo test --test karte && cargo build`
Expected: PASS (`fachebenen_kritis_ohne_bbox_ist_400` weiterhin grün, jetzt über echten Pfad).

- [ ] **Step 3: Smoke-Test (online, optional)**

`curl -s "http://localhost:3000/api/karte/fachebenen/kritis?bbox=6.9,50.9,7.0,51.0" | head -c 200`
Expected: `"quelle":"kritis"`, Features als Points.

- [ ] **Step 4: Backend-Gesamttest + Lint**

Run: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: alle Tests grün, keine Clippy-Warnungen.

- [ ] **Step 5: Commit**

```bash
git add src/karte/quellen.rs
git commit -m "feat(be): KRITIS/OSM via Overpass als bbox-Fachebene (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 6 — Frontend: API-Client + Registry + Persistenz

### Task 10: API-Typen + `ladeFachebene`

**Files:**
- Create: `frontend/src/api/fachebenen.ts`

- [ ] **Step 1: Implementierung** — `frontend/src/api/fachebenen.ts`:

```ts
import { apiGet } from './client';

export type FachebeneStatus = 'ok' | 'leer' | 'offline';

/** GeoJSON FeatureCollection (lose typisiert — Geometrie ist Quell-abhängig). */
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown>;
  }>;
}

export interface FachebeneAntwort {
  quelle: string;
  status: FachebeneStatus;
  attribution: string;
  stand: string | null;
  features: FeatureCollection;
}

export type FachebeneQuelle = 'dwd' | 'pegelonline' | 'nina' | 'kritis';

/** Lädt eine Fachebene. `bbox` (west,sued,ost,nord) ist nur für `kritis` nötig. */
export function ladeFachebene(quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : '';
  return apiGet<FachebeneAntwort>(`/api/karte/fachebenen/${quelle}${q}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/fachebenen.ts
git commit -m "feat(fe): API-Client für Fachebenen (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Registry (`fachebenen.ts`)

**Files:**
- Create: `frontend/src/pages/lagekarte/fachebenen.ts`
- Test: `frontend/src/pages/lagekarte/fachebenen.test.ts`

- [ ] **Step 1: Failing test** — `frontend/src/pages/lagekarte/fachebenen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FACHEBENEN, fachebeneKeys, istBboxAbhaengig } from './fachebenen';

describe('Fachebenen-Registry', () => {
  it('enthält die vier v1-Quellen', () => {
    expect(fachebeneKeys()).toEqual(['nina', 'dwd', 'pegelonline', 'kritis']);
  });
  it('markiert nur kritis als bbox-abhängig', () => {
    expect(istBboxAbhaengig('kritis')).toBe(true);
    expect(istBboxAbhaengig('dwd')).toBe(false);
  });
  it('jede Ebene hat Label, Farbe, Geometrietyp und Poll-Intervall', () => {
    for (const e of Object.values(FACHEBENEN)) {
      expect(e.label).toBeTruthy();
      expect(e.farbe).toMatch(/^#/);
      expect(['polygon', 'punkt']).toContain(e.geometrieTyp);
      expect(e.pollMs).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Implementierung** — `frontend/src/pages/lagekarte/fachebenen.ts`:

```ts
import type { FachebeneQuelle } from '../../api/fachebenen';

export interface FachebeneDef {
  key: FachebeneQuelle;
  label: string;
  farbe: string;
  geometrieTyp: 'polygon' | 'punkt';
  /** Poll-Intervall in ms (Frontend refetchInterval). */
  pollMs: number;
  /** True → braucht Karten-Viewport-bbox (kein Hintergrund-Polling, Refetch bei moveend). */
  bboxAbhaengig: boolean;
}

export const FACHEBENEN: Record<FachebeneQuelle, FachebeneDef> = {
  nina: { key: 'nina', label: 'Amtliche Warnungen (NINA)', farbe: '#cf1322', geometrieTyp: 'polygon', pollMs: 90_000, bboxAbhaengig: false },
  dwd: { key: 'dwd', label: 'Wetterwarnungen (DWD)', farbe: '#d48806', geometrieTyp: 'polygon', pollMs: 300_000, bboxAbhaengig: false },
  pegelonline: { key: 'pegelonline', label: 'Pegel / Hochwasser', farbe: '#096dd9', geometrieTyp: 'punkt', pollMs: 300_000, bboxAbhaengig: false },
  kritis: { key: 'kritis', label: 'KRITIS / sensible Objekte', farbe: '#531dab', geometrieTyp: 'punkt', pollMs: 0, bboxAbhaengig: true },
};

/** Anzeige-Reihenfolge im Panel. */
export function fachebeneKeys(): FachebeneQuelle[] {
  return ['nina', 'dwd', 'pegelonline', 'kritis'];
}

export function istBboxAbhaengig(key: FachebeneQuelle): boolean {
  return FACHEBENEN[key].bboxAbhaengig;
}
```

- [ ] **Step 3: Tests laufen**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/fachebenen.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/fachebenen.ts frontend/src/pages/lagekarte/fachebenen.test.ts
git commit -m "feat(fe): Fachebenen-Registry (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Sichtbarkeits-Persistenz pro Einsatz (`fachebenenAuswahl.ts`)

**Files:**
- Create: `frontend/src/pages/lagekarte/fachebenenAuswahl.ts`
- Test: `frontend/src/pages/lagekarte/fachebenenAuswahl.test.ts`

> Hinweis (Memory): jsdom/Node liefert ggf. kein `localStorage`. Der Test-Setup (`src/test/setup.ts`) polyfilled es bereits + `afterEach`-clear — Tests dürfen `localStorage` direkt nutzen.

- [ ] **Step 1: Failing test** — `frontend/src/pages/lagekarte/fachebenenAuswahl.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { liesFachebenenSichtbar, merkeFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';

const leer: FachebenenSichtbar = { nina: false, dwd: false, pegelonline: false, kritis: false };

describe('Fachebenen-Persistenz pro Einsatz', () => {
  beforeEach(() => localStorage.clear());

  it('liefert null ohne gespeicherte Wahl', () => {
    expect(liesFachebenenSichtbar(7)).toBeNull();
  });
  it('merkt und liest pro Einsatz getrennt', () => {
    merkeFachebenenSichtbar(7, { ...leer, dwd: true });
    merkeFachebenenSichtbar(8, { ...leer, nina: true });
    expect(liesFachebenenSichtbar(7)?.dwd).toBe(true);
    expect(liesFachebenenSichtbar(7)?.nina).toBe(false);
    expect(liesFachebenenSichtbar(8)?.nina).toBe(true);
  });
  it('ignoriert kaputten Inhalt', () => {
    localStorage.setItem('fachebenen:sichtbar:9', '{kaputt');
    expect(liesFachebenenSichtbar(9)).toBeNull();
  });
});
```

- [ ] **Step 2: Implementierung** — `frontend/src/pages/lagekarte/fachebenenAuswahl.ts`:

```ts
import type { FachebeneQuelle } from '../../api/fachebenen';

export type FachebenenSichtbar = Record<FachebeneQuelle, boolean>;

const schluessel = (einsatzId: number) => `fachebenen:sichtbar:${einsatzId}`;

export function merkeFachebenenSichtbar(einsatzId: number, wahl: FachebenenSichtbar): void {
  try {
    localStorage.setItem(schluessel(einsatzId), JSON.stringify(wahl));
  } catch {
    /* localStorage nicht verfügbar — ohne Persistenz weiterarbeiten */
  }
}

export function liesFachebenenSichtbar(einsatzId: number): FachebenenSichtbar | null {
  try {
    const roh = localStorage.getItem(schluessel(einsatzId));
    if (!roh) return null;
    const w = JSON.parse(roh) as Partial<FachebenenSichtbar>;
    return {
      nina: w.nina === true,
      dwd: w.dwd === true,
      pegelonline: w.pegelonline === true,
      kritis: w.kritis === true,
    };
  } catch {
    return null;
  }
}

/** Default: alles aus. */
export function defaultFachebenenSichtbar(): FachebenenSichtbar {
  return { nina: false, dwd: false, pegelonline: false, kritis: false };
}
```

- [ ] **Step 3: Tests laufen**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/fachebenenAuswahl.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/fachebenenAuswahl.ts frontend/src/pages/lagekarte/fachebenenAuswahl.test.ts
git commit -m "feat(fe): Fachebenen-Sichtbarkeit pro Einsatz persistieren (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 7 — Frontend: MapLibre-Rendering + Style-Wechsel-Robustheit

### Task 13: `fachebenenLayer.ts` (Source/Layer je Ebene, jsdom-testbar)

**Files:**
- Create: `frontend/src/pages/lagekarte/fachebenenLayer.ts`
- Test: `frontend/src/pages/lagekarte/fachebenenLayer.test.ts`

> Konvention (wie `kartenLayer.ts`): nur `import type` von maplibre-gl → kein WebGL-Laufzeitimport → in jsdom testbar.

- [ ] **Step 1: Failing test** — `frontend/src/pages/lagekarte/fachebenenLayer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { sorgeFuerFachebeneLayer, entferneFachebeneLayer, fachebeneSourceId } from './fachebenenLayer';
import { FACHEBENEN } from './fachebenen';

function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  return {
    getSource: vi.fn((id: string) => (sources.has(id) ? {} : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((l: { id: string }) => layers.add(l.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    _sources: sources,
    _layers: layers,
  };
}

const leer = { type: 'FeatureCollection', features: [] } as const;

describe('fachebenenLayer', () => {
  it('legt Source + Polygon-Layer für DWD an (idempotent)', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(true);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(true);
    expect(m._layers.has('fachebene-dwd-line')).toBe(true);
    // nur einmal angelegt
    expect(m.addSource).toHaveBeenCalledTimes(1);
  });

  it('legt Circle-Layer für Punkt-Ebene (pegelonline) an', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.pegelonline, leer as never);
    expect(m._layers.has('fachebene-pegelonline-circle')).toBe(true);
  });

  it('entfernt Layer + Source', () => {
    const m = fakeMap();
    sorgeFuerFachebeneLayer(m as never, FACHEBENEN.dwd, leer as never);
    entferneFachebeneLayer(m as never, 'dwd');
    expect(m._sources.has(fachebeneSourceId('dwd'))).toBe(false);
    expect(m._layers.has('fachebene-dwd-fill')).toBe(false);
  });
});
```

- [ ] **Step 2: Implementierung** — `frontend/src/pages/lagekarte/fachebenenLayer.ts`:

```ts
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection, FachebeneQuelle } from '../../api/fachebenen';

export const fachebeneSourceId = (key: string) => `fachebene-${key}`;

/** Idempotent: Source + (Polygon: fill/line | Punkt: circle)-Layer je Fachebene. */
export function sorgeFuerFachebeneLayer(map: MapLibreMap, def: FachebeneDef, daten: FeatureCollection) {
  const src = fachebeneSourceId(def.key);
  if (!map.getSource(src)) {
    map.addSource(src, { type: 'geojson', data: daten as never });
  }
  if (def.geometrieTyp === 'polygon') {
    if (!map.getLayer(`fachebene-${def.key}-fill`)) {
      map.addLayer({
        id: `fachebene-${def.key}-fill`,
        type: 'fill',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': def.farbe, 'fill-opacity': 0.2 },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-line`)) {
      map.addLayer({
        id: `fachebene-${def.key}-line`,
        type: 'line',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': def.farbe, 'line-width': 1.5 },
      });
    }
  } else {
    if (!map.getLayer(`fachebene-${def.key}-circle`)) {
      map.addLayer({
        id: `fachebene-${def.key}-circle`,
        type: 'circle',
        source: src,
        paint: {
          'circle-radius': 5,
          'circle-color': def.farbe,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
    }
  }
}

const layerIds = (key: FachebeneQuelle) => [
  `fachebene-${key}-fill`,
  `fachebene-${key}-line`,
  `fachebene-${key}-circle`,
];

/** Entfernt alle Layer + Source einer Fachebene (idempotent). */
export function entferneFachebeneLayer(map: MapLibreMap, key: FachebeneQuelle) {
  for (const id of layerIds(key)) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  const src = fachebeneSourceId(key);
  if (map.getSource(src)) map.removeSource(src);
}

/** Daten einer bestehenden Fachebene-Source aktualisieren. */
export function setzeFachebeneDaten(map: MapLibreMap, key: FachebeneQuelle, daten: FeatureCollection) {
  const s = map.getSource(fachebeneSourceId(key)) as GeoJSONSource | undefined;
  if (s) s.setData(daten as never);
}
```

- [ ] **Step 3: Tests laufen**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/fachebenenLayer.test.ts --no-file-parallelism`
Expected: PASS (3 Tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/fachebenenLayer.ts frontend/src/pages/lagekarte/fachebenenLayer.test.ts
git commit -m "feat(fe): MapLibre Source/Layer je Fachebene (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Fachebenen in `reAnlegenAlles`/`planeReAnlegenNachStyle` einhängen (KRITISCH)

**Files:**
- Modify: `frontend/src/pages/lagekarte/kartenLayer.ts`
- Test: `frontend/src/pages/lagekarte/kartenLayer.test.ts`

> **Warum kritisch:** `setStyle` (Basemap-Wechsel) löscht alle Custom-Sources/Layer. Abschnitte/Zonen überleben, weil sie in `reAnlegenAlles` neu angelegt werden. Fachebenen müssen hier mit hinein, sonst verschwinden NINA/DWD-Polygone beim Wechsel z. B. auf Online-Luftbild.

- [ ] **Step 1: Failing test** — in `frontend/src/pages/lagekarte/kartenLayer.test.ts` ergänzen (Stil an die vorhandenen Tests anpassen):

```ts
import { FACHEBENEN } from './fachebenen';

it('reAnlegenAlles legt aktive Fachebenen mit an', () => {
  // fakeMap analog zu den bestehenden kartenLayer-Tests verwenden
  const m = macheFakeMap(); // vorhandener Helper in dieser Test-Datei
  const aktive = [
    { def: FACHEBENEN.dwd, daten: { type: 'FeatureCollection', features: [] } },
  ];
  reAnlegenAlles(m as never, baueFlaechenFc([]), baueZonenFc([]), aktive as never);
  expect(m._layers.has('fachebene-dwd-fill')).toBe(true);
});
```

- [ ] **Step 2: `reAnlegenAlles` erweitern** — Signatur in `kartenLayer.ts` um aktive Fachebenen ergänzen:

```ts
import { sorgeFuerFachebeneLayer, setzeFachebeneDaten } from './fachebenenLayer';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection } from '../../api/fachebenen';

export interface AktiveFachebene {
  def: FachebeneDef;
  daten: FeatureCollection;
}

export function reAnlegenAlles(
  map: MapLibreMap,
  flaechen: FlaechenFeatureCollection,
  zonen: ZonenFeatureCollection,
  fachebenen: AktiveFachebene[] = [],
) {
  sorgeFuerAbschnittLayer(map, flaechen);
  (map.getSource('abschnitte') as GeoJSONSource | undefined)?.setData(flaechen as never);
  sorgeFuerZonenLayer(map, zonen);
  (map.getSource('zonen') as GeoJSONSource | undefined)?.setData(zonen as never);
  for (const fe of fachebenen) {
    sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
    setzeFachebeneDaten(map, fe.def.key, fe.daten);
  }
}
```

- [ ] **Step 3: `planeReAnlegenNachStyle` erweitern**

```ts
export function planeReAnlegenNachStyle(
  map: Pick<MapLibreMap, 'isStyleLoaded' | 'on' | 'off'> & MapLibreMap,
  getFlaechen: () => FlaechenFeatureCollection,
  getZonen: () => ZonenFeatureCollection,
  getFachebenen: () => AktiveFachebene[] = () => [],
) {
  wendeKartenDatenAn(map, () => reAnlegenAlles(map, getFlaechen(), getZonen(), getFachebenen()));
}
```

- [ ] **Step 4: Tests laufen**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/kartenLayer.test.ts --no-file-parallelism`
Expected: PASS (bestehende + neuer Test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/kartenLayer.ts frontend/src/pages/lagekarte/kartenLayer.test.ts
git commit -m "feat(fe): Fachebenen in Style-Wechsel-Re-Anlage einhängen (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: `Kartenflaeche.tsx` — Fachebenen-Prop, Effekt, bbox-Callback

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- [ ] **Step 1: Prop + Ref + Re-Anlage-Verdrahtung**

In `KartenflaecheProps` ergänzen:

```ts
  /** Aktive Fachebenen mit Daten (externe Overlays). */
  fachebenen?: import('./kartenLayer').AktiveFachebene[];
  /** Karten-Viewport (west,sued,ost,nord) nach Bewegung — für bbox-abhängige Ebenen. */
  onBboxAenderung?: (bbox: string) => void;
```

Im Funktionskopf destrukturieren (`fachebenen, onBboxAenderung`) und Ref anlegen:

```ts
  const fachebenenRef = useRef<import('./kartenLayer').AktiveFachebene[]>(fachebenen ?? []);
  fachebenenRef.current = fachebenen ?? [];
```

`load`-Handler (in der Map-Erzeugung) ergänzen:

```ts
    map.on('load', () => {
      stilGeladenRef.current = true;
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
      sorgeFuerZonenLayer(map, zonenDatenRef.current);
      for (const fe of fachebenenRef.current) {
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
      }
    });
```

`setStyle`-Effekt: `planeReAnlegenNachStyle(map, () => flaechenDatenRef.current, () => zonenDatenRef.current, () => fachebenenRef.current);`

Imports ergänzen: `sorgeFuerFachebeneLayer, setzeFachebeneDaten, entferneFachebeneLayer` aus `./fachebenenLayer`.

- [ ] **Step 2: Daten-Effekt für Fachebenen** — neuen Effekt einfügen (analog Flächen/Zonen):

```ts
  // Aktive Fachebenen rendern: Source/Layer sicherstellen, Daten einspielen,
  // inaktive entfernen. Vertagt über wendeKartenDatenAn (Style evtl. nicht geladen).
  const vorherigeFachebenenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktiv = fachebenen ?? [];
    fachebenenRef.current = aktiv;
    wendeKartenDatenAn(map, () => {
      const aktivKeys = new Set(aktiv.map((f) => f.def.key));
      // entfernte Ebenen abbauen
      for (const key of vorherigeFachebenenRef.current) {
        if (!aktivKeys.has(key as never)) entferneFachebeneLayer(map, key as never);
      }
      // aktive an-/nachlegen + Daten setzen
      for (const fe of aktiv) {
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
        setzeFachebeneDaten(map, fe.def.key, fe.daten);
      }
      vorherigeFachebenenRef.current = aktivKeys as Set<string>;
    });
  }, [fachebenen]);
```

- [ ] **Step 3: bbox-Callback bei `moveend`** (debounced) — neuer Effekt:

```ts
  // Viewport-bbox nach Kartenbewegung melden (für bbox-abhängige Ebenen wie KRITIS).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onBboxAenderung) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const melde = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        onBboxAenderung(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
      }, 600);
    };
    map.on('moveend', melde);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', melde);
    };
  }, [onBboxAenderung]);
```

- [ ] **Step 4: Typecheck + bestehende Kartentests**

Run: `cd frontend && pnpm tsc --noEmit && pnpm vitest run src/pages/lagekarte --no-file-parallelism`
Expected: keine Typfehler; alle bestehenden lagekarte-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): Kartenflaeche rendert Fachebenen + meldet Viewport-bbox (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 8 — Frontend: Panel, Verdrahtung, Attribution, Offline-Anzeige

### Task 16: „Fachebenen"-Card in `Sidebar.tsx`

**Files:**
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`

- [ ] **Step 1: Props erweitern** — in `SidebarProps` ergänzen:

```ts
  fachebenenSichtbar: import('./fachebenenAuswahl').FachebenenSichtbar;
  onFachebeneToggle: (key: import('../../api/fachebenen').FachebeneQuelle, an: boolean) => void;
  /** Status je Fachebene für Ausgrau-/Offline-Hinweis. */
  fachebenenStatus: Partial<Record<import('../../api/fachebenen').FachebeneQuelle, import('../../api/fachebenen').FachebeneStatus>>;
```

- [ ] **Step 2: Card rendern** — nach der „Ebenen"-Card einfügen:

```tsx
      <Card size="small" title="Fachebenen (extern)" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {fachebeneKeys().map((key) => {
            const def = FACHEBENEN[key];
            const status = props.fachebenenStatus[key];
            const offline = status === 'offline';
            return (
              <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space>
                  <Switch
                    checked={props.fachebenenSichtbar[key]}
                    onChange={(v) => props.onFachebeneToggle(key, v)}
                  />
                  <span style={{ color: def.farbe }}>●</span> {def.label}
                </Space>
                {props.fachebenenSichtbar[key] && offline && (
                  <Tooltip title="Quelle offline — Ebene wird leer angezeigt">
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>offline</Typography.Text>
                  </Tooltip>
                )}
                {props.fachebenenSichtbar[key] && status === 'leer' && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>keine Daten</Typography.Text>
                )}
              </Space>
            );
          })}
        </Space>
      </Card>
```

Imports ergänzen: `import { FACHEBENEN, fachebeneKeys } from './fachebenen';`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx
git commit -m "feat(fe): Fachebenen-Auswahlpanel in der Sidebar (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 17: `LagekartePage.tsx` — Queries, Persistenz, Verdrahtung, Attribution

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`

- [ ] **Step 1: State + Persistenz initialisieren**

Importe:

```ts
import { ladeFachebene, type FachebeneQuelle, type FachebeneStatus } from '../api/fachebenen';
import { FACHEBENEN, fachebeneKeys } from './lagekarte/fachebenen';
import { liesFachebenenSichtbar, merkeFachebenenSichtbar, defaultFachebenenSichtbar, type FachebenenSichtbar } from './lagekarte/fachebenenAuswahl';
import type { AktiveFachebene } from './lagekarte/kartenLayer';
```

State (analog basemap-Persistenz):

```ts
  const [fachebenenSichtbar, setFachebenenSichtbar] = useState<FachebenenSichtbar>(defaultFachebenenSichtbar);
  const [kritisBbox, setKritisBbox] = useState<string | null>(null);
  const fachebenenInitRef = useRef(false);
  useEffect(() => {
    if (fachebenenInitRef.current) return;
    fachebenenInitRef.current = true;
    const gespeichert = liesFachebenenSichtbar(einsatzId);
    if (gespeichert) setFachebenenSichtbar(gespeichert);
  }, [einsatzId]);
  useEffect(() => {
    if (!fachebenenInitRef.current) return;
    merkeFachebenenSichtbar(einsatzId, fachebenenSichtbar);
  }, [fachebenenSichtbar, einsatzId]);
```

- [ ] **Step 2: Query-Hooks je Fachebene**

```ts
  const ninaQuery = useQuery({
    queryKey: ['fachebene', 'nina'], queryFn: () => ladeFachebene('nina'),
    enabled: fachebenenSichtbar.nina, refetchInterval: FACHEBENEN.nina.pollMs,
  });
  const dwdQuery = useQuery({
    queryKey: ['fachebene', 'dwd'], queryFn: () => ladeFachebene('dwd'),
    enabled: fachebenenSichtbar.dwd, refetchInterval: FACHEBENEN.dwd.pollMs,
  });
  const pegelQuery = useQuery({
    queryKey: ['fachebene', 'pegelonline'], queryFn: () => ladeFachebene('pegelonline'),
    enabled: fachebenenSichtbar.pegelonline, refetchInterval: FACHEBENEN.pegelonline.pollMs,
  });
  const kritisQuery = useQuery({
    queryKey: ['fachebene', 'kritis', kritisBbox], queryFn: () => ladeFachebene('kritis', kritisBbox!),
    enabled: fachebenenSichtbar.kritis && !!kritisBbox,
  });
```

- [ ] **Step 3: Aktive Fachebenen + Status + Attribution ableiten**

```ts
  const fachebenenQueries: Record<FachebeneQuelle, typeof ninaQuery> = {
    nina: ninaQuery, dwd: dwdQuery, pegelonline: pegelQuery, kritis: kritisQuery,
  };

  const aktiveFachebenen = useMemo<AktiveFachebene[]>(
    () => fachebeneKeys()
      .filter((k) => fachebenenSichtbar[k])
      .map((k) => {
        const data = fachebenenQueries[k].data;
        return { def: FACHEBENEN[k], daten: data?.features ?? { type: 'FeatureCollection', features: [] } };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fachebenenSichtbar, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisQuery.data],
  );

  const fachebenenStatus = useMemo<Partial<Record<FachebeneQuelle, FachebeneStatus>>>(() => {
    const s: Partial<Record<FachebeneQuelle, FachebeneStatus>> = {};
    for (const k of fachebeneKeys()) {
      const q = fachebenenQueries[k];
      if (!fachebenenSichtbar[k]) continue;
      s[k] = q.isError ? 'offline' : q.data?.status;
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachebenenSichtbar, ninaQuery.status, dwdQuery.status, pegelQuery.status, kritisQuery.status, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisQuery.data]);

  // Pflicht-Attributionen aktiver, nicht-offline Fachebenen an die Karten-Attribution hängen.
  const fachebenenAttribution = useMemo(() => {
    return fachebeneKeys()
      .filter((k) => fachebenenSichtbar[k] && fachebenenQueries[k].data && fachebenenQueries[k].data!.status !== 'offline')
      .map((k) => fachebenenQueries[k].data!.attribution)
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachebenenSichtbar, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisQuery.data]);
```

`attribution`-Memo erweitern (Basemap + Fachebenen kombinieren):

```ts
  const attribution = useMemo(() => {
    const teile = [aktuelleAttribution(basemap ?? 'blind', onlineStil), ...fachebenenAttribution].filter(Boolean) as string[];
    return teile.length ? teile.join(' · ') : null;
  }, [basemap, onlineStil, fachebenenAttribution]);
```

- [ ] **Step 4: An `Kartenflaeche` + `Sidebar` durchreichen**

`<Kartenflaeche … fachebenen={aktiveFachebenen} onBboxAenderung={fachebenenSichtbar.kritis ? setKritisBbox : undefined} />`

`<Sidebar … fachebenenSichtbar={fachebenenSichtbar} fachebenenStatus={fachebenenStatus} onFachebeneToggle={(k, an) => setFachebenenSichtbar((s) => ({ ...s, [k]: an }))} />`

- [ ] **Step 5: Typecheck + komplette Karten-Tests**

Run: `cd frontend && pnpm tsc --noEmit && pnpm vitest run src/pages/lagekarte src/pages/LagekartePage.test.tsx --no-file-parallelism`
Expected: keine Typfehler; Tests grün. Falls `LagekartePage.test.tsx` die neuen Sidebar-Props erwartet/mockt — Mocks/Defaults ergänzen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LagekartePage.tsx
git commit -m "feat(fe): Fachebenen in Lagekarte verdrahtet (Queries, Persistenz, Attribution, Offline) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE 9 — Dokumentation + Abschluss

### Task 18: Quellen-Dokumentation (Lizenz/Attribution/Aktualisierung)

**Files:**
- Create: `docs/fachebenen-quellen.md`

- [ ] **Step 1: Doku schreiben** — `docs/fachebenen-quellen.md` mit Tabelle je Quelle: Endpoint, Format, Lizenz, **Pflicht-Attribution**, Aktualisierungsintervall, Offline-Verhalten. Inhalte aus dem Architektur-Vertrag + Recherche übernehmen (NINA: BBK/MoWaS, nicht-gewerbliche Nutzung; DWD: GeoNutzV „Datenbasis: Deutscher Wetterdienst"; PEGELONLINE: DL-DE→Zero 2.0; KRITIS: ODbL „© OpenStreetMap-Beitragende").

- [ ] **Step 2: Commit**

```bash
git add docs/fachebenen-quellen.md
git commit -m "docs: Fachebenen-Quellen (Lizenz, Attribution, Aktualisierung) (LFH-69)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 19: Gesamt-Verifikation

- [ ] **Step 1: Backend**

Run: `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: alles grün.

- [ ] **Step 2: Frontend**

Run: `cd frontend && pnpm tsc --noEmit && pnpm lint && pnpm vitest run --no-file-parallelism`
Expected: keine Typ-/Lint-Fehler; Testsuite grün.

- [ ] **Step 3: Frontend-Build + Embed-Check** (Memory: Frontend ist ins Binary eingebettet)

Run: `cd frontend && pnpm build` und danach Backend neu bauen/starten.
Expected: Build erfolgreich.

- [ ] **Step 4: Manueller E2E-Smoke (online)**

Backend mit konfigurierter Online-Basemap starten, Lagekarte öffnen:
- NINA + DWD aktivieren → Warngebiete erscheinen als Polygone.
- Basemap wechseln (z. B. Online↔Blind) → **Fachebenen bleiben sichtbar** (Re-Anlage-Test).
- PEGELONLINE → Punkte erscheinen.
- KRITIS aktivieren + Karte bewegen → Objekte des Viewports erscheinen.
- Reload → zuvor aktive Ebenen sind weiterhin aktiv (Persistenz).
- Netz trennen → aktive Ebenen zeigen „offline", keine Fehlermeldung.
- Attribution unten zeigt aktive Quell-Nennungen.

---

## Akzeptanzkriterien-Abgleich (Self-Review)

| Akzeptanzkriterium (LFH-69) | Abgedeckt durch |
|---|---|
| Fachebenen einzeln ein-/ausblendbar | Task 16 (Panel), Task 17 (Toggle-State) |
| Auswahl pro Einsatz gespeichert | Task 12 (Persistenz), Task 17 (Init/Merken) |
| Mind. NINA + DWD angebunden, zeigen Warngebiete | Task 5 (DWD), Task 7 (NINA), Task 13–15 (Rendering) |
| Lizenz/Nutzungsbedingungen + Aktualisierung dokumentiert | Task 18 (Doku), Attribution-Konstanten je Adapter |
| Offline-Verhalten definiert (leer/ausgegraut statt Fehler) | Task 2 (Envelope `offline`), Adapter Stale/Offline, Task 16 (Anzeige) |
| Zusätzlich gewählt: PEGELONLINE + KRITIS/OSM | Task 6 (Pegel), Task 8–9 (KRITIS) |

**Out of scope (bewusst, v1):** Verkehr/Autobahn, Seveso (kein offener Datensatz), Stromausfälle (keine offene API), Luftbild (gehört als `online_styles`-Eintrag in die Server-Config, kein Overlay).
