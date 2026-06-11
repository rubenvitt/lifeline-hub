# Kommunikation — Gemeinsamer Unterbau (LFH-84) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein gemeinsames Kommunikations-Fundament (geteilte Zustellung/Quittung/Vollzug-Tabellen + Code) einziehen und die Bestandsmodule Erinnerung (voll) und Chat (dünn) darauf umstellen.

**Architecture:** Hybrid — neues Domänenmodul `src/kommunikation/` mit zwei geteilten Tabellen (`kommunikation_zustellung` pro Empfänger, `kommunikation_status` pro Objekt mit getrennter Quittungs- und Vollzugs-Achse). Inhalts-Tabellen (`chat_nachricht`, `erinnerung`) bleiben modul-eigen. `erinnerung.status` bleibt **unangetastet** als Scheduler-/Dedup-Treiber (null Regression dort); Quittieren/Erledigen schreiben zusätzlich in `kommunikation_status`, die Anzeige liest die Achsen per LEFT JOIN.

**Tech Stack:** Rust (axum, sqlx/SQLite), React/TypeScript (TanStack Query, antd), SSE über bestehenden `LiveHub` + `useEinsatzLiveStream`.

**Spec:** `docs/superpowers/specs/2026-06-11-kommunikation-unterbau-design.md`

---

## File Structure

**Neu (Backend):**
- `migrations/0045_kommunikation.sql` — die zwei geteilten Tabellen + Indizes
- `migrations/0046_erinnerung_kommunikation_backfill.sql` — Bestandszeilen-Backfill (Phase 2)
- `src/kommunikation/mod.rs` — Enums/Konstanten, Vokabular-Re-Exports, `KommunikationStatus`-Typ
- `src/kommunikation/repo.rs` — Repo-Helfer (quittiere/setze_vollzug/lade_status/vermerke_zustellung/markiere_gelesen) + Tests

**Modifiziert (Backend):**
- `src/lib.rs` (oder `src/main.rs`) — `pub mod kommunikation;` deklarieren
- `src/erinnerung/mod.rs` — `ErinnerungAnzeige` um Achsen-Felder erweitern
- `src/erinnerung/repo.rs` — `ANZEIGE_SELECT` um LEFT JOIN erweitern
- `src/routes/erinnerung.rs` — `fordere_bearbeitbar` liefert `org_id`; `quittieren`/`erledigen` schreiben `kommunikation_status`

**Modifiziert (Frontend):**
- `frontend/src/api/types.ts` — `Erinnerung` um Achsen-Felder
- `frontend/src/einsatz/erinnerung/ErinnerungListe.tsx` (Pfad beim Lesen verifizieren) — Achsen anzeigen

**Chat (Phase 3, dünn):**
- `src/kommunikation/repo.rs` — `vermerke_zustellung`/`markiere_gelesen` (bereits in Phase 1 gebaut)
- `src/chat/mod.rs` — Vokabular-Re-Export-Doku (keine funktionale Änderung nötig, Chat publiziert bereits live)
- Optional-Stretch: Lesebestätigungs-Endpunkt + Wiring

---

## PHASE 1 — Fundament

### Task 1: Migration — geteilte Tabellen

**Files:**
- Create: `migrations/0045_kommunikation.sql`
- Test: `src/kommunikation/repo.rs` (Smoke-Test in Task 3 deckt das Schema ab; hier nur ein Schema-Existenz-Test im selben Modul)

- [ ] **Step 1: Migration schreiben**

`migrations/0045_kommunikation.sql`:

```sql
-- Gemeinsamer Kommunikations-Unterbau (LFH-84). Zwei getrennte Achsen:
--  * kommunikation_zustellung  — Achse 1, PRO EMPFÄNGER (Lesebestätigung, z. B. Chat)
--  * kommunikation_status      — Quittung (Achse 1, pro Objekt) + Vollzug (Achse 2)
-- Polymorphe Referenz (objekt_typ, objekt_id) → kein DB-FK auf die Inhaltstabelle;
-- Integrität/Isolation wird im Code geprüft (org_id + einsatz_id in jeder Query).

CREATE TABLE kommunikation_zustellung (
    id            INTEGER PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    objekt_typ    TEXT    NOT NULL,
    objekt_id     INTEGER NOT NULL,
    empfaenger_id INTEGER NOT NULL REFERENCES benutzer(id),
    zugestellt_at TEXT,
    gelesen_at    TEXT
);
CREATE UNIQUE INDEX idx_komm_zustellung_objekt_empf
    ON kommunikation_zustellung(objekt_typ, objekt_id, empfaenger_id);
CREATE INDEX idx_komm_zustellung_einsatz
    ON kommunikation_zustellung(einsatz_id, objekt_typ, objekt_id);

CREATE TABLE kommunikation_status (
    id               INTEGER PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    objekt_typ       TEXT    NOT NULL,
    objekt_id        INTEGER NOT NULL,
    -- Achse 1: Quittung ("zur Kenntnis genommen").
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id),
    -- Achse 2: Vollzug ("ausgeführt"): 'offen' | 'in_arbeit' | 'vollzogen'.
    vollzug_status   TEXT    NOT NULL DEFAULT 'offen',
    vollzogen_at     TEXT,
    vollzogen_von_id INTEGER REFERENCES benutzer(id)
);
CREATE UNIQUE INDEX idx_komm_status_objekt
    ON kommunikation_status(objekt_typ, objekt_id);
CREATE INDEX idx_komm_status_einsatz
    ON kommunikation_status(einsatz_id, objekt_typ, objekt_id);
```

- [ ] **Step 2: Migration kompiliert/lädt**

Run: `rtk proxy cargo build`
Expected: Erfolg (exit 0). `sqlx::migrate!` validiert das Verzeichnis beim Build.

- [ ] **Step 3: Commit**

```bash
git add migrations/0045_kommunikation.sql
git commit -m "feat(kommunikation): Migration geteilte Zustellung/Status-Tabellen (LFH-84)"
```

---

### Task 2: Modul-Skelett — Enums, Konstanten, Vokabular-Re-Exports

**Files:**
- Create: `src/kommunikation/mod.rs`
- Modify: `src/lib.rs` (Modul deklarieren — exakte Datei beim Lesen prüfen; dort, wo `pub mod erinnerung;` / `pub mod chat;` stehen)

- [ ] **Step 1: Failing test — Vokabular-Re-Export + Vollzug-Konstanten erreichbar**

In `src/kommunikation/mod.rs` (Test-Modul):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vollzug_konstanten_sind_eindeutig() {
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN);
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_IN_ARBEIT);
    }

    #[test]
    fn vokabular_wird_aus_etb_referenziert() {
        // Re-Export, keine Neudefinition: identische String-Repräsentation.
        assert_eq!(EtbTyp::Meldung.as_str(), crate::etb::EtbTyp::Meldung.as_str());
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }

    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
    }
}
```

- [ ] **Step 2: Run → fail (Modul existiert noch nicht)**

Run: `rtk proxy cargo test -p lifeline-hub kommunikation::tests 2>&1 | tail -20`
(Crate-Name in `Cargo.toml` prüfen; ggf. ohne `-p`.)
Expected: FAIL — `kommunikation` nicht gefunden / Modul nicht deklariert.

- [ ] **Step 3: Modul implementieren**

`src/kommunikation/mod.rs`:

```rust
//! Gemeinsamer Kommunikations-Unterbau (LFH-84): geteilte Zustellungs- und
//! Status-Mechanik (Quittung vs. Vollzug — sauber getrennt) für die
//! Kommunikations-Module (Chat, Erinnerung, künftig Aufträge/Meldungen).
pub mod repo;

use serde::Serialize;

/// Vokabular-Re-Export: Single Source of Truth bleibt das ETB-Modul. Module
/// referenzieren `kommunikation::{EtbTyp, MeldeWeg}` statt eigene Vokabulare zu
/// definieren. (Funkrufname lebt fachlich an `einheit`/`fahrzeug` und wird dort
/// referenziert — kein Enum zum Re-Export.)
pub use crate::etb::{EtbTyp, MeldeWeg};

/// Objekttyp für die polymorphe Referenz `(objekt_typ, objekt_id)`.
pub const OBJEKT_CHAT_NACHRICHT: &str = "chat_nachricht";
pub const OBJEKT_ERINNERUNG: &str = "erinnerung";

/// Vollzug-Achse (Achse 2): Bearbeitungszustand eines Objekts.
pub const VOLLZUG_OFFEN: &str = "offen";
pub const VOLLZUG_IN_ARBEIT: &str = "in_arbeit";
pub const VOLLZUG_VOLLZOGEN: &str = "vollzogen";

/// Geteilter Status eines Objekts: beide Achsen getrennt. `quittiert_at` ist die
/// Quittungs-Achse, `vollzug_status`/`vollzogen_at` die Vollzugs-Achse — beide
/// unabhängig setzbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KommunikationStatus {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vollzug_konstanten_sind_eindeutig() {
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN);
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_IN_ARBEIT);
    }

    #[test]
    fn vokabular_wird_aus_etb_referenziert() {
        assert_eq!(EtbTyp::Meldung.as_str(), crate::etb::EtbTyp::Meldung.as_str());
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }

    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
    }
}
```

In `src/lib.rs` bei den anderen `pub mod`-Zeilen ergänzen:

```rust
pub mod kommunikation;
```

> Hinweis: `repo` wird in Task 3 gefüllt; damit Task 2 für sich kompiliert, lege `src/kommunikation/repo.rs` zunächst leer an (`// in Task 3`).

- [ ] **Step 4: Run → pass**

Run: `rtk proxy cargo test kommunikation::tests 2>&1 | tail -20`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/kommunikation/mod.rs src/kommunikation/repo.rs src/lib.rs
git commit -m "feat(kommunikation): Modul-Skelett, Enums + Vokabular-Re-Exports (LFH-84)"
```

---

### Task 3: Repo — Quittung, Vollzug, Zustellung + Isolation

**Files:**
- Modify: `src/kommunikation/repo.rs`

- [ ] **Step 1: Failing tests schreiben**

`src/kommunikation/repo.rs`:

```rust
use crate::error::AppError;
use crate::kommunikation::{KommunikationStatus, VOLLZUG_IN_ARBEIT, VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN};
use sqlx::SqlitePool;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::OBJEKT_ERINNERUNG;

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an; liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'L','l','h') RETURNING id").fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    #[tokio::test]
    async fn quittieren_setzt_quittungs_achse_ohne_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();

        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert_eq!(s.quittiert_at.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(s.quittiert_von_id, Some(b));
        assert_eq!(s.vollzug_status, VOLLZUG_OFFEN, "Vollzug bleibt unberührt");
    }

    #[tokio::test]
    async fn vollzug_setzen_ist_unabhaengig_von_quittung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();

        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
        assert_eq!(s.vollzogen_at.as_deref(), Some("2026-06-11 11:00:00"));
        assert!(s.quittiert_at.is_none(), "Quittung bleibt unberührt");
    }

    #[tokio::test]
    async fn beide_achsen_koexistieren() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();

        let s = lade_status(&pool, e, OBJEKT_ERINNERUNG, 7).await.unwrap().unwrap();
        assert!(s.quittiert_at.is_some());
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
    }

    #[tokio::test]
    async fn vollzug_lehnt_ungueltigen_status_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let err = setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, 7, "blubb", b, "2026-06-11 11:00:00").await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[tokio::test]
    async fn lade_status_isoliert_nach_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        quittiere(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();

        // Fremder Einsatz sieht den Status NICHT.
        assert!(lade_status(&pool, 999, OBJEKT_ERINNERUNG, 7).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn zustellung_gelesen_ist_idempotent_pro_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        markiere_gelesen(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:00:00").await.unwrap();
        markiere_gelesen(&pool, 1, e, OBJEKT_ERINNERUNG, 7, b, "2026-06-11 10:05:00").await.unwrap();

        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM kommunikation_zustellung WHERE objekt_id = 7 AND empfaenger_id = ?")
            .bind(b).fetch_one(&pool).await.unwrap();
        assert_eq!(n, 1, "eine Zeile je (Objekt, Empfänger)");
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `rtk proxy cargo test kommunikation::repo::tests 2>&1 | tail -25`
Expected: FAIL — `quittiere`/`setze_vollzug`/`lade_status`/`markiere_gelesen` nicht gefunden.

- [ ] **Step 3: Repo implementieren** (oberhalb des Test-Moduls)

```rust
/// Setzt die Quittungs-Achse (UPSERT je Objekt). Vollzug bleibt unberührt.
pub async fn quittiere(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, von_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_status \
           (org_id, einsatz_id, objekt_typ, objekt_id, quittiert_at, quittiert_von_id) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id) DO UPDATE SET \
           quittiert_at = excluded.quittiert_at, quittiert_von_id = excluded.quittiert_von_id",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(jetzt).bind(von_id)
    .execute(pool).await?;
    Ok(())
}

/// Setzt die Vollzugs-Achse (UPSERT je Objekt). Quittung bleibt unberührt.
/// `vollzogen_at`/`_von` nur bei Zielstatus `vollzogen` gesetzt.
pub async fn setze_vollzug(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, status: &str, von_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    if status != VOLLZUG_OFFEN && status != VOLLZUG_IN_ARBEIT && status != VOLLZUG_VOLLZOGEN {
        return Err(AppError::Validation("Ungültiger Vollzug-Status".into()));
    }
    let (at, von): (Option<&str>, Option<i64>) =
        if status == VOLLZUG_VOLLZOGEN { (Some(jetzt), Some(von_id)) } else { (None, None) };
    sqlx::query(
        "INSERT INTO kommunikation_status \
           (org_id, einsatz_id, objekt_typ, objekt_id, vollzug_status, vollzogen_at, vollzogen_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id) DO UPDATE SET \
           vollzug_status = excluded.vollzug_status, \
           vollzogen_at = excluded.vollzogen_at, vollzogen_von_id = excluded.vollzogen_von_id",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(status).bind(at).bind(von)
    .execute(pool).await?;
    Ok(())
}

/// Lädt den geteilten Status eines Objekts — nach Einsatz isoliert.
/// `None`, wenn kein Status existiert oder der Einsatz nicht passt.
pub async fn lade_status(
    pool: &SqlitePool, einsatz_id: i64, objekt_typ: &str, objekt_id: i64,
) -> Result<Option<KommunikationStatus>, AppError> {
    sqlx::query_as::<_, KommunikationStatus>(
        "SELECT objekt_typ, objekt_id, quittiert_at, quittiert_von_id, \
                vollzug_status, vollzogen_at, vollzogen_von_id \
         FROM kommunikation_status \
         WHERE einsatz_id = ? AND objekt_typ = ? AND objekt_id = ?",
    )
    .bind(einsatz_id).bind(objekt_typ).bind(objekt_id)
    .fetch_optional(pool).await.map_err(Into::into)
}

/// Vermerkt Zustellung (zugestellt_at) je (Objekt, Empfänger), idempotent.
pub async fn vermerke_zustellung(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, empfaenger_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_zustellung \
           (org_id, einsatz_id, objekt_typ, objekt_id, empfaenger_id, zugestellt_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id, empfaenger_id) DO UPDATE SET \
           zugestellt_at = COALESCE(kommunikation_zustellung.zugestellt_at, excluded.zugestellt_at)",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(empfaenger_id).bind(jetzt)
    .execute(pool).await?;
    Ok(())
}

/// Markiert Lesebestätigung (gelesen_at) je (Objekt, Empfänger), idempotent.
pub async fn markiere_gelesen(
    pool: &SqlitePool, org_id: i64, einsatz_id: i64,
    objekt_typ: &str, objekt_id: i64, empfaenger_id: i64, jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO kommunikation_zustellung \
           (org_id, einsatz_id, objekt_typ, objekt_id, empfaenger_id, gelesen_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(objekt_typ, objekt_id, empfaenger_id) DO UPDATE SET \
           gelesen_at = COALESCE(kommunikation_zustellung.gelesen_at, excluded.gelesen_at)",
    )
    .bind(org_id).bind(einsatz_id).bind(objekt_typ).bind(objekt_id).bind(empfaenger_id).bind(jetzt)
    .execute(pool).await?;
    Ok(())
}
```

- [ ] **Step 4: Run → pass**

Run: `rtk proxy cargo test kommunikation::repo::tests 2>&1 | tail -25`
Expected: PASS (6 Tests).

- [ ] **Step 5: Clippy + Commit**

Run: `rtk proxy cargo clippy --all-targets 2>&1 | tail -15` (erwartet: keine Warnungen)

```bash
git add src/kommunikation/repo.rs
git commit -m "feat(kommunikation): Repo quittiere/setze_vollzug/zustellung + Isolationstests (LFH-84)"
```

---

## PHASE 2 — Erinnerung-Retrofit (Risiko-Locus)

> **Invariante für die ganze Phase:** `erinnerung.status`, `faellige_zum_ausloesen`, `markiere_ausgeloest`, der partielle Unique-Index `idx_erinnerung_auto_bezug` und `anlegen_aus_frist` bleiben **unverändert**. Der Scheduler-Pfad ist damit per Konstruktion regressionsfrei; die bestehenden Tests in `src/erinnerung/scheduler.rs` und `src/erinnerung/repo.rs` müssen ohne Änderung grün bleiben.

### Task 4: Backfill-Migration

**Files:**
- Create: `migrations/0046_erinnerung_kommunikation_backfill.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0046_erinnerung_kommunikation_backfill.sql`:

```sql
-- Retrofit LFH-84: bestehende Erinnerungen in die geteilte kommunikation_status
-- spiegeln. Mapping (alter Einzelstatus → zwei Achsen):
--   offen     → Quittung NULL, Vollzug 'offen'
--   quittiert → Quittung gesetzt (best-effort Zeitstempel), Vollzug 'offen'
--   erledigt  → Vollzug 'vollzogen' (vollzogen_at = erledigt_at), Quittung NULL
-- org_id wird aus dem zugehörigen Einsatz gejoint. quittiert_von/vollzogen_von
-- bleiben NULL (historischer Akteur nicht rekonstruierbar) — bewusste Näherung.
INSERT INTO kommunikation_status
    (org_id, einsatz_id, objekt_typ, objekt_id, quittiert_at, vollzug_status, vollzogen_at)
SELECT
    ein.org_id,
    e.einsatz_id,
    'erinnerung',
    e.id,
    CASE WHEN e.status = 'quittiert' THEN COALESCE(e.erledigt_at, e.erstellt_at) END,
    CASE WHEN e.status = 'erledigt' THEN 'vollzogen' ELSE 'offen' END,
    CASE WHEN e.status = 'erledigt' THEN e.erledigt_at END
FROM erinnerung e
JOIN einsatz ein ON ein.id = e.einsatz_id;
```

- [ ] **Step 2: Build prüft Migration**

Run: `rtk proxy cargo build 2>&1 | tail -5`
Expected: Erfolg (exit 0).

- [ ] **Step 3: Commit**

```bash
git add migrations/0046_erinnerung_kommunikation_backfill.sql
git commit -m "feat(erinnerung): Backfill Bestandsstatus nach kommunikation_status (LFH-84)"
```

---

### Task 5: ErinnerungAnzeige um Achsen-Felder erweitern (Read)

**Files:**
- Modify: `src/erinnerung/mod.rs` (Struct `ErinnerungAnzeige`)
- Modify: `src/erinnerung/repo.rs` (`ANZEIGE_SELECT`)
- Test: `src/erinnerung/repo.rs` (Test-Modul)

- [ ] **Step 1: Failing test — Anzeige liefert Achsen aus kommunikation_status**

In `src/erinnerung/repo.rs` Test-Modul ergänzen:

```rust
#[tokio::test]
async fn anzeige_enthaelt_kommunikation_achsen() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();

    // Default ohne kommunikation_status-Zeile: Vollzug 'offen', Quittung NULL.
    let vorher = laden(&pool, r.id, "2026-06-11 09:00:00").await.unwrap();
    assert_eq!(vorher.vollzug_status, "offen");
    assert!(vorher.quittiert_at.is_none());

    // Quittung über das geteilte Repo setzen → Anzeige spiegelt sie.
    crate::kommunikation::repo::quittiere(
        &pool, 1, e, crate::kommunikation::OBJEKT_ERINNERUNG, r.id, b, "2026-06-11 10:30:00",
    ).await.unwrap();
    let nachher = laden(&pool, r.id, "2026-06-11 10:31:00").await.unwrap();
    assert_eq!(nachher.quittiert_at.as_deref(), Some("2026-06-11 10:30:00"));
    assert_eq!(nachher.vollzug_status, "offen");
}
```

- [ ] **Step 2: Run → fail**

Run: `rtk proxy cargo test erinnerung::repo::tests::anzeige_enthaelt_kommunikation_achsen 2>&1 | tail -20`
Expected: FAIL — Feld `vollzug_status` existiert nicht auf `ErinnerungAnzeige`.

- [ ] **Step 3: Struct + SELECT erweitern**

In `src/erinnerung/mod.rs`, `ErinnerungAnzeige` nach `pub ist_faellig: bool,` ergänzen:

```rust
    // Geteilte Kommunikations-Achsen (LFH-84) per LEFT JOIN; Default für Zeilen
    // ohne kommunikation_status-Eintrag: Vollzug 'offen', Quittung NULL.
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
```

In `src/erinnerung/repo.rs`, `ANZEIGE_SELECT` ersetzen durch (LEFT JOIN + COALESCE für den Default):

```rust
const ANZEIGE_SELECT: &str =
    "SELECT e.id, e.einsatz_id, e.titel, e.beschreibung, e.faellig_at, e.intervall_minuten, \
            e.empfaenger_funktion, e.bezug_typ, e.bezug_id, e.quelle, e.status, e.erledigt_at, \
            e.erstellt_von_id, e.erstellt_at, \
            (e.faellig_at <= ?) AS ist_faellig, \
            ks.quittiert_at AS quittiert_at, ks.quittiert_von_id AS quittiert_von_id, \
            COALESCE(ks.vollzug_status, 'offen') AS vollzug_status, \
            ks.vollzogen_at AS vollzogen_at, ks.vollzogen_von_id AS vollzogen_von_id \
     FROM erinnerung e \
     LEFT JOIN kommunikation_status ks \
            ON ks.objekt_typ = 'erinnerung' AND ks.objekt_id = e.id";
```

> Wichtig: die WHERE-Klauseln in `laden`/`liste`/`faellige_zum_ausloesen` referenzieren Spalten jetzt ggf. mehrdeutig. `ANZEIGE_SELECT` wird nur von `laden` (`WHERE id = ?`) und `liste` (`WHERE einsatz_id = ? ...`) genutzt — beide Spalten in beiden Tabellen vorhanden? Nein: `id`/`einsatz_id`/`status` existieren auch nicht in `kommunikation_status` unter diesen Namen-Kollisionen außer `objekt_id`. Zur Sicherheit die WHERE-Bedingungen in `laden`/`liste` auf `e.`-Präfix umstellen:
> - `laden`: `format!("{ANZEIGE_SELECT} WHERE e.id = ?")`
> - `liste` (nur_offen): `... WHERE e.einsatz_id = ? AND e.status = '{STATUS_OFFEN}' ORDER BY e.faellig_at, e.id`
> - `liste` (sonst): `... WHERE e.einsatz_id = ? ORDER BY e.faellig_at, e.id`

- [ ] **Step 4: Run → pass (neuer Test + alle erinnerung-Tests)**

Run: `rtk proxy cargo test erinnerung:: 2>&1 | tail -25`
Expected: PASS — der neue Test grün, **alle Bestandstests** (`anlegen_setzt_defaults…`, `status_setzen…`, Scheduler-Tests) bleiben grün.

- [ ] **Step 5: Commit**

```bash
git add src/erinnerung/mod.rs src/erinnerung/repo.rs
git commit -m "feat(erinnerung): Anzeige liest Quittung/Vollzug aus kommunikation_status (LFH-84)"
```

---

### Task 6: Endpunkte quittieren/erledigen schreiben kommunikation_status

**Files:**
- Modify: `src/routes/erinnerung.rs`
- Test: `src/routes/erinnerung.rs` (Test-Modul; falls keines existiert, neu anlegen — Muster siehe repo-Tests, Handler via `axum`-Aufruf oder direkter Repo-Pfad)

- [ ] **Step 1: Failing test — quittieren setzt geteilte Quittungs-Achse**

> Handler-Tests brauchen `AppState`. Wenn `src/routes/erinnerung.rs` noch keinen Test-Harness hat, teste die neue Verdrahtung auf Repo-Ebene über einen kleinen Integrationspfad. Konkreter Test (in `src/routes/erinnerung.rs`, `#[cfg(test)] mod tests`):

```rust
#[cfg(test)]
mod tests {
    use crate::kommunikation::{repo as krepo, OBJEKT_ERINNERUNG, VOLLZUG_VOLLZOGEN};
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    // Spiegelt die Wirkung der Handler-Verdrahtung: erledigen → Vollzug 'vollzogen'.
    #[tokio::test]
    async fn erledigen_schreibt_vollzug_in_kommunikation_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = crate::erinnerung::repo::anlegen(
            &pool, e, b,
            crate::erinnerung::repo::ErinnerungDaten { titel: "X", beschreibung: None, faellig_at: "2026-06-11 10:00:00", intervall_minuten: None, empfaenger_funktion: None },
            "2026-06-11 09:00:00").await.unwrap();

        // Wirkung des erledigen-Handlers nachstellen:
        crate::erinnerung::repo::status_setzen(&pool, r.id, crate::erinnerung::STATUS_ERLEDIGT, "2026-06-11 11:00:00").await.unwrap();
        krepo::setze_vollzug(&pool, 1, e, OBJEKT_ERINNERUNG, r.id, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();

        let s = krepo::lade_status(&pool, e, OBJEKT_ERINNERUNG, r.id).await.unwrap().unwrap();
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
        // Scheduler-Treiber unverändert: erinnerung.status ist nicht mehr 'offen'.
        let st: String = sqlx::query_scalar("SELECT status FROM erinnerung WHERE id = ?")
            .bind(r.id).fetch_one(&pool).await.unwrap();
        assert_eq!(st, "erledigt");
    }
}
```

- [ ] **Step 2: Run → fail**

Run: `rtk proxy cargo test routes::erinnerung::tests 2>&1 | tail -20`
Expected: FAIL — Test-Modul/Imports noch nicht vorhanden (bzw. nach Anlage: grün erst nach Step 3-Verdrahtung; dieser Test prüft primär die Repo-Verträge und dient als Guard).

- [ ] **Step 3: Handler verdrahten**

In `src/routes/erinnerung.rs`:

1. Import ergänzen:

```rust
use crate::kommunikation::{repo as krepo, OBJEKT_ERINNERUNG, VOLLZUG_VOLLZOGEN};
```

2. `fordere_bearbeitbar` liefert die `org_id` des Einsatzes zurück (für die geteilten Writes):

```rust
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    erinnerung_id: i64,
) -> Result<i64, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, erinnerung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(einsatz.org_id)
}
```

3. `erledigen` — nach `status_setzen` zusätzlich Vollzug schreiben:

```rust
pub async fn erledigen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    // Scheduler-/Dedup-Treiber unverändert lassen:
    repo::status_setzen(&state.pool, erinnerung_id, STATUS_ERLEDIGT, &now).await?;
    // Geteilte Vollzugs-Achse (Fundament):
    krepo::setze_vollzug(&state.pool, org_id, einsatz_id, OBJEKT_ERINNERUNG, erinnerung_id, VOLLZUG_VOLLZOGEN, benutzer.id, &now).await?;
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}
```

4. `quittieren` — analog mit `krepo::quittiere`:

```rust
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    repo::status_setzen(&state.pool, erinnerung_id, STATUS_QUITTIERT, &now).await?;
    krepo::quittiere(&state.pool, org_id, einsatz_id, OBJEKT_ERINNERUNG, erinnerung_id, benutzer.id, &now).await?;
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}
```

> `STATUS_QUITTIERT` ist bereits importiert (`use crate::erinnerung::{…, STATUS_QUITTIERT}`).

- [ ] **Step 4: Run → pass + Clippy**

Run: `rtk proxy cargo test routes::erinnerung:: 2>&1 | tail -20` → PASS
Run: `rtk proxy cargo clippy --all-targets 2>&1 | tail -15` → keine Warnungen

- [ ] **Step 5: Commit**

```bash
git add src/routes/erinnerung.rs
git commit -m "feat(erinnerung): quittieren/erledigen schreiben kommunikation_status (LFH-84)"
```

---

### Task 7: Scheduler-/Dedup-Regression explizit absichern

**Files:**
- Test: `src/erinnerung/scheduler.rs` (Bestandstests laufen lassen; keine Codeänderung erwartet)

- [ ] **Step 1: Volle erinnerung-Suite grün**

Run: `rtk proxy cargo test erinnerung:: 2>&1 | tail -25`
Expected: PASS — insbesondere `einmalige_loest_genau_einmal_aus`, `wiederkehrende_schiebt_faellig_at_per_skip_forward`, `erledigte_loesen_nicht_aus`, `faellige_publiziert_sse_event_erinnerung`, `auto_frist_ist_idempotent_pro_bezug`. **Keine** dieser Funktionen wurde geändert.

- [ ] **Step 2: Falls eine fehlschlägt** → die WHERE-Präfix-Umstellung aus Task 5 prüfen (`faellige_zum_ausloesen` nutzt **nicht** `ANZEIGE_SELECT`, darf also unverändert bleiben). Kein Commit nötig, wenn keine Änderung; sonst Fix + Commit.

---

### Task 8: Frontend — Achsen im Typ und in der Liste

**Files:**
- Modify: `frontend/src/api/types.ts` (Typ `Erinnerung` — beim Lesen exakte Felder verifizieren)
- Modify: `frontend/src/einsatz/erinnerung/ErinnerungListe.tsx` (Pfad beim Lesen verifizieren)
- Test: `frontend/src/einsatz/erinnerung/ErinnerungListe.test.tsx` (bestehende Testdatei; sonst neben der Komponente anlegen)

- [ ] **Step 1: Typ erweitern**

In `frontend/src/api/types.ts`, Interface `Erinnerung` um die optionalen Achsen-Felder ergänzen (Backend liefert sie immer; `vollzug_status` nie null):

```ts
  quittiert_at: string | null;
  quittiert_von_id: number | null;
  vollzug_status: 'offen' | 'in_arbeit' | 'vollzogen';
  vollzogen_at: string | null;
  vollzogen_von_id: number | null;
```

- [ ] **Step 2: Failing test — Liste zeigt Quittiert-/Vollzogen-Marker**

In `ErinnerungListe.test.tsx` (zuerst die bestehende Datei lesen, Render-Helfer übernehmen). Neuer Testfall:

```tsx
it('zeigt einen Vollzogen-Marker, wenn vollzug_status = vollzogen', () => {
  const erinnerung = macheErinnerung({ vollzug_status: 'vollzogen', vollzogen_at: '2026-06-11 11:00:00' });
  renderListe([erinnerung]);
  expect(screen.getByText(/vollzogen/i)).toBeInTheDocument();
});
```

(`macheErinnerung`/`renderListe`: vorhandene Test-Helfer der Datei verwenden; fehlende Felder mit den Defaults aus Step 1 ergänzen.)

- [ ] **Step 3: Run → fail**

Run: `cd frontend; rtk proxy pnpm vitest run --no-file-parallelism src/einsatz/erinnerung/ErinnerungListe.test.tsx 2>&1 | tail -20`
Expected: FAIL — kein „vollzogen"-Text.

- [ ] **Step 4: Komponente anpassen**

In `ErinnerungListe.tsx` die Achsen rendern: einen antd-`Tag` „Vollzogen" zeigen, wenn `vollzug_status === 'vollzogen'`, und einen `Tag` „Quittiert", wenn `quittiert_at` gesetzt ist (vorhandene Tag-Logik wie „fällig"/„Quelle" als Muster nutzen — Komponente vor der Änderung lesen).

- [ ] **Step 5: Run → pass**

Run: `cd frontend; rtk proxy pnpm vitest run --no-file-parallelism src/einsatz/erinnerung/ErinnerungListe.test.tsx 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/einsatz/erinnerung/
git commit -m "feat(erinnerung): Frontend zeigt Quittung/Vollzug-Achsen (LFH-84)"
```

---

## PHASE 3 — Chat-Retrofit (dünn, ohne Quittung)

> Chat liefert heute schon live über `LiveHub` (Tag `chat`) und referenziert beim Heraufstufen bereits `meldeweg`. „Retrofit" heißt hier: Vokabular-Bezug explizit über `kommunikation` führen und die **optionale** Lesebestätigung (Zustellung) anbinden. Keine Quittung, kein Vollzug.

### Task 9: Chat referenziert Vokabular über kommunikation

**Files:**
- Modify: `src/chat/mod.rs` bzw. `src/chat/repo.rs` (dort, wo `meldeweg` heute genutzt wird — beim Lesen lokalisieren)

- [ ] **Step 1: Bestandsstelle lesen**

Run: `grep -n "meldeweg\|MeldeWeg\|etb::" src/chat/mod.rs src/chat/repo.rs src/routes/chat.rs`

- [ ] **Step 2: Auf `crate::kommunikation::MeldeWeg` umstellen** (falls Chat ein `MeldeWeg`/`EtbTyp` direkt aus `etb` importiert, den Import auf `crate::kommunikation::{…}` umhängen — funktional identisch, dokumentiert die modulübergreifende Referenz). Wenn Chat keinen Enum-Import hat (nur String-Spalten), nur einen Doku-Kommentar setzen, der `kommunikation::MeldeWeg` als kanonische Quelle nennt.

- [ ] **Step 3: Run → bestehende Chat-Tests grün**

Run: `rtk proxy cargo test chat:: 2>&1 | tail -20`
Expected: PASS (unverändert).

- [ ] **Step 4: Commit**

```bash
git add src/chat/
git commit -m "refactor(chat): Vokabular-Bezug über kommunikation-Modul (LFH-84)"
```

---

### Task 10 (Stretch, optional): Lesebestätigung für Chat

> Nur umsetzen, wenn gewünscht — Kern-Retrofit ist Task 9. Bietet einen Endpunkt, der `kommunikation::repo::markiere_gelesen(OBJEKT_CHAT_NACHRICHT, …)` aufruft.

**Files:**
- Modify: `src/routes/chat.rs` (neuer Handler `gelesen`)
- Modify: `src/app.rs` (Route registrieren)
- Modify: `frontend/src/api/chat.ts` (Aufruf), optionale UI

- [ ] **Step 1: Failing test** — Handler-/Repo-Pfad: `markiere_gelesen` für `OBJEKT_CHAT_NACHRICHT` legt genau eine Zustellungszeile je Empfänger an (analog Task 3 `zustellung_gelesen_ist_idempotent_pro_empfaenger`, nur mit `OBJEKT_CHAT_NACHRICHT`).
- [ ] **Step 2: Run → fail**, **Step 3: Endpunkt** `POST /api/einsaetze/{id}/chat/nachrichten/{mid}/gelesen` mit `fordere_lesezugriff` (Lesen genügt, Beobachter darf Lesebestätigung senden) → `krepo::markiere_gelesen`. **Step 4: Route in `src/app.rs`** bei den Chat-Routen registrieren. **Step 5: Run → pass.**
- [ ] **Step 6: Commit** `feat(chat): optionale Lesebestätigung über kommunikation_zustellung (LFH-84)`

---

## Abschluss (nach allen Tasks)

- [ ] **Volle Backend-Suite:** `rtk proxy cargo test 2>&1 | tail -25` → alles grün
- [ ] **Clippy:** `rtk proxy cargo clippy --all-targets 2>&1 | tail -15` → keine Warnungen
- [ ] **Frontend-Suite (Gate):** `cd frontend; rtk proxy pnpm vitest run --no-file-parallelism 2>&1 | tail -25` → grün (`--no-file-parallelism` gegen Last-Flakiness)
- [ ] **Frontend-Build (Binary-Embed):** `cd frontend; rtk proxy pnpm build 2>&1 | tail -5` → Bundle aktualisiert (rust-embed; sonst zeigt cargo-run das alte Bundle)
- [ ] **superpowers:verification-before-completion** vor der „fertig"-Aussage
- [ ] **superpowers:requesting-code-review** vor dem Merge → Board-Status `in review`
```
