# Karten-Region-Build-Service (Komponente A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigenständiger, zentral gehosteter Rust-Service, der einen fixen kuratierten Satz
Offline-Karten-Regionen per Zeitplan (+ on-demand) via `karten-build`/Docker baut, ins
Object-Storage publisht und ein `offline-katalog-manifest.json` (den LFH-199-Client-Vertrag)
regeneriert.

**Architecture:** Neues Crate `karten-service/` in einem neu eingeführten Cargo-Workspace. Ein
`serve`-Prozess trägt eine axum-API (Trigger/Status, Bearer-Auth) + einen in-Prozess-Cron-Scheduler
+ **einen seriellen Build-Worker**. Trigger und Cron *enqueuen* nur; der Worker *drained* die Queue
unter einem globalen Ein-Build-Guard (ein Build zur Zeit — geteilter `karten-build/out/sources`-Cache,
LFH-200). Build-Runner und Storage sitzen hinter Traits (im Test gefaked); die konkreten Docker-/
S3-Implementierungen sind die einzigen Tasks, die den echten Host brauchen. Der Manifest-Vertrag
`OfflineKatalogEintrag` wird in ein geteiltes Crate extrahiert (eine Quelle der Wahrheit).

**Tech Stack:** Rust (edition 2021), axum 0.8, tokio 1, serde/serde_json 1, clap 4 (derive+env),
chrono 0.4 (Datums-Version), sha2 0.11 (gestreamt), anyhow 1, tracing 0.1; `object_store` (S3/R2,
hinter `Storage`-Trait, gestreamter Multipart-Upload), `tokio-cron-scheduler` (Scheduler), `bytes`.
Build via `tokio::process` → `make -C karten-build tiles AREA=<x>`.

## Global Constraints

- **Rust edition 2021**, axum **0.8**, tokio **1** (features `full`), serde **1** mit `derive`,
  chrono **0.4** (`default-features = false`, feature `clock`), sha2 **0.11**, clap **4** (`derive`,
  `env`) — Versionen an den Wurzel-Crate angleichen. Kein sqlx im Service (Job-Status ist in-memory).
- **Ein Build zur Zeit** (globaler Guard, ein Worker); `geofabrik_area` ist immer ein **einzelner**
  gültiger Geofabrik-Extrakt (kein „dach"/Kombi in v1).
- **Große Dateien nie ganz in den RAM:** MBTiles werden als **Datei-Pfad** durchgereicht und
  **gestreamt** hochgeladen (`put_multipart`); nur das winzige Manifest-JSON geht als Bytes.
- **Manifest immer vollständig** (alle Regionen, aktuelle Version) und **atomar** publishen (erst
  Datei, dann Manifest); nie ein Teil-/Zwischen-Manifest. **Beim Start `bestand` aus dem vorhandenen
  Manifest seeden** — sonst verliert ein Neustart alle Nicht-gerade-gebauten Einträge.
- **Kachel-Schema fix `"shortbread"`, Format `pbf`, Lizenz ODbL** je Manifest-Eintrag.
- **Halb-Pin-Regel** (bestehender `karten_katalog::remote_eintrag_ist_gueltig`) bleibt Vertrag:
  64-hex-sha256 lowercase + `https://`-URL ohne `TODO` + groesse>0 + lizenz gesetzt.
- **Versionierung über die URL:** Dateiname `<slug>.<YYYYMMDD>.shortbread.mbtiles`.
- **Bearer-Token** für alle `/builds`-Endpunkte; Manifest+Files liegen public-read im Object-Storage.
- **Gate-Disziplin (Workspace):** der Haupt-Gate bleibt `cargo test -p lifeline-hub`; **nach Task 1
  zusätzlich `cargo test` (workspace-weit) grün prüfen** (die Workspace-Umstellung darf den
  Wurzel-Crate nicht brechen). Pro Service-Task `cargo test -p karten-service`. Repo ist bewusst
  nicht rustfmt-/clippy-clean → im Bestandsstil editieren, `cargo test` ist das Gate.

---

## File Structure

**Neuer Workspace + geteiltes Typ-Crate:**
- Modify: `Cargo.toml` (Wurzel) → `[workspace] members = [".", "crates/karten-katalog", "karten-service"]`.
- Create: `crates/karten-katalog/{Cargo.toml,src/lib.rs}` — `OfflineKatalogEintrag` +
  `remote_eintrag_ist_gueltig` + `merge_offline_katalog` (aus `src/config.rs` extrahiert).
- Modify: `src/config.rs` — re-exportiert die Typen (Bestands-Imports/Tests unverändert).

**Service-Crate `karten-service/`:** `Cargo.toml`, `src/{main.rs,lib.rs,config.rs,regions.rs,manifest.rs,jobs.rs,api.rs,scheduler.rs,worker.rs}`, `src/storage/{mod.rs,s3.rs}`, `src/build/{mod.rs,make_runner.rs,validate.rs}`, `tests/smoke_bremen.rs`.

---

## Task 1: Workspace + geteiltes `karten-katalog`-Crate

**Files:** Modify `Cargo.toml`; Create `crates/karten-katalog/{Cargo.toml,src/lib.rs}`; Modify `src/config.rs`, `src/karte/katalog.rs`.

**Interfaces:**
- Produces: `karten_katalog::OfflineKatalogEintrag { name:String, url:String, region:String, groesse:i64, lizenz:String, kachel_schema:String, quelle:String, sha256:Option<String>, gruppe:Option<String> }` (Clone+Debug+Serialize+Deserialize); `remote_eintrag_ist_gueltig(&OfflineKatalogEintrag)->bool`; `merge_offline_katalog(Vec, Option<Vec>)->Vec`.

- [ ] **Step 1: Workspace-Tabelle** — ans Ende von `Cargo.toml`:

```toml
[workspace]
members = [".", "crates/karten-katalog", "karten-service"]
```

- [ ] **Step 2: geteiltes Crate** — `crates/karten-katalog/Cargo.toml`:

```toml
[package]
name = "karten-katalog"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
```

`crates/karten-katalog/src/lib.rs` — `OfflineKatalogEintrag`, `remote_eintrag_ist_gueltig`,
`merge_offline_katalog` **wörtlich** aus `src/config.rs` übernehmen, plus:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halb_gepinnter_remote_eintrag_ist_ungueltig() {
        let e = OfflineKatalogEintrag { name:"X".into(), url:"https://TODO/x.mbtiles".into(),
            region:"X".into(), groesse:1, lizenz:"ODbL".into(), kachel_schema:"shortbread".into(),
            quelle:"t".into(), sha256:None, gruppe:None };
        assert!(!remote_eintrag_ist_gueltig(&e));
    }
}
```

- [ ] **Step 3: `src/config.rs` auf Re-Export** — die drei Definitionen ersetzen durch
`pub use karten_katalog::{OfflineKatalogEintrag, remote_eintrag_ist_gueltig, merge_offline_katalog};`
(`default_offline_katalog()` bleibt). Wurzel-`[dependencies]`: `karten-katalog = { path = "crates/karten-katalog" }`.

- [ ] **Step 4: Gates** — Run: `cargo test -p karten-katalog` **und** `cargo test` (workspace-weit).
Expected: neuer Crate-Test + alle Bestandstests (`config`/`katalog`) PASS; Wurzel-Crate unverändert grün.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/karten-katalog src/config.rs src/karte/katalog.rs
git commit -m "refactor(lfh-201): OfflineKatalogEintrag in geteiltes karten-katalog-Crate (Workspace)"
```

---

## Task 2: Service-Crate-Skelett + Config + `/healthz`

**Files:** Create `karten-service/Cargo.toml`, `karten-service/src/{main.rs,lib.rs,config.rs,api.rs}`.

**Interfaces:**
- Produces: `ServiceConfig { bind, token, base_url, karten_build_dir:PathBuf, schedule, storage_bucket }` (clap `Parser`, env `KS_*`); `api::router(AppState)->Router` mit `GET /healthz`→`200`.

- [ ] **Step 1: Failing test** — `karten-service/src/api.rs`:

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

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service healthz_ok` → FAIL (Crate fehlt).

- [ ] **Step 3: Crate + Config + minimaler Router**

`karten-service/Cargo.toml`:

```toml
[package]
name = "karten-service"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"

[[bin]]
name = "karten-service"
path = "src/main.rs"

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
async-trait = "0.1"
bytes = "1"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
tempfile = "3"
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
    #[arg(long, env = "KS_TOKEN", default_value = "")]
    pub token: String,
    /// Öffentliche Basis-URL des Object-Storage (ohne End-Slash), z. B. https://cdn.example/maps
    #[arg(long, env = "KS_BASE_URL", default_value = "")]
    pub base_url: String,
    #[arg(long, env = "KS_KARTEN_BUILD_DIR", default_value = "karten-build")]
    pub karten_build_dir: PathBuf,
    /// Cron-Expression (6 Felder). Default: quartalsweise 03:00 am 1. (Jan/Apr/Jul/Okt).
    #[arg(long, env = "KS_SCHEDULE", default_value = "0 0 3 1 1,4,7,10 *")]
    pub schedule: String,
    #[arg(long, env = "KS_STORAGE_BUCKET", default_value = "")]
    pub storage_bucket: String,
}
```

`karten-service/src/lib.rs`:

```rust
pub mod api;
pub mod build;
pub mod config;
pub mod jobs;
pub mod manifest;
pub mod regions;
pub mod scheduler;
pub mod storage;
pub mod worker;
```

`karten-service/src/api.rs` (Grundgerüst):

```rust
use axum::{routing::get, Router};

#[derive(Clone)]
pub struct AppState { pub token: String }

pub fn router(state: AppState) -> Router {
    Router::new().route("/healthz", get(|| async { "ok" })).with_state(state)
}

#[cfg(test)]
pub fn test_state() -> AppState { AppState { token: "t".into() } }
```

`karten-service/src/main.rs`:

```rust
use clap::Parser;
use karten_service::{api, config::ServiceConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let cfg = ServiceConfig::parse();
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    axum::serve(listener, api::router(api::AppState { token: cfg.token })).await?;
    Ok(())
}
```

Die übrigen `lib.rs`-Module (`build`, `jobs`, …) werden in den Folge-Tasks angelegt; bis dahin je
als leere Datei mit `// stub` anlegen, damit `lib.rs` kompiliert, oder die `mod`-Zeilen erst beim
Anlegen des Moduls ergänzen (empfohlen: Zeile erst mit dem Modul einführen).

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service healthz_ok` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service Cargo.toml
git commit -m "feat(lfh-201): karten-service-Skelett (Config, /healthz, lib)"
```

---

## Task 3: Autoritativer Region-Satz (`regions.rs`)

**Files:** Create `karten-service/src/regions.rs`; Modify `lib.rs` (`pub mod regions;`).

**Interfaces:**
- Produces: `regions::Region { slug:&'static str, geofabrik_area:&'static str, name:&'static str, region:&'static str, gruppe:&'static str, lizenz:&'static str }`; `regions::alle()->&'static [Region]`; `regions::finde(&str)->Option<&'static Region>`.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kein_dach_kombi_und_lookup_klappt() {
        assert!(finde("germany").is_some());
        assert!(finde("dach").is_none(), "DACH ist kein einzelner Geofabrik-Extrakt (v1)");
        assert!(finde("atlantis").is_none());
        let mut slugs: Vec<_> = alle().iter().map(|r| r.slug).collect();
        let n = slugs.len(); slugs.sort(); slugs.dedup();
        assert_eq!(slugs.len(), n, "Slugs eindeutig");
        assert!(alle().iter().all(|r| !r.geofabrik_area.is_empty()));
        assert!(alle().iter().all(|r| !r.slug.contains('.')), "Slug ohne Punkt (URL-Parsing)");
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service kein_dach` → FAIL.

- [ ] **Step 3: Implementieren**

```rust
pub struct Region {
    pub slug: &'static str, pub geofabrik_area: &'static str, pub name: &'static str,
    pub region: &'static str, pub gruppe: &'static str, pub lizenz: &'static str,
}
const ODBL: &str = "© OpenStreetMap contributors (ODbL)";
static REGIONS: &[Region] = &[
    Region { slug:"germany", geofabrik_area:"germany", name:"Deutschland (Shortbread)", region:"DE", gruppe:"Deutschland", lizenz:ODBL },
    Region { slug:"bayern", geofabrik_area:"bayern", name:"Bayern", region:"DE-BY", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"baden-wuerttemberg", geofabrik_area:"baden-wuerttemberg", name:"Baden-Württemberg", region:"DE-BW", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"nordrhein-westfalen", geofabrik_area:"nordrhein-westfalen", name:"Nordrhein-Westfalen", region:"DE-NW", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"niedersachsen", geofabrik_area:"niedersachsen", name:"Niedersachsen", region:"DE-NI", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"austria", geofabrik_area:"austria", name:"Österreich", region:"AT", gruppe:"Nachbarländer", lizenz:ODBL },
    Region { slug:"switzerland", geofabrik_area:"switzerland", name:"Schweiz", region:"CH", gruppe:"Nachbarländer", lizenz:ODBL },
];
pub fn alle() -> &'static [Region] { REGIONS }
pub fn finde(slug: &str) -> Option<&'static Region> { REGIONS.iter().find(|r| r.slug == slug) }
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service kein_dach` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/regions.rs karten-service/src/lib.rs
git commit -m "feat(lfh-201): fixer Region-Satz (einzelne Geofabrik-Extrakte, kein DACH-Kombi)"
```

---

## Task 4: Manifest-Generator + Seed-Parser (`manifest.rs`)

**Files:** Create `karten-service/src/manifest.rs`; Modify `lib.rs`.

**Interfaces:**
- Produces: `manifest::PublishedVersion { slug:String, url:String, groesse:i64, sha256:String }` (Clone); `manifest::datei_key(slug:&str, datum:NaiveDate)->String`; `manifest::baue_manifest(&[PublishedVersion])->Vec<OfflineKatalogEintrag>`; `manifest::published_aus_eintrag(&OfflineKatalogEintrag)->Option<PublishedVersion>` (Slug aus URL-Dateiname rekonstruieren — für den Startup-Seed).

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use karten_katalog::remote_eintrag_ist_gueltig;
    #[test]
    fn key_ist_datiert() {
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        assert_eq!(datei_key("bayern", d), "bayern.20260705.shortbread.mbtiles");
    }
    #[test]
    fn manifest_eintraege_sind_vollstaendig_gepinnt() {
        let v = vec![PublishedVersion { slug:"germany".into(),
            url:"https://cdn.example/maps/germany.20260705.shortbread.mbtiles".into(),
            groesse:3_000_000_000, sha256:"a".repeat(64) }];
        let m = baue_manifest(&v);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].kachel_schema, "shortbread");
        assert_eq!(m[0].name, "Deutschland (Shortbread)");
        assert!(remote_eintrag_ist_gueltig(&m[0]));
    }
    #[test]
    fn seed_round_trip() {
        // manifest -> eintrag -> published behält slug/url/sha
        let v = vec![PublishedVersion { slug:"baden-wuerttemberg".into(),
            url:"https://cdn.example/maps/baden-wuerttemberg.20260705.shortbread.mbtiles".into(),
            groesse:1_000_000_000, sha256:"b".repeat(64) }];
        let m = baue_manifest(&v);
        let back = published_aus_eintrag(&m[0]).unwrap();
        assert_eq!(back.slug, "baden-wuerttemberg");
        assert_eq!(back.url, v[0].url);
        assert_eq!(back.sha256, v[0].sha256);
    }
    #[test]
    fn unbekannter_slug_wird_uebersprungen() {
        let v = vec![PublishedVersion { slug:"atlantis".into(), url:"https://x/a.mbtiles".into(), groesse:1, sha256:"c".repeat(64) }];
        assert!(baue_manifest(&v).is_empty());
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service manifest` → FAIL.

- [ ] **Step 3: Implementieren**

```rust
use crate::regions;
use chrono::NaiveDate;
use karten_katalog::OfflineKatalogEintrag;

#[derive(Clone)]
pub struct PublishedVersion { pub slug: String, pub url: String, pub groesse: i64, pub sha256: String }

pub fn datei_key(slug: &str, datum: NaiveDate) -> String {
    format!("{slug}.{}.shortbread.mbtiles", datum.format("%Y%m%d"))
}

pub fn baue_manifest(versionen: &[PublishedVersion]) -> Vec<OfflineKatalogEintrag> {
    versionen.iter().filter_map(|v| {
        let r = regions::finde(&v.slug)?;
        Some(OfflineKatalogEintrag {
            name: r.name.into(), url: v.url.clone(), region: r.region.into(),
            groesse: v.groesse, lizenz: r.lizenz.into(), kachel_schema: "shortbread".into(),
            quelle: "Eigen-Service (karten-build, Planetiler-Shortbread)".into(),
            sha256: Some(v.sha256.clone()), gruppe: Some(r.gruppe.into()),
        })
    }).collect()
}

/// Rekonstruiert eine PublishedVersion aus einem Manifest-Eintrag (Slug = Dateiname-Präfix vor dem
/// ersten '.'; Slugs enthalten keinen Punkt). `None`, wenn kein sha256 oder Slug unbekannt.
pub fn published_aus_eintrag(e: &OfflineKatalogEintrag) -> Option<PublishedVersion> {
    let datei = e.url.rsplit('/').next()?;
    let slug = datei.split('.').next()?.to_string();
    regions::finde(&slug)?;
    let sha256 = e.sha256.clone()?;
    Some(PublishedVersion { slug, url: e.url.clone(), groesse: e.groesse, sha256 })
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service manifest` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/manifest.rs karten-service/src/lib.rs
git commit -m "feat(lfh-201): Manifest-Generator + Seed-Parser (datierte URL, vollständig gepinnt)"
```

---

## Task 5: Job-Registry + serialisierte Queue (`jobs.rs`)

**Files:** Create `karten-service/src/jobs.rs`; Modify `lib.rs`.

**Interfaces:**
- Produces: `jobs::JobStatus` (`Queued|Building|Uploading|Publishing|Done|Failed(String)`, Serialize); `jobs::BuildJob { id:u64, slug:String, status:JobStatus, gestartet:String, beendet:Option<String> }` (Clone+Serialize); `jobs::Registry` (Clone) mit `neu(offene_cap)`, `enqueue(&str)->Result<u64,EnqueueError>`, `get(u64)->Option<BuildJob>`, `alle()->Vec<BuildJob>`, `set_status(u64,JobStatus)`, `naechster_queued()->Option<(u64,String)>`, `try_lock_build()->Option<BuildGuard>`; `EnqueueError::Voll`.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nur_ein_build_guard_gleichzeitig() {
        let r = Registry::neu(4);
        let g1 = r.try_lock_build();
        assert!(g1.is_some());
        assert!(r.try_lock_build().is_none());
        drop(g1);
        assert!(r.try_lock_build().is_some());
    }
    #[test]
    fn naechster_queued_ist_fifo_und_ueberspringt_nicht_queued() {
        let r = Registry::neu(4);
        let a = r.enqueue("bayern").unwrap();
        let _b = r.enqueue("germany").unwrap();
        assert_eq!(r.naechster_queued().unwrap().0, a, "ältester queued zuerst");
        r.set_status(a, JobStatus::Building);
        assert_eq!(r.naechster_queued().unwrap().1, "germany", "Building wird übersprungen");
    }
    #[test]
    fn queue_cap_greift() {
        let r = Registry::neu(1);
        r.enqueue("bayern").unwrap();
        assert!(matches!(r.enqueue("germany"), Err(EnqueueError::Voll)));
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service jobs` → FAIL.

- [ ] **Step 3: Implementieren**

```rust
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "fehler", rename_all = "lowercase")]
pub enum JobStatus { Queued, Building, Uploading, Publishing, Done, Failed(String) }

#[derive(Clone, Serialize)]
pub struct BuildJob { pub id:u64, pub slug:String, pub status:JobStatus, pub gestartet:String, pub beendet:Option<String> }

#[derive(Debug)]
pub enum EnqueueError { Voll }

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<Vec<BuildJob>>>, seq: Arc<AtomicU64>,
    building: Arc<AtomicBool>, offene_cap: usize,
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
        if v.iter().filter(|j| matches!(j.status, JobStatus::Queued)).count() >= self.offene_cap {
            return Err(EnqueueError::Voll);
        }
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        v.push(BuildJob { id, slug: slug.into(), status: JobStatus::Queued, gestartet: now_iso(), beendet: None });
        Ok(id)
    }
    pub fn get(&self, id:u64) -> Option<BuildJob> { self.inner.lock().unwrap().iter().find(|j| j.id==id).cloned() }
    pub fn alle(&self) -> Vec<BuildJob> { self.inner.lock().unwrap().clone() }
    pub fn set_status(&self, id:u64, s:JobStatus) {
        let mut v = self.inner.lock().unwrap();
        if let Some(j) = v.iter_mut().find(|j| j.id==id) {
            if matches!(s, JobStatus::Done | JobStatus::Failed(_)) { j.beendet = Some(now_iso()); }
            j.status = s;
        }
    }
    /// Ältester Job im Status Queued (FIFO). Für den Worker-Drain.
    pub fn naechster_queued(&self) -> Option<(u64,String)> {
        self.inner.lock().unwrap().iter().find(|j| matches!(j.status, JobStatus::Queued))
            .map(|j| (j.id, j.slug.clone()))
    }
    pub fn try_lock_build(&self) -> Option<BuildGuard> {
        if self.building.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            Some(BuildGuard(self.building.clone()))
        } else { None }
    }
}
fn now_iso() -> String { chrono::Utc::now().to_rfc3339() }
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service jobs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/jobs.rs karten-service/src/lib.rs
git commit -m "feat(lfh-201): Job-Registry (FIFO-Queue, naechster_queued, Ein-Build-Guard)"
```

---

## Task 6: Bounds-Validierung (`build/validate.rs`)

**Files:** Create `karten-service/src/build/mod.rs` (zunächst `pub mod validate;`), `karten-service/src/build/validate.rs`; Modify `lib.rs`.

**Interfaces:**
- Produces: `build::validate::erwartete_box(region_code:&str)->Option<(f64,f64,f64,f64)>`; `build::validate::bounds_passen(gebaut:Option<(f64,f64,f64,f64)>, erwartet:(f64,f64,f64,f64))->bool`.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bremen_bounds_liegen_in_de_box() {
        assert!(bounds_passen(Some((8.48,53.01,8.99,53.23)), erwartete_box("DE").unwrap()));
    }
    #[test]
    fn de_weit_faellt_aus_bayern_box() {
        let by = (8.9,47.2,13.9,50.6);
        assert!(!bounds_passen(Some((5.8,47.2,15.1,55.1)), by));
    }
    #[test]
    fn fehlende_bounds_ungueltig() { assert!(!bounds_passen(None, erwartete_box("DE").unwrap())); }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service validate` → FAIL.

- [ ] **Step 3: Implementieren**

```rust
pub fn erwartete_box(region_code: &str) -> Option<(f64,f64,f64,f64)> {
    Some(match region_code {
        "DE" => (5.8,47.2,15.1,55.1),
        "AT" => (9.5,46.3,17.2,49.1),
        "CH" => (5.9,45.8,10.5,47.9),
        c if c.starts_with("DE-") => (5.8,47.2,15.1,55.1),
        _ => return None,
    })
}
/// Gebautes bounds muss (mit kleiner Toleranz) INNERHALB der Erwartungs-Box liegen.
pub fn bounds_passen(gebaut: Option<(f64,f64,f64,f64)>, erwartet: (f64,f64,f64,f64)) -> bool {
    let Some((w,s,o,n)) = gebaut else { return false };
    let (ew,es,eo,en) = erwartet; let t = 0.5;
    w >= ew-t && s >= es-t && o <= eo+t && n <= en+t && w < o && s < n
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service validate` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build karten-service/src/lib.rs
git commit -m "feat(lfh-201): Post-Build-Bounds-Validierung (Falschregion-Schutz)"
```

---

## Task 7: `Storage`-Trait + `FakeStorage` (+ S3-Adapter)

**Files:** Create `karten-service/src/storage/mod.rs`, `karten-service/src/storage/s3.rs`; Modify `lib.rs`.

**Interfaces:**
- Produces: `#[async_trait] Storage { async fn put_datei(&self, key:&str, pfad:&Path)->Result<()>; async fn put_bytes(&self, key:&str, bytes:Vec<u8>)->Result<()>; async fn get_bytes(&self, key:&str)->Result<Option<Vec<u8>>>; fn public_url(&self, key:&str)->String; }`; `storage::FakeStorage` (in-memory, `neu(base)`, `inhalt(key)->Option<Vec<u8>>`); `storage::s3::S3Storage` (object_store, gestreamter Multipart-Upload).

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[tokio::test]
    async fn fake_datei_und_bytes_round_trip() {
        let s = FakeStorage::neu("https://cdn.example/maps");
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[1,2,3]).unwrap();
        s.put_datei("germany.20260705.shortbread.mbtiles", f.path()).await.unwrap();
        assert_eq!(s.public_url("germany.20260705.shortbread.mbtiles"),
                   "https://cdn.example/maps/germany.20260705.shortbread.mbtiles");
        assert_eq!(s.inhalt("germany.20260705.shortbread.mbtiles").unwrap(), vec![1,2,3]);
        s.put_bytes("m.json", b"[]".to_vec()).await.unwrap();
        assert_eq!(s.get_bytes("m.json").await.unwrap().unwrap(), b"[]".to_vec());
        assert!(s.get_bytes("fehlt").await.unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service storage` → FAIL.

- [ ] **Step 3: Trait + Fake + S3-Adapter**

`storage/mod.rs`:

```rust
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;
pub mod s3;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()>;
    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()>;
    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>>;
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
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()> {
        let bytes = tokio::fs::read(pfad).await?; // Testdateien sind klein
        self.map.lock().unwrap().insert(key.into(), bytes); Ok(())
    }
    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.map.lock().unwrap().insert(key.into(), bytes); Ok(())
    }
    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(self.map.lock().unwrap().get(key).cloned())
    }
    fn public_url(&self, key: &str) -> String { format!("{}/{}", self.base, key) }
}
```

`storage/s3.rs` (konkreter Adapter — auf echtem Host, s. Task 13; exakte object_store-API gegen die
Crate-Doc der gepinnten Version verifizieren):

```rust
use super::Storage;
use async_trait::async_trait;
use object_store::{aws::AmazonS3Builder, path::Path as ObjPath, ObjectStore};
use std::path::Path;
use tokio::io::AsyncReadExt;

pub struct S3Storage { store: object_store::aws::AmazonS3, base: String }
impl S3Storage {
    pub fn neu(bucket: &str, base_url: &str) -> anyhow::Result<Self> {
        // Credentials/Endpoint aus Standard-ENV (AWS_ACCESS_KEY_ID/…, AWS_ENDPOINT für R2).
        let store = AmazonS3Builder::from_env().with_bucket_name(bucket).build()?;
        Ok(Self { store, base: base_url.trim_end_matches('/').into() })
    }
}
#[async_trait]
impl Storage for S3Storage {
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()> {
        let mut upload = self.store.put_multipart(&ObjPath::from(key)).await?;
        let mut f = tokio::fs::File::open(pfad).await?;
        let mut buf = vec![0u8; 8 * 1024 * 1024];
        loop {
            let n = f.read(&mut buf).await?;
            if n == 0 { break; }
            upload.put_part(bytes::Bytes::copy_from_slice(&buf[..n]).into()).await?;
        }
        upload.complete().await?;
        Ok(())
    }
    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.store.put(&ObjPath::from(key), bytes.into()).await?; Ok(())
    }
    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
        match self.store.get(&ObjPath::from(key)).await {
            Ok(r) => Ok(Some(r.bytes().await?.to_vec())),
            Err(object_store::Error::NotFound { .. }) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    fn public_url(&self, key: &str) -> String { format!("{}/{}", self.base, key) }
}
```

- [ ] **Step 4: Run → pass** (Fake-Test; S3 nur kompiliert) — `cargo test -p karten-service storage` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/storage karten-service/src/lib.rs
git commit -m "feat(lfh-201): Storage-Trait (put_datei gestreamt/put_bytes/get_bytes) + Fake + S3"
```

---

## Task 8: `BuildRunner`-Trait + `FakeRunner` + `build_region`

**Files:** Modify `karten-service/src/build/mod.rs`.

**Interfaces:**
- Consumes: `Storage`, `regions::Region`, `manifest::{PublishedVersion, datei_key}`, `validate`.
- Produces: `#[async_trait] BuildRunner { async fn baue(&self, geofabrik_area:&str)->Result<BuildArtefakt>; }`; `build::BuildArtefakt { datei:PathBuf, sha256:String, bounds:Option<(f64,f64,f64,f64)> }`; `build::build_region(reg:&Region, heute:NaiveDate, runner:&dyn BuildRunner, storage:&dyn Storage, bestand:&[PublishedVersion])->Result<Vec<PublishedVersion>>`.

- [ ] **Step 1: Failing test** (Fakes schreiben eine kleine Temp-Datei statt RAM-Bytes)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{storage::FakeStorage, regions};
    use std::io::Write;

    fn tempdatei(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(bytes).unwrap(); f
    }
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei: self.0.clone(), sha256:"a".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    struct FalschRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for FalschRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei: self.0.clone(), sha256:"a".repeat(64), bounds:Some((5.8,47.2,15.1,55.1)) })
        }
    }
    #[tokio::test]
    async fn build_region_laedt_hoch_und_pinnt() {
        let f = tempdatei(&[9;10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        let neu = build_region(by, d, &OkRunner(f.path().into()), &s, &[]).await.unwrap();
        let v = neu.iter().find(|v| v.slug=="bayern").unwrap();
        assert_eq!(v.url, "https://cdn.example/maps/bayern.20260705.shortbread.mbtiles");
        assert_eq!(v.groesse, 10);
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_some());
    }
    #[tokio::test]
    async fn falschregion_bricht_ab_ohne_upload() {
        let f = tempdatei(&[9;10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        assert!(build_region(by, d, &FalschRunner(f.path().into()), &s, &[]).await.is_err());
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_none());
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service build_region` → FAIL.

- [ ] **Step 3: Implementieren** (`build/mod.rs` — `validate` + `make_runner` als Submodule)

```rust
pub mod validate;
pub mod make_runner;
use crate::manifest::{datei_key, PublishedVersion};
use crate::regions::Region;
use crate::storage::Storage;
use async_trait::async_trait;
use chrono::NaiveDate;
use std::path::PathBuf;

pub struct BuildArtefakt { pub datei: PathBuf, pub sha256: String, pub bounds: Option<(f64,f64,f64,f64)> }

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
    let groesse = std::fs::metadata(&art.datei)?.len() as i64;
    storage.put_datei(&key, &art.datei).await?;            // gestreamt, nie in den RAM
    let mut out: Vec<PublishedVersion> = bestand.iter().filter(|v| v.slug != reg.slug).cloned().collect();
    out.push(PublishedVersion { slug: reg.slug.into(), url: storage.public_url(&key), groesse, sha256: art.sha256 });
    Ok(out)
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service build_region` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build/mod.rs
git commit -m "feat(lfh-201): BuildRunner-Trait + build_region (PathBuf, validate→gestreamter Upload)"
```

---

## Task 9: `make`-BuildRunner-Impl (`build/make_runner.rs`) — **echter Docker-Host**

**Files:** Create `karten-service/src/build/make_runner.rs`.

**Interfaces:**
- Produces: `make_runner::MakeRunner { karten_build_dir: PathBuf }` implementiert `BuildRunner` (gibt den Datei-Pfad zurück, **streamt** sha256, liest `metadata.bounds`).

- [ ] **Step 1: Implementieren** (kein Unit-Test; Smoke = Task 13)

```rust
use super::{BuildArtefakt, BuildRunner};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub struct MakeRunner { pub karten_build_dir: PathBuf }

#[async_trait]
impl BuildRunner for MakeRunner {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt> {
        let status = Command::new("make")
            .arg("-C").arg(&self.karten_build_dir)
            .arg("tiles").arg(format!("AREA={geofabrik_area}"))
            .status().await?;
        anyhow::ensure!(status.success(), "make tiles AREA={geofabrik_area} fehlgeschlagen ({status})");
        let result_dir = self.karten_build_dir.join("out/result");
        let datei = std::fs::read_dir(&result_dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.file_name().and_then(|n| n.to_str())
                .map(|n| n.starts_with("osm") && n.ends_with(".mbtiles")).unwrap_or(false))
            .ok_or_else(|| anyhow::anyhow!("keine osm*.mbtiles in {}", result_dir.display()))?;
        let sha256 = sha256_datei(&datei)?;
        let bounds = lies_bounds(&datei)?;
        Ok(BuildArtefakt { datei, sha256, bounds })
    }
}

/// sha256 GESTREAMT (Sha256 implementiert io::Write) — die Multi-GB-Datei nie ganz in den RAM.
fn sha256_datei(p: &Path) -> anyhow::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h)?;
    Ok(format!("{:x}", h.finalize()))
}

fn lies_bounds(datei: &Path) -> anyhow::Result<Option<(f64,f64,f64,f64)>> {
    let out = std::process::Command::new("sqlite3").arg(datei)
        .arg("select value from metadata where name='bounds';").output()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let teile: Vec<f64> = s.trim().split(',').filter_map(|x| x.trim().parse().ok()).collect();
    Ok(match teile.as_slice() { [w,s,o,n] => Some((*w,*s,*o,*n)), _ => None })
}
```

- [ ] **Step 2: Kompilieren** — `cargo build -p karten-service` → PASS.

- [ ] **Step 3: Commit**

```bash
git add karten-service/src/build/make_runner.rs
git commit -m "feat(lfh-201): MakeRunner (make -C karten-build, gestreamter sha256, bounds)"
```

---

## Task 10: Build-Fahrt (`fahre_build`) + Startup-Seed

**Files:** Modify `karten-service/src/build/mod.rs`.

**Interfaces:**
- Produces: `build::fahre_build(reg:&Region, job_id:u64, registry:&Registry, runner:Arc<dyn BuildRunner>, storage:Arc<dyn Storage>, bestand:Arc<Mutex<Vec<PublishedVersion>>>)` (Status-FSM Building→Publishing→Done/Failed; ruft `build_region`; publisht das **volle** Manifest via `put_bytes`; aktualisiert `bestand` erst nach Erfolg); `build::seed_bestand(storage:&dyn Storage)->Vec<PublishedVersion>` (liest `offline-katalog-manifest.json`, rekonstruiert die Versionsliste).

- [ ] **Step 1: Failing test — Fahrt endet Done + volles Manifest; Seed round-trippt**

```rust
#[cfg(test)]
mod fahrt_tests {
    use super::*;
    use crate::{jobs::Registry, storage::FakeStorage, manifest::PublishedVersion, regions};
    use std::sync::{Arc, Mutex};
    use std::io::Write;
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei:self.0.clone(), sha256:"c".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    #[tokio::test]
    async fn fahrt_done_und_seed_bewahrt_andere_regionen() {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(&[7;5]).unwrap();
        let s = Arc::new(FakeStorage::neu("https://cdn.example/maps"));
        // Vorbestand: germany bereits publiziert
        let bestand = Arc::new(Mutex::new(vec![PublishedVersion {
            slug:"germany".into(), url:"https://cdn.example/maps/germany.20260101.shortbread.mbtiles".into(),
            groesse:3, sha256:"d".repeat(64) }]));
        let id = { let r = Registry::neu(4); let id = r.enqueue("bayern").unwrap();
            fahre_build(regions::finde("bayern").unwrap(), id, &r, Arc::new(OkRunner(f.path().into())),
                        s.clone(), bestand.clone()).await;
            assert!(matches!(r.get(id).unwrap().status, crate::jobs::JobStatus::Done)); id };
        let _ = id;
        // Manifest enthält BEIDE Regionen (germany bewahrt + bayern neu)
        let m: Vec<karten_katalog::OfflineKatalogEintrag> =
            serde_json::from_slice(&s.inhalt("offline-katalog-manifest.json").unwrap()).unwrap();
        assert!(m.iter().any(|e| e.name=="Deutschland (Shortbread)"));
        assert!(m.iter().any(|e| e.name=="Bayern"));
        // seed_bestand liest das Manifest zurück (2 Einträge)
        assert_eq!(seed_bestand(s.as_ref()).await.len(), 2);
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service fahrt` → FAIL.

- [ ] **Step 3: Implementieren** (`build/mod.rs` ergänzen)

```rust
use crate::jobs::{JobStatus, Registry};
use crate::manifest::{baue_manifest, published_aus_eintrag};
use karten_katalog::OfflineKatalogEintrag;
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
            match serde_json::to_vec(&baue_manifest(&neu)) {
                Ok(js) => match storage.put_bytes("offline-katalog-manifest.json", js).await {
                    Ok(()) => { *bestand.lock().unwrap() = neu; registry.set_status(job_id, JobStatus::Done); }
                    Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Upload: {e}"))),
                },
                Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Serialisierung: {e}"))),
            }
        }
        Err(e) => registry.set_status(job_id, JobStatus::Failed(e.to_string())),
    }
}

/// Beim Start: den aktuellen Manifest-Stand aus dem Storage laden, damit ein einzelner Rebuild
/// nicht die anderen Regionen aus dem Manifest wirft. Best-effort: Fehler → leerer Bestand.
pub async fn seed_bestand(storage: &dyn Storage) -> Vec<PublishedVersion> {
    let Ok(Some(js)) = storage.get_bytes("offline-katalog-manifest.json").await else { return vec![] };
    let Ok(eintraege) = serde_json::from_slice::<Vec<OfflineKatalogEintrag>>(&js) else { return vec![] };
    eintraege.iter().filter_map(published_aus_eintrag).collect()
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service fahrt` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/build/mod.rs
git commit -m "feat(lfh-201): fahre_build (volles atomares Manifest) + Startup-Seed"
```

---

## Task 11: Serieller Worker-Drain + Scheduler

**Files:** Create `karten-service/src/worker.rs`, `karten-service/src/scheduler.rs`; Modify `lib.rs`.

**Interfaces:**
- Consumes: `Registry`, `regions`, `build::fahre_build`, `Storage`, `BuildRunner`, `PublishedVersion`.
- Produces: `worker::WorkerState { registry, runner:Arc<dyn BuildRunner>, storage:Arc<dyn Storage>, bestand:Arc<Mutex<Vec<PublishedVersion>>> }` (Clone); `worker::tick(&WorkerState)->bool` (nimmt genau einen queued Job unter dem Guard, fährt ihn, `true` wenn gearbeitet); `worker::run(WorkerState)` (Endlos-Loop mit Poll-Intervall); `scheduler::starte(cron:&str, enqueue_all:impl FnMut()+Send+'static)->Result<JobScheduler>`.

- [ ] **Step 1: Failing test — tick fährt genau einen queued Job**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::Registry, storage::FakeStorage, manifest::PublishedVersion, build::{BuildArtefakt, BuildRunner}, regions};
    use std::sync::{Arc, Mutex};
    use std::io::Write;
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str)->anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei:self.0.clone(), sha256:"c".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    #[tokio::test]
    async fn tick_faehrt_queued_job() {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(&[7;5]).unwrap();
        let reg = Registry::neu(4);
        let st = WorkerState { registry: reg.clone(), runner: Arc::new(OkRunner(f.path().into())),
            storage: Arc::new(FakeStorage::neu("https://cdn.example/maps")),
            bestand: Arc::new(Mutex::new(Vec::<PublishedVersion>::new())) };
        let id = reg.enqueue("bayern").unwrap();
        assert!(tick(&st).await, "hat gearbeitet");
        assert!(matches!(reg.get(id).unwrap().status, crate::jobs::JobStatus::Done));
        assert!(!tick(&st).await, "nichts mehr queued");
        let _ = regions::finde("bayern");
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service worker` → FAIL.

- [ ] **Step 3: Implementieren**

`worker.rs`:

```rust
use crate::build::{fahre_build, BuildRunner};
use crate::jobs::{JobStatus, Registry};
use crate::manifest::PublishedVersion;
use crate::{regions, storage::Storage};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub struct WorkerState {
    pub registry: Registry,
    pub runner: Arc<dyn BuildRunner>,
    pub storage: Arc<dyn Storage>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
}

/// Nimmt — wenn der Build-Slot frei ist — genau den ältesten queued Job und fährt ihn zu Ende.
/// `true`, wenn gearbeitet wurde.
pub async fn tick(st: &WorkerState) -> bool {
    let Some(_guard) = st.registry.try_lock_build() else { return false };
    let Some((id, slug)) = st.registry.naechster_queued() else { return false };
    match regions::finde(&slug) {
        Some(reg) => fahre_build(reg, id, &st.registry, st.runner.clone(), st.storage.clone(), st.bestand.clone()).await,
        None => st.registry.set_status(id, JobStatus::Failed(format!("unbekannter slug {slug}"))),
    }
    true
}

pub async fn run(st: WorkerState) {
    loop {
        if !tick(&st).await { tokio::time::sleep(Duration::from_millis(500)).await; }
    }
}
```

`scheduler.rs`:

```rust
use tokio_cron_scheduler::{Job, JobScheduler};
pub async fn starte<F>(cron: &str, mut enqueue_all: F) -> anyhow::Result<JobScheduler>
where F: FnMut() + Send + 'static {
    let sched = JobScheduler::new().await?;
    sched.add(Job::new_async(cron, move |_id, _l| { enqueue_all(); Box::pin(async {}) })?).await?;
    sched.start().await?;
    Ok(sched)
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service worker` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/worker.rs karten-service/src/scheduler.rs karten-service/src/lib.rs
git commit -m "feat(lfh-201): serieller Build-Worker (Queue-Drain) + Cron-Scheduler"
```

---

## Task 12: API `/builds` + Bearer-Auth (Trigger enqueued nur)

**Files:** Modify `karten-service/src/api.rs`.

**Interfaces:**
- Consumes: `Registry`, `regions`, `Storage`, `BuildRunner`, `PublishedVersion`.
- Produces: `POST /builds` (Bearer) `{slug}` → 202 `{job_id}` | 400 | 401 | 409(Queue voll); `GET /builds` (Bearer) → `[BuildJob]`; `GET /builds/{id}` (Bearer) → `BuildJob`|404. **`trigger` spawnt NICHT** — es enqueued nur; der Worker (Task 11) fährt.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod api_tests {
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;
    fn post(uri:&str, token:Option<&str>, json:&str) -> Request<Body> {
        let mut b = Request::builder().method("POST").uri(uri).header("content-type","application/json");
        if let Some(t)=token { b = b.header("authorization", format!("Bearer {t}")); }
        b.body(Body::from(json.to_string())).unwrap()
    }
    #[tokio::test]
    async fn ohne_token_401() {
        let app = super::super::router(super::super::test_state());
        let r = app.oneshot(post("/builds", None, r#"{"slug":"bayern"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    }
    #[tokio::test]
    async fn unbekannter_slug_400() {
        let app = super::super::router(super::super::test_state());
        let r = app.oneshot(post("/builds", Some("t"), r#"{"slug":"atlantis"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }
    #[tokio::test]
    async fn gueltiger_trigger_202() {
        let app = super::super::router(super::super::test_state());
        let r = app.oneshot(post("/builds", Some("t"), r#"{"slug":"bayern"}"#)).await.unwrap();
        assert_eq!(r.status(), StatusCode::ACCEPTED);
    }
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service api_tests` → FAIL.

- [ ] **Step 3: Implementieren** (`api.rs` — `AppState` erweitern; `router` + Handler)

```rust
use axum::{extract::{State, Path}, http::{StatusCode, HeaderMap}, routing::{get, post}, Json, Router};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use crate::{jobs::{Registry, BuildJob}, regions, build::BuildRunner, storage::{Storage, FakeStorage}, manifest::PublishedVersion};

#[derive(Clone)]
pub struct AppState {
    pub token: String,
    pub registry: Registry,
    pub storage: Arc<dyn Storage>,
    pub runner: Arc<dyn BuildRunner>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
}
#[derive(Deserialize)] struct BuildReq { slug: String }

fn auth(h:&HeaderMap, token:&str) -> bool {
    !token.is_empty() && h.get("authorization").and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ")) == Some(token)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/builds", post(trigger).get(liste))
        .route("/builds/{id}", get(einzeln))
        .with_state(state)
}

async fn trigger(State(st):State<AppState>, headers:HeaderMap, Json(req):Json<BuildReq>) -> (StatusCode, Json<serde_json::Value>) {
    if !auth(&headers, &st.token) { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"unauthorized"}))); }
    let Some(reg) = regions::finde(&req.slug) else {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":"unbekannter slug"}))); };
    match st.registry.enqueue(reg.slug) {   // NICHT spawnen — der Worker fährt
        Ok(id) => (StatusCode::ACCEPTED, Json(serde_json::json!({"job_id": id}))),
        Err(_) => (StatusCode::CONFLICT, Json(serde_json::json!({"error":"queue voll"}))),
    }
}
async fn liste(State(st):State<AppState>, headers:HeaderMap) -> Result<Json<Vec<BuildJob>>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    Ok(Json(st.registry.alle()))
}
async fn einzeln(State(st):State<AppState>, headers:HeaderMap, Path(id):Path<u64>) -> Result<Json<BuildJob>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    st.registry.get(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

#[cfg(test)]
pub fn test_state() -> AppState {
    AppState { token:"t".into(), registry:Registry::neu(4),
        storage:Arc::new(FakeStorage::neu("https://cdn.example/maps")),
        runner:Arc::new(TestRunner), bestand:Arc::new(Mutex::new(Vec::new())) }
}
#[cfg(test)]
struct TestRunner;
#[cfg(test)]
#[async_trait::async_trait]
impl BuildRunner for TestRunner {
    async fn baue(&self, _a:&str)->anyhow::Result<crate::build::BuildArtefakt> {
        anyhow::bail!("test runner baut nicht") // API-Tests brauchen keinen echten Bau
    }
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service api_tests` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/api.rs
git commit -m "feat(lfh-201): /builds-API (Bearer-Auth, enqueue-only Trigger, Status)"
```

---

## Task 13: `serve`/`build`-CLI (Seed + Worker verdrahten) + Bremen-Smoke — **echter Host**

**Files:** Modify `karten-service/src/main.rs`; Create `karten-service/tests/smoke_bremen.rs`.

**Interfaces:**
- Produces: `karten-service serve` (seedet bestand, startet Worker + Scheduler + API), `karten-service build --slug <x>` / `--all` (baut ohne HTTP).

- [ ] **Step 1: `serve`/`build`-Verdrahtung** — clap-Subkommandos; `serve` baut den `AppState`
(S3Storage/MakeRunner aus Config), **seedet `bestand = build::seed_bestand(&storage).await`**, spawnt
`worker::run(worker_state)`, startet `scheduler::starte(&cfg.schedule, || für alle regions::alle()
registry.enqueue(slug))`, dann `axum::serve`. `build --slug/--all` baut lokal ohne Server (Registry
+ `fahre_build` je Slug). Kein Persist-Reset nötig (in-memory).

```rust
// main.rs (Skizze der serve-Verdrahtung; exakte clap-Subcommand-Struktur im Bestandsstil)
let storage: std::sync::Arc<dyn Storage> = std::sync::Arc::new(S3Storage::neu(&cfg.storage_bucket, &cfg.base_url)?);
let runner: std::sync::Arc<dyn BuildRunner> = std::sync::Arc::new(MakeRunner { karten_build_dir: cfg.karten_build_dir.clone() });
let registry = Registry::neu(regions::alle().len());
let bestand = std::sync::Arc::new(std::sync::Mutex::new(build::seed_bestand(storage.as_ref()).await));
let ws = worker::WorkerState { registry: registry.clone(), runner: runner.clone(), storage: storage.clone(), bestand: bestand.clone() };
tokio::spawn(worker::run(ws));
let reg_for_cron = registry.clone();
let _sched = scheduler::starte(&cfg.schedule, move || { for r in regions::alle() { let _ = reg_for_cron.enqueue(r.slug); } }).await?;
let state = api::AppState { token: cfg.token.clone(), registry, storage, runner, bestand };
axum::serve(listener, api::router(state)).await?;
```

- [ ] **Step 2: Bremen-Smoke (ignored)** — `karten-service/tests/smoke_bremen.rs`:

```rust
// NUR auf einem Host mit Docker + versatiles-Image + Netz.
// `cargo test -p karten-service --test smoke_bremen -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn baut_bremen_und_bounds_passen() {
    use karten_service::build::{make_runner::MakeRunner, BuildRunner, validate};
    let runner = MakeRunner { karten_build_dir: "karten-build".into() };
    let art = runner.baue("bremen").await.expect("Bremen-Bau");
    assert_eq!(art.sha256.len(), 64);
    assert!(art.datei.exists());
    assert!(validate::bounds_passen(art.bounds, validate::erwartete_box("DE").unwrap()),
            "Bremen-bounds in DE-Box: {:?}", art.bounds);
}
```

- [ ] **Step 3: Gates** — Run (überall): `cargo test -p karten-service` (alle Unit-Tests grün).
Run (echter Host): `cargo test -p karten-service --test smoke_bremen -- --ignored --nocapture`.
Expected: Unit-Tests PASS; Smoke PASS auf dem Docker-Host.

- [ ] **Step 4: Commit**

```bash
git add karten-service/src/main.rs karten-service/tests/smoke_bremen.rs
git commit -m "feat(lfh-201): serve/build-CLI (Seed+Worker+Scheduler) + Bremen-Smoke (ignored)"
```

---

## Self-Review

**Spec-Coverage:** §A.1 Katalog-Def → Task 3; §A.2 Build-Runner (seriell, validate, gestreamter
sha256) → Tasks 6/8/9 + Guard 5/11; §A.3 Publisher/Storage (gestreamt) → Task 7; §A.4 Manifest (voll,
atomar) → Tasks 4/10; **Startup-Seed (Manifest-Vollständigkeit über Neustart) → Task 10/13**; §A.5
Scheduler in-service + **serieller Worker-Drain** → Task 11; §A.6 API+Auth (enqueue-only) → Task 12;
§A.7 Nebenläufigkeit/Fehler/in-memory → Tasks 5/10/11/12; Manifest-Vertrag/geteilte Struct → Task 1;
Versionierung (datierte URL) → Task 4. **Nicht in Plan A** (bewusst): lifeline-hub-Config/
Proxy-Trigger/Admin-UI (Komponente B → Plan B); DACH-Merge, Retention/GC, Build-Abbruch (YAGNI).

**Placeholder-Scan:** keine „TBD/TODO/implement later". Infra-Tasks (9, 13) enthalten echten Code +
exakte Kommandos, klar als „echter Host" markiert (Unit-Fläche bleibt grün).

**Typ-Konsistenz:** `OfflineKatalogEintrag` (Task 1) durchgängig; `PublishedVersion{slug,url,groesse:i64,sha256}`
(Task 4, Clone) in 8/10/11/12; `BuildArtefakt{datei:PathBuf,sha256,bounds}` (Task 8) in 9/10/11/13;
`Storage::{put_datei(&Path),put_bytes,get_bytes,public_url}` (Task 7) stabil in 8/10/13;
`BuildRunner::baue(&self,geofabrik_area)` (Task 8) in 9/11/12/13; `Registry`-Signaturen inkl.
`naechster_queued` (Task 5) in 11; `WorkerState`/`tick` (Task 11) in 13.

## Offene Umsetzungs-Details (dem Umsetzer überlassen, Nicht-Blocker)

- Exakte `object_store`-0.11-Multipart-API (`put_multipart`/`put_part`/`complete`) + R2-Endpoint-ENV
  (Task 7) gegen die Crate-Doc verifizieren; ggf. `bytes`-Konvertierung anpassen.
- `tokio-cron-scheduler`-Version + 6-Feld-Cron-Semantik (Task 2/11) beim Verdrahten prüfen.
- Queue-Cap-Politik bei paralleler On-demand-Flut (Task 5/12): `offene_cap = regions::alle().len()`
  ist ein sinnvoller Default (max. je Region ein offener Job).
```
