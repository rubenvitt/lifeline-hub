# K&M‑4 — Material-Stamm & Disposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Material (Sachmittel) als org-weiten Stamm anlegen/pflegen und mit Menge + festem Status in Einsätze disponieren — inkl. Ad-hoc-Material, Identitäts-Schnappschuss, exklusiver Einheiten-Zuordnung und automatischer ETB-Spur.

**Architecture:** Das in K&M‑1 (Fahrzeuge) etablierte Dispositions-Pattern wird für Material wiederverwendet (`src/material/` analog `src/fahrzeug/`). Drei bewusste Abweichungen: (1) `menge ≥ 1` sitzt auf der Dispositionszeile (kein Bestandszähler), (2) der Status ist ein **festes CHECK-Enum** auf der Dispositionszeile statt eines admin-pflegbaren Katalogs, (3) **kein** `UNIQUE(einsatz_id, material_id)` (Mengen-Splitting durch mehrere Positionen). Material hat keine taktische Stärke und zählt nicht in die Einheiten-Stärke ein. Disponieren/Menge/Status/Einheit/Entfernen schreiben automatische System-ETB-Einträge.

**Tech Stack:** Rust (axum, sqlx/SQLite), TypeScript/React (antd, @tanstack/react-query), Vitest + MSW (Frontend), `cargo test` (Backend-Integrationstests in `tests/`).

---

## Spec

Quelle: `docs/superpowers/specs/2026-05-27-kraefte-mittel-material-disposition-design.md`

## File Structure

**Backend — neu:**
- `migrations/0018_material.sql` — Material-Stamm (global, org-weit), partieller Unique-Index auf `bestandsnummer`.
- `migrations/0019_einsatz_material.sql` — Dispositionstabelle `einsatz_material` (Menge, Status-Enum, Snapshot, `einheit_id`).
- `src/material/mod.rs` — Typen `Material` (`FromRow`), `MaterialAnzeige` (`Serialize`), `MaterialStatus`-Enum, `EinsatzMaterialAnzeige`.
- `src/material/repo.rs` — Stamm-CRUD + Soft-Delete + Kategorie-Vorschläge.
- `src/material/disposition_repo.rs` — Disposition (Auflösungsregel, Stamm/Ad-hoc, Menge/Status/Bemerkung, Entfernen).
- `src/routes/material.rs` — Stamm-Routen (Lesen für alle, Schreiben Admin).
- `src/routes/einsatz_material.rs` — Dispositions-Routen (Gating + ETB).
- `tests/material.rs` — Integrationstests Stamm.
- `tests/einsatz_material.rs` — Integrationstests Disposition + Einheit + ETB + Org-Isolation.

**Backend — geändert:**
- `src/lib.rs` — `pub mod material;`
- `src/routes/mod.rs` — `pub mod material; pub mod einsatz_material;`
- `src/app.rs` — Routen-Registrierung.
- `src/einheit/mitglied_repo.rs` — `ordne_material_zu`, `gib_material_frei`, `material_mitglieder`.
- `src/einheit/mod.rs` — `EinheitMitgliedMaterial` + Feld `material_mitglieder` auf `EinheitAnzeige`.
- `src/einheit/repo.rs` — `zu_anzeige` füllt `material_mitglieder`; `loese_auf` gibt Material frei.
- `src/routes/einsatz_einheit.rs` — `material_zuordnen`, `material_freigeben`.

**Frontend — neu:**
- `frontend/src/api/material.ts`, `frontend/src/api/einsatzMaterial.ts`
- `frontend/src/stammdaten/MaterialTab.tsx`, `frontend/src/stammdaten/MaterialFormModal.tsx`
- `frontend/src/pages/MaterialPage.tsx`
- Tests: `MaterialTab.test.tsx`, `MaterialPage.test.tsx`

**Frontend — geändert:**
- `frontend/src/api/types.ts` — `MaterialStatus`, `Material`, `EinsatzMaterial`, `EinheitMitgliedMaterial`, `Einheit.material_mitglieder`.
- `frontend/src/pages/StammdatenPage.tsx` — Tab „Material".
- `frontend/src/App.tsx` — `MaterialPage` in `MODUL_ELEMENTE`.
- `frontend/src/einsatz/modulRegistry.ts` — `material` von `'geplant'` auf `'fertig'`.
- `frontend/src/einsatz/modulRegistry.test.ts` — Regressionsassertion.
- `frontend/src/pages/EinheitenPage.tsx` — Material-Mitglieder-Sektion.

## Konventionen (gelten für den ganzen Plan)

- **Fehler-Mapping** (`src/error.rs`): `Forbidden`→403, `NotFound`→404, `Validation(_)`→400, `Conflict(_)`→409.
- **Dienststatus-Konstanten:** `crate::katalog::DIENSTSTATUS_IN_DIENST` (`"in_dienst"`), `DIENSTSTATUS_AUSSER_DIENST` (`"ausser_dienst"`).
- **ETB-Texte** (festgenagelt, mit `«…»`):
  - Disponieren: `Material «{bezeichnung}» (×{menge}) disponiert`
  - Menge-Wechsel: `Material «{bezeichnung}»: Menge {alt} → {neu}`
  - Status-Wechsel: `Material «{bezeichnung}»: Status «{alt}» → «{neu}»`
  - Entfernen: `Material «{bezeichnung}» aus dem Einsatz entfernt`
  - Einheit-Zuordnung: `Einheit «{einheit}»: Material «{bezeichnung}» (×{menge}) zugeordnet`
  - Einheit-Freigabe: `Einheit «{einheit}»: Material «{bezeichnung}» (×{menge}) freigegeben`
- **Backend-Test-Pool:** `crate::db::test_pool().await` spielt alle Migrationen ein.
- **Befehle:** Backend `cargo test`; Frontend aus `frontend/`: `npm test -- <pfad>` (Vitest), `npm run typecheck` (tsc).

---

## Task 1: Migration 0018 + Material-Typen

**Files:**
- Create: `migrations/0018_material.sql`
- Create: `src/material/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)

- [ ] **Step 1: Migration 0018 schreiben**

Create `migrations/0018_material.sql` (1:1 aus der Spec):

```sql
-- Material-Stamm (global, org-weit). Katalog von Material-Arten/-Stücken OHNE
-- gezählten Bestand: die Menge entsteht erst bei der Disposition (einsatz_material).
CREATE TABLE material (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung         TEXT NOT NULL,            -- "Wolldecke", "Stromerzeuger 5 kVA"
    kategorie           TEXT,                     -- Combobox; Vorschläge abgeleitet (DISTINCT)
    bestandsnummer      TEXT,                     -- optional, nur für einzeln verfolgte Geräte (Inventarnr.)
    traegerorganisation TEXT,                     -- frei; UI default = Name der eigenen Org
    standort            TEXT,                     -- Freitext (echter Standort-Stamm später)
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bestandsnummer je Organisation eindeutig, aber nur unter aktiven Stücken
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_material_bestandsnummer
    ON material(org_id, bestandsnummer)
    WHERE bestandsnummer IS NOT NULL AND dienststatus = 'in_dienst';
```

- [ ] **Step 2: `src/material/mod.rs` mit Typen + Enum-Unit-Tests schreiben**

Create `src/material/mod.rs`:

```rust
pub mod disposition_repo;
pub mod repo;

use serde::Serialize;

// Geteilte Dienststatus-Konstanten (wie Fahrzeug/Personal) aus crate::katalog.
pub use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};

/// Interner Material-Stamm-Datensatz (alle Spalten von `material`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Material {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

impl Material {
    /// Serialisierbare Anzeige (ohne `org_id`).
    pub fn anzeige(&self) -> MaterialAnzeige {
        MaterialAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            kategorie: self.kategorie.clone(),
            bestandsnummer: self.bestandsnummer.clone(),
            traegerorganisation: self.traegerorganisation.clone(),
            standort: self.standort.clone(),
            bemerkung: self.bemerkung.clone(),
            dienststatus: self.dienststatus.clone(),
            angelegt_at: self.angelegt_at.clone(),
        }
    }
}

/// Öffentliche Material-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize)]
pub struct MaterialAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Fester Status einer Material-Dispositionszeile (kein admin-pflegbarer Katalog).
/// Als TEXT in der DB gespeichert; manuell konvertiert (analog `StaerkePosition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum MaterialStatus {
    Einsatzbereit,
    ImEinsatz,
    Defekt,
    Verbraucht,
    DesinfektionNoetig,
}

impl MaterialStatus {
    /// DB-/API-Stringrepräsentation. **Muss exakt dem CHECK-Constraint in
    /// `migrations/0019_einsatz_material.sql` entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            MaterialStatus::Einsatzbereit => "einsatzbereit",
            MaterialStatus::ImEinsatz => "im_einsatz",
            MaterialStatus::Defekt => "defekt",
            MaterialStatus::Verbraucht => "verbraucht",
            MaterialStatus::DesinfektionNoetig => "desinfektion_noetig",
        }
    }

    /// Parst einen Statusstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<MaterialStatus> {
        match s {
            "einsatzbereit" => Some(MaterialStatus::Einsatzbereit),
            "im_einsatz" => Some(MaterialStatus::ImEinsatz),
            "defekt" => Some(MaterialStatus::Defekt),
            "verbraucht" => Some(MaterialStatus::Verbraucht),
            "desinfektion_noetig" => Some(MaterialStatus::DesinfektionNoetig),
            _ => None,
        }
    }
}

/// Aufgelöste Material-Dispositionszeile: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Material in Dienst, sonst Snapshot);
/// `menge` und `status` kommen **immer** aus der Dispositionszeile.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzMaterialAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Material (kein Stamm-Bezug).
    pub material_id: Option<i64>,
    /// Zugeordnete Einheit; `None` = freie, nicht zugeordnete Position.
    pub einheit_id: Option<i64>,
    pub ist_adhoc: bool,
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub menge: i64,
    pub status: String,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["einsatzbereit", "im_einsatz", "defekt", "verbraucht", "desinfektion_noetig"] {
            assert_eq!(MaterialStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(MaterialStatus::parse("unsinn").is_none());
    }

    #[test]
    fn anzeige_ohne_org_id() {
        let m = Material {
            id: 7,
            org_id: 1,
            bezeichnung: "Wolldecke".into(),
            kategorie: Some("Betreuung".into()),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
            dienststatus: DIENSTSTATUS_IN_DIENST.into(),
            angelegt_at: "2026-05-27 10:00:00".into(),
        };
        let a = m.anzeige();
        assert_eq!(a.id, 7);
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.dienststatus, "in_dienst");
    }
}
```

- [ ] **Step 3: Modul in `src/lib.rs` registrieren**

In `src/lib.rs` nach der Zeile `pub mod katalog;` einfügen (alphabetisch zwischen `katalog` und `live`):

```rust
pub mod material;
```

- [ ] **Step 4: Kompilieren + Unit-Tests**

Run: `cargo test material::tests -- --nocapture`
Expected: PASS (`status_roundtrip`, `anzeige_ohne_org_id`). Die Migration 0018 wird durch `test_pool` mit eingespielt; ein Migrationsfehler würde hier auffallen.

> Hinweis: `disposition_repo` ist noch leer und wird in Task 4/5 gefüllt. Damit `cargo test` jetzt baut, lege in **diesem** Step eine Platzhalter-Datei an, falls der Compiler `disposition_repo`/`repo` vermisst — sie werden in Task 2 (repo) und Task 5 (disposition_repo) befüllt. Erzeuge minimale leere Module:
> - `src/material/repo.rs` mit Inhalt `// in Task 2 befüllt`
> - `src/material/disposition_repo.rs` mit Inhalt `// in Task 5 befüllt`

- [ ] **Step 5: Commit**

```bash
git add migrations/0018_material.sql src/material/mod.rs src/material/repo.rs src/material/disposition_repo.rs src/lib.rs
git commit -m "feat(material): Migration 0018 + Stamm-/Status-Typen"
```

---

## Task 2: Material-Stamm-Repository

**Files:**
- Modify (befüllen): `src/material/repo.rs`

- [ ] **Step 1: Repository mit Funktionen + Unit-Tests schreiben**

Replace the placeholder content of `src/material/repo.rs` with:

```rust
use super::{Material, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Material` (FromRow).
const SPALTEN: &str = "id, org_id, bezeichnung, kategorie, bestandsnummer, \
     traegerorganisation, standort, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
#[derive(Debug)]
pub struct MaterialDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub bemerkung: Option<&'a str>,
}

/// Übersetzt einen Unique-Verstoß auf dem Bestandsnummer-Index in `Conflict`.
fn bestandsnummer_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Bestandsnummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Material der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Material, AppError> {
    sqlx::query_as::<_, Material>(&format!(
        "SELECT {SPALTEN} FROM material WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Material-Stücke der Org, sortiert nach Bezeichnung.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Material>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY bezeichnung")
    } else {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? ORDER BY bezeichnung")
    };
    sqlx::query_as::<_, Material>(&sql)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Abgeleitete Kategorie-Vorschläge (DISTINCT, org-weit, nicht-leer, sortiert) für die
/// AutoComplete. Kein eigener Katalog/keine eigene Tabelle.
pub async fn kategorien(pool: &SqlitePool, org_id: i64) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT kategorie FROM material \
         WHERE org_id = ? AND kategorie IS NOT NULL AND kategorie <> '' \
         ORDER BY kategorie",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt ein Material an. Dublette Bestandsnummer (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO material \
            (org_id, bezeichnung, kategorie, bestandsnummer, traegerorganisation, standort, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return bestandsnummer_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Bestandsnummer-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE material SET \
            bezeichnung = ?, kategorie = ?, bestandsnummer = ?, \
            traegerorganisation = ?, standort = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei fremder
/// Org; `Conflict`, wenn beim Reaktivieren die Bestandsnummer inzwischen aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Material, AppError> {
    let neuer = if in_dienst { DIENSTSTATUS_IN_DIENST } else { DIENSTSTATUS_AUSSER_DIENST };
    let ergebnis = sqlx::query("UPDATE material SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung,
            kategorie: Some("Betreuung"),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert_eq!(m.bezeichnung, "Wolldecke");
        assert_eq!(m.dienststatus, "in_dienst");
        assert_eq!(laden(&pool, 1, m.id).await.unwrap().id, m.id);
    }

    #[tokio::test]
    async fn bezeichnung_nicht_eindeutig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(anlegen(&pool, 1, daten("Wolldecke")).await.is_ok(), "zwei „Wolldecke" erlaubt");
    }

    #[tokio::test]
    async fn bestandsnummer_dublette_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, d).await.unwrap();
        let mut d2 = daten("Stromerzeuger 2");
        d2.bestandsnummer = Some("INV-1");
        assert!(matches!(anlegen(&pool, 1, d2).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn bestandsnummer_null_beliebig_oft() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("A")).await.unwrap();
        anlegen(&pool, 1, daten("B")).await.unwrap();
        assert_eq!(liste(&pool, 1, false).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn bestandsnummer_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let mut a = daten("Gerät");
        a.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, a).await.unwrap();
        let mut b = daten("Gerät");
        b.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 2, b).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_gibt_bestandsnummer_frei() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        let m = anlegen(&pool, 1, d).await.unwrap();

        setze_dienststatus(&pool, 1, m.id, false).await.unwrap();
        assert!(liste(&pool, 1, true).await.unwrap().is_empty(), "nicht in nur_im_dienst");
        assert_eq!(liste(&pool, 1, false).await.unwrap().len(), 1, "aber referenzierbar");
        // Nummer nach Außer-Dienst neu vergebbar.
        let mut neu = daten("Stromerzeuger neu");
        neu.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 1, neu).await.is_ok());
    }

    #[tokio::test]
    async fn kategorien_distinct_sortiert() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        for (b, k) in [("Decke", "Betreuung"), ("Sandsack", "Hochwasser"), ("Wolldecke", "Betreuung")] {
            let mut d = daten(b);
            d.kategorie = Some(k);
            anlegen(&pool, 1, d).await.unwrap();
        }
        assert_eq!(kategorien(&pool, 1).await.unwrap(), vec!["Betreuung".to_string(), "Hochwasser".to_string()]);
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(laden(&pool, 2, m.id).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 2: Tests laufen lassen**

Run: `cargo test material::repo::tests`
Expected: PASS (alle 8 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/material/repo.rs
git commit -m "feat(material): Stamm-Repository mit Soft-Delete + Kategorie-Vorschlägen"
```

---

## Task 3: Material-Stamm-Routen

**Files:**
- Create: `src/routes/material.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Create: `tests/material.rs`

- [ ] **Step 1: Routen-Handler schreiben**

Create `src/routes/material.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::material::repo::{self, MaterialDaten};
use crate::material::MaterialAnzeige;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct MaterialBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Owned, validierte Felder; `MaterialDaten` borgt daraus.
struct Normalisiert {
    bezeichnung: String,
    kategorie: Option<String>,
    bestandsnummer: Option<String>,
    traegerorganisation: Option<String>,
    standort: Option<String>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung: &self.bezeichnung,
            kategorie: self.kategorie.as_deref(),
            bestandsnummer: self.bestandsnummer.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            standort: self.standort.as_deref(),
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: MaterialBody) -> Result<Normalisiert, AppError> {
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    Ok(Normalisiert {
        bezeichnung,
        kategorie: trimme(body.kategorie),
        bestandsnummer: trimme(body.bestandsnummer),
        traegerorganisation: trimme(body.traegerorganisation),
        standort: trimme(body.standort),
        bemerkung: trimme(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/material — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MaterialAnzeige>>, AppError> {
    let material = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(material.iter().map(|m| m.anzeige()).collect()))
}

/// GET /api/material-kategorien — abgeleitete Kategorie-Vorschläge (eigene Org).
pub async fn kategorien(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(repo::kategorien(&state.pool, benutzer.org_id).await?))
}

/// POST /api/material — Admin. Dublette Bestandsnummer → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<MaterialBody>,
) -> Result<(StatusCode, Json<MaterialAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let m = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(m.anzeige())))
}

/// PATCH /api/material/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<MaterialBody>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let n = normalisiere(body)?;
    let m = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Nummernkollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(m.anzeige()))
}
```

- [ ] **Step 2: Routen-Modul deklarieren**

In `src/routes/mod.rs` nach `pub mod katalog;`-Block — konkret: nach Zeile `pub mod health;` einfügen (alphabetische Nähe ist nicht streng eingehalten; ans Ende der bestehenden Liste vor `pub mod personal;` passt ebenfalls). Füge ein:

```rust
pub mod material;
```

- [ ] **Step 3: Stamm-Routen in `src/app.rs` registrieren**

In `src/app.rs` direkt **vor** der Zeile `.route("/api/fahrzeug-status", get(routes::fahrzeug_status::liste))` (also unmittelbar nach dem `/api/fahrzeuge/{id}/in-dienst`-Block, Zeile ~94) einfügen:

```rust
        .route("/api/material", get(routes::material::liste))
        .route("/api/material", post(routes::material::anlegen))
        .route("/api/material-kategorien", get(routes::material::kategorien))
        .route("/api/material/{id}", patch(routes::material::aktualisieren))
        .route(
            "/api/material/{id}/ausser-dienst",
            post(routes::material::ausser_dienst),
        )
        .route(
            "/api/material/{id}/in-dienst",
            post(routes::material::in_dienst),
        )
```

- [ ] **Step 4: Integrationstests schreiben**

Create `tests/material.rs`. Der Harness-Kopf (Zeilen 1–88) ist **identisch** zu `tests/fahrzeug.rs` — kopiere ihn exakt (Imports, `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`) und ersetze nur die `// ---------- Tests ----------`-Sektion durch:

```rust
// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_material_an_alle_lesen_es() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/material", &admin,
        Some(r#"{"bezeichnung":"Wolldecke","kategorie":"Betreuung"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["dienststatus"], "in_dienst");

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/material", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(&app, "POST", "/api/material", &erika, Some(r#"{"bezeichnung":"Verboten"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn bezeichnung_nicht_eindeutig_zwei_wolldecken() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"bezeichnung":"Wolldecke"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/material", &admin, Some(body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/material", &admin, Some(body)).await.0, StatusCode::CREATED);
}

#[tokio::test]
async fn dublette_bestandsnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"bezeichnung":"Stromerzeuger","bestandsnummer":"INV-1"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/material", &admin, Some(body)).await.0, StatusCode::CREATED);
    let body2 = r#"{"bezeichnung":"Stromerzeuger 2","bestandsnummer":"INV-1"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/material", &admin, Some(body2)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn leere_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"   "}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"Wolldecke"}"#)).await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(&app, "POST", &format!("/api/material/{id}/ausser-dienst"), &admin, None).await.0,
        StatusCode::OK
    );
    let (_, im_dienst) = anfrage(&app, "GET", "/api/material?nur_im_dienst=true", &admin, None).await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/material", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"Wolldecke"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/material/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn kategorien_endpunkt_liefert_distinct() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"Decke","kategorie":"Betreuung"}"#)).await;
    anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"Wolldecke","kategorie":"Betreuung"}"#)).await;
    anfrage(&app, "POST", "/api/material", &admin, Some(r#"{"bezeichnung":"Sandsack","kategorie":"Hochwasser"}"#)).await;
    let (status, json) = anfrage(&app, "GET", "/api/material-kategorien", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 2, "DISTINCT: Betreuung, Hochwasser");
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --test material`
Expected: PASS (8 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/material.rs src/routes/mod.rs src/app.rs tests/material.rs
git commit -m "feat(material): Stamm-Routen (CRUD/Soft-Delete/Kategorien) + Tests"
```

---

## Task 4: Migration 0019 (Dispositionstabelle)

**Files:**
- Create: `migrations/0019_einsatz_material.sql`

- [ ] **Step 1: Migration schreiben**

Create `migrations/0019_einsatz_material.sql` (1:1 aus der Spec):

```sql
-- Disposition: Zuordnung von Stamm-/Ad-hoc-Material zu einem konkreten Einsatz.
-- Menge sitzt auf der Dispositionszeile (kein Bestandszähler im Stamm). Status ist
-- ein festes Enum (kein Katalog). Identitäts-Schnappschuss (snap_*) für
-- Nachvollziehbarkeit / Ad-hoc-Daten. KEIN UNIQUE(einsatz_id, material_id):
-- dieselbe Art darf mehrfach als getrennte Position (Mengen-Splitting auf Einheiten).
CREATE TABLE einsatz_material (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    material_id     INTEGER REFERENCES material(id),          -- NULL = Ad-hoc extern
    einheit_id      INTEGER REFERENCES einsatz_einheit(id),   -- Mitgliedschaft (exklusiv); NULL = frei
    menge           INTEGER NOT NULL DEFAULT 1 CHECK (menge >= 1),
    status          TEXT NOT NULL DEFAULT 'einsatzbereit'
                    CHECK (status IN ('einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig')),
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_bezeichnung         TEXT NOT NULL,
    snap_kategorie           TEXT,
    snap_bestandsnummer      TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_material_einsatz ON einsatz_material(einsatz_id);
```

- [ ] **Step 2: Migration einspielen verifizieren**

Run: `cargo test material::tests::status_roundtrip`
Expected: PASS — bestätigt, dass `test_pool` (alle Migrationen inkl. 0019) sauber lädt. Ein SQL-Fehler in 0019 würde hier brechen.

- [ ] **Step 3: Commit**

```bash
git add migrations/0019_einsatz_material.sql
git commit -m "feat(material): Migration 0019 (einsatz_material) — Menge + Status-Enum"
```

---

## Task 5: Dispositions-Repository

**Files:**
- Modify (befüllen): `src/material/disposition_repo.rs`

- [ ] **Step 1: Repository mit Funktionen + Unit-Tests schreiben**

Replace the placeholder content of `src/material/disposition_repo.rs` with:

```rust
use super::{EinsatzMaterialAnzeige, MaterialStatus, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use sqlx::SqlitePool;

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN material). Status ist ein festes
/// Enum direkt auf der Zeile — kein Katalog-JOIN. Live vs. Snapshot trifft `zu_anzeige`.
const SELECT_AUFGELOEST: &str = "\
    SELECT em.id, em.einsatz_id, em.material_id, em.einheit_id, em.menge, em.status, \
           em.snap_bezeichnung, em.snap_kategorie, em.snap_bestandsnummer, \
           em.snap_traegerorganisation, em.bemerkung, em.disponiert_at, em.disponiert_von, \
           m.bezeichnung AS live_bezeichnung, m.kategorie AS live_kategorie, \
           m.bestandsnummer AS live_bestandsnummer, m.traegerorganisation AS live_traegerorganisation, \
           m.dienststatus AS live_dienststatus \
    FROM einsatz_material em \
    LEFT JOIN material m ON m.id = em.material_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    material_id: Option<i64>,
    einheit_id: Option<i64>,
    menge: i64,
    status: String,
    snap_bezeichnung: String,
    snap_kategorie: Option<String>,
    snap_bestandsnummer: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_bezeichnung: Option<String>,
    live_kategorie: Option<String>,
    live_bestandsnummer: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
}

/// Auflösungsregel: Live-Felder aus dem Stamm nur, wenn ein Stamm-Bezug besteht, der
/// Einsatz aktiv ist UND das Material noch in Dienst ist. Sonst Snapshot. `menge`/`status`
/// kommen immer aus der Dispositionszeile.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzMaterialAnzeige {
    let live = row.material_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (bezeichnung, kategorie, bestandsnummer, traeger) = if live {
        (
            row.live_bezeichnung.clone().unwrap_or_else(|| row.snap_bezeichnung.clone()),
            row.live_kategorie,
            row.live_bestandsnummer,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_bezeichnung,
            row.snap_kategorie,
            row.snap_bestandsnummer,
            row.snap_traegerorganisation,
        )
    };

    EinsatzMaterialAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        material_id: row.material_id,
        einheit_id: row.einheit_id,
        ist_adhoc: row.material_id.is_none(),
        bezeichnung,
        kategorie,
        bestandsnummer,
        traegerorganisation: traeger,
        menge: row.menge,
        status: row.status,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für Ad-hoc-externes Material (kein Stamm-Bezug); bereits getrimmt.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
}

/// Disponiertes Material eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? ORDER BY em.disponiert_at, em.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| zu_anzeige(r, einsatz_aktiv)).collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    em_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzMaterialAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE em.id = ? AND em.einsatz_id = ?"
    ))
    .bind(em_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert Stamm-Material mit Menge. Prüft Org-Zugehörigkeit + Dienststatus, friert
/// den Identitäts-Schnappschuss ein. `NotFound` bei fremdem/unbekanntem Material,
/// `Validation` bei außer Dienst. Mehrfach-Disposition ist erlaubt (kein Conflict).
/// Liefert die neue `em_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    material_id: i64,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT bezeichnung, kategorie, bestandsnummer, traegerorganisation, dienststatus \
         FROM material WHERE id = ? AND org_id = ?",
    )
    .bind(material_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (bezeichnung, kategorie, bestandsnummer, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Material ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }

    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(material_id)
    .bind(menge)
    .bind(&bezeichnung)
    .bind(&kategorie)
    .bind(&bestandsnummer)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Disponiert Ad-hoc-externes Material (`material_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Liefert die neue `em_id`.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: AdhocDaten<'_>,
    menge: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_material \
            (einsatz_id, material_id, menge, snap_bezeichnung, snap_kategorie, \
             snap_bestandsnummer, snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(menge)
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Aktualisiert Menge, Status und/oder Bemerkung (COALESCE: `None` = unverändert).
/// `status` muss bereits validiert sein (gültiges Enum). `NotFound`, falls die Zeile
/// nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    em_id: i64,
    menge: Option<i64>,
    status: Option<&str>,
    bemerkung: Option<&str>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_material \
         SET menge = COALESCE(?, menge), status = COALESCE(?, status), \
             bemerkung = COALESCE(?, bemerkung) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(menge)
    .bind(status)
    .bind(bemerkung)
    .bind(em_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Entfernt eine Dispositionszeile aus dem Einsatz (der Stamm bleibt). `NotFound`,
/// falls nicht zum Einsatz gehörend.
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, em_id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("DELETE FROM einsatz_material WHERE id = ? AND einsatz_id = ?")
        .bind(em_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::material::repo::{self as mat_repo, MaterialDaten};

    /// Org(1) + Benutzer + Einsatz; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer, einsatz)
    }

    fn mat_daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung, kategorie: Some("Betreuung"), bestandsnummer: None,
            traegerorganisation: None, standort: None, bemerkung: None,
        }
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_default_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();

        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.bezeichnung, "Wolldecke");
        assert_eq!(a.menge, 50);
        assert_eq!(a.status, "einsatzbereit");
        assert!(!a.ist_adhoc);
        assert_eq!(a.kategorie.as_deref(), Some("Betreuung"));
    }

    #[tokio::test]
    async fn disponiere_stamm_mehrfach_erlaubt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 30, benutzer).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, m.id, 20, benutzer).await.unwrap();
        assert_eq!(liste(&pool, einsatz, true).await.unwrap().len(), 2, "kein UNIQUE — Mengen-Splitting");
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool).await.unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO material (org_id, bezeichnung) VALUES (2, 'Fremd-Decke') RETURNING id",
        ).fetch_one(&pool).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd, 1, benutzer).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();
        mat_repo::setze_dienststatus(&pool, 1, m.id, false).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, m.id, 1, benutzer).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_ohne_stamm() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let em = disponiere_adhoc(&pool, einsatz, AdhocDaten {
            bezeichnung: "Spende-Decken", kategorie: None, bestandsnummer: None,
            traegerorganisation: Some("THW"),
        }, 100, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.ist_adhoc && a.material_id.is_none());
        assert_eq!(a.menge, 100);
        assert_eq!(a.traegerorganisation.as_deref(), Some("THW"));
    }

    #[tokio::test]
    async fn aktualisiere_menge_status_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer).await.unwrap();

        aktualisiere(&pool, einsatz, em, Some(30), Some(MaterialStatus::Defekt.as_str()), Some("nass")).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.menge, 30);
        assert_eq!(a.status, "defekt");
        assert_eq!(a.bemerkung.as_deref(), Some("nass"));

        // Nur Status ändern (menge/bemerkung None → bleiben).
        aktualisiere(&pool, einsatz, em, None, Some(MaterialStatus::Verbraucht.as_str()), None).await.unwrap();
        let b = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(b.menge, 30, "Menge unverändert");
        assert_eq!(b.status, "verbraucht");

        entferne(&pool, einsatz, em).await.unwrap();
        assert!(matches!(laden_anzeige(&pool, einsatz, em, true).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer).await.unwrap();

        // Stamm nachträglich umbenennen.
        mat_repo::aktualisiere(&pool, 1, m.id, mat_daten("Wolldecke NEU")).await.unwrap();

        // Aktiver Einsatz + in Dienst → Live (neuer Name); menge/status aus der Zeile.
        let live = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(live.bezeichnung, "Wolldecke NEU");
        assert_eq!(live.menge, 50);

        // Abgeschlossener Einsatz (einsatz_aktiv=false) → Snapshot (alter Name).
        let snap = laden_anzeige(&pool, einsatz, em, false).await.unwrap();
        assert_eq!(snap.bezeichnung, "Wolldecke");

        // Stamm außer Dienst → auch bei aktivem Einsatz Snapshot.
        mat_repo::setze_dienststatus(&pool, 1, m.id, false).await.unwrap();
        let nach_ad = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(nach_ad.bezeichnung, "Wolldecke", "außer Dienst → Snapshot trotz aktivem Einsatz");
    }
}
```

- [ ] **Step 2: Tests laufen lassen**

Run: `cargo test material::disposition_repo::tests`
Expected: PASS (7 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/material/disposition_repo.rs
git commit -m "feat(material): Dispositions-Repository (Stamm/Ad-hoc, Menge/Status, Snapshot)"
```

---

## Task 6: Dispositions-Routen + ETB

**Files:**
- Create: `src/routes/einsatz_material.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Create: `tests/einsatz_material.rs`

- [ ] **Step 1: Routen-Handler schreiben**

Create `src/routes/einsatz_material.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::material::disposition_repo::{self, AdhocDaten};
use crate::material::{EinsatzMaterialAnzeige, MaterialStatus};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (identisch zu `routes::einsatz_fahrzeug::etb_system`).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/material — disponiertes Material (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzMaterialAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub material_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
    pub menge: Option<i64>,
}

/// POST /api/einsaetze/{id}/material — Stamm-Material disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag (inkl. Menge).
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzMaterialAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let menge = body.menge.unwrap_or(1);
    if menge < 1 {
        return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
    }

    let em_id = match (body.material_id, body.adhoc) {
        (Some(material_id), None) => {
            disposition_repo::disponiere_stamm(
                &state.pool, einsatz_id, einsatz.org_id, material_id, menge, benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let bezeichnung = adhoc.bezeichnung.trim().to_string();
            if bezeichnung.is_empty() {
                return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
            }
            let kategorie = trimme(adhoc.kategorie);
            let bestandsnummer = trimme(adhoc.bestandsnummer);
            let traeger = trimme(adhoc.traegerorganisation);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                AdhocDaten {
                    bezeichnung: &bezeichnung,
                    kategorie: kategorie.as_deref(),
                    bestandsnummer: bestandsnummer.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                },
                menge,
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder material_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Material «{}» (×{}) disponiert", anzeige.bezeichnung, anzeige.menge),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    pub status: Option<String>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/material/{em_id} — Menge und/oder Status und/oder Bemerkung.
/// Mengen-Änderung und Status-Wechsel schreiben je einen ETB-Eintrag; eine reine
/// Bemerkungsänderung schreibt keinen.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, em_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if let Some(menge) = body.menge {
        if menge < 1 {
            return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
        }
    }
    // Status validieren (festes Enum). Ungültig → Validation.
    let status = match &body.status {
        Some(s) => {
            let parsed = MaterialStatus::parse(s).ok_or_else(|| AppError::Validation("Unbekannter Status".into()))?;
            Some(parsed.as_str())
        }
        None => None,
    };

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    // Bemerkung: im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert (COALESCE). Daher NICHT über `trimme` zu None kollabieren lassen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(&state.pool, einsatz_id, em_id, body.menge, status, bemerkung).await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;

    if vorher.menge != nachher.menge {
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Material «{}»: Menge {} → {}", nachher.bezeichnung, vorher.menge, nachher.menge),
        )
        .await?;
    }
    if vorher.status != nachher.status {
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Material «{}»: Status «{}» → «{}»", nachher.bezeichnung, vorher.status, nachher.status),
        )
        .await?;
    }
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/material/{em_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, em_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, em_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Material «{}» aus dem Einsatz entfernt", anzeige.bezeichnung),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Routen-Modul deklarieren**

In `src/routes/mod.rs` einfügen (neben den anderen `einsatz_*`-Modulen):

```rust
pub mod einsatz_material;
```

- [ ] **Step 3: Dispositions-Routen in `src/app.rs` registrieren**

In `src/app.rs` direkt **nach** dem `/api/einsaetze/{id}/personal/{ep_id}`-DELETE-Block (Zeile ~72, vor `/api/einsaetze/{id}/abschnitte`) einfügen:

```rust
        .route("/api/einsaetze/{id}/material", get(routes::einsatz_material::liste))
        .route("/api/einsaetze/{id}/material", post(routes::einsatz_material::disponieren))
        .route("/api/einsaetze/{id}/material/{em_id}", patch(routes::einsatz_material::aktualisieren))
        .route("/api/einsaetze/{id}/material/{em_id}", delete(routes::einsatz_material::entfernen))
```

- [ ] **Step 4: Integrationstests schreiben**

Create `tests/einsatz_material.rs`. Kopiere den Harness-Kopf (Zeilen 1–121, inkl. `einsatz_anlegen`, `rolle_setzen`, `system_etb_anzahl`) **exakt** aus `tests/einsatz_fahrzeug.rs`, ersetze aber den `fahrzeug_anlegen`-Helfer durch einen Material-Helfer und die Tests:

```rust
// ---------- Zusatz-Helfer (statt fahrzeug_anlegen) ----------

/// Legt Stamm-Material an (Admin) und liefert dessen id.
async fn material_anlegen(app: &axum::Router, admin: &str, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/material", admin,
        Some(&format!(r#"{{"bezeichnung":"{bezeichnung}","kategorie":"Betreuung"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_mit_menge_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["menge"], 50);
    assert_eq!(json["status"], "einsatzbereit");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "Disponieren schreibt 1 System-ETB");
}

#[tokio::test]
async fn dasselbe_material_mehrfach_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let body = format!(r#"{{"material_id":{mat},"menge":30}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&body)).await.0, StatusCode::CREATED, "kein Conflict");
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn adhoc_ohne_stamm_mit_pflicht_bezeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(r#"{"adhoc":{"bezeichnung":"Spende-Decken","traegerorganisation":"THW"},"menge":100}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["material_id"].is_null());
    assert_eq!(json["menge"], 100);
}

#[tokio::test]
async fn menge_unter_eins_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":0}}"#)),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn beobachter_liest_nicht_disponiert_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &erika, None).await.0, StatusCode::OK);
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &erika, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn menge_und_status_aenderung_schreiben_je_einen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#))).await;
    let em = json["id"].as_i64().unwrap();

    // Menge UND Status in einem PATCH → +2 System-ETB.
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"menge":30,"status":"defekt"}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["menge"], 30);
    assert_eq!(json["status"], "defekt");

    // Disponieren (1) + Menge (1) + Status (1) = 3.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn ungueltiger_status_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"status":"kaputtnochmal"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn reine_bemerkung_schreibt_keinen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();

    let (_, gesetzt) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, Some(r#"{"bemerkung":"Lagerhalle 2"}"#)).await;
    assert_eq!(gesetzt["bemerkung"], "Lagerhalle 2");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "nur die Disposition selbst");
}

#[tokio::test]
async fn entfernen_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat}}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/material/{em}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 2, "Disponieren + Entfernen");
}

#[tokio::test]
async fn org_isolation_fremdes_material_nicht_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Fremde Org + fremdes Material direkt in der DB wäre nötig; einfacher über die
    // NotFound-Semantik: eine nicht existierende material_id liefert NotFound (404).
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(r#"{"material_id":999999}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

> Hinweis zum letzten Test: Echte Cross-Org-Disposition (Org A disponiert Material von Org B) wird auf Repo-Ebene bereits in `disposition_repo::tests::disponiere_stamm_fremde_org_ist_notfound` abgedeckt. Der Route-Test prüft hier die `NotFound`-Weiterleitung.

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --test einsatz_material`
Expected: PASS (11 Tests). Danach `cargo test` (alles) zur Sicherheit.

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_material.rs src/routes/mod.rs src/app.rs tests/einsatz_material.rs
git commit -m "feat(material): Dispositions-Routen + ETB-Integration + Tests"
```

---

## Task 7: Material → Einheit (Mitgliedschaft + Auflösen)

**Files:**
- Modify: `src/einheit/mod.rs`
- Modify: `src/einheit/mitglied_repo.rs`
- Modify: `src/einheit/repo.rs`
- Modify: `src/routes/einsatz_einheit.rs`
- Modify: `src/app.rs`

- [ ] **Step 1: `EinheitMitgliedMaterial` + Feld auf `EinheitAnzeige`**

In `src/einheit/mod.rs` nach der `EinheitMitgliedFahrzeug`-Struct (Zeile ~50) einfügen:

```rust
/// Material-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitMitgliedMaterial {
    /// `einsatz_material.id` der Dispozeile.
    pub em_id: i64,
    pub bezeichnung: String,
    pub menge: i64,
    /// Festes Status-Enum als String (z. B. "einsatzbereit").
    pub status: String,
}
```

In derselben Datei, in `pub struct EinheitAnzeige` nach dem Feld `pub fahrzeug_mitglieder: Vec<EinheitMitgliedFahrzeug>,` ergänzen:

```rust
    pub material_mitglieder: Vec<EinheitMitgliedMaterial>,
```

- [ ] **Step 2: Repo-Funktionen in `mitglied_repo.rs` + Unit-Tests**

In `src/einheit/mitglied_repo.rs`:

(a) Den `use`-Kopf (Zeile 1) erweitern:

```rust
use super::{EinheitMitgliedFahrzeug, EinheitMitgliedMaterial, EinheitMitgliedPerson};
```

(b) Nach `gib_fahrzeug_frei` (Zeile ~72) einfügen:

```rust
/// Ordnet eine Material-Dispozeile einer Einheit zu (exklusiv; Material kann kein Führer
/// sein). `NotFound` analog. Liefert (Bezeichnung, Menge) für den ETB-Text.
pub async fn ordne_material_zu(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, em_id: i64) -> Result<(String, i64), AppError> {
    pruefe_einheit(pool, einsatz_id, einheit_id).await?;
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT snap_bezeichnung, menge FROM einsatz_material WHERE id = ? AND einsatz_id = ?",
    ).bind(em_id).bind(einsatz_id).fetch_optional(pool).await?;
    let row = row.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_material SET einheit_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(em_id).bind(einsatz_id).execute(pool).await?;
    Ok(row)
}

/// Gibt eine Material-Dispozeile aus ihrer Einheit frei. `NotFound`, falls nicht zu dieser
/// Einheit. Liefert (Bezeichnung, Menge).
pub async fn gib_material_frei(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, em_id: i64) -> Result<(String, i64), AppError> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT snap_bezeichnung, menge FROM einsatz_material WHERE id = ? AND einsatz_id = ? AND einheit_id = ?",
    ).bind(em_id).bind(einsatz_id).bind(einheit_id).fetch_optional(pool).await?;
    let row = row.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_material SET einheit_id = NULL WHERE id = ?")
        .bind(em_id).execute(pool).await?;
    Ok(row)
}

#[derive(sqlx::FromRow)]
struct MaterialRow { em_id: i64, bezeichnung: String, menge: i64, status: String }

/// Material-Mitglieder einer Einheit (Snapshot-Bezeichnung + Menge + Status).
pub async fn material_mitglieder(pool: &SqlitePool, einheit_id: i64) -> Result<Vec<EinheitMitgliedMaterial>, AppError> {
    let rows = sqlx::query_as::<_, MaterialRow>(
        "SELECT id AS em_id, snap_bezeichnung AS bezeichnung, menge, status \
         FROM einsatz_material WHERE einheit_id = ? ORDER BY id",
    ).bind(einheit_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| EinheitMitgliedMaterial {
        em_id: r.em_id, bezeichnung: r.bezeichnung, menge: r.menge, status: r.status,
    }).collect())
}
```

(c) In den `#[cfg(test)] mod tests` (am Dateiende) einen Test ergänzen — direkt nach `fahrzeug_zuordnen_und_freigeben`:

```rust
    #[tokio::test]
    async fn material_zuordnen_und_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, menge) VALUES (?, 'Wolldecke', 50) RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();

        let (bez, menge) = ordne_material_zu(&pool, einsatz, a, em).await.unwrap();
        assert_eq!((bez.as_str(), menge), ("Wolldecke", 50));
        assert_eq!(material_mitglieder(&pool, a).await.unwrap().len(), 1);

        // Exklusiv: erneutes Zuordnen zu B wechselt.
        ordne_material_zu(&pool, einsatz, b, em).await.unwrap();
        assert!(material_mitglieder(&pool, a).await.unwrap().is_empty());
        assert_eq!(material_mitglieder(&pool, b).await.unwrap().len(), 1);

        // Freigeben aus falscher Einheit (a) → NotFound.
        assert!(matches!(gib_material_frei(&pool, einsatz, a, em).await.unwrap_err(), AppError::NotFound));
        // Freigeben aus b.
        gib_material_frei(&pool, einsatz, b, em).await.unwrap();
        assert!(material_mitglieder(&pool, b).await.unwrap().is_empty());
    }
```

- [ ] **Step 3: `zu_anzeige` in `repo.rs` füllt `material_mitglieder` + `loese_auf` gibt Material frei**

In `src/einheit/repo.rs`, Funktion `zu_anzeige` (Zeile ~66): nach der Zeile

```rust
    let fahrzeug_mitglieder = mitglied_repo::fahrzeug_mitglieder(pool, row.id).await?;
```

einfügen:

```rust
    let material_mitglieder = mitglied_repo::material_mitglieder(pool, row.id).await?;
```

Im `Ok(EinheitAnzeige { ... })`-Block (Zeile ~85) nach `fahrzeug_mitglieder,` ergänzen:

```rust
        material_mitglieder,
```

In `loese_auf` (Zeile ~270), in der Transaktion direkt nach der `einsatz_fahrzeug`-Freigabe einfügen:

```rust
    sqlx::query("UPDATE einsatz_material SET einheit_id = NULL WHERE einheit_id = ?").bind(id).execute(&mut *tx).await?;
```

- [ ] **Step 4: Auflösungs-Freigabe-Test in `repo.rs` ergänzen**

In `src/einheit/repo.rs` `#[cfg(test)] mod tests` einen Test ergänzen (am Ende vor der schließenden `}` des Test-Moduls):

```rust
    #[tokio::test]
    async fn aufloesen_gibt_material_frei() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let gruppe = anlegen(&pool, einsatz, 1, daten("Gruppe", None, None, None, None), b).await.unwrap();
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, einheit_id, snap_bezeichnung, menge) VALUES (?, ?, 'Wolldecke', 50) RETURNING id",
        ).bind(einsatz).bind(gruppe.id).fetch_one(&pool).await.unwrap();

        loese_auf(&pool, einsatz, gruppe.id).await.unwrap();
        let einheit_id: Option<i64> = sqlx::query_scalar("SELECT einheit_id FROM einsatz_material WHERE id = ?")
            .bind(em).fetch_one(&pool).await.unwrap();
        assert_eq!(einheit_id, None, "Material muss beim Auflösen frei werden");
    }
```

> Hinweis: `anlegen`/`daten`/`setup` existieren bereits im Test-Modul (siehe bestehende Tests). Falls die Signatur von `anlegen` abweicht, orientiere dich an dem unmittelbar darüberstehenden Test `anlegen_loest_typ_und_abschnitt_auf`.

- [ ] **Step 5: Routen-Handler in `einsatz_einheit.rs`**

In `src/routes/einsatz_einheit.rs` nach `fahrzeug_freigeben` (Zeile ~226) einfügen:

```rust
/// PUT .../einheiten/{eid}/material/{em_id} — Material zuordnen. ETB-Eintrag.
pub async fn material_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, em_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let (bez, menge) = mitglied_repo::ordne_material_zu(&state.pool, einsatz_id, eid, em_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Material «{}» (×{}) zugeordnet", einheit, bez, menge)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/material/{em_id} — Material freigeben. ETB-Eintrag.
pub async fn material_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, em_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let (bez, menge) = mitglied_repo::gib_material_frei(&state.pool, einsatz_id, eid, em_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Material «{}» (×{}) freigegeben", einheit, bez, menge)).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 6: Einheit-Material-Routen in `src/app.rs` registrieren**

In `src/app.rs` direkt **nach** der `.../einheiten/{eid}/fahrzeug/{ef_id}`-DELETE-Route (Zeile ~130, das ist die letzte `.route(...)` vor dem `;`) einfügen — beachte: das `;` wandert ans Ende der neuen letzten Zeile:

```rust
        .route("/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}", put(routes::einsatz_einheit::material_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}", delete(routes::einsatz_einheit::material_freigeben));
```

- [ ] **Step 7: Einheit-Material-Zuordnung im Integrationstest abdecken**

In `tests/einsatz_material.rs` (Harness bereits vorhanden) einen Test ergänzen, der die Einheiten-Zuordnung end-to-end prüft. Helfer zum Einheit-Bilden ergänzen:

```rust
/// Bildet eine Einheit (Admin) und liefert ihre id.
async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/einheiten"), cookie, Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn material_einheit_zuordnen_freigeben_und_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"), &admin, Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#))).await;
    let em = json["id"].as_i64().unwrap();
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;

    // Zuordnen.
    assert_eq!(
        anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/{em}"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap()[0]["einheit_id"], eid);

    // Material-Mitglied erscheint in der Einheit.
    let (_, einheiten) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin, None).await;
    let einheit = einheiten.as_array().unwrap().iter().find(|e| e["id"] == eid).unwrap();
    assert_eq!(einheit["material_mitglieder"].as_array().unwrap().len(), 1);

    // Auflösen gibt Material frei.
    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/material"), &admin, None).await;
    assert!(liste2.as_array().unwrap()[0]["einheit_id"].is_null(), "Auflösen gibt Material frei");
}

#[tokio::test]
async fn fremde_em_id_an_einheit_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;
    let (status, _) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/999999"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

- [ ] **Step 8: Alle Backend-Tests**

Run: `cargo test`
Expected: PASS — inkl. `einheit::mitglied_repo::tests::material_zuordnen_und_freigeben`, `einheit::repo::tests::aufloesen_gibt_material_frei`, `--test einsatz_material`, und **alle bestehenden** Einheiten-Tests (das neue `material_mitglieder`-Feld wird vom `zu_anzeige`-Builder gefüllt; es gibt keine `EinheitAnzeige`-Literale in Tests, daher keine weiteren Anpassungen).

- [ ] **Step 9: Commit**

```bash
git add src/einheit/ src/routes/einsatz_einheit.rs src/app.rs tests/einsatz_material.rs
git commit -m "feat(material): Material→Einheit-Mitgliedschaft + Freigabe beim Auflösen"
```

---

## Task 8: Frontend-Typen + API-Module

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/material.ts`
- Create: `frontend/src/api/einsatzMaterial.ts`

- [ ] **Step 1: Typen in `types.ts` ergänzen**

In `frontend/src/api/types.ts` direkt **nach** dem `EinsatzFahrzeug`-Interface (Zeile ~139) einfügen:

```typescript
export type MaterialStatus =
  | 'einsatzbereit' | 'im_einsatz' | 'defekt' | 'verbraucht' | 'desinfektion_noetig';

export interface Material {
  id: number;
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  standort: string | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
}

/** Aufgelöste Material-Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzMaterial {
  id: number;
  einsatz_id: number;
  material_id: number | null;
  einheit_id: number | null;
  ist_adhoc: boolean;
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  menge: number;
  status: MaterialStatus;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
}

/** Material-Mitglied einer Einheit. */
export interface EinheitMitgliedMaterial {
  em_id: number;
  bezeichnung: string;
  menge: number;
  status: MaterialStatus;
}
```

Außerdem im `Einheit`-Interface (Zeile ~242) nach `fahrzeug_mitglieder: EinheitMitgliedFahrzeug[];` ergänzen:

```typescript
  material_mitglieder: EinheitMitgliedMaterial[];
```

- [ ] **Step 2: API-Modul `material.ts`**

Create `frontend/src/api/material.ts`:

```typescript
import type { Material } from './types';
import { apiGet, apiSend } from './client';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
export interface MaterialEingabe {
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  standort: string | null;
  bemerkung: string | null;
}

export function listeMaterial(nurImDienst = false): Promise<Material[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Material[]>(`/api/material${qs}`);
}

export function listeKategorien(): Promise<string[]> {
  return apiGet<string[]>('/api/material-kategorien');
}

export function legeMaterialAn(daten: MaterialEingabe): Promise<Material> {
  return apiSend<Material>('/api/material', 'POST', daten);
}

export function aktualisiereMaterial(id: number, daten: MaterialEingabe): Promise<Material> {
  return apiSend<Material>(`/api/material/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Material> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Material>(`/api/material/${id}/${pfad}`, 'POST');
}
```

- [ ] **Step 3: API-Modul `einsatzMaterial.ts`**

Create `frontend/src/api/einsatzMaterial.ts`:

```typescript
import type { EinsatzMaterial, MaterialStatus } from './types';
import { apiGet, apiSend } from './client';

export interface MaterialAdhocEingabe {
  bezeichnung: string;
  kategorie?: string | null;
  bestandsnummer?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
  return apiGet<EinsatzMaterial[]>(`/api/einsaetze/${einsatzId}/material`);
}

export function disponiereMaterial(einsatzId: number, materialId: number, menge: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', {
    material_id: materialId,
    menge,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: MaterialAdhocEingabe, menge: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', { adhoc, menge });
}

export function aktualisiereDisposition(
  einsatzId: number,
  emId: number,
  felder: { menge?: number; status?: MaterialStatus; bemerkung?: string },
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'DELETE');
}

export function ordneEinheitZu(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'PUT');
}

export function gibEinheitFrei(einsatzId: number, eid: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/material/${emId}`, 'DELETE');
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS (keine TS-Fehler). Die neuen Module werden noch nicht importiert — der Typecheck prüft Konsistenz.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/material.ts frontend/src/api/einsatzMaterial.ts
git commit -m "feat(fe): Material-Typen + API-Module (Stamm + Disposition)"
```

---

## Task 9: Stammdaten-Tab „Material"

**Files:**
- Create: `frontend/src/stammdaten/MaterialFormModal.tsx`
- Create: `frontend/src/stammdaten/MaterialTab.tsx`
- Create: `frontend/src/stammdaten/MaterialTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: `MaterialFormModal.tsx`**

Create `frontend/src/stammdaten/MaterialFormModal.tsx`:

```tsx
import { App, AutoComplete, Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereMaterial, legeMaterialAn, type MaterialEingabe } from '../api/material';
import type { Material } from '../api/types';

interface FormWerte {
  bezeichnung: string;
  kategorie?: string;
  bestandsnummer?: string;
  traegerorganisation?: string;
  standort?: string;
  bemerkung?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function MaterialFormModal({
  offen,
  material,
  kategorien,
  onClose,
}: {
  offen: boolean;
  material: Material | null; // null = neu
  kategorien: string[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (material) {
      form.setFieldsValue({
        bezeichnung: material.bezeichnung,
        kategorie: material.kategorie ?? undefined,
        bestandsnummer: material.bestandsnummer ?? undefined,
        traegerorganisation: material.traegerorganisation ?? undefined,
        standort: material.standort ?? undefined,
        bemerkung: material.bemerkung ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [offen, material, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: MaterialEingabe = {
        bezeichnung: werte.bezeichnung.trim(),
        kategorie: leerZuNull(werte.kategorie),
        bestandsnummer: leerZuNull(werte.bestandsnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        standort: leerZuNull(werte.standort),
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return material ? aktualisiereMaterial(material.id, daten) : legeMaterialAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['material'] });
      qc.invalidateQueries({ queryKey: ['material-kategorien'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={material ? 'Material bearbeiten' : 'Material anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnClose
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
        >
          <Input placeholder="z. B. Wolldecke, Stromerzeuger 5 kVA" />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie">
          <AutoComplete
            options={kategorien.map((k) => ({ value: k }))}
            allowClear
            placeholder="z. B. Betreuung, Sanität, Hochwasser"
            filterOption={(input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="Bestandsnummer" name="bestandsnummer">
          <Input placeholder="Inventarnr. (nur für einzeln verfolgte Geräte)" />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input /></Form.Item>
        <Form.Item label="Standort" name="standort"><Input placeholder="z. B. Lagerhalle 2" /></Form.Item>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: `MaterialTab.tsx`**

Create `frontend/src/stammdaten/MaterialTab.tsx`:

```tsx
import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { listeKategorien, listeMaterial, setzeDienststatus } from '../api/material';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';

export default function MaterialTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Material | null>(null);

  const materialQuery = useQuery({ queryKey: ['material', 'alle'], queryFn: () => listeMaterial(false) });
  const kategorienQuery = useQuery({ queryKey: ['material-kategorien'], queryFn: listeKategorien });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['material'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Material> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie', render: (t) => t ?? '—' },
    { title: 'Bestandsnummer', dataIndex: 'bestandsnummer', key: 'bestandsnummer', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      render: (_, m) =>
        m.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, m: Material) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(m); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                {m.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    onConfirm={() => dienststatusMutation.mutate({ id: m.id, inDienst: false })}
                  >
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: m.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Material>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Material anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={materialQuery.isLoading}
        dataSource={materialQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch kein Material' }}
        pagination={false}
      />
      <MaterialFormModal
        offen={modalOffen}
        material={bearbeite}
        kategorien={kategorienQuery.data ?? []}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
```

- [ ] **Step 3: `MaterialTab.test.tsx`**

Create `frontend/src/stammdaten/MaterialTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import MaterialTab from './MaterialTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const material = {
  id: 1, bezeichnung: 'Wolldecke', kategorie: 'Betreuung', bestandsnummer: null,
  traegerorganisation: null, standort: null, bemerkung: null,
  dienststatus: 'in_dienst', angelegt_at: '2026-05-27 10:00:00',
};

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/material', () => HttpResponse.json([material])),
    http.get('/api/material-kategorien', () => HttpResponse.json(['Betreuung'])),
  );
  return renderMitProviders(
    <AuthProvider>
      <MaterialTab />
    </AuthProvider>,
  );
}

describe('MaterialTab', () => {
  it('zeigt Material', async () => {
    render(admin);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByText('Betreuung')).toBeInTheDocument();
  });

  it('Admin sieht „Material anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: 'Material anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Material anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Tab in `StammdatenPage.tsx` registrieren**

In `frontend/src/pages/StammdatenPage.tsx`:

(a) Import nach `import EinheitTypenTab ...` ergänzen:

```tsx
import MaterialTab from '../stammdaten/MaterialTab';
```

(b) Im `items`-Array nach dem `'fahrzeuge'`-Eintrag (Zeile ~18) ergänzen:

```tsx
          { key: 'material', label: 'Material', children: <MaterialTab /> },
```

- [ ] **Step 5: Tests + Typecheck**

Run: `cd frontend && npm test -- src/stammdaten/MaterialTab.test.tsx`
Expected: PASS (3 Tests).
Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stammdaten/MaterialFormModal.tsx frontend/src/stammdaten/MaterialTab.tsx frontend/src/stammdaten/MaterialTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab Material (CRUD/Soft-Delete, Kategorie-AutoComplete)"
```

---

## Task 10: Einsatz-Modul `MaterialPage` + Registry

**Files:**
- Create: `frontend/src/pages/MaterialPage.tsx`
- Create: `frontend/src/pages/MaterialPage.test.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Modify: `frontend/src/einsatz/modulRegistry.test.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Registry umstellen**

In `frontend/src/einsatz/modulRegistry.ts` den `material`-Eintrag (Zeile ~56) von `status: 'geplant'` auf `status: 'fertig'` ändern. Konkret die Zeile

```tsx
  { key: 'material', kategorie: 'kraefte', label: 'Material', icon: TbPackages, route: 'material', status: 'geplant', beschreibung: 'Material und Verbrauchsgüter im Einsatz.' },
```

ersetzen durch (nur `status`):

```tsx
  { key: 'material', kategorie: 'kraefte', label: 'Material', icon: TbPackages, route: 'material', status: 'fertig', beschreibung: 'Material und Verbrauchsgüter im Einsatz.' },
```

- [ ] **Step 2: Registry-Regressionstest ergänzen**

In `frontend/src/einsatz/modulRegistry.test.ts` nach dem `it('personal ist fertig ...')`-Block (Zeile ~85) einfügen:

```tsx
  it('material ist fertig in der Kategorie kraefte', () => {
    const material = modulRegistry.find((m) => m.key === 'material');
    expect(material?.status).toBe('fertig');
    expect(material?.kategorie).toBe('kraefte');
    expect(material?.route).toBe('material');
  });
```

- [ ] **Step 3: `MaterialPage.tsx`**

Create `frontend/src/pages/MaterialPage.tsx`:

```tsx
import {
  Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space,
  Spin, Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listeMaterial } from '../api/material';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereMaterial, entferneDisposition,
  listeEinsatzMaterial, type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { ApiError } from '../api/client';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';

const STATUS_META: Record<MaterialStatus, { label: string; color: string }> = {
  einsatzbereit: { label: 'einsatzbereit', color: 'green' },
  im_einsatz: { label: 'im Einsatz', color: 'blue' },
  defekt: { label: 'defekt', color: 'red' },
  verbraucht: { label: 'verbraucht', color: 'default' },
  desinfektion_noetig: { label: 'Desinfektion nötig', color: 'orange' },
};
const STATUS_OPTIONEN = (Object.keys(STATUS_META) as MaterialStatus[]).map((s) => ({
  value: s, label: STATUS_META[s].label,
}));

/** Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). */
function MengeZelle({ em, onChange }: { em: EinsatzMaterial; onChange: (menge: number) => void }) {
  const [wert, setWert] = useState<number>(em.menge);
  useEffect(() => setWert(em.menge), [em.menge]);
  const commit = () => { if (wert >= 1 && wert !== em.menge) onChange(wert); };
  return (
    <InputNumber
      size="small" min={1} style={{ width: 80 }} value={wert}
      onChange={(v) => setWert((v as number) ?? 1)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [poolAuswahl, setPoolAuswahl] = useState<number | null>(null);
  const [poolMenge, setPoolMenge] = useState<number>(1);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const emQuery = useQuery({
    queryKey: ['einsatz-material', einsatzId],
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const poolQuery = useQuery({ queryKey: ['material', 'im-dienst'], queryFn: () => listeMaterial(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-material', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) => disponiereMaterial(einsatzId, v.materialId, v.menge),
    onSuccess: () => { invalidate(); setPoolAuswahl(null); setPoolMenge(1); },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(einsatzId, {
        bezeichnung: w.bezeichnung, kategorie: w.kategorie, bestandsnummer: w.bestandsnummer,
        traegerorganisation: w.traegerorganisation,
      }, w.menge ?? 1),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) => aktualisiereDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { emId: number; status: MaterialStatus }) =>
      aktualisiereDisposition(einsatzId, v.emId, { status: v.status }),
    onSuccess: invalidate, onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate, onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (emId: number) => entferneDisposition(einsatzId, emId),
    onSuccess: invalidate, onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const ems = emQuery.data ?? [];
  const poolOptionen = (poolQuery.data ?? []).map((m) => ({
    value: m.id, label: `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  }));

  const spalten: TableColumnsType<EinsatzMaterial> = [
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      render: (_, em) => (
        <Space>
          {em.bezeichnung}
          {em.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie', render: (t) => t ?? '—' },
    {
      title: 'Menge',
      key: 'menge',
      render: (_, em) =>
        darfSchreiben
          ? <MengeZelle em={em} onChange={(menge) => mengeMutation.mutate({ emId: em.id, menge })} />
          : em.menge,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, em) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 170 }}
            value={em.status}
            options={STATUS_OPTIONEN}
            onChange={(status) => statusMutation.mutate({ emId: em.id, status })}
          />
        ) : (
          <Tag color={STATUS_META[em.status].color}>{STATUS_META[em.status].label}</Tag>
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) =>
        darfSchreiben ? (
          <Typography.Text editable={{ onChange: (val) => bemerkungMutation.mutate({ emId: em.id, bemerkung: val }) }}>
            {em.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          em.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, em: EinsatzMaterial) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(em.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzMaterial>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Material' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Material</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              showSearch
              style={{ minWidth: 260 }}
              placeholder="Stamm-Material wählen …"
              value={poolAuswahl}
              options={poolOptionen}
              optionFilterProp="label"
              notFoundContent="Kein Material im Dienst"
              onChange={(v) => setPoolAuswahl(v ?? null)}
            />
            <InputNumber min={1} value={poolMenge} onChange={(v) => setPoolMenge((v as number) ?? 1)} />
            <Button
              type="primary"
              disabled={poolAuswahl == null}
              onClick={() => { if (poolAuswahl != null) disponiereMutation.mutate({ materialId: poolAuswahl, menge: poolMenge }); }}
            >
              Disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={emQuery.isLoading}
        dataSource={ems}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch kein Material disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Material disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ menge: 1 }} onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Spende-Decken" />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie"><Input /></Form.Item>
          <Form.Item label="Bestandsnummer" name="bestandsnummer"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input placeholder="z. B. THW" /></Form.Item>
          <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: `MaterialPage` in `App.tsx` registrieren**

In `frontend/src/App.tsx`:

(a) Import nach `import FahrzeugePage ...` ergänzen:

```tsx
import MaterialPage from './pages/MaterialPage';
```

(b) In `MODUL_ELEMENTE` (Zeile ~22) nach `fahrzeuge: <FahrzeugePage />,` ergänzen:

```tsx
  material: <MaterialPage />,
```

- [ ] **Step 5: `MaterialPage.test.tsx`**

Create `frontend/src/pages/MaterialPage.test.tsx`. **Wichtig:** `renderMitProviders` stellt selbst den Router bereit — Route über das zweite Argument `{ route }` setzen, **kein** `MemoryRouter` im Test (exakt wie `FahrzeugePage.test.tsx`). `AuthProvider` + `/api/auth/me`-Mock sind erforderlich. Inhalt:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import MaterialPage from './MaterialPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};

const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};

const em = {
  id: 10, einsatz_id: 1, material_id: 5, einheit_id: null, ist_adhoc: false,
  bezeichnung: 'Wolldecke', kategorie: 'Betreuung', bestandsnummer: null, traegerorganisation: null,
  menge: 50, status: 'einsatzbereit', bemerkung: null,
  disponiert_at: '2026-05-27 09:00:00', disponiert_von: 1,
};

function render(einsatzObj: typeof einsatzAktiv, materialListe: typeof em[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json(materialListe)),
    http.get('/api/material', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/material" element={<MaterialPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/material' },
  );
}

describe('MaterialPage', () => {
  it('zeigt disponiertes Material mit Menge und Status', async () => {
    render(einsatzAktiv, [em]);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByDisplayValue('50')).toBeInTheDocument(); // Mengen-Input (min 1)
  });

  it('Einsatzleitung sieht Disponier- und Ad-hoc-Aktionen', async () => {
    render(einsatzAktiv, []);
    await screen.findByText('Material');
    expect(screen.getByRole('button', { name: 'Disponieren' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Material' })).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist reine Anzeige', async () => {
    const abgeschlossen = { ...einsatzAktiv, status: 'abgeschlossen' as const };
    render(abgeschlossen, [em]);
    await screen.findByText('Wolldecke');
    expect(screen.queryByRole('button', { name: 'Disponieren' })).not.toBeInTheDocument();
    expect(screen.getByText('einsatzbereit')).toBeInTheDocument(); // Status-Badge statt Select
  });
});
```

- [ ] **Step 6: Tests + Typecheck**

Run: `cd frontend && npm test -- src/pages/MaterialPage.test.tsx src/einsatz/modulRegistry.test.ts`
Expected: PASS.
Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/MaterialPage.tsx frontend/src/pages/MaterialPage.test.tsx frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/App.tsx
git commit -m "feat(fe): Einsatz-Modul Material (Disposition, Menge, Status, Ad-hoc) statt Stub"
```

---

## Task 11: EinheitenPage — Material-Mitglieder-Sektion

**Files:**
- Modify: `frontend/src/pages/EinheitenPage.tsx`

- [ ] **Step 1: Imports + Query + Mutationen ergänzen**

In `frontend/src/pages/EinheitenPage.tsx`:

(a) Import ergänzen (nach `import { listeEinsatzFahrzeuge } ...`, Zeile ~12):

```tsx
import { gibEinheitFrei, listeEinsatzMaterial, ordneEinheitZu } from '../api/einsatzMaterial';
```

(b) Nach der `fahrzeugeQuery`-Definition (Zeile ~93) ergänzen:

```tsx
  const materialQuery = useQuery({ queryKey: ['einsatz-material', einsatzId], queryFn: () => listeEinsatzMaterial(einsatzId) });
```

(c) In `invalidate()` (Zeile ~95) nach der `einsatz-fahrzeuge`-Invalidierung ergänzen:

```tsx
    qc.invalidateQueries({ queryKey: ['einsatz-material', einsatzId] });
```

(d) Nach den `fahrzeugZu`/`fahrzeugFrei`-Mutationen (Zeile ~150) ergänzen:

```tsx
  const materialZu = useMutation({
    mutationFn: (emId: number) => ordneEinheitZu(einsatzId, aktuell!.id, emId),
    onSuccess: invalidate, onError: fehler,
  });
  const materialFrei = useMutation({
    mutationFn: (emId: number) => gibEinheitFrei(einsatzId, aktuell!.id, emId),
    onSuccess: invalidate, onError: fehler,
  });
```

(e) Nach `const freieFahrzeuge = ...` (Zeile ~186) ergänzen:

```tsx
  const freiesMaterial = (materialQuery.data ?? []).filter((m) => m.einheit_id == null);
```

- [ ] **Step 2: Material-Sektion im JSX ergänzen**

In `frontend/src/pages/EinheitenPage.tsx` direkt **nach** der Fahrzeug-Sektion (nach dem `freieFahrzeuge`-`Select`-Block, Zeile ~297, vor dem schließenden `</Form>`) einfügen:

```tsx
              <Typography.Title level={5} style={{ marginTop: 16 }}>Material</Typography.Title>
              {aktuell.material_mitglieder.map((m) => (
                <Space key={m.em_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.bezeichnung} ×{m.menge}</span>
                  {darfSchreiben && <Button size="small" danger onClick={() => materialFrei.mutate(m.em_id)}>Entfernen</Button>}
                </Space>
              ))}
              {darfSchreiben && (
                <Select showSearch style={{ width: '100%', marginTop: 8 }} placeholder="Material zuordnen …" value={null}
                  optionFilterProp="label" notFoundContent="Kein freies Material"
                  options={freiesMaterial.map((m) => ({ value: m.id, label: `${m.bezeichnung} ×${m.menge}` }))}
                  onSelect={(emId) => materialZu.mutate(Number(emId))} />
              )}
```

- [ ] **Step 3: Bestehenden EinheitenPage-Test aktualisieren (falls nötig)**

Run: `cd frontend && npm test -- src/pages/EinheitenPage.test.tsx`

Falls der Test fehlschlägt, weil der MSW-Handler für `/api/einsaetze/:id/material` fehlt (neue Query), ergänze in `frontend/src/pages/EinheitenPage.test.tsx` im `server.use(...)`-Block einen Handler:

```tsx
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
```

(Pfad-`id` ggf. an die im Test verwendete Einsatz-ID anpassen.) Mock-`Einheit`-Objekte im Test brauchen zusätzlich das Feld `material_mitglieder: []`, falls sie als Literal konstruiert werden — sonst TS-Fehler im Typecheck.

- [ ] **Step 4: Tests + Typecheck**

Run: `cd frontend && npm test -- src/pages/EinheitenPage.test.tsx`
Expected: PASS.
Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinheitenPage.tsx frontend/src/pages/EinheitenPage.test.tsx
git commit -m "feat(fe): Material-Mitglieder-Sektion in der Einheiten-Ansicht"
```

---

## Abschluss-Verifikation

- [ ] **Backend gesamt:** `cargo test` → alle grün.
- [ ] **Frontend gesamt:** `cd frontend && npm test` → alle grün; `npm run typecheck` → keine Fehler; `npm run lint` → keine neuen Fehler.
- [ ] **Manueller Smoke-Test (optional):** App starten, Stammdaten → Tab „Material" → Material anlegen; Einsatz öffnen → Modul „Material" → Stamm-Material mit Menge disponieren, Ad-hoc anlegen, Menge/Status ändern, einer Einheit zuordnen, ETB prüfen (System-Einträge mit `«…»` und `×Menge`).
