# Auth-Provider-System — Increment 1 (Fundament) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Provider-Abstraktion einziehen, über die der heutige Passwort-Login und der bestehende Dev-Seed-Login als serverweit an-/abschaltbare „Auth-Provider" erscheinen — ohne Verhaltenswechsel am Login selbst.

**Architecture:** Alle Login-Wege konvergieren weiterhin auf das bestehende Session-Modell (`session::anlegen` → opakes Token → Cookie). Die **konfigurierte** Provider-Menge lebt im Code (`registry::konfiguriert`, abhängig vom `dev-seeds`-Feature); die Tabelle `auth_provider` hält nur **Override-Zustände** (fehlt eine Zeile → Default „aktiviert"). Eine Registry (`src/auth/provider/registry.rs`) ist die Wahrheitsquelle, welche Provider verfügbar/aktiviert sind, und erzwingt einen Aussperr-Guard. Der heutige Passwort-Login wird verhaltensneutral nach `src/auth/provider/password.rs` extrahiert. `GET /api/auth/providers` speist die Login-UI, `PUT /api/auth/providers/{id}` (Admin) schaltet Provider.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa/ToSchema), React/TypeScript (antd), OpenAPI-Codegen (`openapi-typescript`).

## Global Constraints

- **Migrationsnummer beim Start prüfen:** höchste Datei in `migrations/` ist `0082_*`. Neue Migration = `0083_*`, aber gegen den dann aktuellen Stand gegenprüfen (parallele Branches kollidieren; `sqlx` bricht bei doppelter `version`). Verbatim-Wert hier: `migrations/0083_auth_provider.sql`.
- **Migration additiv:** nur `ADD COLUMN` + `CREATE TABLE` + `CREATE INDEX`. **Kein** `benutzer`-Rebuild in Increment 1. `benutzer.passwort_hash` bleibt `NOT NULL` (nullable erst in Increment 3, wenn JIT-SSO-Nutzer ohne Passwort entstehen).
- **Registry self-contained:** Kein Startup-Reconcile nötig — `liste`/`schalten` leiten die konfigurierte Menge aus dem Code ab (`auth_provider` ist reine Override-Tabelle mit Default „aktiviert"). Das hält Tests (`common::setup` reconcilet nicht) und Produktion konsistent.
- **sqlx 0.9 `SqlSafeStr`:** `query`/`query_as` nehmen nur `&'static str`; **kein** `format!`-SQL (bricht E0277). Spaltenlisten je Query als Literal.
- **Rust-Gate:** `cargo test` (nicht fmt/clippy). Nach jeder Task `cargo fmt --all` pflegen. Exit-Codes ehrlich prüfen (`rtk proxy <cmd>` bzw. nicht in `| tail` maskieren).
- **Typ-Codegen-Gate:** neue `#[derive(ToSchema)]`-Response-DTOs müssen in `src/api_doc.rs` (Schemas-Liste) stehen; danach `scripts/check-typ-codegen.sh` laufen lassen und regenerierte `frontend/src/api/openapi.json` + `frontend/src/api/types.generated.ts` mitcommitten.
- **Enum-Wire-Kontrakt:** neue Domänen-Enums mit `#[serde(rename_all = "snake_case")]` UND passendem `as_str()`; jede Variante muss in `tests/enum_wire_kontrakt.rs` über das `wire_eq!`-Makro stehen (vergleicht serde-Wire gegen `as_str()`).
- **Frontend-Gates:** `pnpm lint` läuft mit `--max-warnings 0`. `tsc --noEmit` ist eigenes Gate (lib ES2020 — keine ES2022-APIs). Volle Vitest-Suite via `--no-file-parallelism`. Node/pnpm über `mise exec pnpm@<ver> -- pnpm -C <abs-pfad> …` (absolute `-C`-Pfade).
- **Frontend im Binary eingebettet:** UI-Sichtprüfung braucht `pnpm build` + Backend-Neustart (rust-embed). Für Vitest nicht nötig.
- **Scope-Grenzen Increment 1 (NICHT enthalten):** TLS/HTTPS, echter OIDC-Flow, WebAuthn-Kryptografie, TOTP-Login-Flow (nur Schema-Spalten werden angelegt), graphische Admin-Toggle-UI (nur Toggle-API + Guard). `passwort_hash`-nullable.

---

## File Structure

**Backend (neu):**
- `migrations/0083_auth_provider.sql` — additive Schema-Erweiterung.
- `src/auth/provider/mod.rs` — `AuthProviderTyp`-Enum (+ `as_str`), `AuthProviderAnzeige`-DTO, Provider-ID-Konstanten, Re-Exports.
- `src/auth/provider/registry.rs` — konfigurierte Menge, Auflisten (Override-Default), Aussperr-Guard, Toggle (Upsert).
- `src/auth/provider/password.rs` — extrahierter Passwort-Login (verhaltensneutral).

**Backend (geändert):**
- `src/auth/mod.rs` — `pub mod provider;`.
- `src/routes/auth.rs` — `login` ruft `provider::password::anmelden`; neue Handler `providers` (Liste) + `provider_schalten` (Toggle).
- `src/app.rs` — Routen `GET /api/auth/providers`, `PUT /api/auth/providers/{id}`.
- `src/api_doc.rs` — `AuthProviderAnzeige` + `AuthProviderTyp` in die Schemas-Liste.
- `tests/enum_wire_kontrakt.rs` — `AuthProviderTyp`-Varianten (Import + `wire_eq!`).
- `tests/auth.rs` — Integrationstests für Liste + Toggle + Guard-HTTP-Wiring.

**Frontend (geändert):**
- `frontend/src/api/auth.ts` — `providerListe()`.
- `frontend/src/api/types.ts` — Re-Export `AuthProvider`/`AuthProviderTyp`.
- `frontend/src/api/openapi.json` + `types.generated.ts` — regeneriert (Codegen).
- `frontend/src/pages/LoginPage.tsx` — rendert Passwort-Block bedingt aus `/api/auth/providers`.

---

## Task 1: Additive Schema-Migration

**Files:**
- Create: `migrations/0083_auth_provider.sql`
- Test: `src/db.rs` (neuer `#[tokio::test]` im bestehenden `tests`-Modul)

**Interfaces:**
- Produces: Tabellen `auth_provider(id TEXT PK, aktiviert INTEGER)`, `webauthn_credential`, `totp_recovery_code`; neue `benutzer`-Spalten `oidc_subject`, `oidc_issuer`, `totp_secret`, `totp_aktiviert`; partieller Unique-Index `idx_benutzer_oidc`.

- [ ] **Step 1: Migration schreiben**

Create `migrations/0083_auth_provider.sql`:

```sql
-- Auth-Provider-Fundament (LFH-57). Rein additiv: benutzer wird NICHT rebuildt,
-- passwort_hash bleibt NOT NULL bis Increment 3 (JIT-SSO ohne Passwort).

-- Anhängbare Credential-/Identitäts-Spalten am bestehenden Konto.
ALTER TABLE benutzer ADD COLUMN oidc_subject  TEXT;
ALTER TABLE benutzer ADD COLUMN oidc_issuer   TEXT;
ALTER TABLE benutzer ADD COLUMN totp_secret   TEXT;
ALTER TABLE benutzer ADD COLUMN totp_aktiviert INTEGER NOT NULL DEFAULT 0;

-- Eine SSO-Identität (issuer+sub) darf höchstens einem Konto gehören.
-- Partiell, damit viele Konten ohne SSO (NULL) koexistieren.
CREATE UNIQUE INDEX idx_benutzer_oidc
    ON benutzer(oidc_issuer, oidc_subject)
    WHERE oidc_subject IS NOT NULL;

-- Lokale Passkeys (Increment 4 füllt sie; Schema hier vorbereitet).
CREATE TABLE webauthn_credential (
    id            INTEGER PRIMARY KEY,
    benutzer_id   INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    credential_id BLOB NOT NULL UNIQUE,
    public_key    BLOB NOT NULL,
    sign_count    INTEGER NOT NULL DEFAULT 0,
    label         TEXT,
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webauthn_credential_benutzer ON webauthn_credential(benutzer_id);

-- Einmalige TOTP-Recovery-Codes (Increment 5 füllt sie; gehasht gespeichert).
CREATE TABLE totp_recovery_code (
    id          INTEGER PRIMARY KEY,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    benutzt_at  TEXT
);
CREATE INDEX idx_totp_recovery_benutzer ON totp_recovery_code(benutzer_id);

-- Serverweiter An/Aus-OVERRIDE je Provider. Fehlt eine Zeile, gilt der Provider
-- als aktiviert (Default). Die konfigurierte Menge lebt im Code (registry::konfiguriert).
CREATE TABLE auth_provider (
    id        TEXT PRIMARY KEY,
    aktiviert INTEGER NOT NULL DEFAULT 1
);
```

- [ ] **Step 2: Failing test schreiben**

In `src/db.rs`, im `#[cfg(test)] mod tests`-Block ans Ende ergänzen:

```rust
#[tokio::test]
async fn migration_0083_legt_auth_provider_schema_an() {
    let pool = test_pool().await;

    // auth_provider-Tabelle existiert und ist leer (Override-Tabelle, kein Reconcile).
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_provider")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);

    // Neue benutzer-Spalten sind vorhanden (Query würde sonst fehlschlagen).
    let cols: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('benutzer') \
         WHERE name IN ('oidc_subject','oidc_issuer','totp_secret','totp_aktiviert')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cols, 4, "vier neue benutzer-Spalten erwartet");

    // Kind-Tabellen existieren.
    for tabelle in ["webauthn_credential", "totp_recovery_code"] {
        let da: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .bind(tabelle)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(da, 1, "Tabelle {tabelle} fehlt");
    }
}
```

- [ ] **Step 3: Test laufen**

Run: `cargo test --lib db::tests::migration_0083 -- --nocapture`
Expected: PASS (die Migration wird von `test_pool` eingespielt; der Test ist der Nachweis).

- [ ] **Step 4: fmt + commit**

```bash
cargo fmt --all
git add migrations/0083_auth_provider.sql src/db.rs
git commit -m "feat(lfh-57): additive Auth-Provider-Schema-Migration (0083)"
```

---

## Task 2: Provider-Typen + Registry + Aussperr-Guard

**Files:**
- Create: `src/auth/provider/mod.rs`, `src/auth/provider/registry.rs`, `src/auth/provider/password.rs` (Platzhalter — in Task 3 gefüllt)
- Modify: `src/auth/mod.rs:1-3` (Modul-Deklaration)

**Interfaces:**
- Produces:
  - `AuthProviderTyp` (enum: `Passwort`, `Dev`) — `Serialize`, `ToSchema`, `snake_case`, mit `as_str()`.
  - `AuthProviderAnzeige { id: String, typ: AuthProviderTyp, anzeigename: String, aktiviert: bool }` — `Serialize`, `ToSchema`.
  - `pub const ID_PASSWORT: &str = "passwort";`, `pub const ID_DEV: &str = "dev";`
  - `registry::liste(pool) -> Result<Vec<AuthProviderAnzeige>, AppError>` — konfigurierte Provider inkl. `aktiviert` (Default true).
  - `registry::schalten(pool, id: &str, aktiviert: bool) -> Result<(), AppError>` — Upsert mit Guard.
- Consumes: `crate::auth::ROLLE_ADMIN`, `crate::error::AppError`.

- [ ] **Step 1: Modul-Deklaration ergänzen**

In `src/auth/mod.rs`, die `pub mod`-Zeilen oben erweitern:

```rust
pub mod bootstrap;
pub mod password;
pub mod provider;
pub mod session;
```

- [ ] **Step 2: `src/auth/provider/mod.rs` + Platzhalter `password.rs` anlegen**

`src/auth/provider/mod.rs`:

```rust
//! Auth-Provider-Fundament (LFH-57): Login-Wege als serverweit an-/abschaltbare
//! Provider. Alle Flows münden weiterhin in `session::anlegen`.
pub mod password;
pub mod registry;

use serde::Serialize;
use utoipa::ToSchema;

/// Stabile Provider-IDs (Primärschlüssel/Override-Key in `auth_provider`).
pub const ID_PASSWORT: &str = "passwort";
pub const ID_DEV: &str = "dev";

/// Art eines Auth-Providers — bestimmt, wie das Frontend den Login rendert.
/// Wire == snake_case (Enum-Wire-Kontrakt).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthProviderTyp {
    /// Lokaler Benutzername+Passwort-Login (heutiger Flow).
    Passwort,
    /// Dev-Schnellanmeldung (nur mit Cargo-Feature `dev-seeds`).
    Dev,
}

impl AuthProviderTyp {
    /// Wire-/DB-Stringrepräsentation. MUSS dem serde-Wire entsprechen (enum_wire_kontrakt).
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthProviderTyp::Passwort => "passwort",
            AuthProviderTyp::Dev => "dev",
        }
    }
}

/// Öffentliche Darstellung eines Providers für die Login-UI (`GET /api/auth/providers`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuthProviderAnzeige {
    /// Stabile ID (z.B. "passwort", "dev").
    pub id: String,
    pub typ: AuthProviderTyp,
    /// Menschenlesbarer Anzeigename für Buttons/Labels.
    pub anzeigename: String,
    pub aktiviert: bool,
}
```

`src/auth/provider/password.rs` (Platzhalter, Task 3 füllt):

```rust
//! Passwort-Provider — Login-Logik (in Task 3 aus routes/auth.rs extrahiert).
```

- [ ] **Step 3: `registry.rs` mit Tests-first anlegen**

```rust
//! Registry: Wahrheitsquelle, welche Provider konfiguriert, verfügbar und
//! aktiviert sind. Erzwingt den Aussperr-Guard beim Deaktivieren.
//!
//! Die *konfigurierte* Menge lebt im Code (`konfiguriert`); `auth_provider` hält
//! nur Override-Zustände (fehlt eine Zeile → Default „aktiviert"). Kein Reconcile nötig.
use super::{AuthProviderAnzeige, AuthProviderTyp, ID_DEV, ID_PASSWORT};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Ob der Dev-Provider im aktuellen Build überhaupt existiert (Compile-Feature).
fn dev_verfuegbar() -> bool {
    cfg!(feature = "dev-seeds")
}

/// Im aktuellen Build konfigurierte Provider-IDs (Quelle der Wahrheit).
fn konfiguriert() -> Vec<&'static str> {
    let mut v = vec![ID_PASSWORT];
    if dev_verfuegbar() {
        v.push(ID_DEV);
    }
    v
}

/// Menge der Provider, über die sich ein Admin verlässlich anmelden kann.
/// Wächst mit OIDC/WebAuthn in späteren Increments. Der Dev-Provider zählt
/// bewusst NICHT dazu (feature-gated, kein Prod-Login-Pfad).
fn ist_admin_tauglich(id: &str) -> bool {
    id == ID_PASSWORT
}

fn anzeigename(id: &str) -> &'static str {
    match id {
        ID_PASSWORT => "Passwort",
        ID_DEV => "Dev-Schnellanmeldung",
        _ => "Unbekannt",
    }
}

fn typ(id: &str) -> AuthProviderTyp {
    match id {
        ID_DEV => AuthProviderTyp::Dev,
        _ => AuthProviderTyp::Passwort,
    }
}

/// Konfigurierte Provider inkl. `aktiviert` (Override aus `auth_provider`, sonst Default true).
pub async fn liste(pool: &SqlitePool) -> Result<Vec<AuthProviderAnzeige>, AppError> {
    let rows: Vec<(String, bool)> = sqlx::query_as("SELECT id, aktiviert FROM auth_provider")
        .fetch_all(pool)
        .await?;
    let override_map: HashMap<String, bool> = rows.into_iter().collect();
    Ok(konfiguriert()
        .into_iter()
        .map(|id| AuthProviderAnzeige {
            typ: typ(id),
            anzeigename: anzeigename(id).to_string(),
            aktiviert: *override_map.get(id).unwrap_or(&true),
            id: id.to_string(),
        })
        .collect())
}

/// Ob `id` deaktiviert werden darf, ohne Admins auszusperren: erlaubt, wenn `id`
/// nicht admin-tauglich ist, ODER kein aktiver Admin existiert, ODER nach dem
/// Deaktivieren noch ein ANDERER aktivierter admin-tauglicher Provider bliebe.
/// `ist_admin_tauglich` ist die einzige Quelle der admin-tauglichen Menge — der
/// Guard wächst automatisch mit, sobald OIDC/WebAuthn dort aufgenommen werden.
async fn darf_deaktivieren(pool: &SqlitePool, id: &str) -> Result<bool, AppError> {
    if !ist_admin_tauglich(id) {
        return Ok(true);
    }
    let aktive_admins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1")
            .bind(crate::auth::ROLLE_ADMIN)
            .fetch_one(pool)
            .await?;
    if aktive_admins == 0 {
        return Ok(true);
    }
    // Bliebe nach dem Deaktivieren noch ein anderer aktivierter admin-tauglicher Provider?
    let liste = liste(pool).await?;
    Ok(liste
        .iter()
        .any(|p| p.id != id && p.aktiviert && ist_admin_tauglich(&p.id)))
}

/// Schaltet einen Provider an/aus (Upsert des Overrides). Verweigert das Aussperren
/// des letzten admin-tauglichen Login-Wegs (analog "letzter aktiver Admin").
pub async fn schalten(pool: &SqlitePool, id: &str, aktiviert: bool) -> Result<(), AppError> {
    if !konfiguriert().contains(&id) {
        return Err(AppError::NotFound);
    }
    if !aktiviert && !darf_deaktivieren(pool, id).await? {
        return Err(AppError::Conflict(
            "Der letzte admin-taugliche Login-Weg kann nicht deaktiviert werden".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES (?, ?) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = excluded.aktiviert",
    )
    .bind(id)
    .bind(aktiviert)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn benutzer(pool: &SqlitePool, benutzername: &str, system_rolle: &str) {
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'X', ?, 'h', ?)",
        )
        .bind(benutzername)
        .bind(system_rolle)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn liste_enthaelt_passwort_default_aktiv() {
        let pool = crate::db::test_pool().await;
        let l = liste(&pool).await.unwrap();
        assert!(
            l.iter().any(|p| p.id == "passwort" && p.aktiviert),
            "passwort ist ohne Override standardmäßig aktiviert"
        );
    }

    #[tokio::test]
    async fn passwort_kann_nicht_deaktiviert_werden_mit_admin() {
        let pool = crate::db::test_pool().await;
        org(&pool).await;
        benutzer(&pool, "admin", "admin").await;
        let err = schalten(&pool, ID_PASSWORT, false).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        // Zustand unverändert aktiviert (kein Override geschrieben).
        assert!(liste(&pool).await.unwrap().iter().any(|p| p.id == "passwort" && p.aktiviert));
    }

    #[tokio::test]
    async fn passwort_deaktivierbar_ohne_aktiven_admin() {
        // Diskriminiert die Guard-Logik: ein tautologischer Query ließe passwort NIE
        // schalten. Korrekt ist es schaltbar, wenn kein Admin ausgesperrt wird.
        let pool = crate::db::test_pool().await;
        org(&pool).await;
        benutzer(&pool, "n", "keiner").await; // kein Admin
        schalten(&pool, ID_PASSWORT, false).await.unwrap();
        assert!(liste(&pool).await.unwrap().iter().any(|p| p.id == "passwort" && !p.aktiviert));
    }

    #[tokio::test]
    async fn unbekannter_provider_ist_not_found() {
        let pool = crate::db::test_pool().await;
        let err = schalten(&pool, "gibtsnicht", false).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }
}
```

- [ ] **Step 4: Tests laufen**

Run: `cargo test --lib auth::provider::registry`
Expected: PASS (4 Tests). `cargo test --lib` insgesamt grün halten.

- [ ] **Step 5: fmt + commit**

```bash
cargo fmt --all
git add src/auth/mod.rs src/auth/provider/
git commit -m "feat(lfh-57): Provider-Registry (Override-Default) + Aussperr-Guard"
```

---

## Task 3: Passwort-Login verhaltensneutral extrahieren

**Files:**
- Modify: `src/auth/provider/password.rs` (füllen)
- Modify: `src/routes/auth.rs:28-54` (`login` ruft die extrahierte Funktion)

**Interfaces:**
- Produces: `password::anmelden(pool, benutzername: &str, passwort: &str) -> Result<crate::auth::Benutzer, AppError>` — Lookup + argon2-Verify + User-Enumeration-Schutz; `AppError::Unauthorized` bei Fehlschlag.
- Consumes: `crate::auth::password` (hash/verifizieren), `crate::auth::Benutzer`.

- [ ] **Step 1: Failing test + Implementierung**

`src/auth/provider/password.rs` (ersetzt den Platzhalter):

```rust
//! Passwort-Provider — extrahierte Login-Logik (verhaltensneutral aus routes/auth.rs).
use crate::auth::{password, Benutzer};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Prüft Anmeldedaten und liefert den aktiven Benutzer. `AppError::Unauthorized`
/// bei unbekanntem Benutzer ODER falschem Passwort. Gleicht die Antwortzeit an
/// (Wegwerf-Hash), damit sich existierende Benutzer nicht per Timing enumerieren lassen.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;

    match benutzer {
        Some(b) if password::verifizieren(passwort, &b.passwort_hash) => Ok(b),
        Some(_) => Err(AppError::Unauthorized),
        None => {
            let _ = password::hash(passwort);
            Err(AppError::Unauthorized)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn benutzer_mit_pw(pool: &SqlitePool, pw: &str) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let hash = password::hash(pw).unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', ?, 1)",
        )
        .bind(hash)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn korrektes_passwort_meldet_an() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let b = anmelden(&pool, "max", "geheim123").await.unwrap();
        assert_eq!(b.benutzername, "max");
    }

    #[tokio::test]
    async fn falsches_passwort_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "max", "falsch").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn unbekannter_benutzer_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "niemand", "geheim123").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }
}
```

- [ ] **Step 2: Test laufen (reine Extraktion → grün)**

Run: `cargo test --lib auth::provider::password`
Expected: PASS (3 Tests).

- [ ] **Step 3: `routes/auth.rs::login` auf die Funktion umstellen**

In `src/routes/auth.rs` den `login`-Body ersetzen:

```rust
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let benutzer =
        crate::auth::provider::password::anmelden(&state.pool, &req.benutzername, &req.passwort)
            .await?;

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token));
    Ok((jar, Json(benutzer.anzeige())))
}
```

Nicht mehr genutzten Import `use crate::auth::password;` in `routes/auth.rs` streichen, falls sonst ungenutzt (`cargo build`-Warnung beachten).

- [ ] **Step 4: Login-Integration unverändert grün**

Run: `cargo test --test auth`
Expected: bestehende Login-Tests PASS (Verhaltensneutralität nachgewiesen).

- [ ] **Step 5: fmt + commit**

```bash
cargo fmt --all
git add src/auth/provider/password.rs src/routes/auth.rs
git commit -m "refactor(lfh-57): Passwort-Login in password-Provider extrahieren (neutral)"
```

---

## Task 4: `GET /api/auth/providers` + Schema-Registrierung + Enum-Kontrakt

**Files:**
- Modify: `src/routes/auth.rs` (Handler `providers`)
- Modify: `src/app.rs:41-43` (Route eintragen)
- Modify: `src/api_doc.rs:13-15` (Schemas ergänzen)
- Modify: `tests/enum_wire_kontrakt.rs`
- Modify: `tests/auth.rs` (Integrationstest)

**Interfaces:**
- Consumes: `registry::liste`.
- Produces: `GET /api/auth/providers -> Json<Vec<AuthProviderAnzeige>>` (öffentlich, kein Auth).

- [ ] **Step 1: Handler schreiben**

In `src/routes/auth.rs` ans Ende ergänzen:

```rust
/// GET /api/auth/providers — verfügbare Login-Provider (öffentlich, für die Login-UI).
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}
```

- [ ] **Step 2: Route eintragen**

In `src/app.rs` bei den `/api/auth/*`-Routen ergänzen:

```rust
        .route("/api/auth/providers", get(routes::auth::providers))
```

- [ ] **Step 3: Schemas registrieren**

In `src/api_doc.rs` in die `schemas(...)`-Liste (alphabetisch bei `crate::auth::*`) einfügen:

```rust
    crate::auth::provider::AuthProviderAnzeige,
    crate::auth::provider::AuthProviderTyp,
```

- [ ] **Step 4: Enum-Wire-Kontrakt ergänzen**

In `tests/enum_wire_kontrakt.rs`:
- Zur `use`-Blockliste hinzufügen: `use lifeline_hub::auth::provider::AuthProviderTyp;`
- Im bestehenden Test `serde_wire_gleich_as_str` einen Block ergänzen (Makro `wire_eq!` vergleicht serde-Wire gegen `as_str()`):

```rust
    // auth-provider
    wire_eq!(AuthProviderTyp::Passwort, AuthProviderTyp::Dev);
```

- [ ] **Step 5: Integrationstest (Liste)**

In `tests/auth.rs` ergänzen (die Datei nutzt bereits `mod common; use common::…`; falls die Helfer `setup`/`anfrage` dort noch nicht importiert sind, den `use common::{…}` erweitern):

```rust
#[tokio::test]
async fn providers_listet_passwort() {
    let app = common::setup().await;
    let (status, json) = common::anfrage(&app, "GET", "/api/auth/providers", "", None).await;
    assert_eq!(status, axum::http::StatusCode::OK);
    let ids: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"passwort"));
}
```

- [ ] **Step 6: Enum-Test + Codegen-Gate + commit**

```bash
cargo test --test enum_wire_kontrakt
cargo test --lib && cargo test --test auth providers_listet_passwort
bash scripts/check-typ-codegen.sh
cargo fmt --all
git add src/routes/auth.rs src/app.rs src/api_doc.rs tests/enum_wire_kontrakt.rs tests/auth.rs frontend/src/api/openapi.json frontend/src/api/types.generated.ts
git commit -m "feat(lfh-57): GET /api/auth/providers + AuthProvider-Schemas + Enum-Kontrakt"
```
Expected: `check-typ-codegen.sh` grün (regenerierte Dateien mitcommittet), `tsc` grün.

---

## Task 5: `PUT /api/auth/providers/{id}` (Admin-Toggle) mit Guard

**Files:**
- Modify: `src/routes/auth.rs` (Handler `provider_schalten` + Request-DTO)
- Modify: `src/app.rs` (Route)
- Modify: `tests/auth.rs` (Integrationstests)

**Interfaces:**
- Consumes: `AdminUser`-Extractor, `registry::schalten`.
- Produces: `PUT /api/auth/providers/{id}` Body `{ "aktiviert": bool }` → aktualisierte Liste.

- [ ] **Step 1: Handler + Request-DTO**

In `src/routes/auth.rs` ergänzen:

```rust
#[derive(Debug, serde::Deserialize)]
pub struct ProviderSchaltenRequest {
    pub aktiviert: bool,
}

/// PUT /api/auth/providers/{id} — Provider an/aus. Admin-only. Guard gegen Aussperren.
pub async fn provider_schalten(
    State(state): State<AppState>,
    _admin: crate::auth::session::AdminUser,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ProviderSchaltenRequest>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    crate::auth::provider::registry::schalten(&state.pool, &id, req.aktiviert).await?;
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}
```

- [ ] **Step 2: Route eintragen**

In `src/app.rs` ergänzen (`put` ist bereits importiert, app.rs:6):

```rust
        .route(
            "/api/auth/providers/{id}",
            put(routes::auth::provider_schalten),
        )
```

- [ ] **Step 3: Integrationstests (HTTP-Wiring + Guard-Surfacing)**

Die **Guard-Kernlogik ist bereits in Task 2 (registry-Unit-Tests) vollständig abgedeckt.** Diese Tests prüfen nur das HTTP-Wiring (Auth-Zwang + korrekte Statuscodes). In `tests/auth.rs`:

```rust
#[tokio::test]
async fn toggle_ohne_admin_session_ist_401() {
    let app = common::setup().await;
    let (status, _) = common::anfrage(
        &app,
        "PUT",
        "/api/auth/providers/passwort",
        "",
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, axum::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_kann_passwort_nicht_deaktivieren_409() {
    let app = common::setup().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = common::anfrage(
        &app,
        "PUT",
        "/api/auth/providers/passwort",
        &admin,
        Some(r#"{"aktiviert":false}"#),
    )
    .await;
    assert_eq!(status, axum::http::StatusCode::CONFLICT);
}
```

- [ ] **Step 4: Tests + commit**

```bash
cargo test --lib && cargo test --test auth
cargo fmt --all
git add src/routes/auth.rs src/app.rs tests/auth.rs
git commit -m "feat(lfh-57): PUT /api/auth/providers/{id} Admin-Toggle mit Aussperr-Guard"
```

---

## Task 6: Frontend — Provider laden + LoginPage bedingt rendern

**Files:**
- Modify: `frontend/src/api/types.ts` (Re-Export)
- Modify: `frontend/src/api/auth.ts` (`providerListe`)
- Modify: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: generiertes `AuthProviderAnzeige` aus `types.generated.ts`.
- Produces: `providerListe(): Promise<AuthProvider[]>`.

- [ ] **Step 1: Typ-Barrel-Re-Export**

In `frontend/src/api/types.ts` ergänzen (an die dort etablierte Re-Export-Form angleichen — Datei kurz lesen; `components`-Alias vorhanden):

```ts
export type AuthProvider = components['schemas']['AuthProviderAnzeige'];
export type AuthProviderTyp = components['schemas']['AuthProviderTyp'];
```

- [ ] **Step 2: API-Funktion**

In `frontend/src/api/auth.ts` den Import um `AuthProvider` erweitern und ergänzen:

```ts
export function providerListe(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers');
}
```

- [ ] **Step 3: Failing Vitest schreiben**

In `frontend/src/pages/LoginPage.test.tsx` (Muster der bestehenden Tests; `providerListe` via `vi.mock('../api/auth', …)` oder Modul-Spy). Kernfall:

```ts
// providerListe → [{id:'passwort',typ:'passwort',anzeigename:'Passwort',aktiviert:true}]
// erwartet: Passwort-Feld sichtbar (findByLabelText('Passwort')).
```

- [ ] **Step 4: LoginPage anpassen**

In `frontend/src/pages/LoginPage.tsx`: Provider laden, Passwort-`<Form>` nur bei aktiviertem `passwort`-Provider rendern. Additiv zum bestehenden Dev-Block:

```tsx
import { providerListe } from '../api/auth';
import type { AuthProvider } from '../api/types';
// ...
const [provider, setProvider] = useState<AuthProvider[]>([]);

useEffect(() => {
  providerListe()
    .then(setProvider)
    // Fehler → Passwort-Login als sicherer Default annehmen.
    .catch(() =>
      setProvider([
        { id: 'passwort', typ: 'passwort', anzeigename: 'Passwort', aktiviert: true },
      ]),
    );
}, []);

const passwortAktiv =
  provider.length === 0 || provider.some((p) => p.typ === 'passwort' && p.aktiviert);
```

Dann das `<Form>…</Form>` in `{passwortAktiv && ( … )}` wrappen. `provider.length === 0` hält das Formular sichtbar, solange die Liste lädt (kein Flackern, kein Aussperren bei Ladefehler).

- [ ] **Step 5: Gates**

```bash
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --no-file-parallelism LoginPage
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend lint
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit
```
Expected: alle grün (`--max-warnings 0`).

- [ ] **Step 6: commit**

```bash
git add frontend/src/api/auth.ts frontend/src/api/types.ts frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat(lfh-57): LoginPage rendert Provider aus /api/auth/providers"
```

---

## Task 7: Voll-Gate + Increment-Abschluss

**Files:** —

- [ ] **Step 1: Backend-Voll-Suite (env-hygienisch)**

Dev-Vars entschärfen (sonst kippen SSRF-/Manifest-Tests), dann volle Suite:

```bash
env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL \
    -u AWS_ALLOW_HTTP cargo test
```
Expected: grün. Zusätzlich mit Dev-Feature, damit der Dev-Provider-Zweig (`dev_verfuegbar`) nicht rottet:
```bash
cargo test --features dev-seeds auth::provider
```
(Erwartung: Registry listet dann zusätzlich `dev`.)

- [ ] **Step 2: Codegen-Drift-Gate**

```bash
bash scripts/check-typ-codegen.sh
```
Expected: keine uncommitteten Änderungen, `tsc` grün.

- [ ] **Step 3: Frontend-Voll-Gate**

```bash
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --no-file-parallelism
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend lint
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit
```

- [ ] **Step 4: Manuelle Sichtprüfung (rust-embed)**

```bash
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend build
cargo run --features dev-seeds
```
Login-Seite: Passwort-Formular + Dev-Schnellanmeldung sichtbar, Login unverändert. `curl -s localhost:8080/api/auth/providers` listet `passwort` (+ `dev`).

- [ ] **Step 5: Increment-Abschluss**

Keine offenen Diffs; `superpowers:requesting-code-review` vor dem Mergen; `superpowers:verification-before-completion` vor jeder „fertig"-Aussage; Board-Status des zugehörigen Subtasks vorwärts.

---

## Self-Review

**Spec coverage (Increment-1-Scope):**
- (a) Datenmodell-Migration → Task 1. ✓ (passwort_hash-nullable bewusst nach Inc 3; im Global-Constraints-Block vermerkt.)
- (b) Provider-Registry → Task 2. ✓
- (c) Passwort→Provider-Refactor (neutral) → Task 3. ✓
- (d) Dev-Provider → über `dev-seeds`-Feature in `konfiguriert`/`liste` (Task 2), Feature-Test Task 7. ✓ (kein Neubau — bestehender Mechanismus wird eingebunden.)
- (e) `GET /api/auth/providers` + Codegen-Gate → Task 4. ✓
- (f) Admin-Toggle + Aussperr-Guard → Task 5 (HTTP) + Task 2 (Guard-Kernlogik, inkl. diskriminierendem Test `passwort_deaktivierbar_ohne_aktiven_admin`). ✓
- (g) LoginPage aus /providers → Task 6. ✓
- Graphische Admin-Toggle-UI → **bewusst deferred** (Toggle-API testbar; UI-Widget = Folgetask mit Admin-Bereich-Exploration).

**Placeholder-Scan:** Konkrete Codeblöcke je Step. Verbleibende „an bestehende Form angleichen"-Hinweise (types.ts-Re-Export-Form Task 6, LoginPage-Test-Mockform Task 6) sind begründet: das exakte FE-Muster liegt in der Datei und soll nicht erraten werden; die Kernlogik ist unabhängig davon testbar.

**Type-Konsistenz:** `AuthProviderTyp`/`AuthProviderAnzeige`, `ID_PASSWORT`/`ID_DEV`, `registry::{konfiguriert,liste,schalten,darf_deaktivieren}`, `password::anmelden` durchgängig gleich benannt; FE `AuthProvider`/`providerListe`. Wire-Strings `passwort`/`dev` in Enum, `as_str()`, Kontrakt-Test und FE-Fallback identisch. Kein Startup-Reconcile mehr referenziert (Registry ist self-contained).
