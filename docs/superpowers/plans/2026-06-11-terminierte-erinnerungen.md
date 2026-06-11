# Terminierte Erinnerungen (LFH-51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einsatzbezogene terminierte Erinnerungen (einmalig + wiederkehrend) mit serverseitigem Fälligkeits-Scheduler und Live-Auslösung über SSE.

**Architecture:** Neues Backend-Modul `erinnerung` nach dem Muster von `chat` (mod.rs/repo.rs + routes/erinnerung.rs + Migration + tests/erinnerung.rs). Fälligkeit ist **aus dem Timestamp abgeleitet**, nicht vom Tick erzeugt: die „offene Liste" kommt immer aus `status='offen'`, ein `ist_faellig`-Flag wird pro Read aus `faellig_at <= jetzt` berechnet. Ein dünner Tokio-`interval`-Hintergrundtask (`scheduler.rs`) pollt fällige Erinnerungen, publiziert das SSE-Event-Tag `erinnerung` über den bestehenden `LiveHub` und schreibt wiederkehrende Erinnerungen per **skip-forward** (ganze Intervalle über `jetzt` hinaus) fort — kein Nachhol-Sturm. Die Kern-Wiederholungslogik ist eine **reine Funktion** mit injiziertem `jetzt` (unit-testbar). Ein generischer `Bezug`/`Quelle`-Hook (`anlegen_aus_frist`) erlaubt späteren Modulen (Aufträge, LFH-52), automatisch Erinnerungen zu erzeugen; die konkrete Auftrags-Verdrahtung ist auf LFH-52 vertagt.

**Tech Stack:** Rust (axum, sqlx/SQLite, tokio, chrono), React (TypeScript, antd, @tanstack/react-query), Vitest.

---

## Designentscheidungen (gelten für alle Tasks)

- **Zeitformat:** Wie im Bestand (`datetime('now')`, `berechtigung.rs`) das Format `"%Y-%m-%d %H:%M:%S"` in UTC. Fixe Breite → lexikografischer Vergleich = chronologischer Vergleich, daher `WHERE faellig_at <= ?` korrekt.
- **`jetzt` wird injiziert** (Parameter `jetzt: &str` bzw. `DateTime<Utc>`) in alle zeitabhängigen Repo-/Logik-Funktionen — exakt wie `darf_lesen(..., jetzt)` in `berechtigung.rs`. Handler/Scheduler reichen `Utc::now()` formatiert herein.
- **Status-Modell:** `offen` → `erledigt` | `quittiert`. „Offene Liste" = `status = 'offen'`. Erledigte/quittierte verschwinden daraus (AK 3).
- **Einmalig vs. wiederkehrend:** `intervall_minuten IS NULL` = einmalig; `> 0` = wiederkehrend. Einmalige feuern genau einen Live-Nudge (`zuletzt_ausgeloest_at` gesetzt) und bleiben dann überfällig-offen, bis ein Mensch sie erledigt. Wiederkehrende feuern, dann wird `faellig_at` per skip-forward auf den nächsten Slot `> jetzt` gesetzt; sie bleiben offen, bis ein Mensch sie erledigt (= Rhythmus beenden).
- **SSE:** Event-Tag `erinnerung` über den bestehenden Einsatz-`LiveHub`. Kein neuer Stream-Endpoint — `useEinsatzLiveStream` (eine Verbindung/Einsatz) bekommt nur einen Listener. Payload trägt nur `{ einsatz_id }`; das Frontend invalidiert die Query (Muster wie `chat`).
- **Empfänger/Funktion:** Freitextfeld `empfaenger_funktion` (kein FK). Begründung: ein echtes Funktionen-/Stab-Modell existiert noch nicht (`stab` ist `wip`). Für den MVP genügt Freitext; späterer FK ist additiv.
- **Auto-Quelle (AK 2):** generische Spalten `bezug_typ`/`bezug_id` + `quelle` und die idempotente Funktion `anlegen_aus_frist`. End-to-End-Verdrahtung an Aufträge ist auf **LFH-52 / LFH-92** vertagt (dort als ClickUp-Kommentar vermerkt). Dieses eine AK bleibt bis dahin offen; in diesem Plan wird der Hook mit einem Test-Double (simulierte Auftragsfrist) nachgewiesen.
- **Scheduler-Spawn:** nur in `main.rs::run_server` (Produktivlauf), **nicht** in `build_router` — damit Integrationstests keinen Hintergrundtask starten und die Tick-Logik deterministisch (per `tick_einmal(..., jetzt)`) getestet wird.

---

## File Structure

**Backend (erstellen):**
- `migrations/0044_erinnerung.sql` — Tabelle `erinnerung`.
- `src/erinnerung/mod.rs` — Modul-Deklaration + `ErinnerungAnzeige` (Serialize/FromRow), Konstanten.
- `src/erinnerung/repo.rs` — CRUD, Status, Cross-Einsatz-Guard, Scheduler-Queries, Auto-Quelle-Hook, Tests.
- `src/erinnerung/faelligkeit.rs` — reine Funktion `naechste_faelligkeit` (skip-forward), Tests.
- `src/erinnerung/scheduler.rs` — `tick_einmal` (async, testbar) + `starte_scheduler` (dünner Tokio-Wrapper).
- `src/routes/erinnerung.rs` — HTTP-Handler.
- `tests/erinnerung.rs` — Integrationstests (HTTP-Ebene).

**Backend (ändern):**
- `src/lib.rs` — `pub mod erinnerung;` registrieren.
- `src/routes/mod.rs` — `pub mod erinnerung;`.
- `src/app.rs` — 4 Routen registrieren.
- `src/main.rs` — `erinnerung::scheduler::starte_scheduler(pool.clone(), live.clone())` nach AppState-Bau.

**Frontend (erstellen):**
- `frontend/src/api/erinnerungen.ts` — API-Wrapper.
- `frontend/src/pages/ErinnerungenPage.tsx` — Seite (Liste + Formular + Aktionen).
- `frontend/src/pages/ErinnerungenPage.test.tsx` — Page-Tests.
- `frontend/src/erinnerung/ErinnerungFormular.tsx` — presentational Anlege-Formular.
- `frontend/src/erinnerung/ErinnerungListe.tsx` — presentational Liste mit Fällig-Hervorhebung + Aktionen.
- `frontend/src/erinnerung/ErinnerungListe.test.tsx`, `frontend/src/erinnerung/ErinnerungFormular.test.tsx`.

**Frontend (ändern):**
- `frontend/src/api/types.ts` — `Erinnerung` + Eingabetypen.
- `frontend/src/etb/useEinsatzLiveStream.ts` — Listener `erinnerung` → invalidiert `einsatz-erinnerungen` (+ in `onLag`).
- `frontend/src/App.tsx` — Import + `erinnerungen: <ErinnerungenPage />` in `MODUL_ELEMENTE`.
- `frontend/src/einsatz/modulRegistry.ts` — `erinnerungen`-Eintrag `status: 'geplant'` → `'fertig'` (zuletzt).

---

## Task 1: Migration + Anzeige-Typ + Repo-CRUD

**Files:**
- Create: `migrations/0044_erinnerung.sql`
- Create: `src/erinnerung/mod.rs`
- Create: `src/erinnerung/repo.rs`
- Modify: `src/lib.rs` (add `pub mod erinnerung;`)

- [ ] **Step 1: Migration schreiben**

`migrations/0044_erinnerung.sql`:

```sql
-- Terminierte Erinnerungen / Wiedervorlage / Fristen (LFH-51): Rhythmen und
-- Fristen der Stabsarbeit (z. B. Lagemeldung alle 30 Min). Fälligkeit wird aus
-- faellig_at abgeleitet (nicht vom Scheduler erzeugt); der Scheduler liefert nur
-- den Live-Nudge und schreibt wiederkehrende Erinnerungen per skip-forward fort.
CREATE TABLE erinnerung (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    titel               TEXT    NOT NULL,
    beschreibung        TEXT,
    -- Nächster Fälligkeitszeitpunkt (UTC, 'YYYY-MM-DD HH:MM:SS').
    faellig_at          TEXT    NOT NULL,
    -- NULL = einmalig; > 0 = Wiederholungsintervall in Minuten.
    intervall_minuten   INTEGER,
    -- Freitext-Empfänger/Funktion (noch kein FK; Stab-Modell folgt später).
    empfaenger_funktion TEXT,
    -- Generischer Bezug/Quelle für Auto-Erzeugung (z. B. 'auftrag' + Auftrags-ID).
    -- Kein harter FK, da auf wechselnde Tabellen zeigend.
    bezug_typ           TEXT,
    bezug_id            INTEGER,
    -- Herkunft: 'manuell' | 'auto_frist'.
    quelle              TEXT    NOT NULL DEFAULT 'manuell',
    -- Lebenszyklus: 'offen' | 'erledigt' | 'quittiert'.
    status              TEXT    NOT NULL DEFAULT 'offen',
    erledigt_at         TEXT,
    -- Letzter Live-Nudge des Schedulers (verhindert Doppel-Benachrichtigung).
    zuletzt_ausgeloest_at TEXT,
    erstellt_von_id     INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_erinnerung_einsatz_status ON erinnerung(einsatz_id, status, faellig_at);
-- Idempotenz der Auto-Quelle: je Bezug höchstens eine offene Auto-Erinnerung.
CREATE UNIQUE INDEX idx_erinnerung_auto_bezug
    ON erinnerung(bezug_typ, bezug_id)
    WHERE quelle = 'auto_frist' AND status = 'offen';
```

- [ ] **Step 2: Modul-Skelett + Anzeige-Typ**

`src/erinnerung/mod.rs`:

```rust
pub mod faelligkeit;
pub mod repo;
pub mod scheduler;

use serde::Serialize;

/// Öffentliche Darstellung einer Erinnerung. `ist_faellig` wird pro Read aus
/// `faellig_at <= jetzt` berechnet (nicht persistiert) — die Fälligkeit ist
/// damit unabhängig davon korrekt, ob/wann der Scheduler-Tick lief.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ErinnerungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub titel: String,
    pub beschreibung: Option<String>,
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<String>,
    pub bezug_typ: Option<String>,
    pub bezug_id: Option<i64>,
    pub quelle: String,
    pub status: String,
    pub erledigt_at: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: `faellig_at <= jetzt` zum Zeitpunkt der Abfrage.
    pub ist_faellig: bool,
}

pub const STATUS_OFFEN: &str = "offen";
pub const STATUS_ERLEDIGT: &str = "erledigt";
pub const STATUS_QUITTIERT: &str = "quittiert";
pub const QUELLE_MANUELL: &str = "manuell";
pub const QUELLE_AUTO_FRIST: &str = "auto_frist";
```

`src/lib.rs` — Modul registrieren (alphabetisch zu den übrigen `pub mod`-Zeilen einsortieren):

```rust
pub mod erinnerung;
```

- [ ] **Step 3: Repo-CRUD schreiben (anlegen, liste, laden, gehoert_zu_einsatz, status_setzen)**

`src/erinnerung/repo.rs`:

```rust
use super::{ErinnerungAnzeige, STATUS_ERLEDIGT, STATUS_OFFEN, STATUS_QUITTIERT};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für eine neue (manuelle) Erinnerung — bereits vom Handler validiert.
#[derive(Debug)]
pub struct ErinnerungDaten<'a> {
    pub titel: &'a str,
    pub beschreibung: Option<&'a str>,
    /// 'YYYY-MM-DD HH:MM:SS' (UTC).
    pub faellig_at: &'a str,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<&'a str>,
}

/// SELECT-Projektion inkl. abgeleitetem `ist_faellig`. `jetzt` wird als erster
/// positionaler `?`-Parameter gebunden (steht textuell vor der WHERE-Klausel),
/// danach die WHERE-Parameter — wie im `chat`-Repo durchgehend `?` (keine
/// numbered binds, deren sqlx-SQLite-Verhalten hier unnötig riskant wäre).
const ANZEIGE_SELECT: &str =
    "SELECT id, einsatz_id, titel, beschreibung, faellig_at, intervall_minuten, \
            empfaenger_funktion, bezug_typ, bezug_id, quelle, status, erledigt_at, \
            erstellt_von_id, erstellt_at, \
            (faellig_at <= ?) AS ist_faellig \
     FROM erinnerung";

/// Lädt eine Erinnerung als Anzeige. `NotFound`, wenn sie nicht existiert.
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<ErinnerungAnzeige, AppError> {
    sqlx::query_as::<_, ErinnerungAnzeige>(&format!("{ANZEIGE_SELECT} WHERE id = ?"))
        .bind(jetzt)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Listet Erinnerungen eines Einsatzes. `nur_offen` filtert auf `status='offen'`.
/// Sortierung: nach Fälligkeit aufsteigend (älteste/überfälligste zuerst).
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `einsatz_id` (WHERE).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    nur_offen: bool,
    jetzt: &str,
) -> Result<Vec<ErinnerungAnzeige>, AppError> {
    let sql = if nur_offen {
        format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? AND status = '{STATUS_OFFEN}' ORDER BY faellig_at, id")
    } else {
        format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? ORDER BY faellig_at, id")
    };
    sqlx::query_as::<_, ErinnerungAnzeige>(&sql)
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Legt eine manuelle Erinnerung an und liefert sie als Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: ErinnerungDaten<'_>,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO erinnerung \
           (einsatz_id, titel, beschreibung, faellig_at, intervall_minuten, \
            empfaenger_funktion, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.titel)
    .bind(daten.beschreibung)
    .bind(daten.faellig_at)
    .bind(daten.intervall_minuten)
    .bind(daten.empfaenger_funktion)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, id, jetzt).await
}

/// Prüft, ob eine Erinnerung zum Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM erinnerung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt den Status (erledigt/quittiert) und `erledigt_at = jetzt`.
/// Nur erlaubte Zielstatus; sonst `Validation`.
pub async fn status_setzen(
    pool: &SqlitePool,
    id: i64,
    neuer_status: &str,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    if neuer_status != STATUS_ERLEDIGT && neuer_status != STATUS_QUITTIERT {
        return Err(AppError::Validation("Ungültiger Zielstatus".into()));
    }
    sqlx::query("UPDATE erinnerung SET status = ?, erledigt_at = ? WHERE id = ?")
        .bind(neuer_status)
        .bind(jetzt)
        .bind(id)
        .execute(pool)
        .await?;
    laden(pool, id, jetzt).await
}
```

- [ ] **Step 4: Repo-CRUD-Tests schreiben**

Am Ende von `src/erinnerung/repo.rs` anfügen (das `setup`-Helper-Muster ist 1:1 aus `chat/repo.rs` übernommen):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::erinnerung::{QUELLE_MANUELL, STATUS_OFFEN};

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an; liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn daten<'a>(titel: &'a str, faellig: &'a str, intervall: Option<i64>) -> ErinnerungDaten<'a> {
        ErinnerungDaten { titel, beschreibung: None, faellig_at: faellig, intervall_minuten: intervall, empfaenger_funktion: None }
    }

    #[tokio::test]
    async fn anlegen_setzt_defaults_und_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;

        let r = anlegen(&pool, e, b, daten("Lagemeldung", "2026-06-11 10:00:00", Some(30)), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(r.titel, "Lagemeldung");
        assert_eq!(r.status, STATUS_OFFEN);
        assert_eq!(r.quelle, QUELLE_MANUELL);
        assert!(!r.ist_faellig, "9:00 < 10:00 → noch nicht fällig");

        let liste = liste(&pool, e, true, "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(liste.len(), 1);
    }

    #[tokio::test]
    async fn ist_faellig_wird_aus_jetzt_abgeleitet() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();

        let spaeter = laden(&pool, r.id, "2026-06-11 10:30:00").await.unwrap();
        assert!(spaeter.ist_faellig, "10:30 >= 10:00 → fällig");
    }

    #[tokio::test]
    async fn status_setzen_entfernt_aus_offener_liste() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();

        let erledigt = status_setzen(&pool, r.id, STATUS_ERLEDIGT, "2026-06-11 11:00:00").await.unwrap();
        assert_eq!(erledigt.status, STATUS_ERLEDIGT);
        assert!(erledigt.erledigt_at.is_some());

        let offen = liste(&pool, e, true, "2026-06-11 11:00:00").await.unwrap();
        assert!(offen.is_empty(), "erledigte verschwinden aus der offenen Liste");
        let alle = liste(&pool, e, false, "2026-06-11 11:00:00").await.unwrap();
        assert_eq!(alle.len(), 1, "bleibt in der Gesamtliste");
    }

    #[tokio::test]
    async fn status_setzen_lehnt_ungueltigen_status_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();
        assert!(matches!(status_setzen(&pool, r.id, "offen", "2026-06-11 11:00:00").await.unwrap_err(), AppError::Validation(_)));
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, r.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, r.id, 999).await.unwrap());
    }
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `rtk proxy cargo test --lib erinnerung::repo`
Expected: PASS (5 Tests). Bei Bedarf zuerst `cd frontend && pnpm build` (rust-embed braucht `frontend/dist`), dann `cargo test`.

- [ ] **Step 6: Commit**

```bash
git add migrations/0044_erinnerung.sql src/erinnerung/mod.rs src/erinnerung/repo.rs src/lib.rs
git commit -m "feat(erinnerung): Migration + Anzeige-Typ + Repo-CRUD (LFH-51)"
```

> Hinweis: `src/erinnerung/mod.rs` deklariert `faelligkeit` und `scheduler` — lege in diesem Commit leere Platzhalter an (`// in Task 2/3` als einzige Zeile) ODER kommentiere die beiden `pub mod`-Zeilen aus und aktiviere sie in Task 2/3. Empfohlen: Platzhalterdateien anlegen, damit der Build grün bleibt.

---

## Task 2: Reine Wiederholungsfunktion (skip-forward)

**Files:**
- Create/replace: `src/erinnerung/faelligkeit.rs`

- [ ] **Step 1: Failing test schreiben**

`src/erinnerung/faelligkeit.rs`:

```rust
//! Reine, zeit-injizierte Fälligkeitslogik für wiederkehrende Erinnerungen.
//! Bewusst ohne DB/Wall-Clock, damit unit-testbar (vgl. berechtigung.rs).

use chrono::{DateTime, Duration, Utc};

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap().and_utc()
    }

    #[test]
    fn schiebt_um_genau_ein_intervall_wenn_knapp_ueberfaellig() {
        // fällig 10:00, Intervall 30min, jetzt 10:05 → nächster Slot 10:30.
        assert_eq!(naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:05:00")), t("2026-06-11 10:30:00"));
    }

    #[test]
    fn skip_forward_ueberspringt_verpasste_slots_ohne_sturm() {
        // Server war 2h aus: fällig 10:00, Intervall 30min, jetzt 12:10
        // → nicht 10:30/11:00/…, sondern der erste Slot > jetzt: 12:30.
        assert_eq!(naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 12:10:00")), t("2026-06-11 12:30:00"));
    }

    #[test]
    fn exakt_auf_slot_schiebt_auf_naechsten() {
        // jetzt == fällig → nächster echter Slot in der Zukunft.
        assert_eq!(naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:00:00")), t("2026-06-11 10:30:00"));
    }
}
```

- [ ] **Step 2: Test laufen lassen → fehlschlägt**

Run: `rtk proxy cargo test --lib erinnerung::faelligkeit`
Expected: FAIL (`naechste_faelligkeit` nicht definiert).

- [ ] **Step 3: Implementierung**

Oberhalb des `#[cfg(test)]`-Blocks in `src/erinnerung/faelligkeit.rs` einfügen:

```rust
/// Liefert den nächsten Fälligkeitszeitpunkt einer wiederkehrenden Erinnerung,
/// der **echt nach `jetzt`** liegt (skip-forward). Verpasste Slots (Server aus,
/// Lag) werden übersprungen — kein Nachhol-Sturm. `intervall_min` muss > 0 sein.
pub fn naechste_faelligkeit(
    faellig: DateTime<Utc>,
    intervall_min: i64,
    jetzt: DateTime<Utc>,
) -> DateTime<Utc> {
    let schritt = Duration::minutes(intervall_min.max(1));
    let mut next = faellig;
    // Mindestens einen Schritt; dann so lange, bis der Slot in der Zukunft liegt.
    loop {
        next += schritt;
        if next > jetzt {
            return next;
        }
    }
}
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `rtk proxy cargo test --lib erinnerung::faelligkeit`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/erinnerung/faelligkeit.rs
git commit -m "feat(erinnerung): reine skip-forward-Wiederholungslogik (LFH-51)"
```

---

## Task 3: Scheduler-Queries + Tick-Kern

**Files:**
- Modify: `src/erinnerung/repo.rs` (Funktionen `faellige_zum_ausloesen`, `markiere_ausgeloest`)
- Create/replace: `src/erinnerung/scheduler.rs` (`tick_einmal`)

- [ ] **Step 1: Repo-Scheduler-Queries schreiben**

In `src/erinnerung/repo.rs` (vor dem `#[cfg(test)]`-Block) anfügen:

```rust
/// Eine fällige, offene Erinnerung, die ein Scheduler-Nudge braucht.
/// `intervall_minuten` entscheidet einmalig vs. wiederkehrend in `tick_einmal`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FaelligeErinnerung {
    pub id: i64,
    pub einsatz_id: i64,
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
}

/// Liefert offene Erinnerungen, die fällig sind (`faellig_at <= jetzt`) und für
/// ihren aktuellen `faellig_at`-Slot noch nicht benachrichtigt wurden
/// (`zuletzt_ausgeloest_at IS NULL OR zuletzt_ausgeloest_at < faellig_at`).
/// Einsatzübergreifend — der Scheduler läuft global.
pub async fn faellige_zum_ausloesen(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<Vec<FaelligeErinnerung>, AppError> {
    sqlx::query_as::<_, FaelligeErinnerung>(
        "SELECT id, einsatz_id, faellig_at, intervall_minuten \
         FROM erinnerung \
         WHERE status = 'offen' AND faellig_at <= ?1 \
           AND (zuletzt_ausgeloest_at IS NULL OR zuletzt_ausgeloest_at < faellig_at) \
         ORDER BY faellig_at, id",
    )
    .bind(jetzt)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Markiert eine Erinnerung als ausgelöst. Bei wiederkehrenden wird zugleich
/// `faellig_at` auf `neues_faellig_at` (skip-forward) gesetzt; bei einmaligen
/// bleibt `faellig_at` und nur `zuletzt_ausgeloest_at` wird gesetzt.
pub async fn markiere_ausgeloest(
    pool: &SqlitePool,
    id: i64,
    neues_faellig_at: Option<&str>,
    jetzt: &str,
) -> Result<(), AppError> {
    match neues_faellig_at {
        Some(neu) => {
            sqlx::query("UPDATE erinnerung SET faellig_at = ?, zuletzt_ausgeloest_at = ? WHERE id = ?")
                .bind(neu).bind(jetzt).bind(id).execute(pool).await?;
        }
        None => {
            sqlx::query("UPDATE erinnerung SET zuletzt_ausgeloest_at = ? WHERE id = ?")
                .bind(jetzt).bind(id).execute(pool).await?;
        }
    }
    Ok(())
}
```

- [ ] **Step 2: `tick_einmal` + Test schreiben**

`src/erinnerung/scheduler.rs`:

```rust
//! Zeitbasierter Scheduler für Erinnerungen: ein dünner Tokio-`interval`-Task
//! ruft periodisch `tick_einmal`. Die Fälligkeit ist aus `faellig_at` abgeleitet
//! (siehe repo) — ein verpasster Tick verzögert nur den Live-Nudge, nicht die
//! Korrektheit der offenen Liste.

use crate::erinnerung::faelligkeit::naechste_faelligkeit;
use crate::erinnerung::repo;
use crate::live::LiveHub;
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Schedulers.
const TICK_SEKUNDEN: u64 = 30;

/// Formatiert einen UTC-Zeitpunkt im kanonischen DB-Format.
fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Parst einen DB-Zeitstempel; bei Unparsbarkeit `None` (defensiv).
fn parse(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok().map(|n| n.and_utc())
}

/// Ein Scheduler-Durchlauf für den Zeitpunkt `jetzt`. Publiziert je fälliger
/// Erinnerung ein SSE-Event `erinnerung` (Payload nur `{einsatz_id}`) und
/// schreibt wiederkehrende per skip-forward fort. Async + injiziertes `jetzt`
/// = deterministisch testbar.
pub async fn tick_einmal(pool: &SqlitePool, live: &LiveHub, jetzt: DateTime<Utc>) -> usize {
    let jetzt_s = fmt(jetzt);
    let faellige = match repo::faellige_zum_ausloesen(pool, &jetzt_s).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Scheduler-Abfrage fehlgeschlagen: {e}");
            return 0;
        }
    };

    let mut ausgeloest = 0;
    for f in &faellige {
        let neu = match (f.intervall_minuten, parse(&f.faellig_at)) {
            (Some(iv), Some(fa)) if iv > 0 => Some(fmt(naechste_faelligkeit(fa, iv, jetzt))),
            _ => None, // einmalig oder unparsbar → nur als ausgelöst markieren
        };
        if let Err(e) = repo::markiere_ausgeloest(pool, f.id, neu.as_deref(), &jetzt_s).await {
            tracing::warn!("Scheduler-Update {id} fehlgeschlagen: {e}", id = f.id);
            continue;
        }
        live.publiziere_event(
            f.einsatz_id,
            "erinnerung",
            serde_json::json!({ "einsatz_id": f.einsatz_id }).to_string(),
        );
        ausgeloest += 1;
    }
    ausgeloest
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::erinnerung::repo::ErinnerungDaten;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap().and_utc()
    }

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

    #[tokio::test]
    async fn einmalige_loest_genau_einmal_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Einmal", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        // Vor Fälligkeit: nichts.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 09:30:00")).await, 0);
        // Nach Fälligkeit: genau einmal.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        // Erneuter Tick: kein Doppel-Nudge.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:02:00")).await, 0);
    }

    #[tokio::test]
    async fn wiederkehrende_schiebt_faellig_at_per_skip_forward() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let r = repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Lagemeldung", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: Some(30), empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        // Server „2h weg": jetzt 12:10 → ein Nudge, nächster Slot 12:30 (kein Sturm).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:10:00")).await, 1);
        let nachher = repo::laden(&pool, r.id, "2026-06-11 12:10:00").await.unwrap();
        assert_eq!(nachher.faellig_at, "2026-06-11 12:30:00");
        // Sofortiger zweiter Tick: nichts (12:30 > 12:10).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:11:00")).await, 0);
    }

    #[tokio::test]
    async fn erledigte_loesen_nicht_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let r = repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "X", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();
        repo::status_setzen(&pool, r.id, crate::erinnerung::STATUS_ERLEDIGT, "2026-06-11 09:30:00").await.unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 0);
    }

    #[tokio::test]
    async fn faellige_publiziert_sse_event_erinnerung() {
        // Deckt das AK „Live-Auslösung über SSE" direkt ab: ein Abonnent des
        // Einsatz-LiveHub erhält beim Tick ein Event mit Tag `erinnerung`.
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);
        repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Lagemeldung", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        let nachricht = rx.recv().await.unwrap();
        assert_eq!(nachricht.event, "erinnerung");
    }
}

/// Startet den Hintergrund-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_scheduler(pool: SqlitePool, live: LiveHub) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        loop {
            ticker.tick().await;
            tick_einmal(&pool, &live, Utc::now()).await;
        }
    });
}
```

- [ ] **Step 3: Tests laufen lassen**

Run: `rtk proxy cargo test --lib erinnerung::scheduler`
Expected: PASS (4 Tests).

- [ ] **Step 4: Commit**

```bash
git add src/erinnerung/repo.rs src/erinnerung/scheduler.rs
git commit -m "feat(erinnerung): Scheduler-Queries + testbarer Tick-Kern (LFH-51)"
```

---

## Task 4: Scheduler im Server starten

**Files:**
- Modify: `src/main.rs:75-82` (nach AppState-Bau)

- [ ] **Step 1: Spawn einhängen**

In `src/main.rs`, `run_server`: VOR `build_router_mit_karte` den Pool/Hub klonbar halten und den Scheduler starten. Ersetze den Block ab `let app = build_router_mit_karte(` durch:

```rust
    let live = LiveHub::new();
    // Zeitbasierte Erinnerungen: Hintergrund-Scheduler starten (nur im Server-Lauf).
    lifeline_hub::erinnerung::scheduler::starte_scheduler(pool.clone(), live.clone());

    let app = build_router_mit_karte(
        AppState {
            pool,
            live,
            fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        },
        karte,
    );
```

- [ ] **Step 2: Build prüfen**

Run: `rtk proxy cargo build`
Expected: kompiliert ohne Fehler. (`pool` ist `SqlitePool` = `Clone`; `LiveHub` ist `Clone`.)

- [ ] **Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat(erinnerung): Scheduler beim Serverstart spawnen (LFH-51)"
```

---

## Task 5: Auto-Quelle-Hook (generisch, idempotent)

**Files:**
- Modify: `src/erinnerung/repo.rs` (`anlegen_aus_frist`)

> **Scope:** Generischer Hook + Idempotenz, nachgewiesen mit Test-Double (simulierte Auftragsfrist). Konkrete Auftrags-Verdrahtung ist auf LFH-52/LFH-92 vertagt (ClickUp-Kommentar gesetzt). AK 2 bleibt bis dahin offen.

- [ ] **Step 1: Failing test schreiben**

In den `#[cfg(test)] mod tests` von `src/erinnerung/repo.rs` ergänzen:

```rust
    #[tokio::test]
    async fn auto_frist_ist_idempotent_pro_bezug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;

        // Test-Double: „Auftrag 42 hat Quittungsfrist überschritten".
        let erst = anlegen_aus_frist(&pool, e, b, "auftrag", 42, "Nachfass: Auftrag 42 unquittiert", "2026-06-11 10:00:00", "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(erst.quelle, crate::erinnerung::QUELLE_AUTO_FRIST);
        assert_eq!(erst.bezug_typ.as_deref(), Some("auftrag"));
        assert_eq!(erst.bezug_id, Some(42));

        // Zweiter Aufruf für denselben offenen Bezug → keine Dublette, gleiche ID.
        let zweit = anlegen_aus_frist(&pool, e, b, "auftrag", 42, "Nachfass: Auftrag 42 unquittiert", "2026-06-11 10:05:00", "2026-06-11 10:05:00").await.unwrap();
        assert_eq!(zweit.id, erst.id);

        let alle = liste(&pool, e, false, "2026-06-11 10:05:00").await.unwrap();
        assert_eq!(alle.len(), 1, "nur eine Auto-Erinnerung je Bezug");
    }
```

- [ ] **Step 2: Test laufen lassen → fehlschlägt**

Run: `rtk proxy cargo test --lib erinnerung::repo::tests::auto_frist`
Expected: FAIL (`anlegen_aus_frist` nicht definiert).

- [ ] **Step 3: Implementierung**

In `src/erinnerung/repo.rs` (vor dem Testblock) anfügen:

```rust
/// Generischer Auto-Quelle-Hook: erzeugt eine Erinnerung/Nachfass aus einer
/// überschrittenen Frist eines beliebigen Bezugs (z. B. Auftrag, Meldung).
/// **Idempotent** je offenem Bezug — der partielle UNIQUE-Index verhindert
/// Dubletten; bei bereits vorhandener offener Auto-Erinnerung wird die
/// bestehende zurückgeliefert. Für späteres Wiring durch das Aufträge-Modul
/// (LFH-52); dort wird `bezug_typ='auftrag'` + Auftrags-ID übergeben.
pub async fn anlegen_aus_frist(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    bezug_typ: &str,
    bezug_id: i64,
    titel: &str,
    faellig_at: &str,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    // Idempotenz: existiert bereits eine offene Auto-Erinnerung für den Bezug?
    let vorhanden: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = ? AND bezug_id = ?",
    )
    .bind(bezug_typ)
    .bind(bezug_id)
    .fetch_optional(pool)
    .await?;
    if let Some(id) = vorhanden {
        return laden(pool, id, jetzt).await;
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO erinnerung \
           (einsatz_id, titel, faellig_at, bezug_typ, bezug_id, quelle, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, 'auto_frist', ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(titel)
    .bind(faellig_at)
    .bind(bezug_typ)
    .bind(bezug_id)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, id, jetzt).await
}
```

- [ ] **Step 4: Test laufen lassen → grün**

Run: `rtk proxy cargo test --lib erinnerung::repo`
Expected: PASS (alle Repo-Tests inkl. `auto_frist`).

- [ ] **Step 5: Commit**

```bash
git add src/erinnerung/repo.rs
git commit -m "feat(erinnerung): generischer Auto-Quelle-Hook mit Idempotenz (LFH-51)"
```

---

## Task 6: HTTP-Routen + Integrationstests

**Files:**
- Create: `src/routes/erinnerung.rs`
- Modify: `src/routes/mod.rs` (add `pub mod erinnerung;`)
- Modify: `src/app.rs` (4 Routen registrieren)
- Create: `tests/erinnerung.rs`

- [ ] **Step 1: Handler schreiben**

`src/routes/erinnerung.rs` (Gating-Muster 1:1 aus `routes/chat.rs`):

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::erinnerung::{repo, ErinnerungAnzeige, STATUS_ERLEDIGT, STATUS_QUITTIERT};
use crate::error::AppError;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Erinnerungen des Einsatzes haben sich geändert (Tag `erinnerung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "erinnerung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `true` → nur offene Erinnerungen.
    pub nur_offen: Option<bool>,
}

/// GET /api/einsaetze/{id}/erinnerungen — Erinnerungen listen (Lesezugriff).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<ErinnerungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let nur_offen = params.nur_offen.unwrap_or(false);
    Ok(Json(repo::liste(&state.pool, einsatz_id, nur_offen, &jetzt()).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueErinnerung {
    pub titel: String,
    pub beschreibung: Option<String>,
    /// 'YYYY-MM-DD HH:MM' oder mit Sekunden (UTC).
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<String>,
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
/// Akzeptiert mit/ohne Sekunden; sonst `Validation`.
fn parse_faellig(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Fälligkeitszeitpunkt".into()))
}

/// POST /api/einsaetze/{id}/erinnerungen — Erinnerung anlegen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueErinnerung>,
) -> Result<(StatusCode, Json<ErinnerungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let titel = req.titel.trim();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    if let Some(iv) = req.intervall_minuten {
        if iv <= 0 {
            return Err(AppError::Validation("Intervall muss positiv sein".into()));
        }
    }
    let faellig = parse_faellig(&req.faellig_at)?;
    let beschreibung = req.beschreibung.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let empfaenger = req.empfaenger_funktion.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let r = repo::anlegen(&state.pool, einsatz_id, benutzer.id, repo::ErinnerungDaten {
        titel, beschreibung, faellig_at: &faellig,
        intervall_minuten: req.intervall_minuten, empfaenger_funktion: empfaenger,
    }, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(r)))
}

/// Gemeinsamer Vorlauf für Status-Übergänge: Gates + Cross-Einsatz-Schutz.
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    erinnerung_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, erinnerung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/erledigen — Status → erledigt.
pub async fn erledigen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let r = repo::status_setzen(&state.pool, erinnerung_id, STATUS_ERLEDIGT, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/quittieren — Status → quittiert.
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let r = repo::status_setzen(&state.pool, erinnerung_id, STATUS_QUITTIERT, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}
```

- [ ] **Step 2: Module + Routen registrieren**

`src/routes/mod.rs` — `pub mod erinnerung;` einsortieren.

`src/app.rs` — nach den `chat`-Routen (Zeile ~69) einfügen:

```rust
        .route("/api/einsaetze/{id}/erinnerungen", get(routes::erinnerung::liste))
        .route("/api/einsaetze/{id}/erinnerungen", post(routes::erinnerung::anlegen))
        .route("/api/einsaetze/{id}/erinnerungen/{eid}/erledigen", post(routes::erinnerung::erledigen))
        .route("/api/einsaetze/{id}/erinnerungen/{eid}/quittieren", post(routes::erinnerung::quittieren))
```

- [ ] **Step 3: Build prüfen**

Run: `rtk proxy cargo build`
Expected: kompiliert ohne Fehler.

- [ ] **Step 4: Integrationstests schreiben**

`tests/erinnerung.rs` (Setup-Helfer aus `tests/chat.rs` übernommen):

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
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
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
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn anlegen_listen_und_erledigen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00","intervall_minuten":30}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let eid = json["id"].as_i64().unwrap();
    assert_eq!(json["status"], "offen");
    assert_eq!(json["faellig_at"], "2026-06-11 10:00:00", "auf Sekundenformat normalisiert");

    let (status, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen/{eid}/erledigen"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"), &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty(), "erledigte verschwinden aus offener Liste");
}

#[tokio::test]
async fn anlegen_lehnt_leeren_titel_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/erinnerungen"), &admin,
        Some(r#"{"titel":"  ","faellig_at":"2026-06-11 10:00"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn erledigen_anderer_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/erinnerungen"), &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00"}"#)).await;
    let eid = json["id"].as_i64().unwrap();
    // Erinnerung von e1 über e2 ansprechen → NotFound.
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e2}/erinnerungen/{eid}/erledigen"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
```

> `AppError::Validation` → **400 BAD_REQUEST** (ungültige Eingabe), `AppError::NotFound` → 404, `AppError::Conflict` → 409, `AppError::UnprocessableEntity` → 422 (nur Zustandskonflikt): gegen `src/error.rs` verifiziert; `chat`-Tests nutzen dieselben Codes.

- [ ] **Step 5: Tests laufen lassen**

Run: `rtk proxy cargo test --test erinnerung`
Expected: PASS (3 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/erinnerung.rs src/routes/mod.rs src/app.rs tests/erinnerung.rs
git commit -m "feat(erinnerung): HTTP-Routen + Integrationstests (LFH-51)"
```

---

## Task 7: Frontend-Typen + API-Wrapper

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/erinnerungen.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` einfügen:

```typescript
export interface Erinnerung {
  id: number;
  einsatz_id: number;
  titel: string;
  beschreibung: string | null;
  faellig_at: string;
  intervall_minuten: number | null;
  empfaenger_funktion: string | null;
  bezug_typ: string | null;
  bezug_id: number | null;
  quelle: string;
  status: 'offen' | 'erledigt' | 'quittiert';
  erledigt_at: string | null;
  erstellt_von_id: number;
  erstellt_at: string;
  ist_faellig: boolean;
}

export interface NeueErinnerung {
  titel: string;
  beschreibung?: string;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  faellig_at: string;
  intervall_minuten?: number;
  empfaenger_funktion?: string;
}
```

- [ ] **Step 2: API-Wrapper schreiben**

`frontend/src/api/erinnerungen.ts` (Muster aus `api/chat.ts`):

```typescript
import { apiGet, apiSend } from './client';
import type { Erinnerung, NeueErinnerung } from './types';

export function listeErinnerungen(einsatzId: number, nurOffen = false): Promise<Erinnerung[]> {
  const q = nurOffen ? '?nur_offen=true' : '';
  return apiGet<Erinnerung[]>(`/api/einsaetze/${einsatzId}/erinnerungen${q}`);
}

export function legeErinnerungAn(einsatzId: number, daten: NeueErinnerung): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen`, 'POST', daten);
}

export function erledigeErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen/${id}/erledigen`, 'POST');
}

export function quittiereErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen/${id}/quittieren`, 'POST');
}
```

> `apiGet`/`apiSend`-Signaturen gegen `frontend/src/api/client.ts` verifizieren (in `api/chat.ts` identisch genutzt).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: keine Typfehler in den neuen Dateien.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/erinnerungen.ts
git commit -m "feat(erinnerung): Frontend-Typen + API-Wrapper (LFH-51)"
```

---

## Task 8: Presentational-Komponenten (TDD)

**Files:**
- Create: `frontend/src/erinnerung/ErinnerungListe.tsx`
- Create: `frontend/src/erinnerung/ErinnerungListe.test.tsx`
- Create: `frontend/src/erinnerung/ErinnerungFormular.tsx`
- Create: `frontend/src/erinnerung/ErinnerungFormular.test.tsx`

- [ ] **Step 1: Failing test für ErinnerungListe**

`frontend/src/erinnerung/ErinnerungListe.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErinnerungListe from './ErinnerungListe';
import type { Erinnerung } from '../api/types';

function erinnerung(over: Partial<Erinnerung>): Erinnerung {
  return {
    id: 1, einsatz_id: 1, titel: 'Lagemeldung', beschreibung: null,
    faellig_at: '2026-06-11 10:00:00', intervall_minuten: 30, empfaenger_funktion: null,
    bezug_typ: null, bezug_id: null, quelle: 'manuell', status: 'offen',
    erledigt_at: null, erstellt_von_id: 1, erstellt_at: '2026-06-11 09:00:00',
    ist_faellig: false, ...over,
  };
}

describe('ErinnerungListe', () => {
  it('zeigt Titel und markiert fällige Erinnerungen', () => {
    render(<ErinnerungListe erinnerungen={[erinnerung({ ist_faellig: true })]} darfSchreiben onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.getByText('Lagemeldung')).toBeInTheDocument();
    expect(screen.getByText(/fällig/i)).toBeInTheDocument();
  });

  it('löst onErledigen mit der ID aus', () => {
    const onErledigen = vi.fn();
    render(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben onErledigen={onErledigen} onQuittieren={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /erledigt/i }));
    expect(onErledigen).toHaveBeenCalledWith(1);
  });

  it('blendet Aktionen ohne Schreibrecht aus', () => {
    render(<ErinnerungListe erinnerungen={[erinnerung({})]} darfSchreiben={false} onErledigen={() => {}} onQuittieren={() => {}} />);
    expect(screen.queryByRole('button', { name: /erledigt/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test → fehlschlägt**

Run: `cd frontend && pnpm vitest run src/erinnerung/ErinnerungListe.test.tsx`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: ErinnerungListe implementieren**

`frontend/src/erinnerung/ErinnerungListe.tsx`:

```tsx
import { List, Tag, Button, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Erinnerung } from '../api/types';

interface Props {
  erinnerungen: Erinnerung[];
  darfSchreiben: boolean;
  onErledigen: (id: number) => void;
  onQuittieren: (id: number) => void;
}

/// Gespeicherte UTC-Fälligkeit zur lokalen Anzeige (utc-Plugin global aktiv, s. main.tsx).
function faelligLokal(wert: string): string {
  return dayjs.utc(wert).local().format('YYYY-MM-DD HH:mm');
}

export default function ErinnerungListe({ erinnerungen, darfSchreiben, onErledigen, onQuittieren }: Props) {
  if (erinnerungen.length === 0) {
    return <Typography.Text type="secondary">Keine offenen Erinnerungen.</Typography.Text>;
  }
  return (
    <List
      dataSource={erinnerungen}
      renderItem={(e) => (
        <List.Item
          actions={darfSchreiben ? [
            <Button key="q" size="small" onClick={() => onQuittieren(e.id)}>Quittieren</Button>,
            <Button key="e" size="small" type="primary" onClick={() => onErledigen(e.id)}>Erledigt</Button>,
          ] : []}
        >
          <List.Item.Meta
            title={
              <Space>
                {e.titel}
                {e.ist_faellig && <Tag color="red">fällig</Tag>}
                {e.intervall_minuten && <Tag>alle {e.intervall_minuten} Min</Tag>}
                {e.quelle === 'auto_frist' && <Tag color="orange">automatisch</Tag>}
              </Space>
            }
            description={
              <Space direction="vertical" size={0}>
                <span>fällig: {faelligLokal(e.faellig_at)}</span>
                {e.empfaenger_funktion && <span>für: {e.empfaenger_funktion}</span>}
                {e.beschreibung && <span>{e.beschreibung}</span>}
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
}
```

- [ ] **Step 4: Test → grün**

Run: `cd frontend && pnpm vitest run src/erinnerung/ErinnerungListe.test.tsx`
Expected: PASS (3 Tests).

- [ ] **Step 5: Failing test für ErinnerungFormular**

`frontend/src/erinnerung/ErinnerungFormular.test.tsx`. Die antd-`DatePicker`-Interaktion ist in jsdom flaky; daher wird die risikobehaftete Konvertierung über den **reinen Helfer** `dayjsZuWire` direkt getestet, und die Formular-Tests prüfen nur die Titel-Pflicht-Logik (kein Submit ohne Titel/Fälligkeit):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import ErinnerungFormular, { dayjsZuWire } from './ErinnerungFormular';

dayjs.extend(utc);

describe('dayjsZuWire', () => {
  it('konvertiert lokale Pickerzeit auf UTC-Wireformat', () => {
    // Fester Instant 14:30 UTC, in Lokal-Modus gehalten: der Helfer muss ihn
    // zurück auf 14:30 UTC normalisieren. Auf Nicht-UTC-Maschinen fällt der Test,
    // falls `.utc()` im Helfer fehlt — prüft also den echten local→UTC-Shift.
    expect(dayjsZuWire(dayjs.utc('2026-06-11 14:30:00').local())).toBe('2026-06-11 14:30:00');
  });
});

describe('ErinnerungFormular', () => {
  it('verhindert Anlegen ohne Titel und ohne gewählte Fälligkeit', () => {
    const onAnlegen = vi.fn();
    render(<ErinnerungFormular senden={false} onAnlegen={onAnlegen} />);
    fireEvent.click(screen.getByRole('button', { name: /anlegen/i }));
    expect(onAnlegen).not.toHaveBeenCalled();
  });

  it('verhindert Anlegen mit Titel aber ohne Fälligkeit', () => {
    const onAnlegen = vi.fn();
    render(<ErinnerungFormular senden={false} onAnlegen={onAnlegen} />);
    fireEvent.change(screen.getByLabelText(/titel/i), { target: { value: 'Ablöse prüfen' } });
    fireEvent.click(screen.getByRole('button', { name: /anlegen/i }));
    expect(onAnlegen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Test → fehlschlägt**

Run: `cd frontend && pnpm vitest run src/erinnerung/ErinnerungFormular.test.tsx`
Expected: FAIL (Modul fehlt).

- [ ] **Step 7: ErinnerungFormular implementieren**

`frontend/src/erinnerung/ErinnerungFormular.tsx`. **Zeitkonvention** (empirisch geklärt): wie `EinsatzdatenPage` ein antd-`DatePicker showTime` (lokale Eingabe, vertrautes UX), und wie das ETB (`schnellerfassungModell.ts`) per `dayjs.utc(...)` auf die Leitung. Der Server vergleicht `faellig_at` gegen `Utc::now()` — die Erinnerung **muss** UTC speichern, sonst feuert sie um den TZ-Versatz verschoben (z. B. 14:30 CEST → Nudge 16:30). Anzeige erfolgt in `ErinnerungListe` wieder lokal. Der reine Konvertierungs-Helfer ist exportiert und separat unit-getestet (jsdom läuft auf TZ=UTC, daher prüft der Helfer-Test das Format; das echte TZ-Verhalten greift im Browser):

```tsx
import { useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Space, Form } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { NeueErinnerung } from '../api/types';

/// Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar).
export function dayjsZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

interface Props {
  senden: boolean;
  onAnlegen: (daten: NeueErinnerung) => void;
}

export default function ErinnerungFormular({ senden, onAnlegen }: Props) {
  const [titel, setTitel] = useState('');
  const [faellig, setFaellig] = useState<Dayjs | null>(null);
  const [intervall, setIntervall] = useState<number | null>(null);
  const [empfaenger, setEmpfaenger] = useState('');

  const absenden = () => {
    if (!titel.trim() || !faellig) return;
    onAnlegen({
      titel: titel.trim(),
      faellig_at: dayjsZuWire(faellig),
      intervall_minuten: intervall ?? undefined,
      empfaenger_funktion: empfaenger.trim() || undefined,
    });
    setTitel(''); setFaellig(null); setIntervall(null); setEmpfaenger('');
  };

  return (
    <Form layout="vertical" onFinish={absenden}>
      <Form.Item label="Titel / Anlass">
        <Input aria-label="Titel" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="z. B. Lagemeldung aller EA" />
      </Form.Item>
      <Form.Item label="Fällig">
        <DatePicker showTime format="YYYY-MM-DD HH:mm" value={faellig} onChange={setFaellig} style={{ width: '100%' }} />
      </Form.Item>
      <Space>
        <Form.Item label="Intervall (Min, optional)">
          <InputNumber aria-label="Intervall" min={1} value={intervall} onChange={setIntervall} placeholder="30" />
        </Form.Item>
        <Form.Item label="Empfänger/Funktion (optional)">
          <Input aria-label="Empfänger" value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} />
        </Form.Item>
      </Space>
      <Button type="primary" htmlType="submit" loading={senden}>Anlegen</Button>
    </Form>
  );
}
```

- [ ] **Step 8: Test → grün**

Run: `cd frontend && pnpm vitest run src/erinnerung/ErinnerungFormular.test.tsx`
Expected: PASS (3 Tests: `dayjsZuWire` + 2 Formular-Guards).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/erinnerung/
git commit -m "feat(erinnerung): presentational Liste + Formular mit Tests (LFH-51)"
```

---

## Task 9: ErinnerungenPage (TDD)

**Files:**
- Create: `frontend/src/pages/ErinnerungenPage.tsx`
- Create: `frontend/src/pages/ErinnerungenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

`frontend/src/pages/ErinnerungenPage.test.tsx` (Mock-Muster wie `ChatPage.test.tsx` — die API-Module und `useEinsatzLiveStream` mocken; das genaue Provider-/Mock-Setup an `ChatPage.test.tsx` ausrichten):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import ErinnerungenPage from './ErinnerungenPage';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Hochwasser', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));
vi.mock('../api/erinnerungen', () => ({
  listeErinnerungen: vi.fn().mockResolvedValue([
    { id: 7, einsatz_id: 1, titel: 'Lagemeldung', beschreibung: null, faellig_at: '2026-06-11 10:00:00',
      intervall_minuten: 30, empfaenger_funktion: null, bezug_typ: null, bezug_id: null, quelle: 'manuell',
      status: 'offen', erledigt_at: null, erstellt_von_id: 1, erstellt_at: '2026-06-11 09:00:00', ist_faellig: true },
  ]),
  legeErinnerungAn: vi.fn(), erledigeErinnerung: vi.fn(), quittiereErinnerung: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/erinnerungen']}>
          <Routes><Route path="/einsaetze/:id/erinnerungen" element={<ErinnerungenPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('ErinnerungenPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listet offene Erinnerungen des Einsatzes', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Lagemeldung')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Test → fehlschlägt**

Run: `cd frontend && pnpm vitest run src/pages/ErinnerungenPage.test.tsx`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: ErinnerungenPage implementieren**

`frontend/src/pages/ErinnerungenPage.tsx` (Struktur aus `ChatPage.tsx`):

```tsx
import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  erledigeErinnerung, legeErinnerungAn, listeErinnerungen, quittiereErinnerung,
} from '../api/erinnerungen';
import type { NeueErinnerung } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import ErinnerungListe from '../erinnerung/ErinnerungListe';
import ErinnerungFormular from '../erinnerung/ErinnerungFormular';

export default function ErinnerungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const erinnerungenQuery = useQuery({
    queryKey: ['einsatz-erinnerungen', einsatzId],
    queryFn: () => listeErinnerungen(einsatzId, true),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-erinnerungen', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeueErinnerung) => legeErinnerungAn(einsatzId, daten),
    onSuccess: () => { invalidiere(); message.success('Erinnerung angelegt'); },
    onError: fehler,
  });
  const erledigenMutation = useMutation({
    mutationFn: (eid: number) => erledigeErinnerung(einsatzId, eid),
    onSuccess: invalidiere, onError: fehler,
  });
  const quittierenMutation = useMutation({
    mutationFn: (eid: number) => quittiereErinnerung(einsatzId, eid),
    onSuccess: invalidiere, onError: fehler,
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
  const erinnerungen = erinnerungenQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Erinnerungen' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Erinnerungen</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {erinnerungenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Erinnerungen konnten nicht geladen werden" />
          )}
          <ErinnerungListe
            erinnerungen={erinnerungen}
            darfSchreiben={darfSchreiben}
            onErledigen={(eid) => erledigenMutation.mutate(eid)}
            onQuittieren={(eid) => quittierenMutation.mutate(eid)}
          />
        </Col>
        {darfSchreiben && (
          <Col flex="320px">
            <ErinnerungFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
```

- [ ] **Step 4: Test → grün**

Run: `cd frontend && pnpm vitest run src/pages/ErinnerungenPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ErinnerungenPage.tsx frontend/src/pages/ErinnerungenPage.test.tsx
git commit -m "feat(erinnerung): ErinnerungenPage mit Liste + Formular (LFH-51)"
```

---

## Task 10: Verdrahtung — SSE-Listener, Routing, Modul aktiv

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts`

- [ ] **Step 1: SSE-Listener `erinnerung` ergänzen**

In `frontend/src/etb/useEinsatzLiveStream.ts`:
- Handler definieren: `const onErinnerung = () => inval('einsatz-erinnerungen');`
- in `onLag` aufrufen: `onErinnerung();` (zur Sammel-Invalidierung hinzufügen)
- registrieren: `quelle.addEventListener('erinnerung', onErinnerung);`
- abmelden: `quelle.removeEventListener('erinnerung', onErinnerung);`

- [ ] **Step 2: Page registrieren**

In `frontend/src/App.tsx`:
- Import: `import ErinnerungenPage from './pages/ErinnerungenPage';`
- in `MODUL_ELEMENTE`: `erinnerungen: <ErinnerungenPage />,`

- [ ] **Step 3: Modul auf `fertig` setzen**

In `frontend/src/einsatz/modulRegistry.ts` den `erinnerungen`-Eintrag von `status: 'geplant'` auf `status: 'fertig'` ändern (Zeile 78).

- [ ] **Step 4: Bestehende Live-Stream-Tests prüfen**

Run: `cd frontend && pnpm vitest run src/etb/useEinsatzLiveStream.test.tsx`
Expected: PASS. Falls der Test die registrierten Event-Namen assertiert, `erinnerung` dort ergänzen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/useEinsatzLiveStream.ts frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts
git commit -m "feat(erinnerung): SSE-Listener + Routing + Modul 'fertig' (LFH-51)"
```

---

## Task 11: Gesamt-Verifikation

- [ ] **Step 1: Frontend bauen (rust-embed-Voraussetzung)**

Run: `cd frontend && pnpm build`
Expected: `dist/` aktualisiert.

- [ ] **Step 2: Backend-Tests vollständig**

Run: `rtk proxy cargo test`
Expected: alle grün (inkl. `erinnerung::*` und `--test erinnerung`).

- [ ] **Step 3: Backend-Lint**

Run: `rtk proxy cargo clippy --all-targets`
Expected: keine Warnungen (Projektkonvention; falls `-D warnings` in CI, hart fixen).

- [ ] **Step 4: Frontend-Tests (seriell — Suite ist unter Parallel-Last flaky)**

Run: `cd frontend && rtk proxy pnpm vitest run --no-file-parallelism`
Expected: alle grün (Baseline 433 + neue Tests).

- [ ] **Step 5: Frontend-Lint + Typecheck**

Run: `cd frontend && pnpm lint && pnpm exec tsc --noEmit`
Expected: sauber.

- [ ] **Step 6: Manueller Rauchtest (optional, empfohlen)**

`cargo run` (mit `dev-seeds`), einloggen, Einsatz öffnen → Modul „Erinnerungen": einmalige + wiederkehrende anlegen, Fälligkeit in die nahe Zukunft setzen, ~30 s warten → Liste markiert „fällig" live; Erledigen entfernt aus der Liste.

---

## Self-Review (gegen LFH-51-Spec)

**Spec-Abdeckung:**
- „Erinnerung mit Titel/Anlass, Fälligkeit (Zeitpunkt oder Intervall), Wiederholung, Empfänger/Funktion, Bezug, Status" → Tabelle + Anzeige-Typ + Formular (Task 1, 8). ✅ (Empfänger als Freitext; Bezug generisch.)
- „Auto-Quelle: Fristen aus Aufträgen" → generischer Hook `anlegen_aus_frist` + Idempotenz + Test-Double; End-to-End-Wiring **vertagt auf LFH-52/LFH-92** (dokumentiert). ⚠️ bewusst offen.
- „Wiederkehrende Lagemeldungs-Erinnerung (alle 30 Min)" → Intervall + skip-forward (Task 2, 3). ✅
- „Live-Auslösung über SSE, sichtbar bei der zuständigen Funktion" → Tag `erinnerung` + Listener + Live-Invalidierung (Task 3, 9, 10). ✅
- AK „einmalig + wiederkehrend anlegbar, lösen zum Fälligkeitszeitpunkt aus" → Task 1/3-Tests. ✅
- AK „überschrittene Auftragsfrist erzeugt automatisch Erinnerung" → Hook nachgewiesen, Wiring vertagt. ⚠️
- AK „erledigte/quittierte verschwinden aus offener Liste" → `nur_offen`-Filter + Tests (Task 1, 6). ✅

**Typ-Konsistenz:** `ErinnerungAnzeige`-Felder = `Erinnerung`-TS-Interface = Test-Fixtures; `repo::ErinnerungDaten`/`anlegen`/`status_setzen`/`faellige_zum_ausloesen`/`markiere_ausgeloest`/`anlegen_aus_frist`/`naechste_faelligkeit`/`tick_einmal` durchgehend gleich benannt und signiert. SSE-Tag `erinnerung`, Query-Key `einsatz-erinnerungen` durchgehend.

**Platzhalter:** keine — jeder Code-Schritt enthält vollständigen Code; Validierungen sind konkret (leerer Titel, Intervall > 0, Zeitformat).
