# K&M‑3 — Taktische Einheiten & Einsatzabschnitte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disponierte Kräfte zu taktischen Einheiten (Trupp/Staffel/Gruppe/Zug …) bündeln, in eine Führungskette (Über-/Unterstellung) und in einen Einsatzabschnitt-Baum gliedern — mit org-weitem Einheitstyp-Katalog, abgeleiteter Soll/Ist-Stärke und ETB-Historie.

**Architecture:** Drei neue einsatz-/org-scoped Domänen analog `src/fahrzeug/` und `src/personal/`: `src/einsatzabschnitt/` (Führungs-Baum), `src/einheit/` (Einheiten-Baum + Typ-Katalog + Mitgliedschaft). Mitgliedschaft ist eine exklusive FK-Spalte `einheit_id` an `einsatz_personal`/`einsatz_fahrzeug` (max. 1 Einheit je Kraft). Ist-Stärke aggregiert die Personal-Positionen der Mitglieder über das bestehende `Staerke::aus_positionen`; Soll kommt aus Einheit-Override oder Typ-Default. Auflösen läuft transaktional (Mitglieder freigeben, Unter-Knoten eine Ebene hochziehen). Frontend: zwei neue antd-Seiten (Baum links / Detail rechts) plus ein Stammdaten-Tab.

**Tech Stack:** Rust + axum + sqlx (SQLite, WAL), React + TypeScript + antd + @tanstack/react-query, MSW für FE-Tests.

---

## Gesetzte Entscheidungen (im Plan verbindlich, ergänzen die Spec-Offenpunkte)

- **ETB-Texte** (Quoting wie K&M‑2 mit `«…»`), jeweils `typ = etb::TYP_SYSTEM`:
  - Einheit bilden: `Einheit «{name}» gebildet`
  - Einheit auflösen: `Einheit «{name}» aufgelöst`
  - Abschnitt anlegen: `Abschnitt «{name}» angelegt`
  - Abschnitt auflösen: `Abschnitt «{name}» aufgelöst`
  - Personal zuordnen: `Einheit «{einheit}»: «{person}» zugeordnet`
  - Personal freigeben: `Einheit «{einheit}»: «{person}» freigegeben`
  - Fahrzeug zuordnen: `Einheit «{einheit}»: Fahrzeug «{funkrufname}» zugeordnet`
  - Fahrzeug freigeben: `Einheit «{einheit}»: Fahrzeug «{funkrufname}» freigegeben`
  - Führer setzen (vorher keiner): `Einheit «{einheit}»: Führer «{person}» gesetzt`
  - Führer wechseln: `Einheit «{einheit}»: Führer «{alt}» → «{neu}»`
  - Abschnitt zuordnen: `Einheit «{einheit}»: Abschnitt «{abschnitt}» zugeordnet`
  - Abschnittszuordnung aufheben: `Einheit «{einheit}»: Abschnittszuordnung aufgehoben`
  - Reine `name`/`sortier`-Korrekturen erzeugen **keinen** Eintrag.
- **Parent-Wechsel-Kaskade (Default-Abschnitt):** Das FE belegt `abschnitt_id` einer neuen Unter-Einheit beim **Anlegen** mit dem Abschnitt der Über-Einheit vor. Ein späterer Parent-Wechsel zieht den Abschnitt **nicht** automatisch nach (zwei unabhängige Referenzen, Spec-Entscheidung 3). Backend setzt nichts automatisch.
- **Frei-Kräfte-Picker:** Das FE filtert clientseitig über die bestehende `GET /api/einsaetze/{id}/personal`- bzw. `…/fahrzeuge`-Liste auf `einheit_id === null` — **kein** neuer Endpoint. Voraussetzung: `einheit_id` ist Teil dieser Anzeige-Objekte (Task 2).
- **`soll` ist `Option<Staerke>`** (Override gesetzt → Override; sonst Typ-Soll falls Typ + dessen Soll gesetzt; sonst `None`). Nur `ist` und `ist_kumuliert` sind immer `Staerke`.
- **Mitglieds-Repräsentation:** Leichte Member-Structs (`EinheitMitgliedPerson`/`EinheitMitgliedFahrzeug`) statt der vollen Dispo-Anzeige in `EinheitAnzeige`.

---

## File Structure

**Backend (neu):**
- `migrations/0014_einsatzabschnitt.sql`, `0015_einheit_typ.sql`, `0016_einsatz_einheit.sql`, `0017_einheit_mitgliedschaft.sql`
- `src/einsatzabschnitt/mod.rs` (Typen) + `src/einsatzabschnitt/repo.rs` (CRUD, Baum, Zyklen-Check, Auflösen)
- `src/einheit/mod.rs` (Typen + `EINHEIT_TYP_STARTLISTE`) + `src/einheit/repo.rs` (CRUD, Baum, Soll/Ist, Auflösen) + `src/einheit/typ_repo.rs` (Katalog) + `src/einheit/mitglied_repo.rs` (Zuordnen/Freigeben + Stärke-Aggregation)
- `src/routes/einsatzabschnitt.rs`, `src/routes/einsatz_einheit.rs`, `src/routes/einheit_typ.rs`

**Backend (geändert):**
- `src/lib.rs` (Module `einsatzabschnitt`, `einheit` registrieren), `src/routes/mod.rs`, `src/app.rs` (Routen), `src/auth/bootstrap.rs` (Typ-Seed), `src/personal/disposition_repo.rs` + `src/personal/mod.rs` (Spalte `einheit_id`), `src/fahrzeug/disposition_repo.rs` + `src/fahrzeug/mod.rs` (Spalte `einheit_id`)

**Frontend (neu):**
- `frontend/src/api/einheitTypen.ts`, `frontend/src/api/einsatzabschnitte.ts`, `frontend/src/api/einheiten.ts`
- `frontend/src/pages/EinheitenPage.tsx` (+ `.test.tsx`), `frontend/src/pages/EinsatzabschnittePage.tsx` (+ `.test.tsx`)
- `frontend/src/stammdaten/EinheitTypenTab.tsx` (+ `.test.tsx`)

**Frontend (geändert):**
- `frontend/src/api/types.ts` (neue Typen + `einheit_id`), `frontend/src/einsatz/modulRegistry.ts` (zwei Module `fertig`), `frontend/src/App.tsx`, `frontend/src/pages/StammdatenPage.tsx`

---

## Task 1: Migration `0014_einsatzabschnitt.sql` (Abschnitts-Baum)

**Files:**
- Create: `migrations/0014_einsatzabschnitt.sql`
- Test: `src/db.rs` (neue `#[tokio::test]` im bestehenden `mod tests`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0014_einsatzabschnitt.sql`:

```sql
-- Einsatzabschnitt-Baum (einsatzbezogen, Führungs-Gliederung). Selbstreferenz
-- ueber_abschnitt_id (NULL = oberste Ebene); Zyklen-Schutz app-seitig. leiter_id
-- referenziert eine disponierte Person desselben Einsatzes (optional). Name bewusst
-- NICHT eindeutig (zwei "Abschnitt Nord" auf verschiedenen Ebenen erlaubt).
CREATE TABLE einsatzabschnitt (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    ueber_abschnitt_id INTEGER REFERENCES einsatzabschnitt(id),
    name               TEXT NOT NULL,
    leiter_id          INTEGER REFERENCES einsatz_personal(id),
    bemerkung          TEXT,
    sortier            INTEGER NOT NULL DEFAULT 0,
    angelegt_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_einsatzabschnitt_einsatz ON einsatzabschnitt(einsatz_id);
```

- [ ] **Step 2: Schema-Test schreiben**

In `src/db.rs`, im `mod tests`, neue Funktion ergänzen:

```rust
#[tokio::test]
async fn einsatzabschnitt_migration_legt_tabelle_und_cascade_an() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool).await.unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    ).fetch_one(&pool).await.unwrap();

    // Oberste Ebene + Unterabschnitt.
    let oben: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, ueber_abschnitt_id, name) VALUES (?, ?, 'Nord-1')")
        .bind(einsatz).bind(oben).execute(&pool).await.unwrap();

    // sortier-Default 0, angelegt_at gesetzt.
    let (sortier, angelegt): (i64, String) = sqlx::query_as(
        "SELECT sortier, angelegt_at FROM einsatzabschnitt WHERE name = 'Nord'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(sortier, 0);
    assert!(!angelegt.is_empty());

    // CASCADE: Einsatz löschen entfernt die Abschnitte.
    sqlx::query("DELETE FROM einsatz WHERE id = ?").bind(einsatz).execute(&pool).await.unwrap();
    let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt").fetch_one(&pool).await.unwrap();
    assert_eq!(rest, 0, "CASCADE muss Abschnitte entfernen");
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::einsatzabschnitt_migration_legt_tabelle_und_cascade_an`
Expected: PASS (Migration wird von `test_pool` automatisch eingespielt).

- [ ] **Step 4: Commit**

```bash
git add migrations/0014_einsatzabschnitt.sql src/db.rs
git commit -m "feat(db): Migration 0014 einsatzabschnitt (Abschnitts-Baum)"
```

---

## Task 2: Migration `0015_einheit_typ.sql` (Einheitstyp-Katalog, org-weit)

**Files:**
- Create: `migrations/0015_einheit_typ.sql`
- Test: `src/db.rs` (neue `#[tokio::test]`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0015_einheit_typ.sql`:

```sql
-- Org-weiter, admin-pflegbarer Einheitstyp-Katalog mit optionaler Standard-Soll-
-- Stärke (F/UF/M; alle drei oder keiner). Soft-Delete via aktiv=0 (deaktivieren statt
-- löschen). Der CROSS-JOIN-Seed greift nur für bei Migrationszeit vorhandene Orgs;
-- neue Orgs seedet bootstrap_admin (EINHEIT_TYP_STARTLISTE — synchron halten!).
CREATE TABLE einheit_typ (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    label             TEXT NOT NULL,
    soll_fuehrer      INTEGER,
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    sortier           INTEGER NOT NULL DEFAULT 0,
    aktiv             INTEGER NOT NULL DEFAULT 1,
    UNIQUE(org_id, label)
);

INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier)
SELECT o.id, v.label, v.f, v.uf, v.m, v.sortier
FROM organisation o
CROSS JOIN (
    SELECT 'Trupp'    AS label, 0    AS f, 0    AS uf, 2    AS m, 10 AS sortier
    UNION ALL SELECT 'Staffel',  0,    1,    5,    20
    UNION ALL SELECT 'Gruppe',   0,    1,    8,    30
    UNION ALL SELECT 'Zug',      1,    3,    18,   40
    UNION ALL SELECT 'Sonstige', NULL, NULL, NULL, 50
) v;
```

- [ ] **Step 2: Schema-Test schreiben**

In `src/db.rs`, im `mod tests`:

```rust
#[tokio::test]
async fn einheit_typ_migration_constraints_und_nullable_soll() {
    let pool = test_pool().await;
    // Org NACH der Migration → Migrations-Seed greift NICHT (bootstrap seedet neue Orgs).
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool).await.unwrap();

    // Soll vollständig.
    sqlx::query("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18)")
        .execute(&pool).await.unwrap();
    // Soll komplett NULL (z. B. Sonstige).
    sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Sonstige')")
        .execute(&pool).await.unwrap();
    let (aktiv, sortier): (i64, i64) = sqlx::query_as(
        "SELECT aktiv, sortier FROM einheit_typ WHERE label = 'Sonstige'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!((aktiv, sortier), (1, 0), "aktiv-Default 1, sortier-Default 0");

    // UNIQUE(org_id, label).
    let dup = sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug')")
        .execute(&pool).await;
    assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::einheit_typ_migration_constraints_und_nullable_soll`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/0015_einheit_typ.sql src/db.rs
git commit -m "feat(db): Migration 0015 einheit_typ (Typ-Katalog mit Soll-Stärke)"
```

---

## Task 3: Migration `0016_einsatz_einheit.sql` (Einheiten-Baum)

**Files:**
- Create: `migrations/0016_einsatz_einheit.sql`
- Test: `src/db.rs` (neue `#[tokio::test]`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0016_einsatz_einheit.sql`:

```sql
-- Einheiten-Baum (einsatzbezogen). Zwei unabhängige optionale Referenzen:
-- abschnitt_id (wo die Einheit wirkt) und ueber_einheit_id (wem sie untersteht;
-- Selbstreferenz, Zyklen-Schutz app-seitig). typ_id verweist auf den Katalog.
-- fuehrer_id muss eine Person sein, deren einsatz_personal.einheit_id auf DIESE
-- Einheit zeigt (App-Validierung). Soll-Override (alle drei oder keiner); bei NULL
-- greift die Soll-Stärke des Typs.
CREATE TABLE einsatz_einheit (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id      INTEGER REFERENCES einsatzabschnitt(id),
    ueber_einheit_id  INTEGER REFERENCES einsatz_einheit(id),
    typ_id            INTEGER REFERENCES einheit_typ(id),
    name              TEXT NOT NULL,
    fuehrer_id        INTEGER REFERENCES einsatz_personal(id),
    soll_fuehrer      INTEGER,
    soll_unterfuehrer INTEGER,
    soll_mannschaft   INTEGER,
    bemerkung         TEXT,
    sortier           INTEGER NOT NULL DEFAULT 0,
    angelegt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    angelegt_von      INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_einheit_einsatz ON einsatz_einheit(einsatz_id);
```

- [ ] **Step 2: Schema-Test schreiben**

In `src/db.rs`, im `mod tests`:

```rust
#[tokio::test]
async fn einsatz_einheit_migration_referenzen_und_cascade() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool).await.unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    ).fetch_one(&pool).await.unwrap();
    let typ: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id",
    ).fetch_one(&pool).await.unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();

    // Einheit mit beiden Referenzen + Selbstreferenz (Unter-Einheit).
    let zug: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, abschnitt_id, typ_id, name) VALUES (?, ?, ?, '1. Zug') RETURNING id",
    ).bind(einsatz).bind(abschnitt).bind(typ).fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, ueber_einheit_id, name) VALUES (?, ?, 'Gruppe Florian 1')")
        .bind(einsatz).bind(zug).execute(&pool).await.unwrap();

    let (sortier, angelegt): (i64, String) = sqlx::query_as(
        "SELECT sortier, angelegt_at FROM einsatz_einheit WHERE name = '1. Zug'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(sortier, 0);
    assert!(!angelegt.is_empty());

    // CASCADE über Einsatz.
    sqlx::query("DELETE FROM einsatz WHERE id = ?").bind(einsatz).execute(&pool).await.unwrap();
    let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit").fetch_one(&pool).await.unwrap();
    assert_eq!(rest, 0, "CASCADE muss Einheiten entfernen");
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::einsatz_einheit_migration_referenzen_und_cascade`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/0016_einsatz_einheit.sql src/db.rs
git commit -m "feat(db): Migration 0016 einsatz_einheit (Einheiten-Baum)"
```

---

## Task 4: Migration `0017_einheit_mitgliedschaft.sql` (FK-Spalte, exklusiv)

**Files:**
- Create: `migrations/0017_einheit_mitgliedschaft.sql`
- Test: `src/db.rs` (neue `#[tokio::test]`)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0017_einheit_mitgliedschaft.sql`:

```sql
-- Mitgliedschaft = exklusiv (max. 1 Einheit je Kraft) über eine FK-Spalte direkt an
-- den Dispozeilen. NULL = freie, nicht zugeordnete Kraft. Kein ON DELETE (SQLite-Grenze
-- bei nachträglichem ADD COLUMN): das Freigeben beim Auflösen passiert explizit in einer
-- Repo-Transaktion.
ALTER TABLE einsatz_personal ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN einheit_id INTEGER REFERENCES einsatz_einheit(id);
```

- [ ] **Step 2: Schema-Test schreiben**

In `src/db.rs`, im `mod tests`:

```rust
#[tokio::test]
async fn einheit_mitgliedschaft_migration_fk_spalte_default_null() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool).await.unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    ).fetch_one(&pool).await.unwrap();

    // Neue Dispozeile: einheit_id ist standardmäßig NULL (freie Kraft).
    let ep: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();
    let einheit_id: Option<i64> = sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_personal WHERE id = ?",
    ).bind(ep).fetch_one(&pool).await.unwrap();
    assert_eq!(einheit_id, None);

    // Zuordnen auf eine Einheit funktioniert.
    let einheit: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
        .bind(einheit).bind(ep).execute(&pool).await.unwrap();

    // Auch an einsatz_fahrzeug existiert die Spalte.
    let ef: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
        .bind(einheit).bind(ef).execute(&pool).await.unwrap();
    let zuordnung: Option<i64> = sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_fahrzeug WHERE id = ?",
    ).bind(ef).fetch_one(&pool).await.unwrap();
    assert_eq!(zuordnung, Some(einheit));
}
```

- [ ] **Step 3: Test laufen lassen**

Run: `cargo test --lib db::tests::einheit_mitgliedschaft_migration_fk_spalte_default_null`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/0017_einheit_mitgliedschaft.sql src/db.rs
git commit -m "feat(db): Migration 0017 einheit_id an Dispozeilen (exklusive Mitgliedschaft)"
```

---

## Task 5: `einheit_id` in die bestehenden Dispo-Anzeigen aufnehmen (Regressionsschutz)

Die neue Spalte muss in den Anzeige-Objekten von Personal **und** Fahrzeug auftauchen, damit der Frei-Kräfte-Picker clientseitig filtern kann. Additiv (`Option<i64>`, Default `NULL`) — bestehende Tests bleiben grün.

**Files:**
- Modify: `src/personal/mod.rs` (Struct `EinsatzPersonalAnzeige`), `src/personal/disposition_repo.rs` (`Row`, `SELECT_AUFGELOEST`, `zu_anzeige`)
- Modify: `src/fahrzeug/mod.rs` (Struct `EinsatzFahrzeugAnzeige`), `src/fahrzeug/disposition_repo.rs` (`Row`, `SELECT_AUFGELOEST`, `zu_anzeige`)
- Modify: `frontend/src/api/types.ts` (`EinsatzPersonal`, `EinsatzFahrzeug`)
- Test: `src/personal/disposition_repo.rs` (neuer Test)

- [ ] **Step 1: Failing test — `einheit_id` wird ausgeliefert**

In `src/personal/disposition_repo.rs`, im `mod tests`, ergänzen:

```rust
#[tokio::test]
async fn einheit_id_wird_in_anzeige_geliefert() {
    let pool = crate::db::test_pool().await;
    let (benutzer, einsatz) = setup(&pool).await;
    let person = p_repo::anlegen(&pool, 1, p_daten("Thomas"), &[]).await.unwrap();
    let ep = disponiere_stamm(&pool, einsatz, 1, person.id, None, benutzer).await.unwrap();

    // Frisch disponiert → keiner Einheit zugeordnet.
    assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().einheit_id, None);

    // Direkt einer Einheit zuordnen (Mitglied-Repo kommt später; hier roh).
    let einheit: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
    ).bind(einsatz).fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
        .bind(einheit).bind(ep).execute(&pool).await.unwrap();
    assert_eq!(laden_anzeige(&pool, einsatz, ep, true).await.unwrap().einheit_id, Some(einheit));
}
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `cargo test --lib personal::disposition_repo::tests::einheit_id_wird_in_anzeige_geliefert`
Expected: FAIL — Feld `einheit_id` existiert nicht auf `EinsatzPersonalAnzeige`.

- [ ] **Step 3: `EinsatzPersonalAnzeige` erweitern**

In `src/personal/mod.rs`, im Struct `EinsatzPersonalAnzeige` nach `pub personal_id: Option<i64>,` ergänzen:

```rust
    /// Zugeordnete Einheit (K&M‑3); `None` = freie, nicht zugeordnete Kraft.
    pub einheit_id: Option<i64>,
```

- [ ] **Step 4: Repo-Row + SELECT + Mapping erweitern**

In `src/personal/disposition_repo.rs`:
- Im `const SELECT_AUFGELOEST` die Spalte `ep.einheit_id` in die Spaltenliste aufnehmen (z. B. direkt nach `ep.personal_id,`): `ep.personal_id, ep.einheit_id,`
- Im `struct Row` Feld ergänzen: `einheit_id: Option<i64>,`
- In `fn zu_anzeige` im `EinsatzPersonalAnzeige { … }` ergänzen: `einheit_id: row.einheit_id,`

- [ ] **Step 5: Test laufen lassen (grün)**

Run: `cargo test --lib personal::disposition_repo`
Expected: PASS (alle Personal-Dispo-Tests inkl. neuem).

- [ ] **Step 6: Fahrzeug-Anzeige analog erweitern**

In `src/fahrzeug/mod.rs`, im Struct `EinsatzFahrzeugAnzeige` nach `pub fahrzeug_id: Option<i64>,` ergänzen:

```rust
    /// Zugeordnete Einheit (K&M‑3); `None` = freie, nicht zugeordnete Kraft.
    pub einheit_id: Option<i64>,
```

In `src/fahrzeug/disposition_repo.rs`:
- `SELECT_AUFGELOEST`: `ef.fahrzeug_id, ef.einheit_id,` (Spalte ergänzen)
- `struct Row`: `einheit_id: Option<i64>,`
- `fn zu_anzeige`: `einheit_id: row.einheit_id,`

- [ ] **Step 7: Fahrzeug-Tests laufen lassen**

Run: `cargo test --lib fahrzeug::disposition_repo`
Expected: PASS (additives Feld bricht nichts).

- [ ] **Step 8: Frontend-Typen erweitern**

In `frontend/src/api/types.ts`:
- In `interface EinsatzPersonal` nach `personal_id: number | null;` ergänzen: `einheit_id: number | null;`
- In `interface EinsatzFahrzeug` nach `fahrzeug_id: number | null;` ergänzen: `einheit_id: number | null;`

- [ ] **Step 9: FE-Typecheck + Gesamttest Backend**

Run: `cd frontend && npm run build` (oder `npx tsc --noEmit`)
Expected: kein Typfehler.
Run: `cargo test --lib`
Expected: PASS (gesamte Lib grün — Regressionsschutz).

- [ ] **Step 10: Commit**

```bash
git add src/personal src/fahrzeug frontend/src/api/types.ts
git commit -m "feat: einheit_id in Personal-/Fahrzeug-Dispo-Anzeige (K&M-3 Vorbereitung)"
```

---

## Task 6: `einheit`-Modul-Skelett + `EinheitTyp`-Typen + `typ_repo` (Katalog-CRUD)

**Files:**
- Create: `src/einheit/mod.rs`, `src/einheit/typ_repo.rs`
- Modify: `src/lib.rs` (Modul `einheit` registrieren)
- Test: `src/einheit/typ_repo.rs` (`mod tests`)

- [ ] **Step 1: Modul registrieren + Typen + Startliste anlegen**

In `src/lib.rs` das neue Modul deklarieren — alphabetisch **vor** `pub mod einsatz;` (Zeile 8), da `einheit` < `einsatz`:

```rust
pub mod einheit;
```

Create `src/einheit/mod.rs`:

```rust
pub mod typ_repo;

use crate::staerke::Staerke;
use serde::Serialize;

/// Default-Einheitstyp-Katalog je neu angelegter Organisation
/// (label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier).
/// **Muss mit dem Seed in `migrations/0015_einheit_typ.sql` übereinstimmen.**
/// `None`-Soll = "alle drei leer" (z. B. Sonstige).
pub const EINHEIT_TYP_STARTLISTE: [(&str, Option<i64>, Option<i64>, Option<i64>, i64); 5] = [
    ("Trupp", Some(0), Some(0), Some(2), 10),
    ("Staffel", Some(0), Some(1), Some(5), 20),
    ("Gruppe", Some(0), Some(1), Some(8), 30),
    ("Zug", Some(1), Some(3), Some(18), 40),
    ("Sonstige", None, None, None, 50),
];

/// Einheitstyp-Katalog-Eintrag (org-weit), inkl. aufgelöster optionaler Soll-Stärke.
/// `aktiv` wird nicht serialisiert (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitTyp {
    pub id: i64,
    pub label: String,
    /// Standard-Soll-Stärke; `None`, wenn der Typ keine Soll-Stärke definiert.
    pub soll: Option<Staerke>,
    pub sortier: i64,
}
```

- [ ] **Step 2: Failing tests — Katalog-CRUD + nullable Soll**

Create `src/einheit/typ_repo.rs` mit nur den Tests (Implementierung folgt in Step 4):

```rust
use super::EinheitTyp;
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id).execute(pool).await.unwrap();
    }

    fn daten<'a>(label: &'a str, soll: Option<(i64, i64, i64)>, sortier: i64) -> TypDaten<'a> {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        TypDaten { label, soll_fuehrer: f, soll_unterfuehrer: u, soll_mannschaft: m, sortier }
    }

    #[tokio::test]
    async fn anlegen_liste_sortiert_nur_aktiv() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Zug", Some((1, 3, 18)), 40)).await.unwrap();
        anlegen(&pool, 1, daten("Trupp", Some((0, 0, 2)), 10)).await.unwrap();

        let liste = liste(&pool, 1).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].label, "Trupp", "nach sortier");
        assert_eq!(liste[0].soll, Some(Staerke::neu(0, 0, 2)));
        assert_eq!(liste[1].label, "Zug");
    }

    #[tokio::test]
    async fn soll_komplett_leer_ist_none() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Sonstige", None, 50)).await.unwrap();
        assert_eq!(t.soll, None);
    }

    #[tokio::test]
    async fn dublette_label_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Zug", None, 10)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("Zug", None, 20)).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Zug", Some((1, 3, 18)), 40)).await.unwrap();
        let neu = aktualisiere(&pool, 1, t.id, daten("Verstärkter Zug", None, 45)).await.unwrap();
        assert_eq!(neu.label, "Verstärkter Zug");
        assert_eq!(neu.soll, None);
        assert_eq!(neu.sortier, 45);
    }

    #[tokio::test]
    async fn deaktivieren_versteckt_und_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let t = anlegen(&pool, 1, daten("Zug", None, 40)).await.unwrap();
        deaktivieren(&pool, 1, t.id).await.unwrap();
        assert!(liste(&pool, 1).await.unwrap().is_empty(), "nicht mehr in der aktiven Liste");
        assert_eq!(laden(&pool, 1, t.id).await.unwrap().id, t.id, "laden ignoriert aktiv-Flag");
    }

    #[tokio::test]
    async fn fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let t = anlegen(&pool, 1, daten("Zug", None, 40)).await.unwrap();
        assert!(matches!(laden(&pool, 2, t.id).await.unwrap_err(), AppError::NotFound));
        assert!(matches!(
            aktualisiere(&pool, 2, t.id, daten("X", None, 0)).await.unwrap_err(),
            AppError::NotFound
        ));
    }
}
```

- [ ] **Step 3: Tests laufen lassen (rot)**

Run: `cargo test --lib einheit::typ_repo`
Expected: FAIL — `TypDaten`, `anlegen`, `liste`, `laden`, `aktualisiere`, `deaktivieren` nicht definiert.

- [ ] **Step 4: `typ_repo` implementieren**

In `src/einheit/typ_repo.rs` **vor** dem `#[cfg(test)]`-Block einfügen:

```rust
/// Editierbare Katalog-Felder. Soll-Werte folgen der Regel „alle drei oder keiner"
/// (im Handler über `Staerke::aus_optionen` validiert).
#[derive(Debug)]
pub struct TypDaten<'a> {
    pub label: &'a str,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub sortier: i64,
}

/// Roh-Zeile aus der Tabelle (Soll noch als drei Optionen).
#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    label: String,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    sortier: i64,
}

const SPALTEN: &str = "id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier";

/// Baut die Anzeige; Soll wird best-effort aus den drei Spalten zusammengesetzt
/// (gespeicherte Werte sind durch den Handler bereits konsistent).
fn zu_typ(row: Row) -> EinheitTyp {
    let soll = Staerke::aus_optionen(row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft)
        .unwrap_or(None);
    EinheitTyp { id: row.id, label: row.label, soll, sortier: row.sortier }
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict("Einheitstyp-Label ist bereits vorhanden".into()));
        }
    }
    Err(e.into())
}

/// Lädt einen Typ der Org; `NotFound` bei fremder/unbekannter id (ignoriert aktiv-Flag).
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<EinheitTyp, AppError> {
    sqlx::query_as::<_, Row>(&format!(
        "SELECT {SPALTEN} FROM einheit_typ WHERE id = ? AND org_id = ?"
    ))
    .bind(id).bind(org_id)
    .fetch_optional(pool).await?
    .map(zu_typ)
    .ok_or(AppError::NotFound)
}

/// Nur aktive Typen der Org, sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<EinheitTyp>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "SELECT {SPALTEN} FROM einheit_typ WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    ))
    .bind(org_id)
    .fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_typ).collect())
}

/// Legt einen Typ an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(pool: &SqlitePool, org_id: i64, daten: TypDaten<'_>) -> Result<EinheitTyp, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id).bind(daten.label)
    .bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.sortier)
    .fetch_one(pool).await;
    let id = match ergebnis { Ok(id) => id, Err(e) => return label_conflict(e) };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound`/`Conflict` analog.
pub async fn aktualisiere(pool: &SqlitePool, org_id: i64, id: i64, daten: TypDaten<'_>) -> Result<EinheitTyp, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einheit_typ SET label = ?, soll_fuehrer = ?, soll_unterfuehrer = ?, \
                soll_mannschaft = ?, sortier = ? WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.sortier).bind(id).bind(org_id)
    .execute(pool).await;
    let resultat = match ergebnis { Ok(r) => r, Err(e) => return label_conflict(e) };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert einen Typ (Soft-Delete `aktiv = 0`); referenzierte Einheiten bleiben gültig.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query("UPDATE einheit_typ SET aktiv = 0 WHERE id = ? AND org_id = ?")
        .bind(id).bind(org_id)
        .execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Ob ein Typ mit dieser id zur Org gehört (POST/PATCH-Einheit-Validierung). Bewusst
/// **ohne** `aktiv`-Filter: ein deaktivierter Typ bleibt für bestehende Einheiten-
/// Referenzen gültig (Entscheidung 4), damit das PATCH einer Einheit, deren Typ
/// inzwischen deaktiviert wurde, nicht fehlschlägt. Die Auswahl *neuer* Typen filtert
/// das FE über `GET /api/einheit-typen` (nur aktive).
pub async fn ist_in_org(pool: &SqlitePool, org_id: i64, typ_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einheit_typ WHERE id = ? AND org_id = ?",
    )
    .bind(typ_id).bind(org_id)
    .fetch_optional(pool).await?;
    Ok(treffer.is_some())
}
```

- [ ] **Step 5: Tests laufen lassen (grün)**

Run: `cargo test --lib einheit::typ_repo`
Expected: PASS (alle 6 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/einheit/mod.rs src/einheit/typ_repo.rs
git commit -m "feat(be): einheit_typ-Katalog-Repo (CRUD, Soft-Delete, nullable Soll)"
```

---

## Task 7: Bootstrap seedet `einheit_typ` für neue Organisationen

**Files:**
- Modify: `src/auth/bootstrap.rs`
- Test: `src/auth/bootstrap.rs` (`mod tests`)

- [ ] **Step 1: Failing test — neue Org bekommt den Typ-Katalog**

In `src/auth/bootstrap.rs`, im `mod tests`:

```rust
#[tokio::test]
async fn seedet_einheit_typ_startliste_fuer_neue_org() {
    let pool = crate::db::test_pool().await;
    bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
    let labels: Vec<String> = sqlx::query_scalar(
        "SELECT label FROM einheit_typ ORDER BY sortier",
    ).fetch_all(&pool).await.unwrap();
    assert_eq!(labels.len(), 5, "fünf Default-Einheitstypen erwartet");
    assert_eq!(labels.first().map(String::as_str), Some("Trupp"));
    assert!(labels.contains(&"Zug".to_string()));

    // Zug hat die Soll-Stärke 1/3/18; Sonstige hat keine.
    let (zf, zu, zm): (Option<i64>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT soll_fuehrer, soll_unterfuehrer, soll_mannschaft FROM einheit_typ WHERE label = 'Zug'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!((zf, zu, zm), (Some(1), Some(3), Some(18)));
    let sonstige: (Option<i64>,) = sqlx::query_as(
        "SELECT soll_fuehrer FROM einheit_typ WHERE label = 'Sonstige'",
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(sonstige.0, None);
}
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `cargo test --lib auth::bootstrap::tests::seedet_einheit_typ_startliste_fuer_neue_org`
Expected: FAIL — `einheit_typ` ist leer (Bootstrap seedet noch nicht).

- [ ] **Step 3: Seed-Schleife einfügen**

In `src/auth/bootstrap.rs` den Import oben ergänzen:

```rust
use crate::einheit::EINHEIT_TYP_STARTLISTE;
```

In `bootstrap_admin`, innerhalb der Transaktion **vor** `tx.commit().await?;` (analog zu den anderen Seed-Schleifen) einfügen:

```rust
    for (label, f, u, m, sortier) in EINHEIT_TYP_STARTLISTE {
        sqlx::query(
            "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(f)
        .bind(u)
        .bind(m)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }
```

- [ ] **Step 4: Test laufen lassen (grün)**

Run: `cargo test --lib auth::bootstrap`
Expected: PASS (alle Bootstrap-Tests).

- [ ] **Step 5: Konsistenz-Test Startliste ↔ Migration-Seed**

In `src/einheit/mod.rs`, einen `#[cfg(test)] mod tests` mit Konsistenz-Check ergänzen (pinnt Länge + Soll-Regel, analog `personal/mod.rs:131`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startliste_konsistent() {
        assert_eq!(EINHEIT_TYP_STARTLISTE.len(), 5);
        // Jeder Eintrag hat alle drei Soll-Werte gesetzt ODER alle drei leer.
        for (_, f, u, m, _) in EINHEIT_TYP_STARTLISTE {
            let alle = f.is_some() && u.is_some() && m.is_some();
            let keiner = f.is_none() && u.is_none() && m.is_none();
            assert!(alle || keiner, "Soll muss vollständig oder leer sein");
        }
    }
}
```

Run: `cargo test --lib einheit::mod::tests::startliste_konsistent`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/bootstrap.rs src/einheit/mod.rs
git commit -m "feat(be): bootstrap seedet einheit_typ-Default für neue Orgs"
```

---

## Task 8: Routen `einheit_typ` (Admin-Katalog) + Registrierung

**Files:**
- Create: `src/routes/einheit_typ.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`
- Test: Integration in `src/routes/einheit_typ.rs` ist über `typ_repo`-Tests + Handler-Validierung abgedeckt; Org-Isolation/Admin-Gate werden über das Extractor-Muster (`AdminUser`) und org-scoped Repo-Queries garantiert. Handler-Validierungs-Unit-Test im Modul.

- [ ] **Step 1: Handler + Normalisierung schreiben**

Create `src/routes/einheit_typ.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einheit::typ_repo::{self, TypDaten};
use crate::einheit::EinheitTyp;
use crate::error::AppError;
use crate::staerke::Staerke;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TypBody {
    pub label: String,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    #[serde(default)]
    pub sortier: i64,
}

struct Normalisiert {
    label: String,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> TypDaten<'_> {
        TypDaten {
            label: &self.label,
            soll_fuehrer: self.soll_fuehrer,
            soll_unterfuehrer: self.soll_unterfuehrer,
            soll_mannschaft: self.soll_mannschaft,
            sortier: self.sortier,
        }
    }
}

/// Trimmt das Label und validiert die Soll-Regel „alle drei oder keiner" über
/// `Staerke::aus_optionen` (mappt String-Fehler auf `Validation`).
fn normalisiere(body: TypBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    // Validierung der Vollständigkeit/Bereiche; Rückgabewert verwerfen wir, wir
    // speichern die rohen Optionen (durch aus_optionen als konsistent bestätigt).
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft)
        .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        label,
        soll_fuehrer: body.soll_fuehrer,
        soll_unterfuehrer: body.soll_unterfuehrer,
        soll_mannschaft: body.soll_mannschaft,
        sortier: body.sortier,
    })
}

/// GET /api/einheit-typen — aktive Katalog-Einträge der eigenen Org (für Auswahl).
/// Alle eingeloggten Nutzer.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinheitTyp>>, AppError> {
    Ok(Json(typ_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/einheit-typen — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<TypBody>,
) -> Result<(StatusCode, Json<EinheitTyp>), AppError> {
    let n = normalisiere(body)?;
    let t = typ_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

/// PATCH /api/einheit-typen/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<TypBody>,
) -> Result<Json<EinheitTyp>, AppError> {
    let n = normalisiere(body)?;
    let t = typ_repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(t))
}

/// POST /api/einheit-typen/{id}/deaktivieren — Admin (Soft-Delete).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    typ_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(label: &str, soll: Option<(i64, i64, i64)>) -> TypBody {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        TypBody { label: label.into(), soll_fuehrer: f, soll_unterfuehrer: u, soll_mannschaft: m, sortier: 0 }
    }

    #[test]
    fn normalisiere_leeres_label_ist_validation() {
        assert!(matches!(normalisiere(body("   ", None)).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_teilweise_soll_ist_validation() {
        let mut b = body("Zug", None);
        b.soll_fuehrer = Some(1); // nur einer gesetzt
        assert!(matches!(normalisiere(b).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_vollstaendig_ok() {
        assert!(normalisiere(body("Zug", Some((1, 3, 18)))).is_ok());
        assert!(normalisiere(body("Sonstige", None)).is_ok());
    }
}
```

- [ ] **Step 2: Modul registrieren**

In `src/routes/mod.rs` alphabetisch ergänzen (zwischen `pub mod einsatz_personal;` und `pub mod etb;` passt `pub mod einheit_typ;` nicht alphabetisch — `einheit_typ` < `einsatz`, also **vor** `pub mod einsatz;`):

```rust
pub mod einheit_typ;
```

- [ ] **Step 3: Routen registrieren**

In `src/app.rs`, in `build_router`, bei den anderen `.route(...)`-Ketten ergänzen (z. B. nach den `fahrzeug-status`-Routen):

```rust
        .route("/api/einheit-typen", get(routes::einheit_typ::liste))
        .route("/api/einheit-typen", post(routes::einheit_typ::anlegen))
        .route("/api/einheit-typen/{id}", patch(routes::einheit_typ::aktualisieren))
        .route("/api/einheit-typen/{id}/deaktivieren", post(routes::einheit_typ::deaktivieren))
```

- [ ] **Step 4: Integrationstest `tests/einheit_typ.rs` (Bootstrap-Seed, Admin-Gate, Validierung)**

Create `tests/einheit_typ.rs` (Harness identisch zu `tests/fahrzeug_status.rs` — `setup`/`login_cookie`/`benutzer_anlegen`/`anfrage` hineinkopieren). Tests:

```rust
// (Harness wie tests/fahrzeug_status.rs: setup, login_cookie, benutzer_anlegen, anfrage)

#[tokio::test]
async fn bootstrap_seedet_einheit_typen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = json.as_array().unwrap().iter().map(|t| t["label"].as_str().unwrap()).collect();
    assert_eq!(labels.len(), 5);
    assert!(labels.contains(&"Zug"));
    // Zug hat Soll 1/3/18; Sonstige hat null.
    let zug = json.as_array().unwrap().iter().find(|t| t["label"] == "Zug").unwrap();
    assert_eq!(zug["soll"]["fuehrer"], 1);
    assert_eq!(zug["soll"]["mannschaft"], 18);
    let sonstige = json.as_array().unwrap().iter().find(|t| t["label"] == "Sonstige").unwrap();
    assert!(sonstige["soll"].is_null());
}

#[tokio::test]
async fn alle_lesen_nur_admin_legt_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", "/api/einheit-typen", &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &erika, Some(r#"{"label":"X"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &admin,
            Some(r#"{"label":"Verband","soll_fuehrer":3,"soll_unterfuehrer":9,"soll_mannschaft":40,"sortier":60}"#)).await.0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn teilweise_soll_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(&app, "POST", "/api/einheit-typen", &admin,
        Some(r#"{"label":"X","soll_fuehrer":1}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn dublette_label_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // 'Zug' existiert aus dem Seed.
    assert_eq!(
        anfrage(&app, "POST", "/api/einheit-typen", &admin, Some(r#"{"label":"Zug"}"#)).await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(&app, "POST", "/api/einheit-typen", &admin, Some(r#"{"label":"Reserve"}"#)).await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einheit-typen/{id}/deaktivieren"), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/einheit-typen", &admin, None).await;
    let labels: Vec<&str> = liste.as_array().unwrap().iter().map(|t| t["label"].as_str().unwrap()).collect();
    assert!(!labels.contains(&"Reserve"));
}
```

- [ ] **Step 5: Tests + Build laufen lassen**

Run: `cargo build`
Run: `cargo test --lib einheit_typ` (Handler-Unit-Tests `normalisiere`)
Run: `cargo test --test einheit_typ` (Integrationstests)
Expected: PASS, kein Compile-Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/routes/einheit_typ.rs tests/einheit_typ.rs src/routes/mod.rs src/app.rs
git commit -m "feat(be): Routen einheit-typen (Admin-Katalog-CRUD, Integrationstests)"
```

---

## Task 9: Frontend — `EinheitTyp`-Typ, API-Modul, Stammdaten-Tab „Einheitstypen"

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/einheitTypen.ts`, `frontend/src/stammdaten/EinheitTypenTab.tsx`, `frontend/src/stammdaten/EinheitTypenTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: Typ ergänzen**

In `frontend/src/api/types.ts` nach `interface PersonalStatus { … }` ergänzen:

```ts
/** Einheitstyp-Katalog-Eintrag (org-weit) mit optionaler Standard-Soll-Stärke. */
export interface EinheitTyp {
  id: number;
  label: string;
  /** null, wenn der Typ keine Soll-Stärke definiert (z. B. „Sonstige"). */
  soll: Staerke | null;
  sortier: number;
}
```

- [ ] **Step 2: API-Modul schreiben**

Create `frontend/src/api/einheitTypen.ts`:

```ts
import type { EinheitTyp } from './types';
import { apiGet, apiSend } from './client';

export interface TypEingabe {
  label: string;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  sortier: number;
}

export function listeEinheitTypen(): Promise<EinheitTyp[]> {
  return apiGet<EinheitTyp[]>('/api/einheit-typen');
}

export function legeTypAn(daten: TypEingabe): Promise<EinheitTyp> {
  return apiSend<EinheitTyp>('/api/einheit-typen', 'POST', daten);
}

export function aktualisiereTyp(id: number, daten: TypEingabe): Promise<EinheitTyp> {
  return apiSend<EinheitTyp>(`/api/einheit-typen/${id}`, 'PATCH', daten);
}

export function deaktiviereTyp(id: number): Promise<void> {
  return apiSend<void>(`/api/einheit-typen/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 3: Failing test — Tab zeigt Liste + Admin-Gate**

Create `frontend/src/stammdaten/EinheitTypenTab.test.tsx`. Muster **identisch** zu `StatusKatalogTab.test.tsx`: echter `<AuthProvider>` + gemocktes `/api/auth/me` (kein `vi.mock` von `useAuth`).

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinheitTypenTab from './EinheitTypenTab';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-26 10:00:00',
};
const nichtAdmin = { ...admin, system_rolle: 'keiner' };

const typen = [
  { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
  { id: 2, label: 'Sonstige', soll: null, sortier: 50 },
];

function render(benutzer: typeof admin) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(benutzer)),
    http.get('/api/einheit-typen', () => HttpResponse.json(typen)),
  );
  return renderMitProviders(
    <AuthProvider>
      <EinheitTypenTab />
    </AuthProvider>,
  );
}

describe('EinheitTypenTab', () => {
  it('zeigt Typen mit Soll-Stärke und „—" bei fehlender Soll', async () => {
    render(nichtAdmin);
    expect(await screen.findByText('Zug')).toBeInTheDocument();
    expect(screen.getByText('1/3/18/22')).toBeInTheDocument();
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  it('Admin sieht „Typ anlegen"', async () => {
    render(admin);
    await screen.findByText('Zug');
    expect(screen.getByRole('button', { name: 'Typ anlegen' })).toBeInTheDocument();
  });

  it('Nicht-Admin sieht keine Schreib-Aktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Typ anlegen' })).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 4: Test laufen lassen (rot)**

Run: `cd frontend && npx vitest run src/stammdaten/EinheitTypenTab.test.tsx`
Expected: FAIL — `EinheitTypenTab` existiert nicht.

- [ ] **Step 5: Tab-Komponente schreiben**

Create `frontend/src/stammdaten/EinheitTypenTab.tsx` (Muster aus `StatusKatalogTab.tsx`, Soll als drei `InputNumber`):

```tsx
import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, type TableColumnsType,
} from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen, type TypEingabe,
} from '../api/einheitTypen';
import type { EinheitTyp } from '../api/types';

interface FormWerte {
  label: string;
  soll_fuehrer?: number;
  soll_unterfuehrer?: number;
  soll_mannschaft?: number;
  sortier: number;
}

/** "F/UF/M/Gesamt" oder "—", wenn keine Soll-Stärke definiert ist. */
function sollAnzeige(t: EinheitTyp): string {
  if (!t.soll) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = t.soll;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}/${fuehrer + unterfuehrer + mannschaft}`;
}

export default function EinheitTypenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EinheitTyp | null>(null);

  const typenQuery = useQuery({ queryKey: ['einheit-typen'], queryFn: listeEinheitTypen });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: TypEingabe = {
        label: werte.label.trim(),
        soll_fuehrer: werte.soll_fuehrer ?? null,
        soll_unterfuehrer: werte.soll_unterfuehrer ?? null,
        soll_mannschaft: werte.soll_mannschaft ?? null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereTyp(bearbeite.id, daten) : legeTypAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['einheit-typen'] }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereTyp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['einheit-typen'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        soll_fuehrer: bearbeite.soll?.fuehrer,
        soll_unterfuehrer: bearbeite.soll?.unterfuehrer,
        soll_mannschaft: bearbeite.soll?.mannschaft,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<EinheitTyp> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Soll-Stärke (F/UF/M/Σ)', key: 'soll', render: (_, t) => sollAnzeige(t) },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, t: EinheitTyp) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(t); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Typ deaktivieren?" onConfirm={() => deaktivieren.mutate(t.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EinheitTyp>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Typ anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={typenQuery.isLoading}
        dataSource={typenQuery.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Kein Einheitstyp' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Typ bearbeiten' : 'Typ anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnClose
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Zug" />
          </Form.Item>
          <Form.Item label="Soll-Stärke (vollständig oder leer lassen)">
            <Space>
              <Form.Item name="soll_fuehrer" noStyle><InputNumber min={0} placeholder="Führer" /></Form.Item>
              <Form.Item name="soll_unterfuehrer" noStyle><InputNumber min={0} placeholder="Unterführer" /></Form.Item>
              <Form.Item name="soll_mannschaft" noStyle><InputNumber min={0} placeholder="Mannschaft" /></Form.Item>
            </Space>
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier"><InputNumber min={0} style={{ width: 120 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 6: Test laufen lassen (grün)**

Run: `cd frontend && npx vitest run src/stammdaten/EinheitTypenTab.test.tsx`
Expected: PASS (3 Tests).

- [ ] **Step 7: Tab in StammdatenPage einhängen**

In `frontend/src/pages/StammdatenPage.tsx`:
- Import ergänzen: `import EinheitTypenTab from '../stammdaten/EinheitTypenTab';`
- Im `items`-Array nach dem `personal-status`-Eintrag ergänzen:

```tsx
          { key: 'einheit-typen', label: 'Einheitstypen', children: <EinheitTypenTab /> },
```

- [ ] **Step 8: FE-Build + Stammdaten-Tests**

Run: `cd frontend && npm run build && npx vitest run src/stammdaten src/pages/StammdatenPage.test.tsx`
Expected: PASS (kein Typfehler, bestehende Stammdaten-Tests grün).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einheitTypen.ts frontend/src/stammdaten/EinheitTypenTab.tsx frontend/src/stammdaten/EinheitTypenTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab Einheitstypen (Admin-CRUD, Soll-Stärke)"
```

---

## Task 10: `einsatzabschnitt`-Modul — Typen + Repo (CRUD, Baum, Zyklen-Check, Auflösen)

**Files:**
- Create: `src/einsatzabschnitt/mod.rs`, `src/einsatzabschnitt/repo.rs`
- Modify: `src/lib.rs`
- Test: `src/einsatzabschnitt/repo.rs` (`mod tests`)

- [ ] **Step 1: Modul registrieren + Typen**

In `src/lib.rs` ergänzen — alphabetisch **nach** `pub mod einsatz;` (Zeile 8):

```rust
pub mod einsatzabschnitt;
```

Create `src/einsatzabschnitt/mod.rs`:

```rust
pub mod repo;

use serde::Serialize;

/// Aufgelöste Abschnitts-Anzeige (flach; der Baum wird im FE über
/// `ueber_abschnitt_id` gebaut), inkl. aufgelöstem Leiter-Namen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinsatzabschnittAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub ueber_abschnitt_id: Option<i64>,
    pub name: String,
    pub leiter_id: Option<i64>,
    /// Name der disponierten Leiter-Person (aufgelöst), falls gesetzt.
    pub leiter_name: Option<String>,
    pub bemerkung: Option<String>,
    pub sortier: i64,
}
```

- [ ] **Step 2: Failing tests — CRUD, Zyklen, Auflösen, Org-Isolation**

Create `src/einsatzabschnitt/repo.rs` mit Imports + Tests (Impl folgt in Step 4):

```rust
use super::EinsatzabschnittAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz; liefert einsatz_id.
    async fn setup(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap()
    }

    fn daten<'a>(name: &'a str, parent: Option<i64>, leiter: Option<i64>) -> AbschnittDaten<'a> {
        AbschnittDaten { name, ueber_abschnitt_id: parent, leiter_id: leiter, bemerkung: None, sortier: 0 }
    }

    #[tokio::test]
    async fn anlegen_und_liste_mit_baum_und_leiter() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        // Disponierte Person als Leiter.
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Abschnittsleiter Nord') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();

        let oben = anlegen(&pool, einsatz, daten("Nord", None, Some(ep))).await.unwrap();
        anlegen(&pool, einsatz, daten("Nord-1", Some(oben.id), None)).await.unwrap();

        let liste = liste(&pool, einsatz).await.unwrap();
        assert_eq!(liste.len(), 2);
        let nord = liste.iter().find(|a| a.name == "Nord").unwrap();
        assert_eq!(nord.leiter_name.as_deref(), Some("Abschnittsleiter Nord"));
        let unter = liste.iter().find(|a| a.name == "Nord-1").unwrap();
        assert_eq!(unter.ueber_abschnitt_id, Some(oben.id));
    }

    #[tokio::test]
    async fn parent_in_fremdem_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let fremder_abschnitt = anlegen(&pool, fremd, daten("Fremd-Nord", None, None)).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, daten("X", Some(fremder_abschnitt.id), None)).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn leiter_aus_fremdem_einsatz_ist_validation() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let fremder_ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Fremd') RETURNING id",
        ).bind(fremd).fetch_one(&pool).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, daten("Nord", None, Some(fremder_ep))).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn zyklus_direkt_und_transitiv_ist_validation() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let a = anlegen(&pool, einsatz, daten("A", None, None)).await.unwrap();
        let b = anlegen(&pool, einsatz, daten("B", Some(a.id), None)).await.unwrap();
        let c = anlegen(&pool, einsatz, daten("C", Some(b.id), None)).await.unwrap();

        // A unter sich selbst.
        assert!(matches!(
            aktualisiere(&pool, einsatz, a.id, daten("A", Some(a.id), None)).await.unwrap_err(),
            AppError::Validation(_)
        ));
        // A unter C (C ist Nachfahre von A) → transitiver Zyklus.
        assert!(matches!(
            aktualisiere(&pool, einsatz, a.id, daten("A", Some(c.id), None)).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn aufloesen_zieht_unterabschnitte_hoch_und_loest_einheit_zuordnung() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let oben = anlegen(&pool, einsatz, daten("Nord", None, None)).await.unwrap();
        let mitte = anlegen(&pool, einsatz, daten("Nord-Mitte", Some(oben.id), None)).await.unwrap();
        let unten = anlegen(&pool, einsatz, daten("Nord-Mitte-1", Some(mitte.id), None)).await.unwrap();

        // Eine Einheit ist dem mittleren Abschnitt zugeordnet.
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, abschnitt_id, name) VALUES (?, ?, 'Zug') RETURNING id",
        ).bind(einsatz).bind(mitte.id).fetch_one(&pool).await.unwrap();

        loese_auf(&pool, einsatz, mitte.id).await.unwrap();

        // 'unten' hängt jetzt direkt unter 'oben' (Parent des aufgelösten).
        let liste = liste(&pool, einsatz).await.unwrap();
        let unten_neu = liste.iter().find(|a| a.id == unten.id).unwrap();
        assert_eq!(unten_neu.ueber_abschnitt_id, Some(oben.id));
        // Der aufgelöste Abschnitt ist weg.
        assert!(liste.iter().all(|a| a.id != mitte.id));
        // Die Einheit ist nicht mehr zugeordnet.
        let abschnitt_id: Option<i64> = sqlx::query_scalar(
            "SELECT abschnitt_id FROM einsatz_einheit WHERE id = ?",
        ).bind(einheit).fetch_one(&pool).await.unwrap();
        assert_eq!(abschnitt_id, None);
    }

    #[tokio::test]
    async fn aktualisiere_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;
        let a = anlegen(&pool, einsatz, daten("A", None, None)).await.unwrap();
        assert!(matches!(
            aktualisiere(&pool, 999, a.id, daten("A", None, None)).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(loese_auf(&pool, 999, a.id).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 3: Tests laufen lassen (rot)**

Run: `cargo test --lib einsatzabschnitt::repo`
Expected: FAIL — `AbschnittDaten`, `anlegen`, `liste`, `aktualisiere`, `loese_auf` nicht definiert.

- [ ] **Step 4: Repo implementieren**

In `src/einsatzabschnitt/repo.rs` **vor** dem `#[cfg(test)]`-Block einfügen:

```rust
/// Editierbare Felder eines Abschnitts (bereits getrimmt/validiert durch den Handler,
/// hier zusätzlich auf Einsatz-Zugehörigkeit von parent/leiter geprüft).
#[derive(Debug)]
pub struct AbschnittDaten<'a> {
    pub name: &'a str,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<&'a str>,
    pub sortier: i64,
}

const SELECT_AUFGELOEST: &str = "\
    SELECT a.id, a.einsatz_id, a.ueber_abschnitt_id, a.name, a.leiter_id, \
           p.snap_name AS leiter_name, a.bemerkung, a.sortier \
    FROM einsatzabschnitt a \
    LEFT JOIN einsatz_personal p ON p.id = a.leiter_id";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    ueber_abschnitt_id: Option<i64>,
    name: String,
    leiter_id: Option<i64>,
    leiter_name: Option<String>,
    bemerkung: Option<String>,
    sortier: i64,
}

fn zu_anzeige(row: Row) -> EinsatzabschnittAnzeige {
    EinsatzabschnittAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        ueber_abschnitt_id: row.ueber_abschnitt_id,
        name: row.name,
        leiter_id: row.leiter_id,
        leiter_name: row.leiter_name,
        bemerkung: row.bemerkung,
        sortier: row.sortier,
    }
}

/// Alle Abschnitte eines Einsatzes (flach, aufgelöst), sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<EinsatzabschnittAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE a.einsatz_id = ? ORDER BY a.sortier, a.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt einen Abschnitt (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<EinsatzabschnittAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_AUFGELOEST} WHERE a.id = ? AND a.einsatz_id = ?"))
        .bind(id).bind(einsatz_id)
        .fetch_optional(pool).await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Abschnitt zum Einsatz gehört (für Parent-Validierung). `NotFound` sonst.
async fn pruefe_parent(pool: &SqlitePool, einsatz_id: i64, parent_id: i64) -> Result<(), AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
    ).bind(parent_id).bind(einsatz_id).fetch_optional(pool).await?;
    treffer.map(|_| ()).ok_or(AppError::NotFound)
}

/// Prüft, ob `leiter_id` eine disponierte Person *desselben* Einsatzes ist.
async fn pruefe_leiter(pool: &SqlitePool, einsatz_id: i64, leiter_id: i64) -> Result<(), AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    ).bind(leiter_id).bind(einsatz_id).fetch_optional(pool).await?;
    treffer.map(|_| ()).ok_or_else(|| AppError::Validation(
        "Abschnittsleiter muss eine disponierte Person des Einsatzes sein".into(),
    ))
}

/// Ob `kandidat` ein Nachfahre von `start` ist (oder `kandidat == start`): verhindert
/// Zyklen beim Setzen von `ueber_abschnitt_id = kandidat` für den Knoten `start`.
/// Läuft von `kandidat` nach oben; trifft er auf `start`, läge ein Zyklus vor.
async fn waere_zyklus(pool: &SqlitePool, start_id: i64, kandidat_parent: i64) -> Result<bool, AppError> {
    let mut aktuell = Some(kandidat_parent);
    // Begrenzung gegen korrupte Altdaten: Anzahl Knoten ist endlich.
    let mut schritte = 0;
    while let Some(id) = aktuell {
        if id == start_id {
            return Ok(true);
        }
        schritte += 1;
        if schritte > 10_000 {
            return Ok(true); // defensiv: bei Verdacht auf Zyklus abbrechen
        }
        aktuell = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT ueber_abschnitt_id FROM einsatzabschnitt WHERE id = ?",
        ).bind(id).fetch_optional(pool).await?.flatten();
    }
    Ok(false)
}

/// Validiert parent (selber Einsatz, zyklenfrei) und leiter (disponierte Person).
/// `self_id = None` beim Anlegen (kein Knoten zum Vergleichen).
async fn validiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    self_id: Option<i64>,
    daten: &AbschnittDaten<'_>,
) -> Result<(), AppError> {
    if let Some(parent) = daten.ueber_abschnitt_id {
        pruefe_parent(pool, einsatz_id, parent).await?;
        if let Some(sid) = self_id {
            if waere_zyklus(pool, sid, parent).await? {
                return Err(AppError::Validation(
                    "Abschnitt darf nicht eigener Vorfahr werden".into(),
                ));
            }
        }
    }
    if let Some(leiter) = daten.leiter_id {
        pruefe_leiter(pool, einsatz_id, leiter).await?;
    }
    Ok(())
}

/// Legt einen Abschnitt an (nach Validierung). Liefert die aufgelöste Anzeige.
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, daten: AbschnittDaten<'_>) -> Result<EinsatzabschnittAnzeige, AppError> {
    validiere(pool, einsatz_id, None, &daten).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatzabschnitt (einsatz_id, ueber_abschnitt_id, name, leiter_id, bemerkung, sortier) \
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.ueber_abschnitt_id).bind(daten.name)
    .bind(daten.leiter_id).bind(daten.bemerkung).bind(daten.sortier)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}

/// Vollersatz der editierbaren Felder (Parent-Wechsel zyklenfrei). `NotFound`,
/// falls der Abschnitt nicht zum Einsatz gehört.
pub async fn aktualisiere(pool: &SqlitePool, einsatz_id: i64, id: i64, daten: AbschnittDaten<'_>) -> Result<EinsatzabschnittAnzeige, AppError> {
    // Existenz im Einsatz sichern (auch für die self_id-Zyklenprüfung).
    laden(pool, einsatz_id, id).await?;
    validiere(pool, einsatz_id, Some(id), &daten).await?;
    let resultat = sqlx::query(
        "UPDATE einsatzabschnitt SET ueber_abschnitt_id = ?, name = ?, leiter_id = ?, \
                bemerkung = ?, sortier = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.ueber_abschnitt_id).bind(daten.name).bind(daten.leiter_id)
    .bind(daten.bemerkung).bind(daten.sortier).bind(id).bind(einsatz_id)
    .execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Löst einen Abschnitt auf (Transaktion): Unter-Abschnitte auf den Parent des
/// gelöschten hochziehen, zugeordnete Einheiten `abschnitt_id = NULL`, dann löschen.
/// `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    // Parent des aufzulösenden Knotens ermitteln (und Einsatz-Zugehörigkeit sichern).
    let parent: Option<i64> = sqlx::query_scalar(
        "SELECT ueber_abschnitt_id FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
    ).bind(id).bind(einsatz_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatzabschnitt SET ueber_abschnitt_id = ? WHERE ueber_abschnitt_id = ? AND einsatz_id = ?")
        .bind(parent).bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE abschnitt_id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 5: Tests laufen lassen (grün)**

Run: `cargo test --lib einsatzabschnitt::repo`
Expected: PASS (6 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/einsatzabschnitt/mod.rs src/einsatzabschnitt/repo.rs
git commit -m "feat(be): einsatzabschnitt-Repo (CRUD, Baum, Zyklen-Check, Auflösen)"
```

---

## Task 11: Routen `einsatzabschnitt` (Führung) + ETB + Registrierung

**Files:**
- Create: `src/routes/einsatzabschnitt.rs`, `tests/einsatzabschnitt.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`

Die Gating-Logik (`fordere_lesezugriff` / `fordere_schreibrecht` + `fordere_aktiv`) ist identisch zu `einsatz_personal.rs`. Getestet wird über das **etablierte Integrationstest-Harness** in `tests/` (eine Datei je Routen-Modul, `build_router` + `bootstrap_admin` + `login_cookie` + `oneshot`) — **nicht** über `mod tests` in der Route-Datei.

- [ ] **Step 1: Handler + ETB-Helfer schreiben**

Create `src/routes/einsatzabschnitt.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatzabschnitt::repo::{self as abschnitt_repo, AbschnittDaten};
use crate::einsatzabschnitt::EinsatzabschnittAnzeige;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie
/// `routes::einsatz_personal::etb_system`).
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

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/abschnitte — flache Liste (Baum baut das FE). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzabschnittAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(abschnitt_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AbschnittBody {
    pub name: String,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// POST /api/einsaetze/{id}/abschnitte — anlegen. Schreibrecht + aktiv. ETB-Eintrag.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AbschnittBody>,
) -> Result<(StatusCode, Json<EinsatzabschnittAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let anzeige = abschnitt_repo::anlegen(
        &state.pool, einsatz_id,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Abschnitt «{}» angelegt", anzeige.name)).await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid} — name/parent/leiter/bemerkung/sortier.
/// Kein ETB-Eintrag (reine Korrektur; Auflösen ist die sinntragende Aktion).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
    Json(body): Json<AbschnittBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let anzeige = abschnitt_repo::aktualisiere(
        &state.pool, einsatz_id, aid,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid} — auflösen (Reparenting). ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    abschnitt_repo::loese_auf(&state.pool, einsatz_id, aid).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Abschnitt «{}» aufgelöst", vorher.name)).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Integrationstest `tests/einsatzabschnitt.rs` (Gating + ETB + Org-Isolation)**

Create `tests/einsatzabschnitt.rs`. Es übernimmt das Harness aus `tests/einsatz_personal.rs` (Helfer `setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`, `einsatz_anlegen`, `rolle_setzen`, `person_anlegen` — diese hier mit hineinkopieren; das Projekt dupliziert das Harness bewusst je Testdatei).

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
    build_router(AppState { pool, live: LiveHub::new() })
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

async fn person_anlegen(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> i64 {
    // Stamm anlegen + in den Einsatz disponieren → liefert die einsatz_personal.id.
    let (s1, stamm) = anfrage(app, "POST", "/api/personal", admin, Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(s1, StatusCode::CREATED);
    let pid = stamm["id"].as_i64().unwrap();
    let (s2, dispo) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), admin,
        Some(&format!(r#"{{"personal_id":{pid}}}"#))).await;
    assert_eq!(s2, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system").count()
}

#[tokio::test]
async fn anlegen_schreibt_etb_und_liste_zeigt_abschnitt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin,
        Some(r#"{"name":"Nord"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Nord");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn leiter_setzen_und_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leiter = person_anlegen(&app, &admin, einsatz, "Leiter Nord").await;
    let (s, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin,
        Some(&format!(r#"{{"name":"Nord","leiter_id":{leiter}}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["leiter_name"], "Leiter Nord");
    let aid = json["id"].as_i64().unwrap();

    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/abschnitte/{aid}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // angelegt + aufgelöst = 2 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 2);
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &erika_c, Some(r#"{"name":"X"}"#)).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschliessen"), &admin, None).await;
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &admin, Some(r#"{"name":"X"}"#)).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Fremde Org B mit eigenem Admin (kein System-Admin auf Org A).
    // Bootstrap legt nur eine Org an; hier zweiten Nutzer OHNE Mitgliedschaft + ohne höhere Rolle.
    let fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let _ = fremd;
    let fremd_c = login_cookie(&app, "fremd", "fremdpw1").await;
    // Kein Mitglied, keine höhere Berechtigung → Forbidden bzw. NotFound.
    let status_get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/abschnitte"), &fremd_c, None).await.0;
    assert!(matches!(status_get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
    let status_post = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/abschnitte"), &fremd_c, Some(r#"{"name":"X"}"#)).await.0;
    assert!(matches!(status_post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND));
}
```

> **Hinweis für den Implementierer:** Der Org-Isolations-Test deckt die in [[cross-org-lesezugriff-luecke]] notierte Lücke ab — ein Nutzer **ohne** Mitgliedschaft und **ohne** höhere Berechtigung darf nichts sehen. Echte zwei Orgs erfordern mehr Bootstrap; der hier gewählte „fremde Nutzer derselben Org ohne Mitgliedschaft" prüft denselben Gate-Pfad (`fordere_lesezugriff` → `rolle = None`). Wenn ein Mehr-Org-Setup-Helfer existiert, gerne damit verschärfen.

- [ ] **Step 3: Modul + Routen registrieren**

In `src/routes/mod.rs` ergänzen — `einsatzabschnitt` alphabetisch **nach** `pub mod einsatz_personal;`:

```rust
pub mod einsatzabschnitt;
```

In `src/app.rs`, in `build_router`:

```rust
        .route("/api/einsaetze/{id}/abschnitte", get(routes::einsatzabschnitt::liste))
        .route("/api/einsaetze/{id}/abschnitte", post(routes::einsatzabschnitt::anlegen))
        .route("/api/einsaetze/{id}/abschnitte/{aid}", patch(routes::einsatzabschnitt::aktualisieren))
        .route("/api/einsaetze/{id}/abschnitte/{aid}", delete(routes::einsatzabschnitt::aufloesen))
```

- [ ] **Step 4: Tests + Build laufen lassen**

Run: `cargo build` (Compile inkl. neuer Routen)
Run: `cargo test --test einsatzabschnitt` (Integrationstests)
Run: `cargo test --lib einsatzabschnitt` (Repo-Tests bleiben grün)
Expected: PASS, kein Compile-Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/routes/einsatzabschnitt.rs tests/einsatzabschnitt.rs src/routes/mod.rs src/app.rs
git commit -m "feat(be): Routen einsatzabschnitte (CRUD, Auflösen, ETB, Gating, Org-Isolation)"
```

---

## Task 12: Einheiten-Anzeigetypen + `mitglied_repo` (Zuordnen/Freigeben, Exklusivität, Stärke)

**Files:**
- Modify: `src/einheit/mod.rs` (neue Typen + `pub mod mitglied_repo;`)
- Create: `src/einheit/mitglied_repo.rs`
- Test: `src/einheit/mitglied_repo.rs` (`mod tests`)

- [ ] **Step 1: Anzeigetypen + Modul deklarieren**

In `src/einheit/mod.rs` die Moduldeklarationen ergänzen (über `pub mod typ_repo;`):

```rust
pub mod mitglied_repo;
```

Und nach dem `EinheitTyp`-Struct ergänzen:

```rust
/// Personal-Mitglied einer Einheit (leichtgewichtig für die Einheiten-Anzeige).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitMitgliedPerson {
    /// `einsatz_personal.id` der Dispozeile.
    pub ep_id: i64,
    pub name: String,
    pub funktion: Option<String>,
    pub staerke_position: Option<String>,
    /// `true`, wenn diese Person als Führer der Einheit eingetragen ist.
    pub ist_fuehrer: bool,
}

/// Fahrzeug-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitMitgliedFahrzeug {
    /// `einsatz_fahrzeug.id` der Dispozeile.
    pub ef_id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
}

/// Aufgelöste Einheiten-Anzeige inkl. Typ/Abschnitt-Labels, Führer-Identität,
/// Mitgliedern und berechneter Stärke. `soll` ist optional (Override → Typ-Default →
/// `None`); `ist`/`ist_kumuliert` sind immer gesetzt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub abschnitt_name: Option<String>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub typ_label: Option<String>,
    pub name: String,
    pub fuehrer_id: Option<i64>,
    pub fuehrer_name: Option<String>,
    pub bemerkung: Option<String>,
    pub sortier: i64,
    pub soll: Option<crate::staerke::Staerke>,
    pub ist: crate::staerke::Staerke,
    pub ist_kumuliert: crate::staerke::Staerke,
    pub personal_mitglieder: Vec<EinheitMitgliedPerson>,
    pub fahrzeug_mitglieder: Vec<EinheitMitgliedFahrzeug>,
}
```

- [ ] **Step 2: Failing tests — Zuordnen, Wechsel, Freigeben, Führer-Kaskade, Ist-Stärke**

Create `src/einheit/mitglied_repo.rs` mit Imports + Tests (Impl folgt in Step 4):

```rust
use super::{EinheitMitgliedFahrzeug, EinheitMitgliedPerson};
use crate::error::AppError;
use crate::staerke::{Staerke, StaerkePosition};
use sqlx::SqlitePool;

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz + zwei Einheiten; liefert (einsatz, einheit_a, einheit_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let a: i64 = sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'A') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'B') RETURNING id")
            .bind(einsatz).fetch_one(pool).await.unwrap();
        (einsatz, a, b)
    }

    /// Disponiert eine Ad-hoc-Person mit Position; liefert ep_id.
    async fn person(pool: &SqlitePool, einsatz: i64, name: &str, position: Option<&str>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, staerke_position) VALUES (?, ?, ?) RETURNING id",
        ).bind(einsatz).bind(name).bind(position).fetch_one(pool).await.unwrap()
    }

    async fn einheit_von(pool: &SqlitePool, ep: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?").bind(ep).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn zuordnen_wechseln_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna", Some("mannschaft")).await;

        assert_eq!(ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap(), "Anna");
        assert_eq!(einheit_von(&pool, ep).await, Some(a));

        // Wechsel zu B: A verliert sie.
        ordne_personal_zu(&pool, einsatz, b, ep).await.unwrap();
        assert_eq!(einheit_von(&pool, ep).await, Some(b));

        // Freigeben.
        assert_eq!(gib_personal_frei(&pool, einsatz, b, ep).await.unwrap(), "Anna");
        assert_eq!(einheit_von(&pool, ep).await, None);
    }

    #[tokio::test]
    async fn freigeben_falscher_einheit_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Anna", None).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        // Freigeben aus B (gehört aber zu A) → NotFound.
        assert!(matches!(gib_personal_frei(&pool, einsatz, b, ep).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn freigeben_des_fuehrers_leert_fuehrer_id() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(ep).bind(a).execute(&pool).await.unwrap();

        gib_personal_frei(&pool, einsatz, a, ep).await.unwrap();
        let fuehrer: Option<i64> = sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?").bind(a).fetch_one(&pool).await.unwrap();
        assert_eq!(fuehrer, None, "Freigeben des Führer-Mitglieds muss fuehrer_id leeren");
    }

    #[tokio::test]
    async fn zuordnen_bereinigt_stale_fuehrer_in_alter_einheit() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, b) = setup(&pool).await;
        let ep = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(ep).bind(a).execute(&pool).await.unwrap();

        // Wechsel nach B → A darf keinen dangling Führer behalten.
        ordne_personal_zu(&pool, einsatz, b, ep).await.unwrap();
        let fuehrer_a: Option<i64> = sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?").bind(a).fetch_one(&pool).await.unwrap();
        assert_eq!(fuehrer_a, None);
    }

    #[tokio::test]
    async fn fremde_dispozeile_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let fremder_ep = person(&pool, fremd, "Fremd", None).await;
        assert!(matches!(ordne_personal_zu(&pool, einsatz, a, fremder_ep).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn ist_staerke_aggregiert_positionen_fahrzeuge_zaehlen_nicht() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        for (name, pos) in [("F", "fuehrer"), ("UF", "unterfuehrer"), ("M1", "mannschaft"), ("M2", "mannschaft")] {
            let ep = person(&pool, einsatz, name, Some(pos)).await;
            ordne_personal_zu(&pool, einsatz, a, ep).await.unwrap();
        }
        // Person ohne Position zählt nicht.
        let ohne = person(&pool, einsatz, "Ohne", None).await;
        ordne_personal_zu(&pool, einsatz, a, ohne).await.unwrap();
        // Ein Fahrzeug zuordnen — darf die Stärke nicht beeinflussen.
        let ef: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();
        ordne_fahrzeug_zu(&pool, einsatz, a, ef).await.unwrap();

        assert_eq!(ist_staerke(&pool, a).await.unwrap(), Staerke::neu(1, 1, 2));
    }

    #[tokio::test]
    async fn personal_mitglieder_markiert_fuehrer() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let chef = person(&pool, einsatz, "Chef", Some("fuehrer")).await;
        let mann = person(&pool, einsatz, "Mann", Some("mannschaft")).await;
        ordne_personal_zu(&pool, einsatz, a, chef).await.unwrap();
        ordne_personal_zu(&pool, einsatz, a, mann).await.unwrap();
        sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?").bind(chef).bind(a).execute(&pool).await.unwrap();

        let mitglieder = personal_mitglieder(&pool, a).await.unwrap();
        assert_eq!(mitglieder.len(), 2);
        assert!(mitglieder.iter().find(|m| m.ep_id == chef).unwrap().ist_fuehrer);
        assert!(!mitglieder.iter().find(|m| m.ep_id == mann).unwrap().ist_fuehrer);
    }

    #[tokio::test]
    async fn fahrzeug_zuordnen_und_freigeben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, a, _b) = setup(&pool).await;
        let ef: i64 = sqlx::query_scalar("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();
        assert_eq!(ordne_fahrzeug_zu(&pool, einsatz, a, ef).await.unwrap(), "Florian 1");
        assert_eq!(fahrzeug_mitglieder(&pool, a).await.unwrap().len(), 1);
        assert_eq!(gib_fahrzeug_frei(&pool, einsatz, a, ef).await.unwrap(), "Florian 1");
        assert!(fahrzeug_mitglieder(&pool, a).await.unwrap().is_empty());
    }
}
```

- [ ] **Step 3: Tests laufen lassen (rot)**

Run: `cargo test --lib einheit::mitglied_repo`
Expected: FAIL — Funktionen nicht definiert.

- [ ] **Step 4: `mitglied_repo` implementieren**

In `src/einheit/mitglied_repo.rs` **vor** dem `#[cfg(test)]`-Block einfügen:

```rust
/// Prüft, ob eine Einheit zum Einsatz gehört. `NotFound` sonst.
async fn pruefe_einheit(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Ordnet eine Personal-Dispozeile einer Einheit zu (exklusiv). Eine bereits andernorts
/// zugeordnete Kraft wechselt; war sie dort Führer, wird dieser Verweis bereinigt.
/// `NotFound`, falls Dispozeile oder Einheit nicht zum Einsatz gehören. Liefert den Namen.
pub async fn ordne_personal_zu(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ep_id: i64) -> Result<String, AppError> {
    pruefe_einheit(pool, einsatz_id, einheit_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    ).bind(ep_id).bind(einsatz_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    // Stale Führer-Verweis bereinigen (Person war evtl. anderswo Führer).
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE fuehrer_id = ? AND einsatz_id = ?")
        .bind(ep_id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(ep_id).bind(einsatz_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(name)
}

/// Gibt eine Personal-Dispozeile aus ihrer Einheit frei (`einheit_id = NULL`). War sie
/// Führer dieser Einheit, wird `fuehrer_id` geleert. `NotFound`, falls nicht zu dieser
/// Einheit gehörend. Liefert den Namen.
pub async fn gib_personal_frei(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ep_id: i64) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ? AND einheit_id = ?",
    ).bind(ep_id).bind(einsatz_id).bind(einheit_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE id = ? AND fuehrer_id = ?")
        .bind(einheit_id).bind(ep_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE id = ?")
        .bind(ep_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(name)
}

/// Ordnet ein Fahrzeug einer Einheit zu (exklusiv). `NotFound` analog. Liefert den Funkrufnamen.
pub async fn ordne_fahrzeug_zu(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ef_id: i64) -> Result<String, AppError> {
    pruefe_einheit(pool, einsatz_id, einheit_id).await?;
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    ).bind(ef_id).bind(einsatz_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(ef_id).bind(einsatz_id).execute(pool).await?;
    Ok(name)
}

/// Gibt ein Fahrzeug aus seiner Einheit frei. `NotFound`, falls nicht zu dieser Einheit.
pub async fn gib_fahrzeug_frei(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, ef_id: i64) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_funkrufname FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ? AND einheit_id = ?",
    ).bind(ef_id).bind(einsatz_id).bind(einheit_id).fetch_optional(pool).await?;
    let name = name.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = NULL WHERE id = ?")
        .bind(ef_id).execute(pool).await?;
    Ok(name)
}

#[derive(sqlx::FromRow)]
struct PersonRow {
    ep_id: i64,
    name: String,
    funktion: Option<String>,
    staerke_position: Option<String>,
    ist_fuehrer: i64,
}

/// Personal-Mitglieder einer Einheit; Position aufgelöst (Dispo-Override vor Stamm-Default),
/// `ist_fuehrer` markiert die als `fuehrer_id` eingetragene Person.
pub async fn personal_mitglieder(pool: &SqlitePool, einheit_id: i64) -> Result<Vec<EinheitMitgliedPerson>, AppError> {
    let rows = sqlx::query_as::<_, PersonRow>(
        "SELECT ep.id AS ep_id, ep.snap_name AS name, ep.snap_funktion AS funktion, \
                COALESCE(ep.staerke_position, p.staerke_position) AS staerke_position, \
                COALESCE(ep.id = e.fuehrer_id, 0) AS ist_fuehrer \
         FROM einsatz_personal ep \
         JOIN einsatz_einheit e ON e.id = ep.einheit_id \
         LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einheit_id = ? ORDER BY ep.id",
    ).bind(einheit_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| EinheitMitgliedPerson {
        ep_id: r.ep_id, name: r.name, funktion: r.funktion,
        staerke_position: r.staerke_position, ist_fuehrer: r.ist_fuehrer != 0,
    }).collect())
}

#[derive(sqlx::FromRow)]
struct FahrzeugRow { ef_id: i64, funkrufname: String, fahrzeugtyp: Option<String> }

/// Fahrzeug-Mitglieder einer Einheit (Snapshot-Funkrufname/-typ).
pub async fn fahrzeug_mitglieder(pool: &SqlitePool, einheit_id: i64) -> Result<Vec<EinheitMitgliedFahrzeug>, AppError> {
    let rows = sqlx::query_as::<_, FahrzeugRow>(
        "SELECT id AS ef_id, snap_funkrufname AS funkrufname, snap_fahrzeugtyp AS fahrzeugtyp \
         FROM einsatz_fahrzeug WHERE einheit_id = ? ORDER BY id",
    ).bind(einheit_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| EinheitMitgliedFahrzeug {
        ef_id: r.ef_id, funkrufname: r.funkrufname, fahrzeugtyp: r.fahrzeugtyp,
    }).collect())
}

/// Eigene Ist-Stärke einer Einheit: Aggregation der aufgelösten Personal-Positionen der
/// Mitglieder. Fahrzeuge zählen nicht in F/UF/M. Positionen ohne Wert werden ignoriert.
pub async fn ist_staerke(pool: &SqlitePool, einheit_id: i64) -> Result<Staerke, AppError> {
    let positionen: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(ep.staerke_position, p.staerke_position) \
         FROM einsatz_personal ep LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einheit_id = ?",
    ).bind(einheit_id).fetch_all(pool).await?;
    let iter = positionen.into_iter().flatten().filter_map(|s| StaerkePosition::parse(&s));
    Ok(Staerke::aus_positionen(iter))
}
```

- [ ] **Step 5: Tests laufen lassen (grün)**

Run: `cargo test --lib einheit::mitglied_repo`
Expected: PASS (8 Tests).

- [ ] **Step 6: Commit**

```bash
git add src/einheit/mod.rs src/einheit/mitglied_repo.rs
git commit -m "feat(be): einheit mitglied_repo (Zuordnen/Freigeben, Exklusivität, Ist-Stärke)"
```

---

## Task 13: `einheit/repo.rs` — CRUD, Baum, Zyklen, Soll-Resolution, Ist/Ist-kumuliert, Auflösen

**Files:**
- Modify: `src/einheit/mod.rs` (`pub mod repo;`)
- Create: `src/einheit/repo.rs`
- Test: `src/einheit/repo.rs` (`mod tests`)

- [ ] **Step 1: Modul deklarieren**

In `src/einheit/mod.rs` ergänzen (über `pub mod mitglied_repo;`):

```rust
pub mod repo;
```

- [ ] **Step 2: Failing tests — CRUD, Soll-Resolution, Führer-Regel, Zyklen, kumuliert, Auflösen**

Create `src/einheit/repo.rs` mit Imports + Tests (Impl folgt Step 4):

```rust
use super::{mitglied_repo, EinheitAnzeige};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz + ein Benutzer (angelegt_von); liefert (einsatz, benutzer).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar("INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1, 'U', 'u', 'h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (einsatz, benutzer)
    }

    fn daten<'a>(name: &'a str, typ: Option<i64>, abschnitt: Option<i64>, parent: Option<i64>, soll: Option<(i64, i64, i64)>) -> EinheitDaten<'a> {
        let (f, u, m) = match soll { Some((f, u, m)) => (Some(f), Some(u), Some(m)), None => (None, None, None) };
        EinheitDaten {
            name, abschnitt_id: abschnitt, ueber_einheit_id: parent, typ_id: typ,
            soll_fuehrer: f, soll_unterfuehrer: u, soll_mannschaft: m, bemerkung: None, sortier: 0,
        }
    }

    async fn ad_hoc_person(pool: &SqlitePool, einsatz: i64, name: &str, pos: &str) -> i64 {
        sqlx::query_scalar("INSERT INTO einsatz_personal (einsatz_id, snap_name, staerke_position) VALUES (?, ?, ?) RETURNING id")
            .bind(einsatz).bind(name).bind(pos).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn anlegen_loest_typ_und_abschnitt_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let abschnitt: i64 = sqlx::query_scalar("INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();

        let e = anlegen(&pool, einsatz, 1, daten("1. Zug", Some(typ), Some(abschnitt), None, None), b).await.unwrap();
        assert_eq!(e.typ_label.as_deref(), Some("Zug"));
        assert_eq!(e.abschnitt_name.as_deref(), Some("Nord"));
        // Kein Override → Soll kommt aus dem Typ.
        assert_eq!(e.soll, Some(Staerke::neu(1, 3, 18)));
        assert_eq!(e.ist, Staerke::neu(0, 0, 0));
    }

    #[tokio::test]
    async fn soll_override_schlaegt_typ_default_und_ohne_typ_ist_none() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        // Override 0/2/10 schlägt Typ-Default.
        let mit_override = anlegen(&pool, einsatz, 1, daten("Sonderzug", Some(typ), None, None, Some((0, 2, 10))), b).await.unwrap();
        assert_eq!(mit_override.soll, Some(Staerke::neu(0, 2, 10)));
        // Kein Typ, kein Override → None.
        let ohne = anlegen(&pool, einsatz, 1, daten("Freie Einheit", None, None, None, None), b).await.unwrap();
        assert_eq!(ohne.soll, None);
    }

    #[tokio::test]
    async fn typ_aus_fremder_org_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')").execute(&pool).await.unwrap();
        let fremd_typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label) VALUES (2, 'Zug') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, 1, daten("X", Some(fremd_typ), None, None, None), b).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn deaktivierter_typ_bleibt_beim_aktualisieren_gueltig() {
        // Entscheidung 4: ein deaktivierter Typ bleibt für bestehende Einheiten gültig.
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let e = anlegen(&pool, einsatz, 1, daten("1. Zug", Some(typ), None, None, None), b).await.unwrap();
        // Typ deaktivieren.
        crate::einheit::typ_repo::deaktivieren(&pool, 1, typ).await.unwrap();
        // PATCH (nur Name) muss trotzdem gelingen, Typ bleibt referenziert.
        let nachher = aktualisiere(&pool, einsatz, 1, e.id, daten("1. Zug umbenannt", Some(typ), None, None, None)).await.unwrap();
        assert_eq!(nachher.name, "1. Zug umbenannt");
        assert_eq!(nachher.typ_id, Some(typ));
    }

    #[tokio::test]
    async fn parent_in_fremdem_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id").fetch_one(&pool).await.unwrap();
        let fremd_einheit = anlegen(&pool, fremd, 1, daten("F", None, None, None, None), b).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, 1, daten("X", None, None, Some(fremd_einheit.id), None), b).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn zyklus_transitiv_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, 1, daten("A", None, None, None, None), b).await.unwrap();
        let c = anlegen(&pool, einsatz, 1, daten("B", None, None, Some(a.id), None), b).await.unwrap();
        let d = anlegen(&pool, einsatz, 1, daten("C", None, None, Some(c.id), None), b).await.unwrap();
        // A unter C (Nachfahre) → transitiver Zyklus.
        assert!(matches!(
            aktualisiere(&pool, einsatz, 1, a.id, daten("A", None, None, Some(d.id), None)).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn fuehrer_muss_mitglied_dieser_einheit_sein() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b).await.unwrap();
        let chef = ad_hoc_person(&pool, einsatz, "Chef", "fuehrer").await;
        // Noch nicht Mitglied → Validation.
        assert!(matches!(setze_fuehrer(&pool, einsatz, e.id, Some(chef)).await.unwrap_err(), AppError::Validation(_)));
        // Nach Zuordnung erlaubt.
        mitglied_repo::ordne_personal_zu(&pool, einsatz, e.id, chef).await.unwrap();
        setze_fuehrer(&pool, einsatz, e.id, Some(chef)).await.unwrap();
        assert_eq!(laden(&pool, einsatz, e.id).await.unwrap().fuehrer_id, Some(chef));
        // fuehrer_name aufgelöst.
        assert_eq!(laden(&pool, einsatz, e.id).await.unwrap().fuehrer_name.as_deref(), Some("Chef"));
    }

    #[tokio::test]
    async fn ist_kumuliert_summiert_unterstellte_rekursiv() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        // Zug → Gruppe → Trupp (3 Ebenen).
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b).await.unwrap();
        let gruppe = anlegen(&pool, einsatz, 1, daten("Gruppe", None, None, Some(zug.id), None), b).await.unwrap();
        let trupp = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, Some(gruppe.id), None), b).await.unwrap();
        // je Ebene ein Mannschafter.
        for (einheit, name) in [(zug.id, "Z"), (gruppe.id, "G"), (trupp.id, "T")] {
            let ep = ad_hoc_person(&pool, einsatz, name, "mannschaft").await;
            mitglied_repo::ordne_personal_zu(&pool, einsatz, einheit, ep).await.unwrap();
        }
        let zug_geladen = laden(&pool, einsatz, zug.id).await.unwrap();
        assert_eq!(zug_geladen.ist, Staerke::neu(0, 0, 1), "eigene Ist");
        assert_eq!(zug_geladen.ist_kumuliert, Staerke::neu(0, 0, 3), "eigene + Gruppe + Trupp");
        let gruppe_geladen = laden(&pool, einsatz, gruppe.id).await.unwrap();
        assert_eq!(gruppe_geladen.ist_kumuliert, Staerke::neu(0, 0, 2));
    }

    #[tokio::test]
    async fn aufloesen_gibt_mitglieder_frei_und_zieht_unter_einheiten_hoch() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b).await.unwrap();
        let gruppe = anlegen(&pool, einsatz, 1, daten("Gruppe", None, None, Some(zug.id), None), b).await.unwrap();
        let trupp = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, Some(gruppe.id), None), b).await.unwrap();
        let ep = ad_hoc_person(&pool, einsatz, "Mann", "mannschaft").await;
        mitglied_repo::ordne_personal_zu(&pool, einsatz, gruppe.id, ep).await.unwrap();

        loese_auf(&pool, einsatz, gruppe.id).await.unwrap();

        // Mitglied frei.
        let einheit_id: Option<i64> = sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?").bind(ep).fetch_one(&pool).await.unwrap();
        assert_eq!(einheit_id, None);
        // Trupp hängt jetzt direkt unter Zug.
        assert_eq!(laden(&pool, einsatz, trupp.id).await.unwrap().ueber_einheit_id, Some(zug.id));
        // Gruppe ist weg.
        assert!(matches!(laden(&pool, einsatz, gruppe.id).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 3: Tests laufen lassen (rot)**

Run: `cargo test --lib einheit::repo`
Expected: FAIL — `EinheitDaten`, `anlegen`, `laden`, `aktualisiere`, `setze_fuehrer`, `loese_auf` nicht definiert.

- [ ] **Step 4: Repo implementieren**

In `src/einheit/repo.rs` **vor** dem `#[cfg(test)]`-Block einfügen:

```rust
/// Editierbare Felder einer Einheit (Führer wird separat über `setze_fuehrer` gesetzt,
/// da er Mitgliedschaft voraussetzt und eine eigene ETB-Aktion ist).
#[derive(Debug)]
pub struct EinheitDaten<'a> {
    pub name: &'a str,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<&'a str>,
    pub sortier: i64,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    ueber_einheit_id: Option<i64>,
    typ_id: Option<i64>,
    typ_label: Option<String>,
    name: String,
    fuehrer_id: Option<i64>,
    fuehrer_name: Option<String>,
    bemerkung: Option<String>,
    sortier: i64,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    typ_soll_fuehrer: Option<i64>,
    typ_soll_unterfuehrer: Option<i64>,
    typ_soll_mannschaft: Option<i64>,
}

const SELECT_AUFGELOEST: &str = "\
    SELECT e.id, e.einsatz_id, e.abschnitt_id, ab.name AS abschnitt_name, \
           e.ueber_einheit_id, e.typ_id, t.label AS typ_label, e.name, \
           e.fuehrer_id, fp.snap_name AS fuehrer_name, e.bemerkung, e.sortier, \
           e.soll_fuehrer, e.soll_unterfuehrer, e.soll_mannschaft, \
           t.soll_fuehrer AS typ_soll_fuehrer, t.soll_unterfuehrer AS typ_soll_unterfuehrer, \
           t.soll_mannschaft AS typ_soll_mannschaft \
    FROM einsatz_einheit e \
    LEFT JOIN einheit_typ t ON t.id = e.typ_id \
    LEFT JOIN einsatzabschnitt ab ON ab.id = e.abschnitt_id \
    LEFT JOIN einsatz_personal fp ON fp.id = e.fuehrer_id";

/// Setzt die abgeleitete Anzeige aus Row + Mitgliedern + Stärke zusammen. `soll` ist
/// Override (falls vollständig) sonst Typ-Soll (falls vorhanden) sonst `None`.
async fn zu_anzeige(pool: &SqlitePool, row: Row) -> Result<EinheitAnzeige, AppError> {
    let override_soll = Staerke::aus_optionen(row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft).unwrap_or(None);
    let typ_soll = Staerke::aus_optionen(row.typ_soll_fuehrer, row.typ_soll_unterfuehrer, row.typ_soll_mannschaft).unwrap_or(None);
    let soll = override_soll.or(typ_soll);

    let ist = mitglied_repo::ist_staerke(pool, row.id).await?;
    let ist_kumuliert = ist_kumuliert(pool, row.einsatz_id, row.id).await?;
    let personal_mitglieder = mitglied_repo::personal_mitglieder(pool, row.id).await?;
    let fahrzeug_mitglieder = mitglied_repo::fahrzeug_mitglieder(pool, row.id).await?;

    Ok(EinheitAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        abschnitt_id: row.abschnitt_id,
        abschnitt_name: row.abschnitt_name,
        ueber_einheit_id: row.ueber_einheit_id,
        typ_id: row.typ_id,
        typ_label: row.typ_label,
        name: row.name,
        fuehrer_id: row.fuehrer_id,
        fuehrer_name: row.fuehrer_name,
        bemerkung: row.bemerkung,
        sortier: row.sortier,
        soll,
        ist,
        ist_kumuliert,
        personal_mitglieder,
        fahrzeug_mitglieder,
    })
}

/// Kumulierte Ist-Stärke: eigene + alle unterstellten Einheiten (rekursiv). Cycle-sicher
/// über ein Visited-Set (schützt vor korrupten Altdaten). Dünner Wrapper über
/// `mitglied_repo::ist_staerke` — keine neue Stärke-Logik.
async fn ist_kumuliert(pool: &SqlitePool, einsatz_id: i64, wurzel_id: i64) -> Result<Staerke, AppError> {
    let kanten: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT id, ueber_einheit_id FROM einsatz_einheit WHERE einsatz_id = ?",
    ).bind(einsatz_id).fetch_all(pool).await?;
    let mut kinder: HashMap<i64, Vec<i64>> = HashMap::new();
    for (id, parent) in &kanten {
        if let Some(p) = parent {
            kinder.entry(*p).or_default().push(*id);
        }
    }
    let mut summe = Staerke::neu(0, 0, 0);
    let mut stack = vec![wurzel_id];
    let mut besucht: HashSet<i64> = HashSet::new();
    while let Some(id) = stack.pop() {
        if !besucht.insert(id) {
            continue;
        }
        let s = mitglied_repo::ist_staerke(pool, id).await?;
        summe = Staerke::neu(
            summe.fuehrer.saturating_add(s.fuehrer),
            summe.unterfuehrer.saturating_add(s.unterfuehrer),
            summe.mannschaft.saturating_add(s.mannschaft),
        );
        if let Some(cs) = kinder.get(&id) {
            for c in cs {
                stack.push(*c);
            }
        }
    }
    Ok(summe)
}

/// Alle Einheiten eines Einsatzes (flach, aufgelöst inkl. Mitgliedern/Stärke).
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<EinheitAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE e.einsatz_id = ? ORDER BY e.sortier, e.id"
    )).bind(einsatz_id).fetch_all(pool).await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(zu_anzeige(pool, row).await?);
    }
    Ok(out)
}

/// Lädt eine Einheit (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<EinheitAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!("{SELECT_AUFGELOEST} WHERE e.id = ? AND e.einsatz_id = ?"))
        .bind(id).bind(einsatz_id)
        .fetch_optional(pool).await?
        .ok_or(AppError::NotFound)?;
    zu_anzeige(pool, row).await
}

async fn pruefe_parent(pool: &SqlitePool, einsatz_id: i64, parent_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(parent_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

async fn pruefe_abschnitt(pool: &SqlitePool, einsatz_id: i64, abschnitt_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
        .bind(abschnitt_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Zyklus, wenn beim Setzen von `ueber_einheit_id = kandidat` für `start_id` der
/// Kandidat (oder ein Vorfahr) gleich `start_id` wäre. Läuft von `kandidat` nach oben.
async fn waere_zyklus(pool: &SqlitePool, start_id: i64, kandidat_parent: i64) -> Result<bool, AppError> {
    let mut aktuell = Some(kandidat_parent);
    let mut schritte = 0;
    while let Some(id) = aktuell {
        if id == start_id {
            return Ok(true);
        }
        schritte += 1;
        if schritte > 10_000 {
            return Ok(true);
        }
        aktuell = sqlx::query_scalar::<_, Option<i64>>("SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ?")
            .bind(id).fetch_optional(pool).await?.flatten();
    }
    Ok(false)
}

/// Validiert typ (eigene Org, aktiv), abschnitt (selber Einsatz), parent (selber Einsatz,
/// zyklenfrei). `self_id = None` beim Anlegen.
async fn validiere(pool: &SqlitePool, einsatz_id: i64, org_id: i64, self_id: Option<i64>, daten: &EinheitDaten<'_>) -> Result<(), AppError> {
    if let Some(typ) = daten.typ_id {
        if !crate::einheit::typ_repo::ist_in_org(pool, org_id, typ).await? {
            return Err(AppError::Validation("Unbekannter Einheitstyp".into()));
        }
    }
    if let Some(abschnitt) = daten.abschnitt_id {
        pruefe_abschnitt(pool, einsatz_id, abschnitt).await?;
    }
    if let Some(parent) = daten.ueber_einheit_id {
        pruefe_parent(pool, einsatz_id, parent).await?;
        if let Some(sid) = self_id {
            if waere_zyklus(pool, sid, parent).await? {
                return Err(AppError::Validation("Einheit darf nicht eigener Vorfahr werden".into()));
            }
        }
    }
    Ok(())
}

/// Legt eine Einheit an (nach Validierung). `org_id` für die Typ-Prüfung.
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, org_id: i64, daten: EinheitDaten<'_>, angelegt_von: i64) -> Result<EinheitAnzeige, AppError> {
    validiere(pool, einsatz_id, org_id, None, &daten).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_einheit \
            (einsatz_id, abschnitt_id, ueber_einheit_id, typ_id, name, \
             soll_fuehrer, soll_unterfuehrer, soll_mannschaft, bemerkung, sortier, angelegt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.abschnitt_id).bind(daten.ueber_einheit_id).bind(daten.typ_id)
    .bind(daten.name).bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.bemerkung).bind(daten.sortier).bind(angelegt_von)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}

/// Vollersatz der editierbaren Felder (ohne Führer). Parent-Wechsel zyklenfrei. `NotFound`,
/// falls die Einheit nicht zum Einsatz gehört.
pub async fn aktualisiere(pool: &SqlitePool, einsatz_id: i64, org_id: i64, id: i64, daten: EinheitDaten<'_>) -> Result<EinheitAnzeige, AppError> {
    laden(pool, einsatz_id, id).await?; // Existenz im Einsatz sichern
    validiere(pool, einsatz_id, org_id, Some(id), &daten).await?;
    let resultat = sqlx::query(
        "UPDATE einsatz_einheit SET abschnitt_id = ?, ueber_einheit_id = ?, typ_id = ?, name = ?, \
                soll_fuehrer = ?, soll_unterfuehrer = ?, soll_mannschaft = ?, bemerkung = ?, sortier = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.abschnitt_id).bind(daten.ueber_einheit_id).bind(daten.typ_id).bind(daten.name)
    .bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.bemerkung).bind(daten.sortier).bind(id).bind(einsatz_id)
    .execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Reine Validierung (kein Write): Einheit gehört zum Einsatz, und bei `Some(ep)` ist die
/// Person Mitglied *dieser* Einheit. `NotFound`/`Validation`. Wird im Route-Handler **vor**
/// jeglichem Write aufgerufen, damit ein ungültiger Führer kein Teil-Update hinterlässt.
pub async fn pruefe_fuehrer(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, fuehrer_ep_id: Option<i64>) -> Result<(), AppError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(einsatz_id).fetch_optional(pool).await?;
    exists.ok_or(AppError::NotFound)?;
    if let Some(ep) = fuehrer_ep_id {
        let mitglied: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM einsatz_personal WHERE id = ? AND einheit_id = ?",
        ).bind(ep).bind(einheit_id).fetch_optional(pool).await?;
        if mitglied.is_none() {
            return Err(AppError::Validation("Führer muss Mitglied dieser Einheit sein".into()));
        }
    }
    Ok(())
}

/// Setzt (oder leert mit `None`) den Führer einer Einheit. Validiert vorab über
/// `pruefe_fuehrer`. `NotFound`/`Validation` wie dort.
pub async fn setze_fuehrer(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, fuehrer_ep_id: Option<i64>) -> Result<(), AppError> {
    pruefe_fuehrer(pool, einsatz_id, einheit_id, fuehrer_ep_id).await?;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(fuehrer_ep_id).bind(einheit_id).bind(einsatz_id).execute(pool).await?;
    Ok(())
}

/// Löst eine Einheit auf (Transaktion): alle Mitglieder freigeben (`einheit_id = NULL` an
/// Personal + Fahrzeug), Unter-Einheiten auf den Parent hochziehen, dann löschen.
/// `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let parent: Option<i64> = sqlx::query_scalar(
        "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    ).bind(id).bind(einsatz_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE einheit_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = NULL WHERE einheit_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE ueber_einheit_id = ? AND einsatz_id = ?")
        .bind(parent).bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?").bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
```

- [ ] **Step 5: Tests laufen lassen (grün)**

Run: `cargo test --lib einheit::repo`
Expected: PASS (8 Tests).

- [ ] **Step 6: Gesamttest Backend (Regression)**

Run: `cargo test --lib`
Expected: PASS (gesamte Lib grün).

- [ ] **Step 7: Commit**

```bash
git add src/einheit/mod.rs src/einheit/repo.rs
git commit -m "feat(be): einheit-Repo (CRUD, Baum, Zyklen, Soll/Ist, kumuliert, Auflösen)"
```

---

## Task 14: Routen `einsatz_einheit` (CRUD + Mitglieder + Führer + ETB) + Registrierung

**Files:**
- Create: `src/routes/einsatz_einheit.rs`, `tests/einsatz_einheit.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs`

**API-Vertrag (verbindlich):** PATCH ist Vollersatz **inklusive `fuehrer_id`** (authoritativ; das FE sendet immer den aktuellen Wert mit, beim Führer-Wechsel den neuen, zum Entfernen `null`). Soll-Override folgt „alle drei oder keiner" (validiert via `Staerke::aus_optionen`).

- [ ] **Step 1: Handler schreiben**

Create `src/routes/einsatz_einheit.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einheit::repo::{self as einheit_repo, EinheitDaten};
use crate::einheit::{mitglied_repo, EinheitAnzeige};
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::staerke::Staerke;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

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

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Holt den Einsatz + Rolle und prüft Schreibrecht + aktiv. Liefert den Einsatz.
async fn schreib_gate(state: &AppState, einsatz_id: i64, benutzer_id: i64) -> Result<crate::einsatz::Einsatz, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer_id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    Ok(einsatz)
}

/// Lädt nur den Einheiten-Namen (für ETB-Texte); `NotFound`, falls nicht zum Einsatz.
async fn einheit_name(state: &AppState, einsatz_id: i64, eid: i64) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(eid).bind(einsatz_id)
        .fetch_optional(&state.pool).await?
        .ok_or(AppError::NotFound)
}

/// GET /api/einsaetze/{id}/einheiten — Liste (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinheitAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(einheit_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct EinheitBody {
    pub name: String,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub fuehrer_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// POST /api/einsaetze/{id}/einheiten — Einheit bilden. ETB-Eintrag.
pub async fn bilden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<EinheitBody>,
) -> Result<(StatusCode, Json<EinheitAnzeige>), AppError> {
    let einsatz = schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft).map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);
    let anzeige = einheit_repo::anlegen(
        &state.pool, einsatz_id, einsatz.org_id,
        EinheitDaten {
            name: &name, abschnitt_id: body.abschnitt_id, ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id, soll_fuehrer: body.soll_fuehrer, soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
        benutzer.id,
    ).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}» gebildet", anzeige.name)).await?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH /api/einsaetze/{id}/einheiten/{eid} — Vollersatz inkl. authoritativem fuehrer_id.
/// Führer-Wechsel und Abschnitts-Zuordnungs-Änderung schreiben je einen ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid)): Path<(i64, i64)>,
    Json(body): Json<EinheitBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz = schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft).map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);

    let vorher = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;
    // Führer-Gültigkeit VOR jeglichem Write prüfen, damit ein ungültiger Führer
    // (Nicht-Mitglied) kein Teil-Update der übrigen Felder hinterlässt.
    if vorher.fuehrer_id != body.fuehrer_id {
        einheit_repo::pruefe_fuehrer(&state.pool, einsatz_id, eid, body.fuehrer_id).await?;
    }
    let nachher = einheit_repo::aktualisiere(
        &state.pool, einsatz_id, einsatz.org_id, eid,
        EinheitDaten {
            name: &name, abschnitt_id: body.abschnitt_id, ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id, soll_fuehrer: body.soll_fuehrer, soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;

    // Führer authoritativ setzen (Mitgliedschaft bereits geprüft) + ETB bei Änderung.
    if vorher.fuehrer_id != body.fuehrer_id {
        einheit_repo::setze_fuehrer(&state.pool, einsatz_id, eid, body.fuehrer_id).await?;
    }
    // Endgültige Anzeige (inkl. neu aufgelöstem Führer-Namen).
    let final_anzeige = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;

    if vorher.fuehrer_id != body.fuehrer_id {
        let inhalt = match (&vorher.fuehrer_name, &final_anzeige.fuehrer_name) {
            (None, Some(neu)) => format!("Einheit «{}»: Führer «{}» gesetzt", final_anzeige.name, neu),
            (Some(alt), Some(neu)) => format!("Einheit «{}»: Führer «{}» → «{}»", final_anzeige.name, alt, neu),
            (Some(alt), None) => format!("Einheit «{}»: Führer «{}» entfernt", final_anzeige.name, alt),
            (None, None) => String::new(),
        };
        if !inhalt.is_empty() {
            etb_system(&state, einsatz_id, benutzer.id, &inhalt).await?;
        }
    }
    if vorher.abschnitt_id != nachher.abschnitt_id {
        let inhalt = match &nachher.abschnitt_name {
            Some(a) => format!("Einheit «{}»: Abschnitt «{}» zugeordnet", nachher.name, a),
            None => format!("Einheit «{}»: Abschnittszuordnung aufgehoben", nachher.name),
        };
        etb_system(&state, einsatz_id, benutzer.id, &inhalt).await?;
    }
    Ok(Json(final_anzeige))
}

/// DELETE /api/einsaetze/{id}/einheiten/{eid} — auflösen. ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = einheit_name(&state, einsatz_id, eid).await?;
    einheit_repo::loese_auf(&state.pool, einsatz_id, eid).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}» aufgelöst", name)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/personal/{ep_id} — Person zuordnen. ETB-Eintrag.
pub async fn personal_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let person = mitglied_repo::ordne_personal_zu(&state.pool, einsatz_id, eid, ep_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: «{}» zugeordnet", einheit, person)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/personal/{ep_id} — Person freigeben. ETB-Eintrag.
pub async fn personal_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let person = mitglied_repo::gib_personal_frei(&state.pool, einsatz_id, eid, ep_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: «{}» freigegeben", einheit, person)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug zuordnen. ETB-Eintrag.
pub async fn fahrzeug_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ef_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let fz = mitglied_repo::ordne_fahrzeug_zu(&state.pool, einsatz_id, eid, ef_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Fahrzeug «{}» zugeordnet", einheit, fz)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug freigeben. ETB-Eintrag.
pub async fn fahrzeug_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ef_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let fz = mitglied_repo::gib_fahrzeug_frei(&state.pool, einsatz_id, eid, ef_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Fahrzeug «{}» freigegeben", einheit, fz)).await?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Modul + Routen registrieren**

In `src/routes/mod.rs` ergänzen:

```rust
pub mod einsatz_einheit;
```

In `src/app.rs`, in `build_router`:

```rust
        .route("/api/einsaetze/{id}/einheiten", get(routes::einsatz_einheit::liste))
        .route("/api/einsaetze/{id}/einheiten", post(routes::einsatz_einheit::bilden))
        .route("/api/einsaetze/{id}/einheiten/{eid}", patch(routes::einsatz_einheit::aktualisieren))
        .route("/api/einsaetze/{id}/einheiten/{eid}", delete(routes::einsatz_einheit::aufloesen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}", put(routes::einsatz_einheit::personal_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}", delete(routes::einsatz_einheit::personal_freigeben))
        .route("/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}", put(routes::einsatz_einheit::fahrzeug_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}", delete(routes::einsatz_einheit::fahrzeug_freigeben))
```

- [ ] **Step 3: Integrationstest `tests/einsatz_einheit.rs`**

Create `tests/einsatz_einheit.rs`. Übernimm das Harness aus `tests/einsatzabschnitt.rs` (`setup`, `login_cookie`, `benutzer_anlegen`, `anfrage`, `einsatz_anlegen`, `rolle_setzen`, `person_anlegen`, `system_etb_anzahl`) und ergänze:

```rust
// (Harness wie tests/einsatzabschnitt.rs)

async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(app, "POST", &format!("/api/einsaetze/{einsatz}/einheiten"), cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#))).await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn bilden_schreibt_etb_und_liefert_nullstaerke() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin,
        Some(r#"{"name":"1. Zug"}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["name"], "1. Zug");
    assert_eq!(json["ist"]["mannschaft"], 0);
    assert!(json["soll"].is_null());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn mitglied_zuordnen_wechseln_freigeben_mit_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let b = einheit_bilden(&app, &admin, einsatz, "B").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await; // disponiert ins Personal

    assert_eq!(anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // In A sichtbar.
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin, None).await;
    let einheit_a = liste.as_array().unwrap().iter().find(|e| e["id"] == a).unwrap();
    assert_eq!(einheit_a["personal_mitglieder"].as_array().unwrap().len(), 1);

    // Wechsel zu B → A verliert sie.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"), &admin, None).await;
    let (_, liste2) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin, None).await;
    let einheit_a2 = liste2.as_array().unwrap().iter().find(|e| e["id"] == a).unwrap();
    assert!(einheit_a2["personal_mitglieder"].as_array().unwrap().is_empty());

    // Freigeben.
    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"), &admin, None).await.0, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn freier_pool_zeigt_einheit_id_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    // Vor Zuordnung: einheit_id null im Personal.
    let (_, personal) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert!(personal.as_array().unwrap().iter().find(|p| p["id"] == ep).unwrap()["einheit_id"].is_null());
    // Nach Zuordnung: einheit_id gesetzt.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"), &admin, None).await;
    let (_, personal2) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert_eq!(personal2.as_array().unwrap().iter().find(|p| p["id"] == ep).unwrap()["einheit_id"], a);
}

#[tokio::test]
async fn fuehrer_nur_mitglied_dieser_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    // Nicht-Mitglied als Führer bei gleichzeitigem Namens-Edit → 400 UND kein Teil-Update.
    let body_umbenennen = format!(r#"{{"name":"A-NEU","fuehrer_id":{ep}}}"#);
    assert_eq!(anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{a}"), &admin, Some(&body_umbenennen)).await.0, StatusCode::BAD_REQUEST);
    // Name darf NICHT geändert worden sein (Führer-Prüfung läuft vor jedem Write).
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().iter().find(|e| e["id"] == a).unwrap()["name"], "A");
    // Nach Zuordnung erlaubt.
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"), &admin, None).await;
    let (s, json) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/einheiten/{a}"), &admin, Some(&body_umbenennen)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["fuehrer_id"], ep);
    assert_eq!(json["name"], "A-NEU");
}

#[tokio::test]
async fn aufloesen_gibt_mitglieder_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    anfrage(&app, "PUT", &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"), &admin, None).await;
    assert_eq!(anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/einheiten/{a}"), &admin, None).await.0, StatusCode::NO_CONTENT);
    // Person wieder frei.
    let (_, personal) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/personal"), &admin, None).await;
    assert!(personal.as_array().unwrap().iter().find(|p| p["id"] == ep).unwrap()["einheit_id"].is_null());
}

#[tokio::test]
async fn beobachter_darf_nicht_bilden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/einheiten"), &erika_c, None).await.0, StatusCode::OK);
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/einheiten"), &erika_c, Some(r#"{"name":"X"}"#)).await.0, StatusCode::FORBIDDEN);
}
```

- [ ] **Step 4: Tests + Build laufen lassen**

Run: `cargo build`
Run: `cargo test --test einsatz_einheit`
Run: `cargo test --lib einheit`
Expected: PASS, kein Compile-Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/routes/einsatz_einheit.rs tests/einsatz_einheit.rs src/routes/mod.rs src/app.rs
git commit -m "feat(be): Routen einheiten (CRUD, Mitglieder, Führer, ETB, Gating)"
```

---

## Task 15: Frontend — Typen + API-Module (`einsatzabschnitte.ts`, `einheiten.ts`)

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/einsatzabschnitte.ts`, `frontend/src/api/einheiten.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` am Ende ergänzen:

```ts
/** Aufgelöster Einsatzabschnitt (flach; Baum baut das FE über ueber_abschnitt_id). */
export interface Einsatzabschnitt {
  id: number;
  einsatz_id: number;
  ueber_abschnitt_id: number | null;
  name: string;
  leiter_id: number | null;
  leiter_name: string | null;
  bemerkung: string | null;
  sortier: number;
}

/** Personal-Mitglied einer Einheit (leichtgewichtig). */
export interface EinheitMitgliedPerson {
  ep_id: number;
  name: string;
  funktion: string | null;
  staerke_position: StaerkePosition | null;
  ist_fuehrer: boolean;
}

/** Fahrzeug-Mitglied einer Einheit. */
export interface EinheitMitgliedFahrzeug {
  ef_id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
}

/** Aufgelöste Einheit inkl. Mitgliedern und Soll/Ist-Stärke. */
export interface Einheit {
  id: number;
  einsatz_id: number;
  abschnitt_id: number | null;
  abschnitt_name: string | null;
  ueber_einheit_id: number | null;
  typ_id: number | null;
  typ_label: string | null;
  name: string;
  fuehrer_id: number | null;
  fuehrer_name: string | null;
  bemerkung: string | null;
  sortier: number;
  /** null, wenn weder Override noch Typ eine Soll-Stärke liefern. */
  soll: Staerke | null;
  ist: Staerke;
  ist_kumuliert: Staerke;
  personal_mitglieder: EinheitMitgliedPerson[];
  fahrzeug_mitglieder: EinheitMitgliedFahrzeug[];
}
```

- [ ] **Step 2: `api/einsatzabschnitte.ts`**

Create `frontend/src/api/einsatzabschnitte.ts`:

```ts
import type { Einsatzabschnitt } from './types';
import { apiGet, apiSend } from './client';

export interface AbschnittEingabe {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string | null;
  sortier?: number;
}

export function listeAbschnitte(einsatzId: number): Promise<Einsatzabschnitt[]> {
  return apiGet<Einsatzabschnitt[]>(`/api/einsaetze/${einsatzId}/abschnitte`);
}

export function legeAbschnittAn(einsatzId: number, daten: AbschnittEingabe): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte`, 'POST', daten);
}

export function aktualisiereAbschnitt(einsatzId: number, aid: number, daten: AbschnittEingabe): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'PATCH', daten);
}

export function loeseAbschnittAuf(einsatzId: number, aid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'DELETE');
}
```

- [ ] **Step 3: `api/einheiten.ts`**

Create `frontend/src/api/einheiten.ts`:

```ts
import type { Einheit } from './types';
import { apiGet, apiSend } from './client';

export interface EinheitEingabe {
  name: string;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  typ_id?: number | null;
  fuehrer_id?: number | null;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  bemerkung?: string | null;
  sortier?: number;
}

export function listeEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten`);
}

export function bildeEinheit(einsatzId: number, daten: EinheitEingabe): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten`, 'POST', daten);
}

export function aktualisiereEinheit(einsatzId: number, eid: number, daten: EinheitEingabe): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'PATCH', daten);
}

export function loeseEinheitAuf(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'DELETE');
}

export function ordnePersonalZu(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'PUT');
}

export function gibPersonalFrei(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'DELETE');
}

export function ordneFahrzeugZu(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'PUT');
}

export function gibFahrzeugFrei(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'DELETE');
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: kein Typfehler.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzabschnitte.ts frontend/src/api/einheiten.ts
git commit -m "feat(fe): API-Typen + Module für Einsatzabschnitte und Einheiten"
```

---

## Task 16: Frontend — `EinheitenPage` (Baum + Detail + Mitglieder + Führer)

**Files:**
- Create: `frontend/src/pages/EinheitenPage.tsx`, `frontend/src/pages/EinheitenPage.test.tsx`

**Layout:** Baum links (antd `Tree` nach `ueber_einheit_id`), Detail rechts. Schreibrecht-Gate `darfSchreiben` identisch zu `PersonalPage` (`status === 'aktiv'` und Rolle `einsatzleitung`/`fuehrungspersonal`). Beobachter/abgeschlossen: reine Anzeige. Frei-Pool clientseitig über `einheit_id === null`.

- [ ] **Step 1: Failing test**

Create `frontend/src/pages/EinheitenPage.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitenPage from './EinheitenPage';

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};
const einheiten = [
  {
    id: 10, einsatz_id: 1, abschnitt_id: null, abschnitt_name: null, ueber_einheit_id: null,
    typ_id: 1, typ_label: 'Zug', name: '1. Zug', fuehrer_id: null, fuehrer_name: null, bemerkung: null, sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 }, personal_mitglieder: [], fahrzeug_mitglieder: [],
  },
];

function handlers(rolle = 'einsatzleitung', status = 'aktiv') {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () => HttpResponse.json([{ id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 }])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
  ];
}

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('EinheitenPage', () => {
  it('zeigt den Einheiten-Baum mit Name und Soll/Ist', async () => {
    server.use(...handlers());
    renderMitProviders(<EinheitenPage />, { route: '/einsaetze/1/einheiten' });
    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    // Ist 1/0/2 (Σ3) und Soll 1/3/18 (Σ22) werden angezeigt.
    expect(screen.getByText(/1\/0\/2\/3/)).toBeInTheDocument();
    expect(screen.getByText(/1\/3\/18\/22/)).toBeInTheDocument();
  });

  it('zeigt „Einheit bilden" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(<EinheitenPage />, { route: '/einsaetze/1/einheiten' });
    expect(await screen.findByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(<EinheitenPage />, { route: '/einsaetze/1/einheiten' });
    await screen.findByText('1. Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Einheit bilden' })).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `cd frontend && npx vitest run src/pages/EinheitenPage.test.tsx`
Expected: FAIL — `EinheitenPage` existiert nicht.

- [ ] **Step 3: Seite implementieren**

Create `frontend/src/pages/EinheitenPage.tsx`:

```tsx
import {
  Alert, App, Breadcrumb, Button, Card, Empty, Form, Input, InputNumber, Popconfirm, Select,
  Space, Spin, Tag, Tree, TreeSelect, Typography, type TreeDataNode,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheitTypen } from '../api/einheitTypen';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import {
  aktualisiereEinheit, bildeEinheit, gibFahrzeugFrei, gibPersonalFrei, listeEinheiten,
  loeseEinheitAuf, ordneFahrzeugZu, ordnePersonalZu, type EinheitEingabe,
} from '../api/einheiten';
import { ApiError } from '../api/client';
import type { Einheit, Staerke } from '../api/types';

/** "F/UF/M/Σ" einer Stärke. */
function staerkeText(s: Staerke): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.fuehrer + s.unterfuehrer + s.mannschaft}`;
}

/** Baut antd-Tree-Daten aus der flachen Einheitenliste (nach ueber_einheit_id). */
function baueBaum(einheiten: Einheit[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einheit[]>();
  for (const e of einheiten) {
    const key = e.ueber_einheit_id;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(e);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((e) => ({
      key: e.id,
      title: (
        <Space size={4}>
          <span>{e.name}</span>
          {e.typ_label && <Tag>{e.typ_label}</Tag>}
          <Tag color="blue">{staerkeText(e.ist)}{e.soll ? ` / Soll ${staerkeText(e.soll)}` : ''}</Tag>
          {e.fuehrer_name && <span style={{ color: '#888' }}>👤 {e.fuehrer_name}</span>}
        </Space>
      ),
      children: baue(e.id),
    }));
  return baue(null);
}

/** Menge der Nachfahren-IDs (inkl. self) — für die zyklenfreie Parent-Auswahl. */
function nachfahrenInkl(einheiten: Einheit[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const e of einheiten) {
    if (e.ueber_einheit_id != null) {
      if (!kinder.has(e.ueber_einheit_id)) kinder.set(e.ueber_einheit_id, []);
      kinder.get(e.ueber_einheit_id)!.push(e.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

interface KopfWerte {
  name: string;
  typ_id?: number | null;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  soll_fuehrer?: number;
  soll_unterfuehrer?: number;
  soll_mannschaft?: number;
  bemerkung?: string;
}

export default function EinheitenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [form] = Form.useForm<KopfWerte>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });
  const typenQuery = useQuery({ queryKey: ['einheit-typen'], queryFn: listeEinheitTypen });
  const abschnitteQuery = useQuery({ queryKey: ['abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: ['einsatz-fahrzeuge', einsatzId], queryFn: () => listeEinsatzFahrzeuge(einsatzId) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einheiten', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-personal', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-fahrzeuge', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const einheiten = einheitenQuery.data ?? [];
  const aktuell = einheiten.find((e) => e.id === gewaehlt) ?? null;

  const speichern = useMutation({
    mutationFn: (werte: KopfWerte) => {
      const daten: EinheitEingabe = {
        name: werte.name.trim(),
        typ_id: werte.typ_id ?? null,
        abschnitt_id: werte.abschnitt_id ?? null,
        ueber_einheit_id: werte.ueber_einheit_id ?? null,
        fuehrer_id: aktuell?.fuehrer_id ?? null, // Führer unverändert (authoritativ)
        soll_fuehrer: werte.soll_fuehrer ?? null,
        soll_unterfuehrer: werte.soll_unterfuehrer ?? null,
        soll_mannschaft: werte.soll_mannschaft ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
      };
      return aktuell ? aktualisiereEinheit(einsatzId, aktuell.id, daten) : bildeEinheit(einsatzId, daten);
    },
    onSuccess: (e) => { invalidate(); setGewaehlt(e.id); message.success('Gespeichert'); },
    onError: fehler,
  });

  const bilden = useMutation({
    mutationFn: () => bildeEinheit(einsatzId, { name: 'Neue Einheit' }),
    onSuccess: (e) => { invalidate(); setGewaehlt(e.id); },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (eid: number) => loeseEinheitAuf(einsatzId, eid),
    onSuccess: () => { invalidate(); setGewaehlt(null); },
    onError: fehler,
  });
  const personalZu = useMutation({
    mutationFn: (epId: number) => ordnePersonalZu(einsatzId, aktuell!.id, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const personalFrei = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, aktuell!.id, epId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugZu = useMutation({
    mutationFn: (efId: number) => ordneFahrzeugZu(einsatzId, aktuell!.id, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const fahrzeugFrei = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, aktuell!.id, efId),
    onSuccess: invalidate, onError: fehler,
  });
  const fuehrerSetzen = useMutation({
    // Baut den PATCH-Body bewusst aus dem Server-Stand (`aktuell`), nicht aus dem
    // Formular: ungespeicherte Kopf-Edits werden NICHT mitgesendet (Vollersatz-Vertrag).
    // Führer-Markieren ist eine eigenständige Aktion; zuerst Kopfdaten „Speichern".
    mutationFn: (epId: number | null) => {
      const e = aktuell!;
      return aktualisiereEinheit(einsatzId, e.id, {
        name: e.name, typ_id: e.typ_id, abschnitt_id: e.abschnitt_id, ueber_einheit_id: e.ueber_einheit_id,
        fuehrer_id: epId, soll_fuehrer: e.soll?.fuehrer ?? null, soll_unterfuehrer: e.soll?.unterfuehrer ?? null,
        soll_mannschaft: e.soll?.mannschaft ?? null, bemerkung: e.bemerkung,
      });
    },
    onSuccess: invalidate, onError: fehler,
  });

  // Formular bei Auswahlwechsel mit den Kopfdaten der Einheit füllen.
  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name, typ_id: aktuell.typ_id ?? undefined, abschnitt_id: aktuell.abschnitt_id ?? undefined,
        ueber_einheit_id: aktuell.ueber_einheit_id ?? undefined, soll_fuehrer: aktuell.soll?.fuehrer,
        soll_unterfuehrer: aktuell.soll?.unterfuehrer, soll_mannschaft: aktuell.soll?.mannschaft, bemerkung: aktuell.bemerkung ?? undefined,
      });
    }
  }, [aktuell, form]);

  const baumDaten = useMemo(() => baueBaum(einheiten), [einheiten]);
  const verbotenAlsParent = aktuell ? nachfahrenInkl(einheiten, aktuell.id) : new Set<number>();
  const parentOptionen = einheiten
    .filter((e) => !verbotenAlsParent.has(e.id))
    .map((e) => ({ value: e.id, title: e.name }));
  const abschnittOptionen = (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, title: a.name }));

  // Frei-Pool: disponierte Kräfte ohne Einheit.
  const freiesPersonal = (personalQuery.data ?? []).filter((p) => p.einheit_id == null);
  const freieFahrzeuge = (fahrzeugeQuery.data ?? []).filter((f) => f.einheit_id == null);

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

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Einheiten' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Einheiten</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && <Button type="primary" onClick={() => bilden.mutate()}>Einheit bilden</Button>}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <Card style={{ flex: '0 0 360px' }} size="small" title="Gliederung">
          {einheiten.length === 0 ? (
            <Empty description="Noch keine Einheiten" />
          ) : (
            <Tree
              treeData={baumDaten}
              selectedKeys={gewaehlt != null ? [gewaehlt] : []}
              defaultExpandAll
              onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)}
            />
          )}
        </Card>

        <Card style={{ flex: 1 }} size="small" title={aktuell ? `Einheit: ${aktuell.name}` : 'Keine Einheit gewählt'}>
          {!aktuell ? (
            <Empty description="Wähle eine Einheit im Baum" />
          ) : (
            <Form<KopfWerte> form={form} layout="vertical" disabled={!darfSchreiben} onFinish={(w) => speichern.mutate(w)}>
              <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
              <Form.Item label="Typ" name="typ_id">
                <Select allowClear placeholder="Typ wählen"
                  options={(typenQuery.data ?? []).map((t) => ({ value: t.id, label: t.label }))} />
              </Form.Item>
              <Form.Item label="Abschnitt" name="abschnitt_id">
                <TreeSelect allowClear placeholder="Abschnitt zuordnen" treeData={abschnittOptionen} />
              </Form.Item>
              <Form.Item label="Über-Einheit" name="ueber_einheit_id">
                <TreeSelect allowClear placeholder="Unterstellung" treeData={parentOptionen} />
              </Form.Item>
              <Form.Item label="Soll-Override (vollständig oder leer)">
                <Space>
                  <Form.Item name="soll_fuehrer" noStyle><InputNumber min={0} placeholder="F" /></Form.Item>
                  <Form.Item name="soll_unterfuehrer" noStyle><InputNumber min={0} placeholder="UF" /></Form.Item>
                  <Form.Item name="soll_mannschaft" noStyle><InputNumber min={0} placeholder="M" /></Form.Item>
                  <span style={{ color: '#888' }}>Ist: {staerkeText(aktuell.ist)} · kumuliert: {staerkeText(aktuell.ist_kumuliert)}</span>
                </Space>
              </Form.Item>
              <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
              {darfSchreiben && (
                <Space>
                  <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                  <Popconfirm
                    title="Einheit auflösen?"
                    description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch."
                    onConfirm={() => aufloesen.mutate(aktuell.id)}
                  >
                    <Button danger>Auflösen</Button>
                  </Popconfirm>
                </Space>
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>Personal</Typography.Title>
              {aktuell.personal_mitglieder.map((m) => (
                <Space key={m.ep_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}{m.ist_fuehrer && <Tag color="gold" style={{ marginLeft: 4 }}>Führer</Tag>}</span>
                  {darfSchreiben && (
                    <Space>
                      {!m.ist_fuehrer && <Button size="small" onClick={() => fuehrerSetzen.mutate(m.ep_id)}>Als Führer</Button>}
                      <Button size="small" danger onClick={() => personalFrei.mutate(m.ep_id)}>Entfernen</Button>
                    </Space>
                  )}
                </Space>
              ))}
              {darfSchreiben && (
                <Select showSearch style={{ width: '100%', marginTop: 8 }} placeholder="Person zuordnen …" value={null}
                  optionFilterProp="label" notFoundContent="Keine freien Personen"
                  options={freiesPersonal.map((p) => ({ value: p.id, label: p.name }))}
                  onSelect={(epId) => personalZu.mutate(Number(epId))} />
              )}

              <Typography.Title level={5} style={{ marginTop: 16 }}>Fahrzeuge</Typography.Title>
              {aktuell.fahrzeug_mitglieder.map((m) => (
                <Space key={m.ef_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{m.funkrufname}{m.fahrzeugtyp ? ` (${m.fahrzeugtyp})` : ''}</span>
                  {darfSchreiben && <Button size="small" danger onClick={() => fahrzeugFrei.mutate(m.ef_id)}>Entfernen</Button>}
                </Space>
              ))}
              {darfSchreiben && (
                <Select showSearch style={{ width: '100%', marginTop: 8 }} placeholder="Fahrzeug zuordnen …" value={null}
                  optionFilterProp="label" notFoundContent="Keine freien Fahrzeuge"
                  options={freieFahrzeuge.map((f) => ({ value: f.id, label: f.funkrufname }))}
                  onSelect={(efId) => fahrzeugZu.mutate(Number(efId))} />
              )}
            </Form>
          )}
        </Card>
      </div>
    </div>
  );
}
```

> **Hinweis:** `listeEinsatzFahrzeuge` muss aus `../api/einsatzFahrzeuge` importierbar sein (existiert aus K&M‑1; Funktionsname ggf. prüfen — analog `listeEinsatzPersonal`). Falls der Name abweicht, anpassen.

- [ ] **Step 4: Test laufen lassen (grün)**

Run: `cd frontend && npx vitest run src/pages/EinheitenPage.test.tsx`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinheitenPage.tsx frontend/src/pages/EinheitenPage.test.tsx
git commit -m "feat(fe): EinheitenPage (Baum/Detail, Mitglieder, Führer, Soll/Ist, Auflösen)"
```

---

## Task 17: Frontend — `EinsatzabschnittePage` (Baum + Detail + zugeordnete Einheiten)

**Files:**
- Create: `frontend/src/pages/EinsatzabschnittePage.tsx`, `frontend/src/pages/EinsatzabschnittePage.test.tsx`

**Layout:** Abschnitts-Baum links, Detail rechts. Leiter als `Select` über disponiertes Personal, Parent als `TreeSelect` (zyklenfrei). Zugeordnete Einheiten read-only mit kumulierter Stärke. Gleiches Schreibrecht-Gate.

- [ ] **Step 1: Failing test**

Create `frontend/src/pages/EinsatzabschnittePage.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinsatzabschnittePage from './EinsatzabschnittePage';

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};

function handlers(rolle = 'einsatzleitung', status = 'aktiv') {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([
      { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: 'Leiter Nord', bemerkung: null, sortier: 0 },
    ])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  ];
}

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('EinsatzabschnittePage', () => {
  it('zeigt den Abschnitts-Baum mit Leiter', async () => {
    server.use(...handlers());
    renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/einsatzabschnitte' });
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    expect(screen.getByText(/Leiter Nord/)).toBeInTheDocument();
  });

  it('zeigt „Abschnitt anlegen" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/einsatzabschnitte' });
    expect(await screen.findByRole('button', { name: 'Abschnitt anlegen' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/einsatzabschnitte' });
    await screen.findByText('Nord');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `cd frontend && npx vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: FAIL — Komponente fehlt.

- [ ] **Step 3: Seite implementieren**

Create `frontend/src/pages/EinsatzabschnittePage.tsx`:

```tsx
import {
  Alert, App, Breadcrumb, Button, Card, Empty, Form, Input, List, Popconfirm, Select, Space, Spin,
  Tag, Tree, TreeSelect, Typography, type TreeDataNode,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import {
  aktualisiereAbschnitt, legeAbschnittAn, listeAbschnitte, loeseAbschnittAuf, type AbschnittEingabe,
} from '../api/einsatzabschnitte';
import { ApiError } from '../api/client';
import type { Einsatzabschnitt, Staerke } from '../api/types';

function staerkeText(s: Staerke): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.fuehrer + s.unterfuehrer + s.mannschaft}`;
}

function baueBaum(abschnitte: Einsatzabschnitt[]): TreeDataNode[] {
  const kinder = new Map<number | null, Einsatzabschnitt[]>();
  for (const a of abschnitte) {
    const key = a.ueber_abschnitt_id;
    if (!kinder.has(key)) kinder.set(key, []);
    kinder.get(key)!.push(a);
  }
  const baue = (parent: number | null): TreeDataNode[] =>
    (kinder.get(parent) ?? []).map((a) => ({
      key: a.id,
      title: (
        <Space size={4}>
          <span>{a.name}</span>
          {a.leiter_name && <span style={{ color: '#888' }}>👤 {a.leiter_name}</span>}
        </Space>
      ),
      children: baue(a.id),
    }));
  return baue(null);
}

function nachfahrenInkl(abschnitte: Einsatzabschnitt[], id: number): Set<number> {
  const kinder = new Map<number, number[]>();
  for (const a of abschnitte) {
    if (a.ueber_abschnitt_id != null) {
      if (!kinder.has(a.ueber_abschnitt_id)) kinder.set(a.ueber_abschnitt_id, []);
      kinder.get(a.ueber_abschnitt_id)!.push(a.id);
    }
  }
  const ergebnis = new Set<number>();
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    if (ergebnis.has(n)) continue;
    ergebnis.add(n);
    for (const c of kinder.get(n) ?? []) stack.push(c);
  }
  return ergebnis;
}

interface AbschnittWerte {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string;
}

export default function EinsatzabschnittePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [form] = Form.useForm<AbschnittWerte>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const einheitenQuery = useQuery({ queryKey: ['einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['abschnitte', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einheiten', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const abschnitte = abschnitteQuery.data ?? [];
  const aktuell = abschnitte.find((a) => a.id === gewaehlt) ?? null;

  const speichern = useMutation({
    mutationFn: (werte: AbschnittWerte) => {
      const daten: AbschnittEingabe = {
        name: werte.name.trim(),
        ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
        leiter_id: werte.leiter_id ?? null,
        bemerkung: werte.bemerkung?.trim() || null,
      };
      return aktuell ? aktualisiereAbschnitt(einsatzId, aktuell.id, daten) : legeAbschnittAn(einsatzId, daten);
    },
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); message.success('Gespeichert'); },
    onError: fehler,
  });
  const anlegen = useMutation({
    mutationFn: () => legeAbschnittAn(einsatzId, { name: 'Neuer Abschnitt' }),
    onSuccess: (a) => { invalidate(); setGewaehlt(a.id); },
    onError: fehler,
  });
  const aufloesen = useMutation({
    mutationFn: (aid: number) => loeseAbschnittAuf(einsatzId, aid),
    onSuccess: () => { invalidate(); setGewaehlt(null); },
    onError: fehler,
  });

  useEffect(() => {
    if (aktuell) {
      form.setFieldsValue({
        name: aktuell.name, ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
        leiter_id: aktuell.leiter_id ?? undefined, bemerkung: aktuell.bemerkung ?? undefined,
      });
    }
  }, [aktuell, form]);

  const baumDaten = useMemo(() => baueBaum(abschnitte), [abschnitte]);
  const verboten = aktuell ? nachfahrenInkl(abschnitte, aktuell.id) : new Set<number>();
  const parentOptionen = abschnitte.filter((a) => !verboten.has(a.id)).map((a) => ({ value: a.id, title: a.name }));
  const personalOptionen = (personalQuery.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const zugeordneteEinheiten = (einheitenQuery.data ?? []).filter((e) => e.abschnitt_id === aktuell?.id);

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

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Einsatzabschnitte' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Einsatzabschnitte</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && <Button type="primary" onClick={() => anlegen.mutate()}>Abschnitt anlegen</Button>}
      </Space>
      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <Card style={{ flex: '0 0 360px' }} size="small" title="Gliederung">
          {abschnitte.length === 0 ? (
            <Empty description="Noch keine Abschnitte" />
          ) : (
            <Tree treeData={baumDaten} selectedKeys={gewaehlt != null ? [gewaehlt] : []} defaultExpandAll
              onSelect={(keys) => setGewaehlt(keys.length ? Number(keys[0]) : null)} />
          )}
        </Card>

        <Card style={{ flex: 1 }} size="small" title={aktuell ? `Abschnitt: ${aktuell.name}` : 'Kein Abschnitt gewählt'}>
          {!aktuell ? (
            <Empty description="Wähle einen Abschnitt im Baum" />
          ) : (
            <>
              <Form<AbschnittWerte> form={form} layout="vertical" disabled={!darfSchreiben} onFinish={(w) => speichern.mutate(w)}>
                <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>
                <Form.Item label="Über-Abschnitt" name="ueber_abschnitt_id">
                  <TreeSelect allowClear placeholder="Übergeordneter Abschnitt" treeData={parentOptionen} />
                </Form.Item>
                <Form.Item label="Abschnittsleiter" name="leiter_id">
                  <Select allowClear showSearch optionFilterProp="label" placeholder="Disponierte Person" options={personalOptionen} />
                </Form.Item>
                <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={2} /></Form.Item>
                {darfSchreiben && (
                  <Space>
                    <Button type="primary" htmlType="submit" loading={speichern.isPending}>Speichern</Button>
                    <Popconfirm title="Abschnitt auflösen?"
                      description="Unter-Abschnitte rücken hoch, zugeordnete Einheiten werden „nicht zugeordnet"."
                      onConfirm={() => aufloesen.mutate(aktuell.id)}>
                      <Button danger>Auflösen</Button>
                    </Popconfirm>
                  </Space>
                )}
              </Form>

              <Typography.Title level={5} style={{ marginTop: 16 }}>Zugeordnete Einheiten</Typography.Title>
              <List
                size="small"
                locale={{ emptyText: 'Keine Einheiten zugeordnet' }}
                dataSource={zugeordneteEinheiten}
                renderItem={(e) => (
                  <List.Item>
                    <Space>
                      <span>{e.name}</span>
                      {e.typ_label && <Tag>{e.typ_label}</Tag>}
                      <Tag color="blue">kumuliert {staerkeText(e.ist_kumuliert)}</Tag>
                    </Space>
                  </List.Item>
                )}
              />
              <Typography.Text type="secondary">
                Die Abschnitts-Zuordnung einer Einheit wird auf der Einheiten-Seite gesetzt.
              </Typography.Text>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test laufen lassen (grün)**

Run: `cd frontend && npx vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx
git commit -m "feat(fe): EinsatzabschnittePage (Baum/Detail, Leiter, zugeordnete Einheiten)"
```

---

## Task 18: Module `fertig` schalten + App.tsx-Verdrahtung

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts`, `frontend/src/einsatz/modulRegistry.test.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: Failing test — beide Module sind `fertig`**

In `frontend/src/einsatz/modulRegistry.test.ts` ergänzen (Muster wie der `personal`-Test bei Zeile 80):

```tsx
it('einheiten und einsatzabschnitte sind fertig', () => {
  const einheiten = modulRegistry.find((m) => m.key === 'einheiten');
  const abschnitte = modulRegistry.find((m) => m.key === 'einsatzabschnitte');
  expect(einheiten?.status).toBe('fertig');
  expect(abschnitte?.status).toBe('fertig');
});
```

- [ ] **Step 2: Test laufen lassen (rot)**

Run: `cd frontend && npx vitest run src/einsatz/modulRegistry.test.ts`
Expected: FAIL — beide Module sind aktuell `geplant`.

- [ ] **Step 3: Status umstellen**

In `frontend/src/einsatz/modulRegistry.ts`:
- Zeile des `einsatzabschnitte`-Eintrags: `status: 'geplant'` → `status: 'fertig'`
- Zeile des `einheiten`-Eintrags: `status: 'geplant'` → `status: 'fertig'`

- [ ] **Step 4: Test laufen lassen (grün)**

Run: `cd frontend && npx vitest run src/einsatz/modulRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Seiten in App.tsx registrieren**

In `frontend/src/App.tsx`:
- Imports ergänzen:

```tsx
import EinheitenPage from './pages/EinheitenPage';
import EinsatzabschnittePage from './pages/EinsatzabschnittePage';
```

- Im `MODUL_ELEMENTE`-Record ergänzen:

```tsx
  einheiten: <EinheitenPage />,
  einsatzabschnitte: <EinsatzabschnittePage />,
```

- [ ] **Step 6: FE-Gesamttest + Build**

Run: `cd frontend && npm run build && npx vitest run`
Expected: PASS (alle FE-Tests grün, kein Typfehler — `MODUL_ELEMENTE[m.key]` rendert jetzt echte Seiten statt `ModulStub`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/App.tsx
git commit -m "feat(fe): Einheiten & Einsatzabschnitte als fertige Module verdrahten"
```

---

## Abschluss: Gesamtverifikation

- [ ] **Backend gesamt**

Run: `cargo test`
Expected: PASS (Lib- + alle Integrationstests inkl. `einheit_typ`, `einsatzabschnitt`, `einsatz_einheit`).

- [ ] **Frontend gesamt**

Run: `cd frontend && npm run build && npx vitest run`
Expected: PASS, kein Typfehler.

- [ ] **Manuelle Sichtprüfung (optional, via `/run`-Skill)**

Einsatz öffnen → Einheiten-Modul: Einheit bilden, Typ/Abschnitt/Über-Einheit setzen, freie Person/Fahrzeug zuordnen, Führer markieren, Soll/Ist prüfen, auflösen. Einsatzabschnitte-Modul: Abschnitt-Baum anlegen, Leiter setzen, zugeordnete Einheiten read-only sehen. Stammdaten → Einheitstypen: als Admin anlegen/bearbeiten/deaktivieren. ETB prüfen: sinntragende Ereignisse erscheinen als `system`-Einträge.

