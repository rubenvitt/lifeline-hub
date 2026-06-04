# Lageberichte — strukturierte Lagevorträge (LFH-48) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Führungskraft erfasst den Stand einer Lagebesprechung als strukturierten, vorlagenbasierten Lagebericht (Entwurf → freigegeben); bei Freigabe wird der gerenderte Volltext **transaktional** als unveränderlicher `etb_eintrag` (`typ='lage'`) gesnapshottet, Korrekturen laufen über eine Fortschreibungs-Versionskette, und das Ganze ist anzeig-, druck- und PDF-fähig.

**Architecture:** Ein eigenes, einsatz-skopiertes `lagebericht`-Entity (`src/lagebericht/`, Muster `src/einsatzabschnitt/`) trägt den editierbaren Arbeits-/Versionsstand. Die Berichtsvorlagen (Abschnitts-Schemata) leben als **feste Code-Registry** synchron im Backend (`mod.rs`) und Frontend (`vorlagen.ts`). Bei Freigabe schreibt eine **DB-Transaktion** den serverseitig gerenderten Snapshot über einen neuen `etb_repo::anlegen_tx`-Pfad in den append-only ETB und verknüpft beide Seiten. Live-Updates laufen über den **bestehenden** `/etb/stream`-Kanal (ein neues `lagebericht`-Event, kein neuer Stream).

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TypeScript + Ant Design + TanStack Query, Vitest/Testing-Library + MSW. Frontend ist via rust-embed ins Binary eingebettet.

---

## Quellen / verifizierte Muster

Design-Spec: `docs/superpowers/specs/2026-06-02-lage-lageberichte-design.md` (maßgeblich).

Verifizierte Vorbilder im Code (gegengelesen, nicht geraten):
- Sub-Entity + Routen: `src/einsatzabschnitt/{mod,repo}.rs`, `src/routes/einsatzabschnitt.rs`.
- ETB-Append: `src/etb/repo.rs` (`anlegen`, `EintragDaten`, `lfd_nr`-Logik), `src/etb/mod.rs` (`TYP_LAGE`, `EtbEintragAnzeige`, `normalisiere_zeit`).
- Fehler: `src/error.rs` (`AppError::{NotFound,Validation,Conflict,UnprocessableEntity,Forbidden}`).
- Rechte/Gates: `src/einsatz/berechtigung.rs` (`fordere_lesezugriff`, `fordere_schreibrecht`, `fordere_aktiv`), `src/einsatz/mod.rs` (`EinsatzRolle`).
- Transaktions-Vorbild: `src/auth/bootstrap.rs` (`pool.begin()` / `&mut *tx` / `commit`).
- Migrationen: `migrations/` (sqlx `migrate!("./migrations")`, letzte ist `0037_etb_baustein.sql` → **nächste ist `0038`**), `migrations/0004_etb.sql` (etb_eintrag-Schema + FTS-Trigger auf `inhalt/von/an/veranlassung`).
- Live: `src/live/mod.rs` (`publiziere`, `publiziere_event`), `frontend/src/etb/useEinsatzLiveStream.ts` (eine `/etb/stream`-Verbindung, multiplext alle Events).
- Test-Harness Backend: `tests/einsatzabschnitt.rs` (`db::test_pool`, `build_router(AppState{pool, live})`, `bootstrap_admin`, `oneshot`).
- Frontend: `frontend/src/api/{client,einsaetze}.ts`, `frontend/src/api/types.ts` (`EinsatzAnzeige.meine_rolle`, `EinsatzRolle`), `frontend/src/App.tsx` (`MODUL_ELEMENTE`), `frontend/src/einsatz/modulRegistry.ts` (Eintrag `lageberichte`, aktuell `status:'geplant'`), `frontend/src/pages/EtbPage.tsx` (`darfSchreiben`-Gate), `frontend/src/test/{setup.ts,utils.tsx}` (`renderMitProviders`, MSW `server`), `frontend/src/einsatz/modulRegistry.test.ts` (Test-Stil).

> **Achtung — die Vorab-Recherche der Explore-Agenten hat das Datenmodell teils frei erfunden** (Status `versendet/vorgefuehrt`, single-`inhalt`-CRUD ohne Vorlagen). **Maßgeblich ist allein die Spec:** Status `entwurf|freigegeben`, drei Vorlagen, Abschnitts-Editor, Freigabe-Snapshot, Versionskette. Aus der Recherche werden nur die **mechanischen Idiome** übernommen.

---

## File Structure

**Backend (neu):**
- `migrations/0038_lagebericht.sql` — Tabelle `lagebericht` + additive Spalte `etb_eintrag.lagebericht_id`.
- `src/lagebericht/mod.rs` — Vorlagen-Registry, Datentypen (`Abschnitt`, `LageberichtAnzeige`), `render_snapshot`, Validierung, leeres Skelett. Reine, unit-testbare Logik.
- `src/lagebericht/repo.rs` — CRUD + transaktionale Freigabe + Fortschreibung.
- `src/routes/lagebericht.rs` — HTTP-Handler.
- `tests/lagebericht.rs` — Integrationstests.

**Backend (geändert):**
- `src/etb/repo.rs` — neuer `anlegen_tx`-Pfad (Transaktions-fähig), `anlegen` delegiert; `laden`/Listen-Query um `lagebericht_id` ergänzt.
- `src/etb/mod.rs` — `EtbEintragAnzeige.lagebericht_id`.
- `src/lib.rs` — `pub mod lagebericht;`.
- `src/app.rs` — 5 Routen gemountet.

**Frontend (neu):**
- `frontend/src/lageberichte/vorlagen.ts` — Vorlagen-Registry (Spiegel des Backends), reine Datenstruktur.
- `frontend/src/lageberichte/vorlagen.test.ts` — Synchronitäts-/Strukturtest.
- `frontend/src/api/lageberichte.ts` — API-Wrapper.
- `frontend/src/pages/LageberichtePage.tsx` — Liste, Editor, Detail, Druck.
- `frontend/src/pages/LageberichtePage.test.tsx` — Komponententests.
- `frontend/src/pages/lageberichtePrint.css` — Print-CSS.

**Frontend (geändert):**
- `frontend/src/api/types.ts` — `Lagebericht*`-Typen.
- `frontend/src/einsatz/modulRegistry.ts` — `lageberichte` `status:'geplant'` → `'fertig'`.
- `frontend/src/App.tsx` — `MODUL_ELEMENTE.lageberichte`.
- `frontend/src/etb/useEinsatzLiveStream.ts` — `lagebericht`-Listener.

**Datenmodell-Konvention (Spec §1):** `abschnitte` ist eine JSON-Spalte `[{schluessel, text}]` (Reihenfolge = Vorlage). `zeitstand` wird beim Anlegen/Patchen über `etb::normalisiere_zeit` ins SQLite-Format gebracht, damit es bei Freigabe direkt als `ereigniszeit` (NOT NULL) taugt. `freigegeben_at`/ETB-`received_at` = Server-Jetzt.

---

## Task 1: Migration — Tabelle `lagebericht` + ETB-Verknüpfung

**Files:**
- Create: `migrations/0038_lagebericht.sql`

- [ ] **Step 1: Migration schreiben**

`migrations/0038_lagebericht.sql`:

```sql
-- LFH-48: strukturierte Lageberichte. Einsatz-skopiertes Entity (Vorbild
-- einsatzabschnitt/0014); editierbarer Arbeits-/Versionsstand. Bei Freigabe
-- wird der gerenderte Volltext unveränderlich in einen etb_eintrag (typ='lage')
-- gesnapshottet — der ETB bleibt der manipulationssichere Rechtsstand.
CREATE TABLE lagebericht (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage            TEXT NOT NULL
                       CHECK (vorlage IN ('lagebericht','lagebeurteilung','freitext')),
    titel              TEXT NOT NULL,
    zeitstand          TEXT NOT NULL,            -- beschriebener Lage-Zeitpunkt (SQLite-Format)
    status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben')),
    -- Gefüllte Abschnitte als JSON-Array [{schluessel, text}], Reihenfolge = Vorlage.
    abschnitte         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id      INTEGER REFERENCES lagebericht(id),  -- Fortschreibungs-Kette
    ersteller_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at    TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at     TEXT,
    etb_eintrag_id     INTEGER REFERENCES etb_eintrag(id)   -- gesetzt bei Freigabe
);

CREATE INDEX idx_lagebericht_einsatz ON lagebericht(einsatz_id, status, zeitstand);

-- Additive Rückverlinkung in der ETB-Timeline (Badge "Lagebericht"). Nullable
-- ADD COLUMN ist sicher und berührt die FTS-Trigger (inhalt/von/an/veranlassung) nicht.
ALTER TABLE etb_eintrag ADD COLUMN lagebericht_id INTEGER REFERENCES lagebericht(id);
```

- [ ] **Step 2: Migration anwenden lassen (verifizieren)**

Run: `cargo test --test einsatzabschnitt`
Expected: PASS — die Testsuite ruft `db::test_pool()`, das `sqlx::migrate!("./migrations")` ausführt; ein Syntaxfehler in `0038` ließe alle Tests beim Setup scheitern. Grünes Ergebnis = Migration ist gültig und idempotent einspielbar.

- [ ] **Step 3: Commit**

```bash
git add migrations/0038_lagebericht.sql
git commit -m "feat(be): Migration lagebericht + etb_eintrag.lagebericht_id (LFH-48)"
```

---

## Task 2: ETB-Repo — transaktionsfähiger Anlege-Pfad + `lagebericht_id`

Die Freigabe muss den ETB-Eintrag **innerhalb derselben Transaktion** schreiben wie das Status-Update (Spec: „atomar"; der ETB-Eintrag *ist* der Rechtsstand). Dazu wird die `lfd_nr`-Logik in `anlegen_tx` herausgezogen; `anlegen` delegiert. Die 12 bestehenden Aufrufer von `etb_repo::anlegen` bleiben unverändert. Zusätzlich erhält `EtbEintragAnzeige` das Lese-Feld `lagebericht_id` für das Timeline-Badge.

**Files:**
- Modify: `src/etb/mod.rs:123-139` (Struct `EtbEintragAnzeige`)
- Modify: `src/etb/repo.rs:29-76` (`anlegen` → delegiert an `anlegen_tx`; `laden`-SELECT) und die Listen-Query
- Test: `src/etb/repo.rs` (`#[cfg(test)]`)

- [ ] **Step 1: `lagebericht_id` ins Anzeige-Struct**

In `src/etb/mod.rs`, am Ende von `struct EtbEintragAnzeige` (nach `berichtigt_eintrag_id`):

```rust
    pub berichtigt_eintrag_id: Option<i64>,
    /// Gesetzt, wenn dieser Eintrag der Freigabe-Snapshot eines Lageberichts ist
    /// (Timeline-Badge + Rückverlinkung). Sonst `None`.
    pub lagebericht_id: Option<i64>,
}
```

- [ ] **Step 2: Beide SELECTs um die Spalte ergänzen**

In `src/etb/repo.rs`, Funktion `laden` (das `query_as::<_, EtbEintragAnzeige>`-SELECT): ergänze `e.lagebericht_id` in der Spaltenliste (nach `e.berichtigt_eintrag_id`):

```rust
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id, e.lagebericht_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
         WHERE e.id = ?",
```

Ebenso in der Listen-Query (der `QueryBuilder`, der `build_query_as::<EtbEintragAnzeige>()` aufruft, um Zeile ~165): füge `e.lagebericht_id` zur selektierten Spaltenliste hinzu (analog, direkt nach `e.berichtigt_eintrag_id`).

> Hinweis für den Umsetzer: Öffne `src/etb/repo.rs` und prüfe **beide** Stellen, an denen `EtbEintragAnzeige`-Spalten aufgezählt werden (Volltext-`SELECT` in `laden` + die `QueryBuilder`-`push`-Spaltenliste der Listenfunktion). Eine fehlende Spalte führt zu einem `FromRow`-Laufzeitfehler.

- [ ] **Step 3: `anlegen_tx` einführen und `anlegen` delegieren lassen**

Ersetze in `src/etb/repo.rs` die Funktion `anlegen` (Zeilen 29–60) durch diese beiden Funktionen. Ergänze oben den Import: `use sqlx::SqliteConnection;`.

```rust
/// Legt einen ETB-Eintrag auf einer beliebigen Connection/Transaktion an und
/// liefert die neue `id`. Vergibt `lfd_nr` atomar (`COALESCE(MAX(lfd_nr),0)+1`
/// über alle Einträge desselben Einsatzes); `received_at` per Spalten-Default.
/// Für transaktionale Aufrufer (z. B. Lagebericht-Freigabe), die den Eintrag
/// gemeinsam mit Folge-Updates committen wollen.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EintragDaten<'_>,
) -> Result<i64, AppError> {
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
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Legt einen ETB-Eintrag an und liefert ihn als Anzeige zurück.
/// Dünner Wrapper um `anlegen_tx` auf einer frischen Pool-Connection.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EintragDaten<'_>,
) -> Result<EtbEintragAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    let id = anlegen_tx(&mut conn, einsatz_id, erfasser_id, daten).await?;
    laden(pool, id).await
}
```

- [ ] **Step 4: Test schreiben — `anlegen` liefert `lagebericht_id == None`**

In `src/etb/repo.rs` im `#[cfg(test)] mod tests`-Block (nutze die dort schon vorhandenen Test-Helper für Pool/Setup analog der bestehenden Tests in dieser Datei) einen Test ergänzen:

```rust
#[tokio::test]
async fn anlegen_setzt_lagebericht_id_auf_none() {
    let pool = crate::db::test_pool().await;
    let (einsatz, erfasser) = super::tests_support_setup(&pool).await; // bestehender Setup-Helper dieser Datei
    let a = anlegen(&pool, einsatz, erfasser, EintragDaten {
        typ: crate::etb::TYP_MELDUNG, inhalt: "Test", von: None, an: None, meldeweg: None,
        veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
    }).await.unwrap();
    assert_eq!(a.lagebericht_id, None);
}
```

> Umsetzer: Verwende den **in dieser Datei bereits existierenden** Setup-Helfer (gleiches Muster wie die vorhandenen `repo`-Tests). Falls keiner existiert, lege einen lokalen `async fn setup(pool) -> (einsatz_id, benutzer_id)` analog zu den ETB-`repo`-Tests an (Org + Benutzer + Einsatz per Insert).

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test etb::repo`
Expected: PASS (neuer Test grün; bestehende ETB-Repo-Tests weiterhin grün — `anlegen` verhält sich identisch).

- [ ] **Step 6: Gesamtkompilat verifizieren (12 Aufrufer unverändert)**

Run: `cargo build`
Expected: erfolgreich — `EintragDaten` ist unverändert, daher kompilieren alle 12 bestehenden `anlegen`-Aufrufer (etb, einsatz_uhs, …) ohne Anpassung.

- [ ] **Step 7: Commit**

```bash
git add src/etb/mod.rs src/etb/repo.rs
git commit -m "feat(be): etb_repo::anlegen_tx + EtbEintragAnzeige.lagebericht_id (LFH-48)"
```

---

## Task 3: `src/lagebericht/mod.rs` — Vorlagen-Registry, Render, Validierung (pur)

Reine, DB-freie Logik: die drei Vorlagen (Spec „Berichtsvorlagen"), das deterministische Markdown-Rendering, die Freigabe-Validierung und das leere Abschnitts-Skelett.

**Files:**
- Create: `src/lagebericht/mod.rs`
- Modify: `src/lib.rs` (Modul registrieren)

- [ ] **Step 1: Modul in `src/lib.rs` registrieren**

Füge in `src/lib.rs` bei den `pub mod`-Deklarationen (alphabetisch sinnvoll einsortiert) hinzu:

```rust
pub mod lagebericht;
```

- [ ] **Step 2: Failing test zuerst — Registry + Render + Validierung**

`src/lagebericht/mod.rs` (zunächst nur dieser Test-Block + leere Typen, damit es fehlschlägt). Schreibe die Tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorlagen_haben_erwartete_abschnittszahl() {
        assert_eq!(vorlage("lagebericht").unwrap().abschnitte.len(), 7);
        assert_eq!(vorlage("lagebeurteilung").unwrap().abschnitte.len(), 8);
        assert_eq!(vorlage("freitext").unwrap().abschnitte.len(), 1);
        assert!(vorlage("unsinn").is_none());
    }

    #[test]
    fn abschnitts_schluessel_sind_eindeutig_pro_vorlage() {
        for v in VORLAGEN {
            let mut keys: Vec<&str> = v.abschnitte.iter().map(|a| a.schluessel).collect();
            keys.sort_unstable();
            let vorher = keys.len();
            keys.dedup();
            assert_eq!(keys.len(), vorher, "Doppelter Abschnitts-Schlüssel in {}", v.schluessel);
        }
    }

    #[test]
    fn leere_abschnitte_folgt_vorlagen_reihenfolge() {
        let v = vorlage("freitext").unwrap();
        let leer = leere_abschnitte(v);
        assert_eq!(leer.len(), 1);
        assert_eq!(leer[0].schluessel, "text");
        assert_eq!(leer[0].text, "");
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("freitext").unwrap();
        let abschnitte = vec![Abschnitt { schluessel: "text".into(), text: "Hochwasser steigt.".into() }];
        let a = render_snapshot(v, "Lage 10:00", "2026-06-02 10:00:00", &abschnitte);
        let b = render_snapshot(v, "Lage 10:00", "2026-06-02 10:00:00", &abschnitte);
        assert_eq!(a, b);
        assert!(a.contains("# Lage 10:00"));
        assert!(a.contains("Zeitstand"));
        assert!(a.contains("2026-06-02 10:00:00"));
        assert!(a.contains("Hochwasser steigt."));
    }

    #[test]
    fn validierung_verlangt_alle_abschnitts_schluessel() {
        let v = vorlage("freitext").unwrap();
        // Fehlender Pflicht-Schlüssel → Fehler.
        let leer: Vec<Abschnitt> = vec![];
        assert!(validiere_freigabe(v, &leer).is_err());
        // Schlüssel vorhanden, aber komplett leerer Bericht → Fehler.
        let leer_text = vec![Abschnitt { schluessel: "text".into(), text: "  ".into() }];
        assert!(validiere_freigabe(v, &leer_text).is_err());
        // Struktur vollständig + mind. ein Feld gefüllt → ok (leere Einzelfelder erlaubt).
        let ok = vec![Abschnitt { schluessel: "text".into(), text: "Inhalt".into() }];
        assert!(validiere_freigabe(v, &ok).is_ok());
    }
}
```

- [ ] **Step 3: Test fehlschlagen lassen**

Run: `cargo test lagebericht::`
Expected: FAIL — `vorlage`, `VORLAGEN`, `Abschnitt`, `leere_abschnitte`, `render_snapshot`, `validiere_freigabe` existieren noch nicht.

- [ ] **Step 4: Implementierung**

Oberhalb des Test-Blocks in `src/lagebericht/mod.rs`:

```rust
pub mod repo;

use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// Status-Konstanten.
pub const STATUS_ENTWURF: &str = "entwurf";
pub const STATUS_FREIGEGEBEN: &str = "freigegeben";

/// Ein Abschnitt der Vorlagen-Definition (fest im Code).
pub struct AbschnittDef {
    pub schluessel: &'static str,
    pub label: &'static str,
}

/// Eine Berichtsvorlage: Schlüssel, Anzeigelabel und geordnete Abschnitte.
pub struct VorlageDef {
    pub schluessel: &'static str,
    pub label: &'static str,
    pub abschnitte: &'static [AbschnittDef],
}

/// Vorlagen-Registry (Spec „Berichtsvorlagen"). MUSS synchron zu
/// frontend/src/lageberichte/vorlagen.ts gehalten werden (Schlüssel + Reihenfolge).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "lagebericht",
        label: "Lagevortrag zur Information",
        abschnitte: &[
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "gefahren_schadenlage", label: "Gefahren-/Schadenlage" },
            AbschnittDef { schluessel: "eigene_lage", label: "Eigene Lage" },
            AbschnittDef { schluessel: "lageentwicklung", label: "Lageentwicklung" },
            AbschnittDef { schluessel: "fuehrungsprobleme", label: "Besondere (Führungs-)Probleme" },
            AbschnittDef { schluessel: "antraege_vorschlaege", label: "Anträge und Vorschläge" },
            AbschnittDef { schluessel: "zusammenfassung", label: "Zusammenfassung" },
        ],
    },
    VorlageDef {
        schluessel: "lagebeurteilung",
        label: "Lagevortrag zur Entscheidung",
        abschnitte: &[
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "anlass", label: "Anlass des Lagevortrags" },
            AbschnittDef { schluessel: "beurteilung_schadenlage", label: "Beurteilung der Schadenlage" },
            AbschnittDef { schluessel: "beurteilung_eigene_lage", label: "Beurteilung der eigenen Lage" },
            AbschnittDef { schluessel: "gemeinsame_elemente", label: "Gemeinsame Elemente aller Möglichkeiten" },
            AbschnittDef { schluessel: "entschlussvorschlaege", label: "Entschlussvorschläge" },
            AbschnittDef { schluessel: "abwaegen", label: "Abwägen der Möglichkeiten" },
            AbschnittDef { schluessel: "vorschlag_beste", label: "Vorschlag der besten Möglichkeit" },
        ],
    },
    VorlageDef {
        schluessel: "freitext",
        label: "Freier Bericht",
        abschnitte: &[AbschnittDef { schluessel: "text", label: "Bericht" }],
    },
];

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    VORLAGEN.iter().find(|v| v.schluessel == schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Abschnitt {
    pub schluessel: String,
    pub text: String,
}

/// Leeres Abschnitts-Skelett gemäß Vorlage (Reihenfolge der Vorlage).
pub fn leere_abschnitte(v: &VorlageDef) -> Vec<Abschnitt> {
    v.abschnitte
        .iter()
        .map(|a| Abschnitt { schluessel: a.schluessel.to_string(), text: String::new() })
        .collect()
}

/// Deterministisches Markdown-Rendering des Berichts (Snapshot-Inhalt für das ETB).
/// Reihenfolge = Vorlage; fehlende Abschnitte werden als leer gerendert.
pub fn render_snapshot(v: &VorlageDef, titel: &str, zeitstand: &str, abschnitte: &[Abschnitt]) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {titel}\n\n"));
    out.push_str(&format!("_Zeitstand: {zeitstand}_\n"));
    for def in v.abschnitte {
        let text = abschnitte
            .iter()
            .find(|a| a.schluessel == def.schluessel)
            .map(|a| a.text.trim())
            .unwrap_or("");
        out.push_str(&format!("\n## {}\n", def.label));
        if text.is_empty() {
            out.push_str("_(keine Angabe)_\n");
        } else {
            out.push_str(text);
            out.push('\n');
        }
    }
    out
}

/// Freigabe-Validierung (Spec „Offene Punkte"): Pflicht ist die Abschnitts-*Struktur*
/// (alle Vorlagen-Schlüssel vorhanden), nicht jedes einzelne Feld. Zusätzlich darf der
/// *gesamte* Bericht nicht leer sein.
pub fn validiere_freigabe(v: &VorlageDef, abschnitte: &[Abschnitt]) -> Result<(), AppError> {
    for def in v.abschnitte {
        if !abschnitte.iter().any(|a| a.schluessel == def.schluessel) {
            return Err(AppError::UnprocessableEntity(format!(
                "Abschnitt «{}» fehlt im Bericht",
                def.label
            )));
        }
    }
    if abschnitte.iter().all(|a| a.text.trim().is_empty()) {
        return Err(AppError::UnprocessableEntity(
            "Der Bericht ist leer und kann nicht freigegeben werden".into(),
        ));
    }
    Ok(())
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test lagebericht::mod` (bzw. `cargo test lagebericht::tests`)
Expected: PASS (alle 5 Tests grün). `src/lagebericht/repo.rs` existiert noch nicht → der `pub mod repo;`-Import schlägt fehl; lege in diesem Schritt eine leere Datei `src/lagebericht/repo.rs` mit nur `// folgt in Task 4` an, damit das Modul kompiliert. (Oder kommentiere `pub mod repo;` bis Task 4 aus — bevorzugt: leere Datei anlegen.)

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/lagebericht/mod.rs src/lagebericht/repo.rs
git commit -m "feat(be): Lagebericht-Vorlagenregistry, Render, Validierung (LFH-48)"
```

---

## Task 4: `src/lagebericht/repo.rs` — CRUD (liste, laden, anlegen, aktualisiere)

**Files:**
- Modify/Create: `src/lagebericht/repo.rs`

- [ ] **Step 1: Failing test — anlegen + laden + liste**

`src/lagebericht/repo.rs` — Test-Block (oben den Implementierungscode aus Step 3 ergänzen):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lagebericht::{vorlage, STATUS_ENTWURF};

    async fn setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name, tz_organisation) VALUES (1, 'Orga', 'hilfsorganisation')")
            .execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'Tester', 'tester', 'x', 'keiner', 'keine', 1) RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (1, 'Lage', 'aktiv') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (einsatz, benutzer)
    }

    #[tokio::test]
    async fn anlegen_erzeugt_entwurf_mit_skelett() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "lagebericht", "Lage 10:00", "2026-06-02 10:00:00", ersteller)
            .await.unwrap();
        assert_eq!(lb.vorlage, "lagebericht");
        assert_eq!(lb.status, STATUS_ENTWURF);
        assert_eq!(lb.version, 1);
        assert_eq!(lb.abschnitte.len(), vorlage("lagebericht").unwrap().abschnitte.len());
        assert!(lb.abschnitte.iter().all(|a| a.text.is_empty()));

        let geladen = laden(&pool, einsatz, lb.id).await.unwrap();
        assert_eq!(geladen, lb);
        let alle = liste(&pool, einsatz).await.unwrap();
        assert_eq!(alle.len(), 1);
    }

    #[tokio::test]
    async fn fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "X", "2026-06-02 10:00:00", ersteller).await.unwrap();
        assert!(matches!(laden(&pool, 999, lb.id).await.unwrap_err(), crate::error::AppError::NotFound));
    }

    #[tokio::test]
    async fn aktualisiere_setzt_abschnitte() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "X", "2026-06-02 10:00:00", ersteller).await.unwrap();
        let neu = vec![Abschnitt { schluessel: "text".into(), text: "Inhalt".into() }];
        let upd = aktualisiere(&pool, einsatz, lb.id, LageberichtPatch {
            titel: Some("Neu"), zeitstand: None, abschnitte: Some(&neu),
        }).await.unwrap();
        assert_eq!(upd.titel, "Neu");
        assert_eq!(upd.abschnitte, neu);
    }
}
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cargo test lagebericht::repo`
Expected: FAIL — `anlegen`, `laden`, `liste`, `aktualisiere`, `LageberichtPatch`, `LageberichtAnzeige` fehlen.

- [ ] **Step 3: Implementierung (CRUD)**

Oben in `src/lagebericht/repo.rs`:

```rust
use super::{leere_abschnitte, vorlage, Abschnitt, STATUS_ENTWURF};
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Öffentliche Anzeige eines Lageberichts (Abschnitte aus JSON geparst, Namen aufgelöst).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LageberichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    pub status: String,
    pub abschnitte: Vec<Abschnitt>,
    pub version: i64,
    pub vorgaenger_id: Option<i64>,
    pub ersteller_id: i64,
    pub ersteller_name: String,
    pub erstellt_at: String,
    pub aktualisiert_at: String,
    pub freigegeben_von_id: Option<i64>,
    pub freigegeben_von_name: Option<String>,
    pub freigegeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}

/// Editierbare Felder eines Entwurfs-PATCH. `None` = unverändert.
#[derive(Debug, Default)]
pub struct LageberichtPatch<'a> {
    pub titel: Option<&'a str>,
    pub zeitstand: Option<&'a str>,
    pub abschnitte: Option<&'a [Abschnitt]>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    vorlage: String,
    titel: String,
    zeitstand: String,
    status: String,
    abschnitte: String,
    version: i64,
    vorgaenger_id: Option<i64>,
    ersteller_id: i64,
    ersteller_name: String,
    erstellt_at: String,
    aktualisiert_at: String,
    freigegeben_von_id: Option<i64>,
    freigegeben_von_name: Option<String>,
    freigegeben_at: Option<String>,
    etb_eintrag_id: Option<i64>,
}

const SELECT: &str = "\
    SELECT l.id, l.einsatz_id, l.vorlage, l.titel, l.zeitstand, l.status, l.abschnitte, \
           l.version, l.vorgaenger_id, \
           l.ersteller_id, b1.anzeigename AS ersteller_name, \
           l.erstellt_at, l.aktualisiert_at, \
           l.freigegeben_von_id, b2.anzeigename AS freigegeben_von_name, \
           l.freigegeben_at, l.etb_eintrag_id \
    FROM lagebericht l \
    JOIN benutzer b1 ON b1.id = l.ersteller_id \
    LEFT JOIN benutzer b2 ON b2.id = l.freigegeben_von_id";

fn zu_anzeige(row: Row) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte: Vec<Abschnitt> = serde_json::from_str(&row.abschnitte)
        .map_err(|e| AppError::Internal(format!("Abschnitte-JSON defekt: {e}")))?;
    Ok(LageberichtAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        vorlage: row.vorlage,
        titel: row.titel,
        zeitstand: row.zeitstand,
        status: row.status,
        abschnitte,
        version: row.version,
        vorgaenger_id: row.vorgaenger_id,
        ersteller_id: row.ersteller_id,
        ersteller_name: row.ersteller_name,
        erstellt_at: row.erstellt_at,
        aktualisiert_at: row.aktualisiert_at,
        freigegeben_von_id: row.freigegeben_von_id,
        freigegeben_von_name: row.freigegeben_von_name,
        freigegeben_at: row.freigegeben_at,
        etb_eintrag_id: row.etb_eintrag_id,
    })
}

/// Alle Berichte eines Einsatzes, neueste Fortschreibung/Anlage zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<LageberichtAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT} WHERE l.einsatz_id = ? ORDER BY l.zeitstand DESC, l.id DESC"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(zu_anzeige).collect()
}

/// Lädt einen Bericht (aufgelöst); `NotFound`, wenn nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<LageberichtAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!("{SELECT} WHERE l.id = ? AND l.einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    zu_anzeige(row)
}

/// Legt einen Entwurf mit leerem Abschnitts-Skelett der Vorlage an.
/// Erwartet eine bereits validierte `vorlage` und normalisierten `zeitstand`.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let v = vorlage(vorlage_key).ok_or_else(|| AppError::Validation("Unbekannte Vorlage".into()))?;
    let skelett = serde_json::to_string(&leere_abschnitte(v))
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lagebericht (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vorlage_key)
    .bind(titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(skelett)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Partielles Update eines Entwurfs (Titel/Zeitstand/Abschnitte). `NotFound`,
/// wenn nicht zum Einsatz. Der Entwurfs-Status wird vom Handler geprüft.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: LageberichtPatch<'_>,
) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte_json = match patch.abschnitte {
        Some(a) => Some(serde_json::to_string(a).map_err(|e| AppError::Internal(e.to_string()))?),
        None => None,
    };
    let betroffen = sqlx::query(
        "UPDATE lagebericht SET \
            titel      = CASE WHEN ? THEN ? ELSE titel END, \
            zeitstand  = CASE WHEN ? THEN ? ELSE zeitstand END, \
            abschnitte = CASE WHEN ? THEN ? ELSE abschnitte END, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(patch.titel.is_some()).bind(patch.titel)
    .bind(patch.zeitstand.is_some()).bind(patch.zeitstand)
    .bind(abschnitte_json.is_some()).bind(abschnitte_json.as_deref())
    .bind(id).bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test lagebericht::repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lagebericht/repo.rs
git commit -m "feat(be): Lagebericht-Repo CRUD (anlegen/laden/liste/aktualisiere) (LFH-48)"
```

---

## Task 5: `src/lagebericht/repo.rs` — transaktionale Freigabe + Fortschreibung

**Files:**
- Modify: `src/lagebericht/repo.rs`

- [ ] **Step 1: Failing test — freigeben schreibt genau einen ETB-Eintrag, danach immutable**

Im Test-Block von `src/lagebericht/repo.rs` ergänzen:

```rust
    #[tokio::test]
    async fn freigeben_schreibt_etb_und_macht_immutable() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "Lage 10:00", "2026-06-02 10:00:00", ersteller).await.unwrap();
        let gefuellt = vec![Abschnitt { schluessel: "text".into(), text: "Hochwasser steigt.".into() }];
        aktualisiere(&pool, einsatz, lb.id, LageberichtPatch { titel: None, zeitstand: None, abschnitte: Some(&gefuellt) }).await.unwrap();

        let render = "# Lage 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Bericht\nHochwasser steigt.\n";
        let frei = freigeben(&pool, einsatz, lb.id, ersteller, render, "2026-06-02 10:00:00").await.unwrap();
        assert_eq!(frei.status, super::STATUS_FREIGEGEBEN);
        assert!(frei.etb_eintrag_id.is_some());
        assert_eq!(frei.freigegeben_von_id, Some(ersteller));

        // Genau ein etb_eintrag (typ='lage') mit Rückverweis.
        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'lage' AND lagebericht_id = ?",
        ).bind(einsatz).bind(lb.id).fetch_one(&pool).await.unwrap();
        assert_eq!(anzahl, 1);

        // Nochmals freigeben schlägt fehl (nicht mehr im Entwurf) → kein zweiter Eintrag.
        assert!(freigeben(&pool, einsatz, lb.id, ersteller, render, "2026-06-02 10:00:00").await.is_err());
        let anzahl2: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'lage'",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        assert_eq!(anzahl2, 1);
    }

    #[tokio::test]
    async fn fortschreiben_erzeugt_version_2_mit_vorgaenger() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "Lage 10:00", "2026-06-02 10:00:00", ersteller).await.unwrap();
        let gefuellt = vec![Abschnitt { schluessel: "text".into(), text: "A".into() }];
        aktualisiere(&pool, einsatz, lb.id, LageberichtPatch { titel: None, zeitstand: None, abschnitte: Some(&gefuellt) }).await.unwrap();
        freigeben(&pool, einsatz, lb.id, ersteller, "render", "2026-06-02 10:00:00").await.unwrap();

        let fort = fortschreiben(&pool, einsatz, lb.id, ersteller, "2026-06-02 12:00:00").await.unwrap();
        assert_eq!(fort.version, 2);
        assert_eq!(fort.vorgaenger_id, Some(lb.id));
        assert_eq!(fort.status, STATUS_ENTWURF);
        assert_eq!(fort.vorlage, "freitext");
        // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers (Spec §2).
        assert_eq!(fort.abschnitte, gefuellt);
    }

    #[tokio::test]
    async fn fortschreiben_nur_aus_freigegebenem() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "X", "2026-06-02 10:00:00", ersteller).await.unwrap();
        // Noch Entwurf → Fortschreiben verboten.
        assert!(fortschreiben(&pool, einsatz, lb.id, ersteller, "2026-06-02 12:00:00").await.is_err());
    }
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cargo test lagebericht::repo`
Expected: FAIL — `freigeben`, `fortschreiben` fehlen.

- [ ] **Step 3: Implementierung**

In `src/lagebericht/repo.rs` ergänzen (Imports oben um `STATUS_FREIGEGEBEN` und ETB erweitern):

```rust
use super::STATUS_FREIGEGEBEN;
use crate::etb::{self, repo as etb_repo};
```

Funktionen:

```rust
/// Gibt einen Entwurf frei: schreibt **in einer Transaktion** den gerenderten
/// Snapshot als etb_eintrag (typ='lage', ereigniszeit=zeitstand), verknüpft beide
/// Seiten und setzt den Bericht auf `freigegeben` (danach immutable). Render +
/// Validierung erledigt der Handler. `zeitstand` ist bereits normalisiert.
/// `UnprocessableEntity`, wenn der Bericht nicht (mehr) im Entwurf ist.
pub async fn freigeben(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
    render: &str,
    zeitstand: &str,
) -> Result<LageberichtAnzeige, AppError> {
    let mut tx = pool.begin().await?;

    // 1. ETB-Snapshot anlegen (server-autoritative lfd_nr).
    let etb_id = etb_repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        freigeber_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_LAGE,
            inhalt: render,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(zeitstand),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;

    // 2. Rückverweis vom ETB-Eintrag auf den Lagebericht.
    sqlx::query("UPDATE etb_eintrag SET lagebericht_id = ? WHERE id = ?")
        .bind(id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;

    // 3. Lagebericht freigeben — nur wenn noch Entwurf (verhindert Doppel-Freigabe).
    let betroffen = sqlx::query(
        "UPDATE lagebericht SET status = ?, freigegeben_von_id = ?, freigegeben_at = datetime('now'), \
            etb_eintrag_id = ?, aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? AND status = ?",
    )
    .bind(STATUS_FREIGEGEBEN)
    .bind(freigeber_id)
    .bind(etb_id)
    .bind(id)
    .bind(einsatz_id)
    .bind(STATUS_ENTWURF)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if betroffen == 0 {
        // Rollback verwirft den eben angelegten ETB-Eintrag → kein verwaister Snapshot.
        tx.rollback().await?;
        return Err(AppError::UnprocessableEntity(
            "Bericht ist nicht (mehr) im Entwurf".into(),
        ));
    }

    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Legt aus einem **freigegebenen** Bericht eine neue Entwurfs-Version an
/// (version+1, vorgaenger_id, gleiche Vorlage, **Abschnitts-Inhalte des Vorgängers
/// übernommen** als Ausgangspunkt — die Führungskraft bearbeitet nur die Deltas;
/// das ETB trägt jede freigegebene Version als eigenen Snapshot). `UnprocessableEntity`,
/// wenn der Vorgänger nicht freigegeben ist.
pub async fn fortschreiben(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    ersteller_id: i64,
    zeitstand: &str,
) -> Result<LageberichtAnzeige, AppError> {
    let vorher = laden(pool, einsatz_id, id).await?;
    if vorher.status != STATUS_FREIGEGEBEN {
        return Err(AppError::UnprocessableEntity(
            "Nur freigegebene Berichte können fortgeschrieben werden".into(),
        ));
    }
    let abschnitte_json =
        serde_json::to_string(&vorher.abschnitte).map_err(|e| AppError::Internal(e.to_string()))?;
    let neu_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lagebericht \
            (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, version, vorgaenger_id, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(&vorher.vorlage)
    .bind(&vorher.titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(abschnitte_json)
    .bind(vorher.version + 1)
    .bind(id)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, neu_id).await
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test lagebericht::repo`
Expected: PASS (alle Repo-Tests grün — inkl. Atomaritäts-/Immutabilitäts-Test).

- [ ] **Step 5: Commit**

```bash
git add src/lagebericht/repo.rs
git commit -m "feat(be): Lagebericht-Freigabe (transaktional) + Fortschreibung (LFH-48)"
```

---

## Task 6: Routen + Mount + Integrationstests

**Files:**
- Create: `src/routes/lagebericht.rs`
- Modify: `src/routes/mod.rs` (Modul deklarieren)
- Modify: `src/app.rs` (5 Routen mounten)
- Create: `tests/lagebericht.rs`

- [ ] **Step 1: Handler-Datei schreiben**

`src/routes/lagebericht.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::lagebericht::repo::{self as lagebericht_repo, LageberichtAnzeige, LageberichtPatch};
use crate::lagebericht::{self, render_snapshot, validiere_freigabe, vorlage, Abschnitt};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: Lageberichte des Einsatzes haben sich geändert. Event-Tag `lagebericht`.
fn sse_lagebericht(state: &AppState, einsatz_id: i64, lb_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "lagebericht_id": lb_id }).to_string();
    state.live.publiziere_event(einsatz_id, "lagebericht", data);
}

/// GET /api/einsaetze/{id}/lageberichte — Liste. Nur Lesezugriff (inkl. Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<LageberichtAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(lagebericht_repo::liste(&state.pool, einsatz_id).await?))
}

/// GET /api/einsaetze/{id}/lageberichte/{lid} — Detail. Nur Lesezugriff.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub vorlage: String,
    pub titel: String,
    /// Optionaler Lage-Zeitpunkt (ISO-8601); Default = jetzt.
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/lageberichte — Entwurf anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if vorlage(&body.vorlage).is_none() {
        return Err(AppError::Validation("Unbekannte Vorlage".into()));
    }
    let titel = body.titel.trim().to_string();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => crate::einsatz::repo::jetzt_sqlite(&state.pool).await?,
    };

    let anzeige =
        lagebericht_repo::anlegen(&state.pool, einsatz_id, &body.vorlage, &titel, &zeitstand, benutzer.id)
            .await?;
    sse_lagebericht(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub titel: Option<String>,
    pub zeitstand: Option<String>,
    pub abschnitte: Option<Vec<Abschnitt>>,
}

/// PATCH /api/einsaetze/{id}/lageberichte/{lid} — nur solange Entwurf (sonst 422).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?;
    if vorher.status != lagebericht::STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Nur Entwürfe können bearbeitet werden".into(),
        ));
    }

    let titel = body.titel.as_ref().map(|t| t.trim().to_string());
    if let Some(t) = &titel {
        if t.is_empty() {
            return Err(AppError::Validation("Titel darf nicht leer sein".into()));
        }
    }
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => Some(normalisiere_zeit(z)?),
        None => None,
    };
    // Abschnitts-Schlüssel müssen zur Vorlage gehören.
    if let Some(abs) = &body.abschnitte {
        let v = vorlage(&vorher.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
        for a in abs {
            if !v.abschnitte.iter().any(|d| d.schluessel == a.schluessel) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Unbekannter Abschnitts-Schlüssel «{}»",
                    a.schluessel
                )));
            }
        }
    }

    let anzeige = lagebericht_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        lid,
        LageberichtPatch {
            titel: titel.as_deref(),
            zeitstand: zeitstand.as_deref(),
            abschnitte: body.abschnitte.as_deref(),
        },
    )
    .await?;
    sse_lagebericht(&state, einsatz_id, lid);
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/freigeben — rendert + snapshottet ins ETB.
pub async fn freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
) -> Result<Json<LageberichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let bericht = lagebericht_repo::laden(&state.pool, einsatz_id, lid).await?;
    if bericht.status != lagebericht::STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity("Bericht ist bereits freigegeben".into()));
    }
    let v = vorlage(&bericht.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
    validiere_freigabe(v, &bericht.abschnitte)?;
    let render = render_snapshot(v, &bericht.titel, &bericht.zeitstand, &bericht.abschnitte);

    let anzeige =
        lagebericht_repo::freigeben(&state.pool, einsatz_id, lid, benutzer.id, &render, &bericht.zeitstand)
            .await?;

    // Den neu erzeugten ETB-Eintrag live an die ETB-Ansicht pushen …
    if let Some(etb_id) = anzeige.etb_eintrag_id {
        if let Ok(etb_anzeige) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb_anzeige) {
                state.live.publiziere(einsatz_id, json); // event="etb"
            }
        }
    }
    // … und die Lagebericht-Liste aktualisieren.
    sse_lagebericht(&state, einsatz_id, lid);
    Ok(Json(anzeige))
}

#[derive(Debug, Deserialize)]
pub struct FortschreibenBody {
    pub zeitstand: Option<String>,
}

/// POST /api/einsaetze/{id}/lageberichte/{lid}/fortschreiben — neue Entwurfs-Version.
pub async fn fortschreiben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, lid)): Path<(i64, i64)>,
    Json(body): Json<FortschreibenBody>,
) -> Result<(StatusCode, Json<LageberichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => crate::einsatz::repo::jetzt_sqlite(&state.pool).await?,
    };
    let anzeige =
        lagebericht_repo::fortschreiben(&state.pool, einsatz_id, lid, benutzer.id, &zeitstand).await?;
    sse_lagebericht(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}
```

> **Umsetzer — `jetzt_sqlite` prüfen:** Der Plan nimmt an, dass es einen Helfer für „Server-Jetzt im SQLite-Format" gibt. Prüfe in `src/einsatz/repo.rs`/`src/etb`, ob ein solcher existiert (z. B. wie `received_at`-Default genutzt). Falls **nicht**, ersetze beide `jetzt_sqlite`-Aufrufe durch `chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()` (chrono ist bereits Dependency, s. `src/etb/mod.rs`/`berechtigung.rs`) und entferne den `&state.pool`-Parameter. Das ist die robustere, abhängigkeitsärmere Variante — bevorzugt direkt so umsetzen.

- [ ] **Step 2: Modul deklarieren**

In `src/routes/mod.rs` bei den `pub mod`-Einträgen (alphabetisch) hinzufügen:

```rust
pub mod lagebericht;
```

- [ ] **Step 3: Routen mounten**

In `src/app.rs`, im Router-Aufbau bei den übrigen `/api/einsaetze/{id}/…`-Sub-Routen (z. B. direkt nach den `abschnitte`-Routen) ergänzen. Achte auf die in `app.rs` bereits importierten Methoden-Helfer (`get`, `post`, `patch`):

```rust
        .route(
            "/api/einsaetze/{id}/lageberichte",
            get(routes::lagebericht::liste).post(routes::lagebericht::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}",
            get(routes::lagebericht::detail).patch(routes::lagebericht::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/freigeben",
            post(routes::lagebericht::freigeben),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/fortschreiben",
            post(routes::lagebericht::fortschreiben),
        )
```

> Umsetzer: Übernimm den exakten Routen-Stil aus `src/app.rs` (Pfad-Platzhalter-Syntax `{id}` vs. `:id` — richte dich nach den dort vorhandenen Einträgen) und stelle sicher, dass `post`/`patch`/`get` importiert sind (ggf. Import ergänzen).

- [ ] **Step 4: Kompilieren**

Run: `cargo build`
Expected: erfolgreich.

- [ ] **Step 5: Integrationstests schreiben**

`tests/lagebericht.rs` (Harness 1:1 aus `tests/einsatzabschnitt.rs` übernommen):

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

#[tokio::test]
async fn anlegen_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["vorlage"], "lagebericht");
    assert_eq!(json["status"], "entwurf");
    assert_eq!(json["abschnitte"].as_array().unwrap().len(), 7);

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn freigabe_schreibt_genau_einen_lage_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 10:00"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();

    // Inhalt setzen.
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Hochwasser steigt."}]}"#)).await;
    assert_eq!(s, StatusCode::OK);

    // Freigeben.
    let (s, frei) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(frei["status"], "freigegeben");
    assert!(frei["etb_eintrag_id"].is_i64());

    // Genau ein ETB-Eintrag typ='lage', Inhalt enthält den Text.
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), &admin, None).await;
    let lage: Vec<&Value> = etb.as_array().unwrap().iter().filter(|e| e["typ"] == "lage").collect();
    assert_eq!(lage.len(), 1);
    assert!(lage[0]["inhalt"].as_str().unwrap().contains("Hochwasser steigt."));
    assert_eq!(lage[0]["lagebericht_id"], lid);
}

#[tokio::test]
async fn freigegebener_bericht_nicht_mehr_patchbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;

    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"titel":"Neu"}"#)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn freigabe_leerer_bericht_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn fortschreiben_erzeugt_version_2() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage"}"#)).await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"), &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#)).await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"), &admin, None).await;

    let (s, fort) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/fortschreiben"), &admin,
        Some(r#"{}"#)).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(fort["version"], 2);
    assert_eq!(fort["vorgaenger_id"], lid);
    assert_eq!(fort["status"], "entwurf");
    // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als Ausgangspunkt.
    assert_eq!(fort["abschnitte"][0]["text"], "A");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/lageberichte"), &erika, None).await.0, StatusCode::OK);
    assert_eq!(
        anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/lageberichte"), &erika,
            Some(r#"{"vorlage":"freitext","titel":"X"}"#)).await.0,
        StatusCode::FORBIDDEN
    );
}
```

> **Umsetzer:** Falls die Org-Rolle für den Beobachter-Test anders heißt oder `rolle_setzen`/`benutzer_anlegen` in `tests/einsatzabschnitt.rs` abweichen, übernimm die dortigen Helfer **wörtlich** (sie sind die verifizierte Quelle). Den Nachlauf-Gate-Test (Schreiben nach Abschluss → 409) optional ergänzen analog `tests/einsatzabschnitt.rs`, falls dort ein `abschliessen`-Helfer existiert.

- [ ] **Step 6: Tests laufen lassen**

Run: `cargo test --test lagebericht`
Expected: PASS (alle Integrationstests grün).

- [ ] **Step 7: Volle Backend-Suite**

Run: `rtk proxy cargo test`
Expected: PASS — keine Regression in bestehenden ETB-/Einsatz-Tests (ehrlicher Exit-Code via `rtk proxy`).

- [ ] **Step 8: Commit**

```bash
git add src/routes/lagebericht.rs src/routes/mod.rs src/app.rs tests/lagebericht.rs
git commit -m "feat(be): Lagebericht-Routen + Integrationstests (LFH-48)"
```

---

## Task 7: Frontend — Typen, Vorlagen-Registry, API-Wrapper

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/lageberichte/vorlagen.ts`
- Create: `frontend/src/lageberichte/vorlagen.test.ts`
- Create: `frontend/src/api/lageberichte.ts`

- [ ] **Step 1: Typen ergänzen**

In `frontend/src/api/types.ts` am Ende anfügen:

```typescript
export type LageberichtVorlageKey = 'lagebericht' | 'lagebeurteilung' | 'freitext';
export type LageberichtStatus = 'entwurf' | 'freigegeben';

export interface LageberichtAbschnitt {
  schluessel: string;
  text: string;
}

export interface LageberichtAnzeige {
  id: number;
  einsatz_id: number;
  vorlage: LageberichtVorlageKey;
  titel: string;
  zeitstand: string;
  status: LageberichtStatus;
  abschnitte: LageberichtAbschnitt[];
  version: number;
  vorgaenger_id: number | null;
  ersteller_id: number;
  ersteller_name: string;
  erstellt_at: string;
  aktualisiert_at: string;
  freigegeben_von_id: number | null;
  freigegeben_von_name: string | null;
  freigegeben_at: string | null;
  etb_eintrag_id: number | null;
}
```

- [ ] **Step 2: Failing test — Vorlagen-Registry (Sync mit Backend)**

`frontend/src/lageberichte/vorlagen.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { VORLAGEN, vorlage } from './vorlagen';

describe('Lagebericht-Vorlagen', () => {
  it('hat die drei Backend-Vorlagen mit erwarteter Abschnittszahl', () => {
    expect(vorlage('lagebericht')?.abschnitte.length).toBe(7);
    expect(vorlage('lagebeurteilung')?.abschnitte.length).toBe(8);
    expect(vorlage('freitext')?.abschnitte.length).toBe(1);
    expect(vorlage('unsinn' as never)).toBeUndefined();
  });

  it('hat eindeutige Abschnitts-Schlüssel je Vorlage', () => {
    for (const v of VORLAGEN) {
      const keys = v.abschnitte.map((a) => a.schluessel);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('Schlüssel decken sich mit den Backend-Schlüsseln (Drift-Schutz)', () => {
    expect(vorlage('lagebericht')?.abschnitte.map((a) => a.schluessel)).toEqual([
      'auftrag', 'gefahren_schadenlage', 'eigene_lage', 'lageentwicklung',
      'fuehrungsprobleme', 'antraege_vorschlaege', 'zusammenfassung',
    ]);
    expect(vorlage('lagebeurteilung')?.abschnitte.map((a) => a.schluessel)).toEqual([
      'auftrag', 'anlass', 'beurteilung_schadenlage', 'beurteilung_eigene_lage',
      'gemeinsame_elemente', 'entschlussvorschlaege', 'abwaegen', 'vorschlag_beste',
    ]);
    expect(vorlage('freitext')?.abschnitte.map((a) => a.schluessel)).toEqual(['text']);
  });
});
```

- [ ] **Step 3: Test fehlschlagen lassen**

Run: `cd frontend && pnpm test -- vorlagen`
Expected: FAIL — `./vorlagen` existiert nicht.

- [ ] **Step 4: Vorlagen-Registry implementieren**

`frontend/src/lageberichte/vorlagen.ts` (Spiegel von `src/lagebericht/mod.rs::VORLAGEN`):

```typescript
import type { LageberichtVorlageKey } from '../api/types';

export interface AbschnittDef {
  schluessel: string;
  label: string;
}
export interface VorlageDef {
  schluessel: LageberichtVorlageKey;
  label: string;
  abschnitte: AbschnittDef[];
}

/**
 * Berichtsvorlagen — MUSS synchron zu src/lagebericht/mod.rs::VORLAGEN bleiben
 * (Schlüssel + Reihenfolge; Labels dürfen rein kosmetisch abweichen).
 */
export const VORLAGEN: VorlageDef[] = [
  {
    schluessel: 'lagebericht',
    label: 'Lagevortrag zur Information',
    abschnitte: [
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'gefahren_schadenlage', label: 'Gefahren-/Schadenlage' },
      { schluessel: 'eigene_lage', label: 'Eigene Lage' },
      { schluessel: 'lageentwicklung', label: 'Lageentwicklung' },
      { schluessel: 'fuehrungsprobleme', label: 'Besondere (Führungs-)Probleme' },
      { schluessel: 'antraege_vorschlaege', label: 'Anträge und Vorschläge' },
      { schluessel: 'zusammenfassung', label: 'Zusammenfassung' },
    ],
  },
  {
    schluessel: 'lagebeurteilung',
    label: 'Lagevortrag zur Entscheidung',
    abschnitte: [
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'anlass', label: 'Anlass des Lagevortrags' },
      { schluessel: 'beurteilung_schadenlage', label: 'Beurteilung der Schadenlage' },
      { schluessel: 'beurteilung_eigene_lage', label: 'Beurteilung der eigenen Lage' },
      { schluessel: 'gemeinsame_elemente', label: 'Gemeinsame Elemente aller Möglichkeiten' },
      { schluessel: 'entschlussvorschlaege', label: 'Entschlussvorschläge' },
      { schluessel: 'abwaegen', label: 'Abwägen der Möglichkeiten' },
      { schluessel: 'vorschlag_beste', label: 'Vorschlag der besten Möglichkeit' },
    ],
  },
  {
    schluessel: 'freitext',
    label: 'Freier Bericht',
    abschnitte: [{ schluessel: 'text', label: 'Bericht' }],
  },
];

export function vorlage(schluessel: LageberichtVorlageKey): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}

/** Leeres Abschnitts-Skelett (lokaler Editor-Startzustand). */
export function leereAbschnitte(v: VorlageDef): { schluessel: string; text: string }[] {
  return v.abschnitte.map((a) => ({ schluessel: a.schluessel, text: '' }));
}
```

- [ ] **Step 5: Test grün**

Run: `cd frontend && pnpm test -- vorlagen`
Expected: PASS.

- [ ] **Step 6: API-Wrapper**

`frontend/src/api/lageberichte.ts`:

```typescript
import { apiGet, apiSend } from './client';
import type { LageberichtAbschnitt, LageberichtAnzeige, LageberichtVorlageKey } from './types';

export function listeLageberichte(einsatzId: number): Promise<LageberichtAnzeige[]> {
  return apiGet<LageberichtAnzeige[]>(`/api/einsaetze/${einsatzId}/lageberichte`);
}

export function ladeLagebericht(einsatzId: number, id: number): Promise<LageberichtAnzeige> {
  return apiGet<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte/${id}`);
}

export interface NeuerLagebericht {
  vorlage: LageberichtVorlageKey;
  titel: string;
  zeitstand?: string;
}

export function legeLageberichtAn(einsatzId: number, daten: NeuerLagebericht): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte`, 'POST', daten);
}

export interface LageberichtPatch {
  titel?: string;
  zeitstand?: string;
  abschnitte?: LageberichtAbschnitt[];
}

export function aktualisiereLagebericht(
  einsatzId: number,
  id: number,
  patch: LageberichtPatch,
): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte/${id}`, 'PATCH', patch);
}

export function gibLageberichtFrei(einsatzId: number, id: number): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte/${id}/freigeben`, 'POST');
}

export function schreibeLageberichtFort(
  einsatzId: number,
  id: number,
  zeitstand?: string,
): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(
    `/api/einsaetze/${einsatzId}/lageberichte/${id}/fortschreiben`,
    'POST',
    { zeitstand },
  );
}
```

- [ ] **Step 7: Typecheck + Commit**

Run: `cd frontend && pnpm tsc --noEmit` (oder das projektübliche Lint/Typecheck-Skript)
Expected: keine Fehler.

```bash
git add frontend/src/api/types.ts frontend/src/lageberichte/ frontend/src/api/lageberichte.ts
git commit -m "feat(fe): Lagebericht-Typen, Vorlagen-Registry, API-Wrapper (LFH-48)"
```

---

## Task 8: Frontend — Modul aktivieren, Routing, Live-Stream

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts:66`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`

- [ ] **Step 1: Failing test — Registry meldet `lageberichte` als fertig**

In `frontend/src/einsatz/modulRegistry.test.ts` einen Test ergänzen:

```typescript
  it('Lageberichte-Modul ist fertig (Kategorie lage, ohne Rollensperre)', () => {
    const lb = modulRegistry.find((m) => m.key === 'lageberichte');
    expect(lb).toBeDefined();
    expect(lb?.status).toBe('fertig');
    expect(lb?.kategorie).toBe('lage');
    expect(lb?.benoetigteRolle).toBeUndefined();
  });
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cd frontend && pnpm test -- modulRegistry`
Expected: FAIL — Status ist noch `'geplant'`.

- [ ] **Step 3: Registry-Eintrag auf `'fertig'`**

In `frontend/src/einsatz/modulRegistry.ts` Zeile 66, `status: 'geplant'` → `status: 'fertig'`:

```typescript
  { key: 'lageberichte', kategorie: 'lage', label: 'Lageberichte', icon: TbReport, route: 'lageberichte', status: 'fertig', beschreibung: 'Strukturierte Lageberichte.' },
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm test -- modulRegistry`
Expected: PASS.

- [ ] **Step 5: Page in `App.tsx` verdrahten**

In `frontend/src/App.tsx`: Import ergänzen (zu den statischen Page-Imports oben):

```typescript
import LageberichtePage from './pages/LageberichtePage';
```

Und im `MODUL_ELEMENTE`-Objekt (nach `schaeden`/vor `lagekarte`) einen Eintrag:

```typescript
  lageberichte: <LageberichtePage />,
```

- [ ] **Step 6: Live-Stream-Listener ergänzen**

In `frontend/src/etb/useEinsatzLiveStream.ts`: einen Handler hinzufügen, der die Lageberichte-Liste invalidiert, und ihn registrieren/abmelden + in `onLag` aufnehmen.

Im `useEffect`, bei den `const on…`-Handlern. Invalidiere **beide** Keys — die Liste (`einsatz-lageberichte`) und die Detail-Queries (`einsatz-lagebericht`, Prefix-Match trifft alle offenen Detailseiten), damit auch eine offene Detailseite auf Fremd-Edits live aktualisiert:

```typescript
    const onLagebericht = () => {
      inval('einsatz-lageberichte');
      inval('einsatz-lagebericht');
    };
```

In `onLag` (Buffer-Overflow) ergänzen:

```typescript
      onPerson();
      onLagebericht();
```

Bei den `addEventListener`-Aufrufen:

```typescript
    quelle.addEventListener('lagebericht', onLagebericht);
```

Im Cleanup (`removeEventListener`-Block):

```typescript
      quelle.removeEventListener('lagebericht', onLagebericht);
```

> Der Query-Key `['einsatz-lageberichte', einsatzId]` muss exakt dem Key in `LageberichtePage` (Task 9) entsprechen.

- [ ] **Step 7: Typecheck (Page existiert noch nicht)**

Da `LageberichtePage` erst in Task 9 entsteht, lege jetzt eine minimale Platzhalter-Datei `frontend/src/pages/LageberichtePage.tsx` an, damit Import/Typecheck nicht brechen:

```tsx
export default function LageberichtePage() {
  return null;
}
```

Run: `cd frontend && pnpm tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/einsatz/modulRegistry.test.ts frontend/src/App.tsx frontend/src/etb/useEinsatzLiveStream.ts frontend/src/pages/LageberichtePage.tsx
git commit -m "feat(fe): Lageberichte-Modul aktiviert + Routing + Live-Listener (LFH-48)"
```

---

## Task 9: `LageberichtePage` — Liste + Anlegen (Vorlagen-Auswahl)

Baut die echte Page schrittweise auf: zuerst Liste + Anlegen-Dialog. Editor/Detail/Druck folgen in Task 10/11.

**Files:**
- Modify: `frontend/src/pages/LageberichtePage.tsx`
- Create: `frontend/src/pages/LageberichtePage.test.tsx`

- [ ] **Step 1: Failing test — Liste zeigt Berichte, Anlegen-Button für Schreibberechtigte**

`frontend/src/pages/LageberichtePage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../test/setup';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LageberichtePage from './LageberichtePage';
import type { EinsatzAnzeige, LageberichtAnzeige } from '../api/types';

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

const bericht: LageberichtAnzeige = {
  id: 11, einsatz_id: 7, vorlage: 'freitext', titel: 'Lage 10:00', zeitstand: '2026-06-02 10:00:00',
  status: 'entwurf', abschnitte: [{ schluessel: 'text', text: 'Inhalt' }], version: 1,
  vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'A', erstellt_at: '2026-06-02 10:00:00',
  aktualisiert_at: '2026-06-02 10:00:00', freigegeben_von_id: null, freigegeben_von_name: null,
  freigegeben_at: null, etb_eintrag_id: null,
};

function setup(berichte: LageberichtAnzeige[] = [bericht]) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/lageberichte' },
  );
}

describe('LageberichtePage', () => {
  it('zeigt die Berichte des Einsatzes', async () => {
    setup();
    expect(await screen.findByText('Lage 10:00')).toBeInTheDocument();
  });

  it('zeigt für Schreibberechtigte den Anlegen-Button', async () => {
    setup();
    expect(await screen.findByRole('button', { name: /Neuer Bericht/i })).toBeInTheDocument();
  });

  it('zeigt leeren Zustand ohne Berichte', async () => {
    setup([]);
    expect(await screen.findByText(/Noch keine Lageberichte/i)).toBeInTheDocument();
  });
});
```

> Umsetzer: Pfade/Namen `AuthProvider`, `server`, `renderMitProviders` ggf. an die tatsächlichen Exporte anpassen (s. `EtbPage.test.tsx` als verifiziertes Vorbild — dort exakt nachsehen).

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cd frontend && pnpm test -- LageberichtePage`
Expected: FAIL — Platzhalter rendert `null`.

- [ ] **Step 3: Liste + Anlegen implementieren**

`frontend/src/pages/LageberichtePage.tsx` (ersetzt den Platzhalter):

```tsx
import { App, Breadcrumb, Button, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  legeLageberichtAn,
  listeLageberichte,
  type NeuerLagebericht,
} from '../api/lageberichte';
import type { LageberichtAnzeige } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { VORLAGEN } from '../lageberichte/vorlagen';

export default function LageberichtePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerLagebericht>();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichteQuery = useQuery({
    queryKey: ['einsatz-lageberichte', einsatzId],
    queryFn: () => listeLageberichte(einsatzId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['einsatz-lageberichte', einsatzId] });
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerLagebericht) => legeLageberichtAn(einsatzId, daten),
    onSuccess: () => {
      invalidate();
      setAnlegenOffen(false);
      form.resetFields();
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
    return <Typography.Text type="danger">Einsatz nicht gefunden oder kein Zugriff.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const berichte = berichteQuery.data ?? [];

  const spalten: TableColumnsType<LageberichtAnzeige> = [
    {
      title: 'Titel',
      dataIndex: 'titel',
      render: (titel: string, lb) => (
        <Link to={`/einsaetze/${einsatzId}/lageberichte/${lb.id}`}>{titel}</Link>
      ),
    },
    {
      title: 'Vorlage',
      dataIndex: 'vorlage',
      render: (v: string) => VORLAGEN.find((x) => x.schluessel === v)?.label ?? v,
    },
    { title: 'Zeitstand', dataIndex: 'zeitstand' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: string) => (
        <Tag color={s === 'freigegeben' ? 'green' : 'default'}>
          {s === 'freigegeben' ? 'Freigegeben' : 'Entwurf'}
        </Tag>
      ),
    },
    { title: 'Version', dataIndex: 'version' },
    { title: 'Ersteller', dataIndex: 'ersteller_name' },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Lageberichte' },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Lageberichte
        </Typography.Title>
        {darfSchreiben && (
          <Button type="primary" onClick={() => setAnlegenOffen(true)}>
            Neuer Bericht
          </Button>
        )}
      </Space>

      <Table<LageberichtAnzeige>
        rowKey="id"
        loading={berichteQuery.isLoading}
        dataSource={berichte}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch keine Lageberichte' }}
      />

      <Modal
        open={anlegenOffen}
        title="Neuer Lagebericht"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerLagebericht>
          form={form}
          layout="vertical"
          initialValues={{ vorlage: 'lagebericht' }}
          onFinish={(w) => anlegenMutation.mutate(w)}
        >
          <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Lageüberblick 10:30 Uhr" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Tests grün**

Run: `cd frontend && pnpm test -- LageberichtePage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LageberichtePage.tsx frontend/src/pages/LageberichtePage.test.tsx
git commit -m "feat(fe): LageberichtePage Liste + Anlegen-Dialog (LFH-48)"
```

---

## Task 10: `LageberichtePage` — Detail, Abschnitts-Editor, Freigabe, Fortschreibung

Erweitert die Page um die Detailansicht mit per-Abschnitt-Editor (Entwurf) bzw. Read-Only-Struktur (freigegeben), „Entwurf speichern", „Freigeben" (Bestätigungsdialog) und „Fortschreiben". Realisiert als zweite Route `…/lageberichte/:lbId` mit eigener Detail-Komponente.

**Files:**
- Create: `frontend/src/pages/LageberichtDetailPage.tsx`
- Modify: `frontend/src/App.tsx` (Detail-Route)
- Modify: `frontend/src/pages/LageberichtePage.test.tsx` (Detail-Tests ergänzen)

- [ ] **Step 1: Failing test — Editor rendert Abschnitte je Vorlage; Freigabe-Bestätigung**

In `LageberichtePage.test.tsx` einen zweiten `describe`-Block ergänzen (Import `LageberichtDetailPage` oben):

```tsx
import LageberichtDetailPage from './LageberichtDetailPage';
import userEvent from '@testing-library/user-event';

const lagebericht7Abschnitte: LageberichtAnzeige = {
  ...bericht, id: 12, vorlage: 'lagebericht', titel: 'Lagevortrag',
  abschnitte: [
    { schluessel: 'auftrag', text: '' },
    { schluessel: 'gefahren_schadenlage', text: '' },
    { schluessel: 'eigene_lage', text: '' },
    { schluessel: 'lageentwicklung', text: '' },
    { schluessel: 'fuehrungsprobleme', text: '' },
    { schluessel: 'antraege_vorschlaege', text: '' },
    { schluessel: 'zusammenfassung', text: '' },
  ],
};

function setupDetail(lb: LageberichtAnzeige) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${lb.id}`, () => HttpResponse.json(lb)),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: `/einsaetze/7/lageberichte/${lb.id}` },
  );
}

describe('LageberichtDetailPage', () => {
  it('Entwurf-Editor zeigt ein Feld je Abschnitt der Vorlage', async () => {
    setupDetail(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toBeInTheDocument();
    expect(screen.getByLabelText('Zusammenfassung')).toBeInTheDocument();
    expect(screen.getByLabelText('Gefahren-/Schadenlage')).toBeInTheDocument();
  });

  it('freigegebener Bericht ist read-only mit ETB-Link und Fortschreiben', async () => {
    setupDetail({
      ...lagebericht7Abschnitte, status: 'freigegeben', etb_eintrag_id: 99,
      freigegeben_von_name: 'A', freigegeben_at: '2026-06-02 11:00:00',
    });
    expect(await screen.findByRole('button', { name: /Fortschreiben/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Auftrag')).not.toBeInTheDocument();
  });

  it('Freigeben öffnet einen Bestätigungsdialog', async () => {
    setupDetail({ ...lagebericht7Abschnitte, abschnitte: [{ schluessel: 'auftrag', text: 'X' },
      { schluessel: 'gefahren_schadenlage', text: '' }, { schluessel: 'eigene_lage', text: '' },
      { schluessel: 'lageentwicklung', text: '' }, { schluessel: 'fuehrungsprobleme', text: '' },
      { schluessel: 'antraege_vorschlaege', text: '' }, { schluessel: 'zusammenfassung', text: '' }] });
    await screen.findByRole('button', { name: /Freigeben/i });
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    expect(await screen.findByText(/endgültig|unveränderlich|ETB/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cd frontend && pnpm test -- LageberichtePage`
Expected: FAIL — `LageberichtDetailPage` existiert nicht.

- [ ] **Step 3: Detail-Page implementieren**

`frontend/src/pages/LageberichtDetailPage.tsx`:

```tsx
import { App, Breadcrumb, Button, Form, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { vorlage } from '../lageberichte/vorlagen';

export default function LageberichtDetailPage() {
  const { id, lbId } = useParams();
  const einsatzId = Number(id);
  const berichtId = Number(lbId);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<Record<string, string>>();

  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: ['einsatz-lagebericht', einsatzId, berichtId],
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
  });

  // Formular mit Abschnittstexten füllen, sobald geladen.
  useEffect(() => {
    if (berichtQuery.data) {
      const werte: Record<string, string> = { titel: berichtQuery.data.titel };
      for (const a of berichtQuery.data.abschnitte) werte[a.schluessel] = a.text;
      form.setFieldsValue(werte);
    }
  }, [berichtQuery.data, form]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['einsatz-lagebericht', einsatzId, berichtId] });
    qc.invalidateQueries({ queryKey: ['einsatz-lageberichte', einsatzId] });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const speichernMutation = useMutation({
    mutationFn: (werte: Record<string, string>) => {
      const v = vorlage(berichtQuery.data!.vorlage)!;
      const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => ({
        schluessel: a.schluessel,
        text: werte[a.schluessel] ?? '',
      }));
      return aktualisiereLagebericht(einsatzId, berichtId, { titel: werte.titel, abschnitte });
    },
    onSuccess: () => {
      invalidate();
      message.success('Entwurf gespeichert');
    },
    onError: fehler,
  });

  const freigebenMutation = useMutation({
    mutationFn: () => gibLageberichtFrei(einsatzId, berichtId),
    onSuccess: () => {
      invalidate();
      message.success('Bericht freigegeben');
    },
    onError: fehler,
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeLageberichtFort(einsatzId, berichtId),
    onSuccess: (neu: LageberichtAnzeige) => {
      qc.invalidateQueries({ queryKey: ['einsatz-lageberichte', einsatzId] });
      navigate(`/einsaetze/${einsatzId}/lageberichte/${neu.id}`);
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading || berichtQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (berichtQuery.isError || !berichtQuery.data || !einsatzQuery.data) {
    return <Typography.Text type="danger">Lagebericht nicht gefunden.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const bericht = berichtQuery.data;
  const v = vorlage(bericht.vorlage);
  const istEntwurf = bericht.status === 'entwurf';
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const freigabeBestaetigen = () =>
    Modal.confirm({
      title: 'Lagebericht freigeben?',
      content:
        'Die Freigabe ist endgültig und unveränderlich: Der Bericht wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich.',
      okText: 'Freigeben',
      cancelText: 'Abbrechen',
      onOk: () => freigebenMutation.mutateAsync(),
    });

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={`/einsaetze/${einsatzId}/lageberichte`}>Lageberichte</Link> },
          { title: bericht.titel },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {bericht.titel}
          </Typography.Title>
          <Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>
          <Tag>{v?.label ?? bericht.vorlage}</Tag>
          <Tag>v{bericht.version}</Tag>
        </Space>
        <Space>
          <Button onClick={() => window.print()}>Drucken / als PDF</Button>
          {!istEntwurf && bericht.etb_eintrag_id != null && (
            <Link to={`/einsaetze/${einsatzId}/etb`}>Zum ETB-Eintrag</Link>
          )}
          {!istEntwurf && darfSchreiben && (
            <Button onClick={() => fortschreibenMutation.mutate()} loading={fortschreibenMutation.isPending}>
              Fortschreiben
            </Button>
          )}
          {istEntwurf && darfSchreiben && (
            <>
              <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
                Entwurf speichern
              </Button>
              <Button type="primary" onClick={freigabeBestaetigen} loading={freigebenMutation.isPending}>
                Freigeben
              </Button>
            </>
          )}
        </Space>
      </Space>

      <Typography.Paragraph type="secondary">Zeitstand: {bericht.zeitstand}</Typography.Paragraph>

      {istEntwurf && darfSchreiben ? (
        <Form
          form={form}
          layout="vertical"
          onFinish={(werte) => speichernMutation.mutate(werte as Record<string, string>)}
        >
          <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {v?.abschnitte.map((a) => (
            <Form.Item key={a.schluessel} label={a.label} name={a.schluessel}>
              <Input.TextArea rows={4} />
            </Form.Item>
          ))}
        </Form>
      ) : (
        <div className="lagebericht-druck">
          {v?.abschnitte.map((a) => {
            const text = bericht.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
            return (
              <section key={a.schluessel} style={{ marginBottom: 16 }}>
                <Typography.Title level={5}>{a.label}</Typography.Title>
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                  {text.trim() || '—'}
                </Typography.Paragraph>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Detail-Route in `App.tsx`**

In `frontend/src/App.tsx` Import ergänzen:

```typescript
import LageberichtDetailPage from './pages/LageberichtDetailPage';
```

Und im Einsatz-Workspace-Block (analog zu `unfallhilfsstellen/:uhsId`) eine zusätzliche Route registrieren:

```tsx
          <Route path="lageberichte/:lbId" element={<LageberichtDetailPage />} />
```

> Hinweis: Da `lageberichte` (Liste) bereits über `modulRegistry.map` als `path="lageberichte"` gemountet ist, ergänzt diese Detail-Route das tiefere Segment — exakt wie es bei `unfallhilfsstellen/:uhsId` im selben Block gemacht ist.

- [ ] **Step 5: Tests grün**

Run: `cd frontend && pnpm test -- LageberichtePage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LageberichtDetailPage.tsx frontend/src/App.tsx frontend/src/pages/LageberichtePage.test.tsx
git commit -m "feat(fe): Lagebericht-Detail mit Editor, Freigabe, Fortschreibung (LFH-48)"
```

---

## Task 11: Druck-/PDF-Ansicht (Print-CSS)

Die Detail-Read-Only-Darstellung (`.lagebericht-druck`) ist bereits die Druckvorlage; der „Drucken / als PDF"-Button ruft `window.print()`. Diese Aufgabe ergänzt Print-CSS, das beim Drucken die App-Chrome (Navigation, Buttons, Breadcrumb) ausblendet und nur den Bericht zeigt.

**Files:**
- Create: `frontend/src/pages/lageberichtPrint.css`
- Modify: `frontend/src/pages/LageberichtDetailPage.tsx` (CSS importieren, Druckbereich markieren)

- [ ] **Step 1: Print-CSS schreiben**

`frontend/src/pages/lageberichtPrint.css`:

```css
@media print {
  /* Alles ausblenden, außer dem markierten Druckbereich. */
  body * {
    visibility: hidden;
  }
  .lagebericht-print-root,
  .lagebericht-print-root * {
    visibility: visible;
  }
  .lagebericht-print-root {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
  }
  /* Interaktive Elemente nie drucken. */
  .lagebericht-no-print {
    display: none !important;
  }
}
```

- [ ] **Step 2: In der Detail-Page einbinden**

In `LageberichtDetailPage.tsx`:
- Oben importieren: `import './lageberichtPrint.css';`
- Das äußerste `<div>` der Detail-Page mit `className="lagebericht-print-root"` versehen.
- Die obere Aktions-/Button-`<Space>` (mit „Drucken", „Freigeben" etc.) sowie das `Breadcrumb` mit `className="lagebericht-no-print"` versehen, damit sie im Druck verschwinden.

Beispiel (oberster Container + Aktionsleiste):

```tsx
  return (
    <div className="lagebericht-print-root">
      <Breadcrumb
        className="lagebericht-no-print"
        style={{ marginBottom: 12 }}
        items={/* … unverändert … */}
      />
      <Space className="lagebericht-no-print" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        {/* … Titel + Buttons unverändert … */}
      </Space>
      {/* Rest unverändert */}
```

- [ ] **Step 3: Failing/Smoke-Test — Druck-Root ist vorhanden**

In `LageberichtePage.test.tsx` (Detail-`describe`) ergänzen:

```tsx
  it('rendert einen markierten Druckbereich', async () => {
    const { container } = setupDetail(lagebericht7Abschnitte);
    await screen.findByText('Lagevortrag');
    expect(container.querySelector('.lagebericht-print-root')).not.toBeNull();
  });
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm test -- LageberichtePage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lageberichtPrint.css frontend/src/pages/LageberichtDetailPage.tsx frontend/src/pages/LageberichtePage.test.tsx
git commit -m "feat(fe): Druck-/PDF-Ansicht für Lageberichte (Print-CSS) (LFH-48)"
```

---

## Task 12: ETB-Schnellerfassung — Einstieg „Als strukturierten Lagebericht erfassen" (Spec §3)

Wenn in der ETB-Schnellerfassung der Eintragstyp `lage` gewählt ist, bietet ein sekundärer Button den Sprung in das Lagebericht-Modul (wo „Neuer Bericht" mit Vorlagenwahl startet). Kurze `lage`-Vermerke bleiben unverändert direkt im ETB möglich — der Button ist ein Angebot, kein Zwang.

**Files:**
- Modify: `frontend/src/etb/Schnellerfassung.tsx`
- Modify: `frontend/src/etb/Schnellerfassung.test.tsx`

- [ ] **Step 1: Failing test — Button erscheint nur bei Typ `lage`**

In `frontend/src/etb/Schnellerfassung.test.tsx` ergänzen (Render-Helfer/Props aus den dortigen bestehenden Tests übernehmen; `einsatz` mit `id: 7`, kein `berichtigungZu`):

```tsx
import userEvent from '@testing-library/user-event';

it('zeigt bei Typ „Lage" den Sprung in den strukturierten Lagebericht', async () => {
  renderSchnellerfassung(); // bestehender Helfer dieser Testdatei
  // Standardtyp ist 'meldung' → kein Button.
  expect(screen.queryByRole('button', { name: /strukturierten Lagebericht/i })).not.toBeInTheDocument();
  // Typ auf 'Lage' umstellen.
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByText('Lage'));
  expect(
    await screen.findByRole('button', { name: /strukturierten Lagebericht/i }),
  ).toBeInTheDocument();
});
```

> Umsetzer: `renderSchnellerfassung` an den real existierenden Render-/Setup-Helfer in `Schnellerfassung.test.tsx` anpassen. Den Routing-Kontext (`MemoryRouter`/`renderMitProviders`) so setzen, dass `useNavigate` nicht crasht. Der Combobox-Label/Optionstext richtet sich nach `TYP_LABEL['lage']` (vmtl. „Lage").

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cd frontend && pnpm test -- Schnellerfassung`
Expected: FAIL — Button existiert nicht.

- [ ] **Step 3: Button implementieren**

In `frontend/src/etb/Schnellerfassung.tsx`:
- Import ergänzen: `import { useNavigate } from 'react-router-dom';`
- Im Komponenten-Body: `const navigate = useNavigate();` und den aktuellen Typ beobachten: `const aktTyp = Form.useWatch('typ', form);`
- Direkt nach der `typ`/`inhalt`-`<Space>` (vor dem `Collapse`) einen sekundären Button rendern, nur wenn nicht im Berichtigungsmodus und Typ `lage`:

```tsx
        {!berichtigungZu && aktTyp === 'lage' && (
          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="link"
              style={{ paddingLeft: 0 }}
              onClick={() => navigate(`/einsaetze/${einsatz.id}/lageberichte`)}
            >
              Als strukturierten Lagebericht erfassen →
            </Button>
          </Form.Item>
        )}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm test -- Schnellerfassung`
Expected: PASS (neuer Test grün; bestehende Schnellerfassung-Tests weiterhin grün).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/Schnellerfassung.tsx frontend/src/etb/Schnellerfassung.test.tsx
git commit -m "feat(fe): ETB-Schnellerfassung-Einstieg in strukturierten Lagebericht (LFH-48)"
```

---

## Task 13: Vollständige Verifikation + Build

**Files:** keine (Verifikation)

- [ ] **Step 1: Backend-Gesamtsuite**

Run: `rtk proxy cargo test`
Expected: PASS (alle Tests, keine Regression). `rtk proxy` für ehrlichen Exit-Code.

- [ ] **Step 2: Frontend-Lint/Typecheck**

Run: `cd frontend && pnpm tsc --noEmit` (bzw. projektübliches Lint-Skript, z. B. `pnpm lint`)
Expected: keine Fehler.

- [ ] **Step 3: Frontend-Testsuite**

Run: `cd frontend && pnpm test -- --no-file-parallelism`
Expected: PASS. (`--no-file-parallelism` gegen die bekannte Last-Flakiness der vollen Suite.)

- [ ] **Step 4: Frontend bauen (Embed ins Binary)**

Run: `cd frontend && pnpm build`
Expected: erfolgreich. Das Frontend ist via rust-embed ins Binary eingebettet — ohne `pnpm build` + Backend-Neustart zeigt `cargo run` das alte Bundle.

- [ ] **Step 5: Manuelle Sicht (optional, empfohlen)**

Run: Backend starten (`cargo run`), im Browser einen aktiven Einsatz öffnen → Kategorie „Lage" → „Lageberichte":
- Neuer Bericht (Vorlage wählen) → Editor mit Abschnittsfeldern → Entwurf speichern → Freigeben (Bestätigung) → Bericht erscheint freigegeben, ETB-Eintrag (`typ='lage'`) in der ETB-Timeline mit Volltext → „Fortschreiben" erzeugt v2 → „Drucken / als PDF" zeigt nur den Bericht.

- [ ] **Step 6: Branch abschließen**

REQUIRED SUB-SKILL: Verwende `superpowers:finishing-a-development-branch` für Code-Review, Merge und Integration. Commits/PR referenzieren `LFH-48` im Body.

---

## Self-Review (gegen die Spec geprüft)

- **§1 Datenmodell** → Task 1 (Tabelle + `abschnitte` JSON + `vorgaenger_id` + `etb_eintrag_id`; ALTER für `etb_eintrag.lagebericht_id`). ✓
- **§2 Lebenszyklus** (Entwurf/PATCH-nur-Entwurf/Freigeben/Fortschreiben) → Tasks 4–6. ✓
- **§3 ETB-Integration** (Snapshot, Volltext inline, Badge-Verlinkung via `lagebericht_id`, Einstieg) → Task 2 (`lagebericht_id` auf Anzeige) + Task 5/6 (Snapshot, `typ='lage'`) + Task 12 (sekundärer „Als strukturierten Lagebericht erfassen"-Button in der ETB-Schnellerfassung). ✓
- **§4 Berechtigungen** (Lesen alle, Schreiben/Freigabe/Fortschreiben nur Führung, kein `benoetigteRolle`, Nachlauf-Gate) → Tasks 6 + 8, Tests in Task 6. ✓
- **§5 Backend `src/lagebericht/`** (repo + Registry + Render + Validierung + Routen + Live) → Tasks 3–6. ✓
- **§6 Frontend** (Modul fertig, Liste, Editor, Detail, Druck, eine SSE-Verbindung, reine Registry) → Tasks 7–11. ✓
- **§7 Tests** (Backend: Freigabe=1 ETB-Eintrag, immutable, Fortschreibung v2, Render-Determinismus, Validierung, Rechte; Frontend: Registry/Editor/Freigabe-Bestätigung/Liste/Print; `localStorage`-Polyfill; `--no-file-parallelism`) → über alle Tasks verteilt + Task 13. ✓
- **Nicht-Ziele** (Befehlsgebung, org-konfigurierbare Vorlagen, Server-PDF, Auto-Aggregation, Multi-Edit) → nicht eingeplant, keine spekulative Abstraktion. ✓

**Offene Festlegungen, die der Umsetzer prüfen muss (im Plan markiert):**
1. `jetzt_sqlite`-Helfer existiert evtl. nicht → robuste `chrono::Utc::now()`-Variante bevorzugt (Task 6, Step 1).
2. Exakte Mount-Syntax `{id}` vs. `:id` in `src/app.rs` (Task 6, Step 3).
3. Frontend-Test-Imports (`AuthProvider`, `server`, `renderMitProviders`) gegen `EtbPage.test.tsx` abgleichen (Task 9, Step 1).
4. ETB-`repo`-Test-Setup-Helfer wiederverwenden (Task 2, Step 4).
5. **Repo-Test-`setup()`-Inserts (Task 4/5) sind nicht gegen das reale Schema verifiziert** — die `INSERT INTO benutzer (… system_rolle, org_rolle, aktiv …)` / `INSERT INTO einsatz (org_id, bezeichnung, status)` stammen aus der (teils halluzinierenden) Vorab-Recherche. Vor dem Schreiben der Repo-Tests die Spalten gegen ein **bestehendes** Repo-Test-Setup (z. B. in `src/einsatzabschnitt/repo.rs` oder einem anderen `src/*/repo.rs` mit `#[cfg(test)]`) bzw. die Migrationen abgleichen und Insert-Spalten **wörtlich** übernehmen. Das `CASE WHEN ? THEN ?`-Update-Idiom ist funktional unkritisch, die rohen Inserts müssen aber zum Schema passen.
6. **Schnellerfassung-Test-Helfer** (`renderSchnellerfassung`, Combobox-Interaktion, Routing-Kontext) an die real existierenden Helfer in `Schnellerfassung.test.tsx` anpassen (Task 12, Step 1).
