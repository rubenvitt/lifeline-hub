# Einsatzinterner Chat (LFH-50) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einsatzinterner Chat pro Einsatz mit frei anlegbaren Kanälen, Live-Updates über den bestehenden Einsatz-LiveHub, Rollen-Gates (Schreiben = Leitung/Führung, Beobachter lesen mit), Bearbeiten/Soft-Löschen eigener Nachrichten und Heraufstufen einer Nachricht zu einem ETB-Eintrag.

**Architecture:** Vertikales Modul nach dem Muster von ETB/Lagebericht: SQLite-Migration → Domain (`src/chat/mod.rs`) → Repository (`src/chat/repo.rs`) → Routes (`src/routes/chat.rs`) → Router (`src/app.rs`). Frontend: API-Modul (`frontend/src/api/chat.ts`) → presentational Komponenten → `ChatPage`. Live läuft über den vorhandenen kanonischen Stream (`/etb/stream`, `useEinsatzLiveStream`); es wird **kein** eigener SSE-Endpoint angelegt. Heraufstufen spiegelt `lagebericht::freigeben` (Transaktion + Rückverweis).

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TypeScript, antd, @tanstack/react-query, Vitest + MSW + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-10-einsatzinterner-chat-design.md`

---

## File Structure

**Backend — neu:**
- `migrations/0043_chat.sql` — Tabellen `chat_kanal`, `chat_nachricht` + Indizes.
- `src/chat/mod.rs` — Domain-Konstanten + Anzeige-Structs (`ChatKanalAnzeige`, `ChatNachrichtAnzeige`).
- `src/chat/repo.rs` — Persistenz: Kanäle, Nachrichten, Heraufstufen. Unit-Tests inline.
- `src/routes/chat.rs` — HTTP-Handler.
- `tests/chat.rs` — Integrationstests (Rollen-/Aktiv-/Autor-Gates, Cross-Einsatz, Heraufstufen).

**Backend — geändert:**
- `src/lib.rs` — `pub mod chat;` (nach `pub mod backup;`).
- `src/routes/mod.rs` — `pub mod chat;` (nach `pub mod benutzer;`).
- `src/app.rs` — 7 Chat-Routen im Router.

**Frontend — neu:**
- `frontend/src/api/chat.ts` — API-Funktionen.
- `frontend/src/chat/NachrichtenStrom.tsx` (+ `.test.tsx`) — Nachrichtenliste (Tombstone, Bearbeitet-Marker, ETB-Badge, Aktionen für eigene Nachrichten).
- `frontend/src/chat/NachrichtEingabe.tsx` (+ `.test.tsx`) — Eingabefeld + Senden.
- `frontend/src/chat/KanalListe.tsx` (+ `.test.tsx`) — Kanal-Sidebar + Kanal anlegen.
- `frontend/src/chat/HeraufstufenModal.tsx` (+ `.test.tsx`) — ETB-Typ-Auswahl + Text.
- `frontend/src/pages/ChatPage.tsx` (+ `.test.tsx`) — Komposition + Datenanbindung.

**Frontend — geändert:**
- `frontend/src/api/types.ts` — `ChatKanal`, `ChatNachricht`.
- `frontend/src/etb/useEinsatzLiveStream.ts` (+ `.test.tsx`) — `chat`-Event-Listener.
- `frontend/src/App.tsx` — `ChatPage` in `MODUL_ELEMENTE`.
- `frontend/src/einsatz/modulRegistry.ts` — Eintrag `chat` auf `status: 'fertig'`.

**Query-Key-Konvention (PINNED — Reihenfolge ist verbindlich, sonst greift die Live-Invalidierung nicht):**
- Kanäle: `['einsatz-chat-kanaele', einsatzId]`
- Nachrichten: `['einsatz-chat-nachrichten', einsatzId, kanalId]` — `einsatzId` **vor** `kanalId`, damit `invalidateQueries({ queryKey: ['einsatz-chat-nachrichten', einsatzId] })` per Prefix alle Kanäle trifft.
- Einsatz (bestehend): `['einsatz', einsatzId]`

---

## Task 1: Migration + Domain-Modul

**Files:**
- Create: `migrations/0043_chat.sql`
- Create: `src/chat/mod.rs`
- Modify: `src/lib.rs` (nach Zeile 3 `pub mod backup;`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0043_chat.sql`:

```sql
-- Einsatzinterner Chat (LFH-50): niederschwellige Abstimmung pro Einsatz.
-- Kanäle sind frei anlegbar; ein Default-Kanal wird serverseitig sichergestellt.
-- Nachrichten sind bearbeitbar und soft-löschbar (Tombstone via geloescht_at);
-- der verbindliche/unveränderliche Datensatz entsteht erst beim Heraufstufen ins ETB.
CREATE TABLE chat_kanal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    beschreibung    TEXT,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    archiviert_at   TEXT
);
CREATE INDEX idx_chat_kanal_einsatz ON chat_kanal(einsatz_id);

CREATE TABLE chat_nachricht (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kanal_id       INTEGER NOT NULL REFERENCES chat_kanal(id) ON DELETE CASCADE,
    autor_id       INTEGER NOT NULL REFERENCES benutzer(id),
    inhalt         TEXT    NOT NULL,
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    bearbeitet_at  TEXT,
    geloescht_at   TEXT,
    -- Heraufstufungs-Rückverweis (NULL = reine Chat-Nachricht). Snapshot:
    -- spätere Bearbeitungen der Nachricht wirken NICHT auf den ETB-Eintrag.
    etb_eintrag_id INTEGER REFERENCES etb_eintrag(id)
);
CREATE INDEX idx_chat_nachricht_kanal ON chat_nachricht(kanal_id, id DESC);
```

- [ ] **Step 2: Domain-Modul schreiben**

Create `src/chat/mod.rs`:

```rust
pub mod repo;

use serde::Serialize;

/// Name des Default-Kanals, der pro Einsatz garantiert existiert.
pub const DEFAULT_KANAL_NAME: &str = "Allgemein";

/// Öffentliche Darstellung eines Chat-Kanals.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatKanalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub beschreibung: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub archiviert_at: Option<String>,
}

/// Öffentliche Darstellung einer Chat-Nachricht. `inhalt` ist `None`, wenn die
/// Nachricht gelöscht wurde (Tombstone) — der Text wird dann nicht ausgeliefert.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatNachrichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub kanal_id: i64,
    pub autor_id: i64,
    pub autor_name: String,
    pub inhalt: Option<String>,
    pub erstellt_at: String,
    pub bearbeitet_at: Option<String>,
    pub geloescht_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}
```

- [ ] **Step 3: Modul registrieren**

In `src/lib.rs`, nach `pub mod backup;` (Zeile 3) einfügen:

```rust
pub mod chat;
```

- [ ] **Step 4: Build prüfen**

Run: `cargo build`
Expected: kompiliert ohne Fehler (Warnungen zu ungenutztem Code sind ok, bis `repo` befüllt ist).

- [ ] **Step 5: Commit**

```bash
git add migrations/0043_chat.sql src/chat/mod.rs src/lib.rs
git commit -m "feat(chat): Migration + Domain-Structs für einsatzinternen Chat (LFH-50)"
```

---

## Task 2: Repository — Kanäle

**Files:**
- Create/append: `src/chat/repo.rs`
- Test: inline `#[cfg(test)] mod tests` in `src/chat/repo.rs`

- [ ] **Step 1: Failing test schreiben**

Create `src/chat/repo.rs` mit Grundgerüst + Tests:

```rust
use super::{ChatKanalAnzeige, ChatNachrichtAnzeige, DEFAULT_KANAL_NAME};
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};

#[cfg(test)]
mod tests {
    use super::*;

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

    #[tokio::test]
    async fn liste_kanaele_legt_default_an() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 1);
        assert_eq!(kanaele[0].name, DEFAULT_KANAL_NAME);

        // Idempotent: ein zweiter Aufruf legt keinen weiteren Default an.
        let nochmal = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(nochmal.len(), 1);
    }

    #[tokio::test]
    async fn kanal_anlegen_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        liste_kanaele(&pool, einsatz, benutzer).await.unwrap(); // Default sicherstellen

        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "S2/S3", Some("Lagebild")).await.unwrap();
        assert_eq!(kanal.name, "S2/S3");
        assert_eq!(kanal.beschreibung.as_deref(), Some("Lagebild"));

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 2);
    }

    #[tokio::test]
    async fn gehoert_kanal_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "K", None).await.unwrap();

        assert!(gehoert_kanal_zu_einsatz(&pool, kanal.id, einsatz).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, kanal.id, 999).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }
}
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cargo test --lib chat::repo::tests`
Expected: FAIL (Kompilierfehler: `liste_kanaele`/`kanal_anlegen`/`gehoert_kanal_zu_einsatz` nicht gefunden).

- [ ] **Step 3: Implementierung schreiben**

In `src/chat/repo.rs` vor dem `#[cfg(test)]`-Block einfügen:

```rust
/// Lädt alle Kanäle eines Einsatzes und stellt sicher, dass mindestens der
/// Default-Kanal existiert (lazy-Anlage mit `default_ersteller_id` als Ersteller).
/// Das deckt Bestands-Einsätze ohne Backfill ab. Das `INSERT … WHERE NOT EXISTS`
/// verhindert ein Duplikat, falls bereits ein Kanal existiert.
pub async fn liste_kanaele(
    pool: &SqlitePool,
    einsatz_id: i64,
    default_ersteller_id: i64,
) -> Result<Vec<ChatKanalAnzeige>, AppError> {
    sqlx::query(
        "INSERT INTO chat_kanal (einsatz_id, name, erstellt_von_id) \
         SELECT ?, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM chat_kanal WHERE einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(DEFAULT_KANAL_NAME)
    .bind(default_ersteller_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE einsatz_id = ? ORDER BY erstellt_at, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen neuen Kanal an und liefert ihn als Anzeige.
pub async fn kanal_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    name: &str,
    beschreibung: Option<&str>,
) -> Result<ChatKanalAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(name)
    .bind(beschreibung)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Prüft, ob ein Kanal zum angegebenen Einsatz gehört (Schutz gegen Cross-Einsatz-Zugriff).
pub async fn gehoert_kanal_zu_einsatz(
    pool: &SqlitePool,
    kanal_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_kanal WHERE id = ? AND einsatz_id = ?")
            .bind(kanal_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cargo test --lib chat::repo::tests`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/chat/repo.rs
git commit -m "feat(chat): Repository für Kanäle (Default-Anlage, gehoert_zu_einsatz)"
```

---

## Task 3: Repository — Nachrichten (anlegen, laden, abfrage)

**Files:**
- Modify: `src/chat/repo.rs`

- [ ] **Step 1: Failing test schreiben**

In `src/chat/repo.rs` im `mod tests`-Block ergänzen (eine Hilfsfunktion + Tests):

```rust
    async fn kanal(pool: &SqlitePool, einsatz: i64, benutzer: i64) -> i64 {
        kanal_anlegen(pool, einsatz, benutzer, "K", None).await.unwrap().id
    }

    #[tokio::test]
    async fn anlegen_und_abfrage_neueste_zuerst() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;

        let m1 = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Hallo" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Welt" }).await.unwrap();

        assert_eq!(m1.inhalt.as_deref(), Some("Hallo"));
        assert_eq!(m1.autor_name, "Leitung");

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: kid, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt.as_deref(), Some("Welt"), "neueste zuerst");
    }

    #[tokio::test]
    async fn abfrage_cursor_blaettert_zu_aelteren() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        for i in 1..=3 {
            anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: &format!("m{i}") }).await.unwrap();
        }

        let f = NachrichtFilter { kanal_id: kid, before_id: None, limit: 1 };
        let seite1 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite1[0].inhalt.as_deref(), Some("m3"));

        let f2 = NachrichtFilter { kanal_id: kid, before_id: Some(seite1[0].id), limit: 1 };
        let seite2 = abfrage(&pool, einsatz, &f2).await.unwrap();
        assert_eq!(seite2[0].inhalt.as_deref(), Some("m2"));
    }

    #[tokio::test]
    async fn abfrage_nur_des_kanals() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let k1 = kanal(&pool, einsatz, benutzer).await;
        let k2 = kanal(&pool, einsatz, benutzer).await;
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k1, inhalt: "in k1" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k2, inhalt: "in k2" }).await.unwrap();

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: k1, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt.as_deref(), Some("in k1"));
    }

    #[tokio::test]
    async fn gehoert_nachricht_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert!(gehoert_nachricht_zu_einsatz(&pool, m.id, einsatz).await.unwrap());
        assert!(!gehoert_nachricht_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cargo test --lib chat::repo::tests`
Expected: FAIL (Kompilierfehler: `anlegen`, `abfrage`, `NachrichtDaten`, `NachrichtFilter`, `STANDARD_LIMIT`, `gehoert_nachricht_zu_einsatz` fehlen).

- [ ] **Step 3: Implementierung schreiben**

In `src/chat/repo.rs` vor dem `#[cfg(test)]`-Block ergänzen:

```rust
/// Standard-Seitengröße der Nachrichten-Abfrage.
pub const STANDARD_LIMIT: i64 = 100;
/// Maximale Seitengröße.
pub const MAX_LIMIT: i64 = 500;

/// Eingabedaten für eine neue Nachricht (bereits validiert/getrimmt vom Handler).
#[derive(Debug)]
pub struct NachrichtDaten<'a> {
    pub kanal_id: i64,
    pub inhalt: &'a str,
}

/// Filter-/Cursor-Parameter der Nachrichten-Abfrage.
#[derive(Debug)]
pub struct NachrichtFilter {
    pub kanal_id: i64,
    /// Cursor: nur Nachrichten mit `id <` diesem Wert (ältere Seite).
    pub before_id: Option<i64>,
    pub limit: i64,
}

/// SELECT-Projektion einer Nachricht inkl. Autor-Name. `inhalt` wird bei
/// gelöschten Nachrichten als NULL ausgeliefert (Tombstone).
const NACHRICHT_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.kanal_id, n.autor_id, b.anzeigename AS autor_name, \
            CASE WHEN n.geloescht_at IS NULL THEN n.inhalt ELSE NULL END AS inhalt, \
            n.erstellt_at, n.bearbeitet_at, n.geloescht_at, n.etb_eintrag_id \
     FROM chat_nachricht n JOIN benutzer b ON b.id = n.autor_id";

/// Lädt eine einzelne Nachricht als Anzeige. `NotFound`, wenn sie nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query_as::<_, ChatNachrichtAnzeige>(&format!("{NACHRICHT_SELECT} WHERE n.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine Nachricht an und liefert sie als Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    autor_id: i64,
    daten: NachrichtDaten<'_>,
) -> Result<ChatNachrichtAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.kanal_id)
    .bind(autor_id)
    .bind(daten.inhalt)
    .fetch_one(pool)
    .await?;
    laden(pool, id).await
}

/// Fragt Nachrichten eines Kanals ab. Sortierung: `id DESC` (neueste zuerst),
/// Cursor über `before_id`.
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &NachrichtFilter,
) -> Result<Vec<ChatNachrichtAnzeige>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(NACHRICHT_SELECT);
    qb.push(" WHERE n.einsatz_id = ");
    qb.push_bind(einsatz_id);
    qb.push(" AND n.kanal_id = ");
    qb.push_bind(filter.kanal_id);
    if let Some(cursor) = filter.before_id {
        qb.push(" AND n.id < ");
        qb.push_bind(cursor);
    }
    qb.push(" ORDER BY n.id DESC LIMIT ");
    qb.push_bind(filter.limit);

    qb.build_query_as::<ChatNachrichtAnzeige>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Prüft, ob eine Nachricht zum angegebenen Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_nachricht_zu_einsatz(
    pool: &SqlitePool,
    nachricht_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_nachricht WHERE id = ? AND einsatz_id = ?")
            .bind(nachricht_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cargo test --lib chat::repo::tests`
Expected: PASS (alle Tests aus Task 2 + 4 neue).

- [ ] **Step 5: Commit**

```bash
git add src/chat/repo.rs
git commit -m "feat(chat): Repository für Nachrichten (anlegen, abfrage, cursor, tombstone-select)"
```

---

## Task 4: Repository — Bearbeiten & Soft-Löschen

**Files:**
- Modify: `src/chat/repo.rs`

- [ ] **Step 1: Failing test schreiben**

Im `mod tests`-Block ergänzen:

```rust
    #[tokio::test]
    async fn autor_von_liefert_autor_id() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert_eq!(autor_von(&pool, m.id).await.unwrap(), Some(benutzer));
        assert_eq!(autor_von(&pool, 999).await.unwrap(), None);
    }

    #[tokio::test]
    async fn bearbeiten_setzt_inhalt_und_bearbeitet_at() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "alt" }).await.unwrap();
        assert_eq!(m.bearbeitet_at, None);

        let bearbeitet = bearbeiten(&pool, m.id, "neu").await.unwrap();
        assert_eq!(bearbeitet.inhalt.as_deref(), Some("neu"));
        assert!(bearbeitet.bearbeitet_at.is_some());
    }

    #[tokio::test]
    async fn loeschen_setzt_tombstone() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "geheim" }).await.unwrap();

        loeschen(&pool, m.id).await.unwrap();
        let nachher = laden(&pool, m.id).await.unwrap();
        assert!(nachher.geloescht_at.is_some());
        assert_eq!(nachher.inhalt, None, "Inhalt gelöschter Nachrichten wird nicht ausgeliefert");
    }
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cargo test --lib chat::repo::tests`
Expected: FAIL (`autor_von`, `bearbeiten`, `loeschen` fehlen).

- [ ] **Step 3: Implementierung schreiben**

In `src/chat/repo.rs` vor dem `#[cfg(test)]`-Block ergänzen:

```rust
/// Liefert die Autor-ID einer Nachricht (`None`, wenn sie nicht existiert).
/// Grundlage für die Autor-Prüfung bei Bearbeiten/Löschen.
pub async fn autor_von(pool: &SqlitePool, nachricht_id: i64) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT autor_id FROM chat_nachricht WHERE id = ?")
        .bind(nachricht_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Bearbeitet den Inhalt einer Nachricht und setzt `bearbeitet_at` auf jetzt.
pub async fn bearbeiten(
    pool: &SqlitePool,
    nachricht_id: i64,
    neuer_inhalt: &str,
) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query(
        "UPDATE chat_nachricht SET inhalt = ?, bearbeitet_at = datetime('now') \
         WHERE id = ? AND geloescht_at IS NULL",
    )
    .bind(neuer_inhalt)
    .bind(nachricht_id)
    .execute(pool)
    .await?;
    laden(pool, nachricht_id).await
}

/// Soft-löscht eine Nachricht (Tombstone via `geloescht_at`).
pub async fn loeschen(pool: &SqlitePool, nachricht_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE chat_nachricht SET geloescht_at = datetime('now') WHERE id = ?")
        .bind(nachricht_id)
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cargo test --lib chat::repo::tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/repo.rs
git commit -m "feat(chat): Repository für Bearbeiten/Soft-Löschen (autor_von, bearbeiten, loeschen)"
```

---

## Task 5: Repository — Heraufstufen zu ETB

**Files:**
- Modify: `src/chat/repo.rs`

- [ ] **Step 1: Failing test schreiben**

Im `mod tests`-Block ergänzen:

```rust
    #[tokio::test]
    async fn heraufstufen_legt_etb_an_und_setzt_rueckverweis() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Deich instabil" }).await.unwrap();

        let etb_id = heraufstufen_zu_etb(
            &pool, einsatz, m.id, benutzer, "meldung", "Deich instabil", &m.erstellt_at,
        ).await.unwrap();

        // ETB-Eintrag existiert mit dem Text und der Ereigniszeit der Nachricht (Snapshot).
        let etb = crate::etb::repo::laden(&pool, etb_id).await.unwrap();
        assert_eq!(etb.typ, "meldung");
        assert_eq!(etb.inhalt, "Deich instabil");
        assert_eq!(etb.ereigniszeit, m.erstellt_at);

        // Rückverweis an der Nachricht ist gesetzt.
        let nachher = laden(&pool, m.id).await.unwrap();
        assert_eq!(nachher.etb_eintrag_id, Some(etb_id));
    }

    #[tokio::test]
    async fn heraufstufen_doppelt_ist_konflikt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();
        heraufstufen_zu_etb(&pool, einsatz, m.id, benutzer, "meldung", "x", &m.erstellt_at).await.unwrap();

        let zweimal = heraufstufen_zu_etb(&pool, einsatz, m.id, benutzer, "meldung", "x", &m.erstellt_at).await;
        assert!(matches!(zweimal.unwrap_err(), AppError::Conflict(_)));
    }
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cargo test --lib chat::repo::tests`
Expected: FAIL (`heraufstufen_zu_etb` fehlt).

- [ ] **Step 3: Implementierung schreiben**

In `src/chat/repo.rs` vor dem `#[cfg(test)]`-Block ergänzen (nutzt `SqliteConnection` aus dem Top-Import + `crate::etb::repo::anlegen_tx`):

```rust
/// Stuft eine Chat-Nachricht zu einem ETB-Eintrag herauf — transaktional nach dem
/// Muster von `lagebericht::freigeben`: legt den ETB-Eintrag an und setzt den
/// Rückverweis `chat_nachricht.etb_eintrag_id` im selben Commit. Der ETB-Eintrag
/// ist ein Snapshot (Text + Ereigniszeit der Nachricht); spätere Bearbeitungen der
/// Nachricht wirken nicht zurück. Doppel-Heraufstufung → `Conflict`.
///
/// `etb_typ`, `inhalt` und `ereigniszeit` sind bereits vom Handler validiert/normalisiert.
/// Liefert die neue ETB-`id`.
pub async fn heraufstufen_zu_etb(
    pool: &SqlitePool,
    einsatz_id: i64,
    nachricht_id: i64,
    heraufstufer_id: i64,
    etb_typ: &str,
    inhalt: &str,
    ereigniszeit: &str,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;

    // Guard: schon heraufgestuft oder gelöscht? (Sperrt Doppel-Heraufstufung.)
    let zustand: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT etb_eintrag_id, geloescht_at FROM chat_nachricht WHERE id = ?",
    )
    .bind(nachricht_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (etb_vorhanden, geloescht) = zustand.ok_or(AppError::NotFound)?;
    if etb_vorhanden.is_some() {
        return Err(AppError::Conflict("Nachricht ist bereits heraufgestuft".into()));
    }
    if geloescht.is_some() {
        return Err(AppError::Conflict("Gelöschte Nachricht kann nicht heraufgestuft werden".into()));
    }

    let etb_id = crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        heraufstufer_id,
        crate::etb::repo::EintragDaten {
            typ: etb_typ,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(ereigniszeit),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;

    sqlx::query("UPDATE chat_nachricht SET etb_eintrag_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(nachricht_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(etb_id)
}
```

Hinweis: `anlegen_tx` erwartet `&mut SqliteConnection`; `&mut *tx` (Deref der Transaktion) erfüllt das, wie in `lagebericht::repo::freigeben`. Sollte der Compiler den Typ nicht akzeptieren, `&mut tx` durch `tx.as_mut()` ersetzen.

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cargo test --lib chat::repo::tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/repo.rs
git commit -m "feat(chat): Heraufstufen einer Nachricht zu ETB-Eintrag (transaktional, Doppel-Guard)"
```

---

## Task 6: Routes + Router-Verdrahtung

**Files:**
- Create: `src/routes/chat.rs`
- Modify: `src/routes/mod.rs` (nach `pub mod benutzer;`)
- Modify: `src/app.rs` (Chat-Routen nach dem ETB-Block, Zeile 62)

- [ ] **Step 1: Handler schreiben**

Create `src/routes/chat.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::chat::repo;
use crate::chat::{ChatKanalAnzeige, ChatNachrichtAnzeige};
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::EtbTyp;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: der Chat des Einsatzes hat sich geändert. Event-Tag `chat`.
/// Das Frontend invalidiert daraufhin Kanal- und Nachrichten-Queries.
fn sse_chat(state: &AppState, einsatz_id: i64, data: String) {
    state.live.publiziere_event(einsatz_id, "chat", data);
}

/// Serialisiert eine Anzeige für den Live-Push; bei Serialisierungsfehler wird
/// ein minimales Fallback-Event gesendet (das Frontend invalidiert ohnehin nur).
fn als_json<T: serde::Serialize>(wert: &T, einsatz_id: i64) -> String {
    serde_json::to_string(wert)
        .unwrap_or_else(|_| serde_json::json!({ "einsatz_id": einsatz_id }).to_string())
}

// ---- Kanäle ----

/// GET /api/einsaetze/{id}/chat/kanaele — Kanäle listen (Default wird sichergestellt).
pub async fn kanaele_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<ChatKanalAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(repo::liste_kanaele(&state.pool, einsatz_id, benutzer.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerKanal {
    pub name: String,
    pub beschreibung: Option<String>,
}

/// POST /api/einsaetze/{id}/chat/kanaele — Kanal anlegen. Schreibrecht + aktiv.
pub async fn kanal_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerKanal>,
) -> Result<(StatusCode, Json<ChatKanalAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Kanalname darf nicht leer sein".into()));
    }
    let beschreibung = req.beschreibung.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let kanal = repo::kanal_anlegen(&state.pool, einsatz_id, benutzer.id, name, beschreibung).await?;
    sse_chat(&state, einsatz_id, als_json(&kanal, einsatz_id));
    Ok((StatusCode::CREATED, Json(kanal)))
}

// ---- Nachrichten ----

#[derive(Debug, Deserialize)]
pub struct NachrichtenParams {
    pub before_id: Option<i64>,
    pub limit: Option<i64>,
}

/// GET /api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten — Nachrichten eines Kanals.
/// Lesezugriff (inkl. Beobachter). Cursor über `before_id`.
pub async fn nachrichten_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, kanal_id)): Path<(i64, i64)>,
    Query(params): Query<NachrichtenParams>,
) -> Result<Json<Vec<ChatNachrichtAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Cross-Einsatz-Schutz: Kanal muss zu diesem Einsatz gehören.
    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let limit = params.limit.unwrap_or(repo::STANDARD_LIMIT).clamp(1, repo::MAX_LIMIT);
    let filter = repo::NachrichtFilter { kanal_id, before_id: params.before_id, limit };
    Ok(Json(repo::abfrage(&state.pool, einsatz_id, &filter).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueNachricht {
    pub inhalt: String,
}

/// POST /api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten — Nachricht senden.
/// Schreibrecht + aktiv. Cross-Einsatz-Schutz auf den Kanal.
pub async fn nachricht_erfassen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, kanal_id)): Path<(i64, i64)>,
    Json(req): Json<NeueNachricht>,
) -> Result<(StatusCode, Json<ChatNachrichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Nachricht darf nicht leer sein".into()));
    }

    let nachricht = repo::anlegen(&state.pool, einsatz_id, benutzer.id,
        repo::NachrichtDaten { kanal_id, inhalt }).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok((StatusCode::CREATED, Json(nachricht)))
}

/// Lädt Einsatz + verifiziert Schreibrecht/Aktiv + Autorenschaft der Nachricht.
/// Gemeinsamer Vorlauf von Bearbeiten/Löschen. Liefert nichts (nur Gates).
async fn fordere_autor(
    state: &AppState,
    benutzer_id: i64,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    nachricht_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Cross-Einsatz-Schutz + Existenz.
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Nur der Autor darf bearbeiten/löschen (auch die Einsatzleitung nicht fremd).
    match repo::autor_von(&state.pool, nachricht_id).await? {
        Some(autor) if autor == benutzer_id => Ok(()),
        Some(_) => Err(AppError::Forbidden),
        None => Err(AppError::NotFound),
    }
}

/// PATCH /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht bearbeiten.
pub async fn nachricht_bearbeiten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<NeueNachricht>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    fordere_autor(&state, benutzer.id, &benutzer, einsatz_id, nachricht_id).await?;
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Nachricht darf nicht leer sein".into()));
    }
    let nachricht = repo::bearbeiten(&state.pool, nachricht_id, inhalt).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
}

/// DELETE /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht soft-löschen.
pub async fn nachricht_loeschen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    fordere_autor(&state, benutzer.id, &benutzer, einsatz_id, nachricht_id).await?;
    repo::loeschen(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id,
        serde_json::json!({ "einsatz_id": einsatz_id, "nachricht_id": nachricht_id }).to_string());
    Ok(StatusCode::NO_CONTENT)
}

// ---- Heraufstufen ----

#[derive(Debug, Deserialize)]
pub struct HeraufstufenBody {
    pub typ: String,
    /// Optionaler überarbeiteter Text; fehlt er, wird der Nachrichtentext genutzt.
    pub inhalt: Option<String>,
}

/// POST /api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-etb — Nachricht → ETB.
/// Schreibrecht + aktiv. Server erzwingt die zulässigen ETB-Typen.
pub async fn heraufstufen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<HeraufstufenBody>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Server-seitige Typ-Allowlist: kein 'system' (Modul-reserviert) und keine
    // 'berichtigung' (bräuchte berichtigt_eintrag_id; semantisch unzulässig hier).
    let typ = EtbTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger ETB-Typ".into()))?;
    if !typ.darf_client_erfassen() || typ.ist_berichtigung() {
        return Err(AppError::Validation(
            "Für die Heraufstufung sind nur meldung/anordnung/lage/entscheidung zulässig".into(),
        ));
    }

    // Quellnachricht laden: liefert Ereigniszeit (Snapshot) + Fallback-Inhalt.
    let quelle = repo::laden(&state.pool, nachricht_id).await?;
    let inhalt = req
        .inhalt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| quelle.inhalt.clone())
        .ok_or_else(|| AppError::Validation("Kein Inhalt zum Heraufstufen".into()))?;

    let etb_id = repo::heraufstufen_zu_etb(
        &state.pool, einsatz_id, nachricht_id, benutzer.id, typ.as_str(), &inhalt, &quelle.erstellt_at,
    ).await?;

    // Beide Events publizieren (wie lagebericht::freigeben): ETB-Eintrag + Chat-Update.
    if let Ok(etb_anzeige) = crate::etb::repo::laden(&state.pool, etb_id).await {
        if let Ok(json) = serde_json::to_string(&etb_anzeige) {
            state.live.publiziere(einsatz_id, json);
        }
    }
    let nachricht = repo::laden(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
}
```

- [ ] **Step 2: Modul + Router verdrahten**

In `src/routes/mod.rs` nach `pub mod benutzer;` (Zeile 3) einfügen:

```rust
pub mod chat;
```

In `src/app.rs` nach der ETB-Stream-Route (`…/etb/stream`, Zeile 62) einfügen:

```rust
        .route("/api/einsaetze/{id}/chat/kanaele", get(routes::chat::kanaele_liste))
        .route("/api/einsaetze/{id}/chat/kanaele", post(routes::chat::kanal_anlegen))
        .route("/api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten", get(routes::chat::nachrichten_liste))
        .route("/api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten", post(routes::chat::nachricht_erfassen))
        .route("/api/einsaetze/{id}/chat/nachrichten/{mid}", patch(routes::chat::nachricht_bearbeiten))
        .route("/api/einsaetze/{id}/chat/nachrichten/{mid}", delete(routes::chat::nachricht_loeschen))
        .route("/api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-etb", post(routes::chat::heraufstufen))
```

- [ ] **Step 3: Build prüfen**

Run: `cargo build`
Expected: kompiliert ohne Fehler. (Bei Typfehler an `crate::auth::Benutzer` in `fordere_autor`: Importpfad an die tatsächliche `Benutzer`-Definition anpassen — `rg "pub struct Benutzer" src/auth`.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat.rs src/routes/mod.rs src/app.rs
git commit -m "feat(chat): HTTP-Handler + Router-Verdrahtung (Kanäle, Nachrichten, Heraufstufen)"
```

---

## Task 7: Integrationstests (Gates, Cross-Einsatz, Heraufstufen)

**Files:**
- Create: `tests/chat.rs`

- [ ] **Step 1: Failing tests schreiben**

Create `tests/chat.rs` (Harness wie `tests/lagebericht.rs`):

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

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#);
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
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
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#))).await;
    assert_eq!(status, StatusCode::OK);
}

/// GET kanaele legt den Default-Kanal an und gibt ihn zurück.
async fn default_kanal(app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
    let (status, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele"), cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let arr = json.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "Allgemein");
    arr[0]["id"].as_i64().unwrap()
}

#[tokio::test]
async fn senden_und_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (s, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"Funktionsabstimmung S2/S3"}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(m["inhalt"], "Funktionsabstimmung S2/S3");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &erika,
            Some(r#"{"inhalt":"darf nicht"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn fremde_nachricht_nicht_bearbeitbar_auch_nicht_durch_leitung() {
    // Autor = Führungspersonal; Bearbeiten-Versuch durch die Einsatzleitung → 403.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await; // Einsatzleitung (Anleger)
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "frank", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let frank = login_cookie(&app, "frank", "frankpw1").await;

    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &frank,
        Some(r#"{"inhalt":"von frank"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"), &admin,
        Some(r#"{"inhalt":"fremd geändert"}"#)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Eigene Nachricht darf der Autor löschen → 204.
    let (s, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"), &frank, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn kanal_eines_anderen_einsatzes_ist_nicht_erreichbar() {
    // Cross-Einsatz: schreibberechtigt auf A, POST gegen Kanal von B → 404.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let kid_b = default_kanal(&app, einsatz_b, &admin).await;

    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz_a}/chat/kanaele/{kid_b}/nachrichten"), &admin,
        Some(r#"{"inhalt":"falscher Einsatz"}"#)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn heraufstufen_erzeugt_etb_und_sperrt_doppelt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"Deich km12 instabil"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, hoch) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
        Some(r#"{"typ":"meldung"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert!(hoch["etb_eintrag_id"].is_i64());

    // ETB-Eintrag liegt vor.
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), &admin, None).await;
    let meldungen: Vec<&Value> = etb.as_array().unwrap().iter().filter(|e| e["typ"] == "meldung").collect();
    assert_eq!(meldungen.len(), 1);
    assert!(meldungen[0]["inhalt"].as_str().unwrap().contains("Deich km12 instabil"));

    // Zweite Heraufstufung → 409.
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
        Some(r#"{"typ":"meldung"}"#)).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn heraufstufen_lehnt_unzulaessige_typen_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, m) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"), &admin,
        Some(r#"{"inhalt":"x"}"#)).await;
    let mid = m["id"].as_i64().unwrap();

    for typ in ["system", "berichtigung", "quatsch"] {
        let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/heraufstufen-etb"), &admin,
            Some(&format!(r#"{{"typ":"{typ}"}}"#))).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "Typ {typ} muss abgelehnt werden");
    }
}
```

- [ ] **Step 2: Tests ausführen**

Run: `cargo test --test chat`
Expected: PASS (6 Tests). Bei rotem Lauf gezielt debuggen (z.B. `--test chat heraufstufen_erzeugt_etb_und_sperrt_doppelt -- --nocapture`).

- [ ] **Step 3: Volles Backend-Gate**

Run: `cargo test`
Expected: gesamte Suite grün (keine Regression in ETB/Einsatz).

- [ ] **Step 4: Commit**

```bash
git add tests/chat.rs
git commit -m "test(chat): Integrationstests für Gates, Cross-Einsatz, Heraufstufen (LFH-50)"
```

---

## Task 8: Frontend — Typen + API-Modul

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/chat.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` am Ende anfügen:

```typescript
export interface ChatKanal {
  id: number;
  einsatz_id: number;
  name: string;
  beschreibung: string | null;
  erstellt_von_id: number;
  erstellt_at: string;
  archiviert_at: string | null;
}

export interface ChatNachricht {
  id: number;
  einsatz_id: number;
  kanal_id: number;
  autor_id: number;
  autor_name: string;
  /** `null` = gelöscht (Tombstone) — der Text wird vom Server nicht ausgeliefert. */
  inhalt: string | null;
  erstellt_at: string;
  bearbeitet_at: string | null;
  geloescht_at: string | null;
  etb_eintrag_id: number | null;
}
```

- [ ] **Step 2: API-Modul schreiben**

Create `frontend/src/api/chat.ts`:

```typescript
import { apiGet, apiSend } from './client';
import type { ChatKanal, ChatNachricht, EtbTyp } from './types';

/** Seitengröße der Nachrichten-Abfrage (muss zum Server-STANDARD_LIMIT passen). */
export const SEITENGROESSE_CHAT = 100;

export function listeKanaele(einsatzId: number): Promise<ChatKanal[]> {
  return apiGet<ChatKanal[]>(`/api/einsaetze/${einsatzId}/chat/kanaele`);
}

export interface NeuerKanal {
  name: string;
  beschreibung?: string;
}

export function legeKanalAn(einsatzId: number, daten: NeuerKanal): Promise<ChatKanal> {
  return apiSend<ChatKanal>(`/api/einsaetze/${einsatzId}/chat/kanaele`, 'POST', daten);
}

export function listeNachrichten(
  einsatzId: number,
  kanalId: number,
  beforeId?: number,
): Promise<ChatNachricht[]> {
  const q = beforeId !== undefined ? `?before_id=${beforeId}` : '';
  return apiGet<ChatNachricht[]>(`/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten${q}`);
}

export function sendeNachricht(einsatzId: number, kanalId: number, inhalt: string): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten`, 'POST', { inhalt },
  );
}

export function bearbeiteNachricht(einsatzId: number, nachrichtId: number, inhalt: string): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(`/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}`, 'PATCH', { inhalt });
}

export function loescheNachricht(einsatzId: number, nachrichtId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}`, 'DELETE');
}

export function heraufstufenZuEtb(
  einsatzId: number,
  nachrichtId: number,
  typ: EtbTyp,
  inhalt: string,
): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}/heraufstufen-etb`, 'POST', { typ, inhalt },
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: keine Typfehler. (`EtbTyp` ist in `types.ts` bereits definiert.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/chat.ts
git commit -m "feat(chat): Frontend-Typen + API-Modul für Chat (LFH-50)"
```

---

## Task 9: Frontend — Live-Stream-Event `chat`

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`
- Modify: `frontend/src/etb/useEinsatzLiveStream.test.tsx`

- [ ] **Step 1: Failing test schreiben**

In `frontend/src/etb/useEinsatzLiveStream.test.tsx` einen Testfall ergänzen (Muster der bestehenden Tests in derselben Datei nutzen — dieselbe `FakeEventSource`/`Probe`-Struktur). Falls die Datei einen Helfer wie `emit(event)` nutzt, diesen verwenden:

```typescript
  it('invalidiert Chat-Queries bei einem chat-Event', async () => {
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('chat', '{}');
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ['einsatz-chat-kanaele', 7] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ['einsatz-chat-nachrichten', 7] });
    });
  });
```

Hinweis: Import-/Helfernamen (`neuerQueryClient`, `FakeEventSource`, `Probe`, `waitFor`) an die bereits in dieser Datei vorhandenen anpassen — nicht neu erfinden.

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test useEinsatzLiveStream`
Expected: FAIL (kein `chat`-Listener registriert).

- [ ] **Step 3: Implementierung schreiben**

In `frontend/src/etb/useEinsatzLiveStream.ts`:

1. Nach `const onLagebericht = …` (Zeile 53–56) ergänzen:

```typescript
    const onChat = () => {
      inval('einsatz-chat-kanaele');
      inval('einsatz-chat-nachrichten');
    };
```

2. In `onLag` (nach `onLagebericht();`, Zeile 68) ergänzen:

```typescript
      onChat();
```

3. Bei den `addEventListener` (nach `quelle.addEventListener('lagebericht', onLagebericht);`, Zeile 80) ergänzen:

```typescript
    quelle.addEventListener('chat', onChat);
```

4. Im Cleanup (nach `quelle.removeEventListener('lagebericht', onLagebericht);`, Zeile 92) ergänzen:

```typescript
      quelle.removeEventListener('chat', onChat);
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cd frontend && pnpm test useEinsatzLiveStream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/useEinsatzLiveStream.ts frontend/src/etb/useEinsatzLiveStream.test.tsx
git commit -m "feat(chat): chat-Event im Einsatz-Live-Stream (invalidiert Kanäle + Nachrichten)"
```

---

## Task 10: Frontend — NachrichtenStrom + NachrichtEingabe

**Files:**
- Create: `frontend/src/chat/NachrichtenStrom.tsx` (+ `.test.tsx`)
- Create: `frontend/src/chat/NachrichtEingabe.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Failing test für NachrichtenStrom schreiben**

Create `frontend/src/chat/NachrichtenStrom.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtenStrom from './NachrichtenStrom';
import type { ChatNachricht } from '../api/types';

function nachricht(over: Partial<ChatNachricht> = {}): ChatNachricht {
  return {
    id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
    inhalt: 'Hallo Stab', erstellt_at: '2026-06-10 10:00:00',
    bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null, ...over,
  };
}

describe('NachrichtenStrom', () => {
  it('zeigt Inhalt und Autor', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht()]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText('Hallo Stab')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
  });

  it('zeigt Tombstone für gelöschte Nachrichten ohne Aktionen', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ inhalt: null, geloescht_at: '2026-06-10 10:05:00' })]}
        eigeneBenutzerId={1} darfSchreiben onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText('Nachricht gelöscht')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('zeigt ETB-Badge bei heraufgestufter Nachricht', () => {
    renderMitProviders(
      <NachrichtenStrom nachrichten={[nachricht({ etb_eintrag_id: 42 })]} eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={vi.fn()} />,
    );
    expect(screen.getByText(/heraufgestuft zu ETB/i)).toBeInTheDocument();
  });

  it('Aktionen nur an eigenen Nachrichten; Heraufstufen löst Callback aus', async () => {
    const onHeraufstufen = vi.fn();
    renderMitProviders(
      <NachrichtenStrom
        nachrichten={[nachricht({ id: 1, autor_id: 1 }), nachricht({ id: 2, autor_id: 99, inhalt: 'fremd' })]}
        eigeneBenutzerId={1} darfSchreiben
        onBearbeiten={vi.fn()} onLoeschen={vi.fn()} onHeraufstufen={onHeraufstufen} />,
    );
    // Genau eine "Löschen"-Schaltfläche (nur an eigener Nachricht id=1).
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(1);
    // Heraufstufen ist an jeder noch nicht heraufgestuften Nachricht möglich (schreibberechtigt).
    const hochButtons = screen.getAllByRole('button', { name: 'Zu ETB' });
    await userEvent.click(hochButtons[0]);
    expect(onHeraufstufen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test NachrichtenStrom`
Expected: FAIL (Komponente fehlt).

- [ ] **Step 3: NachrichtenStrom implementieren**

Create `frontend/src/chat/NachrichtenStrom.tsx`:

```typescript
import { Button, List, Space, Tag, Typography } from 'antd';
import type { ChatNachricht } from '../api/types';

interface Props {
  nachrichten: ChatNachricht[];
  eigeneBenutzerId: number | null;
  darfSchreiben: boolean;
  onBearbeiten: (n: ChatNachricht) => void;
  onLoeschen: (n: ChatNachricht) => void;
  onHeraufstufen: (n: ChatNachricht) => void;
}

export default function NachrichtenStrom({
  nachrichten, eigeneBenutzerId, darfSchreiben, onBearbeiten, onLoeschen, onHeraufstufen,
}: Props) {
  return (
    <List<ChatNachricht>
      dataSource={nachrichten}
      locale={{ emptyText: 'Noch keine Nachrichten' }}
      renderItem={(n) => {
        const geloescht = n.geloescht_at !== null;
        const eigene = eigeneBenutzerId !== null && n.autor_id === eigeneBenutzerId;
        const heraufgestuft = n.etb_eintrag_id !== null;
        return (
          <List.Item
            actions={
              geloescht
                ? []
                : [
                    ...(darfSchreiben && !heraufgestuft
                      ? [<Button key="hoch" type="link" size="small" onClick={() => onHeraufstufen(n)}>Zu ETB</Button>]
                      : []),
                    ...(eigene
                      ? [
                          <Button key="edit" type="link" size="small" onClick={() => onBearbeiten(n)}>Bearbeiten</Button>,
                          <Button key="del" type="link" size="small" danger onClick={() => onLoeschen(n)}>Löschen</Button>,
                        ]
                      : []),
                  ]
            }
          >
            <List.Item.Meta
              title={
                <Space size="small">
                  <Typography.Text strong>{n.autor_name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                    {n.erstellt_at}
                  </Typography.Text>
                  {n.bearbeitet_at && <Tag>bearbeitet</Tag>}
                  {heraufgestuft && <Tag color="blue">heraufgestuft zu ETB</Tag>}
                </Space>
              }
              description={
                geloescht ? (
                  <Typography.Text type="secondary" italic>Nachricht gelöscht</Typography.Text>
                ) : (
                  <Typography.Text>{n.inhalt}</Typography.Text>
                )
              }
            />
          </List.Item>
        );
      }}
    />
  );
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cd frontend && pnpm test NachrichtenStrom`
Expected: PASS.

- [ ] **Step 5: Failing test für NachrichtEingabe schreiben**

Create `frontend/src/chat/NachrichtEingabe.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtEingabe from './NachrichtEingabe';

describe('NachrichtEingabe', () => {
  it('sendet getrimmten Text und leert das Feld', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, '  Lagebild aktualisiert  ');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledWith('Lagebild aktualisiert');
  });

  it('sendet nicht bei leerem Text', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test NachrichtEingabe`
Expected: FAIL (Komponente fehlt).

- [ ] **Step 7: NachrichtEingabe implementieren**

Create `frontend/src/chat/NachrichtEingabe.tsx`:

```typescript
import { Button, Input, Space } from 'antd';
import { useState } from 'react';

interface Props {
  onSenden: (text: string) => void;
  /** true, solange die Sende-Mutation läuft. */
  senden: boolean;
}

export default function NachrichtEingabe({ onSenden, senden }: Props) {
  const [text, setText] = useState('');

  const absenden = () => {
    const getrimmt = text.trim();
    if (!getrimmt) return;
    onSenden(getrimmt);
    setText('');
  };

  return (
    <Space.Compact style={{ width: '100%', marginTop: 12 }}>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Nachricht…"
        autoSize={{ minRows: 1, maxRows: 4 }}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            absenden();
          }
        }}
      />
      <Button type="primary" loading={senden} onClick={absenden}>Senden</Button>
    </Space.Compact>
  );
}
```

- [ ] **Step 8: Test ausführen (muss bestehen)**

Run: `cd frontend && pnpm test NachrichtEingabe`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/chat/NachrichtenStrom.tsx frontend/src/chat/NachrichtenStrom.test.tsx frontend/src/chat/NachrichtEingabe.tsx frontend/src/chat/NachrichtEingabe.test.tsx
git commit -m "feat(chat): NachrichtenStrom + NachrichtEingabe (presentational, getestet)"
```

---

## Task 11: Frontend — KanalListe + HeraufstufenModal

**Files:**
- Create: `frontend/src/chat/KanalListe.tsx` (+ `.test.tsx`)
- Create: `frontend/src/chat/HeraufstufenModal.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Failing test für KanalListe schreiben**

Create `frontend/src/chat/KanalListe.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KanalListe from './KanalListe';
import type { ChatKanal } from '../api/types';

function kanal(over: Partial<ChatKanal> = {}): ChatKanal {
  return {
    id: 1, einsatz_id: 7, name: 'Allgemein', beschreibung: null,
    erstellt_von_id: 1, erstellt_at: '2026-06-10 09:00:00', archiviert_at: null, ...over,
  };
}

describe('KanalListe', () => {
  it('zeigt Kanäle und meldet Wechsel', async () => {
    const onWechsel = vi.fn();
    renderMitProviders(
      <KanalListe kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]} aktiverKanalId={1}
        onWechsel={onWechsel} darfSchreiben onKanalAnlegen={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('S2/S3'));
    expect(onWechsel).toHaveBeenCalledWith(2);
  });

  it('blendet "Kanal anlegen" für Nicht-Schreibberechtigte aus', () => {
    renderMitProviders(
      <KanalListe kanaele={[kanal()]} aktiverKanalId={1} onWechsel={vi.fn()}
        darfSchreiben={false} onKanalAnlegen={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Kanal' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test KanalListe`
Expected: FAIL.

- [ ] **Step 3: KanalListe implementieren**

Create `frontend/src/chat/KanalListe.tsx`:

```typescript
import { Button, Form, Input, List, Modal, Typography } from 'antd';
import { useState } from 'react';
import type { ChatKanal } from '../api/types';

interface Props {
  kanaele: ChatKanal[];
  aktiverKanalId: number | null;
  onWechsel: (kanalId: number) => void;
  darfSchreiben: boolean;
  onKanalAnlegen: (name: string, beschreibung?: string) => void;
}

interface KanalFormWerte {
  name: string;
  beschreibung?: string;
}

export default function KanalListe({
  kanaele, aktiverKanalId, onWechsel, darfSchreiben, onKanalAnlegen,
}: Props) {
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<KanalFormWerte>();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>Kanäle</Typography.Text>
        {darfSchreiben && (
          <Button size="small" onClick={() => setOffen(true)}>Kanal</Button>
        )}
      </div>
      <List<ChatKanal>
        size="small"
        dataSource={kanaele}
        renderItem={(k) => (
          <List.Item
            onClick={() => onWechsel(k.id)}
            style={{
              cursor: 'pointer',
              fontWeight: k.id === aktiverKanalId ? 600 : 400,
            }}
          >
            {k.name}
          </List.Item>
        )}
      />
      <Modal
        open={offen}
        title="Neuer Kanal"
        okText="Anlegen"
        onOk={() => form.submit()}
        onCancel={() => setOffen(false)}
        destroyOnHidden
      >
        <Form<KanalFormWerte>
          form={form}
          layout="vertical"
          onFinish={(w) => {
            onKanalAnlegen(w.name.trim(), w.beschreibung?.trim() || undefined);
            form.resetFields();
            setOffen(false);
          }}
        >
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true, message: 'Name erforderlich' }]}>
            <Input placeholder="z. B. S2/S3 oder Abschnitt Nord" />
          </Form.Item>
          <Form.Item label="Beschreibung (optional)" name="beschreibung">
            <Input placeholder="Kurzbeschreibung" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

Run: `cd frontend && pnpm test KanalListe`
Expected: PASS.

- [ ] **Step 5: Failing test für HeraufstufenModal schreiben**

Create `frontend/src/chat/HeraufstufenModal.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import HeraufstufenModal from './HeraufstufenModal';
import type { ChatNachricht } from '../api/types';

const nachricht: ChatNachricht = {
  id: 1, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'Max',
  inhalt: 'Deich instabil', erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null,
};

describe('HeraufstufenModal', () => {
  it('übernimmt den Nachrichtentext und bestätigt mit Typ + Text', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <HeraufstufenModal offen nachricht={nachricht} senden={false}
        onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );
    expect(screen.getByDisplayValue('Deich instabil')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Heraufstufen' }));
    expect(onBestaetigen).toHaveBeenCalledWith('meldung', 'Deich instabil');
  });
});
```

- [ ] **Step 6: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test HeraufstufenModal`
Expected: FAIL.

- [ ] **Step 7: HeraufstufenModal implementieren**

Create `frontend/src/chat/HeraufstufenModal.tsx`:

```typescript
import { Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import type { ChatNachricht, EtbTyp } from '../api/types';

/** Für die Heraufstufung zulässige ETB-Typen (Server erzwingt dieselbe Allowlist). */
const TYP_OPTIONEN: { value: EtbTyp; label: string }[] = [
  { value: 'meldung', label: 'Meldung' },
  { value: 'anordnung', label: 'Anordnung' },
  { value: 'lage', label: 'Lage' },
  { value: 'entscheidung', label: 'Entscheidung' },
];

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
}

interface Props {
  offen: boolean;
  nachricht: ChatNachricht | null;
  senden: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (typ: EtbTyp, inhalt: string) => void;
}

export default function HeraufstufenModal({ offen, nachricht, senden, onAbbrechen, onBestaetigen }: Props) {
  const [form] = Form.useForm<FormWerte>();

  // Bei jedem Öffnen den aktuellen Nachrichtentext vorbefüllen.
  useEffect(() => {
    if (offen && nachricht) {
      form.setFieldsValue({ typ: 'meldung', inhalt: nachricht.inhalt ?? '' });
    }
  }, [offen, nachricht, form]);

  return (
    <Modal
      open={offen}
      title="Zu ETB heraufstufen"
      okText="Heraufstufen"
      confirmLoading={senden}
      onOk={() => form.submit()}
      onCancel={onAbbrechen}
      destroyOnHidden
    >
      <Form<FormWerte>
        form={form}
        layout="vertical"
        onFinish={(w) => onBestaetigen(w.typ, w.inhalt.trim())}
      >
        <Form.Item label="ETB-Typ" name="typ" rules={[{ required: true }]}>
          <Select options={TYP_OPTIONEN} />
        </Form.Item>
        <Form.Item label="Text" name="inhalt" rules={[{ required: true, whitespace: true, message: 'Text erforderlich' }]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 8: Test ausführen (muss bestehen)**

Run: `cd frontend && pnpm test HeraufstufenModal`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/chat/KanalListe.tsx frontend/src/chat/KanalListe.test.tsx frontend/src/chat/HeraufstufenModal.tsx frontend/src/chat/HeraufstufenModal.test.tsx
git commit -m "feat(chat): KanalListe + HeraufstufenModal (presentational, getestet)"
```

---

## Task 12: Frontend — ChatPage + Verdrahtung

**Files:**
- Create: `frontend/src/pages/ChatPage.tsx` (+ `.test.tsx`)
- Modify: `frontend/src/App.tsx` (Import + `MODUL_ELEMENTE`)
- Modify: `frontend/src/einsatz/modulRegistry.ts` (Eintrag `chat` → `status: 'fertig'`)

- [ ] **Step 1: Failing page test schreiben**

Create `frontend/src/pages/ChatPage.test.tsx` (MSW-Muster wie `LageberichtePage.test.tsx`):

```typescript
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import ChatPage from './ChatPage';
import type { ChatKanal, ChatNachricht, EinsatzAnzeige } from '../api/types';

const admin = {
  id: 1, anzeigename: 'A', benutzername: 'a', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-06-02 10:00:00',
};

const einsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-06-02 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-06-02 09:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Orga',
};

const kanal: ChatKanal = {
  id: 1, einsatz_id: 7, name: 'Allgemein', beschreibung: null,
  erstellt_von_id: 1, erstellt_at: '2026-06-10 09:00:00', archiviert_at: null,
};

const nachricht: ChatNachricht = {
  id: 5, einsatz_id: 7, kanal_id: 1, autor_id: 1, autor_name: 'A',
  inhalt: 'Erste Lage', erstellt_at: '2026-06-10 10:00:00',
  bearbeitet_at: null, geloescht_at: null, etb_eintrag_id: null,
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/chat/kanaele', () => HttpResponse.json([kanal])),
    http.get('/api/einsaetze/7/chat/kanaele/1/nachrichten', () => HttpResponse.json([nachricht])),
    http.post('/api/einsaetze/7/chat/kanaele/1/nachrichten', async ({ request }) => {
      const body = (await request.json()) as { inhalt: string };
      return HttpResponse.json(
        { ...nachricht, id: 6, inhalt: body.inhalt }, { status: 201 },
      );
    }),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/chat" element={<ChatPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/chat' },
  );
}

describe('ChatPage', () => {
  it('zeigt Kanal und Nachrichten und erlaubt das Senden', async () => {
    setup();
    expect(await screen.findByText('Erste Lage')).toBeInTheDocument();
    expect(screen.getByText('Allgemein')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Nachricht…'), 'Neue Meldung');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    // Nach dem Senden invalidiert die Mutation die Query; der neue Eintrag erscheint.
    expect(await screen.findByText('Neue Meldung')).toBeInTheDocument();
  });
});
```

Hinweis: Falls der `findByText('Neue Meldung')`-Schritt durch MSW-Re-Fetch-Timing flaky ist, im Test den GET-Handler nach dem POST auf `[nachricht, {…id:6}]` umstellen (`server.use` erneut). Primär gilt der Render-/Sende-Pfad als Nachweis.

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

Run: `cd frontend && pnpm test ChatPage`
Expected: FAIL (Seite fehlt).

- [ ] **Step 3: ChatPage implementieren**

Create `frontend/src/pages/ChatPage.tsx`:

```typescript
import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  bearbeiteNachricht, heraufstufenZuEtb, legeKanalAn, listeKanaele, listeNachrichten,
  loescheNachricht, sendeNachricht,
} from '../api/chat';
import type { ChatNachricht, EtbTyp } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import KanalListe from '../chat/KanalListe';
import NachrichtenStrom from '../chat/NachrichtenStrom';
import NachrichtEingabe from '../chat/NachrichtEingabe';
import HeraufstufenModal from '../chat/HeraufstufenModal';

export default function ChatPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [aktiverKanal, setAktiverKanal] = useState<number | null>(null);
  const [heraufstufen, setHeraufstufen] = useState<ChatNachricht | null>(null);

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const kanaeleQuery = useQuery({
    queryKey: ['einsatz-chat-kanaele', einsatzId],
    queryFn: () => listeKanaele(einsatzId),
  });

  // Default-Kanal wählen, sobald die Liste da ist und noch keiner aktiv ist.
  const kanaele = kanaeleQuery.data ?? [];
  const kanalId = aktiverKanal ?? kanaele[0]?.id ?? null;

  const nachrichtenQuery = useQuery({
    queryKey: ['einsatz-chat-nachrichten', einsatzId, kanalId],
    queryFn: () => listeNachrichten(einsatzId, kanalId as number),
    enabled: kanalId !== null,
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiereNachrichten = () =>
    qc.invalidateQueries({ queryKey: ['einsatz-chat-nachrichten', einsatzId] });

  const sendenMutation = useMutation({
    mutationFn: (text: string) => sendeNachricht(einsatzId, kanalId as number, text),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const bearbeitenMutation = useMutation({
    mutationFn: ({ id: nid, text }: { id: number; text: string }) => bearbeiteNachricht(einsatzId, nid, text),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const loeschenMutation = useMutation({
    mutationFn: (nid: number) => loescheNachricht(einsatzId, nid),
    onSuccess: invalidiereNachrichten,
    onError: fehler,
  });
  const kanalMutation = useMutation({
    mutationFn: (daten: { name: string; beschreibung?: string }) => legeKanalAn(einsatzId, daten),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['einsatz-chat-kanaele', einsatzId] }),
    onError: fehler,
  });
  const heraufstufenMutation = useMutation({
    mutationFn: ({ nid, typ, text }: { nid: number; typ: EtbTyp; text: string }) =>
      heraufstufenZuEtb(einsatzId, nid, typ, text),
    onSuccess: () => {
      invalidiereNachrichten();
      setHeraufstufen(null);
      message.success('Zu ETB heraufgestuft');
    },
    onError: fehler,
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
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  // Anzeige aufsteigend (älteste oben, neueste unten); Server liefert DESC.
  const nachrichten = [...(nachrichtenQuery.data ?? [])].sort((a, b) => a.id - b.id);

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Chat' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Chat</Typography.Title>
      <Row gutter={16}>
        <Col flex="220px">
          <KanalListe
            kanaele={kanaele}
            aktiverKanalId={kanalId}
            onWechsel={setAktiverKanal}
            darfSchreiben={darfSchreiben}
            onKanalAnlegen={(name, beschreibung) => kanalMutation.mutate({ name, beschreibung })}
          />
        </Col>
        <Col flex="auto">
          {nachrichtenQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              message="Nachrichten konnten nicht geladen werden" />
          )}
          <NachrichtenStrom
            nachrichten={nachrichten}
            eigeneBenutzerId={benutzer?.id ?? null}
            darfSchreiben={darfSchreiben}
            onBearbeiten={(n) => {
              const text = window.prompt('Nachricht bearbeiten', n.inhalt ?? '');
              if (text && text.trim()) bearbeitenMutation.mutate({ id: n.id, text: text.trim() });
            }}
            onLoeschen={(n) => loeschenMutation.mutate(n.id)}
            onHeraufstufen={(n) => setHeraufstufen(n)}
          />
          {darfSchreiben && kanalId !== null && (
            <NachrichtEingabe onSenden={(t) => sendenMutation.mutate(t)} senden={sendenMutation.isPending} />
          )}
        </Col>
      </Row>
      <HeraufstufenModal
        offen={heraufstufen !== null}
        nachricht={heraufstufen}
        senden={heraufstufenMutation.isPending}
        onAbbrechen={() => setHeraufstufen(null)}
        onBestaetigen={(typ, text) => {
          if (heraufstufen) heraufstufenMutation.mutate({ nid: heraufstufen.id, typ, text });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Seite registrieren**

In `frontend/src/App.tsx`:

1. Import nach `import EtbPage from './pages/EtbPage';` (Zeile 11) ergänzen:

```typescript
import ChatPage from './pages/ChatPage';
```

2. In `MODUL_ELEMENTE` (nach `etb: <EtbPage />,`, Zeile 45) ergänzen:

```typescript
  chat: <ChatPage />,
```

In `frontend/src/einsatz/modulRegistry.ts` den `chat`-Eintrag (Zeile 77) von `status: 'geplant'` auf `status: 'fertig'` ändern:

```typescript
  { key: 'chat', kategorie: 'kommunikation', label: 'Chat', icon: TbMessageCircle, route: 'chat', status: 'fertig', beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).' },
```

- [ ] **Step 5: Tests + Typecheck + Lint**

Run: `cd frontend && pnpm test ChatPage && pnpm typecheck && pnpm lint`
Expected: ChatPage-Test PASS, keine Typ-/Lint-Fehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/pages/ChatPage.test.tsx frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts
git commit -m "feat(chat): ChatPage + Routing-Registrierung, Modul auf 'fertig' (LFH-50)"
```

---

## Task 13: Gesamtverifikation

- [ ] **Step 1: Backend-Suite**

Run: `cargo test`
Expected: vollständig grün.

- [ ] **Step 2: Frontend-Suite (stabiles Gate)**

Run: `cd frontend && pnpm test -- --no-file-parallelism`
Expected: vollständig grün. (`--no-file-parallelism` gegen Last-Flakiness der vollen Suite.)

- [ ] **Step 3: Frontend ins Binary einbetten + Smoke**

Run: `cd frontend && pnpm build && cd .. && cargo build`
Expected: Build grün. (Frontend ist via rust-embed ins Binary eingebettet — der `pnpm build` ist nötig, damit ein manueller App-Test das neue Bundle zeigt.)

- [ ] **Step 4: REQUIRED SUB-SKILL — `superpowers:verification-before-completion`** vor jeder „fertig"-Aussage. Danach `superpowers:requesting-code-review` (Board-Status `in review`), dann `superpowers:finishing-a-development-branch` (Merge → `shipped`/`done`). Commits/PR referenzieren `LFH-50`.

---

## Self-Review (Plan ↔ Spec)

**Spec-Abdeckung:**
- Kanäle frei anlegbar + Default „Allgemein" → Task 1 (Schema), 2 (Repo lazy-Default), 11/12 (UI). ✔
- Nachrichten (Kanal, Autor, Zeit, Text) live über bestehenden Hub → Task 1, 3, 6 (`sse_chat`/`publiziere_event`), 9 (`chat`-Listener), 12. ✔
- Rollen (Schreiben = Leitung/Führung; Beobachter lesen) → Task 6 (Gates), 7 (Integrationstest), 12 (`darfSchreiben`). ✔
- Bearbeiten/Soft-Löschen eigener Nachrichten → Task 4 (Repo), 6 (`fordere_autor`), 7 (Autor-Test), 10/12. ✔
- Heraufstufen → ETB (transaktional, Rückverweis, Doppel-Guard, Typ-Allowlist, Snapshot-Ereigniszeit, Badge) → Task 5, 6, 7, 11, 12. ✔
- Kein Auto-ETB, kein FTS, kein eigener SSE-Endpoint, kein Quittierungs-Workflow → durch Designtreue gewahrt (Task 6 nutzt vorhandenen Stream; keine FTS-Tabelle in Task 1). ✔

**Advisor-Punkte als eigene Failing-Tests:**
1. Cross-Einsatz-Schutz (Kanal/Nachricht ↔ Pfad-`einsatz_id`) → Task 7 `kanal_eines_anderen_einsatzes_ist_nicht_erreichbar`; Repo-Guards Task 2/3. ✔
2. Server-seitige ETB-Typ-Allowlist (kein system/berichtigung) → Task 7 `heraufstufen_lehnt_unzulaessige_typen_ab`. ✔
3. Autor-only Edit/Delete (auch Leitung 403) → Task 7 `fremde_nachricht_nicht_bearbeitbar_auch_nicht_durch_leitung`. ✔
4. Query-Key-Reihenfolge `['einsatz-chat-nachrichten', einsatzId, kanalId]` → File-Structure (PINNED) + Task 9 Test + Task 12. ✔
5. Heraufstufen: Ereigniszeit = `erstellt_at`, beide Events publizieren, Snapshot → Task 5 Test (`ereigniszeit == m.erstellt_at`) + Task 6 (`publiziere` + `sse_chat`). ✔

**Platzhalter-Scan:** keine „TBD"/„TODO"/„analog zu …"; jeder Code-Schritt enthält vollständigen Code. ✔
**Typkonsistenz:** `ChatKanalAnzeige`/`ChatNachrichtAnzeige` (Backend) ↔ `ChatKanal`/`ChatNachricht` (Frontend) feldgleich; `NachrichtDaten`/`NachrichtFilter`/`STANDARD_LIMIT` über Tasks 3–7 konsistent; `heraufstufenZuEtb(typ, inhalt)` ↔ Body `{typ, inhalt}` ↔ Handler. ✔
