# Gefahrenmatrix pro Gefahrengebiet — Implementation Plan (LFH-70)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die einsatzweite Gefahrenmatrix (LFH-53) auf eine 13×5-Matrix je Gefahrengebiet umstellen; ein Gefahrengebiet ist eine Gruppe aus 1..n gezeichneten `gefahrengebiet`-Zonen, „Zusammenlegen" ist Umhängen der Gruppe.

**Architecture:** Neue Tabelle `gefahrengebiet` (Gruppe, trägt die Matrix). `gefahr_bewertung` hängt per `gefahrengebiet_id` daran (statt `einsatz_id`); `lage_zone` verliert den Einzelzeiger `gefahrentyp/schutzobjekt` und bekommt `gefahrengebiet_id`. Gruppen-Lebenszyklus (Auto-Anlage beim Zeichnen, Merge/Split, Cleanup leerer Gruppen) lebt im `lage_zone`-Repo; Matrix-Routen liegen unter `:gid` mit Ownership-Gate.

**Tech Stack:** Rust + axum + sqlx (SQLite), React + TypeScript + antd + @tanstack/react-query + Vitest/MSW.

---

## Wichtige Rahmenbedingungen (vor Phase 1 lesen)

- **Backend ist EINE Compile-Einheit.** Rust kompiliert das ganze Crate inkl. aller `tests/*.rs` vor jedem Testlauf. Ein halb-migrierter Stand ist per Konstruktion rot. Deshalb gibt es in Phase 1 **kein** grünes `cargo test`-Gate zwischen Repo und Routen. Es gibt zwei Checkpoints: (a) `cargo test --lib` sobald `src/` in sich konsistent ist (kompiliert Library + Inline-Unit-Tests, NICHT `tests/`), (b) volles `cargo test` am Phasenende nach Umbau der Integrationstests.
- **Daten faktisch leer** (mit User bestätigt): Migration ist Drop/Rebuild, kein Datenerhalt.
- **Worktree:** Arbeit liegt im Worktree `.claude/worktrees/feat+lfh-70-gefahrenmatrix-pro-gebiet`. Alle Pfade unten sind relativ zur Repo-Wurzel (= Worktree-Wurzel).
- **Frontend ins Binary eingebettet** (Memory `frontend-in-binary-eingebettet`): FE-Änderungen brauchen `pnpm build`; das ist das Phase-2-Gate.
- **Spec:** `docs/superpowers/specs/2026-06-09-gefahrenmatrix-pro-gefahrengebiet-design.md`.

---

# Phase 1 — Backend (Gate: volles `cargo test`)

Reihenfolge: Migration → `gefahr`-Modul → `lage_zone`-Modul → Routen → `app.rs` → Inline-Unit-Tests grün (`cargo test --lib`) → Integrationstests umbauen → volles `cargo test`.

## Task 1: Migration 0041 — Tabelle `gefahrengebiet`, `gefahr_bewertung` neu, `lage_zone` umstellen

**Files:**
- Create: `migrations/0041_gefahrengebiet.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- LFH-70: Gefahrenmatrix pro Gefahrengebiet (geografisch).
-- Ein Gefahrengebiet ist die bewertete Fläche; es besteht aus 1..n gezeichneten
-- gefahrengebiet-Zonen (lage_zone) und trägt GENAU EINE 13×5-Matrix.
-- Ablösung der einsatzweiten Matrix (LFH-53) und des Einzelzeigers
-- lage_zone.gefahrentyp/schutzobjekt. Bestand faktisch leer → Drop/Rebuild.

CREATE TABLE gefahrengebiet (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    label        TEXT,
    erstellt_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gefahrengebiet_einsatz ON gefahrengebiet(einsatz_id);

-- gefahr_bewertung neu aufbauen: Zelle hängt am Gefahrengebiet statt am Einsatz.
-- SQLite kann UNIQUE nicht per ALTER ändern → DROP/CREATE (Bestand leer).
DROP TABLE gefahr_bewertung;
CREATE TABLE gefahr_bewertung (
    id                INTEGER PRIMARY KEY,
    gefahrengebiet_id INTEGER NOT NULL REFERENCES gefahrengebiet(id) ON DELETE CASCADE,
    gefahrentyp       TEXT NOT NULL
                        CHECK (gefahrentyp IN ('atemgifte','angstreaktion','ausbreitung',
                          'atomare_strahlung','chemische_stoffe','erkrankung_verletzung',
                          'explosion','elektrizitaet','einsturz','absturz','brand',
                          'durchbruch','ertrinken')),
    schutzobjekt      TEXT NOT NULL
                        CHECK (schutzobjekt IN ('menschen','tiere','umwelt','sachwerte',
                          'einsatzkraefte')),
    warnstufe         TEXT NOT NULL DEFAULT 'keine'
                        CHECK (warnstufe IN ('keine','niedrig','mittel','hoch','akut')),
    beschreibung      TEXT,
    gemeldet_von      TEXT,
    aktualisiert_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (gefahrengebiet_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_gebiet ON gefahr_bewertung(gefahrengebiet_id);

-- lage_zone: Einzelzeiger raus, Gruppen-Zugehörigkeit rein.
-- gefahrengebiet_id nur bei typ='gefahrengebiet' gesetzt (App-Invariante), sonst NULL.
ALTER TABLE lage_zone DROP COLUMN gefahrentyp;
ALTER TABLE lage_zone DROP COLUMN schutzobjekt;
ALTER TABLE lage_zone ADD COLUMN gefahrengebiet_id INTEGER
    REFERENCES gefahrengebiet(id) ON DELETE SET NULL;
CREATE INDEX idx_lage_zone_gebiet ON lage_zone(gefahrengebiet_id);
```

- [ ] **Step 2: Migration lädt (Compile-Check der SQL via Testpool kommt am Phasenende)**

Kein eigenes Gate hier — die Migration wird beim ersten `cargo test`/`test_pool()` ausgeführt. Nicht committen, bis Task 11 grün ist (Migration + Code zusammen).

---

## Task 2: `gefahr/mod.rs` — DTO umstellen, `GefahrengebietAnzeige` + Rang-Helfer

**Files:**
- Modify: `src/gefahr/mod.rs`

- [ ] **Step 1: `GefahrBewertungAnzeige.einsatz_id` → `gefahrengebiet_id`**

In `src/gefahr/mod.rs` das Feld umbenennen:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GefahrBewertungAnzeige {
    pub id: i64,
    pub gefahrengebiet_id: i64,
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
    pub aktualisiert_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}
```

- [ ] **Step 2: `GefahrengebietAnzeige` + Rang-Helfer ergänzen**

Direkt nach `GefahrBewertungAnzeige` einfügen:

```rust
/// Ein Gefahrengebiet (Gruppe aus 1..n gefahrengebiet-Zonen), trägt eine Matrix.
/// `zonen_ids`: zugehörige lage_zone-IDs. `hoechste_warnstufe`: stärkste gesetzte
/// Zelle der Matrix (Severity-Maximum), `keine` wenn nichts gesetzt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GefahrengebietAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub label: Option<String>,
    pub zonen_ids: Vec<i64>,
    pub hoechste_warnstufe: String,
}

/// Severity-Rang einer Warnstufe (für „höchste Warnstufe je Gebiet"). Lexikalisches
/// MAX wäre falsch (`akut` < `keine`), daher expliziter Rang.
pub fn warnstufe_von_rang(rang: i64) -> &'static str {
    match rang {
        4 => "akut",
        3 => "hoch",
        2 => "mittel",
        1 => "niedrig",
        _ => "keine",
    }
}
```

(Kataloge, `kombination_gueltig`, `*_label` bleiben unverändert.)

---

## Task 3: `gefahr/repo.rs` — Matrix auf `gefahrengebiet_id` + Gruppen-Funktionen

**Files:**
- Modify: `src/gefahr/repo.rs`

- [ ] **Step 1: `Row`, `zu_anzeige`, `SELECT_ALLE`, `liste`, `aktuelle_warnstufe`, `upsert_bewertung`, `laden` auf `gefahrengebiet_id` umstellen; `lazy_create_zelle` entfernen**

Ersetze in `src/gefahr/repo.rs` den Block von `const SELECT_ALLE` bis Ende `laden(...)` durch:

```rust
const SELECT_ALLE: &str = "\
    SELECT id, gefahrengebiet_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, \
           gemeldet_von, aktualisiert_von, erstellt_at, geaendert_at \
    FROM gefahr_bewertung";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    gefahrengebiet_id: i64,
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
        gefahrengebiet_id: r.gefahrengebiet_id,
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

/// Alle gesetzten Zellen eines Gefahrengebiets (ohne `warnstufe='keine'`).
pub async fn liste(pool: &SqlitePool, gefahrengebiet_id: i64) -> Result<Vec<GefahrBewertungAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_ALLE} WHERE gefahrengebiet_id = ? AND warnstufe != 'keine' \
         ORDER BY gefahrentyp, schutzobjekt"
    ))
    .bind(gefahrengebiet_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Aktuelle Warnstufe einer Zelle (für die ETB-Entscheidung *vor* dem Schreiben).
pub async fn aktuelle_warnstufe(
    pool: &SqlitePool,
    gefahrengebiet_id: i64,
    gefahrentyp: &str,
    schutzobjekt: &str,
) -> Result<Option<String>, AppError> {
    let w = sqlx::query_scalar::<_, String>(
        "SELECT warnstufe FROM gefahr_bewertung \
         WHERE gefahrengebiet_id = ? AND gefahrentyp = ? AND schutzobjekt = ?",
    )
    .bind(gefahrengebiet_id)
    .bind(gefahrentyp)
    .bind(schutzobjekt)
    .fetch_optional(pool)
    .await?;
    Ok(w)
}

/// UPSERT einer Bewertung. KEIN Delete-Zweig: `warnstufe='keine'` lässt die Zeile
/// bestehen, `liste()` filtert sie aus.
pub async fn upsert_bewertung(
    pool: &SqlitePool,
    gefahrengebiet_id: i64,
    daten: BewertungDaten<'_>,
) -> Result<GefahrBewertungAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahr_bewertung \
            (gefahrengebiet_id, gefahrentyp, schutzobjekt, warnstufe, beschreibung, gemeldet_von, aktualisiert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT (gefahrengebiet_id, gefahrentyp, schutzobjekt) DO UPDATE SET \
            warnstufe = excluded.warnstufe, \
            beschreibung = excluded.beschreibung, \
            gemeldet_von = excluded.gemeldet_von, \
            aktualisiert_von = excluded.aktualisiert_von, \
            geaendert_at = datetime('now') \
         RETURNING id",
    )
    .bind(gefahrengebiet_id)
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

/// Lädt eine Zelle per id (für die Anzeige nach Upsert).
async fn laden(pool: &SqlitePool, id: i64) -> Result<GefahrBewertungAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}
```

Außerdem oben den Import erweitern:

```rust
use super::{GefahrBewertungAnzeige, GefahrengebietAnzeige};
```

- [ ] **Step 2: Gruppen-Funktionen ergänzen (`gebiet_anlegen`, `gebiete_liste`, `gebiet_laden`, `gebiet_umbenennen`, `gebiet_aufraeumen_wenn_leer`)**

Vor `#[cfg(test)] mod tests` einfügen:

```rust
/// Legt ein leeres Gefahrengebiet an und liefert seine id.
pub async fn gebiet_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    label: Option<&str>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO gefahrengebiet (einsatz_id, label, erstellt_von) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(label)
    .bind(benutzer_id)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Alle Gefahrengebiete eines Einsatzes inkl. zugehöriger Zonen-IDs und höchster
/// Warnstufe (Severity-Maximum; leere Matrix → `keine`).
pub async fn gebiete_liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<GefahrengebietAnzeige>, AppError> {
    let gruppen = sqlx::query_as::<_, (i64, i64, Option<String>)>(
        "SELECT id, einsatz_id, label FROM gefahrengebiet WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    let zonen = sqlx::query_as::<_, (i64, i64)>(
        "SELECT gefahrengebiet_id, id FROM lage_zone \
         WHERE einsatz_id = ? AND gefahrengebiet_id IS NOT NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    let raenge = sqlx::query_as::<_, (i64, i64)>(
        "SELECT b.gefahrengebiet_id, \
                MAX(CASE b.warnstufe WHEN 'akut' THEN 4 WHEN 'hoch' THEN 3 \
                    WHEN 'mittel' THEN 2 WHEN 'niedrig' THEN 1 ELSE 0 END) \
         FROM gefahr_bewertung b JOIN gefahrengebiet g ON g.id = b.gefahrengebiet_id \
         WHERE g.einsatz_id = ? GROUP BY b.gefahrengebiet_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    Ok(gruppen
        .into_iter()
        .map(|(id, einsatz_id, label)| {
            let zonen_ids = zonen.iter().filter(|(gid, _)| *gid == id).map(|(_, zid)| *zid).collect();
            let rang = raenge.iter().find(|(gid, _)| *gid == id).map(|(_, r)| *r).unwrap_or(0);
            GefahrengebietAnzeige {
                id,
                einsatz_id,
                label,
                zonen_ids,
                hoechste_warnstufe: super::warnstufe_von_rang(rang).to_string(),
            }
        })
        .collect())
}

/// Lädt EIN Gefahrengebiet (Ownership-Gate: `NotFound`, falls nicht zum Einsatz).
pub async fn gebiet_laden(pool: &SqlitePool, einsatz_id: i64, gid: i64) -> Result<GefahrengebietAnzeige, AppError> {
    gebiete_liste(pool, einsatz_id)
        .await?
        .into_iter()
        .find(|g| g.id == gid)
        .ok_or(AppError::NotFound)
}

/// Benennt ein Gefahrengebiet um. `NotFound`, falls nicht zum Einsatz.
pub async fn gebiet_umbenennen(
    pool: &SqlitePool,
    einsatz_id: i64,
    gid: i64,
    label: Option<&str>,
) -> Result<GefahrengebietAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE gefahrengebiet SET label = ?, geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(label)
    .bind(gid)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    gebiet_laden(pool, einsatz_id, gid).await
}

/// Löscht ein Gefahrengebiet, falls keine Zone mehr darauf zeigt (idempotent).
/// Die Matrix wird per ON DELETE CASCADE mit entfernt.
pub async fn gebiet_aufraeumen_wenn_leer(pool: &SqlitePool, gid: i64) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM gefahrengebiet WHERE id = ? \
         AND NOT EXISTS (SELECT 1 FROM lage_zone WHERE gefahrengebiet_id = ?)",
    )
    .bind(gid)
    .bind(gid)
    .execute(pool)
    .await?;
    Ok(())
}
```

- [ ] **Step 3: Inline-Unit-Tests umschreiben**

Ersetze den kompletten `#[cfg(test)] mod tests { ... }`-Block durch:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz + EIN Gefahrengebiet; liefert (gefahrengebiet_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'A', 'a', 'x') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let gid = gebiet_anlegen(pool, eid, Some("Nord"), bid).await.unwrap();
        (gid, bid)
    }

    fn daten<'a>(typ: &'a str, objekt: &'a str, warn: &'a str, bid: i64) -> BewertungDaten<'a> {
        BewertungDaten { gefahrentyp: typ, schutzobjekt: objekt, warnstufe: warn, beschreibung: None, gemeldet_von: None, aktualisiert_von: bid }
    }

    #[tokio::test]
    async fn liste_leer_dann_upsert_dann_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        assert!(liste(&pool, gid).await.unwrap().is_empty());

        let z = upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        assert_eq!(z.warnstufe, "hoch");
        assert_eq!(z.gefahrengebiet_id, gid);
        assert_eq!(liste(&pool, gid).await.unwrap().len(), 1);

        let z2 = upsert_bewertung(&pool, gid, daten("brand", "menschen", "akut", bid)).await.unwrap();
        assert_eq!(z2.id, z.id);
        assert_eq!(z2.warnstufe, "akut");
        assert_eq!(liste(&pool, gid).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn warnstufe_keine_ist_kein_phantom() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "keine", bid)).await.unwrap();
        assert!(liste(&pool, gid).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn gebiete_liste_liefert_hoechste_warnstufe() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        // Einsatz-id über das Gebiet ermitteln.
        let eid: i64 = sqlx::query_scalar("SELECT einsatz_id FROM gefahrengebiet WHERE id = ?")
            .bind(gid).fetch_one(&pool).await.unwrap();

        let leer = gebiete_liste(&pool, eid).await.unwrap();
        assert_eq!(leer.len(), 1);
        assert_eq!(leer[0].hoechste_warnstufe, "keine");

        upsert_bewertung(&pool, gid, daten("brand", "menschen", "mittel", bid)).await.unwrap();
        upsert_bewertung(&pool, gid, daten("explosion", "sachwerte", "akut", bid)).await.unwrap();
        let voll = gebiete_liste(&pool, eid).await.unwrap();
        assert_eq!(voll[0].hoechste_warnstufe, "akut", "Severity-Maximum, nicht lexikalisch");
    }

    #[tokio::test]
    async fn aufraeumen_loescht_leeres_gebiet_mit_matrix() {
        let pool = crate::db::test_pool().await;
        let (gid, bid) = setup(&pool).await;
        let eid: i64 = sqlx::query_scalar("SELECT einsatz_id FROM gefahrengebiet WHERE id = ?")
            .bind(gid).fetch_one(&pool).await.unwrap();
        upsert_bewertung(&pool, gid, daten("brand", "menschen", "hoch", bid)).await.unwrap();
        // Keine Zone zeigt auf das Gebiet → aufräumen entfernt es (und die Matrix).
        gebiet_aufraeumen_wenn_leer(&pool, gid).await.unwrap();
        assert!(gebiete_liste(&pool, eid).await.unwrap().is_empty());
        assert!(liste(&pool, gid).await.unwrap().is_empty());
    }
}
```

---

## Task 4: `lage_zone/mod.rs` — Struct umstellen, Validator entfernen

**Files:**
- Modify: `src/lage_zone/mod.rs`

- [ ] **Step 1: `LageZoneAnzeige` umstellen**

`gefahrentyp`/`schutzobjekt` ersetzen durch `gefahrengebiet_id`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LageZoneAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub typ: String,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub gefahrengebiet_id: Option<i64>,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}
```

- [ ] **Step 2: `gefahren_zuordnung_gueltig` entfernen**

Die gesamte Funktion `gefahren_zuordnung_gueltig(...)` löschen (Einzelzeiger-Validierung entfällt). `typ_label` und `geometrie_klasse_passt` bleiben.

---

## Task 5: `lage_zone/repo.rs` — Gruppen-Lebenszyklus (Auto-Anlage, Merge/Split, Cleanup)

**Files:**
- Modify: `src/lage_zone/repo.rs`

- [ ] **Step 1: `ZoneNeu`/`ZonePatch`, `Row`, `zu_anzeige`, `SELECT_ALLE` umstellen**

```rust
#[derive(Debug)]
pub struct ZoneNeu<'a> {
    pub typ: &'a str,
    pub geometrie_typ: &'a str,
    pub geometrie: &'a str,
    pub label: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub notiz: Option<&'a str>,
    pub erstellt_von: i64,
}

/// `None` = unverändert; `Some(None)` = auf NULL/abspalten; `Some(Some(x))` = setzen.
#[derive(Debug, Default)]
pub struct ZonePatch<'a> {
    pub typ: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
    pub gefahrengebiet_id: Option<Option<i64>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           gefahrengebiet_id, erstellt_von, erstellt_at, geaendert_at \
    FROM lage_zone";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    typ: String,
    geometrie_typ: String,
    geometrie: String,
    label: Option<String>,
    farbe: Option<String>,
    notiz: Option<String>,
    gefahrengebiet_id: Option<i64>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> LageZoneAnzeige {
    LageZoneAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        typ: r.typ,
        geometrie_typ: r.geometrie_typ,
        geometrie: r.geometrie,
        label: r.label,
        farbe: r.farbe,
        notiz: r.notiz,
        gefahrengebiet_id: r.gefahrengebiet_id,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}
```

(`liste` und `laden` bleiben unverändert — sie nutzen `SELECT_ALLE`.)

- [ ] **Step 2: `anlegen` — gefahrengebiet-Zonen bekommen automatisch eine Gruppe**

```rust
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, daten: ZoneNeu<'_>) -> Result<LageZoneAnzeige, AppError> {
    // gefahrengebiet-Zonen tragen immer eine Gruppe (Gruppe-von-eins beim Zeichnen).
    let gebiet_id = if daten.typ == "gefahrengebiet" {
        Some(crate::gefahr::repo::gebiet_anlegen(pool, einsatz_id, daten.label, daten.erstellt_von).await?)
    } else {
        None
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, gefahrengebiet_id, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz).bind(gebiet_id).bind(daten.erstellt_von)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}
```

- [ ] **Step 3: `aktualisiere` — Zielgruppe auflösen + Cleanup (neuer Parameter `benutzer_id`)**

```rust
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let vorher = laden(pool, einsatz_id, id).await?;
    let neuer_typ = daten.typ.unwrap_or(&vorher.typ);
    let alt_gebiet = vorher.gefahrengebiet_id;

    // gefahrengebiet-Zonen tragen IMMER eine Gruppe. `Some(None)` heißt NICHT
    // „Spalte auf NULL", sondern „in NEUE eigene Gruppe abspalten".
    let ziel_gebiet: Option<i64> = if neuer_typ != "gefahrengebiet" {
        None
    } else {
        match daten.gefahrengebiet_id {
            Some(Some(zielid)) => Some(zielid),
            Some(None) => Some(
                crate::gefahr::repo::gebiet_anlegen(pool, einsatz_id, vorher.label.as_deref(), benutzer_id).await?,
            ),
            None => match alt_gebiet {
                Some(g) => Some(g),
                None => Some(
                    crate::gefahr::repo::gebiet_anlegen(pool, einsatz_id, vorher.label.as_deref(), benutzer_id).await?,
                ),
            },
        }
    };

    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            gefahrengebiet_id = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some()).bind(daten.typ)
    .bind(daten.label.is_some()).bind(daten.label.flatten())
    .bind(daten.farbe.is_some()).bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some()).bind(daten.notiz.flatten())
    .bind(ziel_gebiet)
    .bind(id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }

    // Verlassene Gruppe aufräumen, falls jetzt leer (Matrix cascaded mit weg).
    if alt_gebiet != ziel_gebiet {
        if let Some(g) = alt_gebiet {
            crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
        }
    }
    laden(pool, einsatz_id, id).await
}
```

- [ ] **Step 4: `loese_auf` — verlassene Gruppe aufräumen**

```rust
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let z = laden(pool, einsatz_id, id).await?;
    sqlx::query("DELETE FROM lage_zone WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id)
        .execute(pool).await?;
    if let Some(g) = z.gefahrengebiet_id {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
    }
    Ok(())
}
```

- [ ] **Step 5: Inline-Unit-Tests anpassen**

Im `#[cfg(test)] mod tests`-Block: alle `ZoneNeu { ... gefahrentyp: None, schutzobjekt: None, ... }` so ändern, dass die beiden Felder entfallen (sie existieren nicht mehr). `aktualisiere(...)`-Aufrufe um den neuen Parameter ergänzen: `aktualisiere(&pool, einsatz, z.id, von, ZonePatch { label: Some(Some("B")), ..Default::default() })`. Ersetze die vier Bestands-Tests durch:

```rust
    #[tokio::test]
    async fn anlegen_gefahrengebiet_legt_gruppe_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("Chemie Halle 3"), farbe: None, notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert!(z.gefahrengebiet_id.is_some(), "gefahrengebiet-Zone muss eine Gruppe tragen");
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn anlegen_nicht_gefahrengebiet_ohne_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "freie_skizze", geometrie_typ: "LineString", geometrie: LINE,
            label: None, farbe: Some("#00ff00"), notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert!(z.gefahrengebiet_id.is_none());
    }

    #[tokio::test]
    async fn patch_label_merged_und_haelt_notiz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("A"), farbe: None, notiz: Some("Notiz bleibt"), erstellt_von: von,
        }).await.unwrap();
        let n = aktualisiere(&pool, einsatz, z.id, von, ZonePatch {
            label: Some(Some("B")), ..Default::default()
        }).await.unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.notiz.as_deref(), Some("Notiz bleibt"));
        assert_eq!(n.gefahrengebiet_id, z.gefahrengebiet_id, "Gruppe bleibt bei reinem Label-PATCH");
    }

    #[tokio::test]
    async fn merge_haengt_um_und_raeumt_leere_quellgruppe_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, ZoneNeu { typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY, label: None, farbe: None, notiz: None, erstellt_von: von }).await.unwrap();
        let b = anlegen(&pool, einsatz, ZoneNeu { typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY, label: None, farbe: None, notiz: None, erstellt_von: von }).await.unwrap();
        let ziel = b.gefahrengebiet_id.unwrap();
        let quelle = a.gefahrengebiet_id.unwrap();

        let a2 = aktualisiere(&pool, einsatz, a.id, von, ZonePatch {
            gefahrengebiet_id: Some(Some(ziel)), ..Default::default()
        }).await.unwrap();
        assert_eq!(a2.gefahrengebiet_id, Some(ziel));
        // Quellgruppe ist leer → aufgeräumt.
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, quelle).await.is_err());
    }

    #[tokio::test]
    async fn loeschen_letzter_zone_entfernt_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu { typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY, label: None, farbe: None, notiz: None, erstellt_von: von }).await.unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid).await.is_err());
    }

    #[tokio::test]
    async fn typ_wechsel_weg_von_gefahrengebiet_loest_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu { typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY, label: None, farbe: None, notiz: None, erstellt_von: von }).await.unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        let n = aktualisiere(&pool, einsatz, z.id, von, ZonePatch { typ: Some("absperrbereich"), ..Default::default() }).await.unwrap();
        assert!(n.gefahrengebiet_id.is_none());
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid).await.is_err());
    }
```

(`loeschen_und_fremder_einsatz_ist_notfound` aus dem Bestand kann bleiben — `ZoneNeu` dort um die entfallenen Felder bereinigen.)

---

## Task 6: `routes/gefahr.rs` — Routen auf `:gid` umstellen

**Files:**
- Modify: `src/routes/gefahr.rs` (komplett ersetzen)

- [ ] **Step 1: Datei neu schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige, GefahrengebietAnzeige};
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: die Gefahrenmatrix eines Gebiets hat sich geändert. Event-Tag `gefahr`.
fn sse_gefahr(state: &AppState, einsatz_id: i64, gefahrengebiet_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "gefahrengebiet_id": gefahrengebiet_id }).to_string();
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

/// GET /api/einsaetze/{id}/gefahrengebiete — alle Gefahrengebiete (Übersicht/Karten-Styling).
pub async fn gebiete(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<GefahrengebietAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(gefahr_repo::gebiete_liste(&state.pool, einsatz_id).await?))
}

/// GET /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix — gesetzte Zellen eines Gebiets.
pub async fn matrix(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
) -> Result<Json<Vec<GefahrBewertungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    // Ownership-Gate: Gebiet muss zum Einsatz gehören (sonst NotFound).
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?;
    Ok(Json(gefahr_repo::liste(&state.pool, gid).await?))
}

#[derive(Debug, Deserialize)]
pub struct BewertungBody {
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
}

/// PUT /api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung — Zelle setzen (UPSERT).
pub async fn bewerten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
    Json(body): Json<BewertungBody>,
) -> Result<Json<GefahrBewertungAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    let gebiet = gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate

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

    let alt = gefahr_repo::aktuelle_warnstufe(&state.pool, gid, &body.gefahrentyp, &body.schutzobjekt)
        .await?
        .unwrap_or_else(|| "keine".to_string());

    let beschreibung = trimme(body.beschreibung.clone());
    let gemeldet_von = trimme(body.gemeldet_von.clone());
    let z = gefahr_repo::upsert_bewertung(&state.pool, gid, BewertungDaten {
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
        let gname = gebiet.label.clone().unwrap_or_else(|| format!("Gefahrengebiet #{gid}"));
        let text = if z.warnstufe == "keine" {
            format!("Gefahr «{g}» für «{o}» in «{gname}» aufgehoben.")
        } else {
            format!("Gefahr «{g}» für «{o}» in «{gname}» auf Warnstufe «{}» gesetzt.", z.warnstufe)
        };
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(z))
}

#[derive(Debug, Deserialize)]
pub struct UmbenennenBody {
    pub label: Option<String>,
}

/// PATCH /api/einsaetze/{id}/gefahrengebiete/{gid} — Label des Gefahrengebiets ändern.
pub async fn umbenennen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, gid)): Path<(i64, i64)>,
    Json(body): Json<UmbenennenBody>,
) -> Result<Json<GefahrengebietAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    gefahr_repo::gebiet_laden(&state.pool, einsatz_id, gid).await?; // Ownership-Gate
    let label = trimme(body.label);
    let g = gefahr_repo::gebiet_umbenennen(&state.pool, einsatz_id, gid, label.as_deref()).await?;
    sse_gefahr(&state, einsatz_id, gid);
    Ok(Json(g))
}
```

(Die alte `/gefahrenmatrix/stream`-Route entfällt — das FE konsumiert `gefahr` ohnehin über `/etb/stream`.)

---

## Task 7: `routes/lage_zone.rs` — Bodies bereinigen, Merge-Auflösung im Handler

**Files:**
- Modify: `src/routes/lage_zone.rs`

- [ ] **Step 1: `ZoneBody` — `gefahrentyp`/`schutzobjekt` entfernen**

```rust
#[derive(Debug, Deserialize)]
pub struct ZoneBody {
    pub typ: String,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
}
```

- [ ] **Step 2: `anlegen` — Gefahren-Zuordnungs-Check + ZoneNeu-Felder entfernen**

Den Block `if !lage_zone::gefahren_zuordnung_gueltig(...) { ... }` löschen und den `ZoneNeu`-Aufbau auf die neuen Felder reduzieren:

```rust
    let z = zone_repo::anlegen(&state.pool, einsatz_id, ZoneNeu {
        typ: &body.typ,
        geometrie_typ: &body.geometrie_typ,
        geometrie: &geometrie,
        label: label.as_deref(),
        farbe: farbe.as_deref(),
        notiz: notiz.as_deref(),
        erstellt_von: benutzer.id,
    }).await?;
```

- [ ] **Step 3: `ZonePatchBody` — Felder umstellen**

```rust
#[derive(Debug, Deserialize)]
pub struct ZonePatchBody {
    pub typ: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub gefahrengebiet_id: Option<Option<i64>>,
}
```

- [ ] **Step 4: `aktualisieren` — Gefahren-Normalisierung ersetzen durch Gruppen-Auflösung**

`neuer_typ`, `neues_label`, `farbe_patch` bleiben wie gehabt. Den gesamten Block ab `// Gefahren-Normalisierung` bis vor `let z = zone_repo::aktualisiere(...)` ersetzen durch:

```rust
    // Gruppen-Zuordnung: nur gefahrengebiet-Zonen; Merge-Ziel muss zum Einsatz gehören.
    let gebiet_patch: Option<Option<i64>> = match &body.gefahrengebiet_id {
        Some(Some(zielid)) => {
            if neuer_typ != "gefahrengebiet" {
                return Err(AppError::UnprocessableEntity(
                    "Gefahrengebiet-Zuordnung nur an gefahrengebiet-Zonen".into(),
                ));
            }
            crate::gefahr::repo::gebiet_laden(&state.pool, einsatz_id, *zielid).await?; // Ownership/NotFound
            Some(Some(*zielid))
        }
        Some(None) => Some(None), // in neue eigene Gruppe abspalten
        None => None,             // unverändert
    };

    let z = zone_repo::aktualisiere(&state.pool, einsatz_id, zid, benutzer.id, ZonePatch {
        typ: body.typ.as_deref(),
        label: body.label.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
        farbe: farbe_patch,
        notiz: body.notiz.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
        gefahrengebiet_id: gebiet_patch,
    }).await?;
```

(Die ETB-Logik „typ oder label geändert" darunter bleibt unverändert.)

---

## Task 8: `app.rs` — Routen registrieren

**Files:**
- Modify: `src/app.rs:157-159`

- [ ] **Step 1: Die drei `gefahrenmatrix`-Zeilen ersetzen**

```rust
        .route("/api/einsaetze/{id}/gefahrengebiete", get(routes::gefahr::gebiete))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}", patch(routes::gefahr::umbenennen))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix", get(routes::gefahr::matrix))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung", put(routes::gefahr::bewerten))
```

(`get`, `patch`, `put` sind in `app.rs` bereits importiert.)

---

## Task 9: Checkpoint — Library kompiliert + Unit-Tests grün

- [ ] **Step 1: Library-Unit-Tests laufen**

Run: `cargo test --lib`
Expected: PASS (alle Inline-Unit-Tests in `gefahr` und `lage_zone` grün). Hier zeigt sich, ob `src/` in sich konsistent ist. Schlägt es fehl, zuerst Compile-Fehler in Tasks 2–8 beheben, bevor es weitergeht.

Noch NICHT committen — die `tests/*.rs` kompilieren erst nach Task 10.

---

## Task 10: Integrationstests umbauen

**Files:**
- Modify: `tests/gefahr.rs` (komplett ersetzen)
- Modify: `tests/lage_zone.rs` (Gefahren-Tests ersetzen)

- [ ] **Step 1: `tests/gefahr.rs` neu schreiben**

Harness (Zeilen 1–79: `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`, `einsatz_anlegen`, `rolle_setzen`, `system_etb_inhalte`, `recv_until_tag`, `bewertung`) **unverändert lassen**. Ergänze oben eine Geometrie-Konstante + einen Gebiets-Helfer und ersetze ALLE `#[tokio::test]`-Funktionen:

```rust
const POLY: &str = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;

/// Zeichnet eine gefahrengebiet-Zone und liefert die automatisch erzeugte Gebiets-id.
async fn gefahrengebiet_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, label: &str) -> i64 {
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":label}).to_string();
    let (status, z) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), cookie, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    z["gefahrengebiet_id"].as_i64().unwrap()
}

#[tokio::test]
async fn matrix_leer_dann_put_dann_upsert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix");

    let (_, leer) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);

    let (status, z) = anfrage(&app, "PUT", &format!("{u}/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    assert_eq!(status, StatusCode::OK, "{z:?}");
    assert_eq!(z["warnstufe"], "hoch");
    assert_eq!(z["gefahrengebiet_id"], gid);

    anfrage(&app, "PUT", &format!("{u}/bewertung"), &admin, Some(&bewertung("brand", "menschen", "akut"))).await;
    let (_, liste2) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(liste2.as_array().unwrap().len(), 1, "UPSERT, keine zweite Zeile");
    assert_eq!(liste2[0]["warnstufe"], "akut");
}

#[tokio::test]
async fn keine_leert_die_zelle() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix");
    anfrage(&app, "PUT", &format!("{u}/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    anfrage(&app, "PUT", &format!("{u}/bewertung"), &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let (_, liste) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn ungueltiger_enum_und_kombination_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung");
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("quatsch", "menschen", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "quatsch", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "quatsch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anfrage(&app, "PUT", &u, &admin, Some(&bewertung("atemgifte", "sachwerte", "hoch"))).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn etb_bei_warnstufenwechsel_nicht_bei_reiner_beschreibung() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung");

    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Gefahr «Brand» für «Menschen» in «Nord» auf Warnstufe «hoch» gesetzt."), "ETB: {etb:?}");
    let basis = etb.len();

    let nur_beschreibung = json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch","beschreibung":"Dachstuhl"}).to_string();
    anfrage(&app, "PUT", &u, &admin, Some(&nur_beschreibung)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "Beschreibung allein darf keinen ETB erzeugen");

    anfrage(&app, "PUT", &u, &admin, Some(&bewertung("brand", "menschen", "keine"))).await;
    let etb2 = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb2.len(), basis + 1);
    assert!(etb2.iter().any(|i| i == "Gefahr «Brand» für «Menschen» in «Nord» aufgehoben."), "ETB: {etb2:?}");
}

#[tokio::test]
async fn sse_feuert_bei_put() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let mut rx = live.abonniere(einsatz);
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "hoch"))).await;
    let n = recv_until_tag(&mut rx, "gefahr", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    assert_eq!(v["gefahrengebiet_id"], gid);
}

#[tokio::test]
async fn gebiete_liste_zeigt_zonen_und_hoechste_warnstufe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"), &admin, Some(&bewertung("brand", "menschen", "mittel"))).await;

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete"), &admin, None).await;
    let arr = liste.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], gid);
    assert_eq!(arr[0]["label"], "Nord");
    assert_eq!(arr[0]["hoechste_warnstufe"], "mittel");
    assert_eq!(arr[0]["zonen_ids"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fremdes_einsatz_gid_ist_notfound() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let gid_a = gefahrengebiet_anlegen(&app, &admin, a, "Nord").await;
    // gid aus Einsatz A über Einsatz B abfragen → NotFound (Ownership-Gate).
    let (status, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{b}/gefahrengebiete/{gid_a}/matrix"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn berechtigung_beobachter_liest_schreibt_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"), &erika_c, Some(&bewertung("brand", "menschen", "hoch"))).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_abgewiesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix"), &fremd, None).await.0;
    assert!(matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "GET: {get}");
}
```

- [ ] **Step 2: `tests/lage_zone.rs` — Gefahren-Tests durch Gruppen-Tests ersetzen**

Die generischen Zonen-Tests (`anlegen_setzt_zone…`, `ungueltiger_typ…`, `patch_typ_oder_label…`, `patch_typ_weg_von_freie_skizze…`, `patch_typ_inkompatibel…`, `delete_schreibt_etb…`, `sse_feuert…`, `org_isolation…`) bleiben unverändert. Die vier Gefahren-Tests am Ende (`gefahrengebiet_mit_zuordnung_macht_lazy_create`, `zuordnung_an_nicht_gefahrengebiet_ist_422`, `nur_eines_der_zuordnungsfelder_ist_422`, `patch_entfernt_zuordnung…`, `patch_setzt_zuordnung…`, `patch_typ_weg_von_gefahrengebiet_nullt_zuordnung`) **löschen** und ersetzen durch:

```rust
#[tokio::test]
async fn anlegen_gefahrengebiet_erzeugt_gruppe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Nord"}).to_string();
    let (status, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert!(z["gefahrengebiet_id"].is_i64(), "gefahrengebiet-Zone bekommt eine Gruppe: {z:?}");
    let (_, gebiete) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete"), &admin, None).await;
    assert_eq!(gebiete.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn merge_haengt_zone_um_und_raeumt_leere_gruppe_auf() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let (_, b) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();

    let patch = json!({"gefahrengebiet_id": ziel}).to_string();
    let (status, a2) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"), &admin, Some(&patch)).await;
    assert_eq!(status, StatusCode::OK, "{a2:?}");
    assert_eq!(a2["gefahrengebiet_id"], ziel);
    // Nur noch EIN Gebiet (Quellgruppe von A aufgeräumt), mit beiden Zonen.
    let (_, gebiete) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete"), &admin, None).await;
    let arr = gebiete.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["zonen_ids"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn merge_zone_adoptiert_ziel_matrix() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let (_, b) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();
    // Ziel-Matrix (B) hat eine Bewertung.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{ziel}/matrix/bewertung"), &admin, Some(&json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"}).to_string())).await;
    // A umhängen → A liest jetzt B's Matrix.
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"), &admin, Some(&json!({"gefahrengebiet_id": ziel}).to_string())).await;
    let (_, matrix) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{ziel}/matrix"), &admin, None).await;
    assert_eq!(matrix.as_array().unwrap().len(), 1);
    assert_eq!(matrix[0]["warnstufe"], "hoch");
}

#[tokio::test]
async fn split_legt_neue_gruppe_an() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let (_, b) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();
    let alt_a = a["gefahrengebiet_id"].as_i64().unwrap();
    // A in B mergen …
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"), &admin, Some(&json!({"gefahrengebiet_id": ziel}).to_string())).await;
    // … dann A wieder abspalten (null → neue Gruppe).
    let (status, a2) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"), &admin, Some(&json!({"gefahrengebiet_id": null}).to_string())).await;
    assert_eq!(status, StatusCode::OK, "{a2:?}");
    let neu = a2["gefahrengebiet_id"].as_i64().unwrap();
    assert_ne!(neu, ziel, "neue eigene Gruppe");
    assert_ne!(neu, alt_a, "und nicht die ursprüngliche (aufgeräumte) Gruppe");
    let (_, gebiete) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete"), &admin, None).await;
    assert_eq!(gebiete.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn delete_letzter_zone_entfernt_gebiet_und_matrix() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let gid = z["gefahrengebiet_id"].as_i64().unwrap();
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"), &admin, Some(&json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"}).to_string())).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, None).await;
    let (_, gebiete) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/gefahrengebiete"), &admin, None).await;
    assert_eq!(gebiete.as_array().unwrap().len(), 0, "Gebiet (und Matrix) mit der letzten Zone weg");
}

#[tokio::test]
async fn merge_ziel_aus_fremdem_einsatz_ist_notfound() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, za) = anfrage(&app, "POST", &format!("/api/einsaetze/{a}/zonen"), &admin, Some(&body)).await;
    let (_, zb) = anfrage(&app, "POST", &format!("/api/einsaetze/{b}/zonen"), &admin, Some(&body)).await;
    let za_id = za["id"].as_i64().unwrap();
    let gid_b = zb["gefahrengebiet_id"].as_i64().unwrap();
    // Zone aus A auf Gruppe aus B umhängen → abgewiesen.
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{a}/zonen/{za_id}"), &admin, Some(&json!({"gefahrengebiet_id": gid_b}).to_string())).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

---

## Task 11: Backend-Gate + Commit

- [ ] **Step 1: Volles Testgate**

Run: `cargo test`
Expected: PASS (Library-Unit-Tests + `tests/gefahr.rs` + `tests/lage_zone.rs` grün).
Hinweis (Memory `rtk-proxy-fuer-ehrliche-exit-codes`): bei maskiertem Exit-Code via `rtk proxy cargo test` prüfen.

- [ ] **Step 2: Clippy/Format (Hauskonvention prüfen)**

Run: `cargo clippy --all-targets -- -D warnings` und `cargo fmt --check`
Expected: keine Warnungen/Diffs.

- [ ] **Step 3: Commit**

```bash
git add migrations/0041_gefahrengebiet.sql src/gefahr/ src/lage_zone/ src/routes/gefahr.rs src/routes/lage_zone.rs src/app.rs tests/gefahr.rs tests/lage_zone.rs
git commit -m "feat(be): Gefahrenmatrix pro Gefahrengebiet (LFH-70)

Neue Tabelle gefahrengebiet (Gruppe aus 1..n gefahrengebiet-Zonen), Matrix
hängt per gefahrengebiet_id daran. Auto-Gruppe beim Zeichnen, Merge/Split via
Zonen-PATCH, Cleanup leerer Gruppen. Ownership-Gate auf den Matrix-Routen.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 2 — Frontend (Gate: Vitest `--no-file-parallelism` + `pnpm build`)

Alle Pfade unter `frontend/`. Reihenfolge: Typen/API → wiederverwendbare `GefahrenMatrix` (+ Test) → GefahrenPage als Gebiete-Übersicht (+ Test) → Karten-Styling → ZonenInspector-Umbau → Matrix-Drawer → Lagekarte-Verdrahtung → Live-Invalidierung.

## Task 12: Typen + API-Clients umstellen

**Files:**
- Modify: `frontend/src/api/types.ts:617-651`
- Modify: `frontend/src/api/gefahren.ts`
- Modify: `frontend/src/api/lagezonen.ts`

- [ ] **Step 1: `types.ts` — `GefahrBewertung`, `Gefahrengebiet`, `LageZone`**

`GefahrBewertung.einsatz_id` → `gefahrengebiet_id`; neues Interface `Gefahrengebiet`; `LageZone` umstellen:

```ts
export interface GefahrBewertung {
  id: number;
  gefahrengebiet_id: number;
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung: string | null;
  gemeldet_von: string | null;
  aktualisiert_von: number;
  erstellt_at: string;
  geaendert_at: string;
}

export interface Gefahrengebiet {
  id: number;
  einsatz_id: number;
  label: string | null;
  zonen_ids: number[];
  hoechste_warnstufe: Warnstufe;
}
```

In `LageZone` die Zeilen `gefahrentyp: ...` und `schutzobjekt: ...` ersetzen durch:

```ts
  gefahrengebiet_id: number | null;
```

- [ ] **Step 2: `api/gefahren.ts` neu schreiben**

```ts
import type { GefahrBewertung, Gefahrengebiet, Gefahrentyp, Schutzobjekt, Warnstufe } from './types';
import { apiGet, apiSend } from './client';

export interface BewertungEingabe {
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung?: string | null;
  gemeldet_von?: string | null;
}

export function ladeGefahrengebiete(einsatzId: number): Promise<Gefahrengebiet[]> {
  return apiGet<Gefahrengebiet[]>(`/api/einsaetze/${einsatzId}/gefahrengebiete`);
}

export function ladeMatrix(einsatzId: number, gefahrengebietId: number): Promise<GefahrBewertung[]> {
  return apiGet<GefahrBewertung[]>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix`);
}

export function setzeBewertung(einsatzId: number, gefahrengebietId: number, daten: BewertungEingabe): Promise<GefahrBewertung> {
  return apiSend<GefahrBewertung>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix/bewertung`, 'PUT', daten);
}

export function benenneGefahrengebiet(einsatzId: number, gefahrengebietId: number, label: string | null): Promise<Gefahrengebiet> {
  return apiSend<Gefahrengebiet>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}`, 'PATCH', { label });
}
```

- [ ] **Step 3: `api/lagezonen.ts` — `ZoneNeu`/`ZonePatch` umstellen**

```ts
import type { LageZone, ZoneTyp } from './types';
import { apiGet, apiSend } from './client';

export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
  /** Merge-Ziel (bestehende Gruppe) oder `null` = in neue eigene Gruppe abspalten. */
  gefahrengebiet_id?: number | null;
}
```

(`listeZonen`, `legeZoneAn`, `aktualisiereZone`, `loescheZone` bleiben.)

---

## Task 13: `GefahrenMatrix.tsx` — wiederverwendbares 13×5-Grid + Test

**Files:**
- Create: `frontend/src/pages/gefahren/GefahrenMatrix.tsx`
- Create: `frontend/src/pages/gefahren/GefahrenMatrix.test.tsx`

- [ ] **Step 1: Failing test schreiben**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import GefahrenMatrix from './GefahrenMatrix';
import type { GefahrBewertung } from '../../api/types';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1, gefahrengebiet_id: 7, gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch',
  beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '', ...over,
});

describe('GefahrenMatrix', () => {
  it('rendert 13 Zeilen × 5 Spalten', () => {
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={() => {}} />);
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Ertrinken')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Einsatzkräfte')[0]).toBeInTheDocument();
  });

  it('setzt eine Warnstufe und ruft onSetzen mit vollem Zell-Zustand', async () => {
    const onSetzen = vi.fn();
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={onSetzen} />);
    const zellen = screen.getAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Hoch'));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch', beschreibung: null, gemeldet_von: null,
    }));
  });

  it('graut ungültige Kombinationen aus', () => {
    renderMitProviders(<GefahrenMatrix matrix={[]} darfSchreiben pending={false} onSetzen={() => {}} />);
    const zellen = screen.getAllByLabelText('Warnstufe atemgifte × sachwerte');
    expect(zellen[0]).toHaveClass('ant-select-disabled');
  });

  it('behält beschreibung/gemeldet_von bei Warnstufen-Wechsel', async () => {
    const onSetzen = vi.fn();
    const matrix = [zelle({ warnstufe: 'hoch', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' })];
    renderMitProviders(<GefahrenMatrix matrix={matrix} darfSchreiben pending={false} onSetzen={onSetzen} />);
    const zellen = screen.getAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Akut'));
    await waitFor(() => expect(onSetzen).toHaveBeenCalledWith({
      gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'akut', beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW',
    }));
  });
});
```

- [ ] **Step 2: Test ausführen, FAIL bestätigen**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenMatrix.test.tsx`
Expected: FAIL (`Cannot find module './GefahrenMatrix'`).

- [ ] **Step 3: `GefahrenMatrix.tsx` implementieren**

Extrahiert aus der bisherigen `GefahrenPage` (DetailPopover + Grid), aber OHNE Zonen-Badge (Zonen hängen jetzt am Gebiet, nicht an der Zelle). Props rein, Callback raus:

```tsx
import { useState } from 'react';
import { Button, Input, Popover, Select, Space, Table, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from '../../api/types';
import type { BewertungEingabe } from '../../api/gefahren';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe } from './gefahrenSchema';

interface ZeilenDaten { typ: Gefahrentyp; label: string; }

function DetailPopover({ zelle, onSpeichern, speichert }: {
  zelle: GefahrBewertung;
  onSpeichern: (beschreibung: string | null, gemeldetVon: string | null) => void;
  speichert: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [beschreibung, setBeschreibung] = useState(zelle.beschreibung ?? '');
  const [gemeldetVon, setGemeldetVon] = useState(zelle.gemeldet_von ?? '');
  const oeffnen = (auf: boolean) => {
    if (auf) { setBeschreibung(zelle.beschreibung ?? ''); setGemeldetVon(zelle.gemeldet_von ?? ''); }
    setOffen(auf);
  };
  const speichern = () => { onSpeichern(beschreibung.trim() || null, gemeldetVon.trim() || null); setOffen(false); };
  return (
    <Popover trigger="click" open={offen} onOpenChange={oeffnen} title="Details" content={
      <Space direction="vertical" style={{ width: 240 }}>
        <Input.TextArea aria-label="Beschreibung" rows={2} placeholder="Beschreibung" value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} />
        <Input aria-label="Gemeldet von" placeholder="Gemeldet von" value={gemeldetVon} onChange={(e) => setGemeldetVon(e.target.value)} />
        <Button type="primary" size="small" loading={speichert} onClick={speichern}>Speichern</Button>
      </Space>
    }>
      <Button aria-label={`Details ${zelle.gefahrentyp} × ${zelle.schutzobjekt}`} size="small" type="text" icon={<EditOutlined />} />
    </Popover>
  );
}

export interface GefahrenMatrixProps {
  matrix: GefahrBewertung[];
  darfSchreiben: boolean;
  pending: boolean;
  onSetzen: (daten: BewertungEingabe) => void;
}

/** Wiederverwendbares 13×5-Raster für EIN Gefahrengebiet (GefahrenPage + Karten-Drawer). */
export default function GefahrenMatrix({ matrix, darfSchreiben, pending, onSetzen }: GefahrenMatrixProps) {
  const zelleVon = (typ: Gefahrentyp, objekt: Schutzobjekt) =>
    matrix.find((m) => m.gefahrentyp === typ && m.schutzobjekt === objekt);
  const warnstufeVon = (typ: Gefahrentyp, objekt: Schutzobjekt): Warnstufe =>
    zelleVon(typ, objekt)?.warnstufe ?? 'keine';

  const spalten: TableColumnsType<ZeilenDaten> = [
    { title: 'Gefahr', dataIndex: 'label', key: 'label', fixed: 'left', width: 180 },
    ...SCHUTZOBJEKTE.map((obj) => ({
      title: obj.label,
      key: obj.wert,
      onCell: (zeile: ZeilenDaten) => ({
        style: { backgroundColor: warnstufeFarbe(warnstufeVon(zeile.typ, obj.wert)), textAlign: 'center' as const },
      }),
      render: (_: unknown, zeile: ZeilenDaten) => {
        const gueltig = kombinationGueltig(zeile.typ, obj.wert);
        const zelle = zelleVon(zeile.typ, obj.wert);
        const aktuell = zelle?.warnstufe ?? 'keine';
        return (
          <Space size={4} align="center">
            <Select<Warnstufe>
              aria-label={`Warnstufe ${zeile.typ} × ${obj.wert}`}
              size="small"
              style={{ width: 110 }}
              value={aktuell}
              disabled={!gueltig || !darfSchreiben || pending}
              options={WARNSTUFEN.map((w) => ({ value: w.wert, label: w.label }))}
              onChange={(w) => onSetzen({
                gefahrentyp: zeile.typ, schutzobjekt: obj.wert, warnstufe: w,
                beschreibung: zelle?.beschreibung ?? null, gemeldet_von: zelle?.gemeldet_von ?? null,
              })}
            />
            {darfSchreiben && aktuell !== 'keine' && zelle && (
              <DetailPopover zelle={zelle} speichert={pending} onSpeichern={(beschreibung, gemeldetVon) => onSetzen({
                gefahrentyp: zeile.typ, schutzobjekt: obj.wert, warnstufe: zelle.warnstufe, beschreibung, gemeldet_von: gemeldetVon,
              })} />
            )}
          </Space>
        );
      },
    })),
  ];
  const zeilen: ZeilenDaten[] = GEFAHRENTYPEN.map((g) => ({ typ: g.wert, label: g.label }));

  return (
    <Table<ZeilenDaten> rowKey="typ" columns={spalten} dataSource={zeilen}
      pagination={false} size="small" scroll={{ x: 'max-content' }} />
  );
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenMatrix.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add frontend/src/api frontend/src/pages/gefahren/GefahrenMatrix.tsx frontend/src/pages/gefahren/GefahrenMatrix.test.tsx && git commit -m "feat(fe): GefahrenMatrix-Komponente + API/Typen auf Gefahrengebiet (LFH-70)"`

---

## Task 14: `GefahrenPage.tsx` — Gebiete-Übersicht + Matrix je Gebiet

**Files:**
- Modify: `frontend/src/pages/gefahren/GefahrenPage.tsx` (komplett ersetzen)
- Modify: `frontend/src/pages/gefahren/GefahrenPage.test.tsx`

- [ ] **Step 1: Test neu schreiben**

```tsx
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
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
const gebiet = { id: 7, einsatz_id: 1, label: 'Nord', zonen_ids: [9], hoechste_warnstufe: 'hoch' };

function handlers(gebiete: unknown[] = [gebiet], matrix: unknown[] = []) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/gefahrengebiete', () => HttpResponse.json(gebiete)),
    http.get('/api/einsaetze/1/gefahrengebiete/7/matrix', () => HttpResponse.json(matrix)),
  ];
}
function renderPage() {
  renderMitProviders(
    <Routes><Route path="/einsaetze/:id/gefahren" element={<GefahrenPage />} /></Routes>,
    { route: '/einsaetze/1/gefahren' },
  );
}

describe('GefahrenPage', () => {
  it('listet Gefahrengebiete und zeigt die Matrix des gewählten', async () => {
    server.use(...handlers());
    renderPage();
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    // Erstes Gebiet automatisch gewählt → Matrix sichtbar.
    expect(screen.getAllByText('Brand')[0]).toBeInTheDocument();
  });

  it('zeigt Leerzustand ohne Gefahrengebiete', async () => {
    server.use(...handlers([]));
    renderPage();
    expect(await screen.findByText(/keine Gefahrengebiete/i)).toBeInTheDocument();
  });

  it('setzt eine Warnstufe (PUT auf das gewählte Gebiet)', async () => {
    let put: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.put('/api/einsaetze/1/gefahrengebiete/7/matrix/bewertung', async ({ request }) => {
        put = (await request.json()) as typeof put;
        return HttpResponse.json({ id: 1, gefahrengebiet_id: 7, ...put, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1, erstellt_at: '', geaendert_at: '' });
      }),
    );
    renderPage();
    const zellen = await screen.findAllByLabelText('Warnstufe brand × menschen');
    const combobox = zellen[0].querySelector('input[role="combobox"]') ?? zellen[0];
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByText('Hoch'));
    await screen.findByText('Nord'); // settle
    expect(put).toMatchObject({ gefahrentyp: 'brand', schutzobjekt: 'menschen', warnstufe: 'hoch' });
  });
});
```

- [ ] **Step 2: Test ausführen, FAIL bestätigen**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: FAIL (alte Page nutzt `/gefahrenmatrix`).

- [ ] **Step 3: `GefahrenPage.tsx` neu schreiben**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { ladeGefahrengebiete, ladeMatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { useEinsatzLiveStream } from '../../etb/useEinsatzLiveStream';
import { warnstufeFarbe } from './gefahrenSchema';
import GefahrenMatrix from './GefahrenMatrix';
import type { Warnstufe } from '../../api/types';

function gebietName(label: string | null, id: number): string {
  return label?.trim() ? label : `Gefahrengebiet #${id}`;
}

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const gebieteQuery = useQuery({ queryKey: ['gefahrengebiete', einsatzId], queryFn: () => ladeGefahrengebiete(einsatzId) });

  const gebiete = gebieteQuery.data ?? [];
  // Auswahl auf das erste Gebiet defaulten / korrigieren, wenn das gewählte verschwindet.
  useEffect(() => {
    if (gebiete.length === 0) { setGewaehlt(null); return; }
    if (gewaehlt == null || !gebiete.some((g) => g.id === gewaehlt)) setGewaehlt(gebiete[0].id);
  }, [gebiete, gewaehlt]);

  const matrixQuery = useQuery({
    queryKey: ['gefahrenmatrix', einsatzId, gewaehlt],
    queryFn: () => ladeMatrix(einsatzId, gewaehlt as number),
    enabled: gewaehlt != null,
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gewaehlt as number, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId, gewaehlt] });
      qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;

  const einsatz = einsatzQuery.data;
  const darfSchreiben = einsatz.status === 'aktiv' && (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  if (gebiete.length === 0) {
    return <Empty description="Noch keine Gefahrengebiete – auf der Lagekarte ein Gefahrengebiet zeichnen." style={{ marginTop: 64 }} />;
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <List
        style={{ width: 240, flexShrink: 0 }}
        size="small"
        bordered
        header={<Typography.Text strong>Gefahrengebiete</Typography.Text>}
        dataSource={gebiete}
        renderItem={(g) => (
          <List.Item
            onClick={() => setGewaehlt(g.id)}
            style={{ cursor: 'pointer', background: g.id === gewaehlt ? 'rgba(22,119,255,0.08)' : undefined }}
          >
            <Space>
              <Tag color={g.hoechste_warnstufe === 'keine' ? undefined : warnstufeFarbe(g.hoechste_warnstufe as Warnstufe)}>
                {g.hoechste_warnstufe}
              </Tag>
              <span>{gebietName(g.label, g.id)}</span>
              <Typography.Text type="secondary">({g.zonen_ids.length})</Typography.Text>
            </Space>
          </List.Item>
        )}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {!darfSchreiben && (
          <Alert type="info" showIcon message="Nur Lesezugriff – Bewertungen können nicht geändert werden." style={{ marginBottom: 12 }} />
        )}
        {matrixQuery.isError ? (
          <Alert type="error" message="Matrix konnte nicht geladen werden" showIcon />
        ) : (
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            darfSchreiben={darfSchreiben}
            pending={setzen.isPending}
            onSetzen={(d) => setzen.mutate(d)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/gefahren/GefahrenPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add frontend/src/pages/gefahren/GefahrenPage.tsx frontend/src/pages/gefahren/GefahrenPage.test.tsx && git commit -m "feat(fe): GefahrenPage als Gebiete-Übersicht (LFH-70)"`

---

## Task 15: Karten-Styling — Zonenfarbe aus höchster Warnstufe des Gebiets

**Files:**
- Modify: `frontend/src/pages/lagekarte/zonenStil.ts`

- [ ] **Step 1: `gefahrengebietStil` ergänzen**

Am Ende von `zonenStil.ts`:

```ts
import type { Warnstufe } from '../../api/types';

/** Stil einer gefahrengebiet-Zone abgeleitet aus der höchsten Warnstufe ihres Gebiets. */
const WARNSTUFE_KARTE: Record<Warnstufe, string> = {
  keine: '#cf1322',
  niedrig: '#faad14',
  mittel: '#fa8c16',
  hoch: '#f5222d',
  akut: '#a8071a',
};

export function gefahrengebietStil(warnstufe: Warnstufe): ZoneStil {
  const c = WARNSTUFE_KARTE[warnstufe];
  return { fillColor: c, fillOpacity: 0.25, lineColor: c, lineWidth: 2 };
}
```

(Der bestehende `import type { ZoneTyp }` oben kann zu `import type { ZoneTyp, Warnstufe } from '../../api/types';` zusammengezogen werden; dann den separaten Import oben löschen.)

---

## Task 16: `ZonenInspector.tsx` — Gruppen-Dropdown + „Matrix bearbeiten"

**Files:**
- Modify: `frontend/src/pages/lagekarte/ZonenInspector.tsx`

- [ ] **Step 1: Props + Gefahren-Block umbauen**

Komplett ersetzen durch (Gefahrentyp/Schutzobjekt-Selects + Entwurf-State entfallen):

```tsx
import { Button, Card, Input, Popconfirm, Select, Space, Typography } from 'antd';
import type { Gefahrengebiet, LageZone, ZoneTyp } from '../../api/types';
import { ZONE_TYPEN, zoneTypLabel } from './zonenStil';

/** Sentinel im Dropdown für „in neues Gefahrengebiet abspalten". */
const NEU = -1;

export interface ZonenInspectorProps {
  zone: LageZone;
  gebiete: Gefahrengebiet[];
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null; gefahrengebiet_id?: number | null }) => void;
  onMatrixOeffnen: (gefahrengebietId: number) => void;
  onLoeschen: () => void;
}

function gebietName(g: Gefahrengebiet): string {
  return g.label?.trim() ? g.label : `Gefahrengebiet #${g.id}`;
}

export default function ZonenInspector({ zone, gebiete, darfSchreiben, onSchliessen, onAendern, onMatrixOeffnen, onLoeschen }: ZonenInspectorProps) {
  const istFreieSkizze = zone.typ === 'freie_skizze';
  const erlaubteTypen = ZONE_TYPEN.filter((t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ);
  const aktuellesGebiet = gebiete.find((g) => g.id === zone.gefahrengebiet_id) ?? null;
  const aktuellHatWarnstufen = (aktuellesGebiet?.hoechste_warnstufe ?? 'keine') !== 'keine';

  const umhaengen = (ziel: number) => onAendern({ gefahrengebiet_id: ziel === NEU ? null : ziel });

  return (
    <Card
      title={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      extra={<Button type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      size="small"
      style={{ position: 'absolute', right: 12, top: 12, width: 280, maxHeight: 'calc(100% - 24px)', overflowY: 'auto', zIndex: 5 }}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp> aria-label="Zonen-Typ" value={zone.typ} style={{ width: '100%' }}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(v) => onAendern({ typ: v })} />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
        )}

        <Input aria-label="Label" placeholder="Bezeichnung" defaultValue={zone.label ?? ''} disabled={!darfSchreiben}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.label ?? '')) onAendern({ label: v || null }); }} />

        {istFreieSkizze && (
          <Input aria-label="Farbe" type="color" defaultValue={zone.farbe ?? '#1677ff'} disabled={!darfSchreiben}
            onBlur={(e) => { const v = e.target.value; if (v !== (zone.farbe ?? '#1677ff')) onAendern({ farbe: v }); }} />
        )}

        {zone.typ === 'gefahrengebiet' && (
          <>
            <Typography.Text type="secondary">Gehört zu Gefahrengebiet</Typography.Text>
            <Select<number>
              aria-label="Gehört zu Gefahrengebiet"
              style={{ width: '100%' }}
              value={zone.gefahrengebiet_id ?? undefined}
              disabled={!darfSchreiben}
              options={[
                ...gebiete.map((g) => ({ value: g.id, label: gebietName(g) })),
                { value: NEU, label: '+ Neues Gefahrengebiet' },
              ]}
              onChange={(v) => umhaengen(v)}
            />
            {zone.gefahrengebiet_id != null && (
              <Button block onClick={() => onMatrixOeffnen(zone.gefahrengebiet_id as number)}>
                Gefahrenmatrix bearbeiten
              </Button>
            )}
          </>
        )}

        <Input.TextArea aria-label="Notiz" placeholder="Notiz" defaultValue={zone.notiz ?? ''} disabled={!darfSchreiben} rows={2}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (zone.notiz ?? '')) onAendern({ notiz: v || null }); }} />

        {darfSchreiben && (
          aktuellHatWarnstufen ? (
            <Popconfirm title="Zone aufheben?" description="Wird das Gefahrengebiet dadurch leer, geht seine Matrix verloren." okText="Aufheben" cancelText="Abbrechen" onConfirm={onLoeschen}>
              <Button danger>Zone aufheben</Button>
            </Popconfirm>
          ) : (
            <Button danger onClick={onLoeschen}>Zone aufheben</Button>
          )
        )}
      </Space>
    </Card>
  );
}
```

(Hinweis: Die Merge-Warnung ist hier als `Popconfirm` beim Löschen umgesetzt; eine zusätzliche Bestätigung beim Umhängen ist optional und kann später ergänzt werden — die Spec verlangt nur, dass die UI warnt.)

---

## Task 17: `GefahrengebietMatrixDrawer.tsx` — Matrix-Panel von der Karte

**Files:**
- Create: `frontend/src/pages/lagekarte/GefahrengebietMatrixDrawer.tsx`

- [ ] **Step 1: Drawer mit eigener Query/Mutation**

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Drawer, Spin } from 'antd';
import { ApiError } from '../../api/client';
import { ladeMatrix, setzeBewertung, type BewertungEingabe } from '../../api/gefahren';
import GefahrenMatrix from '../gefahren/GefahrenMatrix';

export interface GefahrengebietMatrixDrawerProps {
  einsatzId: number;
  gefahrengebietId: number | null;
  darfSchreiben: boolean;
  onClose: () => void;
}

/** Öffnet die 13×5-Matrix EINES Gefahrengebiets kontextuell von der Lagekarte. */
export default function GefahrengebietMatrixDrawer({ einsatzId, gefahrengebietId, darfSchreiben, onClose }: GefahrengebietMatrixDrawerProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const offen = gefahrengebietId != null;

  const matrixQuery = useQuery({
    queryKey: ['gefahrenmatrix', einsatzId, gefahrengebietId],
    queryFn: () => ladeMatrix(einsatzId, gefahrengebietId as number),
    enabled: offen,
  });

  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gefahrengebietId as number, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gefahrenmatrix', einsatzId, gefahrengebietId] });
      qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
    },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  return (
    <Drawer title="Gefahrenmatrix" placement="right" width={560} open={offen} onClose={onClose} destroyOnClose>
      {matrixQuery.isLoading ? (
        <Spin />
      ) : (
        <GefahrenMatrix
          matrix={matrixQuery.data ?? []}
          darfSchreiben={darfSchreiben}
          pending={setzen.isPending}
          onSetzen={(d) => setzen.mutate(d)}
        />
      )}
    </Drawer>
  );
}
```

---

## Task 18: `LagekartePage.tsx` — Gebiete laden, Inspector verdrahten, Styling, Drawer

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`

- [ ] **Step 1: Imports + Gebiete-Query + Drawer-State**

Imports ergänzen:

```tsx
import { ladeGefahrengebiete } from '../api/gefahren';
import { zoneStil, gefahrengebietStil } from './lagekarte/zonenStil';
import GefahrengebietMatrixDrawer from './lagekarte/GefahrengebietMatrixDrawer';
```

(Den bestehenden `import { zoneStil } from './lagekarte/zonenStil';` durch die kombinierte Zeile ersetzen.)

State + Query (bei den anderen `useState`/`useQuery`):

```tsx
  const [matrixGebiet, setMatrixGebiet] = useState<number | null>(null);
  const gebieteQuery = useQuery({ queryKey: ['gefahrengebiete', einsatzId], queryFn: () => ladeGefahrengebiete(einsatzId) });
```

- [ ] **Step 2: Zonen-Styling aus Gebiets-Warnstufe ableiten**

`zonenFeatures` umbauen:

```tsx
  const gebietWarnstufe = useMemo(() => {
    const m = new Map<number, import('../api/types').Warnstufe>();
    (gebieteQuery.data ?? []).forEach((g) => m.set(g.id, g.hoechste_warnstufe));
    return m;
  }, [gebieteQuery.data]);

  const zonenFeatures = useMemo<ZoneFeature[]>(
    () =>
      (layer.zone ? zonenQuery.data ?? [] : []).flatMap((z) => {
        const g = parseGeometry(z.geometrie);
        if (!g) return [];
        const stil =
          z.typ === 'gefahrengebiet' && z.gefahrengebiet_id != null
            ? gefahrengebietStil(gebietWarnstufe.get(z.gefahrengebiet_id) ?? 'keine')
            : zoneStil(z.typ, z.farbe);
        return [{ id: z.id, geometrie: g, label: z.label, stil }];
      }),
    [zonenQuery.data, layer.zone, gebietWarnstufe],
  );
```

- [ ] **Step 3: ZonenInspector mit neuen Props + Drawer rendern**

Den `<ZonenInspector .../>`-Block ersetzen:

```tsx
        {ausgewaehlteZone && (
          <ZonenInspector
            zone={ausgewaehlteZone}
            gebiete={gebieteQuery.data ?? []}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setZoneAuswahl(null)}
            onAendern={(patch) =>
              aktualisiereZone(einsatzId, ausgewaehlteZone.id, patch)
                .then(() => {
                  qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
                  qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
                })
                .catch(fehler)
            }
            onMatrixOeffnen={(gid) => setMatrixGebiet(gid)}
            onLoeschen={() =>
              loescheZone(einsatzId, ausgewaehlteZone.id)
                .then(() => {
                  setZoneAuswahl(null);
                  qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
                  return qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
                })
                .catch(fehler)
            }
          />
        )}
        <GefahrengebietMatrixDrawer
          einsatzId={einsatzId}
          gefahrengebietId={matrixGebiet}
          darfSchreiben={!!darfSchreiben}
          onClose={() => setMatrixGebiet(null)}
        />
```

---

## Task 19: Live-Invalidierung erweitern

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`

- [ ] **Step 1: `onZone` und `onGefahr` erweitern**

```ts
    const onZone = () => { inval('einsatz-zonen'); inval('gefahrengebiete'); };
    const onGefahr = () => { inval('gefahrenmatrix'); inval('gefahrengebiete'); };
```

(`inval('gefahrenmatrix')` trifft als Prefix `['gefahrenmatrix', einsatzId, gid]` für alle Gebiete. Zonen-Änderungen — z. B. Merge — verschieben Gruppen-Mitgliedschaften, daher invalidiert `onZone` zusätzlich `gefahrengebiete`.)

---

## Task 20: Frontend-Gate + Commit

- [ ] **Step 1: Volle Vitest-Suite (stabil)**

Run: `cd frontend && pnpm vitest run --no-file-parallelism`
Expected: PASS (Memory `frontend-testsuite-parallel-timeouts`: nur so ist die volle Suite unter Last stabil).

- [ ] **Step 2: Typecheck + Build**

Run: `cd frontend && pnpm build`
Expected: PASS (tsc + vite-Build; deckt alle Typ-Umstellungen ab). Backend bettet das Bundle ein (Memory `frontend-in-binary-eingebettet`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src
git commit -m "feat(fe): Gefahrenmatrix pro Gefahrengebiet — Karte/Inspector/Drawer/Live (LFH-70)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Abschluss (nach beiden Phasen)

- **`superpowers:verification-before-completion`** vor jeder „fertig"-Aussage (cargo test + vitest + build mit echten Exit-Codes, ggf. `rtk proxy`).
- **`superpowers:requesting-code-review`** → ClickUp-Status `in review`.
- **`superpowers:finishing-a-development-branch`** → Merge (Memory `harness-worktree-merge-statt-exitworktree`: via `git -C <mainroot>`), danach Status `shipped`/`done`.
- Commits/PR referenzieren `LFH-70`.

## Offene Punkte / bewusst ausgeklammert

- Einsatzabschnitt-Verknüpfung (vom User zurückgestellt).
- Aggregat-/Gesamtlage-Ansicht über alle Gebiete (evtl. später).
- Zusätzliche Bestätigung beim Umhängen einer Gruppe mit Warnstufen (UI warnt aktuell beim Löschen; Umhäng-Bestätigung optional nachrüstbar).


