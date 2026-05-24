# Backup/Restore + Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine selbst-hostbare Single-Binary, die das gebaute React-Frontend einbettet und ausliefert, plus eingebautes Hot-Backup (konsistente SQLite-Sicherung im laufenden Einsatz) und einen einfachen Restore-Pfad.

**Architecture:** Backup nutzt SQLite `VACUUM INTO`, das im WAL-Modus auch unter Schreiblast eine konsistente Kopie als einzelne `.sqlite`-Datei erzeugt. Der Admin lädt diese Sicherung per HTTP-Download (`GET /api/backup`, admin-only) herunter — funktioniert sowohl lokal (Browser im LAN, Speichern auf USB) als auch in der Cloud. Zusätzlich erlaubt die Binary die Subkommandos `backup` und `restore` für skript-/cron-gesteuerten Offline-Betrieb. Das Frontend wird mit `rust-embed` zur Compile-Zeit (Release) in die Binary eingebettet und über einen Fallback-Handler mit korrekten Content-Type- und Cache-Headern und SPA-Fallback ausgeliefert.

**Tech Stack:** Rust + Axum 0.8 + sqlx 0.8 (SQLite, WAL), clap 4 (Subcommands), rust-embed (Frontend-Embedding), tempfile (Backup-Zwischendatei). Frontend: Vite-Build nach `frontend/dist`.

---

## Designentscheidungen (vorab festgeklopft)

- **Backup-Endpoint = `GET /api/backup` (Download), admin-only.** GET ist im Browser direkt klickbar (Link → „Speichern unter" auf USB). Das Backup ist aus DB-Sicht nicht-mutierend (`VACUUM INTO` erzeugt eine Kopie, ändert die Quell-DB nicht) — die GET-Semantik ist daher vertretbar. Server-seitiges Schreiben in ein konfiguriertes `--backup-dir` ist als spätere Erweiterung machbar, aber **nicht** Teil dieses Plans (Download deckt Cloud- und Lokal-Szenario ab).
- **`VACUUM INTO` ohne Parameter-Binding.** SQLite akzeptiert keinen `?`-Platzhalter für den Zieldateinamen. Der Pfad wird per `format!` eingesetzt, Single Quotes werden verdoppelt (SQL-String-Escape). Der Zielpfad ist **immer server-kontrolliert** (Tempfile bzw. CLI-Argument), nie direkt aus einem Client-Request.
- **Restore-CLI bleibt dünn.** Die Spec (§14) sieht primär einen *dokumentierten* Restore-Pfad vor. Wir liefern zusätzlich ein minimales `restore`-Subkommando (Sicherung validieren → DB-Datei ersetzen → stale `-wal`/`-shm` entfernen), weil das den fehleranfälligsten Teil (vergessene WAL-Seitendateien) zuverlässig erledigt. Der manuelle Pfad wird trotzdem dokumentiert.
- **Frontend-Embedding via `rust-embed`.** Release-Build bettet `frontend/dist` ein; Debug-Build liest zur Laufzeit vom Dateisystem. Der Ordner `frontend/dist` muss zur Compile-Zeit existieren — daher wird `frontend/dist/.gitkeep` committet (per `.gitignore`-Negation), damit ein frischer Clone kompiliert. Die Auslieferungs-Logik (Content-Type, Cache, SPA-Fallback) ist über einen injizierbaren Getter unit-testbar und hängt **nicht** von tatsächlich gebauten Assets ab.

---

## File Structure

- `src/backup/mod.rs` — **neu.** Backup-Kern: `vacuum_into()`. Verantwortung: konsistente SQLite-Kopie erzeugen.
- `src/backup/restore.rs` — **neu.** Restore-Kern: `restore_aus_datei()`. Verantwortung: Sicherung validieren und an Stelle der DB einspielen.
- `src/routes/backup.rs` — **neu.** HTTP-Handler `GET /api/backup` (admin-only, Download).
- `src/static_files.rs` — **neu.** Frontend-Auslieferung: `Asset`-Embed + `statische_antwort()` (Content-Type, Cache, SPA-Fallback) + `serve()`-Handler.
- `src/config.rs` — **ändern.** Subkommandos `backup`/`restore` ergänzen; Server-Felder bleiben.
- `src/main.rs` — **ändern.** Subkommando-Dispatch; Server-Lauf in `run_server()` extrahieren.
- `src/app.rs` — **ändern.** Backup-Route + statischer Fallback-Handler.
- `src/lib.rs` — **ändern.** Module `backup`, `static_files` registrieren.
- `src/routes/mod.rs` — **ändern.** Modul `backup` registrieren.
- `Cargo.toml` — **ändern.** Deps `rust-embed`, `tempfile` (von dev zu regulär).
- `.gitignore` — **ändern.** `frontend/dist/.gitkeep` von der Ignore-Regel ausnehmen.
- `frontend/dist/.gitkeep` — **neu.** Stellt sicher, dass der Embed-Ordner zur Compile-Zeit existiert.
- `tests/backup.rs` — **neu.** Integrationstests für `GET /api/backup`.
- `scripts/build-release.sh` — **neu.** Frontend bauen → Backend-Release bauen → Single-Binary.
- `docs/betrieb/backup-restore.md` — **neu.** Operator-Doku: Sicherung & Wiederherstellung.
- `docs/betrieb/packaging.md` — **neu.** Operator-Doku: Bauen & Betreiben der Binary.
- `docs/superpowers/PROGRESS.md` — **ändern.** Plan-6-Status auf DONE.

---

## Task 1: Backup-Kernfunktion (`vacuum_into`)

**Files:**
- Create: `src/backup/mod.rs`
- Modify: `src/lib.rs`

- [ ] **Step 1: Modul registrieren**

In `src/lib.rs` die Modulliste um `backup` ergänzen (alphabetisch nach `auth`):

```rust
pub mod app;
pub mod auth;
pub mod backup;
pub mod config;
pub mod db;
pub mod einsatz;
pub mod error;
pub mod etb;
pub mod live;
pub mod routes;
```

- [ ] **Step 2: Failing test schreiben**

`src/backup/mod.rs` neu anlegen mit Funktion (zunächst `todo!()`) und Tests:

```rust
use crate::error::AppError;
use sqlx::SqlitePool;
use std::path::Path;

/// Verdoppelt einfache Anführungszeichen, damit ein Pfad sicher als
/// SQL-String-Literal in `VACUUM INTO` eingesetzt werden kann.
/// (SQLite erlaubt für VACUUM INTO keinen Parameter-Bind.)
fn escape_sql_string(pfad: &str) -> String {
    pfad.replace('\'', "''")
}

/// Erzeugt eine konsistente Sicherungskopie der Datenbank in `ziel`.
///
/// Nutzt `VACUUM INTO`, das im WAL-Modus auch während laufender Schreibzugriffe
/// einen konsistenten Snapshot als einzelne Datei schreibt. `ziel` darf noch
/// nicht existieren (sonst schlägt VACUUM INTO fehl) und muss server-kontrolliert
/// sein — niemals ein direkt vom Client gelieferter Pfad.
///
/// Liefert die Größe der erzeugten Datei in Bytes.
pub async fn vacuum_into(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::SqlitePool;

    /// Öffnet eine Sicherungsdatei als eigenen Pool und liest sie.
    async fn oeffne_sicherung(pfad: &Path) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(pfad)
            .read_only(true);
        SqlitePool::connect_with(options).await.unwrap()
    }

    #[tokio::test]
    async fn sicherung_enthaelt_die_daten() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();

        let dir = tempfile::tempdir().unwrap();
        let ziel = dir.path().join("backup.sqlite");

        let groesse = vacuum_into(&pool, &ziel).await.unwrap();
        assert!(groesse > 0, "Sicherungsdatei muss Inhalt haben");
        assert!(ziel.exists());

        // Die ersten Bytes einer SQLite-Datei sind die Magic-Bytes.
        let bytes = std::fs::read(&ziel).unwrap();
        assert!(
            bytes.starts_with(b"SQLite format 3\0"),
            "Datei muss eine echte SQLite-Datenbank sein"
        );

        // Sicherung öffnen und Daten verifizieren.
        let backup_pool = oeffne_sicherung(&ziel).await;
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&backup_pool)
            .await
            .unwrap();
        assert_eq!(name, "Test-Orga");
    }

    #[tokio::test]
    async fn zielpfad_mit_anfuehrungszeichen_ist_sicher() {
        let pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        // Pfad mit Single Quote — darf nicht zu SQL-Injection/Fehler führen.
        let ziel = dir.path().join("o'brien-backup.sqlite");

        let groesse = vacuum_into(&pool, &ziel).await.unwrap();
        assert!(groesse > 0);
        assert!(ziel.exists());
    }

    #[test]
    fn escape_verdoppelt_single_quotes() {
        assert_eq!(escape_sql_string("a'b"), "a''b");
        assert_eq!(escape_sql_string("normal"), "normal");
    }
}
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib backup::tests`
Expected: FAIL — `todo!()` paniert in `sicherung_enthaelt_die_daten` und `zielpfad_mit_anfuehrungszeichen_ist_sicher`.

- [ ] **Step 4: `tempfile` als reguläre Dependency verfügbar machen**

In `Cargo.toml` `tempfile` aus `[dev-dependencies]` nach `[dependencies]` verschieben (der Backup-Endpoint in Task 2 braucht es zur Laufzeit). Ergebnis:

```toml
[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "migrate"] }
libsqlite3-sys = { version = "0.30", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
clap = { version = "4", features = ["derive", "env"] }
anyhow = "1"
argon2 = { version = "0.5", features = ["std"] }
chrono = { version = "0.4", default-features = false, features = ["clock"] }
axum-extra = { version = "0.10", features = ["cookie"] }
tokio-stream = { version = "0.1", features = ["sync"] }
tempfile = "3"

[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
```

- [ ] **Step 5: Implementierung schreiben**

In `src/backup/mod.rs` das `todo!()` ersetzen:

```rust
pub async fn vacuum_into(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError> {
    let ziel_str = ziel
        .to_str()
        .ok_or_else(|| AppError::Internal("Sicherungspfad ist kein gültiges UTF-8".into()))?;
    let sql = format!("VACUUM INTO '{}'", escape_sql_string(ziel_str));
    sqlx::query(&sql).execute(pool).await?;

    let groesse = std::fs::metadata(ziel)
        .map_err(|e| AppError::Internal(format!("Sicherungsdatei nicht lesbar: {e}")))?
        .len();
    Ok(groesse)
}
```

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `cargo test --lib backup::tests`
Expected: PASS (3 Tests).

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src/lib.rs src/backup/mod.rs
git commit -m "feat: Backup-Kernfunktion vacuum_into (konsistente SQLite-Sicherung)"
```

---

## Task 2: Backup-Download-Endpoint (`GET /api/backup`, admin-only)

**Files:**
- Create: `src/routes/backup.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Test: `tests/backup.rs`

- [ ] **Step 1: Modul registrieren**

In `src/routes/mod.rs` `backup` ergänzen (alphabetisch zuerst):

```rust
pub mod auth;
pub mod backup;
pub mod benutzer;
pub mod einsatz;
pub mod etb;
pub mod health;
```

- [ ] **Step 2: Failing-Integrationstest schreiben**

`tests/backup.rs` neu anlegen:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt;

/// Baut Router + DB mit Bootstrap-Admin (admin / startpw12) und einer Org.
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
    })
}

/// Loggt einen Benutzer ein und liefert den Session-Cookie-Wert.
async fn login(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    // Nur das "name=value"-Paar vor dem ersten ';' übernehmen.
    cookie.split(';').next().unwrap().to_string()
}

#[tokio::test]
async fn admin_kann_backup_herunterladen() {
    let app = setup().await;
    let cookie = login(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let disposition = resp
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(disposition.contains("attachment"));
    assert!(disposition.contains(".sqlite"));

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    assert!(
        bytes.starts_with(b"SQLite format 3\0"),
        "Download muss eine echte SQLite-Datenbank sein"
    );

    // Heruntergeladene Bytes in eine Datei schreiben, öffnen und Daten prüfen.
    let dir = tempfile::tempdir().unwrap();
    let pfad = dir.path().join("heruntergeladen.sqlite");
    std::fs::write(&pfad, &bytes).unwrap();
    let pool = lifeline_hub::backup::vacuum_open_readonly_fuer_test(&pfad).await;
    let admin_da: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(admin_da, 1, "Sicherung muss den Admin enthalten");
}

#[tokio::test]
async fn backup_ohne_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn backup_als_nicht_admin_ist_403() {
    let app = setup().await;

    // Admin legt einen Nicht-Admin-Benutzer an.
    let admin_cookie = login(&app, "admin", "startpw12").await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::COOKIE, &admin_cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"anzeigename":"Bea Obachter","benutzername":"bea","passwort":"passwort1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let bea_cookie = login(&app, "bea", "passwort1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/backup")
                .header(header::COOKIE, &bea_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
```

- [ ] **Step 3: Test-Hilfsfunktion zum Öffnen einer Sicherung bereitstellen**

Damit der Integrationstest die heruntergeladene Datei verifizieren kann, eine kleine, klar als Test-Helfer benannte Funktion in `src/backup/mod.rs` ergänzen (am Ende, vor `#[cfg(test)]`):

```rust
/// Öffnet eine Sicherungsdatei schreibgeschützt — für Verifikation in Tests.
pub async fn vacuum_open_readonly_fuer_test(pfad: &std::path::Path) -> SqlitePool {
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(pfad)
        .read_only(true);
    SqlitePool::connect_with(options)
        .await
        .expect("Sicherung öffnen")
}
```

- [ ] **Step 4: Handler schreiben**

`src/routes/backup.rs` neu anlegen:

```rust
use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::backup;
use crate::error::AppError;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::IntoResponse;
use chrono::Local;

/// GET /api/backup — konsistente Sicherung der Datenbank als Download. Admin-only.
///
/// Erzeugt per `VACUUM INTO` einen Snapshot in einer temporären Datei, liest ihn
/// vollständig ein und liefert ihn als Datei-Download. Das Tempverzeichnis wird
/// beim Verlassen der Funktion automatisch wieder entfernt.
pub async fn download(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let dir = tempfile::tempdir()
        .map_err(|e| AppError::Internal(format!("Tempverzeichnis fehlgeschlagen: {e}")))?;
    let pfad = dir.path().join("lifeline-backup.sqlite");

    backup::vacuum_into(&state.pool, &pfad).await?;

    let bytes = std::fs::read(&pfad)
        .map_err(|e| AppError::Internal(format!("Sicherung lesen fehlgeschlagen: {e}")))?;

    let dateiname = format!("lifeline-backup-{}.sqlite", Local::now().format("%Y%m%d-%H%M%S"));
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{dateiname}\""))
            .map_err(|e| AppError::Internal(format!("Ungültiger Dateiname: {e}")))?,
    );

    Ok((headers, bytes))
}
```

- [ ] **Step 5: Route registrieren**

In `src/app.rs` die Route innerhalb von `build_router` ergänzen (z.B. direkt nach der `/api/health`-Route). Der `get`-Import ist bereits vorhanden:

```rust
        .route("/api/health", get(routes::health::health))
        .route("/api/backup", get(routes::backup::download))
```

- [ ] **Step 6: Tests ausführen — müssen bestehen**

Run: `cargo test --test backup`
Expected: PASS (3 Tests: Download, 401, 403).

- [ ] **Step 7: Commit**

```bash
git add src/routes/mod.rs src/routes/backup.rs src/app.rs src/backup/mod.rs
git commit -m "feat: GET /api/backup — admin-only Hot-Backup-Download"
```

---

## Task 3: Restore-Kernfunktion (`restore_aus_datei`)

**Files:**
- Create: `src/backup/restore.rs`
- Modify: `src/backup/mod.rs`

- [ ] **Step 1: Submodul registrieren**

In `src/backup/mod.rs` ganz oben ergänzen:

```rust
pub mod restore;
```

- [ ] **Step 2: Failing test schreiben**

`src/backup/restore.rs` neu anlegen:

```rust
use crate::error::AppError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::path::Path;

/// Prüft, ob `quelle` eine gültige lifeline-hub-Sicherung ist (öffnet die Datei
/// und liest den `app_meta`-Initialisierungsmarker).
async fn ist_gueltige_sicherung(quelle: &Path) -> Result<bool, AppError> {
    let options = SqliteConnectOptions::new().filename(quelle).read_only(true);
    let pool = match SqlitePool::connect_with(options).await {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    let marker: Result<String, _> =
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_initialized'")
            .fetch_one(&pool)
            .await;
    pool.close().await;
    Ok(matches!(marker, Ok(v) if v == "1"))
}

/// Spielt die Sicherung `quelle` an die Stelle der Datenbank `ziel` ein.
///
/// Validiert zuerst, dass `quelle` eine echte lifeline-hub-Sicherung ist, und
/// entfernt vor dem Kopieren etwaige stale WAL-/SHM-Seitendateien (`-wal`/`-shm`),
/// damit die ältere DB nicht mit neuem WAL-Inhalt vermischt wird.
///
/// **Voraussetzung:** Der Server darf nicht laufen (keine offene Verbindung auf `ziel`).
pub async fn restore_aus_datei(quelle: &Path, ziel: &Path) -> Result<(), AppError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn restore_stellt_daten_wieder_her() {
        // 1. Quell-DB mit Daten anlegen und per vacuum_into sichern.
        let quell_pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Wiederhergestellt')")
            .execute(&quell_pool)
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();

        // 2. Restore in einen frischen Zielpfad.
        let ziel = dir.path().join("wiederhergestellt.db");
        restore_aus_datei(&sicherung, &ziel).await.unwrap();

        // 3. Ziel öffnen und Daten prüfen.
        let pool = crate::db::connect(ziel.to_str().unwrap()).await.unwrap();
        let name: String = sqlx::query_scalar("SELECT name FROM organisation WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Wiederhergestellt");
    }

    #[tokio::test]
    async fn restore_entfernt_stale_wal_und_shm() {
        let quell_pool = crate::db::test_pool().await;
        let dir = tempfile::tempdir().unwrap();
        let sicherung = dir.path().join("sicherung.sqlite");
        crate::backup::vacuum_into(&quell_pool, &sicherung)
            .await
            .unwrap();

        // Ziel mit veralteter DB + stale -wal/-shm vorbereiten.
        let ziel = dir.path().join("alt.db");
        std::fs::write(&ziel, b"alt").unwrap();
        let wal = dir.path().join("alt.db-wal");
        let shm = dir.path().join("alt.db-shm");
        std::fs::write(&wal, b"stale").unwrap();
        std::fs::write(&shm, b"stale").unwrap();

        restore_aus_datei(&sicherung, &ziel).await.unwrap();

        assert!(!wal.exists(), "stale -wal muss entfernt sein");
        assert!(!shm.exists(), "stale -shm muss entfernt sein");
    }

    #[tokio::test]
    async fn ungueltige_quelle_wird_abgelehnt() {
        let dir = tempfile::tempdir().unwrap();
        let kaputt = dir.path().join("kaputt.sqlite");
        std::fs::write(&kaputt, b"kein gueltiges sqlite").unwrap();
        let ziel = dir.path().join("ziel.db");

        let err = restore_aus_datei(&kaputt, &ziel).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(!ziel.exists(), "Ziel darf bei ungültiger Quelle nicht entstehen");
    }
}
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib backup::restore`
Expected: FAIL — `todo!()` paniert.

- [ ] **Step 4: Implementierung schreiben**

In `src/backup/restore.rs` das `todo!()` ersetzen:

```rust
pub async fn restore_aus_datei(quelle: &Path, ziel: &Path) -> Result<(), AppError> {
    if !quelle.exists() {
        return Err(AppError::Validation(format!(
            "Sicherungsdatei nicht gefunden: {}",
            quelle.display()
        )));
    }
    if !ist_gueltige_sicherung(quelle).await? {
        return Err(AppError::Validation(
            "Datei ist keine gültige lifeline-hub-Sicherung".into(),
        ));
    }

    // Stale WAL-/SHM-Seitendateien des Ziels entfernen (sonst Vermischung).
    for endung in ["-wal", "-shm"] {
        let mut p = ziel.as_os_str().to_owned();
        p.push(endung);
        let nebendatei = std::path::PathBuf::from(p);
        if nebendatei.exists() {
            std::fs::remove_file(&nebendatei)
                .map_err(|e| AppError::Internal(format!("Konnte {nebendatei:?} nicht entfernen: {e}")))?;
        }
    }

    std::fs::copy(quelle, ziel)
        .map_err(|e| AppError::Internal(format!("Kopieren der Sicherung fehlgeschlagen: {e}")))?;
    Ok(())
}
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --lib backup::restore`
Expected: PASS (3 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/backup/mod.rs src/backup/restore.rs
git commit -m "feat: Restore-Kernfunktion (Sicherung validieren und einspielen)"
```

---

## Task 4: CLI-Subkommandos `backup` und `restore`

**Files:**
- Modify: `src/config.rs`, `src/main.rs`

- [ ] **Step 1: Failing test für Subkommando-Parsing schreiben**

In `src/config.rs` im `#[cfg(test)] mod tests`-Block diese Tests ergänzen:

```rust
    #[test]
    fn ohne_subkommando_ist_kein_command() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert!(config.command.is_none());
    }

    #[test]
    fn backup_subkommando_wird_geparst() {
        let config = Config::parse_from(["lifeline-hub", "backup", "--out", "/mnt/usb/b.sqlite"]);
        match config.command {
            Some(Command::Backup { out }) => assert_eq!(out, "/mnt/usb/b.sqlite"),
            andere => panic!("erwartete Backup, fand {andere:?}"),
        }
    }

    #[test]
    fn restore_subkommando_mit_force_wird_geparst() {
        let config =
            Config::parse_from(["lifeline-hub", "restore", "--from", "/mnt/usb/b.sqlite", "--force"]);
        match config.command {
            Some(Command::Restore { from, force }) => {
                assert_eq!(from, "/mnt/usb/b.sqlite");
                assert!(force);
            }
            andere => panic!("erwartete Restore, fand {andere:?}"),
        }
    }

    #[test]
    fn server_flags_funktionieren_weiter_mit_subkommando() {
        let config = Config::parse_from([
            "lifeline-hub", "--db-path", "/tmp/x.db", "backup", "--out", "/tmp/b.sqlite",
        ]);
        assert_eq!(config.db_path, "/tmp/x.db");
        assert!(matches!(config.command, Some(Command::Backup { .. })));
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen (Kompilierfehler)**

Run: `cargo test --lib config::tests`
Expected: FAIL — `Command` und `config.command` existieren noch nicht.

- [ ] **Step 3: `Command`-Enum und Feld ergänzen**

In `src/config.rs` den `use`-Block und die `Config`-Struct erweitern. Oben:

```rust
use clap::{Parser, Subcommand};
```

Das `command`-Feld am Ende der `Config`-Struct (nach `admin_password`) ergänzen:

```rust
    /// Optionales Subkommando. Ohne Subkommando wird der Server gestartet.
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Subkommandos der lifeline-hub-Binary (neben dem Server-Standardlauf).
#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Konsistente Sicherung der Datenbank erstellen (auch im laufenden Betrieb).
    Backup {
        /// Zielpfad der Sicherungsdatei (darf noch nicht existieren).
        #[arg(long)]
        out: String,
    },
    /// Sicherung zurückspielen — ersetzt die aktuelle Datenbank.
    Restore {
        /// Pfad zur Sicherungsdatei.
        #[arg(long)]
        from: String,
        /// Ohne Rückfrage überschreiben.
        #[arg(long)]
        force: bool,
    },
}
```

Hinweis: Der bestehende `use clap::Parser;` am Dateianfang wird durch die `use clap::{Parser, Subcommand};`-Zeile ersetzt.

- [ ] **Step 4: Tests ausführen — müssen bestehen**

Run: `cargo test --lib config::tests`
Expected: PASS (alle bestehenden + 4 neue Tests).

- [ ] **Step 5: `main.rs` auf Subkommando-Dispatch umbauen**

`src/main.rs` vollständig ersetzen:

```rust
use clap::Parser;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::backup;
use lifeline_hub::config::{Command, Config};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use std::path::Path;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::parse();

    match config.command.clone() {
        Some(Command::Backup { out }) => cmd_backup(&config.db_path, &out).await,
        Some(Command::Restore { from, force }) => cmd_restore(&config.db_path, &from, force).await,
        None => run_server(config).await,
    }
}

/// Startet den HTTP-Server (Standardlauf ohne Subkommando).
async fn run_server(config: Config) -> anyhow::Result<()> {
    tracing::info!(db_path = %config.db_path, bind = %config.bind, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    let ergebnis = lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        &config.org_name,
        &config.admin_user,
        config.admin_password.as_ref().map(|p| p.als_str()),
    )
    .await?;
    if ergebnis.admin_angelegt {
        tracing::info!("Admin-Konto '{}' angelegt", config.admin_user);
        if let Some(pw) = &ergebnis.generiertes_passwort {
            tracing::warn!(
                "Initiales Admin-Passwort (bitte sicher notieren und nach Login ändern): {pw}"
            );
        }
    }

    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
    });

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!("Server lauscht auf {}", config.bind);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Subkommando `backup`: konsistente Sicherung in `out` schreiben.
async fn cmd_backup(db_path: &str, out: &str) -> anyhow::Result<()> {
    let ziel = Path::new(out);
    if ziel.exists() {
        anyhow::bail!("Zieldatei existiert bereits: {out} (VACUUM INTO überschreibt nicht)");
    }
    let pool = db::connect(db_path).await?;
    let groesse = backup::vacuum_into(&pool, ziel).await?;
    pool.close().await;
    println!("Sicherung erstellt: {out} ({groesse} Bytes)");
    Ok(())
}

/// Subkommando `restore`: Sicherung `from` an Stelle von `db_path` einspielen.
async fn cmd_restore(db_path: &str, from: &str, force: bool) -> anyhow::Result<()> {
    if !force {
        anyhow::bail!(
            "Restore überschreibt die Datenbank {db_path}. Zum Bestätigen --force angeben \
             (Server vorher stoppen!)."
        );
    }
    backup::restore::restore_aus_datei(Path::new(from), Path::new(db_path)).await?;
    println!("Sicherung {from} wurde nach {db_path} eingespielt.");
    Ok(())
}

/// Wartet auf ein Shutdown-Signal (SIGINT/Ctrl+C oder SIGTERM) für einen sauberen Shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::warn!("Ctrl+C-Handler konnte nicht installiert werden: {err}");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(err) => {
                tracing::warn!("SIGTERM-Handler konnte nicht installiert werden: {err}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown-Signal empfangen, fahre herunter");
}
```

- [ ] **Step 6: Gesamtkompilierung + manuelle CLI-Verifikation**

Run: `cargo build`
Expected: kompiliert ohne Fehler.

Run: `cargo run -- --help`
Expected: Hilfe listet die Subkommandos `backup` und `restore` auf.

Manueller Smoke-Test (Backup → Restore über die echte CLI):

```bash
cargo run -- --db-path /tmp/ll-src.db backup --out /tmp/ll-backup.sqlite
cargo run -- --db-path /tmp/ll-ziel.db restore --from /tmp/ll-backup.sqlite --force
```
Expected: „Sicherung erstellt: …" bzw. „Sicherung … wurde nach … eingespielt." Danach aufräumen:
```bash
rm -f /tmp/ll-src.db* /tmp/ll-backup.sqlite /tmp/ll-ziel.db*
```

- [ ] **Step 7: Commit**

```bash
git add src/config.rs src/main.rs
git commit -m "feat: CLI-Subkommandos backup und restore (Offline-/Skriptbetrieb)"
```

---

## Task 5: Frontend in die Binary einbetten und ausliefern

**Files:**
- Create: `src/static_files.rs`, `frontend/dist/.gitkeep`
- Modify: `Cargo.toml`, `.gitignore`, `src/lib.rs`, `src/app.rs`

- [ ] **Step 1: `frontend/dist`-Ordner für die Compile-Zeit sicherstellen**

rust-embed verlangt, dass der Embed-Ordner zur Compile-Zeit existiert (sonst bricht jeder `cargo build`/`cargo test` auf einem frischen Clone). Daher einen Platzhalter committen.

In `.gitignore` direkt unter der `dist/`-Zeile eine Negationsregel ergänzen:

```gitignore
# Node / Frontend
node_modules/
dist/
build/
# Embed-Ordner muss für die Compile-Zeit existieren (rust-embed):
!frontend/dist/
!frontend/dist/.gitkeep
```

Platzhalterdatei anlegen:

```bash
mkdir -p frontend/dist
printf '' > frontend/dist/.gitkeep
git add -f frontend/dist/.gitkeep
```

- [ ] **Step 2: `rust-embed` als Dependency ergänzen**

In `Cargo.toml` unter `[dependencies]` ergänzen (nach `tempfile`):

```toml
rust-embed = "8"
```

- [ ] **Step 3: Failing test für die Auslieferungs-Logik schreiben**

`src/static_files.rs` neu anlegen. Die reine Funktion `statische_antwort` ist über einen injizierten Getter testbar — unabhängig von tatsächlich gebauten Assets:

```rust
use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::Response;
use rust_embed::Embed;

/// Eingebettetes Frontend. Release-Build bettet `frontend/dist` ein,
/// Debug-Build liest zur Laufzeit vom Dateisystem.
#[derive(Embed)]
#[folder = "frontend/dist"]
struct Asset;

/// MIME-Typ anhand der Dateiendung. Bewusst manuell (kleiner, deterministischer
/// Satz statt zusätzlicher Dependency).
fn content_type(pfad: &str) -> &'static str {
    match pfad.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("json") | Some("map") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// True, wenn das letzte Pfadsegment eine Dateiendung hat (enthält einen Punkt).
fn hat_dateiendung(pfad: &str) -> bool {
    pfad.rsplit('/').next().is_some_and(|seg| seg.contains('.'))
}

/// Baut die HTTP-Antwort für einen statischen Pfad.
///
/// Regeln:
/// - Vorhandenes Asset → 200 mit passendem Content-Type + Cache-Header.
/// - Fehlendes Asset **ohne** Dateiendung → SPA-Fallback auf `index.html` (200).
/// - Fehlendes Asset **mit** Dateiendung → 404 (sonst würde index.html z.B. als Bild ausgeliefert).
/// - Auch `index.html` fehlt → 404.
///
/// Cache: Dateien unter `assets/` tragen hash-suffixierte Namen (Vite) →
/// langes `immutable`-Caching. Alles andere (index.html, Service Worker, Manifest)
/// → `no-cache`, damit nach einem Binary-Update kein veraltetes Frontend hängen bleibt.
fn statische_antwort(pfad: &str, get: impl Fn(&str) -> Option<Vec<u8>>) -> Response {
    let pfad = pfad.trim_start_matches('/');
    let pfad = if pfad.is_empty() { "index.html" } else { pfad };

    if let Some(daten) = get(pfad) {
        return baue_antwort(pfad, daten);
    }

    if hat_dateiendung(pfad) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap();
    }

    // SPA-Fallback.
    match get("index.html") {
        Some(daten) => baue_antwort("index.html", daten),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Frontend nicht eingebettet"))
            .unwrap(),
    }
}

fn baue_antwort(pfad: &str, daten: Vec<u8>) -> Response {
    let cache = if pfad.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static(content_type(pfad)))
        .header(header::CACHE_CONTROL, HeaderValue::from_static(cache))
        .body(Body::from(daten))
        .unwrap()
}

/// Axum-Fallback-Handler: liefert eingebettete Frontend-Dateien aus.
/// Nutzt den `Uri`-Extractor (ein Fallback hat kein gematchtes Routenmuster,
/// daher funktioniert hier kein `Path`-Extractor).
pub async fn serve(uri: Uri) -> Response {
    statische_antwort(uri.path(), |p| Asset::get(p).map(|f| f.data.into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn getter(eintraege: Vec<(&'static str, &'static [u8])>) -> impl Fn(&str) -> Option<Vec<u8>> {
        let map: HashMap<&str, &[u8]> = eintraege.into_iter().collect();
        move |p: &str| map.get(p).map(|b| b.to_vec())
    }

    #[test]
    fn liefert_vorhandenes_asset_mit_content_type_und_cache() {
        let get = getter(vec![("assets/index-abc123.js", b"console.log(1)")]);
        let resp = statische_antwort("/assets/index-abc123.js", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn leerer_pfad_liefert_index_html_mit_no_cache() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        assert_eq!(resp.headers().get(header::CACHE_CONTROL).unwrap(), "no-cache");
    }

    #[test]
    fn unbekannte_route_ohne_endung_faellt_auf_index_zurueck() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/einsaetze/42", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn fehlendes_asset_mit_endung_ist_404() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/assets/fehlt.js", get);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn ohne_eingebettetes_index_html_ist_404() {
        let get = getter(vec![]);
        let resp = statische_antwort("/", get);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
```

- [ ] **Step 4: Modul registrieren**

In `src/lib.rs` `static_files` ergänzen (nach `routes`):

```rust
pub mod routes;
pub mod static_files;
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cargo test --lib static_files`
Expected: PASS (5 Tests).

- [ ] **Step 6: Fallback-Handler in den Router einhängen**

In `src/app.rs` am Ende der Router-Kette — **nach** `.with_state(state)` geht nicht, daher direkt vor `.with_state(state)` einfügen. `crate::static_files` ist über den Crate-Pfad erreichbar:

```rust
        .route("/api/einsaetze/{id}/etb/stream", get(routes::etb::stream))
        .fallback(crate::static_files::serve)
        .with_state(state)
```

- [ ] **Step 7: Bestehende API-Tests bleiben grün (Fallback bricht nichts)**

Run: `cargo test`
Expected: PASS — alle bestehenden Tests laufen weiter; `/api/*`-Routen werden vom Fallback nicht erfasst.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml .gitignore frontend/dist/.gitkeep src/static_files.rs src/lib.rs src/app.rs
git commit -m "feat: Frontend in Binary einbetten und mit SPA-Fallback ausliefern"
```

---

## Task 6: Build-Skript und Betriebsdokumentation

**Files:**
- Create: `scripts/build-release.sh`, `docs/betrieb/packaging.md`, `docs/betrieb/backup-restore.md`

- [ ] **Step 1: Build-Skript anlegen**

`scripts/build-release.sh` neu anlegen:

```bash
#!/usr/bin/env bash
# Baut das Frontend, bettet es in die Rust-Binary ein und erzeugt die Single-Binary.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/2 Frontend bauen (frontend/dist)"
( cd frontend && npm ci && npm run build )

echo "==> 2/2 Backend im Release-Modus bauen (bettet frontend/dist ein)"
cargo build --release

BINARY="target/release/lifeline-hub"
echo "==> Fertig: $BINARY"
ls -lh "$BINARY"
echo "Start mit: $BINARY --db-path lifeline.db --bind 0.0.0.0:8080"
```

Ausführbar machen:

```bash
chmod +x scripts/build-release.sh
```

- [ ] **Step 2: Packaging-Doku schreiben**

`docs/betrieb/packaging.md` neu anlegen:

```markdown
# Betrieb: Bauen & Betreiben der Binary

lifeline-hub wird als **eine** ausführbare Datei ausgeliefert. Sie enthält API,
eingebettetes Frontend und (statisch gebündeltes) SQLite — kein separater
Webserver, keine Laufzeit-Abhängigkeiten.

## Bauen

Voraussetzungen: Rust-Toolchain (stable) und Node.js (für den Frontend-Build).

```bash
./scripts/build-release.sh
```

Das Skript baut zuerst das Frontend nach `frontend/dist` und danach die
Release-Binary, die `frontend/dist` zur Compile-Zeit einbettet. Ergebnis:
`target/release/lifeline-hub`.

> **Wichtig:** Das Frontend muss **vor** dem Release-Build gebaut sein, sonst
> bettet die Binary einen veralteten/leeren Frontend-Stand ein. Das Skript
> erledigt die Reihenfolge automatisch.

## Starten

```bash
./target/release/lifeline-hub --db-path /var/lib/lifeline/lifeline.db --bind 0.0.0.0:8080
```

Konfiguration per CLI-Flag oder ENV (Auszug):

| Flag | ENV | Default | Bedeutung |
|---|---|---|---|
| `--db-path` | `LIFELINE_DB_PATH` | `lifeline.db` | Pfad zur SQLite-Datei |
| `--bind` | `LIFELINE_BIND` | `127.0.0.1:8080` | Lausch-Adresse |
| `--org-name` | `LIFELINE_ORG_NAME` | `Meine Organisation` | Org-Name beim ersten Start |
| `--admin-user` | `LIFELINE_ADMIN_USER` | `admin` | Initialer Admin (erster Start) |
| `--admin-password` | `LIFELINE_ADMIN_PASSWORD` | *(generiert)* | Fehlt es, wird beim ersten Start ein Zufallspasswort ins Log geschrieben |

Beim ersten Start legt die Binary die DB-Datei an, spielt die Migrationen ein
und bootstrappt das Admin-Konto.

## Lokaler Betrieb (ELW / Mini-PC)

`--bind 0.0.0.0:8080` macht den Server im lokalen WLAN erreichbar. Clients geben
die Server-URL einmalig in der PWA ein. TLS ist empfohlen, im vertrauenswürdigen
LAN ist HTTP zulässig.
```

- [ ] **Step 3: Backup/Restore-Doku schreiben**

`docs/betrieb/backup-restore.md` neu anlegen:

```markdown
# Betrieb: Sicherung & Wiederherstellung

SQLite läuft im WAL-Modus. Sicherungen sind ein eingebautes Feature — kein DevOps
nötig.

## Sicherung (Hot-Backup, auch im laufenden Einsatz)

`VACUUM INTO` erzeugt eine **konsistente** Kopie als einzelne `.sqlite`-Datei,
auch während aktiv ins Tagebuch geschrieben wird.

**Variante A — per Weboberfläche (empfohlen, funktioniert lokal & Cloud):**
Als Admin angemeldet `GET /api/backup` aufrufen (Browser-Link/„Speichern unter").
Die heruntergeladene Datei `lifeline-backup-<zeitstempel>.sqlite` z.B. auf einen
USB-Stick speichern.

**Variante B — per CLI (für Skripte/Cron, Server darf laufen):**

```bash
lifeline-hub --db-path /var/lib/lifeline/lifeline.db backup --out /mnt/usb/lifeline-backup.sqlite
```

Die Zieldatei darf noch nicht existieren.

## Wiederherstellung

> **Server vorher stoppen.** Restore ersetzt die Datenbankdatei.

**Variante A — per CLI (empfohlen):** validiert die Sicherung und entfernt stale
`-wal`/`-shm`-Seitendateien automatisch:

```bash
# Server stoppen, dann:
lifeline-hub --db-path /var/lib/lifeline/lifeline.db restore --from /mnt/usb/lifeline-backup.sqlite --force
# Server wieder starten.
```

**Variante B — manuell:**

1. Server stoppen.
2. Aktuelle DB beiseitelegen und WAL-/SHM-Dateien entfernen:
   ```bash
   mv /var/lib/lifeline/lifeline.db /var/lib/lifeline/lifeline.db.alt
   rm -f /var/lib/lifeline/lifeline.db-wal /var/lib/lifeline/lifeline.db-shm
   ```
3. Sicherung an die Stelle der DB kopieren:
   ```bash
   cp /mnt/usb/lifeline-backup.sqlite /var/lib/lifeline/lifeline.db
   ```
4. Server starten.

Das Entfernen der `-wal`/`-shm`-Dateien ist wichtig: Eine alte WAL-Datei würde
sonst mit der zurückgespielten DB vermischt.
```

- [ ] **Step 4: Build-Skript verifizieren (länger laufend)**

Run: `bash scripts/build-release.sh`
Expected: Frontend-Build erfolgreich, danach Release-Build erfolgreich, am Ende `ls -lh` zeigt `target/release/lifeline-hub`.

Run: `./target/release/lifeline-hub --help`
Expected: Hilfe inkl. Subkommandos `backup`/`restore`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-release.sh docs/betrieb/packaging.md docs/betrieb/backup-restore.md
git commit -m "docs: Build-Skript und Betriebsdoku (Packaging, Backup/Restore)"
```

---

## Task 7: PROGRESS.md aktualisieren

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Plan-6-Status auf DONE setzen**

In `docs/superpowers/PROGRESS.md` die Tabellenzeile für Plan 6 ersetzen:

Vorher:
```markdown
| 6 | **Backup/Restore + Packaging** — Hot-Backup (USB) + Restore, Frontend-Embedding, Single-Binary-Build | ⬜ |
```

Nachher (Commit-Hash beim tatsächlichen Commit einsetzen):
```markdown
| 6 | **Backup/Restore + Packaging** — Hot-Backup (`GET /api/backup` + CLI), Restore (CLI + Doku), Frontend-Embedding (rust-embed), Single-Binary-Build | ✅ **DONE** — Branch `worktree-feat+einsatz-rollen` |
```

- [ ] **Step 2: Dateien-Liste ergänzen**

Im Abschnitt „## Dateien" nach der Plan-5-Zeile ergänzen:

```markdown
- Plan 6 (DONE): `docs/superpowers/plans/2026-05-24-backup-restore-packaging.md`
- Betriebsdoku: `docs/betrieb/packaging.md`, `docs/betrieb/backup-restore.md`
```

- [ ] **Step 3: „So startest du einen neuen Chat" aktualisieren**

Den letzten Absatz so anpassen, dass Teilprojekt 1 abgeschlossen ist (alle 6 Pläne fertig) und der nächste Schritt der Merge nach `main` bzw. der Start von Teilprojekt 2 (Fahrzeug-/Einsatzmittelverwaltung) ist. Konkreter Ersatztext für den letzten Absatz:

```markdown
Der aktuelle Code-Stand: Pläne 1–3 auf `main`; Pläne 4–6 auf Branch
`worktree-feat+einsatz-rollen` (Merge nach `main` ausstehend). **Teilprojekt 1
ist damit funktional vollständig** (Server, Auth, Einsatz, ETB-Kern, Frontend,
Backup/Restore, Single-Binary mit eingebettetem Frontend). **Nächster Schritt:
Merge nach `main`, danach Spec + Pläne für Teilprojekt 2 (Fahrzeug-/
Einsatzmittelverwaltung).**
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: Plan 6 (Backup/Restore + Packaging) als DONE markiert"
```

---

## Self-Review

**1. Spec-Coverage (§14 Backup/Restore & §4 Scope + §5 Architektur):**
- Hot-Backup im laufenden Betrieb → Task 1 (`vacuum_into`, WAL-konsistent), Task 2 (HTTP-Download), Task 4 (CLI). ✓
- Sicherung auf USB → Task 2 (Download → Speichern auf USB), Task 4 (`backup --out /mnt/usb/...`). ✓
- Dokumentierter, einfacher Restore-Pfad (stoppen, ersetzen, starten) → Task 6 (`backup-restore.md`, manuelle Variante B) + Task 3/4 (CLI-Restore mit WAL/SHM-Bereinigung). ✓
- Frontend in die Binary eingebettet → Task 5 (rust-embed). ✓
- Ein Deployment-Artefakt / Single-Binary-Build → Task 6 (`build-release.sh`). ✓
- Admin-only Zugriff (Rollen §7) → Task 2 (`AdminUser`, Tests für 401/403/200). ✓

**2. Placeholder-Scan:** Kein „TBD"/„TODO"/„implement later". Alle Code-Schritte enthalten vollständigen Code; alle Test-Schritte enthalten konkreten Testcode mit erwartetem Ausgang. ✓

**3. Type-Konsistenz:**
- `vacuum_into(pool: &SqlitePool, ziel: &Path) -> Result<u64, AppError>` — definiert in Task 1, identisch aufgerufen in Task 2 (`backup::vacuum_into(&state.pool, &pfad)`), Task 3-Tests und Task 4 (`backup::vacuum_into(&pool, ziel)`). ✓
- `restore::restore_aus_datei(quelle: &Path, ziel: &Path) -> Result<(), AppError>` — definiert in Task 3, aufgerufen in Task 4 (`backup::restore::restore_aus_datei(...)`). ✓
- `Command::Backup { out }` / `Command::Restore { from, force }` — definiert in Task 4 (config.rs), gematcht in Task 4 (main.rs) identisch. ✓
- `static_files::serve` — definiert in Task 5, eingehängt via `.fallback(crate::static_files::serve)` in Task 5/app.rs. ✓
- `AdminUser` Extractor — bestehendes Muster aus `src/auth/session.rs`, genutzt in Task 2 wie in `routes/benutzer.rs`. ✓
- `vacuum_open_readonly_fuer_test` — definiert in Task 2/Step 3, genutzt im Integrationstest Task 2/Step 2. ✓

Keine offenen Inkonsistenzen.
