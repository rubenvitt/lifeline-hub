# K&M‑1 — Stammdaten & Disposition (Fahrzeuge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Globaler Fahrzeug-Stamm + admin-pflegbarer Status-Katalog + Disposition von Stamm-/Ad-hoc-Fahrzeugen in den Einsatz, mit Identitäts-Schnappschuss und automatischem ETB-Eintrag.

**Architecture:** Drei neue Tabellen (`fahrzeug`, `fahrzeug_status`, `einsatz_fahrzeug`). Backend: neues Domänen-Modul `src/fahrzeug/` (`mod.rs` Typen, `repo.rs` Stamm, `status_repo.rs` Katalog, `disposition_repo.rs` Einsatz-Disposition) + drei Routen-Module, analog `src/einsatz/`. Wiederverwendbarer `src/staerke.rs`. Disposition schreibt zusätzlich einen `typ='system'`-ETB-Eintrag über das bestehende `etb::repo::anlegen` (sequentiell, bewusst nicht-atomar). Frontend: `StammdatenPage` wird auf antd-`Tabs` umgebaut (Stichworte/Fahrzeuge/Status), neue `FahrzeugePage` ersetzt den `ModulStub`.

**Tech Stack:** Rust (Axum, sqlx/SQLite, chrono), React + TypeScript + antd + @tanstack/react-query, Vitest + MSW.

**Quellen-Patterns (vor Beginn lesen):** `src/etb/repo.rs` + `src/routes/etb.rs` (Repo-/Routen-/Gate-Vorbild), `src/stichwort/mod.rs` + `src/routes/stichwort.rs` (Admin-CRUD-Vorbild), `src/einsatz/berechtigung.rs` (Gates), `src/auth/bootstrap.rs` (Seeding), `tests/etb.rs` + `tests/stichwort.rs` (Integrationstest-Harness), `frontend/src/pages/EinsatzdatenPage.tsx` (Form/Read-Toggle), `frontend/src/pages/StammdatenPage.test.tsx` (Frontend-Test).

**Wichtige Konventionen dieses Codebase:**
- Fehler: zentraler `AppError` (`src/error.rs`) mit `Validation`(400)/`Conflict`(409)/`Forbidden`(403)/`NotFound`(404). `is_unique_violation()` → `Conflict`.
- Auth-Extractors: `CurrentUser(benutzer)` (eingeloggt), `AdminUser(benutzer)` (System-Admin). `benutzer.org_id` ist die eigene Org.
- Gates im Einsatz: `einsatz_repo::laden` (404) → `einsatz_repo::rolle_von` → `fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv` (`src/einsatz/berechtigung.rs`).
- Repos sind freie `async fn` mit `&SqlitePool`, Enums werden manuell als TEXT geparst (kein sqlx-Enum-Decode), `bool`-Spalten via `INTEGER` 0/1 (FromRow kann `bool`).
- Tests: `crate::db::test_pool()` (In-Memory, Migrationen eingespielt) für Unit-Tests; Integrationstests bauen `build_router(AppState{pool, live})` nach Bootstrap.
- Commit-Trailer (jede Commit-Message): `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

**Test-Kommandos:**
- Backend einzelner Test: `cargo test --test fahrzeug nicht_admin_darf_nicht_anlegen` / Unit: `cargo test staerke::`
- Backend gesamt: `cargo test`
- Frontend einzeln: `cd frontend && npx vitest run src/pages/FahrzeugePage.test.tsx`
- Frontend gesamt: `cd frontend && npm run test` — Typecheck: `npm run typecheck` — Lint: `npm run lint`

---

## Hinweis zur Test-Harness-Duplizierung

Die drei Integrationstest-Dateien (`tests/fahrzeug.rs`, `tests/fahrzeug_status.rs`, `tests/einsatz_fahrzeug.rs`) beginnen jeweils mit denselben Harness-Helfern (`setup`, `login_cookie`, `benutzer_anlegen`), exakt wie `tests/stichwort.rs`/`tests/etb.rs`. Der volle Harness-Block wird in **Task 7** vollständig gezeigt; die Tasks 9 und 12 weisen an, denselben Block (plus die dort gezeigten Zusatz-Helfer) an den Dateianfang zu kopieren. Das entspricht dem bestehenden Codebase-Muster (jede `tests/*.rs` dupliziert den Harness).

---

## Task 1: Migration `0007_fahrzeug.sql` — Fahrzeug-Stamm

**Files:**
- Create: `migrations/0007_fahrzeug.sql`
- Test: `src/db.rs` (neuer `#[tokio::test]` im bestehenden `mod tests`)

- [ ] **Step 1: Migration schreiben**

`migrations/0007_fahrzeug.sql`:

```sql
-- Globaler, org-weiter Fahrzeug-Stamm (Fuhrpark der Organisation).
-- Kein Hard-Delete: "löschen" = dienststatus auf 'ausser_dienst' setzen, damit
-- Referenzen aus (auch abgeschlossenen) Einsätzen immer auflösbar bleiben.
CREATE TABLE fahrzeug (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id),
    funkrufname          TEXT NOT NULL,
    fahrzeugtyp          TEXT,                       -- Combobox; Vorschläge abgeleitet (DISTINCT)
    traegerorganisation  TEXT,                       -- frei; UI-Default = Name der eigenen Org
    kennzeichen          TEXT,
    opta                 TEXT,
    standort             TEXT,                       -- Freitext (echter Standort-Stamm später)
    fms_issi             TEXT,                       -- Digitalfunk-Kennung (Zukunfts-Haken)
    sondersignal         INTEGER NOT NULL DEFAULT 0, -- 0/1: Sonder-/Wegerecht
    tragenkapazitaet     INTEGER,                    -- optional, San-Typen
    staerke_fuehrer      INTEGER,                    -- Sollbesatzung (taktische Stärke), optional
    staerke_unterfuehrer INTEGER,
    staerke_mannschaft   INTEGER,
    bemerkung            TEXT,
    dienststatus         TEXT NOT NULL DEFAULT 'in_dienst'
                         CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Funkrufname je Organisation eindeutig, aber nur unter aktiven Fahrzeugen:
-- außer Dienst gestellte geben ihren Namen zur Wiederverwendung frei.
CREATE UNIQUE INDEX idx_fahrzeug_funkrufname
    ON fahrzeug(org_id, funkrufname) WHERE dienststatus = 'in_dienst';
```

- [ ] **Step 2: Migrationstest schreiben**

In `src/db.rs`, im vorhandenen `#[cfg(test)] mod tests` (nach dem letzten Test, vor der schließenden `}`), einfügen:

```rust
    #[tokio::test]
    async fn fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // dienststatus-Default ist 'in_dienst'.
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (status, signal): (String, i64) =
            sqlx::query_as("SELECT dienststatus, sondersignal FROM fahrzeug WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "in_dienst");
        assert_eq!(signal, 0);

        // dienststatus-CHECK lehnt ungültigen Wert ab.
        let bad = sqlx::query("UPDATE fahrzeug SET dienststatus = 'kaputt' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(bad.is_err(), "ungültiger dienststatus muss abgelehnt werden");

        // Partieller Unique-Index: doppelter Funkrufname unter aktiven verboten.
        let dup = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppelter aktiver Funkrufname je Org muss abgelehnt werden");

        // Außer Dienst gestellt → Name wieder frei.
        sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let wieder = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(wieder.is_ok(), "Name eines außer Dienst gestellten Fahrzeugs muss frei sein");
    }
```

- [ ] **Step 3: Test ausführen (erwartet PASS — reiner Migrations-/Schema-Test)**

Run: `cargo test --lib db::tests::fahrzeug_migration_constraints`
Expected: PASS (Migration wird beim `test_pool()` eingespielt).

- [ ] **Step 4: Commit**

```bash
git add migrations/0007_fahrzeug.sql src/db.rs
git commit -m "feat(fahrzeug): Migration Fahrzeug-Stamm (0007) mit partiellem Funkrufname-Index"
```

---

## Task 2: Migration `0008_fahrzeug_status.sql` — Status-Katalog + Seed der Bestands-Org

**Files:**
- Create: `migrations/0008_fahrzeug_status.sql`
- Test: `src/db.rs` (neuer Test)

- [ ] **Step 1: Migration schreiben**

`migrations/0008_fahrzeug_status.sql`:

```sql
-- Org-weiter, admin-pflegbarer Fahrzeug-Status-Katalog. Die feste Semantik-
-- Kategorie ('verfuegbar'/'gebunden'/'nicht_verfuegbar') trägt die App-Logik;
-- label/farbe/sortier sind frei umbenenn-/umsortierbar. Soft-Delete via aktiv=0.
CREATE TABLE fahrzeug_status (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    label     TEXT NOT NULL,
    kategorie TEXT NOT NULL
              CHECK (kategorie IN ('verfuegbar', 'gebunden', 'nicht_verfuegbar')),
    farbe     TEXT,                        -- optional, Hex (#rrggbb) für Lageübersicht
    fms_anker INTEGER CHECK (fms_anker BETWEEN 0 AND 9),  -- optional
    sortier   INTEGER NOT NULL DEFAULT 0,
    aktiv     INTEGER NOT NULL DEFAULT 1,  -- Soft-Delete (deaktiviert, statt löschen)
    UNIQUE(org_id, label)
);

-- Bestehende Organisation(en) mit dem Default-Katalog seeden. Auf einer frischen
-- DB (Migration läuft vor Bootstrap, keine Organisation vorhanden) ist dies ein
-- No-Op; neue Orgs seedet bootstrap_admin (gleiche Werte, siehe fahrzeug/mod.rs
-- STATUS_STARTLISTE — beide synchron halten).
INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier)
SELECT o.id, v.label, v.kategorie, v.fms_anker, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'einsatzbereit'  AS label, 'verfuegbar'       AS kategorie, 1 AS fms_anker, 10 AS sortier
    UNION ALL SELECT 'disponiert',    'gebunden',         3, 20
    UNION ALL SELECT 'anfahrt',       'gebunden',         3, 30
    UNION ALL SELECT 'vor_ort',       'gebunden',         4, 40
    UNION ALL SELECT 'transport',     'gebunden',         7, 50
    UNION ALL SELECT 'am_ziel',       'gebunden',         8, 60
    UNION ALL SELECT 'zurück',        'gebunden',         1, 70
    UNION ALL SELECT 'außer Dienst',  'nicht_verfuegbar', 6, 80
) v;
```

- [ ] **Step 2: Migrationstest schreiben**

In `src/db.rs`, `mod tests`, einfügen:

```rust
    #[tokio::test]
    async fn fahrzeug_status_migration_constraints_und_seed() {
        let pool = test_pool().await;
        // Org NACH der Migration anlegen → Migrations-Seed greift hier NICHT
        // (das Seeding der neuen Org ist bootstrap_admins Aufgabe, separat getestet).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // kategorie-CHECK.
        let bad_kat = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'X', 'quatsch')",
        )
        .execute(&pool)
        .await;
        assert!(bad_kat.is_err(), "ungültige kategorie muss abgelehnt werden");

        // fms_anker-CHECK (0..=9).
        let bad_fms = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker) VALUES (1, 'Y', 'gebunden', 12)",
        )
        .execute(&pool)
        .await;
        assert!(bad_fms.is_err(), "fms_anker außerhalb 0..=9 muss abgelehnt werden");

        // aktiv-Default ist 1, sortier-Default 0.
        sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'verfuegbar')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) = sqlx::query_as(
            "SELECT aktiv, sortier FROM fahrzeug_status WHERE label = 'frei'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(aktiv, 1);
        assert_eq!(sortier, 0);

        // UNIQUE(org_id, label).
        let dup = sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'gebunden')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }
```

- [ ] **Step 3: Test ausführen**

Run: `cargo test --lib db::tests::fahrzeug_status_migration_constraints_und_seed`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/0008_fahrzeug_status.sql src/db.rs
git commit -m "feat(fahrzeug): Migration Status-Katalog (0008) mit Bestands-Org-Seed"
```

---

## Task 3: Migration `0009_einsatz_fahrzeug.sql` — Disposition

**Files:**
- Create: `migrations/0009_einsatz_fahrzeug.sql`
- Test: `src/db.rs` (neuer Test)

- [ ] **Step 1: Migration schreiben**

`migrations/0009_einsatz_fahrzeug.sql`:

```sql
-- Disposition: Zuordnung von Stamm-/Ad-hoc-Fahrzeugen zu einem konkreten Einsatz.
-- Referenz + Einsatz-Zustand (kein Voll-Snapshot des Stamms), plus Identitäts-
-- Schnappschuss (snap_*) für Nachvollziehbarkeit / Ad-hoc-Daten.
CREATE TABLE einsatz_fahrzeug (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    fahrzeug_id     INTEGER REFERENCES fahrzeug(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES fahrzeug_status(id),  -- aktueller Einsatz-Status
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_funkrufname         TEXT NOT NULL,
    snap_kennzeichen         TEXT,
    snap_fahrzeugtyp         TEXT,
    snap_opta                TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, fahrzeug_id)   -- ein Stamm-Fahrzeug je Einsatz nur einmal; mehrere NULL erlaubt
);

CREATE INDEX idx_einsatz_fahrzeug_einsatz ON einsatz_fahrzeug(einsatz_id);
```

- [ ] **Step 2: Migrationstest schreiben**

In `src/db.rs`, `mod tests`, einfügen:

```rust
    #[tokio::test]
    async fn einsatz_fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stamm-Disposition.
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await
        .unwrap();

        // UNIQUE(einsatz_id, fahrzeug_id): dasselbe Stamm-Fahrzeug nicht doppelt.
        let dup = sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "dasselbe Stamm-Fahrzeug doppelt im Einsatz muss abgelehnt werden");

        // Mehrere Ad-hoc (fahrzeug_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 1')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 2')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 3, "1 Stamm + 2 Ad-hoc");

        // Einsatz löschen → CASCADE entfernt die Dispositionszeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Dispositionszeilen entfernen");
    }
```

- [ ] **Step 3: Test ausführen**

Run: `cargo test --lib db::tests::einsatz_fahrzeug_migration_constraints`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/0009_einsatz_fahrzeug.sql src/db.rs
git commit -m "feat(fahrzeug): Migration Disposition (0009) mit Snapshot-Feldern"
```

---

## Task 4: `src/staerke.rs` — wiederverwendbarer Stärke-Typ

Eigenes Top-Level-Modul (K&M‑2/3 importieren denselben Typ). Reine Logik, keine DB — vollständig unit-testbar.

**Files:**
- Create: `src/staerke.rs`
- Modify: `src/lib.rs` (Modul registrieren)

- [ ] **Step 1: Failing test schreiben (zuerst Modul + leeres Gerüst, damit es kompiliert)**

`src/staerke.rs` zunächst nur mit Typ-Gerüst + Tests anlegen:

```rust
use serde::Serialize;

/// Taktische Stärke (FwDV 3 / DV 100): Führer / Unterführer / Mannschaft.
/// `gesamt` wird berechnet, nicht gespeichert. `u16`, damit auch ein Verband/Stab
/// über 255 nicht anstößt. Wiederverwendbar für Personal/Einheiten (K&M‑2/3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Staerke {
    pub fuehrer: u16,
    pub unterfuehrer: u16,
    pub mannschaft: u16,
}

impl Staerke {
    pub fn neu(fuehrer: u16, unterfuehrer: u16, mannschaft: u16) -> Self {
        Staerke { fuehrer, unterfuehrer, mannschaft }
    }

    /// Gesamtstärke = Summe der drei Werte. `u32`, damit die Summe dreier `u16`
    /// nie überläuft (sauber, auch wenn praktisch nie relevant).
    pub fn gesamt(&self) -> u32 {
        self.fuehrer as u32 + self.unterfuehrer as u32 + self.mannschaft as u32
    }

    /// 4-stellige Anzeige "F/UF/M/Gesamt", z. B. "1/3/18/22".
    pub fn anzeige(&self) -> String {
        format!("{}/{}/{}/{}", self.fuehrer, self.unterfuehrer, self.mannschaft, self.gesamt())
    }

    /// Baut eine optionale Stärke aus drei Eingabe-/DB-Optionen (i64, da SQLite
    /// INTEGER). Regel: alle drei gesetzt **oder** alle drei `None`; Werte
    /// 0..=u16::MAX. Bei Verstoß `Err` mit deutscher Validierungsmeldung — der
    /// Aufrufer (Handler) mappt das auf `AppError::Validation`.
    pub fn aus_optionen(
        fuehrer: Option<i64>,
        unterfuehrer: Option<i64>,
        mannschaft: Option<i64>,
    ) -> Result<Option<Staerke>, String> {
        match (fuehrer, unterfuehrer, mannschaft) {
            (None, None, None) => Ok(None),
            (Some(f), Some(u), Some(m)) => {
                for (name, wert) in [("Führer", f), ("Unterführer", u), ("Mannschaft", m)] {
                    if wert < 0 {
                        return Err(format!("Stärke ({name}) darf nicht negativ sein"));
                    }
                    if wert > u16::MAX as i64 {
                        return Err(format!("Stärke ({name}) ist zu groß"));
                    }
                }
                Ok(Some(Staerke::neu(f as u16, u as u16, m as u16)))
            }
            _ => Err(
                "Stärke muss vollständig (Führer, Unterführer, Mannschaft) oder leer sein".into(),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gesamt_summiert_die_drei_werte() {
        assert_eq!(Staerke::neu(1, 3, 18).gesamt(), 22);
        assert_eq!(Staerke::neu(0, 0, 2).gesamt(), 2);
    }

    #[test]
    fn anzeige_ist_vierstellig() {
        assert_eq!(Staerke::neu(1, 3, 18).anzeige(), "1/3/18/22");
        assert_eq!(Staerke::neu(0, 1, 5).anzeige(), "0/1/5/6");
    }

    #[test]
    fn aus_optionen_alle_none_ist_ok_none() {
        assert_eq!(Staerke::aus_optionen(None, None, None).unwrap(), None);
    }

    #[test]
    fn aus_optionen_alle_gesetzt_ist_ok_some() {
        assert_eq!(
            Staerke::aus_optionen(Some(1), Some(3), Some(18)).unwrap(),
            Some(Staerke::neu(1, 3, 18))
        );
    }

    #[test]
    fn aus_optionen_teilweise_gesetzt_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(1), None, Some(2)).is_err());
        assert!(Staerke::aus_optionen(None, Some(1), None).is_err());
    }

    #[test]
    fn aus_optionen_negativ_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(-1), Some(0), Some(0)).is_err());
    }

    #[test]
    fn aus_optionen_zu_gross_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(0), Some(0), Some(70000)).is_err());
    }
}
```

- [ ] **Step 2: Modul registrieren**

In `src/lib.rs` die alphabetisch passende Zeile ergänzen (nach `pub mod routes;`):

```rust
pub mod staerke;
```

- [ ] **Step 3: Tests ausführen**

Run: `cargo test --lib staerke::`
Expected: PASS (alle 7 Tests grün).

- [ ] **Step 4: Commit**

```bash
git add src/staerke.rs src/lib.rs
git commit -m "feat(fahrzeug): wiederverwendbarer Staerke-Typ (F/UF/M, Gesamt berechnet)"
```

---

## Task 5: `src/fahrzeug/mod.rs` — Typen, Konstanten, Status-Startliste

**Files:**
- Create: `src/fahrzeug/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)

- [ ] **Step 1: Modul mit Typen + Konstanten anlegen**

`src/fahrzeug/mod.rs`:

```rust
pub mod disposition_repo;
pub mod repo;
pub mod status_repo;

use crate::staerke::Staerke;
use serde::Serialize;

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = "in_dienst";
pub const DIENSTSTATUS_AUSSER_DIENST: &str = "ausser_dienst";

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = "verfuegbar";
pub const KATEGORIE_GEBUNDEN: &str = "gebunden";
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = "nicht_verfuegbar";

/// Default-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, fms_anker, sortier). **Muss mit dem Seed in
/// `migrations/0008_fahrzeug_status.sql` übereinstimmen.** bootstrap_admin
/// iteriert diese Liste für neue Orgs.
pub const STATUS_STARTLISTE: [(&str, &str, i64, i64); 8] = [
    ("einsatzbereit", KATEGORIE_VERFUEGBAR, 1, 10),
    ("disponiert", KATEGORIE_GEBUNDEN, 3, 20),
    ("anfahrt", KATEGORIE_GEBUNDEN, 3, 30),
    ("vor_ort", KATEGORIE_GEBUNDEN, 4, 40),
    ("transport", KATEGORIE_GEBUNDEN, 7, 50),
    ("am_ziel", KATEGORIE_GEBUNDEN, 8, 60),
    ("zurück", KATEGORIE_GEBUNDEN, 1, 70),
    ("außer Dienst", KATEGORIE_NICHT_VERFUEGBAR, 6, 80),
];

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    matches!(s, KATEGORIE_VERFUEGBAR | KATEGORIE_GEBUNDEN | KATEGORIE_NICHT_VERFUEGBAR)
}

/// Interner Fahrzeug-Datensatz (alle Spalten von `fahrzeug`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Fahrzeug {
    pub id: i64,
    pub org_id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke_fuehrer: Option<i64>,
    pub staerke_unterfuehrer: Option<i64>,
    pub staerke_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

impl Fahrzeug {
    /// Soll-Stärke als optionaler `Staerke` (alle drei gesetzt → Some, sonst None).
    pub fn staerke(&self) -> Option<Staerke> {
        match (self.staerke_fuehrer, self.staerke_unterfuehrer, self.staerke_mannschaft) {
            (Some(f), Some(u), Some(m)) => Some(Staerke::neu(f as u16, u as u16, m as u16)),
            _ => None,
        }
    }

    /// Serialisierbare Anzeige (mit aufgelöster Stärke).
    pub fn anzeige(&self) -> FahrzeugAnzeige {
        FahrzeugAnzeige {
            id: self.id,
            funkrufname: self.funkrufname.clone(),
            fahrzeugtyp: self.fahrzeugtyp.clone(),
            traegerorganisation: self.traegerorganisation.clone(),
            kennzeichen: self.kennzeichen.clone(),
            opta: self.opta.clone(),
            standort: self.standort.clone(),
            fms_issi: self.fms_issi.clone(),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke: self.staerke(),
            bemerkung: self.bemerkung.clone(),
            dienststatus: self.dienststatus.clone(),
            angelegt_at: self.angelegt_at.clone(),
        }
    }
}

/// Öffentliche Fahrzeug-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize)]
pub struct FahrzeugAnzeige {
    pub id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Status-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FahrzeugStatus {
    pub id: i64,
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    pub fms_anker: Option<i64>,
    pub sortier: i64,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Fahrzeug in Dienst, sonst Snapshot)
/// plus aufgelöster Status.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzFahrzeugAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Fahrzeug (kein Stamm-Bezug).
    pub fahrzeug_id: Option<i64>,
    pub ist_adhoc: bool,
    pub funkrufname: String,
    pub kennzeichen: Option<String>,
    pub fahrzeugtyp: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
    pub status_id: Option<i64>,
    pub status_label: Option<String>,
    pub status_kategorie: Option<String>,
    pub status_farbe: Option<String>,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fahrzeug() -> Fahrzeug {
        Fahrzeug {
            id: 1,
            org_id: 1,
            funkrufname: "Florian 1".into(),
            fahrzeugtyp: Some("LF 20".into()),
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: true,
            tragenkapazitaet: None,
            staerke_fuehrer: Some(0),
            staerke_unterfuehrer: Some(1),
            staerke_mannschaft: Some(8),
            bemerkung: None,
            dienststatus: DIENSTSTATUS_IN_DIENST.into(),
            angelegt_at: "2026-05-26 10:00:00".into(),
        }
    }

    #[test]
    fn staerke_aufgeloest_wenn_vollstaendig() {
        let f = fahrzeug();
        let s = f.staerke().unwrap();
        assert_eq!(s.anzeige(), "0/1/8/9");
        assert_eq!(f.anzeige().staerke, Some(s));
    }

    #[test]
    fn staerke_none_wenn_unvollstaendig() {
        let mut f = fahrzeug();
        f.staerke_unterfuehrer = None;
        assert_eq!(f.staerke(), None);
        assert_eq!(f.anzeige().staerke, None);
    }

    #[test]
    fn kategorie_validierung() {
        assert!(ist_gueltige_kategorie("gebunden"));
        assert!(!ist_gueltige_kategorie("irgendwas"));
    }

    #[test]
    fn startliste_deckt_alle_kategorien_ab() {
        assert_eq!(STATUS_STARTLISTE.len(), 8);
        assert!(STATUS_STARTLISTE.iter().all(|(_, k, _, _)| ist_gueltige_kategorie(k)));
    }
}
```

- [ ] **Step 2: Modul registrieren**

In `src/lib.rs` ergänzen (nach `pub mod etb;`):

```rust
pub mod fahrzeug;
```

> Hinweis: `disposition_repo`, `repo`, `status_repo` werden in `mod.rs` als Submodule deklariert. Damit `cargo build` in diesem Task durchläuft, lege jetzt **leere Platzhalterdateien** an, die in den folgenden Tasks gefüllt werden:
> ```bash
> touch src/fahrzeug/repo.rs src/fahrzeug/status_repo.rs src/fahrzeug/disposition_repo.rs
> ```

- [ ] **Step 3: Tests ausführen**

Run: `cargo test --lib fahrzeug::tests`
Expected: PASS (4 Tests). `cargo build` muss fehlerfrei sein (leere Submodule sind gültig).

- [ ] **Step 4: Commit**

```bash
git add src/fahrzeug/ src/lib.rs
git commit -m "feat(fahrzeug): Domänen-Typen (Fahrzeug, FahrzeugStatus, EinsatzFahrzeugAnzeige)"
```

---

## Task 6: `src/fahrzeug/repo.rs` — Stamm-CRUD (Soft-Delete)

**Files:**
- Modify (befüllen): `src/fahrzeug/repo.rs`

- [ ] **Step 1: Repository schreiben**

`src/fahrzeug/repo.rs`:

```rust
use super::{Fahrzeug, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Fahrzeug` (FromRow).
const SPALTEN: &str = "id, org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, \
     opta, standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
     staerke_unterfuehrer, staerke_mannschaft, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
/// `staerke` ist bereits validiert (alle drei oder keiner).
#[derive(Debug)]
pub struct FahrzeugDaten<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub kennzeichen: Option<&'a str>,
    pub opta: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub fms_issi: Option<&'a str>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<&'a str>,
}

/// Zerlegt eine optionale Stärke in drei `Option<i64>` (DB-Spalten).
fn zerlege_staerke(s: Option<Staerke>) -> (Option<i64>, Option<i64>, Option<i64>) {
    match s {
        Some(s) => (Some(s.fuehrer as i64), Some(s.unterfuehrer as i64), Some(s.mannschaft as i64)),
        None => (None, None, None),
    }
}

/// Übersetzt einen Unique-Verstoß auf dem Funkrufname-Index in `Conflict`.
fn funkrufname_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Funkrufname ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Fahrzeug der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Fahrzeug, AppError> {
    sqlx::query_as::<_, Fahrzeug>(&format!(
        "SELECT {SPALTEN} FROM fahrzeug WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Fahrzeuge der Org, sortiert nach Funkrufname.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Fahrzeug>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY funkrufname")
    } else {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? ORDER BY funkrufname")
    };
    sqlx::query_as::<_, Fahrzeug>(&sql)
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Abgeleitete Fahrzeugtyp-Vorschläge (DISTINCT, org-weit) für die AutoComplete.
pub async fn typ_vorschlaege(pool: &SqlitePool, org_id: i64) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT fahrzeugtyp FROM fahrzeug \
         WHERE org_id = ? AND fahrzeugtyp IS NOT NULL AND fahrzeugtyp <> '' \
         ORDER BY fahrzeugtyp",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt ein Fahrzeug an. Dublette Funkrufname (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fahrzeug \
            (org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, opta, \
             standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
             staerke_unterfuehrer, staerke_mannschaft, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return funkrufname_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Funkrufname-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query(
        "UPDATE fahrzeug SET \
            funkrufname = ?, fahrzeugtyp = ?, traegerorganisation = ?, kennzeichen = ?, \
            opta = ?, standort = ?, fms_issi = ?, sondersignal = ?, tragenkapazitaet = ?, \
            staerke_fuehrer = ?, staerke_unterfuehrer = ?, staerke_mannschaft = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei
/// fremder Org; `Conflict`, wenn beim Reaktivieren der Funkrufname inzwischen
/// aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Fahrzeug, AppError> {
    let neuer = if in_dienst { DIENSTSTATUS_IN_DIENST } else { DIENSTSTATUS_AUSSER_DIENST };
    let ergebnis = sqlx::query("UPDATE fahrzeug SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
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

    fn daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname,
            fahrzeugtyp: Some("LF 20"),
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: false,
            tragenkapazitaet: None,
            staerke: Some(Staerke::neu(0, 1, 8)),
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert_eq!(f.funkrufname, "Florian 1");
        assert_eq!(f.staerke().unwrap().anzeige(), "0/1/8/9");
        assert_eq!(laden(&pool, 1, f.id).await.unwrap().id, f.id);
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(laden(&pool, 2, f.id).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn dublette_funkrufname_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("Florian 1")).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn funkrufname_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(anlegen(&pool, 2, daten("Florian 1")).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();

        setze_dienststatus(&pool, 1, f.id, false).await.unwrap();
        assert!(liste(&pool, 1, true).await.unwrap().is_empty(), "nicht in nur_im_dienst");
        assert_eq!(liste(&pool, 1, false).await.unwrap().len(), 1, "aber weiter referenzierbar");
        assert_eq!(laden(&pool, 1, f.id).await.unwrap().dienststatus, "ausser_dienst");
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebenen_namen_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let alt = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Name inzwischen neu vergeben.
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        // Reaktivieren des alten Fahrzeugs kollidiert → Conflict.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        let mut neu = daten("Florian 1");
        neu.kennzeichen = Some("XX-AB 123");
        neu.staerke = None;
        let g = aktualisiere(&pool, 1, f.id, neu).await.unwrap();
        assert_eq!(g.kennzeichen.as_deref(), Some("XX-AB 123"));
        assert_eq!(g.staerke(), None);
    }

    #[tokio::test]
    async fn typ_vorschlaege_distinct() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap(); // LF 20
        let mut rtw = daten("Rettung 1");
        rtw.fahrzeugtyp = Some("RTW");
        anlegen(&pool, 1, rtw).await.unwrap();
        let mut lf2 = daten("Florian 2");
        lf2.fahrzeugtyp = Some("LF 20");
        anlegen(&pool, 1, lf2).await.unwrap();

        let typen = typ_vorschlaege(&pool, 1).await.unwrap();
        assert_eq!(typen, vec!["LF 20".to_string(), "RTW".to_string()]);
    }
}
```

- [ ] **Step 2: Tests ausführen**

Run: `cargo test --lib fahrzeug::repo::`
Expected: PASS (8 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/fahrzeug/repo.rs
git commit -m "feat(fahrzeug): Stamm-Repo (CRUD, Soft-Delete, Reaktivierungs-Conflict)"
```

---

## Task 7: `src/routes/fahrzeug.rs` — Stamm-Routen + Integrationstest

**Files:**
- Create: `src/routes/fahrzeug.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Test: `tests/fahrzeug.rs`

- [ ] **Step 1: Routen-Modul schreiben**

`src/routes/fahrzeug.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::fahrzeug::repo::{self, FahrzeugDaten};
use crate::fahrzeug::FahrzeugAnzeige;
use crate::staerke::Staerke;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct FahrzeugBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    #[serde(default)]
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke_fuehrer: Option<i64>,
    pub staerke_unterfuehrer: Option<i64>,
    pub staerke_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Owned, validierte Felder; `FahrzeugDaten` borgt daraus.
struct Normalisiert {
    funkrufname: String,
    fahrzeugtyp: Option<String>,
    traegerorganisation: Option<String>,
    kennzeichen: Option<String>,
    opta: Option<String>,
    standort: Option<String>,
    fms_issi: Option<String>,
    sondersignal: bool,
    tragenkapazitaet: Option<i64>,
    staerke: Option<Staerke>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname: &self.funkrufname,
            fahrzeugtyp: self.fahrzeugtyp.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            kennzeichen: self.kennzeichen.as_deref(),
            opta: self.opta.as_deref(),
            standort: self.standort.as_deref(),
            fms_issi: self.fms_issi.as_deref(),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke: self.staerke,
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: FahrzeugBody) -> Result<Normalisiert, AppError> {
    let funkrufname = body.funkrufname.trim().to_string();
    if funkrufname.is_empty() {
        return Err(AppError::Validation("Funkrufname darf nicht leer sein".into()));
    }
    let staerke = Staerke::aus_optionen(
        body.staerke_fuehrer,
        body.staerke_unterfuehrer,
        body.staerke_mannschaft,
    )
    .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        funkrufname,
        fahrzeugtyp: trimme(body.fahrzeugtyp),
        traegerorganisation: trimme(body.traegerorganisation),
        kennzeichen: trimme(body.kennzeichen),
        opta: trimme(body.opta),
        standort: trimme(body.standort),
        fms_issi: trimme(body.fms_issi),
        sondersignal: body.sondersignal,
        tragenkapazitaet: body.tragenkapazitaet,
        staerke,
        bemerkung: trimme(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/fahrzeuge — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<FahrzeugAnzeige>>, AppError> {
    let fahrzeuge = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(fahrzeuge.iter().map(|f| f.anzeige()).collect()))
}

/// GET /api/fahrzeug-typen — abgeleitete AutoComplete-Vorschläge (eigene Org).
pub async fn typen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(repo::typ_vorschlaege(&state.pool, benutzer.org_id).await?))
}

/// POST /api/fahrzeuge — Admin. Dublette Funkrufname → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<FahrzeugBody>,
) -> Result<(StatusCode, Json<FahrzeugAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let f = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(f.anzeige())))
}

/// PATCH /api/fahrzeuge/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<FahrzeugBody>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let n = normalisiere(body)?;
    let f = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Namenskollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(f.anzeige()))
}
```

- [ ] **Step 2: Modul + Routen registrieren**

In `src/routes/mod.rs` ergänzen (alphabetisch nach `pub mod etb;`):

```rust
pub mod fahrzeug;
```

In `src/app.rs` im `build_router`, nach dem `stichwort-vorschlaege`-Block, ergänzen (Kette vor dem abschließenden `;` einfügen):

```rust
        .route("/api/fahrzeuge", get(routes::fahrzeug::liste))
        .route("/api/fahrzeuge", post(routes::fahrzeug::anlegen))
        .route("/api/fahrzeug-typen", get(routes::fahrzeug::typen))
        .route("/api/fahrzeuge/{id}", patch(routes::fahrzeug::aktualisieren))
        .route(
            "/api/fahrzeuge/{id}/ausser-dienst",
            post(routes::fahrzeug::ausser_dienst),
        )
        .route(
            "/api/fahrzeuge/{id}/in-dienst",
            post(routes::fahrzeug::in_dienst),
        )
```

- [ ] **Step 3: Integrationstest schreiben (FULL HARNESS — Vorlage für Tasks 9 & 12)**

`tests/fahrzeug.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

// ---------- Harness (identisch zu tests/stichwort.rs) ----------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool, live: LiveHub::new() })
}

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
    assert_eq!(resp.status(), StatusCode::OK);
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

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(methode).uri(uri).header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_fahrzeug_an_alle_lesen_es() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/fahrzeuge", &admin,
        Some(r#"{"funkrufname":"Florian Musterstadt 83/1","fahrzeugtyp":"LF 20","staerke_fuehrer":0,"staerke_unterfuehrer":1,"staerke_mannschaft":8}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian Musterstadt 83/1");
    assert_eq!(json["staerke"]["mannschaft"], 8);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeuge", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeuge", &erika, Some(r#"{"funkrufname":"Verboten 1"}"#),
    ).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_funkrufname_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"funkrufname":"Florian 1"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn unvollstaendige_staerke_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeuge", &admin,
        Some(r#"{"funkrufname":"Florian 1","staerke_fuehrer":0,"staerke_mannschaft":8}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(r#"{"funkrufname":"Florian 1"}"#)).await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(&app, "POST", &format!("/api/fahrzeuge/{id}/ausser-dienst"), &admin, None).await.0,
        StatusCode::OK
    );
    let (_, im_dienst) = anfrage(&app, "GET", "/api/fahrzeuge?nur_im_dienst=true", &admin, None).await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/fahrzeuge", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "PATCH", "/api/fahrzeuge/9999", &admin, Some(r#"{"funkrufname":"X"}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(r#"{"funkrufname":"Florian 1"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    // DELETE existiert nicht → 405 Method Not Allowed (Route ist nur PATCH/POST).
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/fahrzeuge/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
```

- [ ] **Step 4: Tests ausführen**

Run: `cargo test --test fahrzeug`
Expected: PASS (7 Tests). Falls `kein_delete_endpunkt` nicht 405 liefert (Axum-Version), auf 404 anpassen — entscheidend ist nur „kein erfolgreiches Löschen".

- [ ] **Step 5: Commit**

```bash
git add src/routes/fahrzeug.rs src/routes/mod.rs src/app.rs tests/fahrzeug.rs
git commit -m "feat(fahrzeug): Stamm-Routen (Admin-CRUD, Soft-Delete) + Integrationstests"
```

---

## Task 8: `src/fahrzeug/status_repo.rs` — Status-Katalog-CRUD

**Files:**
- Modify (befüllen): `src/fahrzeug/status_repo.rs`

- [ ] **Step 1: Repository schreiben**

`src/fahrzeug/status_repo.rs`:

```rust
use super::FahrzeugStatus;
use crate::error::AppError;
use sqlx::SqlitePool;

const SPALTEN: &str = "id, label, kategorie, farbe, fms_anker, sortier";

/// Editierbare Katalog-Felder (label/kategorie/farbe/fms_anker/sortier).
/// `kategorie` ist bereits gegen das Enum validiert, `fms_anker` im Bereich 0..=9.
#[derive(Debug)]
pub struct StatusDaten<'a> {
    pub label: &'a str,
    pub kategorie: &'a str,
    pub farbe: Option<&'a str>,
    pub fms_anker: Option<i64>,
    pub sortier: i64,
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict("Status-Label ist bereits vorhanden".into()));
        }
    }
    Err(e.into())
}

/// Lädt einen Status der Org; `NotFound` bei fremder/unbekannter id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<FahrzeugStatus, AppError> {
    sqlx::query_as::<_, FahrzeugStatus>(&format!(
        "SELECT {SPALTEN} FROM fahrzeug_status WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Status der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<FahrzeugStatus>, AppError> {
    sqlx::query_as::<_, FahrzeugStatus>(&format!(
        "SELECT {SPALTEN} FROM fahrzeug_status WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    ))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen Status an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: StatusDaten<'_>,
) -> Result<FahrzeugStatus, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fahrzeug_status (org_id, label, kategorie, farbe, fms_anker, sortier) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.label)
    .bind(daten.kategorie)
    .bind(daten.farbe)
    .bind(daten.fms_anker)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound`/`Conflict` analog Stamm.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: StatusDaten<'_>,
) -> Result<FahrzeugStatus, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE fahrzeug_status SET label = ?, kategorie = ?, farbe = ?, fms_anker = ?, sortier = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.kategorie)
    .bind(daten.farbe)
    .bind(daten.fms_anker)
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

/// Deaktiviert einen Status (Soft-Delete `aktiv = 0`); referenzierte Dispositionen
/// bleiben gültig. `NotFound` bei fremder/unbekannter id.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("UPDATE fahrzeug_status SET aktiv = 0 WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// `id` des ersten aktiven Status einer Kategorie (deterministisch nach `sortier`,
/// dann `id`); `None`, wenn die Org keinen solchen aktiven Status hat.
pub async fn erster_der_kategorie(
    pool: &SqlitePool,
    org_id: i64,
    kategorie: &str,
) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id FROM fahrzeug_status \
         WHERE org_id = ? AND aktiv = 1 AND kategorie = ? ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(kategorie)
    .fetch_optional(pool)
    .await
    .map_err(Into::into)
}

/// Ob ein aktiver Status mit dieser id zur Org gehört (PATCH-Disposition-Validierung).
pub async fn ist_in_org(pool: &SqlitePool, org_id: i64, status_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM fahrzeug_status WHERE id = ? AND org_id = ? AND aktiv = 1",
    )
    .bind(status_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fahrzeug::{KATEGORIE_GEBUNDEN, KATEGORIE_VERFUEGBAR};

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten<'a>(label: &'a str, kategorie: &'a str, sortier: i64) -> StatusDaten<'a> {
        StatusDaten { label, kategorie, farbe: None, fms_anker: None, sortier }
    }

    #[tokio::test]
    async fn anlegen_liste_sortiert_nur_aktiv() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("disponiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        anlegen(&pool, 1, daten("einsatzbereit", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();

        let liste = liste(&pool, 1).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].label, "einsatzbereit", "nach sortier");
        assert_eq!(liste[1].label, "disponiert");
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("disponiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("disponiert", KATEGORIE_VERFUEGBAR, 5)).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_und_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let s = anlegen(&pool, 1, daten("alt", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();
        deaktivieren(&pool, 1, s.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty(), "nicht mehr in der aktiven Liste");
        // laden ignoriert aktiv-Flag → Referenz bleibt auflösbar.
        assert_eq!(laden(&pool, 1, s.id).await.unwrap().id, s.id);
    }

    #[tokio::test]
    async fn erster_der_kategorie_deterministisch_und_ohne_deaktivierte() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let frueh = anlegen(&pool, 1, daten("disponiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        anlegen(&pool, 1, daten("anfahrt", KATEGORIE_GEBUNDEN, 30)).await.unwrap();

        assert_eq!(
            erster_der_kategorie(&pool, 1, KATEGORIE_GEBUNDEN).await.unwrap(),
            Some(frueh.id)
        );
        // verfuegbar gibt es nicht → None.
        assert_eq!(erster_der_kategorie(&pool, 1, KATEGORIE_VERFUEGBAR).await.unwrap(), None);

        // erster deaktiviert → nächster nach sortier.
        deaktivieren(&pool, 1, frueh.id).await.unwrap();
        let naechster = erster_der_kategorie(&pool, 1, KATEGORIE_GEBUNDEN).await.unwrap();
        assert!(naechster.is_some() && naechster != Some(frueh.id));
    }

    #[tokio::test]
    async fn ist_in_org_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let s = anlegen(&pool, 1, daten("disponiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(ist_in_org(&pool, 1, s.id).await.unwrap());
        assert!(!ist_in_org(&pool, 2, s.id).await.unwrap(), "fremde Org");
    }
}
```

- [ ] **Step 2: Tests ausführen**

Run: `cargo test --lib fahrzeug::status_repo::`
Expected: PASS (5 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/fahrzeug/status_repo.rs
git commit -m "feat(fahrzeug): Status-Katalog-Repo (CRUD, Deaktivieren, Kategorie-Lookup)"
```

---

## Task 9: `src/routes/fahrzeug_status.rs` — Status-Routen + Integrationstest

**Files:**
- Create: `src/routes/fahrzeug_status.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Test: `tests/fahrzeug_status.rs`

- [ ] **Step 1: Routen-Modul schreiben**

`src/routes/fahrzeug_status.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::fahrzeug::status_repo::{self, StatusDaten};
use crate::fahrzeug::{ist_gueltige_kategorie, FahrzeugStatus};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    pub fms_anker: Option<i64>,
    #[serde(default)]
    pub sortier: i64,
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

struct Normalisiert {
    label: String,
    kategorie: String,
    farbe: Option<String>,
    fms_anker: Option<i64>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> StatusDaten<'_> {
        StatusDaten {
            label: &self.label,
            kategorie: &self.kategorie,
            farbe: self.farbe.as_deref(),
            fms_anker: self.fms_anker,
            sortier: self.sortier,
        }
    }
}

fn normalisiere(body: StatusBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    if !ist_gueltige_kategorie(&body.kategorie) {
        return Err(AppError::Validation("Ungültige Kategorie".into()));
    }
    if let Some(f) = body.fms_anker {
        if !(0..=9).contains(&f) {
            return Err(AppError::Validation("FMS-Anker muss zwischen 0 und 9 liegen".into()));
        }
    }
    Ok(Normalisiert {
        label,
        kategorie: body.kategorie,
        farbe: trimme(body.farbe),
        fms_anker: body.fms_anker,
        sortier: body.sortier,
    })
}

/// GET /api/fahrzeug-status — aktive Katalog-Einträge (eigene Org), für Dropdowns.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<FahrzeugStatus>>, AppError> {
    Ok(Json(status_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/fahrzeug-status — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<StatusBody>,
) -> Result<(StatusCode, Json<FahrzeugStatus>), AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(s)))
}

/// PATCH /api/fahrzeug-status/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<StatusBody>,
) -> Result<Json<FahrzeugStatus>, AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(s))
}

/// POST /api/fahrzeug-status/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    status_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Modul + Routen registrieren**

In `src/routes/mod.rs` ergänzen (nach `pub mod fahrzeug;`):

```rust
pub mod fahrzeug_status;
```

In `src/app.rs` im `build_router`, nach den Fahrzeug-Stamm-Routen, ergänzen:

```rust
        .route("/api/fahrzeug-status", get(routes::fahrzeug_status::liste))
        .route("/api/fahrzeug-status", post(routes::fahrzeug_status::anlegen))
        .route(
            "/api/fahrzeug-status/{id}",
            patch(routes::fahrzeug_status::aktualisieren),
        )
        .route(
            "/api/fahrzeug-status/{id}/deaktivieren",
            post(routes::fahrzeug_status::deaktivieren),
        )
```

- [ ] **Step 3: Integrationstest schreiben**

`tests/fahrzeug_status.rs` — beginne mit **demselben Harness-Block wie `tests/fahrzeug.rs`** (Step 3, Task 7: `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`), dann:

```rust
// ---------- Tests ----------

#[tokio::test]
async fn bootstrap_seedet_status_katalog() {
    // bootstrap_admin seedet den Default-Katalog → GET liefert die 8 Stati.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json.as_array().unwrap().iter().map(|s| s["label"].as_str().unwrap()).collect();
    assert!(labels.contains(&"einsatzbereit"));
    assert!(labels.contains(&"disponiert"));
    assert_eq!(json.as_array().unwrap().len(), 8);
}

#[tokio::test]
async fn alle_lesen_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Nicht-Admin liest (für Dropdowns), darf aber nicht anlegen.
    assert_eq!(anfrage(&app, "GET", "/api/fahrzeug-status", &erika, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &erika,
        Some(r#"{"label":"X","kategorie":"gebunden"}"#),
    ).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar","sortier":90}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn ungueltige_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"X","kategorie":"unsinn"}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fms_anker_ausserhalb_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"X","kategorie":"gebunden","fms_anker":12}"#),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // 'disponiert' existiert bereits aus dem Seed.
    let (status, _) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"disponiert","kategorie":"gebunden"}"#),
    ).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app, "POST", "/api/fahrzeug-status", &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#),
    ).await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(&app, "POST", &format!("/api/fahrzeug-status/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    let labels: Vec<&str> = liste.as_array().unwrap().iter().map(|s| s["label"].as_str().unwrap()).collect();
    assert!(!labels.contains(&"Reserve"));
}
```

- [ ] **Step 4: Tests ausführen**

Run: `cargo test --test fahrzeug_status`
Expected: PASS (6 Tests). `bootstrap_seedet_status_katalog` schlägt fehl, bis Task 10 das Seeding ergänzt — **das ist beabsichtigt** (dieser Test treibt Task 10). Führe Task 10 unmittelbar danach aus; alternativ markiere diesen einen Test temporär `#[ignore]` und aktiviere ihn in Task 10.

> **Reihenfolge-Hinweis:** Strikt-TDD-konform gehört der Seeding-Test zu Task 10. Hier belassen, weil er die Status-Routen integrativ prüft. Wenn du Tasks isoliert grün haben willst, verschiebe nur `bootstrap_seedet_status_katalog` nach Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fahrzeug_status.rs src/routes/mod.rs src/app.rs tests/fahrzeug_status.rs
git commit -m "feat(fahrzeug): Status-Katalog-Routen (Admin-CRUD, Deaktivieren) + Tests"
```

---

## Task 10: Bootstrap seedet Status-Katalog für neue Orgs

**Files:**
- Modify: `src/auth/bootstrap.rs`

Migration 0008 seedet die **bestehende** Org; `bootstrap_admin` muss **neue** Orgs seeden (gleiche Werte aus `STATUS_STARTLISTE`).

- [ ] **Step 1: Failing test schreiben**

In `src/auth/bootstrap.rs`, `#[cfg(test)] mod tests`, einfügen:

```rust
    #[tokio::test]
    async fn seedet_status_katalog_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12"))
            .await
            .unwrap();

        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM fahrzeug_status ORDER BY sortier",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(labels.len(), 8, "acht Default-Status erwartet");
        assert_eq!(labels.first().map(String::as_str), Some("einsatzbereit"));

        // 'disponiert' ist als 'gebunden' geseedet (Initial-Status der Disposition).
        let kat: String = sqlx::query_scalar(
            "SELECT kategorie FROM fahrzeug_status WHERE label = 'disponiert'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kat, "gebunden");
    }
```

- [ ] **Step 2: Test ausführen (erwartet FAIL)**

Run: `cargo test --lib auth::bootstrap::tests::seedet_status_katalog_fuer_neue_org`
Expected: FAIL — `labels.len()` ist 0 (Bootstrap seedet noch keine Status).

- [ ] **Step 3: Seeding einbauen**

In `src/auth/bootstrap.rs` oben den Import ergänzen:

```rust
use crate::fahrzeug::STATUS_STARTLISTE;
```

Im `bootstrap_admin`, **innerhalb der Transaktion** direkt nach der `STICHWORT_STARTLISTE`-Schleife (vor `tx.commit().await?;`), einfügen:

```rust
    for (label, kategorie, fms_anker, sortier) in STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(fms_anker)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }
```

- [ ] **Step 4: Tests ausführen (erwartet PASS)**

Run: `cargo test --lib auth::bootstrap::`
Expected: PASS (alle Bootstrap-Tests, inkl. neuem Seed-Test).

Run zusätzlich: `cargo test --test fahrzeug_status bootstrap_seedet_status_katalog`
Expected: PASS (der in Task 9 eingeführte Integrationstest ist jetzt grün; falls dort `#[ignore]` gesetzt wurde, entfernen).

- [ ] **Step 5: Commit**

```bash
git add src/auth/bootstrap.rs
git commit -m "feat(fahrzeug): Bootstrap seedet Status-Default-Katalog für neue Orgs"
```

---

## Task 11: `src/fahrzeug/disposition_repo.rs` — Disposition (Snapshot, Auflösung, Org-Isolation)

Reine DB-Schicht: schreibt die `einsatz_fahrzeug`-Zeile, **schreibt aber keinen ETB-Eintrag** (das orchestriert der Handler in Task 12, sequentiell). Org-Isolation wird hier durchgesetzt (`org_id` des Einsatzes wird übergeben).

**Files:**
- Modify (befüllen): `src/fahrzeug/disposition_repo.rs`

- [ ] **Step 1: Repository schreiben**

`src/fahrzeug/disposition_repo.rs`:

```rust
use super::{status_repo, EinsatzFahrzeugAnzeige, DIENSTSTATUS_IN_DIENST, KATEGORIE_GEBUNDEN};
use crate::error::AppError;
use sqlx::SqlitePool;

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN fahrzeug) und Status (LEFT JOIN
/// fahrzeug_status). Die Wahl Live vs. Snapshot trifft `zu_anzeige` mit `einsatz_aktiv`.
const SELECT_AUFGELOEST: &str = "\
    SELECT ef.id, ef.einsatz_id, ef.fahrzeug_id, ef.status_id, \
           ef.snap_funkrufname, ef.snap_kennzeichen, ef.snap_fahrzeugtyp, ef.snap_opta, \
           ef.snap_traegerorganisation, ef.bemerkung, ef.disponiert_at, ef.disponiert_von, \
           f.funkrufname AS live_funkrufname, f.kennzeichen AS live_kennzeichen, \
           f.fahrzeugtyp AS live_fahrzeugtyp, f.opta AS live_opta, \
           f.traegerorganisation AS live_traegerorganisation, f.dienststatus AS live_dienststatus, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe \
    FROM einsatz_fahrzeug ef \
    LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
    LEFT JOIN fahrzeug_status s ON s.id = ef.status_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    fahrzeug_id: Option<i64>,
    status_id: Option<i64>,
    snap_funkrufname: String,
    snap_kennzeichen: Option<String>,
    snap_fahrzeugtyp: Option<String>,
    snap_opta: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_funkrufname: Option<String>,
    live_kennzeichen: Option<String>,
    live_fahrzeugtyp: Option<String>,
    live_opta: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    status_label: Option<String>,
    status_kategorie: Option<String>,
    status_farbe: Option<String>,
}

/// Auflösungsregel: Live-Felder aus dem Stamm nur, wenn ein Stamm-Bezug besteht,
/// der Einsatz aktiv ist UND das Fahrzeug noch in Dienst ist. Sonst Snapshot.
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzFahrzeugAnzeige {
    let live = row.fahrzeug_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger) = if live {
        (
            row.live_funkrufname.clone().unwrap_or_else(|| row.snap_funkrufname.clone()),
            row.live_kennzeichen,
            row.live_fahrzeugtyp,
            row.live_opta,
            row.live_traegerorganisation,
        )
    } else {
        (
            row.snap_funkrufname,
            row.snap_kennzeichen,
            row.snap_fahrzeugtyp,
            row.snap_opta,
            row.snap_traegerorganisation,
        )
    };

    EinsatzFahrzeugAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        fahrzeug_id: row.fahrzeug_id,
        ist_adhoc: row.fahrzeug_id.is_none(),
        funkrufname,
        kennzeichen,
        fahrzeugtyp,
        opta,
        traegerorganisation: traeger,
        status_id: row.status_id,
        status_label: row.status_label,
        status_kategorie: row.status_kategorie,
        status_farbe: row.status_farbe,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für ein Ad-hoc-externes Fahrzeug (kein Stamm-Bezug); bereits getrimmt.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub kennzeichen: Option<&'a str>,
    pub opta: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
}

/// Disponierte Fahrzeuge eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzFahrzeugAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ef.einsatz_id = ? ORDER BY ef.disponiert_at, ef.id"
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
    ef_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzFahrzeugAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ef.id = ? AND ef.einsatz_id = ?"
    ))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert ein Stamm-Fahrzeug. Prüft Org-Zugehörigkeit + Dienststatus, friert
/// den Identitäts-Schnappschuss ein und setzt den ersten `gebunden`-Status.
/// `NotFound` bei fremdem/unbekanntem Fahrzeug, `Validation` bei außer Dienst,
/// `Conflict` bei Doppel-Disposition. Liefert die neue `ef_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    fahrzeug_id: i64,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, Option<String>, Option<String>, Option<String>, String)>(
        "SELECT funkrufname, kennzeichen, fahrzeugtyp, opta, traegerorganisation, dienststatus \
         FROM fahrzeug WHERE id = ? AND org_id = ?",
    )
    .bind(fahrzeug_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let (funkrufname, kennzeichen, fahrzeugtyp, opta, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Fahrzeug ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }

    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, snap_funkrufname, snap_kennzeichen, \
             snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(fahrzeug_id)
    .bind(status_id)
    .bind(&funkrufname)
    .bind(&kennzeichen)
    .bind(&fahrzeugtyp)
    .bind(&opta)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await;

    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Fahrzeug ist bereits in diesem Einsatz disponiert".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Disponiert ein Ad-hoc-externes Fahrzeug (`fahrzeug_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Initial-Status = erster `gebunden`. Liefert die neue `ef_id`.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_fahrzeug \
            (einsatz_id, fahrzeug_id, status_id, snap_funkrufname, snap_kennzeichen, \
             snap_fahrzeugtyp, snap_opta, snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.funkrufname)
    .bind(daten.kennzeichen)
    .bind(daten.fahrzeugtyp)
    .bind(daten.opta)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Aktualisiert Status und/oder Bemerkung einer Dispositionszeile (COALESCE: `None`
/// = unverändert lassen). `NotFound`, falls die Zeile nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    ef_id: i64,
    status_id: Option<i64>,
    bemerkung: Option<&str>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_fahrzeug \
         SET status_id = COALESCE(?, status_id), bemerkung = COALESCE(?, bemerkung) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(status_id)
    .bind(bemerkung)
    .bind(ef_id)
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
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, ef_id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("DELETE FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
        .bind(ef_id)
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
    use crate::fahrzeug::repo::{self as fz_repo, FahrzeugDaten};
    use crate::fahrzeug::status_repo::{self, StatusDaten};
    use crate::fahrzeug::KATEGORIE_GEBUNDEN;

    /// Org(1) + Benutzer + Einsatz + ein 'gebunden'-Status; liefert (benutzer, einsatz).
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
        status_repo::anlegen(pool, 1, StatusDaten {
            label: "disponiert", kategorie: KATEGORIE_GEBUNDEN, farbe: None, fms_anker: Some(3), sortier: 20,
        }).await.unwrap();
        (benutzer, einsatz)
    }

    fn fz_daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname, fahrzeugtyp: Some("LF 20"), traegerorganisation: None,
            kennzeichen: Some("XX-AB 1"), opta: None, standort: None, fms_issi: None,
            sondersignal: false, tragenkapazitaet: None, staerke: None, bemerkung: None,
        }
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_und_gebunden_status() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();

        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.funkrufname, "Florian 1");
        assert_eq!(a.kennzeichen.as_deref(), Some("XX-AB 1"));
        assert_eq!(a.status_kategorie.as_deref(), Some("gebunden"));
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn disponiere_stamm_doppelt_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool).await.unwrap();
        let fremd_fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'Fremd 1') RETURNING id",
        ).fetch_one(&pool).await.unwrap();
        // Org-Isolation: Einsatz gehört Org 1, Fahrzeug Org 2.
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd_fz, benutzer).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_und_ist_adhoc() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["FW Extern 1", "FW Extern 2"] {
            disponiere_adhoc(&pool, einsatz, 1, AdhocDaten {
                funkrufname: name, fahrzeugtyp: None, kennzeichen: None, opta: None,
                traegerorganisation: Some("Feuerwehr"),
            }, benutzer).await.unwrap();
        }
        let liste = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|a| a.ist_adhoc && a.fahrzeug_id.is_none()));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();

        // Stamm nachträglich umbenennen.
        let mut neu = fz_daten("Florian 1 NEU");
        neu.kennzeichen = Some("XX-AB 1");
        fz_repo::aktualisiere(&pool, 1, fz.id, neu).await.unwrap();

        // Aktiver Einsatz → Live (zeigt neuen Namen).
        let live = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(live.funkrufname, "Florian 1 NEU");

        // „Abgeschlossener" Einsatz (einsatz_aktiv=false) → Snapshot (alter Name).
        let snap = laden_anzeige(&pool, einsatz, ef, false).await.unwrap();
        assert_eq!(snap.funkrufname, "Florian 1");

        // Stamm außer Dienst → auch bei aktivem Einsatz Snapshot.
        fz_repo::setze_dienststatus(&pool, 1, fz.id, false).await.unwrap();
        let nach_ad = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(nach_ad.funkrufname, "Florian 1", "außer Dienst → Snapshot trotz aktivem Einsatz");
    }

    #[tokio::test]
    async fn aktualisiere_status_und_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let fz = fz_repo::anlegen(&pool, 1, fz_daten("Florian 1")).await.unwrap();
        let ef = disponiere_stamm(&pool, einsatz, 1, fz.id, benutzer).await.unwrap();
        let neuer_status = status_repo::anlegen(&pool, 1, StatusDaten {
            label: "vor_ort", kategorie: KATEGORIE_GEBUNDEN, farbe: None, fms_anker: Some(4), sortier: 40,
        }).await.unwrap();

        aktualisiere(&pool, einsatz, ef, Some(neuer_status.id), Some("am Einsatzort")).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer_status.id));
        assert_eq!(a.bemerkung.as_deref(), Some("am Einsatzort"));

        // Nur Bemerkung ändern (status_id None → bleibt).
        aktualisiere(&pool, einsatz, ef, None, Some("korrigiert")).await.unwrap();
        let b = laden_anzeige(&pool, einsatz, ef, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer_status.id), "Status unverändert");
        assert_eq!(b.bemerkung.as_deref(), Some("korrigiert"));

        entferne(&pool, einsatz, ef).await.unwrap();
        assert!(matches!(laden_anzeige(&pool, einsatz, ef, true).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 2: Tests ausführen**

Run: `cargo test --lib fahrzeug::disposition_repo::`
Expected: PASS (7 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/fahrzeug/disposition_repo.rs
git commit -m "feat(fahrzeug): Dispositions-Repo (Snapshot, Live-Auflösung, Org-Isolation)"
```

---

## Task 12: `src/routes/einsatz_fahrzeug.rs` — Dispositions-Routen + ETB-Integration

Orchestriert Gates (`fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv`), Disposition und den **sequentiellen** ETB-Eintrag (`typ='system'`). Vorbild für Struktur & SSE-Publish: `src/routes/etb.rs`.

**Files:**
- Create: `src/routes/einsatz_fahrzeug.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Test: `tests/einsatz_fahrzeug.rs`

- [ ] **Step 1: Routen-Modul schreiben**

`src/routes/einsatz_fahrzeug.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::fahrzeug::disposition_repo::{self, AdhocDaten};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag für die handelnde Person und
/// publiziert ihn live (wie `routes::etb::erfassen`). Bewusst sequentiell nach der
/// Disposition (Entscheidung 4 der Spec: ETB = zusätzliche, append-only Spur).
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

/// GET /api/einsaetze/{id}/fahrzeuge — disponierte Fahrzeuge (aufgelöst). Nur Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub fahrzeug_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/fahrzeuge — Stamm-Fahrzeug disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let ef_id = match (body.fahrzeug_id, body.adhoc) {
        (Some(fahrzeug_id), None) => {
            disposition_repo::disponiere_stamm(
                &state.pool, einsatz_id, einsatz.org_id, fahrzeug_id, benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let funkrufname = adhoc.funkrufname.trim().to_string();
            if funkrufname.is_empty() {
                return Err(AppError::Validation("Funkrufname darf nicht leer sein".into()));
            }
            let fahrzeugtyp = trimme(adhoc.fahrzeugtyp);
            let kennzeichen = trimme(adhoc.kennzeichen);
            let opta = trimme(adhoc.opta);
            let traeger = trimme(adhoc.traegerorganisation);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    funkrufname: &funkrufname,
                    fahrzeugtyp: fahrzeugtyp.as_deref(),
                    kennzeichen: kennzeichen.as_deref(),
                    opta: opta.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» disponiert", anzeige.funkrufname),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // Bemerkung im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert lassen (COALESCE im Repo). Daher NICHT über `trimme` zu None kollabieren,
    // sonst ließe sich eine Bemerkung nie löschen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(&state.pool, einsatz_id, ef_id, body.status_id, bemerkung)
        .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Fahrzeug «{}»: Status «{}» → «{}»", nachher.funkrufname, alt, neu),
        )
        .await?;
    }
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ef_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» aus dem Einsatz entfernt", anzeige.funkrufname),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Modul + Routen registrieren**

In `src/routes/mod.rs` ergänzen (nach `pub mod einsatz;`):

```rust
pub mod einsatz_fahrzeug;
```

In `src/app.rs` im `build_router`, bei den `einsaetze/{id}`-Routen (z. B. nach dem ETB-Stream-Block), ergänzen:

```rust
        .route(
            "/api/einsaetze/{id}/fahrzeuge",
            get(routes::einsatz_fahrzeug::liste),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge",
            post(routes::einsatz_fahrzeug::disponieren),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}",
            patch(routes::einsatz_fahrzeug::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}",
            delete(routes::einsatz_fahrzeug::entfernen),
        )
```

- [ ] **Step 3: Integrationstest schreiben**

`tests/einsatz_fahrzeug.rs` — beginne mit **demselben Harness-Block wie `tests/fahrzeug.rs`** (`setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`), ergänze diese zwei Helfer, dann die Tests:

```rust
// ---------- Zusatz-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Weist einem Benutzer eine Einsatz-Rolle zu (durch die Einsatzleitung).
async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::OK);
}

/// Legt ein Stamm-Fahrzeug an (Admin) und liefert dessen id.
async fn fahrzeug_anlegen(app: &axum::Router, admin: &str, funkrufname: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/fahrzeuge", admin,
        Some(&format!(r#"{{"funkrufname":"{funkrufname}","kennzeichen":"XX-AB 1"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Zählt ETB-Einträge mit typ='system'.
async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system").count()
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_setzt_status_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await; // Admin = Einsatzleitung des selbst angelegten Einsatzes
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian 1");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "Disponieren schreibt 1 System-ETB");
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let body = format!(r#"{{"fahrzeug_id":{fz}}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&body)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn adhoc_disposition_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["fahrzeug_id"].is_null());
}

#[tokio::test]
async fn beobachter_darf_lesen_aber_nicht_disponieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen erlaubt.
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &erika, None).await.0, StatusCode::OK);
    // Disponieren verboten.
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &erika, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fuehrungspersonal_darf_disponieren_nicht_mitglied_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    // Führungspersonal darf.
    let f_id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, f_id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &fritz, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await.0,
        StatusCode::CREATED
    );

    // Nicht-Mitglied (ohne höhere Berechtigung) darf weder lesen noch schreiben.
    benutzer_anlegen(&app, &admin, "norbert", "keine").await;
    let norbert = login_cookie(&app, "norbert", "norbertpw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &norbert, None).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);

    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    let ef = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('vor_ort').
    let (_, stati) = anfrage(&app, "GET", "/api/fahrzeug-status", &admin, None).await;
    let vor_ort = stati.as_array().unwrap().iter().find(|s| s["label"] == "vor_ort").unwrap()["id"].as_i64().unwrap();

    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(&format!(r#"{{"status_id":{vor_ort}}}"#))).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Disponieren + Status-Wechsel + Entfernen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn bemerkung_setzen_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/fahrzeuge"), &admin, Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))).await;
    let ef = json["id"].as_i64().unwrap();

    // Setzen.
    let (_, gesetzt) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(r#"{"bemerkung":"Tank halb"}"#)).await;
    assert_eq!(gesetzt["bemerkung"], "Tank halb");

    // Leeren: leerer String überschreibt (Wert verschwindet), statt „unverändert" zu lassen.
    // COALESCE('', bemerkung) ergibt '' (nicht NULL) — entscheidend ist, dass der alte
    // Wert NICHT persistiert. Das Frontend rendert '' als „—".
    let (_, geleert) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"), &admin, Some(r#"{"bemerkung":""}"#)).await;
    assert_eq!(geleert["bemerkung"], "", "leere Bemerkung darf den alten Wert nicht behalten");

    // status_id absent → Status bleibt; eine reine Bemerkung-Änderung schreibt KEINEN ETB.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1, "nur die Disposition selbst");
}
```

- [ ] **Step 4: Tests ausführen**

Run: `cargo test --test einsatz_fahrzeug`
Expected: PASS (8 Tests).

- [ ] **Step 5: Volle Backend-Suite + Commit**

Run: `cargo test` — Expected: alle grün.

```bash
git add src/routes/einsatz_fahrzeug.rs src/routes/mod.rs src/app.rs tests/einsatz_fahrzeug.rs
git commit -m "feat(fahrzeug): Dispositions-Routen mit System-ETB-Einträgen + Integrationstests"
```

---

## Task 13: Frontend-Typen + API-Module

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/fahrzeuge.ts`, `frontend/src/api/fahrzeugStatus.ts`, `frontend/src/api/einsatzFahrzeuge.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` am Ende anhängen:

```typescript
export type Dienststatus = 'in_dienst' | 'ausser_dienst';
export type StatusKategorie = 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar';

/** Taktische Stärke (F/UF/M); Gesamt = Summe (Frontend berechnet bei Bedarf). */
export interface Staerke {
  fuehrer: number;
  unterfuehrer: number;
  mannschaft: number;
}

export interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
  traegerorganisation: string | null;
  kennzeichen: string | null;
  opta: string | null;
  standort: string | null;
  fms_issi: string | null;
  sondersignal: boolean;
  tragenkapazitaet: number | null;
  staerke: Staerke | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
}

export interface FahrzeugStatus {
  id: number;
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}

/** Aufgelöste Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzFahrzeug {
  id: number;
  einsatz_id: number;
  fahrzeug_id: number | null;
  ist_adhoc: boolean;
  funkrufname: string;
  kennzeichen: string | null;
  fahrzeugtyp: string | null;
  opta: string | null;
  traegerorganisation: string | null;
  status_id: number | null;
  status_label: string | null;
  status_kategorie: StatusKategorie | null;
  status_farbe: string | null;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
}
```

- [ ] **Step 2: `api/fahrzeuge.ts`**

```typescript
import type { Fahrzeug } from './types';
import { apiGet, apiSend } from './client';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
export interface FahrzeugEingabe {
  funkrufname: string;
  fahrzeugtyp: string | null;
  traegerorganisation: string | null;
  kennzeichen: string | null;
  opta: string | null;
  standort: string | null;
  fms_issi: string | null;
  sondersignal: boolean;
  tragenkapazitaet: number | null;
  staerke_fuehrer: number | null;
  staerke_unterfuehrer: number | null;
  staerke_mannschaft: number | null;
  bemerkung: string | null;
}

export function listeFahrzeuge(nurImDienst = false): Promise<Fahrzeug[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Fahrzeug[]>(`/api/fahrzeuge${qs}`);
}

export function ladeFahrzeugTypen(): Promise<string[]> {
  return apiGet<string[]>('/api/fahrzeug-typen');
}

export function legeFahrzeugAn(daten: FahrzeugEingabe): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>('/api/fahrzeuge', 'POST', daten);
}

export function aktualisiereFahrzeug(id: number, daten: FahrzeugEingabe): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Fahrzeug> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}/${pfad}`, 'POST');
}
```

- [ ] **Step 3: `api/fahrzeugStatus.ts`**

```typescript
import type { FahrzeugStatus, StatusKategorie } from './types';
import { apiGet, apiSend } from './client';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}

export function listeFahrzeugStatus(): Promise<FahrzeugStatus[]> {
  return apiGet<FahrzeugStatus[]>('/api/fahrzeug-status');
}

export function legeStatusAn(daten: StatusEingabe): Promise<FahrzeugStatus> {
  return apiSend<FahrzeugStatus>('/api/fahrzeug-status', 'POST', daten);
}

export function aktualisiereStatus(id: number, daten: StatusEingabe): Promise<FahrzeugStatus> {
  return apiSend<FahrzeugStatus>(`/api/fahrzeug-status/${id}`, 'PATCH', daten);
}

export function deaktiviereStatus(id: number): Promise<void> {
  return apiSend<void>(`/api/fahrzeug-status/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 4: `api/einsatzFahrzeuge.ts`**

```typescript
import type { EinsatzFahrzeug } from './types';
import { apiGet, apiSend } from './client';

export interface AdhocEingabe {
  funkrufname: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  opta?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/einsaetze/${einsatzId}/fahrzeuge`);
}

export function disponiereFahrzeug(einsatzId: number, fahrzeugId: number): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge`, 'POST', {
    fahrzeug_id: fahrzeugId,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge`, 'POST', { adhoc });
}

export function aktualisiereDisposition(
  einsatzId: number,
  efId: number,
  felder: { status_id?: number; bemerkung?: string },
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/fahrzeuge/${efId}`, 'DELETE');
}
```

- [ ] **Step 5: Typecheck + Commit**

Run: `cd frontend && npm run typecheck`
Expected: keine Fehler.

```bash
git add frontend/src/api/types.ts frontend/src/api/fahrzeuge.ts frontend/src/api/fahrzeugStatus.ts frontend/src/api/einsatzFahrzeuge.ts
git commit -m "feat(fahrzeug): Frontend-Typen + API-Module (Stamm, Status, Disposition)"
```

---

## Task 14: StammdatenPage → Tab-Layout (Stichwort-Block extrahieren)

Reines Refactoring **ohne** Verhaltensänderung: bestehender Stichwort-Block wandert in `StichworteTab.tsx`, `StammdatenPage` wird ein `Tabs`-Container. Die bestehenden Tests bleiben grün (Stichworte ist der Default-Tab; antd v5 mountet nur den aktiven Tab → keine zusätzlichen API-Mocks nötig).

**Files:**
- Create: `frontend/src/stammdaten/StichworteTab.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: `StichworteTab.tsx` anlegen (Inhalt aus der bisherigen Seite, ohne äußeres `div`/Titel/Platzhalter)**

`frontend/src/stammdaten/StichworteTab.tsx`:

```tsx
import { App, Button, Input, List, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';

export default function StichworteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerText, setNeuerText] = useState('');

  const vorschlaegeQuery = useQuery({
    queryKey: ['stichwort-vorschlaege'],
    queryFn: listeStichwortVorschlaege,
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] });
      setNeuerText('');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  function hinzufuegen() {
    const text = neuerText.trim();
    if (text) anlegenMutation.mutate(text);
  }

  const vorschlaege = vorschlaegeQuery.data ?? [];

  return (
    <>
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im
        Einsatz unabhängig davon möglich.
      </Typography.Paragraph>

      <List
        bordered
        dataSource={vorschlaege}
        locale={{ emptyText: 'Noch keine Stichworte' }}
        renderItem={(v) => (
          <List.Item
            actions={
              istAdmin
                ? [
                    <Button
                      key="del"
                      danger
                      size="small"
                      loading={loeschenMutation.isPending}
                      onClick={() => loeschenMutation.mutate(v.id)}
                    >
                      Löschen
                    </Button>,
                  ]
                : []
            }
          >
            {v.text}
          </List.Item>
        )}
      />

      {istAdmin && (
        <Space.Compact style={{ marginTop: 12, width: '100%' }}>
          <Input
            value={neuerText}
            onChange={(e) => setNeuerText(e.target.value)}
            onPressEnter={hinzufuegen}
            placeholder="Neues Stichwort, z. B. H1Y"
          />
          <Button type="primary" loading={anlegenMutation.isPending} onClick={hinzufuegen}>
            Hinzufügen
          </Button>
        </Space.Compact>
      )}
    </>
  );
}
```

- [ ] **Step 2: `StammdatenPage.tsx` auf Tabs umstellen (vorerst nur Stichworte-Tab)**

`frontend/src/pages/StammdatenPage.tsx` vollständig ersetzen durch:

```tsx
import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';

export default function StammdatenPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>
      <Tabs
        defaultActiveKey="stichworte"
        items={[
          { key: 'stichworte', label: 'Einsatz-Stichworte', children: <StichworteTab /> },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Bestehende Tests ausführen**

Run: `cd frontend && npx vitest run src/pages/StammdatenPage.test.tsx`
Expected: PASS (Titel „Stammdaten", „H1", „Hinzufügen"/„Löschen" weiterhin sichtbar — Stichworte ist Default-Tab). Falls ein Test scheitert, weil „Einsatz-Stichworte" jetzt ein Tab-Label statt Überschrift ist: der Test prüft das nicht — keine Anpassung nötig.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stammdaten/StichworteTab.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "refactor(fe): StammdatenPage auf Tab-Layout (Stichworte-Tab extrahiert)"
```

---

## Task 15: Stammdaten-Tabs „Fahrzeuge" und „Fahrzeug-Status"

**Files:**
- Create: `frontend/src/stammdaten/FahrzeugFormModal.tsx`, `frontend/src/stammdaten/FahrzeugeTab.tsx`, `frontend/src/stammdaten/StatusKatalogTab.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`
- Test: `frontend/src/stammdaten/FahrzeugeTab.test.tsx`, `frontend/src/stammdaten/StatusKatalogTab.test.tsx`

- [ ] **Step 1: `FahrzeugFormModal.tsx` (Anlegen/Bearbeiten, Stärke mit Live-Gesamt)**

`frontend/src/stammdaten/FahrzeugFormModal.tsx`:

```tsx
import { App, AutoComplete, Form, Input, InputNumber, Modal, Space, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereFahrzeug, legeFahrzeugAn, type FahrzeugEingabe } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';

interface FormWerte {
  funkrufname: string;
  fahrzeugtyp?: string;
  traegerorganisation?: string;
  kennzeichen?: string;
  opta?: string;
  standort?: string;
  fms_issi?: string;
  sondersignal: boolean;
  tragenkapazitaet?: number;
  staerke_fuehrer?: number;
  staerke_unterfuehrer?: number;
  staerke_mannschaft?: number;
  bemerkung?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function FahrzeugFormModal({
  offen,
  fahrzeug,
  typVorschlaege,
  onClose,
}: {
  offen: boolean;
  fahrzeug: Fahrzeug | null; // null = neu
  typVorschlaege: string[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  useEffect(() => {
    if (!offen) return;
    if (fahrzeug) {
      form.setFieldsValue({
        funkrufname: fahrzeug.funkrufname,
        fahrzeugtyp: fahrzeug.fahrzeugtyp ?? undefined,
        traegerorganisation: fahrzeug.traegerorganisation ?? undefined,
        kennzeichen: fahrzeug.kennzeichen ?? undefined,
        opta: fahrzeug.opta ?? undefined,
        standort: fahrzeug.standort ?? undefined,
        fms_issi: fahrzeug.fms_issi ?? undefined,
        sondersignal: fahrzeug.sondersignal,
        tragenkapazitaet: fahrzeug.tragenkapazitaet ?? undefined,
        staerke_fuehrer: fahrzeug.staerke?.fuehrer,
        staerke_unterfuehrer: fahrzeug.staerke?.unterfuehrer,
        staerke_mannschaft: fahrzeug.staerke?.mannschaft,
        bemerkung: fahrzeug.bemerkung ?? undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ sondersignal: false });
    }
  }, [offen, fahrzeug, form]);

  const sf = Form.useWatch('staerke_fuehrer', form);
  const su = Form.useWatch('staerke_unterfuehrer', form);
  const sm = Form.useWatch('staerke_mannschaft', form);
  const gesamt = sf != null && su != null && sm != null ? sf + su + sm : null;

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: FahrzeugEingabe = {
        funkrufname: werte.funkrufname.trim(),
        fahrzeugtyp: leerZuNull(werte.fahrzeugtyp),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        kennzeichen: leerZuNull(werte.kennzeichen),
        opta: leerZuNull(werte.opta),
        standort: leerZuNull(werte.standort),
        fms_issi: leerZuNull(werte.fms_issi),
        sondersignal: werte.sondersignal ?? false,
        tragenkapazitaet: werte.tragenkapazitaet ?? null,
        staerke_fuehrer: werte.staerke_fuehrer ?? null,
        staerke_unterfuehrer: werte.staerke_unterfuehrer ?? null,
        staerke_mannschaft: werte.staerke_mannschaft ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
      };
      return fahrzeug ? aktualisiereFahrzeug(fahrzeug.id, daten) : legeFahrzeugAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fahrzeuge'] });
      qc.invalidateQueries({ queryKey: ['fahrzeug-typen'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  return (
    <Modal
      open={offen}
      title={fahrzeug ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnClose
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item
          label="Funkrufname"
          name="funkrufname"
          rules={[{ required: true, whitespace: true, message: 'Funkrufname darf nicht leer sein' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp">
          <AutoComplete
            options={typVorschlaege.map((t) => ({ value: t }))}
            allowClear
            placeholder="z. B. LF 20, RTW"
            filterOption={(input, option) =>
              (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input /></Form.Item>
        <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
        <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
        <Form.Item label="Standort" name="standort"><Input /></Form.Item>
        <Form.Item label="FMS-ISSI" name="fms_issi"><Input /></Form.Item>
        <Form.Item label="Sonder-/Wegerecht" name="sondersignal" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="Tragenkapazität" name="tragenkapazitaet">
          <InputNumber min={0} style={{ width: 160 }} />
        </Form.Item>
        <Typography.Text type="secondary">Soll-Stärke (alle drei oder keiner)</Typography.Text>
        <Space style={{ display: 'flex', marginTop: 8 }} align="end">
          <Form.Item label="Führer" name="staerke_fuehrer"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
          <Form.Item label="Unterführer" name="staerke_unterfuehrer"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
          <Form.Item label="Mannschaft" name="staerke_mannschaft"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
          <div style={{ paddingBottom: 24 }}>= Gesamt: <strong>{gesamt ?? '—'}</strong></div>
        </Space>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 2: `FahrzeugeTab.tsx` (Tabelle + Aktionen)**

`frontend/src/stammdaten/FahrzeugeTab.tsx`:

```tsx
import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeFahrzeugTypen, listeFahrzeuge, setzeDienststatus } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';
import FahrzeugFormModal from './FahrzeugFormModal';

function staerkeText(f: Fahrzeug): string {
  if (!f.staerke) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = f.staerke;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}/${fuehrer + unterfuehrer + mannschaft}`;
}

export default function FahrzeugeTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Fahrzeug | null>(null);

  const fahrzeugeQuery = useQuery({ queryKey: ['fahrzeuge', 'alle'], queryFn: () => listeFahrzeuge(false) });
  const typenQuery = useQuery({ queryKey: ['fahrzeug-typen'], queryFn: ladeFahrzeugTypen });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fahrzeuge'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Fahrzeug> = [
    { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'fahrzeugtyp', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Stärke', key: 'staerke', render: (_, f) => staerkeText(f) },
    {
      title: 'Status',
      key: 'dienststatus',
      render: (_, f) =>
        f.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, f: Fahrzeug) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(f); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                {f.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    onConfirm={() => dienststatusMutation.mutate({ id: f.id, inDienst: false })}
                  >
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: f.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Fahrzeug>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Fahrzeug anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={fahrzeugeQuery.isLoading}
        dataSource={fahrzeugeQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch keine Fahrzeuge' }}
        pagination={false}
      />
      <FahrzeugFormModal
        offen={modalOffen}
        fahrzeug={bearbeite}
        typVorschlaege={typenQuery.data ?? []}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
```

- [ ] **Step 3: `StatusKatalogTab.tsx`**

`frontend/src/stammdaten/StatusKatalogTab.tsx`:

```tsx
import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag,
  type TableColumnsType,
} from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listeFahrzeugStatus, type StatusEingabe,
} from '../api/fahrzeugStatus';
import type { FahrzeugStatus, StatusKategorie } from '../api/types';

const KATEGORIE_LABELS: Record<StatusKategorie, string> = {
  verfuegbar: 'verfügbar',
  gebunden: 'gebunden',
  nicht_verfuegbar: 'nicht verfügbar',
};
const KATEGORIE_FARBEN: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  fms_anker?: number;
  sortier: number;
}

export default function StatusKatalogTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<FahrzeugStatus | null>(null);

  const statusQuery = useQuery({ queryKey: ['fahrzeug-status'], queryFn: listeFahrzeugStatus });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: werte.farbe?.trim() || null,
        fms_anker: werte.fms_anker ?? null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereStatus(bearbeite.id, daten) : legeStatusAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fahrzeug-status'] });
      setModalOffen(false);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fahrzeug-status'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        fms_anker: bearbeite.fms_anker ?? undefined,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<FahrzeugStatus> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      render: (k: StatusKategorie) => <Tag color={KATEGORIE_FARBEN[k]}>{KATEGORIE_LABELS[k]}</Tag>,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'FMS-Anker', dataIndex: 'fms_anker', key: 'fms_anker', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: FahrzeugStatus) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(s); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<FahrzeugStatus>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Status anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={statusQuery.isLoading}
        dataSource={statusQuery.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Kein Status' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Status bearbeiten' : 'Status anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnClose
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(KATEGORIE_LABELS) as StatusKategorie[]).map((k) => ({
                value: k,
                label: KATEGORIE_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="FMS-Anker (0–9, optional)" name="fms_anker">
            <InputNumber min={0} max={9} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Tabs in `StammdatenPage.tsx` ergänzen**

In `frontend/src/pages/StammdatenPage.tsx` die Imports + `items` erweitern:

```tsx
import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import StatusKatalogTab from '../stammdaten/StatusKatalogTab';

export default function StammdatenPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>
      <Tabs
        defaultActiveKey="stichworte"
        items={[
          { key: 'stichworte', label: 'Einsatz-Stichworte', children: <StichworteTab /> },
          { key: 'fahrzeuge', label: 'Fahrzeuge', children: <FahrzeugeTab /> },
          { key: 'status', label: 'Fahrzeug-Status', children: <StatusKatalogTab /> },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 5: Tests schreiben**

`frontend/src/stammdaten/FahrzeugeTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugeTab from './FahrzeugeTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const fahrzeug = {
  id: 1, funkrufname: 'Florian 1', fahrzeugtyp: 'LF 20', traegerorganisation: null,
  kennzeichen: 'XX-AB 1', opta: null, standort: null, fms_issi: null, sondersignal: false,
  tragenkapazitaet: null, staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
};

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([fahrzeug])),
    http.get('/api/fahrzeug-typen', () => HttpResponse.json(['LF 20'])),
  );
  return renderMitProviders(
    <AuthProvider>
      <FahrzeugeTab />
    </AuthProvider>,
  );
}

describe('FahrzeugeTab', () => {
  it('zeigt Fahrzeuge inkl. Stärke', async () => {
    render(admin);
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
    expect(screen.getByText('0/1/8/9')).toBeInTheDocument();
  });

  it('Admin sieht „Fahrzeug anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Fahrzeug anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
```

`frontend/src/stammdaten/StatusKatalogTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StatusKatalogTab from './StatusKatalogTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const status = [
  { id: 1, label: 'einsatzbereit', kategorie: 'verfuegbar', farbe: null, fms_anker: 1, sortier: 10 },
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(status)),
  );
  return renderMitProviders(
    <AuthProvider>
      <StatusKatalogTab />
    </AuthProvider>,
  );
}

describe('StatusKatalogTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('einsatzbereit')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('einsatzbereit');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('einsatzbereit');
    expect(screen.queryByRole('button', { name: 'Status anlegen' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Tests + Typecheck ausführen**

Run: `cd frontend && npx vitest run src/stammdaten/ && npm run typecheck`
Expected: alle grün, kein Typfehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stammdaten/ frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tabs Fahrzeuge + Fahrzeug-Status (Admin-CRUD)"
```

---

## Task 16: `FahrzeugePage.tsx` — Einsatz-Disposition

**Files:**
- Create: `frontend/src/pages/FahrzeugePage.tsx`
- Test: `frontend/src/pages/FahrzeugePage.test.tsx`

- [ ] **Step 1: Seite schreiben**

`frontend/src/pages/FahrzeugePage.tsx`:

```tsx
import {
  Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Select, Space, Spin,
  Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereFahrzeug, entferneDisposition,
  listeEinsatzFahrzeuge, type AdhocEingabe,
} from '../api/einsatzFahrzeuge';
import { ApiError } from '../api/client';
import type { EinsatzFahrzeug, StatusKategorie } from '../api/types';

const KATEGORIE_FALLBACK: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

function StatusBadge({ ef }: { ef: EinsatzFahrzeug }) {
  if (!ef.status_label || !ef.status_kategorie) return <Tag>kein Status</Tag>;
  const farbe = ef.status_farbe ?? KATEGORIE_FALLBACK[ef.status_kategorie];
  return <Tag color={farbe}>{ef.status_label}</Tag>;
}

export default function FahrzeugePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const efQuery = useQuery({
    queryKey: ['einsatz-fahrzeuge', einsatzId],
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: ['fahrzeug-status'], queryFn: listeFahrzeugStatus });
  const poolQuery = useQuery({ queryKey: ['fahrzeuge', 'im-dienst'], queryFn: () => listeFahrzeuge(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-fahrzeuge', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (fahrzeugId: number) => disponiereFahrzeug(einsatzId, fahrzeugId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { efId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.efId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (efId: number) => entferneDisposition(einsatzId, efId),
    onSuccess: invalidate,
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

  const efs = efQuery.data ?? [];
  const stati = statusQuery.data ?? [];
  const disponierteIds = new Set(efs.map((e) => e.fahrzeug_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((f) => !disponierteIds.has(f.id))
    .map((f) => ({ value: f.id, label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}` }));

  const spalten: TableColumnsType<EinsatzFahrzeug> = [
    {
      title: 'Funkrufname',
      key: 'funkrufname',
      render: (_, ef) => (
        <Space>
          {ef.funkrufname}
          {ef.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'typ', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'status',
      render: (_, ef) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={ef.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ efId: ef.id, statusId })}
          />
        ) : (
          <StatusBadge ef={ef} />
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ef) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ efId: ef.id, bemerkung: val }) }}
          >
            {ef.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ef.bemerkung || '—' // leere/null-Bemerkung als „—" anzeigen
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ef: EinsatzFahrzeug) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ef.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzFahrzeug>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Fahrzeuge' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Fahrzeuge</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              showSearch
              style={{ minWidth: 260 }}
              placeholder="Stamm-Fahrzeug disponieren …"
              value={null}
              options={poolOptionen}
              optionFilterProp="label"
              notFoundContent="Keine freien Fahrzeuge"
              onSelect={(fahrzeugId: number) => disponiereMutation.mutate(fahrzeugId)}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Fahrzeug</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="Einsatz ist abgeschlossen — nur Ansicht."
        />
      )}

      <Table
        rowKey="id"
        loading={efQuery.isLoading}
        dataSource={efs}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch keine Fahrzeuge disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Fahrzeug disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnClose
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Funkrufname" name="funkrufname" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Florian Nachbarstadt 44/1" />
          </Form.Item>
          <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp"><Input /></Form.Item>
          <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
          <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. Feuerwehr Nachbarstadt" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Test schreiben**

`frontend/src/pages/FahrzeugePage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import FahrzeugePage from './FahrzeugePage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-26 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-26 09:00:00',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const ef = {
  id: 10, einsatz_id: 7, fahrzeug_id: 1, ist_adhoc: false, funkrufname: 'Florian 1',
  kennzeichen: 'XX-AB 1', fahrzeugtyp: 'LF 20', opta: null, traegerorganisation: null,
  status_id: 2, status_label: 'disponiert', status_kategorie: 'gebunden', status_farbe: null,
  bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
};
const stati = [
  { id: 2, label: 'disponiert', kategorie: 'gebunden', farbe: null, fms_anker: 3, sortier: 20 },
  { id: 3, label: 'vor_ort', kategorie: 'gebunden', farbe: null, fms_anker: 4, sortier: 40 },
];

function render(einsatzObj: ReturnType<typeof einsatz>) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([ef])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json(stati)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/fahrzeuge" element={<FahrzeugePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/fahrzeuge' },
  );
}

describe('FahrzeugePage', () => {
  it('zeigt disponierte Fahrzeuge', async () => {
    render(einsatz());
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
  });

  it('Einsatzleitung im aktiven Einsatz sieht Disponieren-/Entfernen-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Florian 1');
    expect(screen.getByText('Stamm-Fahrzeug disponieren …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ad-hoc-Fahrzeug' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter sieht reine Anzeige (Status-Badge statt Select)', async () => {
    render(einsatz({ meine_rolle: 'beobachter' }));
    await screen.findByText('Florian 1');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Fahrzeug' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
    // Badge zeigt das Status-Label.
    expect(screen.getByText('disponiert')).toBeInTheDocument();
  });

  it('abgeschlossener Einsatz ist read-only und zeigt Hinweis', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00' }));
    await screen.findByText('Florian 1');
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Tests + Typecheck ausführen**

Run: `cd frontend && npx vitest run src/pages/FahrzeugePage.test.tsx && npm run typecheck`
Expected: alle grün.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/FahrzeugePage.tsx frontend/src/pages/FahrzeugePage.test.tsx
git commit -m "feat(fe): FahrzeugePage — Disposition (Stamm/Ad-hoc, Status, Bemerkung, Entfernen)"
```

---

## Task 17: Modul-Registrierung — `fahrzeuge` aktiv, `abrollbehaelter` entfernen

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/einsatz/modulRegistry.ts`
- Test: `frontend/src/einsatz/modulRegistry.test.ts`, `frontend/src/App.test.tsx`

- [ ] **Step 1: Failing-Tests zuerst (Registry-Regression)**

In `frontend/src/einsatz/modulRegistry.test.ts`, im `describe('modulRegistry', …)`, einfügen:

```typescript
  it('fahrzeuge ist fertig, abrollbehaelter ist entfernt', () => {
    const fahrzeuge = modulRegistry.find((m) => m.key === 'fahrzeuge');
    expect(fahrzeuge?.status).toBe('fertig');
    expect(fahrzeuge?.kategorie).toBe('kraefte');
    expect(modulRegistry.find((m) => m.key === 'abrollbehaelter')).toBeUndefined();
  });
```

- [ ] **Step 2: Test ausführen (erwartet FAIL)**

Run: `cd frontend && npx vitest run src/einsatz/modulRegistry.test.ts`
Expected: FAIL (fahrzeuge ist noch `geplant`, abrollbehaelter noch vorhanden).

- [ ] **Step 3: `modulRegistry.ts` anpassen**

a) In der Icon-Import-Zeile `TbBox` entfernen (wird nach Entfernen von `abrollbehaelter` nicht mehr genutzt → sonst ESLint-Fehler). Aus:

```typescript
  TbUsersGroup, TbUser, TbTruck, TbBox, TbPackages,
```
wird:
```typescript
  TbUsersGroup, TbUser, TbTruck, TbPackages,
```

b) Den `fahrzeuge`-Eintrag auf `status: 'fertig'` setzen:

```typescript
  { key: 'fahrzeuge', kategorie: 'kraefte', label: 'Fahrzeuge', icon: TbTruck, route: 'fahrzeuge', status: 'fertig', beschreibung: 'Disponierte Fahrzeuge des Einsatzes.' },
```

c) Die gesamte `abrollbehaelter`-Zeile löschen:

```typescript
  { key: 'abrollbehaelter', kategorie: 'kraefte', label: 'Abrollbehälter', icon: TbBox, route: 'abrollbehaelter', status: 'geplant', beschreibung: 'Abrollbehälter und deren Träger-Fahrzeuge.' },
```

- [ ] **Step 4: `App.tsx` — FahrzeugePage als echtes Modul registrieren**

Import ergänzen (nach `import EinsatzdatenPage …`):

```typescript
import FahrzeugePage from './pages/FahrzeugePage';
```

`MODUL_ELEMENTE` erweitern:

```typescript
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  einsatzdaten: <EinsatzdatenPage />,
  fahrzeuge: <FahrzeugePage />,
};
```

- [ ] **Step 5: App-Regressionstest ergänzen**

In `frontend/src/App.test.tsx`, im `describe('App-Routing', …)`, einfügen:

```typescript
  it('fahrzeuge-Route rendert die echte FahrzeugePage statt Stub', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze', () => HttpResponse.json([einsatz])),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/fahrzeuge', () => HttpResponse.json([])),
      http.get('/api/fahrzeug-status', () => HttpResponse.json([])),
      http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    );
    renderApp('/einsaetze/7/fahrzeuge');
    // Echte Seite hat die Überschrift „Fahrzeuge"; der Stub würde „🚧"/Platzhalter zeigen.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Fahrzeuge' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/🚧/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Tests + Typecheck + Lint ausführen**

Run: `cd frontend && npx vitest run src/einsatz/modulRegistry.test.ts src/App.test.tsx`
Expected: PASS (inkl. der bestehenden ETB-/Default-Route-/Stub-Tests).

Run: `cd frontend && npm run test && npm run typecheck && npm run lint`
Expected: gesamte Frontend-Suite grün, kein Typ-/Lint-Fehler (insb. kein „TbBox is defined but never used").

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/App.test.tsx
git commit -m "feat(fe): Fahrzeuge-Modul aktiv, Abrollbehälter entfernt (Entscheidung 9)"
```

---

## Abschluss: Gesamtverifikation

- [ ] **Step 1: Volle Backend-Suite**

Run: `cargo test`
Expected: alle grün (Unit + alle `tests/*.rs`).

- [ ] **Step 2: Volle Frontend-Suite + Typecheck + Lint**

Run: `cd frontend && npm run test && npm run typecheck && npm run lint`
Expected: alle grün.

- [ ] **Step 3: Manueller Rauchtest (optional, empfohlen)**

Backend `cargo run`, Frontend `cd frontend && npm run dev`, als Admin anmelden:
1. Stammdaten → Tab „Fahrzeuge" → Fahrzeug anlegen (Stärke-Gesamt aktualisiert live).
2. Stammdaten → Tab „Fahrzeug-Status" → 8 Default-Status sichtbar; einen anlegen/deaktivieren.
3. Einsatz öffnen → Kräfte & Mittel → „Fahrzeuge": Stamm-Fahrzeug disponieren, Status setzen, Ad-hoc anlegen, entfernen.
4. ETB-Modul desselben Einsatzes: System-Einträge für Disposition/Status/Entfernen sind sichtbar.
5. „Abrollbehälter" ist in der Kräfte-&-Mittel-Rail/Panel nicht mehr vorhanden.

---

## Spec-Coverage-Selbstprüfung (vom Plan-Autor)

| Spec-Anforderung | Task(s) |
|---|---|
| Fahrzeug-Stamm CRUD + Soft-Delete (0007, partieller Unique-Index, Reaktivierungs-Conflict) | 1, 6, 7 |
| Status-Katalog CRUD + Deaktivieren + Seed (0008, Bestands-Org + Bootstrap) | 2, 8, 9, 10 |
| Disposition (0009) — Stamm/Ad-hoc, Snapshot, Live-Auflösung, Org-Isolation, Initial-`gebunden`-Status, Initial-Status leer | 3, 11, 12 |
| Wiederverwendbarer `Staerke`-Typ (u16, Gesamt berechnet, all-or-none-Validierung) | 4, 5 |
| ETB-System-Einträge bei Disponieren/Status-Wechsel/Entfernen (`typ='system'`, sequentiell) | 12 |
| Gates: Lesen (`fordere_lesezugriff`), Schreiben (`fordere_schreibrecht`+`fordere_aktiv`); Admin für Stamm/Status | 7, 9, 12 |
| Org-Isolation (Repo-Unit-Tests + NotFound auf fremde IDs) | 6, 8, 11 |
| StammdatenPage Tab-Layout (Stichworte/Fahrzeuge/Status) | 14, 15 |
| FahrzeugePage als echtes Modul; AutoComplete-Typen; Stärke-Live-Gesamt; Status-Badge mit Katalog-Farbe; Read-only für Beobachter/abgeschlossen | 13, 15, 16 |
| `fahrzeuge` → `fertig`, `abrollbehaelter` entfernt + Regression | 17 |

**Bewusst offen gelassen (Spec „Draußen"/Offene Punkte):** SSE-Live der Dispo-Liste (nur ETB ist live), echte Funk-/Leitstellen-Bridge, Einsatzabschnitt-Zuordnung, Retention/PDF. UX-Feinschliff des Ad-hoc-Flows in Task 16 bewusst schlicht (Modal) — kann später geschärft werden.

**Bekannte Test-Lücken (bewusst akzeptiert):**
- Der Pfad „Initial-Status leer" (Org ohne aktiven `gebunden`-Status → `status_id = NULL`) ist funktional korrekt (Insert mit NULL, Frontend zeigt „kein Status"/Select), aber **nicht** durch einen eigenen Test abgedeckt. Bei Bedarf in `disposition_repo`-Tests ergänzen: alle `gebunden`-Stati deaktivieren, dann `disponiere_stamm` → `status_id` ist `None`.
- Der **Bestands-Org-Seed in Migration 0008** ist nur über die Constraints getestet, nicht über den `SELECT … FROM organisation`-Pfad — mit `test_pool` nicht sauber prüfbar (Migration läuft vor jedem manuellen Org-Insert). Der Bootstrap-Seed-Pfad (neue Orgs) ist dagegen getestet (Task 10).
- **Bemerkung-Semantik:** Leeren speichert Leerstring `''` (nicht `NULL`); das Frontend rendert beides als „—". Der COALESCE-Mechanismus unterscheidet „Feld absent → unverändert" von „Feld = '' → geleert" (Task 12-Test `bemerkung_setzen_und_leeren`).
