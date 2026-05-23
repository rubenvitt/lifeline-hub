# Auth & Benutzer/Org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lokale Benutzerkonten mit Argon2-Passwort-Hashing, server-seitigen Sessions (httpOnly-Cookie), Admin-Bootstrap beim ersten Start und admin-gesteuerter Benutzerverwaltung — als Auth-Fundament für alle weiteren Module von lifeline-hub.

**Architecture:** Aufbauend auf Plan 1 (Config, SQLite-Pool, Router, `AppState`). Ein zentrales `error`-Modul (`AppError` + `IntoResponse`) vereinheitlicht Fehlerantworten als JSON. Authentifizierung über **opake Session-Tokens**, die server-seitig in einer `session`-Tabelle liegen und per **httpOnly-Cookie** transportiert werden (erlaubt Revocation beim Deaktivieren, kein JWT-Geheimnis, funktioniert offline im LAN). Login prüft Argon2-Hashes; `CurrentUser`/`AdminUser` sind Axum-Extractors, die die Session aus dem Cookie auflösen. Beim Start legt ein Bootstrap eine Organisation + Admin-Konto an, falls noch keine Benutzer existieren.

**Tech Stack:** Rust (Edition 2021), Axum 0.8, sqlx 0.8 (SQLite, Runtime-Queries — keine Compile-Time-Makros, konsistent mit Plan 1), `argon2` 0.5 (inkl. `password_hash` + re-exportiertes `OsRng`), `axum-extra` 0.10 (`cookie`-Feature). Tests: `tower::ServiceExt::oneshot` + `tempfile` + `db::test_pool()`.

---

## Plan-Hinweise

- **Commits:** Jede Commit-Nachricht endet mit der Zeile `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (Repo-Konvention). In den Schritten unten der Kürze halber weggelassen.
- **Branch:** Vor Beginn einen Feature-Branch anlegen (z.B. `feat/auth-benutzer-org`), nicht direkt auf `main` arbeiten. Umsetzung idealerweise in isoliertem Worktree.
- **TDD-Stil:** Wie Plan 1 — Code und Test werden gemeinsam geschrieben und der Test soll am Ende **bestehen**. Das ist nicht streng red-green, aber repo-konsistent. Wo ein eigener „Test schlägt fehl"-Schritt sinnvoll ist, ist er aufgeführt.
- **Reihenfolge:** Tasks sind so geordnet, dass nach jedem Task `cargo build` und `cargo test` grün sind. Module werden erst in `lib.rs` eingetragen, wenn sie existieren.
- **Fachsprache:** BOS-/Führungsbegriffe in Code-Identifiern und Texten (z.B. `Benutzer`, `Organisation`, `system_rolle`). Funktionsnamen auf Deutsch, wo es die Domäne betrifft.

---

## Design-Entscheidungen (fixiert)

| Entscheidung | Wert | Begründung |
|---|---|---|
| Session-Transport | httpOnly-Cookie `lifeline_sid`, opaker Token | Same-Origin-PWA; Revocation möglich; kein Token-Secret |
| Cookie-Attribute | `HttpOnly`, `SameSite=Lax`, `Path=/`, **kein** `Secure` | Spec erlaubt HTTP im vertrauenswürdigen LAN — `Secure` würde Cookie über HTTP unterdrücken |
| Token-Format | 32 Zufallsbytes (`OsRng`), hex → 64 Zeichen | Ausreichend Entropie |
| Token-Speicherung | Roh als Primärschlüssel in `session.token` | Bewusster Trade-off: DB-Datei enthält ohnehin alle Daten; kein zusätzlicher `sha2`-Dep |
| Session-TTL | 7 Tage (`expires_at`) | Pragmatisch für Einsatzbetrieb |
| Passwort-Mindestlänge | 8 Zeichen | Spec sagt nichts; bewusst niedrig gewählt |
| User-Enumeration-Schutz | Wegwerf-Hash bei unbekanntem/inaktivem Benutzer | Gleicht Timing an, ohne brüchige Konstanten |
| `system_rolle` | TEXT `CHECK IN ('admin','keiner')`, im Rust-Struct als `String` + `ist_admin()` | Vermeidet sqlx-Decode-Reibung mit Custom-Enum; CHECK erzwingt Integrität |
| Bootstrap-Passwort | aus Config falls gesetzt, sonst Zufalls-Passwort generieren + prominent loggen | „Betrieb ohne DevOps" |

**Abgrenzung:** Plan 2 behandelt **nur** die System-Rolle (`admin`/`keiner`). Einsatz-Mitgliedschaften und Einsatz-Rollen (Einsatzleitung/Führungspersonal/Beobachter) sind Plan 3.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `Cargo.toml` | + `argon2`, `axum-extra` (cookie) |
| `src/error.rs` | `AppError`-Enum + `IntoResponse` + `From<sqlx::Error>` |
| `migrations/0002_auth.sql` | Tabellen `organisation`, `benutzer`, `session` |
| `src/auth/mod.rs` | Modul-Sammlung + Domänen-Typen `Benutzer`, `BenutzerAnzeige`, Rollen-Konstanten |
| `src/auth/password.rs` | Argon2 `hash` / `verifizieren` |
| `src/auth/session.rs` | Token-Erzeugung, Session-Store (`anlegen`/`loeschen`), Extractors `CurrentUser`/`AdminUser`, Cookie-Konstante |
| `src/auth/bootstrap.rs` | `bootstrap_admin` — Org + Admin beim ersten Start |
| `src/routes/auth.rs` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| `src/routes/benutzer.rs` | `GET /api/benutzer`, `POST /api/benutzer`, `POST /api/benutzer/{id}/deaktivieren` (alle admin-only) |
| `src/app.rs` | Router um Auth-/Benutzer-Routen erweitern |
| `src/config.rs` | + Bootstrap-Felder (Org-Name, Admin-Benutzername, Admin-Passwort) |
| `src/main.rs` | Bootstrap nach Migration aufrufen |
| `tests/auth.rs` | Integrationstests Login/Logout/Me (inkl. Cookie-Roundtrip) |
| `tests/benutzer.rs` | Integrationstests Benutzerverwaltung |

---

## Task 1: Abhängigkeiten ergänzen

**Files:**
- Modify: `Cargo.toml`

- [ ] **Step 1: Dependencies hinzufügen** — in `Cargo.toml` den `[dependencies]`-Block um zwei Einträge erweitern (nach `clap`):

```toml
argon2 = { version = "0.5", features = ["std"] }
axum-extra = { version = "0.10", features = ["cookie"] }
```

> Hinweis: Das `std`-Feature von `argon2` ist nötig, damit `OsRng` (über `password_hash::rand_core` mit `getrandom`) verfügbar ist — sonst kompiliert das Salt-Generieren in Task 4 nicht.

Der `[dependencies]`-Block sieht danach so aus:

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
axum-extra = { version = "0.10", features = ["cookie"] }
```

- [ ] **Step 2: Build verifizieren**

Run: `cargo build`
Expected: Kompiliert ohne Fehler; lädt `argon2`, `axum-extra` und transitive Crates herunter.

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml Cargo.lock
git commit -m "chore: argon2 und axum-extra (cookie) als Abhängigkeiten"
```

---

## Task 2: error-Modul (AppError + IntoResponse)

**Files:**
- Create: `src/error.rs`
- Modify: `src/lib.rs`
- Test: in `src/error.rs` (Unit-Test)

- [ ] **Step 1: `src/error.rs` schreiben**

```rust
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Zentraler Anwendungsfehler. Wird über `IntoResponse` einheitlich
/// als JSON `{ "error": "<Meldung>" }` mit passendem Statuscode beantwortet.
#[derive(Debug)]
pub enum AppError {
    /// Nicht angemeldet / ungültige Session (401).
    Unauthorized,
    /// Angemeldet, aber keine Berechtigung (403).
    Forbidden,
    /// Ressource nicht gefunden (404).
    NotFound,
    /// Eingabe ungültig (400) — Meldung wird ausgegeben.
    Validation(String),
    /// Konflikt mit dem aktuellen Zustand (409), z.B. doppelter Benutzername.
    Conflict(String),
    /// Datenbankfehler (500) — Details nur im Log, nicht in der Antwort.
    Database(sqlx::Error),
    /// Sonstiger interner Fehler (500).
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Unauthorized => write!(f, "Nicht angemeldet"),
            AppError::Forbidden => write!(f, "Keine Berechtigung"),
            AppError::NotFound => write!(f, "Nicht gefunden"),
            AppError::Validation(m) => write!(f, "{m}"),
            AppError::Conflict(m) => write!(f, "{m}"),
            AppError::Database(e) => write!(f, "Datenbankfehler: {e}"),
            AppError::Internal(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Database(err)
    }
}

impl AppError {
    /// Statuscode für diese Fehlerart.
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        // Server-Fehler werden geloggt, dem Client aber generisch beantwortet,
        // damit keine internen Details (SQL, Pfade) nach außen gelangen.
        let message = match &self {
            AppError::Database(e) => {
                tracing::error!("Datenbankfehler: {e}");
                "Interner Serverfehler".to_string()
            }
            AppError::Internal(m) => {
                tracing::error!("Interner Fehler: {m}");
                "Interner Serverfehler".to_string()
            }
            other => other.to_string(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn unauthorized_maps_to_401() {
        let resp = AppError::Unauthorized.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn validation_maps_to_400_with_message() {
        let resp = AppError::Validation("Passwort zu kurz".into()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Passwort zu kurz");
    }

    #[tokio::test]
    async fn database_error_is_500_and_generic() {
        let resp = AppError::Database(sqlx::Error::RowNotFound).into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Interner Serverfehler");
    }

    #[test]
    fn conflict_maps_to_409() {
        assert_eq!(
            AppError::Conflict("x".into()).status(),
            StatusCode::CONFLICT
        );
    }
}
```

- [ ] **Step 2: Modul in `lib.rs` eintragen** — `src/lib.rs` (alphabetisch einsortiert):

```rust
pub mod app;
pub mod config;
pub mod db;
pub mod error;
pub mod routes;
```

- [ ] **Step 3: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib error`
Expected: PASS — `unauthorized_maps_to_401`, `validation_maps_to_400_with_message`, `database_error_is_500_and_generic`, `conflict_maps_to_409`.

- [ ] **Step 4: Commit**

```bash
git add src/error.rs src/lib.rs
git commit -m "feat: zentrales error-Modul mit AppError und IntoResponse"
```

---

## Task 3: Migration für Organisation, Benutzer und Session

**Files:**
- Create: `migrations/0002_auth.sql`
- Test: in `src/db.rs` (Unit-Test ergänzen)

- [ ] **Step 1: Migration anlegen** — `migrations/0002_auth.sql`

```sql
-- Organisation: in T1 genau eine pro Server (siehe Spec, Annahme Single-Org).
CREATE TABLE organisation (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    erstellt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lokale Benutzerkonten. system_rolle: 'admin' (serverweite Verwaltung) oder 'keiner'.
CREATE TABLE benutzer (
    id            INTEGER PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES organisation(id),
    anzeigename   TEXT NOT NULL,
    benutzername  TEXT NOT NULL UNIQUE,
    passwort_hash TEXT NOT NULL,
    system_rolle  TEXT NOT NULL DEFAULT 'keiner'
                  CHECK (system_rolle IN ('admin', 'keiner')),
    aktiv         INTEGER NOT NULL DEFAULT 1,
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Server-seitige Sessions; Token im httpOnly-Cookie. expires_at als ISO-Zeitstempel.
CREATE TABLE session (
    token       TEXT PRIMARY KEY,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    erstellt_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE INDEX idx_session_benutzer ON session(benutzer_id);
```

- [ ] **Step 2: Test in `src/db.rs` ergänzen** — im `#[cfg(test)] mod tests`-Block diesen Test hinzufügen:

```rust
    #[tokio::test]
    async fn auth_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // Organisation + Benutzer anlegen funktioniert.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Max Muster', 'max', 'hash')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Default-Rolle ist 'keiner', aktiv ist 1.
        let (rolle, aktiv): (String, i64) =
            sqlx::query_as("SELECT system_rolle, aktiv FROM benutzer WHERE benutzername = 'max'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rolle, "keiner");
        assert_eq!(aktiv, 1);

        // CHECK-Constraint lehnt ungültige Rolle ab.
        let bad_rolle = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'X', 'x', 'h', 'superadmin')",
        )
        .execute(&pool)
        .await;
        assert!(bad_rolle.is_err(), "ungültige system_rolle muss abgelehnt werden");

        // UNIQUE-Constraint lehnt doppelten Benutzernamen ab.
        let dup = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Zweiter Max', 'max', 'h')",
        )
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelter benutzername muss abgelehnt werden");
    }
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib db::tests::auth_migration_creates_tables_and_constraints`
Expected: PASS — Tabellen existieren, Defaults greifen, CHECK- und UNIQUE-Constraints wirken.

- [ ] **Step 4: Commit**

```bash
git add migrations/0002_auth.sql src/db.rs
git commit -m "feat: Migration für organisation, benutzer und session"
```

---

## Task 4: auth-Modul-Skelett + Passwort-Hashing

**Files:**
- Create: `src/auth/mod.rs`
- Create: `src/auth/password.rs`
- Modify: `src/lib.rs`
- Test: in `src/auth/password.rs` (Unit-Tests)

- [ ] **Step 1: `src/auth/mod.rs` schreiben** (Modul-Deklarationen + Domänen-Typen)

```rust
pub mod bootstrap;
pub mod password;
pub mod session;

use serde::Serialize;

/// Wert der System-Rolle für Administratoren (serverweite Verwaltung).
pub const ROLLE_ADMIN: &str = "admin";
/// Wert der System-Rolle für reguläre Benutzer ohne Admin-Rechte.
pub const ROLLE_KEINER: &str = "keiner";

/// Interner Benutzer-Datensatz inklusive Passwort-Hash.
/// Wird NICHT direkt serialisiert — für API-Antworten `anzeige()` verwenden.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Benutzer {
    pub id: i64,
    pub org_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort_hash: String,
    pub system_rolle: String,
    pub aktiv: bool,
    pub erstellt_at: String,
}

impl Benutzer {
    /// Ob dieser Benutzer die System-Rolle Admin hat.
    pub fn ist_admin(&self) -> bool {
        self.system_rolle == ROLLE_ADMIN
    }

    /// Sichere, serialisierbare Darstellung ohne Passwort-Hash.
    pub fn anzeige(&self) -> BenutzerAnzeige {
        BenutzerAnzeige {
            id: self.id,
            anzeigename: self.anzeigename.clone(),
            benutzername: self.benutzername.clone(),
            system_rolle: self.system_rolle.clone(),
            aktiv: self.aktiv,
            erstellt_at: self.erstellt_at.clone(),
        }
    }
}

/// Öffentliche Benutzerdarstellung (ohne Passwort-Hash) für API-Antworten.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BenutzerAnzeige {
    pub id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub system_rolle: String,
    pub aktiv: bool,
    pub erstellt_at: String,
}
```

> Hinweis: `bootstrap` und `session` werden in den folgenden Tasks 5 und 6 angelegt. Damit `src/auth/mod.rs` in **diesem** Task kompiliert, lege zuerst leere Platzhalter an (Step 2), bevor du baust.

- [ ] **Step 2: Platzhalter für noch leere Submodule anlegen** (werden in Task 5/6 gefüllt):

`src/auth/session.rs`:

```rust
// Inhalt folgt in Task 5.
```

`src/auth/bootstrap.rs`:

```rust
// Inhalt folgt in Task 6.
```

- [ ] **Step 3: `src/auth/password.rs` schreiben**

```rust
use crate::error::AppError;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Hasht ein Klartext-Passwort mit Argon2id (OWASP-Defaultparameter)
/// und liefert den PHC-String (inkl. eingebettetem Salt).
pub fn hash(passwort: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(passwort.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Passwort-Hashing fehlgeschlagen: {e}")))
}

/// Prüft ein Klartext-Passwort gegen einen gespeicherten PHC-Hash.
/// Liefert `false` bei Nichtübereinstimmung oder unparsbarem Hash.
pub fn verifizieren(passwort: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(passwort.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_unterscheidet_sich_vom_klartext_und_ist_phc() {
        let h = hash("geheim123").unwrap();
        assert_ne!(h, "geheim123");
        assert!(h.starts_with("$argon2id$"), "PHC-String erwartet, war: {h}");
    }

    #[test]
    fn verifizieren_akzeptiert_korrektes_passwort() {
        let h = hash("geheim123").unwrap();
        assert!(verifizieren("geheim123", &h));
    }

    #[test]
    fn verifizieren_lehnt_falsches_passwort_ab() {
        let h = hash("geheim123").unwrap();
        assert!(!verifizieren("falsch", &h));
    }

    #[test]
    fn verifizieren_lehnt_kaputten_hash_ab() {
        assert!(!verifizieren("egal", "kein-gueltiger-hash"));
    }

    #[test]
    fn zwei_hashes_desselben_passworts_unterscheiden_sich() {
        // Unterschiedliche Salts → unterschiedliche Hashes.
        assert_ne!(hash("gleich").unwrap(), hash("gleich").unwrap());
    }
}
```

- [ ] **Step 4: Modul in `lib.rs` eintragen** — `src/lib.rs`:

```rust
pub mod app;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod routes;
```

- [ ] **Step 5: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib auth::password`
Expected: PASS — alle fünf Passwort-Tests grün.

- [ ] **Step 6: Commit**

```bash
git add src/auth/ src/lib.rs
git commit -m "feat: auth-Modul mit Benutzer-Typen und Argon2-Passwort-Hashing"
```

---

## Task 5: Session-Store + Extractors (CurrentUser/AdminUser)

**Files:**
- Modify: `src/auth/session.rs` (Platzhalter ersetzen)
- Test: in `src/auth/session.rs` (Unit-Tests für Store) + Extractor-Tests folgen integrationsweise in Task 7

- [ ] **Step 1: `src/auth/session.rs` vollständig schreiben**

```rust
use crate::app::AppState;
use crate::auth::Benutzer;
use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::cookie::CookieJar;
use sqlx::SqlitePool;

/// Name des Session-Cookies.
pub const SESSION_COOKIE: &str = "lifeline_sid";

/// Erzeugt einen neuen, kryptografisch zufälligen Session-Token (64 Hex-Zeichen).
pub fn neuer_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Legt eine neue Session für den Benutzer an (TTL 7 Tage) und liefert den Token.
pub async fn anlegen(pool: &SqlitePool, benutzer_id: i64) -> Result<String, AppError> {
    let token = neuer_token();
    sqlx::query(
        "INSERT INTO session (token, benutzer_id, expires_at) \
         VALUES (?, ?, datetime('now', '+7 days'))",
    )
    .bind(&token)
    .bind(benutzer_id)
    .execute(pool)
    .await?;
    Ok(token)
}

/// Löscht eine Session anhand ihres Tokens (idempotent).
pub async fn loeschen(pool: &SqlitePool, token: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM session WHERE token = ?")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

/// Löst eine gültige (nicht abgelaufene) Session zu einem aktiven Benutzer auf.
async fn benutzer_aus_token(pool: &SqlitePool, token: &str) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.aktiv, b.erstellt_at \
         FROM session s \
         JOIN benutzer b ON b.id = s.benutzer_id \
         WHERE s.token = ? AND s.expires_at > datetime('now') AND b.aktiv = 1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    benutzer.ok_or(AppError::Unauthorized)
}

/// Extractor: der aktuell angemeldete Benutzer (aus Session-Cookie).
/// Liefert 401, wenn kein gültiger Session-Cookie vorliegt.
pub struct CurrentUser(pub Benutzer);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .expect("CookieJar-Extractor ist infallible");
        let token = jar
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or(AppError::Unauthorized)?;

        let benutzer = benutzer_aus_token(&state.pool, &token).await?;
        Ok(CurrentUser(benutzer))
    }
}

/// Extractor: der aktuell angemeldete Benutzer, der zusätzlich Admin sein muss.
/// Liefert 401 ohne Session, 403 bei fehlender Admin-Rolle.
pub struct AdminUser(pub Benutzer);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;
        if benutzer.ist_admin() {
            Ok(AdminUser(benutzer))
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt eine Org + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, aktiv: i64) -> i64 {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', 'hash', ?)",
        )
        .bind(aktiv)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = 'max'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn neuer_token_ist_64_hex_zeichen() {
        let t = neuer_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t, neuer_token(), "Tokens müssen sich unterscheiden");
    }

    #[tokio::test]
    async fn anlegen_und_aufloesen_roundtrip() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id).await.unwrap();
        let benutzer = benutzer_aus_token(&pool, &token).await.unwrap();
        assert_eq!(benutzer.id, id);
        assert_eq!(benutzer.benutzername, "max");
    }

    #[tokio::test]
    async fn unbekannter_token_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_anlegen(&pool, 1).await;
        let err = benutzer_aus_token(&pool, "gibtsnicht").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn abgelaufene_session_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        // Session mit Ablauf in der Vergangenheit direkt einfügen.
        sqlx::query(
            "INSERT INTO session (token, benutzer_id, expires_at) \
             VALUES ('alt', ?, datetime('now', '-1 day'))",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let err = benutzer_aus_token(&pool, "alt").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn session_eines_inaktiven_benutzers_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 0).await; // inaktiv
        let token = anlegen(&pool, id).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn loeschen_invalidiert_session() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let token = anlegen(&pool, id).await.unwrap();
        loeschen(&pool, &token).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }
}
```

- [ ] **Step 2: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib auth::session`
Expected: PASS — Token-Format, Roundtrip, unbekannter/abgelaufener Token, inaktiver Benutzer und Löschen verhalten sich korrekt.

- [ ] **Step 3: Commit**

```bash
git add src/auth/session.rs
git commit -m "feat: Session-Store und CurrentUser/AdminUser-Extractors"
```

---

## Task 6: Admin-Bootstrap

**Files:**
- Modify: `src/auth/bootstrap.rs` (Platzhalter ersetzen)
- Test: in `src/auth/bootstrap.rs` (Unit-Tests)

- [ ] **Step 1: `src/auth/bootstrap.rs` vollständig schreiben**

```rust
use crate::auth::{password, ROLLE_ADMIN};
use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use sqlx::SqlitePool;

/// Ergebnis des Bootstraps: ob ein Admin neu angelegt wurde und mit welchem
/// Passwort (nur gesetzt, wenn der Bootstrap ein Zufalls-Passwort erzeugt hat).
#[derive(Debug, Default)]
pub struct BootstrapErgebnis {
    pub admin_angelegt: bool,
    /// Generiertes Zufalls-Passwort, falls keines vorgegeben war.
    pub generiertes_passwort: Option<String>,
}

/// Erzeugt ein gut lesbares Zufalls-Passwort (Hex, 24 Zeichen).
fn zufalls_passwort() -> String {
    let mut bytes = [0u8; 12];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Legt beim ersten Start eine Organisation und ein Admin-Konto an,
/// sofern noch kein Benutzer existiert. Idempotent: bei vorhandenen
/// Benutzern passiert nichts.
///
/// `admin_passwort = None` → es wird ein Zufalls-Passwort erzeugt und im
/// Ergebnis zurückgegeben (der Aufrufer loggt es).
pub async fn bootstrap_admin(
    pool: &SqlitePool,
    org_name: &str,
    admin_benutzername: &str,
    admin_passwort: Option<&str>,
) -> Result<BootstrapErgebnis, AppError> {
    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
        .fetch_one(pool)
        .await?;
    if anzahl > 0 {
        return Ok(BootstrapErgebnis::default());
    }

    let (passwort, generiert) = match admin_passwort {
        Some(p) => (p.to_string(), None),
        None => {
            let p = zufalls_passwort();
            (p.clone(), Some(p))
        }
    };
    let hash = password::hash(&passwort)?;

    let mut tx = pool.begin().await?;
    // Organisation anlegen (oder vorhandene id=1 nutzen, falls schon vorhanden).
    let org_id: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name) VALUES (?) RETURNING id",
    )
    .bind(org_name)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind("Administrator")
    .bind(admin_benutzername)
    .bind(&hash)
    .bind(ROLLE_ADMIN)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(BootstrapErgebnis {
        admin_angelegt: true,
        generiertes_passwort: generiert,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::password;

    #[tokio::test]
    async fn legt_org_und_admin_an_wenn_leer() {
        let pool = crate::db::test_pool().await;
        let erg = bootstrap_admin(&pool, "Meine Orga", "admin", Some("startpw12"))
            .await
            .unwrap();
        assert!(erg.admin_angelegt);
        assert!(erg.generiertes_passwort.is_none());

        let (rolle, hash): (String, String) = sqlx::query_as(
            "SELECT system_rolle, passwort_hash FROM benutzer WHERE benutzername = 'admin'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rolle, "admin");
        assert!(password::verifizieren("startpw12", &hash));

        let org_name: String = sqlx::query_scalar("SELECT name FROM organisation LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(org_name, "Meine Orga");
    }

    #[tokio::test]
    async fn generiert_passwort_wenn_keines_vorgegeben() {
        let pool = crate::db::test_pool().await;
        let erg = bootstrap_admin(&pool, "Orga", "admin", None).await.unwrap();
        let pw = erg.generiertes_passwort.expect("Passwort muss generiert sein");

        let hash: String =
            sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(password::verifizieren(&pw, &hash));
    }

    #[tokio::test]
    async fn ist_idempotent_bei_vorhandenen_benutzern() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("pw")).await.unwrap();

        let erg2 = bootstrap_admin(&pool, "Orga", "admin2", Some("pw2"))
            .await
            .unwrap();
        assert!(!erg2.admin_angelegt, "zweiter Bootstrap darf nichts anlegen");

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 1);
    }
}
```

- [ ] **Step 2: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib auth::bootstrap`
Expected: PASS — Anlegen mit vorgegebenem Passwort, mit generiertem Passwort, und Idempotenz.

- [ ] **Step 3: Commit**

```bash
git add src/auth/bootstrap.rs
git commit -m "feat: Admin-Bootstrap beim ersten Start"
```

---

## Task 7: Login/Logout/Me-Routen + Router-Verdrahtung

**Files:**
- Create: `src/routes/auth.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Test: `tests/auth.rs` (Integrationstests)

- [ ] **Step 1: `src/routes/auth.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::auth::password;
use crate::error::AppError;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub benutzername: String,
    pub passwort: String,
}

/// Baut das Session-Cookie. Bewusst OHNE `Secure`, damit der Betrieb über
/// HTTP im vertrauenswürdigen LAN (ELW) funktioniert (siehe Spec Abschnitt 14).
fn session_cookie(token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .build()
}

/// POST /api/auth/login — prüft Anmeldedaten, legt Session an, setzt Cookie.
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let benutzer = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(&req.benutzername)
    .fetch_optional(&state.pool)
    .await?;

    let benutzer = match benutzer {
        Some(b) if password::verifizieren(&req.passwort, &b.passwort_hash) => b,
        Some(_) => return Err(AppError::Unauthorized),
        None => {
            // Wegwerf-Hash, um die Antwortzeit anzugleichen (User-Enumeration-Schutz).
            let _ = password::hash(&req.passwort);
            return Err(AppError::Unauthorized);
        }
    };

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token));
    Ok((jar, Json(benutzer.anzeige())))
}

/// POST /api/auth/logout — löscht die Session und entfernt das Cookie.
pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        session::loeschen(&state.pool, cookie.value()).await?;
    }
    let jar = jar.remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
    Ok((jar, StatusCode::NO_CONTENT))
}

/// GET /api/auth/me — liefert den aktuell angemeldeten Benutzer.
pub async fn me(CurrentUser(benutzer): CurrentUser) -> Json<crate::auth::BenutzerAnzeige> {
    Json(benutzer.anzeige())
}
```

> Hinweis zum `Unauthorized`-Fall: Der Fehlertext lautet einheitlich „Nicht angemeldet" (aus `AppError::Display`). Für die Anmeldung leakt das bewusst keine Information darüber, ob der Benutzername existiert.

- [ ] **Step 2: Routen-Modul erweitern** — `src/routes/mod.rs`:

```rust
pub mod auth;
pub mod health;
```

- [ ] **Step 3: Router erweitern** — `src/app.rs` vollständig ersetzen:

```rust
use crate::routes;
use axum::{
    routing::{get, post},
    Router,
};
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
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .with_state(state)
}
```

- [ ] **Step 4: Integrationstest schreiben** — `tests/auth.rs`

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use tower::ServiceExt; // stellt `oneshot` bereit

/// Baut Router + DB mit einem Bootstrap-Admin (admin / startpw12).
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool })
}

/// Sendet ein Login und gibt den `Set-Cookie`-Header-Wert zurück.
async fn login(app: &axum::Router, benutzername: &str, passwort: &str) -> (StatusCode, Option<String>) {
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
    let status = resp.status();
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().to_string());
    (status, cookie)
}

#[tokio::test]
async fn login_erfolgreich_setzt_httponly_cookie() {
    let app = setup().await;
    let (status, cookie) = login(&app, "admin", "startpw12").await;
    assert_eq!(status, StatusCode::OK);
    let cookie = cookie.expect("Set-Cookie erwartet");
    assert!(cookie.contains("lifeline_sid="));
    assert!(cookie.to_lowercase().contains("httponly"));
}

#[tokio::test]
async fn login_mit_falschem_passwort_ist_401() {
    let app = setup().await;
    let (status, _) = login(&app, "admin", "falsch").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_mit_unbekanntem_benutzer_ist_401() {
    let app = setup().await;
    let (status, _) = login(&app, "niemand", "egal1234").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_ohne_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn me_mit_session_liefert_benutzer() {
    let app = setup().await;
    let (_, cookie) = login(&app, "admin", "startpw12").await;
    // Set-Cookie-Wert vor dem ersten ';' ist das eigentliche name=value-Paar.
    let cookie_paar = cookie.unwrap();
    let cookie_paar = cookie_paar.split(';').next().unwrap().to_string();

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(header::COOKIE, cookie_paar)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["benutzername"], "admin");
    assert_eq!(json["system_rolle"], "admin");
    assert!(json.get("passwort_hash").is_none(), "Hash darf nicht ausgegeben werden");
}

#[tokio::test]
async fn logout_invalidiert_session() {
    let app = setup().await;
    let (_, cookie) = login(&app, "admin", "startpw12").await;
    let cookie_paar = cookie.unwrap().split(';').next().unwrap().to_string();

    // Logout.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(header::COOKIE, cookie_paar.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Dieselbe Session ist danach ungültig.
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(header::COOKIE, cookie_paar)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 5: Tests ausführen (sollen bestehen)**

Run: `cargo test --test auth`
Expected: PASS — Login setzt httpOnly-Cookie, falsche/unbekannte Anmeldung → 401, `me` ohne/mit Session, Logout invalidiert die Session.

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.rs src/routes/mod.rs src/app.rs tests/auth.rs
git commit -m "feat: Login/Logout/Me-Endpoints mit Session-Cookie"
```

---

## Task 8: Benutzerverwaltung (admin-only)

**Files:**
- Create: `src/routes/benutzer.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Test: `tests/benutzer.rs` (Integrationstests)

- [ ] **Step 1: `src/routes/benutzer.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::auth::{password, BenutzerAnzeige, ROLLE_ADMIN, ROLLE_KEINER};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Mindestlänge für Passwörter (siehe Plan-Design-Entscheidungen).
const PASSWORT_MIN_LEN: usize = 8;

#[derive(Debug, Deserialize)]
pub struct NeuerBenutzer {
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort: String,
    /// 'admin' oder 'keiner'; fehlt das Feld, gilt 'keiner'.
    pub system_rolle: Option<String>,
}

/// GET /api/benutzer — Liste aller Benutzer (ohne Passwort-Hashes). Admin-only.
pub async fn liste(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<BenutzerAnzeige>>, AppError> {
    let benutzer = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, aktiv, erstellt_at \
         FROM benutzer ORDER BY id",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(benutzer))
}

/// POST /api/benutzer — neuen Benutzer anlegen. Admin-only.
pub async fn anlegen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(req): Json<NeuerBenutzer>,
) -> Result<(StatusCode, Json<BenutzerAnzeige>), AppError> {
    if req.benutzername.trim().is_empty() {
        return Err(AppError::Validation("Benutzername darf nicht leer sein".into()));
    }
    if req.anzeigename.trim().is_empty() {
        return Err(AppError::Validation("Anzeigename darf nicht leer sein".into()));
    }
    if req.passwort.len() < PASSWORT_MIN_LEN {
        return Err(AppError::Validation(format!(
            "Passwort muss mindestens {PASSWORT_MIN_LEN} Zeichen haben"
        )));
    }
    let rolle = req.system_rolle.as_deref().unwrap_or(ROLLE_KEINER);
    if rolle != ROLLE_ADMIN && rolle != ROLLE_KEINER {
        return Err(AppError::Validation(
            "system_rolle muss 'admin' oder 'keiner' sein".into(),
        ));
    }

    let hash = password::hash(&req.passwort)?;
    // Single-Org in T1: alle Benutzer gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let ergebnis = sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(req.anzeigename.trim())
    .bind(req.benutzername.trim())
    .bind(&hash)
    .bind(rolle)
    .execute(&state.pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict("Benutzername ist bereits vergeben".into()));
        }
    }
    let id = ergebnis?.last_insert_rowid();

    let angelegt = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// POST /api/benutzer/{id}/deaktivieren — Benutzer deaktivieren + Sessions löschen.
/// Verweigert die Deaktivierung des letzten aktiven Admins. Admin-only.
pub async fn deaktivieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<BenutzerAnzeige>, AppError> {
    let ziel = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Letzten aktiven Admin schützen.
    if ziel.ist_admin() && ziel.aktiv {
        let aktive_admins: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1",
        )
        .bind(ROLLE_ADMIN)
        .fetch_one(&state.pool)
        .await?;
        if aktive_admins <= 1 {
            return Err(AppError::Conflict(
                "Der letzte aktive Admin kann nicht deaktiviert werden".into(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM session WHERE benutzer_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let aktualisiert = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(aktualisiert))
}
```

- [ ] **Step 2: Routen-Modul erweitern** — `src/routes/mod.rs`:

```rust
pub mod auth;
pub mod benutzer;
pub mod health;
```

- [ ] **Step 3: Router erweitern** — in `src/app.rs` die drei Benutzer-Routen ergänzen. `build_router` lautet danach:

```rust
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/benutzer", get(routes::benutzer::liste))
        .route("/api/benutzer", post(routes::benutzer::anlegen))
        .route("/api/benutzer/{id}/deaktivieren", post(routes::benutzer::deaktivieren))
        .with_state(state)
}
```

> Hinweis: Axum 0.8 nutzt geschweifte Klammern für Pfadparameter (`{id}`), nicht `:id`.

- [ ] **Step 4: Integrationstest schreiben** — `tests/benutzer.rs`

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool })
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar.
async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
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
    assert_eq!(resp.status(), StatusCode::OK, "Login im Test muss klappen");
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn liste_ohne_admin_session_ist_401() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn nicht_admin_bekommt_403_auf_benutzerliste() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // Admin legt einen normalen Benutzer an.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Dieser meldet sich an und versucht die Liste zu lesen → 403.
    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .header(header::COOKIE, erika_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_legt_benutzer_an_und_listet() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(
                    r#"{"anzeigename":"Erika Muster","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/benutzer")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2); // admin + erika
}

#[tokio::test]
async fn doppelter_benutzername_ist_409() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let neu = r#"{"anzeigename":"Admin Zwei","benutzername":"admin","passwort":"adminpw2"}"#;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(neu))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn zu_kurzes_passwort_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Kurz","benutzername":"kurz","passwort":"123"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn letzter_admin_kann_nicht_deaktiviert_werden() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // admin hat id=1 (erster und einziger Benutzer nach Bootstrap).
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer/1/deaktivieren")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn deaktivierter_benutzer_kann_sich_nicht_mehr_anmelden() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    // Zweiten Benutzer anlegen (bekommt id=2).
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Deaktivieren.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer/2/deaktivieren")
                .header(header::COOKIE, admin_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Login schlägt nun fehl (aktiv = 0).
    let body = r#"{"benutzername":"erika","passwort":"erikapw1"}"#;
    let resp = app
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
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 5: Tests ausführen (sollen bestehen)**

Run: `cargo test --test benutzer`
Expected: PASS — Auth-Schutz (401/403), Anlegen + Liste, Konflikt bei Duplikat, Validierung, Schutz des letzten Admins, Deaktivierung sperrt Login.

- [ ] **Step 6: Commit**

```bash
git add src/routes/benutzer.rs src/routes/mod.rs src/app.rs tests/benutzer.rs
git commit -m "feat: admin-gesteuerte Benutzerverwaltung (Liste/Anlegen/Deaktivieren)"
```

---

## Task 9: Config-Felder + Bootstrap in der Binary verdrahten

**Files:**
- Modify: `src/config.rs`
- Modify: `src/main.rs`
- Test: in `src/config.rs` (Unit-Test ergänzen) + manueller Smoke-Test

- [ ] **Step 1: Config um Bootstrap-Felder erweitern** — `src/config.rs`, in das `Config`-Struct nach `bind` einfügen:

```rust
    /// Name der Organisation, die beim ersten Start angelegt wird.
    #[arg(long, env = "LIFELINE_ORG_NAME", default_value = "Meine Organisation")]
    pub org_name: String,

    /// Benutzername des initialen Admin-Kontos (erster Start).
    #[arg(long, env = "LIFELINE_ADMIN_USER", default_value = "admin")]
    pub admin_user: String,

    /// Passwort des initialen Admin-Kontos. Fehlt es, wird beim ersten Start
    /// ein Zufalls-Passwort erzeugt und ins Log geschrieben.
    #[arg(long, env = "LIFELINE_ADMIN_PASSWORD")]
    pub admin_password: Option<String>,
```

- [ ] **Step 2: Config-Test ergänzen** — im `#[cfg(test)] mod tests`-Block von `src/config.rs`:

```rust
    #[test]
    fn bootstrap_defaults_und_optionales_passwort() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert_eq!(config.org_name, "Meine Organisation");
        assert_eq!(config.admin_user, "admin");
        assert!(config.admin_password.is_none());

        let config = Config::parse_from(["lifeline-hub", "--admin-password", "geheim123"]);
        assert_eq!(config.admin_password.as_deref(), Some("geheim123"));
    }
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib config`
Expected: PASS — bestehende Config-Tests + `bootstrap_defaults_und_optionales_passwort`.

- [ ] **Step 4: Bootstrap in `main.rs` aufrufen** — `src/main.rs` zwischen `db::migrate(...)` und `build_router(...)` einfügen:

```rust
    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    let ergebnis = lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        &config.org_name,
        &config.admin_user,
        config.admin_password.as_deref(),
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

    let app = build_router(AppState { pool });
```

> Hinweis: `bootstrap_admin` gibt `Result<_, AppError>` zurück; in `main` (`anyhow::Result`) funktioniert `?`, weil `AppError` `std::error::Error` implementiert.

- [ ] **Step 5: Build verifizieren**

Run: `cargo build`
Expected: Kompiliert ohne Fehler.

- [ ] **Step 6: Smoke-Test (manuell)** — frische DB starten und Login durchspielen:

```bash
rm -f smoke.db smoke.db-wal smoke.db-shm
LIFELINE_ADMIN_PASSWORD=startpw12 cargo run -- --db-path smoke.db
```

Erwartung im Log: `Admin-Konto 'admin' angelegt`, Server lauscht auf `127.0.0.1:8080`.

In zweitem Terminal (Cookie wird in `jar.txt` gespeichert):

```bash
curl -s -c jar.txt -X POST http://127.0.0.1:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"benutzername":"admin","passwort":"startpw12"}'
curl -s -b jar.txt http://127.0.0.1:8080/api/auth/me
curl -s -b jar.txt http://127.0.0.1:8080/api/benutzer
```

Erwartung: Login liefert JSON mit `"system_rolle":"admin"`; `me` denselben Benutzer; `benutzer` ein Array mit einem Eintrag. Danach Server mit `Ctrl+C` beenden und Smoke-Artefakte entfernen: `rm -f smoke.db smoke.db-wal smoke.db-shm jar.txt`.

- [ ] **Step 7: Gesamten Testlauf verifizieren**

Run: `cargo test`
Expected: Alle Tests grün (Plan-1-Tests: config, db, health; Plan-2-Tests: error, auth::password, auth::session, auth::bootstrap, tests/auth, tests/benutzer).

- [ ] **Step 8: Commit**

```bash
git add src/config.rs src/main.rs
git commit -m "feat: Admin-Bootstrap und Config-Felder in der Binary verdrahten"
```

---

## Self-Review (durchgeführt)

**1. Spec-Abdeckung (Plan 2 = Auth & Benutzer/Org, Spec-Abschnitte 6–8):**
- `error`-Modul (`AppError` + `IntoResponse`) → Task 2 ✓
- Lokale Benutzerkonten, Org-Stammdaten (minimal) → Task 3 (Migration), Task 8 (Verwaltung) ✓
- Argon2-Passwort-Hashing → Task 4 ✓
- Sessions (Spec lässt Mechanik offen → server-seitige Sessions per Cookie gewählt) → Task 5 ✓
- Login/Logout/Me → Task 7 ✓
- Admin-Bootstrap beim ersten Start → Task 6 + Task 9 ✓
- Benutzerverwaltung durch Admin (anlegen/deaktivieren/listen) → Task 8 ✓
- System-Rolle Admin/keiner → Task 3 (Schema), Task 4 (Typ), Task 5 (`AdminUser`) ✓
- (Einsatz-Rollen Einsatzleitung/Führungspersonal/Beobachter gehören bewusst zu Plan 3.)

**2. Placeholder-Scan:** Keine TBD/TODO. Die „Inhalt folgt"-Platzhalter in Task 4 Step 2 sind bewusste, kompilierende Zwischenstände, die in Task 5/6 vollständig ersetzt werden — kein offener Rest am Planende.

**3. Typ-Konsistenz (über Tasks hinweg geprüft):**
- `AppError`-Varianten (`Unauthorized`/`Forbidden`/`NotFound`/`Validation`/`Conflict`/`Database`/`Internal`) identisch in Task 2, 5, 6, 7, 8 verwendet.
- `Benutzer` (Felder inkl. `aktiv: bool`, `system_rolle: String`) + `BenutzerAnzeige` (ohne `passwort_hash`) konsistent in Task 4, 5, 7, 8.
- `password::hash`/`password::verifizieren` (Task 4) in Task 5-Tests, 6, 7, 8 identisch.
- `session::anlegen`/`loeschen`/`SESSION_COOKIE`/`neuer_token` (Task 5) in Task 7 verwendet.
- Extractors `CurrentUser`/`AdminUser` (Task 5) in Task 7/8.
- `bootstrap_admin(pool, org_name, admin_user, admin_password: Option<&str>) -> BootstrapErgebnis` (Task 6) in Task 9 + Integrationstests (Task 7/8) identisch aufgerufen.
- SQL-Spaltennamen (`benutzername`, `passwort_hash`, `system_rolle`, `aktiv`, `erstellt_at`) durchgängig gleich zur Migration (Task 3).
- Axum-0.8-Pfadparameter-Syntax `{id}` in Route und `Path<i64>` konsistent (Task 8).

**4. Cookie-Roundtrip:** Das `Set-Cookie` → `Cookie`-Muster ist in `tests/auth.rs` (Task 7) vollständig ausgeschrieben und in `tests/benutzer.rs` (Task 8) erneut vollständig wiederholt (kein „siehe Task 7").

---

## Nächste Pläne (Kontext)

Plan 3 (Einsatz & Rollen) setzt hierauf auf: Einsatz-CRUD, Lebenszyklus (aktiv → abgeschlossen), Einsatz-Mitgliedschaften und die Einsatz-Rollen (Einsatzleitung/Führungspersonal/Beobachter) inklusive einsatzbezogener Autorisierung. Die hier gebauten Bausteine (`AppError`, `CurrentUser`, Session-Auth, `Benutzer`) werden dort wiederverwendet.
