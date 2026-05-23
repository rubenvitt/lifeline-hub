# Backend-Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine lauffähige Rust/Axum-Binary mit eingebettetem SQLite (WAL), Migrationen, konfigurierbarem Bind/DB-Pfad und einem Health-Check-Endpoint als Fundament für alle weiteren Module von lifeline-hub.

**Architecture:** Ein Cargo-Crate mit Lib- + Bin-Target. Die Lib (`lifeline_hub`) kapselt Config, DB-Pool, Router und Routen; die Binary verdrahtet alles und startet den Server mit Graceful Shutdown. SQLite wird über sqlx mit WAL-Modus, `create_if_missing` und aktivierten Foreign Keys angebunden; Schema-Migrationen werden beim Start eingespielt.

**Tech Stack:** Rust (Edition 2021), Axum 0.8, Tokio, sqlx 0.8 (SQLite + migrate), clap 4 (CLI/ENV), tracing, anyhow. Tests: `tower::ServiceExt::oneshot` + `tempfile`.

---

## Plan-Hinweise

- **Commits:** Jede Commit-Nachricht endet mit der Zeile `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (Repo-Konvention). In den Schritten unten der Kürze halber weggelassen.
- **Branch:** Vor Beginn einen Feature-Branch anlegen (z.B. `feat/backend-fundament`), nicht direkt auf `main` arbeiten.
- **Reihenfolge:** Tasks sind so geordnet, dass jeder Schritt kompiliert. Module werden erst in `lib.rs` eingetragen, wenn sie existieren.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `Cargo.toml` | Paket-Metadaten, Abhängigkeiten, Lib+Bin-Target |
| `src/lib.rs` | Re-Export der Module (`config`, `db`, `app`, `routes`) |
| `src/main.rs` | Binary: Config laden, Tracing, Pool+Migration, Server starten, Graceful Shutdown |
| `src/config.rs` | `Config`-Struct + Parsing aus CLI-Flags/ENV (clap) |
| `src/db.rs` | Pool-Erstellung (WAL, FK, create_if_missing), Migrationen, In-Memory-Test-Pool |
| `src/app.rs` | `AppState` + `build_router()` |
| `src/routes/mod.rs` | Routen-Modul-Sammlung |
| `src/routes/health.rs` | Health-Check-Handler |
| `migrations/0001_init.sql` | Erste Migration: `app_meta`-Tabelle |
| `tests/health.rs` | Integrationstest für `GET /api/health` |

---

## Task 1: Cargo-Projekt & Abhängigkeiten

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`
- Create: `src/lib.rs`

- [ ] **Step 1: Cargo.toml anlegen**

```toml
[package]
name = "lifeline-hub"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "migrate"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
clap = { version = "4", features = ["derive", "env"] }
anyhow = "1"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
tempfile = "3"
```

- [ ] **Step 2: Minimale `src/lib.rs` anlegen**

```rust
// Module werden in den folgenden Tasks ergänzt.
```

- [ ] **Step 3: Minimale `src/main.rs` anlegen**

```rust
fn main() {
    println!("lifeline-hub");
}
```

- [ ] **Step 4: Build verifizieren**

Run: `cargo build`
Expected: Kompiliert ohne Fehler (lädt beim ersten Mal alle Abhängigkeiten herunter).

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock src/main.rs src/lib.rs
git commit -m "chore: Cargo-Projekt mit Backend-Abhängigkeiten initialisieren"
```

---

## Task 2: Config (CLI/ENV)

**Files:**
- Create: `src/config.rs`
- Modify: `src/lib.rs`
- Test: in `src/config.rs` (Unit-Test)

- [ ] **Step 1: Failing Test schreiben** — `src/config.rs`

```rust
use clap::Parser;

/// Laufzeit-Konfiguration für den lifeline-hub-Server.
#[derive(Parser, Debug, Clone)]
#[command(version, about = "lifeline-hub Server")]
pub struct Config {
    /// Pfad zur SQLite-Datenbankdatei.
    #[arg(long, env = "LIFELINE_DB_PATH", default_value = "lifeline.db")]
    pub db_path: String,

    /// Adresse, auf der der Server lauscht (Host:Port).
    #[arg(long, env = "LIFELINE_BIND", default_value = "127.0.0.1:8080")]
    pub bind: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_applied() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert_eq!(config.db_path, "lifeline.db");
        assert_eq!(config.bind, "127.0.0.1:8080");
    }

    #[test]
    fn cli_flags_override_defaults() {
        let config = Config::parse_from(["lifeline-hub", "--bind", "0.0.0.0:9000"]);
        assert_eq!(config.bind, "0.0.0.0:9000");
    }
}
```

- [ ] **Step 2: Modul in `lib.rs` eintragen** — `src/lib.rs`

```rust
pub mod config;
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib config`
Expected: PASS (`defaults_are_applied`, `cli_flags_override_defaults`)

> Hinweis: Da `Config` selbst die Implementierung ist, sind Definition und Test in einem Schritt. Der Test prüft, dass clap die Defaults/Overrides korrekt anwendet.

- [ ] **Step 4: Commit**

```bash
git add src/config.rs src/lib.rs
git commit -m "feat: Config aus CLI-Flags und Umgebungsvariablen"
```

---

## Task 3: DB-Pool mit WAL & Foreign Keys

**Files:**
- Create: `src/db.rs`
- Modify: `src/lib.rs`
- Test: in `src/db.rs` (Unit-Test)

- [ ] **Step 1: Failing Test + `connect` schreiben** — `src/db.rs`

```rust
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

/// Öffnet einen SQLite-Pool auf der angegebenen Datei.
/// Aktiviert WAL-Journal, Foreign Keys und legt die Datei bei Bedarf an.
pub async fn connect(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[tokio::test]
    async fn connect_enables_wal_and_foreign_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        let journal: String = sqlx::query("PRAGMA journal_mode;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(journal.to_lowercase(), "wal");

        let foreign_keys: i64 = sqlx::query("PRAGMA foreign_keys;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(foreign_keys, 1);
    }
}
```

- [ ] **Step 2: Modul in `lib.rs` eintragen** — `src/lib.rs`

```rust
pub mod config;
pub mod db;
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib db::tests::connect_enables_wal_and_foreign_keys`
Expected: PASS — bestätigt WAL-Modus und aktivierte Foreign Keys auf einer echten Datei.

- [ ] **Step 4: Commit**

```bash
git add src/db.rs src/lib.rs
git commit -m "feat: SQLite-Pool mit WAL-Modus und Foreign Keys"
```

---

## Task 4: Migrationen + In-Memory-Test-Pool

**Files:**
- Create: `migrations/0001_init.sql`
- Modify: `src/db.rs`
- Test: in `src/db.rs` (Unit-Test)

- [ ] **Step 1: Erste Migration anlegen** — `migrations/0001_init.sql`

```sql
-- Schlüssel/Wert-Tabelle für Schema-/App-Metadaten.
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('schema_initialized', '1');
```

- [ ] **Step 2: `migrate` + `test_pool` + Test ergänzen** — am Ende von `src/db.rs` (vor dem `#[cfg(test)]`-Block) einfügen:

```rust
/// Spielt alle eingebetteten Migrationen aus `./migrations` ein.
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// In-Memory-Pool für Tests (eine Verbindung, damit dieselbe DB geteilt wird),
/// inklusive eingespielter Migrationen.
pub async fn test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(":memory:")
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("In-Memory-Pool");

    migrate(&pool).await.expect("Migrationen einspielen");
    pool
}
```

Und im `#[cfg(test)] mod tests`-Block diesen Test ergänzen:

```rust
    #[tokio::test]
    async fn migrations_create_app_meta() {
        let pool = test_pool().await;
        let value: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_initialized'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(value, "1");
    }
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib db::tests::migrations_create_app_meta`
Expected: PASS — die Migration wurde eingespielt und `app_meta` enthält den erwarteten Wert.

> Hinweis: `sqlx::migrate!("./migrations")` ist ein Compile-Time-Makro; das Verzeichnis muss existieren (Step 1 stellt das sicher), sonst schlägt bereits `cargo build` fehl.

- [ ] **Step 4: Commit**

```bash
git add migrations/0001_init.sql src/db.rs
git commit -m "feat: Migrationen einspielen und In-Memory-Test-Pool"
```

---

## Task 5: AppState, Router & Health-Endpoint

**Files:**
- Create: `src/app.rs`
- Create: `src/routes/mod.rs`
- Create: `src/routes/health.rs`
- Modify: `src/lib.rs`
- Test: `tests/health.rs` (Integrationstest)

- [ ] **Step 1: Health-Handler schreiben** — `src/routes/health.rs`

```rust
use crate::app::AppState;
use axum::{extract::State, Json};
use serde_json::{json, Value};

/// Health-Check: prüft DB-Konnektivität und liefert Status + Version.
pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map(|v| v == 1)
        .unwrap_or(false);

    Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "db": db_ok,
    }))
}
```

- [ ] **Step 2: Routen-Modul anlegen** — `src/routes/mod.rs`

```rust
pub mod health;
```

- [ ] **Step 3: AppState + Router schreiben** — `src/app.rs`

```rust
use crate::routes;
use axum::{routing::get, Router};
use sqlx::SqlitePool;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(routes::health::health))
        .with_state(state)
}
```

- [ ] **Step 4: Module in `lib.rs` eintragen** — `src/lib.rs`

```rust
pub mod app;
pub mod config;
pub mod db;
pub mod routes;
```

- [ ] **Step 5: Failing-Integrationstest schreiben** — `tests/health.rs`

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use tower::ServiceExt; // stellt `oneshot` bereit

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let pool = db::test_pool().await;
    let app = build_router(AppState { pool });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["status"], "ok");
    assert_eq!(json["db"], true);
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 6: Test ausführen (soll bestehen)**

Run: `cargo test --test health`
Expected: PASS — der Router antwortet auf `GET /api/health` mit `200` und korrektem JSON.

- [ ] **Step 7: Commit**

```bash
git add src/app.rs src/routes/ src/lib.rs tests/health.rs
git commit -m "feat: AppState, Router und Health-Endpoint"
```

---

## Task 6: Binary verdrahten & Server starten

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: `main.rs` vollständig schreiben** — `src/main.rs`

```rust
use clap::Parser;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::config::Config;
use lifeline_hub::db;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::parse();
    tracing::info!(?config, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    let app = build_router(AppState { pool });

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!("Server lauscht auf {}", config.bind);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Wartet auf Ctrl+C für einen sauberen Shutdown.
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Ctrl+C-Handler installieren");
    tracing::info!("Shutdown-Signal empfangen, fahre herunter");
}
```

- [ ] **Step 2: Build verifizieren**

Run: `cargo build`
Expected: Kompiliert ohne Fehler.

- [ ] **Step 3: Smoke-Test (manuell)**

Server starten (legt `lifeline.db` an):

Run: `cargo run`
Expected (Logausgabe): `Starte lifeline-hub …` und `Server lauscht auf 127.0.0.1:8080`.

In einem zweiten Terminal:

Run: `curl -s http://127.0.0.1:8080/api/health`
Expected: `{"db":true,"status":"ok","version":"0.1.0"}`

Server mit `Ctrl+C` beenden — Erwartung: Log `Shutdown-Signal empfangen, fahre herunter`, sauberer Exit.

- [ ] **Step 4: Lokale DB-Artefakte ignorieren** — sicherstellen, dass `.gitignore` SQLite-Dateien ausschließt. Falls nicht vorhanden, ergänzen:

```gitignore
# Lokale SQLite-Datenbanken
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 5: Gesamten Testlauf verifizieren**

Run: `cargo test`
Expected: Alle Tests (config, db, health) PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.rs .gitignore
git commit -m "feat: Server-Binary mit Migration und Graceful Shutdown"
```

---

## Self-Review (durchgeführt)

**1. Spec-Abdeckung (Plan 1 = Backend-Fundament):**
- Single-Binary Rust/Axum → Task 1, 6 ✓
- SQLite WAL-Modus → Task 3 ✓
- Migrationen → Task 4 ✓
- Konfigurierbarer Port/DB-Pfad (Bind-Adresse) → Task 2, 6 ✓
- Health-Check / DB-Konnektivität → Task 5 ✓
- (Auth, Einsatz, ETB, Backup/Restore, Frontend-Embedding gehören bewusst zu den Plänen 2–6.)

**2. Placeholder-Scan:** Keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code, jeder Test-Schritt eine konkrete Assertion.

**3. Typ-Konsistenz:** `Config` (Felder `db_path`, `bind`), `connect(&str)`, `migrate(&SqlitePool)`, `test_pool()`, `AppState { pool }`, `build_router(AppState)`, `health(State<AppState>)` werden über alle Tasks identisch verwendet. Crate-Name `lifeline_hub` (aus Paket `lifeline-hub`) im Integrationstest korrekt.

---

## Nächste Pläne (Kontext)

Plan 2 (Auth & Benutzer/Org) setzt auf diesem Fundament auf: führt ein `error`-Modul (zentraler `AppError` mit `IntoResponse`), Argon2-Passwort-Hashing, Sessions und Migrationen für `organisation`/`benutzer` ein. Die Pläne 3–6 folgen gemäß Spec-Sequenz.
