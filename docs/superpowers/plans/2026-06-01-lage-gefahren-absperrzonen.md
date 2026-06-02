# L‑3 Gefahren- & Absperrzonen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen freien, entitätslosen Annotations-Layer (Gefahren- & Absperrzonen als Flächen/Linien) auf die Lagekarte bringen — eigenständige `lage_zone`-Entität mit typabgeleitetem Stil, automatischer ETB-Spur und Live-Update.

**Architecture:** Neues einsatz-skopiertes Backend-Modul `src/lage_zone/` (Vorbild `src/einsatzabschnitt/`) mit CRUD-Routen, automatischem ETB-Append (POST/wesentliches PATCH/DELETE) über `src/etb/` und neuem SSE-Kanal `lage_zone` über den bestehenden `LiveHub`. Frontend erweitert die bestehende `LagekartePage` um einen „Zonen"-Layer: generalisiertes Zeichen-Modul `zeichnen.ts` (Polygon **+** LineString), typabgeleitetes Stil-Mapping `zonenStil.ts` (eine Wahrheit), MapLibre-GeoJSON-Rendering, Inspector zum Bearbeiten/Löschen, Live-Resync.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + TypeScript, MapLibre-GL, terra-draw 1.31.0 + terra-draw-maplibre-gl-adapter, @tanstack/react-query, Ant Design, Vitest + @testing-library + MSW.

**Bewusste Abweichung von der Spec-SQL:** Die Spec zeigt `id TEXT PRIMARY KEY` / `erstellt_von TEXT REFERENCES benutzer(id)` — das ist illustrativ. `einsatz(id)` und `benutzer(id)` sind in dieser Codebasis `INTEGER`; eine TEXT-ID bräche die Fremdschlüssel. Dieser Plan nutzt durchgängig die Hauskonvention: `INTEGER PRIMARY KEY`, `TEXT NOT NULL DEFAULT (datetime('now'))` für Zeitstempel. Die in der Spec namentlich genannten Spalten `erstellt_von`/`erstellt_at`/`geaendert_at` bleiben erhalten (Typen angepasst). ETB-Wortlaut nutzt `«…»` (vorhandenes Format aus `einsatzabschnitt`), nicht die `‚…'` aus der Spec — die Spec verlangt ausdrücklich „am vorhandenen ETB-Eintrags-Format ausrichten".

---

## File Structure

**Backend (neu):**
- `migrations/0036_lage_zone.sql` — Tabelle `lage_zone` + Index
- `src/lage_zone/mod.rs` — `LageZoneAnzeige` (Serialize-DTO), Typ-Katalog-Konstanten/Helfer (`typ_label`, `geometrie_klasse_passt`)
- `src/lage_zone/repo.rs` — CRUD (`liste`, `laden`, `anlegen`, `aktualisiere`, `loese_auf`) + Unit-Tests
- `src/routes/lage_zone.rs` — Handler (`liste`, `anlegen`, `aktualisieren`, `aufloesen`, `stream`), ETB-/SSE-Verdrahtung, Validierung
- `tests/lage_zone.rs` — Integrationstests (CRUD, CHECK→422, Partial-PATCH, ETB-Regeln, SSE, Berechtigung, Org-Isolation)

**Backend (geändert):**
- `src/lib.rs` (oder `src/main.rs`) — `pub mod lage_zone;` registrieren
- `src/routes/mod.rs` — `pub mod lage_zone;` registrieren
- `src/app.rs` — 5 Routen einhängen

**Frontend (neu):**
- `frontend/src/api/lagezonen.ts` — API-Client (`listeZonen`, `legeZoneAn`, `aktualisiereZone`, `loescheZone`)
- `frontend/src/pages/lagekarte/zonenStil.ts` — reines Stil-/Katalog-Mapping aus `typ` (+ Unit-Test `zonenStil.test.ts`)
- `frontend/src/pages/lagekarte/zeichnen.ts` — generisches terra-draw-Modul (Polygon + LineString); löst `abschnittDraw.ts` ab
- `frontend/src/pages/lagekarte/ZonenInspector.tsx` — Editier-/Lösch-Panel für eine Zone
- `frontend/src/etb/useZonenStream.ts` — SSE-Listener für `lage_zone`-Events

**Frontend (geändert):**
- `frontend/src/api/types.ts` — `LageZone` + `ZoneTyp`
- `frontend/src/pages/lagekarte/geo.ts` — `GeoJsonLineString`, `GeoJsonGeometry`, `parseGeometry`
- `frontend/src/pages/lagekarte/Kartenflaeche.tsx` — Zonen-Source/Layer + Zonen-Zeichnen + Zonen-Klick; Abschnitt-Zeichnen auf `zeichnen.ts` umstellen
- `frontend/src/pages/LagekartePage.tsx` — Layer-Toggle `zone`, Query, Live-Hook, Zeichen-Flow, Zonen-Auswahl/Inspector
- `frontend/src/pages/lagekarte/Sidebar.tsx` — Layer-Toggle „Zonen" + „Zone zeichnen"-Steuerung
- `frontend/src/pages/LagekartePage.test.tsx` — Zonen-Tests; Kartenflaeche-Stub um Zonen-Buttons erweitern

---

## Konventionen aus dem Vorbild (gelten für alle Backend-Tasks)

Diese Muster stammen 1:1 aus `src/einsatzabschnitt/` und `src/routes/einsatzabschnitt.rs` (gelesen). Nicht neu erfinden:

- Tri-State-Deserializer für nullable Felder (`Option<Option<T>>`), exakt wie `routes/einsatzabschnitt.rs:18-26`.
- Berechtigung in jedem Handler: `let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?; let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;` dann `fordere_lesezugriff(&benutzer, &einsatz, rolle)?` (GET/stream) bzw. `fordere_schreibrecht(rolle)?; fordere_aktiv(&einsatz)?` (POST/PATCH/DELETE).
- ETB-Helfer `etb_system(...)` exakt wie `routes/einsatzabschnitt.rs:34-48` (publiziert den ETB-Eintrag zusätzlich live als `etb`-Event).
- SSE-Stream-Handler exakt wie `routes/einsatzabschnitt.rs:199-219`.
- Fehler: `AppError::Validation` (400), `AppError::UnprocessableEntity` (422), `AppError::NotFound` (404), `AppError::Forbidden` (403).
- Partial-Update per `CASE WHEN ? THEN ? ELSE <spalte> END` (Merge gegen Effektivzustand), wie `repo.rs:184-200`.

---

## Task 1: Migration `lage_zone`-Tabelle

**Files:**
- Create: `migrations/0036_lage_zone.sql`

- [ ] **Step 1: Migration schreiben**

Schema folgt der Hauskonvention (INTEGER-IDs, `datetime('now')`-Defaults). Zwei unabhängige `CHECK`s, **kein** Mehrspalten-CHECK zwischen `typ` und `geometrie_typ` (die fachliche Bindung erzwingt die App; siehe Spec „Datenmodell" und Memory `patch-xor-effektivzustand`).

`migrations/0036_lage_zone.sql`:

```sql
-- L‑3 Gefahren-/Absperrzonen: freier, entitätsloser Annotations-Layer.
-- Eigenständige einsatz-skopierte Entität (Vorbild einsatzabschnitt/0014).
-- Zwei unabhängige CHECKs (typ, geometrie_typ); die fachliche Bindung
-- (welcher typ welche Geometrie haben darf) erzwingt die App, nicht die DB.
-- farbe nur für freie_skizze gesetzt; sonst NULL (Stil sonst aus typ abgeleitet).
-- Hard-Delete: die Historie lebt im ETB; ON DELETE CASCADE räumt beim Einsatz-Löschen auf.
CREATE TABLE lage_zone (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    typ           TEXT NOT NULL
                    CHECK (typ IN ('gefahrengebiet','absperrbereich','absperrgrenze','sperrgebiet','freie_skizze')),
    geometrie_typ TEXT NOT NULL
                    CHECK (geometrie_typ IN ('Polygon','LineString')),
    geometrie     TEXT NOT NULL,   -- GeoJSON-Geometry (Polygon oder LineString)
    label         TEXT,
    farbe         TEXT,            -- nur freie_skizze; sonst NULL
    notiz         TEXT,
    erstellt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lage_zone_einsatz ON lage_zone(einsatz_id);
```

- [ ] **Step 2: Migration anwenden (Kompilier-/Migrations-Check)**

Migrationen laufen über `sqlx::migrate!("./migrations")` automatisch beim Test-Pool-Aufbau (`src/db.rs:19-22`). Verifizieren, dass die SQL syntaktisch lädt:

Run: `rtk proxy cargo test --lib db:: 2>&1 | tail -20`
Expected: Kompiliert; Migrationen laufen fehlerfrei (kein „migration … failed"). (Falls keine `db::`-Tests existieren: `rtk proxy cargo build 2>&1 | tail -5` muss fehlerfrei sein.)

- [ ] **Step 3: Commit**

```bash
git add migrations/0036_lage_zone.sql
git commit -m "feat(lage): Migration lage_zone-Tabelle (L-3)"
```

---

## Task 2: Modul `lage_zone` — DTO + Typ-Katalog-Helfer

**Files:**
- Create: `src/lage_zone/mod.rs`

- [ ] **Step 1: `mod.rs` mit Anzeige-DTO und Katalog-Helfern schreiben**

`geometrie_klasse_passt` ist der **gemeinsame** Invarianten-Helfer, den POST und PATCH beide aufrufen (siehe Tasks 4). Er kodiert den Typ-Katalog der Spec: Polygon ⇒ {gefahrengebiet, absperrbereich, sperrgebiet, freie_skizze}; LineString ⇒ {absperrgrenze, freie_skizze}.

`src/lage_zone/mod.rs`:

```rust
pub mod repo;

use serde::Serialize;

/// Erlaubte Typen (Reihenfolge wie Typ-Katalog der Spec).
pub const TYPEN: [&str; 5] = [
    "gefahrengebiet",
    "absperrbereich",
    "absperrgrenze",
    "sperrgebiet",
    "freie_skizze",
];

/// Erlaubte Geometrie-Typen (GeoJSON-Geometry-`type`).
pub const GEOMETRIE_TYPEN: [&str; 2] = ["Polygon", "LineString"];

/// Eine freie Lage-Zone (Gefahren-/Absperrzone). Eigenständige Entität — kein Fachobjekt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LageZoneAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub typ: String,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

/// Sprechendes Typ-Label für den ETB-Wortlaut.
pub fn typ_label(typ: &str) -> &'static str {
    match typ {
        "gefahrengebiet" => "Gefahrengebiet",
        "absperrbereich" => "Absperrbereich",
        "absperrgrenze" => "Absperrgrenze",
        "sperrgebiet" => "Sperrgebiet",
        "freie_skizze" => "Freie Skizze",
        _ => "Zone",
    }
}

/// Ob `typ` zur Geometrieklasse `geometrie_typ` passt (Typ-Katalog der Spec).
/// Von POST (typ vs. übergebenem geometrie_typ) und PATCH (neuer typ vs. *gespeichertem*
/// geometrie_typ — Geometrie ist nicht änderbar) gemeinsam erzwungen.
pub fn geometrie_klasse_passt(typ: &str, geometrie_typ: &str) -> bool {
    match geometrie_typ {
        "Polygon" => matches!(
            typ,
            "gefahrengebiet" | "absperrbereich" | "sperrgebiet" | "freie_skizze"
        ),
        "LineString" => matches!(typ, "absperrgrenze" | "freie_skizze"),
        _ => false,
    }
}
```

- [ ] **Step 2: Modul registrieren**

Finde die Stelle, an der die Module deklariert sind (neben `pub mod einsatzabschnitt;`):

Run: `rtk proxy grep -rn "pub mod einsatzabschnitt;" src/`
Erwartet: ein Treffer in `src/lib.rs` (oder `src/main.rs`). Füge **direkt darunter** ein:

```rust
pub mod lage_zone;
```

(`repo` wird in Task 3 ergänzt; bis dahin existiert `repo.rs` noch nicht — daher Task 2 erst nach Task 3 kompilieren, ODER `pub mod repo;` in Step 1 vorerst auskommentieren. Empfehlung: Tasks 2 und 3 in einem Zug umsetzen, dann gemeinsam kompilieren.)

- [ ] **Step 3: (gemeinsam mit Task 3 committen)** — siehe Task 3, Step 5.

---

## Task 3: `lage_zone/repo.rs` — CRUD + Unit-Tests

**Files:**
- Create: `src/lage_zone/repo.rs`

- [ ] **Step 1: Failing Unit-Test schreiben (anlegen + laden + freie-Skizze-Farbe)**

Die Unit-Tests haben **keinen** `bootstrap_admin` — wegen `erstellt_von INTEGER REFERENCES benutzer(id)` muss das Setup eine `benutzer`-Zeile anlegen. Schreibe ans Ende von `src/lage_zone/repo.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz; liefert (einsatz_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (einsatz, benutzer)
    }

    const POLY: &str = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
    const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

    #[tokio::test]
    async fn anlegen_und_laden_polygon() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("Chemie Halle 3"), farbe: None, notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert_eq!(z.typ, "gefahrengebiet");
        assert_eq!(z.geometrie_typ, "Polygon");
        assert_eq!(z.label.as_deref(), Some("Chemie Halle 3"));
        assert_eq!(z.farbe, None);
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn freie_skizze_linie_mit_farbe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "freie_skizze", geometrie_typ: "LineString", geometrie: LINE,
            label: None, farbe: Some("#00ff00"), notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert_eq!(z.farbe.as_deref(), Some("#00ff00"));
        assert_eq!(z.geometrie_typ, "LineString");
    }

    #[tokio::test]
    async fn patch_merged_und_nullt_nichts_ungewollt() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "gefahrengebiet", geometrie_typ: "Polygon", geometrie: POLY,
            label: Some("A"), farbe: None, notiz: Some("Notiz bleibt"), erstellt_von: von,
        }).await.unwrap();
        // Nur label ändern; notiz NICHT mitsenden → bleibt erhalten.
        let n = aktualisiere(&pool, einsatz, z.id, ZonePatch {
            label: Some(Some("B")), ..Default::default()
        }).await.unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.notiz.as_deref(), Some("Notiz bleibt"));
    }

    #[tokio::test]
    async fn loeschen_und_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(&pool, einsatz, ZoneNeu {
            typ: "absperrgrenze", geometrie_typ: "LineString", geometrie: LINE,
            label: None, farbe: None, notiz: None, erstellt_von: von,
        }).await.unwrap();
        assert!(matches!(laden(&pool, 999, z.id).await.unwrap_err(), AppError::NotFound));
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(laden(&pool, einsatz, z.id).await.unwrap_err(), AppError::NotFound));
    }
}
```

- [ ] **Step 2: Test läuft → schlägt fehl (Symbole fehlen)**

Run: `rtk proxy cargo test --lib lage_zone::repo 2>&1 | tail -20`
Expected: FAIL — Kompilierfehler „cannot find function `anlegen`" / „cannot find struct `ZoneNeu`". (Erwartetes Rot vor Implementierung.)

- [ ] **Step 3: Repo implementieren**

Schreibe **an den Anfang** von `src/lage_zone/repo.rs` (vor dem `#[cfg(test)]`-Block):

```rust
use super::LageZoneAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Felder zum Anlegen einer Zone (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZoneNeu<'a> {
    pub typ: &'a str,
    pub geometrie_typ: &'a str,
    pub geometrie: &'a str,
    pub label: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub notiz: Option<&'a str>,
    pub erstellt_von: i64,
}

/// Editierbare Felder eines PATCH. `None` = unverändert; `Some(None)` = auf NULL.
/// `typ` ist nicht nullable → schlichtes `Option`.
#[derive(Debug, Default)]
pub struct ZonePatch<'a> {
    pub typ: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           erstellt_von, erstellt_at, geaendert_at \
    FROM lage_zone";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    typ: String,
    geometrie_typ: String,
    geometrie: String,
    label: Option<String>,
    farbe: Option<String>,
    notiz: Option<String>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> LageZoneAnzeige {
    LageZoneAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        typ: r.typ,
        geometrie_typ: r.geometrie_typ,
        geometrie: r.geometrie,
        label: r.label,
        farbe: r.farbe,
        notiz: r.notiz,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle Zonen eines Einsatzes, älteste zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<LageZoneAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt eine Zone; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<LageZoneAnzeige, AppError> {
    sqlx::query_as::<_, Row>(&format!("{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"))
        .bind(id).bind(einsatz_id)
        .fetch_optional(pool).await?
        .map(zu_anzeige)
        .ok_or(AppError::NotFound)
}

/// Legt eine Zone an (Felder bereits validiert). Liefert die Anzeige.
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, daten: ZoneNeu<'_>) -> Result<LageZoneAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz).bind(daten.erstellt_von)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}

/// Partial-Update gegen den Effektivzustand (nur gesendete Felder ändern), `geaendert_at`
/// stets aktualisiert. Geometrie ist NICHT änderbar (kein Reshape). `NotFound`, falls fremd.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some()).bind(daten.typ)
    .bind(daten.label.is_some()).bind(daten.label.flatten())
    .bind(daten.farbe.is_some()).bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some()).bind(daten.notiz.flatten())
    .bind(id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete. `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query("DELETE FROM lage_zone WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id)
        .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 4: Tests grün**

Run: `rtk proxy cargo test --lib lage_zone::repo 2>&1 | tail -20`
Expected: PASS (4 Tests). Falls die `benutzer`-INSERT-Spalten abweichen, mit `rtk proxy grep -n "CREATE TABLE benutzer" migrations/*.sql` die echten Spaltennamen prüfen und das Setup anpassen.

- [ ] **Step 5: Commit (Tasks 2+3)**

```bash
git add src/lage_zone/ src/lib.rs
git commit -m "feat(lage): lage_zone-Modul (DTO, Katalog-Helfer, CRUD-Repo) (L-3)"
```

---

## Task 4: Routen `lage_zone` — Handler, Validierung, ETB, SSE

**Files:**
- Create: `src/routes/lage_zone.rs`
- Modify: `src/routes/mod.rs` (Modul registrieren)
- Modify: `src/app.rs` (5 Routen einhängen)

- [ ] **Step 1: Handler-Datei schreiben**

`src/routes/lage_zone.rs`:

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::lage_zone::repo::{self as zone_repo, ZoneNeu, ZonePatch};
use crate::lage_zone::{self, LageZoneAnzeige};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Tri-State: JSON-`null` → `Some(None)`, fehlendes Feld → `None`.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// SSE-Notify (Lage-Karte): eine Zone hat sich geändert. Event-Tag `lage_zone`.
fn sse_zone(state: &AppState, einsatz_id: i64, zid: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "zone_id": zid }).to_string();
    state.live.publiziere_event(einsatz_id, "lage_zone", data);
}

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie einsatzabschnitt).
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

/// ETB-Wortlaut: «<Typ-Label> «Label» <verb>» bzw. ohne Label «<Typ-Label> <verb>».
fn etb_text(typ: &str, label: Option<&str>, verb: &str) -> String {
    match label {
        Some(l) => format!("{} «{}» {}", lage_zone::typ_label(typ), l, verb),
        None => format!("{} {}", lage_zone::typ_label(typ), verb),
    }
}

/// GET /api/einsaetze/{id}/zonen — Liste aller Zonen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<LageZoneAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(zone_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct ZoneBody {
    pub typ: String,
    pub geometrie_typ: String,
    /// GeoJSON-Geometry als **String** (Hausmuster wie `FlaecheBody.flaeche_geojson` —
    /// das FE sendet `JSON.stringify(g)`, die DB-Spalte ist `TEXT`).
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
}

/// Validiert typ/geometrie_typ/geometrie und gibt 422 bei Verstoß (statt DB-CHECK→500).
/// Liefert die zu speichernde Geometrie-String-Form zurück (= der validierte Eingabe-String).
fn validiere_neu(body: &ZoneBody) -> Result<String, AppError> {
    if !lage_zone::TYPEN.contains(&body.typ.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekannter Zonen-Typ: {}", body.typ)));
    }
    if !lage_zone::GEOMETRIE_TYPEN.contains(&body.geometrie_typ.as_str()) {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannter Geometrie-Typ: {}", body.geometrie_typ
        )));
    }
    if !lage_zone::geometrie_klasse_passt(&body.typ, &body.geometrie_typ) {
        return Err(AppError::UnprocessableEntity(format!(
            "Typ {} ist mit Geometrie {} nicht zulässig", body.typ, body.geometrie_typ
        )));
    }
    // geometrie muss gültiges JSON und vom angegebenen geometrie_typ sein.
    let v: serde_json::Value = serde_json::from_str(&body.geometrie)
        .map_err(|_| AppError::UnprocessableEntity("geometrie ist kein gültiges JSON".into()))?;
    if v.get("type").and_then(|t| t.as_str()) != Some(body.geometrie_typ.as_str()) {
        return Err(AppError::UnprocessableEntity(
            "geometrie.type passt nicht zu geometrie_typ".into(),
        ));
    }
    Ok(body.geometrie.clone())
}

/// POST /api/einsaetze/{id}/zonen — anlegen. Schreibrecht + aktiv. ETB „eingerichtet".
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<ZoneBody>,
) -> Result<(StatusCode, Json<LageZoneAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let geometrie = validiere_neu(&body)?;
    let label = trimme(body.label.clone());
    let notiz = trimme(body.notiz.clone());
    // farbe nur für freie_skizze; sonst ignorieren (Stil aus typ abgeleitet).
    let farbe = if body.typ == "freie_skizze" { trimme(body.farbe.clone()) } else { None };

    let z = zone_repo::anlegen(&state.pool, einsatz_id, ZoneNeu {
        typ: &body.typ,
        geometrie_typ: &body.geometrie_typ,
        geometrie: &geometrie,
        label: label.as_deref(),
        farbe: farbe.as_deref(),
        notiz: notiz.as_deref(),
        erstellt_von: benutzer.id,
    }).await?;

    etb_system(&state, einsatz_id, benutzer.id, &etb_text(&z.typ, z.label.as_deref(), "eingerichtet")).await?;
    sse_zone(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

#[derive(Debug, Deserialize)]
pub struct ZonePatchBody {
    pub typ: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/zonen/{zid} — label/typ/farbe/notiz. Geometrie NICHT änderbar.
/// ETB „geändert" NUR wenn effektiver typ oder label sich gegenüber vorher unterscheidet.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
    Json(body): Json<ZonePatchBody>,
) -> Result<Json<LageZoneAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;

    // Effektiver neuer typ; wenn geändert: gültig + passt zur *gespeicherten* Geometrie.
    let neuer_typ = match &body.typ {
        Some(t) => {
            if !lage_zone::TYPEN.contains(&t.as_str()) {
                return Err(AppError::UnprocessableEntity(format!("Unbekannter Zonen-Typ: {t}")));
            }
            if !lage_zone::geometrie_klasse_passt(t, &vorher.geometrie_typ) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Typ {t} ist mit der vorhandenen Geometrie ({}) nicht zulässig", vorher.geometrie_typ
                )));
            }
            t.clone()
        }
        None => vorher.typ.clone(),
    };

    // Effektives label (getrimmt). label-Patch: Some(Some) = setzen, Some(None) = NULL, None = unverändert.
    let neues_label: Option<String> = match &body.label {
        Some(opt) => opt.clone().and_then(|s| trimme(Some(s))),
        None => vorher.label.clone(),
    };

    // farbe-Normalisierung: nur freie_skizze darf farbe tragen.
    let farbe_patch: Option<Option<&str>> = if neuer_typ != "freie_skizze" {
        Some(None) // beim Wechsel weg von freie_skizze farbe nullen
    } else {
        match &body.farbe {
            Some(opt) => Some(opt.as_deref()),
            None => None,
        }
    };

    let z = zone_repo::aktualisiere(&state.pool, einsatz_id, zid, ZonePatch {
        typ: body.typ.as_deref(),
        label: body.label.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
        farbe: farbe_patch,
        notiz: body.notiz.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
    }).await?;

    // Sinntragende Änderung? typ oder label effektiv geändert.
    let typ_geaendert = neuer_typ != vorher.typ;
    let label_geaendert = neues_label != vorher.label;
    if typ_geaendert || label_geaendert {
        etb_system(&state, einsatz_id, benutzer.id, &etb_text(&z.typ, z.label.as_deref(), "geändert")).await?;
    }

    sse_zone(&state, einsatz_id, zid);
    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/zonen/{zid} — aufheben (Hard-Delete). ETB „aufgehoben".
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;
    zone_repo::loese_auf(&state.pool, einsatz_id, zid).await?;
    etb_system(&state, einsatz_id, benutzer.id, &etb_text(&vorher.typ, vorher.label.as_deref(), "aufgehoben")).await?;
    sse_zone(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/einsaetze/{id}/zonen/stream — SSE (ganzer Einsatz-Kanal). Nur Lesezugriff;
/// das Frontend filtert per Event-Name (`lage_zone`).
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

> Hinweis zur PATCH-`label`-Behandlung: Der `ZonePatch.label` wird aus `body.label` getrimmt; ein leerer String wird zu `None` (NULL). Wichtig: `neues_label` (für den ETB-Vergleich) und der an `aktualisiere` übergebene `label`-Patch müssen **dieselbe** Trim-Regel verwenden — sonst weicht der ETB-Vergleich vom gespeicherten Wert ab. `neues_label` oben nutzt `trimme(...)`, der Patch nutzt `str::trim().filter(non-empty)` — beide ergeben „getrimmt, leer ⇒ None"; identisch halten.

- [ ] **Step 2: Modul registrieren**

In `src/routes/mod.rs` neben `pub mod einsatzabschnitt;` einfügen:

```rust
pub mod lage_zone;
```

- [ ] **Step 3: Routen einhängen**

In `src/app.rs`, direkt nach dem Abschnitte-Block (`src/app.rs:140-145`), einfügen:

```rust
.route("/api/einsaetze/{id}/zonen", get(routes::lage_zone::liste))
.route("/api/einsaetze/{id}/zonen", post(routes::lage_zone::anlegen))
.route("/api/einsaetze/{id}/zonen/stream", get(routes::lage_zone::stream))
.route("/api/einsaetze/{id}/zonen/{zid}", patch(routes::lage_zone::aktualisieren))
.route("/api/einsaetze/{id}/zonen/{zid}", delete(routes::lage_zone::aufloesen))
```

- [ ] **Step 4: Kompiliert**

Run: `rtk proxy cargo build 2>&1 | tail -20`
Expected: kompiliert fehlerfrei. Falls `ZonePatch`-`label`-Closure-Typen meckern, die `label`-/`notiz`-Zeile vereinfachen: `label: body.label.as_ref().map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty()))` — Ziel ist `Option<Option<&str>>`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/lage_zone.rs src/routes/mod.rs src/app.rs
git commit -m "feat(lage): zonen-Routen (CRUD, ETB, SSE-Kanal lage_zone) (L-3)"
```

---

## Task 5: Backend-Integrationstests

**Files:**
- Create: `tests/lage_zone.rs`

Vorbild: `tests/einsatzabschnitt.rs` (Harness: `setup`, `login_cookie`, `anfrage`, `system_etb_*`) und `tests/etb.rs`/`tests/lage_taktik.rs` (SSE: `live.abonniere`, `recv_until_tag`). Übernimm den Harness 1:1.

- [ ] **Step 1: Test-Datei mit Harness + CRUD-/ETB-/Validierungs-/SSE-/Org-Tests schreiben**

`tests/lage_zone.rs`:

```rust
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

const POLY: &str = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12")).await.unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState { pool, live: live.clone() });
    (router, live)
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
    assert_eq!(status, StatusCode::CREATED, "Einsatz anlegen: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Inhalte aller system-ETB-Einträge (jüngste/älteste je nach Sortierung der API).
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(app, "GET", &format!("/api/einsaetze/{einsatz}/etb"), cookie, None).await;
    json.as_array().unwrap().iter().filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string()).collect()
}

async fn recv_until_tag(rx: &mut Receiver<LiveNachricht>, tag: &str, timeout: Duration) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv()).await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event == tag { return n; }
    }
}

#[tokio::test]
async fn anlegen_setzt_zone_und_schreibt_etb_eingerichtet() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Chemie Halle 3"}).to_string();
    let (status, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["typ"], "gefahrengebiet");
    assert_eq!(z["geometrie_typ"], "Polygon");

    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Gefahrengebiet «Chemie Halle 3» eingerichtet"), "ETB: {etb:?}");
}

#[tokio::test]
async fn ungueltiger_typ_und_geometrie_typ_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Unbekannter typ.
    let b1 = json!({"typ":"quatsch","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b1)).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    // typ passt nicht zur Geometrie (Linien-Typ mit Polygon).
    let b2 = json!({"typ":"absperrgrenze","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b2)).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    // geometrie.type passt nicht zu geometrie_typ.
    let b3 = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":LINE}).to_string();
    assert_eq!(anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&b3)).await.0, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_typ_oder_label_schreibt_etb_geaendert_notiz_und_farbe_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"freie_skizze","geometrie_typ":"Polygon","geometrie":POLY,"label":"A","farbe":"#00ff00"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let basis = system_etb_inhalte(&app, &admin, einsatz).await.len();

    // Nur notiz → KEIN ETB.
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"notiz":"egal"}"#)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "notiz darf keinen ETB erzeugen");

    // Nur farbe → KEIN ETB.
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"farbe":"#ff0000"}"#)).await;
    assert_eq!(system_etb_inhalte(&app, &admin, einsatz).await.len(), basis, "farbe darf keinen ETB erzeugen");

    // label ändern → ETB „geändert".
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"label":"B"}"#)).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb.len(), basis + 1, "label-Änderung muss genau einen ETB erzeugen");
    assert!(etb.iter().any(|i| i == "Freie Skizze «B» geändert"), "ETB: {etb:?}");
}

#[tokio::test]
async fn patch_typ_inkompatibel_zur_geometrie_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Linien-Zone anlegen, dann auf Polygon-only-Typ patchen → 422 (Geometrie ist nicht änderbar).
    let body = json!({"typ":"absperrgrenze","geometrie_typ":"LineString","geometrie":LINE}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"typ":"gefahrengebiet"}"#)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn delete_schreibt_etb_aufgehoben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"sperrgebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Tor 2"}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(etb.iter().any(|i| i == "Sperrgebiet «Tor 2» aufgehoben"), "ETB: {etb:?}");
    // Hard-Delete: Liste ist leer.
    let (_, liste) = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn sse_feuert_bei_post_patch_delete() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let n = recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    let zid = z["id"].as_i64().unwrap();

    anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, Some(r#"{"label":"X"}"#)).await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;

    anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &admin, None).await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_kann_zonen_nicht_lesen_oder_schreiben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &admin, Some(&body)).await;
    let zid = z["id"].as_i64().unwrap();

    // Fremder Nutzer ohne Mitgliedschaft/höhere Rolle (Harness wie tests/einsatzabschnitt.rs).
    let fremd_c = fremder_nutzer(&app, &admin).await;

    let get = anfrage(&app, "GET", &format!("/api/einsaetze/{einsatz}/zonen"), &fremd_c, None).await.0;
    assert!(matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "GET: {get}");
    let post = anfrage(&app, "POST", &format!("/api/einsaetze/{einsatz}/zonen"), &fremd_c, Some(&body)).await.0;
    assert!(matches!(post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "POST: {post}");
    let patch = anfrage(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &fremd_c, Some(r#"{"label":"x"}"#)).await.0;
    assert!(matches!(patch, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "PATCH: {patch}");
    let del = anfrage(&app, "DELETE", &format!("/api/einsaetze/{einsatz}/zonen/{zid}"), &fremd_c, None).await.0;
    assert!(matches!(del, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND), "DELETE: {del}");
}
```

> `fremder_nutzer(&app, &admin)`: Übernimm exakt das Helper-Muster aus `tests/einsatzabschnitt.rs` (Funktion `fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben`, ca. Z. 130-144) — Benutzer ohne Mitgliedschaft anlegen + einloggen. Wenn dort kein eigenständiger Helper existiert, kopiere die Inline-Schritte (`benutzer_anlegen` + `login_cookie`) in eine lokale `async fn fremder_nutzer`.

- [ ] **Step 2: Tests laufen lassen**

Run: `rtk proxy cargo test --test lage_zone 2>&1 | tail -30`
Expected: alle Tests PASS. Bei Bedarf serielle Ausführung: `rtk proxy cargo test --test lage_zone -- --test-threads=1`.

- [ ] **Step 3: Volle Backend-Suite als Regressions-Gate**

Run: `rtk proxy cargo test 2>&1 | tail -15`
Expected: keine neuen Failures.

- [ ] **Step 4: Commit**

```bash
git add tests/lage_zone.rs
git commit -m "test(be): lage_zone CRUD, 422-CHECK, ETB-Regeln, SSE, Org-Isolation (L-3)"
```

---

## Task 6: Frontend-API-Client + Typen

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/api/lagezonen.ts`

- [ ] **Step 1: Typen ergänzen**

Am Ende von `frontend/src/api/types.ts` (neben `Einsatzabschnitt`):

```typescript
export type ZoneTyp =
  | 'gefahrengebiet'
  | 'absperrbereich'
  | 'absperrgrenze'
  | 'sperrgebiet'
  | 'freie_skizze';

export interface LageZone {
  id: number;
  einsatz_id: number;
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string; // GeoJSON-Geometry als String
  label: string | null;
  farbe: string | null;
  notiz: string | null;
  erstellt_von: number;
  erstellt_at: string;
  geaendert_at: string;
}
```

- [ ] **Step 2: API-Client schreiben**

Vorbild: `frontend/src/api/einsatzabschnitte.ts` (`apiGet`/`apiSend` aus `./client`). `frontend/src/api/lagezonen.ts`:

```typescript
import type { LageZone, ZoneTyp } from './types';
import { apiGet, apiSend } from './client';

export interface ZoneNeu {
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string; // JSON.stringify der Geometry
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
}

export interface ZonePatch {
  typ?: ZoneTyp;
  label?: string | null;
  farbe?: string | null;
  notiz?: string | null;
}

export function listeZonen(einsatzId: number): Promise<LageZone[]> {
  return apiGet<LageZone[]>(`/api/einsaetze/${einsatzId}/zonen`);
}

export function legeZoneAn(einsatzId: number, daten: ZoneNeu): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen`, 'POST', daten);
}

export function aktualisiereZone(einsatzId: number, zid: number, daten: ZonePatch): Promise<LageZone> {
  return apiSend<LageZone>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'PATCH', daten);
}

export function loescheZone(einsatzId: number, zid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/zonen/${zid}`, 'DELETE');
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -15`
Expected: keine Fehler in `api/lagezonen.ts`/`api/types.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/lagezonen.ts
git commit -m "feat(fe): API-Client + Typen für Lage-Zonen (L-3)"
```

---

## Task 7: `zonenStil.ts` — typabgeleiteter Stil (reine Funktion) + Test

**Files:**
- Create: `frontend/src/pages/lagekarte/zonenStil.ts`
- Test: `frontend/src/pages/lagekarte/zonenStil.test.ts`

Analogon zu `taktischesZeichen.ts` (eine Wahrheit: Stil typisierter Zonen lebt im FE, nicht in der DB). Reine Funktion → direkt unit-testbar (die Page-Tests mocken `Kartenflaeche` weg, daher hier den Stil prüfen).

- [ ] **Step 1: Failing Test schreiben**

`frontend/src/pages/lagekarte/zonenStil.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { zoneStil, ZONE_TYPEN } from './zonenStil';

describe('zoneStil', () => {
  it('leitet roten Stil für gefahrengebiet ab (gespeicherte Farbe wird ignoriert)', () => {
    const s = zoneStil('gefahrengebiet', '#abcdef');
    expect(s.fillColor).toBe('#cf1322');
    expect(s.lineColor).toBe('#cf1322');
    expect(s.fillOpacity).toBeGreaterThan(0);
  });

  it('absperrgrenze ist eine kräftige Linie ohne Füllung', () => {
    const s = zoneStil('absperrgrenze', null);
    expect(s.fillOpacity).toBe(0);
    expect(s.lineWidth).toBeGreaterThanOrEqual(3);
  });

  it('freie_skizze nutzt die gespeicherte Farbe (Fallback bei leer)', () => {
    expect(zoneStil('freie_skizze', '#00ff00').fillColor).toBe('#00ff00');
    expect(zoneStil('freie_skizze', null).fillColor).toBe('#1677ff');
  });

  it('Katalog: nur freie_skizze erlaubt beide Geometrien', () => {
    const freie = ZONE_TYPEN.find((t) => t.typ === 'freie_skizze')!;
    expect(freie.geometrie).toBe('beides');
    expect(ZONE_TYPEN.find((t) => t.typ === 'absperrgrenze')!.geometrie).toBe('LineString');
    expect(ZONE_TYPEN.find((t) => t.typ === 'gefahrengebiet')!.geometrie).toBe('Polygon');
  });
});
```

- [ ] **Step 2: Test läuft → schlägt fehl**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/lagekarte/zonenStil.test.ts 2>&1 | tail -15`
Expected: FAIL — „Cannot find module './zonenStil'".

- [ ] **Step 3: Modul implementieren**

`frontend/src/pages/lagekarte/zonenStil.ts`:

```typescript
import type { ZoneTyp } from '../../api/types';

export interface ZoneStil {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineWidth: number;
}

/** Voreingestellter Stil je typisierter Zone (eine Wahrheit; nicht gespeichert). */
const STILE: Record<Exclude<ZoneTyp, 'freie_skizze'>, ZoneStil> = {
  gefahrengebiet: { fillColor: '#cf1322', fillOpacity: 0.2, lineColor: '#cf1322', lineWidth: 2 },
  absperrbereich: { fillColor: '#fa8c16', fillOpacity: 0.2, lineColor: '#fa8c16', lineWidth: 2 },
  absperrgrenze: { fillColor: '#cf1322', fillOpacity: 0, lineColor: '#cf1322', lineWidth: 4 },
  sperrgebiet: { fillColor: '#8c8c8c', fillOpacity: 0.3, lineColor: '#595959', lineWidth: 2 },
};

const FREIE_SKIZZE_FALLBACK = '#1677ff';

/** Stil einer Zone: typisierte aus `typ`, freie Skizze aus gespeicherter `farbe`. */
export function zoneStil(typ: ZoneTyp, farbe: string | null | undefined): ZoneStil {
  if (typ === 'freie_skizze') {
    const c = farbe && farbe.trim() ? farbe : FREIE_SKIZZE_FALLBACK;
    return { fillColor: c, fillOpacity: 0.2, lineColor: c, lineWidth: 2 };
  }
  return STILE[typ];
}

export interface ZoneTypInfo {
  typ: ZoneTyp;
  label: string;
  /** Geometrie, die der Typ erzwingt; `beides` = Nutzer wählt Fläche/Linie. */
  geometrie: 'Polygon' | 'LineString' | 'beides';
}

/** Typ-Katalog für die Zeichen-UI (Reihenfolge wie Spec-Tabelle). */
export const ZONE_TYPEN: ZoneTypInfo[] = [
  { typ: 'gefahrengebiet', label: 'Gefahrengebiet', geometrie: 'Polygon' },
  { typ: 'absperrbereich', label: 'Absperrbereich', geometrie: 'Polygon' },
  { typ: 'absperrgrenze', label: 'Absperrgrenze', geometrie: 'LineString' },
  { typ: 'sperrgebiet', label: 'Sperrgebiet', geometrie: 'Polygon' },
  { typ: 'freie_skizze', label: 'Freie Skizze', geometrie: 'beides' },
];

/** Sprechendes Label eines Typs (für Inspector/Legende). */
export function zoneTypLabel(typ: ZoneTyp): string {
  return ZONE_TYPEN.find((t) => t.typ === typ)?.label ?? typ;
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/lagekarte/zonenStil.test.ts 2>&1 | tail -15`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/zonenStil.ts frontend/src/pages/lagekarte/zonenStil.test.ts
git commit -m "feat(fe): zonenStil.ts typabgeleiteter Stil + Katalog (L-3)"
```

---

## Task 8: `geo.ts` — LineString-Unterstützung

**Files:**
- Modify: `frontend/src/pages/lagekarte/geo.ts`
- Test: `frontend/src/pages/lagekarte/geo.test.ts` (anlegen, falls nicht vorhanden)

- [ ] **Step 1: Failing Test schreiben**

In `frontend/src/pages/lagekarte/geo.test.ts` (anhängen oder neu anlegen):

```typescript
import { describe, expect, it } from 'vitest';
import { parseGeometry } from './geo';

describe('parseGeometry', () => {
  it('liest ein Polygon', () => {
    const g = parseGeometry('{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}');
    expect(g?.type).toBe('Polygon');
  });
  it('liest einen LineString', () => {
    const g = parseGeometry('{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}');
    expect(g?.type).toBe('LineString');
  });
  it('gibt null bei Unsinn / fremdem Typ zurück', () => {
    expect(parseGeometry('{"type":"Point","coordinates":[8.6,50.1]}')).toBeNull();
    expect(parseGeometry('kein json')).toBeNull();
    expect(parseGeometry(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Test läuft → schlägt fehl**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/lagekarte/geo.test.ts 2>&1 | tail -15`
Expected: FAIL — `parseGeometry` ist kein Export.

- [ ] **Step 3: `geo.ts` erweitern**

In `frontend/src/pages/lagekarte/geo.ts` ergänzen (bestehendes `GeoJsonPolygon`/`parsePolygon`/`polygonZentroid` unverändert lassen):

```typescript
export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: number[][];
}

export type GeoJsonGeometry = GeoJsonPolygon | GeoJsonLineString;

/** Liest eine Polygon- ODER LineString-Geometry aus einem GeoJSON-String; null sonst. */
export function parseGeometry(geojson: string | null | undefined): GeoJsonGeometry | null {
  if (!geojson) return null;
  try {
    const v = JSON.parse(geojson);
    if (v?.type === 'Polygon' && Array.isArray(v.coordinates)) return v as GeoJsonPolygon;
    if (v?.type === 'LineString' && Array.isArray(v.coordinates)) return v as GeoJsonLineString;
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/lagekarte/geo.test.ts 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/geo.ts frontend/src/pages/lagekarte/geo.test.ts
git commit -m "feat(fe): geo.ts parseGeometry für Polygon + LineString (L-3)"
```

---

## Task 9: Generisches Zeichen-Modul `zeichnen.ts` (löst `abschnittDraw.ts` ab)

**Files:**
- Create: `frontend/src/pages/lagekarte/zeichnen.ts`
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx` (Abschnitt-Zeichnen auf `zeichnen.ts` umstellen)
- Delete: `frontend/src/pages/lagekarte/abschnittDraw.ts` (nach Migration aller Importe)

Spec: „`abschnittDraw.ts` zu einem generischen Modul `zeichnen.ts` verallgemeinern (Polygon + `TerraDrawLineStringMode`), das der L‑2-Abschnitt weiterhin (nur Polygon) nutzt." Verifizierte terra-draw-Modusnamen (terra-draw 1.31.0): Polygon = `"polygon"`, LineString = `"linestring"`.

- [ ] **Step 1: `zeichnen.ts` schreiben**

`frontend/src/pages/lagekarte/zeichnen.ts`:

```typescript
import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { GeoJsonGeometry } from './geo';

export type ZeichenModus = 'polygon' | 'linie';

/** App-Modus → terra-draw-Modusname (terra-draw 1.31.0). */
const MODUS_NAME: Record<ZeichenModus, string> = { polygon: 'polygon', linie: 'linestring' };

export interface Zeichnung {
  starten: (modus: ZeichenModus) => void;
  stoppen: () => void;
  zerstoeren: () => void;
}

/**
 * Aktiviert Polygon- oder Linien-Zeichnen; ruft `onFertig` mit der gezeichneten Geometry auf.
 * Persistenz übernimmt die App; das Roh-Feature wird nach `finish` entfernt.
 */
export function createZeichnung(
  map: maplibregl.Map,
  onFertig: (geometrie: GeoJsonGeometry) => void,
): Zeichnung {
  // terra-draw-maplibre-gl-adapter@1.x nimmt KEIN `lib`-Argument.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode()],
  });
  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && (f.geometry.type === 'Polygon' || f.geometry.type === 'LineString')) {
      onFertig(f.geometry as GeoJsonGeometry);
    }
    draw.removeFeatures(
      draw
        .getSnapshot()
        .map((x) => x.id)
        .filter((i): i is NonNullable<typeof i> => i != null),
    );
  });
  return {
    starten: (modus) => {
      if (!draw.enabled) draw.start();
      draw.setMode(MODUS_NAME[modus]);
    },
    stoppen: () => {
      if (draw.enabled) draw.stop();
    },
    zerstoeren: () => {
      if (draw.enabled) draw.stop();
    },
  };
}
```

- [ ] **Step 2: Bestehende Abschnitt-Nutzung auf `zeichnen.ts` umstellen**

Prüfe Importe von `abschnittDraw`:

Run: `cd frontend && rtk proxy grep -rn "abschnittDraw\|createAbschnittDraw" src/`

In `Kartenflaeche.tsx`: Import `createAbschnittDraw` durch `createZeichnung` ersetzen und den Abschnitt-Draw-Effekt anpassen (Vorbild `Kartenflaeche.tsx:224-236`). Konkret:

```typescript
// vorher:
//   drawRef.current = createAbschnittDraw(map, (poly) => onFlaecheGezeichnetRef.current?.(poly));
//   drawRef.current.starten();
// nachher:
drawRef.current = createZeichnung(map, (g) => {
  if (g.type === 'Polygon') onFlaecheGezeichnetRef.current?.(g);
});
drawRef.current.starten('polygon');
```

(`onFlaecheGezeichnet` erwartet weiterhin ein Polygon — daher der `type`-Guard. Die `GeoJsonPolygon`-Signatur des Abschnitt-Callbacks bleibt unverändert.)

- [ ] **Step 3: `abschnittDraw.ts` entfernen**

Wenn Step 2 der einzige Importer war:

Run: `cd frontend && rtk proxy grep -rn "abschnittDraw" src/` (muss leer sein), dann:

```bash
git rm frontend/src/pages/lagekarte/abschnittDraw.ts
```

Falls ein Test `abschnittDraw` direkt importiert, diesen Test auf `zeichnen.ts` umziehen (gleicher Vertrag) statt die Datei zu behalten.

- [ ] **Step 4: Typecheck + bestehende Abschnitt-Tests**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -15`
Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/LagekartePage.test.tsx 2>&1 | tail -20`
Expected: Typecheck sauber; Abschnitt-Zeichen-Test weiterhin grün (Kartenflaeche ist im Test gemockt, die Umstellung berührt die Page-Logik nicht).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/zeichnen.ts frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "refactor(fe): generisches zeichnen.ts (Polygon+Linie) löst abschnittDraw ab (L-3)"
```

---

## Task 10: `Kartenflaeche.tsx` — Zonen rendern, zeichnen, anklicken

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

Vorbild: die Abschnitt-Fläche (`sorgeFuerAbschnittLayer`/`baueFlaechenFc` `Kartenflaeche.tsx:50-83`, Daten-Effekt `:199-210`, Klick `:212-222`, Draw-Effekt `:224-236`). Zonen nutzen **datengetriebenes** Paint (Stil steckt in den Feature-Properties), weil Typ/Farbe je Feature variieren.

- [ ] **Step 1: Zonen-Props + Feature-Typ ergänzen**

Im Props-Interface von `Kartenflaeche` (am Anfang der Datei) ergänzen:

```typescript
import type { GeoJsonGeometry } from './geo';
import type { ZeichenModus } from './zeichnen';
import type { ZoneStil } from './zonenStil';

export interface ZoneFeature {
  id: number;
  geometrie: GeoJsonGeometry;
  label: string | null;
  stil: ZoneStil;
}

// in KartenflaecheProps ergänzen:
//   zonen?: ZoneFeature[];
//   zoneZeichnen?: ZeichenModus | null;   // null/undefined = nicht zeichnen
//   onZoneGezeichnet?: (geometrie: GeoJsonGeometry) => void;
//   onZoneKlick?: (id: number) => void;
```

- [ ] **Step 2: Source/Layer-Helfer für Zonen**

Neben `sorgeFuerAbschnittLayer` einfügen:

```typescript
type ZonenFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: number;
    properties: {
      id: number;
      label: string;
      fillColor: string;
      fillOpacity: number;
      lineColor: string;
      lineWidth: number;
    };
    geometry: GeoJsonGeometry;
  }>;
};

function baueZonenFc(zonen: ZoneFeature[] | undefined): ZonenFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (zonen ?? []).map((z) => ({
      type: 'Feature',
      id: z.id,
      properties: {
        id: z.id,
        label: z.label ?? '',
        fillColor: z.stil.fillColor,
        fillOpacity: z.stil.fillOpacity,
        lineColor: z.stil.lineColor,
        lineWidth: z.stil.lineWidth,
      },
      geometry: z.geometrie,
    })),
  };
}

/** Idempotent: Source + fill/line/label-Layer für Zonen (datengetriebenes Paint). */
function sorgeFuerZonenLayer(map: maplibregl.Map, daten: ZonenFeatureCollection) {
  if (!map.getSource('zonen')) {
    map.addSource('zonen', { type: 'geojson', data: daten as never });
  }
  if (!map.getLayer('zonen-fill')) {
    map.addLayer({
      id: 'zonen-fill',
      type: 'fill',
      source: 'zonen',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] },
    });
  }
  if (!map.getLayer('zonen-line')) {
    map.addLayer({
      id: 'zonen-line',
      type: 'line',
      source: 'zonen',
      paint: { 'line-color': ['get', 'lineColor'], 'line-width': ['get', 'lineWidth'] },
    });
  }
  if (!map.getLayer('zonen-label')) {
    map.addLayer({
      id: 'zonen-label',
      type: 'symbol',
      source: 'zonen',
      layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'symbol-placement': 'point' },
      paint: { 'text-color': '#1f1f1f', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    });
  }
}
```

> Für `Polygon`-Features platziert MapLibre das `point`-Symbol am Zentroid, für `LineString` an der Linienmitte — ein Label-Layer deckt beide ab. Eine Schraffur für `sperrgebiet` ist bewusst nicht enthalten (graue Füllung genügt; Schraffur bräuchte ein `fill-pattern`-Image und ist Scope-Erweiterung).

- [ ] **Step 3: `styledata`-Hook erweitern + Daten-Effekt + Klick + Draw**

Im bestehenden `styledata`-Handler (`Kartenflaeche.tsx:119-124`) nach `sorgeFuerAbschnittLayer(...)` ergänzen: `sorgeFuerZonenLayer(map, zonenDatenRef.current);` (mit `const zonenDatenRef = useRef<ZonenFeatureCollection>(baueZonenFc(undefined));` neben dem bestehenden `flaechenDatenRef`).

Daten-Effekt (Vorbild `:199-210`):

```typescript
useEffect(() => {
  const fc = baueZonenFc(zonen);
  zonenDatenRef.current = fc;
  const map = mapRef.current;
  if (!map || !map.isStyleLoaded()) return;
  sorgeFuerZonenLayer(map, fc);
  const src = map.getSource('zonen') as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(fc as never);
}, [zonen]);
```

Klick (Vorbild `:212-222`) — auf Fill **und** Linie:

```typescript
useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  const handler = (e: maplibregl.MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id;
    if (id != null) onZoneKlick?.(Number(id));
  };
  map.on('click', 'zonen-fill', handler);
  map.on('click', 'zonen-line', handler);
  return () => {
    map.off('click', 'zonen-fill', handler);
    map.off('click', 'zonen-line', handler);
  };
}, [onZoneKlick]);
```

Draw-Effekt (Vorbild `:224-236`, separater Ref `zoneDrawRef`, mit Ref auf den aktuellen Callback wie beim Abschnitt):

```typescript
const zoneDrawRef = useRef<Zeichnung | null>(null);
const onZoneGezeichnetRef = useRef(onZoneGezeichnet);
useEffect(() => { onZoneGezeichnetRef.current = onZoneGezeichnet; }, [onZoneGezeichnet]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (zoneZeichnen) {
    if (!zoneDrawRef.current) {
      zoneDrawRef.current = createZeichnung(map, (g) => onZoneGezeichnetRef.current?.(g));
    }
    zoneDrawRef.current.starten(zoneZeichnen);
  } else if (zoneDrawRef.current) {
    zoneDrawRef.current.stoppen();
  }
}, [zoneZeichnen]);
```

(Import `Zeichnung`, `createZeichnung` aus `./zeichnen`.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -15`
Expected: keine Fehler. (MapLibre-Expression-Typen ggf. via `as never` bei `paint`/`filter` glätten, falls die Typen meckern — bestehender Stil in dieser Datei nutzt `as never` bereits.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): Kartenflaeche rendert/zeichnet Zonen (datengetriebenes Paint) (L-3)"
```

---

## Task 11: `useZonenStream.ts` — Live-Resync

**Files:**
- Create: `frontend/src/etb/useZonenStream.ts`

Vorbild: `frontend/src/etb/useAbschnitteStream.ts`. **Event-Tag muss `lage_zone` heißen** (identisch zum Backend-Publish in Task 4) — sonst feuert der Resync nie.

- [ ] **Step 1: Hook schreiben**

`frontend/src/etb/useZonenStream.ts`:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den Zonen-SSE-Kanal und invalidiert die Zonen-Query bei Änderungen. */
export function useZonenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/zonen/stream`);
    const resync = () => {
      qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
    };
    quelle.addEventListener('lage_zone', resync);
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('lage_zone', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -10`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/etb/useZonenStream.ts
git commit -m "feat(fe): useZonenStream Live-Resync für Lage-Zonen (L-3)"
```

---

## Task 12: `ZonenInspector.tsx` — Bearbeiten/Löschen

**Files:**
- Create: `frontend/src/pages/lagekarte/ZonenInspector.tsx`

Editierbar: Typ (Select), Label, Notiz, Farbe (nur freie Skizze). Löschen-Button. **Kein** Stützpunkt-Editing, **keine** Geometrie-Änderung (Annahme 5). Vorbild für Ant-Design-Card/Felder: `Inspector.tsx:49-114`.

- [ ] **Step 1: Komponente schreiben**

`frontend/src/pages/lagekarte/ZonenInspector.tsx`:

```typescript
import { Button, Card, Input, Select, Space, Typography } from 'antd';
import type { LageZone, ZoneTyp } from '../../api/types';
import { ZONE_TYPEN, zoneTypLabel } from './zonenStil';

export interface ZonenInspectorProps {
  zone: LageZone;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  /** Partielles PATCH (nur geänderte Felder). */
  onAendern: (patch: { typ?: ZoneTyp; label?: string | null; farbe?: string | null; notiz?: string | null }) => void;
  onLoeschen: () => void;
}

/** Inspector für eine Zone: Typ/Label/Notiz/Farbe ändern (PATCH) + löschen (DELETE). */
export default function ZonenInspector({ zone, darfSchreiben, onSchliessen, onAendern, onLoeschen }: ZonenInspectorProps) {
  const istFreieSkizze = zone.typ === 'freie_skizze';
  // Beim Typ-Wechsel sind nur Typen mit passender Geometrie zulässig (Geometrie ist fix).
  const erlaubteTypen = ZONE_TYPEN.filter(
    (t) => t.geometrie === 'beides' || t.geometrie === zone.geometrie_typ,
  );

  return (
    <Card
      title={zone.label?.trim() ? zone.label : zoneTypLabel(zone.typ)}
      extra={<Button type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      size="small"
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {darfSchreiben ? (
          <Select<ZoneTyp>
            aria-label="Zonen-Typ"
            value={zone.typ}
            style={{ width: '100%' }}
            options={erlaubteTypen.map((t) => ({ value: t.typ, label: t.label }))}
            onChange={(v) => onAendern({ typ: v })}
          />
        ) : (
          <Typography.Text>{zoneTypLabel(zone.typ)}</Typography.Text>
        )}

        <Input
          aria-label="Label"
          placeholder="Bezeichnung"
          defaultValue={zone.label ?? ''}
          disabled={!darfSchreiben}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (zone.label ?? '')) onAendern({ label: v || null });
          }}
        />

        {istFreieSkizze && (
          <Input
            aria-label="Farbe"
            type="color"
            value={zone.farbe ?? '#1677ff'}
            disabled={!darfSchreiben}
            onChange={(e) => onAendern({ farbe: e.target.value })}
          />
        )}

        <Input.TextArea
          aria-label="Notiz"
          placeholder="Notiz"
          defaultValue={zone.notiz ?? ''}
          disabled={!darfSchreiben}
          rows={2}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (zone.notiz ?? '')) onAendern({ notiz: v || null });
          }}
        />

        {darfSchreiben && (
          <Button danger onClick={onLoeschen}>
            Zone aufheben
          </Button>
        )}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -10`
Expected: keine Fehler. (Falls die Ant-Design-Import-Namen/Versionen abweichen, an `Inspector.tsx` ausrichten.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/lagekarte/ZonenInspector.tsx
git commit -m "feat(fe): ZonenInspector zum Bearbeiten/Aufheben einer Zone (L-3)"
```

---

## Task 13: `LagekartePage` + `Sidebar` verdrahten

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`

Integration der Bausteine. Vorbild durchgehend: die Abschnitt-Verdrahtung (Query `:86-89`, `flaechen`-Memo `:125-157`, Draw-Start `:287-291`, `onFlaecheGezeichnet` `:320-325`, `useAbschnitteStream` `:20`).

- [ ] **Step 1: Layer-State, Query, Live-Hook**

In `LagekartePage.tsx`:

```typescript
// Imports
import { listeZonen, legeZoneAn, aktualisiereZone, loescheZone } from '../api/lagezonen';
import { useZonenStream } from '../etb/useZonenStream';
import { zoneStil, type ZoneTypInfo } from './lagekarte/zonenStil';
import { parseGeometry } from './lagekarte/geo';
import ZonenInspector from './lagekarte/ZonenInspector';
import type { ZeichenModus } from './lagekarte/zeichnen';
import type { ZoneFeature } from './lagekarte/Kartenflaeche';

// LayerSichtbar um zone erweitern (Default true):
const [layer, setLayer] = useState<LayerSichtbar>({
  einsatzort: true, uhs: true, schaden: true, einheit: true, fahrzeug: true, fuehrung: true, abschnitt: true, zone: true,
});

// Zonen laden + live:
const zonenQuery = useQuery({
  queryKey: ['einsatz-zonen', einsatzId],
  queryFn: () => listeZonen(einsatzId),
});
useZonenStream(einsatzId);

// Zeichen-/Auswahl-State:
const [zoneEntwurf, setZoneEntwurf] = useState<{ typ: ZoneTyp; modus: ZeichenModus; farbe?: string } | null>(null);
const [zoneAuswahl, setZoneAuswahl] = useState<number | null>(null);
```

Außerdem `LayerSichtbar` (Typdefinition in dieser Datei oder `Sidebar.tsx`) um `zone: boolean;` ergänzen.

- [ ] **Step 2: Zonen-Features ableiten**

```typescript
const zonenFeatures = useMemo<ZoneFeature[]>(
  () =>
    (layer.zone ? zonenQuery.data ?? [] : []).flatMap((z) => {
      const g = parseGeometry(z.geometrie);
      if (!g) return [];
      return [{ id: z.id, geometrie: g, label: z.label, stil: zoneStil(z.typ, z.farbe) }];
    }),
  [zonenQuery.data, layer.zone],
);

const ausgewaehlteZone = useMemo(
  () => (zonenQuery.data ?? []).find((z) => z.id === zoneAuswahl) ?? null,
  [zonenQuery.data, zoneAuswahl],
);
```

- [ ] **Step 3: Kartenflaeche-Props + Callbacks**

An `<Kartenflaeche .../>` ergänzen:

```typescript
zonen={zonenFeatures}
zoneZeichnen={zoneEntwurf ? zoneEntwurf.modus : null}
onZoneKlick={(id) => {
  setZoneAuswahl(id);
  setAuswahl(null); // bestehende Marker-Auswahl zurücksetzen
}}
onZoneGezeichnet={(g) => {
  if (!zoneEntwurf) return;
  const geometrie_typ = g.type; // 'Polygon' | 'LineString'
  legeZoneAn(einsatzId, {
    typ: zoneEntwurf.typ,
    geometrie_typ,
    geometrie: JSON.stringify(g),
    farbe: zoneEntwurf.typ === 'freie_skizze' ? zoneEntwurf.farbe ?? null : null,
  })
    .then(() => qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] }))
    .catch(fehler)
    .finally(() => setZoneEntwurf(null));
}}
```

(`fehler` ist der bestehende Fehler-Handler der Seite; `qc` der bestehende QueryClient.)

- [ ] **Step 4: ZonenInspector einblenden**

Dort, wo der bestehende `Inspector` gerendert wird, parallel:

```typescript
{ausgewaehlteZone && (
  <ZonenInspector
    zone={ausgewaehlteZone}
    darfSchreiben={darfSchreiben}
    onSchliessen={() => setZoneAuswahl(null)}
    onAendern={(patch) =>
      aktualisiereZone(einsatzId, ausgewaehlteZone.id, patch)
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] }))
        .catch(fehler)
    }
    onLoeschen={() =>
      loescheZone(einsatzId, ausgewaehlteZone.id)
        .then(() => {
          setZoneAuswahl(null);
          return qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
        })
        .catch(fehler)
    }
  />
)}
```

(`darfSchreiben` ist das bestehende Schreibrecht-Flag der Seite.)

- [ ] **Step 5: Sidebar — Layer-Toggle + Zeichen-Steuerung**

In `Sidebar.tsx`:
1. Den bestehenden Layer-Toggle-Block (Einsatzort/…/Abschnitte) um einen Eintrag „Zonen" erweitern, der `layer.zone` schaltet (gleiches Muster wie `abschnitt`).
2. Eine Zeichen-Steuerung „Zone zeichnen" ergänzen: pro Katalog-Typ (`ZONE_TYPEN`) ein Button/Menüeintrag. Klick startet `setZoneEntwurf`:

```typescript
// in Sidebar (Props: onZoneZeichnenStart: (entwurf: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string }) => void)
import { ZONE_TYPEN } from './zonenStil';

ZONE_TYPEN.map((t) => {
  if (t.geometrie === 'beides') {
    // freie Skizze: Fläche ODER Linie + Farbe wählbar
    return (
      <Space key={t.typ}>
        <span>{t.label}</span>
        <Button onClick={() => onZoneZeichnenStart({ typ: t.typ, modus: 'polygon', farbe: '#1677ff' })}>Fläche</Button>
        <Button onClick={() => onZoneZeichnenStart({ typ: t.typ, modus: 'linie', farbe: '#1677ff' })}>Linie</Button>
      </Space>
    );
  }
  const modus: ZeichenModus = t.geometrie === 'LineString' ? 'linie' : 'polygon';
  return (
    <Button key={t.typ} onClick={() => onZoneZeichnenStart({ typ: t.typ, modus })}>
      {t.label} zeichnen
    </Button>
  );
});
```

In `LagekartePage.tsx` die Sidebar-Props verdrahten: `onZoneZeichnenStart={(entwurf) => { setZoneEntwurf(entwurf); setZoneAuswahl(null); setPlatzierungZiel(null); }}` und den Layer-Toggle `layer.zone` an die bestehende `setLayer`-Mechanik hängen (analog `abschnitt`).

> Hinweis: Für die freie Skizze ist die Farbe hier mit `#1677ff` vorbelegt; eine feinere Farbauswahl vor dem Zeichnen ist optional — die Farbe lässt sich nach dem Anlegen jederzeit im `ZonenInspector` ändern.

- [ ] **Step 6: Typecheck + bestehende Page-Tests**

Run: `cd frontend && rtk proxy pnpm exec tsc --noEmit 2>&1 | tail -20`
Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/LagekartePage.test.tsx 2>&1 | tail -20`
Expected: Typecheck sauber; bestehende Tests grün (der MSW-Basishandler braucht jetzt ggf. `GET /api/einsaetze/1/zonen → []` — siehe Task 14, Step 1; falls bestehende Tests vorher fehlschlagen, dort den Handler ergänzen).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LagekartePage.tsx frontend/src/pages/lagekarte/Sidebar.tsx
git commit -m "feat(fe): Lagekarte verdrahtet Zonen-Layer, Zeichnen, Inspector, Live (L-3)"
```

---

## Task 14: Frontend-Tests (Page-Flows)

**Files:**
- Modify: `frontend/src/pages/LagekartePage.test.tsx`

Vorbild: bestehende Datei (Kartenflaeche-Stub `:1-61`, `basisHandler` `:182-199`, Abschnitt-Zeichnen-Test `:371-390`, FakeEventSource). Die Page-Tests mocken `Kartenflaeche` — getestet werden Toggle, Zeichen-Flow→POST (Polygon **und** Linie), Inspector→PATCH, Löschen→DELETE.

- [ ] **Step 1: Kartenflaeche-Stub + Basishandler um Zonen erweitern**

Im `vi.mock('./lagekarte/Kartenflaeche', …)`-Stub ergänzen (analog zu `flaeche-fertig`/`flaeche-{id}`):

```typescript
{props.zoneZeichnen && (
  <button
    onClick={() =>
      props.onZoneGezeichnet?.(
        props.zoneZeichnen === 'linie'
          ? { type: 'LineString', coordinates: [[8.6, 50.1], [8.7, 50.2]] }
          : { type: 'Polygon', coordinates: [[[8.6, 50.1], [8.7, 50.1], [8.7, 50.2], [8.6, 50.1]]] },
      )
    }
  >
    zone-fertig
  </button>
)}
{(props.zonen ?? []).map((z) => (
  <button key={z.id} onClick={() => props.onZoneKlick?.(z.id)}>
    zone-{z.id}
  </button>
))}
```

In `basisHandler` ergänzen: `http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([]))`.

- [ ] **Step 2: Zeichen-Flow-Tests (Polygon + Linie) schreiben**

```typescript
it('zeichnet eine Polygon-Zone: Typ Gefahrengebiet → zeichnen → POST mit geometrie_typ Polygon', async () => {
  let body: { typ?: string; geometrie_typ?: string; geometrie?: string } | null = null;
  basisHandler([
    http.post('/api/einsaetze/1/zonen', async ({ request }) => {
      body = (await request.json()) as typeof body;
      return HttpResponse.json({ id: 5, einsatz_id: 1, typ: body!.typ, geometrie_typ: body!.geometrie_typ, geometrie: body!.geometrie, label: null, farbe: null, notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' });
    }),
  ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
  await user.click(await screen.findByText('zone-fertig'));
  await waitFor(() => expect(body).not.toBeNull());
  expect(body!.typ).toBe('gefahrengebiet');
  expect(body!.geometrie_typ).toBe('Polygon');
  expect(JSON.parse(body!.geometrie as string).type).toBe('Polygon');
});

it('zeichnet eine Linien-Zone: Absperrgrenze → zeichnen → POST mit geometrie_typ LineString', async () => {
  let body: { typ?: string; geometrie_typ?: string } | null = null;
  basisHandler([
    http.post('/api/einsaetze/1/zonen', async ({ request }) => {
      body = (await request.json()) as typeof body;
      return HttpResponse.json({ id: 6, einsatz_id: 1, typ: 'absperrgrenze', geometrie_typ: 'LineString', geometrie: '{}', label: null, farbe: null, notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' });
    }),
  ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByRole('button', { name: 'Absperrgrenze zeichnen' }));
  await user.click(await screen.findByText('zone-fertig'));
  await waitFor(() => expect(body).not.toBeNull());
  expect(body!.typ).toBe('absperrgrenze');
  expect(body!.geometrie_typ).toBe('LineString');
});
```

- [ ] **Step 3: Inspector-Edit (PATCH) + Löschen (DELETE) schreiben**

```typescript
const ZONE_FREI = { id: 7, einsatz_id: 1, typ: 'freie_skizze', geometrie_typ: 'Polygon',
  geometrie: '{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}',
  label: 'Skizze', farbe: '#00ff00', notiz: null, erstellt_von: 1, erstellt_at: '', geaendert_at: '' };

it('öffnet den Inspector per Klick und ändert das Label (PATCH)', async () => {
  let patch: { label?: string } | null = null;
  basisHandler([
    http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
    http.patch('/api/einsaetze/1/zonen/7', async ({ request }) => {
      patch = (await request.json()) as typeof patch;
      return HttpResponse.json({ ...ZONE_FREI, label: patch!.label });
    }),
  ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByText('zone-7'));
  const labelInput = await screen.findByLabelText('Label');
  await user.clear(labelInput);
  await user.type(labelInput, 'Neu');
  await user.tab(); // onBlur löst PATCH aus
  await waitFor(() => expect(patch).not.toBeNull());
  expect(patch!.label).toBe('Neu');
});

it('hebt eine Zone auf (DELETE)', async () => {
  let geloescht = false;
  basisHandler([
    http.get('/api/einsaetze/1/zonen', () => HttpResponse.json([ZONE_FREI])),
    http.delete('/api/einsaetze/1/zonen/7', () => { geloescht = true; return new HttpResponse(null, { status: 204 }); }),
  ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByText('zone-7'));
  await user.click(await screen.findByRole('button', { name: 'Zone aufheben' }));
  await waitFor(() => expect(geloescht).toBe(true));
});
```

> Voraussetzung: `renderSeite()` und `darfSchreiben` müssen den Schreibmodus liefern (Admin/Leiter), damit Zeichnen-Buttons und „Zone aufheben" sichtbar sind — gleiche Bedingung wie der bestehende Abschnitt-Zeichnen-Test (`:371`). Falls dort ein bestimmter Einsatz-/Rollen-Fixture nötig ist, denselben verwenden.

- [ ] **Step 4: Tests laufen lassen**

Run: `cd frontend && rtk proxy pnpm exec vitest run src/pages/LagekartePage.test.tsx 2>&1 | tail -30`
Expected: alle neuen + bestehenden Tests PASS.

- [ ] **Step 5: Gate — volle FE-Suite (stabil, ohne Parallel-Flakiness)**

Per Memory `frontend-testsuite-parallel-timeouts`: volle Suite seriell fahren.

Run: `cd frontend && rtk proxy pnpm exec vitest run --no-file-parallelism 2>&1 | tail -20`
Expected: keine neuen Failures.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LagekartePage.test.tsx
git commit -m "test(fe): Zonen Layer/Zeichnen(Polygon+Linie)/Inspector/Löschen (L-3)"
```

---

## Task 15: Frontend ins Binary einbetten + End-to-End-Bauprüfung

**Files:** keine Code-Änderung — Build/Verifikation.

Per Memory `frontend-in-binary-eingebettet`: das Frontend ist via rust-embed ins Binary eingebettet; FE-Änderungen brauchen `pnpm build` + Backend-Neustart, sonst zeigt `cargo run` das alte Bundle.

- [ ] **Step 1: Frontend bauen**

Run: `cd frontend && rtk proxy pnpm build 2>&1 | tail -15`
Expected: Build erfolgreich (kein Type-/Lint-Fehler).

- [ ] **Step 2: Backend bauen (bettet das frische Bundle ein)**

Run: `rtk proxy cargo build 2>&1 | tail -10`
Expected: kompiliert.

- [ ] **Step 3: Volle Gates final**

Run: `rtk proxy cargo test 2>&1 | tail -15`
Run: `cd frontend && rtk proxy pnpm exec vitest run --no-file-parallelism 2>&1 | tail -15`
Expected: beide grün.

- [ ] **Step 4: PROGRESS aktualisieren**

In `docs/superpowers/PROGRESS.md` unter „Teilprojekt 4 — Lage" L‑3 als DONE markieren (Format der vorhandenen L‑1/L‑2-Einträge übernehmen) und Teilprojekt 4 als funktional abgeschlossen vermerken (L‑4 bleibt geparkt).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs(progress): L-3 Gefahren-/Absperrzonen DONE; Teilprojekt 4 abgeschlossen"
```

---

## Self-Review

**1. Spec-Coverage:**
- Eigenständige typisierte Entität `lage_zone` → Task 1 (Migration), Task 2/3 (Modul/Repo). ✓
- Typ-Katalog mit freie-Skizze-Auffang + Geometriebindung → `geometrie_klasse_passt` (Task 2), POST/PATCH-Validierung (Task 4), `ZONE_TYPEN` (Task 7). ✓
- Stil aus `typ` abgeleitet, nur freie Skizze speichert `farbe` → `zonenStil.ts` (Task 7), Farb-Normalisierung im POST/PATCH (Task 4). ✓
- ETB bei POST/wesentlichem PATCH/DELETE, **nicht** bei notiz/farbe → Task 4 (`etb_text`, effektiver typ/label-Vergleich), Test Task 5. ✓
- Bearbeiten ohne Reshape (Geometrie nicht änderbar) → PATCH ohne Geometrie-Feld (Task 4), Inspector ohne Stützpunkt-Edit (Task 12). ✓
- Live über neuen SSE-Kanal `lage_zone` → Task 4 (`sse_zone`), Task 11 (`useZonenStream`), Tests Task 5/14. ✓
- Org-Bindung implizit über `einsatz_id`, Org-Isolation explizit getestet → Migration (kein eigener Org-FK), Test Task 5. ✓
- CRUD-Routen `/api/einsaetze/{id}/zonen[/{zid}][/stream]` → Task 4. ✓
- Frontend: Layer-Toggle, Zeichnen (Polygon+Linie), Rendering, Klick→Inspector, Live, kein Clustering → Tasks 10–14. ✓
- Hard-Delete → `loese_auf` (Task 3), Test (Task 5). ✓
- Keine neuen Abhängigkeiten (terra-draw LineString-Modus bereits installiert, v1.31.0) → verifiziert; Task 9. ✓

**2. Placeholder-Scan:** Keine „TODO/TBD". Backend- und neue FE-Dateien sind als Vollcode angegeben. Bei drei großen, bestehenden UI-Dateien (`Kartenflaeche.tsx`, `LagekartePage.tsx`, `Sidebar.tsx`) sind die Änderungen als konkrete Code-Blöcke mit Einfügepunkten/Zeilen-Referenzen zum verifizierten Vorbild beschrieben — bewusst, weil ein wörtlicher Vollabdruck dieser Dateien (nicht vollständig vorliegend) Fehler einführen würde; das Muster (Abschnitt-Fläche) ist exakt parallel und im Plan zitiert.

**3. Typ-Konsistenz:** Backend `LageZoneAnzeige` (Felder) == FE `LageZone` (Task 6) == Repo `Row`/`ZoneNeu`/`ZonePatch`. Funktionsnamen konsistent: `geometrie_klasse_passt`, `typ_label`, `etb_text`, `zone_repo::{liste,laden,anlegen,aktualisiere,loese_auf}`. FE: `zoneStil`, `ZONE_TYPEN`, `zoneTypLabel`, `createZeichnung`/`Zeichnung`/`ZeichenModus`, `ZoneFeature`, `useZonenStream`, `listeZonen/legeZoneAn/aktualisiereZone/loescheZone`. SSE-Tag durchgängig `lage_zone` (Publish Task 4 == Listener Task 11 == Test Task 5). Query-Key durchgängig `['einsatz-zonen', einsatzId]`. terra-draw-Modusname `linestring` verifiziert.
