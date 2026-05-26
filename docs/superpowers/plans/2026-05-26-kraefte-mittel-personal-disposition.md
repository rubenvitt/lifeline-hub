# K&M‑2 — Personal-Stamm & Disposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-weiter Personal-Stamm mit n:m-Qualifikationen, eigenem Status-Katalog und Disposition ins Einsatz-Modul „Personal" — analog zum K&M‑1-Fahrzeug-Pattern, inkl. Identitäts-Schnappschuss und automatischen ETB-Einträgen.

**Architecture:** Wiederverwendung des K&M‑1-Patterns (`src/fahrzeug/`): Domänen-Modul `src/personal/` (mod + vier Repos), vier Routen-Module, vier Migrationen. Die gemeinsam genutzten Status-Kategorie-/Dienststatus-Konstanten werden in ein neutrales Modul `src/katalog.rs` gezogen (von `fahrzeug` re-exportiert, damit Bestandscode grün bleibt). `Staerke` wird um `StaerkePosition` + Aggregation erweitert. Frontend: drei neue Stammdaten-Tabs + eine Einsatz-Modul-Seite, registriert über `App.tsx` und `modulRegistry.ts`.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TypeScript (antd, @tanstack/react-query, react-router), Vitest + MSW (Frontend-Tests), `cargo test` (Backend + Integrationstests).

---

## Konventionen & Befehle

- **Backend-Tests:** `cargo test` (Unit-Tests liegen in `#[cfg(test)] mod tests` je Modul; Integrationstests unter `tests/*.rs`).
- **Backend-Lint:** `cargo clippy --all-targets -- -D warnings` und `cargo fmt`.
- **Frontend-Verzeichnis:** alle `npm`-Befehle aus `frontend/` heraus.
- **Frontend-Tests:** `npm test` (= `vitest run`); Einzeldatei: `npx vitest run src/pfad/Datei.test.tsx`.
- **Frontend-Lint/Typecheck:** `npm run lint` und `npm run typecheck`.
- **Migrationen** werden über `sqlx::migrate!("./migrations")` eingebettet (`src/db.rs`) — kein separater Migrate-Befehl nötig; `db::test_pool()` spielt sie für Tests ein.

## Scope-Notiz (bewusst draußen)

- **Dev-Seeds:** `src/dev/seed.rs` seedet heute **keine** Fahrzeuge/Dispositionen (nur Orgs/Benutzer/Einsätze/ETB). Personal/Qualifikationen/Dispositionen werden — parallel zu Fahrzeugen — **nicht** dev-geseedet. Kein Task dafür.
- **SSE-Live** der Dispositions-Liste, **Einheiten (K&M‑3)**, **PII-Verschärfung**, **`einsatz_mitglied`-Kopplung**: laut Spec Folge-/Backlog-Themen, hier nicht enthalten.

## File Structure

**Backend (neu):**
- `migrations/0010_personal.sql` — Personal-Stamm + partielle Unique-Indizes.
- `migrations/0011_qualifikation.sql` — Qualifikations-Katalog + n:m-Join + Seed bestehender Orgs.
- `migrations/0012_personal_status.sql` — Personal-Status-Katalog + Seed bestehender Orgs.
- `migrations/0013_einsatz_personal.sql` — Dispositions-Tabelle + Index.
- `src/katalog.rs` — neutrale, geteilte Konstanten (`KATEGORIE_*`, `ist_gueltige_kategorie`, `DIENSTSTATUS_*`).
- `src/personal/mod.rs` — Typen + Seed-Listen + Re-Exports der Repos.
- `src/personal/repo.rs` — Stamm-CRUD, Soft-Delete, Qualifikations-Zuordnung, Vorschläge.
- `src/personal/qualifikation_repo.rs` — Katalog-CRUD + `funktion_text`-Helper.
- `src/personal/status_repo.rs` — Status-Katalog-CRUD (wie `fahrzeug` minus `fms_anker`).
- `src/personal/disposition_repo.rs` — Disposition (Stamm/Ad-hoc), Snapshot, Auflösung.
- `src/routes/personal.rs`, `src/routes/qualifikation.rs`, `src/routes/personal_status.rs`, `src/routes/einsatz_personal.rs`.
- `tests/personal.rs`, `tests/qualifikation.rs`, `tests/personal_status.rs`, `tests/einsatz_personal.rs`.

**Backend (geändert):**
- `src/lib.rs` — `pub mod katalog;`, `pub mod personal;`.
- `src/fahrzeug/mod.rs` — Konstanten nach `katalog` verschoben + re-exportiert.
- `src/staerke.rs` — `StaerkePosition` + `Staerke::aus_positionen`.
- `src/auth/bootstrap.rs` — Seeding von Qualifikation + Personal-Status für neue Orgs.
- `src/routes/mod.rs` — neue Routen-Module deklarieren.
- `src/app.rs` — neue Routen registrieren.

**Frontend (neu):**
- `frontend/src/api/personal.ts`, `qualifikationen.ts`, `personalStatus.ts`, `einsatzPersonal.ts`.
- `frontend/src/stammdaten/QualifikationenTab.tsx`, `PersonalStatusTab.tsx`, `PersonalTab.tsx`, `PersonalFormModal.tsx` (+ je `.test.tsx`).
- `frontend/src/pages/PersonalPage.tsx` (+ `.test.tsx`).

**Frontend (geändert):**
- `frontend/src/api/types.ts` — neue Typen.
- `frontend/src/pages/StammdatenPage.tsx` — drei Tabs ergänzt.
- `frontend/src/App.tsx` — `PersonalPage` als Modul-Element.
- `frontend/src/einsatz/modulRegistry.ts` — `personal` auf `status: 'fertig'`.

---

## Task 1: Migrationen (Schema-Schicht)

Vier Migrationsdateien. Schema ist deklarativ und wird gemeinsam über `db::test_pool()` getestet. **`0011`/`0012` seeden bestehende Orgs** per `CROSS JOIN organisation` (auf frischer DB ein No-Op; neue Orgs seedet `bootstrap_admin` in Task 9 — Werte synchron halten).

**Files:**
- Create: `migrations/0010_personal.sql`
- Create: `migrations/0011_qualifikation.sql`
- Create: `migrations/0012_personal_status.sql`
- Create: `migrations/0013_einsatz_personal.sql`
- Test: `src/db.rs` (neuer `#[tokio::test]` im bestehenden `mod tests`)

- [ ] **Step 1: `migrations/0010_personal.sql` schreiben**

```sql
-- Globaler, org-weiter Personenstamm (Einsatzkräfte der Organisation).
-- Kein Hard-Delete: "löschen" = dienststatus auf 'ausser_dienst' (Referenzen aus
-- Dispositionen bleiben auflösbar). benutzer_id ist ein optionaler Link auf ein
-- App-Konto (Mehrheit der Kräfte hat kein Login).
CREATE TABLE personal (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    benutzer_id         INTEGER REFERENCES benutzer(id),  -- optionaler Link zum App-Konto
    name                TEXT NOT NULL,                    -- Klarname/Anzeigename (NICHT eindeutig)
    personalnummer      TEXT,                             -- optional, org-intern
    traegerorganisation TEXT,                             -- frei; UI-Default = Name der eigenen Org
    telefon             TEXT,                             -- optional, minimale Kontakt-PII
    staerke_position    TEXT                              -- Stamm-Default-Position, optional
                        CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personalnummer je Organisation eindeutig, aber nur unter aktiven Personen
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_personal_personalnummer
    ON personal(org_id, personalnummer)
    WHERE personalnummer IS NOT NULL AND dienststatus = 'in_dienst';

-- Höchstens ein Personal-Datensatz je verknüpftem Benutzerkonto:
CREATE UNIQUE INDEX idx_personal_benutzer
    ON personal(benutzer_id) WHERE benutzer_id IS NOT NULL;
```

- [ ] **Step 2: `migrations/0011_qualifikation.sql` schreiben**

```sql
-- Org-weiter, admin-pflegbarer Qualifikations-Katalog + echte n:m-Zuordnung.
-- Soft-Delete via aktiv=0 (deaktivierte Qualifikation bleibt in bestehenden
-- Zuordnungen gültig, erscheint aber nicht mehr in der Auswahl).
CREATE TABLE qualifikation (
    id      INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL REFERENCES organisation(id),
    label   TEXT NOT NULL,
    sortier INTEGER NOT NULL DEFAULT 0,
    aktiv   INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

CREATE TABLE personal_qualifikation (
    personal_id      INTEGER NOT NULL REFERENCES personal(id),
    qualifikation_id INTEGER NOT NULL REFERENCES qualifikation(id),
    PRIMARY KEY (personal_id, qualifikation_id)
);

-- Bestehende Organisation(en) mit dem Default-Katalog seeden. Auf frischer DB ein
-- No-Op; neue Orgs seedet bootstrap_admin (gleiche Werte, siehe personal/mod.rs
-- QUALIFIKATION_STARTLISTE — beide synchron halten).
INSERT INTO qualifikation (org_id, label, sortier)
SELECT o.id, v.label, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Sanitäter'          AS label, 10 AS sortier
    UNION ALL SELECT 'Rettungssanitäter',  20
    UNION ALL SELECT 'Notfallsanitäter',   30
    UNION ALL SELECT 'Notarzt',            40
    UNION ALL SELECT 'Truppführer',        50
    UNION ALL SELECT 'Gruppenführer',      60
    UNION ALL SELECT 'Zugführer',          70
    UNION ALL SELECT 'Maschinist',         80
    UNION ALL SELECT 'Sprechfunker',       90
) v;
```

- [ ] **Step 3: `migrations/0012_personal_status.sql` schreiben**

```sql
-- Org-weiter, admin-pflegbarer Personal-Status-Katalog. Schema identisch zu
-- fahrzeug_status MINUS fms_anker (keine FMS-Anbindung bei Personal). Die feste
-- Semantik-Kategorie trägt die App-Logik. Soft-Delete via aktiv=0.
CREATE TABLE personal_status (
    id        INTEGER PRIMARY KEY,
    org_id    INTEGER NOT NULL REFERENCES organisation(id),
    label     TEXT NOT NULL,
    kategorie TEXT NOT NULL
              CHECK (kategorie IN ('verfuegbar', 'gebunden', 'nicht_verfuegbar')),
    farbe     TEXT,                        -- optional, Hex (#rrggbb) für Lageübersicht
    sortier   INTEGER NOT NULL DEFAULT 0,
    aktiv     INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

-- Bestehende Organisation(en) seeden (No-Op auf frischer DB; neue Orgs über
-- bootstrap_admin, Werte synchron zu personal/mod.rs PERSONAL_STATUS_STARTLISTE).
INSERT INTO personal_status (org_id, label, kategorie, sortier)
SELECT o.id, v.label, v.kategorie, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'verfügbar'    AS label, 'verfuegbar'       AS kategorie, 10 AS sortier
    UNION ALL SELECT 'alarmiert',    'gebunden',         20
    UNION ALL SELECT 'auf Anfahrt',  'gebunden',         30
    UNION ALL SELECT 'im Einsatz',   'gebunden',         40
    UNION ALL SELECT 'Pause',        'nicht_verfuegbar', 50
    UNION ALL SELECT 'abgemeldet',   'nicht_verfuegbar', 60
) v;
```

- [ ] **Step 4: `migrations/0013_einsatz_personal.sql` schreiben**

```sql
-- Disposition: Zuordnung von Stamm-/Ad-hoc-Personen zu einem konkreten Einsatz.
-- Referenz + Einsatz-Status + Identitäts-Schnappschuss (snap_*). Bei Ad-hoc-extern
-- (personal_id IS NULL) sind die snap_*-Felder die eigentlichen Daten.
CREATE TABLE einsatz_personal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    personal_id     INTEGER REFERENCES personal(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES personal_status(id),  -- aktueller Einsatz-Status
    staerke_position TEXT                                    -- Dispo-Override (sonst Stamm-Default)
                    CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    snap_name                TEXT NOT NULL,
    snap_funktion            TEXT,    -- Qualifikationen/Funktion als flacher Text
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, personal_id)   -- eine Stamm-Person je Einsatz nur einmal; mehrere NULL erlaubt
);

CREATE INDEX idx_einsatz_personal_einsatz ON einsatz_personal(einsatz_id);
```

- [ ] **Step 5: Schema-Smoke-Test in `src/db.rs` ergänzen**

Im bestehenden `#[cfg(test)] mod tests` von `src/db.rs` anhängen (Muster: andere `test_pool()`-Tests dort). Prüft, dass die Migrationen einspielen und die Seed-Defaults der bestehenden Org da sind. **Hinweis:** `test_pool()` enthält **keine** Organisation → der Seed ist ein No-Op; daher legen wir hier zuerst eine Org an und prüfen dann das Tabellen-Vorhandensein leer.

```rust
    #[tokio::test]
    async fn migration_0010_bis_0013_legen_personal_schema_an() {
        let pool = test_pool().await;
        // Tabellen existieren (leeres SELECT wirft nicht).
        for tabelle in ["personal", "qualifikation", "personal_qualifikation", "personal_status", "einsatz_personal"] {
            let sql = format!("SELECT COUNT(*) FROM {tabelle}");
            let n: i64 = sqlx::query_scalar(&sql).fetch_one(&pool).await.unwrap();
            assert_eq!(n, 0, "{tabelle} startet leer (keine Org auf test_pool)");
        }
    }

    #[tokio::test]
    async fn seed_qualifikation_und_status_fuer_bestehende_org() {
        let pool = test_pool().await;
        // Org NACH den Migrationen anlegen → Seed greift NICHT (CROSS JOIN lief auf leerer
        // Org-Menge). Wir prüfen daher den Seed über bootstrap in Task 9; hier nur, dass
        // ein manuell geseedeter Eintrag einfügbar ist (Schema/CHECK korrekt).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (1, 'verfügbar', 'verfuegbar', 10)")
            .execute(&pool).await.unwrap();
        let q: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM qualifikation WHERE org_id = 1").fetch_one(&pool).await.unwrap();
        let s: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_status WHERE org_id = 1").fetch_one(&pool).await.unwrap();
        assert_eq!((q, s), (1, 1));
    }
```

- [ ] **Step 6: Tests laufen lassen**

Run: `cargo test --lib db::tests`
Expected: PASS (beide neuen Tests grün; bestehende `db`-Tests unverändert grün).

- [ ] **Step 7: Commit**

```bash
git add migrations/0010_personal.sql migrations/0011_qualifikation.sql migrations/0012_personal_status.sql migrations/0013_einsatz_personal.sql src/db.rs
git commit -m "feat(db): Migrationen für Personal-Stamm, Qualifikationen, Status & Disposition"
```

---

## Task 2: `StaerkePosition` + `Staerke::aus_positionen`

Reine Logik, TDD. Erweitert den wiederverwendbaren `Staerke`-Typ (K&M‑3-Vorbereitung).

**Files:**
- Modify: `src/staerke.rs`

- [ ] **Step 1: Failing Test schreiben**

Im `#[cfg(test)] mod tests` von `src/staerke.rs` anhängen:

```rust
    #[test]
    fn staerke_position_roundtrip() {
        for p in [StaerkePosition::Fuehrer, StaerkePosition::Unterfuehrer, StaerkePosition::Mannschaft] {
            assert_eq!(StaerkePosition::parse(p.as_str()), Some(p));
        }
        assert_eq!(StaerkePosition::parse("chef"), None);
    }

    #[test]
    fn aus_positionen_zaehlt_je_topf() {
        use StaerkePosition::*;
        let s = Staerke::aus_positionen([Fuehrer, Mannschaft, Mannschaft, Unterfuehrer, Mannschaft].into_iter());
        assert_eq!(s, Staerke::neu(1, 1, 3));
        assert_eq!(s.gesamt(), 5);
    }

    #[test]
    fn aus_positionen_leer_ist_null() {
        assert_eq!(Staerke::aus_positionen(std::iter::empty()), Staerke::neu(0, 0, 0));
    }
```

- [ ] **Step 2: Test zum Scheitern bringen**

Run: `cargo test --lib staerke::tests::staerke_position_roundtrip`
Expected: FAIL (Kompilerfehler: `StaerkePosition` / `aus_positionen` nicht gefunden).

- [ ] **Step 3: Implementierung in `src/staerke.rs` ergänzen**

Vor dem `#[cfg(test)]`-Block einfügen:

```rust
/// Taktische Stärke-Position einer einzelnen Person (genau einer von drei Töpfen).
/// Wird als TEXT in der DB gespeichert (kein sqlx-Enum-Decode → manuell konvertiert).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum StaerkePosition {
    Fuehrer,
    Unterfuehrer,
    Mannschaft,
}

impl StaerkePosition {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            StaerkePosition::Fuehrer => "fuehrer",
            StaerkePosition::Unterfuehrer => "unterfuehrer",
            StaerkePosition::Mannschaft => "mannschaft",
        }
    }

    /// Parst einen gespeicherten/übergebenen Positionsstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<StaerkePosition> {
        match s {
            "fuehrer" => Some(StaerkePosition::Fuehrer),
            "unterfuehrer" => Some(StaerkePosition::Unterfuehrer),
            "mannschaft" => Some(StaerkePosition::Mannschaft),
            _ => None,
        }
    }
}

impl Staerke {
    /// Aggregiert einzelne Positionen zu einer Stärke (zählt je Topf). Damit summiert
    /// K&M‑3 die Einheiten-Stärke direkt aus den Dispositionszeilen, ohne neue Logik.
    pub fn aus_positionen(positionen: impl Iterator<Item = StaerkePosition>) -> Staerke {
        let (mut f, mut u, mut m) = (0u16, 0u16, 0u16);
        for p in positionen {
            match p {
                StaerkePosition::Fuehrer => f += 1,
                StaerkePosition::Unterfuehrer => u += 1,
                StaerkePosition::Mannschaft => m += 1,
            }
        }
        Staerke::neu(f, u, m)
    }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test --lib staerke::tests`
Expected: PASS (neue + bestehende `staerke`-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/staerke.rs
git commit -m "feat(staerke): StaerkePosition-Enum + Staerke::aus_positionen für Disposition"
```

---

## Task 3: Neutrales `katalog`-Modul (Refactor)

`KATEGORIE_*`, `ist_gueltige_kategorie` und `DIENSTSTATUS_*` aus `src/fahrzeug/mod.rs` in ein neutrales `src/katalog.rs` ziehen, damit `fahrzeug` und `personal` denselben Code teilen. `fahrzeug/mod.rs` re-exportiert sie per `pub use` → **bestehende Referenzen (`crate::fahrzeug::KATEGORIE_GEBUNDEN`, `super::*` in den Repos, die Bestandstests) bleiben unverändert grün.**

**Files:**
- Create: `src/katalog.rs`
- Modify: `src/lib.rs`
- Modify: `src/fahrzeug/mod.rs:9-37` (Konstanten entfernen, re-exportieren)

- [ ] **Step 1: `src/katalog.rs` anlegen**

```rust
//! Geteilte Katalog-Grundlagen für Status-Kataloge (Fahrzeug, Personal, später Material).
//! Die feste Semantik-Kategorie trägt die App-Logik (Verfügbarkeit); der Dienststatus
//! steuert den Soft-Delete eines Stamm-Datensatzes.

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = "in_dienst";
pub const DIENSTSTATUS_AUSSER_DIENST: &str = "ausser_dienst";

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = "verfuegbar";
pub const KATEGORIE_GEBUNDEN: &str = "gebunden";
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = "nicht_verfuegbar";

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    matches!(s, KATEGORIE_VERFUEGBAR | KATEGORIE_GEBUNDEN | KATEGORIE_NICHT_VERFUEGBAR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kategorie_validierung() {
        assert!(ist_gueltige_kategorie("gebunden"));
        assert!(!ist_gueltige_kategorie("irgendwas"));
    }
}
```

- [ ] **Step 2: `src/lib.rs` ergänzen**

`pub mod katalog;` alphabetisch nach `pub mod fahrzeug;` einfügen (zwischen `fahrzeug` und `live`):

```rust
pub mod fahrzeug;
pub mod katalog;
pub mod live;
```

- [ ] **Step 3: `src/fahrzeug/mod.rs` umstellen**

Die Zeilen 8–16 (die `DIENSTSTATUS_*`- und `KATEGORIE_*`-`const`-Definitionen) **und** die Funktion `ist_gueltige_kategorie` (Zeilen 34–37) entfernen. Stattdessen oben (direkt nach `use serde::Serialize;`) den Re-Export einfügen, sodass alle Altpfade (`crate::fahrzeug::KATEGORIE_GEBUNDEN`, `super::KATEGORIE_GEBUNDEN`, `use super::*`) weiter aufgelöst werden:

```rust
use crate::staerke::Staerke;
use serde::Serialize;

// Geteilte Konstanten/Validierung leben jetzt neutral in `crate::katalog` und werden
// hier re-exportiert, damit Bestandscode (crate::fahrzeug::KATEGORIE_*, super::*) gilt.
pub use crate::katalog::{
    ist_gueltige_kategorie, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST,
    KATEGORIE_GEBUNDEN, KATEGORIE_NICHT_VERFUEGBAR, KATEGORIE_VERFUEGBAR,
};
```

Die Doc-Kommentar-Zeilen über `STATUS_STARTLISTE` (Zeilen 17–20) und `STATUS_STARTLISTE` selbst **bleiben** unverändert in `fahrzeug/mod.rs`. Der `kategorie_validierung`-Test in `fahrzeug/mod.rs` (Zeilen 197–201) **bleibt** ebenfalls — er ruft die nun re-exportierte Funktion über `use super::*` auf.

- [ ] **Step 4: Gesamten Backend-Testlauf — fängt beide Refactor-Risiken ab**

Run: `cargo test --lib`
Expected: PASS (alle `fahrzeug`-, `staerke`-, `katalog`-Tests grün). Bei „cannot find value `KATEGORIE_*`": fehlender Re-Export in Step 3 → korrigieren, bevor weitergemacht wird.

Run: `cargo clippy --all-targets -- -D warnings`
Expected: keine Warnungen (insb. kein „unused import" für den Re-Export).

- [ ] **Step 5: Commit**

```bash
git add src/katalog.rs src/lib.rs src/fahrzeug/mod.rs
git commit -m "refactor: Status-Kategorie-/Dienststatus-Konstanten in neutrales katalog-Modul"
```

---

## Task 4: `src/personal/mod.rs` — Typen & Seed-Listen

Domänen-Modul mit allen `serde`/`FromRow`-Typen, den Bootstrap-Seed-Listen und Repo-Re-Exports. Analog zu `src/fahrzeug/mod.rs`.

**Files:**
- Create: `src/personal/mod.rs`
- Modify: `src/lib.rs`

- [ ] **Step 1: `src/lib.rs` ergänzen**

`pub mod personal;` alphabetisch nach `pub mod live;` einfügen:

```rust
pub mod live;
pub mod personal;
pub mod routes;
```

- [ ] **Step 2: `src/personal/mod.rs` anlegen**

```rust
pub mod disposition_repo;
pub mod qualifikation_repo;
pub mod repo;
pub mod status_repo;

use crate::katalog::{KATEGORIE_GEBUNDEN, KATEGORIE_NICHT_VERFUEGBAR, KATEGORIE_VERFUEGBAR};
use serde::Serialize;

/// Default-Qualifikations-Katalog je neu angelegter Organisation (label, sortier).
/// **Muss mit dem Seed in `migrations/0011_qualifikation.sql` übereinstimmen.**
pub const QUALIFIKATION_STARTLISTE: [(&str, i64); 9] = [
    ("Sanitäter", 10),
    ("Rettungssanitäter", 20),
    ("Notfallsanitäter", 30),
    ("Notarzt", 40),
    ("Truppführer", 50),
    ("Gruppenführer", 60),
    ("Zugführer", 70),
    ("Maschinist", 80),
    ("Sprechfunker", 90),
];

/// Default-Personal-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, sortier). **Muss mit dem Seed in
/// `migrations/0012_personal_status.sql` übereinstimmen.**
pub const PERSONAL_STATUS_STARTLISTE: [(&str, &str, i64); 6] = [
    ("verfügbar", KATEGORIE_VERFUEGBAR, 10),
    ("alarmiert", KATEGORIE_GEBUNDEN, 20),
    ("auf Anfahrt", KATEGORIE_GEBUNDEN, 30),
    ("im Einsatz", KATEGORIE_GEBUNDEN, 40),
    ("Pause", KATEGORIE_NICHT_VERFUEGBAR, 50),
    ("abgemeldet", KATEGORIE_NICHT_VERFUEGBAR, 60),
];

/// Interner Personal-Datensatz (alle Spalten von `personal`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Personal {
    pub id: i64,
    pub org_id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Aufgelöste Qualifikation einer Person (id + label), inkl. deaktivierter
/// Zuordnungen (deaktivierte Qualifikation bleibt in der Anzeige sichtbar).
#[derive(Debug, Clone, Serialize)]
pub struct QualifikationRef {
    pub id: i64,
    pub label: String,
}

/// Öffentliche Personal-Darstellung (ohne `org_id`), inkl. aufgelöster Qualifikationen.
#[derive(Debug, Clone, Serialize)]
pub struct PersonalAnzeige {
    pub id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
    pub qualifikationen: Vec<QualifikationRef>,
}

/// Abgeleitete AutoComplete-Vorschläge für die Trägerorganisation (DISTINCT, org-weit).
/// Bewusst nur ein Feld (anders als FahrzeugVorschlaege mit drei Feldern).
#[derive(Debug, Clone, Serialize)]
pub struct PersonalVorschlaege {
    pub traegerorganisation: Vec<String>,
}

/// Qualifikations-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Qualifikation {
    pub id: i64,
    pub label: String,
    pub sortier: i64,
}

/// Personal-Status-Katalog-Eintrag (org-weit). Schema wie `FahrzeugStatus` minus `fms_anker`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PersonalStatus {
    pub id: i64,
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    pub sortier: i64,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel (Live aus dem
/// Stamm bei aktivem Einsatz + Person in Dienst, sonst Snapshot), aufgelöste
/// Stärke-Position (Dispo-Override vor Stamm-Default) und aufgelöster Status.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzPersonalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externe Person (kein Stamm-Bezug).
    pub personal_id: Option<i64>,
    pub ist_adhoc: bool,
    pub name: String,
    /// Qualifikationen/Funktion als flacher Text (Live recomposed oder Snapshot).
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    pub staerke_position: Option<String>,
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
    use crate::katalog::ist_gueltige_kategorie;

    #[test]
    fn startlisten_konsistent() {
        assert_eq!(QUALIFIKATION_STARTLISTE.len(), 9);
        assert_eq!(PERSONAL_STATUS_STARTLISTE.len(), 6);
        // Jede Seed-Kategorie ist gültig, und es gibt mindestens einen 'gebunden'-Status
        // (Initial-Status der Disposition).
        assert!(PERSONAL_STATUS_STARTLISTE.iter().all(|(_, k, _)| ist_gueltige_kategorie(k)));
        assert!(PERSONAL_STATUS_STARTLISTE.iter().any(|(_, k, _)| *k == KATEGORIE_GEBUNDEN));
    }
}
```

- [ ] **Step 3: Kompilieren (Repos existieren noch nicht → erwarteter Fehler)**

Run: `cargo build --lib 2>&1 | head -5`
Expected: FAIL mit „file not found for module `disposition_repo`" o. ä. — das ist erwartet; die Repo-Dateien folgen in Tasks 5–8. **Lege jetzt vier leere Platzhalter an, damit das Modul kompiliert:**

```bash
printf '// implementiert in Task 5\n' > src/personal/repo.rs
printf '// implementiert in Task 6\n' > src/personal/qualifikation_repo.rs
printf '// implementiert in Task 7\n' > src/personal/status_repo.rs
printf '// implementiert in Task 8\n' > src/personal/disposition_repo.rs
```

- [ ] **Step 4: Modul-Test laufen lassen**

Run: `cargo test --lib personal::tests`
Expected: PASS (`startlisten_konsistent`).

- [ ] **Step 5: Commit**

```bash
git add src/lib.rs src/personal/
git commit -m "feat(personal): Domänen-Typen, Seed-Listen und Modulgerüst"
```

---

## Task 5: `src/personal/repo.rs` — Stamm-CRUD + Qualifikations-Zuordnung

Stamm-CRUD mit Soft-Delete, n:m-Qualifikations-Zuordnung (Vollersatz), Benutzer-Link-Validierung und Trägerorganisations-Vorschlägen. Org-scoped wie `fahrzeug/repo.rs`.

**Files:**
- Replace: `src/personal/repo.rs` (Platzhalter aus Task 4 überschreiben)

- [ ] **Step 1: Failing Tests schreiben**

Inhalt von `src/personal/repo.rs` mit folgendem `#[cfg(test)]`-Block **am Ende** anlegen (Implementierung kommt in Step 3 davor):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }

    /// Legt einen Benutzer in einer Org an und liefert dessen id.
    async fn benutzer(pool: &SqlitePool, org_id: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (?, ?, ?, 'h') RETURNING id",
        )
        .bind(org_id).bind(name).bind(name).fetch_one(pool).await.unwrap()
    }

    fn daten(name: &str) -> PersonalDaten<'_> {
        PersonalDaten {
            name,
            benutzer_id: None,
            personalnummer: None,
            traegerorganisation: None,
            telefon: None,
            staerke_position: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden_anzeige() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Thomas Müller");
        d.staerke_position = Some("fuehrer"); // Repo validiert die Position nicht (das macht die Route)
        let p = anlegen(&pool, 1, d, &[]).await.unwrap();
        let a = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a.name, "Thomas Müller");
        assert_eq!(a.staerke_position.as_deref(), Some("fuehrer"));
        assert_eq!(a.dienststatus, "in_dienst");
    }

    #[tokio::test]
    async fn namens_dubletten_erlaubt_personalnummer_dublette_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut a = daten("Thomas Müller");
        a.personalnummer = Some("4711");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        // gleicher Name, KEINE Nummer → erlaubt (Namen sind nicht eindeutig).
        anlegen(&pool, 1, daten("Thomas Müller"), &[]).await.unwrap();
        // gleiche Personalnummer (unter aktiven) → Conflict.
        let mut dup = daten("Anders Anders");
        dup.personalnummer = Some("4711");
        assert!(matches!(anlegen(&pool, 1, dup, &[]).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn personalnummer_je_org_unabhaengig_und_null_mehrfach() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let mut a = daten("A");
        a.personalnummer = Some("1");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        let mut b = daten("B");
        b.personalnummer = Some("1");
        assert!(anlegen(&pool, 2, b, &[]).await.is_ok(), "andere Org unabhängig");
        // mehrere ohne Nummer in derselben Org erlaubt.
        anlegen(&pool, 1, daten("C"), &[]).await.unwrap();
        anlegen(&pool, 1, daten("D"), &[]).await.unwrap();
    }

    #[tokio::test]
    async fn benutzer_link_fremde_org_ist_validation_belegt_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let fremd = benutzer(&pool, 2, "fremd").await;
        let mut d = daten("X");
        d.benutzer_id = Some(fremd);
        assert!(matches!(anlegen(&pool, 1, d, &[]).await.unwrap_err(), AppError::Validation(_)));

        let eigen = benutzer(&pool, 1, "eigen").await;
        let mut ok = daten("Y");
        ok.benutzer_id = Some(eigen);
        anlegen(&pool, 1, ok, &[]).await.unwrap();
        // dasselbe Konto erneut → Conflict.
        let mut zwei = daten("Z");
        zwei.benutzer_id = Some(eigen);
        assert!(matches!(anlegen(&pool, 1, zwei, &[]).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let p = anlegen(&pool, 1, daten("Thomas"), &[]).await.unwrap();
        setze_dienststatus(&pool, 1, p.id, false).await.unwrap();
        assert!(liste_anzeige(&pool, 1, true).await.unwrap().is_empty(), "nicht in nur_im_dienst");
        assert_eq!(liste_anzeige(&pool, 1, false).await.unwrap().len(), 1, "aber referenzierbar");
        assert_eq!(laden(&pool, 1, p.id).await.unwrap().dienststatus, "ausser_dienst");
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebene_personalnummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut alt = daten("Alt");
        alt.personalnummer = Some("7");
        let alt = anlegen(&pool, 1, alt, &[]).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Nummer inzwischen neu vergeben.
        let mut neu = daten("Neu");
        neu.personalnummer = Some("7");
        anlegen(&pool, 1, neu, &[]).await.unwrap();
        // Reaktivieren des alten kollidiert.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn qualifikations_zuordnung_vollersatz_inkl_deaktivierter_sichtbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q1: i64 = sqlx::query_scalar("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10) RETURNING id").fetch_one(&pool).await.unwrap();
        let q2: i64 = sqlx::query_scalar("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Gruppenführer', 20) RETURNING id").fetch_one(&pool).await.unwrap();
        let p = anlegen(&pool, 1, daten("Thomas"), &[q1, q2]).await.unwrap();
        let a = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a.qualifikationen.iter().map(|q| q.label.as_str()).collect::<Vec<_>>(), vec!["Sanitäter", "Gruppenführer"]);

        // q2 deaktivieren → bleibt in bestehender Zuordnung sichtbar.
        sqlx::query("UPDATE qualifikation SET aktiv = 0 WHERE id = ?").bind(q2).execute(&pool).await.unwrap();
        let a2 = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert!(a2.qualifikationen.iter().any(|q| q.id == q2), "deaktivierte Qualifikation bleibt sichtbar");

        // Vollersatz auf nur q1.
        aktualisiere(&pool, 1, p.id, daten("Thomas"), &[q1]).await.unwrap();
        let a3 = laden_anzeige(&pool, 1, p.id).await.unwrap();
        assert_eq!(a3.qualifikationen.len(), 1);
        assert_eq!(a3.qualifikationen[0].id, q1);
    }

    #[tokio::test]
    async fn vorschlaege_distinct_traeger() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut a = daten("A");
        a.traegerorganisation = Some("DRK");
        anlegen(&pool, 1, a, &[]).await.unwrap();
        let mut b = daten("B");
        b.traegerorganisation = Some("DRK");
        anlegen(&pool, 1, b, &[]).await.unwrap();
        let mut c = daten("C");
        c.traegerorganisation = Some("THW");
        anlegen(&pool, 1, c, &[]).await.unwrap();
        let v = vorschlaege(&pool, 1).await.unwrap();
        assert_eq!(v.traegerorganisation, vec!["DRK".to_string(), "THW".to_string()]);
    }
}
```

- [ ] **Step 2: Tests zum Scheitern bringen**

Run: `cargo test --lib personal::repo 2>&1 | head -5`
Expected: FAIL (Kompilerfehler: `PersonalDaten`, `anlegen`, … nicht gefunden).

- [ ] **Step 3: Implementierung **vor** den Test-Block setzen**

```rust
use super::{Personal, PersonalAnzeige, PersonalVorschlaege, QualifikationRef};
use crate::error::AppError;
use crate::katalog::{DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Personal` (FromRow).
const SPALTEN: &str = "id, org_id, benutzer_id, name, personalnummer, traegerorganisation, \
     telefon, staerke_position, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt (leer → `None`),
/// `staerke_position` bereits gegen das Enum validiert.
#[derive(Debug)]
pub struct PersonalDaten<'a> {
    pub name: &'a str,
    pub benutzer_id: Option<i64>,
    pub personalnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub telefon: Option<&'a str>,
    pub staerke_position: Option<&'a str>,
    pub bemerkung: Option<&'a str>,
}

/// Übersetzt einen Unique-Verstoß auf dem Personalnummer-Index in `Conflict`.
fn personalnummer_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Personalnummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Validiert den optionalen Benutzer-Link: Konto muss zur Org gehören
/// (`Validation`) und darf nicht schon mit einer anderen Person verknüpft sein
/// (`Conflict`). `eigene_id` schließt die zu aktualisierende Person aus.
async fn pruefe_benutzer_link(
    pool: &SqlitePool,
    org_id: i64,
    benutzer_id: i64,
    eigene_id: Option<i64>,
) -> Result<(), AppError> {
    let gehoert: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM benutzer WHERE id = ? AND org_id = ?")
            .bind(benutzer_id).bind(org_id).fetch_optional(pool).await?;
    if gehoert.is_none() {
        return Err(AppError::Validation("Benutzerkonto gehört nicht zur Organisation".into()));
    }
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM personal WHERE benutzer_id = ? AND (? IS NULL OR id <> ?)",
    )
    .bind(benutzer_id).bind(eigene_id).bind(eigene_id).fetch_optional(pool).await?;
    if belegt.is_some() {
        return Err(AppError::Conflict("Benutzerkonto ist bereits mit Personal verknüpft".into()));
    }
    Ok(())
}

/// Setzt die Qualifikations-Zuordnung einer Person als Vollersatz (löscht alle und
/// fügt die übergebenen wieder ein). Org-geschützt: nur ids, die zur Org gehören,
/// werden eingefügt (unbekannte/fremde werden still ignoriert — die UI bietet
/// ohnehin nur eigene Qualifikationen an).
async fn setze_qualifikationen(
    tx: &mut sqlx::SqliteConnection,
    org_id: i64,
    personal_id: i64,
    qualifikation_ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM personal_qualifikation WHERE personal_id = ?")
        .bind(personal_id).execute(&mut *tx).await?;
    for &qid in qualifikation_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO personal_qualifikation (personal_id, qualifikation_id) \
             SELECT ?, id FROM qualifikation WHERE id = ? AND org_id = ?",
        )
        .bind(personal_id).bind(qid).bind(org_id).execute(&mut *tx).await?;
    }
    Ok(())
}

/// Lädt eine Person der eigenen Org (roh); `NotFound` bei fremder/unbekannter id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Personal, AppError> {
    sqlx::query_as::<_, Personal>(&format!(
        "SELECT {SPALTEN} FROM personal WHERE id = ? AND org_id = ?"
    ))
    .bind(id).bind(org_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Qualifikationen einer Person (inkl. deaktivierter Zuordnungen), nach `sortier`.
async fn qualifikationen_von(
    pool: &SqlitePool,
    personal_id: i64,
) -> Result<Vec<QualifikationRef>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT q.id, q.label FROM personal_qualifikation pq \
         JOIN qualifikation q ON q.id = pq.qualifikation_id \
         WHERE pq.personal_id = ? ORDER BY q.sortier, q.id",
    )
    .bind(personal_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(id, label)| QualifikationRef { id, label }).collect())
}

/// Person als Anzeige (inkl. aufgelöster Qualifikationen). `NotFound` bei fremder id.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<PersonalAnzeige, AppError> {
    let p = laden(pool, org_id, id).await?;
    let qualifikationen = qualifikationen_von(pool, id).await?;
    Ok(zu_anzeige(p, qualifikationen))
}

/// Baut die Anzeige aus dem Rohdatensatz + aufgelösten Qualifikationen.
fn zu_anzeige(p: Personal, qualifikationen: Vec<QualifikationRef>) -> PersonalAnzeige {
    PersonalAnzeige {
        id: p.id,
        benutzer_id: p.benutzer_id,
        name: p.name,
        personalnummer: p.personalnummer,
        traegerorganisation: p.traegerorganisation,
        telefon: p.telefon,
        staerke_position: p.staerke_position,
        bemerkung: p.bemerkung,
        dienststatus: p.dienststatus,
        angelegt_at: p.angelegt_at,
        qualifikationen,
    }
}

/// Alle Personen der Org (Anzeige), sortiert nach Name; `nur_im_dienst` filtert
/// auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl). Lädt Qualifikationen in
/// einer zweiten Sammelabfrage (kein N+1).
pub async fn liste_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<PersonalAnzeige>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM personal WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY name")
    } else {
        format!("SELECT {SPALTEN} FROM personal WHERE org_id = ? ORDER BY name")
    };
    let personen = sqlx::query_as::<_, Personal>(&sql).bind(org_id).fetch_all(pool).await?;

    // Alle Qualifikations-Zuordnungen der Org in einer Abfrage holen und gruppieren.
    let zuordnungen = sqlx::query_as::<_, (i64, i64, String)>(
        "SELECT pq.personal_id, q.id, q.label FROM personal_qualifikation pq \
         JOIN qualifikation q ON q.id = pq.qualifikation_id \
         JOIN personal p ON p.id = pq.personal_id \
         WHERE p.org_id = ? ORDER BY q.sortier, q.id",
    )
    .bind(org_id).fetch_all(pool).await?;

    Ok(personen
        .into_iter()
        .map(|p| {
            let quals = zuordnungen
                .iter()
                .filter(|(pid, _, _)| *pid == p.id)
                .map(|(_, qid, label)| QualifikationRef { id: *qid, label: label.clone() })
                .collect();
            zu_anzeige(p, quals)
        })
        .collect())
}

/// DISTINCT Trägerorganisationen der Org (nicht-leer, sortiert) für die AutoComplete.
pub async fn vorschlaege(pool: &SqlitePool, org_id: i64) -> Result<PersonalVorschlaege, AppError> {
    let traegerorganisation = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT traegerorganisation FROM personal \
         WHERE org_id = ? AND traegerorganisation IS NOT NULL AND traegerorganisation <> '' \
         ORDER BY traegerorganisation",
    )
    .bind(org_id).fetch_all(pool).await?;
    Ok(PersonalVorschlaege { traegerorganisation })
}

/// Legt eine Person an (mit optionaler Qualifikations-Zuordnung). Validiert den
/// Benutzer-Link; Personalnummer-Dublette → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: PersonalDaten<'_>,
    qualifikation_ids: &[i64],
) -> Result<Personal, AppError> {
    if let Some(bid) = daten.benutzer_id {
        pruefe_benutzer_link(pool, org_id, bid, None).await?;
    }
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO personal \
            (org_id, benutzer_id, name, personalnummer, traegerorganisation, telefon, \
             staerke_position, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.benutzer_id)
    .bind(daten.name)
    .bind(daten.personalnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.telefon)
    .bind(daten.staerke_position)
    .bind(daten.bemerkung)
    .fetch_one(&mut *tx)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return personalnummer_conflict(e),
    };
    setze_qualifikationen(&mut tx, org_id, id, qualifikation_ids).await?;
    tx.commit().await?;
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder + Qualifikations-Zuordnung (org-scoped).
/// `NotFound` bei fremder Org; `Validation`/`Conflict` für den Benutzer-Link;
/// `Conflict` bei Personalnummer-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: PersonalDaten<'_>,
    qualifikation_ids: &[i64],
) -> Result<Personal, AppError> {
    // Existenz/Org sicherstellen (sonst NotFound statt stiller No-Op).
    laden(pool, org_id, id).await?;
    if let Some(bid) = daten.benutzer_id {
        pruefe_benutzer_link(pool, org_id, bid, Some(id)).await?;
    }
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE personal SET \
            benutzer_id = ?, name = ?, personalnummer = ?, traegerorganisation = ?, \
            telefon = ?, staerke_position = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.benutzer_id)
    .bind(daten.name)
    .bind(daten.personalnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.telefon)
    .bind(daten.staerke_position)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(&mut *tx)
    .await;

    if let Err(e) = ergebnis {
        return personalnummer_conflict(e);
    }
    setze_qualifikationen(&mut tx, org_id, id, qualifikation_ids).await?;
    tx.commit().await?;
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei fremder
/// Org; `Conflict`, wenn beim Reaktivieren die Personalnummer inzwischen aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Personal, AppError> {
    let neuer = if in_dienst { DIENSTSTATUS_IN_DIENST } else { DIENSTSTATUS_AUSSER_DIENST };
    let ergebnis = sqlx::query("UPDATE personal SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer).bind(id).bind(org_id).execute(pool).await;
    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return personalnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test --lib personal::repo`
Expected: PASS (alle Repo-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/personal/repo.rs
git commit -m "feat(personal): Stamm-Repo mit Soft-Delete, Qualifikations-Zuordnung und Benutzer-Link"
```

---

## Task 6: `src/personal/qualifikation_repo.rs` — Katalog-CRUD + `funktion_text`

Katalog-CRUD (Deaktivieren statt Löschen) **plus** den geteilten `funktion_text`-Helper, der die Funktion einer Person aus ihren **aktiven** Qualifikationen (nach `sortier`, kommasepariert) zusammensetzt — er ist die **einzige Quelle** der `snap_funktion`-Komposition beim Disponieren.

**Files:**
- Replace: `src/personal/qualifikation_repo.rs`

- [ ] **Step 1: Failing Tests schreiben (Test-Block ans Ende)**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn anlegen_liste_nur_aktiv_nach_sortier() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let l = liste(&pool, 1).await.unwrap();
        assert_eq!(l.iter().map(|q| q.label.as_str()).collect::<Vec<_>>(), vec!["Sanitäter", "Gruppenführer"]);
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        assert!(matches!(anlegen(&pool, 1, "Sanitäter", 20).await.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_aus_liste_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let q = anlegen(&pool, 1, "Notarzt", 40).await.unwrap();
        deaktivieren(&pool, 1, q.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
        assert_eq!(laden(&pool, 1, q.id).await.unwrap().id, q.id);
    }

    #[tokio::test]
    async fn funktion_text_nur_aktive_nach_sortier() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let san = anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let inaktiv = anlegen(&pool, 1, "Veraltet", 5).await.unwrap();
        let pid: i64 = sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (1, 'T') RETURNING id").fetch_one(&pool).await.unwrap();
        for q in [san.id, gf.id, inaktiv.id] {
            sqlx::query("INSERT INTO personal_qualifikation (personal_id, qualifikation_id) VALUES (?, ?)")
                .bind(pid).bind(q).execute(&pool).await.unwrap();
        }
        deaktivieren(&pool, 1, inaktiv.id).await.unwrap();
        // Reihenfolge nach sortier; deaktivierte raus.
        assert_eq!(funktion_text(&pool, pid).await.unwrap().as_deref(), Some("Sanitäter, Gruppenführer"));
    }

    #[tokio::test]
    async fn funktion_text_ohne_qualifikationen_ist_none() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let pid: i64 = sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (1, 'T') RETURNING id").fetch_one(&pool).await.unwrap();
        assert_eq!(funktion_text(&pool, pid).await.unwrap(), None);
    }
}
```

- [ ] **Step 2: Tests zum Scheitern bringen**

Run: `cargo test --lib personal::qualifikation_repo 2>&1 | head -5`
Expected: FAIL (Kompilerfehler).

- [ ] **Step 3: Implementierung **vor** den Test-Block setzen**

```rust
use super::Qualifikation;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Funktion einer Person als kommaseparierter Text aus ihren **aktiven** Qualifikationen,
/// geordnet nach `sortier`, dann `id`. **Einzige Quelle der `snap_funktion`-Komposition**
/// (siehe `disposition_repo::disponiere_stamm`); die Live-Anzeige in
/// `disposition_repo` verwendet die identische geordnete Subquery — beide MÜSSEN
/// dieselbe Ausgabe erzeugen (Test `funktion_komposition_identisch` in Task 8).
/// `None`, wenn die Person keine aktive Qualifikation hat.
pub async fn funktion_text(pool: &SqlitePool, personal_id: i64) -> Result<Option<String>, AppError> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT GROUP_CONCAT(label, ', ') FROM ( \
            SELECT q.label FROM personal_qualifikation pq \
            JOIN qualifikation q ON q.id = pq.qualifikation_id \
            WHERE pq.personal_id = ? AND q.aktiv = 1 \
            ORDER BY q.sortier, q.id \
         )",
    )
    .bind(personal_id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict("Qualifikation ist bereits vorhanden".into()));
        }
    }
    Err(e.into())
}

/// Lädt eine Qualifikation der Org (ignoriert `aktiv`); `NotFound` bei fremder id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Qualifikation, AppError> {
    sqlx::query_as::<_, Qualifikation>(
        "SELECT id, label, sortier FROM qualifikation WHERE id = ? AND org_id = ?",
    )
    .bind(id).bind(org_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Nur aktive Qualifikationen der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<Qualifikation>, AppError> {
    sqlx::query_as::<_, Qualifikation>(
        "SELECT id, label, sortier FROM qualifikation WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id",
    )
    .bind(org_id).fetch_all(pool).await.map_err(Into::into)
}

/// Legt eine Qualifikation an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    label: &str,
    sortier: i64,
) -> Result<Qualifikation, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id).bind(label).bind(sortier).fetch_one(pool).await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz von label/sortier (org-scoped). `NotFound`/`Conflict` analog Stamm.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    label: &str,
    sortier: i64,
) -> Result<Qualifikation, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE qualifikation SET label = ?, sortier = ? WHERE id = ? AND org_id = ?",
    )
    .bind(label).bind(sortier).bind(id).bind(org_id).execute(pool).await;
    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return label_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert eine Qualifikation (Soft-Delete `aktiv = 0`); bestehende Zuordnungen
/// bleiben gültig. `NotFound` bei fremder/unbekannter id.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("UPDATE qualifikation SET aktiv = 0 WHERE id = ? AND org_id = ?")
        .bind(id).bind(org_id).execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test --lib personal::qualifikation_repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/personal/qualifikation_repo.rs
git commit -m "feat(personal): Qualifikations-Katalog-Repo + funktion_text-Komposition"
```

---

## Task 7: `src/personal/status_repo.rs` — Status-Katalog

Identisch zu `src/fahrzeug/status_repo.rs`, **minus `fms_anker`** und auf `personal_status` umgestellt. Inkl. `erster_der_kategorie` (deterministisch `ORDER BY sortier, id LIMIT 1`) und `ist_in_org`.

**Files:**
- Replace: `src/personal/status_repo.rs`

- [ ] **Step 1: Failing Tests schreiben (Test-Block ans Ende)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::{KATEGORIE_GEBUNDEN, KATEGORIE_VERFUEGBAR};

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }

    fn daten<'a>(label: &'a str, kategorie: &'a str, sortier: i64) -> StatusDaten<'a> {
        StatusDaten { label, kategorie, farbe: None, sortier }
    }

    #[tokio::test]
    async fn anlegen_liste_sortiert_nur_aktiv() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        anlegen(&pool, 1, daten("verfügbar", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();
        let l = liste(&pool, 1).await.unwrap();
        assert_eq!(l[0].label, "verfügbar");
        assert_eq!(l[1].label, "alarmiert");
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("alarmiert", KATEGORIE_VERFUEGBAR, 5)).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let s = anlegen(&pool, 1, daten("alt", KATEGORIE_VERFUEGBAR, 10)).await.unwrap();
        deaktivieren(&pool, 1, s.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
        assert_eq!(laden(&pool, 1, s.id).await.unwrap().id, s.id);
    }

    #[tokio::test]
    async fn erster_der_kategorie_deterministisch() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let frueh = anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        anlegen(&pool, 1, daten("anfahrt", KATEGORIE_GEBUNDEN, 30)).await.unwrap();
        assert_eq!(erster_der_kategorie(&pool, 1, KATEGORIE_GEBUNDEN).await.unwrap(), Some(frueh.id));
        assert_eq!(erster_der_kategorie(&pool, 1, KATEGORIE_VERFUEGBAR).await.unwrap(), None);
    }

    #[tokio::test]
    async fn ist_in_org_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let s = anlegen(&pool, 1, daten("alarmiert", KATEGORIE_GEBUNDEN, 20)).await.unwrap();
        assert!(ist_in_org(&pool, 1, s.id).await.unwrap());
        assert!(!ist_in_org(&pool, 2, s.id).await.unwrap());
    }
}
```

- [ ] **Step 2: Tests zum Scheitern bringen**

Run: `cargo test --lib personal::status_repo 2>&1 | head -5`
Expected: FAIL (Kompilerfehler).

- [ ] **Step 3: Implementierung **vor** den Test-Block setzen**

```rust
use super::PersonalStatus;
use crate::error::AppError;
use sqlx::SqlitePool;

const SPALTEN: &str = "id, label, kategorie, farbe, sortier";

/// Editierbare Katalog-Felder. `kategorie` ist bereits gegen das Enum validiert.
#[derive(Debug)]
pub struct StatusDaten<'a> {
    pub label: &'a str,
    pub kategorie: &'a str,
    pub farbe: Option<&'a str>,
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

/// Lädt einen Status der Org (ignoriert `aktiv`); `NotFound` bei fremder id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<PersonalStatus, AppError> {
    sqlx::query_as::<_, PersonalStatus>(&format!(
        "SELECT {SPALTEN} FROM personal_status WHERE id = ? AND org_id = ?"
    ))
    .bind(id).bind(org_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

/// Nur aktive Status der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<PersonalStatus>, AppError> {
    sqlx::query_as::<_, PersonalStatus>(&format!(
        "SELECT {SPALTEN} FROM personal_status WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    ))
    .bind(org_id).fetch_all(pool).await.map_err(Into::into)
}

/// Legt einen Status an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: StatusDaten<'_>,
) -> Result<PersonalStatus, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO personal_status (org_id, label, kategorie, farbe, sortier) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id).bind(daten.label).bind(daten.kategorie).bind(daten.farbe).bind(daten.sortier)
    .fetch_one(pool).await;
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
) -> Result<PersonalStatus, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE personal_status SET label = ?, kategorie = ?, farbe = ?, sortier = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label).bind(daten.kategorie).bind(daten.farbe).bind(daten.sortier)
    .bind(id).bind(org_id).execute(pool).await;
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
    let resultat = sqlx::query("UPDATE personal_status SET aktiv = 0 WHERE id = ? AND org_id = ?")
        .bind(id).bind(org_id).execute(pool).await?;
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
        "SELECT id FROM personal_status \
         WHERE org_id = ? AND aktiv = 1 AND kategorie = ? ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id).bind(kategorie).fetch_optional(pool).await.map_err(Into::into)
}

/// Ob ein aktiver Status mit dieser id zur Org gehört (PATCH-Disposition-Validierung).
pub async fn ist_in_org(pool: &SqlitePool, org_id: i64, status_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM personal_status WHERE id = ? AND org_id = ? AND aktiv = 1",
    )
    .bind(status_id).bind(org_id).fetch_optional(pool).await?;
    Ok(treffer.is_some())
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test --lib personal::status_repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/personal/status_repo.rs
git commit -m "feat(personal): Personal-Status-Katalog-Repo (ohne FMS-Anker)"
```

---

## Task 8: `src/personal/disposition_repo.rs` — Disposition + Auflösung

Disposition von Stamm-/Ad-hoc-Personen mit Identitäts-Schnappschuss und Auflösungsregel (Live vs. Snapshot). Analog `src/fahrzeug/disposition_repo.rs`. **Besonderheiten gegenüber Fahrzeug:** `snap_funktion` aus `qualifikation_repo::funktion_text`; Live-Funktion via identischer geordneter Subquery; `staerke_position`-Auflösung `COALESCE(ep, p)` (kein Snapshot).

**Files:**
- Replace: `src/personal/disposition_repo.rs`

- [ ] **Step 1: Failing Tests schreiben (Test-Block ans Ende)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::KATEGORIE_GEBUNDEN;
    use crate::personal::repo::{self as p_repo, PersonalDaten};
    use crate::personal::status_repo::{self, StatusDaten};
    use crate::personal::qualifikation_repo;

    /// Org(1) + Benutzer + Einsatz + ein 'gebunden'-Status; liefert (benutzer, einsatz).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        status_repo::anlegen(pool, 1, StatusDaten {
            label: "alarmiert", kategorie: KATEGORIE_GEBUNDEN, farbe: None, sortier: 20,
        }).await.unwrap();
        (benutzer, einsatz)
    }

    fn p_daten(name: &str) -> PersonalDaten<'_> {
        PersonalDaten {
            name, benutzer_id: None, personalnummer: None, traegerorganisation: Some("DRK"),
            telefon: None, staerke_position: Some("fuehrer"), bemerkung: None,
        }
    }

    #[tokio::test]
    async fn disponiere_stamm_fuellt_snapshot_status_und_funktion() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[san.id, gf.id]).await.unwrap();

        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.name, "Thomas Müller");
        assert_eq!(a.funktion.as_deref(), Some("Sanitäter, Gruppenführer"));
        assert_eq!(a.status_kategorie.as_deref(), Some("gebunden"));
        assert_eq!(a.staerke_position.as_deref(), Some("fuehrer"), "Stamm-Default greift");
        assert!(!a.ist_adhoc);
    }

    #[tokio::test]
    async fn staerke_position_override_schlaegt_stamm_default() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap(); // Stamm = fuehrer
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, Some("mannschaft"), benutzer).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"), "Override schlägt Default");
    }

    #[tokio::test]
    async fn doppelte_stamm_disposition_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')").execute(&pool).await.unwrap();
        let fremd: i64 = sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (2, 'Fremd') RETURNING id").fetch_one(&pool).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, fremd, None, benutzer).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn disponiere_stamm_ausser_dienst_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        p_repo::setze_dienststatus(&pool, 1, person.id, false).await.unwrap();
        assert!(matches!(
            disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn adhoc_mehrfach_erlaubt_nur_dispo_position() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for name in ["Notarzt Extern", "Helfer Extern"] {
            disponiere_adhoc(&pool, einsatz, 1, AdhocDaten {
                name, funktion: Some("Notarzt"), traegerorganisation: Some("KV"),
                staerke_position: Some("unterfuehrer"),
            }, benutzer).await.unwrap();
        }
        let l = liste(&pool, einsatz, true).await.unwrap();
        assert_eq!(l.len(), 2);
        assert!(l.iter().all(|a| a.ist_adhoc && a.personal_id.is_none()));
        assert_eq!(l[0].staerke_position.as_deref(), Some("unterfuehrer"));
    }

    #[tokio::test]
    async fn snapshot_stabil_live_vs_snapshot() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas Müller"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

        // Stamm nachträglich umbenennen.
        p_repo::aktualisiere(&pool, 1, person.id, p_daten("Thomas NEU"), &[]).await.unwrap();
        // Aktiver Einsatz → Live (neuer Name).
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().name, "Thomas NEU");
        // Abgeschlossen → Snapshot (alter Name).
        assert_eq!(laden_anzeige(&pool, einsatz, ep, false).await.unwrap().name, "Thomas Müller");
        // Außer Dienst → auch bei aktivem Einsatz Snapshot.
        p_repo::setze_dienststatus(&pool, 1, person.id, false).await.unwrap();
        assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().name, "Thomas Müller");
    }

    #[tokio::test]
    async fn funktion_komposition_identisch() {
        // snap_funktion (beim Disponieren) und Live-Funktion (in der Anzeige) MÜSSEN
        // dieselbe Komposition liefern. Pinnt beide Pfade auf dieselbe Ausgabe.
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let san = qualifikation_repo::anlegen(&pool, 1, "Sanitäter", 10).await.unwrap();
        let gf = qualifikation_repo::anlegen(&pool, 1, "Gruppenführer", 60).await.unwrap();
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[gf.id, san.id]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

        let live = laden_anzeige(&pool, einsatz, ep, true).await.unwrap().funktion;
        let snap = laden_anzeige(&pool, einsatz, ep, false).await.unwrap().funktion;
        let helper = qualifikation_repo::funktion_text(&pool, person.id).await.unwrap();
        assert_eq!(live, snap, "Live == Snapshot bei unverändertem Stamm");
        assert_eq!(live, helper, "Anzeige == funktion_text-Helper");
        assert_eq!(live.as_deref(), Some("Sanitäter, Gruppenführer"));
    }

    #[tokio::test]
    async fn aktualisiere_status_position_bemerkung_dann_entferne() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
        let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();
        let neuer = status_repo::anlegen(&pool, 1, StatusDaten {
            label: "im Einsatz", kategorie: KATEGORIE_GEBUNDEN, farbe: None, sortier: 40,
        }).await.unwrap();

        aktualisiere(&pool, einsatz, ep, Some(neuer.id), Some("mannschaft"), Some("vor Ort")).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(a.status_id, Some(neuer.id));
        assert_eq!(a.staerke_position.as_deref(), Some("mannschaft"));
        assert_eq!(a.bemerkung.as_deref(), Some("vor Ort"));

        // status_id None → bleibt; position None → bleibt; nur Bemerkung leeren.
        aktualisiere(&pool, einsatz, ep, None, None, Some("")).await.unwrap();
        let b = laden_anzeige(&pool, einsatz, ep, true).await.unwrap();
        assert_eq!(b.status_id, Some(neuer.id), "Status unverändert");
        assert_eq!(b.staerke_position.as_deref(), Some("mannschaft"), "Position unverändert");
        assert_eq!(b.bemerkung.as_deref(), Some(""), "Bemerkung geleert");

        entferne(&pool, einsatz, ep).await.unwrap();
        assert!(matches!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 2: Tests zum Scheitern bringen**

Run: `cargo test --lib personal::disposition_repo 2>&1 | head -5`
Expected: FAIL (Kompilerfehler).

- [ ] **Step 3: Implementierung **vor** den Test-Block setzen**

```rust
use super::qualifikation_repo;
use super::{status_repo, EinsatzPersonalAnzeige};
use crate::error::AppError;
use crate::katalog::{DIENSTSTATUS_IN_DIENST, KATEGORIE_GEBUNDEN};
use sqlx::SqlitePool;

/// SELECT mit aufgelöster Live-Identität (LEFT JOIN personal), Live-Funktion (geordnete
/// Subquery über aktive Qualifikationen — identisch zu `qualifikation_repo::funktion_text`)
/// und Status (LEFT JOIN personal_status). Live vs. Snapshot wählt `zu_anzeige`.
const SELECT_AUFGELOEST: &str = "\
    SELECT ep.id, ep.einsatz_id, ep.personal_id, ep.status_id, \
           ep.staerke_position AS ep_staerke_position, \
           ep.snap_name, ep.snap_funktion, ep.snap_traegerorganisation, \
           ep.bemerkung, ep.disponiert_at, ep.disponiert_von, \
           p.name AS live_name, p.traegerorganisation AS live_traegerorganisation, \
           p.dienststatus AS live_dienststatus, p.staerke_position AS live_staerke_position, \
           (SELECT GROUP_CONCAT(label, ', ') FROM ( \
                SELECT q.label FROM personal_qualifikation pq \
                JOIN qualifikation q ON q.id = pq.qualifikation_id \
                WHERE pq.personal_id = ep.personal_id AND q.aktiv = 1 \
                ORDER BY q.sortier, q.id \
           )) AS live_funktion, \
           s.label AS status_label, s.kategorie AS status_kategorie, s.farbe AS status_farbe \
    FROM einsatz_personal ep \
    LEFT JOIN personal p ON p.id = ep.personal_id \
    LEFT JOIN personal_status s ON s.id = ep.status_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    personal_id: Option<i64>,
    status_id: Option<i64>,
    ep_staerke_position: Option<String>,
    snap_name: String,
    snap_funktion: Option<String>,
    snap_traegerorganisation: Option<String>,
    bemerkung: Option<String>,
    disponiert_at: String,
    disponiert_von: Option<i64>,
    live_name: Option<String>,
    live_traegerorganisation: Option<String>,
    live_dienststatus: Option<String>,
    live_staerke_position: Option<String>,
    live_funktion: Option<String>,
    status_label: Option<String>,
    status_kategorie: Option<String>,
    status_farbe: Option<String>,
}

/// Auflösungsregel für Identität/Funktion: Live nur, wenn Stamm-Bezug besteht, der
/// Einsatz aktiv ist UND die Person in Dienst ist. Sonst Snapshot. Die Stärke-Position
/// wird IMMER live aufgelöst (Dispo-Override vor Stamm-Default, kein Snapshot-Feld).
fn zu_anzeige(row: Row, einsatz_aktiv: bool) -> EinsatzPersonalAnzeige {
    let live = row.personal_id.is_some()
        && einsatz_aktiv
        && row.live_dienststatus.as_deref() == Some(DIENSTSTATUS_IN_DIENST);

    let (name, funktion, traeger) = if live {
        (
            row.live_name.clone().unwrap_or_else(|| row.snap_name.clone()),
            row.live_funktion,
            row.live_traegerorganisation,
        )
    } else {
        (row.snap_name, row.snap_funktion, row.snap_traegerorganisation)
    };

    EinsatzPersonalAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        personal_id: row.personal_id,
        ist_adhoc: row.personal_id.is_none(),
        name,
        funktion,
        traegerorganisation: traeger,
        staerke_position: row.ep_staerke_position.or(row.live_staerke_position),
        status_id: row.status_id,
        status_label: row.status_label,
        status_kategorie: row.status_kategorie,
        status_farbe: row.status_farbe,
        bemerkung: row.bemerkung,
        disponiert_at: row.disponiert_at,
        disponiert_von: row.disponiert_von,
    }
}

/// Daten für eine Ad-hoc-externe Person (kein Stamm-Bezug); bereits getrimmt/validiert.
#[derive(Debug)]
pub struct AdhocDaten<'a> {
    pub name: &'a str,
    pub funktion: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub staerke_position: Option<&'a str>,
}

/// Disponiertes Personal eines Einsatzes (aufgelöst), sortiert nach Dispo-Zeit.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzPersonalAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ep.einsatz_id = ? ORDER BY ep.disponiert_at, ep.id"
    ))
    .bind(einsatz_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| zu_anzeige(r, einsatz_aktiv)).collect())
}

/// Lädt eine Dispositionszeile (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden_anzeige(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    einsatz_aktiv: bool,
) -> Result<EinsatzPersonalAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE ep.id = ? AND ep.einsatz_id = ?"
    ))
    .bind(ep_id).bind(einsatz_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;
    Ok(zu_anzeige(row, einsatz_aktiv))
}

/// Disponiert eine Stamm-Person. Prüft Org-Zugehörigkeit + Dienststatus, friert den
/// Identitäts-Schnappschuss ein (`snap_funktion` aus den aktiven Qualifikationen) und
/// setzt den ersten `gebunden`-Status. `staerke_position` ist der optionale Dispo-Override.
/// `NotFound` bei fremder/unbek. Person, `Validation` bei außer Dienst, `Conflict` bei
/// Doppel-Disposition. Liefert die neue `ep_id`.
pub async fn disponiere_stamm(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    personal_id: i64,
    staerke_position: Option<&str>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let snap = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT name, traegerorganisation, dienststatus FROM personal WHERE id = ? AND org_id = ?",
    )
    .bind(personal_id).bind(org_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;
    let (name, traeger, dienststatus) = snap;
    if dienststatus != DIENSTSTATUS_IN_DIENST {
        return Err(AppError::Validation(
            "Person ist außer Dienst und kann nicht disponiert werden".into(),
        ));
    }
    let funktion = qualifikation_repo::funktion_text(pool, personal_id).await?;
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;

    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(personal_id)
    .bind(status_id)
    .bind(staerke_position)
    .bind(&name)
    .bind(&funktion)
    .bind(&traeger)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await;

    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Person ist bereits in diesem Einsatz disponiert".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Disponiert eine Ad-hoc-externe Person (`personal_id = NULL`); `snap_*` sind die
/// eigentlichen Daten. Initial-Status = erster `gebunden`. Liefert die neue `ep_id`.
pub async fn disponiere_adhoc(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    daten: AdhocDaten<'_>,
    disponiert_von: i64,
) -> Result<i64, AppError> {
    let status_id = status_repo::erster_der_kategorie(pool, org_id, KATEGORIE_GEBUNDEN).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_personal \
            (einsatz_id, personal_id, status_id, staerke_position, snap_name, snap_funktion, \
             snap_traegerorganisation, disponiert_von) \
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status_id)
    .bind(daten.staerke_position)
    .bind(daten.name)
    .bind(daten.funktion)
    .bind(daten.traegerorganisation)
    .bind(disponiert_von)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Aktualisiert Status, Stärke-Position und/oder Bemerkung (COALESCE: `None` = unverändert).
/// `NotFound`, falls die Zeile nicht zum Einsatz gehört.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    ep_id: i64,
    status_id: Option<i64>,
    staerke_position: Option<&str>,
    bemerkung: Option<&str>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_personal \
         SET status_id = COALESCE(?, status_id), \
             staerke_position = COALESCE(?, staerke_position), \
             bemerkung = COALESCE(?, bemerkung) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(status_id).bind(staerke_position).bind(bemerkung).bind(ep_id).bind(einsatz_id)
    .execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Entfernt eine Dispositionszeile aus dem Einsatz (der Stamm bleibt). `NotFound`,
/// falls nicht zum Einsatz gehörend.
pub async fn entferne(pool: &SqlitePool, einsatz_id: i64, ep_id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("DELETE FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
        .bind(ep_id).bind(einsatz_id).execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

> **Hinweis:** `staerke_position` wird im Repo **nicht** validiert (Enum-Prüfung macht die Route via `StaerkePosition::parse`). Die `CHECK`-Constraint der DB fängt ungültige Werte zusätzlich ab.

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test --lib personal::disposition_repo`
Expected: PASS (alle Dispositions-Tests, insb. `funktion_komposition_identisch`).

- [ ] **Step 5: Gesamtes Lib-Testpaket + Clippy**

Run: `cargo test --lib personal && cargo clippy --lib -- -D warnings`
Expected: PASS, keine Warnungen.

- [ ] **Step 6: Commit**

```bash
git add src/personal/disposition_repo.rs
git commit -m "feat(personal): Dispositions-Repo mit Snapshot, Live-Auflösung und Stärke-Position"
```

---

## Task 9: Bootstrap — Qualifikation + Personal-Status für neue Orgs seeden

`bootstrap_admin` seedet für neue Orgs zusätzlich den Qualifikations- und Personal-Status-Default (analog zur bestehenden Status-/Stichwort-Seedung). Werte aus `personal::{QUALIFIKATION_STARTLISTE, PERSONAL_STATUS_STARTLISTE}`.

**Files:**
- Modify: `src/auth/bootstrap.rs:1-5` (Imports), `:90-102` (Seed-Schleifen), Test-Block

- [ ] **Step 1: Failing Tests schreiben**

Im `#[cfg(test)] mod tests` von `src/auth/bootstrap.rs` anhängen (Muster: `seedet_status_katalog_fuer_neue_org`):

```rust
    #[tokio::test]
    async fn seedet_qualifikations_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM qualifikation ORDER BY sortier",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(labels.len(), 9, "neun Default-Qualifikationen erwartet");
        assert_eq!(labels.first().map(String::as_str), Some("Sanitäter"));
        assert!(labels.contains(&"Notarzt".to_string()));
    }

    #[tokio::test]
    async fn seedet_personal_status_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM personal_status ORDER BY sortier",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(labels.len(), 6, "sechs Default-Personal-Status erwartet");
        // 'alarmiert' ist als 'gebunden' geseedet (erster Initial-Status der Disposition).
        let kat: String = sqlx::query_scalar(
            "SELECT kategorie FROM personal_status WHERE label = 'alarmiert'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(kat, "gebunden");
    }
```

- [ ] **Step 2: Tests zum Scheitern bringen**

Run: `cargo test --lib auth::bootstrap::tests::seedet_qualifikations_startliste_fuer_neue_org`
Expected: FAIL (`labels.len()` ist 0 — noch kein Seeding).

- [ ] **Step 3: Import in `src/auth/bootstrap.rs` ergänzen**

Zeile 3 (`use crate::fahrzeug::STATUS_STARTLISTE;`) um die Personal-Startlisten erweitern:

```rust
use crate::fahrzeug::STATUS_STARTLISTE;
use crate::personal::{PERSONAL_STATUS_STARTLISTE, QUALIFIKATION_STARTLISTE};
```

- [ ] **Step 4: Seed-Schleifen in der Transaktion ergänzen**

Nach der bestehenden `for (label, kategorie, fms_anker, sortier) in STATUS_STARTLISTE { … }`-Schleife (vor `tx.commit().await?;`) einfügen:

```rust
    for (label, sortier) in QUALIFIKATION_STARTLISTE {
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?)")
            .bind(org_id)
            .bind(label)
            .bind(sortier)
            .execute(&mut *tx)
            .await?;
    }

    for (label, kategorie, sortier) in PERSONAL_STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --lib auth::bootstrap`
Expected: PASS (neue + bestehende Bootstrap-Tests grün).

- [ ] **Step 6: Commit**

```bash
git add src/auth/bootstrap.rs
git commit -m "feat(bootstrap): Qualifikations- und Personal-Status-Default für neue Orgs seeden"
```

---

## Task 10: Routen — Globaler Personal-Stamm

`src/routes/personal.rs` analog `src/routes/fahrzeug.rs`: `GET` für alle, Schreiben Admin. Validiert `name`, `staerke_position` (Enum), übergibt `qualifikation_ids`.

**Files:**
- Create: `src/routes/personal.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Create: `tests/personal.rs`

- [ ] **Step 1: `src/routes/personal.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::personal::repo::{self, PersonalDaten};
use crate::personal::{PersonalAnzeige, PersonalVorschlaege};
use crate::staerke::StaerkePosition;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct PersonalBody {
    pub name: String,
    pub benutzer_id: Option<i64>,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub qualifikation_ids: Vec<i64>,
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Owned, validierte Felder; `PersonalDaten` borgt daraus.
struct Normalisiert {
    name: String,
    benutzer_id: Option<i64>,
    personalnummer: Option<String>,
    traegerorganisation: Option<String>,
    telefon: Option<String>,
    staerke_position: Option<String>,
    bemerkung: Option<String>,
    qualifikation_ids: Vec<i64>,
}

impl Normalisiert {
    fn daten(&self) -> PersonalDaten<'_> {
        PersonalDaten {
            name: &self.name,
            benutzer_id: self.benutzer_id,
            personalnummer: self.personalnummer.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            telefon: self.telefon.as_deref(),
            staerke_position: self.staerke_position.as_deref(),
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: PersonalBody) -> Result<Normalisiert, AppError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let staerke_position = match trimme(body.staerke_position) {
        Some(s) => {
            if StaerkePosition::parse(&s).is_none() {
                return Err(AppError::Validation("Ungültige Stärke-Position".into()));
            }
            Some(s)
        }
        None => None,
    };
    Ok(Normalisiert {
        name,
        benutzer_id: body.benutzer_id,
        personalnummer: trimme(body.personalnummer),
        traegerorganisation: trimme(body.traegerorganisation),
        telefon: trimme(body.telefon),
        staerke_position,
        bemerkung: trimme(body.bemerkung),
        qualifikation_ids: body.qualifikation_ids,
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/personal — alle eingeloggten Nutzer (eigene Org), inkl. Qualifikationen.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonalAnzeige>>, AppError> {
    Ok(Json(
        repo::liste_anzeige(&state.pool, benutzer.org_id, params.nur_im_dienst).await?,
    ))
}

/// GET /api/personal-vorschlaege — abgeleitete Trägerorganisations-Vorschläge (eigene Org).
pub async fn vorschlaege(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<PersonalVorschlaege>, AppError> {
    Ok(Json(repo::vorschlaege(&state.pool, benutzer.org_id).await?))
}

/// POST /api/personal — Admin. Dublette Personalnummer → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<PersonalBody>,
) -> Result<(StatusCode, Json<PersonalAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let p = repo::anlegen(&state.pool, benutzer.org_id, n.daten(), &n.qualifikation_ids).await?;
    let a = repo::laden_anzeige(&state.pool, benutzer.org_id, p.id).await?;
    Ok((StatusCode::CREATED, Json(a)))
}

/// PATCH /api/personal/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<PersonalBody>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    let n = normalisiere(body)?;
    repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten(), &n.qualifikation_ids).await?;
    let a = repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?;
    Ok(Json(a))
}

/// POST /api/personal/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?))
}

/// POST /api/personal/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Nummernkollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<PersonalAnzeige>, AppError> {
    repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(repo::laden_anzeige(&state.pool, benutzer.org_id, id).await?))
}
```

- [ ] **Step 2: `src/routes/mod.rs` ergänzen**

In diesem Task **nur** `pub mod personal;` hinzufügen (alphabetisch einsortiert, zwischen `pub mod health;` und `pub mod stichwort;`). Die Module `qualifikation`, `personal_status` und `einsatz_personal` werden in ihren eigenen Tasks (11–13) deklariert — eine Deklaration ohne existierende Datei ist ein Kompilerfehler, daher jeweils erst dort.

```rust
pub mod personal;
```

- [ ] **Step 3: Routen in `src/app.rs` registrieren**

Im `build_router` nach dem `fahrzeug-status`-Block (vor dem schließenden `;` der Router-Kette) einfügen:

```rust
        .route("/api/personal", get(routes::personal::liste))
        .route("/api/personal", post(routes::personal::anlegen))
        .route("/api/personal-vorschlaege", get(routes::personal::vorschlaege))
        .route("/api/personal/{id}", patch(routes::personal::aktualisieren))
        .route("/api/personal/{id}/ausser-dienst", post(routes::personal::ausser_dienst))
        .route("/api/personal/{id}/in-dienst", post(routes::personal::in_dienst))
```

- [ ] **Step 4: Integrationstest `tests/personal.rs` schreiben**

Den Harness aus `tests/fahrzeug.rs` (Zeilen 1–88: `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`) **wörtlich übernehmen** und folgende Tests anhängen:

```rust
// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_person_an_alle_lesen_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/personal", &admin,
        Some(r#"{"name":"Thomas Müller","staerke_position":"fuehrer"}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 0);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &erika, Some(r#"{"name":"Verboten"}"#)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_personalnummer_ist_409_namen_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Gleicher Name ohne Nummer → erlaubt.
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas Müller"}"#)).await.0, StatusCode::CREATED);
    // Gleiche Nummer → Conflict.
    let mit_nr = r#"{"name":"A","personalnummer":"4711"}"#;
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(mit_nr)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"B","personalnummer":"4711"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn ungueltige_staerke_position_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"X","staerke_position":"chef"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(r#"{"name":"Thomas"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(anfrage(&app, "POST", &format!("/api/personal/{id}/ausser-dienst"), &admin, None).await.0, StatusCode::OK);
    let (_, im_dienst) = anfrage(&app, "GET", "/api/personal?nur_im_dienst=true", &admin, None).await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/personal", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn qualifikationen_werden_zugeordnet_und_aufgeloest() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Aus dem Bootstrap-Seed zwei Qualifikations-IDs holen.
    let (_, quals) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    // Dieser Test setzt voraus, dass Task 11 (GET /api/qualifikationen) registriert ist.
    let ids: Vec<i64> = quals.as_array().unwrap().iter().take(2).map(|q| q["id"].as_i64().unwrap()).collect();
    let body = format!(r#"{{"name":"Thomas","qualifikation_ids":[{},{}]}}"#, ids[0], ids[1]);
    let (status, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 2);
}
```

> **Reihenfolge-Hinweis:** `qualifikationen_werden_zugeordnet_und_aufgeloest` braucht `GET /api/qualifikationen` aus Task 11. Schreibe diesen einen Test erst, nachdem Task 11 registriert ist, oder führe ihn nach Task 11 aus. Die übrigen Tests laufen sofort.

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --test personal`
Expected: PASS (außer ggf. `qualifikationen_werden_zugeordnet_und_aufgeloest` bis Task 11 registriert ist).

- [ ] **Step 6: Commit**

```bash
git add src/routes/personal.rs src/routes/mod.rs src/app.rs tests/personal.rs
git commit -m "feat(routes): globaler Personal-Stamm (CRUD, Soft-Delete, Qualifikations-Zuordnung)"
```

---

## Task 11: Routen — Qualifikations-Katalog

`src/routes/qualifikation.rs` analog `src/routes/fahrzeug_status.rs`, aber schlanker (nur label/sortier, kein kategorie/farbe/fms).

**Files:**
- Create: `src/routes/qualifikation.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Create: `tests/qualifikation.rs`

- [ ] **Step 1: `src/routes/qualifikation.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::personal::qualifikation_repo as repo;
use crate::personal::Qualifikation;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct QualifikationBody {
    pub label: String,
    #[serde(default)]
    pub sortier: i64,
}

fn normalisiere_label(label: &str) -> Result<String, AppError> {
    let l = label.trim().to_string();
    if l.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    Ok(l)
}

/// GET /api/qualifikationen — aktive Katalog-Einträge (eigene Org), für die Auswahl.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<Qualifikation>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/qualifikationen — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<QualifikationBody>,
) -> Result<(StatusCode, Json<Qualifikation>), AppError> {
    let label = normalisiere_label(&body.label)?;
    let q = repo::anlegen(&state.pool, benutzer.org_id, &label, body.sortier).await?;
    Ok((StatusCode::CREATED, Json(q)))
}

/// PATCH /api/qualifikationen/{id} — Admin, Vollersatz label/sortier.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<QualifikationBody>,
) -> Result<Json<Qualifikation>, AppError> {
    let label = normalisiere_label(&body.label)?;
    let q = repo::aktualisiere(&state.pool, benutzer.org_id, id, &label, body.sortier).await?;
    Ok(Json(q))
}

/// POST /api/qualifikationen/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: `src/routes/mod.rs` ergänzen**

`pub mod qualifikation;` hinzufügen.

- [ ] **Step 3: Routen in `src/app.rs` registrieren**

```rust
        .route("/api/qualifikationen", get(routes::qualifikation::liste))
        .route("/api/qualifikationen", post(routes::qualifikation::anlegen))
        .route("/api/qualifikationen/{id}", patch(routes::qualifikation::aktualisieren))
        .route("/api/qualifikationen/{id}/deaktivieren", post(routes::qualifikation::deaktivieren))
```

- [ ] **Step 4: Integrationstest `tests/qualifikation.rs` schreiben**

Harness aus `tests/fahrzeug.rs` (Zeilen 1–88) übernehmen, dann:

```rust
// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_neun_aktive_qualifikationen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 9, "Bootstrap-Seed");
    assert_eq!(json[0]["label"], "Sanitäter");
}

#[tokio::test]
async fn admin_crud_nicht_admin_nur_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen für alle.
    assert_eq!(anfrage(&app, "GET", "/api/qualifikationen", &erika, None).await.0, StatusCode::OK);
    // Anlegen nur Admin.
    assert_eq!(anfrage(&app, "POST", "/api/qualifikationen", &erika, Some(r#"{"label":"Hund"}"#)).await.0, StatusCode::FORBIDDEN);
    let (status, json) = anfrage(&app, "POST", "/api/qualifikationen", &admin, Some(r#"{"label":"Drohnenpilot","sortier":100}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let id = json["id"].as_i64().unwrap();

    // Dublette → Conflict.
    assert_eq!(anfrage(&app, "POST", "/api/qualifikationen", &admin, Some(r#"{"label":"Drohnenpilot"}"#)).await.0, StatusCode::CONFLICT);

    // Deaktivieren → verschwindet aus der Liste.
    assert_eq!(anfrage(&app, "POST", &format!("/api/qualifikationen/{id}/deaktivieren"), &admin, None).await.0, StatusCode::NO_CONTENT);
    let (_, json) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    assert!(json.as_array().unwrap().iter().all(|q| q["id"].as_i64() != Some(id)));
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --test qualifikation && cargo test --test personal`
Expected: PASS (jetzt auch `qualifikationen_werden_zugeordnet_und_aufgeloest` aus Task 10).

- [ ] **Step 6: Commit**

```bash
git add src/routes/qualifikation.rs src/routes/mod.rs src/app.rs tests/qualifikation.rs
git commit -m "feat(routes): Qualifikations-Katalog (CRUD, Deaktivieren)"
```

---

## Task 12: Routen — Personal-Status-Katalog

`src/routes/personal_status.rs` analog `src/routes/fahrzeug_status.rs`, minus `fms_anker`.

**Files:**
- Create: `src/routes/personal_status.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Create: `tests/personal_status.rs`

- [ ] **Step 1: `src/routes/personal_status.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::katalog::ist_gueltige_kategorie;
use crate::personal::status_repo::{self, StatusDaten};
use crate::personal::PersonalStatus;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
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
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> StatusDaten<'_> {
        StatusDaten {
            label: &self.label,
            kategorie: &self.kategorie,
            farbe: self.farbe.as_deref(),
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
    Ok(Normalisiert {
        label,
        kategorie: body.kategorie,
        farbe: trimme(body.farbe),
        sortier: body.sortier,
    })
}

/// GET /api/personal-status — aktive Katalog-Einträge (eigene Org), für Dropdowns.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<PersonalStatus>>, AppError> {
    Ok(Json(status_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/personal-status — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<StatusBody>,
) -> Result<(StatusCode, Json<PersonalStatus>), AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(s)))
}

/// PATCH /api/personal-status/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<StatusBody>,
) -> Result<Json<PersonalStatus>, AppError> {
    let n = normalisiere(body)?;
    let s = status_repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(s))
}

/// POST /api/personal-status/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    status_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: `src/routes/mod.rs` ergänzen**

`pub mod personal_status;` hinzufügen.

- [ ] **Step 3: Routen in `src/app.rs` registrieren**

```rust
        .route("/api/personal-status", get(routes::personal_status::liste))
        .route("/api/personal-status", post(routes::personal_status::anlegen))
        .route("/api/personal-status/{id}", patch(routes::personal_status::aktualisieren))
        .route("/api/personal-status/{id}/deaktivieren", post(routes::personal_status::deaktivieren))
```

- [ ] **Step 4: Integrationstest `tests/personal_status.rs` schreiben**

Harness aus `tests/fahrzeug.rs` (Zeilen 1–88) übernehmen, dann:

```rust
// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_sechs_aktive_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 6);
    assert_eq!(json[0]["label"], "verfügbar");
}

#[tokio::test]
async fn admin_crud_kategorie_validierung_dublette() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", "/api/personal-status", &erika, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &erika, Some(r#"{"label":"X","kategorie":"gebunden"}"#)).await.0, StatusCode::FORBIDDEN);

    // Ungültige Kategorie → 400.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"X","kategorie":"quatsch"}"#)).await.0, StatusCode::BAD_REQUEST);
    // Anlegen ok.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#)).await.0, StatusCode::CREATED);
    // Dublette label → Conflict.
    assert_eq!(anfrage(&app, "POST", "/api/personal-status", &admin, Some(r#"{"label":"nachalarmiert","kategorie":"verfuegbar"}"#)).await.0, StatusCode::CONFLICT);
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test --test personal_status`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/personal_status.rs src/routes/mod.rs src/app.rs tests/personal_status.rs
git commit -m "feat(routes): Personal-Status-Katalog (CRUD, Deaktivieren)"
```

---

## Task 13: Routen — Disposition im Einsatz + ETB

`src/routes/einsatz_personal.rs` analog `src/routes/einsatz_fahrzeug.rs`. Gates: `fordere_schreibrecht` + `fordere_aktiv` (Schreiben), `fordere_lesezugriff` (Lesen). **ETB-Texte (festgelegt):**
- Disponieren: `Person «{name} ({funktion})» disponiert` (ohne Klammer-Teil, wenn Funktion leer)
- Status-Wechsel: `Person «{name}»: Status «{alt}» → «{neu}»`
- Entfernen: `Person «{name} ({funktion})» aus dem Einsatz entfernt`

**Files:**
- Create: `src/routes/einsatz_personal.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Create: `tests/einsatz_personal.rs`

- [ ] **Step 1: `src/routes/einsatz_personal.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo;
use crate::personal::EinsatzPersonalAnzeige;
use crate::staerke::StaerkePosition;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (wie `routes::einsatz_fahrzeug::etb_system`).
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

/// Personen-Bezeichnung für ETB-Texte: Name, optional mit Funktion in Klammern.
fn person_bezeichnung(a: &EinsatzPersonalAnzeige) -> String {
    match a.funktion.as_deref() {
        Some(f) if !f.is_empty() => format!("{} ({})", a.name, f),
        _ => a.name.clone(),
    }
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Validiert eine optionale Stärke-Position gegen das Enum (leer/None erlaubt).
fn pruefe_position(p: &Option<String>) -> Result<(), AppError> {
    if let Some(s) = p.as_deref() {
        if StaerkePosition::parse(s).is_none() {
            return Err(AppError::Validation("Ungültige Stärke-Position".into()));
        }
    }
    Ok(())
}

/// GET /api/einsaetze/{id}/personal — disponiertes Personal (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzPersonalAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub name: String,
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    pub staerke_position: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub personal_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/personal — Stamm-Person disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzPersonalAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let ep_id = match (body.personal_id, body.adhoc) {
        (Some(personal_id), None) => {
            pruefe_position(&body.staerke_position)?;
            disposition_repo::disponiere_stamm(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                personal_id,
                body.staerke_position.as_deref(),
                benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let name = adhoc.name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::Validation("Name darf nicht leer sein".into()));
            }
            pruefe_position(&adhoc.staerke_position)?;
            let funktion = trimme(adhoc.funktion);
            let traeger = trimme(adhoc.traegerorganisation);
            let position = trimme(adhoc.staerke_position);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    name: &name,
                    funktion: funktion.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                    staerke_position: position.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person «{}» disponiert", person_bezeichnung(&anzeige)),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personal/{ep_id} — Status, Stärke-Position und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }
    pruefe_position(&body.staerke_position)?;

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    // Bemerkung: gesetzt (auch "") → setzen; absent/null → unverändert (COALESCE).
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        ep_id,
        body.status_id,
        body.staerke_position.as_deref(),
        bemerkung,
    )
    .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Person «{}»: Status «{}» → «{}»", nachher.name, alt, neu),
        )
        .await?;
    }
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/personal/{ep_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ep_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person «{}» aus dem Einsatz entfernt", person_bezeichnung(&anzeige)),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: `src/routes/mod.rs` ergänzen**

`pub mod einsatz_personal;` hinzufügen.

- [ ] **Step 3: Routen in `src/app.rs` registrieren**

Direkt nach dem `einsatz_fahrzeug`-Block einfügen:

```rust
        .route("/api/einsaetze/{id}/personal", get(routes::einsatz_personal::liste))
        .route("/api/einsaetze/{id}/personal", post(routes::einsatz_personal::disponieren))
        .route("/api/einsaetze/{id}/personal/{ep_id}", patch(routes::einsatz_personal::aktualisieren))
        .route("/api/einsaetze/{id}/personal/{ep_id}", delete(routes::einsatz_personal::entfernen))
```

- [ ] **Step 4: Integrationstest `tests/einsatz_personal.rs` schreiben**

Harness + Zusatz-Helfer aus `tests/einsatz_fahrzeug.rs` (Zeilen 1–121) übernehmen, aber `fahrzeug_anlegen` durch `person_anlegen` ersetzen und die Tests anpassen:

```rust
/// Legt eine Stamm-Person an (Admin) und liefert deren id.
async fn person_anlegen(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let (status, json) = anfrage(
        app, "POST", "/api/personal", admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// `system_etb_anzahl` aus tests/einsatz_fahrzeug.rs unverändert übernehmen.

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_setzt_status_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas Müller").await;

    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(&format!(r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#)),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["ist_adhoc"], false);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let body = format!(r#"{{"personal_id":{person}}}"#);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&body)).await.0, StatusCode::CREATED);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&body)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn adhoc_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(r#"{"adhoc":{"name":"Notarzt Extern","funktion":"Notarzt","staerke_position":"fuehrer"}}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["personal_id"].is_null());
    assert_eq!(json["funktion"], "Notarzt");
}

#[tokio::test]
async fn beobachter_liest_disponiert_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &erika, None).await.0, StatusCode::OK);
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &erika, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await.0, StatusCode::OK);
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    let ep = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('im Einsatz').
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let im_einsatz = stati.as_array().unwrap().iter().find(|s| s["label"] == "im Einsatz").unwrap()["id"].as_i64().unwrap();

    assert_eq!(anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin, Some(&format!(r#"{{"status_id":{im_einsatz}}}"#))).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/personal/{ep}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // Disponieren + Status-Wechsel + Entfernen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn snapshot_bleibt_nach_stamm_aenderung_bei_abgeschlossenem_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Thomas Müller").await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin, Some(&format!(r#"{{"personal_id":{person}}}"#))).await;
    // Stamm umbenennen.
    anfrage(&app, "PATCH", &format!("/api/personal/{person}"), &admin, Some(r#"{"name":"Thomas NEU"}"#)).await;
    // Aktiver Einsatz → Live.
    let (_, live) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert_eq!(live[0]["name"], "Thomas NEU");
    // Abschließen → Snapshot.
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await;
    let (_, snap) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert_eq!(snap[0]["name"], "Thomas Müller", "Snapshot bei abgeschlossenem Einsatz");
}
```

- [ ] **Step 5: Tests + vollständiger Backend-Lauf + Clippy**

Run: `cargo test --test einsatz_personal && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS, keine Warnungen (alle Backend-Unit- und Integrationstests grün).

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_personal.rs src/routes/mod.rs src/app.rs tests/einsatz_personal.rs
git commit -m "feat(routes): Personal-Disposition im Einsatz mit ETB-Einträgen"
```

---

## Task 14: Frontend-Typen + API-Module

Neue Typen in `types.ts` und vier API-Module analog `fahrzeuge.ts`/`fahrzeugStatus.ts`/`einsatzFahrzeuge.ts`. **Reine Typ-/Funktionsschicht — kein Test-Step** (wird über die Komponenten-Tests in Tasks 15–18 abgedeckt; `npm run typecheck` ist der Gate).

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/personal.ts`, `qualifikationen.ts`, `personalStatus.ts`, `einsatzPersonal.ts`

- [ ] **Step 1: `frontend/src/api/types.ts` ergänzen**

Am Dateiende anhängen (`StatusKategorie`/`Dienststatus` existieren bereits):

```typescript
export type StaerkePosition = 'fuehrer' | 'unterfuehrer' | 'mannschaft';

/** Aufgelöste Qualifikation einer Person (inkl. deaktivierter Zuordnungen). */
export interface QualifikationRef {
  id: number;
  label: string;
}

export interface Personal {
  id: number;
  benutzer_id: number | null;
  name: string;
  personalnummer: string | null;
  traegerorganisation: string | null;
  telefon: string | null;
  staerke_position: StaerkePosition | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
  qualifikationen: QualifikationRef[];
}

/** Bereits verwendete Trägerorganisationen (DISTINCT) für die Combobox. */
export interface PersonalVorschlaege {
  traegerorganisation: string[];
}

/** Qualifikations-Katalog-Eintrag. */
export interface Qualifikation {
  id: number;
  label: string;
  sortier: number;
}

/** Personal-Status-Katalog-Eintrag (wie FahrzeugStatus, ohne fms_anker). */
export interface PersonalStatus {
  id: number;
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  sortier: number;
}

/** Aufgelöste Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzPersonal {
  id: number;
  einsatz_id: number;
  personal_id: number | null;
  ist_adhoc: boolean;
  name: string;
  funktion: string | null;
  traegerorganisation: string | null;
  staerke_position: StaerkePosition | null;
  status_id: number | null;
  status_label: string | null;
  status_kategorie: StatusKategorie | null;
  status_farbe: string | null;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
}
```

- [ ] **Step 2: `frontend/src/api/personal.ts` anlegen**

```typescript
import type { Personal, PersonalVorschlaege, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
export interface PersonalEingabe {
  name: string;
  benutzer_id: number | null;
  personalnummer: string | null;
  traegerorganisation: string | null;
  telefon: string | null;
  staerke_position: StaerkePosition | null;
  bemerkung: string | null;
  qualifikation_ids: number[];
}

export function listePersonal(nurImDienst = false): Promise<Personal[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Personal[]>(`/api/personal${qs}`);
}

export function ladePersonalVorschlaege(): Promise<PersonalVorschlaege> {
  return apiGet<PersonalVorschlaege>('/api/personal-vorschlaege');
}

export function legePersonAn(daten: PersonalEingabe): Promise<Personal> {
  return apiSend<Personal>('/api/personal', 'POST', daten);
}

export function aktualisierePerson(id: number, daten: PersonalEingabe): Promise<Personal> {
  return apiSend<Personal>(`/api/personal/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Personal> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Personal>(`/api/personal/${id}/${pfad}`, 'POST');
}
```

- [ ] **Step 3: `frontend/src/api/qualifikationen.ts` anlegen**

```typescript
import type { Qualifikation } from './types';
import { apiGet, apiSend } from './client';

export interface QualifikationEingabe {
  label: string;
  sortier: number;
}

export function listeQualifikationen(): Promise<Qualifikation[]> {
  return apiGet<Qualifikation[]>('/api/qualifikationen');
}

export function legeQualifikationAn(daten: QualifikationEingabe): Promise<Qualifikation> {
  return apiSend<Qualifikation>('/api/qualifikationen', 'POST', daten);
}

export function aktualisiereQualifikation(id: number, daten: QualifikationEingabe): Promise<Qualifikation> {
  return apiSend<Qualifikation>(`/api/qualifikationen/${id}`, 'PATCH', daten);
}

export function deaktiviereQualifikation(id: number): Promise<void> {
  return apiSend<void>(`/api/qualifikationen/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 4: `frontend/src/api/personalStatus.ts` anlegen**

```typescript
import type { PersonalStatus, StatusKategorie } from './types';
import { apiGet, apiSend } from './client';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  sortier: number;
}

export function listePersonalStatus(): Promise<PersonalStatus[]> {
  return apiGet<PersonalStatus[]>('/api/personal-status');
}

export function legeStatusAn(daten: StatusEingabe): Promise<PersonalStatus> {
  return apiSend<PersonalStatus>('/api/personal-status', 'POST', daten);
}

export function aktualisiereStatus(id: number, daten: StatusEingabe): Promise<PersonalStatus> {
  return apiSend<PersonalStatus>(`/api/personal-status/${id}`, 'PATCH', daten);
}

export function deaktiviereStatus(id: number): Promise<void> {
  return apiSend<void>(`/api/personal-status/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 5: `frontend/src/api/einsatzPersonal.ts` anlegen**

```typescript
import type { EinsatzPersonal, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';

export interface AdhocEingabe {
  name: string;
  funktion?: string | null;
  traegerorganisation?: string | null;
  staerke_position?: StaerkePosition | null;
}

export function listeEinsatzPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal`);
}

export function disponierePerson(
  einsatzId: number,
  personalId: number,
  staerkePosition?: StaerkePosition | null,
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', {
    personal_id: personalId,
    staerke_position: staerkePosition ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', { adhoc });
}

export function aktualisiereDisposition(
  einsatzId: number,
  epId: number,
  felder: { status_id?: number; staerke_position?: StaerkePosition; bemerkung?: string },
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal/${epId}`, 'PATCH', felder);
}

export function entferneDisposition(einsatzId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personal/${epId}`, 'DELETE');
}
```

- [ ] **Step 6: Typecheck**

Run (aus `frontend/`): `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/personal.ts frontend/src/api/qualifikationen.ts frontend/src/api/personalStatus.ts frontend/src/api/einsatzPersonal.ts
git commit -m "feat(fe): Personal-Typen und API-Module"
```

---

## Task 15: Stammdaten — Qualifikationen-Tab

`QualifikationenTab.tsx` analog `StatusKatalogTab.tsx`, schlanker (nur label/sortier). Wird in `StammdatenPage.tsx` als Tab ergänzt.

**Files:**
- Create: `frontend/src/stammdaten/QualifikationenTab.tsx`
- Create: `frontend/src/stammdaten/QualifikationenTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: Failing Test schreiben**

`frontend/src/stammdaten/QualifikationenTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import QualifikationenTab from './QualifikationenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const quals = [
  { id: 1, label: 'Sanitäter', sortier: 10 },
  { id: 2, label: 'Gruppenführer', sortier: 60 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/qualifikationen', () => HttpResponse.json(quals)),
  );
  return renderMitProviders(
    <AuthProvider>
      <QualifikationenTab />
    </AuthProvider>,
  );
}

describe('QualifikationenTab', () => {
  it('zeigt Qualifikationen', async () => {
    render(admin);
    expect(await screen.findByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Gruppenführer')).toBeInTheDocument();
  });

  it('Admin sieht „Qualifikation anlegen"', async () => {
    render(admin);
    await screen.findByText('Sanitäter');
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Sanitäter');
    expect(screen.queryByRole('button', { name: 'Qualifikation anlegen' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test zum Scheitern bringen**

Run (aus `frontend/`): `npx vitest run src/stammdaten/QualifikationenTab.test.tsx`
Expected: FAIL (Modul `./QualifikationenTab` existiert nicht).

- [ ] **Step 3: `frontend/src/stammdaten/QualifikationenTab.tsx` anlegen**

```tsx
import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table,
  type TableColumnsType,
} from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereQualifikation, deaktiviereQualifikation, legeQualifikationAn,
  listeQualifikationen, type QualifikationEingabe,
} from '../api/qualifikationen';
import type { Qualifikation } from '../api/types';

interface FormWerte {
  label: string;
  sortier: number;
}

export default function QualifikationenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Qualifikation | null>(null);

  const query = useQuery({ queryKey: ['qualifikationen'], queryFn: listeQualifikationen });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: QualifikationEingabe = { label: werte.label.trim(), sortier: werte.sortier ?? 0 };
      return bearbeite ? aktualisiereQualifikation(bearbeite.id, daten) : legeQualifikationAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['qualifikationen'] }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereQualifikation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qualifikationen'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({ label: bearbeite.label, sortier: bearbeite.sortier });
    } else {
      form.resetFields();
      form.setFieldsValue({ sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<Qualifikation> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, q: Qualifikation) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(q); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Qualifikation deaktivieren?" onConfirm={() => deaktivieren.mutate(q.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<Qualifikation>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Qualifikation anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Qualifikationen' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Qualifikation bearbeiten' : 'Qualifikation anlegen'}
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
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: `frontend/src/pages/StammdatenPage.tsx` um den Tab erweitern**

Import + Tab-Item ergänzen:

```tsx
import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import StatusKatalogTab from '../stammdaten/StatusKatalogTab';
import QualifikationenTab from '../stammdaten/QualifikationenTab';
```

Im `items`-Array nach dem `status`-Tab ergänzen:

```tsx
          { key: 'qualifikationen', label: 'Qualifikationen', children: <QualifikationenTab /> },
```

- [ ] **Step 5: Tests laufen lassen**

Run (aus `frontend/`): `npx vitest run src/stammdaten/QualifikationenTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stammdaten/QualifikationenTab.tsx frontend/src/stammdaten/QualifikationenTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab Qualifikationen"
```

---

## Task 16: Stammdaten — Personal-Status-Tab

`PersonalStatusTab.tsx` praktisch identisch zu `StatusKatalogTab.tsx`, aber ohne `fms_anker`, auf die Personal-Status-API umgestellt und mit eigenem Query-Key `['personal-status']`.

**Files:**
- Create: `frontend/src/stammdaten/PersonalStatusTab.tsx`
- Create: `frontend/src/stammdaten/PersonalStatusTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: Failing Test schreiben**

`frontend/src/stammdaten/PersonalStatusTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalStatusTab from './PersonalStatusTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const status = [
  { id: 1, label: 'verfügbar', kategorie: 'verfuegbar', farbe: null, sortier: 10 },
  { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal-status', () => HttpResponse.json(status)),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalStatusTab />
    </AuthProvider>,
  );
}

describe('PersonalStatusTab', () => {
  it('zeigt Status mit Kategorie-Badge', async () => {
    render(admin);
    expect(await screen.findByText('verfügbar')).toBeInTheDocument();
    expect(screen.getByText('gebunden')).toBeInTheDocument();
  });

  it('Admin sieht „Status anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('verfügbar');
    expect(screen.getByRole('button', { name: 'Status anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('verfügbar');
    expect(screen.queryByRole('button', { name: 'Status anlegen' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test zum Scheitern bringen**

Run (aus `frontend/`): `npx vitest run src/stammdaten/PersonalStatusTab.test.tsx`
Expected: FAIL (Modul existiert nicht).

- [ ] **Step 3: `frontend/src/stammdaten/PersonalStatusTab.tsx` anlegen**

Wie `StatusKatalogTab.tsx`, mit diesen Unterschieden: Import aus `../api/personalStatus`; Query-Key `['personal-status']`; **kein `fms_anker`** (Form-Item, Spalte und `StatusEingabe`-Feld entfernen). Vollständig:

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
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listePersonalStatus, type StatusEingabe,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';

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
  sortier: number;
}

export default function PersonalStatusTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<PersonalStatus | null>(null);

  const statusQuery = useQuery({ queryKey: ['personal-status'], queryFn: listePersonalStatus });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: werte.farbe?.trim() || null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereStatus(bearbeite.id, daten) : legeStatusAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['personal-status'] }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personal-status'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<PersonalStatus> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      render: (k: StatusKategorie) => <Tag color={KATEGORIE_FARBEN[k]}>{KATEGORIE_LABELS[k]}</Tag>,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: PersonalStatus) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(s); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<PersonalStatus>)
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
                value: k, label: KATEGORIE_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
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

- [ ] **Step 4: `StammdatenPage.tsx` um den Tab erweitern**

Import `PersonalStatusTab` ergänzen und im `items`-Array nach dem Qualifikationen-Tab:

```tsx
          { key: 'personal-status', label: 'Personal-Status', children: <PersonalStatusTab /> },
```

- [ ] **Step 5: Tests laufen lassen**

Run (aus `frontend/`): `npx vitest run src/stammdaten/PersonalStatusTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stammdaten/PersonalStatusTab.tsx frontend/src/stammdaten/PersonalStatusTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab Personal-Status"
```

---

## Task 17: Stammdaten — Personal-Tab + Formular-Modal

`PersonalTab.tsx` (Tabelle + Außer-/In-Dienst) analog `FahrzeugeTab.tsx` und `PersonalFormModal.tsx` analog `FahrzeugFormModal.tsx`. Das Formular bietet Qualifikationen als Mehrfach-`Select`, Stärke-Position als `Select` (drei Werte + leer), Trägerorganisation als `AutoComplete`, optionalen Benutzer-Link als `Select` über die Org-Benutzer.

**Files:**
- Create: `frontend/src/stammdaten/PersonalFormModal.tsx`
- Create: `frontend/src/stammdaten/PersonalTab.tsx`
- Create: `frontend/src/stammdaten/PersonalTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: Failing Test schreiben**

`frontend/src/stammdaten/PersonalTab.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalTab from './PersonalTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const personal = [
  {
    id: 1, benutzer_id: null, name: 'Thomas Müller', personalnummer: '4711',
    traegerorganisation: 'DRK', telefon: null, staerke_position: 'fuehrer',
    bemerkung: null, dienststatus: 'in_dienst', angelegt_at: '2026-05-26 10:00:00',
    qualifikationen: [{ id: 1, label: 'Sanitäter' }],
  },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/personal', () => HttpResponse.json(personal)),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: ['DRK'] })),
    http.get('/api/qualifikationen', () => HttpResponse.json([{ id: 1, label: 'Sanitäter', sortier: 10 }])),
    http.get('/api/benutzer', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <AuthProvider>
      <PersonalTab />
    </AuthProvider>,
  );
}

describe('PersonalTab', () => {
  it('zeigt Personen mit Qualifikationen und Stärke-Position', async () => {
    render(admin);
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter')).toBeInTheDocument();
    expect(screen.getByText('Führer')).toBeInTheDocument();
  });

  it('Admin sieht „Person anlegen", Nicht-Admin nicht', async () => {
    render(admin);
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Person anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Person anlegen' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test zum Scheitern bringen**

Run (aus `frontend/`): `npx vitest run src/stammdaten/PersonalTab.test.tsx`
Expected: FAIL (Modul `./PersonalTab` existiert nicht).

- [ ] **Step 3: `frontend/src/stammdaten/PersonalFormModal.tsx` anlegen**

```tsx
import { App, AutoComplete, Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisierePerson, legePersonAn, type PersonalEingabe } from '../api/personal';
import { listeQualifikationen } from '../api/qualifikationen';
import { listeBenutzer } from '../api/benutzer';
import type { Personal, PersonalVorschlaege, StaerkePosition } from '../api/types';

const POSITION_LABELS: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

interface FormWerte {
  name: string;
  personalnummer?: string;
  traegerorganisation?: string;
  telefon?: string;
  staerke_position?: StaerkePosition;
  qualifikation_ids: number[];
  benutzer_id?: number;
  bemerkung?: string;
}

function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

export default function PersonalFormModal({
  offen,
  person,
  vorschlaege,
  onClose,
}: {
  offen: boolean;
  person: Personal | null; // null = neu
  vorschlaege: PersonalVorschlaege;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormWerte>();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const qualQuery = useQuery({ queryKey: ['qualifikationen'], queryFn: listeQualifikationen });
  const benutzerQuery = useQuery({ queryKey: ['benutzer'], queryFn: listeBenutzer });

  useEffect(() => {
    if (!offen) return;
    if (person) {
      form.setFieldsValue({
        name: person.name,
        personalnummer: person.personalnummer ?? undefined,
        traegerorganisation: person.traegerorganisation ?? undefined,
        telefon: person.telefon ?? undefined,
        staerke_position: person.staerke_position ?? undefined,
        qualifikation_ids: person.qualifikationen.map((q) => q.id),
        benutzer_id: person.benutzer_id ?? undefined,
        bemerkung: person.bemerkung ?? undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ qualifikation_ids: [] });
    }
  }, [offen, person, form]);

  const mutation = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: PersonalEingabe = {
        name: werte.name.trim(),
        benutzer_id: werte.benutzer_id ?? null,
        personalnummer: leerZuNull(werte.personalnummer),
        traegerorganisation: leerZuNull(werte.traegerorganisation),
        telefon: leerZuNull(werte.telefon),
        staerke_position: werte.staerke_position ?? null,
        bemerkung: leerZuNull(werte.bemerkung),
        qualifikation_ids: werte.qualifikation_ids ?? [],
      };
      return person ? aktualisierePerson(person.id, daten) : legePersonAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] });
      qc.invalidateQueries({ queryKey: ['personal-vorschlaege'] });
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  // Aktive Qualifikationen + bereits zugeordnete (auch deaktivierte) als Optionen,
  // damit eine deaktivierte Zuordnung sichtbar/erhaltbar bleibt.
  const aktive = qualQuery.data ?? [];
  const zugeordnete = person?.qualifikationen ?? [];
  const qualOptionen = [
    ...aktive.map((q) => ({ value: q.id, label: q.label })),
    ...zugeordnete
      .filter((z) => !aktive.some((a) => a.id === z.id))
      .map((z) => ({ value: z.id, label: `${z.label} (deaktiviert)` })),
  ];

  const benutzerOptionen = (benutzerQuery.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.anzeigename} (${b.benutzername})`,
  }));

  return (
    <Modal
      open={offen}
      title={person ? 'Person bearbeiten' : 'Person anlegen'}
      okText="Speichern"
      confirmLoading={mutation.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnClose
    >
      <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => mutation.mutate(w)}>
        <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Personalnummer" name="personalnummer"><Input /></Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <AutoComplete
            options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
            allowClear
            placeholder="z. B. DRK Musterstadt"
            filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item label="Telefon" name="telefon"><Input /></Form.Item>
        <Form.Item label="Stärke-Position" name="staerke_position">
          <Select
            allowClear
            placeholder="optional"
            options={(Object.keys(POSITION_LABELS) as StaerkePosition[]).map((p) => ({
              value: p, label: POSITION_LABELS[p],
            }))}
          />
        </Form.Item>
        <Form.Item label="Qualifikationen" name="qualifikation_ids">
          <Select mode="multiple" allowClear options={qualOptionen} optionFilterProp="label" placeholder="Qualifikationen wählen" />
        </Form.Item>
        <Form.Item label="Benutzer-Konto (optional)" name="benutzer_id">
          <Select allowClear showSearch options={benutzerOptionen} optionFilterProp="label" placeholder="kein Konto verknüpft" />
        </Form.Item>
        <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 4: `frontend/src/stammdaten/PersonalTab.tsx` anlegen**

```tsx
import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladePersonalVorschlaege, listePersonal, setzeDienststatus } from '../api/personal';
import type { Personal, StaerkePosition } from '../api/types';
import PersonalFormModal from './PersonalFormModal';

const POSITION_LABELS: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Personal | null>(null);

  const personalQuery = useQuery({ queryKey: ['personal', 'alle'], queryFn: () => listePersonal(false) });
  const vorschlaegeQuery = useQuery({ queryKey: ['personal-vorschlaege'], queryFn: ladePersonalVorschlaege });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personal'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Personal> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Personalnr.', dataIndex: 'personalnummer', key: 'personalnummer', render: (t) => t ?? '—' },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      render: (_, p) =>
        p.qualifikationen.length ? (
          <Space size={[0, 4]} wrap>
            {p.qualifikationen.map((q) => <Tag key={q.id}>{q.label}</Tag>)}
          </Space>
        ) : '—',
    },
    {
      title: 'Stärke-Position',
      dataIndex: 'staerke_position',
      key: 'staerke_position',
      render: (p: StaerkePosition | null) => (p ? POSITION_LABELS[p] : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      render: (_, p) =>
        p.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, p: Personal) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(p); setModalOffen(true); }}>Bearbeiten</Button>
                {p.dienststatus === 'in_dienst' ? (
                  <Popconfirm title="Außer Dienst stellen?" onConfirm={() => dienststatusMutation.mutate({ id: p.id, inDienst: false })}>
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: p.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Personal>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Person anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={personalQuery.isLoading}
        dataSource={personalQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch kein Personal' }}
        pagination={false}
      />
      <PersonalFormModal
        offen={modalOffen}
        person={bearbeite}
        vorschlaege={vorschlaegeQuery.data ?? { traegerorganisation: [] }}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
```

- [ ] **Step 5: `StammdatenPage.tsx` um den Personal-Tab erweitern**

Import `PersonalTab` ergänzen. Der Personal-Tab soll **vor** den Katalog-Tabs (Qualifikationen, Personal-Status) und nach „Fahrzeuge" stehen. Finales `items`-Array:

```tsx
        items={[
          { key: 'stichworte', label: 'Einsatz-Stichworte', children: <StichworteTab /> },
          { key: 'fahrzeuge', label: 'Fahrzeuge', children: <FahrzeugeTab /> },
          { key: 'status', label: 'Fahrzeug-Status', children: <StatusKatalogTab /> },
          { key: 'personal', label: 'Personal', children: <PersonalTab /> },
          { key: 'qualifikationen', label: 'Qualifikationen', children: <QualifikationenTab /> },
          { key: 'personal-status', label: 'Personal-Status', children: <PersonalStatusTab /> },
        ]}
```

- [ ] **Step 6: Tests + Typecheck**

Run (aus `frontend/`): `npx vitest run src/stammdaten/PersonalTab.test.tsx && npm run typecheck`
Expected: PASS, keine Typfehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stammdaten/PersonalFormModal.tsx frontend/src/stammdaten/PersonalTab.tsx frontend/src/stammdaten/PersonalTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab Personal mit Formular (Qualifikationen, Position, Benutzer-Link)"
```

---

## Task 18: Einsatz-Modul `PersonalPage` + Registrierung

`PersonalPage.tsx` analog `FahrzeugePage.tsx`: Liste des disponierten Personals mit Status-Badge, Funktion, Stärke-Position; Aktionen nur bei Schreibrecht + aktivem Einsatz. Registrierung als echtes Modul-Element in `App.tsx` und Flip in `modulRegistry.ts` (`personal` → `status: 'fertig'`).

**Files:**
- Create: `frontend/src/pages/PersonalPage.tsx`
- Create: `frontend/src/pages/PersonalPage.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/einsatz/modulRegistry.ts`, `frontend/src/einsatz/modulRegistry.test.ts`

- [ ] **Step 1: `modulRegistry`-Regressionstest erweitern (failing)**

In `frontend/src/einsatz/modulRegistry.test.ts` im letzten `it(...)`-Block ergänzen (oder als neuer Test):

```ts
  it('personal ist fertig in der Kategorie kraefte', () => {
    const personal = modulRegistry.find((m) => m.key === 'personal');
    expect(personal?.status).toBe('fertig');
    expect(personal?.kategorie).toBe('kraefte');
    expect(personal?.route).toBe('personal');
  });
```

- [ ] **Step 2: Test zum Scheitern bringen**

Run (aus `frontend/`): `npx vitest run src/einsatz/modulRegistry.test.ts`
Expected: FAIL (`personal?.status` ist `'geplant'`).

- [ ] **Step 3: `modulRegistry.ts` flippen**

In `frontend/src/einsatz/modulRegistry.ts` den `personal`-Eintrag (Zeile 54) von `status: 'geplant'` auf `status: 'fertig'` ändern:

```ts
  { key: 'personal', kategorie: 'kraefte', label: 'Personal', icon: TbUser, route: 'personal', status: 'fertig', beschreibung: 'Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte.' },
```

- [ ] **Step 4: Registry-Test grün**

Run (aus `frontend/`): `npx vitest run src/einsatz/modulRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: `frontend/src/pages/PersonalPage.tsx` anlegen**

```tsx
import {
  Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Select, Space, Spin,
  Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listePersonal } from '../api/personal';
import { listePersonalStatus } from '../api/personalStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponierePerson, entferneDisposition,
  listeEinsatzPersonal, type AdhocEingabe,
} from '../api/einsatzPersonal';
import { ApiError } from '../api/client';
import type { EinsatzPersonal, StaerkePosition, StatusKategorie } from '../api/types';

const KATEGORIE_FALLBACK: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

const POSITION_LABELS: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

const POSITION_OPTIONEN = (Object.keys(POSITION_LABELS) as StaerkePosition[]).map((p) => ({
  value: p, label: POSITION_LABELS[p],
}));

function StatusBadge({ ep }: { ep: EinsatzPersonal }) {
  if (!ep.status_label || !ep.status_kategorie) return <Tag>kein Status</Tag>;
  const farbe = ep.status_farbe ?? KATEGORIE_FALLBACK[ep.status_kategorie];
  return <Tag color={farbe}>{ep.status_label}</Tag>;
}

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const epQuery = useQuery({
    queryKey: ['einsatz-personal', einsatzId],
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: ['personal-status'], queryFn: listePersonalStatus });
  const poolQuery = useQuery({ queryKey: ['personal', 'im-dienst'], queryFn: () => listePersonal(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-personal', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (personalId: number) => disponierePerson(einsatzId, personalId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { epId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const positionMutation = useMutation({
    mutationFn: (v: { epId: number; position: StaerkePosition }) =>
      aktualisiereDisposition(einsatzId, v.epId, { staerke_position: v.position }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (epId: number) => entferneDisposition(einsatzId, epId),
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

  const eps = epQuery.data ?? [];
  const stati = statusQuery.data ?? [];
  const disponierteIds = new Set(eps.map((e) => e.personal_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((p) => !disponierteIds.has(p.id))
    .map((p) => ({ value: p.id, label: `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}` }));

  const spalten: TableColumnsType<EinsatzPersonal> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, ep) => (
        <Space>
          {ep.name}
          {ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Funktion', dataIndex: 'funktion', key: 'funktion', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Position',
      key: 'position',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 130 }}
            value={ep.staerke_position ?? undefined}
            placeholder="—"
            options={POSITION_OPTIONEN}
            onChange={(position) => positionMutation.mutate({ epId: ep.id, position })}
          />
        ) : (
          ep.staerke_position ? POSITION_LABELS[ep.staerke_position] : '—'
        ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={ep.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ epId: ep.id, statusId })}
          />
        ) : (
          <StatusBadge ep={ep} />
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ep) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ epId: ep.id, bemerkung: val }) }}
          >
            {ep.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ep.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ep: EinsatzPersonal) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ep.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzPersonal>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personal' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personal</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              showSearch
              style={{ minWidth: 260 }}
              placeholder="Person aus Pool disponieren …"
              value={null}
              options={poolOptionen}
              optionFilterProp="label"
              notFoundContent="Keine freien Personen"
              onSelect={(personalId) => { if (personalId != null) disponiereMutation.mutate(personalId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={epQuery.isLoading}
        dataSource={eps}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch kein Personal disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Person disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnClose
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Dr. Schmidt" />
          </Form.Item>
          <Form.Item label="Funktion" name="funktion"><Input placeholder="z. B. Notarzt" /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. KV Musterstadt" />
          </Form.Item>
          <Form.Item label="Stärke-Position" name="staerke_position">
            <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 6: `frontend/src/App.tsx` registrieren**

Import + `MODUL_ELEMENTE`-Eintrag ergänzen:

```tsx
import FahrzeugePage from './pages/FahrzeugePage';
import PersonalPage from './pages/PersonalPage';
```

```tsx
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  einsatzdaten: <EinsatzdatenPage />,
  fahrzeuge: <FahrzeugePage />,
  personal: <PersonalPage />,
};
```

- [ ] **Step 7: `frontend/src/pages/PersonalPage.test.tsx` anlegen**

**Wichtig — verifiziertes Routing-Muster:** `PersonalPage` nutzt `useParams()`. In `MemoryRouter` setzt die `route`-Option nur die URL; ohne passendes `<Route path>`-Element liefert `useParams()` `{}` und `Number(undefined) = NaN` → die MSW-Handler greifen nie und der Test läuft in einen Timeout. Daher die Seite **in `<Routes><Route path="/einsaetze/:id/personal" …></Routes>` wrappen** — exakt wie `src/pages/FahrzeugePage.test.tsx` (Zeilen 45–52). Vollständig:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonalPage from './PersonalPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};

function einsatz(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv', begonnen_at: '2026-05-26 09:00:00',
    abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null,
    angelegt_at: '2026-05-26 09:00:00', leitstellen_nr: null, einsatzort: null, einsatzort_lat: null,
    einsatzort_lon: null, meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung', ...overrides,
  };
}

const disponiert = [
  {
    id: 10, einsatz_id: 7, personal_id: 5, ist_adhoc: false, name: 'Thomas Müller',
    funktion: 'Sanitäter, Gruppenführer', traegerorganisation: 'DRK', staerke_position: 'fuehrer',
    status_id: 2, status_label: 'alarmiert', status_kategorie: 'gebunden', status_farbe: null,
    bemerkung: null, disponiert_at: '2026-05-26 09:10:00', disponiert_von: 1,
  },
];

function render(einsatzObj: ReturnType<typeof einsatz>) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/7/personal', () => HttpResponse.json(disponiert)),
    http.get('/api/personal-status', () => HttpResponse.json([
      { id: 2, label: 'alarmiert', kategorie: 'gebunden', farbe: null, sortier: 20 },
    ])),
    http.get('/api/personal', () => HttpResponse.json([])), // Pool (nur_im_dienst)
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personal" element={<PersonalPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/personal' },
  );
}

describe('PersonalPage', () => {
  it('zeigt disponiertes Personal mit Funktion und Position', async () => {
    render(einsatz());
    expect(await screen.findByText('Thomas Müller')).toBeInTheDocument();
    expect(screen.getByText('Sanitäter, Gruppenführer')).toBeInTheDocument();
  });

  it('Leitung im aktiven Einsatz sieht Dispositions-Aktionen', async () => {
    render(einsatz());
    await screen.findByText('Thomas Müller');
    expect(screen.getByRole('button', { name: 'Ad-hoc-Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
  });

  it('Beobachter / abgeschlossen: reine Ansicht', async () => {
    render(einsatz({ status: 'abgeschlossen', abgeschlossen_at: '2026-05-26 12:00:00', meine_rolle: 'beobachter' }));
    await screen.findByText('Thomas Müller');
    expect(screen.queryByRole('button', { name: 'Ad-hoc-Person' })).not.toBeInTheDocument();
    expect(screen.getByText(/abgeschlossen — nur Ansicht/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Frontend-Gesamtlauf (inkl. Regression)**

Run (aus `frontend/`): `npm test && npm run typecheck && npm run lint`
Expected: PASS — alle neuen Tests **und** die bestehenden Einsatz-/ETB-/Fahrzeug-/Registry-Tests grün; keine Typ-/Lint-Fehler.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/PersonalPage.tsx frontend/src/pages/PersonalPage.test.tsx frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts
git commit -m "feat(fe): Einsatz-Modul Personal (Disposition, Ad-hoc, Status/Position) statt Stub"
```

---

## Abschluss-Verifikation (nach Task 18)

- [ ] **Backend vollständig:** `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- [ ] **Frontend vollständig:** aus `frontend/`: `npm test && npm run typecheck && npm run lint`
- [ ] **Manueller Smoke-Test (optional):** Backend starten, als Admin einloggen → Stammdaten → Tabs „Personal", „Qualifikationen", „Personal-Status" prüfen; einen Einsatz öffnen → Modul „Personal" → Stamm-Person disponieren, Ad-hoc anlegen, Status/Position setzen, entfernen; ETB des Einsatzes zeigt die System-Einträge.
