# E‑5 Schäden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein einsatz-scoped Schäden-Modul (Sach-/Infrastruktur-/Umweltschäden inkl. Tierkadaver + Verkehrshindernisse) mit Bearbeitungs-Workflow (`offen → uebergeben → abgeschlossen`), pseudonymer ETB-Spur, SSE-Live und Frontend, das das E‑1/E‑4-Pattern wiederverwendet.

**Architecture:** Rust-Backend (axum 0.8 + sqlx/SQLite) mit Modul `src/schaden/` (Modell + Repo), Routen `src/routes/einsatz_schaden.rs` unter `/api/einsaetze/{id}/schaeden`, Migration `0032_einsatz_schaden.sql`. Status-Maschine über zwei dedizierte Aktions-Routen (`/uebergeben`, `/abschliessen`). React/TypeScript-Frontend (Ant Design + React-Query + SSE) mit `SchaedenPage`, API-Client, Stream-Hook und einem lesenden Cross-Modul-Block im Personen-Drawer.

**Tech Stack:** Rust, axum 0.8, sqlx (SQLite, async, `:memory:` für Tests), tokio; React 18, TypeScript, Ant Design (`antd`), `@tanstack/react-query`, EventSource/SSE; Tests: `cargo test` (tower `oneshot`-Harness) + Vitest/@testing-library/MSW. Pass/Fail-Gates über `rtk proxy <cmd>` (der rtk-Hook maskiert sonst Exit-Codes).

---

## Architektur-Entscheidungen (gegenüber der E‑4-Tier-Vorlage — bewusst abweichend)

Dieses Modul kopiert das Tier-Pattern, **überschreibt** es aber an genau diesen Stellen. Beim Umsetzen jeder Task gegenprüfen:

1. **Status-Maschine ist invers zu Tier.** Erlaubt: `offen→uebergeben`, `offen→abgeschlossen`, `uebergeben→abgeschlossen`. **Keine** Rückwärts-Übergänge, `abgeschlossen` ist terminal. (Tier erlaubt Rückwärts-Übergänge.)
2. **Zwei dedizierte Aktions-Routen** statt Tiers generischer `/status`-Route: `POST …/uebergeben {uebergeben_an}` und `POST …/abschliessen {abschluss_grund, notiz?}`. Jede mit eigener Repo-Funktion (`uebergebe`, `schliesse_ab`).
3. **Falscher Quell-Status der Aktions-Routen → 409** (Conflict), **nicht** 422. Fehlendes Pflichtfeld → 422.
4. **`storniert_von` existiert** (Tier hat nur `storniert_at`). `storniere()` muss `storniert_von` setzen, sonst ist die Spalte tot.
5. **PATCH-Effektivzustand prüft DREI Mehrspalten-CHECKs**, nicht nur einen: Geschädigt-XOR **plus** „status='uebergeben' ⇒ uebergeben_an NOT NULL" **plus** „status='abgeschlossen' ⇒ abschluss_grund NOT NULL". Der PATCH-Handler merged gegen den Bestandswert und liefert 422 (nie 500 durch DB-CHECK).
6. **`abschliessen` hängt optionale `notiz` mit Zeitstempel an `beschreibung` an** (im selben UPDATE). Die Notiz darf **nicht** in den ETB-Eintrag.
7. **`liste` hat reichere Filter** inkl. `inkl_storniert` (Tier blendet storniert immer aus). Der Personen-Cross-Block ruft `inkl_storniert=false`.
8. **Alle Feld-Validierungen sind 422** (kein 400 in diesem Modul); alle Zustands-Konflikte 409. (Tier nutzte teils 400.)
9. **ETB enthält den Ort** (Lagebild-relevant), aber **nie** Geschädigt-Bezug, `beschreibung` oder `notiz`. (Bewusste Abweichung von E‑4-Strenge, Spec-Annahme 11.)
10. **Geschädigt-Modell** = `geschaedigt_person_id` (FK) XOR `geschaedigt_kontakt` (Freitext), symmetrisch zum E‑4-Halter. Read-only-Join-Felder `geschaedigt_registrier_nr` + `geschaedigt_storniert_at`.

**Wichtig — `berechtigung.rs` NICHT anfassen.** Die mögliche Cross-Org-Lesezugriff-Lücke über `ist_hoehere_berechtigung` ist querschnittlich und außerhalb dieser Spec. Task 9 **pinnt** das aktuelle Verhalten per benannter Tests (es behebt es nicht).

---

## File Structure

**Backend (neu):**
- `migrations/0032_einsatz_schaden.sql` — Schaden-Entity, Status-Maschine-CHECKs, Geschädigt-XOR, Soft-Delete. Eine Verantwortung: Schema.
- `src/schaden/mod.rs` — Domänen-Modell: Enums (`SchadenStatus`, `SchadenTyp`, `Ausmass`, `AbschlussGrund`), `darf_uebergehen`, `registrier_anzeige`, `ort_kurz`, DTO `SchadenAnzeige`, Unit-Tests.
- `src/schaden/repo.rs` — DB-Zugriff: `liste/laden/anlegen/aktualisiere/uebergebe/schliesse_ab/storniere`, DTOs `NeueDaten`/`PatchDaten`, Repo-Unit-Tests.
- `src/routes/einsatz_schaden.rs` — HTTP-Handler + ETB/SSE-Helfer + Request-DTOs.
- `tests/einsatz_schaden.rs` — HTTP-Integrationstests (CRUD, Status, Rechte, Org-Isolation, ETB-Leak).

**Backend (geändert):**
- `src/lib.rs` — `pub mod schaden;` registrieren.
- `src/routes/mod.rs` — `pub mod einsatz_schaden;` registrieren.
- `src/app.rs` — 8 Routen unter `/api/einsaetze/{id}/schaeden` montieren.

**Frontend (neu):**
- `frontend/src/api/einsatzSchaden.ts` — API-Client.
- `frontend/src/etb/useSchaedenStream.ts` — SSE-Hook.
- `frontend/src/pages/SchaedenPage.tsx` — Liste, Filter, Detail-Drawer, Schnellerfassung, Übergabe-/Abschluss-Modals.
- `frontend/src/pages/SchaedenPage.test.tsx` — Komponenten-Tests.

**Frontend (geändert):**
- `frontend/src/api/types.ts` — `Schaden`-Typen.
- `frontend/src/einsatz/modulRegistry.ts` — Stub `sachschaeden` → `schaeden`, `status: 'fertig'`.
- `frontend/src/App.tsx` — Import + `MODUL_ELEMENTE['schaeden']`.
- `frontend/src/pages/PersonenPage.tsx` — Block „Als Geschädigte bei Schäden".

**Doku (geändert):**
- `docs/superpowers/PROGRESS.md` — E‑5-Zeile auf ✅ DONE.

---

## Task 0: Pre-Flight — Bestands-Schemata verifizieren (kein Commit)

Mehrere Test-Helfer legen Org/Benutzer/Einsatz/Person per rohem SQL an, mit **angenommenen** Spalten. Weil die Tasks TDD-getrieben sind, würde eine falsche Spalte den „Test soll fehlschlagen"-Schritt mit `no such column: …` zum Fehlschlag bringen — was wie der erwartete Fail *aussieht*, sodass der spätere „grün"-Schritt verwirrend scheitert. Diese Annahmen einmal vorab klären.

- [ ] **Step 1: Basis-Tabellen-Schemata lesen**

Run: `rtk proxy cat migrations/0001*.sql migrations/0002*.sql migrations/0006*.sql migrations/0020_einsatz_person.sql`
(bzw. die Migrationen, die `organisation`, `benutzer`, `einsatz`, `einsatz_person` definieren).

Festhalten und in den Helfern aus Task 1/3/5/6/7 abgleichen:
- `organisation`: echte NOT-NULL-Pflichtspalten (Plan nutzt nur `name`).
- `benutzer`: Pflichtspalten + erlaubte `system_rolle`/`org_rolle`-CHECK-Werte (Plan nutzt `organisation_id, anzeigename, benutzername, passwort_hash, system_rolle='benutzer', org_rolle='keine'`).
- `einsatz`: Pflichtspalten (Plan nutzt `bezeichnung, status='aktiv', erstellt_von`).
- `einsatz_person`: Pflichtspalten + erlaubte `status`-CHECK-Werte (Plan nutzt `einsatz_id, registrier_nr, status='betroffen', erfasst_von, geaendert_von`).

Falls Abweichungen: die `schaden_setup`/`setup`-Helfer und den `einsatz_person`-Insert in Task 1/3 entsprechend korrigieren, bevor diese Tasks umgesetzt werden.

- [ ] **Step 2: `bootstrap_admin`-Idempotenz für Task 7 klären**

Run: `rtk proxy rg -n "pub async fn bootstrap_admin" -A 40 src/auth/bootstrap.rs`

Prüfen, ob ein **zweiter** Aufruf mit anderem Org-Namen (`bootstrap_admin(&pool, "Fremd-Orga", …)`) sauber durchläuft oder an einer nicht-org-scoped UNIQUE (z. B. globale FMS-/Status-Katalog-Seeds) scheitert.
- Läuft er sauber → Task 7 bleibt wie geschrieben.
- Scheitert er → in Task 7 die zweite Org + deren Benutzer per rohem SQL anlegen (Muster wie `schaden_setup`), statt `bootstrap_admin` ein zweites Mal aufzurufen.

> Keine Datei-Änderung, kein Commit — reine Verifikation. Erkenntnisse fließen in Task 1/3/7 ein.

---

## Task 1: Migration `0032_einsatz_schaden.sql` + Constraint-Tests

**Files:**
- Create: `migrations/0032_einsatz_schaden.sql`
- Test: `src/db.rs` (neuer `#[tokio::test]` im bestehenden `#[cfg(test)] mod tests`-Block am Dateiende)

Constraint-Tests testen direkt gegen `db::test_pool()` (In-Memory-SQLite, spielt alle Migrationen ein) per rohem SQL — exakt das Muster, das bei Tier in `src/db.rs` liegt.

- [ ] **Step 1: Constraint-Tests schreiben**

In `src/db.rs`, im bestehenden `#[cfg(test)] mod tests { ... }`-Block am Dateiende, diese Tests ergänzen. Falls dort schon eine Helfer-Funktion existiert, die Org/Benutzer/Einsatz per SQL anlegt, diese nutzen; andernfalls die hier gezeigte lokale `schaden_setup` verwenden.

```rust
// --- E-5 Schaden: Constraints ---

/// Legt Org, Benutzer, Einsatz per rohem SQL an und gibt (benutzer_id, einsatz_id) zurück.
async fn schaden_setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
    sqlx::query("INSERT INTO organisation (name) VALUES ('O')")
        .execute(pool).await.unwrap();
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (organisation_id, anzeigename, benutzername, passwort_hash, \
            system_rolle, org_rolle) \
         VALUES (1, 'A', 'a', 'x', 'benutzer', 'keine') RETURNING id")
        .fetch_one(pool).await.unwrap();
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (bezeichnung, status, erstellt_von) \
         VALUES ('L', 'aktiv', ?) RETURNING id")
        .bind(benutzer_id).fetch_one(pool).await.unwrap();
    (benutzer_id, einsatz_id)
}

async fn schaden_insert_min(
    pool: &sqlx::SqlitePool, einsatz_id: i64, benutzer_id: i64, extra_spalten: &str, extra_werte: &str,
) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
    let sql = format!(
        "INSERT INTO einsatz_schaden \
            (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von{extra_spalten}) \
         VALUES ({einsatz_id}, 1, 'sachschaden', 'gering', 'Hauptstr. 1', {benutzer_id}, {benutzer_id}{extra_werte})"
    );
    sqlx::query(&sql).execute(pool).await
}

#[tokio::test]
async fn schaden_minimal_insert_ok() {
    let pool = test_pool().await;
    let (b, e) = schaden_setup(&pool).await;
    schaden_insert_min(&pool, e, b, "", "").await.expect("Minimal-Insert muss gehen");
}

#[tokio::test]
async fn schaden_geschaedigt_xor_check() {
    let pool = test_pool().await;
    let (b, e) = schaden_setup(&pool).await;
    // Eine Person anlegen, damit der FK gültig ist.
    let p: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
        .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
    let res = schaden_insert_min(
        &pool, e, b, ", geschaedigt_person_id, geschaedigt_kontakt",
        &format!(", {p}, 'Herr Meier'")).await;
    assert!(res.is_err(), "FK UND Freitext gleichzeitig muss vom CHECK abgelehnt werden");
}

#[tokio::test]
async fn schaden_status_uebergeben_braucht_adressat() {
    let pool = test_pool().await;
    let (b, e) = schaden_setup(&pool).await;
    let res = schaden_insert_min(&pool, e, b, ", status", ", 'uebergeben'").await;
    assert!(res.is_err(), "status='uebergeben' ohne uebergeben_an muss CHECK verletzen");
}

#[tokio::test]
async fn schaden_status_abgeschlossen_braucht_grund() {
    let pool = test_pool().await;
    let (b, e) = schaden_setup(&pool).await;
    let res = schaden_insert_min(&pool, e, b, ", status", ", 'abgeschlossen'").await;
    assert!(res.is_err(), "status='abgeschlossen' ohne abschluss_grund muss CHECK verletzen");
}

#[tokio::test]
async fn schaden_registrier_nr_unique_je_einsatz() {
    let pool = test_pool().await;
    let (b, e) = schaden_setup(&pool).await;
    schaden_insert_min(&pool, e, b, "", "").await.unwrap();
    let res = schaden_insert_min(&pool, e, b, "", "").await; // erneut registrier_nr=1
    assert!(res.is_err(), "UNIQUE(einsatz_id, registrier_nr) muss greifen");
}
```

> **Hinweis:** Die Spalten in `schaden_setup` (`organisation.name`, `benutzer.*`, `einsatz.*`) an die echten Pflichtspalten dieser Tabellen anpassen — die genauen NOT-NULL-Spalten ergeben sich aus den Migrationen `0001`–`0006`. Beim ersten Lauf zeigt ein NOT-NULL-Fehler, welche Spalte fehlt; ergänzen.

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `rtk proxy cargo test --lib db::tests::schaden`
Expected: FAIL — Kompilier- bzw. Laufzeitfehler, weil die Tabelle `einsatz_schaden` noch nicht existiert (`no such table: einsatz_schaden`).

- [ ] **Step 3: Migration schreiben**

`migrations/0032_einsatz_schaden.sql`:

```sql
-- E‑5: Einsatz-scoped Schadens-Entity (Sach-/Infrastruktur-/Umweltschäden inkl.
-- Tierkadaver + Verkehrshindernisse). Schaden ist Arbeitsauftrag: Status-Maschine
-- offen → uebergeben → abgeschlossen. Geschädigter als FK XOR Freitext (beides NULL =
-- unbekannt/öffentlich). Soft-Delete via storniert_at (kein Hard-Delete). Kein
-- Lese-Audit (keine DSGVO-besondere Kategorie). Koordinaten → T4 (ort als Freitext).
CREATE TABLE einsatz_schaden (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id               INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr            INTEGER NOT NULL,                  -- fortlaufend je Einsatz, server-autoritativ
    status                   TEXT    NOT NULL DEFAULT 'offen'
                             CHECK (status IN ('offen','uebergeben','abgeschlossen')),

    -- Klassifikation
    typ                      TEXT    NOT NULL
                             CHECK (typ IN ('sachschaden','verkehrshindernis','infrastruktur',
                                            'umweltschaden','tierkadaver','sonstige')),
    ausmass                  TEXT    NOT NULL
                             CHECK (ausmass IN ('gering','mittel','gross','katastrophal')),

    -- Ort + Beschreibung
    ort                      TEXT    NOT NULL,                  -- Freitext; Koordinaten → T4
    beschreibung             TEXT    NOT NULL DEFAULT '',       -- editierbar; Verlauf liefert ETB

    -- Geschädigter (FK XOR Freitext; beides NULL = unbekannt/öffentlich)
    geschaedigt_person_id    INTEGER REFERENCES einsatz_person(id),
    geschaedigt_kontakt      TEXT,

    -- Übergabe (gefüllt beim Übergang → uebergeben)
    uebergeben_an            TEXT,                              -- Freitext-Adressat (Bauhof, Stadtwerke, …)
    uebergeben_at            TEXT,                              -- ISO-Zeit beim Übergang

    -- Abschluss (gefüllt beim Übergang → abgeschlossen)
    abschluss_grund          TEXT
                             CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                                    ('behoben','kein_handlungsbedarf','abgewiesen')),
    abschluss_at             TEXT,

    -- Meta / Audit
    erfasst_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von              INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von            INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at             TEXT,                              -- Soft-Delete (Fehleingabe); kein Hard-Delete
    storniert_von            INTEGER REFERENCES benutzer(id),

    UNIQUE (einsatz_id, registrier_nr),

    -- Geschädigt FK XOR Freitext
    CHECK (geschaedigt_person_id IS NULL OR geschaedigt_kontakt IS NULL),

    -- Status-Pflichtfelder (Effektivzustand)
    CHECK (status <> 'uebergeben'    OR uebergeben_an   IS NOT NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_schaden_einsatz      ON einsatz_schaden (einsatz_id, status);
CREATE INDEX idx_einsatz_schaden_geschaedigt  ON einsatz_schaden (geschaedigt_person_id)
    WHERE geschaedigt_person_id IS NOT NULL;
CREATE INDEX idx_einsatz_schaden_offen        ON einsatz_schaden (einsatz_id)
    WHERE status <> 'abgeschlossen' AND storniert_at IS NULL;
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `rtk proxy cargo test --lib db::tests::schaden`
Expected: PASS — alle fünf `schaden_*`-Constraint-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add migrations/0032_einsatz_schaden.sql src/db.rs
git commit -m "feat(be): E-5 Schaden-Migration 0032 + Constraint-Tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `src/schaden/mod.rs` — Domänen-Modell + Unit-Tests

**Files:**
- Create: `src/schaden/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)

- [ ] **Step 1: Modul registrieren**

In `src/lib.rs` zwischen `pub mod routes;` (Zeile 19) und `pub mod staerke;` (Zeile 20) einfügen — alphabetische Einordnung:

```rust
pub mod schaden;
```

- [ ] **Step 2: `src/schaden/mod.rs` mit Modell + Tests schreiben**

```rust
pub mod repo;

use serde::Serialize;

// ---------- Status ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SchadenStatus {
    Offen,
    Uebergeben,
    Abgeschlossen,
}

impl SchadenStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenStatus::Offen => "offen",
            SchadenStatus::Uebergeben => "uebergeben",
            SchadenStatus::Abgeschlossen => "abgeschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenStatus> {
        match s {
            "offen" => Some(SchadenStatus::Offen),
            "uebergeben" => Some(SchadenStatus::Uebergeben),
            "abgeschlossen" => Some(SchadenStatus::Abgeschlossen),
            _ => None,
        }
    }
}

// ---------- Typ ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SchadenTyp {
    Sachschaden,
    Verkehrshindernis,
    Infrastruktur,
    Umweltschaden,
    Tierkadaver,
    Sonstige,
}

impl SchadenTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenTyp::Sachschaden => "sachschaden",
            SchadenTyp::Verkehrshindernis => "verkehrshindernis",
            SchadenTyp::Infrastruktur => "infrastruktur",
            SchadenTyp::Umweltschaden => "umweltschaden",
            SchadenTyp::Tierkadaver => "tierkadaver",
            SchadenTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenTyp> {
        match s {
            "sachschaden" => Some(SchadenTyp::Sachschaden),
            "verkehrshindernis" => Some(SchadenTyp::Verkehrshindernis),
            "infrastruktur" => Some(SchadenTyp::Infrastruktur),
            "umweltschaden" => Some(SchadenTyp::Umweltschaden),
            "tierkadaver" => Some(SchadenTyp::Tierkadaver),
            "sonstige" => Some(SchadenTyp::Sonstige),
            _ => None,
        }
    }
}

// ---------- Ausmaß ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Ausmass {
    Gering,
    Mittel,
    Gross,
    Katastrophal,
}

impl Ausmass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Ausmass::Gering => "gering",
            Ausmass::Mittel => "mittel",
            Ausmass::Gross => "gross",
            Ausmass::Katastrophal => "katastrophal",
        }
    }

    pub fn parse(s: &str) -> Option<Ausmass> {
        match s {
            "gering" => Some(Ausmass::Gering),
            "mittel" => Some(Ausmass::Mittel),
            "gross" => Some(Ausmass::Gross),
            "katastrophal" => Some(Ausmass::Katastrophal),
            _ => None,
        }
    }
}

// ---------- Abschlussgrund ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbschlussGrund {
    Behoben,
    KeinHandlungsbedarf,
    Abgewiesen,
}

impl AbschlussGrund {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschlussGrund::Behoben => "behoben",
            AbschlussGrund::KeinHandlungsbedarf => "kein_handlungsbedarf",
            AbschlussGrund::Abgewiesen => "abgewiesen",
        }
    }

    pub fn parse(s: &str) -> Option<AbschlussGrund> {
        match s {
            "behoben" => Some(AbschlussGrund::Behoben),
            "kein_handlungsbedarf" => Some(AbschlussGrund::KeinHandlungsbedarf),
            "abgewiesen" => Some(AbschlussGrund::Abgewiesen),
            _ => None,
        }
    }
}

// ---------- Status-Übergänge ----------

/// Erlaubte Status-Übergänge der Schaden-Maschine. Keine Rückwärts-Übergänge,
/// `abgeschlossen` ist terminal. Fehleingaben werden storniert, nicht zurückgerollt.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use SchadenStatus::*;
    let (Some(von), Some(nach)) = (SchadenStatus::parse(von), SchadenStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Offen => matches!(nach, Uebergeben | Abgeschlossen),
        Uebergeben => matches!(nach, Abgeschlossen),
        Abgeschlossen => false,
    }
}

/// Anzeige der Registriernummer: `S-007`.
pub fn registrier_anzeige(nr: i64) -> String {
    format!("S-{nr:03}")
}

/// Ort-Kurzform für die pseudonyme ETB-Spur (max. 40 Zeichen, char-sicher).
pub fn ort_kurz(ort: &str) -> String {
    let mut kurz: String = ort.trim().chars().take(40).collect();
    if ort.trim().chars().count() > 40 {
        kurz.push('…');
    }
    kurz
}

// ---------- Anzeige-DTO ----------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SchadenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: String,
    pub typ: String,
    pub ausmass: String,
    pub ort: String,
    pub beschreibung: String,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub uebergeben_an: Option<String>,
    pub uebergeben_at: Option<String>,
    pub abschluss_grund: Option<String>,
    pub abschluss_at: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    pub storniert_von: Option<i64>,
    // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_person):
    pub geschaedigt_registrier_nr: Option<i64>,
    pub geschaedigt_storniert_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["offen", "uebergeben", "abgeschlossen"] {
            assert_eq!(SchadenStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(SchadenStatus::parse("quatsch").is_none());
    }

    #[test]
    fn typ_und_ausmass_roundtrip() {
        for s in ["sachschaden", "verkehrshindernis", "infrastruktur", "umweltschaden", "tierkadaver", "sonstige"] {
            assert_eq!(SchadenTyp::parse(s).unwrap().as_str(), s);
        }
        for s in ["gering", "mittel", "gross", "katastrophal"] {
            assert_eq!(Ausmass::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn abschlussgrund_roundtrip() {
        for s in ["behoben", "kein_handlungsbedarf", "abgewiesen"] {
            assert_eq!(AbschlussGrund::parse(s).unwrap().as_str(), s);
        }
        assert!(AbschlussGrund::parse("uebergabe").is_none());
    }

    #[test]
    fn uebergaenge_vorwaerts_erlaubt() {
        assert!(darf_uebergehen("offen", "uebergeben"));
        assert!(darf_uebergehen("offen", "abgeschlossen"));
        assert!(darf_uebergehen("uebergeben", "abgeschlossen"));
    }

    #[test]
    fn uebergaenge_rueckwaerts_und_terminal_verboten() {
        assert!(!darf_uebergehen("uebergeben", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "uebergeben"));
        assert!(!darf_uebergehen("offen", "offen"));
        assert!(!darf_uebergehen("quatsch", "offen"));
    }

    #[test]
    fn registrier_und_ort_kurz() {
        assert_eq!(registrier_anzeige(7), "S-007");
        assert_eq!(registrier_anzeige(123), "S-123");
        assert_eq!(ort_kurz("Hauptstr. 17"), "Hauptstr. 17");
        let lang = "A".repeat(50);
        assert_eq!(ort_kurz(&lang).chars().count(), 41); // 40 + Ellipsis
    }
}
```

- [ ] **Step 3: Tests laufen lassen — müssen grün sein**

Run: `rtk proxy cargo test --lib schaden::tests`
Expected: PASS — alle sechs Unit-Tests grün.

> **Hinweis:** `repo` ist in `mod.rs` als `pub mod repo;` deklariert, aber die Datei existiert noch nicht — `cargo` schlägt mit `file not found for module repo` fehl. Lege in diesem Schritt eine leere `src/schaden/repo.rs` an (`// folgt in Task 3`), damit Task 2 isoliert kompiliert.

- [ ] **Step 4: Commit**

```bash
git add src/lib.rs src/schaden/mod.rs src/schaden/repo.rs
git commit -m "feat(be): E-5 Schaden-Domänenmodell (Enums, Status-Maschine, DTO)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `src/schaden/repo.rs` — DB-Zugriff + Repo-Unit-Tests

**Files:**
- Create/Replace: `src/schaden/repo.rs`

- [ ] **Step 1: Repo-Unit-Tests schreiben**

`src/schaden/repo.rs` mit folgendem Test-Block beginnen (Implementierung folgt in Step 3). Das Test-Setup legt Org/Benutzer/Einsatz per rohem SQL an — Muster aus `src/tier/repo.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    async fn setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (name) VALUES ('O')").execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (organisation_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle) VALUES (1,'A','a','x','benutzer','keine') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (bezeichnung, status, erstellt_von) VALUES ('L','aktiv',?) RETURNING id")
            .bind(b).fetch_one(pool).await.unwrap();
        (b, e)
    }

    fn minimal<'a>() -> NeueDaten<'a> {
        NeueDaten {
            typ: "sachschaden",
            ausmass: "gering",
            ort: "Hauptstr. 1",
            beschreibung: None,
            geschaedigt_person_id: None,
            geschaedigt_kontakt: None,
        }
    }

    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_nr_und_status_offen() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s1 = anlegen(&pool, e, b, minimal()).await.unwrap();
        let s2 = anlegen(&pool, e, b, minimal()).await.unwrap();
        assert_eq!(s1.registrier_nr, 1);
        assert_eq!(s2.registrier_nr, 2);
        assert_eq!(s1.status, "offen");
    }

    #[tokio::test]
    async fn uebergebe_setzt_status_und_zeit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        uebergebe(&pool, e, s.id, "Stadtwerke", b).await.unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert_eq!(neu.status, "uebergeben");
        assert_eq!(neu.uebergeben_an.as_deref(), Some("Stadtwerke"));
        assert!(neu.uebergeben_at.is_some());
    }

    #[tokio::test]
    async fn schliesse_ab_haengt_notiz_an_beschreibung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, NeueDaten { beschreibung: Some("Erstbefund"), ..minimal() })
            .await.unwrap();
        schliesse_ab(&pool, e, s.id, "behoben", Some("vor Ort erledigt"), b).await.unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert_eq!(neu.status, "abgeschlossen");
        assert_eq!(neu.abschluss_grund.as_deref(), Some("behoben"));
        assert!(neu.abschluss_at.is_some());
        assert!(neu.beschreibung.contains("Erstbefund"));
        assert!(neu.beschreibung.contains("vor Ort erledigt"), "Notiz angehängt");
    }

    #[tokio::test]
    async fn storniere_setzt_at_und_von() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        storniere(&pool, e, s.id, b).await.unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert!(neu.storniert_at.is_some());
        assert_eq!(neu.storniert_von, Some(b));
    }

    #[tokio::test]
    async fn liste_blendet_storniert_aus_default_und_zeigt_mit_flag() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        storniere(&pool, e, s.id, b).await.unwrap();
        let ohne = liste(&pool, e, None, None, None, None, false).await.unwrap();
        assert_eq!(ohne.len(), 0, "storniert nicht in Default-Liste");
        let mit = liste(&pool, e, None, None, None, None, true).await.unwrap();
        assert_eq!(mit.len(), 1, "mit inkl_storniert sichtbar");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status_typ_ausmass() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, NeueDaten { typ: "umweltschaden", ausmass: "gross", ..minimal() }).await.unwrap();
        anlegen(&pool, e, b, minimal()).await.unwrap();
        let nur_umwelt = liste(&pool, e, None, Some("umweltschaden"), None, None, false).await.unwrap();
        assert_eq!(nur_umwelt.len(), 1);
        let nur_gross = liste(&pool, e, None, None, Some("gross"), None, false).await.unwrap();
        assert_eq!(nur_gross.len(), 1);
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, minimal()).await.unwrap();
        let res = laden(&pool, 999, s.id).await;
        assert!(matches!(res, Err(AppError::NotFound)));
    }

    #[tokio::test]
    async fn aktualisiere_geschaedigt_toggle() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let s = anlegen(&pool, e, b, NeueDaten { geschaedigt_kontakt: Some("Herr Meier"), ..minimal() })
            .await.unwrap();
        // Freitext leeren via Some(None):
        aktualisiere(&pool, e, s.id, b, PatchDaten {
            geschaedigt_kontakt: Some(None),
            ..Default::default()
        }).await.unwrap();
        let neu = laden(&pool, e, s.id).await.unwrap();
        assert!(neu.geschaedigt_kontakt.is_none());
    }
}
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `rtk proxy cargo test --lib schaden::repo`
Expected: FAIL — Kompilierfehler (`cannot find function anlegen`, `cannot find type NeueDaten`, …), weil die Repo-Implementierung fehlt.

- [ ] **Step 3: Repo-Implementierung schreiben (oberhalb des Test-Blocks)**

```rust
use super::SchadenAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT s.id, s.einsatz_id, s.registrier_nr, s.status, s.typ, s.ausmass, s.ort, \
           s.beschreibung, s.geschaedigt_person_id, s.geschaedigt_kontakt, \
           s.uebergeben_an, s.uebergeben_at, s.abschluss_grund, s.abschluss_at, \
           s.erfasst_at, s.erfasst_von, s.geaendert_at, s.geaendert_von, \
           s.storniert_at, s.storniert_von, \
           gp.registrier_nr AS geschaedigt_registrier_nr, \
           gp.storniert_at  AS geschaedigt_storniert_at \
    FROM einsatz_schaden s \
    LEFT JOIN einsatz_person gp ON gp.id = s.geschaedigt_person_id \
                               AND gp.einsatz_id = s.einsatz_id";

#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub typ: &'a str,
    pub ausmass: &'a str,
    pub ort: &'a str,
    pub beschreibung: Option<&'a str>,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<&'a str>,
}

#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub typ: Option<&'a str>,
    pub ausmass: Option<&'a str>,
    pub ort: Option<&'a str>,
    pub beschreibung: Option<&'a str>,
    /// `Some(Some(id))` = setzen, `Some(None)` = auf NULL, `None` = unverändert.
    pub geschaedigt_person_id: Option<Option<i64>>,
    pub geschaedigt_kontakt: Option<Option<&'a str>>,
    pub uebergeben_an: Option<Option<&'a str>>,
    pub abschluss_grund: Option<Option<&'a str>>,
}

#[allow(clippy::too_many_arguments)]
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    typ: Option<&str>,
    ausmass: Option<&str>,
    geschaedigt_person_id: Option<i64>,
    inkl_storniert: bool,
) -> Result<Vec<SchadenAnzeige>, AppError> {
    let storno_filter = if inkl_storniert { "" } else { " AND s.storniert_at IS NULL" };
    let sql = format!(
        "{SELECT_ALLE} WHERE s.einsatz_id = ?1{storno_filter} \
         AND (?2 IS NULL OR s.status = ?2) \
         AND (?3 IS NULL OR s.typ = ?3) \
         AND (?4 IS NULL OR s.ausmass = ?4) \
         AND (?5 IS NULL OR s.geschaedigt_person_id = ?5) \
         ORDER BY s.registrier_nr DESC"
    );
    Ok(sqlx::query_as::<_, SchadenAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .bind(typ)
        .bind(ausmass)
        .bind(geschaedigt_person_id)
        .fetch_all(pool)
        .await?)
}

pub async fn laden(pool: &SqlitePool, einsatz_id: i64, schaden_id: i64) -> Result<SchadenAnzeige, AppError> {
    sqlx::query_as::<_, SchadenAnzeige>(&format!("{SELECT_ALLE} WHERE s.id = ? AND s.einsatz_id = ?"))
        .bind(schaden_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<SchadenAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_schaden \
            (einsatz_id, registrier_nr, status, typ, ausmass, ort, beschreibung, \
             geschaedigt_person_id, geschaedigt_kontakt, erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, 'offen', ?2, ?3, ?4, \
                COALESCE(?5, ''), ?6, ?7, ?8, ?8 \
         FROM einsatz_schaden WHERE einsatz_id = ?1 \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.typ)
    .bind(daten.ausmass)
    .bind(daten.ort)
    .bind(daten.beschreibung)
    .bind(daten.geschaedigt_person_id)
    .bind(daten.geschaedigt_kontakt)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<SchadenAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_schaden SET \
            typ = COALESCE(?, typ), \
            ausmass = COALESCE(?, ausmass), \
            ort = COALESCE(?, ort), \
            beschreibung = COALESCE(?, beschreibung), \
            geschaedigt_person_id = CASE WHEN ? THEN ? ELSE geschaedigt_person_id END, \
            geschaedigt_kontakt   = CASE WHEN ? THEN ? ELSE geschaedigt_kontakt END, \
            uebergeben_an   = CASE WHEN ? THEN ? ELSE uebergeben_an END, \
            abschluss_grund = CASE WHEN ? THEN ? ELSE abschluss_grund END, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ)
    .bind(daten.ausmass)
    .bind(daten.ort)
    .bind(daten.beschreibung)
    .bind(daten.geschaedigt_person_id.is_some())
    .bind(daten.geschaedigt_person_id.flatten())
    .bind(daten.geschaedigt_kontakt.is_some())
    .bind(daten.geschaedigt_kontakt.flatten())
    .bind(daten.uebergeben_an.is_some())
    .bind(daten.uebergeben_an.flatten())
    .bind(daten.abschluss_grund.is_some())
    .bind(daten.abschluss_grund.flatten())
    .bind(geaendert_von)
    .bind(schaden_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, schaden_id).await
}

pub async fn uebergebe(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    uebergeben_an: &str,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_schaden SET status = 'uebergeben', uebergeben_an = ?, \
            uebergeben_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(uebergeben_an)
    .bind(geaendert_von)
    .bind(schaden_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub async fn schliesse_ab(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    abschluss_grund: &str,
    notiz: Option<&str>,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = if let Some(notiz) = notiz {
        sqlx::query(
            "UPDATE einsatz_schaden SET status = 'abgeschlossen', abschluss_grund = ?, \
                abschluss_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
                beschreibung = beschreibung || (CASE WHEN beschreibung = '' THEN '' ELSE char(10) END) \
                    || '[' || strftime('%Y-%m-%d %H:%M:%S','now') || '] ' || ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschluss_grund)
        .bind(notiz)
        .bind(geaendert_von)
        .bind(schaden_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE einsatz_schaden SET status = 'abgeschlossen', abschluss_grund = ?, \
                abschluss_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(abschluss_grund)
        .bind(geaendert_von)
        .bind(schaden_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
    };
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    schaden_id: i64,
    storniert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_schaden SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            storniert_von = ?, geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(storniert_von)
    .bind(storniert_von)
    .bind(schaden_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `rtk proxy cargo test --lib schaden::repo`
Expected: PASS — alle acht Repo-Unit-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/schaden/repo.rs
git commit -m "feat(be): E-5 Schaden-Repo (CRUD, Status-Aktionen, Soft-Delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `src/routes/einsatz_schaden.rs` — HTTP-Handler + Montage

**Files:**
- Create: `src/routes/einsatz_schaden.rs`
- Modify: `src/routes/mod.rs` (Modul registrieren)
- Modify: `src/app.rs` (Routen montieren)

Diese Task hat keine eigenen Tests (die HTTP-Tests kommen in Task 9); das Gate ist erfolgreiche Kompilierung. Sie ist groß, aber ein zusammenhängender Handler-Satz.

- [ ] **Step 1: Modul registrieren**

In `src/routes/mod.rs` nach `pub mod einsatz_person;` (alphabetisch) einfügen:

```rust
pub mod einsatz_schaden;
```

- [ ] **Step 2: Handler-Datei `src/routes/einsatz_schaden.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::repo as person_repo; // Org-Isolation der Geschädigt-FK (404 bei fremder Person)
use crate::schaden::{
    darf_uebergehen, ort_kurz, registrier_anzeige, repo as schaden_repo, AbschlussGrund, Ausmass,
    SchadenAnzeige, SchadenTyp,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

// ---------- ETB-/SSE-Helfer ----------

/// Schreibt einen pseudonymen System-ETB-Eintrag und publiziert ihn als `etb`-SSE.
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

/// Publiziert ein `schaden`-SSE-Event ohne sensible Payload (Clients refetchen).
fn sse_schaden(state: &AppState, einsatz_id: i64, schaden_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "schaden_id": schaden_id }).to_string();
    state.live.publiziere_event(einsatz_id, "schaden", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Tri-State-Deserializer: fehlendes Feld → `None`; JSON-`null` → `Some(None)`;
/// Wert → `Some(Some(v))`. Für Geschädigt-/Status-Toggle-Felder im PATCH.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ---------- GET /schaeden (Liste) ----------

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub geschaedigt_person_id: Option<i64>,
    #[serde(default)]
    pub inkl_storniert: bool,
}

pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<SchadenAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if crate::schaden::SchadenStatus::parse(s).is_none() {
            return Err(AppError::UnprocessableEntity("Unbekannter Status im Filter".into()));
        }
    }
    if let Some(t) = &params.typ {
        if SchadenTyp::parse(t).is_none() {
            return Err(AppError::UnprocessableEntity("Unbekannter Typ im Filter".into()));
        }
    }
    if let Some(a) = &params.ausmass {
        if Ausmass::parse(a).is_none() {
            return Err(AppError::UnprocessableEntity("Unbekanntes Ausmaß im Filter".into()));
        }
    }
    Ok(Json(
        schaden_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.typ.as_deref(),
            params.ausmass.as_deref(),
            params.geschaedigt_person_id,
            params.inkl_storniert,
        )
        .await?,
    ))
}

// ---------- POST /schaeden (Anlegen) ----------

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
}

pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<SchadenAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Direktes Anlegen nur als 'offen'.
    if let Some(s) = &body.status {
        if s != "offen" {
            return Err(AppError::UnprocessableEntity(
                "Schaden kann nur als 'offen' angelegt werden".into(),
            ));
        }
    }
    let typ = match body.typ.as_deref().and_then(SchadenTyp::parse) {
        Some(t) => t,
        None => return Err(AppError::UnprocessableEntity("Typ fehlt oder ist ungültig".into())),
    };
    let ausmass = match body.ausmass.as_deref().and_then(Ausmass::parse) {
        Some(a) => a,
        None => return Err(AppError::UnprocessableEntity("Ausmaß fehlt oder ist ungültig".into())),
    };
    let ort = match trimme(body.ort.clone()) {
        Some(o) => o,
        None => return Err(AppError::UnprocessableEntity("Ort ist Pflicht".into())),
    };
    let kontakt = trimme(body.geschaedigt_kontakt.clone());
    if body.geschaedigt_person_id.is_some() && kontakt.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Geschädigt-FK und Geschädigt-Freitext schließen sich aus".into(),
        ));
    }
    if let Some(pid) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?; // 404 bei fremder/unbekannter Person
    }
    let beschreibung = trimme(body.beschreibung.clone());

    let schaden = schaden_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        schaden_repo::NeueDaten {
            typ: typ.as_str(),
            ausmass: ausmass.as_str(),
            ort: &ort,
            beschreibung: beschreibung.as_deref(),
            geschaedigt_person_id: body.geschaedigt_person_id,
            geschaedigt_kontakt: kontakt.as_deref(),
        },
    )
    .await?;

    let text = format!(
        "Schaden {} angelegt: {} ({}) — {}",
        registrier_anzeige(schaden.registrier_nr),
        typ.as_str(),
        ausmass.as_str(),
        ort_kurz(&ort),
    );
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_schaden(&state, einsatz_id, schaden.id);
    Ok((StatusCode::CREATED, Json(schaden)))
}

// ---------- GET /schaeden/{sid} (Detail) ----------

pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?))
}

// ---------- PATCH /schaeden/{sid} (Stammfelder) ----------

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_person_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub geschaedigt_kontakt: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uebergeben_an: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschluss_grund: Option<Option<String>>,
}

pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Stornierter Schaden kann nicht geändert werden".into()));
    }

    // Enum-Felder validieren, wenn gesetzt.
    if let Some(t) = &body.typ {
        if SchadenTyp::parse(t).is_none() {
            return Err(AppError::UnprocessableEntity("Ungültiger Typ".into()));
        }
    }
    if let Some(a) = &body.ausmass {
        if Ausmass::parse(a).is_none() {
            return Err(AppError::UnprocessableEntity("Ungültiges Ausmaß".into()));
        }
    }
    if let Some(Some(g)) = &body.abschluss_grund {
        if AbschlussGrund::parse(g.trim()).is_none() {
            return Err(AppError::UnprocessableEntity("Ungültiger Abschlussgrund".into()));
        }
    }
    // ort darf, wenn übergeben, nicht leer werden.
    let ort_norm = trimme(body.ort.clone());
    if body.ort.is_some() && ort_norm.is_none() {
        return Err(AppError::UnprocessableEntity("Ort darf nicht leer sein".into()));
    }

    // Normalisierte Bindungen (müssen den `aktualisiere`-Aufruf überleben → eigene `let`s).
    let beschreibung_norm = trimme(body.beschreibung.clone());
    let kontakt_norm: Option<Option<String>> =
        body.geschaedigt_kontakt.map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let uebergeben_an_norm: Option<Option<String>> =
        body.uebergeben_an.map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let abschluss_grund_norm: Option<Option<String>> =
        body.abschluss_grund.map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    // Effektivzustand NACH dem Patch berechnen (drei Mehrspalten-CHECKs) → 422 statt 500.
    let eff_fk: Option<i64> = match body.geschaedigt_person_id {
        Some(opt) => opt,
        None => vorher.geschaedigt_person_id,
    };
    let eff_kontakt: Option<String> = match &kontakt_norm {
        Some(opt) => opt.clone(),
        None => vorher.geschaedigt_kontakt.clone(),
    };
    if eff_fk.is_some() && eff_kontakt.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Geschädigt-FK und Geschädigt-Freitext schließen sich aus".into(),
        ));
    }
    let eff_uebergeben_an: Option<String> = match &uebergeben_an_norm {
        Some(opt) => opt.clone(),
        None => vorher.uebergeben_an.clone(),
    };
    let eff_abschluss_grund: Option<String> = match &abschluss_grund_norm {
        Some(opt) => opt.clone(),
        None => vorher.abschluss_grund.clone(),
    };
    if vorher.status == "uebergeben" && eff_uebergeben_an.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Übergebener Schaden braucht einen Übergabe-Adressaten".into(),
        ));
    }
    if vorher.status == "abgeschlossen" && eff_abschluss_grund.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Abgeschlossener Schaden braucht einen Abschlussgrund".into(),
        ));
    }

    if let Some(Some(pid)) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?; // Org-Isolation → 404
    }

    let schaden = schaden_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        schaden_id,
        benutzer.id,
        schaden_repo::PatchDaten {
            typ: body.typ.as_deref(),
            ausmass: body.ausmass.as_deref(),
            ort: ort_norm.as_deref(),
            beschreibung: beschreibung_norm.as_deref(),
            geschaedigt_person_id: body.geschaedigt_person_id,
            geschaedigt_kontakt: kontakt_norm.as_ref().map(|o| o.as_deref()),
            uebergeben_an: uebergeben_an_norm.as_ref().map(|o| o.as_deref()),
            abschluss_grund: abschluss_grund_norm.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;

    sse_schaden(&state, einsatz_id, schaden_id); // KEIN ETB bei Stammfeld-PATCH
    Ok(Json(schaden))
}

// ---------- POST /schaeden/{sid}/uebergeben ----------

#[derive(Debug, Deserialize)]
pub struct UebergebenBody {
    pub uebergeben_an: Option<String>,
}

pub async fn uebergeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<UebergebenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let adressat = match trimme(body.uebergeben_an.clone()) {
        Some(a) => a,
        None => return Err(AppError::UnprocessableEntity("Übergabe-Adressat ist Pflicht".into())),
    };
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Stornierter Schaden kann nicht übergeben werden".into()));
    }
    if !darf_uebergehen(&vorher.status, "uebergeben") {
        return Err(AppError::Conflict(format!(
            "Schaden im Status '{}' kann nicht übergeben werden",
            vorher.status
        )));
    }

    schaden_repo::uebergebe(&state.pool, einsatz_id, schaden_id, &adressat, benutzer.id).await?;

    let text = format!("Schaden {} übergeben an {}", registrier_anzeige(vorher.registrier_nr), adressat);
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(Json(schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?))
}

// ---------- POST /schaeden/{sid}/abschliessen ----------

#[derive(Debug, Deserialize)]
pub struct AbschliessenBody {
    pub abschluss_grund: Option<String>,
    pub notiz: Option<String>,
}

pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<AbschliessenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let grund = match trimme(body.abschluss_grund.clone()).as_deref().and_then(AbschlussGrund::parse) {
        Some(g) => g,
        None => {
            return Err(AppError::UnprocessableEntity(
                "Abschlussgrund ist Pflicht und muss gültig sein".into(),
            ))
        }
    };
    let notiz = trimme(body.notiz.clone());
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Stornierter Schaden kann nicht abgeschlossen werden".into()));
    }
    if !darf_uebergehen(&vorher.status, "abgeschlossen") {
        return Err(AppError::Conflict(format!(
            "Schaden im Status '{}' kann nicht abgeschlossen werden",
            vorher.status
        )));
    }

    schaden_repo::schliesse_ab(&state.pool, einsatz_id, schaden_id, grund.as_str(), notiz.as_deref(), benutzer.id)
        .await?;

    // ETB: nur Grund — NIE die Notiz oder beschreibung.
    let text = format!("Schaden {} abgeschlossen ({})", registrier_anzeige(vorher.registrier_nr), grund.as_str());
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(Json(schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?))
}

// ---------- DELETE /schaeden/{sid} (Stornieren) ----------

pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Schaden ist bereits storniert".into()));
    }
    schaden_repo::storniere(&state.pool, einsatz_id, schaden_id, benutzer.id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Schaden {} storniert", registrier_anzeige(vorher.registrier_nr)),
    )
    .await?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------- GET /schaeden/stream (SSE) ----------

pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
```

- [ ] **Step 3: Routen in `src/app.rs` montieren**

Den Tier-Block in `src/app.rs` (um Zeile 92–99) als Vorlage nehmen und folgenden Block direkt darunter ergänzen. **Wichtig:** `/stream` muss vor der `{sid}`-Catch-All-Zeile stehen.

```rust
        .route("/api/einsaetze/{id}/schaeden", get(routes::einsatz_schaden::liste))
        .route("/api/einsaetze/{id}/schaeden", post(routes::einsatz_schaden::anlegen))
        .route("/api/einsaetze/{id}/schaeden/stream", get(routes::einsatz_schaden::stream))
        .route("/api/einsaetze/{id}/schaeden/{sid}", get(routes::einsatz_schaden::detail))
        .route("/api/einsaetze/{id}/schaeden/{sid}", patch(routes::einsatz_schaden::aktualisieren))
        .route("/api/einsaetze/{id}/schaeden/{sid}/uebergeben", post(routes::einsatz_schaden::uebergeben))
        .route("/api/einsaetze/{id}/schaeden/{sid}/abschliessen", post(routes::einsatz_schaden::abschliessen))
        .route("/api/einsaetze/{id}/schaeden/{sid}", delete(routes::einsatz_schaden::stornieren))
```

(`get`, `post`, `patch`, `delete` sind in `app.rs` bereits importiert.)

- [ ] **Step 4: Kompilieren — muss durchlaufen**

Run: `rtk proxy cargo build`
Expected: PASS — kein Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/routes/mod.rs src/routes/einsatz_schaden.rs src/app.rs
git commit -m "feat(be): E-5 Schaden-Routen (CRUD, uebergeben/abschliessen, SSE, ETB)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HTTP-Integrationstests — CRUD, Status, Validierung

**Files:**
- Create: `tests/einsatz_schaden.rs`

Harness und Domänen-Helfer sind inline (Muster aus `tests/einsatz_tier.rs`, kein `tests/common/`).

- [ ] **Step 1: Harness + Helfer + CRUD/Status/Validierungs-Tests schreiben**

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let router = build_router(AppState { pool: pool.clone(), live: LiveHub::new() });
    (router, pool)
}

async fn setup() -> axum::Router {
    setup_mit_pool().await.0
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

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri).header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

// ---------- Domänen-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(&json!({"bezeichnung":"Lage"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        "/api/benutzer",
        admin_cookie,
        Some(&json!({
            "anzeigename": name, "benutzername": name,
            "passwort": format!("{name}pw1"), "org_rolle": org_rolle
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "benutzer_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&json!({ "einsatz_rolle": rolle })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"), cookie, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn schaden_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/schaeden"), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "schaden_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

fn gueltig() -> Value {
    json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 1" })
}

// ---------- Tests: CRUD + Registriernummer + Status ----------

#[tokio::test]
async fn anlegen_vergibt_s_nummer_und_status_offen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin,
        Some(&json!({"typ":"umweltschaden","ausmass":"gross","ort":"Hauptstr. 17"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["registrier_nr"], 1);
    assert_eq!(v["status"], "offen");
    assert_eq!(v["typ"], "umweltschaden");
    assert_eq!(v["ausmass"], "gross");
}

#[tokio::test]
async fn registriernr_fortlaufend_je_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let _ = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (_, v2) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&gueltig())).await;
    assert_eq!(v2["registrier_nr"], 2);
}

#[tokio::test]
async fn anlegen_ohne_pflichtfelder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [json!({"ausmass":"gering","ort":"X"}), json!({"typ":"sachschaden","ort":"X"}),
                 json!({"typ":"sachschaden","ausmass":"gering"})] {
        let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "fehlt Pflichtfeld → 422: {body}");
    }
}

#[tokio::test]
async fn anlegen_mit_status_ungleich_offen_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body = gueltig();
    body["status"] = json!("abgeschlossen");
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn uebergeben_setzt_status_und_adressat() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Stadtwerke"}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["status"], "uebergeben");
    assert_eq!(v["uebergeben_an"], "Stadtwerke");
    assert!(v["uebergeben_at"].is_string());
}

#[tokio::test]
async fn uebergeben_ohne_adressat_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn uebergeben_aus_abgeschlossen_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn abschliessen_aus_offen_und_aus_uebergeben_ok() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // direkt aus offen
    let s1 = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (a1, v1) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s1}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(a1, StatusCode::OK);
    assert_eq!(v1["status"], "abgeschlossen");
    // über uebergeben
    let s2 = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s2}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    let (a2, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{s2}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(a2, StatusCode::OK);
}

#[tokio::test]
async fn abschliessen_ohne_grund_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn abschliessen_aus_abgeschlossen_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn abschliessen_haengt_notiz_an_beschreibung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body = gueltig();
    body["beschreibung"] = json!("Erstbefund");
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben","notiz":"vor Ort erledigt"}))).await;
    let (_, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    let beschr = v["beschreibung"].as_str().unwrap();
    assert!(beschr.contains("Erstbefund"));
    assert!(beschr.contains("vor Ort erledigt"));
}

// ---------- Tests: Geschädigt-Exklusivität + Soft-Delete + PATCH-Effektivzustand ----------

#[tokio::test]
async fn geschaedigt_beide_felder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p);
    body["geschaedigt_kontakt"] = json!("Herr Meier");
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn geschaedigt_fk_auf_storniert_person_bleibt_zulaessig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p);
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    // Person stornieren
    let (s_del, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert!(s_del == StatusCode::NO_CONTENT || s_del == StatusCode::OK);
    // Schaden bleibt ladbar, FK bleibt
    let (s, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["geschaedigt_person_id"], json!(p));
    assert!(v["geschaedigt_storniert_at"].is_string(), "Join zeigt storniert-Marke");
}

#[tokio::test]
async fn patch_loescht_uebergeben_an_bei_status_uebergeben_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Stadtwerke"}))).await;
    // PATCH setzt uebergeben_an auf null, Status bleibt 'uebergeben' → 422, NICHT 500
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"uebergeben_an": null}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn patch_geschaedigt_xor_effektivzustand_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let mut body = gueltig();
    body["geschaedigt_kontakt"] = json!("Herr Meier");
    let sid = schaden_anlegen(&app, &admin, e, &body).await;
    // FK setzen, ohne Freitext zu leeren → Effektivzustand hätte beide → 422
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"geschaedigt_person_id": p}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn soft_delete_blendet_aus_und_doppelt_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s1, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s1, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0, "storniert nicht in Default-Liste");
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?inkl_storniert=true"), &admin, None).await;
    assert_eq!(liste2.as_array().unwrap().len(), 1, "mit inkl_storniert sichtbar");
    let (s2, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s2, StatusCode::CONFLICT, "doppeltes Stornieren → 409");
}

#[tokio::test]
async fn patch_auf_storniertem_schaden_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"ausmass":"gross"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn liste_filtert_nach_status_typ_ausmass() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    schaden_anlegen(&app, &admin, e, &json!({"typ":"umweltschaden","ausmass":"gross","ort":"A"})).await;
    schaden_anlegen(&app, &admin, e, &json!({"typ":"sachschaden","ausmass":"gering","ort":"B"})).await;
    let (_, nur_umwelt) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?typ=umweltschaden"), &admin, None).await;
    assert_eq!(nur_umwelt.as_array().unwrap().len(), 1);
    let (_, nur_gross) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden?ausmass=gross"), &admin, None).await;
    assert_eq!(nur_gross.as_array().unwrap().len(), 1);
}
```

- [ ] **Step 2: Tests laufen lassen — müssen grün sein**

Run: `rtk proxy cargo test --test einsatz_schaden`
Expected: PASS — alle Tests dieser Datei grün. Falls `geschaedigt_fk_auf_storniert_person_bleibt_zulaessig` am Personen-DELETE-Statuscode scheitert, den erwarteten Code an die echte Personen-Storno-Route anpassen (NO_CONTENT vs OK).

- [ ] **Step 3: Commit**

```bash
git add tests/einsatz_schaden.rs
git commit -m "test(be): E-5 Schaden HTTP-Tests (CRUD, Status, Validierung, Soft-Delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ETB-Leak-Tests

**Files:**
- Modify: `tests/einsatz_schaden.rs` (Sektion ETB-Leak ergänzen)

- [ ] **Step 1: ETB-Leak-Tests ergänzen**

Am Ende von `tests/einsatz_schaden.rs` anfügen:

```rust
// ---------- Tests: ETB-Leak ----------

#[tokio::test]
async fn anlegen_etb_nennt_ort_aber_nicht_geschaedigt_oder_beschreibung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    schaden_anlegen(&app, &admin, e, &json!({
        "typ":"umweltschaden","ausmass":"gross","ort":"Hauptstr. 17",
        "beschreibung":"GEHEIM_BESCHREIBUNG","geschaedigt_kontakt":"Frau GEHEIM"
    })).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(inhalte[0].contains("S-001"), "ETB nennt Registriernummer");
    assert!(inhalte[0].contains("umweltschaden"), "ETB nennt Typ");
    assert!(inhalte[0].contains("gross"), "ETB nennt Ausmaß");
    assert!(inhalte[0].contains("Hauptstr. 17"), "ETB nennt den Ort (Lagebild)");
    assert!(!inhalte[0].contains("GEHEIM"), "ETB-Leak: weder beschreibung noch geschaedigt_kontakt");
}

#[tokio::test]
async fn lifecycle_etb_je_event_ein_eintrag_ohne_leak() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await; // FK-Geschädigter (R-001)
    let sid = schaden_anlegen(&app, &admin, e, &json!({
        "typ":"sachschaden","ausmass":"mittel","ort":"Wald hinter Müllers Hof",
        "geschaedigt_person_id": p
    })).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/uebergeben"), &admin,
        Some(&json!({"uebergeben_an":"Bauhof"}))).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden/{sid}/abschliessen"), &admin,
        Some(&json!({"abschluss_grund":"behoben","notiz":"GEHEIM_NOTIZ"}))).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;

    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    // NUR die Schaden-eigenen Einträge prüfen: Das Anlegen der Geschädigt-Person (E‑1)
    // schreibt selbst einen system-ETB-Eintrag mit IHRER R-Nr — das ist kein Leak des
    // Schadens. Auf S-001 filtern macht den Test robust, egal ob/welche Fremd-Einträge
    // im selben Einsatz stehen.
    let schaden_eintraege: Vec<&String> = inhalte.iter().filter(|i| i.contains("S-001")).collect();
    assert_eq!(
        schaden_eintraege.len(),
        4,
        "Schaden-Lifecycle: Anlegen + uebergeben + abschliessen + storno: {schaden_eintraege:?}"
    );
    for i in &schaden_eintraege {
        assert!(!i.contains("GEHEIM_NOTIZ"), "Leak: Abschluss-Notiz im ETB: {i}");
        assert!(!i.contains("R-001"), "Leak: Geschädigt-R-Nr im Schaden-ETB: {i}");
    }
    assert!(schaden_eintraege.iter().any(|i| i.contains("übergeben an Bauhof")));
    assert!(schaden_eintraege.iter().any(|i| i.contains("abgeschlossen (behoben)")));
    assert!(schaden_eintraege.iter().any(|i| i.contains("S-001 storniert")));
}
```

- [ ] **Step 2: Tests laufen lassen — müssen grün sein**

Run: `rtk proxy cargo test --test einsatz_schaden etb`
Expected: PASS — beide ETB-Leak-Tests grün.

> **Hinweis:** `R-001` ist die Personen-Registrieranzeige (E‑1-Konvention). Falls E‑1 ein anderes Präfix/Format nutzt, den Assert-String an die echte Person-Anzeige anpassen — der ETB darf diesen Bezug ohnehin nicht enthalten.

- [ ] **Step 3: Commit**

```bash
git add tests/einsatz_schaden.rs
git commit -m "test(be): E-5 ETB-Leak-Tests (Ort ja, Geschädigt/Beschreibung/Notiz nein)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Berechtigungs- + Org-Isolations-Tests (inkl. Cross-Org-Pinning)

**Files:**
- Modify: `tests/einsatz_schaden.rs` (Sektion Rechte-Matrix + Org-Isolation ergänzen)

> **Cross-Org-Entscheidung:** Die Spec (Zeile 262, 411) behandelt „höhere Berechtigung org-übergreifend" als *bestehende* Eigenschaft von `darf_lesen`; der Test **pinnt** das aktuelle Verhalten, er erzwingt keine Korrektur. `berechtigung.rs` wird nicht angefasst. Der Schreib-Pfad hat keinen `ist_hoehere_berechtigung`-Bypass → fremde Org kann nie schreiben.

- [ ] **Step 1: Berechtigungs- + Org-Isolations-Tests ergänzen**

Am Ende von `tests/einsatz_schaden.rs` anfügen:

```rust
// ---------- Tests: Rechte-Matrix + Org-Isolation + Read-only ----------

#[tokio::test]
async fn beobachter_kann_lesen_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &beob, None).await;
    assert_eq!(s_get, StatusCode::OK);
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &beob, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fremder_einsatz_ohne_mitgliedschaft_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fremder", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fremd = login_cookie(&app, "fremder", "fremderpw1").await;
    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &fremd, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn geschaedigt_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let p_fremd = person_anlegen(&app, &admin, e2).await;
    let mut body = gueltig();
    body["geschaedigt_person_id"] = json!(p_fremd);
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/schaeden"), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Geschädigt aus fremdem Einsatz → 404");
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_read_only() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    // Einsatz abschließen
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/abschliessen"), &admin, Some(&json!({}))).await;
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &admin, None).await;
    assert_eq!(s_get, StatusCode::OK, "Lesen bleibt erlaubt (Nachlauffrist)");
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &admin, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::CONFLICT, "Schreiben auf abgeschlossenem Einsatz → 409");
    let (s_del, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin, None).await;
    assert_eq!(s_del, StatusCode::CONFLICT);
}

/// PINNT das aktuelle Cross-Org-Verhalten von `darf_lesen` (mögliche Isolations-Lücke
/// über `ist_hoehere_berechtigung`). Schlägt der Test fehl, hat sich das Gate geändert —
/// dann ist die Sicherheitslage neu zu bewerten, NICHT der Test stumpf anzupassen.
#[tokio::test]
async fn fremde_org_fuehrungskraft_lesen_pin_und_schreiben_403() {
    let (app, pool) = setup_mit_pool().await; // "Test-Orga" (org 1) + admin
    bootstrap_admin(&pool, "Fremd-Orga", "fremdadmin", Some("fremdpw12")).await.unwrap();
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await; // Einsatz in org 1
    schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let fremd = login_cookie(&app, "fremdadmin", "fremdpw12").await; // org 2, höhere Berechtigung

    // LESEN: aktuelles Verhalten festhalten (erwartet: 200 wegen ist_hoehere_berechtigung-Bypass).
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/schaeden"), &fremd, None).await;
    assert_eq!(s_get, StatusCode::OK, "PIN: fremde Org mit höherer Berechtigung liest aktuell (Lücke dokumentiert)");

    // SCHREIBEN: muss IMMER 403 sein — Schreib-Gate kennt keinen Bypass.
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/schaeden"), &fremd, Some(&gueltig())).await;
    assert_eq!(s_post, StatusCode::FORBIDDEN, "fremde Org darf nie schreiben");
}
```

- [ ] **Step 2: Tests laufen lassen — anpassen falls Pin abweicht**

Run: `rtk proxy cargo test --test einsatz_schaden`
Expected: PASS. **Falls** `fremde_org_fuehrungskraft_lesen_pin_und_schreiben_403` beim LESEN nicht 200 liefert (z. B. 404/403), den `assert_eq!`-Wert auf den tatsächlich beobachteten Status setzen und den Kommentar entsprechend anpassen — der Test dokumentiert das Ist-Verhalten. Der Schreib-Assert (403) bleibt unverändert; scheitert er, liegt ein echter Sicherheitsbefund vor → stoppen und melden.

- [ ] **Step 3: Commit**

```bash
git add tests/einsatz_schaden.rs
git commit -m "test(be): E-5 Rechte-Matrix + Org-Isolation (Cross-Org-Pin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend — Typen + API-Client

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/einsatzSchaden.ts`

- [ ] **Step 1: Typen in `frontend/src/api/types.ts` ergänzen**

Am Ende der Datei (oder bei den anderen Einsatz-Entitäten) anfügen:

```ts
export type SchadenStatus = 'offen' | 'uebergeben' | 'abgeschlossen';
export type SchadenTyp =
  | 'sachschaden'
  | 'verkehrshindernis'
  | 'infrastruktur'
  | 'umweltschaden'
  | 'tierkadaver'
  | 'sonstige';
export type Ausmass = 'gering' | 'mittel' | 'gross' | 'katastrophal';
export type AbschlussGrund = 'behoben' | 'kein_handlungsbedarf' | 'abgewiesen';

export interface Schaden {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: SchadenStatus;
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  beschreibung: string;
  geschaedigt_person_id: number | null;
  geschaedigt_kontakt: string | null;
  uebergeben_an: string | null;
  uebergeben_at: string | null;
  abschluss_grund: AbschlussGrund | null;
  abschluss_at: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
  storniert_von: number | null;
  // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_person):
  geschaedigt_registrier_nr: number | null;
  geschaedigt_storniert_at: string | null;
}
```

- [ ] **Step 2: API-Client `frontend/src/api/einsatzSchaden.ts` schreiben**

```ts
import type { Schaden, SchadenStatus, SchadenTyp, Ausmass } from './types';
import { apiGet, apiSend } from './client';

/** Felder beim Anlegen (Typ + Ort + Ausmaß Pflicht; Rest optional). Geschädigt FK XOR Freitext. */
export interface SchadenEingabe {
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  beschreibung?: string | null;
  geschaedigt_person_id?: number | null;
  geschaedigt_kontakt?: string | null;
}

/** Patch-Felder (nur Stammfelder + Audit-Felder; NICHT Status). Geschädigt-/Übergabe-Felder
 *  akzeptieren `null` = leeren (Toggle). */
export interface SchadenPatch {
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  ort?: string;
  beschreibung?: string;
  geschaedigt_person_id?: number | null;
  geschaedigt_kontakt?: string | null;
  uebergeben_an?: string | null;
  abschluss_grund?: string | null;
}

export interface SchaedenFilter {
  status?: SchadenStatus;
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  geschaedigtPersonId?: number;
  inklStorniert?: boolean;
}

export function listeSchaeden(einsatzId: number, filter: SchaedenFilter = {}): Promise<Schaden[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.typ) params.set('typ', filter.typ);
  if (filter.ausmass) params.set('ausmass', filter.ausmass);
  if (filter.geschaedigtPersonId != null) params.set('geschaedigt_person_id', String(filter.geschaedigtPersonId));
  if (filter.inklStorniert) params.set('inkl_storniert', 'true');
  const q = params.toString();
  return apiGet<Schaden[]>(`/api/einsaetze/${einsatzId}/schaeden${q ? `?${q}` : ''}`);
}

export function ladeSchaden(einsatzId: number, schadenId: number): Promise<Schaden> {
  return apiGet<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`);
}

export function legeSchadenAn(einsatzId: number, daten: SchadenEingabe): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden`, 'POST', daten);
}

export function aktualisiereSchaden(einsatzId: number, schadenId: number, daten: SchadenPatch): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'PATCH', daten);
}

export function uebergebeSchaden(einsatzId: number, schadenId: number, uebergeben_an: string): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/uebergeben`, 'POST', { uebergeben_an });
}

export function schliesseSchadenAb(
  einsatzId: number,
  schadenId: number,
  abschluss_grund: string,
  notiz?: string,
): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/abschliessen`, 'POST', {
    abschluss_grund,
    notiz: notiz ?? null,
  });
}

export function storniereSchaden(einsatzId: number, schadenId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (S-007). */
export function schadenRegistrierAnzeige(nr: number): string {
  return `S-${String(nr).padStart(3, '0')}`;
}
```

- [ ] **Step 3: Typecheck — muss durchlaufen**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit`
Expected: PASS — keine Typfehler in den neuen Dateien.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzSchaden.ts
git commit -m "feat(fe): E-5 Schaden-Typen + API-Client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend — SSE-Hook `useSchaedenStream`

**Files:**
- Create: `frontend/src/etb/useSchaedenStream.ts`

- [ ] **Step 1: Hook schreiben**

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Schaden-SSE-Stream und invalidiert bei jedem `schaden`- oder
 *  `lagged`-Event die Schaden-Listen-Queries. Per Key-Prefix deckt das sowohl die
 *  Modul-Liste (`['einsatz-schaeden', einsatzId]`) als auch den
 *  „Als Geschädigte bei Schäden"-Block im Personen-Drawer ab. */
export function useSchaedenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/schaeden/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
    quelle.addEventListener('schaden', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('schaden', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```

- [ ] **Step 2: Typecheck — muss durchlaufen**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/etb/useSchaedenStream.ts
git commit -m "feat(fe): E-5 useSchaedenStream SSE-Hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Frontend — `SchaedenPage` (Liste, Filter, Drawer, Modals)

**Files:**
- Create: `frontend/src/pages/SchaedenPage.tsx`

Struktur eng an `frontend/src/pages/TierePage.tsx`. Statt einer generischen Status-Route gibt es zwei Aktions-Modals (Übergeben / Abschließen). Der Geschädigt-Picker ist inline (Radio `keiner|fk|freitext`, exklusiver Wechsel beim Submit), Muster wie der Tier-Halter-Picker.

- [ ] **Step 1: Komponente schreiben**

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ApiError } from '../api/client';
import { ladeEinsatz } from '../api/einsaetze';
import {
  aktualisiereSchaden,
  ladeSchaden,
  legeSchadenAn,
  listeSchaeden,
  schadenRegistrierAnzeige,
  schliesseSchadenAb,
  storniereSchaden,
  uebergebeSchaden,
  type SchadenEingabe,
  type SchadenPatch,
} from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenStatus, SchadenTyp } from '../api/types';
import { useSchaedenStream } from '../etb/useSchaedenStream';

const STATUS_META: Record<SchadenStatus, { label: string; color: string }> = {
  offen: { label: 'offen', color: 'gold' },
  uebergeben: { label: 'übergeben', color: 'blue' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const TYP_LABEL: Record<SchadenTyp, string> = {
  sachschaden: 'Sachschaden',
  verkehrshindernis: 'Verkehrshindernis',
  infrastruktur: 'Infrastruktur',
  umweltschaden: 'Umweltschaden',
  tierkadaver: 'Tierkadaver',
  sonstige: 'Sonstige',
};

const AUSMASS_META: Record<Ausmass, { label: string; color: string }> = {
  gering: { label: 'gering', color: 'green' },
  mittel: { label: 'mittel', color: 'gold' },
  gross: { label: 'groß', color: 'orange' },
  katastrophal: { label: 'katastrophal', color: 'red' },
};

const ABSCHLUSS_GRUENDE = [
  { value: 'behoben', label: 'behoben' },
  { value: 'kein_handlungsbedarf', label: 'kein Handlungsbedarf' },
  { value: 'abgewiesen', label: 'abgewiesen' },
];

type Sicht = 'offen' | 'uebergeben' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'uebergeben', label: 'Übergeben' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

function geschaedigtAnzeige(s: Schaden): React.ReactNode {
  if (s.geschaedigt_registrier_nr != null) {
    const label = `R-${String(s.geschaedigt_registrier_nr).padStart(3, '0')}`;
    return s.geschaedigt_storniert_at ? (
      <Typography.Text type="secondary">Geschädigt (storniert): {label}</Typography.Text>
    ) : (
      <Tag color="blue">{label}</Tag>
    );
  }
  if (s.geschaedigt_kontakt) return <Typography.Text>{s.geschaedigt_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">—</Typography.Text>;
}

type GeschaedigtModus = 'keiner' | 'fk' | 'freitext';

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [sicht, setSicht] = useState<Sicht>('offen');
  const [typFilter, setTypFilter] = useState<SchadenTyp | undefined>(undefined);
  const [ausmassFilter, setAusmassFilter] = useState<Ausmass | undefined>(undefined);
  const [suche, setSuche] = useState('');

  const [offenerSchadenId, setOffenerSchadenId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [erfassenOffen, setErfassenOffen] = useState(false);
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);

  const [erfassForm] = Form.useForm<SchadenEingabe & { geschaedigt_modus?: GeschaedigtModus }>();
  const [editForm] = Form.useForm<SchadenPatch & { geschaedigt_modus?: GeschaedigtModus }>();
  const [uebergebForm] = Form.useForm<{ uebergeben_an: string }>();
  const [abschlussForm] = Form.useForm<{ abschluss_grund: string; notiz?: string }>();

  useSchaedenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: ['einsatz-schaden', einsatzId, offenerSchadenId],
    queryFn: () => ladeSchaden(einsatzId, offenerSchadenId!),
    enabled: offenerSchadenId != null,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-schaden', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (v: SchadenEingabe) => legeSchadenAn(einsatzId, v),
    onSuccess: () => {
      invalidate();
      setErfassenOffen(false);
      erfassForm.resetFields();
    },
    onError: fehler,
  });
  const editMutation = useMutation({
    mutationFn: (v: SchadenPatch) => aktualisiereSchaden(einsatzId, offenerSchadenId!, v),
    onSuccess: () => {
      invalidate();
      setBearbeiten(false);
    },
    onError: fehler,
  });
  const uebergebMutation = useMutation({
    mutationFn: (an: string) => uebergebeSchaden(einsatzId, offenerSchadenId!, an),
    onSuccess: () => {
      invalidate();
      setUebergebenOffen(false);
      uebergebForm.resetFields();
    },
    onError: fehler,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: string; notiz?: string }) =>
      schliesseSchadenAb(einsatzId, offenerSchadenId!, v.abschluss_grund, v.notiz),
    onSuccess: () => {
      invalidate();
      setAbschlussOffen(false);
      abschlussForm.resetFields();
    },
    onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: () => storniereSchaden(einsatzId, offenerSchadenId!),
    onSuccess: () => {
      invalidate();
      setOffenerSchadenId(null);
    },
    onError: fehler,
  });

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  const alle = schaedenQuery.data ?? [];
  const sichtbar = alle
    .filter((s) => sicht === 'alle' || s.status === sicht)
    .filter((s) => !typFilter || s.typ === typFilter)
    .filter((s) => !ausmassFilter || s.ausmass === ausmassFilter)
    .filter((s) => {
      if (!suche.trim()) return true;
      const q = suche.toLowerCase();
      return s.ort.toLowerCase().includes(q) || s.beschreibung.toLowerCase().includes(q);
    });

  const spalten: TableColumnsType<Schaden> = [
    {
      title: 'Nr.',
      dataIndex: 'registrier_nr',
      render: (nr: number) => <strong>{schadenRegistrierAnzeige(nr)}</strong>,
    },
    { title: 'Typ', dataIndex: 'typ', render: (t: SchadenTyp) => <Tag>{TYP_LABEL[t]}</Tag> },
    {
      title: 'Ausmaß',
      dataIndex: 'ausmass',
      render: (a: Ausmass) => <Tag color={AUSMASS_META[a].color}>{AUSMASS_META[a].label}</Tag>,
    },
    { title: 'Ort', dataIndex: 'ort', ellipsis: true },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (st: SchadenStatus, row) => (
        <Tag color={STATUS_META[st].color}>
          {STATUS_META[st].label}
          {st === 'uebergeben' && row.uebergeben_an ? ` (${row.uebergeben_an})` : ''}
        </Tag>
      ),
    },
    { title: 'Geschädigt', key: 'geschaedigt', render: (_, row) => geschaedigtAnzeige(row) },
  ];

  function onErfassen(daten: SchadenEingabe & { geschaedigt_modus?: GeschaedigtModus }) {
    const modus = daten.geschaedigt_modus ?? 'keiner';
    anlegenMutation.mutate({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung ?? null,
      geschaedigt_person_id: modus === 'fk' ? daten.geschaedigt_person_id ?? null : null,
      geschaedigt_kontakt: modus === 'freitext' ? daten.geschaedigt_kontakt ?? null : null,
    });
  }

  function onEdit(daten: SchadenPatch & { geschaedigt_modus?: GeschaedigtModus }) {
    const modus = daten.geschaedigt_modus ?? 'keiner';
    editMutation.mutate({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung,
      geschaedigt_person_id: modus === 'fk' ? daten.geschaedigt_person_id ?? null : null,
      geschaedigt_kontakt: modus === 'freitext' ? daten.geschaedigt_kontakt ?? null : null,
    });
  }

  const s = detailQuery.data;

  function geschaedigtFelder(form: typeof erfassForm | typeof editForm) {
    return (
      <>
        <Form.Item label="Geschädigt" name="geschaedigt_modus">
          <Radio.Group
            options={[
              { value: 'keiner', label: 'unbekannt/öffentlich' },
              { value: 'fk', label: 'Person im Einsatz (R-Nr.)' },
              { value: 'freitext', label: 'Freitext (extern)' },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.geschaedigt_modus !== c.geschaedigt_modus}>
          {() => {
            const m = form.getFieldValue('geschaedigt_modus');
            if (m === 'fk')
              return (
                <Form.Item label="Geschädigt-Person-ID" name="geschaedigt_person_id">
                  <InputNumber min={1} style={{ width: 200 }} />
                </Form.Item>
              );
            if (m === 'freitext')
              return (
                <Form.Item label="Geschädigt-Kontakt (Name, Tel.)" name="geschaedigt_kontakt">
                  <Input />
                </Form.Item>
              );
            return null;
          }}
        </Form.Item>
      </>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Schäden
        </Typography.Title>
        {darfSchreiben && (
          <Button type="primary" onClick={() => setErfassenOffen(true)}>
            Schnellerfassung
          </Button>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Typ"
          style={{ width: 180 }}
          value={typFilter}
          onChange={setTypFilter}
          options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))}
        />
        <Select
          allowClear
          placeholder="Ausmaß"
          style={{ width: 160 }}
          value={ausmassFilter}
          onChange={setAusmassFilter}
          options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))}
        />
        <Input.Search
          placeholder="Ort/Beschreibung"
          allowClear
          style={{ width: 220 }}
          onChange={(e) => setSuche(e.target.value)}
        />
      </Space>

      <Table
        rowKey="id"
        loading={schaedenQuery.isLoading}
        dataSource={sichtbar}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Schäden in dieser Sicht' }}
        onRow={(row) => ({
          onClick: () => {
            setOffenerSchadenId(row.id);
            setBearbeiten(false);
          },
          style: { cursor: 'pointer' },
        })}
      />

      {/* Schnellerfassung */}
      <Modal
        title="Schaden erfassen"
        open={erfassenOffen}
        onCancel={() => setErfassenOffen(false)}
        onOk={() => erfassForm.submit()}
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        destroyOnClose
      >
        <Form form={erfassForm} layout="vertical" onFinish={onErfassen} initialValues={{ geschaedigt_modus: 'keiner' }}>
          <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ ist Pflicht' }]}>
            <Select options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
          </Form.Item>
          <Form.Item label="Ausmaß" name="ausmass" rules={[{ required: true, message: 'Ausmaß ist Pflicht' }]}>
            <Select options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))} />
          </Form.Item>
          <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
            <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />
          </Form.Item>
          <Form.Item label="Beschreibung" name="beschreibung">
            <Input.TextArea rows={2} />
          </Form.Item>
          {geschaedigtFelder(erfassForm)}
        </Form>
      </Modal>

      {/* Detail-Drawer */}
      <Drawer
        width={520}
        open={offenerSchadenId != null}
        onClose={() => setOffenerSchadenId(null)}
        title={s ? `${schadenRegistrierAnzeige(s.registrier_nr)} · ${TYP_LABEL[s.typ]}` : 'Schaden'}
        loading={detailQuery.isLoading}
      >
        {s && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Tag color={STATUS_META[s.status].color}>{STATUS_META[s.status].label}</Tag>
              <Tag color={AUSMASS_META[s.ausmass].color}>{AUSMASS_META[s.ausmass].label}</Tag>
              {s.storniert_at && <Tag color="red">storniert</Tag>}
            </Space>

            {/* Status-Aktionen je nach Status (de)aktiviert */}
            {darfSchreiben && !s.storniert_at && (
              <Space wrap>
                <Button size="small" disabled={s.status !== 'offen'} onClick={() => setUebergebenOffen(true)}>
                  Übergeben
                </Button>
                <Button
                  size="small"
                  disabled={s.status === 'abgeschlossen'}
                  onClick={() => setAbschlussOffen(true)}
                >
                  Abschließen
                </Button>
              </Space>
            )}

            {!bearbeiten ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Ort">{s.ort}</Descriptions.Item>
                <Descriptions.Item label="Beschreibung">{s.beschreibung || '—'}</Descriptions.Item>
                <Descriptions.Item label="Geschädigt">{geschaedigtAnzeige(s)}</Descriptions.Item>
                {s.status !== 'offen' && (
                  <Descriptions.Item label="Übergeben an">{s.uebergeben_an || '—'}</Descriptions.Item>
                )}
                {s.status === 'abgeschlossen' && (
                  <Descriptions.Item label="Abschlussgrund">{s.abschluss_grund || '—'}</Descriptions.Item>
                )}
              </Descriptions>
            ) : (
              <Form
                form={editForm}
                layout="vertical"
                onFinish={onEdit}
                initialValues={{
                  typ: s.typ,
                  ausmass: s.ausmass,
                  ort: s.ort,
                  beschreibung: s.beschreibung,
                  geschaedigt_modus:
                    s.geschaedigt_person_id != null ? 'fk' : s.geschaedigt_kontakt ? 'freitext' : 'keiner',
                  geschaedigt_person_id: s.geschaedigt_person_id ?? undefined,
                  geschaedigt_kontakt: s.geschaedigt_kontakt ?? undefined,
                }}
              >
                <Form.Item label="Typ" name="typ">
                  <Select options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
                </Form.Item>
                <Form.Item label="Ausmaß" name="ausmass">
                  <Select options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))} />
                </Form.Item>
                <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="Beschreibung" name="beschreibung">
                  <Input.TextArea rows={2} />
                </Form.Item>
                {geschaedigtFelder(editForm)}
                <Space>
                  <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
                    Speichern
                  </Button>
                  <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
                </Space>
              </Form>
            )}

            {darfSchreiben && !s.storniert_at && !bearbeiten && (
              <Space>
                <Button onClick={() => setBearbeiten(true)}>Bearbeiten</Button>
                <Popconfirm title="Schaden stornieren?" onConfirm={() => stornoMutation.mutate()} okText="Stornieren">
                  <Button danger>Stornieren</Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        )}
      </Drawer>

      {/* Übergeben-Modal */}
      <Modal
        title="Schaden übergeben"
        open={uebergebenOffen}
        onCancel={() => setUebergebenOffen(false)}
        onOk={() => uebergebForm.submit()}
        okText="Übergeben"
        confirmLoading={uebergebMutation.isPending}
        destroyOnClose
      >
        <Form form={uebergebForm} layout="vertical" onFinish={(v) => uebergebMutation.mutate(v.uebergeben_an)}>
          <Form.Item
            label="Übergeben an"
            name="uebergeben_an"
            rules={[{ required: true, message: 'Adressat ist Pflicht' }]}
          >
            <Input placeholder="z. B. Stadtwerke, Bauhof, Umweltamt" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Abschließen-Modal */}
      <Modal
        title="Schaden abschließen"
        open={abschlussOffen}
        onCancel={() => setAbschlussOffen(false)}
        onOk={() => abschlussForm.submit()}
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        destroyOnClose
      >
        <Form form={abschlussForm} layout="vertical" onFinish={(v) => abschlussMutation.mutate(v)}>
          <Form.Item
            label="Abschlussgrund"
            name="abschluss_grund"
            rules={[{ required: true, message: 'Grund ist Pflicht' }]}
          >
            <Select options={ABSCHLUSS_GRUENDE} />
          </Form.Item>
          <Form.Item label="Notiz (optional, wird an Beschreibung angehängt)" name="notiz">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck — muss durchlaufen**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit`
Expected: PASS. Falls `ladeEinsatz`/`einsatz.meine_rolle` anders heißen, an die echte `einsaetze.ts`-API anpassen (Vorlage: wie `TierePage.tsx` es importiert).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SchaedenPage.tsx
git commit -m "feat(fe): E-5 SchaedenPage (Liste, Filter, Drawer, Übergabe/Abschluss)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Frontend — Modul aktivieren (Registry + Routing)

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Modify: `frontend/src/App.tsx`

Der bestehende Stub heißt `sachschaeden` (Zeile 62). Wir benennen ihn auf `schaeden` um und aktivieren (`status: 'fertig'`).

- [ ] **Step 1: Registry-Eintrag umbenennen + aktivieren**

In `frontend/src/einsatz/modulRegistry.ts` Zeile 62 ersetzen:

```ts
  { key: 'schaeden', kategorie: 'erfassung', label: 'Schäden', icon: TbHome, route: 'schaeden', status: 'fertig', beschreibung: 'Sach-/Infrastruktur-/Umweltschäden mit Bearbeitungs-Workflow.' },
```

(Icon `TbHome` ist bereits importiert. Optional `TbAlertTriangle` o. ä. wählen und in Zeile 2–9 importieren.)

- [ ] **Step 2: Route verdrahten**

In `frontend/src/App.tsx`:
- Bei den Imports (nach Zeile 18) ergänzen:

```tsx
import SchaedenPage from './pages/SchaedenPage';
```

- In `MODUL_ELEMENTE` (nach `tiere: <TierePage />,`, Zeile 38) ergänzen:

```tsx
  schaeden: <SchaedenPage />,
```

- [ ] **Step 3: Registry-Tests laufen lassen — müssen grün bleiben**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/einsatz/modulRegistry.test.ts src/einsatz/ModulPanel.test.tsx`
Expected: PASS — die generische `modulRegistry`-Struktur bleibt valide (die Tests prüfen Form, nicht den konkreten `schaeden`-Key).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx
git commit -m "feat(fe): E-5 Schäden-Modul aktivieren (Registry + Route)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Frontend — `SchaedenPage`-Tests

**Files:**
- Create: `frontend/src/pages/SchaedenPage.test.tsx`

Muster aus `frontend/src/pages/TierePage.test.tsx` (Vitest + @testing-library + MSW). EventSource muss gestubbt werden, sonst crasht der SSE-Hook in jsdom.

- [ ] **Step 1: Tests schreiben**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import SchaedenPage from './SchaedenPage';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { AuthProvider } from '../auth/AuthProvider';

class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = { id: 1, anzeigename: 'Admin', system_rolle: 'admin', org_rolle: 'fuehrungskraft' };
const einsatzAktiv = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' };
const einsatzBeobachter = { id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter' };

function basisSchaden(overrides = {}) {
  return {
    id: 10,
    einsatz_id: 1,
    registrier_nr: 1,
    status: 'offen',
    typ: 'sachschaden',
    ausmass: 'gering',
    ort: 'Hauptstr. 17',
    beschreibung: '',
    geschaedigt_person_id: null,
    geschaedigt_kontakt: null,
    uebergeben_an: null,
    uebergeben_at: null,
    abschluss_grund: null,
    abschluss_at: null,
    erfasst_at: '2026-05-29 10:00:00',
    erfasst_von: 1,
    geaendert_at: '2026-05-29 10:00:00',
    geaendert_von: 1,
    storniert_at: null,
    storniert_von: null,
    geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null,
    ...overrides,
  };
}

function render(einsatzObj: object, schaeden: object[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(schaeden)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/schaeden' },
  );
}

describe('SchaedenPage', () => {
  it('zeigt offene Schäden mit S-Nummer, Typ und Ausmaß', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    expect(await screen.findByText('S-001')).toBeInTheDocument();
    expect(screen.getByText('Hauptstr. 17')).toBeInTheDocument();
    expect(screen.queryByText('S-002')).not.toBeInTheDocument(); // abgeschlossen nicht in Default-Sicht
  });

  it('filtert per Tab auf Abgeschlossen', async () => {
    render(einsatzAktiv, [
      basisSchaden(),
      basisSchaden({ id: 11, registrier_nr: 2, status: 'abgeschlossen', abschluss_grund: 'behoben' }),
    ]);
    await screen.findByText('S-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Abgeschlossen' }));
    expect(await screen.findByText('S-002')).toBeInTheDocument();
  });

  it('versteckt Schreib-Buttons für Beobachter', async () => {
    render(einsatzBeobachter, [basisSchaden()]);
    await screen.findByText('S-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt Pflichtfelder', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post('/api/einsaetze/1/schaeden', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(basisSchaden(), { status: 201 });
      }),
    );
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    const dialog = (await screen.findAllByRole('dialog')).find((d) => !d.classList.contains('ant-drawer-content'))!;
    // Typ wählen
    await userEvent.click(within(dialog).getByLabelText('Typ'));
    await userEvent.click(await screen.findByText('Umweltschaden'));
    // Ausmaß wählen
    await userEvent.click(within(dialog).getByLabelText('Ausmaß'));
    await userEvent.click(await screen.findByText('groß'));
    // Ort
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Hauptstr. 17');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await vi.waitFor(() => {
      expect(body.typ).toBe('umweltschaden');
      expect(body.ausmass).toBe('gross');
      expect(body.ort).toBe('Hauptstr. 17');
    });
  });

  it('Übergeben-Modal erzwingt einen Adressaten und schickt ihn', async () => {
    let body: { uebergeben_an?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.post('/api/einsaetze/1/schaeden/10/uebergeben', async ({ request }) => {
        body = (await request.json()) as { uebergeben_an?: string };
        return HttpResponse.json(basisSchaden({ status: 'uebergeben', uebergeben_an: body.uebergeben_an }));
      }),
    );
    render(einsatzAktiv, [basisSchaden()]);
    await userEvent.click((await screen.findAllByText('Hauptstr. 17'))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Übergeben' }));
    const dialog = (await screen.findAllByRole('dialog')).find((d) => !d.classList.contains('ant-drawer-content'))!;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    expect(await screen.findByText('Adressat ist Pflicht')).toBeInTheDocument();
    expect(body.uebergeben_an).toBeUndefined();
    await userEvent.type(within(dialog).getByLabelText('Übergeben an'), 'Stadtwerke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übergeben' }));
    await vi.waitFor(() => expect(body.uebergeben_an).toBe('Stadtwerke'));
  });

  it('Abschließen-Modal erzwingt einen Grund', async () => {
    let body: { abschluss_grund?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/schaeden/10', () => HttpResponse.json(basisSchaden())),
      http.post('/api/einsaetze/1/schaeden/10/abschliessen', async ({ request }) => {
        body = (await request.json()) as { abschluss_grund?: string };
        return HttpResponse.json(basisSchaden({ status: 'abgeschlossen', abschluss_grund: body.abschluss_grund }));
      }),
    );
    render(einsatzAktiv, [basisSchaden()]);
    await userEvent.click((await screen.findAllByText('Hauptstr. 17'))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    const dialog = (await screen.findAllByRole('dialog')).find((d) => !d.classList.contains('ant-drawer-content'))!;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.abschluss_grund).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('behoben'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    await vi.waitFor(() => expect(body.abschluss_grund).toBe('behoben'));
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen grün sein**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/SchaedenPage.test.tsx`
Expected: PASS — alle sechs Tests grün. Bei antd-Select-Eigenheiten ggf. die Label-Zuordnung (`getByLabelText`) an die tatsächliche `Form.Item`-Struktur anpassen (Vorlage: `TierePage.test.tsx`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SchaedenPage.test.tsx
git commit -m "test(fe): E-5 SchaedenPage-Tests (Liste, Filter, Übergabe/Abschluss-Modals)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Frontend — Personen-Drawer „Als Geschädigte bei Schäden"

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`

Lesender Cross-Modul-Block analog dem „Zugeordnete Tiere"-Block.

- [ ] **Step 1: Imports + SSE-Abo + Query + Block ergänzen**

In `frontend/src/pages/PersonenPage.tsx`:

- Bei den Imports ergänzen:

```tsx
import { useSchaedenStream } from '../etb/useSchaedenStream';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import type { Schaden } from '../api/types';
```

- Beim bestehenden `useTiereStream(einsatzId);` (Stream-Abos) ergänzen:

```tsx
  useSchaedenStream(einsatzId);
```

- Bei den Detail-Queries des offenen Personen-Drawers (neben `tiereDerPersonQuery`) ergänzen:

```tsx
  const schaedenDerPersonQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId, 'geschaedigt', offenePersonId],
    queryFn: () => listeSchaeden(einsatzId, { geschaedigtPersonId: offenePersonId!, inklStorniert: false }),
    enabled: offenePersonId != null,
  });
```

- Im Drawer-Inhalt, nach dem „Zugeordnete Tiere"-Block, ergänzen:

```tsx
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
            Als Geschädigte bei Schäden
          </Typography.Text>
          {(schaedenDerPersonQuery.data?.length ?? 0) === 0 ? (
            <div>
              <Typography.Text type="secondary">keine</Typography.Text>
            </div>
          ) : (
            <Space wrap style={{ marginTop: 4 }}>
              {(schaedenDerPersonQuery.data ?? []).map((s: Schaden) => (
                <Tag
                  key={s.id}
                  color="orange"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/einsaetze/${einsatzId}/schaeden`)}
                >
                  {schadenRegistrierAnzeige(s.registrier_nr)} {s.typ} ({s.ausmass}) — {s.status}
                </Tag>
              ))}
            </Space>
          )}
        </div>
```

> **Hinweis:** Die exakten Namen `offenePersonId`, `navigate`, `Typography`, `Tag`, `Space`, `useQuery` aus dem Bestand von `PersonenPage.tsx` übernehmen (sie existieren dort bereits für den Tiere-Block). Falls die Personen-Detail-Variable anders heißt, an den lokalen Bestand anpassen.

- [ ] **Step 2: Personen-Tests + Typecheck laufen lassen — müssen grün bleiben**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit && rtk proxy pnpm exec vitest run src/pages/PersonenPage.test.tsx`
Expected: PASS — bestehende Personen-Tests bleiben grün (neuer Block rendert „keine", solange kein Schaden gemockt ist). Falls ein bestehender Test alle Drawer-Fetches mockt, einen Handler für `GET /api/einsaetze/1/schaeden?...` mit `[]` ergänzen.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx
git commit -m "feat(fe): E-5 Personen-Drawer-Block 'Als Geschädigte bei Schäden'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Gesamt-Verifikation + PROGRESS.md

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Vollständige Backend-Suite grün**

Run: `rtk proxy cargo test`
Expected: PASS — alle Tests, inklusive `einsatz_schaden`, `schaden::*`, `db::tests::schaden_*`. Keine Regressionen in bestehenden Tests.

- [ ] **Step 2: Vollständige Frontend-Suite + Typecheck grün**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit && rtk proxy pnpm test`
Expected: PASS — alle Vitest-Tests grün, kein Typfehler.

- [ ] **Step 3: PROGRESS.md E‑5-Zeile auf DONE setzen**

In `docs/superpowers/PROGRESS.md` Zeile 92 (E‑5) ersetzen — Format wie E‑1/E‑2/E‑3:

```markdown
| E‑5 | **Schäden** (allgemein) | Schadensobjekte/-stellen: Art, Ort, Ausmaß, Status (Sach-/Infrastruktur-/Umweltschäden); **kein** Karten-Rendering (→ T4), **keine** Gefahren-/Absperrzonen (→ Lage) | E‑1-Foundation | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-29-erfassung-schaeden.md`, SchaedenPage + Tests, Modul aktiviert, ETB-Leak-Tests grün |
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: E-5 Schäden auf DONE setzen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Akzeptanzkriterien (aus der Spec)

- [ ] Alle Repo-/HTTP-/Frontend-Tests grün via `rtk proxy cargo test` / `rtk proxy pnpm test` (ehrliche Exit-Codes ohne Hook-Maskierung).
- [ ] Frontend-Modul aktiviert; Navigation zeigt „Schäden" statt Stub.
- [ ] PROGRESS.md-Tabelle Teilprojekt 3 E‑5 auf ✅ DONE.
- [ ] ETB-Leak-Tests beweisen, dass weder Geschädigt-Bezug noch `beschreibung` noch Abschluss-`notiz` automatisch in `typ=system`-Einträge wandern; der **Ort** ist bewusst enthalten.
- [ ] Status-Maschine: `offen→uebergeben→abgeschlossen`, keine Rückwärts-Übergänge, falscher Quell-Status → 409, fehlende Pflichtfelder → 422.
- [ ] PATCH gegen Effektivzustand liefert 422 (nie 500) für alle drei Mehrspalten-CHECKs.
- [ ] Cross-Org-Verhalten ist per Test gepinnt (Lesen dokumentiert, Schreiben immer 403).

## ClickUp-Folge-Task (beim Spec-Abschluss anlegen)

- „Schäden → Geo-Koordinaten nachziehen, sobald T4 Lagekarte läuft" (Spec Scope „Draußen" + Offene Punkte). Über den `clickup-task-anlegen`-Skill im Entwicklungsboard `901523554968`.
