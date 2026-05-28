# E‑2 Sichtung & medizinischer Verlauf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die medizinische Schicht auf die E‑1-Personen-Entity bauen — Sichtung (Triage) als Verlauf + Cache, append-only Befund-/Verlaufsnotizen, Transport/Verbleib als Verlauf + Cache und den zweistufigen Vermisstenabgleich.

**Architecture:** Vier neue append-only Tabellen (`person_sichtung`, `person_verlaufsnotiz`, `person_verbleib`, `person_abgleich`) plus drei denormalisierte Cache-Spalten auf `einsatz_person`. Je ein fokussiertes Repo-Modul unter `src/person/` (`sichtung_repo`, `verlaufsnotiz_repo`, `verbleib_repo`, `abgleich_repo`). Die Schreib-Endpunkte hängen unter den bestehenden Einsatz-Routen (`/api/einsaetze/:id/personen/:pid/…`) und wiederverwenden das Rollen-/Nachlauf-Gate (`src/einsatz/berechtigung.rs`), den `etb_system`-Helfer und das `person`-SSE-Event aus `src/routes/einsatz_person.rs`. Der medizinische Verlauf wird **in der bestehenden `GET …/:pid`-Detailantwort** mitgeliefert (genau ein `detail`-Audit-Eintrag, E‑1-Mechanik) — kein eigener lesender Sub-Endpunkt.

**ETB-Schreibreihenfolge (bewusste Konvention, weicht von der wörtlichen Spec ab):** Die Spec sagt „jeweils in derselben Transaktion wie der fachliche Insert". Der Codebase-Präzedenzfall ist jedoch **sequentiell nach dem Insert über den Pool** — siehe `src/routes/einsatz_fahrzeug.rs:15-17`: *„Bewusst sequentiell nach der Disposition (Entscheidung 4 der Spec: ETB = zusätzliche, append-only Spur)"* — und E‑1 (`einsatz_person.rs`) macht es genauso (`etb_system` nach `repo::…`). `etb_repo::anlegen` nimmt nur `&SqlitePool`, keine Transaktion. **Wir folgen der Codebase-Konvention:** ETB + SSE laufen im Handler nach dem Repo-Aufruf. **Echt atomar (via `pool.begin()` im Repo) bleiben nur:** Sichtung-Insert + Cache (+ ggf. `erfasst→betroffen`), Verbleib-Insert + Cache, Abgleich-Entscheidung + `vermisst→abgemeldet`.

**Tech Stack:** Rust (axum 0.8, sqlx 0.8/SQLite, tokio), React + TypeScript + Ant Design + TanStack Query, Vitest + MSW (Frontend-Tests), `tower::ServiceExt::oneshot` (HTTP-Integrationstests).

---

## Konventionen & Begriffe (verbindlich für alle Tasks)

- **Backend-Submodule** (in `src/person/mod.rs` als `pub mod …;` registrieren): `sichtung_repo`, `verlaufsnotiz_repo`, `verbleib_repo`, `abgleich_repo`. `src/person` ist bereits in `src/lib.rs` registriert.
- **Tabellen:** `person_sichtung`, `person_verlaufsnotiz`, `person_verbleib`, `person_abgleich`. Cache-Spalten auf `einsatz_person`: `aktuelle_sichtung`, `aktuelle_sichtung_at`, `aktueller_verbleib`.
- **Migrations:** `0022_einsatz_person_med_cache.sql` … `0026_person_abgleich.sql` (E‑1 endet bei `0021`).
- **Sichtungskategorie-Werte** (Enum `Sichtungskategorie`, exakt = CHECK-Constraint): `sk1`, `sk2`, `sk3`, `sk4`, `tot`, `unverletzt`. ETB-Label: `SK I`, `SK II`, `SK III`, `SK IV`, `tot`, `unverletzt`.
- **Verbleib-Art-Werte** (Enum `VerbleibArt`, exakt = CHECK): `transport`, `entlassung`, `vor_ort`, `verstorben`. Verbleib-`status` (nur sinnvoll bei `transport`): `angemeldet`, `abtransportiert` (oder NULL).
- ⚠️ **`Sichtungskategorie::Tot` (`"tot"`)** ist ein **medizinisches Sichtungsurteil** und ändert den Admin-Status **nicht**. **`VerbleibArt::Verstorben` (`"verstorben"`)** ist der Verbleib des Leichnams. Beide sind getrennt von `PersonStatus::Verstorben` (Admin-Status). Nicht verwechseln.
- **Abgleich-Status-Werte:** `verdacht`, `bestaetigt`, `verworfen`.
- **Abgleich-Routing-Invariante:** `POST /personen/:pid/abgleich` → `:pid` ist die **vermisste** Person (`vermisst_person_id`), die gefundene Person kommt im Body (`gefunden_person_id`). Bei `…/abgleich/:aid/entscheidung` muss `abgleich.vermisst_person_id == :pid` gelten, sonst `404`.
- **ETB-Texte (pseudonym, `typ=system`, nur `registrier_nr`):**
  - Sichtung → `Person R-042: Sichtung SK II` (bzw. `… tot`, `… unverletzt`).
  - Verbleib → `Person R-042: abtransportiert → [Ziel]` / `… entlassen` / `… verbleibt vor Ort` / `… Verbleib des Leichnams`.
  - Abgleich bestätigt → `Vermisstmeldung R-007 aufgeklärt — identisch mit R-042`.
  - **Befund-/Verlaufsnotiz → KEIN ETB-Eintrag.** Nie `name`/`vorname`/Befundtext im ETB.
- **SSE:** `person`-Event mit **nur** `{ einsatz_id, person_id }` (über `sse_person` aus `einsatz_person.rs`). Keine sensible Payload.
- **Frontend:** Typen in `frontend/src/api/types.ts`; API-Client `frontend/src/api/einsatzPerson.ts`; Seite `frontend/src/pages/PersonenPage.tsx`.

### File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `migrations/0022_einsatz_person_med_cache.sql` | Cache-Spalten auf `einsatz_person` | 1 |
| `src/person/mod.rs` | `PersonAnzeige` um Cache-Felder; `Sichtungskategorie` + `VerbleibArt` Enums | 1, 3 |
| `src/person/repo.rs` | `SELECT_ALLE` um Cache-Spalten erweitern | 1 |
| `migrations/0023_person_sichtung.sql` … `0026_person_abgleich.sql` | append-only Verlaufstabellen | 2 |
| `src/person/sichtung_repo.rs` | Sichtung-Insert (Tx: +Cache +`erfasst→betroffen`), Liste je Person | 4 |
| `src/person/verlaufsnotiz_repo.rs` | Notiz-Insert, Liste je Person | 5 |
| `src/person/verbleib_repo.rs` | Verbleib-Insert (Tx: +Cache), Liste je Person | 6 |
| `src/person/abgleich_repo.rs` | Verdacht anlegen, entscheiden (Tx: +`→abgemeldet`), Liste je Person | 7 |
| `src/routes/einsatz_person.rs` | `PersonDetail`, Detail-Anreicherung, 5 neue Handler | 8–13 |
| `src/app.rs` | Routen registrieren | 9–13 |
| `tests/einsatz_person.rs` | HTTP-Integrationstests (Harness existiert) | 8–14 |
| `frontend/src/api/types.ts` | `Person`-Cache-Felder; `PersonDetail`, `Sichtung`, `Verlaufsnotiz`, `Verbleib`, `Abgleich`, `Sichtungskategorie`, `VerbleibArt` | 15 |
| `frontend/src/api/einsatzPerson.ts` | `ladePerson`→`PersonDetail`; Sichtung/Verbleib/Notiz/Abgleich-Funktionen | 15 |
| `frontend/src/pages/PersonenPage.tsx` | SK-Spalte/-Badge + Lagebild; Tab „Medizinischer Verlauf"; Abgleich-Flow | 16–18 |
| `frontend/src/pages/PersonenPage.test.tsx` | Komponententests | 16–18 |
| `docs/superpowers/PROGRESS.md` | E‑2 auf erledigt | 19 |

---

## Task 1: Migration 0022 (Cache-Spalten) + Propagation in E‑1-Code

Migration 0022 fügt drei Cache-Spalten zu `einsatz_person` hinzu. Das berührt bestehenden E‑1-Code: `PersonAnzeige` (Struct) und `SELECT_ALLE` (Query) müssen die Spalten kennen, sonst bricht das `FromRow`-Mapping bzw. die Felder fehlen in der API.

**Files:**
- Create: `migrations/0022_einsatz_person_med_cache.sql`
- Modify: `src/person/mod.rs` (`PersonAnzeige`)
- Modify: `src/person/repo.rs` (`SELECT_ALLE`)

- [ ] **Step 1: Failing test schreiben (Cache-Felder in der Detail-Antwort)**

In `src/person/repo.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
    #[tokio::test]
    async fn neue_person_hat_leeren_med_cache() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let p = anlegen(&pool, e, b, leere_daten()).await.unwrap();
        let detail = laden(&pool, e, p.id).await.unwrap();
        assert!(detail.aktuelle_sichtung.is_none(), "ungesichtet = NULL");
        assert!(detail.aktuelle_sichtung_at.is_none());
        assert!(detail.aktueller_verbleib.is_none(), "kein Verbleib = vor Ort");
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::repo::tests::neue_person_hat_leeren_med_cache`
Expected: FAIL (Compile-Fehler: `no field aktuelle_sichtung on PersonAnzeige`)

- [ ] **Step 3: Migration schreiben**

`migrations/0022_einsatz_person_med_cache.sql`:

```sql
-- E‑2: denormalisierte Cache-Spalten für Liste/Filter/Lagebild. Jeder Sichtungs-/
-- Verbleib-Insert aktualisiert das jeweilige Feld in DERSELBEN Transaktion. Da
-- Zeitstempel Server-Jetzt sind, ist „jüngster Eintrag = zuletzt eingefügt"
-- garantiert (kein „bin ich der jüngste?"-Check nötig).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung    TEXT;  -- NULL = ungesichtet
ALTER TABLE einsatz_person ADD COLUMN aktuelle_sichtung_at TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktueller_verbleib   TEXT;  -- Kurzform letzter Verbleib; NULL = vor Ort
```

- [ ] **Step 4: `PersonAnzeige` um Cache-Felder erweitern**

In `src/person/mod.rs` im Struct `PersonAnzeige` nach `pub storniert_at: Option<String>,` ergänzen:

```rust
    // E‑2: denormalisierter medizinischer Cache (NULL = ungesichtet / vor Ort).
    pub aktuelle_sichtung: Option<String>,
    pub aktuelle_sichtung_at: Option<String>,
    pub aktueller_verbleib: Option<String>,
```

- [ ] **Step 5: `SELECT_ALLE` um Cache-Spalten erweitern**

In `src/person/repo.rs` die Konstante `SELECT_ALLE` anpassen — `storniert_at` ist die letzte Spalte; danach die drei Cache-Spalten:

```rust
const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
           geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
           melder_kontakt, notiz, erfasst_at, erfasst_von, geaendert_at, \
           geaendert_von, storniert_at, \
           aktuelle_sichtung, aktuelle_sichtung_at, aktueller_verbleib \
    FROM einsatz_person";
```

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `cargo test --lib person::repo`
Expected: PASS (alle Repo-Tests grün, inkl. neuem Cache-Test)

- [ ] **Step 7: Regressionscheck**

Run: `cargo test --test einsatz_person`
Expected: PASS (E‑1-HTTP-Tests grün — die Antwort hat nur drei zusätzliche `null`-Felder)

- [ ] **Step 8: Commit**

```bash
git add migrations/0022_einsatz_person_med_cache.sql src/person/mod.rs src/person/repo.rs
git commit -m "feat(person): medizinische Cache-Spalten auf einsatz_person (E-2 Fundament)"
```

---

## Task 2: Migrations 0023–0026 (append-only Verlaufstabellen)

Vier neue Tabellen. SQLite kann „append-only" nicht erzwingen — die Disziplin liegt im Repo (Tasks 4–7: keine UPDATE/DELETE auf die Verlaufstabellen außer der definierten Cache-/Entscheidungs-Logik).

**Files:**
- Create: `migrations/0023_person_sichtung.sql`
- Create: `migrations/0024_person_verlaufsnotiz.sql`
- Create: `migrations/0025_person_verbleib.sql`
- Create: `migrations/0026_person_abgleich.sql`

- [ ] **Step 1: `0023_person_sichtung.sql` schreiben**

```sql
-- Sichtungs-Verlauf (append-only — kein UPDATE/DELETE). Jede (Re-)Sichtung ein
-- Eintrag; das denormalisierte einsatz_person.aktuelle_sichtung spiegelt den jüngsten.
CREATE TABLE person_sichtung (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id     INTEGER NOT NULL REFERENCES einsatz_person(id),
    kategorie     TEXT    NOT NULL
                  CHECK (kategorie IN ('sk1','sk2','sk3','sk4','tot','unverletzt')),
    notiz         TEXT,                       -- optionale Kurzbegründung zum Sichtungszeitpunkt
    gesichtet_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    gesichtet_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_sichtung_person ON person_sichtung (person_id, gesichtet_at);
```

- [ ] **Step 2: `0024_person_verlaufsnotiz.sql` schreiben**

```sql
-- Medizinische Befund-/Verlaufsnotizen (append-only — besondere Kategorie).
-- Korrektur = neue Notiz. NIE ins ETB, nie in den SSE-Payload.
CREATE TABLE person_verlaufsnotiz (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER NOT NULL REFERENCES einsatz_person(id),
    text        TEXT    NOT NULL,
    erfasst_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verlaufsnotiz_person ON person_verlaufsnotiz (person_id, erfasst_at);
```

- [ ] **Step 3: `0025_person_verbleib.sql` schreiben**

```sql
-- Transport/Verbleib (append-only). Das jüngste Ereignis füllt
-- einsatz_person.aktueller_verbleib (Kurzform). Krankenhaus/Ziel = Freitext.
CREATE TABLE person_verbleib (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES einsatz_person(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('transport','entlassung','vor_ort','verstorben')),
    transportmittel TEXT,                     -- Freitext (RTW, KTW, …), optional
    ziel           TEXT,                      -- Freitext-Krankenhaus/Ziel, optional
    status         TEXT
                   CHECK (status IS NULL OR status IN ('angemeldet','abtransportiert')),
    notiz          TEXT,
    zeitpunkt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verbleib_person ON person_verbleib (person_id, zeitpunkt_at);
```

- [ ] **Step 4: `0026_person_abgleich.sql` schreiben**

```sql
-- Vermisstenabgleich (Verdacht → bestätigt/verworfen). Höchstens EIN bestätigter
-- Abgleich je Vermisstmeldung (partieller Unique-Index).
CREATE TABLE person_abgleich (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vermisst_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status vermisst
    gefunden_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status betroffen|verstorben
    status            TEXT    NOT NULL DEFAULT 'verdacht'
                      CHECK (status IN ('verdacht','bestaetigt','verworfen')),
    erstellt_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erstellt_von      INTEGER NOT NULL REFERENCES benutzer(id),
    entschieden_at    TEXT,
    entschieden_von   INTEGER REFERENCES benutzer(id),
    CHECK (vermisst_person_id <> gefunden_person_id)
);
CREATE UNIQUE INDEX idx_person_abgleich_bestaetigt
    ON person_abgleich (vermisst_person_id) WHERE status = 'bestaetigt';
CREATE INDEX idx_person_abgleich_einsatz ON person_abgleich (einsatz_id);
```

- [ ] **Step 5: Migrationen einspielen lassen (Smoke-Test)**

Run: `cargo test --lib db::tests`
Expected: PASS (alle vier Migrationen laden syntaktisch über `test_pool()`)

- [ ] **Step 6: Commit**

```bash
git add migrations/0023_person_sichtung.sql migrations/0024_person_verlaufsnotiz.sql migrations/0025_person_verbleib.sql migrations/0026_person_abgleich.sql
git commit -m "feat(db): Migrationen 0023-0026 (Sichtung, Notiz, Verbleib, Abgleich)"
```

---

## Task 3: `Sichtungskategorie` + `VerbleibArt` Enums

Reine Logik (Parsen/Validierung/Anzeige-Label) ohne DB, analog `PersonStatus`/`Geschlecht`. Isoliert getestet, bevor die Routen sie nutzen.

**Files:**
- Modify: `src/person/mod.rs`

- [ ] **Step 1: Failing tests schreiben**

In `src/person/mod.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
    #[test]
    fn sichtungskategorie_roundtrip_und_label() {
        for k in ["sk1", "sk2", "sk3", "sk4", "tot", "unverletzt"] {
            assert_eq!(Sichtungskategorie::parse(k).unwrap().as_str(), k);
        }
        assert!(Sichtungskategorie::parse("sk5").is_none());
        assert_eq!(Sichtungskategorie::parse("sk2").unwrap().etb_label(), "SK II");
        assert_eq!(Sichtungskategorie::parse("tot").unwrap().etb_label(), "tot");
        assert_eq!(Sichtungskategorie::parse("unverletzt").unwrap().etb_label(), "unverletzt");
    }

    #[test]
    fn verbleib_art_roundtrip() {
        for a in ["transport", "entlassung", "vor_ort", "verstorben"] {
            assert_eq!(VerbleibArt::parse(a).unwrap().as_str(), a);
        }
        assert!(VerbleibArt::parse("teleportation").is_none());
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::mod`
Expected: FAIL (Compile-Fehler: `Sichtungskategorie`, `VerbleibArt` fehlen)

- [ ] **Step 3: Enums implementieren**

In `src/person/mod.rs` nach dem `Geschlecht`-Block (vor `darf_uebergehen`) einfügen:

```rust
/// Medizinische Sichtungskategorie (Triage). String = CHECK-Constraint in
/// `migrations/0023_person_sichtung.sql`. **`Tot` ist ein medizinisches Urteil
/// und ändert den Admin-`PersonStatus` NICHT** (Annahme 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Sichtungskategorie {
    Sk1,
    Sk2,
    Sk3,
    Sk4,
    Tot,
    Unverletzt,
}

impl Sichtungskategorie {
    pub fn as_str(&self) -> &'static str {
        match self {
            Sichtungskategorie::Sk1 => "sk1",
            Sichtungskategorie::Sk2 => "sk2",
            Sichtungskategorie::Sk3 => "sk3",
            Sichtungskategorie::Sk4 => "sk4",
            Sichtungskategorie::Tot => "tot",
            Sichtungskategorie::Unverletzt => "unverletzt",
        }
    }

    pub fn parse(s: &str) -> Option<Sichtungskategorie> {
        match s {
            "sk1" => Some(Sichtungskategorie::Sk1),
            "sk2" => Some(Sichtungskategorie::Sk2),
            "sk3" => Some(Sichtungskategorie::Sk3),
            "sk4" => Some(Sichtungskategorie::Sk4),
            "tot" => Some(Sichtungskategorie::Tot),
            "unverletzt" => Some(Sichtungskategorie::Unverletzt),
            _ => None,
        }
    }

    /// Pseudonyme ETB-Beschriftung (z. B. `SK II`, `tot`, `unverletzt`).
    pub fn etb_label(&self) -> &'static str {
        match self {
            Sichtungskategorie::Sk1 => "SK I",
            Sichtungskategorie::Sk2 => "SK II",
            Sichtungskategorie::Sk3 => "SK III",
            Sichtungskategorie::Sk4 => "SK IV",
            Sichtungskategorie::Tot => "tot",
            Sichtungskategorie::Unverletzt => "unverletzt",
        }
    }
}

/// Art eines Verbleib-Ereignisses. String = CHECK-Constraint in
/// `migrations/0025_person_verbleib.sql`. `Verstorben` = Verbleib des Leichnams
/// (NICHT der Admin-Status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum VerbleibArt {
    Transport,
    Entlassung,
    VorOrt,
    Verstorben,
}

impl VerbleibArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            VerbleibArt::Transport => "transport",
            VerbleibArt::Entlassung => "entlassung",
            VerbleibArt::VorOrt => "vor_ort",
            VerbleibArt::Verstorben => "verstorben",
        }
    }

    pub fn parse(s: &str) -> Option<VerbleibArt> {
        match s {
            "transport" => Some(VerbleibArt::Transport),
            "entlassung" => Some(VerbleibArt::Entlassung),
            "vor_ort" => Some(VerbleibArt::VorOrt),
            "verstorben" => Some(VerbleibArt::Verstorben),
            _ => None,
        }
    }

    /// Kurzform fürs Cache-Feld `aktueller_verbleib` (z. B. `Transport → KH Mitte`).
    pub fn kurzform(&self, ziel: Option<&str>) -> String {
        match self {
            VerbleibArt::Transport => match ziel {
                Some(z) => format!("Transport → {z}"),
                None => "Transport".to_string(),
            },
            VerbleibArt::Entlassung => "entlassen".to_string(),
            VerbleibArt::VorOrt => "vor Ort".to_string(),
            VerbleibArt::Verstorben => "verstorben".to_string(),
        }
    }

    /// Pseudonymer ETB-Sachverhalt (ohne Reg.-Nr.-Präfix; der Handler stellt es voran).
    pub fn etb_sachverhalt(&self, ziel: Option<&str>) -> String {
        match self {
            VerbleibArt::Transport => match ziel {
                Some(z) => format!("abtransportiert → {z}"),
                None => "abtransportiert".to_string(),
            },
            VerbleibArt::Entlassung => "entlassen".to_string(),
            VerbleibArt::VorOrt => "verbleibt vor Ort".to_string(),
            VerbleibArt::Verstorben => "Verbleib des Leichnams".to_string(),
        }
    }
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::mod::tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/mod.rs
git commit -m "feat(person): Sichtungskategorie- und VerbleibArt-Enums mit ETB-Labels"
```

---

## Task 4: `src/person/sichtung_repo.rs` — Sichtungs-Verlauf + Cache

Der Insert läuft in **einer Transaktion**: optional `erfasst→betroffen` (Annahme 5), dann Insert in `person_sichtung`, dann Cache-Update auf `einsatz_person`. Das `aktuelle_sichtung_at`-Feld übernimmt exakt das `gesichtet_at` der neu eingefügten Zeile. Die Status-/Anwesenheits-Validierung (422) bleibt Handler-Aufgabe (Task 9) — das Repo führt nur aus.

**Files:**
- Create: `src/person/sichtung_repo.rs`
- Modify: `src/person/mod.rs` (`pub mod sichtung_repo;`)

- [ ] **Step 1: Modul registrieren**

In `src/person/mod.rs` ganz oben die Modulzeilen ergänzen (alphabetisch eingeordnet):

```rust
pub mod abgleich_repo;
pub mod audit_repo;
pub mod repo;
pub mod sichtung_repo;
pub mod verbleib_repo;
pub mod verlaufsnotiz_repo;
```

> **Hinweis:** Damit `cargo` in diesem Task kompiliert, lege für die noch nicht implementierten Module **leere Platzhalter** an: `src/person/verlaufsnotiz_repo.rs`, `src/person/verbleib_repo.rs`, `src/person/abgleich_repo.rs` mit je einem Kommentar `// implementiert in Task 5/6/7`. (Tasks 5–7 ersetzen sie.)

- [ ] **Step 2: Failing tests schreiben**

`src/person/sichtung_repo.rs` — Test-Block (Implementierung folgt). Das `setup` erzeugt zusätzlich eine Person:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Org + Benutzer + aktiver Einsatz + eine Person (Status erfasst). Liefert (benutzer_id, einsatz_id, person_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, p)
    }

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengste() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, "sk2", None, b, false).await.unwrap();
        erfassen(&pool, e, p, "sk1", Some("verschlechtert"), b, false).await.unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "beide Sichtungen bleiben (append-only)");
        assert_eq!(verlauf[0].kategorie, "sk1", "neueste zuerst");
        // Cache spiegelt jüngste Sichtung + deren Zeitstempel:
        let (kat, at): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT aktuelle_sichtung, aktuelle_sichtung_at FROM einsatz_person WHERE id = ?")
            .bind(p).fetch_one(&pool).await.unwrap();
        assert_eq!(kat.as_deref(), Some("sk1"));
        assert_eq!(at.as_deref(), Some(verlauf[0].gesichtet_at.as_str()), "Cache-At = jüngstes gesichtet_at");
    }

    #[tokio::test]
    async fn hebe_auf_betroffen_setzt_status_in_derselben_aktion() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        assert_eq!(status(&pool, p).await, "erfasst");
        erfassen(&pool, e, p, "sk3", None, b, true).await.unwrap();
        assert_eq!(status(&pool, p).await, "betroffen", "erfasst→betroffen durch Sichtung");
    }

    #[tokio::test]
    async fn sichtung_tot_aendert_admin_status_nicht() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        // Vorbedingung: Person ist betroffen (kein erfasst-Anheben mehr nötig).
        sqlx::query("UPDATE einsatz_person SET status='betroffen' WHERE id=?")
            .bind(p).execute(&pool).await.unwrap();
        erfassen(&pool, e, p, "tot", None, b, false).await.unwrap();
        assert_eq!(status(&pool, p).await, "betroffen", "Sichtung=tot lässt Admin-Status unangetastet");
    }
}
```

- [ ] **Step 3: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::sichtung_repo`
Expected: FAIL (Compile-Fehler: `SichtungAnzeige`, `erfassen`, `liste_je_person` fehlen)

- [ ] **Step 4: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block in `src/person/sichtung_repo.rs`:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Ein Sichtungs-Verlaufseintrag (1:1 zu `person_sichtung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SichtungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub kategorie: String,
    pub notiz: Option<String>,
    pub gesichtet_at: String,
    pub gesichtet_von: i64,
}

const SELECT_SICHTUNG: &str = "\
    SELECT id, einsatz_id, person_id, kategorie, notiz, gesichtet_at, gesichtet_von \
    FROM person_sichtung";

/// Erfasst eine Sichtung append-only und aktualisiert den Cache in DERSELBEN
/// Transaktion. Bei `hebe_auf_betroffen` wird die Person vorab `erfasst→betroffen`
/// gehoben (Annahme 5). `kategorie` muss bereits validiert sein (Handler).
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    kategorie: &str,
    notiz: Option<&str>,
    gesichtet_von: i64,
    hebe_auf_betroffen: bool,
) -> Result<SichtungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    if hebe_auf_betroffen {
        sqlx::query(
            "UPDATE einsatz_person SET status = 'betroffen', \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(gesichtet_von)
        .bind(person_id)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, gesichtet_von) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(kategorie)
    .bind(notiz)
    .bind(gesichtet_von)
    .fetch_one(&mut *tx)
    .await?;
    // Cache spiegelt die jüngste Sichtung; das At-Feld übernimmt exakt deren gesichtet_at.
    sqlx::query(
        "UPDATE einsatz_person SET aktuelle_sichtung = ?, \
            aktuelle_sichtung_at = (SELECT gesichtet_at FROM person_sichtung WHERE id = ?) \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(kategorie)
    .bind(id)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt eine Sichtung; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<SichtungAnzeige, AppError> {
    sqlx::query_as::<_, SichtungAnzeige>(&format!("{SELECT_SICHTUNG} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Sichtungs-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<SichtungAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, SichtungAnzeige>(&format!(
        "{SELECT_SICHTUNG} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY gesichtet_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}
```

- [ ] **Step 5: Test ausführen — muss bestehen**

Run: `cargo test --lib person::sichtung_repo`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/person/mod.rs src/person/sichtung_repo.rs src/person/verlaufsnotiz_repo.rs src/person/verbleib_repo.rs src/person/abgleich_repo.rs
git commit -m "feat(person): sichtung_repo (Verlauf + Cache + erfasst-Anhebung, transaktional)"
```

---

## Task 5: `src/person/verlaufsnotiz_repo.rs` — Befundnotizen (append-only)

Schlichtes append-only: `anlegen` + `liste_je_person`. Kein Cache, kein ETB (besondere Kategorie — Task 11 stellt sicher, dass der Handler kein ETB schreibt).

**Files:**
- Create: `src/person/verlaufsnotiz_repo.rs` (ersetzt den Platzhalter aus Task 4)

- [ ] **Step 1: Failing tests schreiben**

`src/person/verlaufsnotiz_repo.rs` — Test-Block (Implementierung folgt). Das `setup` ist identisch zu Task 4 (Org + Benutzer + Einsatz + Person):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, p)
    }

    #[tokio::test]
    async fn anlegen_ist_append_only_und_liste_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, p, "Platzwunde Stirn", b).await.unwrap();
        anlegen(&pool, e, p, "stabil, ansprechbar", b).await.unwrap();
        let notizen = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(notizen.len(), 2);
        assert_eq!(notizen[0].text, "stabil, ansprechbar", "neueste zuerst");
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::verlaufsnotiz_repo`
Expected: FAIL (Compile-Fehler: `NotizAnzeige`, `anlegen`, `liste_je_person` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Eine medizinische Verlaufsnotiz (1:1 zu `person_verlaufsnotiz`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct NotizAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub text: String,
    pub erfasst_at: String,
    pub erfasst_von: i64,
}

const SELECT_NOTIZ: &str = "\
    SELECT id, einsatz_id, person_id, text, erfasst_at, erfasst_von \
    FROM person_verlaufsnotiz";

/// Legt eine append-only Befundnotiz an. `text` ist bereits getrimmt (Handler).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    text: &str,
    erfasst_von: i64,
) -> Result<NotizAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(text)
    .bind(erfasst_von)
    .fetch_one(pool)
    .await?;
    sqlx::query_as::<_, NotizAnzeige>(&format!("{SELECT_NOTIZ} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

/// Notizen einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<NotizAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, NotizAnzeige>(&format!(
        "{SELECT_NOTIZ} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY erfasst_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::verlaufsnotiz_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/verlaufsnotiz_repo.rs
git commit -m "feat(person): verlaufsnotiz_repo (append-only Befundnotizen)"
```

---

## Task 6: `src/person/verbleib_repo.rs` — Transport/Verbleib + Cache

Wie `sichtung_repo`: Insert + Cache-Update in **einer Transaktion**. Der Handler (Task 10) berechnet die Kurzform via `VerbleibArt::kurzform(ziel)` und übergibt sie; das Repo schreibt sie ins Cache-Feld `aktueller_verbleib`.

**Files:**
- Create: `src/person/verbleib_repo.rs` (ersetzt den Platzhalter aus Task 4)

- [ ] **Step 1: Failing tests schreiben**

`src/person/verbleib_repo.rs` — Test-Block (Implementierung folgt). `setup` identisch zu Task 5:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, p)
    }

    fn daten<'a>(art: &'a str, ziel: Option<&'a str>) -> VerbleibDaten<'a> {
        VerbleibDaten { art, transportmittel: None, ziel, status: None, notiz: None }
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengsten() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, daten("vor_ort", None), "vor Ort", b).await.unwrap();
        erfassen(&pool, e, p, daten("transport", Some("KH Mitte")), "Transport → KH Mitte", b).await.unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "append-only");
        assert_eq!(verlauf[0].art, "transport", "neueste zuerst");
        let cache: Option<String> = sqlx::query_scalar(
            "SELECT aktueller_verbleib FROM einsatz_person WHERE id = ?")
            .bind(p).fetch_one(&pool).await.unwrap();
        assert_eq!(cache.as_deref(), Some("Transport → KH Mitte"));
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::verbleib_repo`
Expected: FAIL (Compile-Fehler: `VerbleibAnzeige`, `VerbleibDaten`, `erfassen`, `liste_je_person` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Ein Verbleib-Ereignis (1:1 zu `person_verbleib`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct VerbleibAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub art: String,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<String>,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}

/// Eingabedaten beim Erfassen; Strings bereits getrimmt (Handler). `art`/`status`
/// sind bereits validiert (Handler via `VerbleibArt`).
#[derive(Debug)]
pub struct VerbleibDaten<'a> {
    pub art: &'a str,
    pub transportmittel: Option<&'a str>,
    pub ziel: Option<&'a str>,
    pub status: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

const SELECT_VERBLEIB: &str = "\
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
           zeitpunkt_at, erfasst_von \
    FROM person_verbleib";

/// Erfasst ein Verbleib-Ereignis append-only und aktualisiert `aktueller_verbleib`
/// in DERSELBEN Transaktion. `kurzform` ist die vom Handler berechnete Cache-Kurzform.
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    daten: VerbleibDaten<'_>,
    kurzform: &str,
    erfasst_von: i64,
) -> Result<VerbleibAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verbleib \
            (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(daten.art)
    .bind(daten.transportmittel)
    .bind(daten.ziel)
    .bind(daten.status)
    .bind(daten.notiz)
    .bind(erfasst_von)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET aktueller_verbleib = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(kurzform)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt ein Verbleib-Ereignis; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<VerbleibAnzeige, AppError> {
    sqlx::query_as::<_, VerbleibAnzeige>(&format!("{SELECT_VERBLEIB} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Verbleib-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<VerbleibAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, VerbleibAnzeige>(&format!(
        "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY zeitpunkt_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::verbleib_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/verbleib_repo.rs
git commit -m "feat(person): verbleib_repo (Verlauf + Cache, transaktional)"
```

---

## Task 7: `src/person/abgleich_repo.rs` — Vermisstenabgleich

Verdacht anlegen, entscheiden, je Person listen. `entscheide` mit `bestaetigt` läuft in **einer Transaktion**: Abgleich-Status setzen + Vermisstmeldung `→ abgemeldet`. Der partielle Unique-Index `idx_person_abgleich_bestaetigt` erzwingt höchstens **einen** bestätigten Abgleich je Vermisstmeldung — eine Verletzung wird auf `Conflict` (409) gemappt.

**Files:**
- Create: `src/person/abgleich_repo.rs` (ersetzt den Platzhalter aus Task 4)

- [ ] **Step 1: Failing tests schreiben**

`src/person/abgleich_repo.rs` — Test-Block (Implementierung folgt). `setup` erzeugt eine vermisste + zwei gefundene Personen:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, vermisst_id, gefunden_a, gefunden_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let mk = |nr: i64, status: &'static str| {
            let e = e; let b = b; let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
                     VALUES (?, ?, ?, ?, ?) RETURNING id")
                    .bind(e).bind(nr).bind(status).bind(b).bind(b)
                    .fetch_one(&pool).await.unwrap()
            }
        };
        let vermisst = mk(1, "vermisst").await;
        let gef_a = mk(2, "betroffen").await;
        let gef_b = mk(3, "betroffen").await;
        (b, e, vermisst, gef_a, gef_b)
    }

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn verdacht_anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        assert_eq!(a.status, "verdacht");
        // Taucht sowohl beim Vermissten als auch bei der gefundenen Person auf:
        assert_eq!(liste_je_person(&pool, e, v).await.unwrap().len(), 1);
        assert_eq!(liste_je_person(&pool, e, g).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn bestaetigen_meldet_vermissten_ab() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        let entschieden = entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();
        assert_eq!(entschieden.status, "bestaetigt");
        assert!(entschieden.entschieden_at.is_some());
        assert_eq!(status(&pool, v).await, "abgemeldet", "Vermisstmeldung aufgeklärt → abgemeldet");
    }

    #[tokio::test]
    async fn zweiter_bestaetigter_je_vermisstmeldung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, v, g_a, g_b) = setup(&pool).await;
        let a1 = anlegen_verdacht(&pool, e, v, g_a, b).await.unwrap();
        let a2 = anlegen_verdacht(&pool, e, v, g_b, b).await.unwrap();
        entscheide(&pool, e, a1.id, "bestaetigt", b).await.unwrap();
        let err = entscheide(&pool, e, a2.id, "bestaetigt", b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "Unique-Index: nur ein bestätigter Abgleich je Vermisstmeldung");
    }

    #[tokio::test]
    async fn verwerfen_laesst_status_unveraendert() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        entscheide(&pool, e, a.id, "verworfen", b).await.unwrap();
        assert_eq!(status(&pool, v).await, "vermisst", "verworfen ändert den Status nicht");
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib person::abgleich_repo`
Expected: FAIL (Compile-Fehler: `AbgleichAnzeige`, `anlegen_verdacht`, `entscheide`, `liste_je_person`, `laden` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Ein Vermisstenabgleich (1:1 zu `person_abgleich`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AbgleichAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub vermisst_person_id: i64,
    pub gefunden_person_id: i64,
    pub status: String,
    pub erstellt_at: String,
    pub erstellt_von: i64,
    pub entschieden_at: Option<String>,
    pub entschieden_von: Option<i64>,
}

const SELECT_ABGLEICH: &str = "\
    SELECT id, einsatz_id, vermisst_person_id, gefunden_person_id, status, \
           erstellt_at, erstellt_von, entschieden_at, entschieden_von \
    FROM person_abgleich";

/// Legt einen Verdachts-Link an (Status `verdacht`). Die fachliche Validierung
/// (Status der beteiligten Personen, gleicher Einsatz, nicht dieselbe Person)
/// ist Handler-Aufgabe (Task 12).
pub async fn anlegen_verdacht(
    pool: &SqlitePool,
    einsatz_id: i64,
    vermisst_person_id: i64,
    gefunden_person_id: i64,
    erstellt_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_abgleich \
            (einsatz_id, vermisst_person_id, gefunden_person_id, erstellt_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vermisst_person_id)
    .bind(gefunden_person_id)
    .bind(erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt einen Abgleich; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<AbgleichAnzeige, AppError> {
    sqlx::query_as::<_, AbgleichAnzeige>(&format!("{SELECT_ABGLEICH} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Entscheidet einen Abgleich (`bestaetigt`/`verworfen`). Bei `bestaetigt` wird in
/// DERSELBEN Transaktion die Vermisstmeldung `→ abgemeldet` gesetzt; der partielle
/// Unique-Index erzwingt höchstens einen bestätigten Abgleich je Vermisstmeldung
/// (Verletzung → `Conflict`). Voraussetzung (Handler): Abgleich-Status == `verdacht`.
pub async fn entscheide(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    entscheidung: &str,
    entschieden_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let abgleich = laden(pool, einsatz_id, id).await?;
    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE person_abgleich SET status = ?, \
            entschieden_at = strftime('%Y-%m-%d %H:%M:%S','now'), entschieden_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(entscheidung)
    .bind(entschieden_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await;
    if let Err(e) = ergebnis {
        // Partieller Unique-Index: bereits ein bestätigter Abgleich je Vermisstmeldung.
        if let sqlx::Error::Database(db) = &e {
            if db.is_unique_violation() {
                return Err(AppError::Conflict(
                    "Für diese Vermisstmeldung ist bereits ein Abgleich bestätigt".into(),
                ));
            }
        }
        return Err(e.into());
    }
    if entscheidung == "bestaetigt" {
        sqlx::query(
            "UPDATE einsatz_person SET status = 'abgemeldet', \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(entschieden_von)
        .bind(abgleich.vermisst_person_id)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Abgleiche, an denen die Person beteiligt ist (als vermisst ODER gefunden),
/// neueste zuerst.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<AbgleichAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, AbgleichAnzeige>(&format!(
        "{SELECT_ABGLEICH} WHERE einsatz_id = ? \
         AND (vermisst_person_id = ?1 OR gefunden_person_id = ?1) \
         ORDER BY erstellt_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}
```

> **Hinweis:** `?1` referenziert in SQLite denselben gebundenen Parameter mehrfach. Da `bind(einsatz_id)` der erste und `bind(person_id)` der zweite Parameter ist, prüfe beim Implementieren, dass die Reihenfolge stimmt: `einsatz_id` = `?` (Position 1 im WHERE), `person_id` = `?1` (Position 2). Falls das gemischte `?`/`?1` Probleme macht, schreibe die Query mit expliziten `?2`/`?2` und binde `einsatz_id`, dann `person_id`. Verifiziere via Test.

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib person::abgleich_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/person/abgleich_repo.rs
git commit -m "feat(person): abgleich_repo (Verdacht/Entscheidung, transaktional, Unique-Konflikt)"
```

---

## Task 8: `PersonDetail` + Detail-Anreicherung (genau ein Audit)

Der `detail`-Handler liefert den medizinischen Verlauf **mit** (Spec: ein lesender Sub-Endpunkt würde mehrfach auditieren). `PersonDetail` flacht `PersonAnzeige` per `#[serde(flatten)]` ein, sodass alle E‑1-Felder weiter top-level erscheinen — bestehende Tests (`json["name"]`, `json["registrier_nr"]`) bleiben grün.

**Files:**
- Modify: `src/routes/einsatz_person.rs` (`PersonDetail`, `detail`-Handler, neue `use`-Zeilen)
- Modify: `tests/einsatz_person.rs` (Detail-Test prüft `sichtungen`-Array; Audit-Test bleibt)

- [ ] **Step 1: Failing test schreiben (Detail enthält medizinischen Verlauf)**

In `tests/einsatz_person.rs` ergänzen:

```rust
#[tokio::test]
async fn detail_enthaelt_medizinischen_verlauf_und_genau_einen_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (status, json) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    // E-2: vier Verlaufs-Arrays sind Teil der Detail-Antwort:
    assert!(json["sichtungen"].is_array());
    assert!(json["notizen"].is_array());
    assert!(json["verbleib"].is_array());
    assert!(json["abgleiche"].is_array());
    // E-1-Felder bleiben top-level (serde flatten):
    assert_eq!(json["registrier_nr"], 1);
    // Cache-Felder sind initial null:
    assert!(json["aktuelle_sichtung"].is_null());
    assert!(json["aktueller_verbleib"].is_null());
    // Genau EIN detail-Audit-Eintrag — auch mit angereicherter Antwort:
    assert_eq!(audit_anzahl(&app, &admin, e, p).await, 1);
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --test einsatz_person detail_enthaelt_medizinischen_verlauf`
Expected: FAIL (Felder fehlen in Response)

- [ ] **Step 3: `use`-Zeilen ergänzen**

In `src/routes/einsatz_person.rs` oben die `use`-Zeilen erweitern (vorhandene `use crate::person::…` Zeile ersetzen + neue Anzeige-Typen einbinden):

```rust
use crate::person::{darf_uebergehen, registrier_anzeige, repo, Geschlecht, PersonAnzeige, PersonStatus, Sichtungskategorie, VerbleibArt};
use crate::person::{abgleich_repo, audit_repo, sichtung_repo, verbleib_repo, verlaufsnotiz_repo};
use crate::person::abgleich_repo::AbgleichAnzeige;
use crate::person::audit_repo::ZugriffAnzeige;
use crate::person::sichtung_repo::SichtungAnzeige;
use crate::person::verbleib_repo::VerbleibAnzeige;
use crate::person::verlaufsnotiz_repo::NotizAnzeige;
use serde::Serialize;
```

> **Hinweis:** Die bestehende Zeile `use crate::person::audit_repo;` und `use crate::person::audit_repo::ZugriffAnzeige;` durch obige ersetzen (nicht doppelt importieren).

- [ ] **Step 4: `PersonDetail` definieren**

In `src/routes/einsatz_person.rs` nach den `use`-Zeilen (vor den ETB-Helfern):

```rust
/// Detail-Antwort: E‑1-Personenfelder (flatten) + E‑2-Verlauf-Arrays. Genau eine
/// Antwort, genau ein `detail`-Audit (Spec-Annahme „Lesen / Lese-Audit").
#[derive(Debug, Serialize)]
pub struct PersonDetail {
    #[serde(flatten)]
    pub person: PersonAnzeige,
    pub sichtungen: Vec<SichtungAnzeige>,
    pub notizen: Vec<NotizAnzeige>,
    pub verbleib: Vec<VerbleibAnzeige>,
    pub abgleiche: Vec<AbgleichAnzeige>,
}
```

- [ ] **Step 5: `detail`-Handler umstellen**

Den bestehenden `detail`-Handler (Rückgabetyp `Json<PersonAnzeige>`) ersetzen:

```rust
/// GET /api/einsaetze/{id}/personen/{pid} — Detail inkl. medizinischem Verlauf.
/// **Schreibt EINEN `detail`-Audit-Eintrag VOR der Verlauf-Anreicherung**
/// (auch wenn der Client abbricht). Die Verlauf-Listen sind eigene Reads ohne
/// zusätzliches Audit — der eine Audit-Eintrag steht für die gesamte Öffnung.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<PersonDetail>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, Some(person_id), benutzer.id, "detail").await?;

    let sichtungen = sichtung_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let notizen = verlaufsnotiz_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let verbleib = verbleib_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let abgleiche = abgleich_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;

    Ok(Json(PersonDetail { person, sichtungen, notizen, verbleib, abgleiche }))
}
```

- [ ] **Step 6: Tests ausführen — alles grün**

Run: `cargo test --test einsatz_person`
Expected: PASS (neuer Test + bestehende E‑1-Detail/Audit-Tests bleiben grün dank `serde(flatten)`)

- [ ] **Step 7: Commit**

```bash
git add src/routes/einsatz_person.rs tests/einsatz_person.rs
git commit -m "feat(person): Detail-Antwort um medizinischen Verlauf erweitern (ein Audit)"
```

---

## Task 9: Sichtungs-Route + Tests

`POST /api/einsaetze/{id}/personen/{pid}/sichtung`. Schreibberechtigt + aktiv. Validiert Kategorie (Enum), Anwesenheit (storniert→409, vermisst/abgemeldet→422); hebt `erfasst→betroffen` (Annahme 5); ETB pseudonym; SSE `person`. **`tot` ändert den Admin-Status NICHT.**

**Files:**
- Modify: `src/routes/einsatz_person.rs` (Body, Handler)
- Modify: `src/app.rs` (Route registrieren)
- Modify: `tests/einsatz_person.rs` (Tests)

- [ ] **Step 1: Failing tests schreiben**

In `tests/einsatz_person.rs` einen Helfer und drei Tests ergänzen:

```rust
async fn sichten(app: &axum::Router, cookie: &str, einsatz: i64, person: i64, body: &str) -> (StatusCode, Value) {
    anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/sichtung"), cookie, Some(body)).await
}

#[tokio::test]
async fn sichtung_ist_append_only_cache_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Geheim","vorname":"Sehr"}"#).await;
    // erfasst → Sichtung sk2: hebt Status auf betroffen + Cache + ETB
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"sk2"}"#).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"sk1","notiz":"verschlechtert"}"#).await;
    assert_eq!(s, StatusCode::CREATED);
    // Detail: zwei Sichtungen, neuester Cache + Person ist betroffen
    let (_, detail) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(detail["status"], "betroffen", "Sichtung hebt erfasst → betroffen");
    assert_eq!(detail["aktuelle_sichtung"], "sk1");
    assert_eq!(detail["sichtungen"].as_array().unwrap().len(), 2);
    // ETB: zwei Sichtungs-Einträge, kein Identitäts-Leak
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    let sichtung_etb: Vec<_> = inhalte.iter().filter(|i| i.contains("Sichtung")).collect();
    assert_eq!(sichtung_etb.len(), 2);
    assert!(sichtung_etb.iter().all(|i| i.contains("R-001")));
    assert!(sichtung_etb.iter().any(|i| i.contains("SK II")));
    assert!(sichtung_etb.iter().any(|i| i.contains("SK I")));
    assert!(sichtung_etb.iter().all(|i| !i.contains("Geheim") && !i.contains("Sehr") && !i.contains("verschlechtert")));
}

#[tokio::test]
async fn sichtung_tot_aendert_admin_status_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    // Vorab betroffen setzen (kein erfasst-Anheben verfälscht den Test)
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin, Some(r#"{"status":"betroffen"}"#)).await;
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"tot"}"#).await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(detail["status"], "betroffen", "Sichtung tot ändert Admin-Status NICHT");
    assert_eq!(detail["aktuelle_sichtung"], "tot");
}

#[tokio::test]
async fn sichtung_bei_vermisst_ist_422_und_unbekannte_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/status"), &admin, Some(r#"{"status":"vermisst"}"#)).await;
    let (s, _) = sichten(&app, &admin, e, p, r#"{"kategorie":"sk2"}"#).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "vermisste Person ist nicht anwesend");
    let p2 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = sichten(&app, &admin, e, p2, r#"{"kategorie":"sk7"}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unbekannte Kategorie");
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cargo test --test einsatz_person sichtung_`
Expected: FAIL (Route 404 / Handler fehlt)

- [ ] **Step 3: Handler implementieren**

In `src/routes/einsatz_person.rs` (z. B. nach `stornieren`) einfügen:

```rust
#[derive(Debug, Deserialize)]
pub struct SichtungBody {
    pub kategorie: String,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/sichtung — Sichtung erfassen.
/// Schreibberechtigt + aktiv. Hebt `erfasst→betroffen` (Annahme 5); bei
/// `vermisst`/`abgemeldet` → 422; bei storniert → 409. Sichtung=`tot` ändert
/// den Admin-Status NICHT (Annahme 4). Pseudonyme ETB-Spur + SSE.
pub async fn sichten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<SichtungBody>,
) -> Result<(StatusCode, Json<SichtungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let kategorie = Sichtungskategorie::parse(&body.kategorie)
        .ok_or_else(|| AppError::Validation("Unbekannte Sichtungskategorie".into()))?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann nicht gesichtet werden".into(),
        ));
    }
    // Anwesenheit: betroffen|verstorben ok; erfasst → anheben; sonst 422.
    let hebe_auf_betroffen = match person.status.as_str() {
        "betroffen" | "verstorben" => false,
        "erfasst" => true,
        _ => {
            return Err(AppError::UnprocessableEntity(format!(
                "Person ist nicht anwesend (Status {})",
                person.status
            )))
        }
    };
    let notiz = trimme(body.notiz);

    let sichtung = sichtung_repo::erfassen(
        &state.pool,
        einsatz_id,
        person_id,
        kategorie.as_str(),
        notiz.as_deref(),
        benutzer.id,
        hebe_auf_betroffen,
    )
    .await?;

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: Sichtung {}",
            registrier_anzeige(person.registrier_nr),
            kategorie.etb_label()
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(sichtung)))
}
```

- [ ] **Step 4: Route registrieren**

In `src/app.rs` nach der bestehenden `…/personen/{pid}/status`-Zeile einfügen:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/sichtung", post(routes::einsatz_person::sichten))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person sichtung_ && cargo test --test einsatz_person`
Expected: PASS (alle Sichtungs-Tests + bestehende grün)

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): POST /sichtung (Verlauf, Cache, erfasst-Anhebung, tot≠verstorben)"
```

---

## Task 10: Verbleib-Route + Tests

`POST /api/einsaetze/{id}/personen/{pid}/verbleib`. Schreibberechtigt + aktiv. Validiert `art` (Enum) und `status` (optional); berechnet Kurzform fürs Cache-Feld; ETB pseudonym; SSE.

**Files:**
- Modify: `src/routes/einsatz_person.rs` (Body, Handler)
- Modify: `src/app.rs` (Route registrieren)
- Modify: `tests/einsatz_person.rs` (Tests)

- [ ] **Step 1: Failing tests schreiben**

In `tests/einsatz_person.rs` ergänzen:

```rust
#[tokio::test]
async fn verbleib_transport_setzt_cache_und_etb_mit_ziel() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/verbleib"), &admin,
        Some(r#"{"art":"transport","transportmittel":"RTW 1","ziel":"KH Mitte","status":"abtransportiert"}"#),
    ).await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    assert_eq!(detail["aktueller_verbleib"], "Transport → KH Mitte");
    assert_eq!(detail["verbleib"].as_array().unwrap().len(), 1);
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte.iter().any(|i| i.contains("R-001") && i.contains("abtransportiert → KH Mitte")));
}

#[tokio::test]
async fn verbleib_ungueltige_art_ist_400_und_ungueltiger_status_auch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/verbleib"), &admin,
        Some(r#"{"art":"teleportation"}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/verbleib"), &admin,
        Some(r#"{"art":"transport","status":"unterwegs"}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cargo test --test einsatz_person verbleib_`
Expected: FAIL (Route 404)

- [ ] **Step 3: Handler implementieren**

In `src/routes/einsatz_person.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct VerbleibBody {
    pub art: String,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/verbleib — Verbleib-Ereignis erfassen.
/// Schreibberechtigt + aktiv. Cache-Kurzform via `VerbleibArt::kurzform`. Pseudonyme ETB-Spur + SSE.
pub async fn verbleib(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<VerbleibBody>,
) -> Result<(StatusCode, Json<VerbleibAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let art = VerbleibArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Verbleib-Art".into()))?;
    if let Some(s) = &body.status {
        if !matches!(s.as_str(), "angemeldet" | "abtransportiert") {
            return Err(AppError::Validation("Unbekannter Verbleib-Status".into()));
        }
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keinen Verbleib erhalten".into(),
        ));
    }
    let transportmittel = trimme(body.transportmittel);
    let ziel = trimme(body.ziel);
    let notiz = trimme(body.notiz);
    let kurzform = art.kurzform(ziel.as_deref());

    let verbleib = verbleib_repo::erfassen(
        &state.pool,
        einsatz_id,
        person_id,
        verbleib_repo::VerbleibDaten {
            art: art.as_str(),
            transportmittel: transportmittel.as_deref(),
            ziel: ziel.as_deref(),
            status: body.status.as_deref(),
            notiz: notiz.as_deref(),
        },
        &kurzform,
        benutzer.id,
    )
    .await?;

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: {}",
            registrier_anzeige(person.registrier_nr),
            art.etb_sachverhalt(ziel.as_deref())
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(verbleib)))
}
```

- [ ] **Step 4: Route registrieren**

In `src/app.rs` nach der `…/sichtung`-Zeile:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/verbleib", post(routes::einsatz_person::verbleib))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person verbleib_ && cargo test --test einsatz_person`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): POST /verbleib (Verlauf, Cache-Kurzform, ETB mit Ziel)"
```

---

## Task 11: Notizen-Route + Tests (KEIN ETB)

`POST /api/einsaetze/{id}/personen/{pid}/notizen`. Schreibberechtigt + aktiv. **Kein ETB-Eintrag** (besondere Kategorie). SSE als reines „refetch"-Signal.

**Files:**
- Modify: `src/routes/einsatz_person.rs` (Body, Handler)
- Modify: `src/app.rs` (Route)
- Modify: `tests/einsatz_person.rs` (Tests)

- [ ] **Step 1: Failing tests schreiben**

```rust
#[tokio::test]
async fn notiz_erscheint_im_detail_und_erzeugt_keinen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let vorher_etb = system_etb_inhalte(&app, &admin, e).await.len();
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/notizen"), &admin,
        Some(r#"{"text":"Platzwunde Stirn, stabil"}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    let (_, detail) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    let notizen = detail["notizen"].as_array().unwrap();
    assert_eq!(notizen.len(), 1);
    assert_eq!(notizen[0]["text"], "Platzwunde Stirn, stabil");
    // KEIN ETB-Eintrag (besondere Kategorie):
    assert_eq!(system_etb_inhalte(&app, &admin, e).await.len(), vorher_etb,
        "Befundnotiz darf KEINEN ETB-Eintrag erzeugen");
}

#[tokio::test]
async fn notiz_mit_leerem_text_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{}"#).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/notizen"), &admin,
        Some(r#"{"text":"  "}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cargo test --test einsatz_person notiz_`
Expected: FAIL

- [ ] **Step 3: Handler implementieren**

```rust
#[derive(Debug, Deserialize)]
pub struct NotizBody {
    pub text: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/notizen — append-only Befundnotiz.
/// Schreibberechtigt + aktiv. **KEIN ETB-Eintrag** (besondere Kategorie). SSE.
pub async fn notiz(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<NotizBody>,
) -> Result<(StatusCode, Json<NotizAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Notiztext darf nicht leer sein".into()));
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keine Notiz erhalten".into(),
        ));
    }
    let notiz = verlaufsnotiz_repo::anlegen(&state.pool, einsatz_id, person_id, text, benutzer.id).await?;
    // BEWUSST kein etb_system(): besondere Kategorie gehört NICHT in den ETB.
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(notiz)))
}
```

- [ ] **Step 4: Route registrieren**

In `src/app.rs`:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/notizen", post(routes::einsatz_person::notiz))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person notiz_ && cargo test --test einsatz_person`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): POST /notizen (append-only Befund, KEIN ETB)"
```

---

## Task 12: Abgleich-anlegen-Route + Tests

`POST /api/einsaetze/{id}/personen/{pid}/abgleich` — **`:pid` = vermisste Person** (`vermisst_person_id`), Body `{ gefunden_person_id }`. Schreibberechtigt + aktiv. Validiert: pid-Person muss Status `vermisst` haben, gefunden muss `betroffen`/`verstorben` sein; beide nicht storniert; nicht dieselbe Person; gefunden-Person muss zum selben Einsatz gehören (Org-Isolation via `repo::laden` → `404`). Mehrere Verdachts-Links erlaubt. **Kein ETB** (nur Bestätigung schreibt ETB), SSE für beide beteiligten Personen.

**Files:**
- Modify: `src/routes/einsatz_person.rs` (Body, Handler)
- Modify: `src/app.rs` (Route)
- Modify: `tests/einsatz_person.rs` (Tests)

- [ ] **Step 1: Failing tests schreiben**

```rust
async fn status_setzen(app: &axum::Router, cookie: &str, einsatz: i64, person: i64, status: &str) {
    let body = format!(r#"{{"status":"{status}"}}"#);
    let (s, _) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/status"), cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn abgleich_anlegen_verdacht_erlaubt_und_in_beiden_details_sichtbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let (s, j) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich"), &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g}}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(j["status"], "verdacht");
    // Sichtbar in beiden Detail-Antworten:
    let (_, dv) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{v}"), &admin, None).await;
    assert_eq!(dv["abgleiche"].as_array().unwrap().len(), 1);
    let (_, dg) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{g}"), &admin, None).await;
    assert_eq!(dg["abgleiche"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn abgleich_falsche_status_kombination_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;          // erfasst, NICHT vermisst
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    // pid-Person ist nicht vermisst → 422
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich"), &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g}}}"#))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Jetzt vermisst, aber gefunden ist erfasst → 422
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g2 = person_anlegen(&app, &admin, e, r#"{}"#).await;          // erfasst
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich"), &admin,
        Some(&format!(r#"{{"gefunden_person_id":{g2}}}"#))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cargo test --test einsatz_person abgleich_anlegen`
Expected: FAIL

- [ ] **Step 3: Handler implementieren**

```rust
#[derive(Debug, Deserialize)]
pub struct AbgleichBody {
    pub gefunden_person_id: i64,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich — Verdachts-Link anlegen.
/// `pid` = vermisste Person. Schreibberechtigt + aktiv. KEIN ETB; SSE für beide Personen.
pub async fn abgleich_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<AbgleichBody>,
) -> Result<(StatusCode, Json<AbgleichAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if body.gefunden_person_id == person_id {
        return Err(AppError::Validation(
            "Vermisste und gefundene Person müssen verschieden sein".into(),
        ));
    }
    let vermisst = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if vermisst.storniert_at.is_some() || vermisst.status != "vermisst" {
        return Err(AppError::UnprocessableEntity(
            "Abgleich nur ausgehend von einer vermissten Person".into(),
        ));
    }
    // `repo::laden` schützt org-isoliert: NotFound (404), falls in fremdem Einsatz.
    let gefunden = repo::laden(&state.pool, einsatz_id, body.gefunden_person_id).await?;
    if gefunden.storniert_at.is_some() || !matches!(gefunden.status.as_str(), "betroffen" | "verstorben") {
        return Err(AppError::UnprocessableEntity(
            "Gefundene Person muss Status betroffen/verstorben haben".into(),
        ));
    }

    let abgleich = abgleich_repo::anlegen_verdacht(
        &state.pool,
        einsatz_id,
        person_id,
        body.gefunden_person_id,
        benutzer.id,
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    sse_person(&state, einsatz_id, body.gefunden_person_id);
    Ok((StatusCode::CREATED, Json(abgleich)))
}
```

- [ ] **Step 4: Route registrieren**

In `src/app.rs`:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/abgleich", post(routes::einsatz_person::abgleich_anlegen))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person abgleich && cargo test --test einsatz_person`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): POST /abgleich (Verdacht anlegen, vermisst↔betroffen/verstorben)"
```

---

## Task 13: Abgleich-Entscheidungs-Route + Tests

`POST /api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung` — **nur Einsatzleitung**. Routing-Invariante: `abgleich.vermisst_person_id == pid`, sonst `404`. Nur aus `verdacht` heraus (sonst `409`). Bei `bestaetigt`: ETB „Vermisstmeldung R‑x aufgeklärt — identisch mit R‑y" + Vermissterabgleich-Update (Repo erledigt die Statusänderung). Zweiter `bestaetigt` je Vermisstmeldung → `Conflict` (Unique-Index). SSE für beide Personen.

**Files:**
- Modify: `src/routes/einsatz_person.rs` (Body, Handler)
- Modify: `src/app.rs` (Route)
- Modify: `tests/einsatz_person.rs` (Tests)

- [ ] **Step 1: Failing tests schreiben**

```rust
async fn abgleich_anlegen_helper(app: &axum::Router, cookie: &str, einsatz: i64, vermisst: i64, gefunden: i64) -> i64 {
    let body = format!(r#"{{"gefunden_person_id":{gefunden}}}"#);
    let (s, j) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{vermisst}/abgleich"), cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED);
    j["id"].as_i64().unwrap()
}

#[tokio::test]
async fn entscheidung_bestaetigt_meldet_ab_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let aid = abgleich_anlegen_helper(&app, &admin, e, v, g).await;
    let (s, j) = anfrage(&app, "POST",
        &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"), &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["status"], "bestaetigt");
    // Vermisstmeldung ist abgemeldet:
    let (_, dv) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{v}"), &admin, None).await;
    assert_eq!(dv["status"], "abgemeldet");
    // ETB „Vermisstmeldung R-001 aufgeklärt — identisch mit R-002"
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert!(inhalte.iter().any(|i|
        i.contains("Vermisstmeldung R-001") && i.contains("aufgeklärt") && i.contains("R-002")),
        "ETB-Bestätigung fehlt oder unvollständig: {inhalte:?}");
}

#[tokio::test]
async fn zweiter_bestaetigter_je_vermisstmeldung_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g1 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g1, "betroffen").await;
    let g2 = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g2, "betroffen").await;
    let a1 = abgleich_anlegen_helper(&app, &admin, e, v, g1).await;
    let a2 = abgleich_anlegen_helper(&app, &admin, e, v, g2).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{a1}/entscheidung"), &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#)).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{a2}/entscheidung"), &admin,
        Some(r#"{"entscheidung":"bestaetigt"}"#)).await;
    // Achtung: nach dem ersten bestaetigt ist v=abgemeldet → der Status-Check des zweiten Aufrufs greift, BEVOR der Unique-Index feuert. Spec verlangt 409 für den Doppel-bestaetigt; der Unique-Index ist die Garantie, der Status-Check ist freundlicher: beides ist akzeptabel und konsistent.
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn entscheidung_nur_einsatzleitung_und_pid_invariante() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fueh_id = benutzer_anlegen(&app, &admin, "fuehr2", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, fueh_id, "fuehrungspersonal").await;
    let v = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, v, "vermisst").await;
    let g = person_anlegen(&app, &admin, e, r#"{}"#).await;
    status_setzen(&app, &admin, e, g, "betroffen").await;
    let aid = abgleich_anlegen_helper(&app, &admin, e, v, g).await;
    // Führungspersonal (Schreibrecht, aber keine Leitung) → 403
    let fueh = login_cookie(&app, "fuehr2", "fuehr2pw1").await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"), &fueh,
        Some(r#"{"entscheidung":"verworfen"}"#)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // pid-Invariante: Aufruf mit falscher pid → 404 (Abgleich gehört dort nicht hin)
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{g}/abgleich/{aid}/entscheidung"), &admin,
        Some(r#"{"entscheidung":"verworfen"}"#)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Verworfen lässt den Status unverändert:
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{v}/abgleich/{aid}/entscheidung"), &admin,
        Some(r#"{"entscheidung":"verworfen"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    let (_, dv) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/personen/{v}"), &admin, None).await;
    assert_eq!(dv["status"], "vermisst", "verworfen ändert den Status nicht");
}
```

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cargo test --test einsatz_person entscheidung`
Expected: FAIL

- [ ] **Step 3: Handler implementieren**

```rust
#[derive(Debug, Deserialize)]
pub struct EntscheidungBody {
    pub entscheidung: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung — bestätigen
/// oder verwerfen. **Nur Einsatzleitung** (Annahme 8). Routing-Invariante:
/// `abgleich.vermisst_person_id == pid`, sonst `404`. Nur aus `verdacht` heraus
/// (sonst `409`). Bei `bestaetigt`: Vermisstmeldung → `abgemeldet` + pseudonyme
/// ETB-Spur. SSE für beide beteiligten Personen.
pub async fn abgleich_entscheiden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id, abgleich_id)): Path<(i64, i64, i64)>,
    Json(body): Json<EntscheidungBody>,
) -> Result<Json<AbgleichAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !matches!(body.entscheidung.as_str(), "bestaetigt" | "verworfen") {
        return Err(AppError::Validation(
            "Entscheidung muss 'bestaetigt' oder 'verworfen' sein".into(),
        ));
    }
    let abgleich = abgleich_repo::laden(&state.pool, einsatz_id, abgleich_id).await?;
    if abgleich.vermisst_person_id != person_id {
        // pid-Invariante verletzt: nicht der Pfad zu DIESEM Abgleich.
        return Err(AppError::NotFound);
    }
    if abgleich.status != "verdacht" {
        return Err(AppError::Conflict("Abgleich ist bereits entschieden".into()));
    }
    let entschieden = abgleich_repo::entscheide(
        &state.pool,
        einsatz_id,
        abgleich_id,
        &body.entscheidung,
        benutzer.id,
    )
    .await?;

    if body.entscheidung == "bestaetigt" {
        let vermisst = repo::laden(&state.pool, einsatz_id, abgleich.vermisst_person_id).await?;
        let gefunden = repo::laden(&state.pool, einsatz_id, abgleich.gefunden_person_id).await?;
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!(
                "Vermisstmeldung {} aufgeklärt — identisch mit {}",
                registrier_anzeige(vermisst.registrier_nr),
                registrier_anzeige(gefunden.registrier_nr)
            ),
        )
        .await?;
    }
    sse_person(&state, einsatz_id, abgleich.vermisst_person_id);
    sse_person(&state, einsatz_id, abgleich.gefunden_person_id);
    Ok(Json(entschieden))
}
```

- [ ] **Step 4: Route registrieren**

In `src/app.rs`:

```rust
        .route("/api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung",
               post(routes::einsatz_person::abgleich_entscheiden))
```

- [ ] **Step 5: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person`
Expected: PASS (alle E‑1- und E‑2-Tests grün)

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs src/app.rs tests/einsatz_person.rs
git commit -m "feat(person): POST /abgleich/{aid}/entscheidung (nur Leitung, ETB, →abgemeldet)"
```

---

## Task 14: Querschnittliche Leak- und SSE-Tests

Sicherstellen: (a) ETB enthält **nie** Identität (`name`/`vorname`) oder Befundtext; (b) SSE-Payload enthält **nur** `einsatz_id`+`person_id`. Diese Tests fangen Regressionen, falls jemand später ETB-Texte um „mehr Kontext" anreichert.

**Files:**
- Modify: `tests/einsatz_person.rs` (Cross-cutting Tests)

- [ ] **Step 1: ETB-Leak-Test schreiben**

```rust
#[tokio::test]
async fn etb_enthaelt_keine_identitaet_und_keinen_befundtext() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Mustermann","vorname":"Max"}"#).await;
    // Sichtung + Verbleib + Notiz
    sichten(&app, &admin, e, p, r#"{"kategorie":"sk1","notiz":"GANZ_GEHEIME_KURZBEGRUENDUNG"}"#).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/verbleib"), &admin,
        Some(r#"{"art":"transport","ziel":"KH Mitte"}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/notizen"), &admin,
        Some(r#"{"text":"VERTRAULICHER_BEFUND_XYZ"}"#)).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    for i in &inhalte {
        assert!(!i.contains("Mustermann"), "ETB-Leak (name): {i}");
        assert!(!i.contains("Max"), "ETB-Leak (vorname): {i}");
        assert!(!i.contains("VERTRAULICHER_BEFUND_XYZ"), "ETB-Leak (befundtext): {i}");
        assert!(!i.contains("GANZ_GEHEIME_KURZBEGRUENDUNG"), "ETB-Leak (sichtungsnotiz): {i}");
    }
    // Notiz darf KEINEN ETB-Eintrag erzeugt haben → kein Eintrag mit "Notiz" o.ä.
    assert!(inhalte.iter().all(|i| !i.to_lowercase().contains("notiz")), "Notiz darf kein ETB schreiben: {inhalte:?}");
}
```

- [ ] **Step 2: SSE-Payload-Test schreiben**

Verifiziere direkt am `LiveHub`, dass `person`-Events nur `einsatz_id`/`person_id` enthalten (kein Befundtext, keine Identität). Der einfachste Weg: einen Abonnenten vor den Aktionen erstellen, dann lesen.

```rust
#[tokio::test]
async fn sse_person_event_enthaelt_nur_ids_keinen_befundtext() {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let live = lifeline_hub::live::LiveHub::new();
    let app = lifeline_hub::app::build_router(lifeline_hub::app::AppState { pool: pool.clone(), live: live.clone() });
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, r#"{"name":"Mustermann"}"#).await;
    let mut rx = live.abonniere(e);

    // Eine Notiz auslösen (enthält sensiblen Text → muss im SSE NICHT auftauchen)
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/personen/{p}/notizen"), &admin,
        Some(r#"{"text":"GEHEIM_XYZ_BEFUND"}"#)).await;

    // Es gibt potenziell mehrere Events (etb für vorherige Anlegen-ETB-Einträge); wir
    // suchen das nach der Notiz erwartete `person`-Event und prüfen seinen Payload.
    let mut gefunden = false;
    for _ in 0..10 {
        match tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await {
            Ok(Ok(n)) if n.event == "person" => {
                assert!(!n.data.contains("GEHEIM_XYZ_BEFUND"), "SSE leakt Befundtext: {}", n.data);
                assert!(!n.data.contains("Mustermann"), "SSE leakt Name: {}", n.data);
                // Erwartetes Format: { einsatz_id, person_id }
                let v: Value = serde_json::from_str(&n.data).unwrap();
                assert!(v.get("einsatz_id").is_some() && v.get("person_id").is_some());
                assert_eq!(v.as_object().unwrap().len(), 2, "person-SSE darf NUR einsatz_id+person_id enthalten");
                gefunden = true;
                break;
            }
            Ok(Ok(_)) => continue,    // andere Events ignorieren
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(gefunden, "Kein `person`-SSE-Event empfangen");
}
```

- [ ] **Step 3: Tests ausführen — müssen bestehen**

Run: `cargo test --test einsatz_person etb_enthaelt && cargo test --test einsatz_person sse_person_event`
Expected: PASS

- [ ] **Step 4: Voller Backend-Regressionscheck**

Run: `cargo test`
Expected: PASS (alle Tests grün)

- [ ] **Step 5: Commit**

```bash
git add tests/einsatz_person.rs
git commit -m "test(person): ETB-Leak-Schutz + SSE-Payload-Minimalität (E-2 Cross-cutting)"
```

---

## Task 15: Frontend-Typen + API-Client

`Person` um Cache-Felder erweitern (E‑2 Backend liefert sie immer); neue Typen für Sichtung/Notiz/Verbleib/Abgleich + `PersonDetail` (extends Person mit Verlauf-Arrays). API-Funktionen für die fünf neuen POST-Endpunkte; `ladePerson` liefert nun `PersonDetail`.

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/einsatzPerson.ts`

- [ ] **Step 1: Typen erweitern**

In `frontend/src/api/types.ts` die `Person`-Schnittstelle um drei Felder ergänzen (nach `storniert_at`):

```ts
  storniert_at: string | null;
  // E‑2: medizinischer Cache (null = ungesichtet / vor Ort)
  aktuelle_sichtung: Sichtungskategorie | null;
  aktuelle_sichtung_at: string | null;
  aktueller_verbleib: string | null;
}
```

Direkt nach dem `Person`-Block (vor `PersonZugriff`) ergänzen:

```ts
export type Sichtungskategorie = 'sk1' | 'sk2' | 'sk3' | 'sk4' | 'tot' | 'unverletzt';
export type VerbleibArt = 'transport' | 'entlassung' | 'vor_ort' | 'verstorben';
export type VerbleibStatus = 'angemeldet' | 'abtransportiert';
export type AbgleichStatus = 'verdacht' | 'bestaetigt' | 'verworfen';

export interface Sichtung {
  id: number;
  einsatz_id: number;
  person_id: number;
  kategorie: Sichtungskategorie;
  notiz: string | null;
  gesichtet_at: string;
  gesichtet_von: number;
}

export interface Verlaufsnotiz {
  id: number;
  einsatz_id: number;
  person_id: number;
  text: string;
  erfasst_at: string;
  erfasst_von: number;
}

export interface Verbleib {
  id: number;
  einsatz_id: number;
  person_id: number;
  art: VerbleibArt;
  transportmittel: string | null;
  ziel: string | null;
  status: VerbleibStatus | null;
  notiz: string | null;
  zeitpunkt_at: string;
  erfasst_von: number;
}

export interface Abgleich {
  id: number;
  einsatz_id: number;
  vermisst_person_id: number;
  gefunden_person_id: number;
  status: AbgleichStatus;
  erstellt_at: string;
  erstellt_von: number;
  entschieden_at: string | null;
  entschieden_von: number | null;
}

/** Detail-Antwort: alle Person-Felder PLUS die vier E‑2-Verlauf-Arrays. */
export interface PersonDetail extends Person {
  sichtungen: Sichtung[];
  notizen: Verlaufsnotiz[];
  verbleib: Verbleib[];
  abgleiche: Abgleich[];
}
```

- [ ] **Step 2: API-Client erweitern**

In `frontend/src/api/einsatzPerson.ts`:

```ts
import type {
  Person, PersonDetail, PersonStatus, PersonZugriff,
  Sichtung, Sichtungskategorie, Verbleib, VerbleibArt, VerbleibStatus,
  Verlaufsnotiz, Abgleich,
} from './types';
```

`ladePerson` Rückgabetyp auf `PersonDetail` ändern:

```ts
export function ladePerson(einsatzId: number, personId: number): Promise<PersonDetail> {
  // Schreibt serverseitig EINEN detail-Audit-Eintrag (E‑1-Mechanik, unverändert
  // in E‑2 — der medizinische Verlauf ist Teil derselben Antwort).
  return apiGet<PersonDetail>(`/api/einsaetze/${einsatzId}/personen/${personId}`);
}
```

Am Ende der Datei (nach `registrierAnzeige`) die neuen Funktionen anhängen:

```ts
/** E‑2: Sichtung (Triage) erfassen. Hebt erfasst→betroffen serverseitig an. */
export function erfasseSichtung(
  einsatzId: number, personId: number,
  kategorie: Sichtungskategorie, notiz?: string | null,
): Promise<Sichtung> {
  return apiSend<Sichtung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/sichtung`,
    'POST', { kategorie, notiz: notiz ?? null },
  );
}

export interface VerbleibEingabe {
  art: VerbleibArt;
  transportmittel?: string | null;
  ziel?: string | null;
  status?: VerbleibStatus | null;
  notiz?: string | null;
}
export function erfasseVerbleib(
  einsatzId: number, personId: number, daten: VerbleibEingabe,
): Promise<Verbleib> {
  return apiSend<Verbleib>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verbleib`, 'POST', daten,
  );
}

/** E‑2: Befund-/Verlaufsnotiz (append-only, KEIN ETB-Eintrag). */
export function legeNotizAn(
  einsatzId: number, personId: number, text: string,
): Promise<Verlaufsnotiz> {
  return apiSend<Verlaufsnotiz>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/notizen`, 'POST', { text },
  );
}

/** E‑2: Vermisstenabgleich vorschlagen (Verdacht). `vermisstPersonId` ist :pid. */
export function schlageAbgleichVor(
  einsatzId: number, vermisstPersonId: number, gefundenPersonId: number,
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich`,
    'POST', { gefunden_person_id: gefundenPersonId },
  );
}

/** E‑2: Abgleich entscheiden — nur Einsatzleitung. */
export function entscheideAbgleich(
  einsatzId: number, vermisstPersonId: number, abgleichId: number,
  entscheidung: 'bestaetigt' | 'verworfen',
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich/${abgleichId}/entscheidung`,
    'POST', { entscheidung },
  );
}
```

- [ ] **Step 3: Typecheck + bestehende Frontend-Tests grün lassen**

Run: `cd frontend && npm run typecheck && npm test -- PersonenPage`
Expected: PASS — die bestehenden `PersonenPage`-Tests verwenden weiterhin `Person`-kompatible Mock-Objekte (die neuen Felder sind optional/null und müssen in Mocks nur ergänzt werden, falls TypeScript meckert; sonst Mock-`person` um `aktuelle_sichtung: null, aktuelle_sichtung_at: null, aktueller_verbleib: null` ergänzen).

> **Hinweis für den Implementer:** Wenn `tsc` die Mock-`person` in `PersonenPage.test.tsx` als unvollständig meldet, füge die drei `null`-Felder dem `person`-Konstanten-Objekt hinzu — keine Test-Logik ändert sich.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzPerson.ts frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): E-2-Typen + API-Funktionen (Sichtung, Verbleib, Notiz, Abgleich)"
```

---

## Task 16: Liste — SK-Spalte/-Badge + Lagebild-Zählung

Die Personen-Liste erhält eine SK-Spalte (Farbbadge je Kategorie) und über der Tabelle einen kleinen Lagebild-Streifen mit Zählungen je SK + „ungesichtet" + „unverletzt" (Spec: drei Gruppen).

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

In `PersonenPage.test.tsx` ergänzen:

```ts
it('zeigt SK-Badge und Lagebild-Zählungen', async () => {
  const gesichtet = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
    aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
  render(einsatzAktiv, [person, unbekannt, gesichtet]);
  // Liste-Sicht „Alle" wählen, dann nach SK-Tag suchen
  await screen.findByText('R-001');
  await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
  expect(await screen.findByText('SK II')).toBeInTheDocument();
  // Lagebild: „SK II: 1", „ungesichtet: 2" (person + unbekannt)
  expect(screen.getByText(/SK II:\s*1/)).toBeInTheDocument();
  expect(screen.getByText(/ungesichtet:\s*2/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: FAIL

- [ ] **Step 3: SK-Badge-Helper + Spalte + Lagebild implementieren**

In `PersonenPage.tsx` oberhalb von `STATUS_META` ergänzen:

```ts
import type { Sichtungskategorie } from '../api/types';

const SK_META: Record<Sichtungskategorie, { label: string; color: string }> = {
  sk1: { label: 'SK I', color: 'red' },
  sk2: { label: 'SK II', color: 'gold' },
  sk3: { label: 'SK III', color: 'green' },
  sk4: { label: 'SK IV', color: 'blue' },
  tot: { label: 'tot', color: 'black' },
  unverletzt: { label: 'unverletzt', color: 'default' },
};

/** Zählt je SK-Kategorie + Gruppen „ungesichtet" und „unverletzt" (Spec-Drei-Teilung). */
function lagebildZaehlung(alle: Person[]): { sk: Record<Sichtungskategorie, number>; ungesichtet: number } {
  const sk: Record<Sichtungskategorie, number> = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0 };
  let ungesichtet = 0;
  for (const p of alle) {
    if (p.aktuelle_sichtung) sk[p.aktuelle_sichtung]++;
    else ungesichtet++;
  }
  return { sk, ungesichtet };
}
```

Die `spalten`-Konstante um eine SK-Spalte nach `status` erweitern:

```ts
    {
      title: 'SK', key: 'sk', width: 90,
      render: (_, p) =>
        p.aktuelle_sichtung
          ? <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>
          : <Typography.Text type="secondary">—</Typography.Text>,
    },
```

Direkt vor `<Table>` einen Lagebild-Streifen einfügen:

```tsx
{(() => {
  const z = lagebildZaehlung(alle);
  const skTags = (Object.keys(z.sk) as Sichtungskategorie[])
    .filter((k) => z.sk[k] > 0)
    .map((k) => (
      <Tag key={k} color={SK_META[k].color}>{SK_META[k].label}: {z.sk[k]}</Tag>
    ));
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary">Lagebild:</Typography.Text>
      {skTags.length > 0 ? skTags : <Typography.Text type="secondary">noch keine Sichtungen</Typography.Text>}
      <Tag>ungesichtet: {z.ungesichtet}</Tag>
    </Space>
  );
})()}
```

- [ ] **Step 4: Tests ausführen — müssen bestehen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): SK-Spalte mit Farb-Badge + Lagebild-Zählung über der Tabelle"
```

---

## Task 17: Detail-Drawer — Tab „Medizinischer Verlauf"

Drawer auf Tabs umstellen: „Stammdaten" (bisheriger Inhalt) und „Medizinischer Verlauf" (neu). Im neuen Tab: aktuelle Sichtung als Badge; **Re-Sichten**-Aktion (Kategorie + Notiz); bei `tot` ein Hinweis-Button „Status → verstorben"; **Notiz anlegen**; **Verbleib erfassen** (art + Felder); merged chronologischer Verlauf (Sichtungen + Notizen + Verbleib, neueste zuerst). Schreibaktionen für Beobachter / abgeschlossenen Einsatz disabled (E‑1-Muster: `darfSchreiben`-Flag).

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing tests schreiben**

```ts
it('Re-Sichten-Aktion ruft erfasseSichtung mit SK II und löst Refetch aus', async () => {
  const detail: PersonDetail = { ...person, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
    aktueller_verbleib: null, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] };
  let gerufen: { kategorie?: string } = {};
  server.use(
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)),
    http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
      gerufen = await request.json() as { kategorie?: string };
      return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
        notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }, { status: 201 });
    }),
  );
  render(einsatzAktiv, [person]);
  await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
  await userEvent.click(await screen.findByRole('tab', { name: 'Medizinischer Verlauf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Re-Sichten' }));
  await userEvent.click(await screen.findByText('SK II'));
  await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
  await vi.waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
});

it('zeigt bei Sichtung=tot den Hinweis „Status → verstorben"', async () => {
  const detail: PersonDetail = { ...person, aktuelle_sichtung: 'tot', aktuelle_sichtung_at: '2026-05-27 10:00:00',
    aktueller_verbleib: null, sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'tot',
      notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }],
    notizen: [], verbleib: [], abgleiche: [] };
  server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
  render(einsatzAktiv, [person]);
  await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
  await userEvent.click(await screen.findByRole('tab', { name: 'Medizinischer Verlauf' }));
  expect(await screen.findByRole('button', { name: /Status → verstorben/ })).toBeInTheDocument();
});
```

> **Hinweis:** `PersonDetail` aus `../api/types` im Test-File importieren.

- [ ] **Step 2: Tests ausführen — müssen fehlschlagen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: FAIL

- [ ] **Step 3: Drawer-Inhalt auf Tabs umstellen + neuen Tab implementieren**

In `PersonenPage.tsx`:

(a) Neue Mutationen + Modal-State direkt neben den bestehenden Mutationen ergänzen:

```ts
import { erfasseSichtung, erfasseVerbleib, legeNotizAn,
  schlageAbgleichVor, entscheideAbgleich } from '../api/einsatzPerson';
import type { PersonDetail, Sichtung, Sichtungskategorie, Verbleib, VerbleibArt, Verlaufsnotiz, Abgleich } from '../api/types';

const [reSichtenOffen, setReSichtenOffen] = useState(false);
const [sichtungForm] = Form.useForm<{ kategorie: Sichtungskategorie; notiz?: string }>();
const sichtungMutation = useMutation({
  mutationFn: (v: { kategorie: Sichtungskategorie; notiz?: string }) =>
    erfasseSichtung(einsatzId, offenePersonId!, v.kategorie, v.notiz ?? null),
  onSuccess: () => { invalidateDetail(); setReSichtenOffen(false); sichtungForm.resetFields(); },
  onError: fehler,
});

const [notizForm] = Form.useForm<{ text: string }>();
const notizMutation = useMutation({
  mutationFn: (v: { text: string }) => legeNotizAn(einsatzId, offenePersonId!, v.text),
  onSuccess: () => { invalidateDetail(); notizForm.resetFields(); },
  onError: fehler,
});

const [verbleibOffen, setVerbleibOffen] = useState(false);
const [verbleibForm] = Form.useForm<{ art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }>();
const verbleibMutation = useMutation({
  mutationFn: (v: { art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }) =>
    erfasseVerbleib(einsatzId, offenePersonId!, {
      art: v.art, ziel: v.ziel ?? null, transportmittel: v.transportmittel ?? null,
      status: v.art === 'transport' ? 'abtransportiert' : null, notiz: v.notiz ?? null,
    }),
  onSuccess: () => { invalidateDetail(); setVerbleibOffen(false); verbleibForm.resetFields(); },
  onError: fehler,
});
```

(b) Im Drawer den bisherigen Inhalt in einen `Tabs` mit zwei Reitern packen. Das vorhandene `<Space direction="vertical">` mit Status-Buttons + Beschreibung + Audit-Tabelle wandert in Tab „Stammdaten"; neuer Tab „Medizinischer Verlauf" mit folgender Struktur (innerhalb des Drawers, ersetzt den IIFE-Block, der die Detail-Inhalte rendert):

```tsx
<Tabs
  items={[
    {
      key: 'stamm',
      label: 'Stammdaten',
      children: (
        /* … BESTEHENDER Inhalt aus dem IIFE: STATUS-Tags, Übergangs-Buttons,
           Bearbeiten-Form / Descriptions, Audit-Tabelle. */
      ),
    },
    {
      key: 'med',
      label: 'Medizinischer Verlauf',
      children: (() => {
        const p = detailQuery.data!;
        const eintraege: Array<{ key: string; at: string; node: React.ReactNode }> = [
          ...p.sichtungen.map((s) => ({
            key: `s-${s.id}`, at: s.gesichtet_at,
            node: <span><Tag color={SK_META[s.kategorie].color}>{SK_META[s.kategorie].label}</Tag>
              {s.notiz && <Typography.Text type="secondary"> — {s.notiz}</Typography.Text>}</span>,
          })),
          ...p.notizen.map((n) => ({
            key: `n-${n.id}`, at: n.erfasst_at,
            node: <span><Tag>Notiz</Tag> {n.text}</span>,
          })),
          ...p.verbleib.map((v) => ({
            key: `v-${v.id}`, at: v.zeitpunkt_at,
            node: <span><Tag color="purple">Verbleib</Tag> {kurzVerbleib(v)}</span>,
          })),
        ].sort((a, b) => b.at.localeCompare(a.at));
        return (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Space wrap>
              {p.aktuelle_sichtung
                ? <Tag color={SK_META[p.aktuelle_sichtung].color}>SK: {SK_META[p.aktuelle_sichtung].label}</Tag>
                : <Tag>ungesichtet</Tag>}
              {p.aktueller_verbleib && <Tag color="purple">{p.aktueller_verbleib}</Tag>}
            </Space>
            {darfSchreiben && !p.storniert_at && (
              <Space wrap>
                <Button onClick={() => setReSichtenOffen(true)}>Re-Sichten</Button>
                <Button onClick={() => setVerbleibOffen(true)}>Verbleib erfassen</Button>
              </Space>
            )}
            {/* Tot-Hinweis: separat sichtbar, wenn aktuelle Sichtung = tot, Person aber noch nicht verstorben */}
            {darfSchreiben && p.aktuelle_sichtung === 'tot' && p.status !== 'verstorben' && (
              <Alert
                type="warning" showIcon
                message="Sichtung = tot. Admin-Status wurde NICHT automatisch geändert."
                action={
                  <Button size="small" onClick={() => statusMutation.mutate({ personId: p.id, status: 'verstorben' })}>
                    Status → verstorben
                  </Button>
                }
              />
            )}
            {darfSchreiben && !p.storniert_at && (
              <Form form={notizForm} layout="vertical" onFinish={notizMutation.mutate}>
                <Form.Item label="Befund/Verlaufsnotiz (append-only, kein ETB)" name="text"
                  rules={[{ required: true, message: 'Bitte Text eingeben' }]}>
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={notizMutation.isPending}>Notiz anlegen</Button>
              </Form>
            )}
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                Chronologischer Verlauf (neueste zuerst)
              </Typography.Text>
              {eintraege.length === 0
                ? <Typography.Text type="secondary"> noch leer</Typography.Text>
                : <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                    {eintraege.map((e) => (
                      <li key={e.key} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>{e.at}</Typography.Text>
                        {e.node}
                      </li>
                    ))}
                  </ul>}
            </div>
          </Space>
        );
      })(),
    },
  ]}
/>
```

(c) Helper `kurzVerbleib` und die Modale „Re-Sichten" / „Verbleib erfassen" oberhalb von `return (`:

```ts
function kurzVerbleib(v: Verbleib): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport': return `Transport${ziel}${tm}`;
    case 'entlassung': return 'entlassen';
    case 'vor_ort': return 'verbleibt vor Ort';
    case 'verstorben': return 'Verbleib des Leichnams';
  }
}
```

```tsx
<Modal
  open={reSichtenOffen}
  title="Sichtung erfassen"
  okText="Übernehmen"
  confirmLoading={sichtungMutation.isPending}
  onOk={() => sichtungForm.submit()}
  onCancel={() => { setReSichtenOffen(false); sichtungForm.resetFields(); }}
  destroyOnClose
>
  <Form form={sichtungForm} layout="vertical" onFinish={sichtungMutation.mutate}>
    <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
      <Select options={(Object.keys(SK_META) as Sichtungskategorie[]).map((k) => ({ value: k, label: SK_META[k].label }))} />
    </Form.Item>
    <Form.Item label="Kurzbegründung (optional)" name="notiz">
      <Input />
    </Form.Item>
  </Form>
</Modal>

<Modal
  open={verbleibOffen}
  title="Verbleib erfassen"
  okText="Erfassen"
  confirmLoading={verbleibMutation.isPending}
  onOk={() => verbleibForm.submit()}
  onCancel={() => { setVerbleibOffen(false); verbleibForm.resetFields(); }}
  destroyOnClose
>
  <Form form={verbleibForm} layout="vertical" onFinish={verbleibMutation.mutate}>
    <Form.Item label="Art" name="art" rules={[{ required: true }]}>
      <Select options={[
        { value: 'transport', label: 'Transport' },
        { value: 'entlassung', label: 'Entlassung vor Ort' },
        { value: 'vor_ort', label: 'verbleibt vor Ort' },
        { value: 'verstorben', label: 'Verbleib des Leichnams' },
      ]} />
    </Form.Item>
    <Form.Item label="Ziel (z. B. Krankenhaus, Freitext)" name="ziel"><Input /></Form.Item>
    <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel"><Input /></Form.Item>
    <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
  </Form>
</Modal>
```

> **Hinweis:** `detailQuery.data!` ist im Tab-Block sicher, weil der Tabs-Container nur im äußeren Block gerendert wird, wenn `detailQuery.data` existiert (analog zum bestehenden IIFE). Wenn der Build über `detailQuery.data` als `undefined` mosert, den gesamten `Tabs`-Block in das bestehende `detailQuery.data && (() => { … })()`-IIFE schieben.

- [ ] **Step 4: Tests ausführen — müssen bestehen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): Drawer-Tab „Medizinischer Verlauf" (Re-Sichten, Notiz, Verbleib, tot-Hinweis)"
```

---

## Task 18: Vermisstenabgleich-Flow

In der Vermisst-Sicht je Eintrag „Abgleich vorschlagen" (Dropdown mit gefundenen Personen → Verdacht). Im Detail-Drawer der vermissten Person eine Liste offener Verdachts-Links mit „Bestätigen/Verwerfen" (Bestätigen-Button nur für Einsatzleitung aktiv).

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

```ts
it('Einsatzleitung kann einen Verdachts-Abgleich bestätigen', async () => {
  const vermisst = { ...person, id: 20, status: 'vermisst' as const };
  const gefunden = { ...person, id: 21, registrier_nr: 4, status: 'betroffen' as const };
  const detail: PersonDetail = { ...vermisst, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
    aktueller_verbleib: null, sichtungen: [], notizen: [], verbleib: [],
    abgleiche: [{ id: 5, einsatz_id: 1, vermisst_person_id: 20, gefunden_person_id: 21,
      status: 'verdacht', erstellt_at: '2026-05-27 10:00:00', erstellt_von: 1,
      entschieden_at: null, entschieden_von: null }] };
  let entscheidung: string | undefined;
  server.use(
    http.get('/api/einsaetze/1/personen/20', () => HttpResponse.json(detail)),
    http.post('/api/einsaetze/1/personen/20/abgleich/5/entscheidung', async ({ request }) => {
      entscheidung = ((await request.json()) as { entscheidung: string }).entscheidung;
      return HttpResponse.json({ ...detail.abgleiche[0], status: 'bestaetigt' });
    }),
  );
  render(einsatzAktiv, [vermisst, gefunden]);
  await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
  await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
  await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
  await vi.waitFor(() => expect(entscheidung).toBe('bestaetigt'));
});
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: FAIL

- [ ] **Step 3: „Abgleich vorschlagen" + Entscheidungs-Aktionen implementieren**

(a) Neue Mutationen oben bei den anderen ergänzen:

```ts
const abgleichVorschlagMutation = useMutation({
  mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
    schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
  onSuccess: () => { invalidateDetail(); message.success('Verdachts-Abgleich angelegt'); },
  onError: fehler,
});
const abgleichEntscheidenMutation = useMutation({
  mutationFn: (v: { vermisstId: number; abgleichId: number; entscheidung: 'bestaetigt' | 'verworfen' }) =>
    entscheideAbgleich(einsatzId, v.vermisstId, v.abgleichId, v.entscheidung),
  onSuccess: invalidateDetail, onError: fehler,
});
```

(b) Im Tab „Medizinischer Verlauf" zusätzlich nach dem Lagebild-Block die offenen Verdachts-Links rendern:

```tsx
{p.abgleiche.length > 0 && (
  <div>
    <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
      Vermisstenabgleich
    </Typography.Text>
    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {p.abgleiche.map((a) => (
        <li key={a.id} style={{ padding: '4px 0' }}>
          <Tag color={a.status === 'bestaetigt' ? 'green' : a.status === 'verworfen' ? 'default' : 'gold'}>{a.status}</Tag>
          <Typography.Text>
            R-{String(a.vermisst_person_id === p.id ? a.gefunden_person_id : a.vermisst_person_id).padStart(3, '0')}
          </Typography.Text>
          {a.status === 'verdacht' && a.vermisst_person_id === p.id && (
            <Space style={{ marginLeft: 12 }}>
              <Button size="small" type="primary"
                disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                onClick={() => abgleichEntscheidenMutation.mutate({
                  vermisstId: p.id, abgleichId: a.id, entscheidung: 'bestaetigt' })}>
                Bestätigen
              </Button>
              <Button size="small" danger
                disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                onClick={() => abgleichEntscheidenMutation.mutate({
                  vermisstId: p.id, abgleichId: a.id, entscheidung: 'verworfen' })}>
                Verwerfen
              </Button>
            </Space>
          )}
        </li>
      ))}
    </ul>
  </div>
)}
```

(c) In der Tabellenspalten-Definition für die Vermisst-Sicht eine „Aktionen"-Spalte (oder ein Inline-`Select` in der Spalte „Aktion") für „Abgleich vorschlagen". Pragmatisch: eine zusätzliche Tabellen-Spalte „Aktion", die nur in der Sicht `vermisst` gerendert wird und einen `Select` mit den **gefundenen** Personen (status in `betroffen`/`verstorben`) zeigt:

```ts
const gefundene = alle.filter((p) => ['betroffen', 'verstorben'].includes(p.status) && !p.storniert_at);

const aktionsSpalte = darfSchreiben && sicht === 'vermisst' ? [{
  title: 'Abgleich vorschlagen', key: 'abgleich', width: 220,
  render: (_: unknown, v: Person) => (
    <Select<number> placeholder="gefundene Person …" size="small" style={{ width: 200 }}
      onClick={(e) => e.stopPropagation()}
      onChange={(gid) => abgleichVorschlagMutation.mutate({ vermisstId: v.id, gefundenId: gid })}
      options={gefundene.map((g) => ({ value: g.id, label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}` }))}
      disabled={gefundene.length === 0}
    />
  ),
}] : [];
```

Und unten in der `<Table … columns={[...spalten, ...aktionsSpalte]} … />` einbauen.

- [ ] **Step 4: Tests ausführen — müssen bestehen**

Run: `cd frontend && npm test -- PersonenPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): Vermisstenabgleich-Flow (Verdacht vorschlagen, Bestätigen/Verwerfen)"
```

---

## Task 19: PROGRESS aktualisieren + Final-Regression

E‑2 abschließen: Status in `PROGRESS.md` setzen, vollständigen Test-Lauf, Commit.

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Backend- und Frontend-Tests grün**

Run: `cargo test && cd frontend && npm run typecheck && npm test`
Expected: PASS (alles grün)

- [ ] **Step 2: PROGRESS aktualisieren**

In `docs/superpowers/PROGRESS.md`, in der Tabelle „Teilprojekt 3 — Erfassung", die Zeile **E‑2** auf:

```
| E‑2 | **Sichtung & medizinischer Verlauf** | Sichtungskategorien SK I–IV/tot/unverletzt (Verlauf + Cache), Befund-/Verlaufsnotiz (append-only), Transport/Verbleib (KH=Freitext), Vermisstenabgleich (Verdacht→bestätigt) | E‑1 | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-27-erfassung-sichtung-medizinischer-verlauf.md` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs(progress): E-2 (Sichtung & medizinischer Verlauf) auf erledigt"
```

- [ ] **Step 4: Abschluss-Review**

Optional (empfohlen): `pr-review-toolkit:review-pr` oder `superpowers:requesting-code-review` auf den E‑2-Diff laufen lassen und gefundene High-Confidence-Issues abräumen, bevor nach `main` gemerged wird.

---

## Self-Review (vor Übergabe an die Umsetzung)

- ✅ **Spec-Abdeckung** (jeder Spec-Block → Task): Sichtung (Task 4, 9), Notizen (Task 5, 11), Verbleib (Task 6, 10), Abgleich (Task 7, 12, 13). Cache-Konsistenz (Task 1, 4, 6 atomar im Repo). Detail-Antwort mit Verlauf (Task 8). ETB pseudonym + Notizen ohne ETB (Task 9, 10, 11, 13, 14). SSE ohne sensible Payload (Task 14). Berechtigung (alle Routen-Tasks via `fordere_schreibrecht`+`fordere_aktiv`; Task 13 zusätzlich `fordere_einsatzleitung`). Tests pro Spec-Punkt (Tasks 9–14). Frontend (Tasks 15–18).
- ✅ **Fünf von der Spec namentlich verlangte Tests** vorhanden: `sichtung_tot_aendert_admin_status_nicht` (Task 9), `detail_enthaelt_…_genau_einen_audit` (Task 8), `zweiter_bestaetigter_je_vermisstmeldung_ist_409` (Task 13), `etb_enthaelt_keine_identitaet_und_keinen_befundtext` + Befundnotiz erzeugt kein ETB (Task 11 + Task 14), `sse_person_event_enthaelt_nur_ids_keinen_befundtext` (Task 14).
- ✅ **Typ-/Methoden-Konsistenz:** `Sichtungskategorie::as_str/parse/etb_label`, `VerbleibArt::as_str/parse/kurzform/etb_sachverhalt`, `sichtung_repo::erfassen/laden/liste_je_person`, `verlaufsnotiz_repo::anlegen/liste_je_person`, `verbleib_repo::erfassen/laden/liste_je_person`, `abgleich_repo::anlegen_verdacht/laden/entscheide/liste_je_person`, `PersonDetail { person, sichtungen, notizen, verbleib, abgleiche }`. Frontend-Funktionen: `ladePerson→PersonDetail`, `erfasseSichtung`, `erfasseVerbleib`, `legeNotizAn`, `schlageAbgleichVor`, `entscheideAbgleich`. Keine umbenannten Symbole zwischen Tasks.
- ✅ **Keine Placeholders:** Jeder Step enthält konkreten Code oder konkreten Befehl + erwartete Ausgabe.
- ⚠️ **Bewusste Spec-Abweichung dokumentiert** (Architecture-Block): ETB sequentiell nach dem fachlichen Insert (Codebase-Konvention, E‑1-Präzedenz), nicht in derselben DB-Transaktion. Echt atomar bleibt die kritische Cache-/Status-Konsistenz im Repo.
