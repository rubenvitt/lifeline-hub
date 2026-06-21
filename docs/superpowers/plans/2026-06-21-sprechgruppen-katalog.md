# Sprechgruppen-Katalog (LFH-109) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-weiter Sprechgruppen-Katalog (Stammdaten) + einsatz-lokal anlegbare Sprechgruppen, per Mehrfachauswahl (M:N) an Einsatzabschnitt und Einsatz-Einheit zuordenbar; LFH-86-Freitextwerte werden verlustfrei ins Join-Modell migriert.

**Architecture:** Eine Tabelle `sprechgruppe` (Scope über `einsatz_id`: NULL = Org-Katalog, gesetzt = einsatz-lokal) + zwei Join-Tabellen. Backend = Rust/axum/sqlx (Modul `src/sprechgruppe/` analog `src/fahrzeug/`; Katalog-Routen analog `src/routes/einheit_typ.rs`). Frontend = React/antd/TanStack-Query (Stammdaten-Tab analog Fahrzeug; wiederverwendbarer `SprechgruppenPicker`).

**Tech Stack:** Rust (axum, sqlx-sqlite), React + TypeScript + antd v5 + @tanstack/react-query, vitest + Testing Library.

## Global Constraints

- Org-Scoping in **jeder** Query (`WHERE org_id = ?`); fremde Org → `AppError::NotFound` (keine Enumeration). Quelle: `src/fahrzeug/repo.rs`.
- Katalog-Schreiben nur `AdminUser`; Lesen `CurrentUser`; einsatz-lokales Anlegen jeder `CurrentUser` mit Schreibrecht am Einsatz.
- `betriebsart` ∈ `{'TMO','DMO'}` (DB-CHECK + String-Konstanten in `src/katalog.rs`, Muster `DIENSTSTATUS_*`).
- Soft-Delete (`aktiv=0`) für Katalog; nie Hard-Delete. Einsatz-lokale Einträge cascaden mit dem Einsatz.
- Alt-Spalten `einsatzabschnitt.sprechgruppe_tmo`/`_dmo` bleiben unangetastet (read-only Reserve); Formular schreibt sie nicht mehr.
- Migrations-Nummer: **0073** (höchste vorhandene = 0072).
- Rust-Tests: `crate::db::test_pool().await` (führt alle Migrations aus). Frontend-Gate: `pnpm test --no-file-parallelism` (Suite unter Last sonst flaky); pnpm läuft über `mise exec`.
- Commits referenzieren `LFH-109`; jede Task endet mit Commit.

---

## File Structure

**Neu (Backend):**
- `src/sprechgruppe/mod.rs` — Domain `Sprechgruppe` (FromRow) + `SprechgruppeAnzeige` (Serialize).
- `src/sprechgruppe/repo.rs` — Katalog-CRUD, einsatz-lokal, Join-Helfer.
- `src/routes/sprechgruppe.rs` — HTTP-Handler.
- `migrations/0073_sprechgruppe.sql` — Schema + Daten-Migration.

**Modifiziert (Backend):**
- `src/katalog.rs` — `BETRIEBSART_TMO/DMO` + `ist_gueltige_betriebsart`.
- `src/lib.rs` (oder `src/main.rs`, wo Module deklariert sind) — `pub mod sprechgruppe;`.
- `src/routes/mod.rs` — `pub mod sprechgruppe;`.
- `src/app.rs` — Routen registrieren.
- `src/einsatzabschnitt/mod.rs` — `EinsatzabschnittAnzeige` um `sprechgruppen: Vec<SprechgruppeAnzeige>`.
- `src/einsatzabschnitt/repo.rs` — Anzeige um Sprechgruppen befüllen; Join setzen.
- `src/routes/einsatzabschnitt.rs` — `AbschnittBody.sprechgruppe_ids`, Join persistieren.
- `src/einsatz_einheit/…` (Modul der Einsatz-Einheit) + `src/routes/einsatz_einheit.rs` — analog.

**Neu (Frontend):**
- `frontend/src/api/sprechgruppen.ts` — API-Client.
- `frontend/src/stammdaten/SprechgruppenTab.tsx`, `SprechgruppeFormModal.tsx`.
- `frontend/src/components/SprechgruppenPicker.tsx` — wiederverwendbarer Picker.

**Modifiziert (Frontend):**
- `frontend/src/api/types.ts` — `Sprechgruppe`, `SprechgruppeEingabe`, `Betriebsart`.
- `frontend/src/pages/StammdatenPage.tsx` — Tab registrieren.
- `frontend/src/pages/EinsatzabschnittePage.tsx` — Inputs → Picker.
- `frontend/src/pages/EinheitenPage.tsx` — Picker ergänzen.
- `frontend/src/api/einsatzabschnitte.ts`, `frontend/src/api/einheiten.ts` — `sprechgruppe_ids` in Eingabe-Typ + `sprechgruppen` in Anzeige-Typ.

---

## Task 1: Migration `0073_sprechgruppe.sql`

**Files:**
- Create: `migrations/0073_sprechgruppe.sql`
- Test: `src/sprechgruppe/repo.rs` (Migrations-/Daten-Test, kommt in Task 4 hinzu; hier nur Schema)

**Interfaces:**
- Produces: Tabellen `sprechgruppe`, `einsatzabschnitt_sprechgruppe`, `einsatz_einheit_sprechgruppe`.

- [ ] **Step 1: Migration schreiben**

```sql
-- LFH-109: Sprechgruppen-Katalog (Stammdaten) + einsatz-lokale Sprechgruppen.
-- Scope über einsatz_id: NULL = org-weiter Katalog, gesetzt = einsatz-lokal.
-- M:N-Zuordnung an Einsatzabschnitt und Einsatz-Einheit. Migriert die LFH-86-
-- Freitextwerte (einsatzabschnitt.sprechgruppe_tmo/_dmo, aus 0047) ins Join-Modell;
-- die Alt-Spalten bleiben als read-only Reserve unangetastet.
CREATE TABLE sprechgruppe (
    id          INTEGER PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organisation(id),
    einsatz_id  INTEGER REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung TEXT NOT NULL,
    betriebsart TEXT NOT NULL CHECK (betriebsart IN ('TMO','DMO')),
    hinweis     TEXT,
    aktiv       INTEGER NOT NULL DEFAULT 1,
    sortier     INTEGER NOT NULL DEFAULT 0,
    angelegt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_sprechgruppe_katalog
    ON sprechgruppe(org_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NULL AND aktiv = 1;
CREATE UNIQUE INDEX idx_sprechgruppe_einsatz_lokal
    ON sprechgruppe(einsatz_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NOT NULL;
CREATE INDEX idx_sprechgruppe_org     ON sprechgruppe(org_id);
CREATE INDEX idx_sprechgruppe_einsatz ON sprechgruppe(einsatz_id);

CREATE TABLE einsatzabschnitt_sprechgruppe (
    abschnitt_id    INTEGER NOT NULL REFERENCES einsatzabschnitt(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)     ON DELETE CASCADE,
    PRIMARY KEY (abschnitt_id, sprechgruppe_id)
);
CREATE TABLE einsatz_einheit_sprechgruppe (
    einheit_id      INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)    ON DELETE CASCADE,
    PRIMARY KEY (einheit_id, sprechgruppe_id)
);

-- Daten-Migration LFH-86 → einsatz-lokal + Join (TMO).
INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart)
SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_tmo), 'TMO'
FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';
INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id)
SELECT ea.id, sg.id FROM einsatzabschnitt ea
JOIN sprechgruppe sg ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'TMO'
                    AND sg.bezeichnung = trim(ea.sprechgruppe_tmo)
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';

-- Daten-Migration LFH-86 → einsatz-lokal + Join (DMO).
INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart)
SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_dmo), 'DMO'
FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id
WHERE ea.sprechgruppe_dmo IS NOT NULL AND trim(ea.sprechgruppe_dmo) <> '';
INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id)
SELECT ea.id, sg.id FROM einsatzabschnitt ea
JOIN sprechgruppe sg ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'DMO'
                    AND sg.bezeichnung = trim(ea.sprechgruppe_dmo)
WHERE ea.sprechgruppe_dmo IS NOT NULL AND trim(ea.sprechgruppe_dmo) <> '';
```

- [ ] **Step 2: Migration lädt sauber** — `cargo test --lib db::` (oder ein bestehender Test, der `test_pool()` nutzt). Erwartet: PASS (alle Migrations inkl. 0073 anwendbar).

- [ ] **Step 3: Commit** — `git add migrations/0073_sprechgruppe.sql && git commit -m "feat(sprechgruppe): Migration 0073 — Katalog + Joins + LFH-86-Datenmigration (LFH-109)"`

---

## Task 2: `betriebsart`-Konstanten in `src/katalog.rs`

**Files:**
- Modify: `src/katalog.rs` (Muster `DIENSTSTATUS_*` in Zeile 6–7; `ist_gueltige_kategorie` als Vorlage)

**Interfaces:**
- Produces: `pub const BETRIEBSART_TMO: &str = "TMO"`, `pub const BETRIEBSART_DMO: &str = "DMO"`, `pub fn ist_gueltige_betriebsart(s: &str) -> bool`.

- [ ] **Step 1: Failing test** (in `src/katalog.rs` `#[cfg(test)]`, analog zu vorhandenen Tests dort)

```rust
#[test]
fn betriebsart_validierung() {
    assert!(ist_gueltige_betriebsart("TMO"));
    assert!(ist_gueltige_betriebsart("DMO"));
    assert!(!ist_gueltige_betriebsart("FOO"));
    assert!(!ist_gueltige_betriebsart("tmo"));
}
```

- [ ] **Step 2: Run, expect FAIL** — `cargo test --lib katalog::tests::betriebsart_validierung` → FAIL (Funktion fehlt).
- [ ] **Step 3: Implementieren**

```rust
pub const BETRIEBSART_TMO: &str = "TMO";
pub const BETRIEBSART_DMO: &str = "DMO";

/// Gültige Betriebsart einer Sprechgruppe (TETRA: TMO = Netz, DMO = Direkt).
pub fn ist_gueltige_betriebsart(s: &str) -> bool {
    matches!(s, BETRIEBSART_TMO | BETRIEBSART_DMO)
}
```

- [ ] **Step 4: Run, expect PASS** — `cargo test --lib katalog::tests::betriebsart_validierung` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Betriebsart-Konstanten + Validierung (LFH-109)"`

---

## Task 3: Domain `src/sprechgruppe/mod.rs`

**Files:**
- Create: `src/sprechgruppe/mod.rs`
- Modify: Modul-Deklaration (`src/lib.rs`/`src/main.rs`: `pub mod sprechgruppe;` — Stelle analog zu `pub mod fahrzeug;` suchen)

**Interfaces:**
- Produces:
  - `struct Sprechgruppe { id, org_id, einsatz_id: Option<i64>, bezeichnung, betriebsart, hinweis: Option<String>, aktiv: bool, sortier: i64, angelegt_at }` (`sqlx::FromRow`, `Clone`, `Debug`).
  - `struct SprechgruppeAnzeige { id, einsatz_id: Option<i64>, einsatz_lokal: bool, bezeichnung, betriebsart, hinweis: Option<String>, aktiv: bool, sortier }` (`Serialize`, `Clone`, `Debug`, `PartialEq`).
  - `fn Sprechgruppe::anzeige(&self) -> SprechgruppeAnzeige` (setzt `einsatz_lokal = einsatz_id.is_some()`).
- Consumes: nichts.

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn sg(einsatz_id: Option<i64>) -> Sprechgruppe {
        Sprechgruppe {
            id: 1, org_id: 1, einsatz_id, bezeichnung: "412_F_DRK".into(),
            betriebsart: "TMO".into(), hinweis: None, aktiv: true, sortier: 0,
            angelegt_at: "2026-06-21 10:00:00".into(),
        }
    }
    #[test]
    fn anzeige_markiert_einsatz_lokal() {
        assert!(!sg(None).anzeige().einsatz_lokal, "Katalog ist nicht lokal");
        assert!(sg(Some(7)).anzeige().einsatz_lokal, "mit einsatz_id = lokal");
        assert_eq!(sg(None).anzeige().bezeichnung, "412_F_DRK");
    }
}
```

- [ ] **Step 2: Run, expect FAIL** — `cargo test --lib sprechgruppe::tests::anzeige_markiert_einsatz_lokal` → FAIL.
- [ ] **Step 3: Implementieren** — Structs wie oben + `pub mod repo;` am Dateikopf; `anzeige()` wie in `src/fahrzeug/mod.rs:65`. `aktiv`/`einsatz_lokal` als `bool` (sqlx mappt INTEGER 0/1 → bool, vgl. `Fahrzeug.sondersignal`). Modul in `src/lib.rs`/`src/main.rs` deklarieren.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Domain-Typen Sprechgruppe/Anzeige (LFH-109)"`

---

## Task 4: Repo — Katalog-CRUD `src/sprechgruppe/repo.rs`

**Files:**
- Create: `src/sprechgruppe/repo.rs` (Muster: `src/fahrzeug/repo.rs` — `SPALTEN`-Konstante, `laden`, `liste`, `anlegen`, Conflict-Mapping, Test-Setup `org()`)

**Interfaces:**
- Produces:
  - `struct KatalogDaten<'a> { bezeichnung: &'a str, betriebsart: &'a str, hinweis: Option<&'a str>, sortier: i64 }`
  - `async fn laden(pool, org_id, id) -> Result<Sprechgruppe, AppError>` (org-scoped, NotFound).
  - `async fn liste_katalog(pool, org_id, nur_aktive: bool) -> Result<Vec<Sprechgruppe>, AppError>` (`einsatz_id IS NULL`, sortiert nach `betriebsart, sortier, bezeichnung`).
  - `async fn anlegen_katalog(pool, org_id, KatalogDaten) -> Result<Sprechgruppe, AppError>` (Dublette → `Conflict`).
  - `async fn aktualisiere_katalog(pool, org_id, id, KatalogDaten) -> Result<Sprechgruppe, AppError>` (Vollersatz; NotFound/Conflict).
  - `async fn deaktiviere(pool, org_id, id) -> Result<(), AppError>` (`UPDATE … SET aktiv=0 WHERE id=? AND org_id=? AND einsatz_id IS NULL`; rows_affected==0 → NotFound).

- [ ] **Step 1: Failing tests** (Test-Setup `org(pool, id)` wie `src/fahrzeug/repo.rs:217`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }
    fn daten<'a>(bez: &'a str, ba: &'a str) -> KatalogDaten<'a> {
        KatalogDaten { bezeichnung: bez, betriebsart: ba, hinweis: None, sortier: 0 }
    }
    #[tokio::test]
    async fn anlegen_listen_und_laden() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert_eq!(sg.einsatz_id, None);
        assert_eq!(liste_katalog(&pool, 1, true).await.unwrap().len(), 1);
        assert_eq!(laden(&pool, 1, sg.id).await.unwrap().bezeichnung, "412_F_DRK");
    }
    #[tokio::test]
    async fn dublette_im_katalog_ist_conflict() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert!(matches!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap_err(), AppError::Conflict(_)));
        // gleiche Bezeichnung, andere Betriebsart → erlaubt
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "DMO")).await.is_ok());
    }
    #[tokio::test]
    async fn katalog_je_org_isoliert() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await; org(&pool, 2).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        assert!(matches!(laden(&pool, 2, sg.id).await.unwrap_err(), AppError::NotFound));
        assert!(liste_katalog(&pool, 2, true).await.unwrap().is_empty());
    }
    #[tokio::test]
    async fn deaktivieren_versteckt_aus_nur_aktive() {
        let pool = crate::db::test_pool().await; org(&pool, 1).await;
        let sg = anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.unwrap();
        deaktiviere(&pool, 1, sg.id).await.unwrap();
        assert!(liste_katalog(&pool, 1, true).await.unwrap().is_empty());
        assert_eq!(liste_katalog(&pool, 1, false).await.unwrap().len(), 1);
        // Nach Deaktivierung ist die gleiche Bezeichnung neu anlegbar (Partial-Index nur aktiv).
        assert!(anlegen_katalog(&pool, 1, daten("412_F_DRK", "TMO")).await.is_ok());
    }
}
```

- [ ] **Step 2: Run, expect FAIL** — `cargo test --lib sprechgruppe::repo::tests` → FAIL.
- [ ] **Step 3: Implementieren** — Funktionen wie in den Interfaces; Conflict-Mapping per `is_unique_violation()` (Vorlage `funkrufname_conflict`, `src/fahrzeug/repo.rs:37`). `SPALTEN`-Konstante mit allen `sprechgruppe`-Spalten in `Sprechgruppe`-FromRow-Reihenfolge.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Repo Katalog-CRUD + Soft-Delete (LFH-109)"`

---

## Task 5: Repo — einsatz-lokal + Auswahlmenge

**Files:**
- Modify: `src/sprechgruppe/repo.rs`

**Interfaces:**
- Produces:
  - `async fn anlegen_einsatz_lokal(pool, org_id, einsatz_id, bezeichnung: &str, betriebsart: &str, hinweis: Option<&str>) -> Result<Sprechgruppe, AppError>` — idempotent: bei vorhandener (einsatz_id, betriebsart, bezeichnung) den Bestand laden statt Fehler (z. B. `INSERT … ON CONFLICT DO NOTHING` + anschließendes SELECT, oder Conflict abfangen → SELECT).
  - `async fn liste_fuer_einsatz(pool, org_id, einsatz_id) -> Result<Vec<Sprechgruppe>, AppError>` — aktiver Katalog (`einsatz_id IS NULL AND aktiv=1`) **plus** einsatz-lokale dieses Einsatzes, sortiert `betriebsart, sortier, bezeichnung`.

- [ ] **Step 1: Failing tests**

```rust
#[tokio::test]
async fn einsatz_lokal_anlegen_ist_idempotent() {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1,'Orga')").execute(&pool).await.unwrap();
    let e: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id").fetch_one(&pool).await.unwrap();
    let a = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None).await.unwrap();
    let b = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None).await.unwrap();
    assert_eq!(a.id, b.id, "kein Duplikat, gleicher Eintrag");
    assert_eq!(a.einsatz_id, Some(e));
}
#[tokio::test]
async fn liste_fuer_einsatz_vereint_katalog_und_lokal() {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1,'Orga')").execute(&pool).await.unwrap();
    let e: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id").fetch_one(&pool).await.unwrap();
    let kat = anlegen_katalog(&pool, 1, KatalogDaten{bezeichnung:"412_F_DRK",betriebsart:"TMO",hinweis:None,sortier:0}).await.unwrap();
    deaktiviere(&pool, 1, anlegen_katalog(&pool, 1, KatalogDaten{bezeichnung:"alt",betriebsart:"TMO",hinweis:None,sortier:0}).await.unwrap().id).await.unwrap();
    let lokal = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None).await.unwrap();
    let ids: Vec<i64> = liste_fuer_einsatz(&pool, 1, e).await.unwrap().into_iter().map(|s| s.id).collect();
    assert!(ids.contains(&kat.id) && ids.contains(&lokal.id));
    assert_eq!(ids.len(), 2, "inaktiver Katalogeintrag nicht enthalten");
}
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): einsatz-lokales Anlegen + Auswahlmenge je Einsatz (LFH-109)"`

---

## Task 6: Repo — Join-Helfer (Abschnitt & Einheit)

**Files:**
- Modify: `src/sprechgruppe/repo.rs`

**Interfaces:**
- Produces:
  - `async fn setze_abschnitt_sprechgruppen(pool, org_id, einsatz_id, abschnitt_id, ids: &[i64]) -> Result<(), AppError>` — validiert jede id (gehört zu `org_id` als Katalog [`einsatz_id IS NULL`] **oder** ist einsatz-lokal mit `einsatz_id = einsatz_id`); sonst `AppError::UnprocessableEntity`. Ersetzt Join in einer Transaktion (DELETE alle für `abschnitt_id`, dann INSERT).
  - `async fn lade_abschnitt_sprechgruppen(pool, abschnitt_id) -> Result<Vec<Sprechgruppe>, AppError>` — sortiert `betriebsart, sortier, bezeichnung`.
  - `async fn setze_einheit_sprechgruppen(pool, org_id, einsatz_id, einheit_id, ids: &[i64]) -> Result<(), AppError>` — analog mit `einsatz_einheit_sprechgruppe`.
  - `async fn lade_einheit_sprechgruppen(pool, einheit_id) -> Result<Vec<Sprechgruppe>, AppError>`.
- Hilfsvalidierung intern: `async fn pruefe_zuordenbar(pool, org_id, einsatz_id, ids) -> Result<(), AppError>` (Count-Abgleich: jede id muss `SELECT 1 FROM sprechgruppe WHERE id=? AND org_id=? AND (einsatz_id IS NULL OR einsatz_id=?)` treffen).

- [ ] **Step 1: Failing tests**

```rust
async fn setup_einsatz_abschnitt(pool: &SqlitePool) -> (i64, i64) {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1,'Orga')").execute(pool).await.unwrap();
    let e: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id").fetch_one(pool).await.unwrap();
    let a: i64 = sqlx::query_scalar("INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id").bind(e).fetch_one(pool).await.unwrap();
    (e, a)
}
#[tokio::test]
async fn setze_und_lade_abschnitt_sprechgruppen() {
    let pool = crate::db::test_pool().await;
    let (e, a) = setup_einsatz_abschnitt(&pool).await;
    let kat = anlegen_katalog(&pool, 1, KatalogDaten{bezeichnung:"412_F_DRK",betriebsart:"TMO",hinweis:None,sortier:0}).await.unwrap();
    let lokal = anlegen_einsatz_lokal(&pool, 1, e, "Sonder 1", "DMO", None).await.unwrap();
    setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[kat.id, lokal.id]).await.unwrap();
    assert_eq!(lade_abschnitt_sprechgruppen(&pool, a).await.unwrap().len(), 2);
    // Ersetzen: nur noch eine.
    setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[kat.id]).await.unwrap();
    let nach = lade_abschnitt_sprechgruppen(&pool, a).await.unwrap();
    assert_eq!(nach.len(), 1);
    assert_eq!(nach[0].id, kat.id);
}
#[tokio::test]
async fn fremde_oder_anderer_einsatz_sprechgruppe_ist_unprocessable() {
    let pool = crate::db::test_pool().await;
    let (e, a) = setup_einsatz_abschnitt(&pool).await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (2,'Fremd')").execute(&pool).await.unwrap();
    let fremd = anlegen_katalog(&pool, 2, KatalogDaten{bezeichnung:"X",betriebsart:"TMO",hinweis:None,sortier:0}).await.unwrap();
    let anderer_einsatz: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Andere') RETURNING id").fetch_one(&pool).await.unwrap();
    let lokal_woanders = anlegen_einsatz_lokal(&pool, 1, anderer_einsatz, "Sonder 9", "DMO", None).await.unwrap();
    assert!(matches!(setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[fremd.id]).await.unwrap_err(), AppError::UnprocessableEntity(_)));
    assert!(matches!(setze_abschnitt_sprechgruppen(&pool, 1, e, a, &[lokal_woanders.id]).await.unwrap_err(), AppError::UnprocessableEntity(_)));
}
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** (Transaktion via `pool.begin()`, Muster `loese_auf` in `src/einsatzabschnitt/repo.rs:229`). Einheit-Helfer + ein analoger Test `setze_und_lade_einheit_sprechgruppen` (Einheit via `INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Zug')`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Join-Helfer für Abschnitt & Einheit mit Org/Einsatz-Validierung (LFH-109)"`

---

## Task 7: Routen `src/routes/sprechgruppe.rs`

**Files:**
- Create: `src/routes/sprechgruppe.rs` (Muster: `src/routes/einheit_typ.rs` — `Body`, `normalisiere`, Handler; für Einsatz-Endpunkte Auth-Muster aus `src/routes/einsatzabschnitt.rs`: `einsatz_repo::laden` + `rolle_von` + `fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv`)
- Modify: `src/routes/mod.rs` (`pub mod sprechgruppe;`), `src/app.rs` (Routen)

**Interfaces:**
- Consumes: `sprechgruppe::repo`, `crate::auth::session::{AdminUser, CurrentUser}`, `crate::einsatz::repo`, `crate::einsatz::berechtigung::*`, `crate::katalog::ist_gueltige_betriebsart`.
- Produces Handler:
  - `liste_katalog(State, CurrentUser, Query{nur_aktive: Option<bool>}) -> Json<Vec<SprechgruppeAnzeige>>` → GET `/api/sprechgruppen`
  - `anlegen(State, AdminUser, Json<KatalogBody>) -> (CREATED, Json<SprechgruppeAnzeige>)` → POST `/api/sprechgruppen`
  - `aktualisieren(State, AdminUser, Path<i64>, Json<KatalogBody>) -> Json<SprechgruppeAnzeige>` → PATCH `/api/sprechgruppen/{id}`
  - `deaktivieren(State, AdminUser, Path<i64>) -> StatusCode` → POST `/api/sprechgruppen/{id}/deaktivieren`
  - `liste_fuer_einsatz(State, CurrentUser, Path<i64>) -> Json<Vec<SprechgruppeAnzeige>>` → GET `/api/einsaetze/{id}/sprechgruppen`
  - `anlegen_einsatz_lokal(State, CurrentUser, Path<i64>, Json<EinsatzLokalBody>) -> (CREATED, Json<SprechgruppeAnzeige>)` → POST `/api/einsaetze/{id}/sprechgruppen`
- `struct KatalogBody { bezeichnung: String, betriebsart: String, hinweis: Option<String>, #[serde(default)] sortier: i64 }`
- `struct EinsatzLokalBody { bezeichnung: String, betriebsart: String, hinweis: Option<String> }`
- `normalisiere(body) -> Result<…, AppError>`: trimmt `bezeichnung` (leer → `Validation`), prüft `ist_gueltige_betriebsart` (sonst `Validation`), trimmt `hinweis`.

- [ ] **Step 1: Failing test** (Route-Test-Stil wie `einheit_typ.rs:105` — `normalisiere` unit-testen)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalisiere_leere_bezeichnung_ist_validation() {
        let b = KatalogBody { bezeichnung: "  ".into(), betriebsart: "TMO".into(), hinweis: None, sortier: 0 };
        assert!(matches!(normalisiere_katalog(b).unwrap_err(), AppError::Validation(_)));
    }
    #[test]
    fn normalisiere_ungueltige_betriebsart_ist_validation() {
        let b = KatalogBody { bezeichnung: "412".into(), betriebsart: "XX".into(), hinweis: None, sortier: 0 };
        assert!(matches!(normalisiere_katalog(b).unwrap_err(), AppError::Validation(_)));
    }
    #[test]
    fn normalisiere_ok_trimmt() {
        let b = KatalogBody { bezeichnung: " 412 ".into(), betriebsart: "TMO".into(), hinweis: Some("  ".into()), sortier: 0 };
        let n = normalisiere_katalog(b).unwrap();
        assert_eq!(n.bezeichnung, "412");
        assert_eq!(n.hinweis, None);
    }
}
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** — Handler + `normalisiere_katalog`/`normalisiere_lokal`. Einsatz-Endpunkte: `einsatz_repo::laden` + `rolle_von`, GET → `fordere_lesezugriff`, POST → `fordere_schreibrecht` + `fordere_aktiv` (kein Modul-Key — Sprechgruppen sind modulübergreifende Hilfsdaten). Routen in `src/app.rs` neben den `/api/einheit-typen`-Zeilen registrieren (`src/app.rs:308–317`).
- [ ] **Step 4: Run, expect PASS** — `cargo test --lib routes::sprechgruppe`.
- [ ] **Step 5: `cargo build` grün** (Routen kompilieren, `frontend/dist`-Platzhalter siehe Task 0/Setup).
- [ ] **Step 6: Commit** — `git commit -am "feat(sprechgruppe): HTTP-Routen Katalog + einsatz-lokal (LFH-109)"`

---

## Task 8: Einsatzabschnitt-Zuordnung anbinden

**Files:**
- Modify: `src/einsatzabschnitt/mod.rs` (Anzeige), `src/einsatzabschnitt/repo.rs` (Anzeige befüllen), `src/routes/einsatzabschnitt.rs` (`AbschnittBody.sprechgruppe_ids`, Join setzen)

**Interfaces:**
- `EinsatzabschnittAnzeige` erhält `pub sprechgruppen: Vec<SprechgruppeAnzeige>` (Serialize).
- `AbschnittBody` erhält `pub sprechgruppe_ids: Option<Vec<i64>>` (None = unverändert lassen; Some = ersetzen).
- Im Handler `anlegen`/`aktualisieren`: nach `abschnitt_repo::anlegen/aktualisiere` und vorhandener Auth, falls `sprechgruppe_ids` `Some`, `sprechgruppe::repo::setze_abschnitt_sprechgruppen(&pool, einsatz.org_id, einsatz_id, anzeige.id, &ids)` aufrufen, dann Anzeige neu laden (`abschnitt_repo::laden`) zurückgeben.
- `abschnitt_repo`: in `zu_anzeige`/`laden`/`liste` die `sprechgruppen` befüllen (separater Query `lade_abschnitt_sprechgruppen` pro Zeile genügt; bei `liste` Map über die Abschnitte). Initial leeres `Vec` in den Bestands-Tests ist ok.

- [ ] **Step 1: Failing test** (in `src/einsatzabschnitt/repo.rs` tests; bestehender `funk_felder_anlegen_und_aktualisieren` bleibt unverändert grün)

```rust
#[tokio::test]
async fn abschnitt_anzeige_enthaelt_zugeordnete_sprechgruppen() {
    let pool = crate::db::test_pool().await;
    let einsatz = setup(&pool).await;
    let a = anlegen(&pool, einsatz, daten("Nord", None, None)).await.unwrap();
    let kat = crate::sprechgruppe::repo::anlegen_katalog(&pool, 1,
        crate::sprechgruppe::repo::KatalogDaten{bezeichnung:"412_F_DRK",betriebsart:"TMO",hinweis:None,sortier:0}).await.unwrap();
    crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(&pool, 1, einsatz, a.id, &[kat.id]).await.unwrap();
    let neu = laden(&pool, einsatz, a.id).await.unwrap();
    assert_eq!(neu.sprechgruppen.len(), 1);
    assert_eq!(neu.sprechgruppen[0].bezeichnung, "412_F_DRK");
}
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** (Anzeige-Feld + Befüllung + Route-Verdrahtung). `setup`-Helper legt Org(1) an, daher org_id=1.
- [ ] **Step 4: Run, expect PASS** — `cargo test --lib einsatzabschnitt` (alle, inkl. Bestands-Funk-Test).
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Zuordnung an Einsatzabschnitt (Anzeige + PATCH/POST) (LFH-109)"`

---

## Task 9: Einsatz-Einheit-Zuordnung anbinden

**Files:**
- Modify: Einsatz-Einheit-Domain (`src/einsatz_einheit/mod.rs` o. ä. — vor Umsetzung `rg "struct .*EinheitAnzeige" src/` lokalisieren), dessen Repo, `src/routes/einsatz_einheit.rs` (Routen `/api/einsaetze/{id}/einheiten`; POST=`bilden`, PATCH=`aktualisieren`)

**Interfaces:**
- Einheit-Anzeige-Struct erhält `pub sprechgruppen: Vec<SprechgruppeAnzeige>`.
- Einheit-Body (für `bilden`/`aktualisieren`) erhält `pub sprechgruppe_ids: Option<Vec<i64>>`.
- Handler: nach Anlegen/Aktualisieren und vorhandener Auth `sprechgruppe::repo::setze_einheit_sprechgruppen(&pool, org_id, einsatz_id, einheit_id, &ids)`; Anzeige um `lade_einheit_sprechgruppen` befüllen.

- [ ] **Step 1: Failing test** (im Einheit-Repo-Testmodul, analog Task 8 mit `einsatz_einheit`)

```rust
// Skizze – Namen an das tatsächliche Einheit-Repo anpassen:
// 1. Einsatz + Einheit anlegen, 2. Katalog-Sprechgruppe, 3. setze_einheit_sprechgruppen,
// 4. Einheit-Anzeige laden, assert sprechgruppen.len()==1.
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** (Muster exakt wie Task 8, auf `einsatz_einheit` übertragen).
- [ ] **Step 4: Run, expect PASS** — `cargo test --lib einsatz_einheit`.
- [ ] **Step 5: `cargo test --lib` komplett grün.**
- [ ] **Step 6: Commit** — `git commit -am "feat(sprechgruppe): Zuordnung an Einsatz-Einheit (LFH-109)"`

---

## Task 10: Frontend-API-Client + Typen

**Files:**
- Create: `frontend/src/api/sprechgruppen.ts` (Muster `frontend/src/api/fahrzeuge.ts`)
- Modify: `frontend/src/api/types.ts` (Sprechgruppe-Typen), `frontend/src/api/einsatzabschnitte.ts` + `frontend/src/api/einheiten.ts` (`sprechgruppe_ids` in Eingabe, `sprechgruppen` in Anzeige)

**Interfaces:**
- `type Betriebsart = 'TMO' | 'DMO'`
- `interface Sprechgruppe { id: number; einsatz_id: number | null; einsatz_lokal: boolean; bezeichnung: string; betriebsart: Betriebsart; hinweis: string | null; aktiv: boolean; sortier: number }`
- `interface SprechgruppeEingabe { bezeichnung: string; betriebsart: Betriebsart; hinweis?: string | null; sortier?: number }`
- API-Funktionen: `listeSprechgruppen(nurAktive?: boolean)`, `legeSprechgruppeAn(eingabe)`, `aktualisiereSprechgruppe(id, eingabe)`, `deaktiviereSprechgruppe(id)`, `listeEinsatzSprechgruppen(einsatzId)`, `legeEinsatzSprechgruppeAn(einsatzId, {bezeichnung, betriebsart, hinweis?})`.

- [ ] **Step 1:** Client + Typen nach Muster `api/fahrzeuge.ts` schreiben (gleiche `fetch`/Fehler-Helfer). `AbschnittEingabe`/`EinheitEingabe` um `sprechgruppe_ids?: number[]`, Anzeige-Interfaces um `sprechgruppen: Sprechgruppe[]`.
- [ ] **Step 2: Typecheck** — `mise exec pnpm@<ver> -- pnpm -C <abs>/frontend exec tsc --noEmit` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "feat(sprechgruppe): Frontend-API-Client + Typen (LFH-109)"`

---

## Task 11: Stammdaten-Tab (Katalogpflege)

**Files:**
- Create: `frontend/src/stammdaten/SprechgruppenTab.tsx`, `frontend/src/stammdaten/SprechgruppeFormModal.tsx` (Muster `FahrzeugeTab.tsx` / `FahrzeugFormModal.tsx`)
- Modify: `frontend/src/pages/StammdatenPage.tsx` (Tab `{ key: 'sprechgruppen', label: 'Sprechgruppen', children: <SprechgruppenTab /> }`)

**Interfaces:**
- Consumes: `api/sprechgruppen.ts`. useQuery `['sprechgruppen','alle']`; useMutation für Anlegen/Aktualisieren/Deaktivieren mit `invalidateQueries`.
- Tabelle: Spalten Bezeichnung, Betriebsart (Tag), Hinweis, Aktiv; Aktionen Bearbeiten/Deaktivieren. Modal-Felder: Bezeichnung (Input), Betriebsart (Select TMO/DMO), Hinweis (Input). antd statisches Modal/message vermeiden → `App.useApp()`.

- [ ] **Step 1: Failing test** `frontend/src/stammdaten/SprechgruppenTab.test.tsx` (RTL; QueryClient-Wrapper wie in `FahrzeugeTab.test.tsx`; fetch mocken)

```tsx
it('zeigt Katalog-Sprechgruppen', async () => {
  // mock listeSprechgruppen → [{id:1,bezeichnung:'412_F_DRK',betriebsart:'TMO',aktiv:true,...}]
  renderMitProvider(<SprechgruppenTab />);
  expect(await screen.findByText('412_F_DRK')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL** — `mise exec pnpm@<ver> -- pnpm -C <abs>/frontend test --no-file-parallelism SprechgruppenTab`.
- [ ] **Step 3: Implementieren** Tab + Modal + StammdatenPage-Registrierung.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Stammdaten-Tab Katalogpflege (LFH-109)"`

---

## Task 12: `SprechgruppenPicker` (wiederverwendbar)

**Files:**
- Create: `frontend/src/components/SprechgruppenPicker.tsx`

**Interfaces:**
- Props: `{ einsatzId: number; value?: number[]; onChange?: (ids: number[]) => void }` (antd-Form-kompatibel: value/onChange).
- Verhalten: lädt `listeEinsatzSprechgruppen(einsatzId)` (useQuery `['einsatz-sprechgruppen', einsatzId]`); rendert zwei `Checkbox.Group`-Blöcke (Überschrift „TMO" / „DMO"), Optionen je Betriebsart; einsatz-lokale mit Badge „lokal". Button „+ neue Sprechgruppe": kleines Inline-Formular (Bezeichnung, Betriebsart-Select [, Hinweis]) → `legeEinsatzSprechgruppeAn` → `invalidateQueries(['einsatz-sprechgruppen', einsatzId])` → neue id automatisch in `value` aufnehmen (onChange).

- [ ] **Step 1: Failing tests** `frontend/src/components/SprechgruppenPicker.test.tsx`

```tsx
it('rendert nach Betriebsart gruppierte Checkboxen und meldet Auswahl', async () => {
  // mock listeEinsatzSprechgruppen → [{id:1,betriebsart:'TMO',bezeichnung:'412',...},{id:2,betriebsart:'DMO',bezeichnung:'DMO 31',...}]
  const onChange = vi.fn();
  renderMitProvider(<SprechgruppenPicker einsatzId={5} value={[]} onChange={onChange} />);
  await screen.findByText('412');
  await userEvent.click(screen.getByLabelText('412'));
  expect(onChange).toHaveBeenCalledWith([1]);
});
it('legt einsatz-lokale Sprechgruppe an und hakt sie an', async () => {
  // mock POST → {id:9,einsatz_lokal:true,betriebsart:'DMO',bezeichnung:'Sonder 1',...}
  // Klick „+ neue", Felder ausfüllen, speichern → onChange enthält 9
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** (antd `Checkbox.Group`; Inline-Anlegen).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): SprechgruppenPicker (Checkboxen + inline einsatz-lokal) (LFH-109)"`

---

## Task 13: Picker in EinsatzabschnittePage

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx` (Funk-Form: die beiden `<Input>` `sprechgruppe_tmo`/`_dmo` durch `<SprechgruppenPicker einsatzId={…} />` unter `name="sprechgruppe_ids"` ersetzen; beim Speichern `sprechgruppe_ids` mitsenden; bestehende Felder kommunikationsmittel/erreichbarkeit bleiben). Anzeige je Abschnitt: zugeordnete `sprechgruppen` als Tags (gruppiert nach Betriebsart).

- [ ] **Step 1: Failing test** in `frontend/src/pages/EinsatzabschnittePage.test.tsx` (Form rendert Picker statt der Freitext-Inputs; Speichern überträgt `sprechgruppe_ids`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren** (Form-Item ersetzen, Submit-Payload, Tag-Anzeige). Form-Initialwerte aus `abschnitt.sprechgruppen.map(s=>s.id)`.
- [ ] **Step 4: Run, expect PASS** — `… test --no-file-parallelism EinsatzabschnittePage`.
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Abschnitt-Form nutzt SprechgruppenPicker (LFH-109)"`

---

## Task 14: Picker in EinheitenPage

**Files:**
- Modify: `frontend/src/pages/EinheitenPage.tsx` (Einheit-Form: `<SprechgruppenPicker einsatzId={…} name="sprechgruppe_ids" />` ergänzen; Submit überträgt `sprechgruppe_ids`; Anzeige zeigt Tags).

- [ ] **Step 1: Failing test** in `frontend/src/pages/EinheitenPage.test.tsx`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4: Run, expect PASS** — `… test --no-file-parallelism EinheitenPage`.
- [ ] **Step 5: Commit** — `git commit -am "feat(sprechgruppe): Einheit-Form nutzt SprechgruppenPicker (LFH-109)"`

---

## Task 15: Integration & Gesamt-Gate

- [ ] **Step 1: Backend gesamt** — `cargo test` (oder `cargo test --lib`) → PASS; `cargo clippy --all-targets` → keine neuen Warnings.
- [ ] **Step 2: Frontend gesamt** — `mise exec pnpm@<ver> -- pnpm -C <abs>/frontend test --no-file-parallelism` → PASS; `… exec tsc --noEmit` → PASS; `… build` → PASS (rust-embed-Bundle).
- [ ] **Step 3: Smoke** — Backend hochziehen, Stammdaten→Sprechgruppen anlegen, an einem Abschnitt + einer Einheit auswählen, einsatz-lokal anlegen; alte Freitext-Migration an einem Seed-Einsatz sichten (`verify`-Skill).
- [ ] **Step 4: Board-Status + Review** — `superpowers:verification-before-completion`, dann `requesting-code-review`.

---

## Self-Review (gegen Spec)

- **Katalog-Entität (AC#1):** Tabelle + Partial-Unique-Index (Task 1), CRUD (Task 4), Tab (Task 11). ✓
- **Einsatz-lokal anlegbar:** Task 5 (repo), Task 7 (route), Task 12 (UI inline). ✓
- **M:N an Abschnitt + Einheit (Checkboxen):** Tasks 6/8/9 (backend), 12–14 (frontend). ✓
- **Migration LFH-86-Freitext (AC#2):** Task 1 Daten-Migration; Alt-Spalten bleiben. ✓
- **Org-Scoping/Isolation:** in jeder Repo-Query + Validierung (Tasks 4–7). ✓
- **Soft-Delete Katalog / Cascade einsatz-lokal:** Task 1 (Schema) + Task 4 (deaktiviere). ✓
- **Betriebsart TMO/DMO:** Task 2 (Konstanten) + CHECK (Task 1). ✓
- **Offen/abhängig:** Task 9 erfordert Lokalisierung der Einheit-Anzeige-/Body-Namen (im Task vermerkt).
