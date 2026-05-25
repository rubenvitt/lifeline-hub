# Dev-Seeds & Dev-Login-Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Im Entwicklungsmodus reproduzierbare Testdaten seeden und auf der Login-Seite einen Dev-Benutzer-Picker anbieten, der Benutzername+Passwort ins Formular füllt — beides niemals im Production-Binary.

**Architecture:** Zwei unabhängige Gates. Backend: Cargo-Feature `dev-seeds` (Seed-Code + `/api/dev/users` existieren physisch nicht im Release). Frontend: `import.meta.env.DEV` (Picker + Fetch werden per Dead-Code-Elimination aus dem Production-Build entfernt). Eine einzige Seed-Konstante (`SEED_BENUTZER`) ist Source of Truth für Seeding **und** Endpoint.

**Tech Stack:** Rust (axum 0.8, sqlx/SQLite, argon2), React/TypeScript (antd, react-router, MSW + Vitest für Tests).

---

## Hintergrund — bestätigte Fakten aus der Codebase

Diese Fakten wurden vor der Planung verifiziert; sie begründen mehrere Schritte:

- **`dev_seed` muss die Organisation selbst anlegen.** `dev_seed` läuft laut Spec **vor** `bootstrap_admin`. `bootstrap_admin` (`src/auth/bootstrap.rs:34-39`) bricht ab, sobald `COUNT(*) FROM benutzer > 0`, und legt dann **auch keine Organisation** an. Nach `dev_seed` existieren Benutzer → `bootstrap_admin` ist no-op → die Organisation würde fehlen. Deshalb legt `dev_seed` als erstes idempotent eine Organisation an.
- **`config.org_name` wird im Dev-Seed bewusst ignoriert** (fester Seed-Org-Name). Das ist ein bewusster Trade-off und wird in `seed.rs` kommentiert.
- **Die `rolle`-Spalte im Endpoint-JSON ist ein Anzeige-Label** (`"Admin"`, `"Führungskraft"`, `"Benutzer"`), nicht `system_rolle`/`org_rolle`. Die Seed-Konstante trägt dafür ein eigenes Feld `rolle_anzeige`.
- **Seed-Konstante (intern) ≠ Response-Typ (öffentlich).** Die Konstante `DevBenutzer` ist nicht `Serialize` und enthält `system_rolle`/`org_rolle`/`aktiv`. Der Endpoint baut daraus einen separaten `Serialize`-Typ mit nur `benutzername`, `passwort`, `anzeigename`, `rolle` — damit keine internen Rollen nach außen gelangen.
- **`/api/dev/users` ohne Feature → 404.** Der Fallback `static_files::serve` (`src/static_files.rs:91-97`) gibt für alle `/api/`-Pfade explizit 404 JSON zurück, fällt also **nicht** auf das SPA-`index.html` zurück. Der Absenz-Test kann daher 404 erwarten.
- **`scripts/build-release.sh` braucht keine Änderung** — `cargo build --release` ohne `--features` aktiviert nur die (leeren) Default-Features. Wird in Task 10 verifiziert, nicht geändert.
- **MSW läuft mit `onUnhandledRequest: 'error'`** (`frontend/src/test/setup.ts:31`). Jeder Test, der `LoginPage` mit `import.meta.env.DEV === true` rendert, löst zwingend `GET /api/dev/users` aus. **Bestehende Tests** (`LoginPage.test.tsx`, `App.test.tsx`) müssen daher einen Handler für diese Route bekommen, sonst brechen sie.
- **`import.meta.env.DEV` ist in Vitest standardmäßig `true`** — der DEV-Zweig läuft in Tests ohne weiteres Zutun.

## File Structure

**Backend (neu):**
- `src/dev/mod.rs` — Modul-Deklaration (`pub mod seed;`), feature-gegated in `lib.rs`.
- `src/dev/seed.rs` — `DevBenutzer`-Struct, Seed-Konstanten (`SEED_BENUTZER` u.a.), `dev_seed(&pool)` + private Seeding-Helfer.
- `src/routes/dev.rs` — Handler `users()` + öffentlicher `DevBenutzerResponse`-Typ.
- `tests/dev_present.rs` — Integrationstests **mit** Feature (`#![cfg(feature = "dev-seeds")]`).
- `tests/dev_absent.rs` — Absenz-Test **ohne** Feature (`#![cfg(not(feature = "dev-seeds"))]`).

**Backend (geändert):**
- `Cargo.toml` — `[features]`-Sektion mit `dev-seeds = []`.
- `src/lib.rs` — gegate `pub mod dev;`.
- `src/routes/mod.rs` — gegate `pub mod dev;`.
- `src/app.rs` — `build_router` umstrukturiert: gegate Registrierung von `/api/dev/users`.
- `src/main.rs` — gegater `dev_seed`-Aufruf vor `bootstrap_admin`.

**Frontend (neu):**
- `frontend/src/api/dev.ts` — `DevBenutzer`-Typ + `devBenutzerLaden()`.

**Frontend (geändert):**
- `frontend/src/pages/LoginPage.tsx` — `Form.useForm()`-Instanz + Dev-Picker hinter `import.meta.env.DEV`.
- `frontend/src/pages/LoginPage.test.tsx` — bestehender `setup()` bekommt `/api/dev/users`-Handler; zwei neue Tests.
- `frontend/src/App.test.tsx` — `/api/dev/users`-Handler ergänzen.

---

## Task 1: Cargo-Feature + Seed-Modul-Gerüst mit Benutzer-Konstante

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/lib.rs`
- Create: `src/dev/mod.rs`
- Create: `src/dev/seed.rs`

- [ ] **Step 1: `[features]`-Sektion in `Cargo.toml` ergänzen**

In `Cargo.toml` direkt **nach** dem `[dependencies]`-Block (vor `[dev-dependencies]`) einfügen:

```toml
[features]
# Dev-only: aktiviert Seed-Testdaten und den /api/dev/users-Endpoint.
# Niemals im Release-Build aktivieren (kein Default-Feature).
dev-seeds = []
```

- [ ] **Step 2: Modul feature-gegated in `lib.rs` registrieren**

In `src/lib.rs` nach `pub mod db;` einfügen (alphabetische Nähe zu `db`):

```rust
#[cfg(feature = "dev-seeds")]
pub mod dev;
```

- [ ] **Step 3: `src/dev/mod.rs` anlegen**

```rust
pub mod seed;
```

- [ ] **Step 4: `src/dev/seed.rs` mit Struct, Benutzer-Konstante und Test anlegen**

```rust
use crate::auth::{
    ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};

/// Ein Seed-Benutzer. **Interne** Struktur — bewusst NICHT `Serialize`:
/// `system_rolle`/`org_rolle` dürfen nicht über den Dev-Endpoint nach außen.
/// Für die Endpoint-Antwort gibt es den separaten `DevBenutzerResponse`-Typ.
pub struct DevBenutzer {
    pub benutzername: &'static str,
    /// Einheitliches Klartext-Dev-Passwort (siehe SEED_PASSWORT).
    pub passwort: &'static str,
    pub anzeigename: &'static str,
    pub system_rolle: &'static str,
    pub org_rolle: &'static str,
    /// Menschenlesbares Rollen-Label, nur für die Anzeige im Login-Picker.
    pub rolle_anzeige: &'static str,
    pub aktiv: bool,
}

/// Einheitliches Dev-Passwort für alle Seed-Benutzer.
pub const SEED_PASSWORT: &str = "dev";

/// Source of Truth für Seeding UND /api/dev/users. Nur hier gepflegt.
pub const SEED_BENUTZER: &[DevBenutzer] = &[
    DevBenutzer {
        benutzername: "admin",
        passwort: SEED_PASSWORT,
        anzeigename: "Administrator",
        system_rolle: ROLLE_ADMIN,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Admin",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "leitung",
        passwort: SEED_PASSWORT,
        anzeigename: "Führungskraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_FUEHRUNGSKRAFT,
        rolle_anzeige: "Führungskraft",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "mitglied",
        passwort: SEED_PASSWORT,
        anzeigename: "Einsatzkraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "inaktiv",
        passwort: SEED_PASSWORT,
        anzeigename: "Gesperrtes Konto",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: false,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_benutzer_enthaelt_erwartete_konten() {
        let namen: Vec<&str> = SEED_BENUTZER.iter().map(|b| b.benutzername).collect();
        assert!(namen.contains(&"admin"));
        assert!(namen.contains(&"leitung"));
        assert!(namen.contains(&"mitglied"));
        assert!(namen.contains(&"inaktiv"));
        // Einheitliches Dev-Passwort für alle.
        assert!(SEED_BENUTZER.iter().all(|b| b.passwort == "dev"));
        // 'inaktiv' ist nicht aktiv (Test der Login-Sperre).
        let inaktiv = SEED_BENUTZER
            .iter()
            .find(|b| b.benutzername == "inaktiv")
            .unwrap();
        assert!(!inaktiv.aktiv);
    }
}
```

- [ ] **Step 5: Test laufen lassen — muss grün sein**

Run: `cargo test --features dev-seeds seed::tests::seed_benutzer_enthaelt_erwartete_konten`
Expected: PASS (1 passed). Ohne `--features dev-seeds` existiert das Modul nicht.

- [ ] **Step 6: Sicherstellen, dass der Default-Build (ohne Feature) noch kompiliert**

Run: `cargo build`
Expected: erfolgreicher Build, keine Warnungen zu `dev`.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src/lib.rs src/dev/mod.rs src/dev/seed.rs
git commit -m "feat(dev-seeds): Cargo-Feature und Seed-Benutzer-Konstante"
```

---

## Task 2: dev_seed — Organisation + Benutzer (idempotent)

**Files:**
- Modify: `src/dev/seed.rs`

- [ ] **Step 1: Idempotenz-Test für Organisation + Benutzer schreiben**

In `src/dev/seed.rs` den `#[cfg(test)] mod tests`-Block um diesen Test erweitern (innerhalb von `mod tests`, nach dem bestehenden Test):

```rust
    #[tokio::test]
    async fn org_und_benutzer_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;

        dev_seed(&pool).await.unwrap();
        dev_seed(&pool).await.unwrap();

        // Genau eine Organisation, egal wie oft geseedet wird.
        let orgs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organisation")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(orgs, 1);

        // Alle vier Seed-Benutzer, keine Duplikate.
        let benutzer: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(benutzer, 4);

        // 'admin' hat system_rolle 'admin', 'leitung' org_rolle 'fuehrungskraft'.
        let admin_rolle: String =
            sqlx::query_scalar("SELECT system_rolle FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(admin_rolle, "admin");
        let leitung_org: String =
            sqlx::query_scalar("SELECT org_rolle FROM benutzer WHERE benutzername = 'leitung'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leitung_org, "fuehrungskraft");

        // 'inaktiv' ist aktiv=0 (Login-Sperre testbar).
        let inaktiv_aktiv: i64 =
            sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE benutzername = 'inaktiv'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(inaktiv_aktiv, 0);

        // Geseedetes Passwort ist 'dev' (verifizierbar gegen den Hash).
        let hash: String =
            sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(crate::auth::password::verifizieren("dev", &hash));
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen (Funktion fehlt)**

Run: `cargo test --features dev-seeds seed::tests::org_und_benutzer_seeding_ist_idempotent`
Expected: FAIL — Compile-Fehler `cannot find function dev_seed in this scope`.

- [ ] **Step 3: Imports und `dev_seed` + Helfer implementieren**

In `src/dev/seed.rs` die oberste `use`-Zeile ergänzen und die Funktionen **vor** dem `#[cfg(test)]`-Block einfügen.

Imports oben in der Datei anpassen zu:

```rust
use crate::auth::{
    password, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};
use crate::error::AppError;
use sqlx::SqlitePool;
```

Funktionen einfügen:

```rust
/// Fester Name der Dev-Organisation. `config.org_name` wird im Dev-Seed
/// bewusst ignoriert — Dev-Daten sollen unabhängig von der Server-Konfiguration
/// reproduzierbar sein.
const SEED_ORG_NAME: &str = "Entwicklung";

/// Legt reproduzierbare Dev-Testdaten an. Idempotent: mehrfacher Aufruf
/// erzeugt keine Duplikate. Wird in `main` VOR `bootstrap_admin` aufgerufen,
/// daher legt diese Funktion die Organisation selbst an.
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
    Ok(())
}

/// Liefert die id der (einzigen) Organisation; legt sie an, falls keine existiert.
async fn organisation_anlegen(pool: &SqlitePool) -> Result<i64, AppError> {
    if let Some(id) =
        sqlx::query_scalar::<_, i64>("SELECT id FROM organisation ORDER BY id LIMIT 1")
            .fetch_optional(pool)
            .await?
    {
        return Ok(id);
    }
    let id = sqlx::query_scalar::<_, i64>("INSERT INTO organisation (name) VALUES (?) RETURNING id")
        .bind(SEED_ORG_NAME)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

/// Seedet die `SEED_BENUTZER`. Idempotent über den natürlichen Schlüssel
/// `benutzername`: existiert der Benutzer bereits, wird übersprungen (und das
/// teure Argon2-Hashing gar nicht erst ausgeführt).
async fn benutzer_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for b in SEED_BENUTZER {
        let existiert: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM benutzer WHERE benutzername = ?")
                .bind(b.benutzername)
                .fetch_optional(pool)
                .await?;
        if existiert.is_some() {
            continue;
        }
        let hash = password::hash(b.passwort)?;
        sqlx::query(
            "INSERT INTO benutzer \
                (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(b.anzeigename)
        .bind(b.benutzername)
        .bind(&hash)
        .bind(b.system_rolle)
        .bind(b.org_rolle)
        .bind(b.aktiv)
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

Hinweis: Die `use ... ROLLE_ADMIN`-Importe werden weiterhin von der `SEED_BENUTZER`-Konstante genutzt; `password`, `AppError`, `SqlitePool` kommen neu hinzu.

- [ ] **Step 4: Test ausführen — muss grün sein**

Run: `cargo test --features dev-seeds seed::tests::org_und_benutzer_seeding_ist_idempotent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dev/seed.rs
git commit -m "feat(dev-seeds): Organisation und Benutzer idempotent seeden"
```

---

## Task 3: dev_seed — Einsätze (idempotent)

**Files:**
- Modify: `src/dev/seed.rs`

- [ ] **Step 1: Idempotenz-Test für Einsätze schreiben**

In `mod tests` ergänzen:

```rust
    #[tokio::test]
    async fn einsatz_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool).await.unwrap();
        dev_seed(&pool).await.unwrap();

        let einsaetze: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(einsaetze, 3);

        // Ein aktiver und ein abgeschlossener Einsatz sind enthalten.
        let aktiv: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE status = 'aktiv'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(aktiv, 2);
        let abgeschlossen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE status = 'abgeschlossen'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(abgeschlossen, 1);
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --features dev-seeds seed::tests::einsatz_seeding_ist_idempotent`
Expected: FAIL — `assert_eq!(einsaetze, 3)` schlägt fehl (0 angelegt), da Einsätze noch nicht geseedet werden.

- [ ] **Step 3: Einsatz-Konstante + Seeding implementieren**

In `src/dev/seed.rs` die Konstante (z.B. direkt nach `SEED_BENUTZER`) und den Helfer (vor `#[cfg(test)]`) einfügen:

```rust
/// Seed-Einsätze: (bezeichnung, stichwort, status). `bezeichnung` ist der
/// natürliche Schlüssel für die Idempotenz.
const SEED_EINSAETZE: &[(&str, &str, &str)] = &[
    ("Übung Hochwasser", "THW-Übung", "aktiv"),
    ("Verkehrsunfall B27", "VU/Person", "aktiv"),
    ("Sturmtief Abschluss", "Unwetter", "abgeschlossen"),
];

/// Seedet die `SEED_EINSAETZE`. Idempotent: nur fehlende `bezeichnung`en anlegen.
async fn einsaetze_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for &(bezeichnung, stichwort, status) in SEED_EINSAETZE {
        let existiert: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM einsatz WHERE bezeichnung = ?")
                .bind(bezeichnung)
                .fetch_optional(pool)
                .await?;
        if existiert.is_some() {
            continue;
        }
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, stichwort, status) VALUES (?, ?, ?, ?)")
            .bind(org_id)
            .bind(bezeichnung)
            .bind(stichwort)
            .bind(status)
            .execute(pool)
            .await?;
    }
    Ok(())
}
```

- [ ] **Step 4: Aufruf in `dev_seed` ergänzen**

`dev_seed` so erweitern:

```rust
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
    einsaetze_seeden(pool, org_id).await?;
    Ok(())
}
```

- [ ] **Step 5: Test ausführen — muss grün sein**

Run: `cargo test --features dev-seeds seed::tests::einsatz_seeding_ist_idempotent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dev/seed.rs
git commit -m "feat(dev-seeds): Einsätze idempotent seeden"
```

---

## Task 4: dev_seed — Mitgliedschaften (idempotent)

**Files:**
- Modify: `src/dev/seed.rs`

- [ ] **Step 1: Idempotenz-Test für Mitgliedschaften schreiben**

In `mod tests` ergänzen:

```rust
    #[tokio::test]
    async fn mitgliedschaft_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool).await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_mitgliedschaft")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool).await.unwrap();
        let n2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_mitgliedschaft")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n1, n2, "zweiter Seed-Lauf darf keine Duplikate erzeugen");
        assert!(n1 > 0, "es müssen Mitgliedschaften angelegt werden");

        // 'leitung' ist Einsatzleitung in 'Übung Hochwasser'.
        let rolle: String = sqlx::query_scalar(
            "SELECT m.einsatz_rolle FROM einsatz_mitgliedschaft m \
             JOIN einsatz e ON e.id = m.einsatz_id \
             JOIN benutzer b ON b.id = m.benutzer_id \
             WHERE e.bezeichnung = 'Übung Hochwasser' AND b.benutzername = 'leitung'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rolle, "einsatzleitung");
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --features dev-seeds seed::tests::mitgliedschaft_seeding_ist_idempotent`
Expected: FAIL — `assert!(n1 > 0)` schlägt fehl (keine Mitgliedschaften angelegt).

- [ ] **Step 3: Mitgliedschafts-Konstante + Seeding implementieren**

Konstante und Helfer in `src/dev/seed.rs` einfügen:

```rust
/// Seed-Mitgliedschaften: (einsatz_bezeichnung, benutzername, einsatz_rolle).
/// einsatz_rolle ∈ {einsatzleitung, fuehrungspersonal, beobachter}.
const SEED_MITGLIEDSCHAFTEN: &[(&str, &str, &str)] = &[
    ("Übung Hochwasser", "leitung", "einsatzleitung"),
    ("Übung Hochwasser", "mitglied", "beobachter"),
    ("Übung Hochwasser", "admin", "fuehrungspersonal"),
    ("Verkehrsunfall B27", "leitung", "einsatzleitung"),
    ("Verkehrsunfall B27", "mitglied", "fuehrungspersonal"),
];

/// Seedet die `SEED_MITGLIEDSCHAFTEN`. Idempotent über den Primärschlüssel
/// `(einsatz_id, benutzer_id)` via `ON CONFLICT DO NOTHING`.
async fn mitgliedschaften_seeden(pool: &SqlitePool) -> Result<(), AppError> {
    for &(einsatz_bez, benutzername, rolle) in SEED_MITGLIEDSCHAFTEN {
        let einsatz_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE bezeichnung = ?")
                .bind(einsatz_bez)
                .fetch_optional(pool)
                .await?;
        let benutzer_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
                .bind(benutzername)
                .fetch_optional(pool)
                .await?;
        let (Some(einsatz_id), Some(benutzer_id)) = (einsatz_id, benutzer_id) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(rolle)
        .execute(pool)
        .await?;
    }
    Ok(())
}
```

- [ ] **Step 4: Aufruf in `dev_seed` ergänzen**

```rust
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
    einsaetze_seeden(pool, org_id).await?;
    mitgliedschaften_seeden(pool).await?;
    Ok(())
}
```

- [ ] **Step 5: Test ausführen — muss grün sein**

Run: `cargo test --features dev-seeds seed::tests::mitgliedschaft_seeding_ist_idempotent`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dev/seed.rs
git commit -m "feat(dev-seeds): Einsatz-Mitgliedschaften idempotent seeden"
```

---

## Task 5: dev_seed — ETB-Einträge (idempotent, lfd_nr lückenlos)

**Files:**
- Modify: `src/dev/seed.rs`

- [ ] **Step 1: Idempotenz- + Lückenlosigkeits-Test schreiben**

In `mod tests` ergänzen:

```rust
    #[tokio::test]
    async fn etb_seeding_ist_idempotent_und_lfd_nr_lueckenlos() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool).await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool).await.unwrap();
        let n2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n1, n2, "zweiter Seed-Lauf darf keine ETB-Duplikate erzeugen");
        assert!(n1 > 0, "es müssen ETB-Einträge angelegt werden");

        // lfd_nr lückenlos ab 1 pro Einsatz: COUNT == MAX(lfd_nr).
        let gruppen: Vec<(i64, i64, i64)> = sqlx::query_as(
            "SELECT einsatz_id, COUNT(*) AS anzahl, MAX(lfd_nr) AS maxnr \
             FROM etb_eintrag GROUP BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for (einsatz_id, anzahl, maxnr) in gruppen {
            assert_eq!(anzahl, maxnr, "lfd_nr in Einsatz {einsatz_id} nicht lückenlos");
        }
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --features dev-seeds seed::tests::etb_seeding_ist_idempotent_und_lfd_nr_lueckenlos`
Expected: FAIL — `assert!(n1 > 0)` schlägt fehl (keine ETB-Einträge).

- [ ] **Step 3: ETB-Konstante + Seeding implementieren**

Konstante und Helfer in `src/dev/seed.rs` einfügen:

```rust
/// Seed-ETB-Einträge: (einsatz_bezeichnung, typ, inhalt, erfasser_benutzername,
/// ereigniszeit). typ ∈ {meldung, anordnung, lage, ...}. Reihenfolge bestimmt
/// die lfd_nr innerhalb eines Einsatzes (ab 1, lückenlos).
const SEED_ETB: &[(&str, &str, &str, &str, &str)] = &[
    (
        "Übung Hochwasser",
        "lage",
        "Deich bei km 12 wird beobachtet, Pegel steigt langsam.",
        "leitung",
        "2026-05-25 08:00:00",
    ),
    (
        "Übung Hochwasser",
        "meldung",
        "Sandsackfüllstelle am Bauhof eingerichtet.",
        "mitglied",
        "2026-05-25 08:15:00",
    ),
    (
        "Übung Hochwasser",
        "anordnung",
        "Trupp 1 zur Deichsicherung an km 12 entsenden.",
        "leitung",
        "2026-05-25 08:20:00",
    ),
    (
        "Verkehrsunfall B27",
        "meldung",
        "PKW gegen Baum, eine Person eingeklemmt.",
        "leitung",
        "2026-05-25 09:30:00",
    ),
    (
        "Verkehrsunfall B27",
        "lage",
        "Rettungsdienst und Feuerwehr vor Ort, Bergung läuft.",
        "mitglied",
        "2026-05-25 09:35:00",
    ),
];

/// Seedet die `SEED_ETB`. Idempotent pro Einsatz: nur anlegen, wenn der
/// Einsatz noch KEINE Einträge hat (so bleibt lfd_nr lückenlos ab 1).
async fn etb_seeden(pool: &SqlitePool) -> Result<(), AppError> {
    for &(einsatz_bez, _, _) in SEED_EINSAETZE {
        let einsatz_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE bezeichnung = ?")
                .bind(einsatz_bez)
                .fetch_optional(pool)
                .await?;
        let Some(einsatz_id) = einsatz_id else {
            continue;
        };

        let vorhandene: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz_id)
                .fetch_one(pool)
                .await?;
        if vorhandene > 0 {
            continue;
        }

        let mut lfd_nr: i64 = 0;
        for &(bez, typ, inhalt, erfasser, ereigniszeit) in SEED_ETB {
            if bez != einsatz_bez {
                continue;
            }
            let erfasser_id: i64 =
                sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
                    .bind(erfasser)
                    .fetch_one(pool)
                    .await?;
            lfd_nr += 1;
            sqlx::query(
                "INSERT INTO etb_eintrag \
                    (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(lfd_nr)
            .bind(typ)
            .bind(inhalt)
            .bind(erfasser_id)
            .bind(ereigniszeit)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Aufruf in `dev_seed` ergänzen**

```rust
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
    einsaetze_seeden(pool, org_id).await?;
    mitgliedschaften_seeden(pool).await?;
    etb_seeden(pool).await?;
    Ok(())
}
```

- [ ] **Step 5: Test ausführen — muss grün sein**

Run: `cargo test --features dev-seeds seed::tests::etb_seeding_ist_idempotent_und_lfd_nr_lueckenlos`
Expected: PASS.

- [ ] **Step 6: Alle Seed-Tests zusammen laufen lassen**

Run: `cargo test --features dev-seeds seed::tests`
Expected: PASS (5 Tests).

- [ ] **Step 7: Commit**

```bash
git add src/dev/seed.rs
git commit -m "feat(dev-seeds): ETB-Beispieleinträge idempotent seeden"
```

---

## Task 6: Dev-Endpoint `/api/dev/users` + Route-Registrierung

**Files:**
- Create: `src/routes/dev.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Create: `tests/dev_present.rs`
- Create: `tests/dev_absent.rs`

- [ ] **Step 1: Integrationstest MIT Feature schreiben (`tests/dev_present.rs`)**

```rust
#![cfg(feature = "dev-seeds")]

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use lifeline_hub::dev::seed::dev_seed;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt; // stellt `oneshot` bereit

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    dev_seed(&pool).await.unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
    })
}

#[tokio::test]
async fn dev_users_liefert_aktive_benutzer_mit_klartext_passwort() {
    let app = setup().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/dev/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let arr = json.as_array().expect("Array erwartet");

    // 3 aktive Benutzer; 'inaktiv' ist ausgeschlossen.
    assert_eq!(arr.len(), 3);
    assert!(arr.iter().any(|b| b["benutzername"] == "admin"));
    assert!(!arr.iter().any(|b| b["benutzername"] == "inaktiv"));

    // Alle tragen das Klartext-Dev-Passwort 'dev' und ein Anzeige-Label.
    assert!(arr.iter().all(|b| b["passwort"] == "dev"));
    assert!(arr.iter().all(|b| b["rolle"].is_string()));

    // KEINE internen Felder nach außen.
    assert!(arr
        .iter()
        .all(|b| b.get("passwort_hash").is_none() && b.get("system_rolle").is_none()));
}
```

- [ ] **Step 2: Absenz-Test OHNE Feature schreiben (`tests/dev_absent.rs`)**

```rust
#![cfg(not(feature = "dev-seeds"))]

use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use tower::ServiceExt;

#[tokio::test]
async fn dev_users_route_fehlt_ohne_feature() {
    let pool = db::test_pool().await;
    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
    });
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/dev/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    // Fallback gibt für unbekannte /api/-Pfade 404 JSON zurück.
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 3: Tests ausführen — beide müssen fehlschlagen bzw. der Endpoint fehlt**

Run: `cargo test --features dev-seeds --test dev_present`
Expected: FAIL — Compile-Fehler (`routes::dev` existiert nicht / Route nicht registriert).

Run: `cargo test --test dev_absent`
Expected: PASS bereits jetzt (Route gibt es nicht → 404). Dieser Test sichert nur ab, dass das so bleibt.

- [ ] **Step 4: Handler `src/routes/dev.rs` anlegen**

```rust
use crate::dev::seed::SEED_BENUTZER;
use axum::Json;
use serde::Serialize;

/// Öffentliche Dev-Benutzer-Darstellung für den Login-Picker. Bewusst NUR
/// Anzeige-Felder plus das bekannte Klartext-Dev-Passwort — `system_rolle`/
/// `org_rolle` bleiben intern und werden NICHT serialisiert.
#[derive(Debug, Serialize)]
pub struct DevBenutzerResponse {
    pub benutzername: &'static str,
    pub passwort: &'static str,
    pub anzeigename: &'static str,
    /// Menschenlesbares Rollen-Label (z.B. "Admin").
    pub rolle: &'static str,
}

/// GET /api/dev/users — nur mit Feature `dev-seeds` registriert.
/// Liefert die **aktiven** Seed-Benutzer mit Klartext-Dev-Passwort. Quelle ist
/// dieselbe Konstante wie beim Seeding (`SEED_BENUTZER`), kein zweiter Pflegeort.
/// Keine Authentifizierung (existiert nur im Dev-Build).
pub async fn users() -> Json<Vec<DevBenutzerResponse>> {
    let liste = SEED_BENUTZER
        .iter()
        .filter(|b| b.aktiv)
        .map(|b| DevBenutzerResponse {
            benutzername: b.benutzername,
            passwort: b.passwort,
            anzeigename: b.anzeigename,
            rolle: b.rolle_anzeige,
        })
        .collect();
    Json(liste)
}
```

- [ ] **Step 5: Modul gegated in `src/routes/mod.rs` registrieren**

Am Ende von `src/routes/mod.rs` ergänzen:

```rust
#[cfg(feature = "dev-seeds")]
pub mod dev;
```

- [ ] **Step 6: `build_router` in `src/app.rs` umstrukturieren**

`src/app.rs` ab Zeile 17 (die Funktion `build_router`) durch diese Fassung ersetzen — der bestehende Routen-Block bleibt unverändert, nur das abschließende `.fallback(...).with_state(...)` wird abgetrennt und die gegate Route dazwischen eingefügt:

```rust
/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand.
pub fn build_router(state: AppState) -> Router {
    let router = Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/backup", get(routes::backup::download))
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/benutzer", get(routes::benutzer::liste))
        .route("/api/benutzer", post(routes::benutzer::anlegen))
        .route(
            "/api/benutzer/{id}/deaktivieren",
            post(routes::benutzer::deaktivieren),
        )
        .route("/api/einsaetze", get(routes::einsatz::liste))
        .route("/api/einsaetze", post(routes::einsatz::anlegen))
        .route("/api/einsaetze/{id}", get(routes::einsatz::detail))
        .route(
            "/api/einsaetze/{id}/abschliessen",
            post(routes::einsatz::abschliessen),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder",
            get(routes::einsatz::mitglieder),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            put(routes::einsatz::mitglied_setzen),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            delete(routes::einsatz::mitglied_entfernen),
        )
        .route("/api/einsaetze/{id}/etb", post(routes::etb::erfassen))
        .route("/api/einsaetze/{id}/etb", get(routes::etb::liste))
        .route("/api/einsaetze/{id}/etb/stream", get(routes::etb::stream));

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    router
        .fallback(crate::static_files::serve)
        .with_state(state)
}
```

- [ ] **Step 7: Beide Tests ausführen**

Run: `cargo test --features dev-seeds --test dev_present`
Expected: PASS.

Run: `cargo test --test dev_absent`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/dev.rs src/routes/mod.rs src/app.rs tests/dev_present.rs tests/dev_absent.rs
git commit -m "feat(dev-seeds): /api/dev/users-Endpoint hinter Feature-Gate"
```

---

## Task 7: dev_seed in `main.rs` verdrahten (vor bootstrap_admin)

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: Gegaten `dev_seed`-Aufruf einfügen**

In `src/main.rs`, in `run_server`, direkt **nach** `db::migrate(&pool).await?;` (aktuell Zeile 32) und **vor** dem `bootstrap_admin`-Aufruf einfügen:

```rust
    // Dev-only: reproduzierbare Testdaten seeden, BEVOR bootstrap_admin läuft.
    // Danach existieren Benutzer → bootstrap_admin ist no-op (legt auch keine
    // Organisation an; deshalb macht dev_seed das selbst).
    #[cfg(feature = "dev-seeds")]
    {
        lifeline_hub::dev::seed::dev_seed(&pool).await?;
        tracing::warn!(
            "dev-seeds AKTIV: Testdaten geseedet, /api/dev/users verfügbar — NIEMALS in Production!"
        );
    }
```

- [ ] **Step 2: Build mit Feature prüfen**

Run: `cargo build --features dev-seeds`
Expected: erfolgreicher Build, keine Warnungen.

- [ ] **Step 3: Build ohne Feature prüfen**

Run: `cargo build`
Expected: erfolgreicher Build (der `#[cfg]`-Block entfällt vollständig), keine ungenutzten Imports.

- [ ] **Step 4: Manuell-funktionaler Smoke-Test (optional, empfohlen)**

Run: `cargo run --features dev-seeds -- --db-path /tmp/lifeline-dev-smoke.db --bind 127.0.0.1:8099 &` dann
`curl -s http://127.0.0.1:8099/api/dev/users` → JSON-Array mit `admin`/`leitung`/`mitglied` (ohne `inaktiv`), danach Prozess beenden und `/tmp/lifeline-dev-smoke.db*` löschen.
Expected: 3 Einträge mit `"passwort":"dev"`.

- [ ] **Step 5: Commit**

```bash
git add src/main.rs
git commit -m "feat(dev-seeds): dev_seed vor bootstrap_admin aufrufen (feature-gegated)"
```

---

## Task 8: Frontend — Dev-API-Helfer `api/dev.ts`

**Files:**
- Create: `frontend/src/api/dev.ts`

- [ ] **Step 1: Helfer + Typ anlegen**

```ts
import { apiGet } from './client';

/** Dev-Benutzer, wie vom feature-gegateten `/api/dev/users` geliefert.
 *  Spiegelt das Backend-`DevBenutzerResponse`. */
export interface DevBenutzer {
  benutzername: string;
  passwort: string;
  anzeigename: string;
  /** Menschenlesbares Rollen-Label, z.B. "Admin". */
  rolle: string;
}

/** Lädt die aktiven Dev-Benutzer. Wirft `ApiError` (z.B. 404, wenn das
 *  Backend ohne Feature läuft) — Aufrufer ignorieren das still. */
export function devBenutzerLaden(): Promise<DevBenutzer[]> {
  return apiGet<DevBenutzer[]>('/api/dev/users');
}
```

- [ ] **Step 2: Typecheck + Lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/dev.ts
git commit -m "feat(dev-seeds): Frontend-Helfer devBenutzerLaden"
```

---

## Task 9: Frontend — LoginPage-Picker + Form-Instanz

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/LoginPage.test.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Bestehende Tests gegen den neuen Fetch absichern**

Weil MSW mit `onUnhandledRequest: 'error'` läuft und `LoginPage` ab jetzt im DEV-Modus `GET /api/dev/users` auslöst, müssen bestehende Tests einen Handler dafür bekommen.

In `frontend/src/pages/LoginPage.test.tsx` die `setup()`-Funktion erweitern:

```ts
function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
  // Default: leere Dev-Benutzerliste → kein Picker, bestehender Test unverändert.
  server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
  return renderMitProviders(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}
```

In `frontend/src/App.test.tsx` im Test-Body (nach der `me`-Zeile) ergänzen:

```ts
    server.use(http.get('/api/dev/users', () => HttpResponse.json([])));
```

- [ ] **Step 2: Zwei neue LoginPage-Tests schreiben**

In `frontend/src/pages/LoginPage.test.tsx` innerhalb `describe('LoginPage', ...)` ergänzen:

```ts
  it('füllt das Formular bei Auswahl eines Dev-Benutzers', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json([
          { benutzername: 'admin', passwort: 'dev', anzeigename: 'Administrator', rolle: 'Admin' },
        ]),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    const knopf = await screen.findByRole('button', { name: /Administrator/ });
    await userEvent.click(knopf);

    expect((screen.getByLabelText('Benutzername') as HTMLInputElement).value).toBe('admin');
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('dev');
  });

  it('zeigt keinen Picker, wenn der Dev-Endpoint fehlt (404)', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    server.use(
      http.get('/api/dev/users', () =>
        HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
      ),
    );
    renderMitProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    // Das normale Login-Formular ist vorhanden …
    expect(await screen.findByLabelText('Benutzername')).toBeInTheDocument();
    // … aber kein Dev-Schnellanmeldung-Block.
    expect(screen.queryByText('Dev-Schnellanmeldung')).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Tests ausführen — die neuen müssen fehlschlagen**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx`
Expected: Der „füllt das Formular"-Test schlägt fehl (kein Button „Administrator" — Picker noch nicht implementiert). Der „kein Picker"-Test ist evtl. schon grün (es gibt noch keinen Picker), zählt aber erst nach der Implementierung als echte Absicherung.

- [ ] **Step 4: `LoginPage.tsx` implementieren — Form-Instanz + Picker**

`frontend/src/pages/LoginPage.tsx` vollständig ersetzen:

```tsx
import { Alert, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { devBenutzerLaden, type DevBenutzer } from '../api/dev';
import { useAuth } from '../auth/AuthContext';

interface FormWerte {
  benutzername: string;
  passwort: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<FormWerte>();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [devBenutzer, setDevBenutzer] = useState<DevBenutzer[]>([]);

  const zielPfad = (location.state as { von?: string } | null)?.von ?? '/einsaetze';

  // Nur im Dev-Build: verfügbare Seed-Benutzer laden. Der gesamte Block steht
  // hinter `import.meta.env.DEV` und entfällt im Production-Build per DCE.
  useEffect(() => {
    if (import.meta.env.DEV) {
      devBenutzerLaden()
        .then(setDevBenutzer)
        // Feature aus / Netzwerkfehler → still ignorieren, normales Login bleibt.
        .catch(() => {});
    }
  }, []);

  async function absenden(werte: FormWerte) {
    setFehler(null);
    setLaedt(true);
    try {
      await login(werte.benutzername, werte.passwort);
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Verbindung zum Server fehlgeschlagen');
    } finally {
      setLaedt(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3}>lifeline-hub</Typography.Title>
        {fehler && <Alert type="error" message={fehler} style={{ marginBottom: 16 }} showIcon />}
        {import.meta.env.DEV && devBenutzer.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">Dev-Schnellanmeldung</Typography.Text>
            <Space wrap style={{ display: 'flex', marginTop: 8 }}>
              {devBenutzer.map((b) => (
                <Button
                  key={b.benutzername}
                  size="small"
                  onClick={() =>
                    form.setFieldsValue({ benutzername: b.benutzername, passwort: b.passwort })
                  }
                >
                  {b.anzeigename}
                  <Tag style={{ marginLeft: 4 }}>{b.rolle}</Tag>
                </Button>
              ))}
            </Space>
          </div>
        )}
        <Form form={form} layout="vertical" onFinish={absenden} disabled={laedt}>
          <Form.Item
            label="Benutzername"
            name="benutzername"
            rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="Passwort"
            name="passwort"
            rules={[{ required: true, message: 'Bitte Passwort eingeben' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={laedt}>
            Anmelden
          </Button>
        </Form>
      </Card>
    </div>
  );
}
```

Hinweis: `Form.useForm()` ändert die Label-Anbindung nicht — `getByLabelText('Benutzername')`/`'Passwort'` funktioniert weiterhin (`Form.Item`-`label`+`name` erzeugen dieselbe Verknüpfung). Die Auswahl-Buttons tragen `anzeigename` als zugänglichen Namen (plus `rolle`-Tag), daher matcht `findByRole('button', { name: /Administrator/ })`.

- [ ] **Step 5: LoginPage-Tests ausführen — alle grün**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx`
Expected: PASS (3 Tests: Fehlermeldung, Picker-Füllen, kein-Picker).

Falls der Picker-Test NICHT rendert (d.h. `import.meta.env.DEV` ist in dieser Umgebung nicht `true`): in `frontend/src/test/setup.ts` im `beforeEach` `vi.stubEnv('DEV', true);` ergänzen und `vi.unstubAllEnvs()` im `afterEach`. (Erfahrungsgemäß ist DEV in Vitest bereits `true`; diesen Fallback nur bei Bedarf anwenden.)

- [ ] **Step 6: Gesamte Frontend-Tests + Typecheck + Lint**

Run: `cd frontend && npm run typecheck && npm run lint && npm test`
Expected: alle grün. Falls ein anderer Test mit „unhandled request `/api/dev/users`" bricht, dort denselben `server.use(http.get('/api/dev/users', () => HttpResponse.json([])))`-Handler ergänzen.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx frontend/src/App.test.tsx
git commit -m "feat(dev-seeds): Dev-Login-Picker auf der LoginPage"
```

---

## Task 10: Abschluss-Verifikation — beide Gates greifen

**Files:** keine Änderung (reine Verifikation).

- [ ] **Step 1: Backend-Tests OHNE Feature (Default-Build)**

Run: `cargo test`
Expected: PASS. Enthält `dev_absent`-Test (Route 404), aber KEINE `seed`/`dev_present`-Tests (Modul existiert nicht).

- [ ] **Step 2: Backend-Tests MIT Feature**

Run: `cargo test --features dev-seeds`
Expected: PASS. Enthält zusätzlich die 5 Seed-Tests und `dev_present`. `dev_absent` läuft hier nicht (per `#![cfg(not(...))]` ausgeschlossen).

- [ ] **Step 3: Verifizieren, dass das Release-Skript nichts aktiviert**

Run: `grep -n "features" scripts/build-release.sh`
Expected: kein Treffer — `cargo build --release` baut ohne `--features`, also ohne Seed-Code/Endpoint. **Keine Änderung am Skript.**

- [ ] **Step 4: Release-Build kompiliert ohne Dev-Symbole**

Run: `cargo build --release`
Expected: erfolgreicher Build. (Der Seed-Code und `/api/dev/users` sind physisch nicht enthalten.)

- [ ] **Step 5: Frontend-Production-Build kompiliert**

Run: `cd frontend && npm run build`
Expected: erfolgreicher Build. Der DEV-Block in `LoginPage.tsx` wird per DCE entfernt (`import.meta.env.DEV` ist im Prod-Build `false`).

- [ ] **Step 6: Abschluss-Commit (falls noch uncommittete Reste)**

```bash
git status
# Sollte sauber sein; andernfalls fehlende Änderungen committen.
```

---

## Self-Review

**1. Spec-Abdeckung:**
- Zwei Gates (Cargo-Feature + `import.meta.env.DEV`) → Tasks 1/6/7 (Backend), Task 9 (Frontend). ✓
- Source of Truth Backend-Endpoint aus Seed-Konstante → `SEED_BENUTZER` (Task 1), Endpoint nutzt sie (Task 6). ✓
- Seeding-Modul `src/dev/seed.rs` hinter `#[cfg(feature = "dev-seeds")]`, Aufruf vor `bootstrap_admin` → Tasks 1–5, 7. ✓
- Idempotenz für Benutzer/Einsätze/Mitgliedschaften/ETB → je eigener Test in Tasks 2–5. ✓
- Seed-Daten (4 Benutzer inkl. `inaktiv`, 3 Einsätze, Mitgliedschaften, ETB) → Tasks 2–5. ✓
- Endpoint liefert nur aktive Benutzer (kein `inaktiv`), Klartext-Passwort, keine Hashes → Task 6 Tests. ✓
- Endpoint ohne Feature = 404 → `tests/dev_absent.rs` (Task 6). ✓
- Frontend Picker (DEV-Fetch, Block über Formular, `setFieldsValue`, eigener Anmelden-Klick) + `Form.useForm()` → Task 9. ✓
- Fehlerbehandlung (Fetch-Fehler still ignorieren) → `.catch(() => {})` (Task 9); `inaktiv`-Login via bestehendem `aktiv=1`-Filter, kein Sonderfall (verifiziert in `src/routes/auth.rs:35`). ✓
- `frontend/src/api/dev.ts` optionaler Helfer → Task 8. ✓
- Niemals im Production-Binary → Task 10 verifiziert beide Builds. ✓

**2. Placeholder-Scan:** Keine TODO/TBD/„appropriate error handling"; jeder Code-Schritt enthält vollständigen Code. ✓

**3. Typ-Konsistenz:**
- `dev_seed` heißt durchgängig `dev_seed` (Tasks 1/2/3/4/5/6/7). ✓
- `DevBenutzer` (intern, Felder inkl. `rolle_anzeige`) vs. `DevBenutzerResponse` (öffentlich, Feld `rolle`) konsistent zwischen Task 1 und Task 6. ✓
- Frontend-`DevBenutzer` (`benutzername`/`passwort`/`anzeigename`/`rolle`) spiegelt `DevBenutzerResponse`. ✓
- Seeding-Helfer-Namen (`organisation_anlegen`, `benutzer_seeden`, `einsaetze_seeden`, `mitgliedschaften_seeden`, `etb_seeden`) konsistent zwischen Definition und `dev_seed`-Aufruf. ✓
- Einsatz-Rollen-Strings (`einsatzleitung`/`fuehrungspersonal`/`beobachter`) und `status`-Werte entsprechen den CHECK-Constraints aus `migrations/0003_einsatz.sql`. ✓
