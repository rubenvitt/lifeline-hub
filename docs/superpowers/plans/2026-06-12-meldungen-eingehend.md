# Meldungen (eingehend) zur Bearbeitung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digitaler Meldekopf (Bottom-up-Strang): eingehende Meldungen werden strukturiert über einen Nachrichtenvordruck erfasst, priorisiert, einem Bearbeitungsstatus geführt, optional einem Bearbeiter zugewiesen und — wenn lagerelevant — an die Lage übergeben. Jede erfasste Meldung erscheint automatisch im ETB (Kopplung).

**Architecture:** Spiegelt das Aufträge-Modul (LFH-52) als Template. Backend: eigenes `meldung`-Modul (`mod.rs` + `repo.rs`) + Route-Schicht, ETB-Kopplung (Pattern B: bei `anlegen` entsteht ein `etb_eintrag` typ='meldung' mit beidseitigem Backlink, im selben Commit). Vokabular `MeldeWeg` wird aus dem Kommunikations-Unterbau (`crate::kommunikation`, Single Source = ETB) re-exportiert. Der Triage-Status ist eine **direkte, code-validierte `status`-Spalte** (4-Zustands-Linearfluss neu→gesichtet→in_bearbeitung→erledigt), **nicht** der `kommunikation_status` — dessen zwei unabhängige Achsen (Quittung / Vollzug-3-Zustände) bilden einen linearen 4-Zustands-Workflow nicht ab (insb. „gesichtet" hat dort keinen Slot). Der Unterbau wird trotzdem geehrt: `MeldeWeg`-Vokabular + ETB-Kopplungs-Pattern. Lagerelevanz (LFH-95) erzeugt ein eigenes leichtgewichtiges Lageobjekt (`lage_meldung`, Geo optional) mit Rückverweis und einer eigenen Lese-Oberfläche unter der Lage-Kategorie.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TypeScript (antd, @tanstack/react-query, vitest/RTL), SSE über den geteilten `LiveHub`.

**Datenfluss-Entscheidungen (Review-Notizen, damit nichts gegen den Strich gebürstet wird):**
- **Single Adressat statt 1:n Empfänger:** Eine Meldung hat genau einen Adressaten (Nachrichtenvordruck), kein Fan-out wie ein Auftrag → `empfaenger TEXT` (Freitext, optional), keine `_empfaenger`-Tabelle.
- **ETB-Kopplung bei Erfassung (create-time):** Doktrinär geht jede eingehende Nachricht ins ETB. Mapping: `von`=absender, `an`=empfaenger, `meldeweg`=meldeweg, `inhalt`=inhalt, `ereigniszeit`=ereigniszeit, `typ`='meldung'. Beide Backlinks (`etb_eintrag.meldung_id`, `meldung.etb_meldung_id`) im selben Commit.
- **Dual-Publish bei Erfassung** (wie `routes/auftrag.rs:254-261`): den neuen ETB-Eintrag per `state.live.publiziere(...)` **und** das `meldung`-Event per `sse(...)` schicken — sonst aktualisiert die ETB-Live-Ansicht nicht.
- **`lfd_nr` atomar** via `INSERT … SELECT COALESCE(MAX(lfd_nr),0)+1 … WHERE einsatz_id = ?` (Muster `etb/repo.rs:33-40`), kein SELECT-then-INSERT (Race/BUSY in der DEFERRED-Tx).
- **`auftrag_id`-Spalte** wird angelegt (steht in LFH-94 „Zu tun"), aber Endpoint/UI deferren (kein Akzeptanzkriterium) — die Spalte hält die Kopplung offen.
- **`status` code-validiert, kein DB-CHECK** (wie `auftrag.prioritaet`) — Validierung im Code, damit PATCH/Effektivzustand-Fallen (vgl. Memory PATCH-XOR) gar nicht entstehen.

**Vorbild-Dateien (1:1 Muster):**
- Backend: `migrations/0048_auftrag.sql`, `src/auftrag/mod.rs`, `src/auftrag/repo.rs`, `src/routes/auftrag.rs`, `src/etb/repo.rs` (`anlegen_tx`, `EintragDaten`), `src/kommunikation/mod.rs` (Vokabular-Re-Export).
- Frontend: `frontend/src/api/auftraege.ts`, `frontend/src/auftraege/AuftragFormular.tsx`, `frontend/src/auftraege/AuftragListe.tsx`, `frontend/src/pages/AuftraegePage.tsx`, `frontend/src/pages/AuftraegePage.test.tsx`, `frontend/src/etb/useEinsatzLiveStream.ts`, `frontend/src/einsatz/modulRegistry.ts`, `frontend/src/App.tsx`.

**Gate-Konventionen (aus `routes/auftrag.rs`):** `einsatz_repo::laden` + `rolle_von`; `fordere_lesezugriff` (GET, Beobachter ok), `fordere_schreibrecht` + `fordere_aktiv` (Mutationen); Cross-Einsatz-Schutz via `gehoert_zu_einsatz`.

**Test-Gate (Memory):** Rust-Gates über `rtk proxy cargo test ...` (ehrliche Exit-Codes). Frontend voll über `pnpm test -- --run --no-file-parallelism` (Parallel-Flakiness). Einzelne Vitest-Dateien gezielt mit `pnpm test -- --run <pfad>`.

---

## File Structure

**Backend (neu):**
- `migrations/0049_meldung.sql` — Tabelle `meldung` + `ALTER etb_eintrag ADD meldung_id`.
- `migrations/0050_lage_meldung.sql` — Tabelle `lage_meldung` (LFH-95).
- `src/meldung/mod.rs` — Konstanten (Status, Meldungsart, Prioritaet), Validatoren, `MeldungAnzeige`-Struct.
- `src/meldung/repo.rs` — `anlegen` (+ETB-Kopplung), `laden`, `liste`, `gehoert_zu_einsatz`, `setze_status`, `als_lagerelevant`, `liste_lage_meldungen`.
- `src/routes/meldung.rs` — `liste`, `anlegen`, `status`, `lagerelevant`, `lage_liste`.

**Backend (modifiziert):**
- `src/lib.rs:25` — `pub mod meldung;` (alphabetisch nach `material`).
- `src/routes/mod.rs` — `pub mod meldung;`.
- `src/app.rs` — 5 Routen registrieren (nach dem `auftraege`-Block).

**Frontend (neu):**
- `frontend/src/api/meldungen.ts` — API-Client.
- `frontend/src/meldungen/MeldungFormular.tsx` — Nachrichtenvordruck-Erfassung.
- `frontend/src/meldungen/MeldungListe.tsx` — Posteingang-Liste mit Status/Aktionen.
- `frontend/src/pages/MeldungenPage.tsx` — Orchestrierung (Kommunikation).
- `frontend/src/pages/MeldungenPage.test.tsx` — Tests.
- `frontend/src/pages/LagemeldungenPage.tsx` — Lese-Oberfläche der Lageobjekte (Lage-Kategorie, LFH-95).
- `frontend/src/pages/LagemeldungenPage.test.tsx` — Tests.

**Frontend (modifiziert):**
- `frontend/src/api/types.ts` — `Meldung`, `MeldungStatus`, `Meldungsart`, `MeldungMeldeweg`, `NeueMeldung`, `LageMeldung`.
- `frontend/src/einsatz/modulRegistry.ts:80` — `meldungen` status `geplant`→`fertig`; neuer Eintrag `lagemeldungen` (Kategorie `lage`).
- `frontend/src/App.tsx` — Imports + `MODUL_ELEMENTE['meldungen']`, `MODUL_ELEMENTE['lagemeldungen']`.
- `frontend/src/etb/useEinsatzLiveStream.ts` — `meldung`-Event → `inval('einsatz-meldungen')` + `inval('einsatz-lagemeldungen')`; in `onLag` aufnehmen.

---

## SUBTASK LFH-93 — Eingehende Meldung erfassen (Meldekopf / Nachrichtenvordruck)

> Board: LFH-93 → `in development`. Liefert: Migration, Backend-Modul, Erfassen + Listen + ETB-Kopplung + SSE, Frontend-Erfassungsmaske + Posteingang-Liste (read), Modul-Verdrahtung. Akzeptanz: Mindestfelder (Absender, Inhalt, Meldeweg) erfassbar; Ereigniszeit ≠ Erfassungszeit pflegbar; übernommene Meldung erzeugt ETB-Meldung.

### Task 1: Migration `meldung` + ETB-Backlink

**Files:**
- Create: `migrations/0049_meldung.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- Meldungen (eingehend) (LFH-54): Bottom-up-Strang — digitaler Meldekopf.
-- Nachrichtenvordruck-Felder + linearer Triage-Workflow (neu→gesichtet→in_bearbeitung→erledigt).
-- Status ist code-validiert (kein DB-CHECK), wie auftrag.prioritaet. Single Adressat
-- (empfaenger TEXT), kein 1:n Fan-out. ETB-Kopplung (Pattern B): bei der Erfassung
-- entsteht ein etb_eintrag typ='meldung' mit beidseitigem Backlink (meldung.etb_meldung_id
-- ↔ etb_eintrag.meldung_id).
CREATE TABLE meldung (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Laufende Nr. pro Einsatz (atomar via COALESCE(MAX)+1, wie ETB).
    lfd_nr          INTEGER NOT NULL,
    -- Nachrichtenvordruck:
    absender        TEXT    NOT NULL,                 -- Funkrufname/Stelle (Pflicht)
    empfaenger      TEXT,                             -- Adressat (optional, Freitext)
    -- Meldeweg: 'funk'|'telefon'|'persoenlich'|'sonstige' (Vokabular = ETB/MeldeWeg).
    meldeweg        TEXT    NOT NULL,
    inhalt          TEXT    NOT NULL,                 -- Wortlaut (Pflicht)
    -- Meldungsart: 'lagemeldung'|'sofortmeldung'|'rueckmeldung'|'vollzugsmeldung'|'anfrage'|'sonstige'.
    meldungsart     TEXT    NOT NULL DEFAULT 'sonstige',
    -- 'sofort'|'dringend'|'normal' (code-validiert).
    prioritaet      TEXT    NOT NULL DEFAULT 'normal',
    -- Triage-Status: 'neu'|'gesichtet'|'in_bearbeitung'|'erledigt' (code-validiert).
    status          TEXT    NOT NULL DEFAULT 'neu',
    bearbeiter_id   INTEGER REFERENCES benutzer(id),
    -- Lagerelevanz (LFH-95): Flag; Übergabe erzeugt lage_meldung (0050).
    lagerelevant    INTEGER NOT NULL DEFAULT 0,
    -- Ereigniszeit (wann der Vorgang war) ≠ eingang_at (Erfassungs-/Empfangszeit).
    ereigniszeit    TEXT    NOT NULL,
    eingang_at      TEXT    NOT NULL,
    -- Kopplungen:
    etb_meldung_id  INTEGER REFERENCES etb_eintrag(id),   -- erzeugte ETB-Meldung
    auftrag_id      INTEGER REFERENCES auftrag(id),        -- ausgelöster Auftrag (Spalte offen, UI deferred)
    erfasst_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meldung_einsatz ON meldung(einsatz_id, status);

-- ETB-Kopplung: ETB-Eintrag verweist zurück auf die Quell-Meldung (Vorlage 0048_auftrag.sql;
-- berührt die FTS-Trigger nicht).
ALTER TABLE etb_eintrag ADD COLUMN meldung_id INTEGER REFERENCES meldung(id);
```

- [ ] **Step 2: Migration kompiliert/lädt (Smoke über Test-Pool)**

Wird in Task 3 durch den ersten Repo-Test mitgeprüft (jeder `crate::db::test_pool()` führt alle Migrationen aus). Kein separater Lauf nötig.

- [ ] **Step 3: Commit**

```bash
git add migrations/0049_meldung.sql
git commit -m "feat(meldung): Migration meldung-Tabelle + ETB-Backlink (LFH-93/54)"
```

### Task 2: Modul-Gerüst `meldung/mod.rs` (Konstanten, Validatoren, Anzeige-Struct)

**Files:**
- Create: `src/meldung/mod.rs`
- Modify: `src/lib.rs` (mod-Deklaration)

- [ ] **Step 1: Failing test (Konstanten/Validatoren) in `mod.rs` schreiben**

```rust
//! Meldungen (eingehend) (LFH-54): Bottom-up-Strang des Führungsvorgangs
//! (digitaler Meldekopf). Strukturierte Erfassung (Nachrichtenvordruck),
//! linearer Triage-Status, ETB-Kopplung. Baut auf dem Kommunikations-Unterbau
//! (`MeldeWeg`-Vokabular, LFH-84) und spiegelt das Aufträge-Template (LFH-52).
pub mod repo;

use serde::Serialize;

/// Meldeweg-Vokabular: Single Source of Truth bleibt das ETB-Modul (über den
/// Kommunikations-Unterbau re-exportiert), keine Eigendefinition.
pub use crate::kommunikation::MeldeWeg;

/// Priorität/Dringlichkeit (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Meldungsart (Nachrichtenvordruck-Klassifikation).
pub const ART_LAGEMELDUNG: &str = "lagemeldung";
pub const ART_SOFORTMELDUNG: &str = "sofortmeldung";
pub const ART_RUECKMELDUNG: &str = "rueckmeldung";
pub const ART_VOLLZUGSMELDUNG: &str = "vollzugsmeldung";
pub const ART_ANFRAGE: &str = "anfrage";
pub const ART_SONSTIGE: &str = "sonstige";

/// Triage-Status (linearer Workflow). Bewusst KEIN kommunikation_status:
/// dessen zwei unabhängige Achsen (Quittung / Vollzug-3-Zustände) bilden einen
/// linearen 4-Zustands-Fluss nicht ab — „gesichtet" hat dort keinen Slot.
pub const STATUS_NEU: &str = "neu";
pub const STATUS_GESICHTET: &str = "gesichtet";
pub const STATUS_IN_BEARBEITUNG: &str = "in_bearbeitung";
pub const STATUS_ERLEDIGT: &str = "erledigt";

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn meldungsart_gueltig(a: &str) -> bool {
    matches!(
        a,
        ART_LAGEMELDUNG | ART_SOFORTMELDUNG | ART_RUECKMELDUNG
            | ART_VOLLZUGSMELDUNG | ART_ANFRAGE | ART_SONSTIGE
    )
}

pub fn status_gueltig(s: &str) -> bool {
    matches!(s, STATUS_NEU | STATUS_GESICHTET | STATUS_IN_BEARBEITUNG | STATUS_ERLEDIGT)
}

/// Anzeige einer Meldung inkl. abgeleiteter Felder (Bearbeitername per JOIN,
/// `lage_meldung_id` als Herkunfts-Rückverweis, `ist_offen` für Posteingang-Filter).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MeldungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lfd_nr: i64,
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: String,
    pub inhalt: String,
    pub meldungsart: String,
    pub prioritaet: String,
    pub status: String,
    pub bearbeiter_id: Option<i64>,
    pub bearbeiter_name: Option<String>,
    pub lagerelevant: bool,
    pub ereigniszeit: String,
    pub eingang_at: String,
    pub etb_meldung_id: Option<i64>,
    pub auftrag_id: Option<i64>,
    pub erfasst_von_id: i64,
    pub erstellt_at: String,
    // Abgeleitet: id des erzeugten Lageobjekts (LFH-95), falls übergeben.
    pub lage_meldung_id: Option<i64>,
    // Abgeleitet: status != 'erledigt' (Posteingang = offene Meldungen).
    pub ist_offen: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritaet_validierung() {
        assert!(prioritaet_gueltig(PRIO_SOFORT));
        assert!(!prioritaet_gueltig("blubb"));
    }

    #[test]
    fn meldungsart_validierung() {
        assert!(meldungsart_gueltig(ART_VOLLZUGSMELDUNG));
        assert!(!meldungsart_gueltig("brieftaube"));
    }

    #[test]
    fn status_validierung() {
        assert!(status_gueltig(STATUS_GESICHTET));
        assert!(!status_gueltig("archiviert"));
    }

    #[test]
    fn meldeweg_kommt_aus_kommunikation() {
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }
}
```

> Hinweis: `mod.rs` deklariert `pub mod repo;`. Damit der Crate kompiliert, in Task 3 wird `repo.rs` angelegt. Bis dahin Task 2 + 3 als ein Compile-Schritt behandeln (erst nach Task 3 baut es). Wer strikt test-first arbeitet: lege in Step 1 zusätzlich eine leere `src/meldung/repo.rs` mit `// folgt` an, dann kompiliert das Modulgerüst isoliert.

- [ ] **Step 2: `lib.rs` ergänzen**

In `src/lib.rs` nach `pub mod material;` (Zeile 25) einfügen:

```rust
pub mod meldung;
```

- [ ] **Step 3: leeres `repo.rs` anlegen (Compile-Platzhalter)**

```rust
// src/meldung/repo.rs — Implementierung in Task 3.
```

- [ ] **Step 4: Test (nur mod-Tests) laufen lassen**

Run: `rtk proxy cargo test -p lifeline-hub meldung::tests 2>&1 | tail -20`
Expected: 4 Tests grün (`prioritaet_validierung`, `meldungsart_validierung`, `status_validierung`, `meldeweg_kommt_aus_kommunikation`).

> Falls der Crate-Name nicht `lifeline-hub` ist: `rtk proxy cargo test meldung:: 2>&1 | tail -20`. Crate-Namen vorab via `grep '^name' Cargo.toml` bestätigen.

- [ ] **Step 5: Commit**

```bash
git add src/meldung/mod.rs src/meldung/repo.rs src/lib.rs
git commit -m "feat(meldung): Modulgerüst – Vokabular, Validatoren, MeldungAnzeige (LFH-93/54)"
```

### Task 3: Repo `anlegen` (mit ETB-Kopplung) + `laden`

**Files:**
- Modify: `src/meldung/repo.rs`

- [ ] **Step 1: Failing test schreiben** (`src/meldung/repo.rs`, `#[cfg(test)] mod tests`)

```rust
use crate::error::AppError;
use sqlx::SqlitePool;

use super::{meldungsart_gueltig, prioritaet_gueltig, MeldungAnzeige};

/// Validierte Eingabe für eine neue Meldung (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct MeldungDaten<'a> {
    pub absender: &'a str,
    pub empfaenger: Option<&'a str>,
    pub meldeweg: &'a str,
    pub inhalt: &'a str,
    pub meldungsart: &'a str,
    pub prioritaet: &'a str,
    pub ereigniszeit: &'a str,
    pub eingang_at: &'a str,
}

/// SELECT-Projektion inkl. Bearbeitername (LEFT JOIN benutzer), Herkunfts-Rückverweis
/// (Subquery lage_meldung) und abgeleiteten Feldern. Reihenfolge der Spalten = Struct.
const ANZEIGE_SELECT: &str =
    "SELECT m.id, m.einsatz_id, m.lfd_nr, m.absender, m.empfaenger, m.meldeweg, m.inhalt, \
            m.meldungsart, m.prioritaet, m.status, m.bearbeiter_id, b.anzeigename AS bearbeiter_name, \
            m.lagerelevant, m.ereigniszeit, m.eingang_at, m.etb_meldung_id, m.auftrag_id, \
            m.erfasst_von_id, m.erstellt_at, \
            (SELECT lm.id FROM lage_meldung lm WHERE lm.meldung_id = m.id) AS lage_meldung_id, \
            (m.status != 'erledigt') AS ist_offen \
     FROM meldung m LEFT JOIN benutzer b ON b.id = m.bearbeiter_id";

/// Lädt eine Meldung als Anzeige. `NotFound`, wenn unbekannt.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<MeldungAnzeige, AppError> {
    sqlx::query_as::<_, MeldungAnzeige>(&format!("{ANZEIGE_SELECT} WHERE m.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine Meldung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung',
/// Pattern B mit beidseitigem Backlink). `lfd_nr` atomar (COALESCE(MAX)+1 pro Einsatz).
/// `daten` ist vom Handler validiert (Pflichtfelder, Vokabular, Zeit normalisiert).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: MeldungDaten<'_>,
) -> Result<MeldungAnzeige, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    debug_assert!(meldungsart_gueltig(daten.meldungsart));
    let mut tx = pool.begin().await?;

    // lfd_nr atomar je Einsatz (Muster etb/repo.rs).
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO meldung \
           (einsatz_id, lfd_nr, absender, empfaenger, meldeweg, inhalt, meldungsart, \
            prioritaet, ereigniszeit, eingang_at, erfasst_von_id) \
         SELECT ?, COALESCE(MAX(lfd_nr), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? \
         FROM meldung WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.absender)
    .bind(daten.empfaenger)
    .bind(daten.meldeweg)
    .bind(daten.inhalt)
    .bind(daten.meldungsart)
    .bind(daten.prioritaet)
    .bind(daten.ereigniszeit)
    .bind(daten.eingang_at)
    .bind(erfasser_id)
    .bind(einsatz_id)
    .fetch_one(&mut *tx)
    .await?;

    // ETB-Meldung (Pattern B) im selben Commit. Nachrichtenvordruck-Felder mappen
    // direkt: von=absender, an=empfaenger, meldeweg, inhalt, ereigniszeit.
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        erfasser_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: daten.inhalt,
            von: Some(daten.absender),
            an: daten.empfaenger,
            meldeweg: Some(daten.meldeweg),
            veranlassung: None,
            ereigniszeit: Some(daten.ereigniszeit),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET meldung_id = ? WHERE id = ?")
        .bind(meldung_id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE meldung SET etb_meldung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(meldung_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    laden(pool, meldung_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meldung::{ART_SOFORTMELDUNG, PRIO_NORMAL};

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id").fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    fn daten<'a>(inhalt: &'a str, ereignis: &'a str, eingang: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            absender: "Florian Nord 1",
            empfaenger: Some("ELW 1"),
            meldeweg: "funk",
            inhalt,
            meldungsart: ART_SOFORTMELDUNG,
            prioritaet: PRIO_NORMAL,
            ereigniszeit: ereignis,
            eingang_at: eingang,
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_meldung_mit_default_status_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Deich instabil", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        assert_eq!(m.lfd_nr, 1);
        assert_eq!(m.absender, "Florian Nord 1");
        assert_eq!(m.empfaenger.as_deref(), Some("ELW 1"));
        assert_eq!(m.status, "neu");
        assert!(m.ist_offen);
        assert!(!m.lagerelevant);
        assert_eq!(m.ereigniszeit, "2026-06-12 09:00:00");
        assert_eq!(m.eingang_at, "2026-06-12 09:05:00");
        assert!(m.etb_meldung_id.is_some(), "ETB-Meldung wird erzeugt");
        assert!(m.lage_meldung_id.is_none());
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_meldung_mit_backlink_und_feldmapping() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let etb_id = m.etb_meldung_id.unwrap();
        let (typ, von, an, weg, backlink): (String, Option<String>, Option<String>, Option<String>, i64) =
            sqlx::query_as("SELECT typ, von, an, meldeweg, meldung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(von.as_deref(), Some("Florian Nord 1"));
        assert_eq!(an.as_deref(), Some("ELW 1"));
        assert_eq!(weg.as_deref(), Some("funk"));
        assert_eq!(backlink, m.id);
    }

    #[tokio::test]
    async fn lfd_nr_zaehlt_pro_einsatz_hoch() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m1 = anlegen(&pool, e, b, daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let m2 = anlegen(&pool, e, b, daten("B", "2026-06-12 09:01:00", "2026-06-12 09:01:00")).await.unwrap();
        assert_eq!(m1.lfd_nr, 1);
        assert_eq!(m2.lfd_nr, 2);
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(laden(&pool, 999).await.unwrap_err(), AppError::NotFound));
    }
}
```

> `ANZEIGE_SELECT` referenziert `lage_meldung` (Tabelle aus 0050, erst in LFH-95). Damit LFH-93 isoliert grün ist, wird `migrations/0050_lage_meldung.sql` als **Teil von Task 1** mit angelegt ODER die Subquery in LFH-93 vorerst durch `NULL AS lage_meldung_id` ersetzt und in LFH-95 auf die echte Subquery umgestellt. **Entscheidung:** 0050 in Task 1 mitanlegen (siehe Anhang A), damit der `ANZEIGE_SELECT` von Anfang an final ist und LFH-93 grün bleibt. Die `lagerelevant`-Route kommt erst in LFH-95.

- [ ] **Step 2: Run test → FAIL** (Tabelle/Funktionen vorhanden, aber `lage_meldung` fehlt falls 0050 nicht angelegt)

Run: `rtk proxy cargo test meldung::repo::tests 2>&1 | tail -30`
Expected zunächst FAIL bei `anlegen_*` (kompiliert noch nicht / Tabelle fehlt). Nach Anlegen von 0050 + Implementierung: PASS.

- [ ] **Step 3: Implementierung steht bereits im Step-1-Block** (anlegen/laden). Sicherstellen, dass 0050 (Anhang A) existiert.

- [ ] **Step 4: Run test → PASS**

Run: `rtk proxy cargo test meldung::repo::tests 2>&1 | tail -30`
Expected: 4 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/meldung/repo.rs migrations/0050_lage_meldung.sql
git commit -m "feat(meldung): anlegen mit ETB-Kopplung + atomare lfd_nr, laden (LFH-93/54)"
```

### Task 4: Repo `liste` + `gehoert_zu_einsatz`

**Files:**
- Modify: `src/meldung/repo.rs`

- [ ] **Step 1: Failing test + Implementierung**

Implementierung (an `repo.rs` anhängen, vor `mod tests`):

```rust
/// Listet Meldungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), dann neueste Ereigniszeit zuerst, dann lfd_nr.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
) -> Result<Vec<MeldungAnzeige>, AppError> {
    let mut q = format!("{ANZEIGE_SELECT} WHERE m.einsatz_id = ?");
    if status_filter.is_some() {
        q.push_str(" AND m.status = ?");
    }
    q.push_str(
        " ORDER BY CASE m.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          m.ereigniszeit DESC, m.lfd_nr DESC",
    );
    let mut query = sqlx::query_as::<_, MeldungAnzeige>(&q).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Cross-Einsatz-Schutz: gehört die Meldung zum Einsatz?
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM meldung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}
```

Tests (in `mod tests` ergänzen):

```rust
    #[tokio::test]
    async fn liste_liefert_meldungen_sortiert_nach_prio() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let mut d = daten("normal", "2026-06-12 09:00:00", "2026-06-12 09:00:00");
        anlegen(&pool, e, b, d).await.unwrap();
        d = daten("sofort", "2026-06-12 08:00:00", "2026-06-12 08:00:00");
        let sofort = MeldungDaten { prioritaet: crate::meldung::PRIO_SOFORT, ..d };
        anlegen(&pool, e, b, sofort).await.unwrap();
        let liste = liste(&pool, e, None).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt, "sofort", "sofort vor normal trotz älterer Ereigniszeit");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let liste_neu = liste(&pool, e, Some("neu")).await.unwrap();
        assert_eq!(liste_neu.len(), 1);
        let liste_erledigt = liste(&pool, e, Some("erledigt")).await.unwrap();
        assert!(liste_erledigt.is_empty());
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, m.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }
```

- [ ] **Step 2: Run → PASS**

Run: `rtk proxy cargo test meldung::repo::tests 2>&1 | tail -30`
Expected: alle grün (7 Tests).

- [ ] **Step 3: Commit**

```bash
git add src/meldung/repo.rs
git commit -m "feat(meldung): liste (Prio-Sortierung + Status-Filter) + Cross-Einsatz-Schutz (LFH-93/54)"
```

### Task 5: Route-Schicht `routes/meldung.rs` — `liste` + `anlegen` (Dual-Publish)

**Files:**
- Create: `src/routes/meldung.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`

- [ ] **Step 1: `routes/meldung.rs` schreiben** (liste + anlegen)

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::meldung::{repo, MeldungAnzeige, ART_SONSTIGE, PRIO_NORMAL};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Meldungen des Einsatzes haben sich geändert (Tag `meldung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "meldung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/meldungen — Posteingang listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MeldungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let status = params.status.as_deref().filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::meldung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, status).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueMeldung {
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: String,
    pub inhalt: String,
    pub meldungsart: Option<String>,
    pub prioritaet: Option<String>,
    /// Ereigniszeit (UTC, ISO-8601 oder SQLite-Format). Pflicht (Funk-Realität: ≠ Erfassung).
    pub ereigniszeit: String,
}

/// POST /api/einsaetze/{id}/meldungen — Meldung erfassen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueMeldung>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Mindestfelder: Absender, Inhalt, Meldeweg.
    let absender = req.absender.trim();
    let inhalt = req.inhalt.trim();
    if absender.is_empty() {
        return Err(AppError::Validation("Absender darf nicht leer sein".into()));
    }
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    if crate::meldung::MeldeWeg::parse(req.meldeweg.trim()).is_none() {
        return Err(AppError::Validation("Ungültiger Meldeweg".into()));
    }
    let meldungsart = req.meldungsart.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(ART_SONSTIGE);
    if !crate::meldung::meldungsart_gueltig(meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    let prioritaet = req.prioritaet.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(PRIO_NORMAL);
    if !crate::meldung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    // Ereigniszeit normalisieren (ISO-8601/SQLite → SQLite-Format), wie ETB.
    let ereigniszeit = crate::etb::normalisiere_zeit(req.ereigniszeit.trim())?;
    let eingang = jetzt();

    let m = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::MeldungDaten {
            absender,
            empfaenger: trimme(&req.empfaenger),
            meldeweg: req.meldeweg.trim(),
            inhalt,
            meldungsart,
            prioritaet,
            ereigniszeit: &ereigniszeit,
            eingang_at: &eingang,
        },
    )
    .await?;

    // Dual-Publish (wie Auftrag): erzeugte ETB-Meldung in den Live-Feed + meldung-Event.
    if let Some(etb_id) = m.etb_meldung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(m)))
}
```

> **Verifikationspflicht vor Implementierung:** Signaturen von `fordere_lesezugriff/_schreibrecht/_aktiv`, `einsatz_repo::laden/rolle_von`, `state.live.publiziere/publiziere_event`, `CurrentUser`, `AppError::Validation`, `crate::etb::normalisiere_zeit` exakt gegen `src/routes/auftrag.rs` + `src/etb/mod.rs` gegenprüfen (1:1 dort verwendet). `MeldeWeg::parse` existiert in `src/etb/mod.rs`.

- [ ] **Step 2: `routes/mod.rs` ergänzen**

`pub mod meldung;` einfügen (alphabetisch nach `material`/vor `organisation`).

- [ ] **Step 3: `app.rs` Routen registrieren** — nach dem `auftraege/{aid}/abnehmen`-Eintrag:

```rust
        .route("/api/einsaetze/{id}/meldungen", get(routes::meldung::liste))
        .route("/api/einsaetze/{id}/meldungen", post(routes::meldung::anlegen))
```

- [ ] **Step 4: Build + Modul-Tests grün**

Run: `rtk proxy cargo test meldung 2>&1 | tail -30`
Expected: kompiliert, alle `meldung`-Tests grün. Kein neuer Route-Unit-Test hier (Route ist dünn; Logik in repo + Validierung deckt der Frontend-Integrationstest mit).

- [ ] **Step 5: Commit**

```bash
git add src/routes/meldung.rs src/routes/mod.rs src/app.rs
git commit -m "feat(meldung): Routen liste + anlegen (Dual-Publish, Gates, Validierung) (LFH-93/54)"
```

### Task 6: Frontend API-Client + Typen

**Files:**
- Create: `frontend/src/api/meldungen.ts`
- Modify: `frontend/src/api/types.ts`

- [ ] **Step 1: Typen in `types.ts` ergänzen** (am Ende, nach dem Auftrag-Block)

```typescript
export type MeldungPrioritaet = 'sofort' | 'dringend' | 'normal';
export type MeldungStatus = 'neu' | 'gesichtet' | 'in_bearbeitung' | 'erledigt';
export type Meldungsart =
  | 'lagemeldung' | 'sofortmeldung' | 'rueckmeldung' | 'vollzugsmeldung' | 'anfrage' | 'sonstige';
export type MeldungMeldeweg = 'funk' | 'telefon' | 'persoenlich' | 'sonstige';

export interface Meldung {
  id: number;
  einsatz_id: number;
  lfd_nr: number;
  absender: string;
  empfaenger: string | null;
  meldeweg: MeldungMeldeweg;
  inhalt: string;
  meldungsart: Meldungsart;
  prioritaet: MeldungPrioritaet;
  status: MeldungStatus;
  bearbeiter_id: number | null;
  bearbeiter_name: string | null;
  lagerelevant: boolean;
  ereigniszeit: string;
  eingang_at: string;
  etb_meldung_id: number | null;
  auftrag_id: number | null;
  erfasst_von_id: number;
  erstellt_at: string;
  /** id des erzeugten Lageobjekts (LFH-95), falls an die Lage übergeben. */
  lage_meldung_id: number | null;
  /** Abgeleitet: status !== 'erledigt'. */
  ist_offen: boolean;
}

export interface NeueMeldung {
  absender: string;
  empfaenger?: string;
  meldeweg: MeldungMeldeweg;
  inhalt: string;
  meldungsart?: Meldungsart;
  prioritaet?: MeldungPrioritaet;
  /** Ereigniszeit (UTC) 'YYYY-MM-DD HH:mm:ss'. Pflicht (≠ Erfassungszeit). */
  ereigniszeit: string;
}

/** Lageobjekt aus lagerelevanter Meldung (LFH-95). */
export interface LageMeldung {
  id: number;
  einsatz_id: number;
  meldung_id: number;
  text: string;
  lat: number | null;
  lon: number | null;
  erstellt_von_id: number;
  erstellt_at: string;
  /** Herkunft (aus JOIN meldung): zur Nachvollziehbarkeit am Lageobjekt. */
  meldung_lfd_nr: number;
  meldung_absender: string;
}
```

- [ ] **Step 2: `meldungen.ts` schreiben**

```typescript
import { apiGet, apiSend } from './client';
import type { LageMeldung, Meldung, MeldungStatus, NeueMeldung } from './types';

export interface MeldungFilter {
  status?: string;
}

export function listeMeldungen(einsatzId: number, filter: MeldungFilter = {}): Promise<Meldung[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Meldung[]>(`/api/einsaetze/${einsatzId}/meldungen${q}`);
}

export function legeMeldungAn(einsatzId: number, daten: NeueMeldung): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen`, 'POST', daten);
}

/** Status setzen (sichten/in Bearbeitung/erledigt) + optional Bearbeiter zuweisen (LFH-94). */
export function setzeMeldungStatus(
  einsatzId: number,
  meldungId: number,
  status: MeldungStatus,
  bearbeiterId?: number | null,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/status`, 'POST', {
    status,
    bearbeiter_id: bearbeiterId ?? null,
  });
}

/** Als lagerelevant an die Lage übergeben (LFH-95). */
export function markiereLagerelevant(
  einsatzId: number,
  meldungId: number,
  text?: string,
): Promise<Meldung> {
  return apiSend<Meldung>(`/api/einsaetze/${einsatzId}/meldungen/${meldungId}/lagerelevant`, 'POST', { text });
}

/** Lageobjekte (aus lagerelevanten Meldungen) listen (LFH-95, Lage-Kategorie). */
export function listeLageMeldungen(einsatzId: number): Promise<LageMeldung[]> {
  return apiGet<LageMeldung[]>(`/api/einsaetze/${einsatzId}/lage/meldungen`);
}
```

> Funktionen `setzeMeldungStatus`/`markiereLagerelevant`/`listeLageMeldungen` werden in LFH-94/95 vom Backend bedient; die Client-Stubs hier sind nur Typ-Anker und werden bis dahin nicht aufgerufen. Verifikation: `apiGet`/`apiSend`-Signaturen gegen `frontend/src/api/auftraege.ts` (dort identisch genutzt).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit 2>&1 | tail -20`
Expected: keine Fehler.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/meldungen.ts frontend/src/api/types.ts
git commit -m "feat(meldung): Frontend API-Client + Typen (LFH-93/54)"
```

### Task 7: Frontend Erfassungsmaske `MeldungFormular.tsx`

**Files:**
- Create: `frontend/src/meldungen/MeldungFormular.tsx`

Mirror `auftraege/AuftragFormular.tsx`. Felder: Absender (Pflicht, `aria-label="Absender"`), Empfänger (optional), Meldeweg (Select: Funk/Telefon/Persönlich/Sonstige), Meldungsart (Select), Priorität (Select), Ereigniszeit (`DatePicker showTime`, Pflicht — Default `dayjs()` falls leer beim Absenden auf jetzt), Inhalt/Wortlaut (`TextArea`, Pflicht, `aria-label="Inhalt / Wortlaut"`).

- [ ] **Step 1: Komponente schreiben**

```tsx
import { App, Button, Card, DatePicker, Form, Input, Select } from 'antd';
import { useState } from 'react';
import dayjs from 'dayjs';
import type { Meldungsart, MeldungMeldeweg, MeldungPrioritaet, NeueMeldung } from '../api/types';

const { TextArea } = Input;

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

export default function MeldungFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeueMeldung) => void;
}) {
  const { message } = App.useApp();
  const [absender, setAbsender] = useState('');
  const [empfaenger, setEmpfaenger] = useState('');
  const [meldeweg, setMeldeweg] = useState<MeldungMeldeweg>('funk');
  const [meldungsart, setMeldungsart] = useState<Meldungsart>('sonstige');
  const [prioritaet, setPrioritaet] = useState<MeldungPrioritaet>('normal');
  const [ereigniszeit, setEreigniszeit] = useState<dayjs.Dayjs | null>(null);
  const [inhalt, setInhalt] = useState('');

  const absenden = () => {
    if (!absender.trim()) { message.error('Absender ist erforderlich'); return; }
    if (!inhalt.trim()) { message.error('Inhalt ist erforderlich'); return; }
    onAnlegen({
      absender: absender.trim(),
      empfaenger: empfaenger.trim() || undefined,
      meldeweg,
      inhalt: inhalt.trim(),
      meldungsart,
      prioritaet,
      // Ereigniszeit Pflicht: leer ⇒ jetzt (Funk-Realität: meist „eben empfangen").
      ereigniszeit: dayjsZuWire(ereigniszeit ?? dayjs()),
    });
    setAbsender(''); setEmpfaenger(''); setMeldeweg('funk'); setMeldungsart('sonstige');
    setPrioritaet('normal'); setEreigniszeit(null); setInhalt('');
  };

  return (
    <Card size="small" title="Neue Meldung erfassen">
      <Form layout="vertical" onFinish={absenden}>
        <Form.Item label="Absender (Funkrufname/Stelle)" required>
          <Input aria-label="Absender" value={absender} onChange={(e) => setAbsender(e.target.value)} />
        </Form.Item>
        <Form.Item label="Empfänger / Adressat">
          <Input value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} placeholder="z. B. ELW 1, S3" />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Meldeweg" style={{ flex: 1 }}>
            <Select<MeldungMeldeweg> value={meldeweg} onChange={setMeldeweg} options={[
              { value: 'funk', label: 'Funk' },
              { value: 'telefon', label: 'Telefon' },
              { value: 'persoenlich', label: 'Persönlich' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
          <Form.Item label="Meldungsart" style={{ flex: 1 }}>
            <Select<Meldungsart> value={meldungsart} onChange={setMeldungsart} options={[
              { value: 'lagemeldung', label: 'Lagemeldung' },
              { value: 'sofortmeldung', label: 'Sofortmeldung' },
              { value: 'rueckmeldung', label: 'Rückmeldung' },
              { value: 'vollzugsmeldung', label: 'Vollzugsmeldung' },
              { value: 'anfrage', label: 'Anfrage' },
              { value: 'sonstige', label: 'Sonstige' },
            ]} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Form.Item label="Priorität" style={{ flex: 1 }}>
            <Select<MeldungPrioritaet> value={prioritaet} onChange={setPrioritaet} options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
          <Form.Item label="Ereigniszeit (≠ Erfassung)" style={{ flex: 1 }}>
            <DatePicker showTime value={ereigniszeit} onChange={setEreigniszeit} style={{ width: '100%' }}
              format="YYYY-MM-DD HH:mm" placeholder="leer = jetzt" />
          </Form.Item>
        </div>
        <Form.Item label="Inhalt / Wortlaut" required>
          <TextArea aria-label="Inhalt / Wortlaut" value={inhalt} onChange={(e) => setInhalt(e.target.value)} rows={3} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={senden} block>Meldung erfassen</Button>
      </Form>
    </Card>
  );
}
```

> `dayjs.utc()` braucht das utc-Plugin. Verifizieren, dass es global geladen ist (`AuftragFormular.tsx` nutzt `d.utc()` identisch ⇒ Plugin ist registriert).

- [ ] **Step 2: Commit** (Komponente wird in Task 9 vom Seitentest gedeckt)

```bash
git add frontend/src/meldungen/MeldungFormular.tsx
git commit -m "feat(meldung): Erfassungsmaske (Nachrichtenvordruck) (LFH-93/54)"
```

### Task 8: Frontend Posteingang-Liste `MeldungListe.tsx`

**Files:**
- Create: `frontend/src/meldungen/MeldungListe.tsx`

Mirror `auftraege/AuftragListe.tsx`. Zeigt je Meldung: lfd_nr, Prio-Tag, Absender→Empfänger, Status-Tag, Meldeweg/Meldungsart, Ereigniszeit, Inhalt; Aktionen (LFH-94) als optionale Callbacks (in LFH-93 noch nicht verdrahtet, aber Props vorbereiten). Lagerelevant-Badge (LFH-95).

- [ ] **Step 1: Komponente schreiben**

```tsx
import { Empty, List, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Meldung, MeldungStatus } from '../api/types';

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const STATUS_TAG: Record<string, { color: string; label: string }> = {
  neu: { color: 'blue', label: 'Neu' },
  gesichtet: { color: 'cyan', label: 'Gesichtet' },
  in_bearbeitung: { color: 'processing', label: 'In Bearbeitung' },
  erledigt: { color: 'success', label: 'Erledigt' },
};
const ART_LABEL: Record<string, string> = {
  lagemeldung: 'Lagemeldung', sofortmeldung: 'Sofortmeldung', rueckmeldung: 'Rückmeldung',
  vollzugsmeldung: 'Vollzugsmeldung', anfrage: 'Anfrage', sonstige: 'Sonstige',
};
const WEG_LABEL: Record<string, string> = {
  funk: 'Funk', telefon: 'Telefon', persoenlich: 'Persönlich', sonstige: 'Sonstige',
};

export interface MeldungListeProps {
  meldungen: Meldung[];
  darfSchreiben?: boolean;
  onStatus?: (meldungId: number, status: MeldungStatus) => void;
  onLagerelevant?: (meldungId: number) => void;
}

export default function MeldungListe({ meldungen, darfSchreiben, onStatus, onLagerelevant }: MeldungListeProps) {
  if (meldungen.length === 0) return <Empty description="Keine Meldungen" />;
  return (
    <List
      dataSource={meldungen}
      renderItem={(m) => {
        const prio = PRIO_TAG[m.prioritaet] ?? PRIO_TAG.normal;
        const status = STATUS_TAG[m.status] ?? STATUS_TAG.neu;
        const aktionen: ReactNode[] = darfSchreiben
          ? [
              m.status === 'neu' && onStatus
                ? <a key="si" onClick={() => onStatus(m.id, 'gesichtet')}>Sichten</a> : null,
              (m.status === 'neu' || m.status === 'gesichtet') && onStatus
                ? <a key="ib" onClick={() => onStatus(m.id, 'in_bearbeitung')}>In Bearbeitung</a> : null,
              m.status !== 'erledigt' && onStatus
                ? <a key="er" onClick={() => onStatus(m.id, 'erledigt')}>Erledigt</a> : null,
              !m.lagerelevant && onLagerelevant
                ? <a key="lr" onClick={() => onLagerelevant(m.id)}>An Lage übergeben</a> : null,
            ].filter(Boolean) as ReactNode[]
          : [];
        return (
          <List.Item actions={aktionen.length ? aktionen : undefined}>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Typography.Text type="secondary">#{m.lfd_nr}</Typography.Text>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  <Typography.Text strong>{m.absender}</Typography.Text>
                  {m.empfaenger && <Typography.Text type="secondary">→ {m.empfaenger}</Typography.Text>}
                  {m.lagerelevant && <Tag color="gold">Lagerelevant ✓</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space wrap size={[8, 4]}>
                    <Tag color={status.color}>{status.label}</Tag>
                    <Typography.Text type="secondary">{WEG_LABEL[m.meldeweg]} · {ART_LABEL[m.meldungsart]}</Typography.Text>
                    <Typography.Text type="secondary">Ereignis: {m.ereigniszeit} UTC</Typography.Text>
                    {m.bearbeiter_name && <Tag>Bearbeiter: {m.bearbeiter_name}</Tag>}
                  </Space>
                  <Typography.Text>{m.inhalt}</Typography.Text>
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/meldungen/MeldungListe.tsx
git commit -m "feat(meldung): Posteingang-Liste mit Status/Prio/Meldeweg (LFH-93/54)"
```

### Task 9: Frontend Seite `MeldungenPage.tsx` + Tests + Modul-Verdrahtung + SSE

**Files:**
- Create: `frontend/src/pages/MeldungenPage.tsx`, `frontend/src/pages/MeldungenPage.test.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts`, `frontend/src/App.tsx`, `frontend/src/etb/useEinsatzLiveStream.ts`

- [ ] **Step 1: Failing test `MeldungenPage.test.tsx`** (Mirror `AuftraegePage.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MeldungenPage from './MeldungenPage';
import type { Meldung } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));

const listeMeldungen = vi.fn();
const legeMeldungAn = vi.fn();
const setzeMeldungStatus = vi.fn();
const markiereLagerelevant = vi.fn();
vi.mock('../api/meldungen', () => ({
  listeMeldungen: (...a: unknown[]) => listeMeldungen(...a),
  legeMeldungAn: (...a: unknown[]) => legeMeldungAn(...a),
  setzeMeldungStatus: (...a: unknown[]) => setzeMeldungStatus(...a),
  markiereLagerelevant: (...a: unknown[]) => markiereLagerelevant(...a),
}));

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1, einsatz_id: 1, lfd_nr: 1, absender: 'Florian Nord 1', empfaenger: 'ELW 1',
  meldeweg: 'funk', inhalt: 'Deich instabil', meldungsart: 'sofortmeldung', prioritaet: 'normal',
  status: 'neu', bearbeiter_id: null, bearbeiter_name: null, lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00', eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7, auftrag_id: null, erfasst_von_id: 1, erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null, ist_offen: true, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
          <Routes><Route path="/einsaetze/:id/meldungen" element={<MeldungenPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('MeldungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeMeldungen.mockResolvedValue([meldung()]); });

  it('zeigt eingegangene Meldungen im Posteingang', async () => {
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Deich instabil')).toBeInTheDocument();
    expect(screen.getByText('Neu')).toBeInTheDocument();
  });

  it('erfasst eine Meldung mit Mindestfeldern (Absender, Inhalt, Meldeweg)', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Eingetroffen');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledWith(1, expect.objectContaining({
      absender: 'RTW 2', inhalt: 'Eingetroffen', meldeweg: 'funk',
    })));
    // Ereigniszeit wird immer mitgesendet (Pflicht).
    expect(legeMeldungAn.mock.calls[0][1].ereigniszeit).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('filtert nach Status', async () => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Erledigt', { selector: '.ant-segmented-item-label *, .ant-segmented-item *' }).closest('label') ?? screen.getByText('Erledigt'));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(1, { status: 'erledigt' }));
  });

  it('Beobachter sieht Posteingang, aber keine Erfassung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meldung erfassen' })).not.toBeInTheDocument();
  });
});
```

> Der „filtert nach Status"-Selector ist fragil. **Robuster:** im Segmented die Option `Erledigt` exakt wie in `AuftraegePage.test.tsx` (`getByText('Erledigt')`) anklicken — sicherstellen, dass „Erledigt" nicht gleichzeitig als Action-`<a>` im Default-Item sichtbar ist. Da die Default-Meldung Status `neu` hat, erscheint die Action „Erledigt" (Action ist `m.status !== 'erledigt'`) **und** das Segment „Erledigt". Konflikt! ⇒ Im Test die Default-Meldung auf `lagerelevant`/Filter so wählen, dass eindeutig: Filter-Klick über `screen.getByText('Erledigt', { selector: 'label *' })` ODER Segment-Labels umbenennen. **Entscheidung:** Segmente heißen „Alle / Offen / In Bearbeitung / Erledigt"; Action-Links heißen „Sichten / In Bearbeitung / Erledigt / An Lage übergeben". Kollisionen bei „In Bearbeitung" und „Erledigt". Wie im Auftrag-Vorbild gelöst: Action-Klick über `{ selector: 'a' }`, Segment-Klick über das Default-`getByText` (Segment ist ein `<label>`/`div`, kein `<a>`). Test entsprechend: `screen.getByText('Erledigt', { selector: 'div' })` fürs Segment bzw. `{ selector: 'a' }` für die Action. Beim Schreiben final gegen das gerenderte DOM verifizieren (`screen.debug()`).

- [ ] **Step 2: `MeldungenPage.tsx` schreiben** (Mirror `AuftraegePage.tsx`, ohne Empfänger-Filter)

```tsx
import { Alert, App, Breadcrumb, Col, Row, Segmented, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeMeldungAn, listeMeldungen, markiereLagerelevant, setzeMeldungStatus } from '../api/meldungen';
import type { MeldungStatus, NeueMeldung } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import MeldungListe from '../meldungen/MeldungListe';
import MeldungFormular from '../meldungen/MeldungFormular';

export default function MeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const meldungenQuery = useQuery({
    queryKey: ['einsatz-meldungen', einsatzId, statusFilter ?? 'alle'],
    queryFn: () => listeMeldungen(einsatzId, { status: statusFilter }),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-meldungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeueMeldung) => legeMeldungAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Meldung erfasst'); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: ({ meldungId, status }: { meldungId: number; status: MeldungStatus }) =>
      setzeMeldungStatus(einsatzId, meldungId, status),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const lageMutation = useMutation({
    mutationFn: (meldungId: number) => markiereLagerelevant(einsatzId, meldungId),
    onSuccess: () => { invalidiere(); qc.invalidateQueries({ queryKey: ['einsatz-lagemeldungen', einsatzId] }); message.success('An die Lage übergeben'); },
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
  const meldungen = meldungenQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Meldungen (eingehend)' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Meldungen (eingehend)</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {meldungenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Meldungen konnten nicht geladen werden" />
          )}
          <div style={{ marginBottom: 12 }}>
            <Segmented
              value={statusFilter ?? 'alle'}
              onChange={(v) => setStatusFilter(v === 'alle' ? undefined : String(v))}
              options={[
                { value: 'alle', label: 'Alle' },
                { value: 'neu', label: 'Neu' },
                { value: 'gesichtet', label: 'Gesichtet' },
                { value: 'in_bearbeitung', label: 'In Arbeit' },
                { value: 'erledigt', label: 'Erledigt' },
              ]}
            />
          </div>
          <MeldungListe
            meldungen={meldungen}
            darfSchreiben={darfSchreiben}
            onStatus={(meldungId, status) => statusMutation.mutate({ meldungId, status })}
            onLagerelevant={(meldungId) => lageMutation.mutate(meldungId)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <MeldungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
```

> Segment-Labels „Neu/Gesichtet/In Arbeit/Erledigt" ≠ Action-Labels „Sichten/In Bearbeitung/Erledigt/An Lage übergeben". „Erledigt" kollidiert weiterhin (Segment + Action). Im Test den Segment-Klick eindeutig über die antd-Segmented-Struktur adressieren (Label-Element, kein `<a>`). Beim Schreiben final mit `screen.debug()` verifizieren und ggf. Segment-Label auf „Abgeschlossen" ändern, falls die Kollision Tests instabil macht.

- [ ] **Step 3: `modulRegistry.ts` — `meldungen` aktivieren** (`status: 'geplant'` → `'fertig'`).

- [ ] **Step 4: `App.tsx` verdrahten** — Import `import MeldungenPage from './pages/MeldungenPage';` (bei den Page-Imports) und `meldungen: <MeldungenPage />,` in `MODUL_ELEMENTE`.

- [ ] **Step 5: `useEinsatzLiveStream.ts` — `meldung`-Event** (4 Stellen):

```typescript
    const onMeldung = () => { inval('einsatz-meldungen'); inval('einsatz-lagemeldungen'); };
```
- in `onLag`: `onMeldung();` ergänzen.
- `quelle.addEventListener('meldung', onMeldung);`
- im Cleanup: `quelle.removeEventListener('meldung', onMeldung);`

- [ ] **Step 6: Tests laufen**

Run: `cd frontend && pnpm test -- --run src/pages/MeldungenPage.test.tsx 2>&1 | tail -30`
Expected: 4 Tests grün. Danach Typecheck `pnpm exec tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/MeldungenPage.tsx frontend/src/pages/MeldungenPage.test.tsx \
        frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx frontend/src/etb/useEinsatzLiveStream.ts
git commit -m "feat(meldung): Posteingang-Seite + Modul-Verdrahtung + SSE-Event (LFH-93/54)"
```

### Task 10: LFH-93 Gate + Board

- [ ] **Step 1: Volles Backend-Gate**

Run: `rtk proxy cargo test 2>&1 | tail -25` → 0 failures.

- [ ] **Step 2: Volles Frontend-Gate**

Run: `cd frontend && pnpm test -- --run --no-file-parallelism 2>&1 | tail -25` → 0 failures; `pnpm exec tsc --noEmit` sauber; `pnpm lint` falls vorhanden.

- [ ] **Step 3: Board** — LFH-93 → `in review` (oder direkt nach Subtask-Abschluss-Konvention). Wird vom Skill-Abschlussschritt mitgeführt.

---

## SUBTASK LFH-94 — Sichten, zuweisen und im Status führen

> Board: LFH-94 → `in development`. Liefert: Status-Endpoint (sichten/in_bearbeitung/erledigt + Bearbeiter-Zuweisung), Posteingang-Filter (offen sichtbar), Beobachter read-only (schon durch Gates erfüllt — wird per Test abgesichert). Akzeptanz: jede Meldung sichtbarer Status + optional Bearbeiter; offene gefiltert sichtbar; Beobachter nur lesend.

### Task 11: Repo `setze_status` (+ optionale Zuweisung)

**Files:**
- Modify: `src/meldung/repo.rs`

- [ ] **Step 1: Failing test + Implementierung**

```rust
/// Setzt den Triage-Status und optional den Bearbeiter. `bearbeiter_id = None`
/// lässt den Bearbeiter unverändert; `Some(Some(id))` setzt, `Some(None)` entfernt.
/// (Hier vereinfachte Signatur: bearbeiter wird übergeben wie geliefert.)
pub async fn setze_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    bearbeiter_id: Option<i64>,
) -> Result<(), AppError> {
    debug_assert!(super::status_gueltig(status));
    sqlx::query("UPDATE meldung SET status = ?, bearbeiter_id = ? WHERE id = ?")
        .bind(status)
        .bind(bearbeiter_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
```

```rust
    #[tokio::test]
    async fn setze_status_fuehrt_workflow_und_bearbeiter() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_IN_BEARBEITUNG, Some(b)).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert_eq!(nach.status, "in_bearbeitung");
        assert!(!nach.ist_offen);  // ist_offen nur bei != erledigt → noch true!
        assert_eq!(nach.bearbeiter_id, Some(b));
        assert_eq!(nach.bearbeiter_name.as_deref(), Some("Leit"));
    }
```

> **Achtung Assertion:** `ist_offen = status != 'erledigt'`. Bei `in_bearbeitung` ist `ist_offen == true`. Test entsprechend `assert!(nach.ist_offen)` korrigieren. (Beim Schreiben fixen — hier bewusst als Stolperstein markiert.)

Zweiter Test (erledigt → nicht offen):

```rust
    #[tokio::test]
    async fn erledigt_ist_nicht_mehr_offen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, None).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert_eq!(nach.status, "erledigt");
        assert!(!nach.ist_offen);
    }
```

- [ ] **Step 2: Run → PASS**; **Step 3: Commit** `feat(meldung): setze_status + Bearbeiter-Zuweisung (LFH-94/54)`

### Task 12: Route `status`

**Files:**
- Modify: `src/routes/meldung.rs`, `src/app.rs`

- [ ] **Step 1: Handler `status` ergänzen**

```rust
/// Gemeinsamer Vorlauf für Meldungs-Aktionen: Gates + Cross-Einsatz-Schutz.
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    meldung_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, meldung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
    pub bearbeiter_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/status — Status setzen + optional Bearbeiter.
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<StatusReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    if !crate::meldung::status_gueltig(req.status.trim()) {
        return Err(AppError::Validation("Ungültiger Status".into()));
    }
    // Bearbeiter (falls gesetzt) muss zum Einsatz gehören (Mitglied) — Cross-Einsatz-Schutz.
    if let Some(bid) = req.bearbeiter_id {
        if einsatz_repo::rolle_von(&state.pool, einsatz_id, bid).await?.is_none() {
            return Err(AppError::Validation("Bearbeiter ist kein Einsatz-Mitglied".into()));
        }
    }
    repo::setze_status(&state.pool, meldung_id, req.status.trim(), req.bearbeiter_id).await?;
    let m = repo::laden(&state.pool, meldung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}
```

> **Verifikation:** Rückgabetyp/Signatur von `einsatz_repo::rolle_von` prüfen — gibt es `Option<Rolle>`? In `routes/auftrag.rs` wird `rolle` direkt an `fordere_schreibrecht(rolle)` gereicht. Falls `rolle_von` `Option<…>` liefert, ist `.is_none()` korrekt für „kein Mitglied". Andernfalls (z. B. eigener Typ) den vorhandenen „Mitglied?"-Check aus einem anderen Route-Modul übernehmen (z. B. wie `auftrag` Empfänger-Person prüft: `SELECT 1 FROM einsatz_personal …`). **Fallback (sicher):** Bearbeiter-Zuweisung auf `benutzer`-Mitgliedschaft via vorhandenem Repo prüfen oder die Zuweisung in MVP auf „nur Status, Bearbeiter = aktueller Benutzer beim Sichten" reduzieren, wenn kein sauberer Mitglieds-Check existiert. Entscheidung beim Implementieren nach Sichtung von `einsatz/repo.rs`.

- [ ] **Step 2: `app.rs` Route**

```rust
        .route("/api/einsaetze/{id}/meldungen/{mid}/status", post(routes::meldung::status))
```

- [ ] **Step 3: Build + `cargo test meldung` grün; Commit** `feat(meldung): Status-Route + Bearbeiter-Zuweisung mit Gates (LFH-94/54)`

### Task 13: Frontend — Status-Aktionen + Filter test-abgesichert

**Files:**
- Modify: `frontend/src/pages/MeldungenPage.test.tsx` (Aktionen sind schon verdrahtet in Task 9)

- [ ] **Step 1: Tests ergänzen** (Sichten/Status setzen, Beobachter ohne Aktionen)

```tsx
  it('sichtet eine neue Meldung', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'gesichtet' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Sichten', { selector: 'a' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));
  });

  it('setzt eine Meldung auf erledigt', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'erledigt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Erledigt', { selector: 'a' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'erledigt'));
  });

  it('Beobachter sieht keine Status-Aktionen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.queryByText('Sichten', { selector: 'a' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run → PASS**; **Step 3: Commit** `test(meldung): Sichten/Status/Beobachter-Pfade (LFH-94/54)`

---

## SUBTASK LFH-95 — Lagerelevant an die Lage/Lagekarte übergeben

> Board: LFH-95 → `in development`. Liefert: Lageobjekt-Tabelle (0050, in Task 1 vorgezogen), `als_lagerelevant` (Flag + Lageobjekt + Rückverweis, tx), `liste_lage_meldungen` (GET = Lese-Oberfläche), Routen, Lese-Seite `LagemeldungenPage` unter Lage-Kategorie. Akzeptanz: lagerelevante Meldung an Lage übergebbar; Herkunft am Lageobjekt nachvollziehbar.

### Task 14: Repo `als_lagerelevant` + `liste_lage_meldungen`

**Files:**
- Modify: `src/meldung/repo.rs`

- [ ] **Step 1: `LageMeldungAnzeige`-Struct** in `meldung/mod.rs` ergänzen:

```rust
/// Lageobjekt aus lagerelevanter Meldung (LFH-95). Herkunfts-Felder (meldung_*)
/// per JOIN — am Lageobjekt bleibt die Quell-Meldung nachvollziehbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LageMeldungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub meldung_id: i64,
    pub text: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub meldung_lfd_nr: i64,
    pub meldung_absender: String,
}
```

- [ ] **Step 2: Repo-Funktionen + Tests**

```rust
use super::LageMeldungAnzeige;

/// Übergibt eine Meldung an die Lage: setzt `lagerelevant=1` und legt (idempotent,
/// UNIQUE meldung_id) ein Lageobjekt an. Geo optional (Meldung hat oft keine
/// Koordinaten). `text` = Lage-Notiz (Default: Meldungsinhalt). Liefert die Lageobjekt-id.
pub async fn als_lagerelevant(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    text: &str,
    geo: Option<(f64, f64)>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE meldung SET lagerelevant = 1 WHERE id = ?")
        .bind(meldung_id)
        .execute(&mut *tx)
        .await?;
    let (lat, lon) = match geo { Some((a, o)) => (Some(a), Some(o)), None => (None, None) };
    let lage_id: i64 = sqlx::query_scalar(
        "INSERT INTO lage_meldung (einsatz_id, meldung_id, text, lat, lon, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(meldung_id) DO UPDATE SET text = excluded.text \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(meldung_id)
    .bind(text)
    .bind(lat)
    .bind(lon)
    .bind(von_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(lage_id)
}

/// Listet Lageobjekte eines Einsatzes inkl. Herkunft (Quell-Meldung). Neueste zuerst.
pub async fn liste_lage_meldungen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageMeldungAnzeige>, AppError> {
    sqlx::query_as::<_, LageMeldungAnzeige>(
        "SELECT lm.id, lm.einsatz_id, lm.meldung_id, lm.text, lm.lat, lm.lon, \
                lm.erstellt_von_id, lm.erstellt_at, \
                m.lfd_nr AS meldung_lfd_nr, m.absender AS meldung_absender \
         FROM lage_meldung lm JOIN meldung m ON m.id = lm.meldung_id \
         WHERE lm.einsatz_id = ? ORDER BY lm.id DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}
```

```rust
    #[tokio::test]
    async fn als_lagerelevant_setzt_flag_und_erzeugt_lageobjekt_mit_herkunft() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Brücke gesperrt", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let lage_id = als_lagerelevant(&pool, e, m.id, b, "Brücke gesperrt", None).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert!(nach.lagerelevant);
        assert_eq!(nach.lage_meldung_id, Some(lage_id));
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].meldung_lfd_nr, m.lfd_nr);
        assert_eq!(liste[0].meldung_absender, "Florian Nord 1");
        assert_eq!(liste[0].text, "Brücke gesperrt");
    }

    #[tokio::test]
    async fn als_lagerelevant_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let id1 = als_lagerelevant(&pool, e, m.id, b, "erste", None).await.unwrap();
        let id2 = als_lagerelevant(&pool, e, m.id, b, "zweite", None).await.unwrap();
        assert_eq!(id1, id2, "UNIQUE meldung_id → ein Lageobjekt");
        assert_eq!(liste_lage_meldungen(&pool, e).await.unwrap().len(), 1);
    }
```

- [ ] **Step 3: Run → PASS; Commit** `feat(meldung): als_lagerelevant (Lageobjekt + Rückverweis) + liste_lage_meldungen (LFH-95/54)`

### Task 15: Routen `lagerelevant` + `lage_liste`

**Files:**
- Modify: `src/routes/meldung.rs`, `src/app.rs`

- [ ] **Step 1: Handler**

```rust
#[derive(Debug, Deserialize)]
pub struct LagerelevantReq {
    pub text: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/lagerelevant — an die Lage übergeben.
pub async fn lagerelevant(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<LagerelevantReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    // Default-Text = Meldungsinhalt, falls kein eigener Lage-Text gegeben.
    let aktuell = repo::laden(&state.pool, meldung_id).await?;
    let text = req.text.as_deref().map(str::trim).filter(|s| !s.is_empty())
        .map(str::to_string).unwrap_or(aktuell.inhalt);
    let geo = match (req.lat, req.lon) {
        (Some(a), Some(o)) => Some((a, o)),
        (None, None) => None,
        _ => return Err(AppError::Validation("lat und lon nur gemeinsam".into())),
    };
    repo::als_lagerelevant(&state.pool, einsatz_id, meldung_id, benutzer.id, &text, geo).await?;
    let m = repo::laden(&state.pool, meldung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

/// GET /api/einsaetze/{id}/lage/meldungen — Lageobjekte aus Meldungen (Lese-Oberfläche).
pub async fn lage_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<crate::meldung::LageMeldungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(repo::liste_lage_meldungen(&state.pool, einsatz_id).await?))
}
```

- [ ] **Step 2: `app.rs` Routen**

```rust
        .route("/api/einsaetze/{id}/meldungen/{mid}/lagerelevant", post(routes::meldung::lagerelevant))
        .route("/api/einsaetze/{id}/lage/meldungen", get(routes::meldung::lage_liste))
```

- [ ] **Step 3: Build + `cargo test meldung` grün; Commit** `feat(meldung): Routen lagerelevant + Lage-Liste (LFH-95/54)`

### Task 16: Frontend Lese-Oberfläche `LagemeldungenPage` (Lage-Kategorie)

**Files:**
- Create: `frontend/src/pages/LagemeldungenPage.tsx`, `frontend/src/pages/LagemeldungenPage.test.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: `LagemeldungenPage.tsx`**

```tsx
import { Alert, Breadcrumb, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeLageMeldungen } from '../api/meldungen';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';

export default function LagemeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const lageQuery = useQuery({
    queryKey: ['einsatz-lagemeldungen', einsatzId],
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const eintraege = lageQuery.data ?? [];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: einsatz.bezeichnung },
        { title: 'Lagemeldungen' },
      ]} />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Lagerelevante Meldungen</Typography.Title>
      {lageQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Lageobjekte konnten nicht geladen werden" />
      )}
      {eintraege.length === 0 ? (
        <Empty description="Noch keine lagerelevanten Meldungen übergeben" />
      ) : (
        <List
          dataSource={eintraege}
          renderItem={(l) => (
            <List.Item>
              <List.Item.Meta
                title={<Typography.Text strong>{l.text}</Typography.Text>}
                description={
                  <Space wrap>
                    <Tag color="gold">Lageobjekt</Tag>
                    <Typography.Text type="secondary">
                      Herkunft: Meldung #{l.meldung_lfd_nr} von {l.meldung_absender}
                    </Typography.Text>
                    {l.lat != null && l.lon != null && (
                      <Typography.Text type="secondary">Geo: {l.lat.toFixed(5)}, {l.lon.toFixed(5)}</Typography.Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: `LagemeldungenPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LagemeldungenPage from './LagemeldungenPage';
import type { LageMeldung } from '../api/types';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter' }),
}));
const listeLageMeldungen = vi.fn();
vi.mock('../api/meldungen', () => ({ listeLageMeldungen: (...a: unknown[]) => listeLageMeldungen(...a) }));

const lage = (over: Partial<LageMeldung> = {}): LageMeldung => ({
  id: 1, einsatz_id: 1, meldung_id: 3, text: 'Brücke gesperrt', lat: null, lon: null,
  erstellt_von_id: 1, erstellt_at: '2026-06-12 09:00:00', meldung_lfd_nr: 5, meldung_absender: 'Florian Nord 1', ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><AntApp>
      <MemoryRouter initialEntries={['/einsaetze/1/lagemeldungen']}>
        <Routes><Route path="/einsaetze/:id/lagemeldungen" element={<LagemeldungenPage />} /></Routes>
      </MemoryRouter>
    </AntApp></QueryClientProvider>,
  );
}

describe('LagemeldungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeLageMeldungen.mockResolvedValue([lage()]); });

  it('zeigt Lageobjekte mit nachvollziehbarer Herkunft', async () => {
    renderPage();
    expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
    expect(screen.getByText('Herkunft: Meldung #5 von Florian Nord 1')).toBeInTheDocument();
  });

  it('zeigt Leerzustand ohne Lageobjekte', async () => {
    listeLageMeldungen.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Noch keine lagerelevanten Meldungen übergeben')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Registry-Eintrag** in `modulRegistry.ts` (Kategorie `lage`, nach `gefahrenzonen`):

```typescript
  { key: 'lagemeldungen', kategorie: 'lage', label: 'Lagemeldungen', icon: TbInbox, route: 'lagemeldungen', status: 'fertig', beschreibung: 'Lagerelevante Meldungen, die an die Lage übergeben wurden.' },
```

> `TbInbox` ist bereits importiert. Falls ein eigenes Icon gewünscht: ein bereits importiertes Lage-Icon (z. B. `TbMap2`) verwenden, keine neuen Imports nötig.

- [ ] **Step 4: `App.tsx`** — Import `import LagemeldungenPage from './pages/LagemeldungenPage';` und `lagemeldungen: <LagemeldungenPage />,` in `MODUL_ELEMENTE`.

- [ ] **Step 5: Tests** `cd frontend && pnpm test -- --run src/pages/LagemeldungenPage.test.tsx` → grün; `tsc --noEmit` sauber.

- [ ] **Step 6: Commit** `feat(meldung): Lage-Lese-Oberfläche (Lagemeldungen) + Modul-Eintrag (LFH-95/54)`

### Task 17: Frontend — „An Lage übergeben" test-abgesichert + LFH-95 Gate

**Files:**
- Modify: `frontend/src/pages/MeldungenPage.test.tsx`

- [ ] **Step 1: Test**

```tsx
  it('übergibt eine Meldung an die Lage', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('An Lage übergeben', { selector: 'a' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledWith(1, 1));
  });

  it('zeigt lagerelevante Meldung als markiert, ohne erneute Übergabe-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ lagerelevant: true, lage_meldung_id: 9 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText('Lagerelevant ✓')).toBeInTheDocument();
    expect(screen.queryByText('An Lage übergeben', { selector: 'a' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Volles Gate** (Backend `rtk proxy cargo test`, Frontend `pnpm test -- --run --no-file-parallelism`, `tsc --noEmit`) → 0 failures.

- [ ] **Step 3: Commit** `test(meldung): Lage-Übergabe-Pfad + Lagerelevant-Badge (LFH-95/54)`

---

## Final: Integration, Review, Merge

- [ ] **Step 1: Frontend-Build (rust-embed)** — `cd frontend && pnpm build`, dann Backend neu bauen (`cargo build`), damit das eingebettete Bundle aktuell ist (Memory: Frontend ins Binary eingebettet). Manueller Smoke optional.
- [ ] **Step 2: Vollständiges Gate** beide Suites grün, `tsc`, Lint.
- [ ] **Step 3: `superpowers:requesting-code-review`** → Board alle Subtasks/LFH-54 → `in review`.
- [ ] **Step 4: Review-Findings einarbeiten.**
- [ ] **Step 5: `superpowers:finishing-a-development-branch`** → Merge in `main` (Memory: Harness-Worktree → Merge via `git -C <mainroot>`, Worktree/Branch dem Harness überlassen, **nicht** ExitWorktree). Board → `shipped`/`done`.

---

## Anhang A: `migrations/0050_lage_meldung.sql` (in Task 1 mit anlegen)

```sql
-- Lageobjekt aus lagerelevanter Meldung (LFH-95). Eigene Schnittstelle (nicht ETB),
-- Rückverweis auf die Quell-Meldung (Herkunft am Lageobjekt nachvollziehbar). Geo
-- optional — eine Meldung hat oft keine Koordinaten. UNIQUE(meldung_id): genau ein
-- Lageobjekt je Meldung (Übergabe idempotent).
CREATE TABLE lage_meldung (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    meldung_id      INTEGER NOT NULL REFERENCES meldung(id) ON DELETE CASCADE,
    text            TEXT    NOT NULL,
    lat             REAL,
    lon             REAL,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (meldung_id)
);
CREATE INDEX idx_lage_meldung_einsatz ON lage_meldung(einsatz_id);
```

---

## Self-Review (Spec-Abdeckung)

**LFH-54 „Zu tun":**
- lfd. Nr. ✓ (lfd_nr atomar) · Eingangs-/Ereigniszeit ✓ (eingang_at/ereigniszeit getrennt) · Absender ✓ · Empfänger/Adressat ✓ · Meldeweg (ETB-Vokabular) ✓ · Inhalt/Wortlaut ✓
- Meldungsart (6 Werte) ✓ · Priorität (sofort/dringend/normal) ✓
- Status-Workflow neu→gesichtet→in_bearbeitung→erledigt ✓ · Zuweisung Bearbeiter ✓
- Flag lagerelevant → Übergabe an Lage ✓ (Task 14–16) · Verknüpfungen: Auftrag (Spalte, UI deferred — kein AC), ETB ✓, Lageobjekt ✓
- Posteingang-Übersicht (offene auf einen Blick) ✓ (Status-Filter + ist_offen)

**LFH-93 AC:** Mindestfelder (Absender/Inhalt/Meldeweg) ✓ · Ereignis ≠ Erfassung ✓ · ETB-Meldung erzeugt ✓ · SSE Live-Zustellung ✓ (Dual-Publish + meldung-Event)
**LFH-94 AC:** sichtbarer Status + optional Bearbeiter ✓ · offene gefiltert sichtbar ✓ · Beobachter nur lesend ✓ (Gates + Test)
**LFH-95 AC:** lagerelevant übergebbar ✓ · Herkunft am Lageobjekt nachvollziehbar ✓ (LagemeldungenPage zeigt Quell-Meldung) · eigene Schnittstelle (nicht ETB) ✓

**Offene Verifikationspunkte beim Implementieren** (im Plan markiert): exakte Signatur `einsatz_repo::rolle_von` (Option?), Segmented-vs-Action-Label-Kollision in MeldungenPage-Tests, `ist_offen`-Assertion (in_bearbeitung bleibt offen), `dayjs.utc`-Plugin global.
