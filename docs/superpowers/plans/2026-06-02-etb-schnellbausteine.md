# ETB-Schnellbausteine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-globaler Katalog vordefinierter ETB-Textbausteine, der die Schnellerfassung über einen Picker mit client-seitiger Platzhalter-Auflösung beschleunigt.

**Architecture:** Backend = „dummer" org-globaler Katalog `etb_baustein` exakt nach bestehendem Stammdaten-Muster (`org_id`-scoped, `AdminUser`-CRUD, Soft-Delete via `aktiv`, Bootstrap-Seed). Frontend = Admin-CRUD-Tab + eine **reine, unit-testbare Platzhalter-Engine** + ein `BausteinPicker`, der beim Einsetzen die Felder der Schnellerfassung vorbefüllt. Backend kennt keine Platzhalter-Logik.

**Tech Stack:** Rust (axum + sqlx/SQLite), React + TypeScript + Ant Design + TanStack Query, dayjs. Tests: `cargo test` (Backend, In-Memory-SQLite-Harness), Vitest + MSW + Testing Library (Frontend).

**Spec:** `docs/superpowers/specs/2026-06-02-etb-schnellbausteine-design.md`

---

## Wichtige Abweichungen & Konventionen (vor dem Start lesen)

1. **Fehlercode 400 statt 422 bei ungültigem `typ`/`meldeweg`.** Die Spec §5 nennt „422", aber der bestehende ETB-Handler (`src/routes/etb.rs:53` und `:69`) wirft für exakt diese Fälle `AppError::Validation` → **400 BAD_REQUEST**. Wir folgen dem Bestandsmuster (Konsistenz schlägt die beiläufige Spec-Angabe). Der DB-`CHECK` ist der zusätzliche Backstop.

2. **`UNIQUE(org_id, label)` ohne `WHERE aktiv=1`.** Ein deaktivierter Baustein belegt sein Label weiter → Neu-Anlage mit gleichem Label ⇒ **409**, auch wenn der Bestands-Baustein deaktiviert ist. Das ist die in der Spec („Offene Punkte") ausdrücklich verlangte v1-Festlegung; Reaktivierung ist v2. **Kein** partieller Index.

3. **Migrationsnummer spät binden.** Im Worktree ist `0035` die höchste Migration → nächste wäre `0036`. Auf einem Parallel-Branch existiert aber bereits `0036_lage_zone.sql`, das vermutlich vor diesem Branch merget. Dieser Plan verwendet **`0037_etb_baustein.sql`**. Schritt 1.1 verifiziert die Nummer zum Ausführungszeitpunkt.

4. **Timestamps: beide.** `erstellt_at` UND `aktualisiert_at` (Spec §1). Beide `TEXT NOT NULL DEFAULT (datetime('now'))`. `aktualisiere()` setzt `aktualisiert_at = datetime('now')` mit.

5. **Seed an zwei Stellen.** Migration-`CROSS JOIN` seedet **bestehende** Orgs beim Upgrade (NO-OP auf frischer DB). `ETB_BAUSTEIN_STARTLISTE` + Bootstrap-Loop seedet **neue** Orgs (und alle Tests). Getestet wird nur der **Bootstrap-Pfad** (analog `qualifikation`/`personal_status`) — kein Schwesterkatalog testet den Upgrade-Pfad.

6. **Test-Kommandos (Pass/Fail-Gates).** Der `rtk`-Hook maskiert Exit-Codes; an jedem Gate (Test soll nachweislich fehlschlagen/bestehen) `rtk proxy` voranstellen, z. B. `rtk proxy cargo test --test etb_baustein`. Die volle Vitest-Suite ist unter Last flaky → mit `--no-file-parallelism` laufen lassen; einzelne Test-Dateien sind unkritisch.

7. **dayjs lokal für Anzeige-Platzhalter.** `{datum}`/`{uhrzeit}` nutzen plain `dayjs().format(...)` (lokal, OHNE `.utc()`). Das `.utc()`-Muster gilt nur für `ereigniszeit` beim Absenden, nicht hier.

## Datei-Struktur (was wird angelegt/geändert)

**Backend (neu):**
- `migrations/0037_etb_baustein.sql` — Tabelle + Constraints + Index + CROSS-JOIN-Seed
- `src/etb_baustein/mod.rs` — `EtbBaustein` (FromRow+Serialize), `ETB_BAUSTEIN_STARTLISTE`, `ist_baustein_typ()`
- `src/etb_baustein/repo.rs` — `BausteinDaten`, `laden/liste/anlegen/aktualisiere/deaktiviere`
- `src/routes/etb_baustein.rs` — Handler + `normalisiere()`
- `tests/etb_baustein.rs` — Integrations- + Repo-Tests

**Backend (geändert):**
- `src/lib.rs` — `pub mod etb_baustein;` (alphabetisch nach `etb`)
- `src/routes/mod.rs` — `pub mod etb_baustein;`
- `src/app.rs` — vier Routen einhängen
- `src/auth/bootstrap.rs` — Seed-Loop für neue Orgs

**Frontend (neu):**
- `frontend/src/api/etbBaustein.ts` — CRUD-Client
- `frontend/src/etb/bausteinEinsetzen.ts` — reine Platzhalter-Engine
- `frontend/src/etb/bausteinEinsetzen.test.ts`
- `frontend/src/etb/BausteinPicker.tsx` — Dropdown + Ausfüll-Dialog
- `frontend/src/etb/BausteinPicker.test.tsx`
- `frontend/src/stammdaten/EtbBausteineTab.tsx` — Admin-CRUD-Tab
- `frontend/src/stammdaten/EtbBausteinFormModal.tsx`
- `frontend/src/stammdaten/EtbBausteineTab.test.tsx`

**Frontend (geändert):**
- `frontend/src/api/types.ts` — `EtbBaustein`-Interface
- `frontend/src/pages/StammdatenPage.tsx` — neuer Tab
- `frontend/src/etb/Schnellerfassung.tsx` — Picker rendern, neue Props
- `frontend/src/pages/EtbPage.tsx` — Bausteine laden, durchreichen

---

## Task 1: Migration `etb_baustein`

**Files:**
- Create: `migrations/0037_etb_baustein.sql`

- [ ] **Step 1.1: Migrationsnummer verifizieren**

Run: `ls migrations/ | sort | tail -3`
Erwartung: höchste Nummer ablesen. Ist `0037` bereits belegt (z. B. weil `0036_lage_zone` schon gemergt ist und eine weitere dazukam), die Datei auf die nächste freie Nummer umbenennen und alle Verweise in diesem Plan entsprechend anpassen. Andernfalls `0037` verwenden.

- [ ] **Step 1.2: Migration schreiben**

Create `migrations/0037_etb_baustein.sql`:

```sql
-- Org-globaler Katalog vordefinierter ETB-Textbausteine (LFH-42).
CREATE TABLE etb_baustein (
    id             INTEGER PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organisation(id),
    label          TEXT NOT NULL,
    typ            TEXT NOT NULL
                     CHECK (typ IN ('meldung', 'anordnung', 'lage', 'entscheidung')),
    inhalt         TEXT NOT NULL,
    meldeweg       TEXT
                     CHECK (meldeweg IS NULL OR meldeweg IN ('funk', 'telefon', 'persoenlich', 'sonstige')),
    veranlassung   TEXT,
    sortier        INTEGER NOT NULL DEFAULT 0,
    aktiv          INTEGER NOT NULL DEFAULT 1,
    erstellt_at    TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(org_id, label)
);

CREATE INDEX idx_etb_baustein_liste ON etb_baustein(org_id, aktiv, sortier);

-- Seed bestehender Orgs beim Upgrade. NO-OP auf frischer DB (keine organisation).
-- Neue Orgs werden via bootstrap_admin (ETB_BAUSTEIN_STARTLISTE) geseedet.
INSERT INTO etb_baustein (org_id, label, typ, inhalt, sortier)
SELECT o.id, v.label, v.typ, v.inhalt, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Lage unverändert'    AS label, 'lage'        AS typ, 'Lage unverändert.'                                       AS inhalt, 10 AS sortier
    UNION ALL SELECT 'Erkundung eingeleitet',     'meldung',      'Erkundung durch {einheit} eingeleitet.',                       20
    UNION ALL SELECT 'Einheit eingetroffen',      'meldung',      '{einheit} um {uhrzeit} an Einsatzstelle eingetroffen.',        30
    UNION ALL SELECT 'Lagemeldung Leitstelle',    'meldung',      'Lagemeldung an Leitstelle zu Einsatz {einsatznr}: {lage}.',    40
    UNION ALL SELECT 'Einsatzabschnitt gebildet', 'entscheidung', 'Einsatzabschnitt {abschnitt} gebildet, Führung {einheit}.',    50
) v;
```

- [ ] **Step 1.3: Migration lädt fehlerfrei**

Run: `rtk proxy cargo build`
Expected: kompiliert ohne Fehler (Migration wird zur Compile-Zeit von `sqlx::migrate!("./migrations")` eingelesen; ein Syntaxfehler in der `.sql` bricht den Build).

- [ ] **Step 1.4: Commit**

```bash
git add migrations/0037_etb_baustein.sql
git commit -m "feat(be): Migration etb_baustein-Katalog (LFH-42)"
```

---

## Task 2: Backend-Modul `etb_baustein` (Modell + Startliste + Typ-Helfer)

**Files:**
- Create: `src/etb_baustein/mod.rs`
- Modify: `src/lib.rs` (neuer `pub mod`)

- [ ] **Step 2.1: Modul anlegen**

Create `src/etb_baustein/mod.rs`:

```rust
pub mod repo;

use crate::etb::EtbTyp;
use serde::Serialize;

/// Default-Bausteine, die beim Anlegen einer neuen Organisation geseedet werden.
/// (label, typ, inhalt, sortier) — muss inhaltlich zum CROSS-JOIN-Seed in
/// migrations/0037_etb_baustein.sql passen.
pub const ETB_BAUSTEIN_STARTLISTE: [(&str, &str, &str, i64); 5] = [
    ("Lage unverändert", "lage", "Lage unverändert.", 10),
    ("Erkundung eingeleitet", "meldung", "Erkundung durch {einheit} eingeleitet.", 20),
    (
        "Einheit eingetroffen",
        "meldung",
        "{einheit} um {uhrzeit} an Einsatzstelle eingetroffen.",
        30,
    ),
    (
        "Lagemeldung Leitstelle",
        "meldung",
        "Lagemeldung an Leitstelle zu Einsatz {einsatznr}: {lage}.",
        40,
    ),
    (
        "Einsatzabschnitt gebildet",
        "entscheidung",
        "Einsatzabschnitt {abschnitt} gebildet, Führung {einheit}.",
        50,
    ),
];

/// Ein Baustein-Typ ist erfassbar (kein `system`) und keine `berichtigung`.
pub fn ist_baustein_typ(typ: EtbTyp) -> bool {
    typ.darf_client_erfassen() && !typ.ist_berichtigung()
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EtbBaustein {
    pub id: i64,
    pub label: String,
    pub typ: String,
    pub inhalt: String,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    pub sortier: i64,
}
```

- [ ] **Step 2.2: Modul registrieren**

In `src/lib.rs`, neue Zeile direkt nach `pub mod etb;` (alphabetische Ordnung):

```rust
pub mod etb;
pub mod etb_baustein;
pub mod fahrzeug;
```

- [ ] **Step 2.3: Build prüft Modell + Helfer**

Run: `rtk proxy cargo build`
Expected: kompiliert. Falls `ist_berichtigung` auf `EtbTyp` fehlt: in `src/etb/mod.rs` prüfen (laut Scout existiert es, da `src/routes/etb.rs:74` `typ.ist_berichtigung()` nutzt). `darf_client_erfassen()` existiert ebenfalls.

- [ ] **Step 2.4: Commit**

```bash
git add src/etb_baustein/mod.rs src/lib.rs
git commit -m "feat(be): EtbBaustein-Modell + Startliste (LFH-42)"
```

---

## Task 3: Backend-Repo `etb_baustein::repo`

**Files:**
- Create: `src/etb_baustein/repo.rs`

- [ ] **Step 3.1: Repo schreiben**

Create `src/etb_baustein/repo.rs` (exakt nach `personal/status_repo.rs`-Muster; org-scoped, `aktiv=1`-Filter, `label_conflict`-Helfer):

```rust
use super::EtbBaustein;
use crate::error::AppError;
use sqlx::SqlitePool;

const SPALTEN: &str = "id, label, typ, inhalt, meldeweg, veranlassung, sortier";

#[derive(Debug)]
pub struct BausteinDaten<'a> {
    pub label: &'a str,
    pub typ: &'a str,
    pub inhalt: &'a str,
    pub meldeweg: Option<&'a str>,
    pub veranlassung: Option<&'a str>,
    pub sortier: i64,
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Ein Baustein mit diesem Label existiert bereits".into(),
            ));
        }
    }
    Err(e.into())
}

pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<EtbBaustein, AppError> {
    sqlx::query_as::<_, EtbBaustein>(&format!(
        "SELECT {SPALTEN} FROM etb_baustein WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<EtbBaustein>, AppError> {
    sqlx::query_as::<_, EtbBaustein>(&format!(
        "SELECT {SPALTEN} FROM etb_baustein \
         WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    ))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: BausteinDaten<'_>,
) -> Result<EtbBaustein, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO etb_baustein \
            (org_id, label, typ, inhalt, meldeweg, veranlassung, sortier) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.label)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: BausteinDaten<'_>,
) -> Result<EtbBaustein, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE etb_baustein SET \
            label = ?, typ = ?, inhalt = ?, meldeweg = ?, veranlassung = ?, sortier = ?, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(daten.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return label_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

pub async fn deaktiviere(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE etb_baustein SET aktiv = 0, aktualisiert_at = datetime('now') \
         WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 3.2: Build prüft Repo**

Run: `rtk proxy cargo build`
Expected: kompiliert ohne Fehler.

- [ ] **Step 3.3: Commit**

```bash
git add src/etb_baustein/repo.rs
git commit -m "feat(be): etb_baustein-Repo (org-scoped CRUD + Soft-Delete) (LFH-42)"
```

---

## Task 4: Backend-Route + Wiring

**Files:**
- Create: `src/routes/etb_baustein.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`

- [ ] **Step 4.1: Handler schreiben**

Create `src/routes/etb_baustein.rs` (Muster: `routes/personal_status.rs`; Typ-/Meldeweg-Validierung → 400 wie `routes/etb.rs`):

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::etb::{EtbTyp, MeldeWeg};
use crate::etb_baustein::repo::{self, BausteinDaten};
use crate::etb_baustein::{ist_baustein_typ, EtbBaustein};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct BausteinBody {
    pub label: String,
    pub typ: String,
    pub inhalt: String,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

struct Normalisiert {
    label: String,
    typ: String,
    inhalt: String,
    meldeweg: Option<String>,
    veranlassung: Option<String>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> BausteinDaten<'_> {
        BausteinDaten {
            label: &self.label,
            typ: &self.typ,
            inhalt: &self.inhalt,
            meldeweg: self.meldeweg.as_deref(),
            veranlassung: self.veranlassung.as_deref(),
            sortier: self.sortier,
        }
    }
}

fn normalisiere(body: BausteinBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    let inhalt = body.inhalt.trim().to_string();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    // Typ muss erfassbar (kein 'system') und keine 'berichtigung' sein.
    let typ = EtbTyp::parse(&body.typ).filter(|t| ist_baustein_typ(*t));
    let typ = typ.ok_or_else(|| AppError::Validation("Ungültiger Baustein-Typ".into()))?;

    let meldeweg = trimme(body.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    Ok(Normalisiert {
        label,
        typ: typ.as_str().to_string(),
        inhalt,
        meldeweg,
        veranlassung: trimme(body.veranlassung),
        sortier: body.sortier,
    })
}

pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EtbBaustein>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<BausteinBody>,
) -> Result<(StatusCode, Json<EtbBaustein>), AppError> {
    let n = normalisiere(body)?;
    let b = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(b)))
}

pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<BausteinBody>,
) -> Result<Json<EtbBaustein>, AppError> {
    let n = normalisiere(body)?;
    let b = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(b))
}

pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktiviere(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 4.2: Modul registrieren**

In `src/routes/mod.rs` einen `pub mod etb_baustein;` ergänzen (Stelle: bei den übrigen `pub mod`-Einträgen, alphabetisch nach `etb`).

- [ ] **Step 4.3: Routen einhängen**

In `src/app.rs`, direkt nach den `personal-status`-Routen (im selben `.route(...)`-Block vor `.with_state(state)`):

```rust
        .route("/api/etb-bausteine", get(routes::etb_baustein::liste))
        .route("/api/etb-bausteine", post(routes::etb_baustein::anlegen))
        .route("/api/etb-bausteine/{id}", patch(routes::etb_baustein::aktualisieren))
        .route("/api/etb-bausteine/{id}/deaktivieren", post(routes::etb_baustein::deaktivieren))
```

- [ ] **Step 4.4: Build prüft Wiring**

Run: `rtk proxy cargo build`
Expected: kompiliert. Falls `get/post/patch` nicht im Scope: sie sind in `app.rs` bereits importiert (von den Bestandsrouten).

- [ ] **Step 4.5: Commit**

```bash
git add src/routes/etb_baustein.rs src/routes/mod.rs src/app.rs
git commit -m "feat(be): etb-bausteine-Routen (AdminUser-CRUD, CurrentUser-Liste) (LFH-42)"
```

---

## Task 5: Bootstrap-Seed für neue Orgs

**Files:**
- Modify: `src/auth/bootstrap.rs`

- [ ] **Step 5.1: Import ergänzen**

In `src/auth/bootstrap.rs` bei den übrigen Startlisten-Imports (oben):

```rust
use crate::etb_baustein::ETB_BAUSTEIN_STARTLISTE;
```

- [ ] **Step 5.2: Seed-Loop ergänzen**

Im selben Block, in dem die anderen Kataloge geseedet werden (nach dem `PERSONAL_STATUS_STARTLISTE`- bzw. `EINHEIT_TYP_STARTLISTE`-Loop; `org_id` ist dort als Variable vorhanden — vorhandene Loops als Referenz nehmen):

```rust
    for (label, typ, inhalt, sortier) in ETB_BAUSTEIN_STARTLISTE {
        sqlx::query(
            "INSERT INTO etb_baustein (org_id, label, typ, inhalt, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(typ)
        .bind(inhalt)
        .bind(sortier)
        .execute(pool)
        .await?;
    }
```

> Hinweis: Den exakten Bindings-/`pool`-/`org_id`-Stil aus dem direkt darüberstehenden Loop übernehmen (z. B. ob `&pool` oder `pool`, ob `.await?` oder `.await.unwrap()` im Bootstrap-Kontext genutzt wird).

- [ ] **Step 5.3: Build prüft Bootstrap**

Run: `rtk proxy cargo build`
Expected: kompiliert.

- [ ] **Step 5.4: Bootstrap-Unittest (analog Schwesterkataloge)**

In `src/auth/bootstrap.rs` im `#[cfg(test)] mod tests`-Block (neben `seedet_personal_status_startliste_fuer_neue_org`):

```rust
    #[tokio::test]
    async fn seedet_etb_baustein_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
            .await
            .unwrap();
        let labels: Vec<String> =
            sqlx::query_scalar("SELECT label FROM etb_baustein ORDER BY sortier")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(labels.len(), 5, "fünf Default-Bausteine erwartet");
        assert_eq!(labels[0], "Lage unverändert");
    }
```

> Den genauen Aufbau (Setup-Helfer, Signatur von `bootstrap_admin`) an die bestehenden Bootstrap-Tests im selben Block angleichen.

- [ ] **Step 5.5: Test ausführen**

Run: `rtk proxy cargo test --lib auth::bootstrap::tests::seedet_etb_baustein_startliste_fuer_neue_org`
Expected: PASS (5 Bausteine, erster = „Lage unverändert").

- [ ] **Step 5.6: Commit**

```bash
git add src/auth/bootstrap.rs
git commit -m "feat(be): Bootstrap seedet ETB-Schnellbausteine fuer neue Orgs (LFH-42)"
```

---

## Task 6: Backend-Integrationstests `tests/etb_baustein.rs`

**Files:**
- Create: `tests/etb_baustein.rs`

Harness-Helfer (`setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`) aus `tests/personal_status.rs` übernehmen. **Zusätzlich** ein `setup_mit_pool()` für den Org-Isolations-Test (Repo-Level, da kein Org-Anlege-Endpunkt existiert).

- [ ] **Step 6.1: Test-Datei mit Imports + Harness anlegen**

Create `tests/etb_baustein.rs`. Kopiere die Imports und die Helfer `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage` **wörtlich** aus `tests/personal_status.rs` (siehe dortige Definitionen). Ergänze einen Pool-liefernden Setup:

```rust
async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = build_router(AppState { pool: pool.clone(), live: LiveHub::new() });
    (app, pool)
}
```

> `build_router`/`AppState`/`LiveHub`/`db`/`bootstrap_admin`-Pfade aus `tests/personal_status.rs` übernehmen.

- [ ] **Step 6.2: Test schreiben — Seed liefert Default-Bausteine**

```rust
#[tokio::test]
async fn seed_liefert_fuenf_aktive_bausteine() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 5);
    assert_eq!(json[0]["label"], "Lage unverändert");
    assert_eq!(json[0]["typ"], "lage");
}
```

- [ ] **Step 6.3: Test schreiben — Admin-CRUD, Nicht-Admin nur lesen, Typ-Validierung**

```rust
#[tokio::test]
async fn admin_crud_und_typ_validierung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Nicht-Admin darf lesen ...
    assert_eq!(anfrage(&app, "GET", "/api/etb-bausteine", &erika, None).await.0, StatusCode::OK);
    // ... aber nicht anlegen.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &erika,
            Some(r#"{"typ":"meldung","label":"X","inhalt":"x"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
    // Ungültiger Typ (system) → 400.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"system","label":"S","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    // berichtigung als Baustein-Typ → 400.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"berichtigung","label":"B","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    // Ungültiger Meldeweg → 400.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"M","inhalt":"x","meldeweg":"brieftaube"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );
    // Leeres Label → 400.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"   ","inhalt":"x"}"#)).await.0,
        StatusCode::BAD_REQUEST
    );

    // Gültiges Anlegen → 201.
    let (status, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Räumung {abschnitt} anordnen.","meldeweg":"funk","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["label"], "Räumung anordnen");
    assert_eq!(json["meldeweg"], "funk");
    let id = json["id"].as_i64().unwrap();

    // PATCH aktualisiert → 200.
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/etb-bausteine/{id}"), &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Sofort räumen.","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["inhalt"], "Sofort räumen.");

    // PATCH unbekannte ID → 404.
    assert_eq!(
        anfrage(&app, "PATCH", "/api/etb-bausteine/9999", &admin,
            Some(r#"{"typ":"meldung","label":"Z","inhalt":"z"}"#)).await.0,
        StatusCode::NOT_FOUND
    );
}
```

- [ ] **Step 6.4: Test schreiben — Label-Konflikt (auch gegen deaktivierten Baustein) → 409**

```rust
#[tokio::test]
async fn label_konflikt_auch_gegen_deaktivierten_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (_, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"lage","label":"Eigenlabel","inhalt":"a"}"#)).await;
    let id = json["id"].as_i64().unwrap();

    // Dublette aktiv → 409.
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"b"}"#)).await.0,
        StatusCode::CONFLICT
    );

    // Deaktivieren → 204, verschwindet aus Liste.
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/etb-bausteine/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert!(!liste.as_array().unwrap().iter().any(|b| b["label"] == "Eigenlabel"));

    // Label des DEAKTIVIERTEN Bausteins erneut anlegen → weiterhin 409 (v1: keine Reaktivierung).
    assert_eq!(
        anfrage(&app, "POST", "/api/etb-bausteine", &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"c"}"#)).await.0,
        StatusCode::CONFLICT
    );
}
```

- [ ] **Step 6.5: Test schreiben — Org-Isolation (Repo-Level, zweite Org per SQL)**

```rust
#[tokio::test]
async fn org_isolation_liste_trennt_orgs() {
    use lifeline_hub::etb_baustein::repo::{self, BausteinDaten};
    let (_app, pool) = setup_mit_pool().await;

    // org_id der Bootstrap-Org (Org A) ermitteln.
    let org_a: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool).await.unwrap();
    // Zweite Org (Org B) direkt anlegen (kein HTTP-Anlege-Endpunkt vorhanden).
    let org_b: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) VALUES ('Org B', 'hilfsorganisation') RETURNING id")
        .fetch_one(&pool).await.unwrap();

    // Baustein nur in Org B anlegen.
    repo::anlegen(&pool, org_b, BausteinDaten {
        label: "Nur-B", typ: "meldung", inhalt: "b", meldeweg: None, veranlassung: None, sortier: 1,
    }).await.unwrap();

    // Org A sieht den Org-B-Baustein nicht.
    let liste_a = repo::liste(&pool, org_a).await.unwrap();
    assert!(!liste_a.iter().any(|b| b.label == "Nur-B"));
    // Org B sieht ihn.
    let liste_b = repo::liste(&pool, org_b).await.unwrap();
    assert!(liste_b.iter().any(|b| b.label == "Nur-B"));

    // laden() org-scoped: Org A findet die Org-B-ID nicht.
    let b_id = liste_b.iter().find(|b| b.label == "Nur-B").unwrap().id;
    assert!(matches!(repo::laden(&pool, org_a, b_id).await, Err(lifeline_hub::error::AppError::NotFound)));
}
```

> Falls der Crate-Name nicht `lifeline_hub` ist, in `Cargo.toml` (`[package] name`) bzw. an einem bestehenden Test verifizieren und anpassen. `tz_organisation`-Wert aus dem Bootstrap-INSERT (`'hilfsorganisation'`) übernommen.

- [ ] **Step 6.6: Alle Backend-Tests grün**

Run: `rtk proxy cargo test --test etb_baustein`
Expected: alle Tests PASS.

- [ ] **Step 6.7: Gesamtsuite Backend (Regression)**

Run: `rtk proxy cargo test`
Expected: keine bestehenden Tests gebrochen (insb. Seed-Zählungen anderer Kataloge unverändert).

- [ ] **Step 6.8: Commit**

```bash
git add tests/etb_baustein.rs
git commit -m "test(be): etb_baustein Integration + Org-Isolation (LFH-42)"
```

---

## Task 7: Frontend-API-Client + Typ

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/etbBaustein.ts`

- [ ] **Step 7.1: Typ ergänzen**

In `frontend/src/api/types.ts` (bei den übrigen Interfaces; `EtbTyp`/`MeldeWeg` existieren dort bereits):

```ts
export interface EtbBaustein {
  id: number;
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  sortier: number;
}
```

- [ ] **Step 7.2: API-Client schreiben**

Create `frontend/src/api/etbBaustein.ts` (Muster: `api/personalStatus.ts`):

```ts
import type { EtbBaustein, EtbTyp, MeldeWeg } from './types';
import { apiGet, apiSend } from './client';

export interface BausteinEingabe {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  sortier: number;
}

export function listeBausteine(): Promise<EtbBaustein[]> {
  return apiGet<EtbBaustein[]>('/api/etb-bausteine');
}

export function legeBausteinAn(daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>('/api/etb-bausteine', 'POST', daten);
}

export function aktualisiereBaustein(id: number, daten: BausteinEingabe): Promise<EtbBaustein> {
  return apiSend<EtbBaustein>(`/api/etb-bausteine/${id}`, 'PATCH', daten);
}

export function deaktiviereBaustein(id: number): Promise<void> {
  return apiSend<void>(`/api/etb-bausteine/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 7.3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: keine Typfehler.

- [ ] **Step 7.4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/etbBaustein.ts
git commit -m "feat(fe): API-Client + Typ fuer ETB-Schnellbausteine (LFH-42)"
```

---

## Task 8: Platzhalter-Engine (rein, TDD)

**Files:**
- Create: `frontend/src/etb/bausteinEinsetzen.test.ts`
- Create: `frontend/src/etb/bausteinEinsetzen.ts`

Die Engine ist die risikoreichste Logik → **Test zuerst**.

- [ ] **Step 8.1: Failing Test schreiben**

Create `frontend/src/etb/bausteinEinsetzen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin } from './bausteinEinsetzen';

function baustein(p: Partial<EtbBaustein>): EtbBaustein {
  return { id: 1, label: 'B', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0, ...p };
}

const einsatz = {
  bezeichnung: 'Hochwasser Altstadt',
  stichwort: 'THL groß',
  leitstellen_nr: 'LS-2026-042',
  einsatzort: 'Marktplatz 1',
} as unknown as EinsatzAnzeige;

describe('ermittlePlatzhalter', () => {
  it('listet nur manuelle Platzhalter (Auto-Kontext ausgenommen), eindeutig und in Reihenfolge', () => {
    const b = baustein({ inhalt: 'Am {einsatzort}: {einheit} und {abschnitt}, erneut {einheit}.' });
    expect(ermittlePlatzhalter(b, einsatz)).toEqual(['einheit', 'abschnitt']);
  });

  it('stuft Auto-Platzhalter mit fehlendem Wert zu manuell herab', () => {
    const leererEinsatz = { ...einsatz, einsatzort: null } as EinsatzAnzeige;
    const b = baustein({ inhalt: 'Lage in {einsatzort}.' });
    expect(ermittlePlatzhalter(b, leererEinsatz)).toEqual(['einsatzort']);
  });

  it('berücksichtigt Platzhalter auch in veranlassung', () => {
    const b = baustein({ inhalt: 'Text', veranlassung: 'Wegen {grund}.' });
    expect(ermittlePlatzhalter(b, einsatz)).toEqual(['grund']);
  });
});

describe('setzeBausteinEin', () => {
  it('substituiert Auto-Kontext still und manuelle Werte', () => {
    const b = baustein({ typ: 'meldung', inhalt: '{einheit} an {einsatzort} (Einsatz {einsatz}).' });
    const ergebnis = setzeBausteinEin(b, einsatz, { einheit: '1. Zug' });
    expect(ergebnis).toEqual({
      typ: 'meldung',
      inhalt: '1. Zug an Marktplatz 1 (Einsatz Hochwasser Altstadt).',
    });
  });

  it('nicht ausgefüllter manueller Platzhalter wird zu leerem String', () => {
    const b = baustein({ inhalt: 'X {fehlt} Y' });
    expect(setzeBausteinEin(b, einsatz, {}).inhalt).toBe('X  Y');
  });

  it('literale Klammern ohne gültiges Token bleiben unverändert', () => {
    const b = baustein({ inhalt: 'Menge { ca. 5 } Stück {Großschreibung}' });
    // '{ ca. 5 }' und '{Großschreibung}' matchen die Token-Regex nicht.
    expect(setzeBausteinEin(b, einsatz, {}).inhalt).toBe('Menge { ca. 5 } Stück {Großschreibung}');
  });

  it('substituiert meldeweg/veranlassung nur wenn gesetzt', () => {
    const b = baustein({ inhalt: 'a', meldeweg: 'funk', veranlassung: 'Wegen {grund}.' });
    const ergebnis = setzeBausteinEin(b, einsatz, { grund: 'Sturm' });
    expect(ergebnis.meldeweg).toBe('funk');
    expect(ergebnis.veranlassung).toBe('Wegen Sturm.');
  });
});
```

- [ ] **Step 8.2: Test schlägt fehl (Modul fehlt)**

Run: `cd frontend && pnpm exec vitest run src/etb/bausteinEinsetzen.test.ts`
Expected: FAIL — `Cannot find module './bausteinEinsetzen'`.

- [ ] **Step 8.3: Engine implementieren**

Create `frontend/src/etb/bausteinEinsetzen.ts`:

```ts
import dayjs from 'dayjs';
import type { EtbBaustein, EinsatzAnzeige, EtbTyp, MeldeWeg } from '../api/types';

const TOKEN = /\{([a-z0-9_]+)\}/g;

export interface BausteinFelder {
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

/** Liefert für jeden Auto-Whitelist-Platzhalter den Wert, oder null wenn nicht auflösbar. */
function autoWert(name: string, einsatz: EinsatzAnzeige): string | null | undefined {
  switch (name) {
    case 'datum':
      return dayjs().format('DD.MM.YYYY');
    case 'uhrzeit':
      return dayjs().format('HH:mm');
    case 'einsatzort':
      return einsatz.einsatzort;
    case 'stichwort':
      return einsatz.stichwort;
    case 'einsatz':
      return einsatz.bezeichnung;
    case 'einsatznr':
      return einsatz.leitstellen_nr;
    default:
      return undefined; // kein Auto-Platzhalter
  }
}

function istLeer(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || wert === '';
}

function tokensVon(...texte: (string | null | undefined)[]): string[] {
  const namen: string[] = [];
  for (const text of texte) {
    if (!text) continue;
    for (const m of text.matchAll(TOKEN)) {
      if (!namen.includes(m[1])) namen.push(m[1]);
    }
  }
  return namen;
}

/**
 * Manuelle Platzhalter (eindeutig, in Vorkommens-Reihenfolge): alle Tokens, die
 * KEINE Auto-Platzhalter sind ODER deren Auto-Wert leer/null ist (Herabstufung).
 */
export function ermittlePlatzhalter(baustein: EtbBaustein, einsatz: EinsatzAnzeige): string[] {
  return tokensVon(baustein.inhalt, baustein.veranlassung).filter((name) => {
    const auto = autoWert(name, einsatz);
    if (auto === undefined) return true; // manuell
    return istLeer(auto); // herabgestuft, wenn Auto-Wert fehlt
  });
}

function substituiere(
  text: string,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
): string {
  return text.replace(TOKEN, (_treffer, name: string) => {
    const auto = autoWert(name, einsatz);
    if (auto !== undefined && !istLeer(auto)) return auto as string;
    return manuelleWerte[name] ?? '';
  });
}

/** Substituiert Auto- + manuelle Platzhalter und liefert die zu setzenden Formularfelder. */
export function setzeBausteinEin(
  baustein: EtbBaustein,
  einsatz: EinsatzAnzeige,
  manuelleWerte: Record<string, string>,
): BausteinFelder {
  const felder: BausteinFelder = {
    typ: baustein.typ,
    inhalt: substituiere(baustein.inhalt, einsatz, manuelleWerte),
  };
  if (baustein.meldeweg) felder.meldeweg = baustein.meldeweg;
  if (baustein.veranlassung) {
    felder.veranlassung = substituiere(baustein.veranlassung, einsatz, manuelleWerte);
  }
  return felder;
}
```

- [ ] **Step 8.4: Tests grün**

Run: `cd frontend && pnpm exec vitest run src/etb/bausteinEinsetzen.test.ts`
Expected: alle PASS.

- [ ] **Step 8.5: Commit**

```bash
git add frontend/src/etb/bausteinEinsetzen.ts frontend/src/etb/bausteinEinsetzen.test.ts
git commit -m "feat(fe): reine Platzhalter-Engine fuer ETB-Schnellbausteine (LFH-42)"
```

---

## Task 9: Admin-CRUD-Tab `EtbBausteineTab`

**Files:**
- Create: `frontend/src/stammdaten/EtbBausteinFormModal.tsx`
- Create: `frontend/src/stammdaten/EtbBausteineTab.tsx`
- Create: `frontend/src/stammdaten/EtbBausteineTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 9.1: FormModal schreiben**

Create `frontend/src/stammdaten/EtbBausteinFormModal.tsx` (Muster: `MaterialFormModal.tsx`):

```tsx
import { App, Form, Input, InputNumber, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereBaustein, legeBausteinAn, type BausteinEingabe } from '../api/etbBaustein';
import type { EtbBaustein, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN } from '../etb/typFarben';
import { TYP_LABEL } from '../etb/typFarben';

interface FormWerte {
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  sortier: number;
}

const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function EtbBausteinFormModal({
  offen,
  baustein,
  onClose,
}: {
  offen: boolean;
  baustein: EtbBaustein | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (baustein) {
      form.setFieldsValue({
        label: baustein.label,
        typ: baustein.typ,
        inhalt: baustein.inhalt,
        meldeweg: baustein.meldeweg ?? undefined,
        veranlassung: baustein.veranlassung ?? undefined,
        sortier: baustein.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ typ: 'meldung', sortier: 0 });
    }
  }, [offen, baustein, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: BausteinEingabe = {
        label: werte.label.trim(),
        typ: werte.typ,
        inhalt: werte.inhalt.trim(),
        meldeweg: werte.meldeweg ?? null,
        veranlassung: leerZuNull(werte.veranlassung),
        sortier: werte.sortier ?? 0,
      };
      return baustein ? aktualisiereBaustein(baustein.id, daten) : legeBausteinAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['etb-bausteine'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={baustein ? 'Baustein bearbeiten' : 'Baustein anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Lage unverändert" />
        </Form.Item>
        <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
          <Select options={ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
        </Form.Item>
        <Form.Item
          label="Inhalt (Platzhalter wie {einheit} erlaubt)"
          name="inhalt"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input.TextArea rows={2} placeholder="Vorlagentext mit {platzhalter}" />
        </Form.Item>
        <Form.Item label="Meldeweg (optional)" name="meldeweg">
          <Select allowClear options={MELDEWEG_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Veranlassung (optional)" name="veranlassung">
          <Input />
        </Form.Item>
        <Form.Item label="Sortierung" name="sortier">
          <InputNumber min={0} style={{ width: 120 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

> Vor dem Schreiben `frontend/src/etb/typFarben.ts` öffnen und verifizieren, dass `ERFASSBARE_TYPEN` und `TYP_LABEL` exportiert werden (laut Scout: ja). Beide importieren statt selbst zu definieren (DRY).

- [ ] **Step 9.2: Tab schreiben**

Create `frontend/src/stammdaten/EtbBausteineTab.tsx` (Muster: `MaterialTab.tsx`):

```tsx
import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereBaustein, listeBausteine } from '../api/etbBaustein';
import type { EtbBaustein } from '../api/types';
import { TYP_LABEL } from '../etb/typFarben';
import EtbBausteinFormModal from './EtbBausteinFormModal';

export default function EtbBausteineTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EtbBaustein | null>(null);

  const query = useQuery({ queryKey: ['etb-bausteine'], queryFn: listeBausteine });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBaustein(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etb-bausteine'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  const spalten: TableColumnsType<EtbBaustein> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Typ', dataIndex: 'typ', key: 'typ', render: (t: EtbBaustein['typ']) => <Tag>{TYP_LABEL[t]}</Tag> },
    { title: 'Inhalt', dataIndex: 'inhalt', key: 'inhalt' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, b: EtbBaustein) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(b); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm title="Baustein deaktivieren?" onConfirm={() => deaktivieren.mutate(b.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EtbBaustein>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Baustein anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Bausteine' }}
      />
      <EtbBausteinFormModal offen={modalOffen} baustein={bearbeite} onClose={() => setModalOffen(false)} />
    </>
  );
}
```

- [ ] **Step 9.3: Tab in StammdatenPage einhängen**

In `frontend/src/pages/StammdatenPage.tsx`: Import ergänzen und einen `items`-Eintrag direkt nach `personal-status` hinzufügen.

Import (bei den übrigen Tab-Imports):
```tsx
import EtbBausteineTab from '../stammdaten/EtbBausteineTab';
```
Neuer `items`-Eintrag (nach `{ key: 'personal-status', ... }`):
```tsx
          { key: 'etb-bausteine', label: 'ETB-Schnellbausteine', children: <EtbBausteineTab /> },
```

- [ ] **Step 9.4: Test schreiben**

Create `frontend/src/stammdaten/EtbBausteineTab.test.tsx` (Muster: `MaterialTab.test.tsx`):

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbBausteineTab from './EtbBausteineTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const bausteine = [
  { id: 1, label: 'Lage unverändert', typ: 'lage', inhalt: 'Lage unverändert.', meldeweg: null, veranlassung: null, sortier: 10 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/etb-bausteine', () => HttpResponse.json(bausteine)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EtbBausteineTab />
    </AuthProvider>,
  );
}

describe('EtbBausteineTab', () => {
  it('zeigt Bausteine', async () => {
    render(admin);
    expect(await screen.findByText('Lage unverändert')).toBeInTheDocument();
  });

  it('Admin sieht Anlegen + Aktionen', async () => {
    render(admin);
    await screen.findByText('Lage unverändert');
    expect(screen.getByRole('button', { name: 'Baustein anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Lage unverändert');
    expect(screen.queryByRole('button', { name: 'Baustein anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 9.5: Tests grün**

Run: `cd frontend && pnpm exec vitest run src/stammdaten/EtbBausteineTab.test.tsx`
Expected: alle PASS.

- [ ] **Step 9.6: Commit**

```bash
git add frontend/src/stammdaten/EtbBausteineTab.tsx frontend/src/stammdaten/EtbBausteinFormModal.tsx frontend/src/stammdaten/EtbBausteineTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Admin-CRUD-Tab fuer ETB-Schnellbausteine (LFH-42)"
```

---

## Task 10: `BausteinPicker` (Dropdown + Ausfüll-Dialog)

**Files:**
- Create: `frontend/src/etb/BausteinPicker.tsx`
- Create: `frontend/src/etb/BausteinPicker.test.tsx`

Der Picker bekommt eine Ant-`FormInstance` und ruft `form.setFieldsValue` mit den substituierten Feldern. Bei manuellen Platzhaltern öffnet sich ein Modal mit je einem Eingabefeld; bei bereits gefülltem `inhalt` fragt ein `Popconfirm` nach Ersetzen.

- [ ] **Step 10.1: Picker schreiben**

Create `frontend/src/etb/BausteinPicker.tsx`:

```tsx
import { Button, Form, Input, Modal, Popconfirm, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import { useState } from 'react';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ermittlePlatzhalter, setzeBausteinEin } from './bausteinEinsetzen';

interface Props {
  form: FormInstance;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
}

export default function BausteinPicker({ form, bausteine, einsatz }: Props) {
  const [dialogBaustein, setDialogBaustein] = useState<EtbBaustein | null>(null);
  const [offenePlatzhalter, setOffenePlatzhalter] = useState<string[]>([]);
  const [werte, setWerte] = useState<Record<string, string>>({});

  function anwenden(baustein: EtbBaustein, manuelleWerte: Record<string, string>) {
    const felder = setzeBausteinEin(baustein, einsatz, manuelleWerte);
    form.setFieldsValue(felder);
    setDialogBaustein(null);
    setWerte({});
  }

  function auswahl(id: number) {
    const baustein = bausteine.find((b) => b.id === id);
    if (!baustein) return;
    const manuell = ermittlePlatzhalter(baustein, einsatz);
    const inhaltGefuellt = (form.getFieldValue('inhalt') ?? '').trim().length > 0;
    if (manuell.length === 0 && !inhaltGefuellt) {
      anwenden(baustein, {});
      return;
    }
    // Dialog: für manuelle Platzhalter und/oder Ersetz-Bestätigung.
    setWerte({});
    setOffenePlatzhalter(manuell);
    setDialogBaustein(baustein);
  }

  const inhaltGefuellt = (form.getFieldValue('inhalt') ?? '').trim().length > 0;

  return (
    <>
      <Select
        placeholder="Baustein einsetzen …"
        style={{ marginBottom: 8, minWidth: 220 }}
        value={null}
        onChange={auswahl}
        options={bausteine.map((b) => ({ value: b.id, label: b.label }))}
      />

      <Modal
        open={dialogBaustein !== null}
        title="Baustein einsetzen"
        okText="Einsetzen"
        onOk={() => dialogBaustein && anwenden(dialogBaustein, werte)}
        onCancel={() => setDialogBaustein(null)}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {offenePlatzhalter.map((name) => (
            <Form.Item key={name} label={name} style={{ marginBottom: 8 }}>
              <Input
                value={werte[name] ?? ''}
                onChange={(e) => setWerte((w) => ({ ...w, [name]: e.target.value }))}
              />
            </Form.Item>
          ))}
          {inhaltGefuellt && (
            <Popconfirm title="Vorhandenen Inhalt ersetzen?" onConfirm={() => dialogBaustein && anwenden(dialogBaustein, werte)}>
              <Button>Vorhandenen Inhalt ersetzen</Button>
            </Popconfirm>
          )}
        </Space>
      </Modal>
    </>
  );
}
```

> Hinweis: Wenn `inhalt` bereits gefüllt ist, läuft die Auswahl immer über den Dialog (auch ohne manuelle Platzhalter), damit das Ersetzen bestätigt werden kann. Bei leerem `inhalt` und keinen manuellen Platzhaltern werden die Felder sofort gesetzt.

- [ ] **Step 10.2: Test schreiben**

Create `frontend/src/etb/BausteinPicker.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import BausteinPicker from './BausteinPicker';

const einsatz = {
  bezeichnung: 'Hochwasser', stichwort: 'THL', leitstellen_nr: 'LS-1', einsatzort: 'Markt',
} as unknown as EinsatzAnzeige;

function b(p: Partial<EtbBaustein>): EtbBaustein {
  return { id: 1, label: 'B', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0, ...p };
}

function Harness({ bausteine, onSet }: { bausteine: EtbBaustein[]; onSet: (v: unknown) => void }) {
  const [form] = Form.useForm();
  // setFieldsValue abfangen, um die gesetzten Werte zu prüfen.
  const orig = form.setFieldsValue;
  form.setFieldsValue = (v: never) => { onSet(v); return orig.call(form, v); };
  return (
    <Form form={form}>
      <BausteinPicker form={form} bausteine={bausteine} einsatz={einsatz} />
    </Form>
  );
}

describe('BausteinPicker', () => {
  it('setzt Felder sofort, wenn keine manuellen Platzhalter', async () => {
    const onSet = vi.fn();
    renderMitProviders(<Harness bausteine={[b({ id: 1, label: 'Lage', inhalt: 'Lage in {einsatzort}.' })]} onSet={onSet} />);
    await userEvent.click(screen.getByText('Baustein einsetzen …'));
    await userEvent.click(await screen.findByText('Lage'));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ inhalt: 'Lage in Markt.' })));
  });

  it('öffnet Dialog bei manuellen Platzhaltern und setzt nach Eingabe', async () => {
    const onSet = vi.fn();
    renderMitProviders(<Harness bausteine={[b({ id: 2, label: 'Eintreffen', inhalt: '{einheit} eingetroffen.' })]} onSet={onSet} />);
    await userEvent.click(screen.getByText('Baustein einsetzen …'));
    await userEvent.click(await screen.findByText('Eintreffen'));
    const eingabe = await screen.findByLabelText('einheit');
    await userEvent.type(eingabe, '1. Zug');
    await userEvent.click(screen.getByRole('button', { name: 'Einsetzen' }));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ inhalt: '1. Zug eingetroffen.' })));
  });
});
```

> Falls das Antd-`Select`-Öffnen im Test zickt: stattdessen per `combobox`-Rolle öffnen (`screen.getByRole('combobox')`) — das genaue Selektormuster aus einem bestehenden Select-Test der Codebase übernehmen (z. B. ein Tab-Test mit `Select`).

- [ ] **Step 10.3: Tests grün**

Run: `cd frontend && pnpm exec vitest run src/etb/BausteinPicker.test.tsx`
Expected: alle PASS.

- [ ] **Step 10.4: Commit**

```bash
git add frontend/src/etb/BausteinPicker.tsx frontend/src/etb/BausteinPicker.test.tsx
git commit -m "feat(fe): BausteinPicker (Dropdown + Ausfuell-Dialog) (LFH-42)"
```

---

## Task 11: Integration in Schnellerfassung + EtbPage

**Files:**
- Modify: `frontend/src/etb/Schnellerfassung.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx`
- Modify: `frontend/src/etb/Schnellerfassung.test.tsx`

- [ ] **Step 11.1: Schnellerfassung-Props erweitern + Picker rendern**

In `frontend/src/etb/Schnellerfassung.tsx`:
1. Import: `import BausteinPicker from './BausteinPicker';` und Typen `import type { EtbBaustein, EinsatzAnzeige } from '../api/types';`.
2. Props-Interface der Komponente um zwei Felder erweitern:
```tsx
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
```
3. Im JSX, direkt über dem `typ`-Feld und nur außerhalb des Berichtigungs-Modus (die `form`-Instanz existiert bereits als `form`):
```tsx
    {!berichtigungZu && bausteine.length > 0 && (
      <BausteinPicker form={form} bausteine={bausteine} einsatz={einsatz} />
    )}
```

> Der Picker steht damit im selben `!berichtigungZu`-Zweig wie das `typ`-`Form.Item`. Im Berichtigungs-Modus wird er nicht gerendert (Spec §3).

- [ ] **Step 11.2: EtbPage lädt Bausteine + reicht durch**

In `frontend/src/pages/EtbPage.tsx`:
1. Import: `import { listeBausteine } from '../api/etbBaustein';`.
2. Query (bei den übrigen `useQuery`-Hooks):
```tsx
  const bausteineQuery = useQuery({ queryKey: ['etb-bausteine'], queryFn: listeBausteine });
```
3. Beim Rendern von `<Schnellerfassung … />` (im `darfSchreiben`-Zweig) zwei Props ergänzen:
```tsx
    bausteine={bausteineQuery.data ?? []}
    einsatz={einsatz}
```

> `einsatz` ist in `EtbPage` bereits als `EinsatzAnzeige` vorhanden (aus `einsatzQuery.data`, wird für `darfSchreiben` genutzt). Denselben Wert durchreichen.

- [ ] **Step 11.3: Bestehenden Schnellerfassung-Test anpassen**

`frontend/src/etb/Schnellerfassung.test.tsx` rendert `<Schnellerfassung />` ohne die neuen Pflicht-Props → TS-Fehler/Render-Bruch. In jeder Render-Stelle die zwei Props ergänzen:
```tsx
  bausteine={[]}
  einsatz={{ bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige}
```
(Import `import type { EinsatzAnzeige } from '../api/types';` ergänzen.) Mit `bausteine={[]}` wird der Picker nicht gerendert → bestehende Assertions bleiben gültig.

- [ ] **Step 11.4: Typecheck + betroffene Tests grün**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: keine Typfehler.

Run: `cd frontend && pnpm exec vitest run src/etb/Schnellerfassung.test.tsx`
Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/src/etb/Schnellerfassung.tsx frontend/src/pages/EtbPage.tsx frontend/src/etb/Schnellerfassung.test.tsx
git commit -m "feat(fe): BausteinPicker in Schnellerfassung integriert (LFH-42)"
```

---

## Abschluss-Verifikation (vor „fertig")

REQUIRED SUB-SKILL: `superpowers:verification-before-completion`.

- [ ] **V1: Volle Backend-Suite**

Run: `rtk proxy cargo test`
Expected: alle Tests grün; bestehende Seed-Zählungen unverändert.

- [ ] **V2: Volle Frontend-Suite (mit Anti-Flake-Flag)**

Run: `cd frontend && pnpm exec vitest run --no-file-parallelism`
Expected: alle Tests grün. (Volle Suite ist unter Last sonst flaky.)

- [ ] **V3: Lint/Typecheck Frontend**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: sauber.

- [ ] **V4: Manuelle Sichtprüfung (optional, aber empfohlen)**

Frontend ist via rust-embed ins Binary eingebettet → für eine manuelle Prüfung im Browser zuerst `cd frontend && pnpm build`, dann Backend neu starten. Im Dev-Modus (`pnpm dev` + laufendes Backend) entfällt das. Prüfen: Stammdaten-Tab „ETB-Schnellbausteine" (Admin sieht CRUD), Schnellerfassung zeigt „Baustein einsetzen …", Auswahl ohne Platzhalter setzt sofort, Auswahl mit `{einheit}` öffnet Dialog, im Berichtigungs-Modus ist der Picker weg.

---

## Self-Review-Notizen (vom Plan-Autor geprüft)

- **Spec-Abdeckung:** §1 Datenmodell→T1; §2 Engine→T8; §3 Einsetz-UX→T10/T11; §4 Berechtigungen→T4 (AdminUser/CurrentUser) + T6 (Tests); §5 Backend→T2–T5; §6 Frontend→T7–T11; §7 Tests→T6/T8/T9/T10; „Offene Punkte" (Soft-Delete vs. UNIQUE, 409)→T1 (plain UNIQUE) + T6.4 (409-Test gegen Deaktivierten).
- **Typ-Konsistenz:** `EtbBaustein`-Felder (id/label/typ/inhalt/meldeweg/veranlassung/sortier) identisch in `mod.rs` (FromRow), `SPALTEN`-Const, FE-`types.ts`, Engine, API-Client. `ermittlePlatzhalter`/`setzeBausteinEin` und `BausteinDaten`-Felder über alle Tasks gleich benannt.
- **Bewusste Spec-Abweichung:** 400 statt 422 (Konventions-Block Punkt 1) — dokumentiert, damit Self-Review/User es nicht als Fehler liest.
