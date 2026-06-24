# Lagekarte: Bild als Hintergrund (LFH-35) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Berechtigte können pro Einsatz mehrere Bilder (PNG/JPG) als Overlay-Hintergrund auf die Lagekarte legen, frei positionieren (Drag + Koordinaten), in Opazität/Sichtbarkeit steuern; persistent im Backend, live für alle Berechtigten.

**Architecture:** Neues einsatz-scoped Backend-Submodul `karte_hintergrundbild` (BLOB in SQLite, Vorbild `anhang` + `lage_zone`), CRUD-Routen unter `/api/einsaetze/{id}/karte/hintergrundbilder`, SSE-Live-Sync über den bestehenden `LiveHub`. Frontend: MapLibre `image`-Source pro Bild (neu, nach dem `fachebenenLayer`-Muster, re-angelegt via `planeReAnlegenNachStyle`), Sidebar-Panel, Drag-/Koordinaten-Platzierung. Bild-Overlays liegen über der Basemap, unter Abschnitten/Zonen/Markern.

**Tech Stack:** Rust/axum, sqlx-sqlite, sha2, mime_guess; React/TypeScript, MapLibre GL, antd, @tanstack/react-query, Vitest/RTL.

## Global Constraints

- **Modul-Key:** `MODUL_KEY = "lagekarte"` (wie `lage_zone`) — kein neuer Registry-Eintrag.
- **Migrationsnummer:** `0075` — vor dem Merge gegen main verifizieren (Parallel-Worktree-Kollision, UNIQUE `_sqlx_migrations.version`).
- **MIME-Allowlist:** nur `image/png` und `image/jpeg`. Validierung über Magic-Bytes (nicht nur Dateiendung).
- **Body-Limit:** Upload-Route mit `DefaultBodyLimit::max(26 * 1024 * 1024)` (Default 2 MiB kappt sonst).
- **Bild-Bytes im Frontend:** via fetch→Blob→`URL.createObjectURL` (same-origin credentials), nicht als direkte image-source-URL. Object-URLs bei Entfernung `revokeObjectURL`.
- **Layer-Reihenfolge:** Bild-Layer mit `beforeId: 'abschnitte-fill'` (Fallback `undefined`) → liegen unter Abschnitten/Zonen/Markern.
- **Frontend tsconfig lib = ES2020:** kein `.at()`, `.findLast()`, `Object.hasOwn` (bricht `tsc --noEmit`, Vitest bleibt grün — Typecheck ist eigenes Gate).
- **antd Modal/message** nur über `App.useApp()` (kein statisches `Modal.confirm`).
- **pnpm via mise:** `mise exec pnpm@<ver> -- pnpm -C <ABS-Pfad> …`, immer absolute `-C`-Pfade.
- **Test-Gates ehrlich:** Pass/Fail über `rtk proxy <cmd>` prüfen; Frontend-Vollsuite mit `--no-file-parallelism`.
- **Worktree-Pfade:** alle Edits unter `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-35-bild-als-hintergrund/` (Backend `src/`, `migrations/`; Frontend `frontend/src/`).

**Datenmodell-Konvention:** `ecken_json` = JSON-Array von genau 4 `[lng, lat]`-Paaren in MapLibre-Reihenfolge (top-left, top-right, bottom-right, bottom-left).

---

## Task-Übersicht

| # | Task | Schicht |
|---|---|---|
| 1 | Migration `0075` + Modul `mod.rs` (Konstanten, Validierung, DTO) | Backend |
| 2 | Repo `repo.rs` (BLOB-CRUD, Ecken/Opazität/Sichtbarkeit-Patch) | Backend |
| 3 | Routen + app.rs-Registrierung + SSE | Backend |
| 4 | PII-Schwärzung (`name` → Platzhalter) | Backend |
| 5 | API-Client `api/kartenbilder.ts` + Blob-URL-Loader | Frontend |
| 6 | Geometrie-Mathematik `bildGeometrie.ts` (Rechteck ↔ 4 Ecken) | Frontend |
| 7 | Overlay-Layer `bildLayer.ts` (image source + raster) | Frontend |
| 8 | Integration in `Kartenflaeche.tsx` (Props, Effekt, Re-Anlage) | Frontend |
| 9 | Sidebar-Panel „Bild-Hintergründe" | Frontend |
| 10 | Platzierungs-Modus (Drag-Handles + KoordinatenEingabe) | Frontend |
| 11 | Verdrahtung in `LagekartePage.tsx` (Queries, SSE, Handler) | Frontend |

---

## Task 1: Migration + Modul-Grundgerüst

**Files:**
- Create: `migrations/0075_karte_hintergrundbild.sql`
- Create: `src/karte_hintergrundbild/mod.rs`
- Modify: `src/lib.rs` (oder `src/main.rs` — wo Module deklariert werden: `pub mod karte_hintergrundbild;`)
- Test: in `src/karte_hintergrundbild/mod.rs` `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `MAX_GROESSE: usize`, `pub fn pruefe_groesse(len: usize) -> Result<(), AppError>`, `pub fn erkenne_bild_mime(daten: &[u8]) -> Result<&'static str, AppError>`, `pub fn pruefe_ecken(ecken_json: &str) -> Result<(), AppError>`, `pub fn pruefe_opazitaet(o: i64) -> Result<(), AppError>`, `pub struct HintergrundbildAnzeige { id, einsatz_id, name, mime, groesse, ecken_json, opazitaet, sichtbar, reihenfolge, hochgeladen_von, erstellt_at, geaendert_at }`.

- [ ] **Step 1: Migration schreiben**

Create `migrations/0075_karte_hintergrundbild.sql`:

```sql
-- LFH-35: Bild-Hintergründe der Lagekarte (Lageplan/Grundriss/Skizze als Overlay).
-- Einsatz-scoped, mehrere pro Einsatz. BLOB in SQLite (Vorbild anhang/0052) —
-- ein Container, VACUUM-INTO-Backup erfasst die Bilder mit. Hard-Delete via CASCADE.
-- ecken_json: JSON-Array von 4 [lng,lat]-Paaren (MapLibre image-source Reihenfolge).
-- Stil (Opazität/Sichtbarkeit/Reihenfolge) am Datensatz; Modul-Sichtbarkeit über "lagekarte".
CREATE TABLE karte_hintergrundbild (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    daten           BLOB    NOT NULL,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    ecken_json      TEXT    NOT NULL,
    opazitaet       INTEGER NOT NULL DEFAULT 100 CHECK (opazitaet BETWEEN 0 AND 100),
    sichtbar        INTEGER NOT NULL DEFAULT 1   CHECK (sichtbar IN (0, 1)),
    reihenfolge     INTEGER NOT NULL DEFAULT 0,
    hochgeladen_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_karte_hintergrundbild_einsatz ON karte_hintergrundbild(einsatz_id);
```

- [ ] **Step 2: Modul-Datei mit Konstanten/DTO/Validierung — failing test zuerst**

Create `src/karte_hintergrundbild/mod.rs` mit leeren Stubs, dann Tests, die fehlschlagen. Test-Block:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // PNG-Magic: 89 50 4E 47 0D 0A 1A 0A ; JPEG: FF D8 FF
    #[test]
    fn erkennt_png() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
        assert_eq!(erkenne_bild_mime(&png).unwrap(), "image/png");
    }
    #[test]
    fn erkennt_jpeg() {
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
        assert_eq!(erkenne_bild_mime(&jpg).unwrap(), "image/jpeg");
    }
    #[test]
    fn lehnt_fremdformat_ab() {
        let gif = *b"GIF89a..";
        assert!(erkenne_bild_mime(&gif).is_err());
    }
    #[test]
    fn groesse_null_und_zu_gross() {
        assert!(pruefe_groesse(0).is_err());
        assert!(pruefe_groesse(MAX_GROESSE + 1).is_err());
        assert!(pruefe_groesse(1024).is_ok());
    }
    #[test]
    fn ecken_genau_vier_paare() {
        let ok = "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]";
        assert!(pruefe_ecken(ok).is_ok());
        assert!(pruefe_ecken("[[9.0,50.0],[9.1,50.0]]").is_err()); // nur 2
        assert!(pruefe_ecken("kein json").is_err());
    }
    #[test]
    fn opazitaet_bereich() {
        assert!(pruefe_opazitaet(0).is_ok());
        assert!(pruefe_opazitaet(100).is_ok());
        assert!(pruefe_opazitaet(101).is_err());
        assert!(pruefe_opazitaet(-1).is_err());
    }
}
```

- [ ] **Step 3: Run, expect fail**

Run: `rtk proxy cargo test -p <crate> karte_hintergrundbild::`
Expected: FAIL (Funktionen/Typen nicht definiert).

- [ ] **Step 4: Implementierung**

In `src/karte_hintergrundbild/mod.rs` oberhalb der Tests:

```rust
pub mod repo;

use crate::error::AppError;
use serde::Serialize;

/// Max. Upload-Größe (wie anhang). Body-Limit der Route liegt knapp darüber.
pub const MAX_GROESSE: usize = 25 * 1024 * 1024;

/// Anzeige-DTO (ohne BLOB-Bytes). `sichtbar` als bool für saubere JSON-Ausgabe.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct HintergrundbildAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub mime: String,
    pub groesse: i64,
    pub ecken_json: String,
    pub opazitaet: i64,
    pub sichtbar: bool,
    pub reihenfolge: i64,
    pub hochgeladen_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

pub fn pruefe_groesse(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::Validation("Bild ist leer".into()));
    }
    if len > MAX_GROESSE {
        return Err(AppError::Validation(format!(
            "Bild ist zu groß ({} MiB erlaubt)",
            MAX_GROESSE / 1024 / 1024
        )));
    }
    Ok(())
}

/// Erkennt den MIME-Typ an den Magic-Bytes (robuster als Dateiendung).
/// Erlaubt nur PNG und JPEG.
pub fn erkenne_bild_mime(daten: &[u8]) -> Result<&'static str, AppError> {
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF];
    if daten.starts_with(PNG) {
        Ok("image/png")
    } else if daten.starts_with(JPEG) {
        Ok("image/jpeg")
    } else {
        Err(AppError::Validation(
            "Nur PNG- oder JPEG-Bilder werden unterstützt".into(),
        ))
    }
}

/// Validiert `ecken_json`: exakt 4 [lng,lat]-Paare.
pub fn pruefe_ecken(ecken_json: &str) -> Result<(), AppError> {
    let ecken: Vec<[f64; 2]> = serde_json::from_str(ecken_json)
        .map_err(|_| AppError::Validation("Ecken sind kein gültiges JSON".into()))?;
    if ecken.len() != 4 {
        return Err(AppError::Validation("Genau 4 Eckpunkte erforderlich".into()));
    }
    Ok(())
}

pub fn pruefe_opazitaet(o: i64) -> Result<(), AppError> {
    if (0..=100).contains(&o) {
        Ok(())
    } else {
        Err(AppError::Validation("Opazität muss 0–100 sein".into()))
    }
}
```

Module deklarieren: in `src/lib.rs` (oder wo `pub mod lage_zone;` steht) `pub mod karte_hintergrundbild;` ergänzen.

- [ ] **Step 5: Run, expect pass**

Run: `rtk proxy cargo test -p <crate> karte_hintergrundbild::`
Expected: PASS (alle 6 Tests). Migration läuft über `cargo test` automatisch via test_pool.

- [ ] **Step 6: Commit**

```bash
git add migrations/0075_karte_hintergrundbild.sql src/karte_hintergrundbild/mod.rs src/lib.rs
git commit -m "feat(lfh-35): Migration + Modul-Grundgerüst karte_hintergrundbild

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Repo (BLOB-CRUD)

**Files:**
- Create: `src/karte_hintergrundbild/repo.rs`
- Test: `#[cfg(test)] mod tests` in `repo.rs` (nutzt `crate::test_support`-Pool wie andere Repos)

**Interfaces:**
- Consumes: `HintergrundbildAnzeige`, `MAX_GROESSE` aus Task 1; `crate::error::AppError`.
- Produces:
  - `pub async fn liste(pool, einsatz_id) -> Result<Vec<HintergrundbildAnzeige>, AppError>`
  - `pub async fn laden(pool, einsatz_id, id) -> Result<HintergrundbildAnzeige, AppError>`
  - `pub async fn laden_bytes(pool, einsatz_id, id) -> Result<(String, Vec<u8>), AppError>` (mime, daten)
  - `pub async fn anlegen(pool, einsatz_id, hochgeladen_von, name, mime, daten, ecken_json) -> Result<HintergrundbildAnzeige, AppError>`
  - `pub struct BildPatch { name: Option<String>, ecken_json: Option<String>, opazitaet: Option<i64>, sichtbar: Option<bool>, reihenfolge: Option<i64> }`
  - `pub async fn aktualisiere(pool, einsatz_id, id, daten: BildPatch) -> Result<HintergrundbildAnzeige, AppError>`
  - `pub async fn loeschen(pool, einsatz_id, id) -> Result<(), AppError>`

- [ ] **Step 1: Failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{test_pool, seed_einsatz_mit_benutzer};

    fn ecken() -> &'static str { "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]" }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = test_pool().await;
        let (eid, uid) = seed_einsatz_mit_benutzer(&pool).await;
        let bytes = [0x89u8, b'P', b'N', b'G', 1, 2, 3];
        let a = anlegen(&pool, eid, uid, "plan.png", "image/png", &bytes, ecken())
            .await
            .unwrap();
        assert_eq!(a.name, "plan.png");
        assert_eq!(a.groesse, bytes.len() as i64);
        assert_eq!(a.opazitaet, 100);
        assert!(a.sichtbar);

        let (mime, daten) = laden_bytes(&pool, eid, a.id).await.unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(daten, bytes);

        let liste = liste(&pool, eid).await.unwrap();
        assert_eq!(liste.len(), 1);
    }

    #[tokio::test]
    async fn patch_opazitaet_und_ecken() {
        let pool = test_pool().await;
        let (eid, uid) = seed_einsatz_mit_benutzer(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89, b'P'], ecken())
            .await.unwrap();
        let neu = "[[8.0,51.0],[8.2,51.0],[8.2,50.8],[8.0,50.8]]";
        let p = aktualisiere(&pool, eid, a.id, BildPatch {
            opazitaet: Some(60), ecken_json: Some(neu.into()), sichtbar: Some(false),
            name: None, reihenfolge: None,
        }).await.unwrap();
        assert_eq!(p.opazitaet, 60);
        assert!(!p.sichtbar);
        assert_eq!(p.ecken_json, neu);
    }

    #[tokio::test]
    async fn fremder_einsatz_notfound() {
        let pool = test_pool().await;
        let (eid, uid) = seed_einsatz_mit_benutzer(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89], ecken()).await.unwrap();
        // anderer Einsatz
        let (eid2, _) = seed_einsatz_mit_benutzer(&pool).await;
        assert!(laden(&pool, eid2, a.id).await.is_err());
    }

    #[tokio::test]
    async fn loeschen_entfernt() {
        let pool = test_pool().await;
        let (eid, uid) = seed_einsatz_mit_benutzer(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89], ecken()).await.unwrap();
        loeschen(&pool, eid, a.id).await.unwrap();
        assert!(liste(&pool, eid).await.unwrap().is_empty());
    }
}
```

> **Hinweis Test-Helper:** Falls `seed_einsatz_mit_benutzer` so nicht existiert, das in `src/test_support.rs` (oder wo `test_pool` lebt) etablierte Pendant nutzen (siehe `lage_zone/repo.rs`-Tests) — Signatur ggf. anpassen, Semantik identisch (legt Einsatz + Benutzer an, gibt deren IDs).

- [ ] **Step 2: Run, expect fail** — `rtk proxy cargo test -p <crate> karte_hintergrundbild::repo`

- [ ] **Step 3: Implementierung** (`src/karte_hintergrundbild/repo.rs`)

```rust
use super::HintergrundbildAnzeige;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

const ANZEIGE_SELECT: &str = "\
    SELECT id, einsatz_id, name, mime, groesse, ecken_json, opazitaet, \
           sichtbar, reihenfolge, hochgeladen_von, erstellt_at, geaendert_at \
    FROM karte_hintergrundbild";

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<HintergrundbildAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, HintergrundbildAnzeige>(
        &format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? ORDER BY reihenfolge, id"),
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<HintergrundbildAnzeige, AppError> {
    sqlx::query_as::<_, HintergrundbildAnzeige>(
        &format!("{ANZEIGE_SELECT} WHERE id = ? AND einsatz_id = ?"),
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn laden_bytes(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(String, Vec<u8>), AppError> {
    sqlx::query_as::<_, (String, Vec<u8>)>(
        "SELECT mime, daten FROM karte_hintergrundbild WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

#[allow(clippy::too_many_arguments)]
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    hochgeladen_von: i64,
    name: &str,
    mime: &str,
    daten: &[u8],
    ecken_json: &str,
) -> Result<HintergrundbildAnzeige, AppError> {
    let groesse = daten.len() as i64;
    let sha = hex(&Sha256::digest(daten));
    // Neue Bilder oben auf den Stapel: max(reihenfolge)+1.
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO karte_hintergrundbild \
            (einsatz_id, name, daten, mime, groesse, sha256, ecken_json, reihenfolge, hochgeladen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, \
            (SELECT COALESCE(MAX(reihenfolge), -1) + 1 FROM karte_hintergrundbild WHERE einsatz_id = ?), \
            ?) RETURNING id",
    )
    .bind(einsatz_id).bind(name).bind(daten).bind(mime).bind(groesse).bind(sha)
    .bind(ecken_json).bind(einsatz_id).bind(hochgeladen_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

#[derive(Debug, Default)]
pub struct BildPatch {
    pub name: Option<String>,
    pub ecken_json: Option<String>,
    pub opazitaet: Option<i64>,
    pub sichtbar: Option<bool>,
    pub reihenfolge: Option<i64>,
}

pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: BildPatch,
) -> Result<HintergrundbildAnzeige, AppError> {
    // Nur gesendete Felder ändern (CASE-WHEN-Muster wie lage_zone); geaendert_at stets neu.
    let betroffen = sqlx::query(
        "UPDATE karte_hintergrundbild SET \
            name        = CASE WHEN ? THEN ? ELSE name END, \
            ecken_json  = CASE WHEN ? THEN ? ELSE ecken_json END, \
            opazitaet   = CASE WHEN ? THEN ? ELSE opazitaet END, \
            sichtbar    = CASE WHEN ? THEN ? ELSE sichtbar END, \
            reihenfolge = CASE WHEN ? THEN ? ELSE reihenfolge END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.name.is_some()).bind(daten.name)
    .bind(daten.ecken_json.is_some()).bind(daten.ecken_json)
    .bind(daten.opazitaet.is_some()).bind(daten.opazitaet)
    .bind(daten.sichtbar.is_some()).bind(daten.sichtbar)
    .bind(daten.reihenfolge.is_some()).bind(daten.reihenfolge)
    .bind(id).bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query("DELETE FROM karte_hintergrundbild WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

> **`sichtbar` bool ↔ INTEGER:** sqlx-sqlite mappt `bool` ↔ `INTEGER 0/1` automatisch (in bind und FromRow). Falls die `FromRow`-Ableitung auf `sichtbar: bool` gegen die INTEGER-Spalte fehlschlägt, im `query_as` denselben Weg wie bestehende bool-Spalten im Projekt nutzen (grep nach `: bool,` in `sqlx::FromRow`-Structs als Referenz).

- [ ] **Step 4: Run, expect pass** — alle 4 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add src/karte_hintergrundbild/repo.rs
git commit -m "feat(lfh-35): Repo für karte_hintergrundbild (BLOB-CRUD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Routen + Registrierung + SSE

**Files:**
- Create: `src/routes/karte_hintergrundbild.rs`
- Modify: `src/routes/mod.rs` (`pub mod karte_hintergrundbild;`)
- Modify: `src/app.rs` (5 Routen registrieren, Upload mit `DefaultBodyLimit`)
- Test: `tests/` Integrationstest oder Handler-Tests im Routen-Modul (Muster wie bestehende Routen-Tests)

**Interfaces:**
- Consumes: `karte_hintergrundbild::{repo, erkenne_bild_mime, pruefe_groesse, pruefe_ecken, pruefe_opazitaet, HintergrundbildAnzeige}`; `fordere_lesezugriff/schreibrecht/aktiv`, `fordere_modul_zugriff_laden`; `einsatz_repo::{laden, rolle_von}`; `state.live.publiziere_event`.
- Produces: Handler `liste`, `hochladen`, `herunterladen`, `aktualisieren`, `loeschen`.

- [ ] **Step 1: Handler schreiben** (`src/routes/karte_hintergrundbild.rs`)

```rust
use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::karte_hintergrundbild::{
    self as bild, repo as bild_repo, repo::BildPatch, HintergrundbildAnzeige,
};
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

const MODUL_KEY: &str = "lagekarte";

/// SSE-Notify: ein Bild-Hintergrund hat sich geändert. Event-Tag `karte_bild`.
fn sse_bild(state: &AppState, einsatz_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id }).to_string();
    state.live.publiziere_event(einsatz_id, "karte_bild", data);
}

/// GET Liste (Metadaten ohne BLOB). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<HintergrundbildAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    Ok(Json(bild_repo::liste(&state.pool, einsatz_id).await?))
}

/// POST Multipart-Upload. Felder: `datei` (Bytes), `ecken` (JSON-String der 4 Ecken),
/// optional `name`. Schreibrecht + aktiv.
pub async fn hochladen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<HintergrundbildAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    let mut bytes: Option<Vec<u8>> = None;
    let mut ecken: Option<String> = None;
    let mut name: Option<String> = None;

    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        match feld.name() {
            Some("datei") => {
                if name.is_none() {
                    name = feld.file_name().map(str::to_string);
                }
                let b = feld.bytes().await
                    .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
                bytes = Some(b.to_vec());
            }
            Some("ecken") => {
                ecken = Some(feld.text().await
                    .map_err(|e| AppError::Validation(format!("Ecken lesen fehlgeschlagen: {e}")))?);
            }
            Some("name") => {
                name = Some(feld.text().await
                    .map_err(|e| AppError::Validation(format!("Name lesen fehlgeschlagen: {e}")))?);
            }
            _ => {}
        }
    }

    let bytes = bytes.ok_or_else(|| AppError::Validation("Kein Bild im Upload".into()))?;
    let ecken = ecken.ok_or_else(|| AppError::Validation("Ecken fehlen".into()))?;
    bild::pruefe_groesse(bytes.len())?;
    let mime = bild::erkenne_bild_mime(&bytes)?;
    bild::pruefe_ecken(&ecken)?;
    let name = name.unwrap_or_else(|| "Bild-Hintergrund".into());

    let a = bild_repo::anlegen(&state.pool, einsatz_id, benutzer.id, &name, mime, &bytes, &ecken).await?;
    sse_bild(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(a)))
}

/// GET Download der Bytes. Nur Lesezugriff; Ownership über `laden_bytes(einsatz_id, id)`.
pub async fn herunterladen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    let (mime, daten) = bild_repo::laden_bytes(&state.pool, einsatz_id, bild_id).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    Ok((headers, daten))
}

#[derive(Debug, Deserialize)]
pub struct BildPatchBody {
    pub name: Option<String>,
    pub ecken_json: Option<String>,
    pub opazitaet: Option<i64>,
    pub sichtbar: Option<bool>,
    pub reihenfolge: Option<i64>,
}

/// PATCH Stil/Geometrie ohne Neuupload. Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
    Json(body): Json<BildPatchBody>,
) -> Result<Json<HintergrundbildAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if let Some(o) = body.opazitaet {
        bild::pruefe_opazitaet(o)?;
    }
    if let Some(e) = &body.ecken_json {
        bild::pruefe_ecken(e)?;
    }

    let a = bild_repo::aktualisiere(&state.pool, einsatz_id, bild_id, BildPatch {
        name: body.name,
        ecken_json: body.ecken_json,
        opazitaet: body.opazitaet,
        sichtbar: body.sichtbar,
        reihenfolge: body.reihenfolge,
    }).await?;
    sse_bild(&state, einsatz_id);
    Ok(Json(a))
}

/// DELETE (Hard-Delete). Schreibrecht + aktiv.
pub async fn loeschen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;
    bild_repo::loeschen(&state.pool, einsatz_id, bild_id).await?;
    sse_bild(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}
```

> **Live-Stream:** Bild-Events laufen über den bestehenden Einsatz-SSE-Kanal (Event-Tag `karte_bild`). Ein eigener `/stream`-Handler ist **nicht** nötig — das Frontend abonniert den Einsatz-Stream über `useEinsatzLiveStream` (eine Verbindung pro Einsatz) und filtert auf `karte_bild`.

- [ ] **Step 2: Routen registrieren** (`src/app.rs`, beim Zonen-Block):

```rust
.route("/api/einsaetze/{id}/karte/hintergrundbilder", get(routes::karte_hintergrundbild::liste))
.route(
    "/api/einsaetze/{id}/karte/hintergrundbilder",
    post(routes::karte_hintergrundbild::hochladen).layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
)
.route("/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}/download", get(routes::karte_hintergrundbild::herunterladen))
.route("/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}", patch(routes::karte_hintergrundbild::aktualisieren))
.route("/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}", delete(routes::karte_hintergrundbild::loeschen))
```

In `src/routes/mod.rs`: `pub mod karte_hintergrundbild;`.

- [ ] **Step 3: Handler-Test (Berechtigung + Upload-Roundtrip)**

Test nach dem Muster bestehender Routen-Tests (grep `async fn` in einem `tests/`-File oder Routen-`#[cfg(test)]`). Mindest-Abdeckung:

```rust
// Pseudo-Struktur — an die Projekt-Test-Harness (Router-Builder + Test-Client) anpassen.
#[tokio::test]
async fn upload_dann_liste_und_download() {
    let app = test_app().await;              // baut Router + seedet Admin/Einsatz
    let (eid, _cookie_leiter) = seed_aktiver_einsatz(&app).await;
    // Multipart mit datei=PNG-Bytes + ecken=JSON posten → 201
    // GET liste → 1 Eintrag
    // GET .../download → 200, Content-Type image/png, Bytes == Upload
}

#[tokio::test]
async fn beobachter_darf_nicht_hochladen() {
    // Rolle ohne Schreibrecht → POST → 403
}

#[tokio::test]
async fn nicht_bild_wird_abgelehnt() {
    // datei = b"GIF89a" → 400 (erkenne_bild_mime)
}
```

> Falls die Test-Harness Multipart umständlich macht, mindestens die Berechtigungs- und Validierungspfade über die Repo- + Validierungs-Funktionen (Task 1/2) abdecken und den Upload-Pfad per manuellem Smoke-Test (Task 11) verifizieren. Den Verzicht im Commit-Text vermerken (keine stille Lücke).

- [ ] **Step 4: Run** — `rtk proxy cargo test -p <crate>` (gesamtes Backend grün).

- [ ] **Step 5: Commit**

```bash
git add src/routes/karte_hintergrundbild.rs src/routes/mod.rs src/app.rs
git commit -m "feat(lfh-35): Routen + SSE für karte_hintergrundbild

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: PII-Schwärzung

**Files:**
- Modify: `src/einsatz/repo.rs` (`schwaerze_einsatz`)
- Test: bestehender Schwärzungs-Test erweitern (grep `schwaerze_einsatz` in Tests)

**Interfaces:** keine neuen; ergänzt nur ein UPDATE-Statement.

- [ ] **Step 1: Test erweitern**

Im bestehenden Schwärzungs-Test ein Bild anlegen, schwärzen, prüfen dass `name` Platzhalter ist, `daten` aber erhalten bleibt:

```rust
// im schwaerze_einsatz-Test, nach dem Anlegen der anderen PII-Daten:
let bild = crate::karte_hintergrundbild::repo::anlegen(
    &pool, einsatz_id, uid, "Lageplan Familie Müller.png", "image/png",
    &[0x89, b'P', b'N', b'G'], "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]",
).await.unwrap();
// ... schwaerze_einsatz(...) ...
let nachher = crate::karte_hintergrundbild::repo::liste(&pool, einsatz_id).await.unwrap();
assert_eq!(nachher[0].name, SCHWAERZUNG_PLATZHALTER);          // Name geschwärzt
let (_, daten) = crate::karte_hintergrundbild::repo::laden_bytes(&pool, einsatz_id, bild.id).await.unwrap();
assert!(!daten.is_empty());                                     // Bytes bleiben (Kartografie)
```

- [ ] **Step 2: Run, expect fail** — Name noch nicht geschwärzt.

- [ ] **Step 3: UPDATE ergänzen** in `schwaerze_einsatz` (bei den anderen Scrub-Statements):

```rust
// Bild-Hintergründe (LFH-35): Dateiname kann PII tragen → Platzhalter; BLOB bleibt (Kartografie).
sqlx::query("UPDATE karte_hintergrundbild SET name = ? WHERE einsatz_id = ?")
    .bind(SCHWAERZUNG_PLATZHALTER)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/repo.rs
git commit -m "feat(lfh-35): PII-Schwärzung des Bild-Hintergrund-Namens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Memory-Hinweis:** Neue PII-Spalten an Einsatz-Tabellen gehören in `schwaerze_einsatz` (LFH-135) — hier erledigt.

---

## Task 5: Frontend API-Client

**Files:**
- Create: `frontend/src/api/kartenbilder.ts`
- Modify: `frontend/src/api/types.ts` (Typ `Hintergrundbild`)
- Test: `frontend/src/api/kartenbilder.test.ts` (dünn — fetch-Pfade)

**Interfaces:**
- Consumes: `apiGet`, `apiSend`, `apiUpload` aus `api/client.ts`.
- Produces:
  - `interface Hintergrundbild { id, einsatz_id, name, mime, groesse, ecken_json, opazitaet, sichtbar, reihenfolge, hochgeladen_von, erstellt_at, geaendert_at }`
  - `type Ecke = [number, number]; type Ecken = [Ecke, Ecke, Ecke, Ecke]`
  - `listeHintergrundbilder(einsatzId): Promise<Hintergrundbild[]>`
  - `ladeHintergrundbildHoch(einsatzId, datei: File, ecken: Ecken, name?: string): Promise<Hintergrundbild>`
  - `aktualisiereHintergrundbild(einsatzId, id, patch: BildPatch): Promise<Hintergrundbild>`
  - `loescheHintergrundbild(einsatzId, id): Promise<void>`
  - `bildDownloadPfad(einsatzId, id): string`
  - `ladeBildBlobUrl(einsatzId, id): Promise<string>`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listeHintergrundbilder, ladeHintergrundbildHoch, bildDownloadPfad } from './kartenbilder';

describe('kartenbilder API', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('liste ruft den richtigen Pfad', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200 }),
    );
    await listeHintergrundbilder(7);
    expect(fetchMock).toHaveBeenCalledWith('/api/einsaetze/7/karte/hintergrundbilder', expect.anything());
  });

  it('download-pfad ist stabil', () => {
    expect(bildDownloadPfad(7, 3)).toBe('/api/einsaetze/7/karte/hintergrundbilder/3/download');
  });

  it('upload hängt datei + ecken als FormData an', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"id":1}', { status: 201 }),
    );
    const datei = new File([new Uint8Array([0x89])], 'plan.png', { type: 'image/png' });
    await ladeHintergrundbildHoch(7, datei, [[9,50],[9.1,50],[9.1,49.9],[9,49.9]]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBeInstanceOf(FormData);
    const fd = init!.body as FormData;
    expect(fd.get('datei')).toBeInstanceOf(File);
    expect(fd.get('ecken')).toBe('[[9,50],[9.1,50],[9.1,49.9],[9,49.9]]');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implementierung** (`frontend/src/api/kartenbilder.ts`)

```typescript
import { apiGet, apiSend, apiUpload } from './client';

export type Ecke = [number, number]; // [lng, lat]
export type Ecken = [Ecke, Ecke, Ecke, Ecke];

export interface Hintergrundbild {
  id: number;
  einsatz_id: number;
  name: string;
  mime: string;
  groesse: number;
  ecken_json: string;
  opazitaet: number;   // 0..100
  sichtbar: boolean;
  reihenfolge: number;
  hochgeladen_von: number;
  erstellt_at: string;
  geaendert_at: string;
}

export interface BildPatch {
  name?: string;
  ecken_json?: string;
  opazitaet?: number;
  sichtbar?: boolean;
  reihenfolge?: number;
}

const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/karte/hintergrundbilder`;

export function listeHintergrundbilder(einsatzId: number): Promise<Hintergrundbild[]> {
  return apiGet<Hintergrundbild[]>(basis(einsatzId));
}

export function ladeHintergrundbildHoch(
  einsatzId: number,
  datei: File,
  ecken: Ecken,
  name?: string,
): Promise<Hintergrundbild> {
  const fd = new FormData();
  fd.append('datei', datei);
  fd.append('ecken', JSON.stringify(ecken));
  if (name) fd.append('name', name);
  return apiUpload<Hintergrundbild>(basis(einsatzId), fd);
}

export function aktualisiereHintergrundbild(
  einsatzId: number,
  id: number,
  patch: BildPatch,
): Promise<Hintergrundbild> {
  return apiSend<Hintergrundbild>(`${basis(einsatzId)}/${id}`, 'PATCH', patch);
}

export function loescheHintergrundbild(einsatzId: number, id: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/${id}`, 'DELETE');
}

export function bildDownloadPfad(einsatzId: number, id: number): string {
  return `${basis(einsatzId)}/${id}/download`;
}

/** Lädt die Bild-Bytes (same-origin, mit Cookies) und liefert eine Object-URL.
 *  Aufrufer MUSS die URL später mit URL.revokeObjectURL freigeben. */
export async function ladeBildBlobUrl(einsatzId: number, id: number): Promise<string> {
  const res = await fetch(bildDownloadPfad(einsatzId, id), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Bild ${id} konnte nicht geladen werden (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/kartenbilder.ts frontend/src/api/kartenbilder.test.ts
git commit -m "feat(lfh-35): Frontend-API-Client für Bild-Hintergründe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Geometrie-Mathematik (Rechteck ↔ 4 Ecken)

**Files:**
- Create: `frontend/src/pages/lagekarte/bildGeometrie.ts`
- Test: `frontend/src/pages/lagekarte/bildGeometrie.test.ts`

**Interfaces:**
- Consumes: `Ecke`, `Ecken` aus `api/kartenbilder.ts`.
- Produces:
  - `interface Rechteck { center: Ecke; breiteGrad: number; hoeheGrad: number; rotationGrad: number }`
  - `eckenAusRechteck(r: Rechteck): Ecken`
  - `rechteckAusEcken(e: Ecken): Rechteck`
  - `eckenAusBounds(west, sued, ost, nord): Ecken` (achsenparallel, für initialen Upload aus dem Viewport)

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { eckenAusRechteck, rechteckAusEcken, eckenAusBounds } from './bildGeometrie';

describe('bildGeometrie', () => {
  it('achsenparalleles Rechteck (rotation 0) ergibt erwartete Ecken', () => {
    const ecken = eckenAusRechteck({ center: [9, 50], breiteGrad: 0.2, hoeheGrad: 0.1, rotationGrad: 0 });
    // TL, TR, BR, BL — lng links<rechts, lat oben>unten
    expect(ecken[0][0]).toBeLessThan(ecken[1][0]);   // TL.lng < TR.lng
    expect(ecken[0][1]).toBeGreaterThan(ecken[3][1]); // TL.lat > BL.lat
    expect(ecken[0][1]).toBeCloseTo(50.05, 6);        // oben = center.lat + hoehe/2
  });

  it('roundtrip Rechteck → Ecken → Rechteck ist stabil', () => {
    const r = { center: [9, 50] as [number, number], breiteGrad: 0.2, hoeheGrad: 0.1, rotationGrad: 30 };
    const zurueck = rechteckAusEcken(eckenAusRechteck(r));
    expect(zurueck.center[0]).toBeCloseTo(9, 6);
    expect(zurueck.center[1]).toBeCloseTo(50, 6);
    expect(zurueck.breiteGrad).toBeCloseTo(0.2, 6);
    expect(zurueck.hoeheGrad).toBeCloseTo(0.1, 6);
    expect(((zurueck.rotationGrad % 360) + 360) % 360).toBeCloseTo(30, 4);
  });

  it('Rotation ist winkeltreu (Seitenverhältnis bleibt bei Bildschirm-Metrik)', () => {
    const r = { center: [9, 50] as [number, number], breiteGrad: 0.2, hoeheGrad: 0.2, rotationGrad: 45 };
    const e = eckenAusRechteck(r);
    const latCos = Math.cos(50 * Math.PI / 180);
    const dist = (a: number[], b: number[]) => Math.hypot((a[0]-b[0])*latCos, a[1]-b[1]);
    // gleichseitig in Bildschirm-Metrik (breite==hoehe) → alle Kanten gleich lang
    expect(dist(e[0], e[1])).toBeCloseTo(dist(e[1], e[2]), 6);
  });

  it('eckenAusBounds liefert achsenparallele 4 Ecken', () => {
    const e = eckenAusBounds(8, 49, 9, 50);
    expect(e).toEqual([[8,50],[9,50],[9,49],[8,49]]);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implementierung** (`frontend/src/pages/lagekarte/bildGeometrie.ts`)

```typescript
import type { Ecke, Ecken } from '../../api/kartenbilder';

export interface Rechteck {
  center: Ecke;        // [lng, lat]
  breiteGrad: number;  // lng-Ausdehnung in Grad bei rotation=0
  hoeheGrad: number;   // lat-Ausdehnung in Grad
  rotationGrad: number;
}

const grad = (r: number) => (r * Math.PI) / 180;

/** Rechteck → 4 Ecken (TL, TR, BR, BL). Rotation winkeltreu in Bildschirm-Metrik
 *  (lng wird mit cos(lat) skaliert, damit Drehung das Bild nicht verzerrt). */
export function eckenAusRechteck(r: Rechteck): Ecken {
  const [clng, clat] = r.center;
  const latCos = Math.cos(grad(clat)) || 1e-9;
  const cos = Math.cos(grad(r.rotationGrad));
  const sin = Math.sin(grad(r.rotationGrad));
  const hw = r.breiteGrad / 2;
  const hh = r.hoeheGrad / 2;
  // lokale Offsets [dLng, dLat] vor Rotation: TL, TR, BR, BL
  const lokal: Ecke[] = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
  const ecken = lokal.map(([dx, dy]) => {
    // in isotropen (Bildschirm-)Raum: x metrisch = dLng * latCos
    const mx = dx * latCos;
    const my = dy;
    const rx = mx * cos - my * sin;
    const ry = mx * sin + my * cos;
    return [clng + rx / latCos, clat + ry] as Ecke;
  });
  return ecken as Ecken;
}

/** 4 Ecken → Rechteck. center = Schwerpunkt; breite/hoehe aus Kantenlängen
 *  (TL-TR bzw. TL-BL), Rotation aus dem Winkel der oberen Kante. */
export function rechteckAusEcken(e: Ecken): Rechteck {
  const [tl, tr, , bl] = e;
  const clng = (e[0][0] + e[1][0] + e[2][0] + e[3][0]) / 4;
  const clat = (e[0][1] + e[1][1] + e[2][1] + e[3][1]) / 4;
  const latCos = Math.cos(grad(clat)) || 1e-9;
  // obere Kante TL→TR in Bildschirm-Metrik
  const ox = (tr[0] - tl[0]) * latCos;
  const oy = tr[1] - tl[1];
  const breiteScreen = Math.hypot(ox, oy);
  // linke Kante TL→BL
  const lx = (bl[0] - tl[0]) * latCos;
  const ly = bl[1] - tl[1];
  const hoeheScreen = Math.hypot(lx, ly);
  const rotationGrad = (Math.atan2(oy, ox) * 180) / Math.PI;
  return {
    center: [clng, clat],
    breiteGrad: breiteScreen / latCos,
    hoeheGrad: hoeheScreen,
    rotationGrad,
  };
}

/** Achsenparallele Ecken aus Bounds (für initialen Upload aus dem Viewport). */
export function eckenAusBounds(west: number, sued: number, ost: number, nord: number): Ecken {
  return [[west, nord], [ost, nord], [ost, sued], [west, sued]];
}
```

> **Hinweis Roundtrip-Test:** `breiteGrad` wird über die Bildschirm-Metrik definiert; bei `rotation=0` ist `breiteScreen = breiteGrad*latCos`, also `breiteScreen/latCos = breiteGrad` — stabil. Der Test nutzt `breiteGrad: 0.2` bei `lat 50`; die Implementierung ist konsistent dazu.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/bildGeometrie.ts frontend/src/pages/lagekarte/bildGeometrie.test.ts
git commit -m "feat(lfh-35): Geometrie-Mathematik Rechteck ↔ 4 Ecken

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Overlay-Layer (`image`-Source)

**Files:**
- Create: `frontend/src/pages/lagekarte/bildLayer.ts`
- Test: `frontend/src/pages/lagekarte/bildLayer.test.ts`

**Interfaces:**
- Consumes: MapLibre `Map`, `ImageSource`; `Ecken` aus `api/kartenbilder`.
- Produces:
  - `interface BildOverlay { id: number; blobUrl: string; ecken: Ecken; opazitaet: number; sichtbar: boolean }`
  - `bildSourceId(id): string`, `bildLayerId(id): string`
  - `sorgeFuerBildLayer(map, overlay, beforeId?)` (idempotent: image source + raster layer)
  - `setzeBildGeometrie(map, id, ecken)`
  - `setzeBildOpazitaet(map, id, opazitaet, sichtbar)`
  - `entferneBildLayer(map, id)`
  - `synchronisiereBildLayer(map, overlays, beforeId?)` (anlegen/aktualisieren/entfernen gegen Soll-Liste)

- [ ] **Step 1: Test** (fakeMap-Muster aus `fachebenenLayer.test.ts`, erweitert um setPaintProperty/getSource.setCoordinates)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sorgeFuerBildLayer, entferneBildLayer, synchronisiereBildLayer, bildSourceId, bildLayerId } from './bildLayer';
import type { Ecken } from '../../api/kartenbilder';

const ECKEN: Ecken = [[9,50],[9.1,50],[9.1,49.9],[9,49.9]];

function fakeMap() {
  const sources = new Map<string, { setCoordinates: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const paint: Record<string, Record<string, unknown>> = {};
  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string) => sources.set(id, { setCoordinates: vi.fn() })),
    removeSource: vi.fn((id: string) => sources.delete(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? {} : undefined)),
    addLayer: vi.fn((l: { id: string }) => layers.add(l.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    setPaintProperty: vi.fn((lid: string, prop: string, val: unknown) => {
      (paint[lid] ??= {})[prop] = val;
    }),
    _sources: sources, _layers: layers, _paint: paint,
  };
}

describe('bildLayer', () => {
  it('legt image source + raster layer idempotent an', () => {
    const map = fakeMap();
    const ov = { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 80, sichtbar: true };
    sorgeFuerBildLayer(map as never, ov);
    sorgeFuerBildLayer(map as never, ov); // zweimal → kein zweites add
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    expect(map._layers.has(bildLayerId(3))).toBe(true);
  });

  it('opazitaet*sichtbar steuert raster-opacity', () => {
    const map = fakeMap();
    sorgeFuerBildLayer(map as never, { id: 3, blobUrl: 'blob:x', ecken: ECKEN, opazitaet: 50, sichtbar: false });
    // unsichtbar → 0, egal welche opazitaet
    expect(map._paint[bildLayerId(3)]['raster-opacity']).toBe(0);
  });

  it('synchronisiere entfernt nicht mehr vorhandene', () => {
    const map = fakeMap();
    synchronisiereBildLayer(map as never, [{ id: 1, blobUrl: 'b', ecken: ECKEN, opazitaet: 100, sichtbar: true }]);
    expect(map._layers.has(bildLayerId(1))).toBe(true);
    synchronisiereBildLayer(map as never, []); // jetzt leer
    expect(map._layers.has(bildLayerId(1))).toBe(false);
    expect(map._sources.has(bildSourceId(1))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implementierung** (`frontend/src/pages/lagekarte/bildLayer.ts`)

```typescript
import type { Map as MapLibreMap, ImageSource } from 'maplibre-gl';
import type { Ecken } from '../../api/kartenbilder';

export interface BildOverlay {
  id: number;
  blobUrl: string;
  ecken: Ecken;
  opazitaet: number; // 0..100
  sichtbar: boolean;
}

export const bildSourceId = (id: number) => `bild-${id}`;
export const bildLayerId = (id: number) => `bild-${id}-raster`;

const opacityWert = (o: BildOverlay) => (o.sichtbar ? o.opazitaet / 100 : 0);

/** Idempotent: image source + raster layer. `beforeId` platziert den Layer unter
 *  den Vektor-Overlays (Abschnitte/Zonen), damit Marker/Zonen darüber liegen. */
export function sorgeFuerBildLayer(map: MapLibreMap, ov: BildOverlay, beforeId?: string) {
  const sid = bildSourceId(ov.id);
  if (!map.getSource(sid)) {
    map.addSource(sid, {
      type: 'image',
      url: ov.blobUrl,
      coordinates: ov.ecken as unknown as [[number, number], [number, number], [number, number], [number, number]],
    } as never);
  }
  const lid = bildLayerId(ov.id);
  if (!map.getLayer(lid)) {
    const vorAnker = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer({
      id: lid,
      type: 'raster',
      source: sid,
      paint: { 'raster-opacity': opacityWert(ov), 'raster-fade-duration': 0 },
    }, vorAnker);
  } else {
    map.setPaintProperty(lid, 'raster-opacity', opacityWert(ov));
  }
}

export function setzeBildGeometrie(map: MapLibreMap, id: number, ecken: Ecken) {
  const s = map.getSource(bildSourceId(id)) as ImageSource | undefined;
  s?.setCoordinates(ecken as unknown as [[number, number], [number, number], [number, number], [number, number]]);
}

export function setzeBildOpazitaet(map: MapLibreMap, id: number, opazitaet: number, sichtbar: boolean) {
  const lid = bildLayerId(id);
  if (map.getLayer(lid)) {
    map.setPaintProperty(lid, 'raster-opacity', sichtbar ? opazitaet / 100 : 0);
  }
}

export function entferneBildLayer(map: MapLibreMap, id: number) {
  const lid = bildLayerId(id);
  if (map.getLayer(lid)) map.removeLayer(lid);
  const sid = bildSourceId(id);
  if (map.getSource(sid)) map.removeSource(sid);
}

/** Soll-Abgleich: legt fehlende an, aktualisiert Geometrie/Opazität bestehender,
 *  entfernt nicht mehr gelistete. Gibt die aktuell vorhandenen IDs zurück. */
export function synchronisiereBildLayer(
  map: MapLibreMap,
  overlays: BildOverlay[],
  beforeId?: string,
): Set<number> {
  const soll = new Set(overlays.map((o) => o.id));
  // anlegen / aktualisieren (in reihenfolge: Aufrufer sortiert overlays aufsteigend)
  for (const ov of overlays) {
    sorgeFuerBildLayer(map, ov, beforeId);
    setzeBildGeometrie(map, ov.id, ov.ecken);
    setzeBildOpazitaet(map, ov.id, ov.opazitaet, ov.sichtbar);
  }
  return soll;
}
```

> **Blob-URL-Wechsel:** `synchronisiereBildLayer` legt eine image-source nur an, wenn sie fehlt — ein geänderter `blobUrl` (neuer Upload mit gleicher id gibt es nicht, da Upload neue id) ist daher kein Fall. Beim Entfernen eines Overlays ruft der Aufrufer (Task 8) zusätzlich `URL.revokeObjectURL(blobUrl)`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/bildLayer.ts frontend/src/pages/lagekarte/bildLayer.test.ts
git commit -m "feat(lfh-35): MapLibre image-Overlay-Layer für Bild-Hintergründe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Integration in `Kartenflaeche.tsx`

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`
- Test: ergänze `frontend/src/pages/lagekarte/Kartenflaeche.test.tsx` (oder neue gezielte Datei), Schwerpunkt: Bild-Effekt + Re-Anlage nach Style-Wechsel.

**Interfaces:**
- Consumes: `BildOverlay`, `synchronisiereBildLayer`, `entferneBildLayer` aus `bildLayer.ts`.
- Produces: neue Prop `bilder?: BildOverlay[]` auf `KartenflaecheProps`; Bild-Layer werden in `planeReAnlegenNachStyle`-Pfad mit re-angelegt.

- [ ] **Step 1: Prop + Ref + Effekt ergänzen**

In `KartenflaecheProps` (bei `fachebenen?`):

```typescript
  /** Bild-Hintergründe (Overlays über der Basemap, unter Abschnitten/Zonen/Markern). */
  bilder?: BildOverlay[];
```

Import oben: `import { synchronisiereBildLayer, entferneBildLayer, type BildOverlay } from './bildLayer';`

Ref bei den anderen Daten-Refs:

```typescript
  const bilderRef = useRef<BildOverlay[]>([]);
  const vorherigeBilderRef = useRef<Set<number>>(new Set());
```

In `map.on('load', …)` (nach den Fachebenen) — Bilder zuerst, damit sie unter `abschnitte-fill` landen:

```typescript
      synchronisiereBildLayer(map, bilderRef.current, 'abschnitte-fill');
```

> **Reihenfolge `on('load')`:** Da `abschnitte-fill` im selben load-Callback VOR diesem Aufruf angelegt wird, existiert der Anker. Den Bild-Aufruf NACH `sorgeFuerAbschnittLayer` platzieren (beforeId muss existieren).

Neuer Effekt (analog Fachebenen-Effekt, Z. 308–326):

```typescript
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktiv = bilder ?? [];
    bilderRef.current = aktiv;
    wendeKartenDatenAn(map, () => {
      const aktivIds = synchronisiereBildLayer(map, aktiv, 'abschnitte-fill');
      for (const id of vorherigeBilderRef.current) {
        if (!aktivIds.has(id)) entferneBildLayer(map, id);
      }
      vorherigeBilderRef.current = aktivIds;
    });
  }, [bilder]);
```

In `planeReAnlegenNachStyle`-Aufruf (Style-Wechsel-Effekt) den Bild-Getter ergänzen — **die Signatur von `planeReAnlegenNachStyle` muss um `getBilder` erweitert werden** (siehe Step 2).

- [ ] **Step 2: `planeReAnlegenNachStyle` + `reAnlegenAlles` um Bilder erweitern**

In `kartenLayer.ts` `reAnlegenAlles` Signatur + Body erweitern:

```typescript
import { synchronisiereBildLayer, type BildOverlay } from './bildLayer';

export function reAnlegenAlles(
  map: MapLibreMap,
  flaechen: FlaechenFeatureCollection,
  zonen: ZonenFeatureCollection,
  fachebenen: AktiveFachebene[] = [],
  bilder: BildOverlay[] = [],
) {
  // Bilder zuerst (vor abschnitte-fill, das gleich angelegt wird → beforeId noch nicht da:
  // daher OHNE beforeId anlegen und danach abschnitte/zonen drüber legen).
  synchronisiereBildLayer(map, bilder);
  sorgeFuerAbschnittLayer(map, flaechen);
  (map.getSource('abschnitte') as GeoJSONSource | undefined)?.setData(flaechen as never);
  sorgeFuerZonenLayer(map, zonen);
  (map.getSource('zonen') as GeoJSONSource | undefined)?.setData(zonen as never);
  for (const fe of fachebenen) {
    sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
    setzeFachebeneDaten(map, fe.def.key, fe.daten);
  }
}
```

> **Layer-Reihenfolge bei Re-Anlage:** Da nach `setStyle` ALLE Custom-Layer weg sind und in dieser Reihenfolge neu angelegt werden (Bilder → Abschnitte → Zonen → Fachebenen), liegen die Bilder automatisch unten — ohne `beforeId`. (Beim inkrementellen Effekt in Step 1 existiert `abschnitte-fill` dagegen schon, daher dort MIT `beforeId`.)

`planeReAnlegenNachStyle` Signatur erweitern:

```typescript
export function planeReAnlegenNachStyle(
  map: Pick<MapLibreMap, 'isStyleLoaded' | 'on' | 'off'> & MapLibreMap,
  getFlaechen: () => FlaechenFeatureCollection,
  getZonen: () => ZonenFeatureCollection,
  getFachebenen: () => AktiveFachebene[] = () => [],
  getBilder: () => BildOverlay[] = () => [],
) {
  wendeKartenDatenAn(map, () =>
    reAnlegenAlles(map, getFlaechen(), getZonen(), getFachebenen(), getBilder()),
  );
}
```

Im `Kartenflaeche.tsx` Style-Wechsel-Effekt den Aufruf ergänzen:

```typescript
    planeReAnlegenNachStyle(
      map,
      () => flaechenDatenRef.current,
      () => zonenDatenRef.current,
      () => fachebenenRef.current,
      () => bilderRef.current,
    );
```

- [ ] **Step 3: Test (Re-Anlage nach Style-Wechsel)**

Erweitere `kartenLayer.test.ts` (fakeMap-Variante mit image-source-Support aus Task 7 wiederverwenden):

```typescript
it('reAnlegenAlles legt Bild-Layer mit an', () => {
  const map = fakeMapMitBild(); // fakeMap inkl. addSource(image)/setPaintProperty
  reAnlegenAlles(map as never, leereFlaechen, leereZonen, [], [
    { id: 5, blobUrl: 'blob:x', ecken: [[9,50],[9.1,50],[9.1,49.9],[9,49.9]], opazitaet: 100, sichtbar: true },
  ]);
  expect(map._layers.has('bild-5-raster')).toBe(true);
});
```

- [ ] **Step 4: Run, expect pass** (`bildLayer`, `kartenLayer`, `Kartenflaeche` grün).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx frontend/src/pages/lagekarte/kartenLayer.ts frontend/src/pages/lagekarte/kartenLayer.test.ts
git commit -m "feat(lfh-35): Bild-Overlays in Kartenflaeche + Re-Anlage nach Style-Wechsel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Sidebar-Panel „Bild-Hintergründe"

**Files:**
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`
- Test: `frontend/src/pages/lagekarte/Sidebar.test.tsx` (RTL, `renderMitProviders`)

**Interfaces:**
- Consumes: `Hintergrundbild` aus `api/kartenbilder`.
- Produces (neue SidebarProps):
  - `bilder: Hintergrundbild[]`
  - `onBildUpload: (datei: File) => void`
  - `onBildToggle: (id: number, sichtbar: boolean) => void`
  - `onBildOpazitaet: (id: number, opazitaet: number) => void`
  - `onBildPlatzieren: (id: number) => void`
  - `onBildLoeschen: (id: number) => void`
  - `bildPlatzierenId: number | null`

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import Sidebar from './Sidebar';

const basisProps = { /* … minimale Pflicht-Props der bestehenden SidebarProps … */ } as never;

describe('Sidebar Bild-Hintergründe', () => {
  it('listet Bilder und schaltet Sichtbarkeit', () => {
    const onBildToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[{ id: 1, name: 'Lageplan', opazitaet: 80, sichtbar: true, einsatz_id: 7,
          mime: 'image/png', groesse: 1, ecken_json: '[]', reihenfolge: 0,
          hochgeladen_von: 1, erstellt_at: '', geaendert_at: '' }]}
        onBildToggle={onBildToggle}
        bildPlatzierenId={null}
      />,
    );
    expect(screen.getByText('Lageplan')).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Lageplan/i });
    fireEvent.click(sw);
    expect(onBildToggle).toHaveBeenCalledWith(1, false);
  });

  it('ohne Schreibrecht kein Upload-Button', () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben={false} bilder={[]} bildPlatzierenId={null} />);
    expect(screen.queryByText(/Bild hochladen/i)).not.toBeInTheDocument();
  });
});
```

> Die `basisProps` müssen alle bestehenden Pflicht-Props von `SidebarProps` erfüllen — beim Schreiben des Tests die aktuelle Interface-Definition kopieren und mit Dummies füllen (Muster aus bestehendem `Inspector.test.tsx`).

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implementierung**

`SidebarProps` um die o.g. Felder erweitern. Neuer `<Card>`-Abschnitt (nach „Fachebenen", vor „Basemap"). Upload über antd `Upload` mit `beforeUpload` (kein Auto-Post — wir rufen `onBildUpload` und geben `false` zurück):

```tsx
import { Upload, Slider, Button, Popconfirm } from 'antd';
import { UploadOutlined, AimOutlined, DeleteOutlined } from '@ant-design/icons';

// … in JSX:
<Card size="small" title="Bild-Hintergründe" style={{ marginBottom: 12 }}>
  <Space direction="vertical" style={{ width: '100%' }}>
    {props.bilder.map((b) => (
      <div key={b.id} style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 6 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Switch
              checked={b.sichtbar}
              aria-label={b.name}
              onChange={(v) => props.onBildToggle(b.id, v)}
            />
            <span>{b.name}</span>
          </Space>
          {props.darfSchreiben && (
            <Space>
              <Button
                size="small"
                type={props.bildPlatzierenId === b.id ? 'primary' : 'default'}
                icon={<AimOutlined />}
                onClick={() => props.onBildPlatzieren(b.id)}
                aria-label={`${b.name} platzieren`}
              />
              <Popconfirm
                title="Bild entfernen?"
                onConfirm={() => props.onBildLoeschen(b.id)}
                okText="Entfernen"
                cancelText="Abbrechen"
              >
                <Button size="small" danger icon={<DeleteOutlined />} aria-label={`${b.name} löschen`} />
              </Popconfirm>
            </Space>
          )}
        </Space>
        <Slider
          min={0}
          max={100}
          value={b.opazitaet}
          disabled={!props.darfSchreiben}
          onChange={(v) => props.onBildOpazitaet(b.id, v as number)}
          tooltip={{ formatter: (v) => `${v}%` }}
        />
      </div>
    ))}
    {props.darfSchreiben && (
      <Upload
        accept="image/png,image/jpeg"
        showUploadList={false}
        beforeUpload={(datei) => {
          props.onBildUpload(datei as File);
          return false; // kein Auto-Upload — wir handhaben es selbst
        }}
      >
        <Button icon={<UploadOutlined />} size="small">Bild hochladen</Button>
      </Upload>
    )}
  </Space>
</Card>
```

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx frontend/src/pages/lagekarte/Sidebar.test.tsx
git commit -m "feat(lfh-35): Sidebar-Panel Bild-Hintergründe (Upload/Toggle/Opazität/Löschen)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Platzierungs-Modus (Drag + Koordinaten)

**Files:**
- Create: `frontend/src/pages/lagekarte/BildPlatzierenPanel.tsx` (Koordinaten-Eingabe der 4 Ecken / des Rechtecks)
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx` (Drag-Handles für das aktive Platzier-Bild)
- Test: `frontend/src/pages/lagekarte/BildPlatzierenPanel.test.tsx`

**Interfaces:**
- Consumes: `Rechteck`, `eckenAusRechteck`, `rechteckAusEcken` (Task 6); `KoordinatenEingabe` (`anzeige/KoordinatenEingabe.tsx`, `value: LatLon`); `Ecken`.
- Produces:
  - `BildPlatzierenPanel`-Props: `ecken: Ecken; onChange: (ecken: Ecken) => void; onFertig: () => void; einsatzId: number`
  - Kartenflaeche-Prop: `platzierBild?: { id: number; ecken: Ecken } | null; onPlatzierGeometrie?: (ecken: Ecken) => void`

- [ ] **Step 1: Panel-Test** (numerische Eingabe ändert Ecken über das Rechteck-Modell)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import BildPlatzierenPanel from './BildPlatzierenPanel';

const ECKEN = [[9,50],[9.1,50],[9.1,49.9],[9,49.9]] as const;

it('Center-Koordinateneingabe verschiebt alle Ecken', () => {
  const onChange = vi.fn();
  renderMitProviders(
    <BildPlatzierenPanel einsatzId={7} ecken={ECKEN as never} onChange={onChange} onFertig={() => {}} />,
  );
  const input = screen.getByPlaceholderText('Koordinate eingeben'); // KoordinatenEingabe (Center)
  fireEvent.change(input, { target: { value: '50.0, 9.5' } }); // WGS84 "lat, lon"
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalled();
  const neueEcken = onChange.mock.calls.at(-1)![0];
  // center.lng verschob sich Richtung 9.5
  const cLng = (neueEcken[0][0] + neueEcken[1][0] + neueEcken[2][0] + neueEcken[3][0]) / 4;
  expect(cLng).toBeCloseTo(9.5, 3);
});
```

> **ES2020-Hinweis:** `.at(-1)` ist im Test (Vitest/esbuild) ok, aber in PRODUKTIONSCODE verboten (tsconfig lib ES2020). Im Panel `arr[arr.length - 1]` verwenden.

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Panel-Implementierung** (`BildPlatzierenPanel.tsx`)

```tsx
import { Card, Space, Slider, Typography, Button } from 'antd';
import KoordinatenEingabe from '../../anzeige/KoordinatenEingabe';
import type { LatLon } from '../../anzeige/koordinaten';
import type { Ecken } from '../../api/kartenbilder';
import { eckenAusRechteck, rechteckAusEcken } from './bildGeometrie';

interface Props {
  einsatzId: number;
  ecken: Ecken;
  onChange: (ecken: Ecken) => void;
  onFertig: () => void;
}

export default function BildPlatzierenPanel({ einsatzId, ecken, onChange, onFertig }: Props) {
  const r = rechteckAusEcken(ecken);
  const center: LatLon = { lat: r.center[1], lon: r.center[0] };

  const setCenter = (wert: LatLon | null) => {
    if (!wert) return;
    onChange(eckenAusRechteck({ ...r, center: [wert.lon, wert.lat] }));
  };
  const setRotation = (grad: number) => onChange(eckenAusRechteck({ ...r, rotationGrad: grad }));
  const setBreite = (faktor: number) => onChange(eckenAusRechteck({ ...r, breiteGrad: r.breiteGrad * faktor }));

  return (
    <Card size="small" title="Bild platzieren">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Bild auf der Karte verschieben/skalieren (Ziehgriffe) oder Mittelpunkt numerisch setzen.
        </Typography.Text>
        <Typography.Text>Mittelpunkt</Typography.Text>
        <KoordinatenEingabe value={center} onChange={setCenter} einsatzId={einsatzId} />
        <Typography.Text>Drehung</Typography.Text>
        <Slider min={-180} max={180} value={Math.round(r.rotationGrad)}
          onChange={(v) => setRotation(v as number)} tooltip={{ formatter: (v) => `${v}°` }} />
        <Typography.Text>Größe</Typography.Text>
        <Slider min={50} max={200} defaultValue={100}
          onChange={(v) => setBreite((v as number) / 100)} tooltip={{ formatter: (v) => `${v}%` }} />
        <Button type="primary" block onClick={onFertig}>Platzierung übernehmen</Button>
      </Space>
    </Card>
  );
}
```

> **Größe-Slider:** ändert Breite UND Höhe proportional — im Handler beide skalieren (`breiteGrad` und `hoeheGrad`), damit das Seitenverhältnis erhalten bleibt. (Im Code oben nur Breite gezeigt; Höhe analog ergänzen: `{ ...r, breiteGrad: r.breiteGrad*faktor, hoeheGrad: r.hoeheGrad*faktor }`.) Der Slider arbeitet relativ; nach „übernehmen" wird neu gemountet.

- [ ] **Step 4: Drag-Handles in Kartenflaeche** (ein zweites GeoJSON-Layer-Set mit ziehbaren Eck-Markern, wenn `platzierBild` aktiv)

Minimaler Ansatz mit MapLibre-`Marker` (DOM, draggable) für die 4 Ecken + Mittelpunkt:
- Bei aktivem `platzierBild`: 5 `maplibregl.Marker({ draggable: true })` an Center + 4 Ecken setzen.
- `on('drag')` des Center-Markers → alle Ecken verschieben (Delta); Eck-Marker → Rechteck-Modell neu berechnen (`rechteckAusEcken` mit der gezogenen Ecke), Seitenverhältnis über `eckenAusRechteck` erzwingen.
- `on('dragend')` → `onPlatzierGeometrie(neueEcken)`.
- Marker entfernen, sobald `platzierBild` null wird.

```typescript
// Skizze in Kartenflaeche (eigener useEffect, gated auf platzierBild):
useEffect(() => {
  const map = mapRef.current;
  if (!map || !platzierBild) return;
  const markers: maplibregl.Marker[] = [];
  const r = rechteckAusEcken(platzierBild.ecken);
  const center = new maplibregl.Marker({ draggable: true, color: '#1677ff' })
    .setLngLat(r.center as [number, number]).addTo(map);
  center.on('drag', () => {
    const ll = center.getLngLat();
    const neu = eckenAusRechteck({ ...rechteckAusEcken(platzierBild.ecken), center: [ll.lng, ll.lat] });
    onPlatzierGeometrie?.(neu);
  });
  markers.push(center);
  // (Eck-Marker analog; für MVP genügt Center-Verschieben + Panel-Rotation/Größe)
  return () => { markers.forEach((m) => m.remove()); };
}, [platzierBild]);
```

> **MVP-Schnitt (bewusst, geloggt):** Interaktiv = Mittelpunkt-Drag auf der Karte; Drehung + Größe laufen über das Panel (Slider). Vier einzeln ziehbare Eck-Handles sind die Ausbaustufe — wird im Commit-Text als bewusste Reduktion vermerkt, nicht still weggelassen.

- [ ] **Step 5: Run + Commit**

```bash
git add frontend/src/pages/lagekarte/BildPlatzierenPanel.tsx frontend/src/pages/lagekarte/BildPlatzierenPanel.test.tsx frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(lfh-35): Platzierungs-Modus (Mittelpunkt-Drag + Koordinaten/Drehung/Größe-Panel)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Verdrahtung in `LagekartePage.tsx`

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`
- Test: bestehende `LagekartePage.test.tsx` um einen Smoke-Pfad erweitern (Bild in der Liste → Overlay-Prop an Kartenflaeche).

**Interfaces:**
- Consumes: alles aus Tasks 5–10; `useEinsatzLiveStream` (bestehender SSE-Hook).
- Produces: keine — Endverdrahtung.

- [ ] **Step 1: Query + State**

```typescript
import { listeHintergrundbilder, aktualisiereHintergrundbild, ladeHintergrundbildHoch,
         loescheHintergrundbild, ladeBildBlobUrl, type Hintergrundbild, type Ecken } from '../api/kartenbilder';
import { eckenAusBounds } from './lagekarte/bildGeometrie';
import type { BildOverlay } from './lagekarte/bildLayer';

// Query (react-query), scoped wie die übrigen Einsatz-Queries:
const bilderQuery = useQuery({
  queryKey: ['einsatz-kartenbilder', einsatzId],
  queryFn: () => listeHintergrundbilder(einsatzId),
});
```

- [ ] **Step 2: Blob-URLs verwalten** (Map id→blobUrl, laden bei neuen Bildern, revoke bei entfernten)

```typescript
const [blobUrls, setBlobUrls] = useState<Record<number, string>>({});
useEffect(() => {
  const bilder = bilderQuery.data ?? [];
  let abgebrochen = false;
  // neue laden
  for (const b of bilder) {
    if (!blobUrls[b.id]) {
      ladeBildBlobUrl(einsatzId, b.id).then((url) => {
        if (!abgebrochen) setBlobUrls((m) => ({ ...m, [b.id]: url }));
      }).catch(() => {});
    }
  }
  // entfernte revoken
  const aktiveIds = new Set(bilder.map((b) => b.id));
  for (const idStr of Object.keys(blobUrls)) {
    const id = Number(idStr);
    if (!aktiveIds.has(id)) {
      URL.revokeObjectURL(blobUrls[id]);
      setBlobUrls((m) => { const n = { ...m }; delete n[id]; return n; });
    }
  }
  return () => { abgebrochen = true; };
}, [bilderQuery.data, einsatzId]);
```

- [ ] **Step 3: Overlays bauen + an Kartenflaeche geben**

```typescript
const bildOverlays: BildOverlay[] = (bilderQuery.data ?? [])
  .filter((b) => blobUrls[b.id])
  .map((b) => ({
    id: b.id,
    blobUrl: blobUrls[b.id],
    ecken: JSON.parse(b.ecken_json) as Ecken,
    opazitaet: b.opazitaet,
    sichtbar: b.sichtbar,
  }));
// <Kartenflaeche … bilder={bildOverlays} platzierBild={…} onPlatzierGeometrie={…} />
```

- [ ] **Step 4: Handler (Upload/Toggle/Opazität/Platzieren/Löschen) + SSE-Invalidierung**

```typescript
const qc = useQueryClient();
const invalidiere = () => qc.invalidateQueries({ queryKey: ['einsatz-kartenbilder', einsatzId] });

const onBildUpload = async (datei: File) => {
  const b = map?.getBounds(); // aktueller Viewport als initiale Bounds
  const ecken: Ecken = b
    ? eckenAusBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth())
    : eckenAusBounds(9, 49.9, 9.1, 50);
  await ladeHintergrundbildHoch(einsatzId, datei, ecken, datei.name);
  invalidiere();
};
const onBildToggle = async (id: number, sichtbar: boolean) => {
  await aktualisiereHintergrundbild(einsatzId, id, { sichtbar }); invalidiere();
};
const onBildOpazitaet = async (id: number, opazitaet: number) => {
  await aktualisiereHintergrundbild(einsatzId, id, { opazitaet }); invalidiere();
};
const onBildLoeschen = async (id: number) => {
  await loescheHintergrundbild(einsatzId, id); invalidiere();
};
const onPlatzierGeometrie = async (ecken: Ecken) => {
  if (bildPlatzierenId == null) return;
  await aktualisiereHintergrundbild(einsatzId, bildPlatzierenId, { ecken_json: JSON.stringify(ecken) });
  invalidiere();
};
```

SSE: im bestehenden `useEinsatzLiveStream`-Handler den Event-Tag `karte_bild` auf `invalidiere()` mappen (wie `lage_zone`/`gefahr` dort behandelt werden — dem bestehenden Switch/Mapping folgen).

> **Opazität-Slider-Debounce:** `onBildOpazitaet` feuert pro Slider-Schritt ein PATCH. Falls das zu viele Requests erzeugt, antd `Slider onChangeComplete` (Commit beim Loslassen) statt `onChange` für den PATCH nutzen und `onChange` nur für lokales Vorschau-State. Für MVP genügt `onChangeComplete`.

- [ ] **Step 5: Sidebar-Props durchreichen + Platzier-Panel einblenden**

`bildPlatzierenId`-State (`useState<number | null>(null)`), Sidebar bekommt `bilder={bilderQuery.data ?? []}`, die Handler und `bildPlatzierenId`. Wenn `bildPlatzierenId != null`, `BildPlatzierenPanel` mit den aktuellen Ecken des Bildes rendern (in der Sidebar oder als Overlay-Panel), `onChange` → lokale Vorschau via `onPlatzierGeometrie`, `onFertig` → `setBildPlatzierenId(null)`.

- [ ] **Step 6: Run volle Suite**

```bash
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-35-bild-als-hintergrund/frontend test -- --run --no-file-parallelism
rtk proxy cargo test -p <crate>
```
Expected: alle grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LagekartePage.tsx frontend/src/pages/LagekartePage.test.tsx
git commit -m "feat(lfh-35): LagekartePage verdrahtet Bild-Hintergründe (Query/SSE/Handler)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss (nach allen Tasks)

- [ ] **Typecheck-Gate** (eigenes Gate, Vitest prüft keine Typen):
  `mise exec pnpm@<ver> -- pnpm -C <frontend-abs> exec tsc --noEmit`
- [ ] **Lint/Format** nach Projektstandard.
- [ ] **Manueller Smoke-Test** (Frontend ins Binary einbetten — rust-embed): `pnpm build` + Backend-Neustart, dann Bild hochladen → positionieren → Reload → zweiter Browser/Nutzer sieht es. (Memory: Frontend-Änderungen brauchen `pnpm build` + Neustart.)
- [ ] **Migrationsnummer 0075** final gegen `main` prüfen (Kollision).
- [ ] **superpowers:verification-before-completion** vor „fertig".
- [ ] **superpowers:requesting-code-review** → Board-Status `in review`.

## Spec-Coverage-Check (Self-Review)

| Spec-Anforderung | Task |
|---|---|
| Upload PNG/JPG, BLOB-Persistenz, ein Container | 1–3 (Magic-Byte, BLOB, DefaultBodyLimit) |
| Positionierung (gedrehtes Rechteck), Drag + Koordinaten | 6, 10 |
| Mehrere pro Einsatz, Stapelung (reihenfolge) | 1 (Schema), 2 (anlegen MAX+1), 7 (Sortierung) |
| Opazität + Sichtbarkeit pro Bild | 2 (Patch), 7 (raster-opacity), 9 (UI) |
| Overlay unabhängig vom Basemap-Modus, unter Markern/Zonen | 7 (beforeId), 8 (Reihenfolge/Re-Anlage) |
| Persistenz nach Reload + für andere Berechtigte | 3 (GET-Liste/Download), 11 (Query), SSE |
| Integration Basemap-Umschaltung übersteht Style-Wechsel | 8 (planeReAnlegenNachStyle) |
| Berechtigung (lesen/schreiben/aktiv) | 3 (Gates) |
| PII (DSGVO) | 4 |
| Live-Sync | 3 (SSE `karte_bild`), 11 (Invalidierung) |
| Koordinaten-Eingabe wiederverwendet | 10 (`KoordinatenEingabe`) |
