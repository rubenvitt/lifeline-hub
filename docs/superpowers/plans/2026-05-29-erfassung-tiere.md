# E‑4 Tiere — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein schlankes, einsatz-scoped Tier-Erfassungs-Modul (E‑4), das das Personen-Pattern (E‑1) und das UHS-Pattern (E‑3) wiederverwendet — ohne Lese-Audit und ohne Verbleibs-Event-Modell.

**Architecture:** Neue Tabelle `einsatz_tier` (Soft-Delete, server-vergebene Registriernummer `T-nnn`, Status-Maschine `aktiv|vermisst|abgeschlossen`, Halter als FK XOR Freitext per CHECK-Constraint). Backend-Schichten exakt wie `src/person/` und `src/uhs/`: `mod.rs` (Enums + Status-Maschine + `*Anzeige`-Struct), `repo.rs` (CRUD), `routes/einsatz_tier.rs` (Handler + lokale `etb_system`/`sse_tier`-Helfer). Wiederverwendet: `berechtigung.rs`-Gate, `etb_repo::anlegen` (pseudonyme `typ=system`-Spur), `LiveHub`-SSE (Event `tier`). Frontend analog `PersonenPage`: neue Seite `TierePage`, API-Client `einsatzTier.ts`, SSE-Hook `useTiereStream.ts`, plus ein lesender „Zugeordnete Tiere"-Block im bestehenden Personen-Drawer.

**Tech Stack:** Rust (axum 0.7, sqlx/SQLite), React 18 + Ant Design 5 + TanStack Query + react-router-dom, Vitest + MSW. Migrationen werden via `sqlx::migrate!("./migrations")` automatisch entdeckt (keine Registrierung nötig).

---

## Gesetzte Entwurfs-Entscheidungen (vor Implementierung lesen)

Diese Punkte sind **bewusst** so entschieden — nicht „korrigieren":

1. **ETB-Spur ist sequenziell, NICHT in einer gemeinsamen sqlx-Transaktion.** Die Spec
   schreibt „in derselben Transaktion", die *bestehende Codebase* (`src/routes/einsatz_person.rs`,
   `src/routes/einsatz_uhs.rs`) ruft `etb_system(...)` aber sequenziell **nach** dem
   Repo-Update auf — nur `registrier_nr + INSERT` ist atomar (ein einziges Statement).
   E‑4 folgt der Codebase-Konvention. Ein transaktionaler ETB-Pfad würde
   `etb_repo::anlegen` auf ein Tx-Handle umbauen müssen — inkonsistent mit allen
   anderen Modulen. **Diese Abweichung von der Spec-Wortwahl ist gewollt.**

2. **`abschluss_grund`/`abschluss_ziel` werden NUR über die Status-Route gesetzt**
   (beim Übergang `→ abgeschlossen`), **nicht** über `PATCH`. Die Route-Tabelle der Spec
   listet `PATCH` als „Identität, Halter, Antreffort, Notiz" — dem folgen wir. Die
   Spec-Prosa „kann aber via PATCH aktualisiert werden" wird bewusst **nicht** umgesetzt
   (YAGNI). Bei Korrektur-zurück (`abgeschlossen → aktiv|vermisst`) bleiben
   `abschluss_grund`/`abschluss_ziel` **unverändert** im Datensatz (Audit-Spur des
   letzten Abschlusses; CHECK erlaubt non-null grund auf nicht-abgeschlossener Zeile).

3. **`tier_repo::setze_status` ist KEIN 1:1-Klon von `person_repo::setze_status`.**
   Person schreibt nur `status`. Der Tier-CHECK `status <> 'abgeschlossen' OR
   abschluss_grund IS NOT NULL` zwingt dazu, beim Übergang `→ abgeschlossen` den
   `abschluss_grund` **im selben UPDATE** mitzuschreiben — sonst CHECK-Verletzung → 500.
   Siehe Task 4, kritischer Schritt.

4. **Halter-Auflösung per `LEFT JOIN einsatz_person`.** `TierAnzeige` trägt zwei
   read-only Join-Felder `halter_registrier_nr: Option<i64>` und
   `halter_storniert_at: Option<String>`, damit die UI `R-nnn` (bzw. „Halter (storniert):
   R-nnn") ohne Zweit-Request zeigen kann. Beide sind `Option` (NULL bei Freitext-Halter
   oder unbekannt). LEFT JOIN löst auch soft-gelöschte Halter weiterhin auf.

   **Org-Isolation der Halter-FK (zwei Linien):** (a) `POST`/`PATCH` verifizieren einen
   gesetzten `halter_person_id` per `person_repo::laden(einsatz_id, id)` → `404`, falls
   die Person zu einem fremden Einsatz gehört (Muster wie `einsatz_uhs::platz_verfuegbarkeit`).
   (b) Der JOIN trägt zusätzlich `AND hp.einsatz_id = t.einsatz_id`, damit selbst ein
   (theoretisch) cross-einsatz gesetzter FK keine fremde `R-nnn`/Storniert-Info leakt.
   Ohne diese Prädikate könnte ein Schreibender die `registrier_nr` einer Person aus
   einem anderen Einsatz exponieren.

5. **Namens-Konventionen (einmal festlegen, überall verbatim verwenden):**
   - Backend-Modul: `src/tier/` · Routen-Modul: `src/routes/einsatz_tier.rs`
   - `tier::registrier_anzeige(nr) -> "T-{nr:03}"`
   - SSE-Event-Tag: `"tier"` · Payload `{ einsatz_id, tier_id }`
   - Frontend: API-Client `einsatzTier.ts` · SSE-Hook `useTiereStream` (Plural, wie
     `usePersonenStream`/`useUhsStream`) · Seite `TierePage`
   - Query-Keys: Liste `['einsatz-tiere', einsatzId]` · Detail `['einsatz-tier', einsatzId, tierId]`
     · Cross-Modul (Tiere einer Person) `['einsatz-tiere', einsatzId, 'halter', personId]`
     (bewusst **Kind** des Listen-Keys → eine Invalidierung deckt beide ab).

---

## File Structure

**Backend (neu):**
- `migrations/0031_einsatz_tier.sql` — Tier-Entity, Status-Maschine, Halter-FK/Freitext, Abschluss-Felder, Soft-Delete, Indizes.
- `src/tier/mod.rs` — `TierStatus`, `Spezies`, `TierGeschlecht`, `AbschlussGrund` (Enums mit `as_str`/`parse`/Labels), `darf_uebergehen`, `registrier_anzeige`, `TierAnzeige` (sqlx::FromRow inkl. Join-Felder).
- `src/tier/repo.rs` — `NeueDaten`/`PatchDaten`, `liste`/`laden`/`anlegen`/`aktualisiere`/`setze_status`/`storniere`.
- `src/routes/einsatz_tier.rs` — Handler + lokale `etb_system`/`sse_tier`/`trimme`/`deserialize_optional_field`-Helfer.
- `tests/einsatz_tier.rs` — HTTP-Integrationstests (Harness wie `tests/einsatz_uhs.rs`).

**Backend (modifiziert):**
- `src/lib.rs` — `pub mod tier;`
- `src/routes/mod.rs` — `pub mod einsatz_tier;`
- `src/app.rs` — 8 `.route(...)`-Einträge für `/api/einsaetze/{id}/tiere…`.
- `src/db.rs` — `#[cfg(test)]`-Migrationstest für die DB-CHECKs (eigene Verteidigungslinie).

**Frontend (neu):**
- `frontend/src/api/einsatzTier.ts` — API-Client.
- `frontend/src/etb/useTiereStream.ts` — SSE-Hook.
- `frontend/src/pages/TierePage.tsx` — Modul-Seite.
- `frontend/src/pages/TierePage.test.tsx` — Vitest-Tests.

**Frontend (modifiziert):**
- `frontend/src/api/types.ts` — Tier-Typen.
- `frontend/src/einsatz/modulRegistry.ts` — `tiere`-Eintrag `status: 'geplant'` → `'fertig'`.
- `frontend/src/App.tsx` — `TierePage` in `MODUL_ELEMENTE`.
- `frontend/src/pages/PersonenPage.tsx` — „Zugeordnete Tiere"-Block + `useTiereStream`.
- `frontend/src/pages/PersonenPage.test.tsx` — Test für den neuen Block.

Reihenfolge ist zwingend: Migration (Task 1) vor Repo-Tests (`test_pool()` spielt sie ein); `mod.rs` (Task 2) vor `repo.rs` (Task 3); Repo vor Routen (Task 4); Backend vor Frontend-Integration.

---

## Task 1: Migration `0031_einsatz_tier.sql` + DB-CHECK-Test

**Files:**
- Create: `migrations/0031_einsatz_tier.sql`
- Test: `src/db.rs` (neue `#[tokio::test]`-Funktion im bestehenden `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing migration test**

In `src/db.rs`, innerhalb `mod tests` (am Ende, vor der schließenden `}`), einfügen. Mirror des Stils von `einsatz_migration_creates_tables_and_constraints` (db.rs:124).

```rust
    #[tokio::test]
    async fn einsatz_tier_migration_legt_tabelle_und_constraints_an() {
        let pool = test_pool().await;

        // Setup: Org, Benutzer, Einsatz, eine Person (als Halter-FK-Ziel).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        ).execute(&pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(&pool).await.unwrap();
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, 1, 1) RETURNING id",
        ).bind(einsatz_id).fetch_one(&pool).await.unwrap();

        // Gültiges Tier (Status-Default 'aktiv', spezies gesetzt).
        let tier_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1) RETURNING id",
        ).bind(einsatz_id).fetch_one(&pool).await.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM einsatz_tier WHERE id = ?")
            .bind(tier_id).fetch_one(&pool).await.unwrap();
        assert_eq!(status, "aktiv", "Status-Default ist aktiv");

        // spezies-CHECK lehnt ungültigen Wert ab.
        let bad_spezies = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'dinosaurier', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(bad_spezies.is_err(), "ungültige spezies muss abgelehnt werden");

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz_tier SET status = 'gestohlen' WHERE id = ?")
            .bind(tier_id).execute(&pool).await;
        assert!(bad_status.is_err(), "ungültiger status muss abgelehnt werden");

        // Halter-XOR-CHECK: beide gesetzt → Insert-Fehler.
        let bad_halter = sqlx::query(
            "INSERT INTO einsatz_tier \
                (einsatz_id, registrier_nr, spezies, halter_person_id, halter_kontakt, erfasst_von, geaendert_von) \
             VALUES (?, 3, 'katze', ?, 'Frau Müller', 1, 1)",
        ).bind(einsatz_id).bind(person_id).execute(&pool).await;
        assert!(bad_halter.is_err(), "halter_person_id UND halter_kontakt gleichzeitig muss abgelehnt werden");

        // Abschluss-CHECK: status='abgeschlossen' ohne abschluss_grund → Fehler.
        let bad_abschluss = sqlx::query(
            "UPDATE einsatz_tier SET status = 'abgeschlossen' WHERE id = ?",
        ).bind(tier_id).execute(&pool).await;
        assert!(bad_abschluss.is_err(), "abgeschlossen ohne abschluss_grund muss abgelehnt werden");

        // Mit abschluss_grund erlaubt.
        sqlx::query(
            "UPDATE einsatz_tier SET status = 'abgeschlossen', abschluss_grund = 'uebergabe_tierarzt' WHERE id = ?",
        ).bind(tier_id).execute(&pool).await.unwrap();

        // UNIQUE (einsatz_id, registrier_nr): doppelte Nummer je Einsatz → Fehler.
        let dup = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(dup.is_err(), "doppelte registrier_nr je Einsatz muss abgelehnt werden");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --lib db::tests::einsatz_tier_migration_legt_tabelle_und_constraints_an`
Expected: FAIL — `no such table: einsatz_tier` (Migration existiert noch nicht).

- [ ] **Step 3: Write the migration**

Create `migrations/0031_einsatz_tier.sql` (1:1 die SQL aus der Spec, Datenmodell-Block):

```sql
-- E‑4: Einsatz-scoped Tier-Stamm (Haustier eines Betroffenen, herrenloses Tier,
-- vermisstes Tier). Kein globaler Stamm, keine Disposition. Identität optional;
-- server-vergebene registrier_nr ist die stabile Kennung (Anzeige T-nnn).
-- Schlanke Status-Maschine, Halter als FK XOR Freitext, Soft-Delete via
-- storniert_at (kein Hard-Delete). Kein Lese-Audit, kein Verbleibs-Event-Modell.
CREATE TABLE einsatz_tier (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,          -- fortlaufend je Einsatz, server-autoritativ
    status          TEXT    NOT NULL DEFAULT 'aktiv'
                    CHECK (status IN ('aktiv','vermisst','abgeschlossen')),

    -- Spezies & Identität (alle außer spezies optional)
    spezies         TEXT    NOT NULL
                    CHECK (spezies IN ('hund','katze','grosstier','nutzgefluegel',
                                       'kleintier','wildtier','sonstige')),
    rasse_beschreibung TEXT,                   -- "Haflinger", "Deutscher Schäferhund"
    rufname         TEXT,
    geschlecht      TEXT CHECK (geschlecht IS NULL OR
                                geschlecht IN ('maennlich','weiblich','unbekannt')),
    alter_geschaetzt INTEGER,                  -- Jahre
    farbe_beschreibung TEXT,                   -- "schwarz mit weißer Brust"
    kennzeichnung   TEXT,                      -- Chip-Nr., Brandzeichen, Tätowierung, Halsband
    groesse_gewicht TEXT,                      -- "ca. 30 kg, mittelgroß"

    -- Halter (FK XOR Freitext; beides NULL = unbekannt)
    halter_person_id INTEGER REFERENCES einsatz_person(id),
    halter_kontakt  TEXT,                      -- Freitext: Name + Tel., wenn Halter nicht im Einsatz

    -- Erfassungskontext
    antreff_ort     TEXT,                      -- Freitext (analog E‑1; Tier-Sammelstelle = Folge-Spec)
    notiz           TEXT,

    -- Abschluss (gefüllt beim Übergang → abgeschlossen)
    abschluss_grund TEXT CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                    ('uebergabe_halter','uebergabe_tierarzt','uebergabe_tierheim',
                     'verstorben','freilauf','sonstiges')),
    abschluss_ziel  TEXT,                      -- Freitext: "Tierarzt Müller, Hauptstr. 12"

    -- Meta / Audit
    erfasst_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                      -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr),
    CHECK (halter_person_id IS NULL OR halter_kontakt IS NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_tier_einsatz ON einsatz_tier (einsatz_id, status);
CREATE INDEX idx_einsatz_tier_halter  ON einsatz_tier (halter_person_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --lib db::tests::einsatz_tier_migration_legt_tabelle_und_constraints_an`
Expected: PASS (alle CHECK-/UNIQUE-Assertions greifen).

- [ ] **Step 5: Commit**

```bash
git add migrations/0031_einsatz_tier.sql src/db.rs
git commit -m "feat(tier): Migration 0031 einsatz_tier + DB-CHECK-Test"
```

---

## Task 2: `src/tier/mod.rs` — Enums, Status-Maschine, Anzeige-Struct

**Files:**
- Create: `src/tier/mod.rs`
- Modify: `src/lib.rs` (eine Zeile)

- [ ] **Step 1: Register the module in `src/lib.rs`**

In `src/lib.rs` zwischen `pub mod stichwort;` und `pub mod uhs;` (alphabetisch) einfügen:

```rust
pub mod tier;
```

- [ ] **Step 2: Write `src/tier/mod.rs` with enums, transitions, struct, and unit tests**

Create `src/tier/mod.rs`. Pattern-Vorbild: `src/person/mod.rs`.

```rust
pub mod repo;

use serde::Serialize;

/// Status-Maschine eines Tiers (E‑4). Bewusst schlank — keine Sichtungskette wie
/// bei Personen. String = CHECK-Constraint in `migrations/0031_einsatz_tier.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TierStatus {
    Aktiv,
    Vermisst,
    Abgeschlossen,
}

impl TierStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TierStatus::Aktiv => "aktiv",
            TierStatus::Vermisst => "vermisst",
            TierStatus::Abgeschlossen => "abgeschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<TierStatus> {
        match s {
            "aktiv" => Some(TierStatus::Aktiv),
            "vermisst" => Some(TierStatus::Vermisst),
            "abgeschlossen" => Some(TierStatus::Abgeschlossen),
            _ => None,
        }
    }
}

/// Spezies-Enum. String = CHECK-Constraint. `etb_label` ist die pseudonyme
/// Anzeige in der ETB-Spur (z. B. "Hund").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Spezies {
    Hund,
    Katze,
    Grosstier,
    Nutzgefluegel,
    Kleintier,
    Wildtier,
    Sonstige,
}

impl Spezies {
    pub fn as_str(&self) -> &'static str {
        match self {
            Spezies::Hund => "hund",
            Spezies::Katze => "katze",
            Spezies::Grosstier => "grosstier",
            Spezies::Nutzgefluegel => "nutzgefluegel",
            Spezies::Kleintier => "kleintier",
            Spezies::Wildtier => "wildtier",
            Spezies::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<Spezies> {
        match s {
            "hund" => Some(Spezies::Hund),
            "katze" => Some(Spezies::Katze),
            "grosstier" => Some(Spezies::Grosstier),
            "nutzgefluegel" => Some(Spezies::Nutzgefluegel),
            "kleintier" => Some(Spezies::Kleintier),
            "wildtier" => Some(Spezies::Wildtier),
            "sonstige" => Some(Spezies::Sonstige),
            _ => None,
        }
    }

    /// Pseudonyme ETB-Beschriftung (Spec-Tabelle: "Tier T-007 (Hund) erfasst").
    pub fn etb_label(&self) -> &'static str {
        match self {
            Spezies::Hund => "Hund",
            Spezies::Katze => "Katze",
            Spezies::Grosstier => "Großtier",
            Spezies::Nutzgefluegel => "Nutzgeflügel",
            Spezies::Kleintier => "Kleintier",
            Spezies::Wildtier => "Wildtier",
            Spezies::Sonstige => "Sonstige",
        }
    }
}

/// Optionale Geschlechtsangabe des Tiers (kein `divers`, anders als bei Personen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TierGeschlecht {
    Maennlich,
    Weiblich,
    Unbekannt,
}

impl TierGeschlecht {
    pub fn as_str(&self) -> &'static str {
        match self {
            TierGeschlecht::Maennlich => "maennlich",
            TierGeschlecht::Weiblich => "weiblich",
            TierGeschlecht::Unbekannt => "unbekannt",
        }
    }

    pub fn parse(s: &str) -> Option<TierGeschlecht> {
        match s {
            "maennlich" => Some(TierGeschlecht::Maennlich),
            "weiblich" => Some(TierGeschlecht::Weiblich),
            "unbekannt" => Some(TierGeschlecht::Unbekannt),
            _ => None,
        }
    }
}

/// Abschlussgrund beim Übergang `→ abgeschlossen`. String = CHECK-Constraint.
/// `etb_label` erscheint in Klammern in der ETB-Spur (Spec: "abgeschlossen
/// (uebergabe_tierarzt)") — daher identisch zum DB-String.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbschlussGrund {
    UebergabeHalter,
    UebergabeTierarzt,
    UebergabeTierheim,
    Verstorben,
    Freilauf,
    Sonstiges,
}

impl AbschlussGrund {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschlussGrund::UebergabeHalter => "uebergabe_halter",
            AbschlussGrund::UebergabeTierarzt => "uebergabe_tierarzt",
            AbschlussGrund::UebergabeTierheim => "uebergabe_tierheim",
            AbschlussGrund::Verstorben => "verstorben",
            AbschlussGrund::Freilauf => "freilauf",
            AbschlussGrund::Sonstiges => "sonstiges",
        }
    }

    pub fn parse(s: &str) -> Option<AbschlussGrund> {
        match s {
            "uebergabe_halter" => Some(AbschlussGrund::UebergabeHalter),
            "uebergabe_tierarzt" => Some(AbschlussGrund::UebergabeTierarzt),
            "uebergabe_tierheim" => Some(AbschlussGrund::UebergabeTierheim),
            "verstorben" => Some(AbschlussGrund::Verstorben),
            "freilauf" => Some(AbschlussGrund::Freilauf),
            "sonstiges" => Some(AbschlussGrund::Sonstiges),
            _ => None,
        }
    }
}

/// Ob ein Status-Übergang `von → nach` erlaubt ist. Gleichbleibender Status und
/// unbekannte Werte sind nie erlaubt. `abgeschlossen` ist terminal; Übergänge
/// zurück in aktive Zustände sind erlaubt — als Korrektur einer Fehleingabe
/// (das Schreibrecht prüft die Route). Der Übergang `→ abgeschlossen` erfordert
/// zusätzlich einen `abschluss_grund` (Route + DB-CHECK), wird hier aber NICHT
/// geprüft — `darf_uebergehen` validiert nur die Zustandskanten.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use TierStatus::*;
    let (Some(von), Some(nach)) = (TierStatus::parse(von), TierStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Aktiv => matches!(nach, Vermisst | Abgeschlossen),
        Vermisst => matches!(nach, Aktiv | Abgeschlossen),
        // Terminal: nur Korrektur zurück in aktive Zustände.
        Abgeschlossen => matches!(nach, Aktiv | Vermisst),
    }
}

/// Stabile, nicht-identifizierende Anzeige der Registriernummer (z. B. `T-042`).
pub fn registrier_anzeige(nr: i64) -> String {
    format!("T-{nr:03}")
}

/// Serialisierbarer Tier-Datensatz (1:1 zur Tabelle `einsatz_tier`). Die beiden
/// `halter_*`-Felder kommen aus einem LEFT JOIN auf `einsatz_person` und sind
/// read-only (NULL bei Freitext-Halter oder unbekannt) — die UI zeigt damit
/// `R-nnn` bzw. "Halter (storniert): R-nnn" ohne Zweit-Request.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TierAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: String,
    pub spezies: String,
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
    pub abschluss_grund: Option<String>,
    pub abschluss_ziel: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    // Join-Felder (read-only): Halter-Auflösung über einsatz_person.
    pub halter_registrier_nr: Option<i64>,
    pub halter_storniert_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["aktiv", "vermisst", "abgeschlossen"] {
            assert_eq!(TierStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(TierStatus::parse("gestohlen").is_none());
    }

    #[test]
    fn spezies_roundtrip_und_label() {
        for s in ["hund", "katze", "grosstier", "nutzgefluegel", "kleintier", "wildtier", "sonstige"] {
            assert_eq!(Spezies::parse(s).unwrap().as_str(), s);
        }
        assert!(Spezies::parse("dinosaurier").is_none());
        assert_eq!(Spezies::parse("hund").unwrap().etb_label(), "Hund");
        assert_eq!(Spezies::parse("grosstier").unwrap().etb_label(), "Großtier");
    }

    #[test]
    fn geschlecht_roundtrip_ohne_divers() {
        for g in ["maennlich", "weiblich", "unbekannt"] {
            assert_eq!(TierGeschlecht::parse(g).unwrap().as_str(), g);
        }
        assert!(TierGeschlecht::parse("divers").is_none(), "Tiere haben kein 'divers'");
    }

    #[test]
    fn abschluss_grund_roundtrip() {
        for g in ["uebergabe_halter", "uebergabe_tierarzt", "uebergabe_tierheim", "verstorben", "freilauf", "sonstiges"] {
            assert_eq!(AbschlussGrund::parse(g).unwrap().as_str(), g);
        }
        assert!(AbschlussGrund::parse("vergessen").is_none());
    }

    #[test]
    fn erlaubte_uebergaenge() {
        assert!(darf_uebergehen("aktiv", "vermisst"));
        assert!(darf_uebergehen("aktiv", "abgeschlossen"));
        assert!(darf_uebergehen("vermisst", "aktiv"));
        assert!(darf_uebergehen("vermisst", "abgeschlossen"));
        // Korrektur aus dem terminalen Zustand zurück:
        assert!(darf_uebergehen("abgeschlossen", "aktiv"));
        assert!(darf_uebergehen("abgeschlossen", "vermisst"));
    }

    #[test]
    fn verbotene_uebergaenge() {
        assert!(!darf_uebergehen("aktiv", "aktiv"));
        assert!(!darf_uebergehen("vermisst", "vermisst"));
        assert!(!darf_uebergehen("abgeschlossen", "abgeschlossen"));
        assert!(!darf_uebergehen("aktiv", "quatsch"));
        assert!(!darf_uebergehen("quatsch", "aktiv"));
    }

    #[test]
    fn registrier_anzeige_mit_fuehrenden_nullen() {
        assert_eq!(registrier_anzeige(7), "T-007");
        assert_eq!(registrier_anzeige(42), "T-042");
        assert_eq!(registrier_anzeige(1234), "T-1234");
    }
}
```

- [ ] **Step 3: Run the unit tests to verify they pass**

Run: `cargo test --lib tier::tests`
Expected: PASS (6 Tests). Anmerkung: `repo`-Modul ist noch leer-deklariert → Step 4.

- [ ] **Step 4: Create an empty `repo.rs` so the crate compiles**

`src/tier/mod.rs` deklariert `pub mod repo;`. Damit `cargo test` kompiliert, lege eine leere Datei an (wird in Task 3 gefüllt):

```bash
touch src/tier/repo.rs
```

(Eine leere `.rs`-Datei ist gültiges Rust. Sie wird in Task 3 vollständig geschrieben.)

- [ ] **Step 5: Run the full lib build + tier tests**

Run: `cargo test --lib tier::`
Expected: PASS, keine Compile-Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/tier/mod.rs src/tier/repo.rs
git commit -m "feat(tier): mod.rs Enums + Status-Maschine + TierAnzeige"
```

---

## Task 3: `src/tier/repo.rs` — CRUD, Status, Soft-Delete

**Files:**
- Modify (fill): `src/tier/repo.rs`

Pattern-Vorbild: `src/person/repo.rs`. Kritischer Unterschied zu Person: `setze_status`
schreibt beim Übergang `→ abgeschlossen` den `abschluss_grund`/`abschluss_ziel` **im
selben UPDATE** (sonst CHECK-Verletzung → 500). Bei anderen Zielzuständen werden die
Abschluss-Felder **nicht** angefasst.

- [ ] **Step 1: Write the repo with inline unit tests**

Vollständiger Inhalt von `src/tier/repo.rs`:

```rust
use super::TierAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Basis-SELECT inkl. LEFT JOIN auf `einsatz_person` für die read-only
/// Halter-Auflösung (`halter_registrier_nr`, `halter_storniert_at`).
const SELECT_ALLE: &str = "\
    SELECT t.id, t.einsatz_id, t.registrier_nr, t.status, t.spezies, \
           t.rasse_beschreibung, t.rufname, t.geschlecht, t.alter_geschaetzt, \
           t.farbe_beschreibung, t.kennzeichnung, t.groesse_gewicht, \
           t.halter_person_id, t.halter_kontakt, t.antreff_ort, t.notiz, \
           t.abschluss_grund, t.abschluss_ziel, t.erfasst_at, t.erfasst_von, \
           t.geaendert_at, t.geaendert_von, t.storniert_at, \
           hp.registrier_nr AS halter_registrier_nr, \
           hp.storniert_at  AS halter_storniert_at \
    FROM einsatz_tier t \
    LEFT JOIN einsatz_person hp ON hp.id = t.halter_person_id \
                               AND hp.einsatz_id = t.einsatz_id";

/// Eingabedaten beim Anlegen. Strings bereits getrimmt (Handler-Aufgabe); leere
/// Werte als `None`. `spezies` ist Pflicht. `status` wird separat übergeben.
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub spezies: &'a str,
    pub rasse_beschreibung: Option<&'a str>,
    pub rufname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<&'a str>,
    pub kennzeichnung: Option<&'a str>,
    pub groesse_gewicht: Option<&'a str>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten. Identitäts-/Kontextfelder folgen COALESCE-Semantik (gesetzt =
/// übernehmen, `None` = unverändert). Die Halter-Felder nutzen die explizite
/// `Some(None)`-Semantik (= auf NULL setzen) wie in `uhs::repo::PatchDaten`,
/// damit der FK↔Freitext-Toggle ein Feld leeren kann.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub rasse_beschreibung: Option<&'a str>,
    pub rufname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<&'a str>,
    pub kennzeichnung: Option<&'a str>,
    pub groesse_gewicht: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// `Some(Some(id))` = setzen, `Some(None)` = auf NULL, `None` = unverändert.
    pub halter_person_id: Option<Option<i64>>,
    pub halter_kontakt: Option<Option<&'a str>>,
}

/// Tiere eines Einsatzes (ohne stornierte), optional gefiltert. Sortierung:
/// registrier_nr absteigend (neueste oben — Spec).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    spezies: Option<&str>,
    halter_person_id: Option<i64>,
) -> Result<Vec<TierAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE t.einsatz_id = ?1 AND t.storniert_at IS NULL \
         AND (?2 IS NULL OR t.status = ?2) \
         AND (?3 IS NULL OR t.spezies = ?3) \
         AND (?4 IS NULL OR t.halter_person_id = ?4) \
         ORDER BY t.registrier_nr DESC"
    );
    Ok(sqlx::query_as::<_, TierAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .bind(spezies)
        .bind(halter_person_id)
        .fetch_all(pool)
        .await?)
}

/// Lädt ein Tier (auch storniertes) eines Einsatzes; `NotFound`, falls es nicht
/// zu diesem Einsatz gehört (Org-Isolation).
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
) -> Result<TierAnzeige, AppError> {
    sqlx::query_as::<_, TierAnzeige>(&format!(
        "{SELECT_ALLE} WHERE t.id = ? AND t.einsatz_id = ?"
    ))
    .bind(tier_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt ein Tier an, vergibt `registrier_nr` atomar als
/// `COALESCE(MAX(registrier_nr),0)+1` je Einsatz (zählt stornierte mit — keine
/// Nummern-Wiederverwendung). `status` ∈ {`aktiv`, `vermisst`} (Route-validiert).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    status: &str,
    daten: NeueDaten<'_>,
) -> Result<TierAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_tier \
            (einsatz_id, registrier_nr, status, spezies, rasse_beschreibung, rufname, \
             geschlecht, alter_geschaetzt, farbe_beschreibung, kennzeichnung, \
             groesse_gewicht, halter_person_id, halter_kontakt, antreff_ort, notiz, \
             erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, \
                ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15 \
         FROM einsatz_tier WHERE einsatz_id = ?1 \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status)
    .bind(daten.spezies)
    .bind(daten.rasse_beschreibung)
    .bind(daten.rufname)
    .bind(daten.geschlecht)
    .bind(daten.alter_geschaetzt)
    .bind(daten.farbe_beschreibung)
    .bind(daten.kennzeichnung)
    .bind(daten.groesse_gewicht)
    .bind(daten.halter_person_id)
    .bind(daten.halter_kontakt)
    .bind(daten.antreff_ort)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Stammfelder. Identitätsfelder via COALESCE (nur gesetzte);
/// Halter-Felder mit expliziter NULL-Semantik (für den FK↔Freitext-Toggle).
/// Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht zum Einsatz.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<TierAnzeige, AppError> {
    // Nur anonyme `?`-Platzhalter (Codebase-Idiom, wie person/uhs). Reihenfolge der
    // `.bind()`-Aufrufe = Reihenfolge der `?` im SQL. Die Halter-Felder nutzen ein
    // Flag (`is_some`) + Wert (`flatten`)-Paar, damit `Some(None)` → NULL setzt.
    let betroffen = sqlx::query(
        "UPDATE einsatz_tier SET \
            rasse_beschreibung = COALESCE(?, rasse_beschreibung), \
            rufname = COALESCE(?, rufname), \
            geschlecht = COALESCE(?, geschlecht), \
            alter_geschaetzt = COALESCE(?, alter_geschaetzt), \
            farbe_beschreibung = COALESCE(?, farbe_beschreibung), \
            kennzeichnung = COALESCE(?, kennzeichnung), \
            groesse_gewicht = COALESCE(?, groesse_gewicht), \
            antreff_ort = COALESCE(?, antreff_ort), \
            notiz = COALESCE(?, notiz), \
            halter_person_id = CASE WHEN ? THEN ? ELSE halter_person_id END, \
            halter_kontakt   = CASE WHEN ? THEN ? ELSE halter_kontakt END, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.rasse_beschreibung)
    .bind(daten.rufname)
    .bind(daten.geschlecht)
    .bind(daten.alter_geschaetzt)
    .bind(daten.farbe_beschreibung)
    .bind(daten.kennzeichnung)
    .bind(daten.groesse_gewicht)
    .bind(daten.antreff_ort)
    .bind(daten.notiz)
    .bind(daten.halter_person_id.is_some())  // Flag: Halter-FK im Patch enthalten?
    .bind(daten.halter_person_id.flatten())  // Wert (oder NULL bei Some(None))
    .bind(daten.halter_kontakt.is_some())    // Flag: Halter-Kontakt im Patch enthalten?
    .bind(daten.halter_kontakt.flatten())    // Wert (oder NULL bei Some(None))
    .bind(geaendert_von)
    .bind(tier_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, tier_id).await
}

/// Setzt den Status (Übergangsvalidierung ist Handler-Aufgabe via
/// `darf_uebergehen`). **Beim Übergang `→ abgeschlossen` werden `abschluss_grund`
/// (Pflicht, Route-validiert) und `abschluss_ziel` (optional) im selben UPDATE
/// geschrieben — sonst verletzt der DB-CHECK.** Bei jedem anderen Zielzustand
/// bleiben die Abschluss-Felder unverändert (Audit-Spur des letzten Abschlusses).
/// `NotFound`, falls nicht zum Einsatz.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    neuer_status: &str,
    abschluss_grund: Option<&str>,
    abschluss_ziel: Option<&str>,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = if neuer_status == "abgeschlossen" {
        sqlx::query(
            "UPDATE einsatz_tier SET status = ?, abschluss_grund = ?, abschluss_ziel = ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(neuer_status)
        .bind(abschluss_grund)
        .bind(abschluss_ziel)
        .bind(geaendert_von)
        .bind(tier_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE einsatz_tier SET status = ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(neuer_status)
        .bind(geaendert_von)
        .bind(tier_id)
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

/// Soft-Delete (Fehleingabe): setzt `storniert_at`. Bleibt referenzierbar.
/// `NotFound`, falls nicht zum Einsatz.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_tier SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(geaendert_von)
    .bind(tier_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Minimal-Setup: eine Org, ein Benutzer, ein aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-29') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn hund<'a>() -> NeueDaten<'a> {
        NeueDaten {
            spezies: "hund", rasse_beschreibung: None, rufname: None, geschlecht: None,
            alter_geschaetzt: None, farbe_beschreibung: None, kennzeichnung: None,
            groesse_gewicht: None, halter_person_id: None, halter_kontakt: None,
            antreff_ort: None, notiz: None,
        }
    }

    /// Legt eine Person an (Halter-FK-Ziel) und liefert ihre id.
    async fn person_anlegen(pool: &SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, (SELECT COALESCE(MAX(registrier_nr),0)+1 FROM einsatz_person WHERE einsatz_id = ?), 1, 1) \
             RETURNING id")
            .bind(einsatz_id).bind(einsatz_id).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t1 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        assert_eq!(t1.registrier_nr, 1);
        assert_eq!(t1.status, "aktiv");
        storniere(&pool, e, t1.id, b).await.unwrap();
        let t2 = anlegen(&pool, e, b, "vermisst", hund()).await.unwrap();
        assert_eq!(t2.registrier_nr, 2, "Soft-Delete recycelt keine Nummern");
        assert_eq!(t2.status, "vermisst");
    }

    #[tokio::test]
    async fn liste_blendet_stornierte_aus_detail_zeigt_sie() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t1 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        storniere(&pool, e, t1.id, b).await.unwrap();
        let liste = liste(&pool, e, None, None, None).await.unwrap();
        assert!(liste.is_empty(), "storniertes Tier nicht in der Liste");
        let detail = laden(&pool, e, t1.id).await.unwrap();
        assert!(detail.storniert_at.is_some(), "Detail liefert storniertes Tier");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status_und_spezies() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        anlegen(&pool, e, b, "aktiv", NeueDaten { spezies: "katze", ..hund() }).await.unwrap();
        let t3 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        setze_status(&pool, e, t3.id, "vermisst", None, None, b).await.unwrap();

        let vermisste = liste(&pool, e, Some("vermisst"), None, None).await.unwrap();
        assert_eq!(vermisste.len(), 1);
        let katzen = liste(&pool, e, None, Some("katze"), None).await.unwrap();
        assert_eq!(katzen.len(), 1);
        assert_eq!(katzen[0].spezies, "katze");
    }

    #[tokio::test]
    async fn liste_sortiert_neueste_oben() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap(); // nr 1
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap(); // nr 2
        let liste = liste(&pool, e, None, None, None).await.unwrap();
        assert_eq!(liste[0].registrier_nr, 2, "neueste oben (DESC)");
        assert_eq!(liste[1].registrier_nr, 1);
    }

    #[tokio::test]
    async fn halter_fk_wird_aufgeloest_und_join_felder_gesetzt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let halter = person_anlegen(&pool, e).await;
        let t = anlegen(&pool, e, b, "aktiv", NeueDaten { halter_person_id: Some(halter), ..hund() }).await.unwrap();
        assert_eq!(t.halter_person_id, Some(halter));
        assert_eq!(t.halter_registrier_nr, Some(1), "Join löst R-Nr des Halters auf");
        assert!(t.halter_storniert_at.is_none());

        // Halter-Person soft-löschen → FK bleibt zulässig, Join löst weiterhin auf.
        sqlx::query("UPDATE einsatz_person SET storniert_at = '2026-05-29 10:00:00' WHERE id = ?")
            .bind(halter).execute(&pool).await.unwrap();
        let nachher = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(nachher.halter_person_id, Some(halter), "Tier-Datensatz unverändert");
        assert!(nachher.halter_storniert_at.is_some(), "Join zeigt storniert");
    }

    #[tokio::test]
    async fn patch_toggle_fk_zu_freitext() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let halter = person_anlegen(&pool, e).await;
        let t = anlegen(&pool, e, b, "aktiv", NeueDaten { halter_person_id: Some(halter), ..hund() }).await.unwrap();
        // FK → Freitext: FK auf NULL, Kontakt setzen.
        let nachher = aktualisiere(&pool, e, t.id, b, PatchDaten {
            halter_person_id: Some(None),
            halter_kontakt: Some(Some("Frau Müller, 0170-123")),
            ..PatchDaten::default()
        }).await.unwrap();
        assert!(nachher.halter_person_id.is_none());
        assert_eq!(nachher.halter_kontakt.as_deref(), Some("Frau Müller, 0170-123"));
        assert!(nachher.halter_registrier_nr.is_none(), "kein FK → kein Join-Ergebnis");
    }

    #[tokio::test]
    async fn abschluss_schreibt_grund_im_selben_update() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        // Ohne abschluss_grund würde der DB-CHECK verletzt → wir übergeben ihn.
        setze_status(&pool, e, t.id, "abgeschlossen", Some("uebergabe_tierarzt"), Some("Tierarzt Müller"), b).await.unwrap();
        let nachher = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(nachher.status, "abgeschlossen");
        assert_eq!(nachher.abschluss_grund.as_deref(), Some("uebergabe_tierarzt"));
        assert_eq!(nachher.abschluss_ziel.as_deref(), Some("Tierarzt Müller"));

        // Korrektur zurück → Status ändert sich, Abschluss-Felder bleiben.
        setze_status(&pool, e, t.id, "aktiv", None, None, b).await.unwrap();
        let korrigiert = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(korrigiert.status, "aktiv");
        assert_eq!(korrigiert.abschluss_grund.as_deref(), Some("uebergabe_tierarzt"),
            "Abschluss-Grund bleibt als Audit-Spur erhalten");
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        let err = laden(&pool, 999, t.id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }
}
```

- [ ] **Step 2: Run the repo tests to verify they pass**

Run: `cargo test --lib tier::repo::tests`
Expected: PASS (8 Tests). Falls `abschluss_schreibt_grund_im_selben_update` mit einem
`Database`-Fehler scheitert, ist `setze_status` falsch (CHECK-Verletzung) — vergleiche
mit dem `if neuer_status == "abgeschlossen"`-Zweig.

- [ ] **Step 3: Commit**

```bash
git add src/tier/repo.rs
git commit -m "feat(tier): repo CRUD + Status (Abschluss-Grund im selben UPDATE)"
```

---

## Task 4: `src/routes/einsatz_tier.rs` — Handler + Routen-Mount

**Files:**
- Create: `src/routes/einsatz_tier.rs`
- Modify: `src/routes/mod.rs` (eine Zeile)
- Modify: `src/app.rs` (8 Routen)

Pattern-Vorbild: `src/routes/einsatz_person.rs` (Liste/Anlegen/Detail/Patch/Status/Storno/Export/Stream)
und `src/routes/einsatz_uhs.rs` (Status-Maschine + `deserialize_optional_field` für den Halter-Toggle).
Die HTTP-Verifikation erfolgt in Task 5 — dieser Task baut die Handler, dann ein
schneller `cargo build`-Gate.

- [ ] **Step 1: Register the route module in `src/routes/mod.rs`**

In `src/routes/mod.rs` nach `pub mod einsatz_person;` (alphabetisch passend) einfügen:

```rust
pub mod einsatz_tier;
```

- [ ] **Step 2: Write `src/routes/einsatz_tier.rs`**

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::repo as person_repo; // Org-Isolation der Halter-FK (404 bei fremder Person)
use crate::tier::{
    darf_uebergehen, registrier_anzeige, repo as tier_repo, AbschlussGrund, Spezies, TierAnzeige,
    TierGeschlecht, TierStatus,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

// ---------- ETB-/SSE-Helfer (lokales Muster wie in anderen Routen) ----------

/// Schreibt einen pseudonymen System-ETB-Eintrag und publiziert ihn als `etb`-SSE.
/// Identisch zu `routes::einsatz_person::etb_system`.
async fn etb_system(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
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

/// Dediziertes `tier`-SSE-Event OHNE sensible Payload (nur einsatz_id + tier_id);
/// Clients refetchen.
fn sse_tier(state: &AppState, einsatz_id: i64, tier_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "tier_id": tier_id }).to_string();
    state.live.publiziere_event(einsatz_id, "tier", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Liest ein optional-nullable Feld so, dass JSON-`null` → `Some(None)` und
/// fehlendes Feld → `None` (für den Halter-FK↔Freitext-Toggle). Wie in
/// `routes::einsatz_uhs`.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Validiert optionales Tier-Geschlecht; `Validation`, falls gesetzt und unbekannt.
fn pruefe_geschlecht(g: &Option<String>) -> Result<(), AppError> {
    if let Some(g) = g {
        if TierGeschlecht::parse(g).is_none() {
            return Err(AppError::Validation("Unbekanntes Geschlecht".into()));
        }
    }
    Ok(())
}

// ============================== Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub spezies: Option<String>,
    pub halter_person_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/tiere — Liste (Filter `?status=`, `?spezies=`, `?halter_person_id=`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<TierAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if TierStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Status im Filter".into()));
        }
    }
    if let Some(s) = &params.spezies {
        if Spezies::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannte Spezies im Filter".into()));
        }
    }
    Ok(Json(
        tier_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.spezies.as_deref(),
            params.halter_person_id,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    /// Optional; Default `aktiv`. Erlaubt nur `aktiv` | `vermisst`.
    pub status: Option<String>,
    pub spezies: String,
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/tiere — Anlegen. Status ∈ {aktiv, vermisst}
/// (`abgeschlossen` → 422). Halter-Exklusivität → 422. Pseudonyme ETB-Spur + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<TierAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Spezies (Pflicht) prüfen.
    if Spezies::parse(&body.spezies).is_none() {
        return Err(AppError::Validation("Unbekannte oder fehlende Spezies".into()));
    }
    // Status: Default aktiv; nur aktiv|vermisst erlaubt.
    let status = body.status.as_deref().unwrap_or("aktiv");
    if !matches!(status, "aktiv" | "vermisst") {
        return Err(AppError::UnprocessableEntity(
            "Beim Anlegen ist nur Status 'aktiv' oder 'vermisst' erlaubt".into(),
        ));
    }
    pruefe_geschlecht(&body.geschlecht)?;
    // Halter-Exklusivität (zweite Verteidigungslinie zum DB-CHECK).
    if body.halter_person_id.is_some() && trimme(body.halter_kontakt.clone()).is_some() {
        return Err(AppError::UnprocessableEntity(
            "Halter-FK und Halter-Freitext schließen sich aus".into(),
        ));
    }
    // Org-Isolation: gesetzte Halter-Person muss zu DIESEM Einsatz gehören (404 sonst).
    // Mustergleich zu `einsatz_uhs::platz_verfuegbarkeit` (Reservierungs-Ziel).
    if let Some(hp) = body.halter_person_id {
        person_repo::laden(&state.pool, einsatz_id, hp).await?;
    }

    let rasse = trimme(body.rasse_beschreibung);
    let rufname = trimme(body.rufname);
    let farbe = trimme(body.farbe_beschreibung);
    let kennzeichnung = trimme(body.kennzeichnung);
    let groesse = trimme(body.groesse_gewicht);
    let halter_kontakt = trimme(body.halter_kontakt);
    let antreff = trimme(body.antreff_ort);
    let notiz = trimme(body.notiz);

    let tier = tier_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        status,
        tier_repo::NeueDaten {
            spezies: &body.spezies,
            rasse_beschreibung: rasse.as_deref(),
            rufname: rufname.as_deref(),
            geschlecht: body.geschlecht.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt,
            farbe_beschreibung: farbe.as_deref(),
            kennzeichnung: kennzeichnung.as_deref(),
            groesse_gewicht: groesse.as_deref(),
            halter_person_id: body.halter_person_id,
            halter_kontakt: halter_kontakt.as_deref(),
            antreff_ort: antreff.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;

    // Pseudonyme ETB-Spur: nur Reg.-Nr. + Spezies (+ Status bei vermisst).
    let spezies_label = Spezies::parse(&tier.spezies).map(|s| s.etb_label()).unwrap_or("");
    let text = if status == "vermisst" {
        format!("Tier {} ({}) als vermisst gemeldet", registrier_anzeige(tier.registrier_nr), spezies_label)
    } else {
        format!("Tier {} ({}) erfasst", registrier_anzeige(tier.registrier_nr), spezies_label)
    };
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_tier(&state, einsatz_id, tier.id);
    Ok((StatusCode::CREATED, Json(tier)))
}

/// GET /api/einsaetze/{id}/tiere/{tid} — Detail (voller Datensatz). NICHT auditiert.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(tier_repo::laden(&state.pool, einsatz_id, tier_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
    /// `Some(null)` = explizit löschen; absent = unverändert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub halter_person_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub halter_kontakt: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/tiere/{tid} — Stammfelder (Identität, Halter,
/// Antreffort, Notiz). Halter-Exklusivität → 422. Storniert → 409. KEIN ETB
/// (Stammfelder sind nicht lagerelevant; vgl. E‑1-PATCH). SSE.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let vorher = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Storniertes Tier kann nicht geändert werden".into()));
    }

    // Halter-Exklusivität: beide explizit-non-null gesetzt → 422.
    let setzt_fk = matches!(body.halter_person_id, Some(Some(_)));
    let kontakt_norm = body
        .halter_kontakt
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let setzt_kontakt = matches!(kontakt_norm, Some(Some(_)));
    if setzt_fk && setzt_kontakt {
        return Err(AppError::UnprocessableEntity(
            "Halter-FK und Halter-Freitext schließen sich aus".into(),
        ));
    }
    // Org-Isolation: ein gesetzter Halter-FK muss zu DIESEM Einsatz gehören (404 sonst).
    if let Some(Some(hp)) = body.halter_person_id {
        person_repo::laden(&state.pool, einsatz_id, hp).await?;
    }

    let rasse = trimme(body.rasse_beschreibung);
    let rufname = trimme(body.rufname);
    let farbe = trimme(body.farbe_beschreibung);
    let kennzeichnung = trimme(body.kennzeichnung);
    let groesse = trimme(body.groesse_gewicht);
    let antreff = trimme(body.antreff_ort);
    let notiz = trimme(body.notiz);

    let tier = tier_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        tier_id,
        benutzer.id,
        tier_repo::PatchDaten {
            rasse_beschreibung: rasse.as_deref(),
            rufname: rufname.as_deref(),
            geschlecht: body.geschlecht.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt,
            farbe_beschreibung: farbe.as_deref(),
            kennzeichnung: kennzeichnung.as_deref(),
            groesse_gewicht: groesse.as_deref(),
            antreff_ort: antreff.as_deref(),
            notiz: notiz.as_deref(),
            halter_person_id: body.halter_person_id,
            halter_kontakt: kontakt_norm.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(Json(tier))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
    pub abschluss_grund: Option<String>,
    pub abschluss_ziel: Option<String>,
}

/// POST /api/einsaetze/{id}/tiere/{tid}/status — validierter Status-Wechsel.
/// Unbekannter Zielstatus → 400; ungültiger Übergang → 422; `→ abgeschlossen`
/// ohne gültigen `abschluss_grund` → 422; storniert → 409. Pseudonyme ETB-Spur + SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<TierAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if TierStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Storniertes Tier kann nicht geändert werden".into()));
    }
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }

    // → abgeschlossen erfordert gültigen abschluss_grund (Route + DB-CHECK).
    let grund = trimme(body.abschluss_grund.clone());
    let ziel = trimme(body.abschluss_ziel.clone());
    if body.status == "abgeschlossen" {
        match grund.as_deref() {
            Some(g) if AbschlussGrund::parse(g).is_some() => {}
            _ => {
                return Err(AppError::UnprocessableEntity(
                    "Abschluss erfordert einen gültigen abschluss_grund".into(),
                ))
            }
        }
    }

    tier_repo::setze_status(
        &state.pool,
        einsatz_id,
        tier_id,
        &body.status,
        grund.as_deref(),
        ziel.as_deref(),
        benutzer.id,
    )
    .await?;

    // Pseudonyme ETB-Spur (Spec-Tabelle): nie Rufname/Kennzeichnung/Halter/Ziel.
    let r = registrier_anzeige(vorher.registrier_nr);
    let text = match body.status.as_str() {
        "abgeschlossen" => format!("Tier {r}: abgeschlossen ({})", grund.as_deref().unwrap_or("")),
        "aktiv" if vorher.status == "vermisst" => format!("Tier {r}: vermisst → aktiv (aufgefunden)"),
        _ => format!("Tier {r}: {} → {}", vorher.status, body.status),
    };
    etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(Json(tier_repo::laden(&state.pool, einsatz_id, tier_id).await?))
}

/// DELETE /api/einsaetze/{id}/tiere/{tid} — Stornieren (Soft-Delete).
/// Bereits storniert → 409. Pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, tier_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let tier = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if tier.storniert_at.is_some() {
        return Err(AppError::Conflict("Tier ist bereits storniert".into()));
    }
    tier_repo::storniere(&state.pool, einsatz_id, tier_id, benutzer.id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Tier {} storniert", registrier_anzeige(tier.registrier_nr)),
    )
    .await?;
    sse_tier(&state, einsatz_id, tier_id);
    Ok(StatusCode::NO_CONTENT)
}

/// Einfaches CSV-Feld-Quoting (RFC 4180 + Formel-Injektions-Schutz), wie in
/// `routes::einsatz_person::csv_feld`.
fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/einsaetze/{id}/tiere/export — CSV aller (nicht-stornierten) Tiere.
/// NICHT auditiert (Tiere sind keine besondere Kategorie).
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Response, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let tiere = tier_repo::liste(&state.pool, einsatz_id, None, None, None).await?;
    let mut csv = String::from("registrier_nr;status;spezies;rufname;rasse;geschlecht;alter;antreff_ort\n");
    for t in &tiere {
        let alter = t.alter_geschaetzt.map(|a| a.to_string()).unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{};{}\n",
            registrier_anzeige(t.registrier_nr),
            csv_feld(&t.status),
            csv_feld(&t.spezies),
            csv_feld(t.rufname.as_deref().unwrap_or("")),
            csv_feld(t.rasse_beschreibung.as_deref().unwrap_or("")),
            csv_feld(t.geschlecht.as_deref().unwrap_or("")),
            alter,
            csv_feld(t.antreff_ort.as_deref().unwrap_or("")),
        ));
    }
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    )
        .into_response())
}

/// GET /api/einsaetze/{id}/tiere/stream — SSE-Stream. Nur Lesezugriff.
/// Der Client filtert clientseitig auf `tier`-Events.
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

> `TierAnzeige` ist bereits in `tier::mod` `Serialize` — dieser Routen-Datei reicht
> `Deserialize` (für die Body-Structs). Belasse die Datei warnungsfrei: entferne
> jeden Import, den `cargo build` als „unused" anmahnt.

- [ ] **Step 3: Mount the routes in `src/app.rs`**

In `src/app.rs` direkt nach dem `personen/{pid}` delete-Eintrag (app.rs:91) und vor
dem `uhs`-Block (app.rs:92) einfügen. Reihenfolge wie bei `personen`: `stream` und
`export` vor `{tid}`:

```rust
        .route("/api/einsaetze/{id}/tiere", get(routes::einsatz_tier::liste))
        .route("/api/einsaetze/{id}/tiere", post(routes::einsatz_tier::anlegen))
        .route("/api/einsaetze/{id}/tiere/stream", get(routes::einsatz_tier::stream))
        .route("/api/einsaetze/{id}/tiere/export", get(routes::einsatz_tier::export))
        .route("/api/einsaetze/{id}/tiere/{tid}", get(routes::einsatz_tier::detail))
        .route("/api/einsaetze/{id}/tiere/{tid}", patch(routes::einsatz_tier::aktualisieren))
        .route("/api/einsaetze/{id}/tiere/{tid}/status", post(routes::einsatz_tier::status_wechsel))
        .route("/api/einsaetze/{id}/tiere/{tid}", delete(routes::einsatz_tier::stornieren))
```

(`get`/`post`/`patch`/`delete` sind in `app.rs` bereits importiert.)

- [ ] **Step 4: Build to verify it compiles**

Run: `cargo build`
Expected: kompiliert ohne Fehler. Behebe vom Compiler gemeldete ungenutzte Imports
(z. B. den Marker-`use` aus Step 2 entfernen, falls gerügt).

- [ ] **Step 5: Commit**

```bash
git add src/routes/einsatz_tier.rs src/routes/mod.rs src/app.rs
git commit -m "feat(tier): Routen (CRUD/Status/Storno/Export/SSE) + Mount"
```

---

## Task 5: HTTP-Integrationstests `tests/einsatz_tier.rs`

**Files:**
- Create: `tests/einsatz_tier.rs`

Harness 1:1 wie `tests/einsatz_uhs.rs` (Router+Pool, Login-Cookie, JSON-Request,
`system_etb_inhalte`-Helfer aus `tests/einsatz_person.rs`).

- [ ] **Step 1: Write the integration test file**

```rust
//! HTTP-Integrationstests für Tiere (E‑4): CRUD, Registriernummer, Status-Maschine,
//! Halter-Exklusivität, Soft-Delete, ETB-Pseudonymisierung, Rechte-Matrix,
//! Cross-Einsatz-404 und Read-only-409 für abgeschlossene Einsätze.

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
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
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
    let value = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, value)
}

// ---------- Domänen-Helfer ----------

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/einsaetze", cookie, Some(&json!({"bezeichnung":"Lage"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

/// Legt einen Benutzer an. Passwort = `{name}pw1` — die Server-Policy verlangt
/// ≥ 8 Zeichen (`PASSWORT_MIN_LEN` in `routes/benutzer.rs`), daher müssen die
/// `name`-Argumente ≥ 5 Zeichen lang sein (z. B. "beobachter", "fremdnutzer").
async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/benutzer", admin_cookie,
        Some(&json!({"anzeigename": name, "benutzername": name, "passwort": format!("{name}pw1"), "org_rolle": org_rolle}))).await;
    assert_eq!(s, StatusCode::CREATED, "benutzer_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit_cookie: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (s, _) = anfrage(app, "PUT", &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"), leit_cookie,
        Some(&json!({"einsatz_rolle": rolle}))).await;
    assert_eq!(s, StatusCode::OK);
}

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"), cookie, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn tier_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) -> i64 {
    let (s, v) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/tiere"), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "tier_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

async fn einsatz_abschliessen(app: &axum::Router, cookie: &str, einsatz: i64) {
    let (s, _) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
}

// ---------- Tests: CRUD + Registriernummer + Status ----------

#[tokio::test]
async fn anlegen_vergibt_t_nummer_und_status_aktiv() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin,
        Some(&json!({"spezies":"hund","rufname":"Rex"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["registrier_nr"], 1);
    assert_eq!(v["status"], "aktiv");
    assert_eq!(v["spezies"], "hund");
}

#[tokio::test]
async fn registriernummer_fortlaufend_und_lueckenlos() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t1 = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let _t2 = tier_anlegen(&app, &admin, e, &json!({"spezies":"katze"})).await;
    // Storno t1 → nächste Nummer bleibt 3 (keine Wiederverwendung).
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t1}"), &admin, None).await;
    let (_, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin, Some(&json!({"spezies":"wildtier"}))).await;
    assert_eq!(v["registrier_nr"], 3);
}

#[tokio::test]
async fn anlegen_als_vermisst_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin,
        Some(&json!({"spezies":"katze","status":"vermisst"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["status"], "vermisst");
}

#[tokio::test]
async fn anlegen_als_abgeschlossen_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin,
        Some(&json!({"spezies":"hund","status":"abgeschlossen"}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn anlegen_ohne_spezies_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin,
        Some(&json!({"spezies":"dinosaurier"}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn gueltiger_status_wechsel_aktiv_vermisst_aktiv() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s1, v1) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"vermisst"}))).await;
    assert_eq!(s1, StatusCode::OK);
    assert_eq!(v1["status"], "vermisst");
    let (s2, v2) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"aktiv"}))).await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(v2["status"], "aktiv");
}

#[tokio::test]
async fn ungueltiger_status_wechsel_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"aktiv"}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "aktiv → aktiv verboten");
}

#[tokio::test]
async fn unbekannter_zielstatus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"entlaufen"}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn abschluss_ohne_grund_ist_422_und_mit_grund_ok() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s_ohne, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"abgeschlossen"}))).await;
    assert_eq!(s_ohne, StatusCode::UNPROCESSABLE_ENTITY);
    let (s_mit, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"uebergabe_tierarzt","abschluss_ziel":"Tierarzt Müller"}))).await;
    assert_eq!(s_mit, StatusCode::OK);
    assert_eq!(v["status"], "abgeschlossen");
    assert_eq!(v["abschluss_grund"], "uebergabe_tierarzt");
    assert_eq!(v["abschluss_ziel"], "Tierarzt Müller");
}

// ---------- Tests: Halter-Exklusivität + Soft-Delete ----------

#[tokio::test]
async fn halter_beide_felder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin,
        Some(&json!({"spezies":"hund","halter_person_id":p,"halter_kontakt":"Frau Müller"}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn halter_fk_auf_stornierte_person_bleibt_zulaessig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","halter_person_id":p})).await;
    // Person stornieren.
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/personen/{p}"), &admin, None).await;
    let (s, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["halter_person_id"], p, "Tier-Datensatz unverändert");
    assert!(v["halter_registrier_nr"].is_i64(), "Join löst R-Nr weiterhin auf");
    assert!(v["halter_storniert_at"].is_string(), "Join zeigt storniert");
}

#[tokio::test]
async fn soft_delete_blendet_aus_liste_und_doppelt_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s1, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;
    assert_eq!(s1, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0, "storniert nicht in Liste");
    let (s2, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;
    assert_eq!(s2, StatusCode::CONFLICT, "doppeltes Stornieren → 409");
}

#[tokio::test]
async fn patch_auf_storniertem_tier_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, Some(&json!({"rufname":"Bello"}))).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn halter_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let p_fremd = person_anlegen(&app, &admin, e2).await; // Person in e2
    // Tier in e1 mit Halter-FK auf Person aus e2 → Org-Isolation greift → 404.
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e1}/tiere"), &admin,
        Some(&json!({"spezies":"hund","halter_person_id":p_fremd}))).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Halter aus fremdem Einsatz → 404");
}

#[tokio::test]
async fn liste_filtert_nach_halter_person_id() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","halter_person_id":p})).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"katze"})).await; // ohne Halter
    let (s, v) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere?halter_person_id={p}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 1);
    assert_eq!(v[0]["halter_person_id"], p);
}

// ---------- Tests: ETB-Leak ----------

#[tokio::test]
async fn anlegen_etb_pseudonym_ohne_rufname_und_halter() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","rufname":"GEHEIM_REX","kennzeichnung":"CHIP_999","halter_kontakt":"Frau GEHEIM"})).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(inhalte[0].contains("T-001"), "ETB nennt die Registriernummer");
    assert!(inhalte[0].contains("Hund"), "ETB nennt die Spezies");
    assert!(!inhalte[0].contains("GEHEIM_REX"), "ETB-Leak (rufname)");
    assert!(!inhalte[0].contains("CHIP_999"), "ETB-Leak (kennzeichnung)");
    assert!(!inhalte[0].contains("GEHEIM"), "ETB-Leak (halter_kontakt)");
}

#[tokio::test]
async fn lifecycle_etb_kein_leak_von_ziel_und_kennzeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"katze","rufname":"GEHEIM_MIEZ","kennzeichnung":"TATTOO_ABC"})).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"vermisst"}))).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin, Some(&json!({"status":"aktiv"}))).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"uebergabe_tierarzt","abschluss_ziel":"GEHEIM_ZIEL_TIERARZT"}))).await;
    anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;

    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    // 1× Anlegen + 3× Status + 1× Storno = 5 Einträge.
    assert_eq!(inhalte.len(), 5, "ein Eintrag je Lifecycle-Event: {inhalte:?}");
    for i in &inhalte {
        assert!(!i.contains("GEHEIM_MIEZ"), "Leak rufname: {i}");
        assert!(!i.contains("TATTOO_ABC"), "Leak kennzeichnung: {i}");
        assert!(!i.contains("GEHEIM_ZIEL_TIERARZT"), "Leak abschluss_ziel: {i}");
    }
    assert!(inhalte.iter().any(|i| i.contains("T-001") && i.contains("aufgefunden")), "vermisst→aktiv (aufgefunden)");
    assert!(inhalte.iter().any(|i| i.contains("abgeschlossen (uebergabe_tierarzt)")), "Abschluss nennt nur den Grund");
    assert!(inhalte.iter().any(|i| i.contains("T-001 storniert")));
}

// ---------- Tests: Rechte-Matrix + Org-Isolation + Read-only ----------

#[tokio::test]
async fn beobachter_kann_nicht_schreiben_aber_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    // Lesen ok.
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere"), &beob, None).await;
    assert_eq!(s_get, StatusCode::OK);
    // Schreiben verboten.
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &beob, Some(&json!({"spezies":"katze"}))).await;
    assert_eq!(s_post, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fremder_einsatz_detail_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{anderer}/tiere/{t}"), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn fremder_einsatz_ohne_mitgliedschaft_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fremd_id = benutzer_anlegen(&app, &admin, "fremdnutzer", "keine").await;
    let _ = fremd_id;
    let e = einsatz_anlegen(&app, &admin).await; // admin ist Leitung, fremdnutzer kein Mitglied
    let fremd = login_cookie(&app, "fremdnutzer", "fremdnutzerpw1").await;
    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere"), &fremd, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_readonly_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    einsatz_abschliessen(&app, &admin, e).await;
    // Lesen weiterhin ok (Nachlauffrist), Schreiben → 409.
    let (s_get, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/tiere"), &admin, None).await;
    assert_eq!(s_get, StatusCode::OK);
    let (s_post, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere"), &admin, Some(&json!({"spezies":"katze"}))).await;
    assert_eq!(s_post, StatusCode::CONFLICT);
    let (s_patch, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, Some(&json!({"rufname":"X"}))).await;
    assert_eq!(s_patch, StatusCode::CONFLICT);
    let (s_del, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{e}/tiere/{t}"), &admin, None).await;
    assert_eq!(s_del, StatusCode::CONFLICT);
}

#[tokio::test]
async fn export_liefert_csv_ohne_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","rufname":"Rex"})).await;
    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(format!("/api/einsaetze/{e}/tiere/export"))
            .header(header::COOKIE, &admin).body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ct = resp.headers().get(header::CONTENT_TYPE).unwrap().to_str().unwrap().to_string();
    assert!(ct.starts_with("text/csv"));
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let csv = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(csv.contains("T-001"));
    assert!(csv.contains("Rex"));
}
```

- [ ] **Step 2: Run the integration tests**

Run: `cargo test --test einsatz_tier`
Expected: PASS (alle Tests). Bei einem 500 in `abschluss_ohne_grund_ist_422_und_mit_grund_ok`
liegt der Fehler in `setze_status` (CHECK) — nicht im Test.

- [ ] **Step 3: Run the full backend suite as a regression gate**

Run: `cargo test`
Expected: PASS — keine Regression in den E‑1/E‑3-Tests (insb. Personen/UHS unverändert).

- [ ] **Step 4: Commit**

```bash
git add tests/einsatz_tier.rs
git commit -m "test(tier): HTTP-Integrationstests (CRUD/Status/Halter/ETB/Rechte)"
```

---

## Task 6: Frontend — Typen, API-Client, SSE-Hook

**Files:**
- Modify: `frontend/src/api/types.ts` (Tier-Typen anhängen)
- Create: `frontend/src/api/einsatzTier.ts`
- Create: `frontend/src/etb/useTiereStream.ts`

- [ ] **Step 1: Add Tier types to `frontend/src/api/types.ts`**

Am Ende von `frontend/src/api/types.ts` anhängen (Stil wie der `Person`-Block):

```typescript
export type TierStatus = 'aktiv' | 'vermisst' | 'abgeschlossen';
export type Spezies =
  | 'hund' | 'katze' | 'grosstier' | 'nutzgefluegel' | 'kleintier' | 'wildtier' | 'sonstige';
export type TierGeschlecht = 'maennlich' | 'weiblich' | 'unbekannt';
export type AbschlussGrund =
  | 'uebergabe_halter' | 'uebergabe_tierarzt' | 'uebergabe_tierheim'
  | 'verstorben' | 'freilauf' | 'sonstiges';

export interface Tier {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: TierStatus;
  spezies: Spezies;
  rasse_beschreibung: string | null;
  rufname: string | null;
  geschlecht: TierGeschlecht | null;
  alter_geschaetzt: number | null;
  farbe_beschreibung: string | null;
  kennzeichnung: string | null;
  groesse_gewicht: string | null;
  halter_person_id: number | null;
  halter_kontakt: string | null;
  antreff_ort: string | null;
  notiz: string | null;
  abschluss_grund: AbschlussGrund | null;
  abschluss_ziel: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
  // Read-only Join-Felder (Halter-Auflösung über einsatz_person):
  halter_registrier_nr: number | null;
  halter_storniert_at: string | null;
}
```

- [ ] **Step 2: Create `frontend/src/api/einsatzTier.ts`**

Vorbild: `frontend/src/api/einsatzPerson.ts`.

```typescript
import type { Tier, TierStatus, Spezies } from './types';
import { apiGet, apiSend } from './client';

/** Felder beim Anlegen (Spezies Pflicht; Rest optional). Halter FK XOR Freitext. */
export interface TierEingabe {
  status?: 'aktiv' | 'vermisst';
  spezies: Spezies;
  rasse_beschreibung?: string | null;
  rufname?: string | null;
  geschlecht?: string | null;
  alter_geschaetzt?: number | null;
  farbe_beschreibung?: string | null;
  kennzeichnung?: string | null;
  groesse_gewicht?: string | null;
  halter_person_id?: number | null;
  halter_kontakt?: string | null;
  antreff_ort?: string | null;
  notiz?: string | null;
}

/** Patch-Felder. Halter-Felder akzeptieren `null` = leeren (FK↔Freitext-Toggle). */
export interface TierPatch {
  rasse_beschreibung?: string | null;
  rufname?: string | null;
  geschlecht?: string | null;
  alter_geschaetzt?: number | null;
  farbe_beschreibung?: string | null;
  kennzeichnung?: string | null;
  groesse_gewicht?: string | null;
  antreff_ort?: string | null;
  notiz?: string | null;
  halter_person_id?: number | null;
  halter_kontakt?: string | null;
}

export interface TierStatusEingabe {
  status: TierStatus;
  abschluss_grund?: string | null;
  abschluss_ziel?: string | null;
}

export interface TiereFilter {
  status?: TierStatus;
  spezies?: Spezies;
  halterPersonId?: number;
}

export function listeTiere(einsatzId: number, filter: TiereFilter = {}): Promise<Tier[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.spezies) params.set('spezies', filter.spezies);
  if (filter.halterPersonId != null) params.set('halter_person_id', String(filter.halterPersonId));
  const q = params.toString();
  return apiGet<Tier[]>(`/api/einsaetze/${einsatzId}/tiere${q ? `?${q}` : ''}`);
}

export function ladeTier(einsatzId: number, tierId: number): Promise<Tier> {
  return apiGet<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`);
}

export function legeTierAn(einsatzId: number, daten: TierEingabe): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere`, 'POST', daten);
}

export function aktualisiereTier(einsatzId: number, tierId: number, daten: TierPatch): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'PATCH', daten);
}

export function setzeTierStatus(einsatzId: number, tierId: number, daten: TierStatusEingabe): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}/status`, 'POST', daten);
}

export function storniereTier(einsatzId: number, tierId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (T-042). */
export function tierRegistrierAnzeige(nr: number): string {
  return `T-${String(nr).padStart(3, '0')}`;
}
```

- [ ] **Step 3: Create `frontend/src/etb/useTiereStream.ts`**

Vorbild: `frontend/src/etb/usePersonenStream.ts`. Eine Invalidierung von
`['einsatz-tiere', einsatzId]` deckt per Prefix-Match auch den Cross-Modul-Key
`['einsatz-tiere', einsatzId, 'halter', personId]` ab.

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Einsatz-SSE-Stream und invalidiert bei jedem `tier`- oder
 *  `lagged`-Event die Tier-Listen-Queries (`['einsatz-tiere', einsatzId, …]`).
 *  Per Prefix-Match deckt das sowohl die Modul-Liste als auch den
 *  „Zugeordnete Tiere"-Block im Personen-Drawer ab. Keine sensible Payload
 *  (nur einsatz_id + tier_id). Liegt neben den übrigen SSE-Hooks. */
export function useTiereStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/tiere/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['einsatz-tiere', einsatzId] });
    quelle.addEventListener('tier', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('tier', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: keine Typfehler.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzTier.ts frontend/src/etb/useTiereStream.ts
git commit -m "feat(fe/tier): Typen, API-Client, SSE-Hook"
```

---

## Task 7: Frontend — `TierePage.tsx` + Routing

**Files:**
- Create: `frontend/src/pages/TierePage.tsx`
- Modify: `frontend/src/einsatz/modulRegistry.ts` (Status-Flip)
- Modify: `frontend/src/App.tsx` (Element-Mapping)

Vorbild: `frontend/src/pages/PersonenPage.tsx` (Liste/Tabs/Modal/Drawer/Mutations).
Vereinfacht: keine medizinische Tab, kein Abgleich, kein Audit. Neu: Spezies-Filter,
Halter-Anzeige (`R-nnn`/Freitext/unbekannt), Abschluss-Modal mit Pflicht-Grund,
Halter-Toggle FK↔Freitext.

- [ ] **Step 1: Flip the module status in `frontend/src/einsatz/modulRegistry.ts`**

Den bestehenden `tiere`-Eintrag (modulRegistry.ts:61) ändern: `status: 'geplant'` →
`status: 'fertig'`. Neue Zeile:

```typescript
  { key: 'tiere', kategorie: 'erfassung', label: 'Tiere', icon: TbPaw, route: 'tiere', status: 'fertig', beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.' },
```

- [ ] **Step 2: Wire `TierePage` in `frontend/src/App.tsx`**

Import nach `import PersonenPage from './pages/PersonenPage';` (App.tsx:17) ergänzen:

```typescript
import TierePage from './pages/TierePage';
```

In `MODUL_ELEMENTE` (App.tsx:26‑36) nach der `unfallhilfsstellen`-Zeile ergänzen:

```typescript
  tiere: <TierePage />,
```

- [ ] **Step 3: Create `frontend/src/pages/TierePage.tsx`**

```tsx
import { Alert, App, Breadcrumb, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import {
  aktualisiereTier, ladeTier, legeTierAn, listeTiere, setzeTierStatus, storniereTier,
  tierRegistrierAnzeige, type TierEingabe, type TierPatch,
} from '../api/einsatzTier';
import { ApiError } from '../api/client';
import { useTiereStream } from '../etb/useTiereStream';
import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../api/types';

const STATUS_META: Record<TierStatus, { label: string; color: string }> = {
  aktiv: { label: 'aktiv', color: 'green' },
  vermisst: { label: 'vermisst', color: 'orange' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};
const SPEZIES_KEYS = Object.keys(SPEZIES_META) as Spezies[];

const ABSCHLUSS_META: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'Übergabe an Halter', uebergabe_tierarzt: 'Übergabe an Tierarzt',
  uebergabe_tierheim: 'Übergabe an Tierheim', verstorben: 'verstorben',
  freilauf: 'Freilauf', sonstiges: 'Sonstiges',
};

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'aktiv', label: 'Aktiv' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: TierStatus): TierStatus[] {
  switch (aktuell) {
    case 'aktiv': return ['vermisst', 'abgeschlossen'];
    case 'vermisst': return ['aktiv', 'abgeschlossen'];
    case 'abgeschlossen': return ['aktiv', 'vermisst'];
  }
}

/** Halter-Kurzanzeige für Liste + Drawer. */
function halterAnzeige(t: Tier): React.ReactNode {
  if (t.halter_registrier_nr != null) {
    const label = `R-${String(t.halter_registrier_nr).padStart(3, '0')}`;
    return t.halter_storniert_at
      ? <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
      : <Tag color="blue">{label}</Tag>;
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

export default function TierePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('aktiv');
  const [speziesFilter, setSpeziesFilter] = useState<Spezies | undefined>(undefined);

  useTiereStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const tiereQuery = useQuery({ queryKey: ['einsatz-tiere', einsatzId], queryFn: () => listeTiere(einsatzId) });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst'>(null);
  const [form] = Form.useForm<TierEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-tiere', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (v: TierEingabe) => legeTierAn(einsatzId, v),
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });

  const [offenesTierId, setOffenesTierId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<TierPatch & { halter_modus?: 'fk' | 'freitext' | 'keiner' }>();

  const detailQuery = useQuery({
    queryKey: ['einsatz-tier', einsatzId, offenesTierId],
    queryFn: () => ladeTier(einsatzId, offenesTierId!),
    enabled: offenesTierId != null,
  });

  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: ['einsatz-tier', einsatzId, offenesTierId] });
  }
  const editMutation = useMutation({
    mutationFn: (daten: TierPatch) => aktualisiereTier(einsatzId, offenesTierId!, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { status: TierStatus }) => setzeTierStatus(einsatzId, offenesTierId!, { status: v.status }),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (tierId: number) => storniereTier(einsatzId, tierId),
    onSuccess: () => { invalidate(); setOffenesTierId(null); }, onError: fehler,
  });

  // Abschluss-Modal (Pflicht-Grund + optionales Ziel).
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [abschlussForm] = Form.useForm<{ abschluss_grund: AbschlussGrund; abschluss_ziel?: string }>();
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: AbschlussGrund; abschluss_ziel?: string }) =>
      setzeTierStatus(einsatzId, offenesTierId!, {
        status: 'abgeschlossen', abschluss_grund: v.abschluss_grund, abschluss_ziel: v.abschluss_ziel ?? null,
      }),
    onSuccess: () => { invalidateDetail(); setAbschlussOffen(false); abschlussForm.resetFields(); },
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

  const alle = tiereQuery.data ?? [];
  const personen = alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !speziesFilter || t.spezies === speziesFilter);

  const spalten: TableColumnsType<Tier> = [
    {
      title: 'Reg.-Nr.', key: 'reg', width: 90,
      render: (_, t) => <Typography.Text strong>{tierRegistrierAnzeige(t.registrier_nr)}</Typography.Text>,
    },
    {
      title: 'Status', key: 'status', width: 130,
      render: (_, t) => <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>,
    },
    { title: 'Spezies', key: 'spezies', width: 120, render: (_, t) => SPEZIES_META[t.spezies] },
    {
      title: 'Rufname', key: 'rufname',
      render: (_, t) => t.rufname ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: 'Rasse', dataIndex: 'rasse_beschreibung', key: 'rasse', render: (r) => r ?? '—' },
    { title: 'Halter', key: 'halter', render: (_, t) => halterAnzeige(t) },
    { title: 'Antreffort', dataIndex: 'antreff_ort', key: 'antreff_ort', render: (t) => t ?? '—' },
  ];

  function drawerInhalt(t: Tier) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Space wrap>
          <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>
          <Tag>{SPEZIES_META[t.spezies]}</Tag>
          {t.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>

        {darfSchreiben && !t.storniert_at && (
          <Space wrap>
            {naechsteStatus(t.status).map((s) =>
              s === 'abgeschlossen' ? (
                <Button key={s} size="small" onClick={() => setAbschlussOffen(true)}>Abschließen</Button>
              ) : (
                <Button key={s} size="small"
                  onClick={() => statusMutation.mutate({ status: s })}>
                  {s === 'vermisst' ? 'Als vermisst markieren' : s === 'aktiv' && t.status === 'vermisst' ? 'Aufgefunden' : `→ ${STATUS_META[s].label}`}
                </Button>
              ),
            )}
          </Space>
        )}

        {bearbeiten ? (
          <Form form={editForm} layout="vertical"
            onFinish={(daten) => {
              const modus = daten.halter_modus ?? 'keiner';
              const patch: TierPatch = {
                rasse_beschreibung: daten.rasse_beschreibung, rufname: daten.rufname,
                geschlecht: daten.geschlecht, alter_geschaetzt: daten.alter_geschaetzt,
                farbe_beschreibung: daten.farbe_beschreibung, kennzeichnung: daten.kennzeichnung,
                groesse_gewicht: daten.groesse_gewicht, antreff_ort: daten.antreff_ort, notiz: daten.notiz,
                // Halter-Toggle: immer beide Felder explizit senden (eines null).
                halter_person_id: modus === 'fk' ? daten.halter_person_id ?? null : null,
                halter_kontakt: modus === 'freitext' ? daten.halter_kontakt ?? null : null,
              };
              editMutation.mutate(patch);
            }}>
            <Form.Item label="Rufname" name="rufname"><Input /></Form.Item>
            <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung"><Input /></Form.Item>
            <Form.Item label="Geschlecht" name="geschlecht">
              <Select allowClear options={[
                { value: 'maennlich', label: 'männlich' }, { value: 'weiblich', label: 'weiblich' },
                { value: 'unbekannt', label: 'unbekannt' },
              ]} />
            </Form.Item>
            <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt"><InputNumber min={0} max={120} /></Form.Item>
            <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung"><Input /></Form.Item>
            <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung"><Input /></Form.Item>
            <Form.Item label="Größe / Gewicht" name="groesse_gewicht"><Input /></Form.Item>
            <Form.Item label="Antreffort" name="antreff_ort"><Input /></Form.Item>
            <Form.Item label="Halter" name="halter_modus">
              <Radio.Group options={[
                { value: 'keiner', label: 'unbekannt' },
                { value: 'fk', label: 'Person im Einsatz (R-Nr.)' },
                { value: 'freitext', label: 'Freitext (extern)' },
              ]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.halter_modus !== c.halter_modus}>
              {() => {
                const m = editForm.getFieldValue('halter_modus');
                if (m === 'fk') return <Form.Item label="Halter-Person-ID" name="halter_person_id"><InputNumber min={1} style={{ width: 200 }} /></Form.Item>;
                if (m === 'freitext') return <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt"><Input /></Form.Item>;
                return null;
              }}
            </Form.Item>
            <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
              <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
            </Space>
          </Form>
        ) : (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Rufname">{t.rufname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Rasse / Beschreibung">{t.rasse_beschreibung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{t.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">{t.alter_geschaetzt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Farbe / Erscheinung">{t.farbe_beschreibung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Kennzeichnung">{t.kennzeichnung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Größe / Gewicht">{t.groesse_gewicht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Antreffort">{t.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Halter">
              {/* Klick auf R-nnn führt in den (auditierten) Personen-Pfad. */}
              {t.halter_person_id != null ? (
                <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/einsaetze/${einsatzId}/personen`)}>
                  {halterAnzeige(t)}
                </Button>
              ) : halterAnzeige(t)}
            </Descriptions.Item>
            <Descriptions.Item label="Notiz">{t.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}

        {t.status === 'abgeschlossen' && (
          <Descriptions column={1} size="small" title="Abschluss">
            <Descriptions.Item label="Grund">{t.abschluss_grund ? ABSCHLUSS_META[t.abschluss_grund] : '—'}</Descriptions.Item>
            <Descriptions.Item label="Ziel">{t.abschluss_ziel ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}

        {darfSchreiben && !t.storniert_at && !bearbeiten && (
          <Space>
            <Button onClick={() => {
              setBearbeiten(true);
              editForm.setFieldsValue({
                ...t,
                halter_modus: t.halter_person_id != null ? 'fk' : t.halter_kontakt ? 'freitext' : 'keiner',
              } as never);
            }}>Bearbeiten</Button>
            <Popconfirm title="Tier stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(t.id)}>
              <Button danger>Stornieren</Button>
            </Popconfirm>
          </Space>
        )}
      </Space>
    );
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Tiere' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Tiere</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
          </Space>
        )}
      </Space>

      <Tabs activeKey={sicht} onChange={(k) => setSicht(k as Sicht)} items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))} />

      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Spezies:</Typography.Text>
        <Select<Spezies | undefined> allowClear placeholder="alle" style={{ width: 180 }}
          value={speziesFilter} onChange={(v) => setSpeziesFilter(v)}
          options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={tiereQuery.isLoading}
        dataSource={personen}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Tiere in dieser Sicht' }}
        onRow={(t) => ({ onClick: () => { setOffenesTierId(t.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
      />

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form form={form} layout="vertical"
          initialValues={{ spezies: 'hund' }}
          onFinish={(daten) => anlegenMutation.mutate({ ...daten, status: modus === 'vermisst' ? 'vermisst' : 'aktiv' })}>
          <Form.Item label="Spezies" name="spezies" rules={[{ required: true, message: 'Bitte Spezies wählen' }]}>
            <Select options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
          </Form.Item>
          <Form.Item label="Rufname" name="rufname"><Input /></Form.Item>
          <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung"><Input placeholder="z. B. Haflinger, Deutscher Schäferhund" /></Form.Item>
          <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Weide, Sammelstelle" /></Form.Item>
          {modus === 'vermisst' && (
            <>
              <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung"><Input /></Form.Item>
              <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung"><Input /></Form.Item>
              <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt"><Input placeholder="meldender Halter" /></Form.Item>
            </>
          )}
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Drawer
        open={offenesTierId != null}
        width={520}
        title={detailQuery.data ? `Tier ${tierRegistrierAnzeige(detailQuery.data.registrier_nr)}` : 'Tier'}
        onClose={() => { setOffenesTierId(null); setBearbeiten(false); }}
      >
        {detailQuery.isLoading && <Spin />}
        {detailQuery.data && drawerInhalt(detailQuery.data)}
      </Drawer>

      <Modal
        open={abschlussOffen}
        title="Tier abschließen"
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        onOk={() => abschlussForm.submit()}
        onCancel={() => { setAbschlussOffen(false); abschlussForm.resetFields(); }}
        destroyOnClose
      >
        <Form form={abschlussForm} layout="vertical" onFinish={abschlussMutation.mutate}>
          <Form.Item label="Abschlussgrund" name="abschluss_grund" rules={[{ required: true, message: 'Grund ist Pflicht' }]}>
            <Select options={(Object.keys(ABSCHLUSS_META) as AbschlussGrund[]).map((k) => ({ value: k, label: ABSCHLUSS_META[k] }))} />
          </Form.Item>
          <Form.Item label="Ziel (Freitext, z. B. Tierarzt Müller, R-Nr. des Halters)" name="abschluss_ziel"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: keine Fehler. (Falls `Radio`/`useNavigate` als ungenutzt gemeldet werden,
prüfe die Imports — beide werden oben verwendet.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TierePage.tsx frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx
git commit -m "feat(fe/tier): TierePage + Routing + Modul aktiviert"
```

---

## Task 8: Frontend — `TierePage.test.tsx`

**Files:**
- Create: `frontend/src/pages/TierePage.test.tsx`

Vorbild: `frontend/src/pages/PersonenPage.test.tsx` (MSW-Handler, `FakeEventSource`,
`renderMitProviders`).

- [ ] **Step 1: Write the test file**

```tsx
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import TierePage from './TierePage';
import type { Tier } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-29 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-29 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-29 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const tierBasis: Tier = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'aktiv', spezies: 'hund',
  rasse_beschreibung: 'Schäferhund', rufname: 'Rex', geschlecht: 'maennlich',
  alter_geschaetzt: 3, farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
  halter_person_id: null, halter_kontakt: null, antreff_ort: 'Weide', notiz: null,
  abschluss_grund: null, abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00', erfasst_von: 1, geaendert_at: '2026-05-29 09:00:00',
  geaendert_von: 1, storniert_at: null, halter_registrier_nr: null, halter_storniert_at: null,
};
const tierVermisst: Tier = { ...tierBasis, id: 11, registrier_nr: 2, status: 'vermisst', spezies: 'katze', rufname: 'Mimi' };

function render(einsatzObj: typeof einsatzAktiv, tiere: Tier[]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json(tiere)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/tiere" element={<TierePage />} />
        <Route path="/einsaetze/:id/personen" element={<div>Personen-Modul</div>} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/tiere' },
  );
}

describe('TierePage', () => {
  it('zeigt aktive Tiere mit T-Nummer und Status', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    expect(await screen.findByText('T-001')).toBeInTheDocument();
    expect(screen.getByText('Rex')).toBeInTheDocument();
    // vermisste Katze ist in der Default-Sicht „Aktiv" nicht sichtbar:
    expect(screen.queryByText('T-002')).not.toBeInTheDocument();
  });

  it('filtert per Tab auf Vermisst', async () => {
    render(einsatzAktiv, [tierBasis, tierVermisst]);
    await screen.findByText('T-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Vermisst' }));
    expect(await screen.findByText('T-002')).toBeInTheDocument();
    expect(screen.getByText('Mimi')).toBeInTheDocument();
  });

  it('filtert nach Spezies', async () => {
    render(einsatzAktiv, [tierBasis, { ...tierBasis, id: 12, registrier_nr: 3, spezies: 'katze', rufname: 'Felix' }]);
    await screen.findByText('Rex');
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText('Katze'));
    expect(await screen.findByText('Felix')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
  });

  it('Einsatzleitung sieht Anlege-Buttons, Beobachter nicht', async () => {
    render(einsatzAktiv, []);
    await screen.findByRole('heading', { name: 'Tiere' });
    expect(screen.getByRole('button', { name: 'Schnellerfassung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vermisst melden' })).toBeInTheDocument();
  });

  it('Beobachter sieht keine Schreibaktionen', async () => {
    render(einsatzBeobachter, [tierBasis]);
    await screen.findByText('T-001');
    expect(screen.queryByRole('button', { name: 'Schnellerfassung' })).not.toBeInTheDocument();
  });

  it('Schnellerfassung schickt status=aktiv + spezies', async () => {
    let body: { spezies?: string; status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { spezies?: string; status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99 }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('aktiv'));
    expect(body.spezies).toBe('hund'); // initialValues
  });

  it('Vermisst-Meldung schickt status=vermisst', async () => {
    let body: { status?: string } = {};
    server.use(http.post('/api/einsaetze/1/tiere', async ({ request }) => {
      body = await request.json() as { status?: string };
      return HttpResponse.json({ ...tierBasis, id: 99, status: 'vermisst' }, { status: 201 });
    }));
    render(einsatzAktiv, []);
    await userEvent.click(await screen.findByRole('button', { name: 'Vermisst melden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await vi.waitFor(() => expect(body.status).toBe('vermisst'));
  });

  it('öffnet den Detail-Drawer und zeigt den Abschluss-Block bei abgeschlossen', async () => {
    const abgeschlossen: Tier = { ...tierBasis, status: 'abgeschlossen', abschluss_grund: 'uebergabe_tierarzt', abschluss_ziel: 'Tierarzt Müller' };
    server.use(http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(abgeschlossen)));
    render(einsatzAktiv, [abgeschlossen]);
    await userEvent.click(screen.getByRole('tab', { name: 'Abgeschlossen' }));
    await userEvent.click((await screen.findAllByText('Rex'))[0]);
    expect(await screen.findByText('Tier T-001')).toBeInTheDocument();
    expect(await screen.findByText('Übergabe an Tierarzt')).toBeInTheDocument();
    expect(screen.getByText('Tierarzt Müller')).toBeInTheDocument();
  });

  it('Abschließen-Modal erzwingt einen Grund und schickt ihn', async () => {
    let body: { status?: string; abschluss_grund?: string } = {};
    server.use(
      http.get('/api/einsaetze/1/tiere/10', () => HttpResponse.json(tierBasis)),
      http.post('/api/einsaetze/1/tiere/10/status', async ({ request }) => {
        body = await request.json() as { status?: string; abschluss_grund?: string };
        return HttpResponse.json({ ...tierBasis, status: 'abgeschlossen', abschluss_grund: 'freilauf' });
      }),
    );
    render(einsatzAktiv, [tierBasis]);
    await userEvent.click((await screen.findAllByText('Rex'))[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Abschließen' }));
    // Ohne Grund: Submit blockiert (Pflichtfeld) → kein Request.
    await userEvent.click(screen.getByRole('button', { name: 'Abschließen' })); // OK-Button im Modal
    expect(await screen.findByText('Grund ist Pflicht')).toBeInTheDocument();
    expect(body.status).toBeUndefined();
    // Mit Grund:
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByText('Freilauf'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abschließen' }));
    await vi.waitFor(() => expect(body.abschluss_grund).toBe('freilauf'));
    expect(body.status).toBe('abgeschlossen');
  });

  it('zeigt die Halter-R-Nr und „storniert" aus den Join-Feldern', async () => {
    const mitHalter: Tier = { ...tierBasis, halter_person_id: 5, halter_registrier_nr: 7, halter_storniert_at: '2026-05-29 11:00:00' };
    render(einsatzAktiv, [mitHalter]);
    expect(await screen.findByText(/Halter \(storniert\): R-007/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the page tests**

Run: `cd frontend && pnpm test -- TierePage`
Expected: PASS. Falls die Antd-`Select`-Option im Test nicht gefunden wird, prüfe, dass
der Filter-`combobox` vor dem Spezies-Klick offen ist (siehe `PersonenPage.test.tsx`-Muster).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TierePage.test.tsx
git commit -m "test(fe/tier): TierePage (Liste/Filter/Anlegen/Abschluss/Halter)"
```

---

## Task 9: Cross-Modul — „Zugeordnete Tiere"-Block im Personen-Drawer

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

Lesender Block im Stammdaten-Tab des Personen-Drawers, der alle Tiere mit
`halter_person_id = person.id` zeigt; live über `tier`-SSE. Read-only — Anlegen/
Bearbeiten passiert nur im Tier-Modul. Pragmatisch: Chips verlinken in das Tier-Modul
(kein Cross-Page-Drawer-State).

- [ ] **Step 1: Write the failing test for the new block**

In `frontend/src/pages/PersonenPage.test.tsx` einen Test ergänzen (vor der schließenden
`});` der `describe`-Suite). Er rendert eine Person mit zugeordnetem Tier.

```tsx
  it('zeigt den „Zugeordnete Tiere"-Block im Personen-Drawer', async () => {
    const detail = { ...person, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
      aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
      sichtungen: [], notizen: [], verbleib: [], abgleiche: [] } as PersonDetail;
    server.use(
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)),
      http.get('/api/einsaetze/1/tiere', ({ request }) => {
        const url = new URL(request.url);
        // Nur der Cross-Modul-Fetch trägt halter_person_id.
        if (url.searchParams.get('halter_person_id') === '10') {
          return HttpResponse.json([{
            id: 30, einsatz_id: 1, registrier_nr: 7, status: 'aktiv', spezies: 'hund',
            rasse_beschreibung: null, rufname: 'Rex', geschlecht: null, alter_geschaetzt: null,
            farbe_beschreibung: null, kennzeichnung: null, groesse_gewicht: null,
            halter_person_id: 10, halter_kontakt: null, antreff_ort: null, notiz: null,
            abschluss_grund: null, abschluss_ziel: null, erfasst_at: '2026-05-27 09:00:00',
            erfasst_von: 1, geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1,
            storniert_at: null, halter_registrier_nr: 1, halter_storniert_at: null,
          }]);
        }
        return HttpResponse.json([]);
      }),
    );
    render(einsatzAktiv, [person]);
    await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
    expect(await screen.findByText(/Zugeordnete Tiere/i)).toBeInTheDocument();
    expect(await screen.findByText(/T-007/)).toBeInTheDocument();
    expect(screen.getByText(/Rex/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm test -- PersonenPage`
Expected: FAIL — der neue Test findet „Zugeordnete Tiere" nicht (Block existiert noch nicht).

- [ ] **Step 3: Add imports + tier query + SSE subscription in `PersonenPage.tsx`**

3a. Importe ergänzen. Nach `import { usePersonenStream } from '../etb/usePersonenStream';`
(PersonenPage.tsx:8):

```tsx
import { useTiereStream } from '../etb/useTiereStream';
import { listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
```

Im bestehenden Typ-Import aus `'../api/types'` (PersonenPage.tsx:9) `Tier` ergänzen:

```tsx
import type { Person, PersonDetail, PersonStatus, PersonZugriff, Sichtungskategorie, Verbleib, VerbleibArt, Tier } from '../api/types';
```

Eine Spezies-Label-Map auf Modulebene (nach `STATUS_META`, ca. PersonenPage.tsx:37):

```tsx
const TIER_SPEZIES_LABEL: Record<string, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};
```

3b. SSE-Abo + Cross-Modul-Query in der Komponente. Nach `usePersonenStream(einsatzId);`
(PersonenPage.tsx:82):

```tsx
  useTiereStream(einsatzId); // hält den „Zugeordnete Tiere"-Block live
```

Nach der `detailQuery`-Definition (nach PersonenPage.tsx:119) ergänzen:

```tsx
  const tiereDerPersonQuery = useQuery({
    queryKey: ['einsatz-tiere', einsatzId, 'halter', offenePersonId],
    queryFn: () => listeTiere(einsatzId, { halterPersonId: offenePersonId! }),
    enabled: offenePersonId != null,
  });
```

- [ ] **Step 4: Render the block in the Stammdaten tab of `drawerInhalt`**

In `drawerInhalt(p)` im `'stamm'`-Tab `children` — direkt vor dem Zugriffs-Audit-Block
(`{einsatz.meine_rolle === 'einsatzleitung' && (` …, PersonenPage.tsx:328) einfügen:

```tsx
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Zugeordnete Tiere
                  </Typography.Text>
                  {(tiereDerPersonQuery.data?.length ?? 0) === 0 ? (
                    <div><Typography.Text type="secondary">keine</Typography.Text></div>
                  ) : (
                    <Space wrap style={{ marginTop: 4 }}>
                      {(tiereDerPersonQuery.data ?? []).map((t: Tier) => (
                        <Tag
                          key={t.id}
                          color="cyan"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/einsaetze/${einsatzId}/tiere`)}
                        >
                          {tierRegistrierAnzeige(t.registrier_nr)} {TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}
                          {t.rufname ? ` „${t.rufname}"` : ''}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </div>
```

3c. `useNavigate` verfügbar machen. Falls `PersonenPage` es noch nicht importiert
(PersonenPage.tsx:2 importiert nur `Link, useParams`), ändere die Zeile zu:

```tsx
import { Link, useNavigate, useParams } from 'react-router-dom';
```

…und in der Komponente nach `const einsatzId = Number(id);` (PersonenPage.tsx:79):

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && pnpm test -- PersonenPage`
Expected: PASS (neuer Test + alle bestehenden PersonenPage-Tests grün).

- [ ] **Step 6: Typecheck + lint the whole frontend**

Run: `cd frontend && pnpm typecheck && pnpm lint`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe/tier): Personen-Drawer „Zugeordnete Tiere\" (lesend, live)"
```

---

## Task 10: Abschluss-Verifikation (ganze Suite)

**Files:** keine — reines Verifikations-Gate vor Abschluss.

- [ ] **Step 1: Backend — komplette Suite**

Run: `cargo test`
Expected: PASS, keine Regression. Wegen des rtk-Hooks, der Exit-Codes maskieren kann
(siehe Memory), bei Zweifel über echten Pass/Fail-Status:
`rtk proxy cargo test` und auf den echten Exit-Code achten.

- [ ] **Step 2: Backend — Lints/Format**

Run: `cargo clippy --all-targets && cargo fmt --check`
Expected: keine Clippy-Warnungen, Formatierung sauber. Behebe gemeldete Punkte.

- [ ] **Step 3: Frontend — Tests + Typecheck + Lint**

Run: `cd frontend && pnpm test && pnpm typecheck && pnpm lint`
Expected: alle grün.

- [ ] **Step 4: Final commit (falls Format-/Lint-Fixes nötig waren)**

```bash
git add -A
git commit -m "chore(tier): Lint/Format-Feinschliff E-4"
```

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Abdeckung (jede Anforderung → Task):**
- Tier-Entity `einsatz_tier` (Soft-Delete, `T-nnn`) → Task 1 (Migration) + Task 2 (`registrier_anzeige`) + Task 3 (Repo).
- Spezies-Enum + Identitäts-/Halter-Felder (FK XOR Freitext, CHECK) → Task 1 (CHECK) + Task 2 (`Spezies`) + Task 3 (`anlegen`/`aktualisiere`) + Task 4 (Route-Validierung 422).
- Status-Maschine `{aktiv,vermisst,abgeschlossen}` inkl. Pflicht-`abschluss_grund` → Task 2 (`darf_uebergehen`) + Task 3 (`setze_status` mit Grund im selben UPDATE) + Task 4 (Route 422).
- CRUD + Status + Stornieren + Org-Isolation + Rollen-/Nachlauf-Gate → Task 4 (Handler, `fordere_*`) + Task 5 (Rechte-Matrix-Tests).
- Pseudonyme ETB-Spur (`typ=system`) bei Lifecycle-Events → Task 4 (`etb_system`-Texte) + Task 5 (Leak-Tests, ein Eintrag je Event).
- SSE-Live (Event `tier`, ohne sensible Payload) → Task 4 (`sse_tier`) + Task 6 (`useTiereStream`).
- Frontend-Modul „Tiere" (Liste/Filter/Schnellerfassung/Vermisst/Detail-Drawer) → Task 7 + Task 8.
- Lesende Cross-Modul-Erweiterung im Personen-Drawer → Task 9.
- Export (CSV, Lesen, nicht auditiert) → Task 4 (`export`) + Task 5 (`export_liefert_csv_ohne_audit`).
- DB-CHECKs als zweite Verteidigungslinie → Task 1 (db.rs-Migrationstest) **getrennt** von Task 4/5 (Route-422).

**Bewusst NICHT umgesetzt (Spec „Draußen" / Entwurfs-Entscheidungen):** Lese-Audit
auf Tieren, Verbleibs-Event-Modell, Halter-Auto-Effekte, Tier-Sammelstelle,
Massentierhaltung; `abschluss_grund` via PATCH (siehe Entscheidung 2); transaktionaler
ETB (siehe Entscheidung 1).

**Typ-Konsistenz geprüft:** `tier::registrier_anzeige`/`tierRegistrierAnzeige` → `T-nnn`
durchgängig · SSE-Tag `"tier"` in Backend (`sse_tier`) und Hook (`useTiereStream`)
identisch · Query-Keys `['einsatz-tiere', …]` (Liste/Cross-Modul) vs.
`['einsatz-tier', …]` (Detail) konsistent · `setze_status`-Signatur
(`abschluss_grund`/`abschluss_ziel`) identisch zwischen Task 3 (Repo) und Task 4 (Aufruf).

**Platzhalter-Scan:** keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code
und jeder Test-Schritt einen konkreten Befehl mit erwartetem Ergebnis.
