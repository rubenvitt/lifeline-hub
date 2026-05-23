# ETB-Kern + Live + Suche — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only Einsatztagebuch (ETB) mit server-autoritativer lückenloser `lfd_nr`, Berichtigungen, Drei-Zeitstempel-Modell, SSE-Live-Updates pro Einsatz und FTS5-Volltextsuche mit Filtern + Cursor-Pagination.

**Architecture:** Eine neue Migration (`0004_etb.sql`) ergänzt die Tabelle `etb_eintrag` (append-only, kein UPDATE/DELETE), einen FTS5-Volltextindex samt `AFTER INSERT`-Trigger und Indizes. Ein neues Domänenmodul `etb/` (Typen + Repository) kapselt Erfassung, Abfrage und Suche. Ein neues Modul `live/` hält pro Einsatz einen `tokio::sync::broadcast`-Kanal; neue Einträge werden nach dem Commit an alle SSE-Abonnenten gepusht. Routen liegen in `routes/etb.rs`. Schreibrechte werden über die bestehende Einsatz-Rollen-Logik durchgesetzt.

**Tech Stack:** Rust + Axum 0.8 + sqlx 0.8 (SQLite, WAL, FK), `tokio::sync::broadcast` + `tokio-stream` (SSE), SQLite FTS5 (im gebündelten SQLite enthalten), `chrono` (Zeitnormalisierung). Tests: Unit-Tests im Modul (`#[cfg(test)]`), Integrationstests in `tests/etb.rs` über `tower::ServiceExt::oneshot`.

---

## Zentrale Architektur-Entscheidungen (verbindlich)

Diese Entscheidungen sind in den Tasks ausformuliert; hier zur Orientierung gebündelt:

1. **`lfd_nr` lückenlos & atomar** — vergeben über ein **einziges** `INSERT … SELECT COALESCE(MAX(lfd_nr),0)+1 … RETURNING`-Statement. SQLite serialisiert im WAL-Modus alle Writer; dieses eine Statement nimmt den Write-Lock atomar, daher keine Race zwischen zwei Erfassungen. `UNIQUE(einsatz_id, lfd_nr)` ist die Defense-in-Depth-Absicherung. (Eine Transaktion „`SELECT MAX` dann `INSERT`" wäre **falsch**, weil das `SELECT` keinen Write-Lock zieht.)

2. **Append-only** — `etb_eintrag` wird nie per `UPDATE`/`DELETE` geändert. Korrekturen entstehen als **neuer** Eintrag mit `typ = 'berichtigung'` und `berichtigt_eintrag_id` → Originaleintrag. Eine Berichtigung darf selbst berichtigt werden (sie ist ein normaler Eintrag).

3. **Drei Zeitstempel** — `ereigniszeit` (Client, Default = Serverzeit falls fehlend; Anzeige-Sortierung), `received_at` (Server, autoritativ, DB-Default `datetime('now')`), `erfasst_lokal_at` (Client, optional, beratend). Client-Zeiten werden auf das SQLite-Format `YYYY-MM-DD HH:MM:SS` (UTC) **normalisiert**, damit String-Sortierung korrekt bleibt.

4. **Pagination via Cursor auf `lfd_nr`** — die Liste/Suche liefert standardmäßig die neuesten Einträge zuerst (`ORDER BY lfd_nr DESC`), Cursor `before_lfd_nr` blättert zu älteren. `lfd_nr` ist pro Einsatz eindeutig und monoton, daher ein stabiler Cursor. Die **fachliche Anzeige-Sortierung nach `ereigniszeit`** (mit `lfd_nr` als Tie-Break, vgl. Spec §11) erfolgt clientseitig auf dem geladenen Fenster — der Server liefert beide Zeitstempel mit.

5. **SSE-Broadcast pro Einsatz** — `LiveHub` mit `HashMap<einsatz_id, broadcast::Sender<String>>`. Capacity 256 (großzügig für Erfassungs-Bursts; bei Überlauf sendet der Server ein `lagged`-Event und der Client resynct per GET). Leere Kanäle (keine Empfänger) werden opportunistisch entfernt, damit der Server bei vielen abgeschlossenen Einsätzen nicht leakt.

6. **SSE-Auth & Initial-Load** — der Stream ist cookie-authentifiziert (same-origin, Frontend wird in T6 in die Binary eingebettet → kein CORS in T1). Beim Connect werden **keine** Bestands-Einträge re-gesendet: der Client lädt initial per `GET …/etb` und empfängt danach nur **neue** Einträge per SSE.

7. **System-Einträge** — der Typ `system` existiert (für spätere Module), darf in T1 aber **nicht** vom Client erfasst werden (400). Manuelle Erfassung nur: `meldung`, `anordnung`, `lage`, `entscheidung`, `berichtigung`.

**Konvention nach jedem Task:** `cargo test` (alle grün) **und** `cargo clippy --all-targets -- -D warnings` (sauber). Jeder Commit endet mit dem Footer:
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

### Task 1: Migration 0004 — `etb_eintrag` + FTS5 + Trigger + Indizes

**Files:**
- Create: `migrations/0004_etb.sql`
- Test: `src/db.rs` (neuer Test im bestehenden `#[cfg(test)] mod tests`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0004_etb.sql`:

```sql
-- ETB-Eintrag: append-only Einsatztagebuch. Einträge sind nach dem Anlegen
-- unveränderlich (kein UPDATE/DELETE); Korrekturen erfolgen als neuer
-- Berichtigungseintrag (typ='berichtigung'), der den fehlerhaften Eintrag
-- referenziert. lfd_nr ist server-autoritativ und lückenlos pro Einsatz.
CREATE TABLE etb_eintrag (
    id                    INTEGER PRIMARY KEY,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lfd_nr                INTEGER NOT NULL,
    typ                   TEXT NOT NULL
                          CHECK (typ IN ('meldung','anordnung','lage','entscheidung','system','berichtigung')),
    inhalt                TEXT NOT NULL,
    von                   TEXT,
    an                    TEXT,
    meldeweg              TEXT
                          CHECK (meldeweg IS NULL OR meldeweg IN ('funk','telefon','persoenlich','sonstige')),
    veranlassung          TEXT,
    erfasser_id           INTEGER NOT NULL REFERENCES benutzer(id),
    -- Zeitmodell (Spec §11): ereigniszeit = Anzeige-Sortierung (Client/Default jetzt),
    -- received_at = autoritativ (Server), erfasst_lokal_at = beratend (Client, optional).
    ereigniszeit          TEXT NOT NULL,
    received_at           TEXT NOT NULL DEFAULT (datetime('now')),
    erfasst_lokal_at      TEXT,
    berichtigt_eintrag_id INTEGER REFERENCES etb_eintrag(id),
    UNIQUE (einsatz_id, lfd_nr)
);

-- Filter nach Ereigniszeitraum innerhalb eines Einsatzes.
-- (Die Cursor-/Sortier-Query nach lfd_nr nutzt den UNIQUE-Index (einsatz_id, lfd_nr).)
CREATE INDEX idx_etb_einsatz_ereigniszeit ON etb_eintrag(einsatz_id, ereigniszeit);

-- FTS5-Volltextindex über Inhalt + Beteiligte. External-content: der Index
-- verweist per rowid auf etb_eintrag(id). Append-only → nur AFTER INSERT nötig.
CREATE VIRTUAL TABLE etb_eintrag_fts USING fts5(
    inhalt,
    von,
    an,
    veranlassung,
    content='etb_eintrag',
    content_rowid='id'
);

CREATE TRIGGER etb_eintrag_fts_ai AFTER INSERT ON etb_eintrag BEGIN
    INSERT INTO etb_eintrag_fts (rowid, inhalt, von, an, veranlassung)
    VALUES (new.id, new.inhalt, new.von, new.an, new.veranlassung);
END;

-- Anwendungsseitig ist die Tabelle append-only; ein DELETE entsteht nur über
-- ON DELETE CASCADE bei Einsatz-Löschung. Damit der FTS-Index dann nicht
-- verwaist, hält dieser AFTER DELETE-Trigger ihn synchron (FTS5 'delete'-Kommando).
CREATE TRIGGER etb_eintrag_fts_ad AFTER DELETE ON etb_eintrag BEGIN
    INSERT INTO etb_eintrag_fts (etb_eintrag_fts, rowid, inhalt, von, an, veranlassung)
    VALUES ('delete', old.id, old.inhalt, old.von, old.an, old.veranlassung);
END;
```

- [ ] **Step 2: Failing-Test schreiben**

In `src/db.rs`, im bestehenden `#[cfg(test)] mod tests`, am Ende ergänzen (verifiziert zugleich, dass das gebündelte SQLite FTS5 unterstützt — sonst schlägt `test_pool()` schon an der Migration fehl):

```rust
    #[tokio::test]
    async fn etb_migration_legt_tabelle_und_fts_an() {
        let pool = test_pool().await;

        // Org + Benutzer + Einsatz als Voraussetzung anlegen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Eintrag einfügen (ereigniszeit Pflicht, received_at Default).
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Deich bei km 12 instabil', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

        // received_at wurde per Default gesetzt.
        let received: String =
            sqlx::query_scalar("SELECT received_at FROM etb_eintrag WHERE lfd_nr = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!received.is_empty());

        // typ-CHECK lehnt ungültigen Wert ab.
        let bad_typ = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 2, 'geschwafel', 'x', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(bad_typ.is_err(), "ungültiger typ muss abgelehnt werden");

        // UNIQUE(einsatz_id, lfd_nr) verhindert doppelte lfd_nr.
        let dup = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'lage', 'y', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelte lfd_nr muss abgelehnt werden");

        // FTS5-Trigger hat den Eintrag indiziert: Volltextsuche findet ihn.
        let treffer: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Deich'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(treffer, 1, "FTS5-Trigger muss den Eintrag indizieren");
    }
```

- [ ] **Step 3: Test ausführen → erwartet FAIL**

Run: `cargo test --lib db::tests::etb_migration_legt_tabelle_und_fts_an`
Expected: FAIL bzw. Migrationsfehler, bevor die Datei existiert (bzw. PASS sobald Step 1 angelegt — dann Reihenfolge prüfen). Wird die Migration noch nicht gefunden, scheitert `test_pool()`.

> Hinweis: Falls Step 1 schon committet ist, kann dieser Test direkt grün sein. Das ist akzeptabel — die Migration ist reine SQL-Deklaration, der Test ist die Verifikation.

- [ ] **Step 4: Test ausführen → erwartet PASS**

Run: `cargo test --lib db::tests::etb_migration_legt_tabelle_und_fts_an`
Expected: PASS

- [ ] **Step 5: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add migrations/0004_etb.sql src/db.rs
git commit -m "feat(etb): Migration 0004 mit etb_eintrag, FTS5-Index und Trigger

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ETB-Domänentypen — `etb/mod.rs`

**Files:**
- Create: `src/etb/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)
- Modify: `Cargo.toml` (Dependency `chrono`)
- Test: Unit-Tests in `src/etb/mod.rs`

- [ ] **Step 1: `chrono`-Dependency ergänzen**

In `Cargo.toml` unter `[dependencies]` (nach der `argon2`-Zeile) einfügen:

```toml
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

- [ ] **Step 2: Modul in `lib.rs` registrieren**

In `src/lib.rs` die Modulliste alphabetisch um `etb` ergänzen (nach `pub mod einsatz;`):

```rust
pub mod app;
pub mod auth;
pub mod config;
pub mod db;
pub mod einsatz;
pub mod error;
pub mod etb;
pub mod routes;
```

- [ ] **Step 3: Failing-Tests + Typen schreiben**

Create `src/etb/mod.rs`:

```rust
pub mod repo;

use crate::error::AppError;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;

/// Eintragstyp: Meldung.
pub const TYP_MELDUNG: &str = "meldung";
/// Eintragstyp: Anordnung.
pub const TYP_ANORDNUNG: &str = "anordnung";
/// Eintragstyp: Lage.
pub const TYP_LAGE: &str = "lage";
/// Eintragstyp: Entscheidung.
pub const TYP_ENTSCHEIDUNG: &str = "entscheidung";
/// Eintragstyp: System (automatisch durch spätere Module; in T1 nicht client-erfassbar).
pub const TYP_SYSTEM: &str = "system";
/// Eintragstyp: Berichtigung (verweist auf den berichtigten Eintrag).
pub const TYP_BERICHTIGUNG: &str = "berichtigung";

/// Eintragstyp eines ETB-Eintrags. Wird als TEXT in der DB gespeichert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EtbTyp {
    Meldung,
    Anordnung,
    Lage,
    Entscheidung,
    System,
    Berichtigung,
}

impl EtbTyp {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            EtbTyp::Meldung => TYP_MELDUNG,
            EtbTyp::Anordnung => TYP_ANORDNUNG,
            EtbTyp::Lage => TYP_LAGE,
            EtbTyp::Entscheidung => TYP_ENTSCHEIDUNG,
            EtbTyp::System => TYP_SYSTEM,
            EtbTyp::Berichtigung => TYP_BERICHTIGUNG,
        }
    }

    /// Parst einen Typstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<EtbTyp> {
        match s {
            TYP_MELDUNG => Some(EtbTyp::Meldung),
            TYP_ANORDNUNG => Some(EtbTyp::Anordnung),
            TYP_LAGE => Some(EtbTyp::Lage),
            TYP_ENTSCHEIDUNG => Some(EtbTyp::Entscheidung),
            TYP_SYSTEM => Some(EtbTyp::System),
            TYP_BERICHTIGUNG => Some(EtbTyp::Berichtigung),
            _ => None,
        }
    }

    /// Ob dieser Typ eine Berichtigung ist (erfordert `berichtigt_eintrag_id`).
    pub fn ist_berichtigung(&self) -> bool {
        matches!(self, EtbTyp::Berichtigung)
    }

    /// Ob dieser Typ in T1 manuell vom Client erfasst werden darf.
    /// `system` ist Modulen vorbehalten und daher nicht client-erfassbar.
    pub fn darf_client_erfassen(&self) -> bool {
        !matches!(self, EtbTyp::System)
    }
}

/// Meldeweg eines Eintrags (optional).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeldeWeg {
    Funk,
    Telefon,
    Persoenlich,
    Sonstige,
}

impl MeldeWeg {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            MeldeWeg::Funk => "funk",
            MeldeWeg::Telefon => "telefon",
            MeldeWeg::Persoenlich => "persoenlich",
            MeldeWeg::Sonstige => "sonstige",
        }
    }

    /// Parst einen Meldeweg-String; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<MeldeWeg> {
        match s {
            "funk" => Some(MeldeWeg::Funk),
            "telefon" => Some(MeldeWeg::Telefon),
            "persoenlich" => Some(MeldeWeg::Persoenlich),
            "sonstige" => Some(MeldeWeg::Sonstige),
            _ => None,
        }
    }
}

/// Normalisiert eine vom Client gelieferte Zeitangabe auf das SQLite-Format
/// `YYYY-MM-DD HH:MM:SS` (UTC). Akzeptiert RFC3339/ISO-8601 (z.B.
/// `2026-05-23T10:00:00Z`, wie von JS `Date.toISOString()` erzeugt) sowie das
/// SQLite-Format selbst. So bleibt die String-Sortierung nach `ereigniszeit`
/// konsistent. `Validation` (400) bei unbekanntem Format.
pub fn normalisiere_zeit(eingabe: &str) -> Result<String, AppError> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(eingabe) {
        return Ok(dt
            .with_timezone(&Utc)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string());
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(eingabe, "%Y-%m-%d %H:%M:%S") {
        return Ok(ndt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    Err(AppError::Validation(
        "Ungültiges Zeitformat (erwartet ISO-8601)".into(),
    ))
}

/// Öffentliche Darstellung eines ETB-Eintrags für API-Antworten und SSE.
/// `erfasser_name` ist der Anzeigename des Erfassers (per JOIN ermittelt).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EtbEintragAnzeige {
    pub id: i64,
    pub lfd_nr: i64,
    pub typ: String,
    pub inhalt: String,
    pub von: Option<String>,
    pub an: Option<String>,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    pub erfasser_id: i64,
    pub erfasser_name: String,
    pub ereigniszeit: String,
    pub received_at: String,
    pub erfasst_lokal_at: Option<String>,
    pub berichtigt_eintrag_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typ_roundtrip() {
        for s in [
            TYP_MELDUNG,
            TYP_ANORDNUNG,
            TYP_LAGE,
            TYP_ENTSCHEIDUNG,
            TYP_SYSTEM,
            TYP_BERICHTIGUNG,
        ] {
            assert_eq!(EtbTyp::parse(s).unwrap().as_str(), s);
        }
        assert!(EtbTyp::parse("unsinn").is_none());
    }

    #[test]
    fn system_ist_nicht_client_erfassbar() {
        assert!(!EtbTyp::System.darf_client_erfassen());
        assert!(EtbTyp::Meldung.darf_client_erfassen());
        assert!(EtbTyp::Berichtigung.darf_client_erfassen());
    }

    #[test]
    fn berichtigung_erkannt() {
        assert!(EtbTyp::Berichtigung.ist_berichtigung());
        assert!(!EtbTyp::Meldung.ist_berichtigung());
    }

    #[test]
    fn meldeweg_roundtrip() {
        for w in [
            MeldeWeg::Funk,
            MeldeWeg::Telefon,
            MeldeWeg::Persoenlich,
            MeldeWeg::Sonstige,
        ] {
            assert_eq!(MeldeWeg::parse(w.as_str()).unwrap(), w);
        }
        assert!(MeldeWeg::parse("brieftaube").is_none());
    }

    #[test]
    fn normalisiere_rfc3339_nach_sqlite() {
        assert_eq!(
            normalisiere_zeit("2026-05-23T10:00:00Z").unwrap(),
            "2026-05-23 10:00:00"
        );
        // Mit Offset: nach UTC umgerechnet.
        assert_eq!(
            normalisiere_zeit("2026-05-23T12:00:00+02:00").unwrap(),
            "2026-05-23 10:00:00"
        );
    }

    #[test]
    fn normalisiere_akzeptiert_sqlite_format() {
        assert_eq!(
            normalisiere_zeit("2026-05-23 10:00:00").unwrap(),
            "2026-05-23 10:00:00"
        );
    }

    #[test]
    fn normalisiere_lehnt_unsinn_ab() {
        assert!(matches!(
            normalisiere_zeit("gestern").unwrap_err(),
            AppError::Validation(_)
        ));
    }
}
```

> Hinweis: `pub mod repo;` in Zeile 1 erzeugt zunächst einen Kompilierfehler (`repo.rs` fehlt). Lege in Task 4 die Datei an; bis dahin diesen Task **vor** dem Test-Lauf nur kompilieren, wenn `repo.rs` als leere Datei existiert. **Empfehlung:** lege in diesem Task `src/etb/repo.rs` als leere Datei an (`// in Task 4 gefüllt`), damit `etb/mod.rs` kompiliert.

- [ ] **Step 4: Leere `repo.rs` anlegen, damit das Modul kompiliert**

Create `src/etb/repo.rs` mit Platzhalterinhalt:

```rust
// Inhalt folgt in Task 4 (Erfassung), Task 5 (Abfrage) und Task 6 (Suche).
```

- [ ] **Step 5: Tests ausführen → erwartet PASS**

Run: `cargo test --lib etb::tests`
Expected: PASS (alle 6 Tests grün)

- [ ] **Step 6: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add Cargo.toml Cargo.lock src/lib.rs src/etb/mod.rs src/etb/repo.rs
git commit -m "feat(etb): Domänentypen (EtbTyp, MeldeWeg, Zeitnormalisierung)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Schreibrecht-Berechtigung — `einsatz/berechtigung.rs`

**Files:**
- Modify: `src/einsatz/mod.rs` (Methode `darf_schreiben` an `EinsatzRolle`)
- Modify: `src/einsatz/berechtigung.rs` (Helper `fordere_schreibrecht`)
- Test: Unit-Tests in beiden Dateien

- [ ] **Step 1: Failing-Test für `darf_schreiben` schreiben**

In `src/einsatz/mod.rs`, im `#[cfg(test)] mod tests`, ergänzen:

```rust
    #[test]
    fn darf_schreiben_nur_leitung_und_fuehrung() {
        assert!(EinsatzRolle::Einsatzleitung.darf_schreiben());
        assert!(EinsatzRolle::Fuehrungspersonal.darf_schreiben());
        assert!(!EinsatzRolle::Beobachter.darf_schreiben());
    }
```

- [ ] **Step 2: Test ausführen → erwartet FAIL**

Run: `cargo test --lib einsatz::tests::darf_schreiben_nur_leitung_und_fuehrung`
Expected: FAIL (`no method named darf_schreiben`)

- [ ] **Step 3: Methode implementieren**

In `src/einsatz/mod.rs`, im `impl EinsatzRolle`-Block (nach `ist_einsatzleitung`), ergänzen:

```rust
    /// Ob diese Rolle ETB-Einträge erfassen/berichtigen darf
    /// (Einsatzleitung und Führungspersonal; Beobachter ist nur lesend).
    pub fn darf_schreiben(&self) -> bool {
        matches!(
            self,
            EinsatzRolle::Einsatzleitung | EinsatzRolle::Fuehrungspersonal
        )
    }
```

- [ ] **Step 4: Test ausführen → erwartet PASS**

Run: `cargo test --lib einsatz::tests::darf_schreiben_nur_leitung_und_fuehrung`
Expected: PASS

- [ ] **Step 5: Failing-Test für `fordere_schreibrecht` schreiben**

In `src/einsatz/berechtigung.rs`, im `#[cfg(test)] mod tests`, ergänzen:

```rust
    #[test]
    fn fordere_schreibrecht_blockt_beobachter_und_fremde() {
        assert!(fordere_schreibrecht(Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(fordere_schreibrecht(Some(EinsatzRolle::Fuehrungspersonal)).is_ok());
        assert!(matches!(
            fordere_schreibrecht(Some(EinsatzRolle::Beobachter)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_schreibrecht(None).unwrap_err(),
            AppError::Forbidden
        ));
    }
```

- [ ] **Step 6: Test ausführen → erwartet FAIL**

Run: `cargo test --lib einsatz::berechtigung::tests::fordere_schreibrecht_blockt_beobachter_und_fremde`
Expected: FAIL (`cannot find function fordere_schreibrecht`)

- [ ] **Step 7: Helper implementieren**

In `src/einsatz/berechtigung.rs`, nach `fordere_einsatzleitung`, ergänzen:

```rust
/// Stellt sicher, dass der Benutzer im Einsatz schreibberechtigt ist
/// (Einsatzleitung oder Führungspersonal). `Forbidden` bei Beobachter
/// oder fehlender Mitgliedschaft.
pub fn fordere_schreibrecht(rolle: Option<EinsatzRolle>) -> Result<(), AppError> {
    match rolle {
        Some(r) if r.darf_schreiben() => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}
```

- [ ] **Step 8: Test ausführen → erwartet PASS**

Run: `cargo test --lib einsatz::berechtigung::tests`
Expected: PASS

- [ ] **Step 9: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/einsatz/mod.rs src/einsatz/berechtigung.rs
git commit -m "feat(einsatz): Schreibrecht-Prüfung für ETB-Erfassung

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ETB-Repository — Erfassung & Laden — `etb/repo.rs`

**Files:**
- Modify: `src/etb/repo.rs` (Platzhalter durch Implementierung ersetzen)
- Test: Unit-Tests in `src/etb/repo.rs`

- [ ] **Step 1: Repository-Grundgerüst + Erfassung + Laden schreiben**

Ersetze den Platzhalterinhalt von `src/etb/repo.rs` vollständig durch:

```rust
use super::EtbEintragAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für einen neuen ETB-Eintrag. Alle Werte sind bereits
/// validiert und normalisiert (Zeitformat, Pflichtfelder) — das ist Aufgabe
/// des Handlers. Das Repository vergibt `lfd_nr` und `received_at`.
#[derive(Debug)]
pub struct EintragDaten<'a> {
    pub typ: &'a str,
    pub inhalt: &'a str,
    pub von: Option<&'a str>,
    pub an: Option<&'a str>,
    pub meldeweg: Option<&'a str>,
    pub veranlassung: Option<&'a str>,
    /// `None` = Server vergibt `datetime('now')`.
    pub ereigniszeit: Option<&'a str>,
    pub erfasst_lokal_at: Option<&'a str>,
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Legt einen ETB-Eintrag an und liefert ihn als Anzeige zurück.
///
/// `lfd_nr` wird in **einem** atomaren Statement vergeben:
/// `COALESCE(MAX(lfd_nr),0)+1` über alle Einträge desselben Einsatzes.
/// SQLite serialisiert im WAL-Modus alle Writer, daher ist dieses einzelne
/// Statement race-frei; `UNIQUE(einsatz_id, lfd_nr)` sichert zusätzlich ab.
/// `received_at` wird per Spalten-Default `datetime('now')` gesetzt.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EintragDaten<'_>,
) -> Result<EtbEintragAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag \
            (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung, \
             erfasser_id, ereigniszeit, erfasst_lokal_at, berichtigt_eintrag_id) \
         SELECT ?, COALESCE(MAX(lfd_nr), 0) + 1, ?, ?, ?, ?, ?, ?, ?, \
                COALESCE(?, datetime('now')), ?, ? \
         FROM etb_eintrag WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.von)
    .bind(daten.an)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(erfasser_id)
    .bind(daten.ereigniszeit)
    .bind(daten.erfasst_lokal_at)
    .bind(daten.berichtigt_eintrag_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;

    laden(pool, id).await
}

/// Lädt einen einzelnen Eintrag als Anzeige (inkl. Erfasser-Name).
/// `NotFound`, wenn der Eintrag nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<EtbEintragAnzeige, AppError> {
    sqlx::query_as::<_, EtbEintragAnzeige>(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
         WHERE e.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Eintrag mit `eintrag_id` zum angegebenen `einsatz_id` gehört.
/// Für die Validierung von Berichtigungs-Verweisen.
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    eintrag_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM etb_eintrag WHERE id = ? AND einsatz_id = ?")
            .bind(eintrag_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an;
    /// liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    fn daten<'a>(inhalt: &'a str) -> EintragDaten<'a> {
        EintragDaten {
            typ: "meldung",
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some("2026-05-23 10:00:00"),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        }
    }

    #[tokio::test]
    async fn lfd_nr_startet_bei_eins_und_zaehlt_hoch() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let e1 = anlegen(&pool, einsatz, benutzer, daten("Erste Meldung"))
            .await
            .unwrap();
        let e2 = anlegen(&pool, einsatz, benutzer, daten("Zweite Meldung"))
            .await
            .unwrap();
        assert_eq!(e1.lfd_nr, 1);
        assert_eq!(e2.lfd_nr, 2);
        assert_eq!(e1.erfasser_name, "Leitung");
        assert!(!e1.received_at.is_empty());
    }

    #[tokio::test]
    async fn lfd_nr_ist_pro_einsatz_unabhaengig() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz_a) = setup(&pool).await;
        let einsatz_b: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        anlegen(&pool, einsatz_a, benutzer, daten("A1")).await.unwrap();
        let b1 = anlegen(&pool, einsatz_b, benutzer, daten("B1"))
            .await
            .unwrap();
        // Eigener Zähler pro Einsatz: B beginnt wieder bei 1.
        assert_eq!(b1.lfd_nr, 1);
    }

    #[tokio::test]
    async fn ereigniszeit_default_wird_gesetzt_wenn_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut d = daten("Ohne Ereigniszeit");
        d.ereigniszeit = None;

        let e = anlegen(&pool, einsatz, benutzer, d).await.unwrap();
        assert!(!e.ereigniszeit.is_empty(), "Server muss jetzt einsetzen");
    }

    #[tokio::test]
    async fn berichtigung_verknuepft_originaleintrag() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let original = anlegen(&pool, einsatz, benutzer, daten("Tippfehler"))
            .await
            .unwrap();

        let mut korrektur = daten("Korrektur des Eintrags");
        korrektur.typ = "berichtigung";
        korrektur.berichtigt_eintrag_id = Some(original.id);
        let b = anlegen(&pool, einsatz, benutzer, korrektur).await.unwrap();

        assert_eq!(b.typ, "berichtigung");
        assert_eq!(b.berichtigt_eintrag_id, Some(original.id));
        assert_eq!(b.lfd_nr, 2);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, benutzer, daten("X")).await.unwrap();

        assert!(gehoert_zu_einsatz(&pool, e.id, einsatz).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, e.id, 999).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(laden(&pool, 999).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 2: Tests ausführen → erwartet PASS**

Run: `cargo test --lib etb::repo::tests`
Expected: PASS (alle 6 Tests grün)

- [ ] **Step 3: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/etb/repo.rs
git commit -m "feat(etb): Erfassung mit atomarer lfd_nr-Vergabe und Laden

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ETB-Repository — Abfrage mit Filtern & Cursor — `etb/repo.rs`

**Files:**
- Modify: `src/etb/repo.rs` (Filter-Struct + `abfrage`)
- Test: Unit-Tests in `src/etb/repo.rs`

- [ ] **Step 1: Filter-Struct + `abfrage` schreiben (ohne FTS)**

In `src/etb/repo.rs`, am Anfang den Import um `QueryBuilder` erweitern:

```rust
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
```

Dann nach `gehoert_zu_einsatz` (vor `#[cfg(test)]`) einfügen:

```rust
/// Standard-Seitengröße der ETB-Abfrage.
pub const STANDARD_LIMIT: i64 = 100;
/// Maximale Seitengröße (Schutz vor Riesen-Responses).
pub const MAX_LIMIT: i64 = 500;

/// Filter- und Pagination-Parameter für die ETB-Abfrage.
/// Alle Filter sind optional und werden mit UND verknüpft.
#[derive(Debug, Default)]
pub struct EtbFilter {
    /// Volltextsuche (FTS5) über Inhalt/Von/An/Veranlassung. Wird in Task 6 ausgewertet.
    pub q: Option<String>,
    /// Eintragstyp-Filter (z.B. "meldung").
    pub typ: Option<String>,
    /// Untere Grenze `ereigniszeit >=` (normalisiert).
    pub von_zeit: Option<String>,
    /// Obere Grenze `ereigniszeit <=` (normalisiert).
    pub bis_zeit: Option<String>,
    /// Filter nach Erfasser.
    pub erfasser_id: Option<i64>,
    /// Cursor: nur Einträge mit `lfd_nr <` diesem Wert (für ältere Seiten).
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (vom Handler auf [1, MAX_LIMIT] geklemmt).
    pub limit: i64,
}

/// Fragt Einträge eines Einsatzes ab. Sortierung: `lfd_nr DESC` (neueste zuerst),
/// stabiler Cursor über `before_lfd_nr`. Die fachliche Anzeige-Sortierung nach
/// `ereigniszeit` erfolgt clientseitig (beide Zeitstempel werden geliefert).
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &EtbFilter,
) -> Result<Vec<EtbEintragAnzeige>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id",
    );

    // FTS-Join nur, wenn ein Volltext-Query gesetzt ist (Auswertung in Task 6).
    // Der Join verbindet nur per rowid; das MATCH gehört in die WHERE-Klausel
    // (FTS5 wertet MATCH nur als top-level AND-Term gegen die FTS-Tabelle aus).
    let fts: Option<String> = filter
        .q
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(fts_query)
        // Falls die Eingabe nur Sonderzeichen war, ist die FTS-Query leer → kein Filter.
        .filter(|s| !s.is_empty());
    // FTS-Tabelle NICHT aliasen: das MATCH-Prädikat muss die FTS-Tabelle beim
    // Originalnamen ansprechen (`etb_eintrag_fts MATCH ?`). Eine Alias-Kurzform
    // wie `f MATCH ?` lehnt SQLite mit „no such column: f" ab.
    if fts.is_some() {
        qb.push(" JOIN etb_eintrag_fts ON etb_eintrag_fts.rowid = e.id");
    }

    qb.push(" WHERE e.einsatz_id = ");
    qb.push_bind(einsatz_id);

    if let Some(fts_q) = fts {
        qb.push(" AND etb_eintrag_fts MATCH ");
        qb.push_bind(fts_q);
    }

    if let Some(typ) = &filter.typ {
        qb.push(" AND e.typ = ");
        qb.push_bind(typ);
    }
    if let Some(v) = &filter.von_zeit {
        qb.push(" AND e.ereigniszeit >= ");
        qb.push_bind(v);
    }
    if let Some(b) = &filter.bis_zeit {
        qb.push(" AND e.ereigniszeit <= ");
        qb.push_bind(b);
    }
    if let Some(eid) = filter.erfasser_id {
        qb.push(" AND e.erfasser_id = ");
        qb.push_bind(eid);
    }
    if let Some(cursor) = filter.before_lfd_nr {
        qb.push(" AND e.lfd_nr < ");
        qb.push_bind(cursor);
    }

    qb.push(" ORDER BY e.lfd_nr DESC LIMIT ");
    qb.push_bind(filter.limit);

    qb.build_query_as::<EtbEintragAnzeige>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Wandelt eine Nutzereingabe in eine sichere FTS5-Query um: jedes Token wird
/// als Phrase in Anführungszeichen gesetzt (interne `"` verdoppelt), Tokens mit
/// Leerzeichen verbunden (FTS5 = implizites UND). Verhindert Syntaxfehler bei
/// Sonderzeichen wie `:`, `*`, `AND`.
///
/// Tokens ohne alphanumerische Zeichen (z.B. `*`, `:`) werden verworfen: sie
/// würden nach dem Quoten zu einer leeren Phrase, die FTS5 als Syntaxfehler
/// ablehnt. Enthält die Eingabe nur solche Tokens, ist das Ergebnis ein leerer
/// String (der Aufrufer behandelt leeres `q` als „kein Filter").
fn fts_query(eingabe: &str) -> String {
    eingabe
        .split_whitespace()
        .filter(|t| t.chars().any(|c| c.is_alphanumeric()))
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}
```

> Hinweis: `fts_query` wird in diesem Task bereits aufgerufen (FTS-Join). Die zugehörigen Suchtests kommen in Task 6; hier wird `fts_query` nur definiert und der Join verdrahtet.

- [ ] **Step 2: Tests für Filter & Cursor schreiben**

In `src/etb/repo.rs`, im `#[cfg(test)] mod tests`, ergänzen:

```rust
    fn filter() -> EtbFilter {
        EtbFilter {
            limit: STANDARD_LIMIT,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn abfrage_sortiert_neueste_zuerst() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("erst")).await.unwrap();
        anlegen(&pool, einsatz, benutzer, daten("dann")).await.unwrap();

        let liste = abfrage(&pool, einsatz, &filter()).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].lfd_nr, 2, "neuester Eintrag zuerst");
        assert_eq!(liste[1].lfd_nr, 1);
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_typ() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("eine meldung")).await.unwrap();
        let mut anordnung = daten("eine anordnung");
        anordnung.typ = "anordnung";
        anlegen(&pool, einsatz, benutzer, anordnung).await.unwrap();

        let mut f = filter();
        f.typ = Some("anordnung".into());
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].typ, "anordnung");
    }

    #[tokio::test]
    async fn abfrage_filtert_nach_zeitraum() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut frueh = daten("frueh");
        frueh.ereigniszeit = Some("2026-05-23 08:00:00");
        anlegen(&pool, einsatz, benutzer, frueh).await.unwrap();
        let mut spaet = daten("spaet");
        spaet.ereigniszeit = Some("2026-05-23 18:00:00");
        anlegen(&pool, einsatz, benutzer, spaet).await.unwrap();

        let mut f = filter();
        f.von_zeit = Some("2026-05-23 12:00:00".into());
        let liste = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt, "spaet");
    }

    #[tokio::test]
    async fn abfrage_cursor_blaettert_zu_aelteren() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for i in 1..=3 {
            anlegen(&pool, einsatz, benutzer, daten(&format!("e{i}")))
                .await
                .unwrap();
        }

        let mut f = filter();
        f.limit = 1;
        let seite1 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite1[0].lfd_nr, 3);

        f.before_lfd_nr = Some(seite1[0].lfd_nr);
        let seite2 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite2[0].lfd_nr, 2);
    }

    #[tokio::test]
    async fn abfrage_limit_begrenzt_anzahl() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        for i in 1..=5 {
            anlegen(&pool, einsatz, benutzer, daten(&format!("e{i}")))
                .await
                .unwrap();
        }
        let mut f = filter();
        f.limit = 2;
        assert_eq!(abfrage(&pool, einsatz, &f).await.unwrap().len(), 2);
    }
```

- [ ] **Step 3: Tests ausführen → erwartet PASS**

Run: `cargo test --lib etb::repo::tests`
Expected: PASS (Task-4- und Task-5-Tests grün)

- [ ] **Step 4: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/etb/repo.rs
git commit -m "feat(etb): Abfrage mit Typ-/Zeit-/Erfasser-Filtern und Cursor-Pagination

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ETB-Repository — Volltextsuche (FTS5) — `etb/repo.rs`

**Files:**
- Modify: `src/etb/repo.rs` (nur Tests — `fts_query` + Join existieren bereits aus Task 5)
- Test: Unit-Tests in `src/etb/repo.rs`

> Die Verdrahtung (FTS-Join + `fts_query`) wurde in Task 5 erstellt. Dieser Task verifiziert das Suchverhalten und das Query-Escaping mit Tests.

- [ ] **Step 1: Suchtests schreiben**

In `src/etb/repo.rs`, im `#[cfg(test)] mod tests`, ergänzen:

```rust
    #[tokio::test]
    async fn suche_findet_eintrag_per_volltext() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Deich bei km 12 instabil"))
            .await
            .unwrap();
        anlegen(&pool, einsatz, benutzer, daten("Lagebesprechung 14 Uhr"))
            .await
            .unwrap();

        let mut f = filter();
        f.q = Some("Deich".into());
        let treffer = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(treffer.len(), 1);
        assert!(treffer[0].inhalt.contains("Deich"));
    }

    #[tokio::test]
    async fn suche_kombiniert_mit_typ_filter() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Hochwasser steigt")).await.unwrap();
        let mut anordnung = daten("Hochwasser-Sperre einrichten");
        anordnung.typ = "anordnung";
        anlegen(&pool, einsatz, benutzer, anordnung).await.unwrap();

        let mut f = filter();
        f.q = Some("Hochwasser".into());
        f.typ = Some("anordnung".into());
        let treffer = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(treffer.len(), 1);
        assert_eq!(treffer[0].typ, "anordnung");
    }

    #[tokio::test]
    async fn suche_mit_sonderzeichen_wirft_keinen_fehler() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        anlegen(&pool, einsatz, benutzer, daten("Status: alles ruhig"))
            .await
            .unwrap();

        // FTS5-Sonderzeichen dürfen keinen Syntaxfehler auslösen (Escaping greift).
        let mut f = filter();
        f.q = Some("Status: \"alles\" AND *".into());
        let ergebnis = abfrage(&pool, einsatz, &f).await;
        assert!(ergebnis.is_ok(), "Sonderzeichen müssen sicher behandelt werden");
    }

    #[tokio::test]
    async fn suche_findet_in_von_feld() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut d = daten("Routinemeldung");
        d.von = Some("Abschnitt Nord");
        anlegen(&pool, einsatz, benutzer, d).await.unwrap();

        let mut f = filter();
        f.q = Some("Nord".into());
        assert_eq!(abfrage(&pool, einsatz, &f).await.unwrap().len(), 1);
    }
```

- [ ] **Step 2: Tests ausführen → erwartet PASS**

Run: `cargo test --lib etb::repo::tests`
Expected: PASS (alle Repo-Tests grün)

- [ ] **Step 3: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/etb/repo.rs
git commit -m "test(etb): Volltextsuche (FTS5) inkl. Sonderzeichen-Escaping abgesichert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Live-Broadcast-Registry — `live/mod.rs`

**Files:**
- Create: `src/live/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)
- Test: Unit-Tests in `src/live/mod.rs`

- [ ] **Step 1: Modul in `lib.rs` registrieren**

In `src/lib.rs` die Modulliste um `live` ergänzen (nach `pub mod etb;`):

```rust
pub mod app;
pub mod auth;
pub mod config;
pub mod db;
pub mod einsatz;
pub mod error;
pub mod etb;
pub mod live;
pub mod routes;
```

- [ ] **Step 2: `LiveHub` + Tests schreiben**

Create `src/live/mod.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

/// Kapazität des Broadcast-Puffers pro Einsatz. Großzügig bemessen für
/// Erfassungs-Bursts; läuft ein langsamer Client über, erhält er ein
/// `lagged`-Signal und resynct per GET (siehe SSE-Route).
const KANAL_KAPAZITAET: usize = 256;

/// Registry der Live-Kanäle: pro Einsatz ein Broadcast-Sender, über den
/// neu erfasste ETB-Einträge (als JSON-String) an alle SSE-Abonnenten gehen.
///
/// Klonbar (teilt denselben inneren Zustand) — wird im `AppState` gehalten.
#[derive(Clone, Default)]
pub struct LiveHub {
    kanaele: Arc<RwLock<HashMap<i64, broadcast::Sender<String>>>>,
}

impl LiveHub {
    /// Neuer, leerer Hub.
    pub fn new() -> Self {
        Self::default()
    }

    /// Abonniert den Live-Kanal eines Einsatzes (legt ihn bei Bedarf an)
    /// und liefert einen Empfänger für neue Einträge.
    pub fn abonniere(&self, einsatz_id: i64) -> broadcast::Receiver<String> {
        let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
        let sender = kanaele
            .entry(einsatz_id)
            .or_insert_with(|| broadcast::channel(KANAL_KAPAZITAET).0);
        sender.subscribe()
    }

    /// Sendet eine Nachricht an alle Abonnenten eines Einsatzes.
    /// Ohne Kanal/Abonnenten passiert nichts. Ein Kanal ohne Empfänger wird
    /// opportunistisch entfernt, damit der Hub nicht über abgeschlossene
    /// Einsätze hinweg leakt.
    pub fn publiziere(&self, einsatz_id: i64, nachricht: String) {
        // Häufiger Fall (Kanal existiert): nur Lese-Lock.
        let keine_empfaenger = {
            let kanaele = self.kanaele.read().expect("LiveHub-Lock");
            match kanaele.get(&einsatz_id) {
                // send() liefert Err, wenn kein Empfänger mehr lauscht.
                Some(sender) => sender.send(nachricht).is_err(),
                None => false,
            }
        };

        if keine_empfaenger {
            let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
            // Erneut prüfen: zwischen den Locks könnte ein neuer Abonnent dazugekommen sein.
            if let Some(sender) = kanaele.get(&einsatz_id) {
                if sender.receiver_count() == 0 {
                    kanaele.remove(&einsatz_id);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn abonnent_empfaengt_publizierte_nachricht() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        assert_eq!(rx.recv().await.unwrap(), "hallo");
    }

    #[tokio::test]
    async fn nachricht_geht_nur_an_passenden_einsatz() {
        let hub = LiveHub::new();
        let mut rx1 = hub.abonniere(1);
        let mut rx2 = hub.abonniere(2);
        hub.publiziere(1, "fuer-eins".into());

        assert_eq!(rx1.recv().await.unwrap(), "fuer-eins");
        // Einsatz 2 hat nichts bekommen.
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn publiziere_ohne_abonnenten_ist_harmlos() {
        let hub = LiveHub::new();
        hub.publiziere(99, "niemand-hoert".into()); // darf nicht panicken
    }

    #[tokio::test]
    async fn kanal_ohne_empfaenger_wird_entfernt() {
        let hub = LiveHub::new();
        let rx = hub.abonniere(1);
        drop(rx); // letzter Empfänger weg
        hub.publiziere(1, "ins-leere".into()); // löst Cleanup aus

        // Interner Zustand: Kanal entfernt.
        assert!(hub.kanaele.read().unwrap().get(&1).is_none());
    }

    #[tokio::test]
    async fn mehrere_abonnenten_erhalten_dieselbe_nachricht() {
        let hub = LiveHub::new();
        let mut a = hub.abonniere(1);
        let mut b = hub.abonniere(1);
        hub.publiziere(1, "broadcast".into());
        assert_eq!(a.recv().await.unwrap(), "broadcast");
        assert_eq!(b.recv().await.unwrap(), "broadcast");
    }
}
```

- [ ] **Step 3: Tests ausführen → erwartet PASS**

Run: `cargo test --lib live::tests`
Expected: PASS (alle 5 Tests grün)

- [ ] **Step 4: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/lib.rs src/live/mod.rs
git commit -m "feat(live): Broadcast-Registry pro Einsatz für SSE-Updates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: ETB-Erfassung — Route `POST /api/einsaetze/{id}/etb` + Live-Publish

**Files:**
- Modify: `src/app.rs` (`AppState.live`-Feld + Router-Route)
- Modify: `src/main.rs`, `tests/health.rs`, `tests/auth.rs`, `tests/benutzer.rs`, `tests/einsatz.rs` (AppState-Konstruktion)
- Create: `src/routes/etb.rs`
- Modify: `src/routes/mod.rs` (Modul registrieren)
- Create: `tests/etb.rs`
- Test: Integrationstests in `tests/etb.rs`

- [ ] **Step 1: `AppState` um `live` erweitern + erste Route verdrahten**

In `src/app.rs`:

Den Import um `LiveHub` ergänzen und das Feld hinzufügen:

```rust
use crate::live::LiveHub;
use crate::routes;
use axum::{
    routing::{delete, get, post, put},
    Router,
};
use sqlx::SqlitePool;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub live: LiveHub,
}
```

Im `build_router` nach der `mitglied_entfernen`-Route die ETB-Erfassungsroute ergänzen (vor `.with_state(state)`):

```rust
        .route("/api/einsaetze/{id}/etb", post(routes::etb::erfassen))
```

- [ ] **Step 2: Alle `AppState`-Konstruktionsstellen anpassen**

`AppState { pool }` → `AppState { pool, live: LiveHub::new() }` an folgenden Stellen.

In `src/main.rs` zuerst den Import ergänzen:

```rust
use lifeline_hub::live::LiveHub;
```
und Zeile 37 ändern zu:
```rust
    let app = build_router(AppState { pool, live: LiveHub::new() });
```

In `tests/health.rs` (beide Stellen, Zeilen 10 und 38) den Import `use lifeline_hub::live::LiveHub;` ergänzen und `AppState { pool }` → `AppState { pool, live: LiveHub::new() }`.

In `tests/auth.rs` (Zeile 14) und `tests/benutzer.rs` (Zeile 13): jeweils Import `use lifeline_hub::live::LiveHub;` ergänzen und `build_router(AppState { pool })` → `build_router(AppState { pool, live: LiveHub::new() })`.

`tests/einsatz.rs` wird in Step 4 separat angepasst (dort wird der Hub im Test verwendet).

- [ ] **Step 3: Modul registrieren + Handler schreiben**

In `src/routes/mod.rs` ergänzen:

```rust
pub mod auth;
pub mod benutzer;
pub mod einsatz;
pub mod etb;
pub mod health;
```

Create `src/routes/etb.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::fordere_schreibrecht;
use crate::einsatz::repo as einsatz_repo;
use crate::einsatz::berechtigung::fordere_aktiv;
use crate::error::AppError;
use crate::etb::{normalisiere_zeit, repo, EtbEintragAnzeige, EtbTyp, MeldeWeg};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerEintrag {
    pub typ: String,
    pub inhalt: String,
    pub von: Option<String>,
    pub an: Option<String>,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    /// ISO-8601/RFC3339 oder SQLite-Format; fehlt das Feld, setzt der Server „jetzt".
    pub ereigniszeit: Option<String>,
    pub erfasst_lokal_at: Option<String>,
    /// Pflicht bei `typ = "berichtigung"`, sonst muss es fehlen.
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// POST /api/einsaetze/{id}/etb — neuen ETB-Eintrag erfassen.
/// Nur Schreibberechtigte (Einsatzleitung/Führungspersonal), nur bei aktivem
/// Einsatz. Der Server vergibt `lfd_nr` und `received_at` und broadcastet den
/// fertigen Eintrag an alle SSE-Abonnenten.
pub async fn erfassen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerEintrag>,
) -> Result<(StatusCode, Json<EtbEintragAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Typ validieren; System ist nicht client-erfassbar.
    let typ = EtbTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Eintragstyp".into()))?;
    if !typ.darf_client_erfassen() {
        return Err(AppError::Validation(
            "Eintragstyp 'system' kann nicht manuell erfasst werden".into(),
        ));
    }

    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }

    // Meldeweg validieren (falls gesetzt).
    let meldeweg = bereinige(req.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    // Berichtigungs-Regeln (Spec §6: Korrekturen nur als verknüpfte Berichtigung).
    if typ.ist_berichtigung() {
        let ziel = req.berichtigt_eintrag_id.ok_or_else(|| {
            AppError::Validation("Berichtigung erfordert berichtigt_eintrag_id".into())
        })?;
        if !repo::gehoert_zu_einsatz(&state.pool, ziel, einsatz_id).await? {
            return Err(AppError::Validation(
                "Berichtigter Eintrag gehört nicht zu diesem Einsatz".into(),
            ));
        }
    } else if req.berichtigt_eintrag_id.is_some() {
        return Err(AppError::Validation(
            "berichtigt_eintrag_id ist nur bei typ='berichtigung' erlaubt".into(),
        ));
    }

    // Zeiten normalisieren (None = Server-Default in der DB).
    let ereigniszeit = match &req.ereigniszeit {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };
    let erfasst_lokal_at = match &req.erfasst_lokal_at {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };

    let von = bereinige(req.von);
    let an = bereinige(req.an);
    let veranlassung = bereinige(req.veranlassung);

    let anzeige = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::EintragDaten {
            typ: typ.as_str(),
            inhalt,
            von: von.as_deref(),
            an: an.as_deref(),
            meldeweg: meldeweg.as_deref(),
            veranlassung: veranlassung.as_deref(),
            ereigniszeit: ereigniszeit.as_deref(),
            erfasst_lokal_at: erfasst_lokal_at.as_deref(),
            berichtigt_eintrag_id: req.berichtigt_eintrag_id,
        },
    )
    .await?;

    // Live an alle SSE-Abonnenten dieses Einsatzes pushen. Eine Serialisierung
    // dieses Typs kann derzeit nicht fehlschlagen; sollte sie es künftig doch,
    // wird der Eintrag (bereits persistiert) nicht stillschweigend verschluckt,
    // sondern protokolliert.
    match serde_json::to_string(&anzeige) {
        Ok(json) => state.live.publiziere(einsatz_id, json),
        Err(e) => tracing::error!(
            eintrag_id = anzeige.id,
            %e,
            "ETB-Eintrag konnte nicht für Live-Publish serialisiert werden"
        ),
    }

    Ok((StatusCode::CREATED, Json(anzeige)))
}
```

- [ ] **Step 4: Integrationstests schreiben (`tests/etb.rs`)**

Create `tests/etb.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use std::time::Duration;
use tower::ServiceExt;

/// Router + Bootstrap-Admin (admin / startpw12); liefert zusätzlich den LiveHub,
/// damit Tests direkt am Broadcast-Kanal lauschen können.
async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
    });
    (router, live)
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
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
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

async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    benutzername: &str,
    org_rolle: &str,
) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{benutzername}","benutzername":"{benutzername}","passwort":"{benutzername}pw1","org_rolle":"{org_rolle}"}}"#
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
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let body = format!(r#"{{"bezeichnung":"{bezeichnung}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/einsaetze")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Erfasst einen Eintrag mit gegebenem JSON-Body; liefert (Status, JSON).
async fn eintrag_erfassen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: &str,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn einsatzleitung_erfasst_eintrag() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, json) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Deich instabil"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["lfd_nr"], 1);
    assert_eq!(json["typ"], "meldung");
    assert_eq!(json["inhalt"], "Deich instabil");
    assert_eq!(json["erfasser_name"], "Administrator"); // bootstrap_admin setzt anzeigename
    assert!(!json["received_at"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn beobachter_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Erika als Beobachterin zuweisen.
    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{erika_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        zuweisung.status(),
        StatusCode::OK,
        "Beobachter-Rolle muss gesetzt werden, sonst testet der Test den Nicht-Mitglied-Pfad"
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &erika, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nicht_mitglied_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;

    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &fremd, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn system_typ_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"system","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn leerer_inhalt_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"   "}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigung_verknuepft_und_validiert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (_, original) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Falsch"}"#).await;
    let original_id = original["id"].as_i64().unwrap();

    // Gültige Berichtigung.
    let body = format!(
        r#"{{"typ":"berichtigung","inhalt":"Korrektur","berichtigt_eintrag_id":{original_id}}}"#
    );
    let (status, json) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["berichtigt_eintrag_id"], original_id);

    // Berichtigung ohne Verweis → 400.
    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"berichtigung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigt_eintrag_id_ohne_berichtigungstyp_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, e1) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"A"}"#).await;
    let id = e1["id"].as_i64().unwrap();

    let body = format!(r#"{{"typ":"meldung","inhalt":"B","berichtigt_eintrag_id":{id}}}"#);
    let (status, _) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn erfassen_in_abgeschlossenem_einsatz_ist_409() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn erfassen_ohne_session_ist_401() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"typ":"meldung","inhalt":"X"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn erfasster_eintrag_wird_live_publiziert() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let mut rx = live.abonniere(einsatz);
    let (status, _) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Live-Test"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let json = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("Broadcast muss innerhalb 1s ankommen")
        .expect("Broadcast-Kanal liefert Nachricht");
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(value["inhalt"], "Live-Test");
}
```

- [ ] **Step 5: Tests ausführen → erwartet PASS**

Run: `cargo test --test etb` und `cargo test` (gesamte Suite muss weiterhin grün sein — AppState-Änderung betrifft alle Test-Setups)
Expected: PASS

- [ ] **Step 6: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/app.rs src/main.rs src/routes/mod.rs src/routes/etb.rs tests/
git commit -m "feat(etb): Erfassungs-Endpoint mit Live-Publish und Berechtigungen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: ETB-Liste & Suche — Route `GET /api/einsaetze/{id}/etb`

**Files:**
- Modify: `src/routes/etb.rs` (`liste`-Handler + Query-Params)
- Modify: `src/app.rs` (Route registrieren)
- Modify: `tests/etb.rs` (Integrationstests)
- Test: Integrationstests in `tests/etb.rs`

- [ ] **Step 1: Query-Param-Struct + `liste`-Handler schreiben**

In `src/routes/etb.rs` den Import um `Query` ergänzen:

```rust
use axum::extract::{Path, Query, State};
```

Am Ende von `src/routes/etb.rs` ergänzen:

```rust
#[derive(Debug, Deserialize)]
pub struct EtbAbfrageParams {
    /// Volltext-Suchbegriff.
    pub q: Option<String>,
    /// Eintragstyp-Filter.
    pub typ: Option<String>,
    /// Untere Grenze ereigniszeit (ISO-8601/SQLite-Format).
    pub von: Option<String>,
    /// Obere Grenze ereigniszeit.
    pub bis: Option<String>,
    /// Filter nach Erfasser.
    pub erfasser_id: Option<i64>,
    /// Cursor: nur Einträge mit lfd_nr < diesem Wert.
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (Default STANDARD_LIMIT, max MAX_LIMIT).
    pub limit: Option<i64>,
}

/// GET /api/einsaetze/{id}/etb — ETB-Einträge eines Einsatzes (gefiltert,
/// volltextdurchsucht, paginiert). Nur für Mitglieder (auch Beobachter).
/// Sortierung: lfd_nr DESC (neueste zuerst); Cursor über before_lfd_nr.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<EtbAbfrageParams>,
) -> Result<Json<Vec<EtbEintragAnzeige>>, AppError> {
    einsatz_repo::laden(&state.pool, einsatz_id).await?; // 404, wenn unbekannt
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    crate::einsatz::berechtigung::fordere_mitglied(rolle)?;

    // Typ validieren, falls gesetzt.
    if let Some(t) = &params.typ {
        if EtbTyp::parse(t).is_none() {
            return Err(AppError::Validation("Ungültiger Eintragstyp im Filter".into()));
        }
    }

    // Zeitgrenzen normalisieren.
    let von_zeit = match &params.von {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };
    let bis_zeit = match &params.bis {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };

    // q nur als Filter nutzen, wenn nach Trim nicht leer.
    let q = params
        .q
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let limit = params
        .limit
        .unwrap_or(repo::STANDARD_LIMIT)
        .clamp(1, repo::MAX_LIMIT);

    let filter = repo::EtbFilter {
        q,
        typ: params.typ,
        von_zeit,
        bis_zeit,
        erfasser_id: params.erfasser_id,
        before_lfd_nr: params.before_lfd_nr,
        limit,
    };

    Ok(Json(repo::abfrage(&state.pool, einsatz_id, &filter).await?))
}
```

- [ ] **Step 2: Route registrieren**

In `src/app.rs`, nach der `etb`-POST-Route ergänzen:

```rust
        .route("/api/einsaetze/{id}/etb", get(routes::etb::liste))
```

> Hinweis: Zwei `.route`-Aufrufe mit gleichem Pfad und unterschiedlicher Methode (`post`/`get`) sind in Axum 0.8 erlaubt und werden zu einem MethodRouter zusammengeführt — wie bei `mitglieder/{benutzer_id}` (PUT/DELETE) bereits praktiziert.

- [ ] **Step 3: Integrationstests schreiben**

In `tests/etb.rs` einen GET-Helper und Tests ergänzen:

```rust
/// Ruft die ETB-Liste mit optionalem Query-String ab; liefert (Status, JSON).
async fn etb_abrufen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    query: &str,
) -> (StatusCode, Value) {
    let uri = if query.is_empty() {
        format!("/api/einsaetze/{einsatz_id}/etb")
    } else {
        format!("/api/einsaetze/{einsatz_id}/etb?{query}")
    };
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn liste_zeigt_eintraege_neueste_zuerst() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"erster"}"#).await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"zweiter"}"#).await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(liste[0]["lfd_nr"], 2);
    assert_eq!(liste[1]["lfd_nr"], 1);
}

#[tokio::test]
async fn liste_nur_fuer_mitglieder() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = etb_abrufen(&app, &fremd, einsatz, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_darf_lesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Test"}"#).await;
    let beob_id = benutzer_anlegen(&app, &admin, "beob", "keine").await;

    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{beob_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(zuweisung.status(), StatusCode::OK);

    let beob = login_cookie(&app, "beob", "beobpw1").await;
    let (status, json) = etb_abrufen(&app, &beob, einsatz, "").await;
    assert_eq!(status, StatusCode::OK, "Beobachter muss das ETB lesen dürfen");
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn liste_volltextsuche_filtert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Deich bricht"}"#).await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Lage ruhig"}"#).await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "q=Deich").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert!(liste[0]["inhalt"].as_str().unwrap().contains("Deich"));
}

#[tokio::test]
async fn liste_typ_filter() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"m"}"#).await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"anordnung","inhalt":"a"}"#).await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "typ=anordnung").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["typ"], "anordnung");
}

#[tokio::test]
async fn liste_cursor_pagination() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    for i in 1..=3 {
        let body = format!(r#"{{"typ":"meldung","inhalt":"e{i}"}}"#);
        eintrag_erfassen(&app, &admin, einsatz, &body).await;
    }

    let (_, seite1) = etb_abrufen(&app, &admin, einsatz, "limit=1").await;
    assert_eq!(seite1[0]["lfd_nr"], 3);

    let (_, seite2) = etb_abrufen(&app, &admin, einsatz, "limit=1&before_lfd_nr=3").await;
    assert_eq!(seite2[0]["lfd_nr"], 2);
}

#[tokio::test]
async fn liste_ungueltiger_typ_filter_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) = etb_abrufen(&app, &admin, einsatz, "typ=unsinn").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 4: Tests ausführen → erwartet PASS**

Run: `cargo test --test etb`
Expected: PASS

- [ ] **Step 5: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add src/routes/etb.rs src/app.rs tests/etb.rs
git commit -m "feat(etb): Liste/Suche-Endpoint mit Filtern und Cursor-Pagination

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ETB-Live-Stream — Route `GET /api/einsaetze/{id}/etb/stream` (SSE)

**Files:**
- Modify: `Cargo.toml` (Dependency `tokio-stream`)
- Modify: `src/routes/etb.rs` (`stream`-Handler)
- Modify: `src/app.rs` (Route registrieren)
- Modify: `tests/etb.rs` (Integrationstests)
- Test: Integrationstests in `tests/etb.rs`

- [ ] **Step 1: `tokio-stream`-Dependency ergänzen**

In `Cargo.toml` unter `[dependencies]` ergänzen:

```toml
tokio-stream = { version = "0.1", features = ["sync"] }
```

- [ ] **Step 2: SSE-Handler schreiben**

In `src/routes/etb.rs` die nötigen Imports am Dateikopf ergänzen:

```rust
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};
```

Am Ende von `src/routes/etb.rs` ergänzen:

```rust
/// GET /api/einsaetze/{id}/etb/stream — Server-Sent-Events-Stream der neuen
/// ETB-Einträge eines Einsatzes. Nur für Mitglieder (auch Beobachter dürfen
/// lesen). Es werden nur **neue** Einträge gepusht — der Initial-Bestand wird
/// per `GET …/etb` geladen. Bei Pufferüberlauf sendet der Server ein
/// `lagged`-Event; der Client soll dann per GET resynchronisieren.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    einsatz_repo::laden(&state.pool, einsatz_id).await?; // 404, wenn unbekannt
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    crate::einsatz::berechtigung::fordere_mitglied(rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(json) => Event::default().event("etb").data(json),
            // Empfänger ist hinterhergehinkt: Client zum Resync auffordern.
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok(event)
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
```

- [ ] **Step 3: Route registrieren**

In `src/app.rs`, nach den beiden `etb`-Routen ergänzen:

```rust
        .route("/api/einsaetze/{id}/etb/stream", get(routes::etb::stream))
```

- [ ] **Step 4: Integrationstests schreiben**

In `tests/etb.rs` ergänzen (Stream-Endpoint: Header prüfen, Body nicht lesen — er bleibt offen):

```rust
#[tokio::test]
async fn stream_fuer_mitglied_liefert_event_stream() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        content_type.starts_with("text/event-stream"),
        "SSE muss text/event-stream sein, war: {content_type}"
    );
    // Body bleibt offen (Live-Stream) — wir lesen ihn nicht und beenden den Test.
}

#[tokio::test]
async fn stream_fuer_nicht_mitglied_ist_403() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, fremd)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn stream_unbekannter_einsatz_ist_404() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze/999/etb/stream")
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn stream_ohne_session_ist_401() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 5: Tests ausführen → erwartet PASS**

Run: `cargo test --test etb`
Expected: PASS

- [ ] **Step 6: Clippy + Commit**

```bash
cargo clippy --all-targets -- -D warnings
git add Cargo.toml Cargo.lock src/routes/etb.rs src/app.rs tests/etb.rs
git commit -m "feat(etb): SSE-Live-Stream pro Einsatz für neue Einträge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Gesamt-Verifikation + Roadmap aktualisieren

**Files:**
- Modify: `docs/superpowers/PROGRESS.md` (Plan-4-Status)

- [ ] **Step 1: Volle Test-Suite + Clippy**

Run:
```bash
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```
Expected: alle Tests grün, keine Clippy-Warnungen, Formatierung sauber. Falls `cargo fmt --check` Abweichungen meldet: `cargo fmt` ausführen und die Formatierung mitcommitten.

- [ ] **Step 2: Manueller Smoke-Test (optional, empfohlen)**

Server starten, anmelden, Einsatz anlegen, Eintrag erfassen, Liste abrufen, Suche testen:
```bash
cargo run -- --db-path /tmp/lifeline-smoke.db --admin-password startpw12 &
# In zweitem Terminal mit curl gegen die API testen (Cookie aus /api/auth/login übernehmen).
# Danach Server stoppen und /tmp/lifeline-smoke.db entfernen.
```

- [ ] **Step 3: PROGRESS.md aktualisieren**

In `docs/superpowers/PROGRESS.md` die Plan-4-Zeile in der Tabelle auf `✅ **DONE**` setzen (mit Commit-Hash nach dem finalen Commit), den Dateieintrag unter „Dateien" ergänzen (`Plan 4 (DONE): docs/superpowers/plans/2026-05-23-etb-kern-live-suche.md`), und im Abschnitt „So startest du einen neuen Chat" den nächsten Schritt auf **Plan 5 (Frontend)** umstellen.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: ETB-Kern (Plan 4) abgeschlossen, Roadmap aktualisiert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Selbst-Review (gegen Spec geprüft)

- **§6 Datenmodell (ETB-Eintrag, alle Felder):** Task 1 (Tabelle), Task 2 (Anzeige-Struct). ✓
- **§6 Integrität (append-only, kein UPDATE/DELETE, lückenlose lfd_nr):** Task 1 (UNIQUE), Task 4 (atomare Vergabe), kein Update/Delete im Repo. ✓
- **§6/§10 Berichtigung (Verknüpfung, Original bleibt):** Task 4 (Verknüpfung), Task 8 (Validierung gegen denselben Einsatz). ✓
- **§7 Rollen/Schreibrecht (Beobachter nur lesend):** Task 3 (`fordere_schreibrecht`), Task 8 (POST blockt Beobachter), Task 9/10 (`fordere_mitglied` erlaubt Beobachter-Lesen). ✓
- **§9 Lebenszyklus (abgeschlossen = read-only):** Task 8 (`fordere_aktiv` → 409). ✓
- **§10 Eintragstypen + System nicht client-erfassbar:** Task 2 (`darf_client_erfassen`), Task 8 (400 bei `system`). ✓
- **§11 Live (SSE, received_at server, broadcast):** Task 7 (Hub), Task 8 (publish), Task 10 (Stream). ✓
- **§11 Zeitmodell (drei Stempel, ereigniszeit-Sortierung, Konfliktregel über lfd_nr):** Task 2 (Normalisierung), Task 4 (received_at/Default), Task 5 (Sortierung lfd_nr + beide Zeiten geliefert). ✓
- **§12 Suche & Filter (FTS5 Volltext, typ/Zeitraum/Person, pro Einsatz):** Task 1 (FTS5), Task 5 (Filter), Task 6 (Volltext), Task 9 (Route). ✓
- **§16 Teststrategie (lfd_nr, Append-only, Berichtigung, Rollen, Lebenszyklus, Zeitmodell, SSE):** in den jeweiligen Tasks abgedeckt. ✓

**Typkonsistenz:** `EtbEintragAnzeige`-Felder = SELECT-Aliase in `laden`/`abfrage` (`erfasser_name`); `EintragDaten`-Felder = Binds in `anlegen`; `EtbFilter`-Felder = Setzen im `liste`-Handler; `LiveHub::{abonniere, publiziere}` einheitlich verwendet. ✓

**Bewusst nicht in Plan 4** (dokumentiert, kein Code): PDF/Druck-Export, OIDC/MFA, Schnellbausteine, Server-Discovery, Wiedereröffnung abgeschlossener Einsätze, clientseitige Offline-Queue (Frontend, Plan 5).
