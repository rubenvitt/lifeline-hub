# Karten-Region-Build-Service (Komponente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigenständiger, zentral gehosteter Rust-Service, der einen fixen kuratierten Satz
Offline-Karten-Regionen per Zeitplan (+ on-demand) via `karten-build`/Docker baut, ins
Object-Storage publisht und ein `offline-katalog-manifest.json` (den LFH-199-Client-Vertrag)
regeneriert.

**Architecture:** Neues Crate `karten-service/` in einem neu eingeführten Cargo-Workspace. Ein
`serve`-Prozess trägt eine axum-API (Trigger/Status, Bearer-Auth) + einen in-Prozess-Cron-Scheduler;
alle Builds (geplant wie on-demand) laufen durch **eine** serialisierte Job-Queue (ein Build zur
Zeit — geteilter `karten-build/out/sources`-Cache, LFH-200). Build-Runner und Storage sitzen hinter
Traits (im Test gefaked); die konkreten Docker-/S3-Implementierungen sind die einzigen Tasks, die
den echten Host brauchen. Der Manifest-Vertrag `OfflineKatalogEintrag` wird in ein geteiltes Crate
extrahiert (eine Quelle der Wahrheit, kein Schema-Duplikat).

**Tech Stack:** Rust (edition 2021), axum 0.8, tokio 1, serde/serde_json 1, clap 4 (derive+env),
chrono 0.4 (Datums-Version), sha2 0.11, anyhow 1, tracing 0.1; `object_store` (S3/R2, hinter
`Storage`-Trait), `tokio-cron-scheduler` (Scheduler). Build via `tokio::process` → `make -C
karten-build tiles AREA=<x>`.

## Global Constraints

- **Rust edition 2021**, axum **0.8**, tokio **1** (features `full`), sqlx nicht nötig (kein DB im
  Service — Job-Status ist in-memory), serde **1** mit `derive`, chrono **0.4** (`default-features
  = false`, feature `clock`), sha2 **0.11**, clap **4** (`derive`, `env`) — Versionen an den
  Wurzel-Crate angleichen.
- **Ein Build zur Zeit** (globaler Lock); `geofabrik_area` ist immer ein **einzelner** gültiger
  Geofabrik-Extrakt (kein „dach"/Kombi in v1).
- **Manifest immer vollständig** (alle Regionen, aktuelle Version) und **atomar** publishen (erst
  Datei, dann Manifest); nie ein Teil-/Zwischen-Manifest.
- **Kachel-Schema fix `"shortbread"`, Format `pbf`, Lizenz ODbL** (Attribution Pflicht, offline
  sichtbar) — je Manifest-Eintrag gesetzt.
- **Halb-Pin-Regel:** ein Eintrag ist vollständig gepinnt (64-hex-sha256 lowercase + `https://`-URL
  ohne `TODO` + groesse>0 + lizenz gesetzt) oder ungültig — der bestehende
  `remote_eintrag_ist_gueltig`-Check bleibt Vertrag.
- **Versionierung über die URL:** Dateiname `<slug>.<YYYYMMDD>.shortbread.mbtiles`; der
  Client-Update-Check vergleicht `name` (stabil) + `url` (versioniert).
- **Bearer-Token** für alle `/builds`-Endpunkte; Manifest+Files liegen public-read im Object-Storage
  (keine Service-Endpunkte dafür).
- Rust-Gate ist **`cargo test`** (das Repo ist bewusst nicht rustfmt-/clippy-clean; im Bestandsstil
  editieren) — pro Task gegen den neuen Crate laufen: `cargo test -p karten-service` bzw.
  `-p karten-katalog`.

---

## File Structure

**Neuer Workspace + geteiltes Typ-Crate:**
- Modify: `Cargo.toml` (Wurzel) → `[workspace] members = [".", "crates/karten-katalog", "karten-service"]`.
- Create: `crates/karten-katalog/Cargo.toml`, `crates/karten-katalog/src/lib.rs` — hält
  `OfflineKatalogEintrag` + `remote_eintrag_ist_gueltig` + `merge_offline_katalog` (aus
  `src/config.rs` extrahiert).
- Modify: `src/config.rs` — re-exportiert die Typen aus `karten-katalog` (Bestands-Imports/Tests
  unverändert lauffähig).

**Service-Crate `karten-service/`:**
- `Cargo.toml`, `src/main.rs` (clap: `serve` | `build --slug <x>` | `build --all`)
- `src/config.rs` — `ServiceConfig` (bind, token, storage, karten_build_dir, schedule, base_url)
- `src/regions.rs` — autoritativer fixer Satz `Region { slug, geofabrik_area, name, region, gruppe, lizenz }`
- `src/manifest.rs` — Manifest aus `Vec<PublishedVersion>` bauen (reine Logik)
- `src/jobs.rs` — In-Memory-Job-Registry: `BuildJob`, Status-FSM, serialisierte Queue (ein Build)
- `src/storage/mod.rs` — `Storage`-Trait + `FakeStorage`; `src/storage/s3.rs` — `object_store`-Impl
- `src/build/mod.rs` — `BuildRunner`-Trait + `FakeRunner` + Orchestrierung `build_region`
- `src/build/make_runner.rs` — `tokio::process`-Impl (`make -C karten-build`)
- `src/build/validate.rs` — mbtiles-`metadata`-`bounds` gegen erwartete Region
- `src/api.rs` — axum-Router + Bearer-Auth
- `src/scheduler.rs` — `tokio-cron-scheduler` → enqueue build-all
- Tests: crate-intern (`#[cfg(test)]`) + `karten-service/tests/` für den Bremen-Integrations-Smoke.

---

## Task 1: Workspace + geteiltes `karten-katalog`-Crate

**Files:**
- Modify: `Cargo.toml` (Wurzel — Workspace-Tabelle ergänzen)
- Create: `crates/karten-katalog/Cargo.toml`, `crates/karten-katalog/src/lib.rs`
- Modify: `src/config.rs` (Typen aus dem neuen Crate re-exportieren), `src/karte/katalog.rs` (Import)

**Interfaces:**
- Produces: `karten_katalog::OfflineKatalogEintrag { name, url, region, groesse: i64, lizenz, kachel_schema, quelle, sha256: Option<String>, gruppe: Option<String> }` (Clone+Debug+Serialize+Deserialize); `karten_katalog::remote_eintrag_ist_gueltig(&OfflineKatalogEintrag) -> bool`; `karten_katalog::merge_offline_katalog(compiled, remote) -> Vec<OfflineKatalogEintrag>`.

- [ ] **Step 1: Wurzel-`Cargo.toml` zum Workspace machen**

An das Ende von `Cargo.toml` (nach `[features]`) ergänzen:

```toml
[workspace]
members = [".", "crates/karten-katalog", "karten-service"]
```

- [ ] **Step 2: geteiltes Crate anlegen**

`crates/karten-katalog/Cargo.toml`:

```toml
[package]
name = "karten-katalog"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
```

`crates/karten-katalog/src/lib.rs` — die Struct + Helfer **wörtlich** aus `src/config.rs`
übernehmen (heutige Definition von `OfflineKatalogEintrag`, `remote_eintrag_ist_gueltig`,
`merge_offline_katalog`), plus dieser Test:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halb_gepinnter_remote_eintrag_ist_ungueltig() {
        let e = OfflineKatalogEintrag {
            name: "X".into(), url: "https://TODO/x.mbtiles".into(), region: "X".into(),
            groesse: 1, lizenz: "ODbL".into(), kachel_schema: "shortbread".into(),
            quelle: "t".into(), sha256: None, gruppe: None,
        };
        assert!(!remote_eintrag_ist_gueltig(&e));
    }
}
```

- [ ] **Step 3: `src/config.rs` auf Re-Export umstellen**

Die drei Definitionen in `src/config.rs` durch `pub use karten_katalog::{OfflineKatalogEintrag,
remote_eintrag_ist_gueltig, merge_offline_katalog};` ersetzen; `default_offline_katalog()` bleibt
in `config.rs`. In der Wurzel-`[dependencies]`: `karten-katalog = { path = "crates/karten-katalog" }`.

- [ ] **Step 4: Bestandstests laufen lassen (nichts darf brechen)**

Run: `cargo test -p lifeline-hub katalog` und `cargo test -p karten-katalog`
Expected: bestehende `katalog`/`config`-Tests PASS; neuer Crate-Test PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/karten-katalog src/config.rs src/karte/katalog.rs
git commit -m "refactor(lfh-201): OfflineKatalogEintrag in geteiltes karten-katalog-Crate (Workspace)"
```

---

## Task 2: Service-Crate-Skelett + Config + `/healthz`

**Files:**
- Create: `karten-service/Cargo.toml`, `karten-service/src/main.rs`, `karten-service/src/config.rs`, `karten-service/src/api.rs`

**Interfaces:**
- Produces: `ServiceConfig { bind: String, token: String, base_url: String, karten_build_dir: PathBuf, schedule: String, storage_bucket: String }` (clap `Parser`, env `KS_*`); `api::router(state) -> axum::Router` mit `GET /healthz` → `200 "ok"`.

- [ ] **Step 1: Failing test — healthz**

`karten-service/src/api.rs` (Test unten anfügen):

```rust
#[cfg(test)]
mod tests {
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;
    #[tokio::test]
    async fn healthz_ok() {
        let app = super::router(super::test_state());
        let res = app.oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
}
```

- [ ] **Step 2: Run → fail (kein Crate/kein router)**

Run: `cargo test -p karten-service healthz_ok`
Expected: FAIL (compile: `router`/Crate fehlt).

- [ ] **Step 3: Crate + Config + minimaler Router**

`karten-service/Cargo.toml`:

```toml
[package]
name = "karten-service"
version = "0.1.0"
edition = "2021"

[dependencies]
karten-katalog = { path = "../crates/karten-katalog" }
axum = "0.8"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive", "env"] }
chrono = { version = "0.4", default-features = false, features = ["clock"] }
sha2 = "0.11"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
object_store = { version = "0.11", features = ["aws"] }
tokio-cron-scheduler = "0.13"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
```

`karten-service/src/config.rs`:

```rust
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(version, about = "karten-service — Region-Pack-Build-Service")]
pub struct ServiceConfig {
    #[arg(long, env = "KS_BIND", default_value = "0.0.0.0:8088")]
    pub bind: String,
    /// Bearer-Token für /builds (Pflicht in serve).
    #[arg(long, env = "KS_TOKEN", default_value = "")]
    pub token: String,
    /// Öffentliche Basis-URL des Object-Storage (endet ohne Slash), z. B. https://cdn.example/maps
    #[arg(long, env = "KS_BASE_URL", default_value = "")]
    pub base_url: String,
    #[arg(long, env = "KS_KARTEN_BUILD_DIR", default_value = "karten-build")]
    pub karten_build_dir: PathBuf,
    /// Cron-Expression (6 Felder, tokio-cron-scheduler). Default: quartalsweise 03:00 am 1.
    #[arg(long, env = "KS_SCHEDULE", default_value = "0 0 3 1 1,4,7,10 *")]
    pub schedule: String,
    #[arg(long, env = "KS_STORAGE_BUCKET", default_value = "")]
    pub storage_bucket: String,
}
```

`karten-service/src/api.rs` (Grundgerüst + Test-State-Helfer):

```rust
use axum::{routing::get, Router};

#[derive(Clone)]
pub struct AppState {
    pub token: String,
}

pub fn router(state: AppState) -> Router {
    Router::new().route("/healthz", get(|| async { "ok" })).with_state(state)
}

#[cfg(test)]
pub fn test_state() -> AppState { AppState { token: "t".into() } }
```

`karten-service/src/main.rs`:

```rust
mod api;
mod config;
use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info".into())).init();
    let cfg = config::ServiceConfig::parse();
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    axum::serve(listener, api::router(api::AppState { token: cfg.token })).await?;
    Ok(())
}
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service healthz_ok`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service Cargo.toml
git commit -m "feat(lfh-201): karten-service-Skelett (Config, /healthz)"
```

---

## Task 3: Autoritativer Region-Satz (`regions.rs`)

**Files:**
- Create: `karten-service/src/regions.rs`; Modify: `karten-service/src/main.rs` (`mod regions;`)

**Interfaces:**
- Produces: `regions::Region { slug: &'static str, geofabrik_area: &'static str, name: &'static str, region: &'static str, gruppe: &'static str, lizenz: &'static str }`; `regions::alle() -> &'static [Region]`; `regions::finde(slug: &str) -> Option<&'static Region>`.

- [ ] **Step 1: Failing test — Satz + Lookup + Constraint**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kein_dach_kombi_und_lookup_klappt() {
        assert!(finde("germany").is_some());
        assert!(finde("dach").is_none(), "DACH ist kein einzelner Geofabrik-Extrakt (v1)");
        assert!(finde("bremen-unbekannt").is_none());
        // geofabrik_area nie leer, slug eindeutig
        let mut slugs: Vec<_> = alle().iter().map(|r| r.slug).collect();
        let n = slugs.len(); slugs.sort(); slugs.dedup();
        assert_eq!(slugs.len(), n, "Slugs eindeutig");
        assert!(alle().iter().all(|r| !r.geofabrik_area.is_empty()));
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service kein_dach`
Expected: FAIL (compile).

- [ ] **Step 3: Region-Satz implementieren**

```rust
pub struct Region {
    pub slug: &'static str,
    pub geofabrik_area: &'static str,
    pub name: &'static str,
    pub region: &'static str,
    pub gruppe: &'static str,
    pub lizenz: &'static str,
}
const ODBL: &str = "© OpenStreetMap contributors (ODbL)";
static REGIONS: &[Region] = &[
    Region { slug: "germany", geofabrik_area: "germany", name: "Deutschland (Shortbread)", region: "DE", gruppe: "Deutschland", lizenz: ODBL },
    Region { slug: "bayern", geofabrik_area: "bayern", name: "Bayern", region: "DE-BY", gruppe: "Bundesländer", lizenz: ODBL },
    Region { slug: "baden-wuerttemberg", geofabrik_area: "baden-wuerttemberg", name: "Baden-Württemberg", region: "DE-BW", gruppe: "Bundesländer", lizenz: ODBL },
    Region { slug: "nordrhein-westfalen", geofabrik_area: "nordrhein-westfalen", name: "Nordrhein-Westfalen", region: "DE-NW", gruppe: "Bundesländer", lizenz: ODBL },
    Region { slug: "niedersachsen", geofabrik_area: "niedersachsen", name: "Niedersachsen", region: "DE-NI", gruppe: "Bundesländer", lizenz: ODBL },
    Region { slug: "austria", geofabrik_area: "austria", name: "Österreich", region: "AT", gruppe: "Nachbarländer", lizenz: ODBL },
    Region { slug: "switzerland", geofabrik_area: "switzerland", name: "Schweiz", region: "CH", gruppe: "Nachbarländer", lizenz: ODBL },
];
pub fn alle() -> &'static [Region] { REGIONS }
pub fn finde(slug: &str) -> Option<&'static Region> { REGIONS.iter().find(|r| r.slug == slug) }
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service kein_dach`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/regions.rs karten-service/src/main.rs
git commit -m "feat(lfh-201): fixer Region-Satz (einzelne Geofabrik-Extrakte, kein DACH-Kombi)"
```

---

## Task 4: Manifest-Generator (`manifest.rs`) — reine Logik

**Files:**
- Create: `karten-service/src/manifest.rs`; Modify: `karten-service/src/main.rs` (`mod manifest;`)

**Interfaces:**
- Consumes: `regions::Region`, `karten_katalog::OfflineKatalogEintrag`.
- Produces: `manifest::PublishedVersion { slug: String, url: String, groesse: i64, sha256: String }`; `manifest::baue_manifest(versionen: &[PublishedVersion]) -> Vec<OfflineKatalogEintrag>`; `manifest::datei_key(slug: &str, datum: chrono::NaiveDate) -> String` → `"<slug>.<YYYYMMDD>.shortbread.mbtiles"`.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use karten_katalog::remote_eintrag_ist_gueltig;
    #[test]
    fn key_ist_datiert() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        assert_eq!(datei_key("bayern", d), "bayern.20260705.shortbread.mbtiles");
    }
    #[test]
    fn manifest_eintraege_sind_vollstaendig_gepinnt() {
        let v = vec![PublishedVersion {
            slug: "germany".into(),
            url: "https://cdn.example/maps/germany.20260705.shortbread.mbtiles".into(),
            groesse: 3_000_000_000, sha256: "a".repeat(64),
        }];
        let m = baue_manifest(&v);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].kachel_schema, "shortbread");
        assert_eq!(m[0].name, "Deutschland (Shortbread)");
        assert!(remote_eintrag_ist_gueltig(&m[0]), "muss vollständig gepinnt sein");
    }
    #[test]
    fn unbekannter_slug_wird_uebersprungen() {
        let v = vec![PublishedVersion { slug: "atlantis".into(), url: "https://x/a.mbtiles".into(), groesse: 1, sha256: "b".repeat(64) }];
        assert!(baue_manifest(&v).is_empty());
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service manifest`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren**

```rust
use crate::regions;
use chrono::NaiveDate;
use karten_katalog::OfflineKatalogEintrag;

pub struct PublishedVersion { pub slug: String, pub url: String, pub groesse: i64, pub sha256: String }

pub fn datei_key(slug: &str, datum: NaiveDate) -> String {
    format!("{slug}.{}.shortbread.mbtiles", datum.format("%Y%m%d"))
}

pub fn baue_manifest(versionen: &[PublishedVersion]) -> Vec<OfflineKatalogEintrag> {
    versionen.iter().filter_map(|v| {
        let r = regions::finde(&v.slug)?; // unbekannte Slugs überspringen
        Some(OfflineKatalogEintrag {
            name: r.name.into(), url: v.url.clone(), region: r.region.into(),
            groesse: v.groesse, lizenz: r.lizenz.into(), kachel_schema: "shortbread".into(),
            quelle: "Eigen-Service (karten-build, Planetiler-Shortbread)".into(),
            sha256: Some(v.sha256.clone()), gruppe: Some(r.gruppe.into()),
        })
    }).collect()
}
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service manifest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/manifest.rs karten-service/src/main.rs
git commit -m "feat(lfh-201): Manifest-Generator (datierte URL, vollständig gepinnt)"
```

---

## Task 5: Job-Registry + serialisierte Queue (`jobs.rs`)

**Files:**
- Create: `karten-service/src/jobs.rs`; Modify: `karten-service/src/main.rs` (`mod jobs;`)

**Interfaces:**
- Produces: `jobs::JobStatus` (enum `Queued|Building|Uploading|Publishing|Done|Failed(String)`, Serialize); `jobs::BuildJob { id: u64, slug: String, status: JobStatus, gestartet: String, beendet: Option<String> }`; `jobs::Registry` (Clone, `Arc`-intern) mit `enqueue(slug) -> Result<u64, EnqueueError>`, `get(id) -> Option<BuildJob>`, `alle() -> Vec<BuildJob>`, `set_status(id, JobStatus)`, `try_lock_build() -> Option<BuildGuard>` (globaler Ein-Build-Guard). `EnqueueError::Voll` bei überfüllter Queue.

- [ ] **Step 1: Failing test — genau ein Build-Guard**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nur_ein_build_guard_gleichzeitig() {
        let r = Registry::neu(1);
        let g1 = r.try_lock_build();
        assert!(g1.is_some());
        assert!(r.try_lock_build().is_none(), "zweiter Build blockiert");
        drop(g1);
        assert!(r.try_lock_build().is_some(), "nach Freigabe wieder frei");
    }
    #[test]
    fn enqueue_und_status_uebergang() {
        let r = Registry::neu(4);
        let id = r.enqueue("bayern").unwrap();
        assert!(matches!(r.get(id).unwrap().status, JobStatus::Queued));
        r.set_status(id, JobStatus::Done);
        assert!(matches!(r.get(id).unwrap().status, JobStatus::Done));
    }
    #[test]
    fn queue_cap_greift() {
        let r = Registry::neu(1);
        r.enqueue("bayern").unwrap();
        assert!(matches!(r.enqueue("germany"), Err(EnqueueError::Voll)));
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service jobs`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren** (In-Memory, `Arc<Mutex<..>>` + `AtomicBool`-Build-Lock)

```rust
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "fehler", rename_all = "lowercase")]
pub enum JobStatus { Queued, Building, Uploading, Publishing, Done, Failed(String) }

#[derive(Clone, Serialize)]
pub struct BuildJob { pub id: u64, pub slug: String, pub status: JobStatus, pub gestartet: String, pub beendet: Option<String> }

#[derive(Debug)]
pub enum EnqueueError { Voll }

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<Vec<BuildJob>>>,
    seq: Arc<AtomicU64>,
    building: Arc<AtomicBool>,
    offene_cap: usize,
}

pub struct BuildGuard(Arc<AtomicBool>);
impl Drop for BuildGuard { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }

impl Registry {
    pub fn neu(offene_cap: usize) -> Self {
        Self { inner: Arc::new(Mutex::new(Vec::new())), seq: Arc::new(AtomicU64::new(1)),
               building: Arc::new(AtomicBool::new(false)), offene_cap }
    }
    pub fn enqueue(&self, slug: &str) -> Result<u64, EnqueueError> {
        let mut v = self.inner.lock().unwrap();
        let offen = v.iter().filter(|j| matches!(j.status, JobStatus::Queued)).count();
        if offen >= self.offene_cap { return Err(EnqueueError::Voll); }
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        v.push(BuildJob { id, slug: slug.into(), status: JobStatus::Queued,
                          gestartet: now_iso(), beendet: None });
        Ok(id)
    }
    pub fn get(&self, id: u64) -> Option<BuildJob> { self.inner.lock().unwrap().iter().find(|j| j.id == id).cloned() }
    pub fn alle(&self) -> Vec<BuildJob> { self.inner.lock().unwrap().clone() }
    pub fn set_status(&self, id: u64, s: JobStatus) {
        let mut v = self.inner.lock().unwrap();
        if let Some(j) = v.iter_mut().find(|j| j.id == id) {
            if matches!(s, JobStatus::Done | JobStatus::Failed(_)) { j.beendet = Some(now_iso()); }
            j.status = s;
        }
    }
    pub fn try_lock_build(&self) -> Option<BuildGuard> {
        if self.building.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            Some(BuildGuard(self.building.clone()))
        } else { None }
    }
}

fn now_iso() -> String { chrono::Utc::now().to_rfc3339() }
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/jobs.rs karten-service/src/main.rs
git commit -m "feat(lfh-201): In-Memory-Job-Registry + serialisierter Ein-Build-Guard"
```

---

## Task 6: Bounds-Validierung (`build/validate.rs`)

**Files:**
- Create: `karten-service/src/build/mod.rs` (nur `pub mod validate;` vorerst), `karten-service/src/build/validate.rs`; Modify: `main.rs` (`mod build;`)

**Interfaces:**
- Produces: `build::validate::bounds_passen(mbtiles_bounds: Option<(f64,f64,f64,f64)>, erwartet: (f64,f64,f64,f64)) -> bool` (Überlappungs-/Enthaltensein-Check: das gebaute `bounds` muss innerhalb einer groben Erwartungs-Box liegen); `build::validate::erwartete_box(region_code: &str) -> Option<(f64,f64,f64,f64)>` (grobe Bounding-Box je region-Code, nur DE/AT/CH grob).

- [ ] **Step 1: Failing test — Falschregion erkennen**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bremen_bounds_liegen_in_de_box() {
        // Bremen ~ (8.48,53.01,8.99,53.23) liegt in der groben DE-Box.
        let de = erwartete_box("DE").unwrap();
        assert!(bounds_passen(Some((8.48,53.01,8.99,53.23)), de));
    }
    #[test]
    fn ganz_de_liegt_nicht_in_bayern_box_beispiel() {
        // Wenn erwartet=Bayern, ein DE-weites bounds (5.8..15.0) fällt raus → Falschregion.
        let by = (8.9,47.2,13.9,50.6);
        assert!(!bounds_passen(Some((5.8,47.2,15.1,55.1)), by));
    }
    #[test]
    fn fehlende_bounds_sind_ungueltig() {
        assert!(!bounds_passen(None, erwartete_box("DE").unwrap()));
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service validate`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren** (Enthaltensein mit kleiner Toleranz)

```rust
pub fn erwartete_box(region_code: &str) -> Option<(f64,f64,f64,f64)> {
    // (west,süd,ost,nord), grob großzügig.
    Some(match region_code {
        "DE" => (5.8, 47.2, 15.1, 55.1),
        "AT" => (9.5, 46.3, 17.2, 49.1),
        "CH" => (5.9, 45.8, 10.5, 47.9),
        c if c.starts_with("DE-") => (5.8, 47.2, 15.1, 55.1), // Bundesländer: in DE-Box
        _ => return None,
    })
}
/// Das gebaute bounds muss (mit kleiner Toleranz) INNERHALB der Erwartungs-Box liegen.
pub fn bounds_passen(gebaut: Option<(f64,f64,f64,f64)>, erwartet: (f64,f64,f64,f64)) -> bool {
    let Some((w,s,o,n)) = gebaut else { return false };
    let (ew,es,eo,en) = erwartet;
    let t = 0.5; // Grad Toleranz
    w >= ew - t && s >= es - t && o <= eo + t && n <= en + t && w < o && s < n
}
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build karten-service/src/main.rs
git commit -m "feat(lfh-201): Post-Build-Bounds-Validierung (Falschregion-Schutz)"
```

---

## Task 7: `Storage`-Trait + `FakeStorage` (+ S3-Impl-Stub)

**Files:**
- Create: `karten-service/src/storage/mod.rs`, `karten-service/src/storage/s3.rs`; Modify: `main.rs` (`mod storage;`)

**Interfaces:**
- Produces: `#[async_trait] Storage { async fn put(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()>; fn public_url(&self, key: &str) -> String; }`; `storage::FakeStorage` (in-memory Map + `base`); `storage::s3::S3Storage` (object_store-Impl). Ergänze `async-trait = "0.1"` in `Cargo.toml`.

- [ ] **Step 1: Failing test — Fake put/url**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn fake_speichert_und_liefert_url() {
        let s = FakeStorage::neu("https://cdn.example/maps");
        s.put("germany.20260705.shortbread.mbtiles", vec![1,2,3]).await.unwrap();
        assert_eq!(s.public_url("germany.20260705.shortbread.mbtiles"),
                   "https://cdn.example/maps/germany.20260705.shortbread.mbtiles");
        assert_eq!(s.inhalt("germany.20260705.shortbread.mbtiles").unwrap().len(), 3);
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service storage`
Expected: FAIL (compile). Vorher `async-trait = "0.1"` zu `[dependencies]` ergänzen.

- [ ] **Step 3: Trait + Fake implementieren; S3-Impl als konkreter (nicht-getesteter) Adapter**

`storage/mod.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;
pub mod s3;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn put(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()>;
    fn public_url(&self, key: &str) -> String;
}

#[derive(Clone)]
pub struct FakeStorage { base: String, map: Arc<Mutex<HashMap<String, Vec<u8>>>> }
impl FakeStorage {
    pub fn neu(base: &str) -> Self { Self { base: base.trim_end_matches('/').into(), map: Default::default() } }
    pub fn inhalt(&self, key: &str) -> Option<Vec<u8>> { self.map.lock().unwrap().get(key).cloned() }
}
#[async_trait]
impl Storage for FakeStorage {
    async fn put(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.map.lock().unwrap().insert(key.into(), bytes); Ok(())
    }
    fn public_url(&self, key: &str) -> String { format!("{}/{}", self.base, key) }
}
```

`storage/s3.rs` (konkreter Adapter — auf echtem Host getestet, s. Task 11):

```rust
use super::Storage;
use async_trait::async_trait;
use object_store::{aws::AmazonS3Builder, ObjectStore, path::Path};

pub struct S3Storage { store: object_store::aws::AmazonS3, base: String }
impl S3Storage {
    pub fn neu(bucket: &str, base_url: &str) -> anyhow::Result<Self> {
        // Credentials/Endpoint kommen aus Standard-ENV (AWS_*, AWS_ENDPOINT für R2).
        let store = AmazonS3Builder::from_env().with_bucket_name(bucket).build()?;
        Ok(Self { store, base: base_url.trim_end_matches('/').into() })
    }
}
#[async_trait]
impl Storage for S3Storage {
    async fn put(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.store.put(&Path::from(key), bytes.into()).await?; Ok(())
    }
    fn public_url(&self, key: &str) -> String { format!("{}/{}", self.base, key) }
}
```

- [ ] **Step 4: Run → pass** (Fake-Test; S3-Impl nur kompiliert)

Run: `cargo test -p karten-service storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/storage karten-service/Cargo.toml
git commit -m "feat(lfh-201): Storage-Trait + FakeStorage + object_store-S3-Adapter"
```

---

## Task 8: `BuildRunner`-Trait + `FakeRunner` + Orchestrierung `build_region`

**Files:**
- Modify: `karten-service/src/build/mod.rs`; Create: `karten-service/src/build/make_runner.rs`

**Interfaces:**
- Consumes: `Storage`, `Registry`, `regions`, `manifest`, `validate`.
- Produces: `#[async_trait] BuildRunner { async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt>; }` mit `BuildArtefakt { bytes: Vec<u8>, sha256: String, bounds: Option<(f64,f64,f64,f64)> }`; `build::FakeRunner`; `build::build_region(reg: &Region, heute: NaiveDate, runner: &dyn BuildRunner, storage: &dyn Storage, bestand: &[PublishedVersion]) -> anyhow::Result<Vec<PublishedVersion>>` (baut → validiert bounds → lädt hoch → gibt aktualisierte Versionsliste zurück; Manifest-Upload macht der Aufrufer in Task 9).

- [ ] **Step 1: Failing test — glücklicher Pfad + Falschregion**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::FakeStorage;
    use crate::manifest::PublishedVersion;
    use crate::regions;

    struct OkRunner;
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { bytes: vec![9;10], sha256: "a".repeat(64), bounds: Some((8.9,47.2,13.9,50.6)) })
        }
    }
    struct FalschRunner;
    #[async_trait::async_trait]
    impl BuildRunner for FalschRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { bytes: vec![9;10], sha256: "a".repeat(64), bounds: Some((5.8,47.2,15.1,55.1)) }) // DE-weit statt Bayern
        }
    }
    #[tokio::test]
    async fn build_region_laedt_hoch_und_pinnt() {
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        let neu = build_region(by, d, &OkRunner, &s, &[]).await.unwrap();
        let v = neu.iter().find(|v| v.slug == "bayern").unwrap();
        assert_eq!(v.url, "https://cdn.example/maps/bayern.20260705.shortbread.mbtiles");
        assert_eq!(v.sha256.len(), 64);
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_some(), "hochgeladen");
    }
    #[tokio::test]
    async fn falschregion_bricht_ab_ohne_upload() {
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        assert!(build_region(by, d, &FalschRunner, &s, &[]).await.is_err());
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_none(), "kein Upload bei Falschregion");
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service build_region`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren** (`build/mod.rs`)

```rust
pub mod validate;
pub mod make_runner;
use crate::manifest::{datei_key, PublishedVersion};
use crate::regions::Region;
use crate::storage::Storage;
use async_trait::async_trait;
use chrono::NaiveDate;

pub struct BuildArtefakt { pub bytes: Vec<u8>, pub sha256: String, pub bounds: Option<(f64,f64,f64,f64)> }

#[async_trait]
pub trait BuildRunner: Send + Sync {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt>;
}

pub async fn build_region(
    reg: &Region, heute: NaiveDate, runner: &dyn BuildRunner, storage: &dyn Storage,
    bestand: &[PublishedVersion],
) -> anyhow::Result<Vec<PublishedVersion>> {
    let art = runner.baue(reg.geofabrik_area).await?;
    let erwartet = validate::erwartete_box(reg.region)
        .ok_or_else(|| anyhow::anyhow!("keine Erwartungs-Box für {}", reg.region))?;
    if !validate::bounds_passen(art.bounds, erwartet) {
        anyhow::bail!("Falschregion: bounds {:?} passen nicht zu {}", art.bounds, reg.region);
    }
    let key = datei_key(reg.slug, heute);
    let groesse = art.bytes.len() as i64;
    storage.put(&key, art.bytes).await?;
    let mut out: Vec<PublishedVersion> = bestand.iter()
        .filter(|v| v.slug != reg.slug).cloned().collect();
    out.push(PublishedVersion { slug: reg.slug.into(), url: storage.public_url(&key), groesse, sha256: art.sha256 });
    Ok(out)
}
```

`PublishedVersion` muss `Clone` sein — in `manifest.rs` `#[derive(Clone)]` ergänzen.

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service build_region`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build karten-service/src/manifest.rs
git commit -m "feat(lfh-201): BuildRunner-Trait + build_region (validate→upload→pin)"
```

---

## Task 9: `make`-BuildRunner-Impl (`build/make_runner.rs`) — **braucht echten Docker-Host**

**Files:**
- Modify: `karten-service/src/build/make_runner.rs`

**Interfaces:**
- Produces: `make_runner::MakeRunner { karten_build_dir: PathBuf }` implementiert `BuildRunner`.

- [ ] **Step 1: Implementieren** (kein Unit-Test — Integrations-Smoke ist Task 11)

```rust
use super::{BuildArtefakt, BuildRunner};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::process::Command;

pub struct MakeRunner { pub karten_build_dir: PathBuf }

#[async_trait]
impl BuildRunner for MakeRunner {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt> {
        // Ein Build zur Zeit garantiert der Aufrufer (BuildGuard). make löscht stale Region-PBFs (LFH-200).
        let status = Command::new("make")
            .arg("-C").arg(&self.karten_build_dir)
            .arg("tiles").arg(format!("AREA={geofabrik_area}"))
            .status().await?;
        anyhow::ensure!(status.success(), "make tiles AREA={geofabrik_area} fehlgeschlagen ({status})");
        // Ergebnis: <dir>/out/result/osm*.mbtiles (+ .sha256). Genau eine Datei (sources je Build bereinigt).
        let result_dir = self.karten_build_dir.join("out/result");
        let datei = std::fs::read_dir(&result_dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.file_name().and_then(|n| n.to_str())
                .map(|n| n.starts_with("osm") && n.ends_with(".mbtiles")).unwrap_or(false))
            .ok_or_else(|| anyhow::anyhow!("keine osm*.mbtiles in {}", result_dir.display()))?;
        let bytes = std::fs::read(&datei)?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let bounds = lies_bounds(&datei)?;
        Ok(BuildArtefakt { bytes, sha256, bounds })
    }
}

/// Liest metadata.bounds ("w,s,o,n") aus der mbtiles-SQLite. Implementierung via `sqlite3`-CLI oder
/// rusqlite; hier: über die `sqlite3`-CLI (im karten-build-Kontext vorhanden), robust geparst.
fn lies_bounds(datei: &std::path::Path) -> anyhow::Result<Option<(f64,f64,f64,f64)>> {
    let out = std::process::Command::new("sqlite3").arg(datei)
        .arg("select value from metadata where name='bounds';").output()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let teile: Vec<f64> = s.trim().split(',').filter_map(|x| x.trim().parse().ok()).collect();
    Ok(match teile.as_slice() { [w,s,o,n] => Some((*w,*s,*o,*n)), _ => None })
}
```

- [ ] **Step 2: Kompiliert prüfen**

Run: `cargo build -p karten-service`
Expected: PASS (Build ok; Laufzeit-Test in Task 11 auf echtem Host).

- [ ] **Step 3: Commit**

```bash
git add karten-service/src/build/make_runner.rs
git commit -m "feat(lfh-201): MakeRunner (tokio::process make -C karten-build + sha256 + bounds)"
```

---

## Task 10: Scheduler + Orchestrierungs-Lauf (`scheduler.rs`) + Job-Fahrt

**Files:**
- Create: `karten-service/src/scheduler.rs`; Modify: `build/mod.rs` (Job-Fahrt `fahre_build`)

**Interfaces:**
- Produces: `build::fahre_build(reg: &Region, job_id: u64, reg_registry: &Registry, runner: Arc<dyn BuildRunner>, storage: Arc<dyn Storage>, bestand: Arc<Mutex<Vec<PublishedVersion>>>) ` — setzt Job-Status Building→Uploading→Publishing→Done/Failed, ruft `build_region`, aktualisiert `bestand`, publisht Manifest (`baue_manifest` → `storage.put("offline-katalog-manifest.json", …)`), gibt den Build-Guard über RAII frei. `scheduler::starte(cron, enqueue_all_fn)`.

- [ ] **Step 1: Failing test — Job-Fahrt setzt Done + publisht Manifest**

```rust
#[cfg(test)]
mod fahrt_tests {
    use super::*;
    use crate::{jobs::Registry, storage::FakeStorage, manifest::PublishedVersion, regions};
    use std::sync::{Arc, Mutex};
    struct OkRunner;
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { bytes: vec![7;5], sha256: "c".repeat(64), bounds: Some((8.9,47.2,13.9,50.6)) })
        }
    }
    #[tokio::test]
    async fn fahrt_endet_done_und_manifest_liegt() {
        let reg = Registry::neu(4);
        let s = Arc::new(FakeStorage::neu("https://cdn.example/maps"));
        let bestand = Arc::new(Mutex::new(Vec::<PublishedVersion>::new()));
        let id = reg.enqueue("bayern").unwrap();
        fahre_build(regions::finde("bayern").unwrap(), id, &reg,
                    Arc::new(OkRunner), s.clone(), bestand.clone()).await;
        assert!(matches!(reg.get(id).unwrap().status, crate::jobs::JobStatus::Done));
        let m = s.inhalt("offline-katalog-manifest.json").unwrap();
        let parsed: Vec<karten_katalog::OfflineKatalogEintrag> = serde_json::from_slice(&m).unwrap();
        assert!(parsed.iter().any(|e| e.name == "Bayern"));
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service fahrt`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren** (`build/mod.rs` ergänzen)

```rust
use crate::jobs::{JobStatus, Registry};
use crate::manifest::{baue_manifest, PublishedVersion};
use std::sync::{Arc, Mutex};

pub async fn fahre_build(
    reg: &Region, job_id: u64, registry: &Registry,
    runner: Arc<dyn BuildRunner>, storage: Arc<dyn Storage>,
    bestand: Arc<Mutex<Vec<PublishedVersion>>>,
) {
    registry.set_status(job_id, JobStatus::Building);
    let heute = chrono::Utc::now().date_naive();
    let snapshot = bestand.lock().unwrap().clone();
    match build_region(reg, heute, runner.as_ref(), storage.as_ref(), &snapshot).await {
        Ok(neu) => {
            registry.set_status(job_id, JobStatus::Publishing);
            let manifest = baue_manifest(&neu);
            match serde_json::to_vec(&manifest) {
                Ok(js) => match storage.put("offline-katalog-manifest.json", js).await {
                    Ok(()) => { *bestand.lock().unwrap() = neu; registry.set_status(job_id, JobStatus::Done); }
                    Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Upload: {e}"))),
                },
                Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Serialisierung: {e}"))),
            }
        }
        Err(e) => registry.set_status(job_id, JobStatus::Failed(e.to_string())),
    }
}
```

`scheduler.rs` (Cron → Callback, der build-all enqueued):

```rust
use tokio_cron_scheduler::{Job, JobScheduler};
pub async fn starte<F>(cron: &str, mut enqueue_all: F) -> anyhow::Result<JobScheduler>
where F: FnMut() + Send + 'static {
    let sched = JobScheduler::new().await?;
    let job = Job::new_async(cron, move |_id, _l| { enqueue_all(); Box::pin(async {}) })?;
    sched.add(job).await?;
    sched.start().await?;
    Ok(sched)
}
```

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service fahrt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build/mod.rs karten-service/src/scheduler.rs
git commit -m "feat(lfh-201): Job-Fahrt (Status-FSM + Manifest-Publish) + Cron-Scheduler"
```

---

## Task 11: API `/builds` + Bearer-Auth + `serve`-Verdrahtung

**Files:**
- Modify: `karten-service/src/api.rs`, `karten-service/src/main.rs`

**Interfaces:**
- Consumes: `Registry`, `regions`, `build::fahre_build`, `Storage` (Arc), `BuildRunner` (Arc).
- Produces: `POST /builds` (Bearer) `{slug}` → 202 `{job_id}` | 400 unbekannter slug | 401 | 409 busy/queue voll; `GET /builds` (Bearer) → `[BuildJob]`; `GET /builds/{id}` (Bearer) → `BuildJob`|404.

- [ ] **Step 1: Failing test — Auth + Trigger + unbekannter slug**

```rust
#[cfg(test)]
mod api_tests {
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;
    fn body_req(uri: &str, token: Option<&str>, json: &str) -> Request<Body> {
        let mut b = Request::builder().method("POST").uri(uri).header("content-type","application/json");
        if let Some(t) = token { b = b.header("authorization", format!("Bearer {t}")); }
        b.body(Body::from(json.to_string())).unwrap()
    }
    #[tokio::test]
    async fn ohne_token_401() {
        let app = super::super::api::router(super::super::api::test_state());
        let r = app.oneshot(body_req("/builds", None, r#"{"slug":"bayern"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    }
    #[tokio::test]
    async fn unbekannter_slug_400() {
        let app = super::super::api::router(super::super::api::test_state());
        let r = app.oneshot(body_req("/builds", Some("t"), r#"{"slug":"atlantis"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }
    #[tokio::test]
    async fn gueltiger_trigger_202() {
        let app = super::super::api::router(super::super::api::test_state());
        let r = app.oneshot(body_req("/builds", Some("t"), r#"{"slug":"bayern"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::ACCEPTED);
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `cargo test -p karten-service api_tests`
Expected: FAIL (compile).

- [ ] **Step 3: Implementieren** — `AppState` um `Registry`, `Arc<dyn Storage>`, `Arc<dyn BuildRunner>`, `Arc<Mutex<Vec<PublishedVersion>>>` erweitern; Bearer-Extractor; Handler spawnen `fahre_build` per `tokio::spawn` mit `try_lock_build`-Guard.

```rust
use axum::{extract::{State, Path}, http::{StatusCode, HeaderMap}, routing::{get, post}, Json, Router};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use crate::{jobs::Registry, regions, build, storage::Storage, manifest::PublishedVersion};

#[derive(Clone)]
pub struct AppState {
    pub token: String,
    pub registry: Registry,
    pub storage: Arc<dyn Storage>,
    pub runner: Arc<dyn build::BuildRunner>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
}
#[derive(Deserialize)] struct BuildReq { slug: String }

fn auth(h: &HeaderMap, token: &str) -> bool {
    h.get("authorization").and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ")) == Some(token) && !token.is_empty()
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/builds", post(trigger).get(liste))
        .route("/builds/{id}", get(einzeln))
        .with_state(state)
}

async fn trigger(State(st): State<AppState>, headers: HeaderMap, Json(req): Json<BuildReq>) -> (StatusCode, Json<serde_json::Value>) {
    if !auth(&headers, &st.token) { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"unauthorized"}))); }
    let Some(reg) = regions::finde(&req.slug) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"unbekannter slug"}))); };
    match st.registry.enqueue(reg.slug) {
        Err(_) => (StatusCode::CONFLICT, Json(serde_json::json!({"error":"queue voll"}))),
        Ok(id) => {
            // genau ein Build zur Zeit: Guard halten, sonst bleibt der Job queued bis der Läufer frei ist.
            let st2 = st.clone();
            tokio::spawn(async move {
                let Some(_guard) = st2.registry.try_lock_build() else { return; }; // v1: busy → bleibt queued (Scheduler/Retry treibt)
                build::fahre_build(reg, id, &st2.registry, st2.runner.clone(), st2.storage.clone(), st2.bestand.clone()).await;
            });
            (StatusCode::ACCEPTED, Json(serde_json::json!({"job_id": id})))
        }
    }
}
async fn liste(State(st): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<crate::jobs::BuildJob>>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    Ok(Json(st.registry.alle()))
}
async fn einzeln(State(st): State<AppState>, headers: HeaderMap, Path(id): Path<u64>) -> Result<Json<crate::jobs::BuildJob>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    st.registry.get(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[cfg(test)]
pub fn test_state() -> AppState {
    AppState {
        token: "t".into(), registry: Registry::neu(4),
        storage: Arc::new(crate::storage::FakeStorage::neu("https://cdn.example/maps")),
        runner: Arc::new(TestRunner), bestand: Arc::new(Mutex::new(Vec::new())),
    }
}
#[cfg(test)]
struct TestRunner;
#[cfg(test)]
#[async_trait::async_trait]
impl build::BuildRunner for TestRunner {
    async fn baue(&self, _a: &str) -> anyhow::Result<build::BuildArtefakt> {
        Ok(build::BuildArtefakt { bytes: vec![1], sha256: "d".repeat(64), bounds: Some((8.9,47.2,13.9,50.6)) })
    }
}
```

`main.rs` `serve`-Zweig verdrahten (Config → S3Storage/MakeRunner → Registry → Scheduler starten → `axum::serve`). Beim Start: keine persistenten Jobs (in-memory) — nichts zu resetten.

- [ ] **Step 4: Run → pass**

Run: `cargo test -p karten-service api_tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/api.rs karten-service/src/main.rs
git commit -m "feat(lfh-201): /builds-API (Bearer-Auth, Trigger→spawn, Status)"
```

---

## Task 12: `build`- & `serve`-CLI + Integrations-Smoke (Bremen) — **echter Docker+S3-Host**

**Files:**
- Modify: `karten-service/src/main.rs` (clap-Subkommandos `serve`|`build --slug|--all`)
- Create: `karten-service/tests/smoke_bremen.rs` (ignored by default)

**Interfaces:**
- Produces: `karten-service serve`, `karten-service build --slug <x>`, `karten-service build --all`.

- [ ] **Step 1: clap-Subkommandos + `build`-Pfad implementieren**

`build --slug <x>` / `--all` bauen ohne HTTP-Server: Registry lokal, `MakeRunner` + `S3Storage` aus
Config, je Slug `fahre_build`. `serve` startet API + Scheduler (Cron `enqueue_all` = alle Slugs).

- [ ] **Step 2: Smoke-Test (ignored) — kleine Region echt bauen**

`karten-service/tests/smoke_bremen.rs`:

```rust
// Läuft NUR auf einem Host mit Docker + versatiles-Image + Netz + S3-ENV.
// Ausführen: `cargo test -p karten-service --test smoke_bremen -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn baut_bremen_und_bounds_passen() {
    use karten_service::build::{make_runner::MakeRunner, BuildRunner, validate};
    let runner = MakeRunner { karten_build_dir: "karten-build".into() };
    let art = runner.baue("bremen").await.expect("Bremen-Bau");
    assert_eq!(art.sha256.len(), 64);
    let de = validate::erwartete_box("DE").unwrap();
    assert!(validate::bounds_passen(art.bounds, de), "Bremen-bounds in DE-Box: {:?}", art.bounds);
}
```

Dafür `karten-service` als Lib zugänglich machen (`src/lib.rs` mit `pub mod build; pub mod regions; …`), `main.rs` nutzt die Lib.

- [ ] **Step 3: Kompilieren + (auf echtem Host) Smoke laufen**

Run (überall): `cargo test -p karten-service`
Run (nur echter Host): `cargo test -p karten-service --test smoke_bremen -- --ignored --nocapture`
Expected: Unit-Tests PASS; Smoke PASS auf dem Docker/S3-Host, baut `bremen`, bounds in DE-Box.

- [ ] **Step 4: Commit**

```bash
git add karten-service/src/main.rs karten-service/src/lib.rs karten-service/tests/smoke_bremen.rs
git commit -m "feat(lfh-201): serve/build-CLI + Bremen-Integrations-Smoke (ignored)"
```

---

## Self-Review

**Spec-Coverage:** §A.1 Katalog-Def → Task 3; §A.2 Build-Runner (seriell, validate, sha256) → Tasks 6/8/9 + Guard in 5/11; §A.3 Publisher/Storage → Task 7; §A.4 Manifest (voll, atomar) → Tasks 4/10; §A.5 Scheduler in-service → Task 10; §A.6 API+Auth → Task 11; §A.7 Nebenläufigkeit/Fehler/in-memory → Tasks 5/10/11; Manifest-Vertrag/geteilte Struct → Task 1; Versionierung (datierte URL) → Task 4. **Nicht in Plan A** (bewusst): lifeline-hub-Config/Proxy-Trigger/Admin-UI (Komponente B → eigener Plan); DACH-Merge (YAGNI); Retention/GC (Ops).

**Placeholder-Scan:** keine „TBD/TODO/implement later". Infra-abhängige Tasks (9, 12) enthalten echten Code + exakte Kommandos und sind klar als „echter Host" markiert (Unit-Fläche bleibt hier grün).

**Typ-Konsistenz:** `OfflineKatalogEintrag` (Task 1) durchgängig; `PublishedVersion{slug,url,groesse:i64,sha256}` (Task 4, `Clone` in Task 8 ergänzt) konsistent in 8/10/11; `BuildArtefakt{bytes,sha256,bounds}` (Task 8) in 9/12; `BuildRunner::baue(&self, geofabrik_area)` und `Storage::{put,public_url}` stabil über 7–12; `Registry`-Signaturen (Task 5) in 10/11 unverändert.

## Offene Umsetzungs-Details (im Plan bewusst dem Umsetzer überlassen)

- Exakte `object_store`-Version/Feature + R2-Endpoint-ENV (Task 7) — gegen die aktuelle Crate-Doku
  pinnen.
- `tokio-cron-scheduler`-Version + 6-Feld-Cron-Semantik (Task 2/10) — beim Verdrahten verifizieren.
- Queue-Retry, wenn `try_lock_build` busy ist (Task 11): v1 lässt den Job `queued`; ein einfacher
  Drain-Loop im `serve`-Prozess (der freie Guards an den ältesten `queued`-Job vergibt) ist die
  saubere Ergänzung — als kleiner Folge-Schritt, nicht Blocker.
```
