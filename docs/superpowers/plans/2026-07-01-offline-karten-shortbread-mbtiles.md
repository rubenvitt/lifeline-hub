# Offline-Karten Shortbread/MBTiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Offline-Basemap der Lagekarte von Protomaps-PMTiles auf ein selbstgebautes Shortbread-MBTiles (mit Beschriftung) umstellen und die Protomaps-Altlast (LFH-196) entfernen.

**Architecture:** Ein separates, bau-zeitiges Docker-Projekt (`karten-build/`) erzeugt ein DE-Shortbread-MBTiles + einmalige Glyph-/Sprite-Assets. Das Rust-Backend serviert die MBTiles-Kacheln selbst aus SQLite (`/api/karte/offline/tiles/{z}/{x}/{y}`, TMS-Y-Flip, gzip) und liefert die ins Binary eingebetteten Glyphs/Sprite aus. Das MapLibre-Frontend baut den Offline-Style schema-korrekt (Shortbread-Layer + `name_de`-Labels) gegen diese lokalen Endpoints. Die generische Download-/Registry-/Aktivierungs-Maschinerie (LFH-181) bleibt unverändert. Online-basemap.de bleibt durchgehend Default-Basemap (nie ohne Karte).

**Tech Stack:** Rust (axum, sqlx/SQLite, rust-embed, reqwest), React + TypeScript + MapLibre-GL-JS + Vitest, Docker + Planetiler-Shortbread.

## Global Constraints

- **Design-Grundlage:** `docs/superpowers/specs/2026-07-01-offline-karten-shortbread-mbtiles-design.md`; Kartografie-Belege: `docs/superpowers/specs/2026-06-27-offline-karten-konzept-recherche.md`.
- **Alles in-App zur Laufzeit** — kein externer Tile-Service, kein Laufzeit-Docker (LFH-178). Docker nur zur Bau-Zeit.
- **Ein Tile-Format:** Shortbread/MBTiles. Kein Protomaps/PMTiles-Pfad mehr (LFH-196).
- **Rust-Gate ist `cargo test`** (nicht `cargo fmt`/`clippy --all-targets -D warnings` — crate-weit vorbestehend rot). Im Bestandsstil von Hand editieren. Exit-Code ehrlich prüfen (kein `| tail`); bei rtk-Hook `rtk proxy <cmd>` für Pass/Fail-Gates.
- **Frontend-Gates:** `pnpm lint` (`--max-warnings 0`), `tsc --noEmit`, Vitest. node/pnpm via `mise exec pnpm@<ver> -- pnpm -C <abs-pfad> …`, absolute `-C`-Pfade.
- **Frontend ist ins Binary eingebettet (rust-embed):** Frontend-Änderungen brauchen `pnpm build` + Backend-Neustart, sonst zeigt `cargo run` das alte Bundle.
- **Migrationen:** neue no-tx-Migration nach vorn ergänzen; alte NIE ändern/löschen. Nummern fortlaufend (nächste frei: `0079`). sqlx 0.9 im Projekt (FK-sicherer CHECK-Rebuild via `-- no-transaction` + `PRAGMA foreign_keys=OFF`, s. Migration 0078 als Muster). `query`/`query_as` nehmen nur `&'static str` — kein `format!`-SQL.
- **Attribution ist Pflicht** (offline sichtbar, ODbL): „© OpenStreetMap contributors".
- **Lagekarte ist WebGL/nicht-jsdom** — Render-Verhalten nur per Browser-Smoke prüfbar, nicht in Vitest.

---

## File Structure

**Neu:**
- `karten-build/Dockerfile`, `karten-build/Makefile`, `karten-build/README.md`, `karten-build/gen-assets.sh` — bau-zeitiges Tile-/Asset-Projekt.
- `assets/karten/fonts/<fontstack>/{range}.pbf`, `assets/karten/sprites/basemap.{json,png}` (+`@2x`) — eingebettete Glyphs/Sprite (von `karten-build` erzeugt, eingecheckt).
- `src/karte/mbtiles.rs` — MBTiles-Leser (TMS-Y-Flip, gzip-Detektion) + Reader-Cache.
- `migrations/0079_karte_protomaps_ausbau.sql` — `typ`-CHECK ohne `protomaps`, Protomaps-Zeilen entfernen.

**Geändert:**
- `src/routes/karte.rs` — `config`-Antwort umbenannt; neue `offline_tiles`/`offline_fonts`/`offline_sprite`-Handler; `tiles`(pmtiles)-Handler + `proxy_tilejson_entry` entfernt (Phase 4); `validiere_online` ohne `protomaps`.
- `src/app.rs` — Routen-Wiring: neue `/offline/*`-Routen; `tiles.pmtiles`- + `tilejson`-Entry-Route entfernt (Phase 4).
- `src/config.rs` — `OnlineStyleTyp::Protomaps` entfernt (Phase 4); `default_offline_katalog()` → Shortbread-DE.
- `src/karte/download.rs` — Download-/Cleanup-Dateiname `.pmtiles` → `.mbtiles`.
- `src/karte/mod.rs` (o. wo Module deklariert werden) — `pub mod mbtiles;`.
- `src/app.rs`/`AppState` — Reader-Cache-Feld für die aktive MBTiles.
- `frontend/src/api/karte.ts` — `KarteServerConfig`-Felder umbenannt.
- `frontend/src/pages/lagekarte/basemapStil.ts` — `offlineStyle()` → Shortbread + Labels; `protomapsLabeledStyle` + Protomaps-Zweig entfernt (Phase 4); Feld-Renames.
- Frontend Offline-Verwaltung/Katalog-Texte + evtl. pmtiles-npm-Dependency (Phase 4).
- `docs/packaging.md` — Bau-/Update-Ablauf.

---

## Phase 1 — Build-Projekt `karten-build/` (bau-zeitig)

> Erzeugt (a) das gehostete `germany.shortbread.mbtiles` und (b) die einmaligen, eingecheckten
> Glyph-/Sprite-Assets. Ops-lastig; „Test" = Validierungs-Smoke auf einem Mini-Extract.

### Task 1.1: Docker-Build für Shortbread-MBTiles

**Files:**
- Create: `karten-build/Dockerfile`, `karten-build/Makefile`, `karten-build/README.md`

**Interfaces:**
- Produces: `make -C karten-build tiles AREA=germany` → `karten-build/out/germany.shortbread.mbtiles` (z0–14).

- [ ] **Step 1: Dockerfile schreiben** — dünner Wrapper um Planetiler-Shortbread.

```dockerfile
# karten-build/Dockerfile
# Bau-zeitig — NICHT Teil der App. Erzeugt Shortbread-MBTiles aus einem Geofabrik-Extract.
FROM ghcr.io/versatiles-org/planetiler-shortbread:latest
# Image bringt Planetiler + Shortbread-Profil mit; wir setzen nur die Defaults.
WORKDIR /data
ENTRYPOINT ["java", "-jar", "/planetiler.jar"]
```

- [ ] **Step 2: Makefile schreiben** — reproduzierbarer Build-Befehl.

```makefile
# karten-build/Makefile
AREA ?= germany
MAXZOOM ?= 14
OUT ?= out
IMAGE := lifeline-karten-build

.PHONY: image tiles validate
image:
	docker build -t $(IMAGE) .

tiles: image
	mkdir -p $(OUT)
	docker run --rm -v "$(PWD)/$(OUT):/data" $(IMAGE) \
	  --download --area=$(AREA) --maxzoom=$(MAXZOOM) \
	  --output=/data/$(AREA).shortbread.mbtiles
	@echo "Fertig: $(OUT)/$(AREA).shortbread.mbtiles"

validate:
	sqlite3 $(OUT)/$(AREA).shortbread.mbtiles \
	  "SELECT 'tiles=' || count(*) FROM tiles; SELECT name||'='||value FROM metadata;"
```

- [ ] **Step 3: README schreiben** — Bau, Publikation, Reproduzierbarkeit.

```markdown
# karten-build — Offline-Basemap-Bau (bau-zeitig)

Erzeugt das Shortbread-MBTiles der Offline-Lagekarte. Läuft NUR beim Bau, nie in der App.

## Bauen
    make tiles AREA=germany        # -> out/germany.shortbread.mbtiles (z0-14)
    make validate AREA=germany     # tiles-Anzahl + metadata prüfen

## Publizieren
`out/germany.shortbread.mbtiles` als GitHub-Release-Artefakt / an eine stabile HTTPS-URL laden.
Diese URL + gemessene Größe + SHA256 gehen in `default_offline_katalog()` (src/config.rs).
SHA256:  `sha256sum out/germany.shortbread.mbtiles`

## Reproduzierbarkeit
Image-Tag (planetiler-shortbread) + Geofabrik-Extract-Datum im Release-Text festhalten.
Update = erneut `make tiles`, neues Release, Katalog-URL/-SHA in src/config.rs anheben.
```

- [ ] **Step 4: Validierungs-Smoke auf Mini-Extract** (lokal/CI, dokumentiert im README-Abschnitt „CI").

Run: `make -C karten-build tiles AREA=bremen && make -C karten-build validate AREA=bremen`
Expected: `validate` gibt `tiles=<N>` mit N>0 und `metadata`-Zeilen (`format=pbf`, `maxzoom=14`).

- [ ] **Step 5: Commit**

```bash
git add karten-build/
git commit -m "feat(lfh-195): karten-build — dockerisierter Shortbread-MBTiles-Build"
```

### Task 1.2: Glyph-/Sprite-Assets erzeugen + einchecken

**Files:**
- Create: `karten-build/gen-assets.sh`
- Create: `assets/karten/fonts/…`, `assets/karten/sprites/basemap.{json,png}` (+`@2x`)

**Interfaces:**
- Produces: eingecheckte statische Assets, die Phase 2 (Task 2.4) via rust-embed ausliefert:
  Glyph-PBFs unter `assets/karten/fonts/<fontstack>/{range}.pbf`, Sprite unter `assets/karten/sprites/basemap.*`.

- [ ] **Step 1: `gen-assets.sh` schreiben** — OFL-Glyphs (Noto/Open Sans) → SDF-PBF, CC0-Sprite → `spreet`.

```bash
#!/usr/bin/env bash
# karten-build/gen-assets.sh — einmalige, schema-fixe Offline-Assets (in ../assets/karten eingecheckt).
set -euo pipefail
DEST="${1:-../assets/karten}"
mkdir -p "$DEST/fonts" "$DEST/sprites"

# Glyphs: OFL-Fonts (Noto Sans/Open Sans) → {fontstack}/{range}.pbf (0-255 … 65280-65535)
docker run --rm -v "$PWD/glyph-src:/in" -v "$PWD/$DEST/fonts:/out" \
  ghcr.io/maplibre/font-maker generate /in /out

# Sprite: CC0-Icons → sprite.png/.json (+@2x)
docker run --rm -v "$PWD/icon-src:/in" -v "$PWD/$DEST/sprites:/out" \
  ghcr.io/flother/spreet /in /out/basemap
docker run --rm -v "$PWD/icon-src:/in" -v "$PWD/$DEST/sprites:/out" \
  ghcr.io/flother/spreet --retina /in /out/basemap@2x
echo "Assets in $DEST erzeugt."
```

- [ ] **Step 2: Assets erzeugen**

Run: `cd karten-build && ./gen-assets.sh`
Expected: `assets/karten/fonts/<fontstack>/0-255.pbf` u.a. und `assets/karten/sprites/basemap.{png,json}` existieren.

- [ ] **Step 3: Größe prüfen** (Global Constraint: nur benötigte Fontstacks/Ranges einbetten).

Run: `du -sh assets/karten/fonts assets/karten/sprites`
Expected: Fonts im niedrigen zweistelligen MB-Bereich; sonst Fontstack-/Range-Auswahl reduzieren.

- [ ] **Step 4: Commit**

```bash
git add karten-build/gen-assets.sh assets/karten/
git commit -m "feat(lfh-195): eingebettete Offline-Glyphs (OFL) + Sprite (CC0)"
```

---

## Phase 2 — Backend: MBTiles-Serving + eingebettete Assets + Config-Umbenennung

### Task 2.1: MBTiles-Leser mit TMS-Y-Flip

**Files:**
- Create: `src/karte/mbtiles.rs`
- Modify: `src/karte/mod.rs` (Modul deklarieren)
- Test: in `src/karte/mbtiles.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `pub async fn lies_tile(pool: &sqlx::SqlitePool, z: i64, x: i64, y: i64) -> Result<Option<Vec<u8>>, sqlx::Error>` — liest die Kachel aus einer als Pool geöffneten MBTiles-DB; wandelt XYZ-`y` in TMS-`tile_row` (`(2^z − 1) − y`). `Ok(None)` = keine Kachel.
- Produces: `pub async fn oeffne_readonly(pfad: &std::path::Path) -> Result<sqlx::SqlitePool, sqlx::Error>` — read-only-Pool auf eine `.mbtiles`-Datei.

- [ ] **Step 1: Modul deklarieren**

In `src/karte/mod.rs` ergänzen (alphabetisch bei den `pub mod`-Zeilen):
```rust
pub mod mbtiles;
```

- [ ] **Step 2: Failing test — TMS-Y-Flip + Treffer/Loch**

```rust
// src/karte/mbtiles.rs
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    // Baut eine In-Memory-MBTiles mit genau einer Kachel bei TMS (z=1, col=0, row=1) = XYZ (z=1,x=0,y=0).
    async fn fixture() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new().connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, x'ABCD')")
            .execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn liest_kachel_mit_tms_flip() {
        let pool = fixture().await;
        // XYZ y=0 bei z=1 -> TMS row = (2^1 - 1) - 0 = 1 -> Treffer.
        let t = lies_tile(&pool, 1, 0, 0).await.unwrap();
        assert_eq!(t, Some(vec![0xAB, 0xCD]));
    }

    #[tokio::test]
    async fn fehlende_kachel_ist_none() {
        let pool = fixture().await;
        assert_eq!(lies_tile(&pool, 1, 1, 1).await.unwrap(), None);
    }
}
```

- [ ] **Step 3: Test rot laufen lassen**

Run: `cargo test -p lifeline-hub karte::mbtiles`
Expected: FAIL (`lies_tile` nicht gefunden).

- [ ] **Step 4: Implementieren**

```rust
// src/karte/mbtiles.rs
//! Liest Vektor-Kacheln aus einer MBTiles-Datei (= SQLite). MBTiles speichert `tile_row` in
//! TMS-Orientierung; MapLibre fragt in XYZ → Y-Flip nötig. MVT-Kacheln sind gzip-komprimiert.
use std::path::Path;

/// Öffnet eine `.mbtiles`-Datei als read-only-Pool (immutable: keine Sperren, kein WAL-Write).
pub async fn oeffne_readonly(pfad: &Path) -> Result<sqlx::SqlitePool, sqlx::Error> {
    use sqlx::sqlite::SqliteConnectOptions;
    use std::str::FromStr;
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", pfad.display()))?
        .read_only(true)
        .immutable(true);
    sqlx::sqlite::SqlitePoolOptions::new().max_connections(4).connect_with(opts).await
}

/// Liest die Kachel (z/x/y in XYZ) oder `None`. `tile_row = (2^z − 1) − y` (TMS-Flip).
pub async fn lies_tile(
    pool: &sqlx::SqlitePool,
    z: i64,
    x: i64,
    y: i64,
) -> Result<Option<Vec<u8>>, sqlx::Error> {
    let tms_row = (1i64 << z) - 1 - y;
    let row: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
    )
    .bind(z)
    .bind(x)
    .bind(tms_row)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(d,)| d))
}
```

- [ ] **Step 5: Test grün**

Run: `cargo test -p lifeline-hub karte::mbtiles`
Expected: PASS (beide Tests).

- [ ] **Step 6: Commit**

```bash
git add src/karte/mbtiles.rs src/karte/mod.rs
git commit -m "feat(lfh-195): MBTiles-Leser mit TMS-Y-Flip (SQLite)"
```

### Task 2.2: Reader-Cache im AppState

**Files:**
- Modify: `src/app.rs` (AppState-Struct + Initialisierung)

**Interfaces:**
- Produces: `state.mbtiles_reader: Arc<tokio::sync::RwLock<Option<(std::path::PathBuf, sqlx::SqlitePool)>>>` — cached den read-only-Pool der aktiven MBTiles, key = Pfad. Der Tile-Handler öffnet neu, wenn der Pfad wechselt (Karten-Swap).

- [ ] **Step 1: Feld ergänzen** — im `AppState`-Struct (dort, wo `download_fortschritt`/`karten_dir` liegen):

```rust
/// Read-only-Pool der aktiven Offline-MBTiles, gecacht per Pfad (Swap → neu öffnen).
pub mbtiles_reader: Arc<tokio::sync::RwLock<Option<(std::path::PathBuf, sqlx::SqlitePool)>>>,
```

- [ ] **Step 2: Initialisieren** — an der `AppState { … }`-Konstruktion:

```rust
mbtiles_reader: Arc::new(tokio::sync::RwLock::new(None)),
```

- [ ] **Step 3: Baut das Projekt**

Run: `cargo build -p lifeline-hub`
Expected: PASS (nur Feld hinzugefügt).

- [ ] **Step 4: Commit**

```bash
git add src/app.rs
git commit -m "feat(lfh-195): AppState-Cache für aktiven MBTiles-Reader"
```

### Task 2.3: Tile-Endpoint `/api/karte/offline/tiles/{z}/{x}/{y}`

**Files:**
- Modify: `src/routes/karte.rs` (neuer Handler `offline_tiles`)
- Modify: `src/app.rs` (Route)
- Test: `src/routes/karte.rs` (`#[cfg(test)]`) oder Integrationstest im bestehenden Muster

**Interfaces:**
- Consumes: `mbtiles::lies_tile`, `mbtiles::oeffne_readonly`, `repo::aktive_offline_karte_pfad`, `state.mbtiles_reader`, `state.karten_dir`.
- Produces: `GET /api/karte/offline/tiles/{z}/{x}/{y}` → `200` MVT (`Content-Type: application/x-protobuf`, `Content-Encoding: gzip`) oder `204` (kein Tile / keine aktive Karte).

- [ ] **Step 1: Failing test** — Handler liefert die aktive-MBTiles-Kachel mit korrekten Headern.

```rust
// src/routes/karte.rs — in einem #[cfg(test)] mod tile_serving_tests
// Baut eine Fixture-MBTiles im karten_dir, registriert+aktiviert sie, ruft offline_tiles auf.
#[tokio::test]
async fn offline_tiles_liefert_gzip_mvt() {
    let state = crate::app::test_state().await; // vorhandenes Test-Harness
    let mbt = state.karten_dir.join("karte-1.mbtiles");
    crate::karte::mbtiles::schreibe_test_mbtiles(&mbt, 1, 0, 1, &[0xAB, 0xCD]).await; // Helper (Step 3)
    // Karte registrieren + aktivieren (bereit, pfad = karte-1.mbtiles) über repo…
    // (Analog zu finalisierung_tests::bereite_karte, pfad auf .mbtiles.)
    let resp = offline_tiles(
        axum::extract::State(state.clone()),
        axum::extract::Path((1i64, 0i64, 0i64)),
    ).await.unwrap().into_response();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers().get(header::CONTENT_TYPE).unwrap(), "application/x-protobuf");
    assert_eq!(resp.headers().get(header::CONTENT_ENCODING).unwrap(), "gzip");
}
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `cargo test -p lifeline-hub tile_serving`
Expected: FAIL (`offline_tiles`/`schreibe_test_mbtiles` fehlen).

- [ ] **Step 3: Test-Helper + Handler implementieren**

Helper in `src/karte/mbtiles.rs` (unter `#[cfg(test)]` NICHT — er wird vom Routen-Test genutzt; als normale `pub`-fn mit `#[cfg(test)]`-Gate oder in einem test-util-Modul):
```rust
#[cfg(test)]
pub async fn schreibe_test_mbtiles(pfad: &Path, z: i64, col: i64, row: i64, data: &[u8]) {
    let pool = oeffne_schreibbar(pfad).await.unwrap(); // sqlx write-Pool auf Datei
    sqlx::query("CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO tiles VALUES (?1,?2,?3,?4)")
        .bind(z).bind(col).bind(row).bind(data).execute(&pool).await.unwrap();
}
```

Handler in `src/routes/karte.rs`:
```rust
/// GET /api/karte/offline/tiles/{z}/{x}/{y} — Vektor-Kachel der aktiven Offline-MBTiles.
/// Öffnet die aktive Datei read-only (gecacht per Pfad im AppState), Y-Flip + gzip in mbtiles.rs.
pub async fn offline_tiles(
    State(state): State<AppState>,
    Path((z, x, y)): Path<(i64, i64, i64)>,
) -> Result<Response, AppError> {
    use crate::karte::mbtiles;
    let Some(pfad_rel) = repo::aktive_offline_karte_pfad(&state.pool).await? else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    // Pfad-Guard analog zum bisherigen tiles-Handler (relativ, kein Traversal, im karten_dir).
    let p = FsPath::new(&pfad_rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let voll = state.karten_dir.join(p);

    // Reader-Cache: bei Pfadwechsel neu öffnen.
    let pool = {
        let gelesen = state.mbtiles_reader.read().await;
        match &*gelesen {
            Some((cached, pool)) if *cached == voll => pool.clone(),
            _ => {
                drop(gelesen);
                let neu = mbtiles::oeffne_readonly(&voll)
                    .await
                    .map_err(|e| AppError::Internal(format!("MBTiles öffnen: {e}")))?;
                *state.mbtiles_reader.write().await = Some((voll.clone(), neu.clone()));
                neu
            }
        }
    };
    match mbtiles::lies_tile(&pool, z, x, y).await {
        Ok(Some(daten)) => Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-protobuf")
            .header(header::CONTENT_ENCODING, "gzip")
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(daten))
            .unwrap()),
        Ok(None) => Ok(StatusCode::NO_CONTENT.into_response()),
        Err(e) => Err(AppError::Internal(format!("Tile lesen: {e}"))),
    }
}
```

Route in `src/app.rs` (bei den `/api/karte`-Routen ergänzen):
```rust
.route(
    "/api/karte/offline/tiles/{z}/{x}/{y}",
    get(routes::karte::offline_tiles),
)
```

- [ ] **Step 4: Test grün**

Run: `cargo test -p lifeline-hub tile_serving`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/karte.rs src/app.rs src/karte/mbtiles.rs
git commit -m "feat(lfh-195): Offline-Tile-Endpoint aus MBTiles (gzip, NO_CONTENT bei Loch)"
```

### Task 2.4: Eingebettete Glyphs/Sprite ausliefern

**Files:**
- Modify: `src/routes/karte.rs` (Handler `offline_fonts`, `offline_sprite`)
- Modify: `src/app.rs` (Routen)
- Create: `src/karte/assets.rs` (rust-embed-Einbettung von `assets/karten/`)
- Test: `src/karte/assets.rs`

**Interfaces:**
- Produces: `GET /api/karte/offline/fonts/{fontstack}/{range}.pbf` (`application/x-protobuf`), `GET /api/karte/offline/sprites/{datei}` (`image/png` bzw. `application/json`). 404 bei Fehlen.

- [ ] **Step 1: Failing test** — eingebettetes Asset ist auffindbar.

```rust
// src/karte/assets.rs
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sprite_json_ist_eingebettet() {
        assert!(KartenAssets::get("sprites/basemap.json").is_some());
    }
}
```

- [ ] **Step 2: Test rot**

Run: `cargo test -p lifeline-hub karte::assets`
Expected: FAIL (`KartenAssets` fehlt).

- [ ] **Step 3: Einbettung + Handler**

```rust
// src/karte/assets.rs
use rust_embed::RustEmbed;
#[derive(RustEmbed)]
#[folder = "assets/karten/"]
pub struct KartenAssets;
```
Handler in `src/routes/karte.rs`:
```rust
fn embedded_antwort(pfad: &str, content_type: &str) -> Response {
    match crate::karte::assets::KartenAssets::get(pfad) {
        Some(f) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "public, max-age=604800")
            .body(Body::from(f.data.into_owned()))
            .unwrap(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// GET /api/karte/offline/fonts/{fontstack}/{range}.pbf — eingebettete SDF-Glyphs (OFL).
pub async fn offline_fonts(Path((fontstack, range)): Path<(String, String)>) -> Response {
    // fontstack/range validieren (Wiederverwendung der Proxy-Validatoren gegen Path-Traversal).
    if proxy::validiere_fontstack(&fontstack).is_err() || proxy::validiere_range(&range).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    embedded_antwort(&format!("fonts/{fontstack}/{range}"), "application/x-protobuf")
}

/// GET /api/karte/offline/sprites/{datei} — eingebettetes Sprite (png/json, +@2x).
pub async fn offline_sprite(Path(datei): Path<String>) -> Response {
    // Nur bekannte Basisnamen zulassen (kein Traversal).
    let ct = if datei.ends_with(".png") { "image/png" }
        else if datei.ends_with(".json") { "application/json" }
        else { return StatusCode::BAD_REQUEST.into_response() };
    if datei.contains('/') || datei.contains("..") { return StatusCode::BAD_REQUEST.into_response(); }
    embedded_antwort(&format!("sprites/{datei}"), ct)
}
```
`range`-Format enthält kein `.pbf`-Suffix im Pfad — MapLibre fragt `…/{fontstack}/{range}.pbf`; die Route fängt `{range}` inkl. `.pbf`. Deshalb im Embed-Pfad das `.pbf` anhängen: `format!("fonts/{fontstack}/{range}")` mit `range` = z. B. `0-255.pbf`. Sicherstellen, dass die eingecheckten Dateien exakt `0-255.pbf` heißen. Modul deklarieren: `pub mod assets;` in `src/karte/mod.rs`.

Routen in `src/app.rs`:
```rust
.route(
    "/api/karte/offline/fonts/{fontstack}/{range}",
    get(routes::karte::offline_fonts),
)
.route(
    "/api/karte/offline/sprites/{datei}",
    get(routes::karte::offline_sprite),
)
```

- [ ] **Step 4: Test grün**

Run: `cargo test -p lifeline-hub karte::assets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/karte/assets.rs src/karte/mod.rs src/routes/karte.rs src/app.rs
git commit -m "feat(lfh-195): eingebettete Offline-Glyphs/Sprite ausliefern"
```

### Task 2.5: Config-Antwort umbenennen (pmtiles_* → offline_*) + Tile-URL

**Files:**
- Modify: `src/routes/karte.rs` (`KarteConfigAntwort` + `config`-Handler)
- Modify: `src/karte/download.rs` + `src/routes/karte.rs` (Download-Dateiname `.pmtiles` → `.mbtiles`)
- Test: `src/karte/download.rs` (bestehende Tests anpassen)

**Interfaces:**
- Produces: `KarteConfigAntwort { online_styles, offline_verfuegbar: bool, offline_tiles_url: Option<String>, offline_attribution: Option<String> }`; `offline_tiles_url` = `"/api/karte/offline/tiles/{z}/{x}/{y}?v=<token>"`.

- [ ] **Step 1: `KarteConfigAntwort` umbenennen** (`src/routes/karte.rs:31–42`):

```rust
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_styles: Vec<OnlineStyle>,
    pub offline_verfuegbar: bool,
    /// Tile-Endpoint-Template der aktiven Offline-Karte inkl. Cache-Bust `?v=…`.
    pub offline_tiles_url: Option<String>,
    /// Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, ODbL).
    pub offline_attribution: Option<String>,
}
```

- [ ] **Step 2: `config`-Handler anpassen** (`src/routes/karte.rs:73–88`) — Tile-URL auf den neuen Endpoint, Feldnamen:

```rust
    let aktiv = repo::aktive_offline_karte(&state.pool).await?;
    let (offline_tiles_url, offline_attribution) = match &aktiv {
        Some(k) => {
            let v: String = k.version.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            (
                Some(format!("/api/karte/offline/tiles/{{z}}/{{x}}/{{y}}?v={v}")),
                k.lizenz.clone(),
            )
        }
        None => (None, None),
    };
    Ok(Json(KarteConfigAntwort {
        online_styles,
        offline_verfuegbar: aktiv.is_some(),
        offline_tiles_url,
        offline_attribution,
    }))
```
(`{{z}}` etc. sind literale `{z}`-Platzhalter im `format!`.)

- [ ] **Step 3: Download-Dateiname auf `.mbtiles`** — `src/karte/download.rs:195–197`:
```rust
pub async fn entferne_download_dateien(karten_dir: &Path, id: i64) {
    let _ = tokio::fs::remove_file(karten_dir.join(format!("karte-{id}.mbtiles"))).await;
    let _ = tokio::fs::remove_file(karten_dir.join(format!("karte-{id}.mbtiles.part"))).await;
}
```
Und in `src/routes/karte.rs`: `offline_download` (`let dateiname = format!("karte-{id}.mbtiles");`, Zeile ~618) und `offline_loeschen` (`k.pfad == format!("karte-{id}.mbtiles")`, Zeile ~477).

- [ ] **Step 4: Betroffene Bestandstests auf `.mbtiles` ziehen** — `src/karte/download.rs`-Tests (Zeilen ~430–439, `entferne_*`) und `finalisierung_tests`/`bereite_karte` (Dateiname). Nur die Suffixe im Test, keine Logikänderung.

- [ ] **Step 5: Gates grün**

Run: `cargo test -p lifeline-hub karte:: routes::karte`
Expected: PASS (Config-Serde + Download-Cleanup-Tests).

- [ ] **Step 6: Commit**

```bash
git add src/routes/karte.rs src/karte/download.rs
git commit -m "feat(lfh-195): Config offline_*-Vertrag + Tile-URL; Download-Datei .mbtiles"
```

---

## Phase 3 — Frontend: Shortbread-Offline-Style + Config-Vertrag

### Task 3.1: `KarteServerConfig`-Felder umbenennen

**Files:**
- Modify: `frontend/src/api/karte.ts`
- Modify: `frontend/src/pages/lagekarte/basemapStil.ts` (Aufrufer der Felder)

**Interfaces:**
- Produces: `KarteServerConfig { online_styles, offline_verfuegbar, offline_tiles_url, offline_attribution }`.

- [ ] **Step 1: Interface anpassen** (`frontend/src/api/karte.ts:14–21`):
```ts
export interface KarteServerConfig {
  online_styles: OnlineStyle[];
  offline_verfuegbar: boolean;
  /** Tile-Endpoint-Template (`{z}/{x}/{y}`) inkl. Cache-Bust `?v=…`, wenn eine Offline-Karte aktiv ist. */
  offline_tiles_url: string | null;
  /** Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z. B. ODbL). */
  offline_attribution: string | null;
}
```

- [ ] **Step 2: Aufrufer angleichen** in `basemapStil.ts`: `defaultModus` (`config?.pmtiles_verfuegbar` → `config?.offline_verfuegbar`), `baueBasemapStyle` (`config?.pmtiles_url` → `config?.offline_tiles_url`), `aktuelleAttribution` (`config?.pmtiles_attribution` → `config?.offline_attribution`).

- [ ] **Step 3: Typecheck**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit`
Expected: PASS (bzw. nur die noch offenen `offlineStyle`-Signatur-Änderungen aus Task 3.2, dann zusammen committen).

- [ ] **Step 4: Commit** (zusammen mit 3.2 möglich)

### Task 3.2: `offlineStyle()` → Shortbread + Labels

**Files:**
- Modify: `frontend/src/pages/lagekarte/basemapStil.ts`
- Test: `frontend/src/pages/lagekarte/basemapStil.test.ts` (neu oder bestehende Datei)

**Interfaces:**
- Consumes: `KarteServerConfig.offline_tiles_url`.
- Produces: `offlineStyle(theme: KartenTheme, tilesUrl: string): StyleSpecification` mit Shortbread-Source (`type:'vector', tiles:[…]`), lokalen `glyphs`/`sprite`, Shortbread-Layernamen + `name_de`-Labels.

- [ ] **Step 1: Failing test** — Shortbread-Layer + lokale Asset-URLs.

```ts
// basemapStil.test.ts
import { describe, it, expect } from 'vitest';
import { offlineStyle } from './basemapStil';

describe('offlineStyle (Shortbread)', () => {
  const style = offlineStyle('light', '/api/karte/offline/tiles/{z}/{x}/{y}?v=abc') as any;
  it('nutzt lokale Glyphs/Sprite (offline)', () => {
    expect(style.glyphs).toBe('/api/karte/offline/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('/api/karte/offline/sprites/basemap');
  });
  it('bindet eine Vektor-Source mit dem Tile-Template', () => {
    const src = style.sources.basemap;
    expect(src.type).toBe('vector');
    expect(src.tiles[0]).toContain('/api/karte/offline/tiles/{z}/{x}/{y}');
  });
  it('rendert Shortbread-Layer inkl. Ortslabels mit name_de', () => {
    const ids = style.layers.map((l: any) => l.id);
    expect(ids).toContain('wasser');
    expect(ids).toContain('strassen');
    const orte = style.layers.find((l: any) => l.id === 'orte');
    expect(orte['source-layer']).toBe('place_labels');
    expect(orte.layout['text-field']).toEqual(['coalesce', ['get', 'name_de'], ['get', 'name']]);
  });
});
```

- [ ] **Step 2: Test rot**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec vitest run basemapStil`
Expected: FAIL.

- [ ] **Step 3: Implementieren** — `offlineStyle` ersetzen (Shortbread-Source-Layer: `water`, `water_lines`, `land`, `landuse`, `streets`/`street_labels`, `buildings`, `place_labels`):

```ts
/**
 * Offline-Vektor-Style über die selbst-servierten Shortbread-MBTiles-Kacheln (LFH-195).
 * Glyphs/Sprite kommen lokal aus dem Binary → Beschriftung offline verfügbar. Theme-Farben aus FARBEN.
 */
export function offlineStyle(theme: KartenTheme, tilesUrl: string): StyleSpecification {
  const f = FARBEN[theme];
  const absolut = new URL(tilesUrl, window.location.origin).href;
  return {
    version: 8,
    glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf',
    sprite: '/api/karte/offline/sprites/basemap',
    sources: {
      basemap: { type: 'vector', tiles: [absolut], minzoom: 0, maxzoom: 14, attribution: '© OpenStreetMap contributors' },
    },
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      { id: 'landuse', source: 'basemap', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': f.landuse } },
      { id: 'wasser', source: 'basemap', 'source-layer': 'water_polygons', type: 'fill', paint: { 'fill-color': f.wasser } },
      { id: 'gebaeude', source: 'basemap', 'source-layer': 'buildings', type: 'fill', paint: { 'fill-color': f.gebaeude } },
      { id: 'strassen', source: 'basemap', 'source-layer': 'streets', type: 'line', paint: { 'line-color': f.strasse, 'line-width': 1.2 } },
      {
        id: 'strassennamen', source: 'basemap', 'source-layer': 'street_labels', type: 'symbol',
        layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name_de'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'orte', source: 'basemap', 'source-layer': 'place_labels', type: 'symbol',
        layout: { 'text-field': ['coalesce', ['get', 'name_de'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
    ],
  } as StyleSpecification;
}
```
> **Hinweis:** Exakte Shortbread-`source-layer`-Namen (`water_polygons`/`water`, `streets`/`street_labels`, `place_labels`) gegen das Shortbread-Schema und die real gebaute MBTiles verifizieren (Task 2.1-Fixture bzw. `make validate`), bevor Task 3.3 den Browser-Smoke fährt.

- [ ] **Step 4: `baueBasemapStyle`-Offline-Zweig anpassen** — `offlineStyle(theme, config.offline_tiles_url)`.

- [ ] **Step 5: Test grün + Lint + Typecheck**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec vitest run basemapStil` → PASS
Run: `… pnpm -C …/frontend run lint` → 0 warnings; `… exec tsc --noEmit` → PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/karte.ts frontend/src/pages/lagekarte/basemapStil.ts frontend/src/pages/lagekarte/basemapStil.test.ts
git commit -m "feat(lfh-195): Frontend Offline-Style Shortbread + lokale Labels; offline_*-Config"
```

### Task 3.3: Browser-Smoke — Offline rendert mit Labels

**Files:** keine (manuell/e2e; folgt bestehendem Lagekarte-Browser-Smoke-Muster).

- [ ] **Step 1: `pnpm build` + Backend mit Test-MBTiles hochziehen** (e2e-Harness: eigenes Backend, `--admin-password e2e-admin-pw`, `frontend/dist` gebaut). Eine kleine real gebaute Shortbread-MBTiles (`make tiles AREA=bremen`) ins `karten_dir` legen, registrieren + aktivieren.
- [ ] **Step 2: Lagekarte offline schalten**, prüfen: Kacheln laden (Netzwerk 200 auf `/api/karte/offline/tiles/…`), Beschriftung sichtbar (Glyphs 200 auf `/api/karte/offline/fonts/…`), Tile-URL im Worker korrekt absolutiert (kein „Failed to parse URL").
- [ ] **Step 3: Ergebnis notieren** (Screenshot/Anmerkung); bei Layer-Namen-Fehltreffern Task 3.2 `source-layer` korrigieren.

---

## Phase 4 — Altlast-Abriss (LFH-196): Protomaps online + PMTiles offline raus

> Erst NACH grünem Browser-Smoke (Phase 3). basemap.de-Online bleibt Default-Basemap.

### Task 4.1: Frontend — Protomaps-Online-Style entfernen

**Files:**
- Modify: `frontend/src/pages/lagekarte/basemapStil.ts`, `frontend/src/api/karte.ts`
- Modify: evtl. `package.json` (pmtiles-Dependency), Stellen mit `maplibregl.addProtocol('pmtiles', …)`

- [ ] **Step 1:** `protomapsLabeledStyle` löschen; in `baueBasemapStyle` den `if (onlineStil.typ === 'protomaps') …`-Zweig entfernen.
- [ ] **Step 2:** `OnlineStyleTyp` in `karte.ts` auf `'vektor' | 'raster'` reduzieren.
- [ ] **Step 3:** `pmtiles`-Import/`addProtocol('pmtiles', …)` suchen (`rg "pmtiles" frontend/src`) und entfernen; `pmtiles`-Dependency aus `frontend/package.json` streichen, falls nirgends sonst genutzt.
- [ ] **Step 4:** Gates: `rg -i "protomaps|pmtiles" frontend/src` → nur noch bewusste/leere Treffer; `vitest run`, `lint`, `tsc --noEmit` grün.
- [ ] **Step 5: Commit** `refactor(lfh-196): Protomaps-Online-Style + pmtiles-Protokoll entfernt`

### Task 4.2: Backend — Protomaps-Typ + tilejson-Entry + alten PMTiles-Serve entfernen

**Files:**
- Modify: `src/config.rs` (`OnlineStyleTyp`), `src/routes/karte.rs` (`config` match-Arm, `validiere_online`, `tiles`, `proxy_tilejson_entry`), `src/app.rs` (Routen `tiles.pmtiles`, `tilejson`-Entry), `src/karte/proxy.rs` (`proxy_config_url` Protomaps-Arm)

- [ ] **Step 1:** `OnlineStyleTyp::Protomaps` (`src/config.rs:38–39`) + `#[default]`-Nachbarschaft prüfen; Protomaps-Variante entfernen. Betroffene `match`-Arme: `config` (`"protomaps" => …`, `karte.rs:55–56` + `matches!(typ, Protomaps)` `:60`), `proxy::proxy_config_url` (`src/karte/proxy.rs:51`).
- [ ] **Step 2:** `validiere_online` (`karte.rs:202–217`): `typ`-Prüfung auf `{vektor, raster}`, Protomaps-Proxy-Zwang-Zeile entfernen.
- [ ] **Step 3:** Alten `tiles`-Handler (`karte.rs:90–125`) + `proxy_tilejson_entry` (`karte.rs:807–819`) löschen; zugehörige Routen in `app.rs` (`/api/karte/tiles.pmtiles` `:361`, `/api/karte/proxy/{id}/tilejson` `:379–382`) entfernen. `use tower_http::services::ServeFile;` + `use tower::ServiceExt;` entfernen, falls sonst ungenutzt.
- [ ] **Step 4:** Bestandstest `online_style_typ_protomaps_serde` (`config.rs:415–421`) entfernen; `offline_katalog_ist_kuratiert_und_konsistent` wird in Task 5.1 ersetzt.
- [ ] **Step 5:** `rg -i "protomaps" src` → 0 funktionale Treffer. `cargo test -p lifeline-hub` grün.
- [ ] **Step 6: Commit** `refactor(lfh-196): Protomaps-Online-Typ + tilejson-Entry + PMTiles-Serve entfernt`

### Task 4.3: Migration — `typ`-CHECK ohne protomaps

**Files:**
- Create: `migrations/0079_karte_protomaps_ausbau.sql`

- [ ] **Step 1: Migration schreiben** (Muster: 0078, no-tx, FK-sicher):

```sql
-- no-transaction
-- LFH-196: Protomaps als Online-Quellentyp wieder entfernen.
-- CHECK (typ IN ('vektor','raster','protomaps')) -> ('vektor','raster').
-- Bestehende protomaps-Zeilen zuerst löschen (Karten-Rebuild verwirft Protomaps).
PRAGMA foreign_keys = OFF;

DELETE FROM karte_online_quelle WHERE typ = 'protomaps';

CREATE TABLE karte_online_quelle_new (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    url          TEXT    NOT NULL,
    typ          TEXT    NOT NULL DEFAULT 'vektor' CHECK (typ IN ('vektor', 'raster')),
    attribution  TEXT,
    sortier      INTEGER NOT NULL DEFAULT 0,
    aktiv        INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT    NOT NULL DEFAULT (datetime('now')),
    proxy        INTEGER NOT NULL DEFAULT 0 CHECK (proxy IN (0, 1))
);
INSERT INTO karte_online_quelle_new
    SELECT id, name, url, typ, attribution, sortier, aktiv, erstellt_at, geaendert_at, proxy
    FROM karte_online_quelle;
DROP TABLE karte_online_quelle;
ALTER TABLE karte_online_quelle_new RENAME TO karte_online_quelle;

PRAGMA foreign_keys = ON;
```

- [ ] **Step 2: Migration greift** — Test-Pool baut alle Migrationen auf.

Run: `cargo test -p lifeline-hub db::` (bzw. ein Test, der `test_pool()` nutzt)
Expected: PASS (keine `_sqlx_migrations`-Kollision, CHECK gültig).

- [ ] **Step 3: Commit** `feat(lfh-196): Migration 0079 — Online-typ-CHECK ohne protomaps`

---

## Phase 5 — Katalog + Doku

### Task 5.1: `default_offline_katalog()` → Shortbread-DE

**Files:**
- Modify: `src/config.rs` (`default_offline_katalog`, `OfflineKatalogEintrag`-Doc, Tests)

**Interfaces:**
- Produces: Katalog mit einem Shortbread-DE-Eintrag (`kachel_schema:'shortbread'`, gehostete MBTiles-URL, gemessene Größe, SHA256-Pin).

- [ ] **Step 1: Failing test anpassen** (`config.rs:266–283`) — statt „nur protomaps/.pmtiles":

```rust
#[test]
fn offline_katalog_ist_shortbread_de() {
    let katalog = default_offline_katalog();
    assert!(!katalog.is_empty());
    for e in &katalog {
        assert!(e.url.starts_with("https://"), "nur https: {}", e.url);
        assert_eq!(e.kachel_schema, "shortbread", "nur Shortbread-Schema");
        assert!(!e.lizenz.is_empty(), "Attribution Pflicht: {}", e.name);
        assert!(e.groesse > 0, "Größe für Plattenplatz-Check: {}", e.name);
    }
    assert!(katalog.iter().any(|e| e.region.starts_with("DE")));
}
```

- [ ] **Step 2: Test rot**

Run: `cargo test -p lifeline-hub config::tests::offline_katalog`
Expected: FAIL.

- [ ] **Step 3: Katalog ersetzen** (`config.rs:117–180`) — Protomaps-Bundesländer-Liste raus, ein DE-Shortbread-Eintrag rein (URL/SHA aus dem `karten-build`-Release; bis zum ersten realen Build als dokumentierter Platzhalter mit `TODO`-freiem Kommentar „URL/SHA nach erstem karten-build-Release setzen" — **kein** Platzhalter im Test):

```rust
pub fn default_offline_katalog() -> Vec<OfflineKatalogEintrag> {
    // DE-Shortbread-MBTiles aus dem eigenen karten-build-Release (z0–14, ODbL).
    // URL + SHA256 werden mit dem ersten Release gesetzt (README karten-build).
    vec![OfflineKatalogEintrag {
        name: "Deutschland (Shortbread)".into(),
        url: "https://github.com/<org>/lifeline-hub/releases/download/karten-de-<datum>/germany.shortbread.mbtiles".into(),
        region: "DE".into(),
        groesse: 3 * 1024 * 1024 * 1024, // gemessen nach erstem Build anpassen
        lizenz: "© OpenStreetMap contributors (ODbL)".into(),
        kachel_schema: "shortbread".into(),
        quelle: "Eigenbau (karten-build, Planetiler-Shortbread)".into(),
        sha256: None, // nach erstem Build pinnen
    }]
}
```

- [ ] **Step 4: Katalog-Doc-Kommentar** (`config.rs:93–96, 112–116`) auf Shortbread/MBTiles umschreiben.

- [ ] **Step 5: Gates grün**

Run: `cargo test -p lifeline-hub config::`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(lfh-195): Offline-Katalog auf Shortbread-DE (Eigenbau) umgestellt`

### Task 5.2: Doku `docs/packaging.md`

**Files:**
- Modify: `docs/packaging.md`

- [ ] **Step 1:** Abschnitt „Offline-Karten" aktualisieren: Bau über `karten-build/` (Docker/Planetiler-Shortbread), Publikation als Release, Admin-Update über den Offline-Manager, in-App-Serving (MBTiles + eingebettete Glyphs/Sprite), keine Protomaps/PMTiles mehr.
- [ ] **Step 2:** Prüfen, dass keine veralteten Protomaps-/PMTiles-Verweise verbleiben (`rg -i "protomaps|pmtiles" docs/packaging.md`).
- [ ] **Step 3: Commit** `docs(lfh-195): packaging — Offline-Karten Shortbread/MBTiles-Ablauf`

---

## Self-Review

**Spec coverage:** §A/§1 (Zielbild/Entscheidungen) → Phasen 1–5; §2.1 Wiederverwenden → unangetastet (Download/Registry/Aktivierung); §2.2 Raus → Phase 4 + Task 2.5; §3.1 Build-Projekt → Task 1.1/1.2; §3.2 Tile-Serving + Assets → Task 2.1–2.4; §3.3 Frontend-Style → Task 3.2; §3.4 Katalog → Task 5.1; §3.5 Migration → Task 4.3; §4 Sequenz rebuild-first → Phasenordnung; §5 Tests → 2.1/2.3/2.4/3.2/3.3/1.1; §7 Abgrenzung (LFH-184/187/188) → nicht enthalten (bewusst).

**Offene Verifikationspunkte für die Umsetzung** (in den Tasks als Hinweis markiert, kein Platzhalter): exakte Shortbread-`source-layer`-Namen (Task 3.2, gegen reale MBTiles), Katalog-URL/SHA (Task 5.1, nach erstem Release), Glyph-Fontstack-Namen (`Noto Sans Regular` muss zu den eingecheckten Assets in `assets/karten/fonts/` passen — Task 2.4 ↔ 1.2).

**Typkonsistenz:** `offline_tiles_url`/`offline_verfuegbar`/`offline_attribution` einheitlich Backend (`KarteConfigAntwort`) ↔ Frontend (`KarteServerConfig`); Source-ID `basemap` einheitlich in `offlineStyle` + Test; MBTiles-Fns `oeffne_readonly`/`lies_tile` konsistent zwischen Task 2.1 und 2.3.
