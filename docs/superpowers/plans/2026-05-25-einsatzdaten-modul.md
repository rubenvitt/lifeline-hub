# Einsatzdaten-Modul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aus der Platzhalter-Seite `/einsaetze/:id/einsatzdaten` ein echtes Führungs-Modul machen, das die Kopf-/Stammdaten eines Einsatzes anzeigt und (atomar) bearbeitbar macht, inklusive org-weitem Stichwort-Vorschlags-Katalog.

**Architecture:** Backend erweitert die `einsatz`-Tabelle um Kopf-Felder (Migration), ergänzt das `Einsatz`-Struct samt SELECTs, vergibt beim Anlegen automatisch eine Einsatznummer `JJJJ-NNN` und führt einen `PATCH /api/einsaetze/{id}`-Endpunkt mit eigenem Gate (Schreibrecht **oder** System-Admin) ein. Ein kleines `stichwort`-Modul liefert org-weite Vorschläge (GET für alle, POST/DELETE Admin-only). Frontend ersetzt den `ModulStub` durch `EinsatzdatenPage` (Lesemodus `Descriptions` + `Form`-Bearbeiten) und erweitert die Stammdaten-Seite um die Stichwort-Pflege.

**Tech Stack:** Rust (axum, sqlx/SQLite, chrono), React 18 + TypeScript, antd 5, @tanstack/react-query, dayjs, Vitest + MSW.

---

## Wichtige Vorab-Entscheidungen (Abweichungen von der Spec, technisch erzwungen)

Beide Punkte wurden während der Recherche empirisch verifiziert und sind **keine** Designfreiheiten, sondern technische Notwendigkeiten:

1. **`angelegt_at`-Default:** Die Spec nennt `angelegt_at TEXT NOT NULL DEFAULT (datetime('now'))`. SQLite verbietet aber bei `ALTER TABLE ADD COLUMN` jeden nicht-konstanten Default (geklammerte Ausdrücke) — verifiziert: `Runtime error: Cannot add a column with non-constant default`. **Lösung:** Spalte als `NOT NULL DEFAULT ''` hinzufügen, Bestandszeilen per `UPDATE` auf `begonnen_at` zurücksetzen, und in `repo::anlegen` `angelegt_at = datetime('now')` **explizit** setzen (einzige INSERT-Stelle für `einsatz`). Verhalten gegenüber der Spec unverändert; nur die DB-Mechanik weicht ab.

2. **Stichwort-Seed:** Die Spec verortet den Seed der Startliste in Migration `0006`. `organisation` wird aber erst zur Laufzeit von `bootstrap_admin` angelegt (Migrationen laufen auf einer DB ganz ohne Org) — ein Migrations-Seed mit konkreter `org_id` ist daher unmöglich. **Lösung:** Migration `0006` legt nur die Tabelle an; der Seed der Startliste passiert in `bootstrap_admin`, sobald die Org existiert. Konsequenz: Bereits bestehende Single-Org-Deployments bekommen den Seed nicht automatisch — Admins pflegen Stichworte über die Stammdaten-UI nach; die Combobox akzeptiert ohnehin Freitext.

---

## File Structure

**Backend (neu):**
- `migrations/0005_einsatzdaten.sql` — neue `einsatz`-Spalten + Unique-Index + Backfill `angelegt_at`.
- `migrations/0006_stichwort_vorschlag.sql` — Tabelle `einsatz_stichwort_vorschlag` (nur Schema).
- `src/stichwort/mod.rs` — `StichwortVorschlag`-Struct + Repo-Funktionen (liste/anlegen/loeschen).
- `src/routes/stichwort.rs` — GET/POST/DELETE-Handler für Stichwort-Vorschläge.
- `tests/stichwort.rs` — Integrationstests der Stichwort-Endpunkte.

**Backend (geändert):**
- `src/lib.rs` — `pub mod stichwort;`.
- `src/einsatz/mod.rs` — Einsatzart-Konstanten + Validierung; `Einsatz`/`EinsatzAnzeige`/`anzeige()` um neue Felder erweitern; bestehende Test-Struct-Literale ergänzen.
- `src/einsatz/repo.rs` — SELECTs in `laden`/`liste_fuer` synchron erweitern; `anlegen` um Einsatznummer-Auto-Vergabe + `angelegt_at`; neue `aktualisiere_kopf`-Funktion + `KopfDaten`-Struct.
- `src/einsatz/berechtigung.rs` — neues Gate `fordere_schreibrecht_oder_admin` + Tests; Test-Helper-Literal ergänzen.
- `src/routes/einsatz.rs` — `aktualisieren`-Handler (PATCH) + `KopfdatenUpdate`-Request.
- `src/routes/mod.rs` — `pub mod stichwort;`.
- `src/app.rs` — Routen registrieren (PATCH-Einsatz, Stichwort-CRUD); `patch` importieren.
- `src/auth/bootstrap.rs` — Stichwort-Startliste seeden + Test.
- `tests/einsatz.rs` — PATCH-Integrationstests + Helfer.

**Frontend (neu):**
- `frontend/src/api/stichwortVorschlaege.ts` — 3 API-Funktionen.
- `frontend/src/pages/EinsatzdatenPage.tsx` — die echte Modul-Seite.
- `frontend/src/pages/EinsatzdatenPage.test.tsx` — Komponententests.

**Frontend (geändert):**
- `frontend/src/api/types.ts` — `EinsatzAnzeige` erweitern; `Einsatzart`, `StichwortVorschlag`.
- `frontend/src/api/einsaetze.ts` — `KopfdatenUpdate` + `aktualisiereEinsatz`.
- `frontend/src/App.tsx` — `einsatzdaten` in `MODUL_ELEMENTE`.
- `frontend/src/einsatz/modulRegistry.ts` — `einsatzdaten` auf `status: 'fertig'`.
- `frontend/src/pages/StammdatenPage.tsx` — Abschnitt „Einsatz-Stichworte".
- `frontend/src/pages/StammdatenPage.test.tsx` — Tests an neue Abhängigkeiten (AuthProvider/MSW) anpassen.

---

## Task 1: Migration 0005 — neue Einsatz-Spalten + Unique-Index

**Files:**
- Create: `migrations/0005_einsatzdaten.sql`
- Test: `src/db.rs` (neuer `#[tokio::test]` im bestehenden `mod tests`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0005_einsatzdaten.sql`:

```sql
-- Kopf-/Stammdatenfelder des Einsatzes (Modul „Einsatzdaten").
-- Alle neuen Spalten sind nullable außer einsatzart.
--
-- Hinweis SQLite: ALTER TABLE ADD COLUMN erlaubt KEINE nicht-konstanten
-- Defaults (z. B. datetime('now')). angelegt_at bekommt daher konstant '' und
-- wird unten für Bestandszeilen auf begonnen_at zurückgesetzt; neue Zeilen
-- setzen den Wert explizit in repo::anlegen.
ALTER TABLE einsatz ADD COLUMN einsatzart TEXT NOT NULL DEFAULT 'realeinsatz'
    CHECK (einsatzart IN ('realeinsatz', 'uebung', 'sanitaetsdienst', 'bereitstellung'));
ALTER TABLE einsatz ADD COLUMN einsatznummer_intern TEXT;
ALTER TABLE einsatz ADD COLUMN angelegt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE einsatz ADD COLUMN leitstellen_nr TEXT;
ALTER TABLE einsatz ADD COLUMN einsatzort TEXT;
ALTER TABLE einsatz ADD COLUMN einsatzort_lat REAL;
ALTER TABLE einsatz ADD COLUMN einsatzort_lon REAL;
ALTER TABLE einsatz ADD COLUMN meldende_stelle TEXT;
ALTER TABLE einsatz ADD COLUMN sachverhalt TEXT;
ALTER TABLE einsatz ADD COLUMN anzahl_betroffene_initial INTEGER;

-- Bestands-Einsätze: angelegt_at auf begonnen_at zurücksetzen
-- (nächste bekannte technische Zeit; Original-Anlagezeitpunkt unbekannt).
UPDATE einsatz SET angelegt_at = begonnen_at;

-- Einsatznummer je Organisation eindeutig. In SQLite gelten mehrere NULL als
-- verschieden → Bestands-Einsätze ohne Nummer kollidieren nicht.
CREATE UNIQUE INDEX idx_einsatz_nummer ON einsatz(org_id, einsatznummer_intern);
```

- [ ] **Step 2: Test schreiben**

In `src/db.rs`, im bestehenden `#[cfg(test)] mod tests` (nach `einsatz_migration_creates_tables_and_constraints`) ergänzen:

```rust
#[tokio::test]
async fn einsatzdaten_migration_legt_spalten_und_unique_index_an() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();

    // einsatzart-Default ist 'realeinsatz'.
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, begonnen_at) \
         VALUES (1, 'Lage', '2026-05-23 09:00:00') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (art, angelegt): (String, String) =
        sqlx::query_as("SELECT einsatzart, angelegt_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(art, "realeinsatz");
    // angelegt_at hat den konstanten Migrations-Default '' — der Backfill
    // betrifft nur Bestandszeilen (in test_pool gibt es keine), neue Zeilen
    // bekommen den Wert erst in repo::anlegen (Task 4).
    assert_eq!(angelegt, "", "neue Zeile: angelegt_at = '' bis repo::anlegen es setzt");

    // einsatzart-CHECK lehnt ungültigen Wert ab.
    let bad = sqlx::query("UPDATE einsatz SET einsatzart = 'quatsch' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await;
    assert!(bad.is_err(), "ungültige einsatzart muss abgelehnt werden");

    // Mehrere NULL-Einsatznummern sind erlaubt (Bestand).
    sqlx::query("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A'), (1, 'B')")
        .execute(&pool)
        .await
        .unwrap();

    // Erste manuelle Nummer ok, Dublette in derselben Org → Unique-Verstoß.
    sqlx::query("UPDATE einsatz SET einsatznummer_intern = '2026-001' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let dup = sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (1, 'C', '2026-001')")
        .execute(&pool)
        .await;
    assert!(dup.is_err(), "doppelte Einsatznummer je Org muss abgelehnt werden");
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::einsatzdaten_migration_legt_spalten_und_unique_index_an`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add migrations/0005_einsatzdaten.sql src/db.rs
git commit -m "feat: Migration 0005 — Einsatz-Kopffelder und Einsatznummer-Unique-Index"
```

---

## Task 2: Migration 0006 — Stichwort-Vorschlag-Tabelle

**Files:**
- Create: `migrations/0006_stichwort_vorschlag.sql`
- Test: `src/db.rs`

- [ ] **Step 1: Migration schreiben**

Create `migrations/0006_stichwort_vorschlag.sql`:

```sql
-- Org-weiter Katalog von Einsatzstichwort-Vorschlägen für die Combobox.
-- Seeding der Startliste passiert in bootstrap_admin (org_id existiert erst
-- zur Laufzeit), nicht hier — eine Migration läuft ohne Organisation.
CREATE TABLE einsatz_stichwort_vorschlag (
    id      INTEGER PRIMARY KEY,
    org_id  INTEGER NOT NULL REFERENCES organisation(id),
    text    TEXT NOT NULL,
    sortier INTEGER NOT NULL DEFAULT 0,
    UNIQUE(org_id, text)
);
```

- [ ] **Step 2: Test schreiben**

In `src/db.rs`, `mod tests` ergänzen:

```rust
#[tokio::test]
async fn stichwort_vorschlag_migration_legt_tabelle_mit_unique_an() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
        .execute(&pool)
        .await
        .unwrap();

    // UNIQUE(org_id, text): Dublette je Org abgelehnt.
    let dup = sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
        .execute(&pool)
        .await;
    assert!(dup.is_err(), "doppeltes Stichwort je Org muss abgelehnt werden");

    // sortier-Default ist 0.
    let sortier: i64 =
        sqlx::query_scalar("SELECT sortier FROM einsatz_stichwort_vorschlag WHERE text = 'H1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sortier, 0);
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::stichwort_vorschlag_migration_legt_tabelle_mit_unique_an`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add migrations/0006_stichwort_vorschlag.sql src/db.rs
git commit -m "feat: Migration 0006 — Stichwort-Vorschlag-Tabelle"
```

---

## Task 3: Einsatz-Typen erweitern + SELECTs synchronisieren

> **Wichtig (zwei Fallen):** `Einsatz` und `EinsatzAnzeige` haben explizite Feldlisten und werden in Tests als Struct-Literale konstruiert — neue Felder brechen diese Literale beim Compile. Und `laden`/`liste_fuer` haben explizite SELECT-Spaltenlisten — ein vergessenes Feld ist erst zur Laufzeit ein sqlx-Decode-Fehler. Deshalb erweitern wir Struct, `anzeige()`, **beide** SELECTs und alle Test-Literale in **einem** Task.

**Files:**
- Modify: `src/einsatz/mod.rs`
- Modify: `src/einsatz/repo.rs`
- Modify: `src/einsatz/berechtigung.rs` (nur Test-Helper-Literal)

- [ ] **Step 1: Einsatzart-Konstanten + Validierung in `mod.rs`**

In `src/einsatz/mod.rs`, nach den `STATUS_*`-Konstanten (nach Zeile 16) einfügen:

```rust
/// Grobklasse eines Einsatzes (DB-Spalte `einsatzart`, CHECK-validiert).
pub const EINSATZART_REALEINSATZ: &str = "realeinsatz";
pub const EINSATZART_UEBUNG: &str = "uebung";
pub const EINSATZART_SANITAETSDIENST: &str = "sanitaetsdienst";
pub const EINSATZART_BEREITSTELLUNG: &str = "bereitstellung";

/// Alle gültigen Einsatzarten (Reihenfolge = UI-Reihenfolge).
pub const EINSATZARTEN: [&str; 4] = [
    EINSATZART_REALEINSATZ,
    EINSATZART_UEBUNG,
    EINSATZART_SANITAETSDIENST,
    EINSATZART_BEREITSTELLUNG,
];

/// Ob `s` eine gültige Einsatzart ist (für die Eingabe-Validierung).
pub fn ist_gueltige_einsatzart(s: &str) -> bool {
    EINSATZARTEN.contains(&s)
}
```

- [ ] **Step 2: `Einsatz`-Struct erweitern**

In `src/einsatz/mod.rs`, das `Einsatz`-Struct (Zeilen 63–73) um die neuen Felder ergänzen — neue Felder **nach** `abgeschlossen_von` (Reihenfolge ist für die manuelle Konstruktion egal, die SELECTs binden über Spaltennamen via `FromRow`):

```rust
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Einsatz {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub angelegt_at: String,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
}
```

- [ ] **Step 3: `EinsatzAnzeige` erweitern + `anzeige()` anpassen**

In `src/einsatz/mod.rs`, `anzeige()` (Zeilen 83–94) und `EinsatzAnzeige` (Zeilen 99–109) ersetzen:

```rust
    pub fn anzeige(&self, meine_rolle: Option<String>) -> EinsatzAnzeige {
        EinsatzAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            stichwort: self.stichwort.clone(),
            status: self.status.clone(),
            begonnen_at: self.begonnen_at.clone(),
            abgeschlossen_at: self.abgeschlossen_at.clone(),
            abgeschlossen_von: self.abgeschlossen_von,
            einsatzart: self.einsatzart.clone(),
            einsatznummer_intern: self.einsatznummer_intern.clone(),
            angelegt_at: self.angelegt_at.clone(),
            leitstellen_nr: self.leitstellen_nr.clone(),
            einsatzort: self.einsatzort.clone(),
            einsatzort_lat: self.einsatzort_lat,
            einsatzort_lon: self.einsatzort_lon,
            meldende_stelle: self.meldende_stelle.clone(),
            sachverhalt: self.sachverhalt.clone(),
            anzahl_betroffene_initial: self.anzahl_betroffene_initial,
            meine_rolle,
        }
    }
}

/// Öffentliche Einsatz-Darstellung für API-Antworten (ohne `org_id`),
/// inklusive der Rolle des abfragenden Benutzers.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub angelegt_at: String,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
    pub meine_rolle: Option<String>,
}
```

- [ ] **Step 4: Test-Struct-Literale in `mod.rs` ergänzen**

In `src/einsatz/mod.rs`, im Test `einsatz_ist_aktiv_spiegelt_status` (Zeile ~157) das `Einsatz { ... }`-Literal um die neuen Felder ergänzen:

```rust
        let mut e = Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: STATUS_AKTIV.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
            einsatzart: EINSATZART_REALEINSATZ.into(),
            einsatznummer_intern: None,
            angelegt_at: "2026-05-23".into(),
            leitstellen_nr: None,
            einsatzort: None,
            einsatzort_lat: None,
            einsatzort_lon: None,
            meldende_stelle: None,
            sachverhalt: None,
            anzahl_betroffene_initial: None,
        };
```

- [ ] **Step 5: Test-Struct-Literal in `berechtigung.rs` ergänzen**

In `src/einsatz/berechtigung.rs`, den Test-Helper `einsatz_mit_status` (Zeilen ~109–120) ersetzen:

```rust
    fn einsatz_mit_status(status: &str) -> Einsatz {
        Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: status.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
            einsatzart: crate::einsatz::EINSATZART_REALEINSATZ.into(),
            einsatznummer_intern: None,
            angelegt_at: "2026-05-23".into(),
            leitstellen_nr: None,
            einsatzort: None,
            einsatzort_lat: None,
            einsatzort_lon: None,
            meldende_stelle: None,
            sachverhalt: None,
            anzahl_betroffene_initial: None,
        }
    }
```

- [ ] **Step 6: SELECT in `repo::laden` erweitern**

In `src/einsatz/repo.rs`, `laden` (Zeilen 49–59) die Spaltenliste ergänzen:

```rust
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    sqlx::query_as::<_, Einsatz>(
        "SELECT id, org_id, bezeichnung, stichwort, status, begonnen_at, \
                abgeschlossen_at, abgeschlossen_von, einsatzart, einsatznummer_intern, \
                angelegt_at, leitstellen_nr, einsatzort, einsatzort_lat, einsatzort_lon, \
                meldende_stelle, sachverhalt, anzahl_betroffene_initial \
         FROM einsatz WHERE id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}
```

- [ ] **Step 7: `liste_fuer` Row-Struct + SELECT + Mapping erweitern**

In `src/einsatz/repo.rs`, `liste_fuer` (Zeilen 81–132): die innere `Row`-Struct, den SELECT und das `EinsatzAnzeige`-Mapping um die neuen Felder ergänzen:

```rust
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        bezeichnung: String,
        stichwort: Option<String>,
        status: String,
        begonnen_at: String,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        einsatzart: String,
        einsatznummer_intern: Option<String>,
        angelegt_at: String,
        leitstellen_nr: Option<String>,
        einsatzort: Option<String>,
        einsatzort_lat: Option<f64>,
        einsatzort_lon: Option<f64>,
        meldende_stelle: Option<String>,
        sachverhalt: Option<String>,
        anzahl_betroffene_initial: Option<i64>,
        meine_rolle: Option<String>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                m.einsatz_rolle AS meine_rolle \
         FROM einsatz e \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer.id)
    .fetch_all(pool)
    .await?;

    let jetzt = Utc::now();
    Ok(rows
        .into_iter()
        .filter(|r| {
            darf_lesen(
                benutzer,
                &r.status,
                r.abgeschlossen_at.as_deref(),
                r.meine_rolle.as_deref().and_then(EinsatzRolle::parse),
                jetzt,
            )
        })
        .map(|r| EinsatzAnzeige {
            id: r.id,
            bezeichnung: r.bezeichnung,
            stichwort: r.stichwort,
            status: r.status,
            begonnen_at: r.begonnen_at,
            abgeschlossen_at: r.abgeschlossen_at,
            abgeschlossen_von: r.abgeschlossen_von,
            einsatzart: r.einsatzart,
            einsatznummer_intern: r.einsatznummer_intern,
            angelegt_at: r.angelegt_at,
            leitstellen_nr: r.leitstellen_nr,
            einsatzort: r.einsatzort,
            einsatzort_lat: r.einsatzort_lat,
            einsatzort_lon: r.einsatzort_lon,
            meldende_stelle: r.meldende_stelle,
            sachverhalt: r.sachverhalt,
            anzahl_betroffene_initial: r.anzahl_betroffene_initial,
            meine_rolle: r.meine_rolle,
        })
        .collect())
```

- [ ] **Step 8: Build + alle Einsatz-Tests laufen lassen**

Run: `cargo test --lib einsatz`
Expected: PASS (alle bestehenden Einsatz-Unit-Tests + Migrations-Test kompilieren und laufen grün). Falls Compile-Fehler wegen weiterer Struct-Literale auftreten, diese identisch ergänzen.

- [ ] **Step 9: Commit**

```bash
git add src/einsatz/mod.rs src/einsatz/repo.rs src/einsatz/berechtigung.rs
git commit -m "feat: Einsatz-Kopffelder im Struct, EinsatzAnzeige und SELECTs"
```

---

## Task 4: Einsatznummer-Auto-Vergabe in `repo::anlegen`

**Files:**
- Modify: `src/einsatz/repo.rs`

- [ ] **Step 1: Test schreiben (zuerst, schlägt fehl)**

In `src/einsatz/repo.rs`, `mod tests`, neue Tests ergänzen:

```rust
    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_einsatznummer() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        let a = anlegen(&pool, "Lage A", None, leit).await.unwrap();
        let b = anlegen(&pool, "Lage B", None, leit).await.unwrap();
        assert_eq!(a.einsatznummer_intern.as_deref(), Some(format!("{jahr}-001").as_str()));
        assert_eq!(b.einsatznummer_intern.as_deref(), Some(format!("{jahr}-002").as_str()));

        // angelegt_at wurde gesetzt (nicht der '' Default).
        assert!(!a.angelegt_at.is_empty());
    }

    #[tokio::test]
    async fn anlegen_zaehlt_je_organisation_getrennt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await; // legt Org id=1 an

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        // Zweite Organisation mit bereits hoher Nummer — darf Org 1 nicht beeinflussen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Orga 2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (2, 'Fremd', ?)")
            .bind(format!("{jahr}-009"))
            .execute(&pool)
            .await
            .unwrap();

        // anlegen nutzt Org 1 (ORDER BY id LIMIT 1) → beginnt bei 001.
        let a = anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(a.einsatznummer_intern.as_deref(), Some(format!("{jahr}-001").as_str()));
    }
```

- [ ] **Step 2: Test ausführen (rot)**

Run: `cargo test --lib einsatz::repo::tests::anlegen_vergibt_fortlaufende_einsatznummer`
Expected: FAIL (`einsatznummer_intern` ist noch `None`).

- [ ] **Step 3: `anlegen` implementieren**

In `src/einsatz/repo.rs`, `anlegen` (Zeilen 12–46) ersetzen:

```rust
pub async fn anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    // Single-Org in T1: alle Einsätze gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let mut tx = pool.begin().await?;

    // Einsatznummer JJJJ-NNN: NNN je Organisation + Jahr fortlaufend, 3-stellig.
    // 'JJJJ-' ist 5 Zeichen lang → substr(..., 6) liefert den NNN-Teil.
    // Race-frei: WAL serialisiert Writer; der Unique-Index sichert zusätzlich ab.
    let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
        .fetch_one(&mut *tx)
        .await?;
    let praefix = format!("{jahr}-");
    let max_nr: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(CAST(substr(einsatznummer_intern, 6) AS INTEGER)) \
         FROM einsatz WHERE org_id = ? AND einsatznummer_intern LIKE ?",
    )
    .bind(org_id)
    .bind(format!("{praefix}%"))
    .fetch_one(&mut *tx)
    .await?;
    let einsatznummer = format!("{praefix}{:03}", max_nr.unwrap_or(0) + 1);

    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, stichwort, einsatznummer_intern, angelegt_at) \
         VALUES (?, ?, ?, ?, datetime('now')) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(stichwort)
    .bind(&einsatznummer)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    laden(pool, einsatz_id).await
}
```

- [ ] **Step 4: Tests ausführen (grün)**

Run: `cargo test --lib einsatz::repo`
Expected: PASS (inkl. der beiden neuen Tests und der bestehenden `anlegen_*`-Tests).

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/repo.rs
git commit -m "feat: Einsatznummer JJJJ-NNN automatisch beim Anlegen vergeben"
```

---

## Task 5: PATCH-Gate `fordere_schreibrecht_oder_admin`

> Eigenes Gate **nur** für die PATCH-Route: Einsatz-Schreibrecht (Leitung/Führung) **oder** System-Admin. `fordere_schreibrecht` (vom ETB genutzt) bleibt unverändert — „System-Admin" hier ist `benutzer.ist_admin()`, **nicht** `ist_hoehere_berechtigung` (org-Führungskraft erhält dadurch KEIN Schreibrecht ohne Einsatz-Mitgliedschaft).

**Files:**
- Modify: `src/einsatz/berechtigung.rs`

- [ ] **Step 1: Test schreiben (zuerst, schlägt fehl)**

In `src/einsatz/berechtigung.rs`, `mod tests`, ergänzen (der Helper `benutzer_mit` existiert dort bereits):

```rust
    #[test]
    fn schreibrecht_oder_admin_erlaubt_admin_ohne_rolle() {
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(fordere_schreibrecht_oder_admin(&admin, None).is_ok());
    }

    #[test]
    fn schreibrecht_oder_admin_erlaubt_schreibberechtigte_rollen() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Fuehrungspersonal)).is_ok());
    }

    #[test]
    fn schreibrecht_oder_admin_blockt_beobachter_und_fremde_ohne_admin() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Beobachter)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&normal, None).unwrap_err(),
            AppError::Forbidden
        ));
        // Org-Führungskraft ohne Mitgliedschaft ist KEIN System-Admin → blockiert.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&fk, None).unwrap_err(),
            AppError::Forbidden
        ));
    }
```

- [ ] **Step 2: Test ausführen (rot — Funktion fehlt)**

Run: `cargo test --lib einsatz::berechtigung::tests::schreibrecht_oder_admin_erlaubt_admin_ohne_rolle`
Expected: FAIL (Compile-Fehler: Funktion existiert nicht).

- [ ] **Step 3: Gate implementieren**

In `src/einsatz/berechtigung.rs`, nach `fordere_schreibrecht` (nach Zeile 89) einfügen:

```rust
/// Gate der PATCH-Kopfdaten-Route: Einsatz-Schreibrecht (Einsatzleitung oder
/// Führungspersonal) ODER System-Admin (`system_rolle == admin`). Bewusst
/// lokal zu dieser Route — `fordere_schreibrecht` (ETB) bleibt unberührt, und
/// die Admin-Erlaubnis gilt NICHT für org-weite Führungskräfte ohne Mitgliedschaft.
pub fn fordere_schreibrecht_oder_admin(
    benutzer: &Benutzer,
    rolle: Option<EinsatzRolle>,
) -> Result<(), AppError> {
    if benutzer.ist_admin() {
        return Ok(());
    }
    fordere_schreibrecht(rolle)
}
```

- [ ] **Step 4: Tests ausführen (grün)**

Run: `cargo test --lib einsatz::berechtigung`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/berechtigung.rs
git commit -m "feat: PATCH-Gate fordere_schreibrecht_oder_admin"
```

---

## Task 6: `repo::aktualisiere_kopf`

**Files:**
- Modify: `src/einsatz/repo.rs`

- [ ] **Step 1: Test schreiben (zuerst, schlägt fehl)**

In `src/einsatz/repo.rs`, `mod tests`, ergänzen:

```rust
    #[tokio::test]
    async fn aktualisiere_kopf_setzt_felder_und_leere_optionals_null() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Alt", None, leit).await.unwrap();

        let aktualisiert = aktualisiere_kopf(
            &pool,
            einsatz.id,
            KopfDaten {
                bezeichnung: "Neu",
                stichwort: Some("H1"),
                einsatzart: crate::einsatz::EINSATZART_UEBUNG,
                einsatznummer_intern: einsatz.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: Some("Hauptstraße 1"),
                einsatzort_lat: Some(52.5),
                einsatzort_lon: Some(13.4),
                meldende_stelle: None,
                sachverhalt: Some("Mehrzeiliges\nMeldebild"),
                anzahl_betroffene_initial: Some(3),
                begonnen_at: "2026-05-25 08:00:00",
            },
        )
        .await
        .unwrap();

        assert_eq!(aktualisiert.bezeichnung, "Neu");
        assert_eq!(aktualisiert.einsatzart, "uebung");
        assert_eq!(aktualisiert.einsatzort.as_deref(), Some("Hauptstraße 1"));
        assert_eq!(aktualisiert.einsatzort_lat, Some(52.5));
        assert_eq!(aktualisiert.anzahl_betroffene_initial, Some(3));
        assert_eq!(aktualisiert.leitstellen_nr, None);
        assert_eq!(aktualisiert.begonnen_at, "2026-05-25 08:00:00");
        // angelegt_at bleibt unverändert (Audit-Spur).
        assert_eq!(aktualisiert.angelegt_at, einsatz.angelegt_at);
    }

    #[tokio::test]
    async fn aktualisiere_kopf_doppelte_nummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let a = anlegen(&pool, "A", None, leit).await.unwrap();
        let b = anlegen(&pool, "B", None, leit).await.unwrap();

        // b auf a's Nummer setzen → Unique-Verstoß → Conflict.
        let err = aktualisiere_kopf(
            &pool,
            b.id,
            KopfDaten {
                bezeichnung: "B",
                stichwort: None,
                einsatzart: crate::einsatz::EINSATZART_REALEINSATZ,
                einsatznummer_intern: a.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: None,
                einsatzort_lat: None,
                einsatzort_lon: None,
                meldende_stelle: None,
                sachverhalt: None,
                anzahl_betroffene_initial: None,
                begonnen_at: &b.begonnen_at,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }
```

- [ ] **Step 2: Test ausführen (rot)**

Run: `cargo test --lib einsatz::repo::tests::aktualisiere_kopf_setzt_felder_und_leere_optionals_null`
Expected: FAIL (Compile-Fehler: `KopfDaten`/`aktualisiere_kopf` fehlen).

- [ ] **Step 3: `KopfDaten` + `aktualisiere_kopf` implementieren**

In `src/einsatz/repo.rs`, nach `abschliessen` (nach Zeile 153) einfügen:

```rust
/// Editierbare Kopffelder für `aktualisiere_kopf`. Optional-Strings sind bereits
/// vom Handler getrimmt; leere Werte werden als `None` übergeben (→ NULL).
#[derive(Debug)]
pub struct KopfDaten<'a> {
    pub bezeichnung: &'a str,
    pub stichwort: Option<&'a str>,
    pub einsatzart: &'a str,
    pub einsatznummer_intern: Option<&'a str>,
    pub leitstellen_nr: Option<&'a str>,
    pub einsatzort: Option<&'a str>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<&'a str>,
    pub sachverhalt: Option<&'a str>,
    pub anzahl_betroffene_initial: Option<i64>,
    /// Bereits ins DB-Format normalisierte Alarmzeit.
    pub begonnen_at: &'a str,
}

/// Vollersatz der editierbaren Kopf-Spalten (ein atomares Speichern).
/// Nicht-editierbare Spalten (status, abgeschlossen_*, angelegt_at, org_id, id)
/// bleiben unberührt. Ein Verstoß gegen den Einsatznummer-Unique-Index ergibt
/// `Conflict` (409).
pub async fn aktualisiere_kopf(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: KopfDaten<'_>,
) -> Result<Einsatz, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einsatz SET \
            bezeichnung = ?, stichwort = ?, einsatzart = ?, einsatznummer_intern = ?, \
            leitstellen_nr = ?, einsatzort = ?, einsatzort_lat = ?, einsatzort_lon = ?, \
            meldende_stelle = ?, sachverhalt = ?, anzahl_betroffene_initial = ?, begonnen_at = ? \
         WHERE id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.stichwort)
    .bind(daten.einsatzart)
    .bind(daten.einsatznummer_intern)
    .bind(daten.leitstellen_nr)
    .bind(daten.einsatzort)
    .bind(daten.einsatzort_lat)
    .bind(daten.einsatzort_lon)
    .bind(daten.meldende_stelle)
    .bind(daten.sachverhalt)
    .bind(daten.anzahl_betroffene_initial)
    .bind(daten.begonnen_at)
    .bind(einsatz_id)
    .execute(pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict(
                "Einsatznummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    ergebnis?;

    laden(pool, einsatz_id).await
}
```

- [ ] **Step 4: Tests ausführen (grün)**

Run: `cargo test --lib einsatz::repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/repo.rs
git commit -m "feat: repo::aktualisiere_kopf für atomares Speichern der Kopfdaten"
```

---

## Task 7: PATCH-Handler + Routen-Registrierung + Integrationstests

**Files:**
- Modify: `src/routes/einsatz.rs`
- Modify: `src/app.rs`
- Test: `tests/einsatz.rs`

- [ ] **Step 1: Handler + Request-Typ in `routes/einsatz.rs`**

In `src/routes/einsatz.rs` die `use`-Zeilen anpassen (Zeilen 3–4):

```rust
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_schreibrecht_oder_admin,
};
use crate::einsatz::{
    ist_gueltige_einsatzart, repo, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige,
    EINSATZ_ROLLE_LEITUNG,
};
```

Am Dateiende anfügen:

```rust
/// Trimmt einen optionalen String; leer → `None` (wird als NULL gespeichert).
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct KopfdatenUpdate {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
    /// Alarmzeit (ISO-8601/RFC3339 oder SQLite-Format).
    pub begonnen_at: String,
}

/// PATCH /api/einsaetze/{id} — Kopf-/Stammdaten in einem Request aktualisieren.
/// Gate: Einsatz-Schreibrecht ODER System-Admin, plus aktiver Einsatz (sonst 409).
/// Vollersatz der editierbaren Felder; leere Optional-Strings → NULL.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
    Json(req): Json<KopfdatenUpdate>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_schreibrecht_oder_admin(&benutzer, rolle)?;
    fordere_aktiv(&einsatz)?;

    let bezeichnung = req.bezeichnung.trim();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    if !ist_gueltige_einsatzart(&req.einsatzart) {
        return Err(AppError::Validation("Ungültige Einsatzart".into()));
    }
    if let Some(n) = req.anzahl_betroffene_initial {
        if n < 0 {
            return Err(AppError::Validation(
                "Anzahl Betroffene darf nicht negativ sein".into(),
            ));
        }
    }
    let begonnen_at = crate::etb::normalisiere_zeit(&req.begonnen_at)?;

    let stichwort = bereinige(req.stichwort);
    let einsatznummer_intern = bereinige(req.einsatznummer_intern);
    let leitstellen_nr = bereinige(req.leitstellen_nr);
    let einsatzort = bereinige(req.einsatzort);
    let meldende_stelle = bereinige(req.meldende_stelle);
    let sachverhalt = bereinige(req.sachverhalt);

    let aktualisiert = repo::aktualisiere_kopf(
        &state.pool,
        id,
        repo::KopfDaten {
            bezeichnung,
            stichwort: stichwort.as_deref(),
            einsatzart: &req.einsatzart,
            einsatznummer_intern: einsatznummer_intern.as_deref(),
            leitstellen_nr: leitstellen_nr.as_deref(),
            einsatzort: einsatzort.as_deref(),
            einsatzort_lat: req.einsatzort_lat,
            einsatzort_lon: req.einsatzort_lon,
            meldende_stelle: meldende_stelle.as_deref(),
            sachverhalt: sachverhalt.as_deref(),
            anzahl_betroffene_initial: req.anzahl_betroffene_initial,
            begonnen_at: &begonnen_at,
        },
    )
    .await?;

    Ok(Json(
        aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string())),
    ))
}
```

- [ ] **Step 2: Route registrieren**

In `src/app.rs` den Routing-Import (Zeile 4) um `patch` ergänzen:

```rust
    routing::{delete, get, patch, post, put},
```

Und die Route nach der `GET /api/einsaetze/{id}`-Zeile (nach Zeile 32) einfügen:

```rust
        .route("/api/einsaetze/{id}", patch(routes::einsatz::aktualisieren))
```

- [ ] **Step 3: Integrationstest-Helfer in `tests/einsatz.rs`**

In `tests/einsatz.rs` `use serde_json::Value;` (Zeile 7) erweitern zu:

```rust
use serde_json::{json, Value};
```

Am Dateiende einfügen (vor dem letzten Test oder ans Ende):

```rust
/// Vollständiger, gültiger Kopfdaten-Body; Tests überschreiben einzelne Keys.
fn basis_kopf(bezeichnung: &str) -> Value {
    json!({
        "bezeichnung": bezeichnung,
        "stichwort": null,
        "einsatzart": "realeinsatz",
        "einsatznummer_intern": null,
        "leitstellen_nr": null,
        "einsatzort": null,
        "einsatzort_lat": null,
        "einsatzort_lon": null,
        "meldende_stelle": null,
        "sachverhalt": null,
        "anzahl_betroffene_initial": null,
        "begonnen_at": "2026-05-25 08:00:00"
    })
}

/// PATCH der Kopfdaten als Cookie-Inhaber; liefert (Status, JSON).
async fn patch_kopf(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn einsatzleitung_patcht_kopfdaten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Alt").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Neu");
    body["einsatzart"] = json!("uebung");
    body["einsatzort"] = json!("Hauptstraße 1");
    body["anzahl_betroffene_initial"] = json!(5);

    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(antwort["bezeichnung"], "Neu");
    assert_eq!(antwort["einsatzart"], "uebung");
    assert_eq!(antwort["einsatzort"], "Hauptstraße 1");
    assert_eq!(antwort["anzahl_betroffene_initial"], 5);
}

#[tokio::test]
async fn admin_ohne_mitgliedschaft_darf_patchen_aber_kein_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Führungskraft legt Einsatz an → sie ist Einsatzleitung, Admin ist NICHT Mitglied.
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, json) = einsatz_anlegen(&app, &frieda, "Friedas Lage").await;
    let id = json["id"].as_i64().unwrap();

    // Admin (nicht Mitglied) darf Kopfdaten patchen.
    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("Vom Admin")).await;
    assert_eq!(status, StatusCode::OK);

    // Aber: Admin ohne Mitgliedschaft darf KEINEN ETB-Eintrag schreiben
    // (ETB-Semantik bleibt unverändert).
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{id}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin)
                .body(Body::from(r#"{"typ":"meldung","inhalt":"Test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_darf_kopf_nicht_patchen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    assert_eq!(
        mitglied_setzen(&app, &admin, id, erika_id, "beobachter").await,
        StatusCode::OK
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = patch_kopf(&app, &erika, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nicht_mitglied_ohne_admin_darf_kopf_nicht_patchen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = patch_kopf(&app, &erika, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patch_auf_abgeschlossenen_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn patch_leere_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("   ")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_ungueltige_einsatzart_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["einsatzart"] = json!("quatsch");
    let (status, _) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_negative_anzahl_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["anzahl_betroffene_initial"] = json!(-1);
    let (status, _) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_leere_optionals_werden_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["einsatzort"] = json!("   ");
    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert!(antwort["einsatzort"].is_null());
}

#[tokio::test]
async fn patch_doppelte_einsatznummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let (_, a) = einsatz_anlegen(&app, &frieda, "A").await;
    let (_, b) = einsatz_anlegen(&app, &frieda, "B").await;
    let nummer_a = a["einsatznummer_intern"].as_str().unwrap().to_string();
    let id_b = b["id"].as_i64().unwrap();

    let mut body = basis_kopf("B");
    body["einsatznummer_intern"] = json!(nummer_a);
    let (status, _) = patch_kopf(&app, &frieda, id_b, body).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn angelegt_at_bleibt_bei_patch_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    let angelegt_vorher = json["angelegt_at"].as_str().unwrap().to_string();

    let mut body = basis_kopf("Lage");
    body["begonnen_at"] = json!("2026-05-20 10:00:00");
    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(antwort["begonnen_at"], "2026-05-20 10:00:00");
    assert_eq!(antwort["angelegt_at"], angelegt_vorher);
}

#[tokio::test]
async fn anlegen_vergibt_einsatznummer_im_format() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, a) = einsatz_anlegen(&app, &admin, "A").await;
    let (_, b) = einsatz_anlegen(&app, &admin, "B").await;
    let nr_a = a["einsatznummer_intern"].as_str().unwrap();
    let nr_b = b["einsatznummer_intern"].as_str().unwrap();
    assert!(nr_a.ends_with("-001"), "erste Nummer endet auf -001: {nr_a}");
    assert!(nr_b.ends_with("-002"), "zweite Nummer endet auf -002: {nr_b}");
}
```

- [ ] **Step 4: Tests ausführen**

Run: `cargo test --test einsatz`
Expected: PASS (alle bestehenden + neuen PATCH-Tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/einsatz.rs src/app.rs tests/einsatz.rs
git commit -m "feat: PATCH /api/einsaetze/{id} für Kopfdaten + Integrationstests"
```

---

## Task 8: Stichwort-Modul (Struct + Repo)

**Files:**
- Create: `src/stichwort/mod.rs`
- Modify: `src/lib.rs`

- [ ] **Step 1: Modul anlegen**

Create `src/stichwort/mod.rs`:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Org-weiter Einsatzstichwort-Vorschlag für die Combobox.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct StichwortVorschlag {
    pub id: i64,
    pub text: String,
}

/// Alle Vorschläge einer Organisation, sortiert nach `sortier`, dann `text`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<StichwortVorschlag>, AppError> {
    sqlx::query_as::<_, StichwortVorschlag>(
        "SELECT id, text FROM einsatz_stichwort_vorschlag \
         WHERE org_id = ? ORDER BY sortier, text",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen Vorschlag an. Duplikat (org_id, text) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    text: &str,
) -> Result<StichwortVorschlag, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(text)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            return Err(AppError::Conflict("Stichwort ist bereits vorhanden".into()));
        }
        Err(e) => return Err(e.into()),
    };

    Ok(StichwortVorschlag {
        id,
        text: text.to_string(),
    })
}

/// Löscht einen Vorschlag der Organisation (idempotent).
pub async fn loeschen(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_stichwort_vorschlag WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org_anlegen(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn anlegen_und_liste_sortiert() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;

        anlegen(&pool, 1, "MANV").await.unwrap();
        anlegen(&pool, 1, "H1").await.unwrap();

        let liste = liste(&pool, 1).await.unwrap();
        // Gleicher sortier (Default 0) → alphabetisch nach text.
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].text, "H1");
        assert_eq!(liste[1].text, "MANV");
    }

    #[tokio::test]
    async fn anlegen_duplikat_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;
        anlegen(&pool, 1, "H1").await.unwrap();

        let err = anlegen(&pool, 1, "H1").await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn loeschen_entfernt_nur_eigene_org() {
        let pool = crate::db::test_pool().await;
        org_anlegen(&pool, 1).await;
        org_anlegen(&pool, 2).await;
        let v = anlegen(&pool, 1, "H1").await.unwrap();

        // Löschversuch aus fremder Org tut nichts.
        loeschen(&pool, 2, v.id).await.unwrap();
        assert_eq!(liste(&pool, 1).await.unwrap().len(), 1);

        // Aus eigener Org löschen.
        loeschen(&pool, 1, v.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Modul registrieren**

In `src/lib.rs`, alphabetisch nach `pub mod live;` (nach Zeile 11) einfügen:

```rust
pub mod stichwort;
```

- [ ] **Step 3: Tests ausführen**

Run: `cargo test --lib stichwort`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stichwort/mod.rs src/lib.rs
git commit -m "feat: stichwort-Modul mit Vorschlags-Repo"
```

---

## Task 9: Stichwort-Routen + Registrierung + Integrationstests

**Files:**
- Create: `src/routes/stichwort.rs`
- Create: `tests/stichwort.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`

- [ ] **Step 1: Routen-Modul anlegen**

Create `src/routes/stichwort.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::stichwort::{self, StichwortVorschlag};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// GET /api/stichwort-vorschlaege — Vorschläge der eigenen Organisation.
/// Für alle eingeloggten Nutzer (Combobox).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<StichwortVorschlag>>, AppError> {
    Ok(Json(stichwort::liste(&state.pool, benutzer.org_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerVorschlag {
    pub text: String,
}

/// POST /api/stichwort-vorschlaege — Vorschlag anlegen. Admin-only.
/// Duplikat je Organisation → Conflict (409).
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(req): Json<NeuerVorschlag>,
) -> Result<(StatusCode, Json<StichwortVorschlag>), AppError> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Stichwort darf nicht leer sein".into()));
    }
    let vorschlag = stichwort::anlegen(&state.pool, benutzer.org_id, text).await?;
    Ok((StatusCode::CREATED, Json(vorschlag)))
}

/// DELETE /api/stichwort-vorschlaege/{id} — Vorschlag löschen. Admin-only.
pub async fn loeschen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    stichwort::loeschen(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Modul + Routen registrieren**

In `src/routes/mod.rs`, alphabetisch (nach `pub mod health;`, Zeile 8) einfügen:

```rust
pub mod stichwort;
```

In `src/app.rs`, nach der ETB-Stream-Zeile (nach Zeile 51) einfügen:

```rust
        .route("/api/stichwort-vorschlaege", get(routes::stichwort::liste))
        .route("/api/stichwort-vorschlaege", post(routes::stichwort::anlegen))
        .route(
            "/api/stichwort-vorschlaege/{id}",
            delete(routes::stichwort::loeschen),
        );
```

> Hinweis: Diese drei `.route(...)`-Aufrufe an die bestehende Router-Builder-Kette anhängen. Das vorhandene Statement endet aktuell mit `routes::etb::stream))` und einem Semikolon — das Semikolon ans Ende der neuen Kette verschieben (also nach dem `delete(...)`-Block), damit die Kette ein einziger Ausdruck bleibt.

- [ ] **Step 3: Integrationstests anlegen**

Create `tests/stichwort.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

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

/// Admin legt einen Nicht-Admin-Benutzer an; gibt dessen id zurück.
async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"keine"}}"#
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
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    json["id"].as_i64().unwrap()
}

async fn post_vorschlag(app: &axum::Router, cookie: &str, text: &str) -> StatusCode {
    let body = format!(r#"{{"text":"{text}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/stichwort-vorschlaege")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

async fn liste_vorschlaege(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stichwort-vorschlaege")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn admin_legt_vorschlag_an_und_alle_sehen_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika").await;

    assert_eq!(post_vorschlag(&app, &admin, "Sonderlage").await, StatusCode::CREATED);

    // Nicht-Admin darf lesen.
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = liste_vorschlaege(&app, &erika).await;
    assert_eq!(status, StatusCode::OK);
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(texte.contains(&"Sonderlage"));
}

#[tokio::test]
async fn nicht_admin_darf_keinen_vorschlag_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(post_vorschlag(&app, &erika, "Verboten").await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn duplikat_vorschlag_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CREATED);
    assert_eq!(post_vorschlag(&app, &admin, "Doppelt").await, StatusCode::CONFLICT);
}

#[tokio::test]
async fn admin_loescht_vorschlag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(post_vorschlag(&app, &admin, "Weg").await, StatusCode::CREATED);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let id = json
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["text"] == "Weg")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/stichwort-vorschlaege/{id}"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let (_, json) = liste_vorschlaege(&app, &admin).await;
    let texte: Vec<&str> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap())
        .collect();
    assert!(!texte.contains(&"Weg"));
}
```

- [ ] **Step 4: Tests ausführen**

Run: `cargo test --test stichwort`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/stichwort.rs src/routes/mod.rs src/app.rs tests/stichwort.rs
git commit -m "feat: Stichwort-Vorschlag-Endpunkte (GET alle, POST/DELETE Admin)"
```

---

## Task 10: Stichwort-Startliste beim Bootstrap seeden

**Files:**
- Modify: `src/auth/bootstrap.rs`

- [ ] **Step 1: Test schreiben (zuerst, schlägt fehl)**

In `src/auth/bootstrap.rs`, `mod tests`, ergänzen:

```rust
    #[tokio::test]
    async fn seedet_stichwort_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12"))
            .await
            .unwrap();

        let texte: Vec<String> = sqlx::query_scalar(
            "SELECT text FROM einsatz_stichwort_vorschlag ORDER BY sortier, text",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert!(texte.contains(&"H1".to_string()));
        assert!(texte.contains(&"MANV".to_string()));
        assert_eq!(texte.len(), 5, "fünf Start-Stichworte erwartet");
    }
```

- [ ] **Step 2: Test ausführen (rot)**

Run: `cargo test --lib auth::bootstrap::tests::seedet_stichwort_startliste_fuer_neue_org`
Expected: FAIL (Tabelle leer).

- [ ] **Step 3: Seed implementieren**

In `src/auth/bootstrap.rs`, vor der Datei-Doku oder oben bei den Konstanten ergänzen:

```rust
/// Start-Stichworte je neu angelegter Organisation (Reihenfolge = sortier).
/// Combobox erlaubt unabhängig davon Freitext.
const STICHWORT_STARTLISTE: [&str; 5] = ["H1", "H1Y", "MANV", "San-Dienst", "Übung"];
```

In `bootstrap_admin`, innerhalb der Transaktion **nach** dem Anlegen des Admin-Benutzers und **vor** `tx.commit().await?` einfügen:

```rust
    for (i, text) in STICHWORT_STARTLISTE.iter().enumerate() {
        sqlx::query(
            "INSERT INTO einsatz_stichwort_vorschlag (org_id, text, sortier) VALUES (?, ?, ?)",
        )
        .bind(org_id)
        .bind(text)
        .bind(i as i64)
        .execute(&mut *tx)
        .await?;
    }
```

- [ ] **Step 4: Test ausführen (grün)**

Run: `cargo test --lib auth::bootstrap`
Expected: PASS (inkl. der bestehenden Bootstrap-Tests).

- [ ] **Step 5: Gesamte Backend-Suite ausführen**

Run: `cargo test`
Expected: PASS (alle Lib- und Integrationstests).

- [ ] **Step 6: Commit**

```bash
git add src/auth/bootstrap.rs
git commit -m "feat: Stichwort-Startliste beim Org-Bootstrap seeden"
```

---

## Task 11: Frontend-Typen erweitern

**Files:**
- Modify: `frontend/src/api/types.ts`

- [ ] **Step 1: `EinsatzAnzeige` erweitern + neue Typen**

In `frontend/src/api/types.ts`, den Block Zeilen 14–35 ersetzen:

```typescript
export type EinsatzStatus = 'aktiv' | 'abgeschlossen';
export type EinsatzRolle = 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter';
export type Einsatzart = 'realeinsatz' | 'uebung' | 'sanitaetsdienst' | 'bereitstellung';

export interface EinsatzAnzeige {
  id: number;
  bezeichnung: string;
  stichwort: string | null;
  status: EinsatzStatus;
  begonnen_at: string;
  abgeschlossen_at: string | null;
  abgeschlossen_von: number | null;
  einsatzart: Einsatzart;
  einsatznummer_intern: string | null;
  /** Read-only technischer Anlage-Zeitpunkt (Audit-Spur). */
  angelegt_at: string;
  leitstellen_nr: string | null;
  einsatzort: string | null;
  einsatzort_lat: number | null;
  einsatzort_lon: number | null;
  meldende_stelle: string | null;
  sachverhalt: string | null;
  anzahl_betroffene_initial: number | null;
  /** Rolle des abfragenden Benutzers; null = kein Mitglied. */
  meine_rolle: EinsatzRolle | null;
}

export interface MitgliedAnzeige {
  benutzer_id: number;
  anzeigename: string;
  benutzername: string;
  einsatz_rolle: EinsatzRolle;
  zugewiesen_at: string;
}

/** Org-weiter Einsatzstichwort-Vorschlag für die Combobox. */
export interface StichwortVorschlag {
  id: number;
  text: string;
}
```

- [ ] **Step 2: TypeScript-Check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: Es können Fehler in Dateien auftreten, die `EinsatzAnzeige` konstruieren (bisher gibt es keine solche Konstruktion außerhalb von Mocks). Falls Fehler in bestehenden Tests/Code → in den jeweiligen Folge-Tasks beheben. Reiner Typ-Zusatz sollte hier fehlerfrei sein.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/types.ts
git commit -m "feat(fe): EinsatzAnzeige-Kopffelder, Einsatzart, StichwortVorschlag"
```

---

## Task 12: Frontend-API-Module

**Files:**
- Modify: `frontend/src/api/einsaetze.ts`
- Create: `frontend/src/api/stichwortVorschlaege.ts`

- [ ] **Step 1: `aktualisiereEinsatz` + `KopfdatenUpdate`**

In `frontend/src/api/einsaetze.ts`, Import-Zeile 1 erweitern:

```typescript
import type { Einsatzart, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige } from './types';
```

Am Dateiende anfügen:

```typescript
/** Editierbare Kopffelder (Vollersatz beim atomaren Speichern). */
export interface KopfdatenUpdate {
  bezeichnung: string;
  stichwort: string | null;
  einsatzart: Einsatzart;
  einsatznummer_intern: string | null;
  leitstellen_nr: string | null;
  einsatzort: string | null;
  einsatzort_lat: number | null;
  einsatzort_lon: number | null;
  meldende_stelle: string | null;
  sachverhalt: string | null;
  anzahl_betroffene_initial: number | null;
  /** Alarmzeit im SQLite-Format 'YYYY-MM-DD HH:mm:ss'. */
  begonnen_at: string;
}

export function aktualisiereEinsatz(id: number, felder: KopfdatenUpdate): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}`, 'PATCH', felder);
}
```

- [ ] **Step 2: Stichwort-API anlegen**

Create `frontend/src/api/stichwortVorschlaege.ts`:

```typescript
import type { StichwortVorschlag } from './types';
import { apiGet, apiSend } from './client';

export function listeStichwortVorschlaege(): Promise<StichwortVorschlag[]> {
  return apiGet<StichwortVorschlag[]>('/api/stichwort-vorschlaege');
}

export function legeStichwortVorschlagAn(text: string): Promise<StichwortVorschlag> {
  return apiSend<StichwortVorschlag>('/api/stichwort-vorschlaege', 'POST', { text });
}

export function loescheStichwortVorschlag(id: number): Promise<void> {
  return apiSend<void>(`/api/stichwort-vorschlaege/${id}`, 'DELETE');
}
```

- [ ] **Step 3: TypeScript-Check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/einsaetze.ts frontend/src/api/stichwortVorschlaege.ts
git commit -m "feat(fe): aktualisiereEinsatz und Stichwort-API"
```

---

## Task 13: EinsatzdatenPage + Registrierung

**Files:**
- Create: `frontend/src/pages/EinsatzdatenPage.tsx`
- Create: `frontend/src/pages/EinsatzdatenPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts`

- [ ] **Step 1: Seite anlegen**

Create `frontend/src/pages/EinsatzdatenPage.tsx`:

```tsx
import {
  Alert, App, AutoComplete, Breadcrumb, Button, DatePicker, Descriptions,
  Form, Input, InputNumber, Select, Space, Spin, Tag, Typography,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { aktualisiereEinsatz, ladeEinsatz, ladeMitglieder, type KopfdatenUpdate } from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Einsatzart } from '../api/types';

const EINSATZART_LABELS: Record<Einsatzart, string> = {
  realeinsatz: 'Realeinsatz',
  uebung: 'Übung',
  sanitaetsdienst: 'Sanitätsdienst',
  bereitstellung: 'Bereitstellung',
};

/** Trimmt einen Formularwert; leer → null (wird serverseitig zu NULL). */
function leerZuNull(wert: string | undefined): string | null {
  const t = wert?.trim();
  return t ? t : null;
}

/** Werte des Bearbeiten-Formulars (begonnen_at als Dayjs aus dem DatePicker). */
interface FormWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  einsatznummer_intern?: string;
  leitstellen_nr?: string;
  einsatzort?: string;
  einsatzort_lat?: number;
  einsatzort_lon?: number;
  meldende_stelle?: string;
  sachverhalt?: string;
  anzahl_betroffene_initial?: number;
  begonnen_at: Dayjs;
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [form] = Form.useForm<FormWerte>();

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: ['mitglieder', einsatzId],
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: ['stichwort-vorschlaege'],
    queryFn: listeStichwortVorschlaege,
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: KopfdatenUpdate) => aktualisiereEinsatz(einsatzId, felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
      setBearbeiten(false);
      message.success('Einsatzdaten gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  const istAdmin = benutzer?.system_rolle === 'admin';
  const darfBearbeiten =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' ||
      einsatz.meine_rolle === 'fuehrungspersonal' ||
      istAdmin);

  const leitung = (mitgliederQuery.data ?? [])
    .filter((m) => m.einsatz_rolle === 'einsatzleitung')
    .map((m) => m.anzeigename)
    .join(', ');

  const stichwortOptionen = (vorschlaegeQuery.data ?? []).map((v) => ({ value: v.text }));

  function bearbeitenStarten() {
    form.setFieldsValue({
      bezeichnung: einsatz.bezeichnung,
      stichwort: einsatz.stichwort ?? undefined,
      einsatzart: einsatz.einsatzart,
      einsatznummer_intern: einsatz.einsatznummer_intern ?? undefined,
      leitstellen_nr: einsatz.leitstellen_nr ?? undefined,
      einsatzort: einsatz.einsatzort ?? undefined,
      einsatzort_lat: einsatz.einsatzort_lat ?? undefined,
      einsatzort_lon: einsatz.einsatzort_lon ?? undefined,
      meldende_stelle: einsatz.meldende_stelle ?? undefined,
      sachverhalt: einsatz.sachverhalt ?? undefined,
      anzahl_betroffene_initial: einsatz.anzahl_betroffene_initial ?? undefined,
      begonnen_at: dayjs(einsatz.begonnen_at),
    });
    setBearbeiten(true);
  }

  function speichern(werte: FormWerte) {
    const felder: KopfdatenUpdate = {
      bezeichnung: werte.bezeichnung.trim(),
      stichwort: leerZuNull(werte.stichwort),
      einsatzart: werte.einsatzart,
      einsatznummer_intern: leerZuNull(werte.einsatznummer_intern),
      leitstellen_nr: leerZuNull(werte.leitstellen_nr),
      einsatzort: leerZuNull(werte.einsatzort),
      einsatzort_lat: werte.einsatzort_lat ?? null,
      einsatzort_lon: werte.einsatzort_lon ?? null,
      meldende_stelle: leerZuNull(werte.meldende_stelle),
      sachverhalt: leerZuNull(werte.sachverhalt),
      anzahl_betroffene_initial: werte.anzahl_betroffene_initial ?? null,
      begonnen_at: werte.begonnen_at.format('YYYY-MM-DD HH:mm:ss'),
    };
    speichernMutation.mutate(felder);
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {einsatz.bezeichnung}
          </Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {!bearbeiten && darfBearbeiten && (
          <Button type="primary" onClick={bearbeitenStarten}>
            Bearbeiten
          </Button>
        )}
      </Space>

      {bearbeiten ? (
        <Form<FormWerte> form={form} layout="vertical" onFinish={speichern}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Einsatzstichwort" name="stichwort">
            <AutoComplete options={stichwortOptionen} allowClear placeholder="z. B. H1, MANV …" />
          </Form.Item>
          <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(EINSATZART_LABELS) as Einsatzart[]).map((k) => ({
                value: k,
                label: EINSATZART_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item label="Einsatznummer (intern)" name="einsatznummer_intern">
            <Input />
          </Form.Item>
          <Form.Item label="Leitstellen-Nr." name="leitstellen_nr">
            <Input />
          </Form.Item>
          <Form.Item label="Alarmzeit" name="begonnen_at" rules={[{ required: true }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Einsatzort (Adresse)" name="einsatzort">
            <Input />
          </Form.Item>
          <Space>
            <Form.Item label="Breitengrad (Lat)" name="einsatzort_lat">
              <InputNumber style={{ width: 180 }} step={0.0001} />
            </Form.Item>
            <Form.Item label="Längengrad (Lon)" name="einsatzort_lon">
              <InputNumber style={{ width: 180 }} step={0.0001} />
            </Form.Item>
          </Space>
          <Form.Item label="Meldende/anfordernde Stelle" name="meldende_stelle">
            <Input />
          </Form.Item>
          <Form.Item label="Sachverhalt / Meldebild" name="sachverhalt">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="Anzahl Betroffene (initial)" name="anzahl_betroffene_initial">
            <InputNumber min={0} style={{ width: 180 }} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={speichernMutation.isPending}>
              Speichern
            </Button>
            <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
          </Space>
        </Form>
      ) : (
        <Descriptions bordered column={1} size="middle">
          <Descriptions.Item label="Einsatzstichwort">{einsatz.stichwort ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Einsatzart">
            {EINSATZART_LABELS[einsatz.einsatzart]}
          </Descriptions.Item>
          <Descriptions.Item label="Einsatznummer (intern)">
            {einsatz.einsatznummer_intern ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Leitstellen-Nr.">
            {einsatz.leitstellen_nr ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Einsatzleitung">{leitung || '—'}</Descriptions.Item>
          <Descriptions.Item label="Alarmzeit">{einsatz.begonnen_at}</Descriptions.Item>
          <Descriptions.Item label="Angelegt am (techn.)">{einsatz.angelegt_at}</Descriptions.Item>
          <Descriptions.Item label="Einsatzort">{einsatz.einsatzort ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Koordinate">
            {einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
              ? `${einsatz.einsatzort_lat}, ${einsatz.einsatzort_lon}`
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Meldende Stelle">
            {einsatz.meldende_stelle ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Sachverhalt / Meldebild">
            {einsatz.sachverhalt ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Anzahl Betroffene (initial)">
            {einsatz.anzahl_betroffene_initial ?? '—'}
          </Descriptions.Item>
        </Descriptions>
      )}
    </div>
  );
}
```

- [ ] **Step 2: In `App.tsx` registrieren**

In `frontend/src/App.tsx`, Import nach Zeile 10 (`import EtbPage ...`) einfügen:

```tsx
import EinsatzdatenPage from './pages/EinsatzdatenPage';
```

`MODUL_ELEMENTE` (Zeilen 17–19) ersetzen:

```tsx
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  einsatzdaten: <EinsatzdatenPage />,
};
```

- [ ] **Step 3: Modul-Status in `modulRegistry.ts`**

In `frontend/src/einsatz/modulRegistry.ts`, den `einsatzdaten`-Eintrag (Zeile 49) von `status: 'geplant'` auf `status: 'fertig'` ändern:

```typescript
  { key: 'einsatzdaten', kategorie: 'fuehrung', label: 'Einsatzdaten', icon: TbFileDescription, route: 'einsatzdaten', status: 'fertig', beschreibung: 'Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung.' },
```

- [ ] **Step 4: Test schreiben**

Create `frontend/src/pages/EinsatzdatenPage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsatzdatenPage from './EinsatzdatenPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const basisEinsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'H1', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: '2026-001', angelegt_at: '2026-05-23 09:00:05',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};

const mitglieder = [
  { benutzer_id: 1, anzeigename: 'Admin', benutzername: 'admin', einsatz_rolle: 'einsatzleitung', zugewiesen_at: '2026-05-23 09:00:00' },
];

const vorschlaege = [{ id: 1, text: 'H1' }, { id: 2, text: 'MANV' }];

interface SetupOpts {
  einsatz?: Partial<typeof basisEinsatz>;
  benutzer?: typeof admin;
}

function setup(opts: SetupOpts = {}) {
  const einsatz = { ...basisEinsatz, ...opts.einsatz };
  const benutzer = opts.benutzer ?? admin;
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json(mitglieder)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json(vorschlaege)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/einsatzdaten" element={<EinsatzdatenPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/einsatzdaten' },
  );
}

describe('EinsatzdatenPage', () => {
  it('zeigt Kopfdaten im Lesemodus, leere Felder als —', async () => {
    setup();
    expect(await screen.findByText('2026-001')).toBeInTheDocument();
    expect(screen.getByText('Realeinsatz')).toBeInTheDocument();
    // Einsatzleitung aus Mitgliedern abgeleitet.
    expect(screen.getByText('Admin')).toBeInTheDocument();
    // leitstellen_nr ist null → mindestens ein „—" sichtbar.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('zeigt den Bearbeiten-Button für schreibberechtigten, aktiven Einsatz', async () => {
    setup();
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button für Beobachter', async () => {
    setup({ einsatz: { meine_rolle: 'beobachter' }, benutzer: { ...admin, system_rolle: 'keiner' } });
    await screen.findByText('2026-001');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('versteckt den Bearbeiten-Button bei abgeschlossenem Einsatz', async () => {
    setup({ einsatz: { status: 'abgeschlossen', abgeschlossen_at: '2026-05-24 10:00:00' } });
    await screen.findByText('2026-001');
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('speichert via PATCH und invalidiert den Einsatz-Cache', async () => {
    let patchBody: Record<string, unknown> | null = null;
    setup();
    server.use(
      http.patch('/api/einsaetze/7', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...basisEinsatz, bezeichnung: 'Geändert' });
      }),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const bezeichnung = await screen.findByLabelText('Bezeichnung');
    await user.clear(bezeichnung);
    await user.type(bezeichnung, 'Geändert');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody?.bezeichnung).toBe('Geändert');
    expect(patchBody?.einsatzart).toBe('realeinsatz');
  });
});
```

- [ ] **Step 5: Frontend-Tests + Typecheck ausführen**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run src/pages/EinsatzdatenPage.test.tsx src/einsatz/modulRegistry.test.ts`
Expected: PASS. (Der Registry-Test prüft `einsatzdaten` nicht und bleibt grün; `redirectZiel` hängt nur an `lage-dashboard`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EinsatzdatenPage.tsx frontend/src/pages/EinsatzdatenPage.test.tsx frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts
git commit -m "feat(fe): EinsatzdatenPage als echtes Modul (Lesemodus + Bearbeiten)"
```

---

## Task 14: StammdatenPage — Abschnitt „Einsatz-Stichworte"

**Files:**
- Modify: `frontend/src/pages/StammdatenPage.tsx`
- Modify: `frontend/src/pages/StammdatenPage.test.tsx`

- [ ] **Step 1: Seite erweitern**

`frontend/src/pages/StammdatenPage.tsx` vollständig ersetzen:

```tsx
import { App, Button, Input, List, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Platzhalter from '../components/Platzhalter';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';

export default function StammdatenPage() {
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] }),
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  function hinzufuegen() {
    const text = neuerText.trim();
    if (text) anlegenMutation.mutate(text);
  }

  const vorschlaege = vorschlaegeQuery.data ?? [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>

      <Typography.Title level={4}>Einsatz-Stichworte</Typography.Title>
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

      <div style={{ marginTop: 32 }}>
        <Platzhalter
          titel="Weitere Stammdaten"
          beschreibung="Personal, Fahrzeuge und Einheiten folgen in späteren Modulen."
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test anpassen**

`frontend/src/pages/StammdatenPage.test.tsx` vollständig ersetzen (Stammdaten braucht jetzt AuthProvider + MSW; Profil-Test bleibt erhalten):

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import StammdatenPage from './StammdatenPage';
import ProfilPage from './ProfilPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

function renderStammdaten(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([{ id: 1, text: 'H1' }])),
  );
  return renderMitProviders(
    <AuthProvider>
      <StammdatenPage />
    </AuthProvider>,
  );
}

describe('StammdatenPage', () => {
  it('zeigt Titel und geladene Stichworte', async () => {
    renderStammdaten(admin);
    expect(screen.getByText('Stammdaten')).toBeInTheDocument();
    expect(await screen.findByText('H1')).toBeInTheDocument();
  });

  it('Admin sieht Hinzufügen und Löschen', async () => {
    renderStammdaten(admin);
    await screen.findByText('H1');
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht weder Hinzufügen noch Löschen', async () => {
    renderStammdaten(nichtAdmin);
    await screen.findByText('H1');
    expect(screen.queryByRole('button', { name: 'Hinzufügen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });
});

describe('ProfilPage', () => {
  it('Profil zeigt Titel und Platzhalter', () => {
    renderMitProviders(<ProfilPage />);
    expect(screen.getByText(/Profil/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Frontend-Tests + Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run src/pages/StammdatenPage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/StammdatenPage.tsx frontend/src/pages/StammdatenPage.test.tsx
git commit -m "feat(fe): Stammdaten-Seite mit Einsatz-Stichwort-Pflege"
```

---

## Task 15: Gesamtlauf + App-Smoke-Test

**Files:**
- (keine neuen) — vollständige Test-Suiten verifizieren.

- [ ] **Step 1: Backend komplett**

Run: `cargo test`
Expected: PASS (alle Lib- + Integrationstests, inkl. `tests/einsatz.rs`, `tests/stichwort.rs`).

- [ ] **Step 2: Frontend komplett**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: PASS. Hinweis: `App.test.tsx` navigiert nur zu `/einsaetze` und `…/etb` und referenziert weder `einsatzdaten` noch `ModulStub` (verifiziert) — die `MODUL_ELEMENTE`-Änderung berührt diesen Test nicht, es ist keine Anpassung nötig. Sollte wider Erwarten ein Test rot werden, prüfe, ob ein neuer ungemockter Request (MSW läuft mit `onUnhandledRequest: 'error'`) die Ursache ist, und ergänze den fehlenden Handler im betroffenen Test.

- [ ] **Step 3: Lint (falls im Projekt üblich)**

Run: `cargo clippy --all-targets -- -D warnings` und `cd frontend && pnpm exec eslint .`
Expected: keine Fehler. Auftretende Warnungen beheben.

- [ ] **Step 4: Abschluss-Commit (falls Anpassungen nötig waren)**

```bash
git add -A
git commit -m "test: Gesamtlauf grün — Einsatzdaten-Modul abgeschlossen"
```

---

## Self-Review (gegen die Spec)

- **Feld-Umfang Kern+Kür:** Migration 0005 + Struct/Anzeige (Task 1, 3) — alle 10 neuen Spalten ✓.
- **Einsatzstichwort als Combobox mit org-weiten Vorschlägen:** `AutoComplete` + `GET /api/stichwort-vorschlaege` (Task 13) ✓.
- **Schreibrecht aktiver Einsatz (Leitung + Führung + Admin), Beobachter lesend, abgeschlossen read-only:** Gate `fordere_schreibrecht_oder_admin` + `fordere_aktiv` (Task 5, 7); FE `darfBearbeiten` (Task 13) ✓.
- **Lesemodus Descriptions + Bearbeiten-Formular, atomares Speichern:** Task 13; Vollersatz-PATCH (Task 6, 7) ✓.
- **Stichwort-Katalog im globalen Stammdaten-Bereich, nur Admin editierbar:** Task 9 (Endpunkte) + Task 14 (UI) ✓.
- **Alarmzeit/Anlage-Trennung (`begonnen_at` editierbar, `angelegt_at` read-only Audit):** Migration-Backfill + explizites `angelegt_at` bei anlegen, PATCH lässt `angelegt_at` unberührt; Test `angelegt_at_bleibt_bei_patch_unveraendert` (Task 7) ✓.
- **Koordinate als zwei Zahlenfelder:** zwei `InputNumber` (Task 13) ✓.
- **Einsatznummer `JJJJ-NNN`, je Org fortlaufend + eindeutig, Dublette → 409:** Auto-Vergabe (Task 4) + Unique-Index (Task 1) + Conflict-Mapping (Task 6) + Tests (Task 4, 7) ✓.
- **Admin-Gate eigenständig, ETB-Semantik unverändert:** neues Gate berührt `fordere_schreibrecht` nicht; Test `admin_ohne_mitgliedschaft_darf_patchen_aber_kein_etb` (Task 7) ✓.
- **Modul-Registrierung + Status fertig + Cache-Invalidierung:** Task 13 (`MODUL_ELEMENTE`, `status: 'fertig'`, `invalidateQueries(['einsatz', id])`/`['einsaetze']`) ✓.
- **Backend-Testliste der Spec:** Berechtigung, abgeschlossen→409, Validierung, leere Optionals→NULL, Auto-Vergabe 001/002, Eindeutigkeit, Stichwort-CRUD-Rechte+Duplikat — alle in Task 4/7/9 abgedeckt ✓.
- **Frontend-Testliste der Spec:** Lesemodus/—, Button-Sichtbarkeit, Combobox, Speichern→PATCH+Invalidate, Stammdaten Admin/Nicht-Admin, Regression Stub→echte Seite — Task 13/14/15 ✓.

**Typ-Konsistenz geprüft:** `KopfDaten` (Rust) ↔ `KopfdatenUpdate` (Handler-Request) ↔ `KopfdatenUpdate` (TS) ↔ PATCH-Body — gleiche Feldnamen/Optionalität. `aktualisiere_kopf`/`aktualisiereEinsatz`, `fordere_schreibrecht_oder_admin`, `ist_gueltige_einsatzart`, `liste/anlegen/loeschen` (stichwort) durchgehend identisch benannt.

**Offene Folge-Specs (bewusst draußen, nicht im Plan):** Sanitätsdienst-Sonderblock, Karten-Picker, strukturierter Stichwort-Katalog mit Sortier-UI.
