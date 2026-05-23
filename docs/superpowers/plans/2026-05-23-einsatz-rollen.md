# Einsatz & Rollen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einsätze anlegen, ihren Lebenszyklus (aktiv → abgeschlossen, read-only) führen, Mitglieder mit Einsatz-Rollen (Einsatzleitung/Führungspersonal/Beobachter) verwalten und alle Einsatz-Endpunkte korrekt autorisieren — als operatives Fundament, auf dem der ETB-Kern (Plan 4) aufsetzt.

**Architecture:** Aufbauend auf Plan 1 (Config, Pool, Router, `AppState`) und Plan 2 (`AppError`, Sessions, `CurrentUser`-Extractor). Eine **neue, orthogonale System-/Org-Rolle** (`benutzer.org_rolle`) entscheidet, wer Einsätze anlegen darf — getrennt von der bestehenden `system_rolle` (admin/keiner). Pro Einsatz gibt es **Mitgliedschaften** mit genau einer **Einsatz-Rolle**. Autorisierung erfolgt über kleine, testbare Guard-Funktionen (`fordere_mitglied`, `fordere_einsatzleitung`, `fordere_aktiv`), die Handler nach dem Laden des Einsatzes aufrufen — keine path-parameter-Extractors. Der Ersteller eines Einsatzes wird automatisch dessen Einsatzleitung (löst das Henne-Ei-Problem). Der System-Admin hat **bewusst keinen** impliziten Einsatz-Zugriff (strikte Trennung, vom Auftraggeber so entschieden).

**Tech Stack:** Rust (Edition 2021), Axum 0.8, sqlx 0.8 (SQLite, Runtime-Queries — keine Compile-Time-Makros), bestehende Deps genügen (kein neuer Crate). Tests: `tower::ServiceExt::oneshot` + `db::test_pool()` (In-Memory) für Integration, Unit-Tests pro Modul.

---

## Plan-Hinweise

- **Commits:** Jede Commit-Nachricht endet mit der Zeile `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (Repo-Konvention). In den Schritten unten der Kürze halber weggelassen.
- **Branch:** Vor Beginn einen Feature-Branch anlegen (z.B. `feat/einsatz-rollen`), nicht direkt auf `main` arbeiten. Umsetzung idealerweise in isoliertem Worktree.
- **TDD-Stil:** Wie Plan 1/2 — Code und Test werden gemeinsam geschrieben und der Test soll am Ende **bestehen** (repo-konsistent, nicht streng red-green).
- **Reihenfolge:** Tasks sind so geordnet, dass nach jedem Task `cargo build` und `cargo test` grün sind. Module werden erst in `lib.rs` eingetragen, wenn sie existieren; Routen erst verdrahtet, wenn ihre Handler existieren.
- **Fachsprache:** BOS-/Führungsbegriffe in Code-Identifiern und Texten (`Einsatz`, `Einsatzleitung`, `Führungspersonal`, `Beobachter`).

---

## Design-Entscheidungen (fixiert)

| Entscheidung | Wert | Begründung |
|---|---|---|
| Wer darf Einsätze anlegen | `system_rolle = 'admin'` **ODER** `org_rolle = 'fuehrungskraft'` | Auftraggeber: „Rollen außerhalb des einsatzbezogenen Modells; Admins und Führungspersonal". Capability statt fester Rolle. |
| Mechanismus der Anlege-Berechtigung | **Neue Spalte** `benutzer.org_rolle TEXT` (`'fuehrungskraft'` \| `'keine'`, Default `'keine'`) | Orthogonale Achse zu `system_rolle`. **Alternative verworfen:** `system_rolle`-CHECK um `'fuehrungskraft'` erweitern → erzwingt riskanten SQLite-Tabellen-Rebuild (CHECK nicht änderbar) und macht admin/fuehrungskraft fälschlich exklusiv. Separate Spalte ist eine triviale `ALTER TABLE ADD COLUMN`-Migration. |
| Naming-Disambiguierung | System-Rolle heißt `fuehrungskraft`, Einsatz-Rolle heißt `fuehrungspersonal` | Bewusst unterschiedliche Bezeichner, damit „darf Einsatz anlegen" (org-weit) und „voller Schreibzugriff im Einsatz" (pro Einsatz) nicht verwechselt werden. |
| Granularität der Anlege-Rolle | **Ein** Sammelwert `fuehrungskraft` (statt „FüKW-Personal" vs. „anderes Führungspersonal" separat) | Bewusste Vereinfachung: die Befugnis ist binär (darf anlegen / nicht). Der Auftraggeber nannte mehrere Personengruppen — diese werden zunächst unter einem Wert zusammengefasst. **Spätere Differenzierung** ist offen: zusätzliche `org_rolle`-Werte per CHECK-Erweiterung möglich. Falls schon jetzt mehrere unterscheidbare Führungsrollen gewünscht sind → vor Umsetzung melden. |
| Ersteller-Rolle | Ersteller eines Einsatzes wird automatisch `einsatzleitung` | Löst das Henne-Ei-Problem (vor Anlage gibt es keine Einsatzleitung). |
| Admin-Zugriff auf Einsätze | **Keiner** — strikt getrennt | Auftraggeber-Entscheidung. Konsequenz: ein Einsatz ohne aktive Einsatzleitung kann „feststecken" (in T1 akzeptiert; keine Wiedereröffnung/kein Admin-Override). |
| Einsatz-Lebenszyklus | `aktiv` → `abgeschlossen`; abgeschlossen = read-only, keine Wiedereröffnung | Spec Abschnitt 9. Nur Einsatzleitung schließt ab. |
| Letzte Einsatzleitung schützen | Herabstufung (PUT) **und** Entfernen (DELETE) der einzigen Einsatzleitung → 409 | Analog zum „letzter Admin"-Schutz aus Plan 2; verhindert verwaiste Einsätze. |
| Einsatz-Rolle in Rust | Kleine `enum EinsatzRolle` mit `parse`/`as_str`/`ist_einsatzleitung`; DB speichert TEXT mit CHECK | Zentralisiert gültige Werte und Parsing; enum nicht in `FromRow` (Decode als `String`, manuelle Konvertierung — vermeidet sqlx-Reibung, konsistent mit Plan 2). Keine `darf_schreiben()`-Methode in Plan 3 (YAGNI — kommt mit dem ETB-Schreibpfad in Plan 4). |
| Sichtbarkeit der Einsatz-Liste | Jeder angemeldete Benutzer sieht alle Einsätze, annotiert mit `meine_rolle` | Single-Org in T1; nötig für Einsatzauswahl. Detail/Mitglieder erfordern Mitgliedschaft. |

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `migrations/0003_einsatz.sql` | `ALTER benutzer ADD org_rolle`; Tabellen `einsatz`, `einsatz_mitgliedschaft` |
| `src/auth/mod.rs` | + `org_rolle` in `Benutzer`/`BenutzerAnzeige`, Konstanten `ORG_ROLLE_FUEHRUNGSKRAFT`/`ORG_ROLLE_KEINE`, `Benutzer::darf_einsatz_anlegen()` |
| `src/auth/session.rs` | SELECT um `b.org_rolle` ergänzen |
| `src/routes/auth.rs` | Login-SELECT um `org_rolle` ergänzen |
| `src/routes/benutzer.rs` | `NeuerBenutzer` + Validierung + INSERT + alle SELECTs um `org_rolle` ergänzen |
| `src/einsatz/mod.rs` | Modul-Sammlung + Domänentypen `Einsatz`, `EinsatzAnzeige`, `MitgliedAnzeige`, `EinsatzRolle`, Konstanten |
| `src/einsatz/repo.rs` | DB-Funktionen: `anlegen`, `laden`, `rolle_von`, `liste_fuer`, `abschliessen`, `mitglieder`, `setze_rolle`, `entferne`, `zaehle_einsatzleitung` |
| `src/einsatz/berechtigung.rs` | Guards: `fordere_mitglied`, `fordere_einsatzleitung`, `fordere_aktiv` |
| `src/routes/einsatz.rs` | HTTP-Handler für alle Einsatz-Endpunkte |
| `src/routes/mod.rs` | + `pub mod einsatz;` |
| `src/app.rs` | Router um Einsatz-Routen erweitern |
| `src/lib.rs` | + `pub mod einsatz;` |
| `tests/einsatz.rs` | Integrationstests (Anlegen, Liste, Detail, Lebenszyklus, Mitglieder) |

---

## Task 1: Migration für Einsatz, Mitgliedschaft und org_rolle

**Files:**
- Create: `migrations/0003_einsatz.sql`
- Test: in `src/db.rs` (Unit-Test ergänzen)

- [ ] **Step 1: Migration anlegen** — `migrations/0003_einsatz.sql`

```sql
-- Org-/Systemweite Rolle, die das ANLEGEN von Einsätzen erlaubt. Orthogonal zu
-- system_rolle: 'fuehrungskraft' = darf Einsätze eröffnen, 'keine' = nicht.
-- Admins dürfen ohnehin (Capability = system_rolle='admin' ODER org_rolle='fuehrungskraft').
ALTER TABLE benutzer
    ADD COLUMN org_rolle TEXT NOT NULL DEFAULT 'keine'
    CHECK (org_rolle IN ('fuehrungskraft', 'keine'));

-- Einsatz: mehrere können parallel aktiv sein. status: 'aktiv' | 'abgeschlossen'.
-- Abgeschlossene Einsätze sind read-only (keine Wiedereröffnung in T1).
CREATE TABLE einsatz (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung       TEXT NOT NULL,
    stichwort         TEXT,
    status            TEXT NOT NULL DEFAULT 'aktiv'
                      CHECK (status IN ('aktiv', 'abgeschlossen')),
    begonnen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    abgeschlossen_at  TEXT,
    abgeschlossen_von INTEGER REFERENCES benutzer(id)
);

-- Mitgliedschaft: ein Benutzer hat in einem Einsatz genau eine Einsatz-Rolle.
CREATE TABLE einsatz_mitgliedschaft (
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id   INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    einsatz_rolle TEXT NOT NULL
                  CHECK (einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal', 'beobachter')),
    zugewiesen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (einsatz_id, benutzer_id)
);

CREATE INDEX idx_mitgliedschaft_benutzer ON einsatz_mitgliedschaft(benutzer_id);
```

- [ ] **Step 2: Test in `src/db.rs` ergänzen** — im bestehenden `#[cfg(test)] mod tests`-Block diesen Test hinzufügen (nach `auth_migration_creates_tables_and_constraints`):

```rust
    #[tokio::test]
    async fn einsatz_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // org_rolle: Default ist 'keine'.
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
        let org_rolle: String =
            sqlx::query_scalar("SELECT org_rolle FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(org_rolle, "keine");

        // org_rolle-CHECK lehnt ungültigen Wert ab.
        let bad_org = sqlx::query("UPDATE benutzer SET org_rolle = 'chef' WHERE benutzername = 'leit'")
            .execute(&pool)
            .await;
        assert!(bad_org.is_err(), "ungültige org_rolle muss abgelehnt werden");

        // Einsatz anlegen: status-Default ist 'aktiv'.
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Sturmlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "aktiv");

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz SET status = 'pausiert' WHERE id = ?")
            .bind(einsatz_id)
            .execute(&pool)
            .await;
        assert!(bad_status.is_err(), "ungültiger status muss abgelehnt werden");

        // Mitgliedschaft anlegen + einsatz_rolle-CHECK.
        let benutzer_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'einsatzleitung')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .unwrap();

        let bad_rolle = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'haeuptling')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(bad_rolle.is_err(), "ungültige einsatz_rolle muss abgelehnt werden");

        // PK (einsatz_id, benutzer_id) verhindert Doppel-Mitgliedschaft.
        let dup = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'beobachter')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelte Mitgliedschaft muss abgelehnt werden");
    }
```

- [ ] **Step 3: Test ausführen (soll bestehen)**

Run: `cargo test --lib db::tests::einsatz_migration_creates_tables_and_constraints`
Expected: PASS — Tabellen existieren, Defaults greifen, CHECK- und PK-Constraints wirken.

- [ ] **Step 4: Gesamte Testsuite ausführen (Regression)**

Run: `cargo test`
Expected: PASS — alle bestehenden Tests bleiben grün (die neue Spalte hat einen Default und bricht keine alten Inserts).

- [ ] **Step 5: Commit**

```bash
git add migrations/0003_einsatz.sql src/db.rs
git commit -m "feat: Migration für einsatz, einsatz_mitgliedschaft und org_rolle"
```

---

## Task 2: org_rolle in Auth- und Benutzer-Code verdrahten

Die neue Spalte `org_rolle` muss überall mitgeführt werden, wo `Benutzer`/`BenutzerAnzeige` aus der DB geladen werden, sonst schlägt `FromRow` zur Laufzeit fehl. Außerdem soll der Admin beim Anlegen eines Benutzers `org_rolle = 'fuehrungskraft'` setzen können.

**Files:**
- Modify: `src/auth/mod.rs`
- Modify: `src/auth/session.rs`
- Modify: `src/routes/auth.rs`
- Modify: `src/routes/benutzer.rs`
- Test: in `src/auth/mod.rs` (Unit-Test) + `tests/benutzer.rs` (Integrationstest)

- [ ] **Step 1: `src/auth/mod.rs` — Konstanten, Felder und Capability ergänzen**

Nach den bestehenden `ROLLE_*`-Konstanten zwei neue ergänzen:

```rust
/// Org-weite Rolle, die das Anlegen von Einsätzen erlaubt (orthogonal zu `system_rolle`).
pub const ORG_ROLLE_FUEHRUNGSKRAFT: &str = "fuehrungskraft";
/// Org-weite Rolle ohne besondere Befugnisse (Default).
pub const ORG_ROLLE_KEINE: &str = "keine";
```

Im `struct Benutzer` das Feld `org_rolle` ergänzen (nach `system_rolle`):

```rust
    pub system_rolle: String,
    pub org_rolle: String,
    pub aktiv: bool,
```

Im `struct BenutzerAnzeige` ebenfalls (nach `system_rolle`):

```rust
    pub system_rolle: String,
    pub org_rolle: String,
    pub aktiv: bool,
```

In `Benutzer::anzeige()` das neue Feld mitkopieren (nach `system_rolle: ...`):

```rust
            system_rolle: self.system_rolle.clone(),
            org_rolle: self.org_rolle.clone(),
            aktiv: self.aktiv,
```

Im `impl Benutzer`-Block die Capability-Methode ergänzen (nach `ist_admin`):

```rust
    /// Ob dieser Benutzer Einsätze anlegen darf: System-Admin ODER org-weite Führungskraft.
    pub fn darf_einsatz_anlegen(&self) -> bool {
        self.ist_admin() || self.org_rolle == ORG_ROLLE_FUEHRUNGSKRAFT
    }
```

Am Ende des bestehenden Codes in `src/auth/mod.rs` einen Unit-Test-Block ergänzen:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn benutzer_mit(system_rolle: &str, org_rolle: &str) -> Benutzer {
        Benutzer {
            id: 1,
            org_id: 1,
            anzeigename: "Test".into(),
            benutzername: "test".into(),
            passwort_hash: "h".into(),
            system_rolle: system_rolle.into(),
            org_rolle: org_rolle.into(),
            aktiv: true,
            erstellt_at: "2026-05-23".into(),
        }
    }

    #[test]
    fn admin_darf_einsatz_anlegen() {
        assert!(benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE).darf_einsatz_anlegen());
    }

    #[test]
    fn fuehrungskraft_darf_einsatz_anlegen() {
        assert!(benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT).darf_einsatz_anlegen());
    }

    #[test]
    fn normaler_benutzer_darf_nicht_anlegen() {
        assert!(!benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE).darf_einsatz_anlegen());
    }
}
```

- [ ] **Step 2: `src/auth/session.rs` — SELECT um `b.org_rolle` ergänzen**

In `benutzer_aus_token` die SELECT-Spaltenliste anpassen. Ersetze:

```rust
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.aktiv, b.erstellt_at \
```

durch:

```rust
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.org_rolle, b.aktiv, b.erstellt_at \
```

- [ ] **Step 3: `src/routes/auth.rs` — Login-SELECT um `org_rolle` ergänzen**

In `login` die SELECT-Spaltenliste anpassen. Ersetze:

```rust
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
```

durch:

```rust
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
```

- [ ] **Step 4: `src/routes/benutzer.rs` — `org_rolle` in Request, Validierung, INSERT und allen SELECTs**

(a) Import erweitern. Ersetze:

```rust
use crate::auth::{password, BenutzerAnzeige, ROLLE_ADMIN, ROLLE_KEINER};
```

durch:

```rust
use crate::auth::{
    password, BenutzerAnzeige, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};
```

(b) `NeuerBenutzer` um ein Feld ergänzen (nach `system_rolle`):

```rust
    /// 'admin' oder 'keiner'; fehlt das Feld, gilt 'keiner'.
    pub system_rolle: Option<String>,
    /// 'fuehrungskraft' oder 'keine'; fehlt das Feld, gilt 'keine'.
    pub org_rolle: Option<String>,
}
```

(c) In `anlegen` nach der `system_rolle`-Validierung die `org_rolle`-Validierung ergänzen (direkt vor `let hash = password::hash(...)`):

```rust
    let org_rolle = req.org_rolle.as_deref().unwrap_or(ORG_ROLLE_KEINE);
    if org_rolle != ORG_ROLLE_FUEHRUNGSKRAFT && org_rolle != ORG_ROLLE_KEINE {
        return Err(AppError::Validation(
            "org_rolle muss 'fuehrungskraft' oder 'keine' sein".into(),
        ));
    }
```

(d) Den INSERT in `anlegen` um `org_rolle` erweitern. Ersetze:

```rust
    let ergebnis = sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(req.anzeigename.trim())
    .bind(req.benutzername.trim())
    .bind(&hash)
    .bind(rolle)
    .execute(&state.pool)
    .await;
```

durch:

```rust
    let ergebnis = sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(req.anzeigename.trim())
    .bind(req.benutzername.trim())
    .bind(&hash)
    .bind(rolle)
    .bind(org_rolle)
    .execute(&state.pool)
    .await;
```

(e) Alle `BenutzerAnzeige`-SELECTs um `org_rolle` ergänzen. Es gibt **drei** Stellen mit dem Muster `SELECT id, anzeigename, benutzername, system_rolle, aktiv, erstellt_at` (in `liste`, am Ende von `anlegen`, am Ende von `deaktivieren`). Ersetze in allen dreien jeweils:

```rust
        "SELECT id, anzeigename, benutzername, system_rolle, aktiv, erstellt_at \
```

durch:

```rust
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at \
```

> Tipp: `replace_all` ist hier sicher, da das Muster identisch ist und nur diese drei `BenutzerAnzeige`-SELECTs betrifft.

(f) Den `Benutzer`-SELECT in `deaktivieren` um `org_rolle` ergänzen. Ersetze:

```rust
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
```

durch:

```rust
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
```

- [ ] **Step 5: Integrationstest für `org_rolle` ergänzen** — in `tests/benutzer.rs` ans Dateiende anfügen:

```rust
#[tokio::test]
async fn admin_legt_fuehrungskraft_an_und_org_rolle_erscheint() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Frieda Führung","benutzername":"frieda","passwort":"friedapw1","org_rolle":"fuehrungskraft"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["org_rolle"], "fuehrungskraft");
}

#[tokio::test]
async fn ungueltige_org_rolle_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"X","benutzername":"x","passwort":"xpasswort1","org_rolle":"chef"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 6: Tests ausführen (sollen bestehen)**

Run: `cargo test`
Expected: PASS — neue Unit-Tests in `auth::tests`, neue Integrationstests in `benutzer`, und **alle bestehenden Tests bleiben grün** (Login/Me/Liste funktionieren mit der zusätzlichen Spalte).

- [ ] **Step 7: Commit**

```bash
git add src/auth/mod.rs src/auth/session.rs src/routes/auth.rs src/routes/benutzer.rs tests/benutzer.rs
git commit -m "feat: org_rolle (Führungskraft) im Benutzer-Modell und in der Benutzerverwaltung"
```

---

## Task 3: einsatz-Modul-Skelett + Domänentypen

**Files:**
- Create: `src/einsatz/mod.rs`
- Create: `src/einsatz/repo.rs` (Platzhalter)
- Create: `src/einsatz/berechtigung.rs` (Platzhalter)
- Modify: `src/lib.rs`
- Test: in `src/einsatz/mod.rs` (Unit-Tests)

- [ ] **Step 1: `src/einsatz/mod.rs` schreiben**

```rust
pub mod berechtigung;
pub mod repo;

use serde::Serialize;

/// Einsatz-Rolle: voller Zugriff + Einsatz-Administration (anlegen/abschließen/Personen).
pub const EINSATZ_ROLLE_LEITUNG: &str = "einsatzleitung";
/// Einsatz-Rolle: voller Lese-/Schreibzugriff im Einsatz, keine Administration.
pub const EINSATZ_ROLLE_FUEHRUNG: &str = "fuehrungspersonal";
/// Einsatz-Rolle: nur lesend.
pub const EINSATZ_ROLLE_BEOBACHTER: &str = "beobachter";

/// Status eines aktiven Einsatzes.
pub const STATUS_AKTIV: &str = "aktiv";
/// Status eines abgeschlossenen (read-only) Einsatzes.
pub const STATUS_ABGESCHLOSSEN: &str = "abgeschlossen";

/// Rolle einer Person innerhalb eines konkreten Einsatzes.
/// Wird als TEXT in der DB gespeichert und manuell konvertiert (kein sqlx-Enum-Decode).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EinsatzRolle {
    Einsatzleitung,
    Fuehrungspersonal,
    Beobachter,
}

impl EinsatzRolle {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            EinsatzRolle::Einsatzleitung => EINSATZ_ROLLE_LEITUNG,
            EinsatzRolle::Fuehrungspersonal => EINSATZ_ROLLE_FUEHRUNG,
            EinsatzRolle::Beobachter => EINSATZ_ROLLE_BEOBACHTER,
        }
    }

    /// Parst einen gespeicherten/übergebenen Rollenstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<EinsatzRolle> {
        match s {
            EINSATZ_ROLLE_LEITUNG => Some(EinsatzRolle::Einsatzleitung),
            EINSATZ_ROLLE_FUEHRUNG => Some(EinsatzRolle::Fuehrungspersonal),
            EINSATZ_ROLLE_BEOBACHTER => Some(EinsatzRolle::Beobachter),
            _ => None,
        }
    }

    /// Ob diese Rolle die Einsatzleitung ist (einzige Rolle mit Einsatz-Administration).
    pub fn ist_einsatzleitung(&self) -> bool {
        matches!(self, EinsatzRolle::Einsatzleitung)
    }
}

/// Interner Einsatz-Datensatz (alle Spalten der Tabelle `einsatz`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Einsatz {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
}

impl Einsatz {
    /// Ob der Einsatz noch aktiv (beschreibbar) ist.
    pub fn ist_aktiv(&self) -> bool {
        self.status == STATUS_AKTIV
    }

    /// API-Darstellung inkl. der Einsatz-Rolle des abfragenden Benutzers
    /// (`None`, wenn dieser kein Mitglied ist).
    pub fn anzeige(&self, meine_rolle: Option<String>) -> EinsatzAnzeige {
        EinsatzAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            stichwort: self.stichwort.clone(),
            status: self.status.clone(),
            begonnen_at: self.begonnen_at.clone(),
            abgeschlossen_at: self.abgeschlossen_at.clone(),
            abgeschlossen_von: self.abgeschlossen_von,
            meine_rolle,
        }
    }
}

/// Öffentliche Einsatz-Darstellung für API-Antworten (ohne `org_id`),
/// inklusive der Rolle des abfragenden Benutzers.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
    pub meine_rolle: Option<String>,
}

/// Mitglied eines Einsatzes für API-Antworten (mit Benutzer-Klartext, ohne Hash).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MitgliedAnzeige {
    pub benutzer_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub einsatz_rolle: String,
    pub zugewiesen_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolle_parse_und_as_str_roundtrip() {
        for s in [
            EINSATZ_ROLLE_LEITUNG,
            EINSATZ_ROLLE_FUEHRUNG,
            EINSATZ_ROLLE_BEOBACHTER,
        ] {
            assert_eq!(EinsatzRolle::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn rolle_parse_unbekannt_ist_none() {
        assert!(EinsatzRolle::parse("chef").is_none());
    }

    #[test]
    fn ist_einsatzleitung_nur_fuer_leitung() {
        assert!(EinsatzRolle::Einsatzleitung.ist_einsatzleitung());
        assert!(!EinsatzRolle::Fuehrungspersonal.ist_einsatzleitung());
        assert!(!EinsatzRolle::Beobachter.ist_einsatzleitung());
    }

    #[test]
    fn einsatz_ist_aktiv_spiegelt_status() {
        let mut e = Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: STATUS_AKTIV.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
        };
        assert!(e.ist_aktiv());
        e.status = STATUS_ABGESCHLOSSEN.into();
        assert!(!e.ist_aktiv());
    }
}
```

- [ ] **Step 2: Platzhalter für die Submodule anlegen** (werden in Task 4/5 gefüllt):

`src/einsatz/repo.rs`:

```rust
// Inhalt folgt in Task 4.
```

`src/einsatz/berechtigung.rs`:

```rust
// Inhalt folgt in Task 5.
```

- [ ] **Step 3: Modul in `lib.rs` eintragen** — `src/lib.rs` (alphabetisch zwischen `db` und `error`):

```rust
pub mod app;
pub mod auth;
pub mod config;
pub mod db;
pub mod einsatz;
pub mod error;
pub mod routes;
```

- [ ] **Step 4: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib einsatz`
Expected: PASS — `rolle_parse_und_as_str_roundtrip`, `rolle_parse_unbekannt_ist_none`, `ist_einsatzleitung_nur_fuer_leitung`, `einsatz_ist_aktiv_spiegelt_status`.

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/ src/lib.rs
git commit -m "feat: einsatz-Modul mit Domänentypen und EinsatzRolle"
```

---

## Task 4: einsatz/repo.rs — Datenbankzugriff

**Files:**
- Modify: `src/einsatz/repo.rs` (Platzhalter ersetzen)
- Test: in `src/einsatz/repo.rs` (Unit-Tests gegen `test_pool`)

- [ ] **Step 1: `src/einsatz/repo.rs` vollständig schreiben**

```rust
use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG,
    STATUS_ABGESCHLOSSEN,
};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    // Single-Org in T1: alle Einsätze gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let mut tx = pool.begin().await?;
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, stichwort) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(stichwort)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    laden(pool, einsatz_id).await
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    sqlx::query_as::<_, Einsatz>(
        "SELECT id, org_id, bezeichnung, stichwort, status, begonnen_at, \
                abgeschlossen_at, abgeschlossen_von \
         FROM einsatz WHERE id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Liefert die Einsatz-Rolle eines Benutzers in einem Einsatz (`None` = kein Mitglied).
pub async fn rolle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<EinsatzRolle>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(rolle.and_then(|s| EinsatzRolle::parse(&s)))
}

/// Alle Einsätze, annotiert mit der Rolle des angegebenen Benutzers (`meine_rolle`).
pub async fn liste_fuer(
    pool: &SqlitePool,
    benutzer_id: i64,
) -> Result<Vec<EinsatzAnzeige>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        bezeichnung: String,
        stichwort: Option<String>,
        status: String,
        begonnen_at: String,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        meine_rolle: Option<String>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, m.einsatz_rolle AS meine_rolle \
         FROM einsatz e \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| EinsatzAnzeige {
            id: r.id,
            bezeichnung: r.bezeichnung,
            stichwort: r.stichwort,
            status: r.status,
            begonnen_at: r.begonnen_at,
            abgeschlossen_at: r.abgeschlossen_at,
            abgeschlossen_von: r.abgeschlossen_von,
            meine_rolle: r.meine_rolle,
        })
        .collect())
}

/// Schließt einen Einsatz ab (nur wenn aktuell `aktiv`) und lädt ihn neu.
/// Das `status = 'aktiv'`-Prädikat im WHERE schützt gegen Races; die fachliche
/// 409-Prüfung erfolgt zusätzlich im Handler.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    von_benutzer_id: i64,
) -> Result<Einsatz, AppError> {
    sqlx::query(
        "UPDATE einsatz \
         SET status = ?, abgeschlossen_at = datetime('now'), abgeschlossen_von = ? \
         WHERE id = ? AND status = 'aktiv'",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(von_benutzer_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    laden(pool, einsatz_id).await
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at \
         FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id \
         WHERE m.einsatz_id = ? \
         ORDER BY m.zugewiesen_at, m.benutzer_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Setzt (oder aktualisiert) die Einsatz-Rolle eines Benutzers in einem Einsatz.
pub async fn setze_rolle(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?) \
         ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET einsatz_rolle = excluded.einsatz_rolle",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Entfernt eine Mitgliedschaft (idempotent).
pub async fn entferne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?")
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Anzahl der Einsatzleitungen in einem Einsatz (für den „letzte Leitung"-Schutz).
pub async fn zaehle_einsatzleitung(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ?",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::{EINSATZ_ROLLE_BEOBACHTER, STATUS_ABGESCHLOSSEN};

    /// Legt Org (id=1) + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h')",
        )
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn anlegen_macht_ersteller_zur_einsatzleitung() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let einsatz = anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
            .await
            .unwrap();
        assert_eq!(einsatz.bezeichnung, "Hochwasser");
        assert_eq!(einsatz.stichwort.as_deref(), Some("Deichbruch"));
        assert!(einsatz.ist_aktiv());

        let rolle = rolle_von(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
    }

    #[tokio::test]
    async fn rolle_von_fuer_nicht_mitglied_ist_none() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
    }

    #[tokio::test]
    async fn abschliessen_setzt_status_und_von() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.status, STATUS_ABGESCHLOSSEN);
        assert!(abgeschlossen.abgeschlossen_at.is_some());
        assert_eq!(abgeschlossen.abgeschlossen_von, Some(leit));
        assert!(!abgeschlossen.ist_aktiv());
    }

    #[tokio::test]
    async fn setze_rolle_legt_an_und_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Beobachter)
        );

        // Upsert: dieselbe (einsatz, benutzer)-Kombination aktualisiert die Rolle.
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Fuehrungspersonal)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Fuehrungspersonal)
        );
    }

    #[tokio::test]
    async fn entferne_loescht_mitgliedschaft() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        entferne(&pool, einsatz.id, erika).await.unwrap();
        assert_eq!(rolle_von(&pool, einsatz.id, erika).await.unwrap(), None);
    }

    #[tokio::test]
    async fn zaehle_einsatzleitung_zaehlt_nur_leitungen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 1);

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Einsatzleitung)
            .await
            .unwrap();
        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn liste_fuer_annotiert_meine_rolle() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Ersteller sieht sich als Einsatzleitung.
        let fuer_leit = liste_fuer(&pool, leit).await.unwrap();
        assert_eq!(fuer_leit.len(), 1);
        assert_eq!(fuer_leit[0].id, einsatz.id);
        assert_eq!(fuer_leit[0].meine_rolle.as_deref(), Some(EINSATZ_ROLLE_LEITUNG));

        // Nicht-Mitglied sieht den Einsatz, aber ohne Rolle.
        let fuer_fremd = liste_fuer(&pool, fremd).await.unwrap();
        assert_eq!(fuer_fremd.len(), 1);
        assert_eq!(fuer_fremd[0].meine_rolle, None);
    }
}
```

- [ ] **Step 2: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib einsatz::repo`
Expected: PASS — Anlegen-Roundtrip, Rollen-Auflösung, Abschließen, Upsert, Entfernen, Zählen, Listen-Annotation.

- [ ] **Step 3: Commit**

```bash
git add src/einsatz/repo.rs
git commit -m "feat: einsatz-Repository (Anlegen, Lebenszyklus, Mitglieder)"
```

---

## Task 5: einsatz/berechtigung.rs — Autorisierungs-Guards

**Files:**
- Modify: `src/einsatz/berechtigung.rs` (Platzhalter ersetzen)
- Test: in `src/einsatz/berechtigung.rs` (Unit-Tests)

- [ ] **Step 1: `src/einsatz/berechtigung.rs` vollständig schreiben**

```rust
use super::{Einsatz, EinsatzRolle};
use crate::error::AppError;

/// Stellt sicher, dass der Benutzer Mitglied (irgendeine Einsatz-Rolle) ist.
/// Liefert die Rolle zurück oder `AppError::Forbidden` (kein Mitglied).
pub fn fordere_mitglied(rolle: Option<EinsatzRolle>) -> Result<EinsatzRolle, AppError> {
    rolle.ok_or(AppError::Forbidden)
}

/// Stellt sicher, dass der Benutzer die Einsatzleitung ist.
/// `Forbidden`, wenn keine Mitgliedschaft oder andere Rolle.
pub fn fordere_einsatzleitung(rolle: Option<EinsatzRolle>) -> Result<(), AppError> {
    match rolle {
        Some(r) if r.ist_einsatzleitung() => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

/// Stellt sicher, dass der Einsatz noch aktiv (beschreibbar) ist.
/// `Conflict` (409) bei abgeschlossenem (read-only) Einsatz.
pub fn fordere_aktiv(einsatz: &Einsatz) -> Result<(), AppError> {
    if einsatz.ist_aktiv() {
        Ok(())
    } else {
        Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::{STATUS_ABGESCHLOSSEN, STATUS_AKTIV};

    fn einsatz_mit_status(status: &str) -> Einsatz {
        Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: status.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
        }
    }

    #[test]
    fn fordere_mitglied_ohne_rolle_ist_forbidden() {
        let err = fordere_mitglied(None).unwrap_err();
        assert!(matches!(err, AppError::Forbidden));
    }

    #[test]
    fn fordere_mitglied_mit_rolle_liefert_rolle() {
        let r = fordere_mitglied(Some(EinsatzRolle::Beobachter)).unwrap();
        assert_eq!(r, EinsatzRolle::Beobachter);
    }

    #[test]
    fn fordere_einsatzleitung_nur_fuer_leitung() {
        assert!(fordere_einsatzleitung(Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(matches!(
            fordere_einsatzleitung(Some(EinsatzRolle::Fuehrungspersonal)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_einsatzleitung(None).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn fordere_aktiv_blockt_abgeschlossene() {
        assert!(fordere_aktiv(&einsatz_mit_status(STATUS_AKTIV)).is_ok());
        assert!(matches!(
            fordere_aktiv(&einsatz_mit_status(STATUS_ABGESCHLOSSEN)).unwrap_err(),
            AppError::Conflict(_)
        ));
    }
}
```

- [ ] **Step 2: Tests ausführen (sollen bestehen)**

Run: `cargo test --lib einsatz::berechtigung`
Expected: PASS — Mitglied/Nicht-Mitglied, Einsatzleitung-Prüfung, Aktiv-/Read-only-Prüfung.

- [ ] **Step 3: Commit**

```bash
git add src/einsatz/berechtigung.rs
git commit -m "feat: Autorisierungs-Guards für Einsatz-Endpunkte"
```

---

## Task 6: Routen — Anlegen, Liste, Detail, Abschließen

**Files:**
- Create: `src/routes/einsatz.rs`
- Modify: `src/routes/mod.rs`
- Modify: `src/app.rs`
- Test: `tests/einsatz.rs` (Integrationstests)

- [ ] **Step 1: `src/routes/einsatz.rs` schreiben**

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_einsatzleitung, fordere_mitglied};
use crate::einsatz::{repo, EinsatzAnzeige, EINSATZ_ROLLE_LEITUNG};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerEinsatz {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
}

/// POST /api/einsaetze — neuen Einsatz anlegen; Ersteller wird Einsatzleitung.
/// Erfordert Anlege-Berechtigung (System-Admin oder org-weite Führungskraft).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Json(req): Json<NeuerEinsatz>,
) -> Result<(StatusCode, Json<EinsatzAnzeige>), AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    if req.bezeichnung.trim().is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    let stichwort = req
        .stichwort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let einsatz = repo::anlegen(&state.pool, req.bezeichnung.trim(), stichwort, benutzer.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(einsatz.anzeige(Some(EINSATZ_ROLLE_LEITUNG.to_string()))),
    ))
}

/// GET /api/einsaetze — alle Einsätze mit der Rolle des Abfragenden (`meine_rolle`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinsatzAnzeige>>, AppError> {
    Ok(Json(repo::liste_fuer(&state.pool, benutzer.id).await?))
}

/// GET /api/einsaetze/{id} — Einsatz-Detail; nur für Mitglieder.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    let rolle = fordere_mitglied(rolle)?;
    Ok(Json(einsatz.anzeige(Some(rolle.as_str().to_string()))))
}

/// POST /api/einsaetze/{id}/abschliessen — Einsatz abschließen (read-only).
/// Nur Einsatzleitung, nur wenn der Einsatz aktuell aktiv ist.
pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_aktiv(&einsatz)?;

    let aktualisiert = repo::abschliessen(&state.pool, id, benutzer.id).await?;
    Ok(Json(aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string()))))
}
```

- [ ] **Step 2: Routen-Modul erweitern** — `src/routes/mod.rs`:

```rust
pub mod auth;
pub mod benutzer;
pub mod einsatz;
pub mod health;
```

- [ ] **Step 3: Router erweitern** — `src/app.rs`.

Die Import-Zeile bleibt in diesem Task **unverändert** (`use axum::{routing::{get, post}, Router};` ist bereits vorhanden). `delete`/`put` werden erst in Task 7 ergänzt — würde man sie schon hier importieren, scheitert `cargo clippy -D warnings` an einer „unused import"-Warnung.

In `build_router` die vier neuen Routen vor `.with_state(state)` einfügen:

```rust
        .route("/api/benutzer/{id}/deaktivieren", post(routes::benutzer::deaktivieren))
        .route("/api/einsaetze", get(routes::einsatz::liste))
        .route("/api/einsaetze", post(routes::einsatz::anlegen))
        .route("/api/einsaetze/{id}", get(routes::einsatz::detail))
        .route("/api/einsaetze/{id}/abschliessen", post(routes::einsatz::abschliessen))
        .with_state(state)
```

- [ ] **Step 4: Integrationstest schreiben** — `tests/einsatz.rs`

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use serde_json::Value;
use tower::ServiceExt;

/// Router + DB mit Bootstrap-Admin (admin / startpw12).
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool })
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar.
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
    assert_eq!(resp.status(), StatusCode::OK, "Login im Test muss klappen");
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

/// Admin legt einen Benutzer an; gibt dessen id zurück. `org_rolle`: z.B. "fuehrungskraft" oder "keine".
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
    assert_eq!(resp.status(), StatusCode::CREATED, "Benutzer anlegen muss klappen");
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    json["id"].as_i64().unwrap()
}

/// Legt als gegebener Cookie-Inhaber einen Einsatz an und liefert (Status, JSON).
async fn einsatz_anlegen(app: &axum::Router, cookie: &str, bezeichnung: &str) -> (StatusCode, Value) {
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
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn normaler_benutzer_darf_keinen_einsatz_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = einsatz_anlegen(&app, &erika, "Verbotene Lage").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_legt_einsatz_an_und_wird_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = einsatz_anlegen(&app, &admin, "Sturmtief").await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Sturmtief");
    assert_eq!(json["status"], "aktiv");
    assert_eq!(json["meine_rolle"], "einsatzleitung");
}

#[tokio::test]
async fn fuehrungskraft_darf_einsatz_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;

    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (status, json) = einsatz_anlegen(&app, &frieda, "Frieda-Lage").await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["meine_rolle"], "einsatzleitung");
}

#[tokio::test]
async fn liste_zeigt_einsatz_mit_meiner_rolle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    einsatz_anlegen(&app, &admin, "Lage A").await;

    // Nicht-Mitglied (normaler Benutzer) sieht den Einsatz ohne Rolle.
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["bezeichnung"], "Lage A");
    assert!(liste[0]["meine_rolle"].is_null());
}

#[tokio::test]
async fn detail_fuer_nicht_mitglied_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn detail_ohne_session_ist_401() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unbekannter_einsatz_detail_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze/999")
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn nur_einsatzleitung_kann_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    // Admin schließt den eigenen Einsatz ab (er ist Einsatzleitung).
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "abgeschlossen");
    assert!(!json["abgeschlossen_at"].is_null());

    // Zweiter Abschluss desselben (bereits abgeschlossenen) Einsatzes → 409.
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn nicht_leitung_kann_nicht_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    // Normaler Benutzer ohne Mitgliedschaft versucht abzuschließen → 403.
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
```

- [ ] **Step 5: Tests ausführen (sollen bestehen)**

Run: `cargo test --test einsatz`
Expected: PASS — Anlege-Berechtigung (403/201), Liste mit `meine_rolle`, Detail-Schutz (401/403/404), Abschließen (200/409/403).

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz.rs src/routes/mod.rs src/app.rs tests/einsatz.rs
git commit -m "feat: Einsatz-Routen Anlegen/Liste/Detail/Abschließen"
```

---

## Task 7: Routen — Mitgliederverwaltung (Liste, Setzen, Entfernen)

**Files:**
- Modify: `src/routes/einsatz.rs`
- Modify: `src/app.rs`
- Test: `tests/einsatz.rs`

- [ ] **Step 1: Imports in `src/routes/einsatz.rs` erweitern** — nur die `use crate::einsatz::{...}`-Zeile ändert sich (`EinsatzRolle` und `MitgliedAnzeige` ergänzen). Ersetze:

```rust
use crate::einsatz::{repo, EinsatzAnzeige, EINSATZ_ROLLE_LEITUNG};
```

durch:

```rust
use crate::einsatz::{repo, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG};
```

(Die `use crate::einsatz::berechtigung::{...}`-Zeile bleibt unverändert.)

- [ ] **Step 2: Mitglieder-Handler an `src/routes/einsatz.rs` anfügen** (ans Dateiende):

```rust
#[derive(Debug, Deserialize)]
pub struct MitgliedRolle {
    /// 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter'.
    pub einsatz_rolle: String,
}

/// GET /api/einsaetze/{id}/mitglieder — Mitgliederliste; nur für Mitglieder.
pub async fn mitglieder(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    repo::laden(&state.pool, id).await?; // 404, wenn der Einsatz nicht existiert
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_mitglied(rolle)?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// PUT /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied hinzufügen oder
/// dessen Rolle ändern. Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Herabstufung.
pub async fn mitglied_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
    Json(req): Json<MitgliedRolle>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let neue_rolle = EinsatzRolle::parse(&req.einsatz_rolle)
        .ok_or_else(|| AppError::Validation("Ungültige einsatz_rolle".into()))?;

    // Ziel-Benutzer muss existieren und aktiv sein.
    let ziel_aktiv: Option<bool> = sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE id = ?")
        .bind(ziel_id)
        .fetch_optional(&state.pool)
        .await?;
    match ziel_aktiv {
        None => return Err(AppError::NotFound),
        Some(false) => return Err(AppError::Validation("Benutzer ist deaktiviert".into())),
        Some(true) => {}
    }

    // Letzte Einsatzleitung nicht herabstufen.
    if neue_rolle != EinsatzRolle::Einsatzleitung {
        let aktuelle = repo::rolle_von(&state.pool, id, ziel_id).await?;
        if aktuelle == Some(EinsatzRolle::Einsatzleitung)
            && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
        {
            return Err(AppError::Conflict(
                "Die letzte Einsatzleitung kann nicht herabgestuft werden".into(),
            ));
        }
    }

    repo::setze_rolle(&state.pool, id, ziel_id, neue_rolle).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}

/// DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id} — Mitglied entfernen.
/// Nur Einsatzleitung, nur bei aktivem Einsatz.
/// Schützt die letzte Einsatzleitung vor Entfernung.
pub async fn mitglied_entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((id, ziel_id)): Path<(i64, i64)>,
) -> Result<Json<Vec<MitgliedAnzeige>>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let meine = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(meine)?;
    fordere_aktiv(&einsatz)?;

    let ziel_rolle = repo::rolle_von(&state.pool, id, ziel_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if ziel_rolle == EinsatzRolle::Einsatzleitung
        && repo::zaehle_einsatzleitung(&state.pool, id).await? <= 1
    {
        return Err(AppError::Conflict(
            "Die letzte Einsatzleitung kann nicht entfernt werden".into(),
        ));
    }

    repo::entferne(&state.pool, id, ziel_id).await?;
    Ok(Json(repo::mitglieder(&state.pool, id).await?))
}
```

- [ ] **Step 3: Router erweitern** — `src/app.rs`. Jetzt werden `delete`/`put` gebraucht. Ersetze:

```rust
use axum::{
    routing::{get, post},
    Router,
};
```

durch:

```rust
use axum::{
    routing::{delete, get, post, put},
    Router,
};
```

Und die drei Mitglieder-Routen vor `.with_state(state)` einfügen (nach der `abschliessen`-Route):

```rust
        .route("/api/einsaetze/{id}/abschliessen", post(routes::einsatz::abschliessen))
        .route("/api/einsaetze/{id}/mitglieder", get(routes::einsatz::mitglieder))
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            put(routes::einsatz::mitglied_setzen),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            delete(routes::einsatz::mitglied_entfernen),
        )
        .with_state(state)
```

- [ ] **Step 4: Integrationstests an `tests/einsatz.rs` anfügen** (ans Dateiende). Diese ergänzenden Helper benutzen die in Task 6 angelegten `setup`, `login_cookie`, `benutzer_anlegen`, `einsatz_anlegen`:

```rust
/// Setzt als Cookie-Inhaber die Rolle eines Ziel-Benutzers in einem Einsatz; liefert den Status.
async fn mitglied_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    ziel_id: i64,
    rolle: &str,
) -> StatusCode {
    let body = format!(r#"{{"einsatz_rolle":"{rolle}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/{ziel_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn einsatzleitung_fuegt_mitglied_hinzu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "fuehrungspersonal").await;
    assert_eq!(status, StatusCode::OK);

    // Erika ist nun Mitglied und kann das Detail sehen.
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["meine_rolle"], "fuehrungspersonal");
}

#[tokio::test]
async fn nicht_leitung_kann_keine_mitglieder_setzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Erika (Nicht-Mitglied) versucht, sich selbst hinzuzufügen → 403.
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let status = mitglied_setzen(&app, &erika, einsatz_id, erika_id, "beobachter").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitglied_mit_ungueltiger_rolle_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "haeuptling").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn mitglied_setzen_fuer_unbekannten_benutzer_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let status = mitglied_setzen(&app, &admin, einsatz_id, 999, "beobachter").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn letzte_einsatzleitung_kann_nicht_herabgestuft_werden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    // admin ist id=1 und einzige Einsatzleitung. Selbst-Herabstufung → 409.
    let status = mitglied_setzen(&app, &admin, einsatz_id, 1, "beobachter").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn letzte_einsatzleitung_kann_nicht_entfernt_werden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/1"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn einsatzleitung_entfernt_mitglied() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    assert_eq!(
        mitglied_setzen(&app, &admin, einsatz_id, erika_id, "beobachter").await,
        StatusCode::OK
    );

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/{erika_id}"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Erika ist kein Mitglied mehr → Detail 403.
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitgliederliste_nur_fuer_mitglieder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_mitgliederaenderung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Einsatz abschließen.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Mitglied setzen auf abgeschlossenem Einsatz → 409 (read-only).
    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "beobachter").await;
    assert_eq!(status, StatusCode::CONFLICT);
}
```

- [ ] **Step 5: Tests ausführen (sollen bestehen)**

Run: `cargo test --test einsatz`
Expected: PASS — Mitglied hinzufügen/entfernen, Rollenwechsel, ungültige Rolle (400), unbekannter Benutzer (404), letzte-Einsatzleitung-Schutz (PUT + DELETE → 409), Mitgliederliste nur für Mitglieder (403), Read-only-Sperre auf abgeschlossenem Einsatz (409).

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatz.rs src/app.rs tests/einsatz.rs
git commit -m "feat: Einsatz-Mitgliederverwaltung mit Rollen und Schutzregeln"
```

---

## Task 8: Abschluss — Gesamttest, Lint, Roadmap

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Gesamte Testsuite ausführen**

Run: `cargo test`
Expected: PASS — alle Unit- und Integrationstests (Plan 1, 2 und 3) grün.

- [ ] **Step 2: Clippy ohne Warnungen**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: Keine Warnungen/Fehler.

- [ ] **Step 3: Formatierung prüfen**

Run: `cargo fmt --check`
Expected: Keine Abweichungen (sonst `cargo fmt` ausführen und Änderungen mitcommitten).

- [ ] **Step 4: Roadmap aktualisieren** — `docs/superpowers/PROGRESS.md`

(a) In der Plan-Tabelle die Zeile für Plan 3 von `⬜` auf erledigt setzen. Ersetze:

```markdown
| 3 | **Einsatz & Rollen** — Einsatz-CRUD, Lebenszyklus (aktiv → abgeschlossen, read-only), Mitgliedschaften, Rollen (Admin/Einsatzleitung/Führungspersonal/Beobachter), Autorisierung | ⬜ |
```

durch (Commit-Hash nach dem tatsächlichen Merge-/Abschluss-Commit einsetzen):

```markdown
| 3 | **Einsatz & Rollen** — Einsatz-CRUD, Lebenszyklus (aktiv → abgeschlossen, read-only), Mitgliedschaften, Rollen (Admin/Einsatzleitung/Führungspersonal/Beobachter), Autorisierung | ✅ **DONE** — auf `main`, Commit `<hash>` |
```

(b) Im Abschnitt „Dateien" den Plan ergänzen (nach der Plan-2-Zeile):

```markdown
- Plan 3 (DONE): `docs/superpowers/plans/2026-05-23-einsatz-rollen.md`
```

(c) Am Dateiende den „Nächster Schritt" aktualisieren. Ersetze:

```markdown
Der aktuelle Code-Stand liegt auf `main` (`cargo test` = 41/41 grün, clippy sauber). **Nächster Schritt: Plan 3 (Einsatz & Rollen).** Nach jedem fertigen Plan diese Tabelle hier aktualisieren.
```

durch:

```markdown
Der aktuelle Code-Stand liegt auf `main` (`cargo test` grün, clippy sauber). **Nächster Schritt: Plan 4 (ETB-Kern + Live + Suche).** Nach jedem fertigen Plan diese Tabelle hier aktualisieren.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: Plan 3 (Einsatz & Rollen) abgeschlossen, Roadmap aktualisiert"
```

---

## Self-Review (vom Planautor durchgeführt)

**1. Spec-Abdeckung (Abschnitte 6, 7, 9):**
- Datenmodell Einsatz (`id`, `org_id`, `bezeichnung`, `stichwort`, `status`, `begonnen_at`, `abgeschlossen_at`, `abgeschlossen_von`) → Task 1 Migration, Task 3 Typ. ✅
- Einsatz-Mitgliedschaft (`einsatz_id`, `benutzer_id`, `einsatz_rolle`) → Task 1. ✅
- Rollen Einsatzleitung/Führungspersonal/Beobachter + Rechte → Task 3 (`EinsatzRolle`), Task 5 (Guards), Task 6/7 (Durchsetzung). ✅
- Admin als System-Rolle, getrennt → strikt umgesetzt (Design-Entscheidung). ✅
- „Wer darf anlegen" inkl. Henne-Ei → `org_rolle`-Capability + Ersteller wird Einsatzleitung (Task 2/6). ✅
- Lebenszyklus aktiv → abgeschlossen, read-only, nur Einsatzleitung, keine Wiedereröffnung → Task 6 (`abschliessen`) + `fordere_aktiv` überall bei Schreibpfaden. ✅
- Rollen pro Einsatz (Person kann je Einsatz andere Rolle haben) → durch Mitgliedschaftstabelle implizit erfüllt; `setze_rolle`-Upsert. ✅

**2. Placeholder-Scan:** Keine „TBD"/„später"/„analog zu"-Lücken; jeder Code-Schritt enthält vollständigen Code. Submodul-Platzhalter (Task 3) sind bewusste, kommentierte Kompilierhilfen, die in Task 4/5 ersetzt werden — kein Inhalts-Platzhalter. ✅

**3. Typ-/Namenskonsistenz:**
- Funktionsnamen `repo::anlegen/laden/rolle_von/liste_fuer/abschliessen/mitglieder/setze_rolle/entferne/zaehle_einsatzleitung` werden in Task 6/7 exakt so aufgerufen. ✅
- Guards `fordere_mitglied/fordere_einsatzleitung/fordere_aktiv` konsistent. ✅
- Konstanten `EINSATZ_ROLLE_LEITUNG/_FUEHRUNG/_BEOBACHTER`, `STATUS_AKTIV/_ABGESCHLOSSEN`, `ORG_ROLLE_FUEHRUNGSKRAFT/_KEINE` durchgängig. ✅
- `org_rolle` als 9. Spalte in jedem `Benutzer`-SELECT und 7. in jedem `BenutzerAnzeige`-SELECT (Task 2 listet alle Stellen explizit). ✅
- Axum-0.8-Pfadsyntax `{id}`/`{benutzer_id}` konsistent mit bestehender `/api/benutzer/{id}/...`-Route. ✅
- Import von `delete`/`put` erst in Task 7 (verhindert „unused import" in Task 6). ✅
