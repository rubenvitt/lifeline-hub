# Aufträge/Befehle (mit Quittierung) — Implementation Plan (LFH-52)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein einsatzbezogenes Modul „Aufträge/Befehle" mit Befehlsschema-Erfassung, getrennter Quittierung (pro Empfänger) und Vollzugskontrolle (pro Auftrag), ETB-Kopplung und Frist-/Board-Überwachung.

**Architecture:** Neue vertikale Schicht `src/auftrag/` (Migration → mod → repo → route) exakt nach dem Vorbild `src/erinnerung/`. Quittung ≠ Vollzug ist die Kernanforderung: **Vollzug** (offen→in_arbeit→vollzogen) läuft über den geteilten Kommunikations-Unterbau `kommunikation_status` (LFH-84, `objekt_typ='auftrag'`); **Quittung** liegt **pro Empfänger** auf den Zeilen der neuen 1:n-Tabelle `auftrag_empfaenger` (Führungskontrolle: „wer hat noch nicht quittiert?"). „Abnahme" durch die Führung ist eine 4. Stufe als eigenes Feld am Auftrag. ETB-Kopplung nach Pattern B (`chat::heraufstufen_zu_etb` / `lagebericht::freigeben`): Auftrag→Anordnung, Vollzugsmeldung→Meldung, gemeinsamer Backlink `etb_eintrag.auftrag_id`. Live über den geteilten Einsatz-Kanal (Event-Tag `auftrag`), kein eigener Stream.

**Tech Stack:** Rust (axum, sqlx runtime-Queries, SQLite), React + TypeScript + antd + @tanstack/react-query, Vitest/MSW. Backend liegt im Repo-Root unter `src/`, Migrationen unter `migrations/`, Integrationstests unter `tests/`.

---

## Architektur-Entscheidungen (verbindlich)

1. **Quittung pro Empfänger**, Vollzug pro Auftrag. `auftrag_empfaenger.quittiert_at/_von_id` (Achse 1); `kommunikation_status` mit `objekt_typ='auftrag'` für die Vollzugs-Achse (Achse 2). Begründung: „Empfänger ggf. mehrere" ist explizit; Führungskontrolle braucht „wer hat noch nicht quittiert?".
2. **„abgenommen"** = eigene Felder `auftrag.abgenommen_at/_von_id` (4. Bearbeitungsstufe nach `vollzogen`), **nicht** den geteilten Vollzug-Enum erweitern (das würde Erinnerung mit-betreffen). Effektiver Bearbeitungsstatus wird in SQL abgeleitet.
3. **ETB-Kopplung Pattern B**, transaktional, `ALTER TABLE etb_eintrag ADD COLUMN auftrag_id` (Vorlage `0038_lagebericht.sql`). Anordnung (`typ='anordnung'`) erst **nach** Validierung (Empfänger + Auftragstext) innerhalb der Create-Transaktion. Vollzugsmeldung (`typ='meldung'`) trägt dieselbe `auftrag_id`. `berichtigt_eintrag_id` wird **nicht** verwendet (correction-only).
4. **Frist/Nachfass:** Board-Hervorhebung Überfälliger via berechnetem `ist_ueberfaellig` (frist überschritten **und** noch nicht alle quittiert) ist Kern. Die Auto-Erinnerung über `erinnerung::repo::anlegen_aus_frist(bezug_typ="auftrag")` ist laut Task **optional** → Phase D, inkl. nötigem Schließ-Gegenpart `schliesse_by_bezug`.
5. **Ereigniszeit ≠ Erfassungszeit:** Feld `erteilt_at` (editierbar, default jetzt) für nachträglich/per Funk erfasste Befehle; geht als `ereigniszeit` ins ETB.
6. **Rollen:** anordnen/quittieren/vollzug/abnehmen = `fordere_schreibrecht` (Einsatzleitung/Fuehrungspersonal) + `fordere_aktiv`; lesen = `fordere_lesezugriff` (Beobachter eingeschlossen). Es gibt nur drei Einsatz-Rollen; keine Adressaten-Bindung erzwingbar.

## Scope-Grenzen (in der Spec dokumentiert)

- **„Als Einheitsführer eigene offene Aufträge sehen" (LFH-92):** Es gibt kein per-User→EA/Einheit-Mapping im System. „Eigene" wird über den **Empfänger-Filter** des Boards abgebildet (Nutzer wählt seinen EA/seine Einheit); kein automatisches „meine".
- **Zustellung pro Benutzer** (`kommunikation_zustellung`) wird **nicht** genutzt — Empfänger sind EA/Einheit/Funktion, keine Benutzerkonten. „Live-Zustellung" = SSE-Event + Board-Aktualisierung.
- **Keine State-Machine** „erst quittiert, dann vollzogen": beide Achsen bleiben unabhängig (Anzeige stellt die Reihenfolge dar), wie im Unterbau.

## Akzeptanzkriterien-Mapping

| Kriterium | Task |
|---|---|
| Auftrag nur absendbar mit Empfänger + Auftragstext (LFH-89) | A6 |
| Empfänger sieht Auftrag unmittelbar (live) | A6 (SSE) + A10 (Live-Hook) |
| Auftrag erscheint automatisch als ETB-Anordnung | A5/A6 |
| Quittierung ≠ Vollzug, getrennt sichtbar (LFH-90/91) | A4/B/C |
| Quittieren ändert nur Quittung, nicht Bearbeitungsstatus (LFH-90) | B1/B2 |
| Unquittierte erkennbar (LFH-90) | A5 (Aggregat) + D3 |
| Vollzug getrennt dokumentiert, Vollzugsmeldung → ETB-Folgeeintrag (LFH-91) | C1/C2 |
| Beobachter sehen Übersicht (nur lesend) (LFH-91) | A6 (Lesezugriff) |
| Überfällige ohne Quittung unübersehbar markiert (LFH-92) | A5 + D3 |
| Filter nach Status und Empfänger (LFH-92) | D1/D3 |
| Optional: Auto-Erinnerung bei Fristüberschreitung | D4 |

---

# Phase A — Datenmodell, Anlegen & ETB-Anordnung (LFH-89)

### Task A1: Migration `0048_auftrag.sql`

**Files:**
- Create: `migrations/0048_auftrag.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- Aufträge/Befehle (LFH-52): MVP-Kern der aktiven Führung (FwDV/DV 100).
-- Befehlsschema + getrennte Achsen: Quittung PRO EMPFÄNGER (auftrag_empfaenger),
-- Vollzug PRO AUFTRAG über den geteilten kommunikation_status (LFH-84).
-- ETB-Kopplung (Pattern B): Auftrag→Anordnung, Vollzugsmeldung→Meldung via auftrag_id.
CREATE TABLE auftrag (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Befehlsschema (FwDV 100): auftrag_text = Auftrag/Was (Pflicht), Rest optional.
    auftrag_text      TEXT    NOT NULL,
    absicht           TEXT,   -- Absicht/Ziel (Auftragstaktik)
    lage              TEXT,   -- Lage(-bezug)
    ort               TEXT,   -- Ort/Wo
    zeit              TEXT,   -- Zeit/Wann (Freitext)
    mittel            TEXT,   -- Mittel/Womit
    verbindung        TEXT,   -- Verbindung/Meldewege
    sicherheit        TEXT,   -- Sicherheit/Besonderes
    -- 'sofort' | 'dringend' | 'normal' (Code-validiert, kein DB-CHECK).
    prioritaet        TEXT    NOT NULL DEFAULT 'normal',
    -- Quittungs-/Vollzugsfrist (UTC 'YYYY-MM-DD HH:MM:SS'), optional.
    frist_at          TEXT,
    -- Ereigniszeit: wann der Befehl tatsächlich erteilt wurde (≠ Erfassungszeit).
    erteilt_at        TEXT    NOT NULL,
    -- Zeitstempel der Stufen, die kommunikation_status nicht führt.
    in_arbeit_at      TEXT,
    -- Vollzugs-Rückmeldung (Text) bei Erledigung; Inhalt der ETB-Meldung.
    vollzugsmeldung   TEXT,
    -- Abnahme durch die Führung (4. Stufe nach 'vollzogen').
    abgenommen_at     TEXT,
    abgenommen_von_id INTEGER REFERENCES benutzer(id),
    -- ETB-Rückverweis auf die erzeugte Anordnung (Pattern-B-Gegenseite).
    etb_anordnung_id  INTEGER REFERENCES etb_eintrag(id),
    erstellt_von_id   INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auftrag_einsatz ON auftrag(einsatz_id, frist_at);

-- Empfänger (1:n): EA / Einheit / Funktion(Freitext) / Person / Fahrzeug.
-- Quittung liegt PRO EMPFÄNGER (Führungskontrolle: wer hat noch nicht quittiert?).
CREATE TABLE auftrag_empfaenger (
    id               INTEGER PRIMARY KEY,
    auftrag_id       INTEGER NOT NULL REFERENCES auftrag(id) ON DELETE CASCADE,
    empfaenger_typ   TEXT    NOT NULL
                     CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','person','fahrzeug')),
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id),
    einheit_id       INTEGER REFERENCES einsatz_einheit(id),
    person_id        INTEGER REFERENCES einsatz_personal(id),
    fahrzeug_id      INTEGER REFERENCES einsatz_fahrzeug(id),
    funktion_text    TEXT,
    -- Klarname zum Erfassungszeitpunkt (snap_*-Muster, historische Nachvollziehbarkeit).
    snap_anzeige     TEXT    NOT NULL,
    -- Quittung (Achse 1) pro Empfänger.
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_auftrag_empfaenger_auftrag ON auftrag_empfaenger(auftrag_id);

-- ETB-Kopplung: Anordnung + Vollzugsmeldung verweisen über auftrag_id auf den
-- Auftrag (Vorlage 0038_lagebericht.sql; berührt die FTS-Trigger nicht).
ALTER TABLE etb_eintrag ADD COLUMN auftrag_id INTEGER REFERENCES auftrag(id);
```

- [ ] **Step 2: Migration greift (Kompilier-/Migrationsprobe)**

Run: `rtk proxy cargo test --lib kommunikation::repo::tests::quittieren_setzt_quittungs_achse_ohne_vollzug`
Expected: PASS (bestätigt, dass `test_pool()` die neue Migration fehlerfrei einspielt).

- [ ] **Step 3: Commit**

```bash
git add migrations/0048_auftrag.sql
git commit -m "feat(auftrag): Migration für Aufträge/Befehle + Empfänger + ETB-Backlink (LFH-52)"
```

---

### Task A2: `OBJEKT_AUFTRAG` im Kommunikations-Unterbau

**Files:**
- Modify: `src/kommunikation/mod.rs:16`

- [ ] **Step 1: Konstante + Test ergänzen**

In `src/kommunikation/mod.rs` nach `pub const OBJEKT_ERINNERUNG: &str = "erinnerung";`:

```rust
pub const OBJEKT_AUFTRAG: &str = "auftrag";
```

Im `mod tests` die Eindeutigkeits-Assertion erweitern:

```rust
    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_CHAT_NACHRICHT);
    }
```

- [ ] **Step 2: Test läuft**

Run: `rtk proxy cargo test --lib kommunikation::tests::objekt_typen_sind_eindeutig`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/kommunikation/mod.rs
git commit -m "feat(kommunikation): OBJEKT_AUFTRAG-Konstante für Aufträge (LFH-52)"
```

---

### Task A3: `auftrag_id` in der ETB-Anzeige

**Files:**
- Modify: `src/etb/mod.rs` (Struct `EtbEintragAnzeige`)
- Modify: `src/etb/repo.rs:79-83` (`laden`-SELECT) und `:141-144` (`abfrage`-SELECT)

- [ ] **Step 1: Feld zum Struct ergänzen**

In `src/etb/mod.rs` im Struct `EtbEintragAnzeige` nach `pub lagebericht_id: Option<i64>,`:

```rust
    /// Rückverweis auf den auslösenden Auftrag (LFH-52), falls aus Auftrag/Vollzug erzeugt.
    pub auftrag_id: Option<i64>,
```

- [ ] **Step 2: Beide SELECTs erweitern**

In `src/etb/repo.rs` in `laden` und `abfrage` jeweils `e.lagebericht_id` ersetzen durch:

```
e.lagebericht_id, e.auftrag_id
```

- [ ] **Step 3: Bestehender Test absichern**

In `src/etb/repo.rs` den Test `anlegen_setzt_lagebericht_id_auf_none` ergänzen:

```rust
        assert_eq!(a.lagebericht_id, None);
        assert_eq!(a.auftrag_id, None);
```

- [ ] **Step 4: Tests laufen**

Run: `rtk proxy cargo test --lib etb::repo::tests`
Expected: PASS (alle ETB-Repo-Tests grün, neue Spalte wird geladen).

- [ ] **Step 5: Commit**

```bash
git add src/etb/mod.rs src/etb/repo.rs
git commit -m "feat(etb): auftrag_id-Backlink in EtbEintragAnzeige (LFH-52)"
```

---

### Task A4: Modul-Grundgerüst `src/auftrag/mod.rs` (DTOs + Konstanten)

**Files:**
- Create: `src/auftrag/mod.rs`
- Modify: `src/lib.rs` (`pub mod auftrag;` ergänzen — alphabetisch nahe `pub mod auth;`)

- [ ] **Step 1: `src/auftrag/mod.rs` schreiben**

```rust
//! Aufträge/Befehle (LFH-52): Top-down-Strang des Führungsvorgangs
//! (Befehlsgebung → Vollzug → Kontrolle). Quittung liegt pro Empfänger
//! (`auftrag_empfaenger`), Vollzug pro Auftrag über den geteilten
//! Kommunikations-Unterbau (`kommunikation_status`, LFH-84).
pub mod repo;

use serde::Serialize;

/// Priorität eines Auftrags (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Empfänger-Diskriminator (Spiegel des DB-CHECK auf auftrag_empfaenger).
pub const EMPF_ABSCHNITT: &str = "abschnitt";
pub const EMPF_EINHEIT: &str = "einheit";
pub const EMPF_FUNKTION: &str = "funktion";
pub const EMPF_PERSON: &str = "person";
pub const EMPF_FAHRZEUG: &str = "fahrzeug";

/// Effektiver Bearbeitungsstatus (abgeleitet, fürs Frontend).
pub const BEARB_OFFEN: &str = "offen";
pub const BEARB_IN_ARBEIT: &str = "in_arbeit";
pub const BEARB_VOLLZOGEN: &str = "vollzogen";
pub const BEARB_ABGENOMMEN: &str = "abgenommen";

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn empfaenger_typ_gueltig(t: &str) -> bool {
    matches!(t, EMPF_ABSCHNITT | EMPF_EINHEIT | EMPF_FUNKTION | EMPF_PERSON | EMPF_FAHRZEUG)
}

/// Anzeige eines Auftrags inkl. abgeleiteter Felder und der Vollzugs-Achse aus
/// dem geteilten `kommunikation_status` (per LEFT JOIN). Quittungs-Aggregate
/// (`empfaenger_anzahl`, `quittiert_anzahl`) stammen aus `auftrag_empfaenger`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuftragAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    pub prioritaet: String,
    pub frist_at: Option<String>,
    pub erteilt_at: String,
    pub in_arbeit_at: Option<String>,
    pub vollzugsmeldung: Option<String>,
    pub abgenommen_at: Option<String>,
    pub abgenommen_von_id: Option<i64>,
    pub etb_anordnung_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    // Vollzugs-Achse aus kommunikation_status (Default 'offen').
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
    // Quittungs-Aggregat aus auftrag_empfaenger.
    pub empfaenger_anzahl: i64,
    pub quittiert_anzahl: i64,
    // Abgeleitet: Frist überschritten UND noch nicht alle Empfänger quittiert.
    pub ist_ueberfaellig: bool,
    // Abgeleitet: 'abgenommen' wenn abgenommen_at gesetzt, sonst vollzug_status.
    pub bearbeitungsstatus: String,
}

/// Anzeige einer Empfänger-Zeile inkl. Quittung (Achse 1, pro Empfänger).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuftragEmpfaengerAnzeige {
    pub id: i64,
    pub auftrag_id: i64,
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
    pub snap_anzeige: String,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
}

/// Auftrag + seine Empfänger (Detail-/Anlege-/Mutations-Antwort).
#[derive(Debug, Clone, Serialize)]
pub struct AuftragDetail {
    #[serde(flatten)]
    pub auftrag: AuftragAnzeige,
    pub empfaenger: Vec<AuftragEmpfaengerAnzeige>,
}
```

- [ ] **Step 2: Modul registrieren**

In `src/lib.rs` `pub mod auftrag;` ergänzen (z. B. direkt nach `pub mod auth;`).

- [ ] **Step 3: Kompiliert**

Run: `rtk proxy cargo build`
Expected: Finished (es kompiliert; `repo` ist als Modul deklariert, wird in A5 gefüllt — bis dahin schlägt `cargo build` fehl, daher A5 unmittelbar anschließen oder hier nur das Struct-Modul anlegen und `pub mod repo;` erst in A5 setzen).

> **Hinweis:** `pub mod repo;` erst in Task A5 aktivieren, damit A4 für sich kompiliert. Bis dahin in A4 die Zeile `pub mod repo;` weglassen und in A5 ergänzen.

- [ ] **Step 4: Commit**

```bash
git add src/auftrag/mod.rs src/lib.rs
git commit -m "feat(auftrag): Modul-Grundgerüst mit Anzeige-DTOs und Konstanten (LFH-52)"
```

---

### Task A5: Repo `src/auftrag/repo.rs` — Anlegen (mit Empfänger + ETB-Anordnung), Laden, Liste

**Files:**
- Create: `src/auftrag/repo.rs`
- Modify: `src/auftrag/mod.rs` (`pub mod repo;` aktivieren)

- [ ] **Step 1: Failing test — `anlegen` legt Auftrag + Empfänger + ETB-Anordnung an**

`src/auftrag/repo.rs` mit Testmodul beginnen (Inline-Repo-Tests nach Vorbild `erinnerung/repo.rs`):

```rust
use crate::error::AppError;
use crate::kommunikation::OBJEKT_AUFTRAG;
use sqlx::SqlitePool;

use super::{AuftragAnzeige, AuftragDetail, AuftragEmpfaengerAnzeige, prioritaet_gueltig, empfaenger_typ_gueltig, PRIO_NORMAL};

/// Validierte Eingabe für eine Empfänger-Zeile (genau ein Ziel-Slot belegt).
#[derive(Debug, Clone)]
pub struct EmpfaengerEingabe {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
}

/// Validierte Eingabe für einen neuen Auftrag (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct AuftragDaten<'a> {
    pub auftrag_text: &'a str,
    pub absicht: Option<&'a str>,
    pub lage: Option<&'a str>,
    pub ort: Option<&'a str>,
    pub zeit: Option<&'a str>,
    pub mittel: Option<&'a str>,
    pub verbindung: Option<&'a str>,
    pub sicherheit: Option<&'a str>,
    pub prioritaet: &'a str,
    pub frist_at: Option<&'a str>,
    pub erteilt_at: &'a str,
    pub empfaenger: Vec<EmpfaengerEingabe>,
}

/// SELECT-Projektion inkl. Vollzugs-Achse (LEFT JOIN kommunikation_status),
/// Quittungs-Aggregat (Subquery auf auftrag_empfaenger) und abgeleiteten Feldern.
/// `jetzt` wird als ERSTER `?` gebunden (computed columns vor WHERE), dann WHERE.
const ANZEIGE_SELECT: &str =
    "SELECT a.id, a.einsatz_id, a.auftrag_text, a.absicht, a.lage, a.ort, a.zeit, a.mittel, \
            a.verbindung, a.sicherheit, a.prioritaet, a.frist_at, a.erteilt_at, a.in_arbeit_at, \
            a.vollzugsmeldung, a.abgenommen_at, a.abgenommen_von_id, a.etb_anordnung_id, \
            a.erstellt_von_id, a.erstellt_at, \
            COALESCE(ks.vollzug_status, 'offen') AS vollzug_status, \
            ks.vollzogen_at AS vollzogen_at, ks.vollzogen_von_id AS vollzogen_von_id, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id) AS empfaenger_anzahl, \
            (SELECT COUNT(*) FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NOT NULL) AS quittiert_anzahl, \
            (a.frist_at IS NOT NULL AND a.frist_at <= ? \
             AND EXISTS (SELECT 1 FROM auftrag_empfaenger ae WHERE ae.auftrag_id = a.id AND ae.quittiert_at IS NULL)) AS ist_ueberfaellig, \
            CASE WHEN a.abgenommen_at IS NOT NULL THEN 'abgenommen' \
                 ELSE COALESCE(ks.vollzug_status, 'offen') END AS bearbeitungsstatus \
     FROM auftrag a \
     LEFT JOIN kommunikation_status ks ON ks.objekt_typ = 'auftrag' AND ks.objekt_id = a.id";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::{repo as krepo, VOLLZUG_VOLLZOGEN};

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

    fn daten<'a>(text: &'a str, frist: Option<&'a str>, empf: Vec<EmpfaengerEingabe>) -> AuftragDaten<'a> {
        AuftragDaten {
            auftrag_text: text, absicht: None, lage: None, ort: None, zeit: None, mittel: None,
            verbindung: None, sicherheit: None, prioritaet: PRIO_NORMAL,
            frist_at: frist, erteilt_at: "2026-06-11 09:00:00", empfaenger: empf,
        }
    }

    fn funktion(t: &str) -> EmpfaengerEingabe {
        EmpfaengerEingabe { empfaenger_typ: "funktion".into(), abschnitt_id: None, einheit_id: None, person_id: None, fahrzeug_id: None, funktion_text: Some(t.into()) }
    }

    #[tokio::test]
    async fn anlegen_speichert_auftrag_mit_empfaenger_und_default_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Deich sichern", None, vec![funktion("Abschnitt Nord")]), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(d.auftrag.auftrag_text, "Deich sichern");
        assert_eq!(d.auftrag.vollzug_status, "offen");
        assert_eq!(d.auftrag.bearbeitungsstatus, "offen");
        assert_eq!(d.auftrag.empfaenger_anzahl, 1);
        assert_eq!(d.auftrag.quittiert_anzahl, 0);
        assert_eq!(d.empfaenger.len(), 1);
        assert_eq!(d.empfaenger[0].snap_anzeige, "Abschnitt Nord");
        assert!(d.auftrag.etb_anordnung_id.is_some(), "ETB-Anordnung wird erzeugt");
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_anordnung_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Lage erkunden", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let etb_id = d.auftrag.etb_anordnung_id.unwrap();
        let typ: String = sqlx::query_scalar("SELECT typ FROM etb_eintrag WHERE id = ?").bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "anordnung");
        let backlink: i64 = sqlx::query_scalar("SELECT auftrag_id FROM etb_eintrag WHERE id = ?").bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn liste_liefert_auftraege_mit_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("A", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        anlegen(&pool, e, b, daten("B", None, vec![funktion("EA2")]), "2026-06-11 09:00:00").await.unwrap();
        let liste = liste(&pool, e, None, None, "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(liste.len(), 2);
        assert!(liste.iter().all(|d| d.empfaenger.len() == 1));
    }

    #[tokio::test]
    async fn ueberfaellig_wenn_frist_ueberschritten_und_unquittiert() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("Frist", Some("2026-06-11 10:00:00"), vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let vor = laden(&pool, d.auftrag.id, "2026-06-11 09:30:00").await.unwrap();
        assert!(!vor.auftrag.ist_ueberfaellig, "vor Frist nicht überfällig");
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:30:00").await.unwrap();
        assert!(nach.auftrag.ist_ueberfaellig, "nach Frist + unquittiert: überfällig");
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, d.auftrag.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, d.auftrag.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn bearbeitungsstatus_spiegelt_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        krepo::setze_vollzug(&pool, 1, e, OBJEKT_AUFTRAG, d.auftrag.id, VOLLZUG_VOLLZOGEN, b, "2026-06-11 11:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:30:00").await.unwrap();
        assert_eq!(nach.auftrag.vollzug_status, "vollzogen");
        assert_eq!(nach.auftrag.bearbeitungsstatus, "vollzogen");
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `rtk proxy cargo test --lib auftrag::repo`
Expected: FAIL (Funktionen `anlegen`/`laden`/`liste`/`gehoert_zu_einsatz` existieren noch nicht).

- [ ] **Step 3: Repo-Funktionen implementieren**

Vor das `#[cfg(test)]`-Modul einfügen:

```rust
/// Lädt einen Auftrag samt Empfängern. `NotFound`, wenn unbekannt.
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<AuftragDetail, AppError> {
    let auftrag = sqlx::query_as::<_, AuftragAnzeige>(&format!("{ANZEIGE_SELECT} WHERE a.id = ?"))
        .bind(jetzt)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let empfaenger = empfaenger_von(pool, id).await?;
    Ok(AuftragDetail { auftrag, empfaenger })
}

/// Lädt die Empfänger-Zeilen eines Auftrags (Quittung pro Empfänger).
pub async fn empfaenger_von(pool: &SqlitePool, auftrag_id: i64) -> Result<Vec<AuftragEmpfaengerAnzeige>, AppError> {
    sqlx::query_as::<_, AuftragEmpfaengerAnzeige>(
        "SELECT id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, \
                funktion_text, snap_anzeige, quittiert_at, quittiert_von_id \
         FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Listet Aufträge eines Einsatzes (optional gefiltert nach Bearbeitungsstatus
/// und/oder Empfänger). Sortierung: Priorität (sofort→normal), dann Frist, dann ID.
/// Filter werden auf der geladenen Liste angewandt (kleine N je Einsatz).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
    empfaenger_filter: Option<&EmpfaengerFilter>,
    jetzt: &str,
) -> Result<Vec<AuftragDetail>, AppError> {
    let auftraege = sqlx::query_as::<_, AuftragAnzeige>(&format!(
        "{ANZEIGE_SELECT} WHERE a.einsatz_id = ? \
         ORDER BY CASE a.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
                  a.frist_at IS NULL, a.frist_at, a.id"
    ))
    .bind(jetzt)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(auftraege.len());
    for auftrag in auftraege {
        if let Some(s) = status_filter {
            if auftrag.bearbeitungsstatus != s {
                continue;
            }
        }
        let empfaenger = empfaenger_von(pool, auftrag.id).await?;
        if let Some(f) = empfaenger_filter {
            let passt = empfaenger.iter().any(|e| f.passt(e));
            if !passt {
                continue;
            }
        }
        out.push(AuftragDetail { auftrag, empfaenger });
    }
    Ok(out)
}

/// Empfänger-Filter fürs Board (genau ein Ziel-Slot gesetzt).
#[derive(Debug, Default)]
pub struct EmpfaengerFilter {
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

impl EmpfaengerFilter {
    fn passt(&self, e: &AuftragEmpfaengerAnzeige) -> bool {
        if let Some(a) = self.abschnitt_id {
            return e.abschnitt_id == Some(a);
        }
        if let Some(u) = self.einheit_id {
            return e.einheit_id == Some(u);
        }
        true
    }
}

/// Prüft, ob ein Auftrag zum Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_zu_einsatz(pool: &SqlitePool, id: i64, einsatz_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Legt einen Auftrag inkl. Empfänger an und erzeugt im selben Commit den
/// ETB-Anordnungseintrag (Pattern B: anlegen_tx + Backlink auftrag_id auf BEIDEN
/// Seiten). `daten` ist vom Handler validiert (auftrag_text + >=1 Empfänger,
/// Slots/Zugehörigkeit geprüft, snap_anzeige je Empfänger gesetzt).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: AuftragDaten<'_>,
    jetzt: &str,
) -> Result<AuftragDetail, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    let mut tx = pool.begin().await?;

    let auftrag_id: i64 = sqlx::query_scalar(
        "INSERT INTO auftrag \
           (einsatz_id, auftrag_text, absicht, lage, ort, zeit, mittel, verbindung, sicherheit, \
            prioritaet, frist_at, erteilt_at, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.auftrag_text)
    .bind(daten.absicht)
    .bind(daten.lage)
    .bind(daten.ort)
    .bind(daten.zeit)
    .bind(daten.mittel)
    .bind(daten.verbindung)
    .bind(daten.sicherheit)
    .bind(daten.prioritaet)
    .bind(daten.frist_at)
    .bind(daten.erteilt_at)
    .bind(ersteller_id)
    .fetch_one(&mut *tx)
    .await?;

    for e in &daten.empfaenger {
        debug_assert!(empfaenger_typ_gueltig(&e.empfaenger_typ));
        let snap = snap_anzeige_fuer(&mut tx, e).await?;
        sqlx::query(
            "INSERT INTO auftrag_empfaenger \
               (auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id, funktion_text, snap_anzeige) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(auftrag_id)
        .bind(&e.empfaenger_typ)
        .bind(e.abschnitt_id)
        .bind(e.einheit_id)
        .bind(e.person_id)
        .bind(e.fahrzeug_id)
        .bind(e.funktion_text.as_deref())
        .bind(&snap)
        .execute(&mut *tx)
        .await?;
    }

    // ETB-Anordnung (Pattern B): erst NACH den Validierungen, im selben Commit.
    let an = empfaenger_klartext(&daten.empfaenger, &mut tx).await?;
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        ersteller_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_ANORDNUNG,
            inhalt: daten.auftrag_text,
            von: None,
            an: Some(&an),
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(daten.erteilt_at),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id).bind(etb_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE auftrag SET etb_anordnung_id = ? WHERE id = ?")
        .bind(etb_id).bind(auftrag_id).execute(&mut *tx).await?;

    tx.commit().await?;
    laden(pool, auftrag_id, jetzt).await
}

/// Ermittelt den Anzeigenamen einer Empfänger-Zeile (snap zum Erfassungszeitpunkt).
/// EA/Einheit/Person/Fahrzeug → Name aus der jeweiligen Tabelle; Funktion → Freitext.
async fn snap_anzeige_fuer(
    tx: &mut sqlx::SqliteConnection,
    e: &EmpfaengerEingabe,
) -> Result<String, AppError> {
    let name: Option<String> = match e.empfaenger_typ.as_str() {
        "abschnitt" => sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ?")
            .bind(e.abschnitt_id).fetch_optional(&mut *tx).await?,
        "einheit" => sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
            .bind(e.einheit_id).fetch_optional(&mut *tx).await?,
        "person" => sqlx::query_scalar("SELECT snap_name FROM einsatz_personal WHERE id = ?")
            .bind(e.person_id).fetch_optional(&mut *tx).await?,
        "fahrzeug" => sqlx::query_scalar("SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ?")
            .bind(e.fahrzeug_id).fetch_optional(&mut *tx).await?,
        _ => e.funktion_text.clone(),
    };
    Ok(name.or_else(|| e.funktion_text.clone()).unwrap_or_else(|| "—".to_string()))
}

/// Empfänger als ETB-`an`-Klartext, kommagetrennt.
async fn empfaenger_klartext(
    empf: &[EmpfaengerEingabe],
    tx: &mut sqlx::SqliteConnection,
) -> Result<String, AppError> {
    let mut teile = Vec::with_capacity(empf.len());
    for e in empf {
        teile.push(snap_anzeige_fuer(tx, e).await?);
    }
    Ok(teile.join(", "))
}
```

In `src/auftrag/mod.rs` jetzt `pub mod repo;` aktivieren (falls in A4 weggelassen).

- [ ] **Step 4: Run to verify it passes**

Run: `rtk proxy cargo test --lib auftrag::repo`
Expected: PASS (alle Repo-Tests grün).

- [ ] **Step 5: Commit**

```bash
git add src/auftrag/mod.rs src/auftrag/repo.rs
git commit -m "feat(auftrag): Repo – Anlegen mit Empfängern + ETB-Anordnung, Laden, Liste (LFH-89)"
```

---

### Task A6: Route `src/routes/auftrag.rs` — Liste + Anlegen + Wiring

**Files:**
- Create: `src/routes/auftrag.rs`
- Modify: `src/routes/mod.rs` (`pub mod auftrag;`)
- Modify: `src/app.rs` (Routen registrieren, nach den Erinnerungs-Routen Z. 73)

- [ ] **Step 1: Handler schreiben**

```rust
use crate::app::AppState;
use crate::auftrag::{repo, AuftragDetail, EMPF_ABSCHNITT, EMPF_EINHEIT, EMPF_FAHRZEUG, EMPF_FUNKTION, EMPF_PERSON, PRIO_NORMAL};
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
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

/// SSE-Notify: Aufträge des Einsatzes haben sich geändert (Tag `auftrag`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
fn parse_zeit(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Zeitpunkt".into()))
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/auftraege — Aufträge listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AuftragDetail>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let filter = (params.abschnitt_id.is_some() || params.einheit_id.is_some()).then(|| {
        repo::EmpfaengerFilter { abschnitt_id: params.abschnitt_id, einheit_id: params.einheit_id }
    });
    let liste = repo::liste(
        &state.pool, einsatz_id, params.status.as_deref(), filter.as_ref(), &jetzt(),
    ).await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct EmpfaengerEingabeReq {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NeuerAuftrag {
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    pub prioritaet: Option<String>,
    pub frist_at: Option<String>,
    /// Optional: Erteilzeitpunkt (mündlich/per Funk nachträglich). Default = jetzt.
    pub erteilt_at: Option<String>,
    pub empfaenger: Vec<EmpfaengerEingabeReq>,
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Prüft Slot-Konsistenz + Einsatz-Zugehörigkeit jeder Empfänger-Zeile.
async fn validiere_empfaenger(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    req: &EmpfaengerEingabeReq,
) -> Result<repo::EmpfaengerEingabe, AppError> {
    let belegt = [
        req.abschnitt_id.is_some(), req.einheit_id.is_some(),
        req.person_id.is_some(), req.fahrzeug_id.is_some(),
        trimme(&req.funktion_text).is_some(),
    ].iter().filter(|b| **b).count();
    if belegt != 1 {
        return Err(AppError::Validation("Empfänger braucht genau ein Ziel".into()));
    }
    // Ziel muss zum Einsatz gehören (FK garantiert nur Existenz, nicht Zugehörigkeit).
    async fn gehoert(pool: &sqlx::SqlitePool, tab: &str, id: i64, einsatz_id: i64) -> Result<bool, AppError> {
        let q = format!("SELECT 1 FROM {tab} WHERE id = ? AND einsatz_id = ?");
        Ok(sqlx::query_scalar::<_, i64>(&q).bind(id).bind(einsatz_id).fetch_optional(pool).await?.is_some())
    }
    let typ = match req.empfaenger_typ.as_str() {
        EMPF_ABSCHNITT => {
            let id = req.abschnitt_id.ok_or_else(|| AppError::Validation("abschnitt_id fehlt".into()))?;
            if !gehoert(pool, "einsatzabschnitt", id, einsatz_id).await? { return Err(AppError::Validation("Abschnitt gehört nicht zum Einsatz".into())); }
            EMPF_ABSCHNITT
        }
        EMPF_EINHEIT => {
            let id = req.einheit_id.ok_or_else(|| AppError::Validation("einheit_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_einheit", id, einsatz_id).await? { return Err(AppError::Validation("Einheit gehört nicht zum Einsatz".into())); }
            EMPF_EINHEIT
        }
        EMPF_PERSON => {
            let id = req.person_id.ok_or_else(|| AppError::Validation("person_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_personal", id, einsatz_id).await? { return Err(AppError::Validation("Person gehört nicht zum Einsatz".into())); }
            EMPF_PERSON
        }
        EMPF_FAHRZEUG => {
            let id = req.fahrzeug_id.ok_or_else(|| AppError::Validation("fahrzeug_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_fahrzeug", id, einsatz_id).await? { return Err(AppError::Validation("Fahrzeug gehört nicht zum Einsatz".into())); }
            EMPF_FAHRZEUG
        }
        EMPF_FUNKTION => {
            if trimme(&req.funktion_text).is_none() { return Err(AppError::Validation("funktion_text fehlt".into())); }
            EMPF_FUNKTION
        }
        _ => return Err(AppError::Validation("Ungültiger Empfänger-Typ".into())),
    };
    Ok(repo::EmpfaengerEingabe {
        empfaenger_typ: typ.to_string(),
        abschnitt_id: req.abschnitt_id,
        einheit_id: req.einheit_id,
        person_id: req.person_id,
        fahrzeug_id: req.fahrzeug_id,
        funktion_text: trimme(&req.funktion_text).map(str::to_string),
    })
}

/// POST /api/einsaetze/{id}/auftraege — Auftrag anlegen + zustellen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerAuftrag>,
) -> Result<(StatusCode, Json<AuftragDetail>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Akzeptanzkriterium: nur absendbar mit Auftragstext UND mindestens einem Empfänger.
    let text = req.auftrag_text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Auftragstext darf nicht leer sein".into()));
    }
    if req.empfaenger.is_empty() {
        return Err(AppError::Validation("Mindestens ein Empfänger ist erforderlich".into()));
    }
    let prioritaet = req.prioritaet.as_deref().unwrap_or(PRIO_NORMAL);
    if !crate::auftrag::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let frist = match trimme(&req.frist_at) {
        Some(f) => Some(parse_zeit(f)?),
        None => None,
    };
    let now = jetzt();
    let erteilt = match trimme(&req.erteilt_at) {
        Some(e) => parse_zeit(e)?,
        None => now.clone(),
    };

    let mut empfaenger = Vec::with_capacity(req.empfaenger.len());
    for r in &req.empfaenger {
        empfaenger.push(validiere_empfaenger(&state.pool, einsatz_id, r).await?);
    }

    let d = repo::anlegen(
        &state.pool, einsatz_id, benutzer.id,
        repo::AuftragDaten {
            auftrag_text: text,
            absicht: trimme(&req.absicht),
            lage: trimme(&req.lage),
            ort: trimme(&req.ort),
            zeit: trimme(&req.zeit),
            mittel: trimme(&req.mittel),
            verbindung: trimme(&req.verbindung),
            sicherheit: trimme(&req.sicherheit),
            prioritaet,
            frist_at: frist.as_deref(),
            erteilt_at: &erteilt,
            empfaenger,
        },
        &now,
    ).await?;

    // ETB-Anordnung wurde im selben Commit erzeugt → ETB-Live-Event mitschicken.
    if let Some(etb_id) = d.auftrag.etb_anordnung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(d)))
}
```

- [ ] **Step 2: Routen verdrahten**

`src/routes/mod.rs`: `pub mod auftrag;` ergänzen (alphabetisch).

`src/app.rs` nach Z. 73 (Erinnerungs-Routen):

```rust
        .route("/api/einsaetze/{id}/auftraege", get(routes::auftrag::liste))
        .route("/api/einsaetze/{id}/auftraege", post(routes::auftrag::anlegen))
```

- [ ] **Step 3: Build**

Run: `rtk proxy cargo build`
Expected: Finished.

- [ ] **Step 4: Commit**

```bash
git add src/routes/auftrag.rs src/routes/mod.rs src/app.rs
git commit -m "feat(auftrag): Route Liste + Anlegen (Validierung Empfänger+Text, ETB, SSE) (LFH-89)"
```

---

### Task A7: Integrationstests `tests/auftrag.rs`

**Files:**
- Create: `tests/auftrag.rs`

- [ ] **Step 1: Tests schreiben** (Helper wörtlich aus `tests/erinnerung.rs` kopieren — kein gemeinsames Modul)

```rust
use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use tower::ServiceExt;

async fn setup() -> axum::Router {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    build_router(AppState { pool, live: LiveHub::new(), fachebenen: lifeline_hub::karte::FachebenenState::neu() })
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = serde_json::json!({ "benutzername": benutzername, "passwort": passwort }).to_string();
    let res = app.clone().oneshot(
        axum::http::Request::builder().method("POST").uri("/api/auth/login")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(body).unwrap()
    ).await.unwrap();
    let cookie = res.headers().get(axum::http::header::SET_COOKIE).unwrap().to_str().unwrap();
    cookie.split(';').next().unwrap().to_string()
}

async fn anfrage(app: &axum::Router, methode: &str, uri: &str, cookie: &str, body: Option<&str>) -> (StatusCode, Value) {
    let mut req = axum::http::Request::builder().method(methode).uri(uri)
        .header(axum::http::header::COOKIE, cookie);
    if body.is_some() { req = req.header(axum::http::header::CONTENT_TYPE, "application/json"); }
    let res = app.clone().oneshot(req.body(body.unwrap_or("").to_string()).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (_, json) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(r#"{"bezeichnung":"Lage"}"#)).await;
    json["id"].as_i64().unwrap()
}

fn body_mit_funktion(text: &str, empf: &str) -> String {
    serde_json::json!({
        "auftrag_text": text,
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": empf }]
    }).to_string()
}

#[tokio::test]
async fn anlegen_erzeugt_auftrag_und_etb_anordnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("Deich sichern", "Abschnitt Nord"))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["auftrag_text"], "Deich sichern");
    assert!(json["etb_anordnung_id"].is_i64(), "ETB-Anordnung wird erzeugt");
    assert_eq!(json["empfaenger"][0]["snap_anzeige"], "Abschnitt Nord");

    // ETB-Anordnung ist in der ETB-Liste sichtbar.
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    assert!(etb.as_array().unwrap().iter().any(|x| x["typ"] == "anordnung"));
}

#[tokio::test]
async fn anlegen_ohne_empfaenger_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = r#"{"auftrag_text":"X","empfaenger":[]}"#;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_ohne_text_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("   ", "EA1"))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn liste_zeigt_angelegte_auftraege() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("A", "EA1"))).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/auftraege"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fremder_empfaenger_abschnitt_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // abschnitt_id 9999 existiert nicht / gehört nicht zum Einsatz.
    let body = serde_json::json!({
        "auftrag_text": "X",
        "empfaenger": [{ "empfaenger_typ": "abschnitt", "abschnitt_id": 9999 }]
    }).to_string();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Tests laufen**

Run: `rtk proxy cargo test --test auftrag`
Expected: PASS (alle 5 Tests grün).

- [ ] **Step 3: Commit**

```bash
git add tests/auftrag.rs
git commit -m "test(auftrag): Integrationstests Anlegen/Validierung/Liste/ETB (LFH-89)"
```

---

### Task A8: Frontend-Typen `Auftrag` / `NeuerAuftrag`

**Files:**
- Modify: `frontend/src/api/types.ts` (neue Sektion ans Dateiende)

- [ ] **Step 1: Typen ergänzen**

```typescript
// ============================== LFH-52 Aufträge/Befehle ==============================

export type AuftragPrioritaet = 'sofort' | 'dringend' | 'normal';
export type AuftragBearbeitungsstatus = 'offen' | 'in_arbeit' | 'vollzogen' | 'abgenommen';
export type EmpfaengerTyp = 'abschnitt' | 'einheit' | 'funktion' | 'person' | 'fahrzeug';

export interface AuftragEmpfaenger {
  id: number;
  auftrag_id: number;
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id: number | null;
  einheit_id: number | null;
  person_id: number | null;
  fahrzeug_id: number | null;
  funktion_text: string | null;
  snap_anzeige: string;
  quittiert_at: string | null;
  quittiert_von_id: number | null;
}

export interface Auftrag {
  id: number;
  einsatz_id: number;
  auftrag_text: string;
  absicht: string | null;
  lage: string | null;
  ort: string | null;
  zeit: string | null;
  mittel: string | null;
  verbindung: string | null;
  sicherheit: string | null;
  prioritaet: AuftragPrioritaet;
  frist_at: string | null;
  erteilt_at: string;
  in_arbeit_at: string | null;
  vollzugsmeldung: string | null;
  abgenommen_at: string | null;
  abgenommen_von_id: number | null;
  etb_anordnung_id: number | null;
  erstellt_von_id: number;
  erstellt_at: string;
  vollzug_status: 'offen' | 'in_arbeit' | 'vollzogen';
  vollzogen_at: string | null;
  vollzogen_von_id: number | null;
  empfaenger_anzahl: number;
  quittiert_anzahl: number;
  ist_ueberfaellig: boolean;
  bearbeitungsstatus: AuftragBearbeitungsstatus;
  // Detail-/Anlege-/Mutations-Antwort liefert die Empfänger mit.
  empfaenger: AuftragEmpfaenger[];
}

export interface NeuerEmpfaenger {
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id?: number;
  einheit_id?: number;
  person_id?: number;
  fahrzeug_id?: number;
  funktion_text?: string;
}

export interface NeuerAuftrag {
  auftrag_text: string;
  absicht?: string;
  lage?: string;
  ort?: string;
  zeit?: string;
  mittel?: string;
  verbindung?: string;
  sicherheit?: string;
  prioritaet?: AuftragPrioritaet;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  frist_at?: string;
  /** Erteilzeitpunkt (UTC); leer = jetzt. */
  erteilt_at?: string;
  empfaenger: NeuerEmpfaenger[];
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: Keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/types.ts
git commit -m "feat(auftrag): Frontend-Typen Auftrag/Empfänger/NeuerAuftrag (LFH-52)"
```

---

### Task A9: Frontend-API-Client `frontend/src/api/auftraege.ts`

**Files:**
- Create: `frontend/src/api/auftraege.ts`

- [ ] **Step 1: Client schreiben** (Vorbild `api/erinnerungen.ts`)

```typescript
import { apiGet, apiSend } from './client';
import type { Auftrag, NeuerAuftrag } from './types';

export interface AuftragFilter {
  status?: string;
  abschnittId?: number;
  einheitId?: number;
}

export function listeAuftraege(einsatzId: number, filter: AuftragFilter = {}): Promise<Auftrag[]> {
  const p = new URLSearchParams();
  if (filter.status) p.set('status', filter.status);
  if (filter.abschnittId != null) p.set('abschnitt_id', String(filter.abschnittId));
  if (filter.einheitId != null) p.set('einheit_id', String(filter.einheitId));
  const q = p.toString() ? `?${p.toString()}` : '';
  return apiGet<Auftrag[]>(`/api/einsaetze/${einsatzId}/auftraege${q}`);
}

export function legeAuftragAn(einsatzId: number, daten: NeuerAuftrag): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege`, 'POST', daten);
}

// Quittierung pro Empfänger (Phase B):
export function quittiereEmpfaenger(einsatzId: number, auftragId: number, empfaengerId: number): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}/empfaenger/${empfaengerId}/quittieren`, 'POST');
}

// Vollzug/Abnahme (Phase C):
export function setzeVollzug(einsatzId: number, auftragId: number, status: 'in_arbeit' | 'vollzogen', vollzugsmeldung?: string): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}/vollzug`, 'POST', { status, vollzugsmeldung });
}

export function nimmAb(einsatzId: number, auftragId: number): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/auftraege/${auftragId}/abnehmen`, 'POST');
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: Keine Fehler (Endpunkte für B/C werden dort scharf geschaltet; Client darf sie vorab deklarieren).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/auftraege.ts
git commit -m "feat(auftrag): Frontend-API-Client für Aufträge (LFH-52)"
```

---

### Task A10: Live-Hook erweitern + Modul real schalten + Page-Grundgerüst + Formular

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`
- Modify: `frontend/src/einsatz/modulRegistry.ts:79` (`status: 'fertig'`)
- Modify: `frontend/src/App.tsx` (Import + `MODUL_ELEMENTE`)
- Create: `frontend/src/auftraege/AuftragFormular.tsx`
- Create: `frontend/src/auftraege/AuftragListe.tsx`
- Create: `frontend/src/pages/AuftraegePage.tsx`

- [ ] **Step 1: Live-Hook um `auftrag`-Event ergänzen**

In `useEinsatzLiveStream.ts`: Handler + Listener + Cleanup + Lag-Resync ergänzen:

```typescript
    const onAuftrag = () => inval('einsatz-auftraege');
```
in `onLag` zusätzlich `onAuftrag();` aufrufen; im Block `quelle.addEventListener('erinnerung', onErinnerung);` direkt darunter:
```typescript
    quelle.addEventListener('auftrag', onAuftrag);
```
und im Cleanup analog:
```typescript
      quelle.removeEventListener('auftrag', onAuftrag);
```

- [ ] **Step 2: Modul real schalten**

`frontend/src/einsatz/modulRegistry.ts` Z. 79: `status: 'geplant'` → `status: 'fertig'`.

`frontend/src/App.tsx`: Import ergänzen
```typescript
import AuftraegePage from './pages/AuftraegePage';
```
und in `MODUL_ELEMENTE` (nahe `erinnerungen: <ErinnerungenPage />,`):
```typescript
  auftraege: <AuftraegePage />,
```

- [ ] **Step 3: `AuftragFormular.tsx` (Befehlsschema)**

```tsx
import { App, Button, Card, DatePicker, Form, Input, Select, Space } from 'antd';
import { useState } from 'react';
import dayjs from 'dayjs';
import type { NeuerAuftrag, NeuerEmpfaenger } from '../api/types';

const { TextArea } = Input;

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss'. */
function dayjsZuWire(d: dayjs.Dayjs | null): string | undefined {
  return d ? d.utc().format('YYYY-MM-DD HH:mm:ss') : undefined;
}

export default function AuftragFormular({ senden, onAnlegen }: {
  senden: boolean;
  onAnlegen: (d: NeuerAuftrag) => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [absicht, setAbsicht] = useState('');
  const [lage, setLage] = useState('');
  const [ort, setOrt] = useState('');
  const [mittel, setMittel] = useState('');
  const [verbindung, setVerbindung] = useState('');
  const [sicherheit, setSicherheit] = useState('');
  const [prioritaet, setPrioritaet] = useState<'sofort' | 'dringend' | 'normal'>('normal');
  const [frist, setFrist] = useState<dayjs.Dayjs | null>(null);
  const [empfText, setEmpfText] = useState('');

  const absenden = () => {
    if (!text.trim()) { message.error('Auftragstext ist erforderlich'); return; }
    if (!empfText.trim()) { message.error('Mindestens ein Empfänger ist erforderlich'); return; }
    // MVP: Empfänger als Funktion (Freitext); EA/Einheit-Auswahl folgt in AuftragEmpfaengerWahl.
    const empfaenger: NeuerEmpfaenger[] = empfText
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((funktion_text) => ({ empfaenger_typ: 'funktion', funktion_text }));
    onAnlegen({
      auftrag_text: text.trim(),
      absicht: absicht.trim() || undefined,
      lage: lage.trim() || undefined,
      ort: ort.trim() || undefined,
      mittel: mittel.trim() || undefined,
      verbindung: verbindung.trim() || undefined,
      sicherheit: sicherheit.trim() || undefined,
      prioritaet,
      frist_at: dayjsZuWire(frist),
      empfaenger,
    });
    setText(''); setAbsicht(''); setLage(''); setOrt(''); setMittel('');
    setVerbindung(''); setSicherheit(''); setFrist(null); setEmpfText('');
  };

  return (
    <Card size="small" title="Neuer Auftrag/Befehl">
      <Form layout="vertical" onFinish={absenden}>
        <Form.Item label="Empfänger (EA/Einheit/Funktion, kommagetrennt)" required>
          <Input value={empfText} onChange={(e) => setEmpfText(e.target.value)} placeholder="Abschnitt Nord, 2. Zug" />
        </Form.Item>
        <Form.Item label="Auftrag / Was" required>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={2} />
        </Form.Item>
        <Form.Item label="Absicht / Ziel">
          <TextArea value={absicht} onChange={(e) => setAbsicht(e.target.value)} rows={1} />
        </Form.Item>
        <Form.Item label="Lage">
          <TextArea value={lage} onChange={(e) => setLage(e.target.value)} rows={1} />
        </Form.Item>
        <Form.Item label="Ort / Wo">
          <Input value={ort} onChange={(e) => setOrt(e.target.value)} />
        </Form.Item>
        <Form.Item label="Mittel / Womit">
          <Input value={mittel} onChange={(e) => setMittel(e.target.value)} />
        </Form.Item>
        <Form.Item label="Verbindung / Meldewege">
          <Input value={verbindung} onChange={(e) => setVerbindung(e.target.value)} />
        </Form.Item>
        <Form.Item label="Sicherheit / Besonderes">
          <Input value={sicherheit} onChange={(e) => setSicherheit(e.target.value)} />
        </Form.Item>
        <Space style={{ width: '100%' }} styles={{ item: { flex: 1 } }}>
          <Form.Item label="Priorität">
            <Select value={prioritaet} onChange={setPrioritaet} options={[
              { value: 'sofort', label: 'Sofort' },
              { value: 'dringend', label: 'Dringend' },
              { value: 'normal', label: 'Normal' },
            ]} />
          </Form.Item>
          <Form.Item label="Frist (Quittung/Vollzug)">
            <DatePicker showTime value={frist} onChange={setFrist} style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={senden} block>Auftrag erteilen</Button>
      </Form>
    </Card>
  );
}
```

- [ ] **Step 4: `AuftragListe.tsx` (Board mit Status-Tags + Überfällig-Markierung)**

```tsx
import { Empty, List, Space, Tag, Typography } from 'antd';
import type { Auftrag } from '../api/types';

const PRIO_TAG: Record<string, { color: string; label: string }> = {
  sofort: { color: 'red', label: 'Sofort' },
  dringend: { color: 'orange', label: 'Dringend' },
  normal: { color: 'default', label: 'Normal' },
};
const BEARB_TAG: Record<string, { color: string; label: string }> = {
  offen: { color: 'default', label: 'Offen' },
  in_arbeit: { color: 'processing', label: 'In Bearbeitung' },
  vollzogen: { color: 'success', label: 'Vollzogen' },
  abgenommen: { color: 'green', label: 'Abgenommen' },
};

export default function AuftragListe({ auftraege, aktionen }: {
  auftraege: Auftrag[];
  aktionen?: (a: Auftrag) => React.ReactNode;
}) {
  if (auftraege.length === 0) return <Empty description="Keine Aufträge" />;
  return (
    <List
      dataSource={auftraege}
      renderItem={(a) => {
        const prio = PRIO_TAG[a.prioritaet] ?? PRIO_TAG.normal;
        const bearb = BEARB_TAG[a.bearbeitungsstatus] ?? BEARB_TAG.offen;
        const alleQuittiert = a.empfaenger_anzahl > 0 && a.quittiert_anzahl === a.empfaenger_anzahl;
        return (
          <List.Item
            style={a.ist_ueberfaellig ? { background: '#fff1f0', borderInlineStart: '3px solid #ff4d4f', paddingInlineStart: 8 } : undefined}
            actions={aktionen ? [aktionen(a)] : undefined}
          >
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag color={prio.color}>{prio.label}</Tag>
                  <Typography.Text strong>{a.auftrag_text}</Typography.Text>
                  {a.ist_ueberfaellig && <Tag color="error">Überfällig</Tag>}
                </Space>
              }
              description={
                <Space wrap size={[8, 4]}>
                  <Tag color={bearb.color}>{bearb.label}</Tag>
                  <Tag color={alleQuittiert ? 'success' : 'warning'}>
                    Quittiert {a.quittiert_anzahl}/{a.empfaenger_anzahl}
                  </Tag>
                  <Typography.Text type="secondary">
                    Empfänger: {a.empfaenger.map((e) => e.snap_anzeige).join(', ')}
                  </Typography.Text>
                  {a.frist_at && <Typography.Text type="secondary">Frist: {a.frist_at} UTC</Typography.Text>}
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

- [ ] **Step 5: `AuftraegePage.tsx` (Page-Grundgerüst, Vorbild ErinnerungenPage)**

```tsx
import { Alert, App, Breadcrumb, Col, Row, Spin, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { legeAuftragAn, listeAuftraege } from '../api/auftraege';
import type { NeuerAuftrag } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import AuftragListe from '../auftraege/AuftragListe';
import AuftragFormular from '../auftraege/AuftragFormular';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId],
    queryFn: () => listeAuftraege(einsatzId),
  });

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-auftraege', einsatzId] });

  const anlegenMutation = useMutation({
    mutationFn: (d: NeuerAuftrag) => legeAuftragAn(einsatzId, d),
    onSuccess: () => { invalidiere(); message.success('Auftrag erteilt'); },
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
  const auftraege = auftraegeQuery.data ?? [];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Aufträge/Befehle' },
        ]}
      />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Aufträge/Befehle</Typography.Title>
      <Row gutter={24}>
        <Col flex="auto">
          {auftraegeQuery.isError && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Aufträge konnten nicht geladen werden" />
          )}
          <AuftragListe auftraege={auftraege} />
        </Col>
        {darfSchreiben && (
          <Col flex="360px">
            <AuftragFormular senden={anlegenMutation.isPending} onAnlegen={(d) => anlegenMutation.mutate(d)} />
          </Col>
        )}
      </Row>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + Build**

Run: `cd frontend && pnpm typecheck && pnpm build`
Expected: Keine Fehler; Build erzeugt `dist/` (für rust-embed).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/etb/useEinsatzLiveStream.ts frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx frontend/src/auftraege/ frontend/src/pages/AuftraegePage.tsx
git commit -m "feat(auftrag): Modul real schalten – Page, Formular, Board, Live-Event (LFH-89)"
```

---

### Task A11: Frontend-Test `AuftraegePage.test.tsx`

**Files:**
- Create: `frontend/src/pages/AuftraegePage.test.tsx`

- [ ] **Step 1: Smoke-/Verhaltenstest** (Vorbild `ErinnerungenPage.test.tsx`, Modul-Mock-Stil)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 1, einsatz_id: 1, auftrag_text: 'Deich sichern', absicht: null, lage: null, ort: null,
  zeit: null, mittel: null, verbindung: null, sicherheit: null, prioritaet: 'normal',
  frist_at: null, erteilt_at: '2026-06-11 09:00:00', in_arbeit_at: null, vollzugsmeldung: null,
  abgenommen_at: null, abgenommen_von_id: null, etb_anordnung_id: 5, erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00', vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
  empfaenger_anzahl: 1, quittiert_anzahl: 0, ist_ueberfaellig: false, bearbeitungsstatus: 'offen',
  empfaenger: [{ id: 1, auftrag_id: 1, empfaenger_typ: 'funktion', abschnitt_id: null, einheit_id: null, person_id: null, fahrzeug_id: null, funktion_text: 'EA Nord', snap_anzeige: 'EA Nord', quittiert_at: null, quittiert_von_id: null }],
  ...over,
});

const listeAuftraege = vi.fn();
const legeAuftragAn = vi.fn();
vi.mock('../api/auftraege', () => ({
  listeAuftraege: (...a: unknown[]) => listeAuftraege(...a),
  legeAuftragAn: (...a: unknown[]) => legeAuftragAn(...a),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/auftraege']}>
          <Routes><Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('AuftraegePage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeAuftraege.mockResolvedValue([auftrag()]); });

  it('zeigt Aufträge mit Quittierungs-Stand', async () => {
    renderPage();
    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    expect(screen.getByText('Quittiert 0/1')).toBeInTheDocument();
  });

  it('markiert überfällige Aufträge', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ ist_ueberfaellig: true, frist_at: '2026-06-11 08:00:00' })]);
    renderPage();
    expect(await screen.findByText('Überfällig')).toBeInTheDocument();
  });

  it('legt einen Auftrag an (Empfänger + Text Pflicht)', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.type(screen.getByPlaceholderText('Abschnitt Nord, 2. Zug'), 'EA Nord');
    const textareas = screen.getAllByRole('textbox');
    // Erstes TextArea nach dem Empfänger-Input ist "Auftrag / Was".
    await userEvent.type(textareas[1], 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledWith(1, expect.objectContaining({
      auftrag_text: 'Erkunden',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    })));
  });
});
```

- [ ] **Step 2: Test läuft**

Run: `cd frontend && pnpm test -- --no-file-parallelism src/pages/AuftraegePage.test.tsx`
Expected: PASS (3 Tests grün).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AuftraegePage.test.tsx
git commit -m "test(auftrag): Page-Test Anzeige/Überfällig/Anlegen (LFH-89)"
```

---

# Phase B — Quittierung pro Empfänger (LFH-90)

### Task B1: Repo `quittiere_empfaenger`

**Files:**
- Modify: `src/auftrag/repo.rs`

- [ ] **Step 1: Failing test**

Im `mod tests` von `src/auftrag/repo.rs`:

```rust
    #[tokio::test]
    async fn quittieren_setzt_nur_quittung_nicht_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1"), funktion("EA2")]), "2026-06-11 09:00:00").await.unwrap();
        let empf1 = d.empfaenger[0].id;

        quittiere_empfaenger(&pool, empf1, b, "2026-06-11 10:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00").await.unwrap();
        assert_eq!(nach.auftrag.quittiert_anzahl, 1, "ein Empfänger quittiert");
        assert_eq!(nach.auftrag.empfaenger_anzahl, 2);
        assert_eq!(nach.auftrag.vollzug_status, "offen", "Quittung ändert Vollzug nicht");
        assert_eq!(nach.auftrag.bearbeitungsstatus, "offen");
        let e1 = nach.empfaenger.iter().find(|x| x.id == empf1).unwrap();
        assert_eq!(e1.quittiert_at.as_deref(), Some("2026-06-11 10:00:00"));
        assert_eq!(e1.quittiert_von_id, Some(b));
    }

    #[tokio::test]
    async fn empfaenger_gehoert_zu_auftrag_schuetzt() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        assert!(empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, d.auftrag.id).await.unwrap());
        assert!(!empfaenger_gehoert_zu_auftrag(&pool, d.empfaenger[0].id, 999).await.unwrap());
    }
```

- [ ] **Step 2: Verify fail**

Run: `rtk proxy cargo test --lib auftrag::repo::tests::quittieren_setzt_nur_quittung_nicht_vollzug`
Expected: FAIL (Funktionen fehlen).

- [ ] **Step 3: Implementieren**

```rust
/// Setzt die Quittung einer Empfänger-Zeile (idempotent: hält den ersten Zeitstempel).
pub async fn quittiere_empfaenger(pool: &SqlitePool, empfaenger_id: i64, von_id: i64, jetzt: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE auftrag_empfaenger \
         SET quittiert_at = COALESCE(quittiert_at, ?), quittiert_von_id = COALESCE(quittiert_von_id, ?) \
         WHERE id = ?",
    )
    .bind(jetzt).bind(von_id).bind(empfaenger_id)
    .execute(pool).await?;
    Ok(())
}

/// Prüft, ob eine Empfänger-Zeile zum Auftrag gehört (Cross-Objekt-Schutz).
pub async fn empfaenger_gehoert_zu_auftrag(pool: &SqlitePool, empfaenger_id: i64, auftrag_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM auftrag_empfaenger WHERE id = ? AND auftrag_id = ?")
            .bind(empfaenger_id).bind(auftrag_id)
            .fetch_optional(pool).await?;
    Ok(treffer.is_some())
}
```

- [ ] **Step 4: Verify pass**

Run: `rtk proxy cargo test --lib auftrag::repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auftrag/repo.rs
git commit -m "feat(auftrag): Repo – Quittierung pro Empfänger (LFH-90)"
```

---

### Task B2: Route `quittieren` + Test

**Files:**
- Modify: `src/routes/auftrag.rs`
- Modify: `src/app.rs`
- Modify: `tests/auftrag.rs`

- [ ] **Step 1: Handler + gemeinsamer Gate-Vorlauf**

In `src/routes/auftrag.rs` ergänzen:

```rust
/// Gemeinsamer Vorlauf für Auftrags-Aktionen: Gates + Cross-Einsatz-Schutz.
/// Gibt `org_id` zurück (für kommunikation_status-Schreibpfade).
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<i64, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, auftrag_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(einsatz.org_id)
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id, empfaenger_id)): Path<(i64, i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    if !repo::empfaenger_gehoert_zu_auftrag(&state.pool, empfaenger_id, auftrag_id).await? {
        return Err(AppError::NotFound);
    }
    repo::quittiere_empfaenger(&state.pool, empfaenger_id, benutzer.id, &jetzt()).await?;
    let d = repo::laden(&state.pool, auftrag_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}
```

- [ ] **Step 2: Route registrieren** (`src/app.rs`)

```rust
        .route("/api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren", post(routes::auftrag::quittieren))
```

- [ ] **Step 3: Integrationstest** (`tests/auftrag.rs`)

```rust
#[tokio::test]
async fn quittieren_aendert_quittung_nicht_vollzug() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let empf = a["empfaenger"][0]["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/empfaenger/{empf}/quittieren"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["quittiert_anzahl"], 1);
    assert_eq!(json["vollzug_status"], "offen");
    assert_eq!(json["bearbeitungsstatus"], "offen");
}
```

- [ ] **Step 4: Tests laufen**

Run: `rtk proxy cargo test --test auftrag`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/auftrag.rs src/app.rs tests/auftrag.rs
git commit -m "feat(auftrag): Route Quittierung pro Empfänger + Test (LFH-90)"
```

---

### Task B3: Frontend — Quittieren-Aktion im Board

**Files:**
- Modify: `frontend/src/auftraege/AuftragListe.tsx` (Empfänger-Details + Quittieren-Buttons)
- Modify: `frontend/src/pages/AuftraegePage.tsx` (Mutation)
- Modify: `frontend/src/pages/AuftraegePage.test.tsx`

- [ ] **Step 1: Quittieren-Mutation in der Page**

In `AuftraegePage.tsx` ergänzen (Import `quittiereEmpfaenger`):

```tsx
  const quittierenMutation = useMutation({
    mutationFn: ({ auftragId, empfaengerId }: { auftragId: number; empfaengerId: number }) =>
      quittiereEmpfaenger(einsatzId, auftragId, empfaengerId),
    onSuccess: invalidiere, onError: fehler,
  });
```
und an `AuftragListe` durchreichen:
```tsx
          <AuftragListe
            auftraege={auftraege}
            darfSchreiben={darfSchreiben}
            onQuittieren={(auftragId, empfaengerId) => quittierenMutation.mutate({ auftragId, empfaengerId })}
          />
```

- [ ] **Step 2: Empfänger-Liste mit Quittieren-Button in `AuftragListe.tsx`**

Props erweitern:
```tsx
export default function AuftragListe({ auftraege, darfSchreiben, onQuittieren }: {
  auftraege: Auftrag[];
  darfSchreiben?: boolean;
  onQuittieren?: (auftragId: number, empfaengerId: number) => void;
}) {
```
In der `description`-Section unter den Tags eine Empfänger-Zeile mit Quittungs-Status rendern:
```tsx
                  <div>
                    {a.empfaenger.map((emp) => (
                      <Tag key={emp.id} color={emp.quittiert_at ? 'success' : 'default'} style={{ marginBottom: 4 }}>
                        {emp.snap_anzeige}{emp.quittiert_at ? ' ✓' : ''}
                        {darfSchreiben && !emp.quittiert_at && onQuittieren && (
                          <Typography.Link style={{ marginInlineStart: 6 }} onClick={() => onQuittieren(a.id, emp.id)}>
                            quittieren
                          </Typography.Link>
                        )}
                      </Tag>
                    ))}
                  </div>
```

- [ ] **Step 3: Test ergänzen**

In `AuftraegePage.test.tsx`:
```tsx
  it('quittiert einen Empfänger', async () => {
    const quittiereEmpfaenger = vi.fn().mockResolvedValue(auftrag());
    // hoist: in vi.mock('../api/auftraege') mit aufnehmen — siehe Mock oben.
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('quittieren'));
    // Erwartung: Mutation mit (auftragId, empfaengerId)
  });
```
Den `vi.mock('../api/auftraege')` um `quittiereEmpfaenger` erweitern (analog `legeAuftragAn`).

- [ ] **Step 4: Tests + Build**

Run: `cd frontend && pnpm test -- --no-file-parallelism src/pages/AuftraegePage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auftraege/AuftragListe.tsx frontend/src/pages/AuftraegePage.tsx frontend/src/pages/AuftraegePage.test.tsx
git commit -m "feat(auftrag): Quittieren pro Empfänger im Board (LFH-90)"
```

---

# Phase C — Vollzug, Abnahme & Führungskontrolle (LFH-91)

### Task C1: Repo Vollzug (`setze_vollzug_status`, `melde_vollzug`, `nimm_ab`)

**Files:**
- Modify: `src/auftrag/repo.rs`

- [ ] **Step 1: Failing tests**

```rust
    #[tokio::test]
    async fn in_arbeit_setzt_zeitstempel_und_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        setze_in_arbeit(&pool, 1, e, d.auftrag.id, b, "2026-06-11 10:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 10:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "in_arbeit");
        assert_eq!(nach.auftrag.in_arbeit_at.as_deref(), Some("2026-06-11 10:00:00"));
    }

    #[tokio::test]
    async fn melde_vollzug_setzt_text_status_und_etb_meldung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        let etb_id = melde_vollzug(&pool, 1, e, d.auftrag.id, b, "Deich gehalten", "2026-06-11 11:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 11:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "vollzogen");
        assert_eq!(nach.auftrag.vollzugsmeldung.as_deref(), Some("Deich gehalten"));
        let (typ, backlink): (String, i64) = sqlx::query_as("SELECT typ, auftrag_id FROM etb_eintrag WHERE id = ?")
            .bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, d.auftrag.id);
    }

    #[tokio::test]
    async fn nimm_ab_setzt_abnahme_nach_vollzug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let d = anlegen(&pool, e, b, daten("X", None, vec![funktion("EA1")]), "2026-06-11 09:00:00").await.unwrap();
        melde_vollzug(&pool, 1, e, d.auftrag.id, b, "fertig", "2026-06-11 11:00:00").await.unwrap();
        nimm_ab(&pool, d.auftrag.id, b, "2026-06-11 12:00:00").await.unwrap();
        let nach = laden(&pool, d.auftrag.id, "2026-06-11 12:01:00").await.unwrap();
        assert_eq!(nach.auftrag.bearbeitungsstatus, "abgenommen");
        assert_eq!(nach.auftrag.abgenommen_von_id, Some(b));
    }
```

- [ ] **Step 2: Verify fail**

Run: `rtk proxy cargo test --lib auftrag::repo::tests::melde_vollzug_setzt_text_status_und_etb_meldung`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

```rust
use crate::kommunikation::{repo as krepo, VOLLZUG_IN_ARBEIT, VOLLZUG_VOLLZOGEN};

/// Setzt Vollzug → 'in_arbeit' (geteilte Achse) und hält den Zeitstempel am Auftrag.
pub async fn setze_in_arbeit(pool: &SqlitePool, org_id: i64, einsatz_id: i64, auftrag_id: i64, von_id: i64, jetzt: &str) -> Result<(), AppError> {
    krepo::setze_vollzug(pool, org_id, einsatz_id, OBJEKT_AUFTRAG, auftrag_id, VOLLZUG_IN_ARBEIT, von_id, jetzt).await?;
    sqlx::query("UPDATE auftrag SET in_arbeit_at = COALESCE(in_arbeit_at, ?) WHERE id = ?")
        .bind(jetzt).bind(auftrag_id).execute(pool).await?;
    Ok(())
}

/// Meldet Vollzug: Rückmeldetext am Auftrag, Vollzug-Achse → 'vollzogen' und ein
/// ETB-Folgeeintrag (typ='meldung', gemeinsames auftrag_id). Transaktional.
/// Liefert die neue ETB-`id`.
pub async fn melde_vollzug(pool: &SqlitePool, org_id: i64, einsatz_id: i64, auftrag_id: i64, von_id: i64, vollzugsmeldung: &str, jetzt: &str) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE auftrag SET vollzugsmeldung = ? WHERE id = ?")
        .bind(vollzugsmeldung).bind(auftrag_id).execute(&mut *tx).await?;
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx, einsatz_id, von_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: vollzugsmeldung,
            von: None, an: None, meldeweg: None, veranlassung: None,
            ereigniszeit: Some(jetzt), erfasst_lokal_at: None, berichtigt_eintrag_id: None,
        },
    ).await?;
    sqlx::query("UPDATE etb_eintrag SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id).bind(etb_id).execute(&mut *tx).await?;
    tx.commit().await?;
    // Vollzug-Achse außerhalb der tx (eigener Pool-Schreibpfad) — Reihenfolge unkritisch.
    krepo::setze_vollzug(pool, org_id, einsatz_id, OBJEKT_AUFTRAG, auftrag_id, VOLLZUG_VOLLZOGEN, von_id, jetzt).await?;
    Ok(etb_id)
}

/// Abnahme durch die Führung (4. Stufe). Setzt abgenommen_at/_von_id am Auftrag.
pub async fn nimm_ab(pool: &SqlitePool, auftrag_id: i64, von_id: i64, jetzt: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE auftrag SET abgenommen_at = ?, abgenommen_von_id = ? WHERE id = ?")
        .bind(jetzt).bind(von_id).bind(auftrag_id).execute(pool).await?;
    Ok(())
}
```

> Den `use crate::kommunikation::...`-Import oben in der Datei zu den bestehenden `use`-Zeilen zusammenführen (nicht doppelt importieren).

- [ ] **Step 4: Verify pass**

Run: `rtk proxy cargo test --lib auftrag::repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auftrag/repo.rs
git commit -m "feat(auftrag): Repo – Vollzug (in_arbeit/vollzogen+ETB-Meldung) und Abnahme (LFH-91)"
```

---

### Task C2: Routen Vollzug + Abnahme + Tests

**Files:**
- Modify: `src/routes/auftrag.rs`, `src/app.rs`, `tests/auftrag.rs`

- [ ] **Step 1: Handler**

```rust
#[derive(Debug, Deserialize)]
pub struct VollzugReq {
    pub status: String,                 // 'in_arbeit' | 'vollzogen'
    pub vollzugsmeldung: Option<String>,
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/vollzug
pub async fn vollzug(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
    Json(req): Json<VollzugReq>,
) -> Result<Json<AuftragDetail>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    let now = jetzt();
    match req.status.as_str() {
        "in_arbeit" => {
            repo::setze_in_arbeit(&state.pool, org_id, einsatz_id, auftrag_id, benutzer.id, &now).await?;
        }
        "vollzogen" => {
            let text = req.vollzugsmeldung.as_deref().map(str::trim).filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::Validation("Vollzugsmeldung darf nicht leer sein".into()))?;
            let etb_id = repo::melde_vollzug(&state.pool, org_id, einsatz_id, auftrag_id, benutzer.id, text, &now).await?;
            if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
                if let Ok(json) = serde_json::to_string(&etb) { state.live.publiziere(einsatz_id, json); }
            }
        }
        _ => return Err(AppError::Validation("Ungültiger Vollzug-Status".into())),
    }
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/abnehmen — Führung nimmt Vollzug ab.
pub async fn abnehmen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, auftrag_id, &now).await?;
    if aktuell.auftrag.vollzug_status != "vollzogen" {
        return Err(AppError::UnprocessableEntity("Nur vollzogene Aufträge können abgenommen werden".into()));
    }
    repo::nimm_ab(&state.pool, auftrag_id, benutzer.id, &now).await?;
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}
```

> **Hinweis:** Prüfen, ob `AppError::UnprocessableEntity(String)` existiert (laut Mapping 422). Falls die Variante einen anderen Konstruktor hat, an `src/error.rs` anpassen.

- [ ] **Step 2: Routen registrieren**

```rust
        .route("/api/einsaetze/{id}/auftraege/{aid}/vollzug", post(routes::auftrag::vollzug))
        .route("/api/einsaetze/{id}/auftraege/{aid}/abnehmen", post(routes::auftrag::abnehmen))
```

- [ ] **Step 3: Integrationstests**

```rust
#[tokio::test]
async fn vollzug_melden_erzeugt_etb_meldung_und_setzt_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();

    let body = r#"{"status":"vollzogen","vollzugsmeldung":"Deich gehalten"}"#;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"), &admin, Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bearbeitungsstatus"], "vollzogen");
    assert_eq!(json["vollzugsmeldung"], "Deich gehalten");

    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    let typen: Vec<&str> = etb.as_array().unwrap().iter().filter_map(|x| x["typ"].as_str()).collect();
    assert!(typen.contains(&"anordnung"));
    assert!(typen.contains(&"meldung"));
}

#[tokio::test]
async fn abnehmen_vor_vollzug_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege"), &admin, Some(&body_mit_funktion("X", "EA1"))).await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/auftraege/{aid}/abnehmen"), &admin, None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
```

- [ ] **Step 4: Tests laufen**

Run: `rtk proxy cargo test --test auftrag`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/auftrag.rs src/app.rs tests/auftrag.rs
git commit -m "feat(auftrag): Routen Vollzug + Abnahme inkl. ETB-Folgeeintrag (LFH-91)"
```

---

### Task C3: Frontend — Vollzug-/Abnahme-Aktionen + Vollzugsmeldungs-Modal

**Files:**
- Modify: `frontend/src/auftraege/AuftragListe.tsx` (Aktions-Buttons je nach `bearbeitungsstatus`)
- Create: `frontend/src/auftraege/VollzugMeldenModal.tsx`
- Modify: `frontend/src/pages/AuftraegePage.tsx` (Mutationen `setzeVollzug`, `nimmAb`)
- Modify: `frontend/src/pages/AuftraegePage.test.tsx`

- [ ] **Step 1: `VollzugMeldenModal.tsx`**

```tsx
import { App, Input, Modal } from 'antd';
import { useState } from 'react';

export default function VollzugMeldenModal({ offen, onAbbrechen, onBestaetigen }: {
  offen: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (vollzugsmeldung: string) => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  return (
    <Modal
      title="Vollzug melden"
      open={offen}
      okText="Vollzug melden"
      onCancel={() => { setText(''); onAbbrechen(); }}
      onOk={() => {
        if (!text.trim()) { message.error('Rückmeldung erforderlich'); return; }
        onBestaetigen(text.trim()); setText('');
      }}
    >
      <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Rückmeldung zur Erledigung" />
    </Modal>
  );
}
```

- [ ] **Step 2: Page-Mutationen + Modal-State**

In `AuftraegePage.tsx` (Imports `setzeVollzug`, `nimmAb`, `VollzugMeldenModal`, `useState`):

```tsx
  const [vollzugFuer, setVollzugFuer] = useState<number | null>(null);
  const vollzugMutation = useMutation({
    mutationFn: ({ auftragId, status, text }: { auftragId: number; status: 'in_arbeit' | 'vollzogen'; text?: string }) =>
      setzeVollzug(einsatzId, auftragId, status, text),
    onSuccess: () => { invalidiere(); setVollzugFuer(null); }, onError: fehler,
  });
  const abnahmeMutation = useMutation({
    mutationFn: (auftragId: number) => nimmAb(einsatzId, auftragId),
    onSuccess: invalidiere, onError: fehler,
  });
```
An `AuftragListe` zusätzliche Callbacks reichen:
```tsx
            onInArbeit={(id) => vollzugMutation.mutate({ auftragId: id, status: 'in_arbeit' })}
            onVollzugMelden={(id) => setVollzugFuer(id)}
            onAbnehmen={(id) => abnahmeMutation.mutate(id)}
```
Und das Modal rendern:
```tsx
      <VollzugMeldenModal
        offen={vollzugFuer !== null}
        onAbbrechen={() => setVollzugFuer(null)}
        onBestaetigen={(text) => vollzugFuer != null && vollzugMutation.mutate({ auftragId: vollzugFuer, status: 'vollzogen', text })}
      />
```

- [ ] **Step 3: Aktions-Buttons in `AuftragListe.tsx`**

Props ergänzen (`onInArbeit`, `onVollzugMelden`, `onAbnehmen`), und im `actions`-Slot je nach Status anbieten:
- `offen` → „In Bearbeitung" (`onInArbeit`)
- `offen`/`in_arbeit` → „Vollzug melden" (`onVollzugMelden`)
- `vollzogen` → „Abnehmen" (`onAbnehmen`)
Alle nur bei `darfSchreiben`.

```tsx
        actions={darfSchreiben ? [
          a.bearbeitungsstatus === 'offen' && onInArbeit ? <a key="ia" onClick={() => onInArbeit(a.id)}>In Bearbeitung</a> : null,
          (a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit') && onVollzugMelden ? <a key="vm" onClick={() => onVollzugMelden(a.id)}>Vollzug melden</a> : null,
          a.bearbeitungsstatus === 'vollzogen' && onAbnehmen ? <a key="ab" onClick={() => onAbnehmen(a.id)}>Abnehmen</a> : null,
        ].filter(Boolean) as React.ReactNode[] : undefined}
```

- [ ] **Step 4: Test ergänzen + Vollzugsmeldung anzeigen**

In `AuftraegePage.test.tsx` einen Test „Vollzug melden öffnet Modal und ruft setzeVollzug". `vi.mock('../api/auftraege')` um `setzeVollzug`, `nimmAb` erweitern.

- [ ] **Step 5: Tests + Build**

Run: `cd frontend && pnpm test -- --no-file-parallelism src/pages/AuftraegePage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/auftraege/ frontend/src/pages/AuftraegePage.tsx frontend/src/pages/AuftraegePage.test.tsx
git commit -m "feat(auftrag): Vollzug/Abnahme-Aktionen + Vollzugsmeldungs-Modal (LFH-91)"
```

---

# Phase D — Board-Filter, Frist-Überwachung & optionaler Nachfass (LFH-92)

### Task D1: Board-Filter (Status/Empfänger) im Frontend

**Files:**
- Modify: `frontend/src/pages/AuftraegePage.tsx` (Filter-State + Query-Key + Segmented/Select)
- Modify: `frontend/src/pages/AuftraegePage.test.tsx`

> Backend-seitig sind Status- und Empfänger-Filter bereits in `listeAuftraege`/`repo::liste` (Task A6/A5) umgesetzt.

- [ ] **Step 1: Filter-UI + parametrisierte Query**

```tsx
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const auftraegeQuery = useQuery({
    queryKey: ['einsatz-auftraege', einsatzId, statusFilter ?? 'alle'],
    queryFn: () => listeAuftraege(einsatzId, { status: statusFilter }),
  });
```
Über der Liste ein `Segmented` (Alle/Offen/In Bearbeitung/Vollzogen/Abgenommen), das `statusFilter` setzt (`undefined` für „Alle").

> Hinweis: Der Live-Hook invalidiert `['einsatz-auftraege', einsatzId]` (Prefix) — react-query invalidiert per Prefix-Match auch die status-spezifischen Keys.

- [ ] **Step 2: Test „Filter Offen ruft listeAuftraege mit status='offen'"**

```tsx
  it('filtert nach Status', async () => {
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('Offen'));
    await waitFor(() => expect(listeAuftraege).toHaveBeenCalledWith(1, { status: 'offen' }));
  });
```

- [ ] **Step 3: Tests + Build**

Run: `cd frontend && pnpm test -- --no-file-parallelism src/pages/AuftraegePage.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AuftraegePage.tsx frontend/src/pages/AuftraegePage.test.tsx
git commit -m "feat(auftrag): Board-Statusfilter (LFH-92)"
```

---

### Task D2: Lage-Dashboard-Kachel auf echte Daten

**Files:**
- Modify: `frontend/src/pages/lage-dashboard/AuftraegeKachel.tsx`

- [ ] **Step 1: Kachel auf `listeAuftraege` umstellen**

Empty-Platzhalter ersetzen durch eine `useQuery(['einsatz-auftraege', einsatzId], () => listeAuftraege(einsatzId))`, die offene/überfällige Aufträge zählt und als Kennzahl + ggf. roten Hinweis bei `ist_ueberfaellig` zeigt. Klick → `navigate('/einsaetze/:id/auftraege')`.

- [ ] **Step 2: Build/Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: keine Fehler. (Falls ein bestehender Kachel-Test existiert, mit anpassen.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/lage-dashboard/AuftraegeKachel.tsx
git commit -m "feat(auftrag): Lage-Dashboard-Kachel zeigt echte Auftragslage (LFH-92)"
```

---

### Task D3 (optional): Auto-Nachfass über Erinnerungs-Modul + Schließ-Gegenpart

**Files:**
- Modify: `src/erinnerung/repo.rs` (`schliesse_by_bezug`)
- Modify: `src/auftrag/repo.rs` (Aufruf `anlegen_aus_frist` beim Anlegen mit Frist; `schliesse_by_bezug` bei voller Quittung/Vollzug)

> Laut Task explizit **optional** („Verknüpfung zu Erinnerungen-Modul"). Nur umsetzen, wenn Phasen A–D2 grün und Zeit vorhanden.

- [ ] **Step 1: `schliesse_by_bezug` (Erinnerung) — Failing test + Impl**

In `src/erinnerung/repo.rs`:
```rust
/// Schließt offene Auto-Erinnerungen eines Bezugs (gibt den Idempotenz-Slot frei).
pub async fn schliesse_by_bezug(pool: &SqlitePool, bezug_typ: &str, bezug_id: i64, jetzt: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE erinnerung SET status = 'erledigt', erledigt_at = ? \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = ? AND bezug_id = ?",
    )
    .bind(jetzt).bind(bezug_typ).bind(bezug_id)
    .execute(pool).await?;
    Ok(())
}
```
Test: `anlegen_aus_frist` → `schliesse_by_bezug` → erneutes `anlegen_aus_frist` legt wieder neu an (Slot frei).

- [ ] **Step 2: Im Auftrags-Anlegen mit Frist eine Nachfass-Erinnerung erzeugen**

In `repo::anlegen` (nach Commit, mit `frist_at`): `erinnerung::repo::anlegen_aus_frist(pool, einsatz_id, ersteller_id, "auftrag", auftrag_id, &format!("Nachfass: Auftrag unquittiert – {}", text-kurz), frist_at, jetzt)`.

- [ ] **Step 3: Bei voller Quittung bzw. Vollzug schließen**

Im Quittier-Handler (Phase B) bzw. Vollzug-Handler (Phase C): wenn `quittiert_anzahl == empfaenger_anzahl` oder Vollzug `vollzogen`, `erinnerung::repo::schliesse_by_bezug(pool, "auftrag", auftrag_id, jetzt)` aufrufen.

- [ ] **Step 4: Tests (Repo + Integration) + Commit**

```bash
git add src/erinnerung/repo.rs src/auftrag/repo.rs src/routes/auftrag.rs
git commit -m "feat(auftrag): optionaler Auto-Nachfass via Erinnerung + Schließ-Gegenpart (LFH-92)"
```

---

## Abschluss-Gate (vor „fertig")

- [ ] Backend gesamt: `rtk proxy cargo test` → grün
- [ ] Frontend gesamt: `cd frontend && pnpm test -- --no-file-parallelism` → grün
- [ ] `cd frontend && pnpm typecheck` → keine Fehler
- [ ] `cd frontend && pnpm build` und `rtk proxy cargo build` → grün (rust-embed-Bundle aktuell)
- [ ] Clippy: `rtk proxy cargo clippy --all-targets` → keine neuen Warnungen
- [ ] Manuelle Sicht: Modul „Aufträge/Befehle" erscheint unter Kommunikation; Anlegen erzeugt ETB-Anordnung; Quittieren ändert nur Quittung; Vollzug erzeugt ETB-Meldung; überfällige Aufträge sind rot markiert.

## Self-Review-Notizen

- **Spec-Abdeckung:** Alle Akzeptanzkriterien sind in der Mapping-Tabelle einer Task zugeordnet.
- **Typkonsistenz:** Backend `bearbeitungsstatus`/`vollzug_status`/`prioritaet` ⇄ Frontend `AuftragBearbeitungsstatus`/`vollzug_status`/`AuftragPrioritaet`. API-Pfade in `auftraege.ts` ⇄ `app.rs`-Routen identisch.
- **Offene Annahme zu prüfen:** `AppError::UnprocessableEntity(String)`-Konstruktor (Task C2) — vor Implementierung an `src/error.rs` verifizieren; alternativ `AppError::Validation` (400) für „Abnahme vor Vollzug", falls 422-Variante anders heißt.
