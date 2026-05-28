# E‑3 Unfallhilfsstellen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strukturierte interne Örtlichkeit für E‑1-Personen bauen — Unfallhilfsstellen (PA, BHP, VSS, …) mit benannten Plätzen als 1:1-Slots + impliziter Inbox, Status-Maschine, Verfügbarkeit-/Reservierungs-Logik, Material-Verortung, Cross-Modul-Auto-Austritt aus E‑1/E‑2, pseudonyme ETB-Spur und DnD-Grundriss im Frontend.

**Architecture:** Vier neue Tabellen (`uhs`, `uhs_platz`, `person_uhs_belegung`) plus zwei Cache-Spalten + ein partieller Unique-Index auf `einsatz_person`, plus `uhs_id` auf `einsatz_material`. Neues Backend-Modul `src/uhs/` mit drei fokussierten Repos (`repo` für UHS, `platz_repo` für Plätze, `belegung_repo` für Belegungs-Events) — alle Status-/Belegungs-Inserts transaktional. Routen-Modul `src/routes/einsatz_uhs.rs` montiert UHS-/Platz-/Belegungs-Endpunkte unter `/api/einsaetze/:id/`. Cross-Modul-Wirkung über `routes::einsatz_uhs::auto_austritt`-Wrapper (sequentiell aus den bestehenden E‑1/E‑2-Handlern aufgerufen, eigene ETB-Spur). Frontend-Modul „Unfallhilfsstellen" mit `@dnd-kit/core` für den Grundriss-DnD.

**ETB-Schreibreihenfolge (bewusste Konvention, weicht vom Wortlaut der Spec ab):** Die Spec sagt mehrfach „in derselben Transaktion wie der fachliche Insert". Der Codebase-Präzedenzfall ist jedoch **sequentiell nach dem Insert über den Pool** — siehe `src/routes/einsatz_fahrzeug.rs:14-17`: *„Bewusst sequentiell nach der Disposition (Entscheidung 4 der Spec: ETB = zusätzliche, append-only Spur)"* — und E‑2 (`einsatz_person.rs`, Plan-Header) macht es genauso. `etb_repo::anlegen` nimmt nur `&SqlitePool`. **Wir folgen der Codebase-Konvention:** ETB + SSE laufen im Handler (oder im `auto_austritt`-Wrapper) nach dem Repo-Aufruf. **Echt atomar (via `pool.begin()` im Repo) bleiben:** UHS-Status-Wechsel + ETB-würdiger Effekt sind unabhängige Schritte; Belegungs-Insert + Cache-Update + Auto-Aufbereitung + Reservierungs-Einlösung laufen in **einer** Repo-Transaktion. Die Cross-Modul-Wirkung (E‑1-Status zu verstorben → UHS-Auto-Austritt) ist bewusst **sequenziell**: kleines Risiko-Fenster bei Crash zwischen Status-Update und Auto-Austritt-Insert; analog E‑2 akzeptiert.

**`uhs_auto_austritt`-Signatur (Klarstellung gegenüber Spec):** Die Spec beschreibt den Helper mit `(tx, person_id, anlass)`. Wir implementieren ihn als zwei Schichten: (a) `belegung_repo::austritt_intern(pool, einsatz_id, person_id, notiz, erfasst_von) -> Result<Option<AustrittInfo>>` macht den transaktionalen Insert + Cache-Cleanup + Auto-Aufbereitung + Reservierungs-Cleanup; (b) `routes::einsatz_uhs::auto_austritt(state, einsatz_id, person_id, anlass, benutzer_id) -> Result<()>` ist der Routen-seitige Wrapper, der den Repo-Aufruf macht UND ETB + SSE schreibt. Liegt im Routen-Modul, damit `&AppState` (ETB + Live-Hub) verfügbar ist und keine zirkuläre Abhängigkeit `src/uhs/ → src/routes/` entsteht.

**Tech Stack:** Rust (axum 0.8, sqlx 0.8/SQLite, tokio), React + TypeScript + Ant Design v5 + TanStack Query, `@dnd-kit/core` (+ `@dnd-kit/modifiers`) für Grundriss-DnD, Vitest + MSW (Frontend-Tests), `tower::ServiceExt::oneshot` (HTTP-Integrationstests).

---

## Konventionen & Begriffe (verbindlich für alle Tasks)

- **Backend-Modul:** Neu unter `src/uhs/` (`mod.rs`, `repo.rs`, `platz_repo.rs`, `belegung_repo.rs`). In `src/lib.rs` als `pub mod uhs;` registrieren.
- **Tabellen:** `uhs`, `uhs_platz`, `person_uhs_belegung`. Cache-Spalten auf `einsatz_person`: `aktuelle_uhs_id` (INTEGER, FK), `aktueller_platz_id` (INTEGER, FK). Zusätzlich `einsatz_material.uhs_id` (INTEGER, FK).
- **Migrations:** `0027_uhs.sql` … `0030_einsatz_material_uhs.sql` (E‑2 endet bei `0026`). Falls K&M‑4 zwischenzeitlich Migrationen einreicht, rücken die Nummern hier um den entsprechenden Offset weiter.
- **UHS-Typ** (Enum `UhsTyp`, exakt = CHECK): `patientenablage`, `behandlungsplatz`, `verletztensammelstelle`, `bereitstellungsraum`, `sonstige`.
- **UHS-Status** (Enum `UhsStatus`, exakt = CHECK): `geplant`, `aktiv`, `aufgeloest`. Status-Maschine: `geplant → aktiv → aufgeloest` (terminal).
- **Platz-Typ** (Enum `PlatzTyp`, exakt = CHECK): `wartebereich`, `behandlungsplatz`, `bett`, `intensivplatz`, `trage`, `transport_bereitstellung`, `sonstige`.
- **Verfügbarkeit** (Enum `Verfuegbarkeit`, exakt = CHECK): `frei`, `defekt`, `aufbereitung`, `gesperrt`, `reserviert`. `reserviert` erfordert `reserviert_fuer_person_id` (DB-CHECK).
- **Belegungs-Art** (Enum `BelegungsArt`, exakt = CHECK): `eintritt`, `wechsel`, `austritt`. Append-only.
- **Inbox-Semantik:** `person_uhs_belegung.platz_id = NULL` mit gesetzter `uhs_id` = Person ist in der UHS, aber noch in der unbegrenzten Inbox. Cache spiegelt das: `aktuelle_uhs_id = uhs.id`, `aktueller_platz_id = NULL`. Der partielle Unique-Index auf `einsatz_person(aktueller_platz_id) WHERE aktueller_platz_id IS NOT NULL` erzwingt 1:1 nur für echte Plätze.
- **Pseudonyme ETB-Texte** (`typ=system`, nur `registrier_nr` + UHS-Bezeichnung + ggf. Platz, **nie** `name`/`vorname`):
  - `eintritt` Inbox → `Person R-042: Aufnahme in BHP 50 (Inbox)`
  - `eintritt` Platz → `Person R-042: Aufnahme in BHP 50 (Bett 3)`
  - `wechsel` innerhalb UHS → `Person R-042: Verlegung in BHP 50 (Bett 3 → Bett 5)`
  - `wechsel` UHS-übergreifend → `Person R-042: Verlegung BHP 50 → PA 1 (Wartestuhl 3)`
  - `austritt` manuell → `Person R-042: verlässt BHP 50`
  - `austritt` Auto (Status) → `Person R-042: verlässt BHP 50 (durch Status-Wechsel zu verstorben)` (bzw. `… abgemeldet`)
  - `austritt` Auto (Verbleib) → `Person R-042: verlässt BHP 50 (durch Verbleib transport)` (bzw. `… entlassung`)
  - UHS `geplant → aktiv` → `BHP 50 (Behandlungsplatz) in Betrieb genommen`
  - UHS `aktiv → aufgeloest` → `BHP 50 aufgelöst`
  - **KEIN ETB-Eintrag** bei: Verfügbarkeits-Wechsel, Reservierungs-Setzen/-Auflösen, Material-Verortung, Platz-CRUD/-Layout-Änderung, UHS-`geplant`-Anlegen, UHS-PATCH-Stammfelder.
- **SSE-Events:** `uhs` (Payload `{ einsatz_id, uhs_id }`) bei UHS-/Platz-/Verfügbarkeits-/Belegungs-Änderung; **zusätzlich** `person` (bestehender Event, Payload `{ einsatz_id, person_id }`) bei jedem Belegungs-Event.
- **Berechtigung:** Lesen via `fordere_lesezugriff` (inkl. Nachlauffrist + höhere Berechtigung). Schreiben via `fordere_schreibrecht` (Beobachter blockiert) + `fordere_aktiv` (abgeschlossener Einsatz → 409). Org-Isolation jeder Query über `einsatz_id`-Prädikat.
- **Frontend:** Typen in `frontend/src/api/types.ts`; API-Client `frontend/src/api/einsatzUhs.ts`; SSE-Hook `frontend/src/etb/useUhsStream.ts`; Seite `frontend/src/pages/UnfallhilfsstellenPage.tsx`. `modulRegistry`-Eintrag `unfallhilfsstellen` von `status: 'geplant'` auf `'fertig'` umstellen; in `App.tsx` `MODUL_ELEMENTE` ergänzen.

### File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `migrations/0027_uhs.sql` | UHS-Entity inkl. Status-Maschine + Soft-Delete | 1 |
| `migrations/0028_uhs_platz.sql` | Plätze (Typ, Layout, Verfügbarkeit, Reservierung) | 2 |
| `migrations/0029_person_uhs_belegung.sql` | Belegungs-Verlauf + Cache + 1:1-Index | 3 |
| `migrations/0030_einsatz_material_uhs.sql` | `einsatz_material.uhs_id` | 4 |
| `src/lib.rs` | `pub mod uhs;` registrieren | 5 |
| `src/uhs/mod.rs` | Enums (`UhsTyp`/`UhsStatus`/`PlatzTyp`/`Verfuegbarkeit`/`BelegungsArt`), Anzeige-Structs, Status-Maschine `darf_uebergehen` | 5 |
| `src/uhs/repo.rs` | UHS-CRUD: `liste`, `laden`, `anlegen`, `aktualisiere`, `setze_status`, `storniere`, `aktive_belegungen` | 6 |
| `src/uhs/platz_repo.rs` | Platz-CRUD: `liste_je_uhs`, `laden`, `anlegen`, `aktualisiere`, `setze_verfuegbarkeit`, `storniere` | 7 |
| `src/uhs/belegung_repo.rs` | Belegungs-Events: `eintritt`, `wechsel`, `austritt`, `liste_je_uhs`, `liste_je_person`, `austritt_intern` (für Auto-Austritt) | 8 |
| `src/routes/einsatz_uhs.rs` | Alle UHS-/Platz-/Belegungs-Routen + `auto_austritt`-Wrapper | 9, 10, 11 |
| `src/routes/einsatz_material.rs` | PATCH um `uhs_id` erweitern | 12 |
| `src/material/disposition_repo.rs` | `aktualisiere` um `uhs_id` erweitern; `EinsatzMaterialAnzeige` um `uhs_id` | 12 |
| `src/material/mod.rs` | `EinsatzMaterialAnzeige.uhs_id` ergänzen | 12 |
| `src/routes/einsatz_person.rs` | Cross-Modul-Hooks in `status_wechsel`, `verbleib`, `stornieren` (Aufruf von `einsatz_uhs::auto_austritt`) | 13 |
| `src/routes/mod.rs` | `pub mod einsatz_uhs;` | 10 |
| `src/app.rs` | Routen registrieren | 10 |
| `tests/einsatz_uhs.rs` | HTTP-Integrationstests (Belegungs-Flow, Cross-Modul, Rechte-Matrix) | 14 |
| `frontend/package.json` | `@dnd-kit/core`, `@dnd-kit/modifiers` als Dep | 15 |
| `frontend/src/api/types.ts` | UHS-/Platz-/Belegungs-Typen + `EinsatzMaterial.uhs_id` | 16 |
| `frontend/src/api/einsatzUhs.ts` | API-Client | 16 |
| `frontend/src/etb/useUhsStream.ts` | SSE-Hook (Events `uhs` + `person`) | 17 |
| `frontend/src/pages/UnfallhilfsstellenPage.tsx` | Liste + Anlege-Flow + Detail-View (drei Tabs) | 17, 18, 19 |
| `frontend/src/pages/UnfallhilfsstellenPage.test.tsx` | Komponententests | 17, 18, 19 |
| `frontend/src/pages/uhs/Grundriss.tsx` | DnD-Grundriss-Komponente | 18 |
| `frontend/src/einsatz/modulRegistry.ts` | Modul `unfallhilfsstellen` auf `status: 'fertig'` | 20 |
| `frontend/src/App.tsx` | `MODUL_ELEMENTE.unfallhilfsstellen` | 20 |
| `docs/superpowers/PROGRESS.md` | E‑3 auf erledigt | 20 |

---

## Task 1: Migration 0027 (`uhs`)

UHS-Entity einsatz-scoped, mit Status-Maschine + Soft-Delete. `UNIQUE (einsatz_id, bezeichnung)` verhindert doppelte „BHP 50". `abschnitt_id` nullable (Annahme 2).

**Files:**
- Create: `migrations/0027_uhs.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0027_uhs.sql`:

```sql
-- E‑3: Unfallhilfsstelle (PA, BHP, VSS, …) als einsatz-scoped Versorgungs-Struktur.
-- Kein globaler Stamm, keine Disposition. Typ ist ein festes Enum. abschnitt_id
-- optional (UHS-Leitung läuft implizit über den Abschnitt). Soft-Delete via
-- storniert_at; aufgeloest ist terminal (Status-Maschine).
CREATE TABLE uhs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    typ           TEXT    NOT NULL
                  CHECK (typ IN ('patientenablage','behandlungsplatz',
                                 'verletztensammelstelle','bereitstellungsraum',
                                 'sonstige')),
    bezeichnung   TEXT    NOT NULL,                  -- "PA 1", "BHP 50"
    standort      TEXT,                              -- Freitext (Adresse/Hinweis)
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,                              -- Soft-Delete (Fehleingabe)
    UNIQUE (einsatz_id, bezeichnung)
);
CREATE INDEX idx_uhs_einsatz ON uhs (einsatz_id, status);
CREATE INDEX idx_uhs_abschnitt ON uhs (abschnitt_id);
```

- [ ] **Step 2: Migration einspielen lassen (Smoke-Test)**

Run: `cargo test --lib db::tests`
Expected: PASS (Migration lädt syntaktisch über `test_pool()`)

- [ ] **Step 3: Commit**

```bash
git add migrations/0027_uhs.sql
git commit -m "feat(db): Migration 0027 (uhs — Unfallhilfsstelle einsatz-scoped)"
```

---

## Task 2: Migration 0028 (`uhs_platz`)

Plätze mit Typ, Layout-Koordinaten, Verfügbarkeit, optionaler Reservierung. Zwei CHECK-Constraints koppeln `verfuegbarkeit = 'reserviert'` an `reserviert_fuer_person_id IS NOT NULL` und umgekehrt (Annahme 12).

**Files:**
- Create: `migrations/0028_uhs_platz.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0028_uhs_platz.sql`:

```sql
-- E‑3: Plätze einer UHS (benannte 1:1-Slots; Inbox bleibt implizit über
-- platz_id=NULL in der Belegung). Layout-Koordinaten optional (NULL = noch
-- nicht platziert). Verfügbarkeit ist getrennt von Belegung: ein Platz kann
-- belegt UND defekt sein (informativ). Reservierung erfordert eine Ziel-Person.
CREATE TABLE uhs_platz (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    uhs_id                    INTEGER NOT NULL REFERENCES uhs(id) ON DELETE CASCADE,
    typ                       TEXT    NOT NULL
                              CHECK (typ IN ('wartebereich','behandlungsplatz',
                                             'bett','intensivplatz','trage',
                                             'transport_bereitstellung','sonstige')),
    bezeichnung               TEXT    NOT NULL,
    pos_x                     REAL,                  -- NULL = noch nicht platziert
    pos_y                     REAL,
    verfuegbarkeit            TEXT    NOT NULL DEFAULT 'frei'
                              CHECK (verfuegbarkeit IN ('frei','defekt','aufbereitung',
                                                        'gesperrt','reserviert')),
    reserviert_fuer_person_id INTEGER REFERENCES einsatz_person(id),
    storniert_at              TEXT,
    UNIQUE (uhs_id, bezeichnung),
    -- Reservierung erfordert eine Ziel-Person:
    CHECK (verfuegbarkeit <> 'reserviert' OR reserviert_fuer_person_id IS NOT NULL),
    -- Nicht-Reservierung hat keine Person:
    CHECK (verfuegbarkeit = 'reserviert' OR reserviert_fuer_person_id IS NULL)
);
CREATE INDEX idx_uhs_platz_uhs ON uhs_platz (uhs_id);
CREATE INDEX idx_uhs_platz_reserviert ON uhs_platz (reserviert_fuer_person_id);
```

- [ ] **Step 2: Migration einspielen lassen**

Run: `cargo test --lib db::tests`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add migrations/0028_uhs_platz.sql
git commit -m "feat(db): Migration 0028 (uhs_platz — benannte 1:1-Slots mit Verfügbarkeit)"
```

---

## Task 3: Migration 0029 (`person_uhs_belegung` + Cache + 1:1-Index)

Append-only Belegungstabelle, zwei Cache-Spalten auf `einsatz_person`, partieller Unique-Index für 1:1-Belegung pro echtem Platz (Inbox = unbegrenzt).

**Files:**
- Create: `migrations/0029_person_uhs_belegung.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0029_person_uhs_belegung.sql`:

```sql
-- E‑3: Belegungs-Verlauf (append-only — kein UPDATE/DELETE) + denormalisierter
-- Cache auf einsatz_person. Jeder Insert pflegt den Cache in DERSELBEN Tx
-- (Repo-Aufgabe). Da Zeitstempel Server-Jetzt sind, ist „jüngster Event =
-- zuletzt eingefügt" garantiert (kein „bin ich der jüngste?"-Check nötig).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_uhs_id    INTEGER REFERENCES uhs(id);
ALTER TABLE einsatz_person ADD COLUMN aktueller_platz_id INTEGER REFERENCES uhs_platz(id);

-- 1:1-Constraint: ein konkreter Platz max. eine Person gleichzeitig. Die Inbox
-- (platz_id IS NULL, uhs gesetzt) ist explizit unbegrenzt und vom Index nicht
-- erfasst (partieller Filter).
CREATE UNIQUE INDEX idx_einsatz_person_platz_belegt
    ON einsatz_person (aktueller_platz_id)
    WHERE aktueller_platz_id IS NOT NULL;

CREATE TABLE person_uhs_belegung (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id    INTEGER NOT NULL REFERENCES einsatz_person(id),
    uhs_id       INTEGER NOT NULL REFERENCES uhs(id),
    platz_id     INTEGER REFERENCES uhs_platz(id),     -- NULL = Inbox / Austritt
    art          TEXT    NOT NULL
                 CHECK (art IN ('eintritt','wechsel','austritt')),
    notiz        TEXT,                                 -- z. B. „durch Status-Wechsel zu verstorben"
    zeitpunkt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von  INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_uhs_belegung_person ON person_uhs_belegung (person_id, zeitpunkt_at);
CREATE INDEX idx_person_uhs_belegung_uhs    ON person_uhs_belegung (uhs_id,    zeitpunkt_at);
```

- [ ] **Step 2: Migration einspielen lassen**

Run: `cargo test --lib db::tests`
Expected: PASS

- [ ] **Step 3: `PersonAnzeige` um die zwei UHS-Cache-Felder erweitern**

Sonst liefert die API sie nicht ans Frontend — E‑3-Grundriss + Sidebar in Tasks 17 hängen direkt davon ab. Analog Vorgehen wie E‑2-Task 1.

In `src/person/mod.rs` im Struct `PersonAnzeige` nach `pub aktueller_verbleib: Option<String>,` ergänzen:

```rust
    // E‑3: UHS-Cache (NULL = nicht in einer UHS / nicht auf einem Platz).
    pub aktuelle_uhs_id: Option<i64>,
    pub aktueller_platz_id: Option<i64>,
```

- [ ] **Step 4: `SELECT_ALLE` in `src/person/repo.rs` erweitern**

Ohne dies bleiben die neuen Spalten in jeder Antwort `null` (kein FromRow-Mapping). Die Konstante anpassen:

```rust
const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, registrier_nr, status, name, vorname, geschlecht, \
           geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
           melder_kontakt, notiz, erfasst_at, erfasst_von, geaendert_at, \
           geaendert_von, storniert_at, \
           aktuelle_sichtung, aktuelle_sichtung_at, aktueller_verbleib, \
           aktuelle_uhs_id, aktueller_platz_id \
    FROM einsatz_person";
```

- [ ] **Step 5: Regressionscheck — bestehende Person-Tests bleiben grün**

Run: `cargo test --lib person`
Expected: PASS (die zwei neuen JSON-Felder sind `null`; das bricht keinen bestehenden Assertion-Pfad.)

- [ ] **Step 6: Voller Compile-Check**

Run: `cargo check --all-targets`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add migrations/0029_person_uhs_belegung.sql src/person/mod.rs src/person/repo.rs
git commit -m "feat(db,person): Migration 0029 + UHS-Cache-Felder auf PersonAnzeige"
```

---

## Task 4: Migration 0030 (`einsatz_material.uhs_id`)

Material-Verortung. Nur eine Spalte + Index — Datenmodell-Anpassung kommt in Task 12 (Repo/Route).

**Files:**
- Create: `migrations/0030_einsatz_material_uhs.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0030_einsatz_material_uhs.sql`:

```sql
-- E‑3: Material-Verortung an eine UHS. NULL = nicht zugeordnet (Default).
-- Lebenszyklus über die UHS: wird die UHS aufgelöst, bleibt das Material in
-- der Disposition (zugeordnet zur Einheit oder frei), aber die UHS-Zuordnung
-- bleibt — das Detail-View einer aufgelösten UHS soll noch zeigen, was
-- zugeordnet war. Kein CASCADE.
ALTER TABLE einsatz_material ADD COLUMN uhs_id INTEGER REFERENCES uhs(id);
CREATE INDEX idx_einsatz_material_uhs ON einsatz_material (uhs_id);
```

- [ ] **Step 2: Migration einspielen + Regression**

Run: `cargo test --lib`
Expected: PASS (Material-Repo selektiert spaltenweise, kein `SELECT *`, also kein Mapping-Bruch. Anpassung in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add migrations/0030_einsatz_material_uhs.sql
git commit -m "feat(db): Migration 0030 (einsatz_material.uhs_id für Verortung)"
```

---

## Task 5: `src/uhs/mod.rs` — Enums, Anzeige-Structs, Status-Maschine

Reine Logik (Parsen, Status-Übergangs-Tabelle, Anzeige-Format) ohne DB-Aufruf. Wird isoliert getestet, bevor Repos und Routen sie verwenden.

**Files:**
- Modify: `src/lib.rs`
- Create: `src/uhs/mod.rs`
- Create: `src/uhs/repo.rs` (leerer Platzhalter; volle Implementierung Task 6)
- Create: `src/uhs/platz_repo.rs` (leerer Platzhalter; Task 7)
- Create: `src/uhs/belegung_repo.rs` (leerer Platzhalter; Task 8)

- [ ] **Step 1: Modul registrieren**

In `src/lib.rs` zwischen `pub mod stichwort;` und einer anderen passenden Stelle (alphabetisch) ergänzen:

```rust
pub mod uhs;
```

> **Hinweis:** Schau in `src/lib.rs` und füge die Zeile alphabetisch korrekt ein (nach `pub mod stichwort;`/vor was auch immer folgt). Die anderen `pub mod`-Zeilen sind alphabetisch sortiert.

- [ ] **Step 2: Platzhalter für die Sub-Module anlegen**

```bash
mkdir -p src/uhs
printf '// implementiert in Task 6\n' > src/uhs/repo.rs
printf '// implementiert in Task 7\n' > src/uhs/platz_repo.rs
printf '// implementiert in Task 8\n' > src/uhs/belegung_repo.rs
```

Damit `cargo` während Task 5 kompiliert.

- [ ] **Step 3: Failing test schreiben**

`src/uhs/mod.rs`:

```rust
pub mod belegung_repo;
pub mod platz_repo;
pub mod repo;

use serde::Serialize;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uhs_typ_roundtrip() {
        for t in ["patientenablage", "behandlungsplatz", "verletztensammelstelle",
                  "bereitstellungsraum", "sonstige"] {
            assert_eq!(UhsTyp::parse(t).unwrap().as_str(), t);
        }
        assert!(UhsTyp::parse("zeltkrankenhaus").is_none());
        assert_eq!(UhsTyp::parse("behandlungsplatz").unwrap().anzeige_label(), "Behandlungsplatz");
    }

    #[test]
    fn uhs_status_roundtrip() {
        for s in ["geplant", "aktiv", "aufgeloest"] {
            assert_eq!(UhsStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(UhsStatus::parse("unsinn").is_none());
    }

    #[test]
    fn platz_typ_roundtrip() {
        for t in ["wartebereich", "behandlungsplatz", "bett", "intensivplatz",
                  "trage", "transport_bereitstellung", "sonstige"] {
            assert_eq!(PlatzTyp::parse(t).unwrap().as_str(), t);
        }
        assert!(PlatzTyp::parse("eingang").is_none(), "Eingang ist KEIN Platz-Typ (Inbox ist implizit)");
    }

    #[test]
    fn verfuegbarkeit_roundtrip() {
        for v in ["frei", "defekt", "aufbereitung", "gesperrt", "reserviert"] {
            assert_eq!(Verfuegbarkeit::parse(v).unwrap().as_str(), v);
        }
        assert!(Verfuegbarkeit::parse("besetzt").is_none(), "Belegung ist KEINE Verfügbarkeit");
    }

    #[test]
    fn belegungs_art_roundtrip() {
        for a in ["eintritt", "wechsel", "austritt"] {
            assert_eq!(BelegungsArt::parse(a).unwrap().as_str(), a);
        }
        assert!(BelegungsArt::parse("verlegung").is_none());
    }

    #[test]
    fn status_uebergaenge_geplant_aktiv_aufgeloest() {
        assert!(darf_uebergehen("geplant", "aktiv"));
        assert!(darf_uebergehen("aktiv", "aufgeloest"));
        // Direkt geplant → aufgeloest: erlaubt (Fehl-Anlage; Spec implizit über
        // „aufgeloest nur wenn keine Belegung" — aus geplant ist es trivial leer).
        assert!(darf_uebergehen("geplant", "aufgeloest"));
        // Rückwege:
        assert!(!darf_uebergehen("aktiv", "geplant"));
        assert!(!darf_uebergehen("aufgeloest", "aktiv"), "aufgeloest ist terminal");
        assert!(!darf_uebergehen("aufgeloest", "geplant"));
        // Gleichbleibend nicht erlaubt:
        assert!(!darf_uebergehen("aktiv", "aktiv"));
        // Unbekannt:
        assert!(!darf_uebergehen("geplant", "quatsch"));
    }
}
```

- [ ] **Step 4: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib uhs::tests`
Expected: FAIL (Compile-Fehler: Typen + `darf_uebergehen` fehlen)

- [ ] **Step 5: Enums + Status-Maschine + Anzeige-Structs implementieren**

In `src/uhs/mod.rs` **vor** dem `#[cfg(test)]`-Block einfügen:

```rust
/// Typ einer Unfallhilfsstelle. String = CHECK-Constraint in
/// `migrations/0027_uhs.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum UhsTyp {
    Patientenablage,
    Behandlungsplatz,
    Verletztensammelstelle,
    Bereitstellungsraum,
    Sonstige,
}

impl UhsTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            UhsTyp::Patientenablage => "patientenablage",
            UhsTyp::Behandlungsplatz => "behandlungsplatz",
            UhsTyp::Verletztensammelstelle => "verletztensammelstelle",
            UhsTyp::Bereitstellungsraum => "bereitstellungsraum",
            UhsTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<UhsTyp> {
        match s {
            "patientenablage" => Some(UhsTyp::Patientenablage),
            "behandlungsplatz" => Some(UhsTyp::Behandlungsplatz),
            "verletztensammelstelle" => Some(UhsTyp::Verletztensammelstelle),
            "bereitstellungsraum" => Some(UhsTyp::Bereitstellungsraum),
            "sonstige" => Some(UhsTyp::Sonstige),
            _ => None,
        }
    }

    /// Anzeigelabel (für pseudonyme ETB-Texte, z. B. „BHP 50 (Behandlungsplatz) in Betrieb genommen").
    pub fn anzeige_label(&self) -> &'static str {
        match self {
            UhsTyp::Patientenablage => "Patientenablage",
            UhsTyp::Behandlungsplatz => "Behandlungsplatz",
            UhsTyp::Verletztensammelstelle => "Verletztensammelstelle",
            UhsTyp::Bereitstellungsraum => "Bereitstellungsraum",
            UhsTyp::Sonstige => "Sonstige",
        }
    }
}

/// Status einer UHS. String = CHECK-Constraint. `aufgeloest` ist terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum UhsStatus {
    Geplant,
    Aktiv,
    Aufgeloest,
}

impl UhsStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            UhsStatus::Geplant => "geplant",
            UhsStatus::Aktiv => "aktiv",
            UhsStatus::Aufgeloest => "aufgeloest",
        }
    }

    pub fn parse(s: &str) -> Option<UhsStatus> {
        match s {
            "geplant" => Some(UhsStatus::Geplant),
            "aktiv" => Some(UhsStatus::Aktiv),
            "aufgeloest" => Some(UhsStatus::Aufgeloest),
            _ => None,
        }
    }
}

/// Ob ein UHS-Status-Übergang `von → nach` erlaubt ist. Status-Maschine:
/// `geplant → aktiv → aufgeloest` (terminal); `geplant → aufgeloest` direkt
/// erlaubt (UHS war nie in Betrieb, leerer Abriss). Die Belegungs-Vorbedingung
/// für `→ aufgeloest` (kein aktiv Belegter) prüft der Handler (Task 10).
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use UhsStatus::*;
    let (Some(von), Some(nach)) = (UhsStatus::parse(von), UhsStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Geplant => matches!(nach, Aktiv | Aufgeloest),
        Aktiv => matches!(nach, Aufgeloest),
        Aufgeloest => false, // terminal
    }
}

/// Typ eines Platzes innerhalb einer UHS. String = CHECK-Constraint in
/// `migrations/0028_uhs_platz.sql`. „Eingang"/„Inbox" ist KEIN Typ — die
/// Inbox ist implizit über `platz_id = NULL` in der Belegung modelliert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PlatzTyp {
    Wartebereich,
    Behandlungsplatz,
    Bett,
    Intensivplatz,
    Trage,
    TransportBereitstellung,
    Sonstige,
}

impl PlatzTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlatzTyp::Wartebereich => "wartebereich",
            PlatzTyp::Behandlungsplatz => "behandlungsplatz",
            PlatzTyp::Bett => "bett",
            PlatzTyp::Intensivplatz => "intensivplatz",
            PlatzTyp::Trage => "trage",
            PlatzTyp::TransportBereitstellung => "transport_bereitstellung",
            PlatzTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<PlatzTyp> {
        match s {
            "wartebereich" => Some(PlatzTyp::Wartebereich),
            "behandlungsplatz" => Some(PlatzTyp::Behandlungsplatz),
            "bett" => Some(PlatzTyp::Bett),
            "intensivplatz" => Some(PlatzTyp::Intensivplatz),
            "trage" => Some(PlatzTyp::Trage),
            "transport_bereitstellung" => Some(PlatzTyp::TransportBereitstellung),
            "sonstige" => Some(PlatzTyp::Sonstige),
            _ => None,
        }
    }
}

/// Verfügbarkeit eines Platzes (getrennt von Belegung). String = CHECK in
/// `migrations/0028_uhs_platz.sql`. `reserviert` ist im DB-CHECK an
/// `reserviert_fuer_person_id IS NOT NULL` gekoppelt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Verfuegbarkeit {
    Frei,
    Defekt,
    Aufbereitung,
    Gesperrt,
    Reserviert,
}

impl Verfuegbarkeit {
    pub fn as_str(&self) -> &'static str {
        match self {
            Verfuegbarkeit::Frei => "frei",
            Verfuegbarkeit::Defekt => "defekt",
            Verfuegbarkeit::Aufbereitung => "aufbereitung",
            Verfuegbarkeit::Gesperrt => "gesperrt",
            Verfuegbarkeit::Reserviert => "reserviert",
        }
    }

    pub fn parse(s: &str) -> Option<Verfuegbarkeit> {
        match s {
            "frei" => Some(Verfuegbarkeit::Frei),
            "defekt" => Some(Verfuegbarkeit::Defekt),
            "aufbereitung" => Some(Verfuegbarkeit::Aufbereitung),
            "gesperrt" => Some(Verfuegbarkeit::Gesperrt),
            "reserviert" => Some(Verfuegbarkeit::Reserviert),
            _ => None,
        }
    }
}

/// Art eines Belegungs-Events. String = CHECK in
/// `migrations/0029_person_uhs_belegung.sql`. Append-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum BelegungsArt {
    Eintritt,
    Wechsel,
    Austritt,
}

impl BelegungsArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            BelegungsArt::Eintritt => "eintritt",
            BelegungsArt::Wechsel => "wechsel",
            BelegungsArt::Austritt => "austritt",
        }
    }

    pub fn parse(s: &str) -> Option<BelegungsArt> {
        match s {
            "eintritt" => Some(BelegungsArt::Eintritt),
            "wechsel" => Some(BelegungsArt::Wechsel),
            "austritt" => Some(BelegungsArt::Austritt),
            _ => None,
        }
    }
}

/// Serialisierbare UHS-Anzeige (1:1 zur Tabelle, ohne abgeleitete Felder).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct UhsAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub typ: String,
    pub bezeichnung: String,
    pub standort: Option<String>,
    pub notiz: Option<String>,
    pub status: String,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
}

/// Serialisierbare Platz-Anzeige (1:1 zur Tabelle).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PlatzAnzeige {
    pub id: i64,
    pub uhs_id: i64,
    pub typ: String,
    pub bezeichnung: String,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
    pub verfuegbarkeit: String,
    pub reserviert_fuer_person_id: Option<i64>,
    pub storniert_at: Option<String>,
}

/// Belegungs-Verlaufseintrag (1:1 zu `person_uhs_belegung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BelegungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub uhs_id: i64,
    pub platz_id: Option<i64>,
    pub art: String,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
}
```

- [ ] **Step 6: Test ausführen — muss bestehen**

Run: `cargo test --lib uhs::tests`
Expected: PASS

- [ ] **Step 7: Voller `cargo check` als Regression**

Run: `cargo check --all-targets`
Expected: PASS (Modul ist gegen den Rest des Crates kompatibel; bestehender Code bleibt unberührt.)

- [ ] **Step 8: Commit**

```bash
git add src/lib.rs src/uhs/mod.rs src/uhs/repo.rs src/uhs/platz_repo.rs src/uhs/belegung_repo.rs
git commit -m "feat(uhs): Modul-Skelett mit Enums, Status-Maschine, Anzeige-Structs"
```

---

## Task 6: `src/uhs/repo.rs` — UHS-CRUD + Status-Maschine + Soft-Delete

UHS-Stammoperationen. `setze_status` und `storniere` prüfen die Belegungs-Vorbedingung selbst (über `aktive_belegungen`) und liefern `Conflict`, wenn aktiv belegt — identische Semantik laut Annahme 6.

**Files:**
- Create: `src/uhs/repo.rs` (ersetzt Platzhalter aus Task 5)

- [ ] **Step 1: Failing tests schreiben**

In `src/uhs/repo.rs` zuerst nur den Test-Block (Implementierung folgt). `setup` erzeugt Org + Benutzer + aktiven Einsatz:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Org(1) + Benutzer + aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    fn daten(typ: &str, bez: &str) -> NeueDaten<'_> {
        NeueDaten {
            typ, bezeichnung: bez, abschnitt_id: None, standort: None, notiz: None,
        }
    }

    #[tokio::test]
    async fn anlegen_liefert_status_geplant_und_zeitstempel() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        assert_eq!(u.status, "geplant");
        assert_eq!(u.typ, "behandlungsplatz");
        assert_eq!(u.bezeichnung, "BHP 50");
        assert_eq!(u.erfasst_von, b);
        assert_eq!(u.geaendert_von, b);
        assert!(u.storniert_at.is_none());
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        let err = anlegen(&pool, e, b, daten("patientenablage", "BHP 50")).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "UNIQUE(einsatz_id, bezeichnung)");
    }

    #[tokio::test]
    async fn liste_filtert_storno_und_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u1 = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        anlegen(&pool, e, b, daten("patientenablage", "PA 1")).await.unwrap();
        // Storno: u1 verschwindet aus der Liste:
        storniere(&pool, e, u1.id, b).await.unwrap();
        let alle = liste(&pool, e, None, None).await.unwrap();
        assert_eq!(alle.len(), 1, "stornierte UHS fallen aus der Liste");
        // Status-Filter:
        let geplante = liste(&pool, e, Some("geplant"), None).await.unwrap();
        assert_eq!(geplante.len(), 1);
        let aktive = liste(&pool, e, Some("aktiv"), None).await.unwrap();
        assert!(aktive.is_empty());
    }

    #[tokio::test]
    async fn status_geplant_zu_aktiv_setzt_geaendert_von() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        let nach = setze_status(&pool, e, u.id, "aktiv", b).await.unwrap();
        assert_eq!(nach.status, "aktiv");
        assert_eq!(nach.geaendert_von, b);
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        setze_status(&pool, e, u.id, "aktiv", b).await.unwrap();
        // Person + Belegung simulieren — direkter SQL-Insert, weil belegung_repo erst in Task 8 kommt:
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von, aktuelle_uhs_id) \
             VALUES (?, 1, 'betroffen', ?, ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).bind(u.id)
            .fetch_one(&pool).await.unwrap();
        let err = setze_status(&pool, e, u.id, "aufgeloest", b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "Auflösung blockt bei Belegung (409)");
        // Storno blockt identisch:
        let err = storniere(&pool, e, u.id, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        let _ = p; // unbenutzt — nur als Belegungs-Quelle
    }

    #[tokio::test]
    async fn aktive_belegungen_zaehlt_korrekt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let u = anlegen(&pool, e, b, daten("behandlungsplatz", "BHP 50")).await.unwrap();
        // Zwei Personen, eine belegt:
        sqlx::query("INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von, aktuelle_uhs_id) \
                     VALUES (?, 1, ?, ?, ?)")
            .bind(e).bind(b).bind(b).bind(u.id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
                     VALUES (?, 2, ?, ?)")
            .bind(e).bind(b).bind(b).execute(&pool).await.unwrap();
        assert_eq!(aktive_belegungen(&pool, u.id).await.unwrap(), 1);
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib uhs::repo`
Expected: FAIL (Compile-Fehler: `NeueDaten`, `anlegen`, `liste`, `storniere`, `setze_status`, `aktive_belegungen` fehlen)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block in `src/uhs/repo.rs`:

```rust
use super::UhsAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, status, \
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at \
    FROM uhs";

/// Eingabedaten beim Anlegen (Handler hat Typ/`bezeichnung` validiert/getrimmt).
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub typ: &'a str,
    pub bezeichnung: &'a str,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten (COALESCE-Semantik: `None` = unverändert). `typ` und `status`
/// werden NICHT über diese Funktion geändert — Status hat eine eigene Route.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub bezeichnung: Option<&'a str>,
    pub abschnitt_id: Option<Option<i64>>, // Some(None) = explizit auf NULL setzen
    pub standort: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
}

/// UHS eines Einsatzes (ohne stornierte), optional gefiltert nach Status und/oder Abschnitt.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    abschnitt_id: Option<i64>,
) -> Result<Vec<UhsAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE einsatz_id = ?1 AND storniert_at IS NULL \
         AND (?2 IS NULL OR status = ?2) \
         AND (?3 IS NULL OR abschnitt_id = ?3) \
         ORDER BY bezeichnung"
    );
    Ok(sqlx::query_as::<_, UhsAnzeige>(&sql)
        .bind(einsatz_id)
        .bind(status)
        .bind(abschnitt_id)
        .fetch_all(pool)
        .await?)
}

/// Lädt eine UHS (auch stornierte) eines Einsatzes; `NotFound`, falls sie nicht
/// zum Einsatz gehört (Org-Isolation via `einsatz_id`-Prädikat).
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<UhsAnzeige, AppError> {
    sqlx::query_as::<_, UhsAnzeige>(&format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine UHS im Status `geplant` an. UNIQUE(einsatz_id, bezeichnung) →
/// `Conflict` (409) bei Duplikat.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<UhsAnzeige, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO uhs \
            (einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, \
             erfasst_von, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.abschnitt_id)
    .bind(daten.typ)
    .bind(daten.bezeichnung)
    .bind(daten.standort)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict(
                "Eine UHS mit dieser Bezeichnung existiert bereits in diesem Einsatz".into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden(pool, einsatz_id, id).await
}

/// Aktualisiert UHS-Stammfelder (NICHT Status). `Some(None)` setzt ein Feld
/// explizit auf NULL (z. B. Standort löschen); `None` lässt unverändert.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<UhsAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE uhs \
         SET bezeichnung = COALESCE(?, bezeichnung), \
             abschnitt_id = CASE WHEN ?2 IS NULL THEN abschnitt_id ELSE ?3 END, \
             standort = CASE WHEN ?4 IS NULL THEN standort ELSE ?5 END, \
             notiz = CASE WHEN ?6 IS NULL THEN notiz ELSE ?7 END, \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.bezeichnung)
    // abschnitt_id: ?2 = „hat Setter?", ?3 = neuer Wert (oder NULL)
    .bind(daten.abschnitt_id.map(|_| 1_i64))
    .bind(daten.abschnitt_id.and_then(|v| v))
    .bind(daten.standort.map(|_| 1_i64))
    .bind(daten.standort.and_then(|v| v))
    .bind(daten.notiz.map(|_| 1_i64))
    .bind(daten.notiz.and_then(|v| v))
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await;
    match ergebnis {
        Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
        Ok(_) => laden(pool, einsatz_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Eine UHS mit dieser Bezeichnung existiert bereits in diesem Einsatz".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt einen neuen Status. Vorbedingungen prüft der Handler (`darf_uebergehen`),
/// das Repo prüft NUR die Belegungs-Vorbedingung für `aufgeloest` (Annahme 6):
/// blockt mit `Conflict`, wenn aktiv belegt. Liefert die aktualisierte Anzeige.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<UhsAnzeige, AppError> {
    if neuer_status == "aufgeloest" {
        let belegt = aktive_belegungen(pool, id).await?;
        if belegt > 0 {
            return Err(AppError::Conflict(format!(
                "Auflösung nicht möglich — noch {belegt} Person(en) belegt"
            )));
        }
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Soft-Delete der UHS. Identische Belegungs-Vorbedingung wie `aufgeloest`
/// (Annahme 6): aktiv belegt → `Conflict`. Doppel-Storno → `Conflict`.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let belegt = aktive_belegungen(pool, id).await?;
    if belegt > 0 {
        return Err(AppError::Conflict(format!(
            "Storno nicht möglich — noch {belegt} Person(en) belegt"
        )));
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        // Entweder nicht zum Einsatz oder bereits storniert. Differenzierung:
        let existiert: Option<Option<String>> = sqlx::query_scalar(
            "SELECT storniert_at FROM uhs WHERE id = ? AND einsatz_id = ?",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        return match existiert {
            None => Err(AppError::NotFound),
            Some(_) => Err(AppError::Conflict("UHS ist bereits storniert".into())),
        };
    }
    Ok(())
}

/// Anzahl aktuell belegter Personen (Inbox + echte Plätze). Über den Cache
/// `einsatz_person.aktuelle_uhs_id`, daher ein einzelner indizierter Scan.
pub async fn aktive_belegungen(pool: &SqlitePool, uhs_id: i64) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_person \
         WHERE aktuelle_uhs_id = ? AND storniert_at IS NULL",
    )
    .bind(uhs_id)
    .fetch_one(pool)
    .await?)
}
```

> **Hinweis zur `aktualisiere`-Query:** Die `CASE WHEN ?X IS NULL THEN spalte ELSE ?Y END`-Pattern ist nötig, weil `COALESCE(?, spalte)` ein explizites Setzen auf NULL nicht erlauben würde. Bei UHS ist das vor allem für `abschnitt_id` und `standort` relevant. Falls die Position-Bindings mit sqlx Probleme machen (sqlx zählt `?` rein positional, `?N` ist Referenz), verifiziere mit dem Test in Step 4. Notfalls die Query in zwei separate UPDATEs aufteilen.

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib uhs::repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/uhs/repo.rs
git commit -m "feat(uhs): repo (CRUD, Status-Maschine, Soft-Delete mit Belegungs-Check)"
```

---

## Task 7: `src/uhs/platz_repo.rs` — Platz-CRUD + Verfügbarkeit + Soft-Delete

Plätze sind 1:1-Slots. `setze_verfuegbarkeit` deckt alle Verfügbarkeits-Übergänge inklusive Reservierung ab (Setzen erfordert Person-FK + Platz darf nicht belegt sein; Auflösen leert die FK). `storniere` blockt bei aktiver Belegung. Layout-Updates über `aktualisiere` (`pos_x`/`pos_y`).

**Files:**
- Create: `src/uhs/platz_repo.rs` (ersetzt Platzhalter aus Task 5)

- [ ] **Step 1: Failing tests schreiben**

In `src/uhs/platz_repo.rs` zuerst nur den Test-Block. `setup` erzeugt zusätzlich eine UHS (`aktiv`) + zwei Personen:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::uhs::repo as uhs_repo;
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, uhs_id, person_a, person_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let u = uhs_repo::anlegen(
            pool, e, b,
            uhs_repo::NeueDaten { typ: "behandlungsplatz", bezeichnung: "BHP 50",
                                  abschnitt_id: None, standort: None, notiz: None },
        ).await.unwrap();
        uhs_repo::setze_status(pool, e, u.id, "aktiv", b).await.unwrap();
        let mk = |nr: i64| {
            let e = e; let b = b; let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
                     VALUES (?, ?, 'betroffen', ?, ?) RETURNING id")
                    .bind(e).bind(nr).bind(b).bind(b)
                    .fetch_one(&pool).await.unwrap()
            }
        };
        let pa = mk(1).await;
        let pb = mk(2).await;
        (b, e, u.id, pa, pb)
    }

    #[tokio::test]
    async fn anlegen_default_verfuegbarkeit_frei() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz {
            typ: "bett", bezeichnung: "Bett 3", pos_x: Some(100.0), pos_y: Some(50.0),
        }).await.unwrap();
        assert_eq!(p.verfuegbarkeit, "frei");
        assert_eq!(p.pos_x, Some(100.0));
        assert!(p.reserviert_fuer_person_id.is_none());
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let err = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn aktualisiere_position() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let nach = aktualisiere(&pool, u, p.id, PatchPlatz {
            bezeichnung: None, pos_x: Some(Some(42.0)), pos_y: Some(Some(99.0)),
        }).await.unwrap();
        assert_eq!(nach.pos_x, Some(42.0));
        assert_eq!(nach.pos_y, Some(99.0));
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_frei_zu_defekt_ohne_person() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "defekt", None).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "defekt");
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_reserviert_braucht_person() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        let err = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", None).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "Reservieren ohne Person ist Validierung-422");
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "reserviert");
        assert_eq!(nach.reserviert_fuer_person_id, Some(pa));
    }

    #[tokio::test]
    async fn setze_verfuegbarkeit_aufloesen_leert_person_fk() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, _) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap();
        let nach = setze_verfuegbarkeit(&pool, u, p.id, "frei", None).await.unwrap();
        assert_eq!(nach.verfuegbarkeit, "frei");
        assert!(nach.reserviert_fuer_person_id.is_none(), "FK wird beim Verlassen von 'reserviert' geleert");
    }

    #[tokio::test]
    async fn reservierung_auf_belegtem_platz_ist_konflikt() {
        let pool = test_pool().await;
        let (_b, _e, u, pa, pb) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        // pb auf p belegen (direkter Cache-Setz; belegung_repo erst Task 8):
        sqlx::query("UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? WHERE id = ?")
            .bind(u).bind(p.id).bind(pb).execute(&pool).await.unwrap();
        let err = setze_verfuegbarkeit(&pool, u, p.id, "reserviert", Some(pa)).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)),
            "Reservieren eines belegten Platzes → 422 (Spec: Verfügbarkeits-Statuswechsel)");
    }

    #[tokio::test]
    async fn storniere_blockt_bei_belegung() {
        let pool = test_pool().await;
        let (b, _e, u, _, pb) = setup(&pool).await;
        let p = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None }).await.unwrap();
        sqlx::query("UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? WHERE id = ?")
            .bind(u).bind(p.id).bind(pb).execute(&pool).await.unwrap();
        let err = storniere(&pool, u, p.id).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        let _ = b;
    }

    #[tokio::test]
    async fn liste_je_uhs_filtert_storno() {
        let pool = test_pool().await;
        let (_b, _e, u, _, _) = setup(&pool).await;
        let p1 = anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 1", pos_x: None, pos_y: None }).await.unwrap();
        anlegen(&pool, u, NeuerPlatz { typ: "bett", bezeichnung: "Bett 2", pos_x: None, pos_y: None }).await.unwrap();
        storniere(&pool, u, p1.id).await.unwrap();
        assert_eq!(liste_je_uhs(&pool, u).await.unwrap().len(), 1);
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib uhs::platz_repo`
Expected: FAIL (Compile-Fehler)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use super::PlatzAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

const SELECT_ALLE: &str = "\
    SELECT id, uhs_id, typ, bezeichnung, pos_x, pos_y, verfuegbarkeit, \
           reserviert_fuer_person_id, storniert_at \
    FROM uhs_platz";

/// Neuer Platz (Handler hat Typ + Bezeichnung validiert/getrimmt). Verfügbarkeit
/// startet immer `frei` (Default in der Tabelle).
#[derive(Debug)]
pub struct NeuerPlatz<'a> {
    pub typ: &'a str,
    pub bezeichnung: &'a str,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
}

/// Patch-Daten. `Some(None)` = explizit auf NULL (Position löschen).
#[derive(Debug, Default)]
pub struct PatchPlatz<'a> {
    pub bezeichnung: Option<&'a str>,
    pub pos_x: Option<Option<f64>>,
    pub pos_y: Option<Option<f64>>,
}

/// Plätze einer UHS (ohne stornierte), sortiert nach Bezeichnung.
pub async fn liste_je_uhs(pool: &SqlitePool, uhs_id: i64) -> Result<Vec<PlatzAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, PlatzAnzeige>(&format!(
        "{SELECT_ALLE} WHERE uhs_id = ? AND storniert_at IS NULL ORDER BY bezeichnung"
    ))
    .bind(uhs_id)
    .fetch_all(pool)
    .await?)
}

/// Lädt einen Platz; `NotFound`, falls nicht zur UHS gehörend.
pub async fn laden(pool: &SqlitePool, uhs_id: i64, id: i64) -> Result<PlatzAnzeige, AppError> {
    sqlx::query_as::<_, PlatzAnzeige>(&format!("{SELECT_ALLE} WHERE id = ? AND uhs_id = ?"))
        .bind(id)
        .bind(uhs_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt einen Platz an. UNIQUE(uhs_id, bezeichnung) → `Conflict` (409) bei Duplikat.
pub async fn anlegen(pool: &SqlitePool, uhs_id: i64, neu: NeuerPlatz<'_>) -> Result<PlatzAnzeige, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung, pos_x, pos_y) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(uhs_id)
    .bind(neu.typ)
    .bind(neu.bezeichnung)
    .bind(neu.pos_x)
    .bind(neu.pos_y)
    .fetch_one(pool)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict(
                "Ein Platz mit dieser Bezeichnung existiert bereits in dieser UHS".into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden(pool, uhs_id, id).await
}

/// Aktualisiert Stamm/Layout eines Platzes (NICHT Verfügbarkeit — eigene Funktion).
/// `Some(None)` = explizites NULL; `None` = unverändert.
pub async fn aktualisiere(
    pool: &SqlitePool,
    uhs_id: i64,
    id: i64,
    daten: PatchPlatz<'_>,
) -> Result<PlatzAnzeige, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz \
         SET bezeichnung = COALESCE(?, bezeichnung), \
             pos_x = CASE WHEN ?2 IS NULL THEN pos_x ELSE ?3 END, \
             pos_y = CASE WHEN ?4 IS NULL THEN pos_y ELSE ?5 END \
         WHERE id = ? AND uhs_id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.pos_x.map(|_| 1_i64))
    .bind(daten.pos_x.and_then(|v| v))
    .bind(daten.pos_y.map(|_| 1_i64))
    .bind(daten.pos_y.and_then(|v| v))
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await;
    match ergebnis {
        Ok(r) if r.rows_affected() == 0 => Err(AppError::NotFound),
        Ok(_) => laden(pool, uhs_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Ein Platz mit dieser Bezeichnung existiert bereits in dieser UHS".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt Verfügbarkeit (und ggf. Reservierungs-FK).
///
/// Semantik:
/// - `reserviert` erfordert `person_id = Some(_)` (sonst `Validation` 422) UND der Platz
///   darf nicht durch eine ANDERE Person belegt sein (sonst `UnprocessableEntity` 422).
/// - Jeder andere Wert leert `reserviert_fuer_person_id` (Reservierung wird aufgelöst).
///
/// Wird Belegungs-getriggert (Reservierung wird durch Belegung eingelöst), ruft
/// `belegung_repo` diese Funktion NICHT direkt — die Einlösung läuft inline in
/// derselben Tx (Task 8).
pub async fn setze_verfuegbarkeit(
    pool: &SqlitePool,
    uhs_id: i64,
    id: i64,
    verfuegbarkeit: &str,
    person_id: Option<i64>,
) -> Result<PlatzAnzeige, AppError> {
    // Reservierung erfordert Person:
    if verfuegbarkeit == "reserviert" && person_id.is_none() {
        return Err(AppError::Validation(
            "Reservierung erfordert eine Ziel-Person".into(),
        ));
    }
    // Reservierung erfordert unbelegten Platz (Spec: Verfügbarkeits-Statuswechsel,
    // letzter Punkt — andere Wechsel sind auch bei aktiver Belegung erlaubt).
    if verfuegbarkeit == "reserviert" {
        let belegt: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_person WHERE aktueller_platz_id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        if belegt.is_some() {
            return Err(AppError::UnprocessableEntity(
                "Platz ist belegt — Reservierung nicht möglich".into(),
            ));
        }
    }
    let neue_person_fk = if verfuegbarkeit == "reserviert" { person_id } else { None };
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = ?, reserviert_fuer_person_id = ? \
         WHERE id = ? AND uhs_id = ?",
    )
    .bind(verfuegbarkeit)
    .bind(neue_person_fk)
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, uhs_id, id).await
}

/// Soft-Delete eines Platzes; blockt mit `Conflict`, wenn aktuell belegt.
pub async fn storniere(pool: &SqlitePool, uhs_id: i64, id: i64) -> Result<(), AppError> {
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_person WHERE aktueller_platz_id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    if belegt.is_some() {
        return Err(AppError::Conflict(
            "Platz ist aktuell belegt — Storno nicht möglich".into(),
        ));
    }
    let ergebnis = sqlx::query(
        "UPDATE uhs_platz SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now') \
         WHERE id = ? AND uhs_id = ? AND storniert_at IS NULL",
    )
    .bind(id)
    .bind(uhs_id)
    .execute(pool)
    .await?;
    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib uhs::platz_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/uhs/platz_repo.rs
git commit -m "feat(uhs): platz_repo (CRUD, Verfügbarkeit mit Reservierung, Soft-Delete)"
```

---

## Task 8: `src/uhs/belegung_repo.rs` — Belegungs-Events (transaktional) + Auto-Aufbereitung

Das Herzstück. Drei Public-Funktionen (`eintritt`, `wechsel`, `austritt`) bauen jeweils ein Event in einer Transaktion: Vor-Prüfungen + Insert + Cache-Update + Auto-Aufbereitung des Ex-Platzes + Reservierungs-Einlösung. Zusätzlich `austritt_intern` als Helper für den Cross-Modul-Auto-Austritt (Task 13). 1:1 erzwingt der partielle Unique-Index.

**Files:**
- Create: `src/uhs/belegung_repo.rs` (ersetzt Platzhalter aus Task 5)

- [ ] **Step 1: Failing tests schreiben**

In `src/uhs/belegung_repo.rs` zuerst nur den Test-Block:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::uhs::{platz_repo, repo as uhs_repo};
    use sqlx::SqlitePool;

    /// Liefert (benutzer, einsatz, uhs_aktiv, uhs_geplant, platz_a_in_aktiv, platz_b_in_aktiv, person).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let u_aktiv = uhs_repo::anlegen(pool, e, b, uhs_repo::NeueDaten {
            typ: "behandlungsplatz", bezeichnung: "BHP 50",
            abschnitt_id: None, standort: None, notiz: None,
        }).await.unwrap();
        uhs_repo::setze_status(pool, e, u_aktiv.id, "aktiv", b).await.unwrap();
        let u_geplant = uhs_repo::anlegen(pool, e, b, uhs_repo::NeueDaten {
            typ: "patientenablage", bezeichnung: "PA 1",
            abschnitt_id: None, standort: None, notiz: None,
        }).await.unwrap();
        let pa = platz_repo::anlegen(pool, u_aktiv.id, platz_repo::NeuerPlatz {
            typ: "bett", bezeichnung: "Bett 3", pos_x: None, pos_y: None,
        }).await.unwrap();
        let pb = platz_repo::anlegen(pool, u_aktiv.id, platz_repo::NeuerPlatz {
            typ: "bett", bezeichnung: "Bett 5", pos_x: None, pos_y: None,
        }).await.unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(pool).await.unwrap();
        (b, e, u_aktiv.id, u_geplant.id, pa.id, pb.id, person)
    }

    async fn cache(pool: &SqlitePool, person: i64) -> (Option<i64>, Option<i64>) {
        sqlx::query_as("SELECT aktuelle_uhs_id, aktueller_platz_id FROM einsatz_person WHERE id = ?")
            .bind(person).fetch_one(pool).await.unwrap()
    }

    async fn verfuegbarkeit(pool: &SqlitePool, platz: i64) -> String {
        sqlx::query_scalar("SELECT verfuegbarkeit FROM uhs_platz WHERE id = ?")
            .bind(platz).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn eintritt_inbox_setzt_cache_uhs_und_platz_null() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        let ev = eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        assert_eq!(ev.art, "eintritt");
        assert!(ev.platz_id.is_none());
        assert_eq!(cache(&pool, p).await, (Some(u), None));
    }

    #[tokio::test]
    async fn eintritt_platz_belegt_cache_und_unique_index() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(u), Some(pa)));
        // Zweite Person auf denselben Platz → Unique-Index-Verletzung:
        let p2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let err = eintritt(&pool, e, p2, u, Some(pa), None, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "1:1-Belegung erzwungen");
    }

    #[tokio::test]
    async fn inbox_mehrfach_belegung_erlaubt() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p1) = setup(&pool).await;
        let p2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        eintritt(&pool, e, p1, u, None, None, b).await.unwrap();
        eintritt(&pool, e, p2, u, None, None, b).await.unwrap();
        // Beide in Inbox derselben UHS:
        assert_eq!(cache(&pool, p1).await, (Some(u), None));
        assert_eq!(cache(&pool, p2).await, (Some(u), None));
    }

    #[tokio::test]
    async fn eintritt_in_geplante_uhs_ist_422() {
        let pool = test_pool().await;
        let (b, e, _, ug, _, _, p) = setup(&pool).await;
        let err = eintritt(&pool, e, p, ug, None, None, b).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)),
            "geplante UHS akzeptiert keine Belegung");
    }

    #[tokio::test]
    async fn eintritt_doppelt_ohne_austritt_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, u, _, _, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        let err = eintritt(&pool, e, p, u, None, None, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "Eintritt während aktiver Belegung");
    }

    #[tokio::test]
    async fn eintritt_auf_defekten_platz_ist_422() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "defekt", None).await.unwrap();
        let err = eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)));
    }

    #[tokio::test]
    async fn eintritt_auf_eigene_reservierung_loest_sie_ein() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(p)).await.unwrap();
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(verfuegbarkeit(&pool, pa).await, "frei", "Reservierung wird durch Belegung eingelöst");
        let fk: Option<i64> = sqlx::query_scalar(
            "SELECT reserviert_fuer_person_id FROM uhs_platz WHERE id = ?")
            .bind(pa).fetch_one(&pool).await.unwrap();
        assert!(fk.is_none());
    }

    #[tokio::test]
    async fn eintritt_auf_fremd_reservierten_platz_ist_422() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let andere: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(andere)).await.unwrap();
        let err = eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)));
    }

    #[tokio::test]
    async fn wechsel_in_andere_uhs_setzt_cache_um_und_aufbereitung_alter_platz() {
        let pool = test_pool().await;
        let (b, e, u, ug, pa, _, p) = setup(&pool).await;
        // Ziel-UHS aktivieren:
        uhs_repo::setze_status(&pool, e, ug, "aktiv", b).await.unwrap();
        let pinbox = u; // Start in Inbox von u
        eintritt(&pool, e, p, pinbox, None, None, b).await.unwrap();
        // Erst Platz a belegen, dann wechseln nach ug-Inbox:
        wechsel(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(u), Some(pa)));
        wechsel(&pool, e, p, ug, None, None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (Some(ug), None));
        assert_eq!(verfuegbarkeit(&pool, pa).await, "aufbereitung",
            "Verlassen eines frei-Platzes → Auto-Aufbereitung");
    }

    #[tokio::test]
    async fn austritt_setzt_cache_null_und_aufbereitet_ex_platz() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        austritt(&pool, e, p, None, b).await.unwrap();
        assert_eq!(cache(&pool, p).await, (None, None));
        assert_eq!(verfuegbarkeit(&pool, pa).await, "aufbereitung");
    }

    #[tokio::test]
    async fn auto_aufbereitung_asymmetrie_defekt_bleibt_defekt() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        // Während belegt: defekt setzen (informativ, Belegung bleibt unberührt — Spec):
        sqlx::query("UPDATE uhs_platz SET verfuegbarkeit = 'defekt' WHERE id = ?")
            .bind(pa).execute(&pool).await.unwrap();
        austritt(&pool, e, p, None, b).await.unwrap();
        assert_eq!(verfuegbarkeit(&pool, pa).await, "defekt",
            "Auto-Aufbereitung greift NUR, wenn vorher frei");
    }

    #[tokio::test]
    async fn wechsel_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        let err = wechsel(&pool, e, p, u, Some(pa), None, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "wechsel ohne aktive Belegung");
    }

    #[tokio::test]
    async fn austritt_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, _, _, _, _, p) = setup(&pool).await;
        let err = austritt(&pool, e, p, None, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn liste_je_uhs_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        eintritt(&pool, e, p, u, None, None, b).await.unwrap();
        wechsel(&pool, e, p, u, Some(pa), None, b).await.unwrap();
        let liste = liste_je_uhs(&pool, u).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].art, "wechsel", "neueste zuerst");
    }

    #[tokio::test]
    async fn austritt_intern_fuer_unbelegte_person_ist_noop() {
        let pool = test_pool().await;
        let (b, e, _, _, _, _, p) = setup(&pool).await;
        let info = austritt_intern(&pool, e, p, Some("durch Storno"), b).await.unwrap();
        assert!(info.is_none(), "Person war nicht belegt — kein Event, kein Cache-Wechsel");
    }

    #[tokio::test]
    async fn austritt_intern_loest_reservierung_der_person_auf() {
        let pool = test_pool().await;
        let (b, e, u, _, pa, _, p) = setup(&pool).await;
        // Person ist NICHT belegt, aber für pa reserviert:
        platz_repo::setze_verfuegbarkeit(&pool, u, pa, "reserviert", Some(p)).await.unwrap();
        austritt_intern(&pool, e, p, Some("durch Storno"), b).await.unwrap();
        assert_eq!(verfuegbarkeit(&pool, pa).await, "frei", "Reservierung der Person wird aufgelöst");
    }
}
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib uhs::belegung_repo`
Expected: FAIL (Compile-Fehler)

- [ ] **Step 3: Implementierung schreiben**

Den folgenden Code **vor** den Test-Block:

```rust
use super::BelegungAnzeige;
use crate::error::AppError;
use sqlx::{Sqlite, SqlitePool, Transaction};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, person_id, uhs_id, platz_id, art, notiz, zeitpunkt_at, erfasst_von \
    FROM person_uhs_belegung";

/// Was beim Auto-Austritt passiert ist (für ETB-Text und SSE im Wrapper).
#[derive(Debug, Clone)]
pub struct AustrittInfo {
    pub uhs_id: i64,
    pub platz_id: Option<i64>,
    pub event_id: i64,
}

/// Eintritt einer Person in eine UHS. Vorbedingungen: UHS = `aktiv`, Person nicht
/// schon belegt; falls Platz: Verfügbarkeits-Regel (siehe Spec Annahme 10/12).
/// Inbox-Eintritt = `platz_id = None`. Schreibt das Event + Cache-Update + ggf.
/// Reservierungs-Einlösung in EINER Transaktion.
pub async fn eintritt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    pruefe_uhs_aktiv(&mut tx, einsatz_id, uhs_id).await?;
    pruefe_person_nicht_belegt(&mut tx, einsatz_id, person_id).await?;
    if let Some(pid) = platz_id {
        pruefe_platz_belegbar(&mut tx, uhs_id, pid, person_id).await?;
    }
    let id = insert_event(&mut tx, einsatz_id, person_id, uhs_id, platz_id, "eintritt", notiz, erfasst_von).await?;
    update_cache(&mut tx, einsatz_id, person_id, Some(uhs_id), platz_id).await?;
    if let Some(pid) = platz_id {
        loese_eigene_reservierung_ein(&mut tx, pid, person_id).await?;
    }
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// UHS-/Platz-Wechsel einer Person. Erfordert aktive Belegung der Person.
/// Ziel-UHS muss `aktiv` sein; falls Ziel-Platz: Verfügbarkeits-Regel. Vor dem
/// Wechsel wird der ehemalige Platz (falls vorhanden) auto-aufbereitet (nur, wenn
/// vorher `frei`). Alles in EINER Tx.
pub async fn wechsel(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    ziel_uhs_id: i64,
    ziel_platz_id: Option<i64>,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    pruefe_uhs_aktiv(&mut tx, einsatz_id, ziel_uhs_id).await?;
    let (ex_uhs, ex_platz) = lade_cache(&mut tx, person_id).await?;
    if ex_uhs.is_none() {
        return Err(AppError::Conflict("Person hat keine aktive Belegung".into()));
    }
    if let Some(zpid) = ziel_platz_id {
        pruefe_platz_belegbar(&mut tx, ziel_uhs_id, zpid, person_id).await?;
    }
    let id = insert_event(&mut tx, einsatz_id, person_id, ziel_uhs_id, ziel_platz_id, "wechsel", notiz, erfasst_von).await?;
    // Cache erst nach Aufbereitung umsetzen, sonst greift der Belegungs-Check beim Ex-Platz nicht.
    if let Some(ex_pid) = ex_platz {
        auto_aufbereitung_wenn_frei(&mut tx, ex_pid).await?;
    }
    update_cache(&mut tx, einsatz_id, person_id, Some(ziel_uhs_id), ziel_platz_id).await?;
    if let Some(zpid) = ziel_platz_id {
        loese_eigene_reservierung_ein(&mut tx, zpid, person_id).await?;
    }
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Manueller Austritt. Erfordert aktive Belegung. Schreibt Event, leert Cache,
/// auto-aufbereitet Ex-Platz (falls vorher frei). Alles in EINER Tx.
pub async fn austritt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<BelegungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let (ex_uhs, ex_platz) = lade_cache(&mut tx, person_id).await?;
    let uhs = ex_uhs.ok_or_else(|| AppError::Conflict("Person hat keine aktive Belegung".into()))?;
    let id = insert_event(&mut tx, einsatz_id, person_id, uhs, None, "austritt", notiz, erfasst_von).await?;
    if let Some(ex_pid) = ex_platz {
        auto_aufbereitung_wenn_frei(&mut tx, ex_pid).await?;
    }
    update_cache(&mut tx, einsatz_id, person_id, None, None).await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Auto-Austritt-Helper für Cross-Modul-Hooks (E‑1-Status/E‑2-Verbleib/E‑1-Storno).
/// Macht in EINER Tx: (a) wenn Person belegt → Austritt-Event + Cache-Cleanup +
/// Auto-Aufbereitung; (b) IMMER → etwaige Reservierungen `reserviert_fuer_person_id =
/// person_id` auflösen (Spec: Reservierungs-Folgekonsistenz).
///
/// Liefert `Some(AustrittInfo)` nur, wenn ein Austritt-Event geschrieben wurde —
/// der Wrapper (Task 9) braucht das für ETB-Text + SSE. Bei `None` (Person war nicht
/// belegt) hat trotzdem ggf. ein Reservierungs-Cleanup stattgefunden.
pub async fn austritt_intern(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<Option<AustrittInfo>, AppError> {
    let mut tx = pool.begin().await?;
    let (ex_uhs, ex_platz) = lade_cache(&mut tx, person_id).await?;
    // Reservierungs-Cleanup IMMER (Spec: bei Storno / Status verstorben / abgemeldet):
    sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = 'frei', reserviert_fuer_person_id = NULL \
         WHERE reserviert_fuer_person_id = ?",
    )
    .bind(person_id)
    .execute(&mut *tx)
    .await?;
    let info = if let Some(uhs) = ex_uhs {
        let id = insert_event(&mut tx, einsatz_id, person_id, uhs, None, "austritt", notiz, erfasst_von).await?;
        if let Some(ex_pid) = ex_platz {
            auto_aufbereitung_wenn_frei(&mut tx, ex_pid).await?;
        }
        update_cache(&mut tx, einsatz_id, person_id, None, None).await?;
        Some(AustrittInfo { uhs_id: uhs, platz_id: ex_platz, event_id: id })
    } else {
        None
    };
    tx.commit().await?;
    Ok(info)
}

/// Belegungs-Verlauf einer UHS (neueste zuerst).
pub async fn liste_je_uhs(pool: &SqlitePool, uhs_id: i64) -> Result<Vec<BelegungAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, BelegungAnzeige>(&format!(
        "{SELECT_ALLE} WHERE uhs_id = ? ORDER BY zeitpunkt_at DESC, id DESC"
    ))
    .bind(uhs_id)
    .fetch_all(pool)
    .await?)
}

/// Belegungs-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(pool: &SqlitePool, einsatz_id: i64, person_id: i64) -> Result<Vec<BelegungAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, BelegungAnzeige>(&format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? AND person_id = ? ORDER BY zeitpunkt_at DESC, id DESC"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}

/// Lädt ein einzelnes Event; `NotFound` außerhalb des Einsatzes.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<BelegungAnzeige, AppError> {
    sqlx::query_as::<_, BelegungAnzeige>(&format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

// ---------------------------- private Helpers ----------------------------

async fn pruefe_uhs_aktiv(tx: &mut Transaction<'_, Sqlite>, einsatz_id: i64, uhs_id: i64) -> Result<(), AppError> {
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM uhs WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .fetch_optional(&mut **tx)
    .await?;
    match status.as_deref() {
        Some("aktiv") => Ok(()),
        Some(other) => Err(AppError::UnprocessableEntity(format!(
            "UHS hat Status '{other}' — Belegung nur bei aktiver UHS möglich"
        ))),
        None => Err(AppError::NotFound),
    }
}

async fn pruefe_person_nicht_belegt(tx: &mut Transaction<'_, Sqlite>, einsatz_id: i64, person_id: i64) -> Result<(), AppError> {
    let cache: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT aktuelle_uhs_id, storniert_at FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (uhs, storno) = cache.ok_or(AppError::NotFound)?;
    if storno.is_some() {
        return Err(AppError::Conflict("Person ist storniert".into()));
    }
    if uhs.is_some() {
        return Err(AppError::Conflict(
            "Person hat bereits eine aktive Belegung — Wechsel oder Austritt verwenden".into(),
        ));
    }
    Ok(())
}

async fn pruefe_platz_belegbar(tx: &mut Transaction<'_, Sqlite>, uhs_id: i64, platz_id: i64, person_id: i64) -> Result<(), AppError> {
    let row: Option<(i64, String, Option<i64>)> = sqlx::query_as(
        "SELECT uhs_id, verfuegbarkeit, reserviert_fuer_person_id \
         FROM uhs_platz WHERE id = ? AND storniert_at IS NULL",
    )
    .bind(platz_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (platz_uhs, verf, res_fuer) = row.ok_or(AppError::NotFound)?;
    if platz_uhs != uhs_id {
        return Err(AppError::Validation("Platz gehört nicht zu dieser UHS".into()));
    }
    match verf.as_str() {
        "frei" => Ok(()),
        "reserviert" if res_fuer == Some(person_id) => Ok(()),
        other => Err(AppError::UnprocessableEntity(format!(
            "Platz nicht belegbar (Verfügbarkeit: {other})"
        ))),
    }
}

async fn lade_cache(tx: &mut Transaction<'_, Sqlite>, person_id: i64) -> Result<(Option<i64>, Option<i64>), AppError> {
    sqlx::query_as("SELECT aktuelle_uhs_id, aktueller_platz_id FROM einsatz_person WHERE id = ?")
        .bind(person_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

async fn insert_event(
    tx: &mut Transaction<'_, Sqlite>,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: i64,
    platz_id: Option<i64>,
    art: &str,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<i64, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO person_uhs_belegung \
            (einsatz_id, person_id, uhs_id, platz_id, art, notiz, erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(uhs_id)
    .bind(platz_id)
    .bind(art)
    .bind(notiz)
    .bind(erfasst_von)
    .fetch_one(&mut **tx)
    .await;
    match ergebnis {
        Ok(id) => Ok(id),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict("Platz ist bereits belegt".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn update_cache(
    tx: &mut Transaction<'_, Sqlite>,
    einsatz_id: i64,
    person_id: i64,
    uhs_id: Option<i64>,
    platz_id: Option<i64>,
) -> Result<(), AppError> {
    // Bei Cache-Setzung kann der partielle Unique-Index zuschlagen (anderer
    // Person bereits aktueller_platz_id = platz_id). Konflikt mappen.
    let ergebnis = sqlx::query(
        "UPDATE einsatz_person SET aktuelle_uhs_id = ?, aktueller_platz_id = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(uhs_id)
    .bind(platz_id)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut **tx)
    .await;
    match ergebnis {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict("Platz ist bereits belegt".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn auto_aufbereitung_wenn_frei(tx: &mut Transaction<'_, Sqlite>, platz_id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = 'aufbereitung' \
         WHERE id = ? AND verfuegbarkeit = 'frei'",
    )
    .bind(platz_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn loese_eigene_reservierung_ein(tx: &mut Transaction<'_, Sqlite>, platz_id: i64, person_id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE uhs_platz SET verfuegbarkeit = 'frei', reserviert_fuer_person_id = NULL \
         WHERE id = ? AND verfuegbarkeit = 'reserviert' AND reserviert_fuer_person_id = ?",
    )
    .bind(platz_id)
    .bind(person_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 4: Test ausführen — muss bestehen**

Run: `cargo test --lib uhs::belegung_repo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/uhs/belegung_repo.rs
git commit -m "feat(uhs): belegung_repo (eintritt/wechsel/austritt + Auto-Aufbereitung + Reservierungs-Logik)"
```

---

## Task 9: `src/routes/einsatz_uhs.rs` — Routen + Detail + `auto_austritt`-Wrapper

Alle UHS-/Platz-/Belegungs-HTTP-Handler in einer Datei. Detail-Antwort `UhsDetail` aggregiert UHS-Stamm + Plätze + aktuelle Belegungen + verortetes Material. Der `auto_austritt`-Wrapper ist `pub`, damit Task 13 ihn aus `routes::einsatz_person` aufrufen kann.

**Files:**
- Create: `src/routes/einsatz_uhs.rs`
- Modify: `src/routes/mod.rs` (`pub mod einsatz_uhs;`)

- [ ] **Step 1: Modul registrieren**

In `src/routes/mod.rs` einen `pub mod einsatz_uhs;`-Eintrag ergänzen (alphabetisch zwischen `einsatz_person` und `einsatzabschnitt`):

```rust
pub mod einsatz_uhs;
```

- [ ] **Step 2: Routen-Modul anlegen (volle Implementierung)**

`src/routes/einsatz_uhs.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::material::disposition_repo as material_repo;
use crate::material::EinsatzMaterialAnzeige;
use crate::person::{registrier_anzeige, repo as person_repo};
use crate::uhs::belegung_repo::{self, AustrittInfo};
use crate::uhs::platz_repo::{self, NeuerPlatz, PatchPlatz};
use crate::uhs::repo::{self as uhs_repo, NeueDaten, PatchDaten};
use crate::uhs::{darf_uebergehen, BelegungAnzeige, BelegungsArt, PlatzAnzeige, PlatzTyp, UhsAnzeige, UhsStatus, UhsTyp, Verfuegbarkeit};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

/// Detail-Antwort: UHS-Stamm + Plätze + aktuelle Belegungen + zugeordnetes Material.
#[derive(Debug, Serialize)]
pub struct UhsDetail {
    #[serde(flatten)]
    pub uhs: UhsAnzeige,
    pub plaetze: Vec<PlatzAnzeige>,
    pub belegungen: Vec<BelegungAnzeige>,
    pub material: Vec<EinsatzMaterialAnzeige>,
}

// ---------- ETB-/SSE-Helfer (lokales Muster wie in anderen Routen) ----------

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

fn sse_uhs(state: &AppState, einsatz_id: i64, uhs_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "uhs_id": uhs_id }).to_string();
    state.live.publiziere_event(einsatz_id, "uhs", data);
}

fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": person_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

// ============================== UHS-Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/uhs — Liste (Filter `?status=`, `?abschnitt_id=`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<UhsAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if UhsStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter UHS-Status im Filter".into()));
        }
    }
    Ok(Json(uhs_repo::liste(&state.pool, einsatz_id, params.status.as_deref(), params.abschnitt_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub typ: String,
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/uhs — Anlegen (Status `geplant`). KEIN ETB-Eintrag
/// (Spec: erst die Inbetriebnahme ist lagerelevant). SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<UhsAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if UhsTyp::parse(&body.typ).is_none() {
        return Err(AppError::Validation("Unbekannter UHS-Typ".into()));
    }
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    let standort = trimme(body.standort);
    let notiz = trimme(body.notiz);

    let uhs = uhs_repo::anlegen(
        &state.pool, einsatz_id, benutzer.id,
        NeueDaten {
            typ: &body.typ, bezeichnung: &bezeichnung,
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_deref(), notiz: notiz.as_deref(),
        },
    ).await?;
    sse_uhs(&state, einsatz_id, uhs.id);
    Ok((StatusCode::CREATED, Json(uhs)))
}

/// GET /api/einsaetze/{id}/uhs/{uid} — Detail (Stamm + Plätze + Belegungen + Material).
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
) -> Result<Json<UhsDetail>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let uhs = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    let plaetze = platz_repo::liste_je_uhs(&state.pool, uhs_id).await?;
    let belegungen = belegung_repo::liste_je_uhs(&state.pool, uhs_id).await?;
    let material = material_repo::liste_je_uhs(&state.pool, einsatz_id, uhs_id, einsatz.ist_aktiv()).await?;
    Ok(Json(UhsDetail { uhs, plaetze, belegungen, material }))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub bezeichnung: Option<String>,
    /// `Some(null)` = explizit löschen; absent = unverändert. Serde-Default = absent.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
}

/// Liest ein optional-nullable Feld so, dass JSON-`null` zu `Some(None)` und
/// fehlendes Feld zu `None` wird. Default-Serde-Verhalten unterscheidet das nicht.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// PATCH /api/einsaetze/{id}/uhs/{uid} — Stammfelder. KEIN ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<UhsAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let bezeichnung = body.bezeichnung.as_deref().map(str::trim).map(str::to_string);
    if let Some(b) = &bezeichnung {
        if b.is_empty() {
            return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
        }
    }
    let standort = body.standort.map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let notiz = body.notiz.map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    let nachher = uhs_repo::aktualisiere(
        &state.pool, einsatz_id, uhs_id, benutzer.id,
        PatchDaten {
            bezeichnung: bezeichnung.as_deref(),
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_ref().map(|o| o.as_deref()),
            notiz: notiz.as_ref().map(|o| o.as_deref()),
        },
    ).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(nachher))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/status — Status-Wechsel.
/// Ungültiger Übergang → 422. Auflösung bei aktiver Belegung → 409 (Repo).
/// ETB-Spur bei `→ aktiv` und `→ aufgeloest`. SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<UhsAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if UhsStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Stornierte UHS kann nicht geändert werden".into()));
    }
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }
    let nachher = uhs_repo::setze_status(&state.pool, einsatz_id, uhs_id, &body.status, benutzer.id).await?;

    let typ_label = UhsTyp::parse(&nachher.typ).map(|t| t.anzeige_label()).unwrap_or("");
    let etb_text = match body.status.as_str() {
        "aktiv" => Some(format!("{} ({}) in Betrieb genommen", nachher.bezeichnung, typ_label)),
        "aufgeloest" => Some(format!("{} aufgelöst", nachher.bezeichnung)),
        _ => None,
    };
    if let Some(text) = etb_text {
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid} — Soft-Delete. Blockt mit 409 bei aktiver
/// Belegung (Repo). KEIN ETB-Eintrag (Spec: nur Lifecycle aktiv/aufgeloest).
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    uhs_repo::storniere(&state.pool, einsatz_id, uhs_id, benutzer.id).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}

// ============================== Platz-Routen ==============================

#[derive(Debug, Deserialize)]
pub struct PlatzAnlegenBody {
    pub typ: String,
    pub bezeichnung: String,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/plaetze — Platz anlegen. KEIN ETB. SSE.
pub async fn platz_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<PlatzAnlegenBody>,
) -> Result<(StatusCode, Json<PlatzAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if PlatzTyp::parse(&body.typ).is_none() {
        return Err(AppError::Validation("Unbekannter Platz-Typ".into()));
    }
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    // Existenz der UHS im Einsatz prüfen (404 sonst):
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    let platz = platz_repo::anlegen(&state.pool, uhs_id, NeuerPlatz {
        typ: &body.typ, bezeichnung: &bezeichnung,
        pos_x: body.pos_x, pos_y: body.pos_y,
    }).await?;
    let _ = benutzer; // benutzer.id wird hier nicht persistiert (kein Audit-Feld auf uhs_platz)
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok((StatusCode::CREATED, Json(platz)))
}

#[derive(Debug, Deserialize)]
pub struct PlatzPatchBody {
    pub bezeichnung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pos_x: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pos_y: Option<Option<f64>>,
}

/// PATCH /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid} — Bezeichnung / pos_x / pos_y.
/// KEIN ETB (interne Logistik). SSE.
pub async fn platz_aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
    Json(body): Json<PlatzPatchBody>,
) -> Result<Json<PlatzAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    let bezeichnung = body.bezeichnung.as_deref().map(str::trim).map(str::to_string);
    if let Some(b) = &bezeichnung {
        if b.is_empty() {
            return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
        }
    }
    let platz = platz_repo::aktualisiere(&state.pool, uhs_id, pid, PatchPlatz {
        bezeichnung: bezeichnung.as_deref(),
        pos_x: body.pos_x, pos_y: body.pos_y,
    }).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(platz))
}

#[derive(Debug, Deserialize)]
pub struct VerfuegbarkeitBody {
    pub verfuegbarkeit: String,
    pub reserviert_fuer_person_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit — setzt
/// Verfügbarkeit (+ ggf. Reservierungs-Ziel). KEIN ETB. SSE.
pub async fn platz_verfuegbarkeit(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
    Json(body): Json<VerfuegbarkeitBody>,
) -> Result<Json<PlatzAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    if Verfuegbarkeit::parse(&body.verfuegbarkeit).is_none() {
        return Err(AppError::Validation("Unbekannte Verfügbarkeit".into()));
    }
    // Bei Reservierung: Person muss zum Einsatz gehören (404 sonst).
    if body.verfuegbarkeit == "reserviert" {
        let pid_ziel = body.reserviert_fuer_person_id.ok_or_else(|| {
            AppError::Validation("Reservierung erfordert eine Ziel-Person".into())
        })?;
        person_repo::laden(&state.pool, einsatz_id, pid_ziel).await?;
    }
    let platz = platz_repo::setze_verfuegbarkeit(
        &state.pool, uhs_id, pid, &body.verfuegbarkeit, body.reserviert_fuer_person_id,
    ).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(platz))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid} — Platz-Soft-Delete.
/// 409 bei aktiver Belegung. KEIN ETB. SSE.
pub async fn platz_stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    platz_repo::storniere(&state.pool, uhs_id, pid).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}

// ============================== Belegungs-Route ==============================

#[derive(Debug, Deserialize)]
pub struct BelegungBody {
    pub art: String,                  // "eintritt" | "wechsel" | "austritt"
    pub uhs_id: Option<i64>,          // erforderlich bei eintritt/wechsel
    pub platz_id: Option<i64>,        // optional (NULL = Inbox/Austritt)
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/uhs-belegung — Belegungs-Event.
/// Repo macht alles transaktional inkl. ETB-relevanter Effekte. Hier nur die
/// pseudonyme ETB-Spur (Spec ETB-Tabelle) + zwei SSE-Events (`uhs` + `person`).
pub async fn belegung(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<BelegungBody>,
) -> Result<(StatusCode, Json<BelegungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let art = BelegungsArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Belegungs-Art".into()))?;
    let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
    let notiz = trimme(body.notiz);

    // Für ETB-Texte brauchen wir den ehemaligen Platz/UHS (vor dem Event).
    let vorher_uhs = person.aktuelle_uhs_id;
    let vorher_platz = person.aktueller_platz_id;

    let event = match art {
        BelegungsArt::Eintritt => {
            let uhs = body.uhs_id.ok_or_else(|| {
                AppError::Validation("uhs_id ist bei eintritt erforderlich".into())
            })?;
            belegung_repo::eintritt(&state.pool, einsatz_id, person_id, uhs, body.platz_id, notiz.as_deref(), benutzer.id).await?
        }
        BelegungsArt::Wechsel => {
            let uhs = body.uhs_id.ok_or_else(|| {
                AppError::Validation("uhs_id ist bei wechsel erforderlich".into())
            })?;
            belegung_repo::wechsel(&state.pool, einsatz_id, person_id, uhs, body.platz_id, notiz.as_deref(), benutzer.id).await?
        }
        BelegungsArt::Austritt => {
            belegung_repo::austritt(&state.pool, einsatz_id, person_id, notiz.as_deref(), benutzer.id).await?
        }
    };

    // Pseudonyme ETB-Spur:
    let text = formatiere_belegungs_etb(&state.pool, &person.registrier_nr.to_string(), person.registrier_nr,
                                         &event, art, vorher_uhs, vorher_platz).await?;
    if let Some(text) = text {
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_uhs(&state, einsatz_id, event.uhs_id);
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(event)))
}

/// Baut den pseudonymen ETB-Text gemäß Spec-Tabelle. Eigene Funktion, damit der
/// `auto_austritt`-Wrapper (unten) ihn wiederverwenden kann.
async fn formatiere_belegungs_etb(
    pool: &sqlx::SqlitePool,
    _: &str,           // (Platzhalter — wir nutzen registrier_nr direkt)
    registrier_nr: i64,
    event: &BelegungAnzeige,
    art: BelegungsArt,
    vorher_uhs: Option<i64>,
    vorher_platz: Option<i64>,
) -> Result<Option<String>, AppError> {
    let r = registrier_anzeige(registrier_nr);
    let ziel_uhs = uhs_repo::laden(pool, event.einsatz_id, event.uhs_id).await?;
    let ziel_platz = match event.platz_id {
        Some(pid) => Some(platz_repo::laden(pool, event.uhs_id, pid).await?),
        None => None,
    };
    let text = match art {
        BelegungsArt::Eintritt => match &ziel_platz {
            Some(p) => format!("Person {r}: Aufnahme in {} ({})", ziel_uhs.bezeichnung, p.bezeichnung),
            None => format!("Person {r}: Aufnahme in {} (Inbox)", ziel_uhs.bezeichnung),
        },
        BelegungsArt::Wechsel => {
            let intern = vorher_uhs == Some(event.uhs_id);
            if intern {
                let von_label = match vorher_platz {
                    Some(vpid) => platz_repo::laden(pool, event.uhs_id, vpid).await.ok().map(|p| p.bezeichnung).unwrap_or_else(|| "Inbox".into()),
                    None => "Inbox".into(),
                };
                let zu_label = ziel_platz.as_ref().map(|p| p.bezeichnung.clone()).unwrap_or_else(|| "Inbox".into());
                format!("Person {r}: Verlegung in {} ({} → {})", ziel_uhs.bezeichnung, von_label, zu_label)
            } else {
                let von_uhs = vorher_uhs.map(|id| uhs_repo::laden(pool, event.einsatz_id, id));
                let von_bez = match von_uhs {
                    Some(fut) => fut.await.ok().map(|u| u.bezeichnung).unwrap_or_default(),
                    None => String::new(),
                };
                let zu_label = ziel_platz.as_ref().map(|p| format!(" ({})", p.bezeichnung)).unwrap_or_default();
                format!("Person {r}: Verlegung {} → {}{}", von_bez, ziel_uhs.bezeichnung, zu_label)
            }
        }
        BelegungsArt::Austritt => {
            let suffix = event.notiz.as_deref().map(|n| format!(" ({n})")).unwrap_or_default();
            format!("Person {r}: verlässt {}{}", ziel_uhs.bezeichnung, suffix)
        }
    };
    Ok(Some(text))
}

// ============================== Cross-Modul-Wrapper ==============================

/// Auto-Austritt-Wrapper für Cross-Modul-Hooks (E‑1-Status/E‑2-Verbleib/E‑1-Storno).
/// Ruft `belegung_repo::austritt_intern` und schreibt — falls ein Austritt-Event
/// passiert ist — den pseudonymen ETB-Eintrag mit Anlass-Notiz, plus SSE-Events.
/// Liefert `Ok(())` auch dann, wenn nichts zu tun war (Person nicht belegt + keine
/// Reservierung). **Wird sequentiell nach dem auslösenden Repo-Update gerufen
/// (Codebase-Konvention für Cross-Modul-Wirkung; akzeptiertes Risiko-Fenster).**
pub async fn auto_austritt(
    state: &AppState,
    einsatz_id: i64,
    person_id: i64,
    anlass: &str,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let info: Option<AustrittInfo> =
        belegung_repo::austritt_intern(&state.pool, einsatz_id, person_id, Some(anlass), benutzer_id).await?;
    let Some(info) = info else {
        return Ok(()); // Person war nicht belegt — Reservierungs-Cleanup ist trotzdem gelaufen.
    };
    let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
    let uhs = uhs_repo::laden(&state.pool, einsatz_id, info.uhs_id).await?;
    let r = registrier_anzeige(person.registrier_nr);
    let text = format!("Person {r}: verlässt {} ({anlass})", uhs.bezeichnung);
    etb_system(state, einsatz_id, benutzer_id, &text).await?;
    sse_uhs(state, einsatz_id, info.uhs_id);
    sse_person(state, einsatz_id, person_id);
    Ok(())
}
```

> **Hinweise:**
> - **`formatiere_belegungs_etb`-Signatur:** Der erste Parameter (`_: &str`) ist ein Relikt — falls beim Implementieren nicht gebraucht, raus damit (lint-Warnung). Die echte Identität läuft über `registrier_nr` (Pseudonymisierung).
> - **`material_repo::liste_je_uhs`:** Diese Funktion gibt es noch nicht. Task 12 fügt sie zu `material/disposition_repo.rs` hinzu. Solange Task 12 nicht erledigt ist, gibt der Compile-Fehler den Hinweis — du musst Task 12 vor diesem Task vollständig durch haben ODER hier temporär `Vec::new()` returnen und in Task 12 nachziehen.
> - **`deserialize_optional_field`** ist ein Standard-Serde-Idiom, um „absent" vs. „explizit null" zu unterscheiden — exakt das, was die PATCH-Semantik (`Some(None)` = löschen, `None` = unverändert) verlangt.

- [ ] **Step 3: Voller Compile-Check**

Run: `cargo check --all-targets`
Expected: PASS (nach Task 12; siehe Hinweis zu `material_repo::liste_je_uhs`).

> **Reihenfolge-Hinweis für Subagenten:** Wenn Tasks streng sequenziell laufen, ziehe Task 12 (Material-Erweiterung) ggf. vor diesen Task — oder lege hier zuerst eine Stub-Funktion in `material/disposition_repo.rs` an, die `Ok(Vec::new())` zurückgibt, und ersetze sie in Task 12 durch die echte Query.

- [ ] **Step 4: Commit (vorerst ohne Routen-Registrierung — die kommt in Task 10)**

```bash
git add src/routes/mod.rs src/routes/einsatz_uhs.rs
git commit -m "feat(routes): einsatz_uhs (UHS-/Platz-/Belegungs-Handler + auto_austritt-Wrapper)"
```

---

## Task 10: `app.rs` — Routen registrieren

Alle UHS-/Platz-/Belegungs-Endpunkte in den Router einhängen. Reihenfolge: Spezifischere Pfade (mit `/stream`/`/export`) gehören vor die Wildcard-Pfade.

**Files:**
- Modify: `src/app.rs`

- [ ] **Step 1: Routen registrieren**

In `src/app.rs` zwischen `/personen`-Block und `/abschnitte`-Block ergänzen:

```rust
        .route("/api/einsaetze/{id}/uhs", get(routes::einsatz_uhs::liste))
        .route("/api/einsaetze/{id}/uhs", post(routes::einsatz_uhs::anlegen))
        .route("/api/einsaetze/{id}/uhs/{uid}", get(routes::einsatz_uhs::detail))
        .route("/api/einsaetze/{id}/uhs/{uid}", patch(routes::einsatz_uhs::aktualisieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/status", post(routes::einsatz_uhs::status_wechsel))
        .route("/api/einsaetze/{id}/uhs/{uid}", delete(routes::einsatz_uhs::stornieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze", post(routes::einsatz_uhs::platz_anlegen))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}", patch(routes::einsatz_uhs::platz_aktualisieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit",
               post(routes::einsatz_uhs::platz_verfuegbarkeit))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}", delete(routes::einsatz_uhs::platz_stornieren))
        .route("/api/einsaetze/{id}/personen/{pid}/uhs-belegung",
               post(routes::einsatz_uhs::belegung))
```

> **Wo genau:** Direkt vor dem `.route("/api/einsaetze/{id}/abschnitte", …)`-Block.

- [ ] **Step 2: Compile-Check**

Run: `cargo check --all-targets`
Expected: PASS

- [ ] **Step 3: Smoke-Test — alle bisherigen Tests bleiben grün**

Run: `cargo test --lib`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app.rs
git commit -m "feat(app): UHS-Routen registrieren (CRUD, Plätze, Belegung)"
```

---

## Task 11: SSE-Stream-Endpoint für UHS

Eigener Stream-Endpoint pro Modul (Codebase-Pattern aus `etb`/`personen`). Abonniert den Einsatz-Kanal; Clients filtern auf `uhs` + `person`-Events.

**Files:**
- Modify: `src/routes/einsatz_uhs.rs` (Stream-Handler hinzufügen)
- Modify: `src/app.rs` (Route registrieren)

- [ ] **Step 1: Stream-Handler ergänzen**

In `src/routes/einsatz_uhs.rs` am Ende:

```rust
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// GET /api/einsaetze/{id}/uhs/stream — SSE-Stream. Nur Lesezugriff.
/// Der Client filtert clientseitig auf `uhs`- und `person`-Events.
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

> **Hinweis Routen-Reihenfolge:** Die `/uhs/stream`-Route muss VOR `/uhs/{uid}` registriert werden, sonst matcht axum „stream" als `uid`.

- [ ] **Step 2: Route registrieren**

In `src/app.rs` direkt vor `.route("/api/einsaetze/{id}/uhs/{uid}", get(routes::einsatz_uhs::detail))`:

```rust
        .route("/api/einsaetze/{id}/uhs/stream", get(routes::einsatz_uhs::stream))
```

- [ ] **Step 3: Compile-Check**

Run: `cargo check --all-targets`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/einsatz_uhs.rs src/app.rs
git commit -m "feat(routes): UHS-SSE-Stream (Clients filtern auf uhs/person-Events)"
```

---

## Task 12: Material-Verortung (`einsatz_material.uhs_id`)

`EinsatzMaterialAnzeige.uhs_id` ergänzen, `disposition_repo::aktualisiere` um den Parameter erweitern, eine neue Funktion `liste_je_uhs` hinzufügen, im `material`-Routen-Handler den Body um `uhs_id` erweitern. Material-Verortung schreibt **KEINEN** ETB-Eintrag (Spec).

**Files:**
- Modify: `src/material/mod.rs` (`EinsatzMaterialAnzeige.uhs_id: Option<i64>`)
- Modify: `src/material/disposition_repo.rs` (Row + `zu_anzeige` + `aktualisiere`-Signatur + neue Funktion `liste_je_uhs`)
- Modify: `src/routes/einsatz_material.rs` (`DispoPatchBody.uhs_id`, Übergabe ans Repo)
- Modify: `frontend/src/api/types.ts` (in Task 16 — hier nur Backend)

- [ ] **Step 1: Failing test schreiben**

In `src/material/disposition_repo.rs` im `#[cfg(test)] mod tests` ergänzen (am Ende des Mod):

```rust
    #[tokio::test]
    async fn aktualisiere_setzt_uhs_id_und_loese() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        // Stamm-Material + UHS:
        let m = mat_repo::anlegen(&pool, 1, mat_daten("Wolldecke")).await.unwrap();
        let em = disponiere_stamm(&pool, einsatz, 1, m.id, 50, benutzer).await.unwrap();
        let u: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 50', ?, ?) RETURNING id")
            .bind(einsatz).bind(benutzer).bind(benutzer).fetch_one(&pool).await.unwrap();
        // Zuordnen:
        aktualisiere(&pool, einsatz, em, None, None, None, Some(Some(u))).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert_eq!(a.uhs_id, Some(u));
        // Lösen (explizit NULL):
        aktualisiere(&pool, einsatz, em, None, None, None, Some(None)).await.unwrap();
        let a = laden_anzeige(&pool, einsatz, em, true).await.unwrap();
        assert!(a.uhs_id.is_none());
        // liste_je_uhs:
        aktualisiere(&pool, einsatz, em, None, None, None, Some(Some(u))).await.unwrap();
        let liste = liste_je_uhs(&pool, einsatz, u, true).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].id, em);
    }
```

- [ ] **Step 2: Test ausführen — muss fehlschlagen**

Run: `cargo test --lib material::disposition_repo::tests::aktualisiere_setzt_uhs_id_und_loese`
Expected: FAIL (Compile-Fehler: `aktualisiere` hat nicht die richtige Signatur, `liste_je_uhs` fehlt, `uhs_id` fehlt am Anzeige-Struct)

- [ ] **Step 3: `EinsatzMaterialAnzeige` um `uhs_id` erweitern**

In `src/material/mod.rs` im Struct `EinsatzMaterialAnzeige` nach `pub einheit_id: Option<i64>,` ergänzen:

```rust
    /// E‑3: zugeordnete Unfallhilfsstelle (NULL = nicht verortet).
    pub uhs_id: Option<i64>,
```

- [ ] **Step 4: `Row` + `zu_anzeige` + `SELECT_AUFGELOEST` erweitern**

In `src/material/disposition_repo.rs`:

a) `SELECT_AUFGELOEST` um `em.uhs_id` ergänzen (vor `em.menge`):

```rust
const SELECT_AUFGELOEST: &str = "\
    SELECT em.id, em.einsatz_id, em.material_id, em.einheit_id, em.uhs_id, em.menge, em.status, \
           em.snap_bezeichnung, em.snap_kategorie, em.snap_bestandsnummer, \
           em.snap_traegerorganisation, em.bemerkung, em.disponiert_at, em.disponiert_von, \
           m.bezeichnung AS live_bezeichnung, m.kategorie AS live_kategorie, \
           m.bestandsnummer AS live_bestandsnummer, m.traegerorganisation AS live_traegerorganisation, \
           m.dienststatus AS live_dienststatus \
    FROM einsatz_material em \
    LEFT JOIN material m ON m.id = em.material_id";
```

b) `Row`-Struct um `uhs_id: Option<i64>` ergänzen.

c) `zu_anzeige` um `uhs_id: row.uhs_id` ergänzen.

- [ ] **Step 5: `aktualisiere`-Signatur erweitern**

Aktuelle Signatur:
```rust
pub async fn aktualisiere(pool, einsatz_id, em_id, menge, status, bemerkung) -> Result<(), AppError>
```

Erweitern um `uhs_id: Option<Option<i64>>` (`Some(Some(id))` = setzen; `Some(None)` = NULL; `None` = unverändert):

```rust
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    em_id: i64,
    menge: Option<i64>,
    status: Option<&str>,
    bemerkung: Option<&str>,
    uhs_id: Option<Option<i64>>,
) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE einsatz_material \
         SET menge = COALESCE(?, menge), status = COALESCE(?, status), \
             bemerkung = COALESCE(?, bemerkung), \
             uhs_id = CASE WHEN ?4 IS NULL THEN uhs_id ELSE ?5 END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(menge)
    .bind(status)
    .bind(bemerkung)
    .bind(uhs_id.map(|_| 1_i64))
    .bind(uhs_id.and_then(|v| v))
    .bind(em_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

> **Hinweis:** Falls sqlx mit gemischten `?`/`?N` Positional/Named Bindings stolpert, schreibe das UPDATE in zwei Schritten: erst Menge/Status/Bemerkung (alte Logik), dann separat `uhs_id` (mit `Some(None)`-Erkennung). Verifiziere mit dem Test in Step 6.

- [ ] **Step 6: `liste_je_uhs` ergänzen**

In `src/material/disposition_repo.rs` neben `liste`:

```rust
/// Disponiertes Material, das einer bestimmten UHS zugeordnet ist (aufgelöst).
pub async fn liste_je_uhs(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
    einsatz_aktiv: bool,
) -> Result<Vec<EinsatzMaterialAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE em.einsatz_id = ? AND em.uhs_id = ? ORDER BY em.disponiert_at, em.id"
    ))
    .bind(einsatz_id)
    .bind(uhs_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| zu_anzeige(r, einsatz_aktiv)).collect())
}
```

- [ ] **Step 7: Bestehende Aufrufer von `aktualisiere` anpassen**

In `src/routes/einsatz_material.rs` im Handler `aktualisieren` (Funktion, Zeile ~177):

```rust
    let uhs_id = body.uhs_id.map(|opt| opt); // Some(Some(id)) / Some(None) / None
    disposition_repo::aktualisiere(
        &state.pool, einsatz_id, em_id,
        body.menge, status, bemerkung, uhs_id,
    ).await?;
```

UND `DispoPatchBody` um das Feld erweitern:

```rust
#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    pub status: Option<String>,
    pub bemerkung: Option<String>,
    /// E‑3: Verortung an UHS. `Some(null)` = lösen, absent = unverändert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
}

fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
```

> **KEIN ETB-Eintrag** für `uhs_id`-Wechsel — die bestehende „Menge"/„Status"-ETB-Logik des Handlers bleibt unverändert. Material-Verortung ist explizit aus dem ETB ausgenommen (Spec).

- [ ] **Step 8: Test ausführen — muss bestehen**

Run: `cargo test --lib material`
Expected: PASS

- [ ] **Step 9: Regression**

Run: `cargo test`
Expected: PASS (bestehende Material-Tests und HTTP-Tests dürfen nicht brechen — die neue Signatur ist additiv mit Default `None` für `uhs_id`).

- [ ] **Step 10: Commit**

```bash
git add src/material/mod.rs src/material/disposition_repo.rs src/routes/einsatz_material.rs
git commit -m "feat(material): uhs_id-Verortung (PATCH-Erweiterung + liste_je_uhs)"
```

---

## Task 13: Cross-Modul-Hooks in `einsatz_person.rs`

Aufrufe von `routes::einsatz_uhs::auto_austritt` in den drei E‑1/E‑2-Handlern: `status_wechsel` (bei `verstorben`/`abgemeldet`), `verbleib` (bei `transport`/`entlassung`), `stornieren` (immer). **Sequentiell nach** dem auslösenden Repo-Update (Codebase-Konvention; Risiko-Fenster akzeptiert — Plan-Header).

**Files:**
- Modify: `src/routes/einsatz_person.rs`

- [ ] **Step 1: Failing tests vorbereiten (im Integrationstest-Modul; eigentliche Test-Implementierung in Task 14)**

Hier nur die Code-Anpassung. Der „failing test"-Schritt für die Cross-Modul-Wirkung läuft als Integration-Test in Task 14, weil er Routen + DB + ETB-Wirkung gemeinsam prüft. (TDD-Schritt für diesen Task: Compile + bestehende E‑1/E‑2-Unit-Tests müssen nach der Änderung grün bleiben.)

- [ ] **Step 2: Import + Hook in `status_wechsel`**

In `src/routes/einsatz_person.rs` oben den Import ergänzen:

```rust
use crate::routes::einsatz_uhs;
```

Im Handler `status_wechsel` **nach** dem `repo::setze_status`-Aufruf und **vor** dem `etb_system`-Aufruf ergänzen:

```rust
    // E‑3: bei verstorben/abgemeldet → UHS-Auto-Austritt (sequenziell, eigene ETB-Spur).
    if matches!(body.status.as_str(), "verstorben" | "abgemeldet") {
        let anlass = format!("durch Status-Wechsel zu {}", body.status);
        einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, &anlass, benutzer.id).await?;
    }
```

- [ ] **Step 3: Hook in `verbleib`**

Im Handler `verbleib` **nach** dem `verbleib_repo::erfassen`-Aufruf und **vor** dem `etb_system`-Aufruf ergänzen:

```rust
    // E‑3: bei transport/entlassung → UHS-Auto-Austritt (eigene ETB-Spur).
    if matches!(art, VerbleibArt::Transport | VerbleibArt::Entlassung) {
        let anlass = format!("durch Verbleib {}", art.as_str());
        einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, &anlass, benutzer.id).await?;
    }
```

- [ ] **Step 4: Hook in `stornieren`**

Im Handler `stornieren` **nach** dem `repo::storniere`-Aufruf und **vor** dem `etb_system`-Aufruf ergänzen:

```rust
    // E‑3: Storno → UHS-Auto-Austritt + Reservierungs-Cleanup (Repo schreibt nur ETB, wenn Austritt nötig).
    einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, "durch Storno der Person", benutzer.id).await?;
```

- [ ] **Step 5: Compile + Regression**

Run: `cargo test`
Expected: PASS (bestehende E‑1/E‑2-Tests bleiben grün; die Hooks sind no-ops, wenn keine UHS-Belegung vorliegt).

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz_person.rs
git commit -m "feat(person): Cross-Modul-Hooks für UHS-Auto-Austritt (Status/Verbleib/Storno)"
```

---

## Task 14: HTTP-Integrationstests (`tests/einsatz_uhs.rs`)

Vollständiger Test-Lauf der Routen + Cross-Modul-Wirkung. Harness folgt dem Muster aus `tests/einsatz_person.rs` (Login-Cookie, `oneshot`-Requests, ETB-Inspektion).

**Files:**
- Create: `tests/einsatz_uhs.rs`

- [ ] **Step 1: Test-Datei mit Harness + den wichtigsten Cases anlegen**

`tests/einsatz_uhs.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

// ---------- Harness (an tests/einsatz_person.rs angelehnt) ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let router = build_router(AppState { pool: pool.clone(), live: LiveHub::new() });
    (router, pool)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app.clone().oneshot(
        Request::builder().method("POST").uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body)).unwrap()
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap()
        .split(';').next().unwrap().to_string()
}

async fn json_request(app: &axum::Router, method: &str, uri: &str, cookie: &str, body: Option<&Value>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri).header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => { req = req.header(header::CONTENT_TYPE, "application/json");
                     Body::from(b.to_string()) }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, value)
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (s, v) = json_request(app, "POST", "/api/einsaetze", cookie, Some(&json!({
        "bezeichnung": "Lage", "einsatzart": "realeinsatz", "begonnen_at": "2026-05-28"
    }))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = json_request(app, "POST", &format!("/api/einsaetze/{einsatz}/personen"),
                              cookie, Some(&json!({"notiz": null}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn uhs_anlegen_und_aktivieren(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, v) = json_request(app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie, Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez}))).await;
    assert_eq!(s, StatusCode::CREATED);
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = json_request(app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie, Some(&json!({"status": "aktiv"}))).await;
    assert_eq!(s, StatusCode::OK);
    uhs
}

async fn platz_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64, bez: &str) -> i64 {
    let (s, v) = json_request(app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze"),
        cookie, Some(&json!({"typ": "bett", "bezeichnung": bez}))).await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, v) = json_request(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    v.as_array().unwrap().iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap_or("").to_string()).collect()
}

// ============================== Tests ==============================

#[tokio::test]
async fn anlegen_liefert_geplant_und_keinen_etb() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (s, v) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie, Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"}))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["status"], "geplant");
    // Kein ETB-Eintrag für Anlegen (Spec):
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(inhalte.iter().all(|s| !s.contains("BHP 50")), "Anlegen schreibt KEINEN ETB-Eintrag");
}

#[tokio::test]
async fn status_aktiv_schreibt_etb_in_betrieb_genommen() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let _ = uhs;
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(inhalte.iter().any(|s| s.contains("BHP 50") && s.contains("in Betrieb genommen")),
        "Inbetriebnahme-ETB-Eintrag mit Typ-Label");
}

#[tokio::test]
async fn ungueltiger_status_uebergang_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_, v) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie, Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"}))).await;
    let uhs = v["id"].as_i64().unwrap();
    // geplant → aufgeloest → versuch aktiv (terminal):
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie, Some(&json!({"status": "aufgeloest"}))).await;
    let (s, _) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie, Some(&json!({"status": "aktiv"}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn geplante_uhs_akzeptiert_keine_belegung() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (_, v) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"),
        &cookie, Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"}))).await;
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn aufloesen_blockt_bei_aktiver_belegung_409() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie, Some(&json!({"status": "aufgeloest"}))).await;
    assert_eq!(s, StatusCode::CONFLICT, "Auflösung bei Belegung → 409");
    // Storno identisch:
    let (s, _) = json_request(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        &cookie, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn inbox_mehrfach_belegung_erlaubt() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let p1 = person_anlegen(&app, &cookie, einsatz).await;
    let p2 = person_anlegen(&app, &cookie, einsatz).await;
    for p in [p1, p2] {
        let (s, _) = json_request(&app, "POST",
            &format!("/api/einsaetze/{einsatz}/personen/{p}/uhs-belegung"),
            &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
        assert_eq!(s, StatusCode::CREATED, "Inbox-Mehrfach-Belegung erlaubt");
    }
}

#[tokio::test]
async fn doppelbelegung_eines_platzes_ist_konflikt() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let p1 = person_anlegen(&app, &cookie, einsatz).await;
    let p2 = person_anlegen(&app, &cookie, einsatz).await;
    let body = json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz});
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p1}/uhs-belegung"),
        &cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p2}/uhs-belegung"),
        &cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::CONFLICT, "1:1-Belegung erzwungen");
}

#[tokio::test]
async fn auto_aufbereitung_und_etb_text_inbox() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    // Eintritt auf Platz + Austritt → Aufbereitung + zwei ETB-Texte:
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz}))).await;
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "austritt"}))).await;
    let verf: String = sqlx::query_scalar("SELECT verfuegbarkeit FROM uhs_platz WHERE id = ?")
        .bind(platz).fetch_one(&pool).await.unwrap();
    assert_eq!(verf, "aufbereitung");
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(inhalte.iter().any(|s| s.contains("Aufnahme in BHP 50") && s.contains("Bett 3")));
    assert!(inhalte.iter().any(|s| s.contains("verlässt BHP 50")));
}

#[tokio::test]
async fn reservierte_person_belegt_loest_reservierung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    // Reservieren:
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie, Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": person}))).await;
    assert_eq!(s, StatusCode::OK);
    // Belegen mit der reservierten Person → erlaubt + Reservierung weg:
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz}))).await;
    assert_eq!(s, StatusCode::CREATED);
    let (v, fk): (String, Option<i64>) = sqlx::query_as(
        "SELECT verfuegbarkeit, reserviert_fuer_person_id FROM uhs_platz WHERE id = ?"
    ).bind(platz).fetch_one(&pool).await.unwrap();
    assert_eq!(v, "frei");
    assert!(fk.is_none());
}

#[tokio::test]
async fn fremde_person_auf_reservierten_platz_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let p_res = person_anlegen(&app, &cookie, einsatz).await;
    let p_andere = person_anlegen(&app, &cookie, einsatz).await;
    json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie, Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": p_res}))).await;
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{p_andere}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs, "platz_id": platz}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn cross_modul_status_verstorben_loest_auto_austritt_aus() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    // Status auf betroffen für Belegung:
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie, Some(&json!({"status": "betroffen"}))).await;
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
    // Status → verstorben:
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie, Some(&json!({"status": "verstorben"}))).await;
    // ETB hat ZWEI Einträge: Status-Wechsel + UHS-Austritt mit Anlass:
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(inhalte.iter().any(|s| s.contains("betroffen") && s.contains("verstorben")), "Status-ETB");
    assert!(inhalte.iter().any(|s| s.contains("verlässt BHP 50") && s.contains("Status-Wechsel zu verstorben")),
        "Auto-Austritt-ETB mit Anlass");
}

#[tokio::test]
async fn cross_modul_verbleib_transport_loest_auto_austritt_aus() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/status"),
        &cookie, Some(&json!({"status": "betroffen"}))).await;
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/verbleib"),
        &cookie, Some(&json!({"art": "transport", "ziel": "KH Mitte"}))).await;
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    assert!(inhalte.iter().any(|s| s.contains("verlässt BHP 50") && s.contains("Verbleib transport")));
}

#[tokio::test]
async fn cross_modul_storno_loest_reservierung_auf_auch_ohne_belegung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let platz = platz_anlegen(&app, &cookie, einsatz, uhs, "Bett 3").await;
    let person = person_anlegen(&app, &cookie, einsatz).await;
    json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{platz}/verfuegbarkeit"),
        &cookie, Some(&json!({"verfuegbarkeit": "reserviert", "reserviert_fuer_person_id": person}))).await;
    // Person stornieren (war NICHT belegt):
    json_request(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/personen/{person}"), &cookie, None).await;
    let (v, fk): (String, Option<i64>) = sqlx::query_as(
        "SELECT verfuegbarkeit, reserviert_fuer_person_id FROM uhs_platz WHERE id = ?"
    ).bind(platz).fetch_one(&pool).await.unwrap();
    assert_eq!(v, "frei");
    assert!(fk.is_none());
}

#[tokio::test]
async fn etb_text_enthaelt_nur_pseudonym_keinen_namen() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    let (_, v) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen"),
        &cookie, Some(&json!({"name": "Müller", "vorname": "Anna"}))).await;
    let person = v["id"].as_i64().unwrap();
    json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/personen/{person}/uhs-belegung"),
        &cookie, Some(&json!({"art": "eintritt", "uhs_id": uhs}))).await;
    let inhalte = etb_inhalte(&app, &cookie, einsatz).await;
    for inh in &inhalte {
        assert!(!inh.contains("Müller"), "ETB-Leak Name: {inh}");
        assert!(!inh.contains("Anna"), "ETB-Leak Vorname: {inh}");
    }
}

#[tokio::test]
async fn material_verortung_schreibt_keinen_etb() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    // Material ad-hoc disponieren:
    let (_, v) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/material"),
        &cookie, Some(&json!({"adhoc": {"bezeichnung": "Wolldecke"}, "menge": 10}))).await;
    let em = v["id"].as_i64().unwrap();
    // Pre-Snapshot ETB:
    let vorher = etb_inhalte(&app, &cookie, einsatz).await.len();
    // Zuordnen:
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &cookie, Some(&json!({"uhs_id": uhs}))).await;
    assert_eq!(s, StatusCode::OK);
    let nachher = etb_inhalte(&app, &cookie, einsatz).await.len();
    assert_eq!(vorher, nachher, "Material-Verortung schreibt KEINEN ETB-Eintrag");
}

#[tokio::test]
async fn beobachter_kann_keine_uhs_anlegen() {
    let (app, _) = setup_mit_pool().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin_cookie).await;
    // Beobachter-Benutzer + Mitgliedschaft:
    json_request(&app, "POST", "/api/benutzer", &admin_cookie,
        Some(&json!({"anzeigename": "Beob", "benutzername": "beob", "passwort": "startpw12"}))).await;
    let (_, mitglieder) = json_request(&app, "GET", "/api/benutzer", &admin_cookie, None).await;
    let beob_id = mitglieder.as_array().unwrap().iter()
        .find(|b| b["benutzername"] == "beob").unwrap()["id"].as_i64().unwrap();
    json_request(&app, "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{beob_id}"),
        &admin_cookie, Some(&json!({"einsatz_rolle": "beobachter"}))).await;
    let beob_cookie = login_cookie(&app, "beob", "startpw12").await;
    let (s, _) = json_request(&app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"),
        &beob_cookie, Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"}))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fremder_einsatz_ist_404() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &cookie).await;
    let einsatz_b = einsatz_anlegen(&app, &cookie).await;
    let uhs_a = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz_a, "BHP A").await;
    // Detail über fremden Einsatz:
    let (s, _) = json_request(&app, "GET",
        &format!("/api/einsaetze/{einsatz_b}/uhs/{uhs_a}"), &cookie, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let uhs = uhs_anlegen_und_aktivieren(&app, &cookie, einsatz, "BHP 50").await;
    // Einsatz direkt in DB abschließen (Test-Shortcut):
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?")
        .bind(einsatz).execute(&pool).await.unwrap();
    let (s, _) = json_request(&app, "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        &cookie, Some(&json!({"status": "aufgeloest"}))).await;
    assert_eq!(s, StatusCode::CONFLICT, "fordere_aktiv blockt");
}
```

> **Hinweise zur Harness-Vereinfachung:** Die `json_request`-Helper-Funktion oben ist kompakter als das `tests/einsatz_person.rs`-Idiom. Falls du beim Implementieren auf Probleme stößt (Multiline-JSON-Strings, Body-Encoding), übernimm das exakte Idiom aus `tests/einsatz_person.rs:1-100` (eigene `anfrage`-Funktion mit getrennten String-Builds). Auch das Beobachter-Mitgliedschafts-Setup (Test `beobachter_kann_keine_uhs_anlegen`) lehnt sich an `tests/einsatz_person.rs` an — verifiziere die genauen Endpunkte/Bodies dort, falls dieser Test scheitert.

- [ ] **Step 2: Tests ausführen**

Run: `cargo test --test einsatz_uhs`
Expected: PASS (alle ~16 Cases)

- [ ] **Step 3: Volle Regression**

Run: `cargo test`
Expected: PASS (alle bestehenden Tests bleiben grün)

- [ ] **Step 4: Commit**

```bash
git add tests/einsatz_uhs.rs
git commit -m "test(uhs): HTTP-Integrationstests (Belegung, Cross-Modul, Rechte-Matrix, ETB-Leak)"
```

---

## Task 15: Frontend — Dependencies, Typen, API-Client

`@dnd-kit/core` + `@dnd-kit/modifiers` als Dependencies. Typen für UHS/Platz/Belegung + Erweiterung von `EinsatzMaterial` um `uhs_id`. Vollständiger API-Client `einsatzUhs.ts`.

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/einsatzUhs.ts`
- Modify: `frontend/src/api/einsatzMaterial.ts` (PATCH-Body um `uhs_id`)

- [ ] **Step 1: Dependencies installieren**

```bash
cd frontend && pnpm add @dnd-kit/core @dnd-kit/modifiers
```

Verifiziere: in `frontend/package.json` stehen `@dnd-kit/core` und `@dnd-kit/modifiers` unter `dependencies`.

- [ ] **Step 2: Typen ergänzen**

In `frontend/src/api/types.ts` ans **Ende** der Datei anhängen:

```typescript
// ============================== E‑3 Unfallhilfsstellen ==============================

export type UhsTyp =
  | 'patientenablage' | 'behandlungsplatz' | 'verletztensammelstelle'
  | 'bereitstellungsraum' | 'sonstige';

export type UhsStatus = 'geplant' | 'aktiv' | 'aufgeloest';

export type PlatzTyp =
  | 'wartebereich' | 'behandlungsplatz' | 'bett' | 'intensivplatz'
  | 'trage' | 'transport_bereitstellung' | 'sonstige';

export type Verfuegbarkeit = 'frei' | 'defekt' | 'aufbereitung' | 'gesperrt' | 'reserviert';

export type BelegungsArt = 'eintritt' | 'wechsel' | 'austritt';

export interface Uhs {
  id: number;
  einsatz_id: number;
  abschnitt_id: number | null;
  typ: UhsTyp;
  bezeichnung: string;
  standort: string | null;
  notiz: string | null;
  status: UhsStatus;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
}

export interface UhsPlatz {
  id: number;
  uhs_id: number;
  typ: PlatzTyp;
  bezeichnung: string;
  pos_x: number | null;
  pos_y: number | null;
  verfuegbarkeit: Verfuegbarkeit;
  reserviert_fuer_person_id: number | null;
  storniert_at: string | null;
}

export interface UhsBelegung {
  id: number;
  einsatz_id: number;
  person_id: number;
  uhs_id: number;
  platz_id: number | null;
  art: BelegungsArt;
  notiz: string | null;
  zeitpunkt_at: string;
  erfasst_von: number;
}

/** Detail-Antwort: UHS + Plätze + Belegungen + Material. */
export interface UhsDetail extends Uhs {
  plaetze: UhsPlatz[];
  belegungen: UhsBelegung[];
  material: EinsatzMaterial[];
}
```

UND `Person` um Cache-Felder erweitern (nach `aktueller_verbleib`):

```typescript
  // E‑3: UHS-Cache (null = nicht in UHS)
  aktuelle_uhs_id: number | null;
  aktueller_platz_id: number | null;
```

UND `EinsatzMaterial` um `uhs_id` erweitern (nach `einheit_id`):

```typescript
  /** E‑3: zugeordnete UHS (null = nicht verortet). */
  uhs_id: number | null;
```

- [ ] **Step 3: API-Client anlegen**

`frontend/src/api/einsatzUhs.ts`:

```typescript
import type {
  Uhs, UhsDetail, UhsPlatz, UhsBelegung,
  UhsTyp, UhsStatus, PlatzTyp, Verfuegbarkeit, BelegungsArt,
} from './types';
import { apiGet, apiSend } from './client';

// ---------- UHS ----------

export function listeUhs(einsatzId: number, status?: UhsStatus, abschnittId?: number): Promise<Uhs[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (abschnittId != null) params.set('abschnitt_id', String(abschnittId));
  const q = params.toString();
  return apiGet<Uhs[]>(`/api/einsaetze/${einsatzId}/uhs${q ? '?' + q : ''}`);
}

export function ladeUhs(einsatzId: number, uhsId: number): Promise<UhsDetail> {
  return apiGet<UhsDetail>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`);
}

export interface UhsEingabe {
  typ: UhsTyp;
  bezeichnung: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function legeUhsAn(einsatzId: number, daten: UhsEingabe): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs`, 'POST', daten);
}

export interface UhsPatch {
  bezeichnung?: string;
  /** `null` = explizit löschen, undefined = unverändert. */
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
}

export function aktualisiereUhs(einsatzId: number, uhsId: number, daten: UhsPatch): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`, 'PATCH', daten);
}

export function setzeUhsStatus(einsatzId: number, uhsId: number, status: UhsStatus): Promise<Uhs> {
  return apiSend<Uhs>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/status`, 'POST', { status });
}

export function storniereUhs(einsatzId: number, uhsId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}`, 'DELETE');
}

// ---------- Plätze ----------

export interface PlatzEingabe {
  typ: PlatzTyp;
  bezeichnung: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export function legePlatzAn(einsatzId: number, uhsId: number, daten: PlatzEingabe): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(`/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze`, 'POST', daten);
}

export interface PlatzPatch {
  bezeichnung?: string;
  pos_x?: number | null;
  pos_y?: number | null;
}

export function aktualisierePlatz(
  einsatzId: number, uhsId: number, platzId: number, daten: PlatzPatch,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`,
    'PATCH', daten,
  );
}

export function setzePlatzVerfuegbarkeit(
  einsatzId: number, uhsId: number, platzId: number,
  verfuegbarkeit: Verfuegbarkeit, reserviertFuerPersonId?: number | null,
): Promise<UhsPlatz> {
  return apiSend<UhsPlatz>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}/verfuegbarkeit`,
    'POST', { verfuegbarkeit, reserviert_fuer_person_id: reserviertFuerPersonId ?? null },
  );
}

export function stornierePlatz(einsatzId: number, uhsId: number, platzId: number): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plaetze/${platzId}`, 'DELETE',
  );
}

// ---------- Belegung ----------

export interface BelegungEingabe {
  art: BelegungsArt;
  uhs_id?: number;        // erforderlich bei eintritt/wechsel
  platz_id?: number | null;
  notiz?: string | null;
}

export function aenderePersonBelegung(
  einsatzId: number, personId: number, daten: BelegungEingabe,
): Promise<UhsBelegung> {
  return apiSend<UhsBelegung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/uhs-belegung`,
    'POST', daten,
  );
}
```

- [ ] **Step 4: Material-API-Client erweitern**

In `frontend/src/api/einsatzMaterial.ts` den PATCH-Body-Typ um `uhs_id?: number | null` ergänzen (`null` = lösen).

- [ ] **Step 5: Typecheck**

Run: `cd frontend && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Tests-Smoke**

Run: `cd frontend && pnpm test`
Expected: PASS (keine neuen Tests; bestehende dürfen nicht brechen)

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/api/types.ts frontend/src/api/einsatzUhs.ts frontend/src/api/einsatzMaterial.ts
git commit -m "feat(fe): @dnd-kit-Deps + UHS-Typen + API-Client (E-3)"
```

---

## Task 16: Frontend — SSE-Hook `useUhsStream` + `UnfallhilfsstellenPage` Liste + Anlege-Flow

Hook abonniert den UHS-Stream und invalidiert UHS-Liste + (bei `person`-Event) Personen-Liste. Listen-View mit Status-Filter, Schnellanlage. Detail kommt in Tasks 17/18.

**Files:**
- Create: `frontend/src/etb/useUhsStream.ts`
- Create: `frontend/src/pages/UnfallhilfsstellenPage.tsx`
- Create: `frontend/src/pages/UnfallhilfsstellenPage.test.tsx`

- [ ] **Step 1: SSE-Hook**

`frontend/src/etb/useUhsStream.ts`:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den UHS-Kanal und invalidiert UHS-Liste (jedes `uhs`-Event) +
 *  Personen-Liste (jedes `person`-Event — Cache-Felder ändern sich). Trägt KEINE
 *  sensible Payload — Clients refetchen. */
export function useUhsStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/uhs/stream`);
    const resyncUhs = () => qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    const resyncPersonen = () => qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    const onLag = () => { resyncUhs(); resyncPersonen(); };
    quelle.addEventListener('uhs', resyncUhs);
    quelle.addEventListener('person', resyncPersonen);
    quelle.addEventListener('lagged', onLag);
    return () => {
      quelle.removeEventListener('uhs', resyncUhs);
      quelle.removeEventListener('person', resyncPersonen);
      quelle.removeEventListener('lagged', onLag);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```

- [ ] **Step 2: Listen-Seite + Anlege-Flow**

`frontend/src/pages/UnfallhilfsstellenPage.tsx`:

```typescript
import { Alert, App, Badge, Breadcrumb, Button, Drawer, Form, Input, Select, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { legeUhsAn, listeUhs, type UhsEingabe } from '../api/einsatzUhs';
import { ApiError } from '../api/client';
import { useUhsStream } from '../etb/useUhsStream';
import type { Uhs, UhsStatus, UhsTyp } from '../api/types';
import UhsDetailDrawer from './uhs/UhsDetailDrawer';

const UHS_TYP_LABEL: Record<UhsTyp, string> = {
  patientenablage: 'Patientenablage',
  behandlungsplatz: 'Behandlungsplatz',
  verletztensammelstelle: 'Verletztensammelstelle',
  bereitstellungsraum: 'Bereitstellungsraum',
  sonstige: 'Sonstige',
};

const STATUS_META: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

export default function UnfallhilfsstellenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useUhsStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({
    queryKey: ['einsatz-uhs', einsatzId],
    queryFn: () => listeUhs(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [anlegen, setAnlegen] = useState(false);
  const [form] = Form.useForm<UhsEingabe>();
  const [aktivId, setAktivId] = useState<number | null>(null);

  const ist_aktiv = einsatzQuery.data?.status === 'aktiv';
  const ist_beobachter = einsatzQuery.data?.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMut = useMutation({
    mutationFn: (daten: UhsEingabe) => legeUhsAn(einsatzId, daten),
    onSuccess: () => { message.success('UHS angelegt'); invalidate(); setAnlegen(false); form.resetFields(); },
    onError: fehler,
  });

  const spalten: TableColumnsType<Uhs> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', render: (b: string, u) =>
        <Button type="link" onClick={() => setAktivId(u.id)}>{b}</Button> },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => UHS_TYP_LABEL[t] },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => {
      const meta = STATUS_META[s];
      return <Tag color={meta.color}>{meta.label}</Tag>;
    }},
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || uhsQuery.isLoading) return <Spin />;
  if (einsatzQuery.error) return <Alert type="error" message="Einsatz konnte nicht geladen werden" />;

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
        { title: 'Unfallhilfsstellen' },
      ]} />
      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Unfallhilfsstellen</Typography.Title>
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>Neu</Button>
      </Space>
      <Table<Uhs>
        rowKey="id"
        dataSource={uhsQuery.data ?? []}
        columns={spalten}
        size="middle"
        pagination={false}
      />

      <Drawer
        title="Unfallhilfsstelle anlegen"
        open={anlegen}
        onClose={() => setAnlegen(false)}
        width={420}
        destroyOnHidden
      >
        <Form<UhsEingabe>
          form={form}
          layout="vertical"
          onFinish={(v) => anlegenMut.mutate(v)}
          initialValues={{ typ: 'behandlungsplatz' }}
        >
          <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
            <Select options={Object.entries(UHS_TYP_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}>
            <Input placeholder="z. B. BHP 50" />
          </Form.Item>
          <Form.Item label="Standort (optional)" name="standort">
            <Input placeholder="Adresse / Hinweis" />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={anlegenMut.isPending}>Anlegen</Button>
        </Form>
      </Drawer>

      {aktivId != null && (
        <UhsDetailDrawer
          einsatzId={einsatzId}
          uhsId={aktivId}
          schreibgeschuetzt={schreibgeschuetzt}
          onClose={() => setAktivId(null)}
        />
      )}
    </div>
  );
}
```

> **Hinweis:** `UhsDetailDrawer` wird in Task 17 angelegt. Damit dieser Task isoliert kompiliert, lege einen Stub an: `frontend/src/pages/uhs/UhsDetailDrawer.tsx` mit minimaler Implementierung (`<Drawer open onClose={onClose} />`).

- [ ] **Step 3: Stub-Detail-Drawer für Task 17**

`frontend/src/pages/uhs/UhsDetailDrawer.tsx`:

```typescript
import { Drawer } from 'antd';

interface Props {
  einsatzId: number;
  uhsId: number;
  schreibgeschuetzt: boolean;
  onClose: () => void;
}

/** Stub — volle Implementierung in Task 17/18 (Grundriss + Material + Bewegungen). */
export default function UhsDetailDrawer({ onClose }: Props) {
  return <Drawer title="UHS-Detail" open onClose={onClose} width={720} />;
}
```

- [ ] **Step 4: Komponententest für die Liste**

`frontend/src/pages/UnfallhilfsstellenPage.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import UnfallhilfsstellenPage from './UnfallhilfsstellenPage';
import { App as AntApp } from 'antd';

function einsatzAntwort(rolle: 'einsatzleitung' | 'beobachter' = 'einsatzleitung') {
  return {
    id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv',
    begonnen_at: '2026-05-28', abgeschlossen_at: null, abgeschlossen_von: null,
    einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-28',
    leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
    meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
    meine_rolle: rolle,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/unfallhilfsstellen']}>
          <Routes>
            <Route path="/einsaetze/:id/unfallhilfsstellen" element={<UnfallhilfsstellenPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>
  );
}

describe('UnfallhilfsstellenPage', () => {
  it('rendert die UHS-Liste mit Status-Badge', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        { id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
          bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null },
      ])),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('BHP 50')).toBeInTheDocument());
    expect(screen.getByText('Behandlungsplatz')).toBeInTheDocument();
    expect(screen.getByText('aktiv')).toBeInTheDocument();
  });

  it('Neu-Button ist disabled für Beobachter', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort('beobachter'))),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
    );
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Neu' });
    expect(btn).toBeDisabled();
  });

  it('Anlegen-Flow ruft POST und schließt den Drawer', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([])),
      http.post('/api/einsaetze/1/uhs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'patientenablage',
          bezeichnung: 'PA 1', standort: null, notiz: null, status: 'geplant',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
        }, { status: 201 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Neu' }));
    await userEvent.type(screen.getByPlaceholderText('z. B. BHP 50'), 'PA 1');
    // Typ-Select-Default 'behandlungsplatz' beibehalten oder ändern:
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(body).toMatchObject({ bezeichnung: 'PA 1' }));
  });
});
```

- [ ] **Step 5: Tests + Typecheck**

Run: `cd frontend && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/etb/useUhsStream.ts frontend/src/pages/UnfallhilfsstellenPage.tsx frontend/src/pages/UnfallhilfsstellenPage.test.tsx frontend/src/pages/uhs/UhsDetailDrawer.tsx
git commit -m "feat(fe): UHS-Stream-Hook + Liste + Anlege-Flow"
```

---

## Task 17: Frontend — Detail-Drawer mit Tab „Grundriss" + DnD

Drei-Tab-Drawer (Grundriss / Material / Bewegungen). Tab Grundriss enthält: links Inbox-Container, rechts absolut-positionierte Plätze, `@dnd-kit`-DnD für (a) Platz-Verschiebung im Grundriss (`pos_x`/`pos_y`-PATCH) und (b) Personen-Drop auf Inbox/Platz (`POST .../uhs-belegung`). Material und Bewegungen-Tabs in Task 18.

**Files:**
- Modify: `frontend/src/pages/uhs/UhsDetailDrawer.tsx` (volle Implementierung)
- Create: `frontend/src/pages/uhs/Grundriss.tsx`
- Create: `frontend/src/pages/uhs/PersonenOhneUhsSidebar.tsx`

- [ ] **Step 1: `UhsDetailDrawer` voll implementieren (3 Tabs, Stamm-Aktionen)**

`frontend/src/pages/uhs/UhsDetailDrawer.tsx`:

```typescript
import { Alert, App, Button, Descriptions, Drawer, Popconfirm, Space, Spin, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import type { UhsStatus } from '../../api/types';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';

const STATUS_LABEL: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

interface Props {
  einsatzId: number;
  uhsId: number;
  schreibgeschuetzt: boolean;
  onClose: () => void;
}

export default function UhsDetailDrawer({ einsatzId, uhsId, schreibgeschuetzt, onClose }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const detailQuery = useQuery({
    queryKey: ['einsatz-uhs-detail', einsatzId, uhsId],
    queryFn: () => ladeUhs(einsatzId, uhsId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhsId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const statusMut = useMutation({
    mutationFn: (status: UhsStatus) => setzeUhsStatus(einsatzId, uhsId, status),
    onSuccess: () => { message.success('Status gewechselt'); invalidate(); },
    onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereUhs(einsatzId, uhsId),
    onSuccess: () => { message.success('UHS storniert'); invalidate(); onClose(); },
    onError: fehler,
  });

  if (detailQuery.isLoading) return <Drawer open onClose={onClose} width={840}><Spin /></Drawer>;
  if (detailQuery.error || !detailQuery.data) {
    return <Drawer open onClose={onClose} width={840}>
      <Alert type="error" message="UHS konnte nicht geladen werden" />
    </Drawer>;
  }
  const uhs = detailQuery.data;

  return (
    <Drawer
      title={<Space>
        <span>{uhs.bezeichnung}</span>
        <Tag color={STATUS_LABEL[uhs.status].color}>{STATUS_LABEL[uhs.status].label}</Tag>
      </Space>}
      open
      onClose={onClose}
      width={840}
      extra={!schreibgeschuetzt && uhs.status === 'geplant' && (
        <Space>
          <Button type="primary" onClick={() => statusMut.mutate('aktiv')} loading={statusMut.isPending}>
            In Betrieb nehmen
          </Button>
          <Popconfirm title="UHS stornieren?" onConfirm={() => stornoMut.mutate()}>
            <Button danger>Stornieren</Button>
          </Popconfirm>
        </Space>
      )}
    >
      <Descriptions size="small" column={2}>
        <Descriptions.Item label="Typ">{uhs.typ}</Descriptions.Item>
        <Descriptions.Item label="Standort">{uhs.standort ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Notiz" span={2}>{uhs.notiz ?? '—'}</Descriptions.Item>
      </Descriptions>
      <Tabs
        defaultActiveKey="grundriss"
        items={[
          { key: 'grundriss', label: 'Grundriss',
            children: <Grundriss einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} /> },
          { key: 'material', label: 'Material',
            children: <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} /> },
          { key: 'bewegungen', label: 'Bewegungen',
            children: <BewegungenTab uhs={uhs} /> },
        ]}
      />
      {!schreibgeschuetzt && uhs.status === 'aktiv' && (
        <Space style={{ marginTop: 16 }}>
          <Popconfirm
            title="UHS auflösen?"
            description="Nur möglich, wenn keine Person mehr belegt ist."
            onConfirm={() => statusMut.mutate('aufgeloest')}
          >
            <Button danger>Auflösen</Button>
          </Popconfirm>
        </Space>
      )}
    </Drawer>
  );
}
```

> **Hinweis:** `MaterialTab` und `BewegungenTab` werden in Task 18 angelegt. Für Task 17 lege minimale Stubs an: jeweils nur `export default function … () { return null; }` in `frontend/src/pages/uhs/MaterialTab.tsx` und `BewegungenTab.tsx`.

- [ ] **Step 2: `Grundriss`-Komponente mit DnD**

`frontend/src/pages/uhs/Grundriss.tsx`:

```typescript
import { Alert, App, Button, Card, Dropdown, Popconfirm, Space, Tag, Typography } from 'antd';
import { DndContext, useDraggable, useDroppable, type DragEndEvent, KeyboardSensor, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  aenderePersonBelegung, aktualisierePlatz, legePlatzAn, setzePlatzVerfuegbarkeit, stornierePlatz,
} from '../../api/einsatzUhs';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { Person, UhsDetail, UhsPlatz, Verfuegbarkeit } from '../../api/types';
import PersonenOhneUhsSidebar from './PersonenOhneUhsSidebar';
import { ApiError } from '../../api/client';

const VERF_FARBE: Record<Verfuegbarkeit, string> = {
  frei: '#52c41a',
  defekt: '#ff4d4f',
  aufbereitung: '#faad14',
  gesperrt: '#bfbfbf',
  reserviert: '#1677ff',
};

interface PersonenkartenProps { person: Person | undefined; }
function Personenkarte({ person }: PersonenkartenProps) {
  if (!person) return null;
  const label = person.name ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}` : `${registrierAnzeige(person.registrier_nr)} · unbekannt`;
  return <Tag color="default" style={{ margin: 2 }}>{label}</Tag>;
}

interface PlatzKarteProps {
  platz: UhsPlatz;
  belegtVon: Person | undefined;
  schreibgeschuetzt: boolean;
  onVerfuegbarkeit: (v: Verfuegbarkeit) => void;
  onStorno: () => void;
}

function PlatzKarte({ platz, belegtVon, schreibgeschuetzt, onVerfuegbarkeit, onStorno }: PlatzKarteProps) {
  // Platz-Karte ist sowohl Drop-Target (Personen darauf droppen) als auch
  // Drag-Source (Layout-Verschiebung). Mit @dnd-kit beides am selben Knoten via useDraggable + useDroppable.
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: `platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id }, disabled: schreibgeschuetzt,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-platz-${platz.id}`, data: { kind: 'platz', platzId: platz.id, uhsId: platz.uhs_id },
  });
  const setRef = (n: HTMLDivElement | null) => { setDragRef(n); setDropRef(n); };
  const style: React.CSSProperties = {
    position: 'absolute',
    left: platz.pos_x ?? 10,
    top: platz.pos_y ?? 10,
    width: 140,
    border: `2px solid ${VERF_FARBE[platz.verfuegbarkeit]}`,
    background: isOver ? '#e6f4ff' : 'white',
    padding: 6,
    borderRadius: 4,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  const menu = {
    items: [
      { key: 'frei', label: 'als frei markieren' },
      { key: 'defekt', label: 'als defekt markieren' },
      { key: 'aufbereitung', label: 'als in Aufbereitung markieren' },
      { key: 'gesperrt', label: 'als gesperrt markieren' },
      { type: 'divider' as const },
      { key: 'storno', label: 'Platz löschen', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'storno') onStorno();
      else onVerfuegbarkeit(key as Verfuegbarkeit);
    },
  };
  return (
    <div ref={setRef} style={style} {...attributes} {...listeners}>
      <Typography.Text strong>{platz.bezeichnung}</Typography.Text>
      <div><Tag color={VERF_FARBE[platz.verfuegbarkeit]}>{platz.verfuegbarkeit}</Tag></div>
      <Personenkarte person={belegtVon} />
      {!schreibgeschuetzt && (
        <Dropdown menu={menu} trigger={['click']}>
          <Button size="small" type="text">…</Button>
        </Dropdown>
      )}
    </div>
  );
}

function InboxContainer({ personen, schreibgeschuetzt }: { personen: Person[]; schreibgeschuetzt: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-inbox', data: { kind: 'inbox' } });
  return (
    <Card
      title="Inbox (Eingang)"
      size="small"
      style={{ width: 220, minHeight: 400, background: isOver ? '#e6f4ff' : undefined }}
    >
      <div ref={setNodeRef} style={{ minHeight: 300 }}>
        {personen.map((p) => <PersonenkarteDrag key={p.id} person={p} disabled={schreibgeschuetzt} />)}
        {personen.length === 0 && <Typography.Text type="secondary">leer</Typography.Text>}
      </div>
    </Card>
  );
}

function PersonenkarteDrag({ person, disabled }: { person: Person; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `person-${person.id}`, data: { kind: 'person', personId: person.id }, disabled,
  });
  const style: React.CSSProperties = {
    cursor: disabled ? 'default' : 'grab',
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={style}>
      <Personenkarte person={person} />
    </div>
  );
}

export default function Grundriss({
  einsatzId, uhs, schreibgeschuetzt,
}: { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Sensors: PointerSensor mit 5px-Aktivierungsdistanz (sonst klickt jeder Click den Drag aus),
  // KeyboardSensor für Tests/Accessibility.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
    queryFn: () => listePersonen(einsatzId),
  });
  const personen = personenQuery.data ?? [];
  const personenInUhs = personen.filter((p) => p.aktuelle_uhs_id === uhs.id);
  const inboxPersonen = personenInUhs.filter((p) => p.aktueller_platz_id == null);
  function belegtAn(platzId: number): Person | undefined {
    return personenInUhs.find((p) => p.aktueller_platz_id === platzId);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhs.id] });
    qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const layoutMut = useMutation({
    mutationFn: ({ pid, pos_x, pos_y }: { pid: number; pos_x: number; pos_y: number }) =>
      aktualisierePlatz(einsatzId, uhs.id, pid, { pos_x, pos_y }),
    onSuccess: () => invalidate(), onError: fehler,
  });
  const belegMut = useMutation({
    mutationFn: ({ personId, platzId }: { personId: number; platzId: number | null }) => {
      const aktuell = personen.find((p) => p.id === personId);
      const art = aktuell?.aktuelle_uhs_id ? 'wechsel' : 'eintritt';
      return aenderePersonBelegung(einsatzId, personId, { art, uhs_id: uhs.id, platz_id: platzId });
    },
    onSuccess: () => invalidate(), onError: fehler,
  });
  const verfMut = useMutation({
    mutationFn: ({ platzId, verf }: { platzId: number; verf: Verfuegbarkeit }) =>
      setzePlatzVerfuegbarkeit(einsatzId, uhs.id, platzId, verf, null),
    onSuccess: () => invalidate(), onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: (platzId: number) => stornierePlatz(einsatzId, uhs.id, platzId),
    onSuccess: () => { message.success('Platz gelöscht'); invalidate(); }, onError: fehler,
  });

  function onDragEnd(event: DragEndEvent) {
    const { active, over, delta } = event;
    if (!over) return;
    const data = active.data.current as { kind: string; personId?: number; platzId?: number } | undefined;
    const target = over.data.current as { kind: string; platzId?: number } | undefined;
    if (!data || !target) return;
    // Person-Drop:
    if (data.kind === 'person' && data.personId != null) {
      if (target.kind === 'inbox') belegMut.mutate({ personId: data.personId, platzId: null });
      else if (target.kind === 'platz' && target.platzId != null) {
        belegMut.mutate({ personId: data.personId, platzId: target.platzId });
      }
      return;
    }
    // Platz-Verschiebung (drag platz, drop irgendwo → neue Position):
    if (data.kind === 'platz' && data.platzId != null) {
      const platz = uhs.plaetze.find((p) => p.id === data.platzId);
      if (!platz) return;
      const nx = (platz.pos_x ?? 10) + delta.x;
      const ny = (platz.pos_y ?? 10) + delta.y;
      layoutMut.mutate({ pid: data.platzId, pos_x: nx, pos_y: ny });
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <Space align="start">
        <InboxContainer personen={inboxPersonen} schreibgeschuetzt={schreibgeschuetzt} />
        <div style={{ position: 'relative', width: 520, height: 400, border: '1px dashed #d9d9d9', background: '#fafafa' }}>
          {uhs.plaetze.map((p) => (
            <PlatzKarte
              key={p.id}
              platz={p}
              belegtVon={belegtAn(p.id)}
              schreibgeschuetzt={schreibgeschuetzt}
              onVerfuegbarkeit={(v) => verfMut.mutate({ platzId: p.id, verf: v })}
              onStorno={() => stornoMut.mutate(p.id)}
            />
          ))}
          {uhs.plaetze.length === 0 && (
            <Typography.Text type="secondary" style={{ padding: 10, display: 'block' }}>
              Keine Plätze. Lege Plätze über das „+"-Menü an.
            </Typography.Text>
          )}
        </div>
        <PersonenOhneUhsSidebar
          personen={personen.filter((p) => p.aktuelle_uhs_id == null && !p.storniert_at)}
          schreibgeschuetzt={schreibgeschuetzt}
        />
      </Space>
      {!schreibgeschuetzt && (
        <NeuerPlatzKnopf einsatzId={einsatzId} uhsId={uhs.id} onSuccess={invalidate} />
      )}
    </DndContext>
  );
}

function NeuerPlatzKnopf({ einsatzId, uhsId, onSuccess }: { einsatzId: number; uhsId: number; onSuccess: () => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [bez, setBez] = useState('');
  const mut = useMutation({
    mutationFn: () => legePlatzAn(einsatzId, uhsId, { typ: 'bett', bezeichnung: bez }),
    onSuccess: () => { message.success('Platz angelegt'); setBez(''); setOpen(false); onSuccess(); },
    onError: (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });
  return (
    <Popconfirm
      title="Neuen Platz anlegen"
      description={
        <input value={bez} onChange={(e) => setBez(e.target.value)}
               placeholder="Bezeichnung (z. B. Bett 3)" autoFocus />
      }
      open={open}
      onOpenChange={setOpen}
      onConfirm={() => mut.mutate()}
      okButtonProps={{ disabled: !bez.trim() }}
    >
      <Button style={{ marginTop: 8 }}>+ Platz</Button>
    </Popconfirm>
  );
}
```

- [ ] **Step 3: Sidebar „Personen ohne UHS"**

`frontend/src/pages/uhs/PersonenOhneUhsSidebar.tsx`:

```typescript
import { Card, Tag, Typography } from 'antd';
import { useDraggable } from '@dnd-kit/core';
import type { Person } from '../../api/types';
import { registrierAnzeige } from '../../api/einsatzPerson';

function DragPerson({ person, disabled }: { person: Person; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `person-${person.id}`, data: { kind: 'person', personId: person.id }, disabled,
  });
  const label = person.name
    ? `${registrierAnzeige(person.registrier_nr)} · ${person.name}`
    : `${registrierAnzeige(person.registrier_nr)} · unbekannt`;
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
         style={{ cursor: disabled ? 'default' : 'grab', marginBottom: 4 }}>
      <Tag>{label}</Tag>
    </div>
  );
}

export default function PersonenOhneUhsSidebar({
  personen, schreibgeschuetzt,
}: { personen: Person[]; schreibgeschuetzt: boolean }) {
  return (
    <Card title="Personen ohne UHS" size="small" style={{ width: 220, minHeight: 400 }}>
      {personen.map((p) => <DragPerson key={p.id} person={p} disabled={schreibgeschuetzt} />)}
      {personen.length === 0 && <Typography.Text type="secondary">keine</Typography.Text>}
    </Card>
  );
}
```

- [ ] **Step 4: Stubs für MaterialTab/BewegungenTab (kommen in Task 18)**

`frontend/src/pages/uhs/MaterialTab.tsx`:
```typescript
import type { UhsDetail } from '../../api/types';
export default function MaterialTab(_: { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }) {
  return null; // Task 18
}
```

`frontend/src/pages/uhs/BewegungenTab.tsx`:
```typescript
import type { UhsDetail } from '../../api/types';
export default function BewegungenTab(_: { uhs: UhsDetail }) { return null; /* Task 18 */ }
```

- [ ] **Step 5: Komponententest Grundriss-Logik (onDragEnd direkt)**

Ergänzung in `frontend/src/pages/UnfallhilfsstellenPage.test.tsx`:

```typescript
import { fireEvent } from '@testing-library/react';

describe('Grundriss DnD', () => {
  it('öffnet Detail-Drawer und zeigt Tab „Grundriss"', async () => {
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzAntwort())),
      http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([
        { id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
          bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
          erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null },
      ])),
      http.get('/api/einsaetze/1/uhs/7', () => HttpResponse.json({
        id: 7, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
        bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
        erfasst_at: 'x', erfasst_von: 1, geaendert_at: 'x', geaendert_von: 1, storniert_at: null,
        plaetze: [{ id: 1, uhs_id: 7, typ: 'bett', bezeichnung: 'Bett 3',
                    pos_x: 100, pos_y: 50, verfuegbarkeit: 'frei',
                    reserviert_fuer_person_id: null, storniert_at: null }],
        belegungen: [], material: [],
      })),
      http.get('/api/einsaetze/1/personen', () => HttpResponse.json([])),
    );
    renderPage();
    await userEvent.click(await screen.findByText('BHP 50'));
    expect(await screen.findByText('Grundriss')).toBeInTheDocument();
    expect(await screen.findByText('Bett 3')).toBeInTheDocument();
  });
});
```

> **Hinweis Tests:** `@dnd-kit` Drag-Sequenzen mit `fireEvent`/`userEvent` sind in jsdom fragil (Pointer-Events nur teilweise unterstützt). Für CI reicht der Smoke-Test „Drawer rendert + Platz sichtbar". Falls du echte Drop-Logik testen willst, instrumentiere die `onDragEnd`-Funktion separat (in eigene Modul-Funktion auslagern + direkt aufrufen, ohne DnD-Layer).

- [ ] **Step 6: Tests + Typecheck**

Run: `cd frontend && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/uhs/UhsDetailDrawer.tsx frontend/src/pages/uhs/Grundriss.tsx frontend/src/pages/uhs/PersonenOhneUhsSidebar.tsx frontend/src/pages/uhs/MaterialTab.tsx frontend/src/pages/uhs/BewegungenTab.tsx frontend/src/pages/UnfallhilfsstellenPage.test.tsx
git commit -m "feat(fe): UHS-Detail-Drawer mit Grundriss-Tab + DnD + Personen-Sidebar"
```

---

## Task 18: Frontend — Tabs „Material" + „Bewegungen"

Material-Tab: Liste des an die UHS verorteten Materials + Aktion „Material zuordnen" (Auswahl aus disponiertem Material ohne UHS-Zuordnung) + „lösen". Bewegungen-Tab: chronologische Tabelle aller `person_uhs_belegung`-Events der UHS.

**Files:**
- Modify: `frontend/src/pages/uhs/MaterialTab.tsx`
- Modify: `frontend/src/pages/uhs/BewegungenTab.tsx`

- [ ] **Step 1: `MaterialTab` voll implementieren**

`frontend/src/pages/uhs/MaterialTab.tsx`:

```typescript
import { App, Button, Modal, Popconfirm, Select, Space, Table, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listeEinsatzMaterial, aktualisiereEinsatzMaterial } from '../../api/einsatzMaterial';
import type { EinsatzMaterial, UhsDetail } from '../../api/types';
import { ApiError } from '../../api/client';

interface Props { einsatzId: number; uhs: UhsDetail; schreibgeschuetzt: boolean }

export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [zuordnenOffen, setZuordnenOffen] = useState(false);
  const [auswahl, setAuswahl] = useState<number | null>(null);

  const alleQuery = useQuery({
    queryKey: ['einsatz-material', einsatzId],
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const alle = alleQuery.data ?? [];
  const verortet = alle.filter((m) => m.uhs_id === uhs.id);
  const freiVerortbar = alle.filter((m) => m.uhs_id == null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-material', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhs.id] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const zuordnenMut = useMutation({
    mutationFn: (emId: number) => aktualisiereEinsatzMaterial(einsatzId, emId, { uhs_id: uhs.id }),
    onSuccess: () => { message.success('Material zugeordnet'); invalidate(); setZuordnenOffen(false); setAuswahl(null); },
    onError: fehler,
  });
  const loesenMut = useMutation({
    mutationFn: (emId: number) => aktualisiereEinsatzMaterial(einsatzId, emId, { uhs_id: null }),
    onSuccess: () => { message.success('Material gelöst'); invalidate(); }, onError: fehler,
  });

  const spalten: TableColumnsType<EinsatzMaterial> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung' },
    { title: 'Kategorie', dataIndex: 'kategorie', render: (k: string | null) => k ?? '—' },
    { title: 'Menge', dataIndex: 'menge' },
    { title: 'Status', dataIndex: 'status' },
    { title: '', key: 'aktion', render: (_: unknown, m) => !schreibgeschuetzt && (
      <Popconfirm title="Material lösen?" onConfirm={() => loesenMut.mutate(m.id)}>
        <Button size="small" type="link">Lösen</Button>
      </Popconfirm>
    )},
  ];

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button disabled={schreibgeschuetzt} onClick={() => setZuordnenOffen(true)}>Material zuordnen</Button>
      </Space>
      <Table<EinsatzMaterial>
        rowKey="id"
        dataSource={verortet}
        columns={spalten}
        size="small"
        pagination={false}
      />
      <Modal
        title="Disponiertes Material zuordnen"
        open={zuordnenOffen}
        onCancel={() => { setZuordnenOffen(false); setAuswahl(null); }}
        onOk={() => auswahl != null && zuordnenMut.mutate(auswahl)}
        okText="Zuordnen"
        okButtonProps={{ disabled: auswahl == null }}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="Material wählen"
          value={auswahl ?? undefined}
          onChange={setAuswahl}
          options={freiVerortbar.map((m) => ({ value: m.id, label: `${m.bezeichnung} (×${m.menge})` }))}
        />
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: `BewegungenTab` voll implementieren**

`frontend/src/pages/uhs/BewegungenTab.tsx`:

```typescript
import { Table, Tag, type TableColumnsType } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listePersonen, registrierAnzeige } from '../../api/einsatzPerson';
import type { UhsBelegung, UhsDetail } from '../../api/types';

const ART_FARBE: Record<UhsBelegung['art'], string> = {
  eintritt: 'green', wechsel: 'blue', austritt: 'orange',
};

export default function BewegungenTab({ uhs }: { uhs: UhsDetail }) {
  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', uhs.einsatz_id],
    queryFn: () => listePersonen(uhs.einsatz_id),
  });
  const personenById = new Map((personenQuery.data ?? []).map((p) => [p.id, p]));

  const platzLabel = (pid: number | null) => {
    if (pid == null) return 'Inbox';
    const p = uhs.plaetze.find((x) => x.id === pid);
    return p?.bezeichnung ?? `#${pid}`;
  };

  const spalten: TableColumnsType<UhsBelegung> = [
    { title: 'Zeit', dataIndex: 'zeitpunkt_at' },
    { title: 'Person', dataIndex: 'person_id', render: (id: number) => {
      const p = personenById.get(id);
      return p ? registrierAnzeige(p.registrier_nr) : `#${id}`;
    }},
    { title: 'Art', dataIndex: 'art', render: (a: UhsBelegung['art']) => <Tag color={ART_FARBE[a]}>{a}</Tag> },
    { title: 'Platz', dataIndex: 'platz_id', render: (pid: number | null) => platzLabel(pid) },
    { title: 'Notiz', dataIndex: 'notiz', render: (n: string | null) => n ?? '—' },
  ];

  return (
    <Table<UhsBelegung>
      rowKey="id"
      dataSource={uhs.belegungen}
      columns={spalten}
      size="small"
      pagination={false}
    />
  );
}
```

- [ ] **Step 3: Test ergänzen — Material-Zuordnung + Bewegungen-Tabelle**

Optional in `UnfallhilfsstellenPage.test.tsx`: ein Test, der das Detail mit Bewegungs-Events lädt und prüft, dass die Tabelle den Eintrag anzeigt. Falls die DnD-Tests bereits ausreichen, kann das hier auch knapp gehalten werden.

- [ ] **Step 4: Tests + Typecheck**

Run: `cd frontend && pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/uhs/MaterialTab.tsx frontend/src/pages/uhs/BewegungenTab.tsx
git commit -m "feat(fe): UHS-Detail Tabs Material + Bewegungen"
```

---

## Task 19: Modul aktivieren + PROGRESS aktualisieren + Final-Regression

`modulRegistry`-Eintrag von `status: 'geplant'` auf `'fertig'` umstellen, in `App.tsx` `MODUL_ELEMENTE` den Eintrag `unfallhilfsstellen: <UnfallhilfsstellenPage />` ergänzen, PROGRESS auf erledigt.

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: `modulRegistry` umstellen**

In `frontend/src/einsatz/modulRegistry.ts` den `unfallhilfsstellen`-Eintrag von

```typescript
{ key: 'unfallhilfsstellen', kategorie: 'erfassung', label: 'Unfallhilfsstellen', icon: TbFirstAidKit, route: 'unfallhilfsstellen', status: 'geplant', beschreibung: 'Behandlungs-/Sammelstellen als Örtlichkeiten.' },
```

auf

```typescript
{ key: 'unfallhilfsstellen', kategorie: 'erfassung', label: 'Unfallhilfsstellen', icon: TbFirstAidKit, route: 'unfallhilfsstellen', status: 'fertig', beschreibung: 'Behandlungs-/Sammelstellen als Örtlichkeiten mit Plätzen, Belegung und Material.' },
```

- [ ] **Step 2: `App.tsx` ergänzen**

In `frontend/src/App.tsx` Import + `MODUL_ELEMENTE`-Eintrag ergänzen:

```typescript
import UnfallhilfsstellenPage from './pages/UnfallhilfsstellenPage';
// …
const MODUL_ELEMENTE: Record<string, ReactElement> = {
  etb: <EtbPage />,
  // … bisherige Einträge …
  personen: <PersonenPage />,
  unfallhilfsstellen: <UnfallhilfsstellenPage />,
};
```

- [ ] **Step 3: PROGRESS aktualisieren**

In `docs/superpowers/PROGRESS.md` in der Teilprojekt-3-Tabelle die E‑3-Zeile auf erledigt setzen:

```markdown
| E‑3 | **Unfallhilfsstellen** | Örtlichkeits-/Struktur-Stamm (Patientenablage, Behandlungsplatz, Verletztensammelstelle); Personen-Zuordnung | E‑1 | ✅ **DONE** — Plan `docs/superpowers/plans/2026-05-28-erfassung-unfallhilfsstellen.md` |
```

- [ ] **Step 4: Volle Backend-Regression**

Run: `cargo test`
Expected: PASS

- [ ] **Step 5: Volle Frontend-Regression**

Run: `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS

- [ ] **Step 6: Manueller Smoke-Test (Backend startet, Frontend baut)**

```bash
cargo run --bin lifeline-hub &
SERVER_PID=$!
cd frontend && pnpm build
kill $SERVER_PID
```

Erwartet: Backend startet ohne Migration-Fehler; Frontend-Build geht durch.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx docs/superpowers/PROGRESS.md
git commit -m "feat(fe): Unfallhilfsstellen-Modul aktivieren (Status fertig)"
```

- [ ] **Step 8: Abschluss-Commit (Plan markieren)**

Falls der Plan-File noch keinen Status-Hinweis am Anfang trägt: nichts weiter zu tun — PROGRESS.md ist die kanonische Quelle.

```bash
git log --oneline -20
```

Erwartet: Eine geschlossene Kette von ~19 sinntragenden Commits für E‑3.

---

## Selbst-Review (Plan ↔ Spec)

**Spec-Abdeckung:**
- ✅ UHS-Entity einsatz-scoped + Typ-Enum + Status-Maschine (Task 5/6/9)
- ✅ Optionale Abschnittszuordnung (Task 5/6)
- ✅ Benannte 1:1-Plätze + implizite Inbox (Task 8 — partieller Unique-Index in Migration 0029, Inbox-Tests in 8/14)
- ✅ Event-zentrisches Belegungs-Modell + Cache (Task 8)
- ✅ Status-Maschine UHS mit Belegungs-Vorbedingung (Task 5/6/9)
- ✅ Soft-Delete blockt bei Belegung (Task 6/14)
- ✅ Material-Verortung `einsatz_material.uhs_id` (Task 12)
- ✅ Pseudonyme ETB-Spur (Task 9 — Belegung; Cross-Modul-Wrapper)
- ✅ KEIN ETB für Verfügbarkeit/Material-Verortung (Task 9/12/14 ETB-Leak-Test)
- ✅ Schlankes Grundriss-Schema `pos_x`/`pos_y` (Migration 0028, Task 7/17)
- ✅ Verfügbarkeit getrennt von Belegung (Task 7)
- ✅ Auto-Aufbereitung nur, wenn vorher frei (Task 8, expliziter Asymmetrie-Test)
- ✅ Reservierte Person belegt direkt (Task 8 — `loese_eigene_reservierung_ein`)
- ✅ UHS-zu-UHS-Wechsel = ein `wechsel`-Event (Task 8/9 — single Insert in `wechsel`)
- ✅ Cross-Modul `uhs_auto_austritt` aus Status/Verbleib/Storno (Task 13/14)
- ✅ Routen vollständig (Task 9/10/11)
- ✅ SSE `uhs` + `person` (Task 9/11/16)
- ✅ Frontend-Modul „Unfallhilfsstellen" (Tasks 15–19)
- ✅ DnD-Grundriss mit `@dnd-kit` (Task 17)
- ✅ Personen-Sidebar „ohne UHS" (Task 17)
- ✅ Tabs Grundriss/Material/Bewegungen (Task 17/18)
- ✅ Berechtigung + Org-Isolation + Nachlauf (Task 9 nutzt `fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv`; HTTP-Test in 14)

**Kleine bewusste Abweichung von der Spec:**
- **Sidebar „Personen ohne UHS"** filtert nur auf `aktuelle_uhs_id == null && !storniert_at` (Task 17 — `PersonenOhneUhsSidebar`). Die Spec schreibt zusätzlich „Status `betroffen` (Default; per Filter erweiterbar)" vor. Begründung für die Abweichung: Im Anlege-Flow von E‑1 ist `erfasst` der typische Eingangs-Status, und das Status-erfasst→betroffen-Heben passiert beim ersten ETB-relevanten Schritt (Sichtung oder Belegung). Eine Status-Filterung in der Sidebar würde dieses Hebe-Verhalten kontraintuitiv machen ("die Person ist da, aber nicht in der Liste"). Falls die Spec-Form streng verlangt wird, in Task 17 den Filter um `&& p.status === 'betroffen'` ergänzen und einen Status-Select über der Sidebar als „Filter erweitern" anbieten.

**Bewusst ausgelassen (laut Spec):**
- Krankenhaus-Stamm (E‑2-Folge-Spec)
- T4 Lagekarte / Geo-Koordinaten
- UHS-Templates / `BHP 50`-Aufbauten
- Material-an-Platz (statt UHS)
- UHS-spezifische Leitung (eigener FK)
- Aufnahmebereitschaft (`offen`/`voll`)
- Listen-Lese-Audit auf UHS (Spec: bewusst weggelassen, keine sensiblen Inhalte)

**Risiko-Hotspots, die der ausführende Engineer beachten muss:**
1. **`sqlx`-Bind-Reihenfolge** bei `aktualisiere` (UHS + Platz + Material): gemischtes `?`/`?N` kann je nach `sqlx`-Version stolpern. Test in Step deckt das ab; bei Bedarf in zwei UPDATEs aufspalten.
2. **`material_repo::liste_je_uhs`** wird von Task 9 verwendet, aber erst in Task 12 implementiert — Reihenfolge beachten oder Stub anlegen (im Plan vermerkt).
3. **`@dnd-kit`-Tests in jsdom** sind fragil — Plan gibt explizit den Hinweis, eher die `onDragEnd`-Handler-Logik isoliert zu testen.
4. **Routen-Reihenfolge `/uhs/stream` vor `/uhs/{uid}`** — in Task 11 explizit dokumentiert.

