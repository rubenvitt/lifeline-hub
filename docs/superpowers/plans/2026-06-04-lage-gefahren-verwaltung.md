# Gefahren-Verwaltung nach Gefahrenschema (LFH-53) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus dem Platzhalter-Modul „Gefahren-/Absperrzonen" eine echte Verwaltungsseite bauen: eine bewertbare 13×5-Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) plus optionale Verknüpfung von `gefahrengebiet`-Zonen mit Matrix-Zellen.

**Architecture:** Additiv, kein Rewrite. Neue einsatz-skopierte Entität `gefahr_bewertung` (eine Zelle je `gefahrentyp×schutzobjekt`), neues Backend-Modul `src/gefahr/` (analog `lage_zone`/`einsatzabschnitt`), neue Frontend-Seite unter Route `gefahren`. Das bestehende Zonen-Zeichnen bleibt unverändert; Phase 3 ergänzt zwei optionale Spalten an `lage_zone` und eine App-seitige Brücke zur Matrix. Fachliche Bindung erzwingt die App, nicht die DB (keine Mehrspalten-CHECKs, kein Composite-FK).

**Tech Stack:** Rust + Axum + sqlx + SQLite (Backend), React + TypeScript + Vite + Vitest + TanStack Query + antd (Frontend). Live über den bestehenden `LiveHub`/`useEinsatzLiveStream` (eine SSE-Verbindung pro Einsatz). ETB-Spur über `etb::repo::anlegen`.

**Spec:** `docs/superpowers/specs/2026-06-04-lage-gefahren-verwaltung-design.md`

---

## Wichtige Korrekturen gegenüber der Spec (vor dem Loslegen lesen)

Die Spec ist fachlich abgestimmt, enthält aber drei Stellen, die gegen den realen Code-Stand abweichen. Dieser Plan ist gegenüber dem realen Code formuliert:

1. **Migrationsnummern.** Die Spec nennt `0037`/`0038` — die sind bereits belegt (`0037_etb_baustein.sql`, `0038_lagebericht.sql`). Dieser Plan nutzt **`0039`** (Matrix) und **`0040`** (lage_zone-Erweiterung). Vor Task 1 verifizieren: `ls migrations/ | tail -3` → höchste vorhandene Nummer ist 0038.
2. **`verweistAuf` existiert nicht.** Das `ModulEintrag`-Interface hat kein `verweistAuf`-Feld; der `gefahrenzonen`-Eintrag ist heute schlicht `route: 'gefahrenzonen', status: 'geplant'` und rendert über `App.tsx` einen `ModulStub`. Es gibt **nichts zu „entfernen"** — wir ändern `route`/`label`/`status`/`beschreibung` und registrieren die Seite in `MODUL_ELEMENTE` (keyed by `m.key === 'gefahrenzonen'`).
3. **Zonen-Count-Badge gehört in Phase 3.** Die Zonen-Zuordnung (`lage_zone.gefahrentyp/schutzobjekt`) entsteht erst mit Migration 0040 (Phase 3). Der Badge „Zonen-Anzahl je Zelle" und sein Test sind daher in Phase 3 angesiedelt, nicht in Phase 2.

**`keine`-Semantik (über alle Tasks konsistent):**
- `liste()` liefert nur Zellen `WHERE warnstufe != 'keine'`.
- `upsert_bewertung` ist ein schlichtes UPSERT (KEIN Delete-Zweig). Eine Zelle auf `keine` zu setzen lässt die Zeile bestehen; `liste()` filtert sie raus → kein Phantom-Eintrag.
- `lazy_create_zelle` ist `INSERT … ON CONFLICT DO NOTHING` mit `warnstufe='keine'` (für die Zonen-Verknüpfung). Bei lifeline gibt es keinen FK (anders als BLH ADR-010) — die Funktion ist daher fast redundant, bleibt aber per Spec erhalten (mit Kommentar).
- Die ETB-Entscheidung (Warnstufe real geändert?) liest die **alte** Warnstufe *vor* dem Schreiben.

---

## File Structure

**Backend — neu:**
- `migrations/0039_gefahr_bewertung.sql` — Tabelle `gefahr_bewertung` (Matrix-Zelle).
- `migrations/0040_lage_zone_gefahr.sql` — zwei nullable Spalten an `lage_zone`.
- `src/gefahr/mod.rs` — DTO `GefahrBewertungAnzeige`, Kataloge, `kombination_gueltig`, Labels.
- `src/gefahr/repo.rs` — `liste`, `aktuelle_warnstufe`, `upsert_bewertung`, `lazy_create_zelle` + Unit-Tests.
- `src/routes/gefahr.rs` — Handler `matrix` (GET), `bewerten` (PUT), `stream` (SSE).
- `tests/gefahr.rs` — Integrationstests.

**Backend — geändert:**
- `src/lib.rs` — `pub mod gefahr;`
- `src/routes/mod.rs` — `pub mod gefahr;`
- `src/app.rs` — 3 Routen einhängen.
- `src/lage_zone/mod.rs` — DTO um zwei Felder; `gefahren_zuordnung_gueltig`.
- `src/lage_zone/repo.rs` — `ZoneNeu`/`ZonePatch` + zwei Felder; Lazy-Create beim Setzen.
- `src/routes/lage_zone.rs` — POST/PATCH akzeptieren die optionalen Felder.
- `tests/lage_zone.rs` — Erweiterung um Zuordnungs-Tests.

**Frontend — neu:**
- `frontend/src/pages/gefahren/gefahrenSchema.ts` — Kataloge + Labels + `kombinationGueltig` + Warnstufen-Farben.
- `frontend/src/pages/gefahren/gefahrenSchema.test.ts` — Schema-Unit-Test.
- `frontend/src/pages/gefahren/GefahrenPage.tsx` — 13×5-Grid.
- `frontend/src/pages/gefahren/GefahrenPage.test.tsx` — Seiten-Test.
- `frontend/src/api/gefahren.ts` — API-Client.

**Frontend — geändert:**
- `frontend/src/api/types.ts` — `Gefahrentyp`, `Schutzobjekt`, `Warnstufe`, `GefahrBewertung`; `LageZone` += zwei Felder.
- `frontend/src/einsatz/modulRegistry.ts` — `gefahrenzonen`-Eintrag umbauen.
- `frontend/src/App.tsx` — `MODUL_ELEMENTE['gefahrenzonen'] = <GefahrenPage/>`.
- `frontend/src/etb/useEinsatzLiveStream.ts` — `gefahr`-Listener.
- `frontend/src/etb/useEinsatzLiveStream.test.tsx` — Test für `gefahr`-Event.
- `frontend/src/pages/lagekarte/ZonenInspector.tsx` — Gefahren-Zuordnung bei `gefahrengebiet` (Phase 3).

---

# Phase 1 — Backend Gefahrenmatrix

**Gate am Phasenende:** `cargo test` grün (`rtk proxy cargo test --test gefahr` für ehrliche Exit-Codes; Memory `rtk-proxy-fuer-ehrliche-exit-codes`).

---

### Task 1: Migration `gefahr_bewertung`

**Files:**
- Create: `migrations/0039_gefahr_bewertung.sql`

- [ ] **Step 1: Nummer verifizieren**

Run: `ls migrations/ | tail -3`
Expected: höchste Nummer ist `0038_lagebericht.sql`. Falls bereits `0039…` existiert, neue Nummer entsprechend hochzählen und in allen folgenden Tasks anpassen.

- [ ] **Step 2: Migration schreiben**

Create `migrations/0039_gefahr_bewertung.sql`:

```sql
-- Gefahrenmatrix-Bewertung (LFH-53): pro Einsatz max. 1 Bewertung je (gefahrentyp,
-- schutzobjekt). Warnstufe ist die Wahrheit; gefahrengebiet-Zonen referenzieren diese
-- Zelle app-seitig (kein DB-FK, Hauskonvention wie lage_zone).
-- CHECKs je Spalte einzeln; die Kombinations-Gültigkeit (ungültige typ×objekt-Paare)
-- erzwingt die App, nicht die DB. liste() blendet warnstufe='keine' aus (kein Phantom).
-- Hard-Delete via ON DELETE CASCADE beim Einsatz-Löschen; Historie lebt im ETB.
CREATE TABLE gefahr_bewertung (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    gefahrentyp      TEXT NOT NULL
                       CHECK (gefahrentyp IN ('atemgifte','angstreaktion','ausbreitung',
                         'atomare_strahlung','chemische_stoffe','erkrankung_verletzung',
                         'explosion','elektrizitaet','einsturz','absturz','brand',
                         'durchbruch','ertrinken')),
    schutzobjekt     TEXT NOT NULL
                       CHECK (schutzobjekt IN ('menschen','tiere','umwelt','sachwerte',
                         'einsatzkraefte')),
    warnstufe        TEXT NOT NULL DEFAULT 'keine'
                       CHECK (warnstufe IN ('keine','niedrig','mittel','hoch','akut')),
    beschreibung     TEXT,
    gemeldet_von     TEXT,
    aktualisiert_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at      TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_einsatz ON gefahr_bewertung(einsatz_id);
```

- [ ] **Step 3: Migration compiliert (lädt)**

Run: `rtk proxy cargo build`
Expected: erfolgreich. (Migrationen werden über `sqlx`/`db::test_pool` zur Laufzeit angewandt; ein Build-Fehler hier wäre nur ein Syntaxfehler in unverändertem Rust — die SQL-Prüfung erfolgt in Task 3 beim ersten Test.)

- [ ] **Step 4: Commit**

```bash
git add migrations/0039_gefahr_bewertung.sql
git commit -m "feat(be): Migration gefahr_bewertung (Gefahrenmatrix) (LFH-53)"
```

---

### Task 2: `src/gefahr/mod.rs` — DTO, Kataloge, Validierung

**Files:**
- Create: `src/gefahr/mod.rs`

- [ ] **Step 1: Modul schreiben**

Create `src/gefahr/mod.rs`:

```rust
pub mod repo;

use serde::Serialize;

/// 13 Gefahrentypen (verbatim aus bluelight-hub; lowercase-snake wie lage_zone.typ).
pub const GEFAHRENTYPEN: [&str; 13] = [
    "atemgifte", "angstreaktion", "ausbreitung", "atomare_strahlung", "chemische_stoffe",
    "erkrankung_verletzung", "explosion", "elektrizitaet", "einsturz", "absturz", "brand",
    "durchbruch", "ertrinken",
];

/// 5 Schutzobjekte.
pub const SCHUTZOBJEKTE: [&str; 5] = [
    "menschen", "tiere", "umwelt", "sachwerte", "einsatzkraefte",
];

/// 5 Warnstufen (`keine` = effektiv keine Bewertung).
pub const WARNSTUFEN: [&str; 5] = ["keine", "niedrig", "mittel", "hoch", "akut"];

/// Aufgelöste Matrix-Zelle (einsatz-skopiert). Die Liste enthält nur Zellen mit
/// `warnstufe != 'keine'`; das Frontend rendert das 13×5-Raster aus den Katalogen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GefahrBewertungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
    pub aktualisiert_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

/// Ob `(typ, objekt)` eine fachlich gültige Kombination ist (verbatim aus BLH).
/// Ungültig: sachwerte×{angstreaktion,atemgifte,erkrankung_verletzung,ertrinken},
/// umwelt×{angstreaktion,erkrankung_verletzung,ertrinken}.
pub fn kombination_gueltig(typ: &str, objekt: &str) -> bool {
    !matches!(
        (objekt, typ),
        ("sachwerte", "angstreaktion" | "atemgifte" | "erkrankung_verletzung" | "ertrinken")
            | ("umwelt", "angstreaktion" | "erkrankung_verletzung" | "ertrinken")
    )
}

/// Sprechendes Label eines Gefahrentyps (für den ETB-Wortlaut).
pub fn gefahrentyp_label(typ: &str) -> &'static str {
    match typ {
        "atemgifte" => "Atemgifte",
        "angstreaktion" => "Angstreaktion",
        "ausbreitung" => "Ausbreitung",
        "atomare_strahlung" => "Atomare Strahlung",
        "chemische_stoffe" => "Chemische Stoffe",
        "erkrankung_verletzung" => "Erkrankung/Verletzung",
        "explosion" => "Explosion",
        "elektrizitaet" => "Elektrizität",
        "einsturz" => "Einsturz",
        "absturz" => "Absturz",
        "brand" => "Brand",
        "durchbruch" => "Durchbruch",
        "ertrinken" => "Ertrinken",
        _ => "Gefahr",
    }
}

/// Sprechendes Label eines Schutzobjekts (für den ETB-Wortlaut).
pub fn schutzobjekt_label(objekt: &str) -> &'static str {
    match objekt {
        "menschen" => "Menschen",
        "tiere" => "Tiere",
        "umwelt" => "Umwelt",
        "sachwerte" => "Sachwerte",
        "einsatzkraefte" => "Einsatzkräfte",
        _ => "Schutzobjekt",
    }
}
```

- [ ] **Step 2: In `src/lib.rs` deklarieren**

Modify `src/lib.rs` — füge die Modul-Deklaration alphabetisch nahe `pub mod fahrzeug;` / `pub mod katalog;` ein:

```rust
pub mod fahrzeug;
pub mod gefahr;
pub mod katalog;
```

- [ ] **Step 3: Build (erwartet Fehler: repo fehlt)**

Run: `rtk proxy cargo build`
Expected: FAIL — `file not found for module repo` (gefahr/repo.rs kommt in Task 3). Das ist erwartet; Task 3 behebt es. (Wer die Tasks streng einzeln baut: Step 1 von Task 3 vorziehen oder diesen Build überspringen.)

- [ ] **Step 4: Commit**

```bash
git add src/gefahr/mod.rs src/lib.rs
git commit -m "feat(be): gefahr-Modul Kataloge + DTO + kombination_gueltig (LFH-53)"
```

---

### Task 3: `src/gefahr/repo.rs` — Repo + Unit-Tests (TDD)

**Files:**
- Create: `src/gefahr/repo.rs`

- [ ] **Step 1: Repo mit Unit-Tests schreiben**

Create `src/gefahr/repo.rs`:

```rust
use super::GefahrBewertungAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für eine Bewertung (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct BewertungDaten<'a> {
    pub gefahrentyp: &'a str,
    pub schutzobjekt: &'a str,
    pub warnstufe: &'a str,
    pub beschreibung: Option<&'a str>,
    pub gemeldet_von: Option<&'a str>,
    pub aktualisiert_von: i64,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, \
           gemeldet_von, aktualisiert_von, erstellt_at, geaendert_at \
    FROM gefahr_bewertung";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    gefahrentyp: String,
    schutzobjekt: String,
    warnstufe: String,
    beschreibung: Option<String>,
    gemeldet_von: Option<String>,
    aktualisiert_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> GefahrBewertungAnzeige {
    GefahrBewertungAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        gefahrentyp: r.gefahrentyp,
        schutzobjekt: r.schutzobjekt,
        warnstufe: r.warnstufe,
        beschreibung: r.beschreibung,
        gemeldet_von: r.gemeldet_von,
        aktualisiert_von: r.aktualisiert_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle gesetzten Zellen eines Einsatzes (ohne `warnstufe='keine'` → kein Phantom),
/// stabil sortiert für deterministische Tests/Anzeige.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<GefahrBewertungAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? AND warnstufe != 'keine' \
         ORDER BY gefahrentyp, schutzobjekt"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Aktuelle Warnstufe einer Zelle (für die ETB-Entscheidung *vor* dem Schreiben).
/// `None`, wenn die Zelle noch nicht existiert (= effektiv `keine`).
pub async fn aktuelle_warnstufe(
    pool: &SqlitePool,
    einsatz_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
) -> Result<Option<String>, AppError> {
    let w = sqlx::query_scalar::<_, String>(
        "SELECT warnstufe FROM gefahr_bewertung \
         WHERE einsatz_id = ? AND gefahrentyp = ? AND schutzobjekt = ?",
    )
    .bind(einsatz_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .fetch_optional(pool)
    .await?;
    Ok(w)
}

/// UPSERT einer Bewertung auf die UNIQUE-Zelle. KEIN Delete-Zweig: `warnstufe='keine'`
/// lässt die Zeile bestehen, `liste()` filtert sie aus → kein Phantom-Eintrag.
pub async fn upsert_bewertung(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: BewertungDaten<'_>,
) -> Result<GefahrBewertungAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahr_bewertung \
            (einsatz_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, gemeldet_von, aktualisiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (einsatz_id, gefahrentyp, schutzobjekt) DO UPDATE SET \
            warnstufe = excluded.warnstufe, \
            beschreibung = excluded.beschreibung, \
            gemeldet_von = excluded.gemeldet_von, \
            aktualisiert_von = excluded.aktualisiert_von, \
            geaendert_at = datetime('now') \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.gefahrentyp)
    .bind(daten.schutzobjekt)
    .bind(daten.warnstufe)
    .bind(daten.beschreibung)
    .bind(daten.gemeldet_von)
    .bind(daten.aktualisiert_von)
    .fetch_one(pool)
    .await?;
    laden(pool, id).await
}

/// Stellt sicher, dass für `(typ, objekt)` eine Zelle existiert (für die Zonen-
/// Verknüpfung in Phase 3). Legt sie bei Bedarf mit `warnstufe='keine'` an.
/// Hinweis: bei lifeline gibt es keinen FK Zone→Zelle (anders als BLH ADR-010), die
/// Zone trägt typ/objekt selbst — diese Funktion ist daher fast redundant, bleibt aber
/// per Spec erhalten (idempotent durch ON CONFLICT DO NOTHING).
pub async fn lazy_create_zelle(
    pool: &SqlitePool,
    einsatz_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO gefahr_bewertung (einsatz_id, gefahrentyp, schutzobjekt, warnstufe, aktualisiert_von) \
         VALUES (?, ?, ?, 'keine', ?) \
         ON CONFLICT (einsatz_id, gefahrentyp, schutzobjekt) DO NOTHING",
    )
    .bind(einsatz_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .bind(benutzer_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Lädt eine Zelle per id (für die Anzeige nach Upsert).
async fn laden(pool: &SqlitePool, id: i64) -> Result<GefahrBewertungAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Benutzer(1) + Einsatz; liefert einsatz_id und benutzer_id.
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'A', 'a', 'x') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (eid, bid)
    }

    fn daten<'a>(typ: &'a str, objekt: &'a str, warn: &'a str, bid: i64) -> BewertungDaten<'a> {
        BewertungDaten { gefahrentyp: typ, schutzobjekt: objekt, warnstufe: warn, beschreibung: None, gemeldet_von: None, aktualisiert_von: bid }
    }

    #[tokio::test]
    async fn liste_leer_dann_upsert_dann_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        assert!(liste(&pool, eid).await.unwrap().is_empty());

        let z = upsert_bewertung(&pool, eid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        assert_eq!(z.warnstufe, "hoch");
        assert_eq!(liste(&pool, eid).await.unwrap().len(), 1);

        // Erneutes Upsert derselben Zelle → Update statt zweiter Zeile.
        let z2 = upsert_bewertung(&pool, eid, daten("brand", "menschen", "akut", bid)).await.unwrap();
        assert_eq!(z2.id, z.id);
        assert_eq!(z2.warnstufe, "akut");
        assert_eq!(liste(&pool, eid).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn warnstufe_keine_ist_kein_phantom() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "keine", bid)).await.unwrap();
        assert!(liste(&pool, eid).await.unwrap().is_empty(), "keine-Zelle darf nicht gelistet werden");
    }

    #[tokio::test]
    async fn aktuelle_warnstufe_liest_vorzustand() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap(), None);
        upsert_bewertung(&pool, eid, daten("brand", "menschen", "mittel", bid)).await.unwrap();
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap().as_deref(), Some("mittel"));
    }

    #[tokio::test]
    async fn lazy_create_ist_idempotent_und_keine() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = setup(&pool).await;
        lazy_create_zelle(&pool, eid, "brand", "menschen", bid).await.unwrap();
        lazy_create_zelle(&pool, eid, "brand", "menschen", bid).await.unwrap();
        // keine-Zelle → nicht gelistet, aber existiert (aktuelle_warnstufe == keine).
        assert!(liste(&pool, eid).await.unwrap().is_empty());
        assert_eq!(aktuelle_warnstufe(&pool, eid, "brand", "menschen").await.unwrap().as_deref(), Some("keine"));
    }
}
```

- [ ] **Step 2: Tests laufen lassen**

Run: `rtk proxy cargo test --lib gefahr::repo`
Expected: PASS (4 Tests). Falls `crate::db::test_pool` einen anderen Pfad hat: `grep -rn "pub async fn test_pool" src/db` zur Korrektur. Falls die `benutzer`-INSERT-Spalten abweichen: `grep -n "CREATE TABLE benutzer" migrations/*.sql` und Pflichtspalten ergänzen.

- [ ] **Step 3: Commit**

```bash
git add src/gefahr/repo.rs
git commit -m "feat(be): gefahr-Repo upsert/liste/lazy_create + Unit-Tests (LFH-53)"
```

---

### Task 4: `src/routes/gefahr.rs` — Handler + Routen-Wiring

**Files:**
- Create: `src/routes/gefahr.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`

- [ ] **Step 1: Handler schreiben**

Create `src/routes/gefahr.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige};
use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// SSE-Notify: die Gefahrenmatrix hat sich geändert. Event-Tag `gefahr`.
fn sse_gefahr(state: &AppState, einsatz_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id }).to_string();
    state.live.publiziere_event(einsatz_id, "gefahr", data);
}

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie lage_zone).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool, einsatz_id, benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM, inhalt, von: None, an: None, meldeweg: None,
            veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
        },
    ).await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/gefahrenmatrix — gesetzte Zellen (Frontend rendert das Raster).
/// Nur Lesezugriff.
pub async fn matrix(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<GefahrBewertungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(gefahr_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct BewertungBody {
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
}

/// PUT /api/einsaetze/{id}/gefahrenmatrix/bewertung — Zelle setzen (UPSERT).
/// Schreibrecht + aktiv. ETB nur bei realer Warnstufen-Änderung (auch keine↔x).
pub async fn bewerten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<BewertungBody>,
) -> Result<Json<GefahrBewertungAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !gefahr::GEFAHRENTYPEN.contains(&body.gefahrentyp.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekannter Gefahrentyp: {}", body.gefahrentyp)));
    }
    if !gefahr::SCHUTZOBJEKTE.contains(&body.schutzobjekt.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekanntes Schutzobjekt: {}", body.schutzobjekt)));
    }
    if !gefahr::WARNSTUFEN.contains(&body.warnstufe.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekannte Warnstufe: {}", body.warnstufe)));
    }
    if !gefahr::kombination_gueltig(&body.gefahrentyp, &body.schutzobjekt) {
        return Err(AppError::UnprocessableEntity(format!(
            "Kombination {} × {} ist nicht zulässig", body.gefahrentyp, body.schutzobjekt
        )));
    }

    let alt = gefahr_repo::aktuelle_warnstufe(&state.pool, einsatz_id, &body.gefahrentyp, &body.schutzobjekt)
        .await?
        .unwrap_or_else(|| "keine".to_string());

    let beschreibung = trimme(body.beschreibung.clone());
    let gemeldet_von = trimme(body.gemeldet_von.clone());
    let z = gefahr_repo::upsert_bewertung(&state.pool, einsatz_id, BewertungDaten {
        gefahrentyp: &body.gefahrentyp,
        schutzobjekt: &body.schutzobjekt,
        warnstufe: &body.warnstufe,
        beschreibung: beschreibung.as_deref(),
        gemeldet_von: gemeldet_von.as_deref(),
        aktualisiert_von: benutzer.id,
    }).await?;

    if z.warnstufe != alt {
        let g = gefahr::gefahrentyp_label(&z.gefahrentyp);
        let o = gefahr::schutzobjekt_label(&z.schutzobjekt);
        let text = if z.warnstufe == "keine" {
            format!("Gefahr «{g}» für «{o}» aufgehoben.")
        } else {
            format!("Gefahr «{g}» für «{o}» auf Warnstufe «{}» gesetzt.", z.warnstufe)
        };
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_gefahr(&state, einsatz_id);
    Ok(Json(z))
}

/// GET /api/einsaetze/{id}/gefahrenmatrix/stream — SSE (ganzer Einsatz-Kanal, verbatim).
/// Symmetrie zu lage_zone/abschnitt. Die SPA konsumiert das `gefahr`-Event über den
/// gemeinsamen `/etb/stream`, NICHT über diese Route (siehe useEinsatzLiveStream).
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
```

- [ ] **Step 2: Route-Modul deklarieren**

Modify `src/routes/mod.rs` — füge nahe `pub mod fahrzeug;` ein:

```rust
pub mod fahrzeug;
pub mod fahrzeug_status;
pub mod gefahr;
```

- [ ] **Step 3: Routen einhängen**

Modify `src/app.rs` — direkt nach dem `zonen`-Block (`.../zonen/{zid}` delete) einfügen:

```rust
        .route("/api/einsaetze/{id}/gefahrenmatrix", get(routes::gefahr::matrix))
        .route("/api/einsaetze/{id}/gefahrenmatrix/bewertung", put(routes::gefahr::bewerten))
        .route("/api/einsaetze/{id}/gefahrenmatrix/stream", get(routes::gefahr::stream))
```

Falls `put` im `use axum::routing::{...}` oben in `app.rs` noch nicht importiert ist: ergänzen (`grep -n "use axum::routing" src/app.rs`).

- [ ] **Step 4: Build**

Run: `rtk proxy cargo build`
Expected: PASS. Bei Fehlern zu `AppError::UnprocessableEntity`: `grep -n "UnprocessableEntity\|Validation" src/error.rs` — den vorhandenen 422-Variant nutzen.

- [ ] **Step 5: Commit**

```bash
git add src/routes/gefahr.rs src/routes/mod.rs src/app.rs
git commit -m "feat(be): Gefahrenmatrix-Routen (GET/PUT/SSE) + ETB-Spur (LFH-53)"
```

---

### Task 5: `tests/gefahr.rs` — Integrationstests

**Files:**
- Create: `tests/gefahr.rs`

- [ ] **Step 1: Test-Datei schreiben**

Create `tests/gefahr.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState { pool, live: live.clone() });
    (router, live)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json").body(Body::from(body)).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap()
        .split(';').next().unwrap().to_string()
}

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#);
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn anfrage(app: &axum::Router, methode: &str, uri: &str, cookie: &str, body: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => { req = req.header(header::CONTENT_TYPE, "application/json"); Body::from(b.to_string()) }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#))).await;
    assert_eq!(status, StatusCode::OK);
}

async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string()).collect()
}

async fn recv_until_tag(rx: &mut Receiver<LiveNachricht>, tag: &str, timeout: Duration) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv()).await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event == tag { return n; }
    }
}

fn bewertung(typ: &str, objekt: &str, warn: &str) -> String {
    json!({"gefahrentyp": typ, "schutzobjekt": objekt, "warnstufe": warn}).to_string()
}

#[tokio::test]
async fn matrix_leer_dann_put_dann_upsert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, leer) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);

    let (status, z) = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    assert_eq!(status, StatusCode::OK, "{z:?}");
    assert_eq!(z["warnstufe"], "hoch");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "akut"))).await;
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste2.as_array().unwrap().len(), 1, "UPSERT, keine zweite Zeile");
    assert_eq!(liste2[0]["warnstufe"], "akut");
}

#[tokio::test]
async fn keine_leert_die_zelle() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0, "keine darf kein Phantom hinterlassen");
}

#[tokio::test]
async fn ungueltiger_enum_und_kombination_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung");

    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("quatsch", "menschen", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "quatsch", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "quatsch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    // Ungültige Kombination: sachwerte × atemgifte.
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("atemgifte", "sachwerte", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn etb_bei_warnstufenwechsel_nicht_bei_reiner_beschreibung() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung");

    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Gefahr «Brand» für «Menschen» auf Warnstufe «hoch» gesetzt."), "ETB: {etb:?}");
    let basis = etb.len();

    // Gleiche Warnstufe, nur Beschreibung → KEIN neuer ETB-Eintrag.
    let nur_beschreibung = json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch","beschreibung":"Dachstuhl"}).to_string();
    anfrage(&app, "PUT", &u, &admin, Some(&nur_beschreibung)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "Beschreibung allein darf keinen ETB erzeugen");

    // Warnstufe → keine: ETB „aufgehoben".
    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let etb2 = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb2.len(), basis + 1);
    assert!(etb2.iter().any(|i| i == "Gefahr «Brand» für «Menschen» aufgehoben."), "ETB: {etb2:?}");
}

#[tokio::test]
async fn sse_feuert_bei_put() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let n = recv_until_tag(&mut rx, "gefahr", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
}

#[tokio::test]
async fn berechtigung_beobachter_liest_schreibt_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &erika_c, Some(&bewertung("brand", "menschen", "hoch"))).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_abgewiesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &fremd, None).await.0;
    assert!(matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "GET: {get}");
    let put = anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &fremd, Some(&bewertung("brand", "menschen", "hoch"))).await.0;
    assert!(matches!(put, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "PUT: {put}");
}
```

- [ ] **Step 2: Tests laufen lassen**

Run: `rtk proxy cargo test --test gefahr`
Expected: PASS (7 Tests). Bei abweichenden Helper-Signaturen (z.B. `/api/einsaetze/{id}/mitglieder/{bid}`-Route): mit `tests/einsatzabschnitt.rs` abgleichen, das identische Helper nutzt.

- [ ] **Step 3: Phase-1-Gate**

Run: `rtk proxy cargo test`
Expected: gesamte Backend-Suite grün.

- [ ] **Step 4: Commit**

```bash
git add tests/gefahr.rs
git commit -m "test(be): Integrationstests Gefahrenmatrix (LFH-53)"
```

---

# Phase 2 — Frontend Gefahrenmatrix-Seite

**Gate am Phasenende:** Vitest grün (`cd frontend && pnpm vitest run --no-file-parallelism`; Memory `frontend-testsuite-parallel-timeouts`) + `pnpm build` (Frontend ist ins Binary eingebettet; Memory `frontend-in-binary-eingebettet`).

---

### Task 6: `types.ts` — Typen ergänzen

**Files:**
- Modify: `frontend/src/api/types.ts`

- [ ] **Step 1: Typen hinzufügen**

Modify `frontend/src/api/types.ts` — direkt vor der bestehenden `ZoneTyp`-Definition (oder am Ende der Lage-Typen) einfügen:

```typescript
export type Gefahrentyp =
  | 'atemgifte' | 'angstreaktion' | 'ausbreitung' | 'atomare_strahlung' | 'chemische_stoffe'
  | 'erkrankung_verletzung' | 'explosion' | 'elektrizitaet' | 'einsturz' | 'absturz' | 'brand'
  | 'durchbruch' | 'ertrinken';

export type Schutzobjekt = 'menschen' | 'tiere' | 'umwelt' | 'sachwerte' | 'einsatzkraefte';

export type Warnstufe = 'keine' | 'niedrig' | 'mittel' | 'hoch' | 'akut';

export interface GefahrBewertung {
  id: number;
  einsatz_id: number;
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung: string | null;
  gemeldet_von: string | null;
  aktualisiert_von: number;
  erstellt_at: string;
  geaendert_at: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/types.ts
git commit -m "feat(fe): Typen Gefahrentyp/Schutzobjekt/Warnstufe/GefahrBewertung (LFH-53)"
```

---

### Task 7: `gefahrenSchema.ts` — Kataloge + Test (TDD)

**Files:**
- Create: `frontend/src/pages/gefahren/gefahrenSchema.ts`
- Create: `frontend/src/pages/gefahren/gefahrenSchema.test.ts`

- [ ] **Step 1: Test schreiben (failing)**

Create `frontend/src/pages/gefahren/gefahrenSchema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe } from './gefahrenSchema';

describe('gefahrenSchema', () => {
  it('hat 13 Gefahrentypen, 5 Schutzobjekte, 5 Warnstufen', () => {
    expect(GEFAHRENTYPEN).toHaveLength(13);
    expect(SCHUTZOBJEKTE).toHaveLength(5);
    expect(WARNSTUFEN).toHaveLength(5);
  });

  it('kombinationGueltig sperrt die ungültigen Paare', () => {
    // sachwerte × {angstreaktion, atemgifte, erkrankung_verletzung, ertrinken}
    expect(kombinationGueltig('atemgifte', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('angstreaktion', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('erkrankung_verletzung', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('ertrinken', 'sachwerte')).toBe(false);
    // umwelt × {angstreaktion, erkrankung_verletzung, ertrinken}
    expect(kombinationGueltig('angstreaktion', 'umwelt')).toBe(false);
    expect(kombinationGueltig('erkrankung_verletzung', 'umwelt')).toBe(false);
    expect(kombinationGueltig('ertrinken', 'umwelt')).toBe(false);
    // gültige Beispiele
    expect(kombinationGueltig('brand', 'menschen')).toBe(true);
    expect(kombinationGueltig('atemgifte', 'umwelt')).toBe(true);
    expect(kombinationGueltig('brand', 'sachwerte')).toBe(true);
  });

  it('warnstufeFarbe liefert für jede Warnstufe einen Wert', () => {
    for (const w of WARNSTUFEN) {
      expect(typeof warnstufeFarbe(w.wert)).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Test laufen lassen (failing)**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/gefahrenSchema.test.ts`
Expected: FAIL — Modul `./gefahrenSchema` nicht gefunden.

- [ ] **Step 3: Schema implementieren**

Create `frontend/src/pages/gefahren/gefahrenSchema.ts`:

```typescript
import type { Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';

export interface Katalogeintrag<T extends string> {
  wert: T;
  label: string;
}

/** 13 Gefahrentypen (Zeilen der Matrix). Reihenfolge = Backend-Katalog. */
export const GEFAHRENTYPEN: Katalogeintrag<Gefahrentyp>[] = [
  { wert: 'atemgifte', label: 'Atemgifte' },
  { wert: 'angstreaktion', label: 'Angstreaktion' },
  { wert: 'ausbreitung', label: 'Ausbreitung' },
  { wert: 'atomare_strahlung', label: 'Atomare Strahlung' },
  { wert: 'chemische_stoffe', label: 'Chemische Stoffe' },
  { wert: 'erkrankung_verletzung', label: 'Erkrankung/Verletzung' },
  { wert: 'explosion', label: 'Explosion' },
  { wert: 'elektrizitaet', label: 'Elektrizität' },
  { wert: 'einsturz', label: 'Einsturz' },
  { wert: 'absturz', label: 'Absturz' },
  { wert: 'brand', label: 'Brand' },
  { wert: 'durchbruch', label: 'Durchbruch' },
  { wert: 'ertrinken', label: 'Ertrinken' },
];

/** 5 Schutzobjekte (Spalten der Matrix). */
export const SCHUTZOBJEKTE: Katalogeintrag<Schutzobjekt>[] = [
  { wert: 'menschen', label: 'Menschen' },
  { wert: 'tiere', label: 'Tiere' },
  { wert: 'umwelt', label: 'Umwelt' },
  { wert: 'sachwerte', label: 'Sachwerte' },
  { wert: 'einsatzkraefte', label: 'Einsatzkräfte' },
];

/** 5 Warnstufen (Dropdown je Zelle). */
export const WARNSTUFEN: Katalogeintrag<Warnstufe>[] = [
  { wert: 'keine', label: 'Keine' },
  { wert: 'niedrig', label: 'Niedrig' },
  { wert: 'mittel', label: 'Mittel' },
  { wert: 'hoch', label: 'Hoch' },
  { wert: 'akut', label: 'Akut' },
];

/** Ungültige Paare (verbatim aus bluelight-hub) → Zelle ausgegraut/nicht editierbar. */
export function kombinationGueltig(typ: Gefahrentyp, objekt: Schutzobjekt): boolean {
  if (objekt === 'sachwerte') {
    return !['angstreaktion', 'atemgifte', 'erkrankung_verletzung', 'ertrinken'].includes(typ);
  }
  if (objekt === 'umwelt') {
    return !['angstreaktion', 'erkrankung_verletzung', 'ertrinken'].includes(typ);
  }
  return true;
}

/** Hintergrundfarbe je Warnstufe (Zell-Codierung). `keine` = neutral. */
export function warnstufeFarbe(w: Warnstufe): string {
  switch (w) {
    case 'niedrig': return '#fff7e6';
    case 'mittel': return '#ffd591';
    case 'hoch': return '#ffa39e';
    case 'akut': return '#ff4d4f';
    case 'keine':
    default: return 'transparent';
  }
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/gefahrenSchema.test.ts`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/gefahren/gefahrenSchema.ts frontend/src/pages/gefahren/gefahrenSchema.test.ts
git commit -m "feat(fe): gefahrenSchema Kataloge + kombinationGueltig + Farben (LFH-53)"
```

---

### Task 8: `api/gefahren.ts` — API-Client

**Files:**
- Create: `frontend/src/api/gefahren.ts`

- [ ] **Step 1: Client schreiben**

Create `frontend/src/api/gefahren.ts`:

```typescript
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from './types';
import { apiGet, apiSend } from './client';

export interface BewertungEingabe {
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung?: string | null;
  gemeldet_von?: string | null;
}

export function ladeGefahrenmatrix(einsatzId: number): Promise<GefahrBewertung[]> {
  return apiGet<GefahrBewertung[]>(`/api/einsaetze/${einsatzId}/gefahrenmatrix`);
}

export function setzeBewertung(einsatzId: number, daten: BewertungEingabe): Promise<GefahrBewertung> {
  return apiSend<GefahrBewertung>(`/api/einsaetze/${einsatzId}/gefahrenmatrix/bewertung`, 'PUT', daten);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: PASS. Falls `'PUT'` kein gültiger `HttpMethode`-Wert ist: `grep -n "HttpMethode" frontend/src/api/client.ts` und PUT zum Union-Typ ergänzen.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/gefahren.ts
git commit -m "feat(fe): API-Client Gefahrenmatrix (laden/setzen) (LFH-53)"
```

---

### Task 9: `GefahrenPage.tsx` — 13×5-Grid + Test (TDD)

**Files:**
- Create: `frontend/src/pages/gefahren/GefahrenPage.tsx`
- Create: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`

- [ ] **Step 1: Test schreiben (failing)**

Create `frontend/src/pages/gefahren/GefahrenPage.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import GefahrenPage from './GefahrenPage';

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};

function handlers(rolle = 'einsatzleitung', status = 'aktiv', matrix: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/gefahrenmatrix', () => HttpResponse.json(matrix)),
  ];
}

function renderPage() {
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} />
    </Routes>,
    { route: '/einsaetze/1/gefahren' },
  );
}

describe('GefahrenPage', () => {
  it('rendert das 13×5-Raster (13 Gefahrentyp-Zeilen, 5 Schutzobjekt-Spalten)', async () => {
    server.use(...handlers());
    renderPage();
    expect(await screen.findByText('Brand')).toBeInTheDocument();
    expect(screen.getByText('Atemgifte')).toBeInTheDocument();
    expect(screen.getByText('Ertrinken')).toBeInTheDocument();
    expect(screen.getByText('Menschen')).toBeInTheDocument();
    expect(screen.getByText('Einsatzkräfte')).toBeInTheDocument();
  });

  it('setzt eine Warnstufe und ruft die API (PUT)', async () => {
    let put: { gefahrentyp: string; schutzobjekt: string; warnstufe: string } | null = null;
    server.use(
      ...handlers(),
      http.put('/api/einsaetze/1/gefahrenmatrix/bewertung', async ({ request }) => {
        put = (await request.json()) as typeof put;
        return HttpResponse.json({
          id: 1, einsatz_id: 1, gefahrentyp: put!.gefahrentyp, schutzobjekt: put!.schutzobjekt,
          warnstufe: put!.warnstufe, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1,
          erstellt_at: '', geaendert_at: '',
        });
      }),
    );
    renderPage();
    // Zelle (brand × menschen): aria-label am Select.
    const zelle = await screen.findByLabelText('Warnstufe brand × menschen');
    await userEvent.click(zelle);
    await userEvent.click(await screen.findByText('Hoch'));
    await waitFor(() => expect(put).toEqual({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' }));
  });

  it('graut ungültige Kombinationen aus (sachwerte × atemgifte disabled)', async () => {
    server.use(...handlers());
    renderPage();
    const zelle = await screen.findByLabelText('Warnstufe atemgifte × sachwerte');
    expect(zelle).toHaveClass('ant-select-disabled');
  });
});
```

- [ ] **Step 2: Test laufen lassen (failing)**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: FAIL — Modul `./GefahrenPage` nicht gefunden.

- [ ] **Step 3: Seite implementieren**

Create `frontend/src/pages/gefahren/GefahrenPage.tsx`:

```typescript
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Select, Spin, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import { ApiError } from '../../api/client';
import { ladeGefahrenmatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import {
  GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe,
} from './gefahrenSchema';

interface ZeilenDaten {
  typ: Gefahrentyp;
  label: string;
}

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const matrixQuery = useQuery({ queryKey: ['gefahrenmatrix', einsatzId], queryFn: () => ladeGefahrenmatrix(einsatzId) });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const setzen = useMutation({
    mutationFn: (d: { typ: Gefahrentyp; objekt: Schutzobjekt; warnstufe: Warnstufe }) =>
      setzeBewertung(einsatzId, { gefahrentyp: d.typ, schutzobjekt: d.objekt, warnstufe: d.warnstufe }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId] }); },
    onError: fehler,
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

  // Effektive Warnstufe je (typ, objekt) aus der (keine-gefilterten) Matrix.
  const matrix: GefahrBewertung[] = matrixQuery.data ?? [];
  const warnstufeVon = (typ: Gefahrentyp, objekt: Schutzobjekt): Warnstufe => {
    const t = matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
    return t?.warnstufe ?? 'keine';
  };

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => ({
      title: obj.label,
      key: obj.wert,
      render: (_: unknown, zeile: ZeilenDaten) => {
        const gueltig = kombinationGueltig(zeile.typ, obj.wert);
        const aktuell = warnstufeVon(zeile.typ, obj.wert);
        return (
          <Select<Warnstufe>
            aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
            size="small"
            style={{ width: 110, backgroundColor: warnstufeFarbe(aktuell) }}
            value={aktuell}
            disabled={!gueltig || !darfSchreiben || setzen.isPending}
            options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
            onChange={(w) => setzen.mutate({ typ: zeile.typ, objekt: obj.wert, warnstufe: w })}
          />
        );
      },
    })),
  ];

  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <Table<ZeilenDaten>
      rowKey="typ"
      columns={spalten}
      dataSource={zeilen}
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
      loading={matrixQuery.isLoading}
    />
  );
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: PASS (3 Tests). Falls `ladeEinsatz` anders heißt: `grep -n "export.*ladeEinsatz\|export.*Einsatz" frontend/src/api/einsaetze.ts`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/gefahren/GefahrenPage.tsx frontend/src/pages/gefahren/GefahrenPage.test.tsx
git commit -m "feat(fe): GefahrenPage 13x5-Matrix-Grid + Test (LFH-53)"
```

---

### Task 10: Registry + Routing + Live-Invalidierung

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`
- Modify: `frontend/src/etb/useEinsatzLiveStream.test.tsx`

- [ ] **Step 1: Live-Listener-Test schreiben (failing)**

Modify `frontend/src/etb/useEinsatzLiveStream.test.tsx` — neuen Test in den `describe`-Block einfügen:

```typescript
  it('invalidiert gefahrenmatrix bei gefahr-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('gefahr');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('gefahrenmatrix');
    });
  });
```

- [ ] **Step 2: Test laufen lassen (failing)**

Run: `cd frontend && pnpm vitest run src/etb/useEinsatzLiveStream.test.tsx`
Expected: FAIL — `gefahrenmatrix` nicht in den invalidierten Keys (Listener fehlt noch).

- [ ] **Step 3: `gefahr`-Listener ergänzen**

Modify `frontend/src/etb/useEinsatzLiveStream.ts`:

a) Handler nach `const onZone = () => inval('einsatz-zonen');` (Zeile 29) einfügen:

```typescript
    const onGefahr = () => inval('gefahrenmatrix');
```

b) In `onLag` (der Buffer-Overflow-Sammelhandler) `onGefahr()` ergänzen — nach `onZone();`:

```typescript
      onZone();
      onGefahr();
```

c) Listener registrieren — nach `quelle.addEventListener('lage_zone', onZone);` (Zeile 70):

```typescript
    quelle.addEventListener('gefahr', onGefahr);
```

d) Listener abmelden — nach `quelle.removeEventListener('lage_zone', onZone);` (Zeile 80):

```typescript
      quelle.removeEventListener('gefahr', onGefahr);
```

- [ ] **Step 4: Live-Test grün**

Run: `cd frontend && pnpm vitest run src/etb/useEinsatzLiveStream.test.tsx`
Expected: PASS (alle Tests inkl. dem neuen `gefahr`-Test).

- [ ] **Step 5: Registry-Eintrag umbauen**

Modify `frontend/src/einsatz/modulRegistry.ts` — den `gefahrenzonen`-Eintrag (Zeile 68) ersetzen:

```typescript
{ key: 'gefahrenzonen', kategorie: 'lage', label: 'Gefahren', icon: TbAlertTriangle, route: 'gefahren', status: 'fertig', beschreibung: 'Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) und Verknüpfung der Gefahrengebiete.' },
```

(Der `key` bleibt `'gefahrenzonen'` — `App.tsx` mappt `MODUL_ELEMENTE[m.key]`. Geändert: `label`, `route`, `status`, `beschreibung`.)

- [ ] **Step 6: Seite registrieren**

Modify `frontend/src/App.tsx`:

a) Import nahe den anderen Seiten-Importen (z.B. nach `EinsatzabschnittePage`):

```typescript
import GefahrenPage from './pages/gefahren/GefahrenPage';
```

b) In `MODUL_ELEMENTE` (Record) einen Eintrag ergänzen:

```typescript
  gefahrenzonen: <GefahrenPage />,
```

- [ ] **Step 7: Typecheck + volle Suite**

Run: `cd frontend && pnpm tsc --noEmit && pnpm vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 8: Phase-2-Gate — Build (Binary-Embed)**

Run: `cd frontend && pnpm build`
Expected: erfolgreich (für die ins Binary eingebettete Auslieferung).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx frontend/src/etb/useEinsatzLiveStream.ts frontend/src/etb/useEinsatzLiveStream.test.tsx
git commit -m "feat(fe): Gefahren-Seite in Registry/Routing + Live-Invalidierung (LFH-53)"
```

---

# Phase 3 — Zonen-Verknüpfung (Gefahrengebiet ↔ Matrix)

**Gate am Phasenende:** `rtk proxy cargo test` + `cd frontend && pnpm vitest run --no-file-parallelism` + `pnpm build` grün.

---

### Task 11: Migration `lage_zone` um Gefahren-Zuordnung

**Files:**
- Create: `migrations/0040_lage_zone_gefahr.sql`

- [ ] **Step 1: Migration schreiben**

Create `migrations/0040_lage_zone_gefahr.sql`:

```sql
-- LFH-53: optionale Verknüpfung einer gefahrengebiet-Zone auf eine Matrix-Zelle.
-- Beide Spalten nullable; gültig nur GEMEINSAM und nur für typ='gefahrengebiet'.
-- Validierung (beide-oder-keine, gültige Enums/Kombination, nur gefahrengebiet) und
-- Lazy-Create der Zelle erzwingt die App, nicht die DB (Hauskonvention, kein Composite-FK).
ALTER TABLE lage_zone ADD COLUMN gefahrentyp  TEXT;
ALTER TABLE lage_zone ADD COLUMN schutzobjekt TEXT;
```

- [ ] **Step 2: Commit**

```bash
git add migrations/0040_lage_zone_gefahr.sql
git commit -m "feat(be): Migration lage_zone Gefahren-Zuordnung (LFH-53)"
```

---

### Task 12: `lage_zone` Backend — DTO, Validierung, Repo, Lazy-Create (TDD)

**Files:**
- Modify: `src/lage_zone/mod.rs`
- Modify: `src/lage_zone/repo.rs`

- [ ] **Step 1: DTO + Validierungs-Helfer (mod.rs)**

Modify `src/lage_zone/mod.rs`:

a) `LageZoneAnzeige` um zwei Felder erweitern (nach `notiz`):

```rust
    pub notiz: Option<String>,
    pub gefahrentyp: Option<String>,
    pub schutzobjekt: Option<String>,
    pub erstellt_von: i64,
```

b) Validierungs-Helfer am Dateiende ergänzen:

```rust
/// Prüft die optionale Gefahren-Zuordnung einer Zone:
/// - nur `typ='gefahrengebiet'` darf eine Zuordnung tragen,
/// - beide Felder gemeinsam gesetzt oder beide leer (kein Halb-Zustand),
/// - gültige Enums + gültige Kombination (delegiert an `gefahr::kombination_gueltig`).
pub fn gefahren_zuordnung_gueltig(
    typ_der_zone: &str,
    gefahrentyp: Option<&str>,
    schutzobjekt: Option<&str>,
) -> bool {
    match (gefahrentyp, schutzobjekt) {
        (None, None) => true,
        (Some(g), Some(o)) => {
            typ_der_zone == "gefahrengebiet"
                && crate::gefahr::GEFAHRENTYPEN.contains(&g)
                && crate::gefahr::SCHUTZOBJEKTE.contains(&o)
                && crate::gefahr::kombination_gueltig(g, o)
        }
        _ => false, // genau eines gesetzt → ungültig
    }
}
```

- [ ] **Step 2: Repo — Felder + Lazy-Create (repo.rs)**

Modify `src/lage_zone/repo.rs`:

a) `Row` und `SELECT_ALLE` um die zwei Spalten erweitern:

```rust
const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           gefahrentyp, schutzobjekt, erstellt_von, erstellt_at, geaendert_at \
    FROM lage_zone";
```

```rust
    notiz: Option<String>,
    gefahrentyp: Option<String>,
    schutzobjekt: Option<String>,
    erstellt_von: i64,
```

b) `zu_anzeige` um die Felder ergänzen:

```rust
        notiz: r.notiz,
        gefahrentyp: r.gefahrentyp,
        schutzobjekt: r.schutzobjekt,
        erstellt_von: r.erstellt_von,
```

c) `ZoneNeu` um die Felder ergänzen:

```rust
    pub notiz: Option<&'a str>,
    pub gefahrentyp: Option<&'a str>,
    pub schutzobjekt: Option<&'a str>,
    pub erstellt_von: i64,
```

d) `ZonePatch` um Tri-State-Felder ergänzen:

```rust
    pub notiz: Option<Option<&'a str>>,
    pub gefahrentyp: Option<Option<&'a str>>,
    pub schutzobjekt: Option<Option<&'a str>>,
```

e) `anlegen` — INSERT-Spaltenliste + Binds um die zwei Felder erweitern und nach erfolgreichem Insert Lazy-Create auslösen:

```rust
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, daten: ZoneNeu<'_>) -> Result<LageZoneAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, gefahrentyp, schutzobjekt, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz)
    .bind(daten.gefahrentyp).bind(daten.schutzobjekt).bind(daten.erstellt_von)
    .fetch_one(pool).await?;
    if let (Some(g), Some(o)) = (daten.gefahrentyp, daten.schutzobjekt) {
        crate::gefahr::repo::lazy_create_zelle(pool, einsatz_id, g, o, daten.erstellt_von).await?;
    }
    laden(pool, einsatz_id, id).await
}
```

f) `aktualisiere` — `ZonePatch` um die zwei Felder erweitern (CASE WHEN) und Lazy-Create beim Setzen. Den UPDATE-Block ersetzen:

```rust
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            gefahrentyp  = CASE WHEN ? THEN ? ELSE gefahrentyp END, \
            schutzobjekt = CASE WHEN ? THEN ? ELSE schutzobjekt END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some()).bind(daten.typ)
    .bind(daten.label.is_some()).bind(daten.label.flatten())
    .bind(daten.farbe.is_some()).bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some()).bind(daten.notiz.flatten())
    .bind(daten.gefahrentyp.is_some()).bind(daten.gefahrentyp.flatten())
    .bind(daten.schutzobjekt.is_some()).bind(daten.schutzobjekt.flatten())
    .bind(id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    // Beim Setzen einer Zuordnung die Matrix-Zelle sicherstellen (Lazy-Create).
    let z = laden(pool, einsatz_id, id).await?;
    if let (Some(g), Some(o)) = (z.gefahrentyp.as_deref(), z.schutzobjekt.as_deref()) {
        crate::gefahr::repo::lazy_create_zelle(pool, einsatz_id, g, o, z.erstellt_von).await?;
    }
    Ok(z)
}
```

- [ ] **Step 3: Build**

Run: `rtk proxy cargo build`
Expected: PASS. (Routen-Handler in `routes/lage_zone.rs` setzen die neuen Felder noch nicht — kompiliert trotzdem, da `ZoneNeu`/`ZonePatch` über `..Default::default()` bzw. explizite `None` befüllt werden; siehe Task 13. Falls `ZoneNeu` kein `Default` ableitet und der Handler alle Felder explizit setzt: Task 13 ergänzt die Felder dort.)

- [ ] **Step 4: Commit**

```bash
git add src/lage_zone/mod.rs src/lage_zone/repo.rs
git commit -m "feat(be): lage_zone Gefahren-Zuordnung (DTO/Repo/Lazy-Create) (LFH-53)"
```

---

### Task 13: `routes/lage_zone.rs` — Felder akzeptieren + Tests (TDD)

**Files:**
- Modify: `src/routes/lage_zone.rs`
- Modify: `tests/lage_zone.rs`

- [ ] **Step 1: Integrationstests schreiben (failing)**

Modify `tests/lage_zone.rs` — neue Tests ergänzen (POLY-Konstante existiert bereits):

```rust
#[tokio::test]
async fn gefahrengebiet_mit_zuordnung_macht_lazy_create() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    let (status, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["gefahrentyp"], "brand");
    assert_eq!(z["schutzobjekt"], "menschen");
    // Lazy-Create legt eine keine-Zelle an → NICHT in der Matrix-Liste (kein Phantom),
    // aber die Matrix bleibt leer (keine != gelistet).
    let (_, matrix) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(matrix.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn zuordnung_an_nicht_gefahrengebiet_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"absperrbereich","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn nur_eines_der_zuordnungsfelder_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand"}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_entfernt_zuordnung_ohne_matrixzelle_zu_loeschen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Zelle aktiv setzen (warnstufe hoch) → Matrix hat 1 Eintrag.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix/bewertung"), &admin,
        Some(&json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"}).to_string())).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"gefahrentyp":"brand","schutzobjekt":"menschen"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();

    // Zuordnung entfernen (beide → null).
    let (status, z2) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin,
        Some(r#"{"gefahrentyp":null,"schutzobjekt":null}"#)).await;
    assert_eq!(status, StatusCode::OK, "{z2:?}");
    assert!(z2["gefahrentyp"].is_null());
    assert!(z2["schutzobjekt"].is_null());
    // Matrix-Zelle bleibt unangetastet.
    let (_, matrix) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrenmatrix"), &admin, None).await;
    assert_eq!(matrix.as_array().unwrap().len(), 1);
    assert_eq!(matrix[0]["warnstufe"], "hoch");
}
```

- [ ] **Step 2: Test laufen lassen (failing)**

Run: `rtk proxy cargo test --test lage_zone`
Expected: FAIL — die neuen Felder werden vom Handler noch nicht akzeptiert/validiert.

- [ ] **Step 3: Handler erweitern (routes/lage_zone.rs)**

Modify `src/routes/lage_zone.rs`:

a) `ZoneBody` um die zwei optionalen Felder erweitern:

```rust
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub gefahrentyp: Option<String>,
    pub schutzobjekt: Option<String>,
}
```

b) In `anlegen` — nach `validiere_neu(&body)?` die Zuordnung prüfen, vor dem `zone_repo::anlegen`-Aufruf:

```rust
    if !lage_zone::gefahren_zuordnung_gueltig(&body.typ, body.gefahrentyp.as_deref(), body.schutzobjekt.as_deref()) {
        return Err(AppError::UnprocessableEntity(
            "Gefahren-Zuordnung nur an gefahrengebiet-Zonen, beide Felder gemeinsam und als gültige Kombination".into(),
        ));
    }
```

c) Den `ZoneNeu`-Aufruf in `anlegen` um die Felder ergänzen:

```rust
        notiz: notiz.as_deref(),
        gefahrentyp: body.gefahrentyp.as_deref(),
        schutzobjekt: body.schutzobjekt.as_deref(),
        erstellt_von: benutzer.id,
```

d) `ZonePatchBody` um Tri-State-Felder ergänzen:

```rust
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub gefahrentyp: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub schutzobjekt: Option<Option<String>>,
}
```

e) In `aktualisieren` — den effektiven Zuordnungs-Zustand gegen den Bestand mergen und validieren (nach der `neuer_typ`-Berechnung, vor `zone_repo::aktualisiere`):

```rust
    // Effektive Zuordnung (Merge gegen Bestand; Memory patch-xor-effektivzustand).
    let eff_gefahrentyp: Option<String> = match &body.gefahrentyp {
        Some(opt) => opt.clone(),
        None => vorher.gefahrentyp.clone(),
    };
    let eff_schutzobjekt: Option<String> = match &body.schutzobjekt {
        Some(opt) => opt.clone(),
        None => vorher.schutzobjekt.clone(),
    };
    if !lage_zone::gefahren_zuordnung_gueltig(&neuer_typ, eff_gefahrentyp.as_deref(), eff_schutzobjekt.as_deref()) {
        return Err(AppError::UnprocessableEntity(
            "Gefahren-Zuordnung nur an gefahrengebiet-Zonen, beide Felder gemeinsam und als gültige Kombination".into(),
        ));
    }
```

f) Den `ZonePatch`-Aufruf in `aktualisieren` um die Felder ergänzen:

```rust
        notiz: body.notiz.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
        gefahrentyp: body.gefahrentyp.as_ref().map(|o| o.as_deref()),
        schutzobjekt: body.schutzobjekt.as_ref().map(|o| o.as_deref()),
```

- [ ] **Step 4: Tests grün**

Run: `rtk proxy cargo test --test lage_zone`
Expected: PASS (bestehende + 4 neue Tests).

- [ ] **Step 5: Backend-Gate**

Run: `rtk proxy cargo test`
Expected: gesamte Suite grün.

- [ ] **Step 6: Commit**

```bash
git add src/routes/lage_zone.rs tests/lage_zone.rs
git commit -m "feat(be): lage_zone POST/PATCH akzeptiert Gefahren-Zuordnung + Tests (LFH-53)"
```

---

### Task 14: Frontend — LageZone-Typ, ZonenInspector, Badge + Styling

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/lagezonen.ts`
- Modify: `frontend/src/pages/lagekarte/ZonenInspector.tsx`
- Modify: `frontend/src/pages/gefahren/GefahrenPage.tsx`
- Modify: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`

- [ ] **Step 1: LageZone-Typ erweitern**

Modify `frontend/src/api/types.ts` — `LageZone` um zwei Felder (nach `notiz`):

```typescript
  notiz: string | null;
  gefahrentyp: Gefahrentyp | null;
  schutzobjekt: Schutzobjekt | null;
  erstellt_von: number;
```

- [ ] **Step 2: ZonePatch/ZoneNeu im Client erweitern**

Modify `frontend/src/api/lagezonen.ts`:

```typescript
export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  gefahrentyp?: Gefahrentyp | null;
  schutzobjekt?: Schutzobjekt | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  gefahrentyp?: Gefahrentyp | null;
  schutzobjekt?: Schutzobjekt | null;
}
```

Import oben ergänzen:

```typescript
import type { Gefahrentyp, LageZone, Schutzobjekt, ZoneTyp } from './types';
```

- [ ] **Step 3: ZonenInspector — Gefahren-Zuordnung bei gefahrengebiet**

Modify `frontend/src/pages/lagekarte/ZonenInspector.tsx`:

a) `onAendern`-Prop-Typ um die zwei Felder erweitern:

```typescript
  onAendern: (patch: {
    typ?: ZoneTyp;
    label?: string | null;
    farbe?: string | null;
    notiz?: string | null;
    gefahrentyp?: Gefahrentyp | null;
    schutzobjekt?: Schutzobjekt | null;
  }) => void;
```

b) Imports ergänzen:

```typescript
import type { Gefahrentyp, LageZone, Schutzobjekt, ZoneTyp } from '../../api/types';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, kombinationGueltig } from '../gefahren/gefahrenSchema';
```

c) Innerhalb des `Space`-Blocks (nach dem Typ-Select, vor/nach dem `freie_skizze`-Farbblock) den Gefahren-Block ergänzen:

```typescript
        {zone.typ === 'gefahrengebiet' && (
          <>
            <Select<Gefahrentyp>
              aria-label="Gefahrentyp"
              allowClear
              placeholder="Gefahrentyp"
              style={{ width: '100%' }}
              value={zone.gefahrentyp ?? undefined}
              disabled={!darfSchreiben}
              options={GEFAHRENTYPEN.map((g) => ({ value: g.wert, label: g.label }))}
              onChange={(v) => {
                // Beim Leeren beide Felder nullen (beide-oder-keine).
                if (!v) onAendern({ gefahrentyp: null, schutzobjekt: null });
                else onAendern({ gefahrentyp: v });
              }}
            />
            <Select<Schutzobjekt>
              aria-label="Schutzobjekt"
              allowClear
              placeholder="Schutzobjekt"
              style={{ width: '100%' }}
              value={zone.schutzobjekt ?? undefined}
              disabled={!darfSchreiben || !zone.gefahrentyp}
              options={SCHUTZOBJEKTE.map((o) => ({
                value: o.wert,
                label: o.label,
                disabled: zone.gefahrentyp ? !kombinationGueltig(zone.gefahrentyp, o.wert) : true,
              }))}
              onChange={(v) => {
                if (!v) onAendern({ gefahrentyp: null, schutzobjekt: null });
                else onAendern({ schutzobjekt: v });
              }}
            />
          </>
        )}
```

- [ ] **Step 4: Badge — Zonen-Anzahl je Matrix-Zelle (GefahrenPage)**

Modify `frontend/src/pages/gefahren/GefahrenPage.tsx`:

a) Imports ergänzen (`Badge`, `Tooltip` aus antd; `listeZonen`):

```typescript
import { Alert, App, Badge, Select, Spin, Table, Tooltip } from 'antd';
import { listeZonen } from '../../api/lagezonen';
```

b) Query ergänzen:

```typescript
  const zonenQuery = useQuery({ queryKey: ['einsatz-zonen', einsatzId], queryFn: () => listeZonen(einsatzId) });
```

c) Zähl-Helfer vor `spalten`:

```typescript
  const zonen = zonenQuery.data ?? [];
  const zonenAnzahl = (typ: Gefahrentyp, objekt: Schutzobjekt): number =>
    zonen.filter((z) => z.gefahrentyp === typ && z.schutzobjekt === objekt).length;
```

d) Im Zell-`render` den Badge ergänzen (Select in einen Wrapper packen):

```typescript
        const anzahl = zonenAnzahl(zeile.typ, obj.wert);
        return (
          <Tooltip title={anzahl > 0 ? `${anzahl} verknüpfte Zone(n) auf der Lagekarte` : undefined}>
            <Badge count={anzahl} size="small" offset={[-4, 2]}>
              <Select<Warnstufe>
                aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
                size="small"
                style={{ width: 110, backgroundColor: warnstufeFarbe(aktuell) }}
                value={aktuell}
                disabled={!gueltig || !darfSchreiben || setzen.isPending}
                options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
                onChange={(w) => setzen.mutate({ typ: zeile.typ, objekt: obj.wert, warnstufe: w })}
              />
            </Badge>
          </Tooltip>
        );
```

- [ ] **Step 5: Badge-Test ergänzen**

Modify `frontend/src/pages/gefahren/GefahrenPage.test.tsx`:

a) Den `handlers`-Helper um den Zonen-Endpunkt erweitern:

```typescript
function handlers(rolle = 'einsatzleitung', status = 'aktiv', matrix: unknown[] = [], zonen: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/gefahrenmatrix', () => HttpResponse.json(matrix)),
    http.get('/api/einsaetze/1/zonen', () => HttpResponse.json(zonen)),
  ];
}
```

b) Neuen Test:

```typescript
  it('zeigt die Anzahl verknüpfter Zonen als Badge', async () => {
    const zone = {
      id: 9, einsatz_id: 1, typ: 'gefahrengebiet', geometrie_typ: 'Polygon', geometrie: '{}',
      label: null, farbe: null, notiz: null, gefahrentyp: 'brand', schutzobjekt: 'menschen',
      erstellt_von: 1, erstellt_at: '', geaendert_at: '',
    };
    server.use(...handlers('einsatzleitung', 'aktiv', [], [zone]));
    renderPage();
    // Badge-Count „1" erscheint an der Zelle brand × menschen.
    expect(await screen.findByText('1')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Typecheck + volle Suite + Build**

Run: `cd frontend && pnpm tsc --noEmit && pnpm vitest run --no-file-parallelism && pnpm build`
Expected: PASS. Falls bestehende `ZonenInspector`-Tests die `onAendern`-Signatur prüfen: dort die neuen optionalen Felder sind rückwärtskompatibel (alle optional) — keine Anpassung nötig.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/lagezonen.ts frontend/src/pages/lagekarte/ZonenInspector.tsx frontend/src/pages/gefahren/GefahrenPage.tsx frontend/src/pages/gefahren/GefahrenPage.test.tsx
git commit -m "feat(fe): Zonen-Gefahren-Zuordnung im Inspector + Zonen-Badge in der Matrix (LFH-53)"
```

---

## Abschluss (nach allen Phasen)

- [ ] **Volles Gate Backend:** `rtk proxy cargo test` grün.
- [ ] **Volles Gate Frontend:** `cd frontend && pnpm vitest run --no-file-parallelism` grün + `pnpm build` erfolgreich.
- [ ] **Manuelle Sichtprüfung** (Frontend ist ins Binary eingebettet — `pnpm build` + Backend-Neustart, Memory `frontend-in-binary-eingebettet`): Modul „Gefahren" erscheint in der Lage-Kategorie, das 13×5-Raster rendert, eine Warnstufe lässt sich setzen (Live-Update + ETB-Eintrag), ungültige Zellen sind ausgegraut, eine gefahrengebiet-Zone im Karten-Inspector nimmt Gefahrentyp+Schutzobjekt an, der Badge zählt verknüpfte Zonen.
- [ ] **Code-Review** vor dem Merge (`superpowers:requesting-code-review`) → ClickUp-Status `in review`.

---

## Selbst-Review (gegen die Spec geprüft)

- **Datenmodell 0037→0039, 0038→0040:** Migrationsnummern korrigiert (Original-Nummern belegt). ✓
- **gefahr_bewertung, CHECKs je Spalte, UNIQUE, CASCADE, Index:** Task 1. ✓
- **mod.rs Kataloge + kombination_gueltig + Labels:** Task 2. ✓
- **repo liste/upsert/lazy_create + warnstufe='keine'-Semantik:** Task 3 (liste filtert keine, upsert ohne Delete, lazy_create ON CONFLICT DO NOTHING). ✓
- **Routen GET/PUT/SSE, ETB nur bei Warnstufenwechsel, Berechtigung, Live-Kanal `gefahr`:** Task 4. ✓
- **tests/gefahr.rs (leer/upsert, keine, 422 Enum+Kombination, ETB-Wechsel/kein-ETB, SSE, Berechtigung, Org-Isolation):** Task 5. ✓
- **Frontend Typen, Schema (eine Wahrheit + Test), API-Client, GefahrenPage (Raster/Dropdown/Farbe/ungültig disabled), Registry-Umbau, Routing, Live-Invalidierung:** Tasks 6–10. ✓
- **Zonen-Verknüpfung: Migration, mod.rs-Validierung, repo-Felder+Lazy-Create, Routen POST/PATCH, lage_zone-Tests, Inspector, warnstufenabgeleitetes/Badge-Styling:** Tasks 11–14. ✓
- **Verschiebungen ggü. Spec:** `verweistAuf` existiert nicht (Registry real umgebaut); Zonen-Badge in Phase 3 statt Phase 2 (Datenabhängigkeit); `/gefahrenmatrix/stream` gebaut, aber SPA nutzt `/etb/stream`. Alle dokumentiert. ✓
- **Bewusst NICHT enthalten (Gefährdungsbeurteilung, Circle-Geometrie, Composite-FK, Zonen-Migration):** nicht eingeplant. ✓

**Offene Hinweise für die Umsetzung:**
- Warnstufenabgeleitetes *Zonen*-Styling auf der Karte (Spec: „Warnstufe aus der Matrix") ist in Task 14 auf die Inspector-Zuordnung + Matrix-Badge reduziert; ein farbliches Re-Styling der Zonen-Polygone nach Warnstufe ist nicht enthalten (würde die Matrix-Query in die Lagekarte ziehen). Falls gewünscht, als Folge-Task der Lagekarte aufnehmen — nicht Teil dieses Plans.
