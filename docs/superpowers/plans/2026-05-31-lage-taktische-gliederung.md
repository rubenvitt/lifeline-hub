# L‑2 Taktische Gliederung auf der Lagekarte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die taktische Gliederung (Einheiten, einzelne Fahrzeuge, Personal-Führungskräfte, Einsatzabschnitte) wird als normgerechte taktische Zeichen nach DV 102 auf die bestehende Lagekarte gebracht — manuell verortbar, live, entity-gekoppelt.

**Architecture:** Wie in L‑1 keine neue Lage-Entität: die bestehenden K&M‑Objekte bekommen Geo-/Symbol-Spalten (`migrations/0035`). Verorten/Zeichnen läuft über **eigene** Geo-PATCH-Routen (No-ETB strukturell), die Karten-Lesedaten erweitern die bestehenden Listen-Endpunkte (Führungskräfte über einen dedizierten Lesepfad). Live über neue SSE-Kanäle am bestehenden `LiveHub`. Das Frontend erweitert `LagekartePage` (keine neue Seite); DV‑102-SVGs liefert die Bibliothek `taktische-zeichen-react`/`-core`, Abschnittsflächen zeichnet `terra-draw` (MapLibre-nativ).

**Tech Stack:** Rust/Axum + SQLite/sqlx (Backend), React/TypeScript/Ant Design + `@tanstack/react-query` + MapLibre-GL 5 (Frontend), `taktische-zeichen-react@0.10` / `taktische-zeichen-core@0.10`, `terra-draw@1.31` + `terra-draw-maplibre-gl-adapter@1.4`, Vitest/@testing-library/MSW (Tests).

---

## Verifizierte externe API-Fakten (kein Raten)

Diese wurden gegen die installierten/zu installierenden Paketversionen geprüft — beim Schreiben des Codes exakt so verwenden:

**`taktische-zeichen-react@0.10.0`**
- Komponente ist der **Default-Export**: `import TaktischesZeichen from 'taktische-zeichen-react'`. (Der Named-Export `TaktischesZeichen` ist der **Typ** aus dem Core, nicht die Komponente — nicht als Komponente importieren.)
- Props = `TaktischesZeichen`-Spec `& SVGProps<SVGSVGElement>`. Rendert ein `<svg>`.
- Für HTML-Marker außerhalb React: Core-Funktion nutzen — `import { erzeugeTaktischesZeichen } from 'taktische-zeichen-core'`; `erzeugeTaktischesZeichen(spec)` liefert ein `Image` mit `.dataUrl` (data:-URL des SVG) und `.svg.render()` (SVG-Markup-String).

**Verifizierte Enum-Wertekeys (`taktische-zeichen-core@0.10.0`):**
- `GrundzeichenId`: u. a. `"taktische-formation"`, `"kraftfahrzeug-landgebunden"`, `"person"`, `"befehlsstelle"` ✓
- `EinheitId`: `"trupp" | "staffel" | "gruppe" | "zug" | "zugtrupp" | "bereitschaft" | "abteilung" | "grossverband"`
- `FachaufgabeId`: u. a. `"rettungswesen"`, `"aerztliche-versorgung"`, `"betreuung"`, `"verpflegung"`, `"fuehrung"`, `"bergung"`, `"wasserrettung"` ✓
- `OrganisationId`: `"feuerwehr" | "thw" | "fuehrung" | "polizei" | "gefahrenabwehr" | "hilfsorganisation" | "bundeswehr" | "zivil"`

**`terra-draw@1.31.0` + `terra-draw-maplibre-gl-adapter@1.4.1`** (peer `maplibre-gl >=4` → kompatibel mit installiertem 5.24):
```ts
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import maplibregl from 'maplibre-gl';

const draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
  modes: [new TerraDrawPolygonMode()],
});
draw.start();
draw.setMode('polygon');
draw.on('finish', (id: string, ctx: { action: string; mode: string }) => {
  if (ctx.action !== 'draw') return;            // nur fertig gezeichnete Polygone
  const f = draw.getSnapshot().find((x) => x.id === id);
  // f.geometry.type === 'Polygon', f.geometry.coordinates: number[][][]
});
// Alle Features entfernen:
draw.removeFeatures(draw.getSnapshot().map((f) => f.id));
```

---

## File Structure

**Backend (neu/geändert):**
- `migrations/0035_lage_taktik.sql` — **Create**. Geo-/Symbol-Spalten an `einsatz_einheit`/`einsatz_fahrzeug`/`einsatz_personal`/`einsatzabschnitt` + `tz_organisation` an `organisation` (mit Backfill).
- `src/auth/bootstrap.rs` — **Modify**. Org-Insert setzt `tz_organisation`-Default.
- `src/einheit/mod.rs`, `src/einheit/repo.rs` — **Modify**. `EinheitAnzeige` + SELECT um `lat/lon/tz_*`; `aktualisiere_position`.
- `src/fahrzeug/mod.rs`, `src/fahrzeug/disposition_repo.rs` — **Modify**. `EinsatzFahrzeugAnzeige` + SELECT um `lat/lon/tz_*`; `aktualisiere_position`.
- `src/einsatzabschnitt/mod.rs`, `src/einsatzabschnitt/repo.rs` — **Modify**. `EinsatzabschnittAnzeige` + SELECT um `flaeche_geojson/tz_*`; `aktualisiere_flaeche`.
- `src/personal/mod.rs`, `src/personal/disposition_repo.rs` — **Modify**. Neue `FuehrungskraftKarte`-Struct + Lesepfad + `aktualisiere_position`.
- `src/routes/einsatz_einheit.rs`, `src/routes/einsatz_fahrzeug.rs`, `src/routes/einsatz_personal.rs`, `src/routes/einsatzabschnitt.rs` — **Modify**. Geo-PATCH-Handler, SSE-Helfer + Stream-Handler, Publish in bestehenden Mutationen.
- `src/routes/organisation.rs` — **Create**. `GET/PATCH /api/organisation` (Org-Default `tz_organisation`).
- `src/routes/mod.rs`, `src/app.rs` — **Modify**. Neue Routen registrieren.

**Frontend (neu/geändert):**
- `frontend/src/pages/lagekarte/taktischesZeichen.ts` (+ `.test.ts`) — **Create**. Mapping `(objekttyp, label, org, fachaufgabe) → TZ-Props`.
- `frontend/src/pages/lagekarte/geo.ts` (+ `.test.ts`) — **Create**. `polygonZentroid`.
- `frontend/src/pages/lagekarte/abschnittDraw.ts` — **Create**. terra-draw-Controller (Polygon zeichnen).
- `frontend/src/pages/lagekarte/marker.ts` (+ `.test.ts`) — **Modify**. Taktische Marker + Flächen + erweiterte „Nicht verortet"-Liste.
- `frontend/src/pages/lagekarte/Kartenflaeche.tsx` — **Modify**. TZ-SVG-Marker (statt Kreis), FMS-Ring, GeoJSON-Flächen, Zeichenmodus.
- `frontend/src/pages/lagekarte/Sidebar.tsx` — **Modify**. Neue Layer-Toggles + taktische Objekte in „Nicht verortet".
- `frontend/src/pages/lagekarte/Inspector.tsx` — **Modify**. Neue Typen + Fach-Modul-Links + Symbol-Auswahl (Fachaufgabe/Org).
- `frontend/src/pages/LagekartePage.tsx` (+ `.test.tsx`) — **Modify**. Queries/Streams/Platzieren für neue Typen + Polygon-Flow.
- `frontend/src/api/einsatzEinheit.ts`, `einsatzFahrzeug.ts`, `einsatzAbschnitt.ts`, `einsatzPersonal.ts`, `organisation.ts` — **Create/Modify**. Lese-Funktionen + Position-/Flächen-PATCH + Org-Default.
- `frontend/src/etb/useEinheitenStream.ts`, `useFahrzeugeStream.ts`, `useAbschnitteStream.ts` — **Create**. SSE-Hooks.
- `frontend/src/pages/StammdatenPage.tsx`, `frontend/src/pages/stammdaten/OrganisationTab.tsx` (+ `.test.tsx`) — **Modify/Create**. Org-Default-Pflege.

---

## Konventionen aus dem Bestand (1:1 übernehmen)

- **Tri-State-Deserializer** (JSON-`null` → `Some(None)`, fehlend → `None`): jede Route-Datei hat eine lokale Kopie `deserialize_optional_field` (siehe `src/routes/einsatz_uhs.rs:79-92`). Für neue Felder wiederverwenden.
- **Geo-Paar-Validierung im Handler** (422 statt 500), Vorbild `src/routes/einsatz_uhs.rs:230-248`: Effektivzustand (`Some(opt) => opt, None => vorher.lat`) prüfen, `lat.is_some() != lon.is_some()` → `AppError::UnprocessableEntity`, Range `-90..=90` / `-180..=180`.
- **DB-Update-Muster** (`CASE WHEN ? THEN ? ELSE spalte END`), Vorbild `src/schaden/repo.rs:123-178`: pro Feld zwei Binds (`daten.x.is_some()`, `daten.x.flatten()`).
- **Berechtigung**, Vorbild `src/routes/einsatz_uhs.rs:219-228`: lesen → `fordere_lesezugriff(&benutzer, &einsatz, rolle)`; schreiben → `fordere_schreibrecht(rolle)` + `fordere_aktiv(&einsatz)`.
- **SSE-Publish-Helfer**, Vorbild `src/routes/einsatz_uhs.rs:69-77`: `state.live.publiziere_event(einsatz_id, "<tag>", json)`. **Kein** ETB-Schreibpfad in Geo-Handlern.
- **SSE-Stream-Handler**, Vorbild `src/routes/etb.rs:211-236`: `state.live.abonniere(id)` + `BroadcastStream` + `lagged`-Fallback.
- **Admin-Gate** für Stammdaten: Extractor `AdminUser` (`src/auth/session.rs:85`) als Handler-Argument (`_admin: AdminUser`).
- **Frontend-API**: `apiGet<T>` / `apiSend<T>(pfad, methode, body)` aus `frontend/src/api/client.ts`. react-query-Keys folgen `['einsatz-<typ>', einsatzId]`.

---

## Task 1: Migration + Bootstrap-Default

**Files:**
- Create: `migrations/0035_lage_taktik.sql`
- Modify: `src/auth/bootstrap.rs:63`

- [ ] **Step 1: Migration schreiben**

`migrations/0035_lage_taktik.sql`:
```sql
-- L‑2 Taktische Gliederung: Geo-/Symbol-Spalten direkt am jeweiligen Objekt
-- (entity-gekoppelt, analog L‑1/0034). Alle neuen Spalten nullable, kein
-- Default, kein Mehrspalten-CHECK; lat/lon werden von der App als Paar behandelt
-- (beide NULL = nicht verortet). tz_fachaufgabe/tz_organisation sind Lib-Schlüssel
-- (taktische-zeichen-core); tz_organisation am Objekt überschreibt den Org-Default.
ALTER TABLE einsatz_einheit  ADD COLUMN lat REAL;
ALTER TABLE einsatz_einheit  ADD COLUMN lon REAL;
ALTER TABLE einsatz_einheit  ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_einheit  ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_fahrzeug ADD COLUMN lat REAL;
ALTER TABLE einsatz_fahrzeug ADD COLUMN lon REAL;
ALTER TABLE einsatz_fahrzeug ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatz_personal ADD COLUMN lat REAL;
ALTER TABLE einsatz_personal ADD COLUMN lon REAL;
ALTER TABLE einsatz_personal ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatz_personal ADD COLUMN tz_organisation TEXT;

ALTER TABLE einsatzabschnitt ADD COLUMN flaeche_geojson TEXT;  -- ein GeoJSON-Polygon
ALTER TABLE einsatzabschnitt ADD COLUMN tz_fachaufgabe TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN tz_organisation TEXT;

-- Org-Default für die DV-102-Organisation (z. B. DRK/ASB/JUH/MHD → hilfsorganisation).
ALTER TABLE organisation    ADD COLUMN tz_organisation TEXT;
UPDATE organisation SET tz_organisation = 'hilfsorganisation' WHERE tz_organisation IS NULL;
```

- [ ] **Step 2: Bootstrap-Default für neue Orgs**

In `src/auth/bootstrap.rs:63` den Org-Insert anpassen:
```rust
// vorher: "INSERT INTO organisation (name) VALUES (?) RETURNING id",
"INSERT INTO organisation (name, tz_organisation) VALUES (?, 'hilfsorganisation') RETURNING id",
```

- [ ] **Step 3: Migration läuft (Backend startet)**

Run: `rtk proxy cargo build`
Expected: kompiliert ohne Fehler. (Die Migration wird beim Start/Test geprüft; sqlx-Makros werden hier nicht genutzt — alle Queries sind `query`/`query_as` zur Laufzeit.)

- [ ] **Step 4: Commit**

```bash
git add migrations/0035_lage_taktik.sql src/auth/bootstrap.rs
git commit -m "feat(db): L-2 Geo-/Symbol-Spalten + tz_organisation-Default (Migration 0035)"
```

---

## Task 2: Einheit — Lesefelder + Positions-Repo

**Files:**
- Modify: `src/einheit/mod.rs:66-86` (Struct `EinheitAnzeige`)
- Modify: `src/einheit/repo.rs:44-54` (SELECT), neue Funktion `aktualisiere_position`
- Test: `src/einheit/repo.rs` (`#[cfg(test)]`-Modul am Dateiende — folge dem bestehenden Test-Stil der Datei)

- [ ] **Step 1: Failing test für `aktualisiere_position`**

Im Test-Modul von `src/einheit/repo.rs` (nutze die vorhandenen Test-Helfer der Datei zum Anlegen von Einsatz + Einheit; falls keine vorhanden, lege Einsatz/Org/Einheit per `sqlx::query` an wie in den Nachbar-Repos):
```rust
#[tokio::test]
async fn position_setzen_und_loeschen() {
    let pool = test_pool().await;
    let (einsatz_id, einheit_id) = seed_einheit(&pool).await;

    // setzen
    let a = aktualisiere_position(&pool, einsatz_id, einheit_id, PositionPatch {
        lat: Some(Some(50.1)), lon: Some(Some(8.6)),
        tz_fachaufgabe: Some(Some("rettungswesen")), tz_organisation: None,
    }).await.unwrap();
    assert_eq!(a.lat, Some(50.1));
    assert_eq!(a.lon, Some(8.6));
    assert_eq!(a.tz_fachaufgabe.as_deref(), Some("rettungswesen"));

    // partial: nur lat senden lässt lon unberührt → hier beide löschen
    let b = aktualisiere_position(&pool, einsatz_id, einheit_id, PositionPatch {
        lat: Some(None), lon: Some(None), tz_fachaufgabe: None, tz_organisation: None,
    }).await.unwrap();
    assert_eq!(b.lat, None);
    assert_eq!(b.lon, None);
    assert_eq!(b.tz_fachaufgabe.as_deref(), Some("rettungswesen")); // unverändert
}
```

- [ ] **Step 2: Test schlägt fehl (Symbol fehlt)**

Run: `rtk proxy cargo test -p lifeline-hub einheit::repo::`
Expected: FAIL — `cannot find function aktualisiere_position` / `cannot find type PositionPatch`.

- [ ] **Step 3: Struct-Felder ergänzen**

In `src/einheit/mod.rs` `EinheitAnzeige` nach `pub bemerkung: Option<String>,` ergänzen:
```rust
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
```
`EinheitAnzeige` wird über `zu_anzeige(pool, row)` aus `Row` gebaut (nicht `FromRow`). Entsprechend in `src/einheit/repo.rs` die `Row`-Struct (sqlx::FromRow) um die vier Felder erweitern und in `zu_anzeige` durchreichen.

- [ ] **Step 4: SELECT erweitern**

In `src/einheit/repo.rs` `SELECT_AUFGELOEST` die Einheit-Spalten ergänzen (nach `e.bemerkung`):
```rust
    // ... e.bemerkung, e.sortier, \
    e.lat, e.lon, e.tz_fachaufgabe, e.tz_organisation, \
    // ... (restliche soll_*-Spalten unverändert)
```

- [ ] **Step 5: `PositionPatch` + `aktualisiere_position` implementieren**

In `src/einheit/repo.rs`:
```rust
/// Reine Geo-/Symbol-Felder einer Einheit. `Some(None)` = auf NULL, `None` = unverändert.
#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

/// Setzt/ändert/löscht Position + Symbol-Felder. KEIN ETB-Schreibpfad (Lage-Pflege).
pub async fn aktualisiere_position(
    pool: &SqlitePool,
    einsatz_id: i64,
    einheit_id: i64,
    daten: PositionPatch<'_>,
) -> Result<EinheitAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_einheit SET \
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.lat.is_some()).bind(daten.lat.flatten())
    .bind(daten.lon.is_some()).bind(daten.lon.flatten())
    .bind(daten.tz_fachaufgabe.is_some()).bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some()).bind(daten.tz_organisation.flatten())
    .bind(einheit_id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    // laden() lädt die Einheit aufgelöst; ID-Signatur der Datei beachten.
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE e.id = ? AND e.einsatz_id = ?"
    )).bind(einheit_id).bind(einsatz_id).fetch_one(pool).await?;
    zu_anzeige(pool, row).await
}
```

- [ ] **Step 6: Test grün**

Run: `rtk proxy cargo test -p lifeline-hub einheit::repo::`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/einheit/
git commit -m "feat(be): Einheit-Geo-/Symbol-Felder + aktualisiere_position"
```

---

## Task 3: Fahrzeug — Lesefelder + Positions-Repo

**Files:**
- Modify: `src/fahrzeug/mod.rs:127-149` (`EinsatzFahrzeugAnzeige`)
- Modify: `src/fahrzeug/disposition_repo.rs:7-17` (SELECT) + `zu_anzeige` + neue `aktualisiere_position`
- Test: `src/fahrzeug/disposition_repo.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Failing test**
```rust
#[tokio::test]
async fn fahrzeug_position_partial_merge() {
    let pool = test_pool().await;
    let (einsatz_id, ef_id) = seed_fahrzeug(&pool).await;
    aktualisiere_position(&pool, einsatz_id, ef_id, PositionPatch {
        lat: Some(Some(50.0)), lon: Some(Some(8.0)),
        tz_fachaufgabe: Some(Some("transport")), tz_organisation: Some(Some("feuerwehr")),
    }, true).await.unwrap();
    // nur tz_fachaufgabe ändern → lat/lon bleiben
    let a = aktualisiere_position(&pool, einsatz_id, ef_id, PositionPatch {
        lat: None, lon: None, tz_fachaufgabe: Some(Some("logistik")), tz_organisation: None,
    }, true).await.unwrap();
    assert_eq!(a.lat, Some(50.0));
    assert_eq!(a.tz_fachaufgabe.as_deref(), Some("logistik"));
    assert_eq!(a.tz_organisation.as_deref(), Some("feuerwehr"));
}
```

- [ ] **Step 2: Test schlägt fehl**

Run: `rtk proxy cargo test -p lifeline-hub fahrzeug::disposition_repo::`
Expected: FAIL — Symbol fehlt.

- [ ] **Step 3: Struct-Felder ergänzen**

In `EinsatzFahrzeugAnzeige` nach `pub bemerkung: Option<String>,`:
```rust
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
```
(`status_kategorie`/`status_farbe` existieren bereits — FMS-Ring kommt frontendseitig.) Die `Row`-Struct + `zu_anzeige` in `disposition_repo.rs` entsprechend erweitern.

- [ ] **Step 4: SELECT erweitern**

In `SELECT_AUFGELOEST` (`disposition_repo.rs:7-17`) nach `ef.bemerkung`:
```rust
    ef.lat, ef.lon, ef.tz_fachaufgabe, ef.tz_organisation, \
```

- [ ] **Step 5: `PositionPatch` + `aktualisiere_position`**

Analog Task 2/Step 5 (gleiche `CASE WHEN`-Bindreihenfolge), Tabelle `einsatz_fahrzeug`, Rückgabe via `zu_anzeige(row, einsatz_aktiv)`. Signatur:
```rust
pub async fn aktualisiere_position(
    pool: &SqlitePool, einsatz_id: i64, ef_id: i64,
    daten: PositionPatch<'_>, einsatz_aktiv: bool,
) -> Result<EinsatzFahrzeugAnzeige, AppError> { /* UPDATE … ; SELECT_AUFGELOEST WHERE ef.id=? AND ef.einsatz_id=? ; zu_anzeige(row, einsatz_aktiv) */ }
```

- [ ] **Step 6: Test grün**

Run: `rtk proxy cargo test -p lifeline-hub fahrzeug::disposition_repo::`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src/fahrzeug/
git commit -m "feat(be): Fahrzeug-Geo-/Symbol-Felder + aktualisiere_position"
```

---

## Task 4: Einsatzabschnitt — Fläche + Repo

**Files:**
- Modify: `src/einsatzabschnitt/mod.rs:7-18` (`EinsatzabschnittAnzeige`)
- Modify: `src/einsatzabschnitt/repo.rs:16-20` (SELECT) + `zu_anzeige` + `aktualisiere_flaeche`
- Test: `src/einsatzabschnitt/repo.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Failing test**
```rust
#[tokio::test]
async fn abschnitt_flaeche_setzen_und_loeschen() {
    let pool = test_pool().await;
    let (einsatz_id, aid) = seed_abschnitt(&pool).await;
    let gj = r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
    let a = aktualisiere_flaeche(&pool, einsatz_id, aid, FlaechePatch {
        flaeche_geojson: Some(Some(gj)), tz_fachaufgabe: Some(Some("fuehrung")), tz_organisation: None,
    }).await.unwrap();
    assert_eq!(a.flaeche_geojson.as_deref(), Some(gj));
    let b = aktualisiere_flaeche(&pool, einsatz_id, aid, FlaechePatch {
        flaeche_geojson: Some(None), tz_fachaufgabe: None, tz_organisation: None,
    }).await.unwrap();
    assert_eq!(b.flaeche_geojson, None);
    assert_eq!(b.tz_fachaufgabe.as_deref(), Some("fuehrung")); // unverändert
}
```

- [ ] **Step 2: Test schlägt fehl**

Run: `rtk proxy cargo test -p lifeline-hub einsatzabschnitt::repo::`
Expected: FAIL.

- [ ] **Step 3: Struct-Felder ergänzen**

In `EinsatzabschnittAnzeige` nach `pub bemerkung: Option<String>,`:
```rust
    pub flaeche_geojson: Option<String>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
```
`Row` + `zu_anzeige` (`repo.rs`) entsprechend.

- [ ] **Step 4: SELECT erweitern**

In `SELECT_AUFGELOEST` (`repo.rs:16-20`) nach `a.bemerkung`:
```rust
    a.flaeche_geojson, a.tz_fachaufgabe, a.tz_organisation, \
```

- [ ] **Step 5: `FlaechePatch` + `aktualisiere_flaeche`**
```rust
#[derive(Debug, Default)]
pub struct FlaechePatch<'a> {
    pub flaeche_geojson: Option<Option<&'a str>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

pub async fn aktualisiere_flaeche(
    pool: &SqlitePool, einsatz_id: i64, aid: i64, daten: FlaechePatch<'_>,
) -> Result<EinsatzabschnittAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatzabschnitt SET \
            flaeche_geojson = CASE WHEN ? THEN ? ELSE flaeche_geojson END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.flaeche_geojson.is_some()).bind(daten.flaeche_geojson.flatten())
    .bind(daten.tz_fachaufgabe.is_some()).bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some()).bind(daten.tz_organisation.flatten())
    .bind(aid).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 { return Err(AppError::NotFound); }
    let row = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE a.id = ? AND a.einsatz_id = ?"
    )).bind(aid).bind(einsatz_id).fetch_one(pool).await?;
    Ok(zu_anzeige(row))
}
```

- [ ] **Step 6: Test grün**

Run: `rtk proxy cargo test -p lifeline-hub einsatzabschnitt::repo::`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src/einsatzabschnitt/
git commit -m "feat(be): Abschnitt-Fläche (GeoJSON) + tz_* + aktualisiere_flaeche"
```

---

## Task 5: Personal — Führungskräfte-Lesepfad + Positions-Repo

**Entscheidung (Spec offen → hier festgelegt):** `GET …/personal` bekommt **kein** `lat/lon`. Stattdessen liefert ein **dedizierter** Pfad `GET /api/einsaetze/{id}/karte/fuehrungskraefte` nur die Personen, die `einsatz_einheit.fuehrer_id` **oder** `einsatzabschnitt.leiter_id` sind (Cross-Table-Union; als Personal-Liste-Filter nicht ausdrückbar). Das verhindert das Fluten der Karte mit gesamtem Personal.

**Files:**
- Modify: `src/personal/mod.rs` (neue Struct `FuehrungskraftKarte`)
- Modify: `src/personal/disposition_repo.rs` (neue `liste_fuehrungskraefte`, `aktualisiere_position`)
- Test: `src/personal/disposition_repo.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Failing test**
```rust
#[tokio::test]
async fn nur_fuehrungskraefte_und_position() {
    let pool = test_pool().await;
    // seed: Einsatz + 3 Personal; #1 = Einheitsführer, #2 = Abschnittsleiter, #3 = normal.
    let (einsatz_id, p1, p2, _p3) = seed_personal_mit_fuehrung(&pool).await;

    let liste = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
    let ids: Vec<i64> = liste.iter().map(|f| f.id).collect();
    assert!(ids.contains(&p1) && ids.contains(&p2));
    assert_eq!(liste.len(), 2); // #3 NICHT enthalten

    aktualisiere_position(&pool, einsatz_id, p1, PositionPatch {
        lat: Some(Some(50.1)), lon: Some(Some(8.6)),
        tz_fachaufgabe: Some(Some("fuehrung")), tz_organisation: None,
    }).await.unwrap();
    let liste2 = liste_fuehrungskraefte(&pool, einsatz_id).await.unwrap();
    let f1 = liste2.iter().find(|f| f.id == p1).unwrap();
    assert_eq!(f1.lat, Some(50.1));
    assert!(f1.ist_einheitsfuehrer);
}
```

- [ ] **Step 2: Test schlägt fehl**

Run: `rtk proxy cargo test -p lifeline-hub personal::disposition_repo::`
Expected: FAIL.

- [ ] **Step 3: Struct `FuehrungskraftKarte`**

In `src/personal/mod.rs`:
```rust
/// Schlanke Karten-Sicht einer Führungskraft (Einheits- oder Abschnittsführung).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FuehrungskraftKarte {
    pub id: i64,            // einsatz_personal.id
    pub einsatz_id: i64,
    pub name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    pub ist_einheitsfuehrer: bool,
    pub ist_abschnittsleiter: bool,
}
```

- [ ] **Step 4: `liste_fuehrungskraefte` + `PositionPatch` + `aktualisiere_position`**

In `src/personal/disposition_repo.rs`:
```rust
pub async fn liste_fuehrungskraefte(
    pool: &SqlitePool, einsatz_id: i64,
) -> Result<Vec<FuehrungskraftKarte>, AppError> {
    let rows = sqlx::query_as::<_, FuehrungskraftKarte>(
        "SELECT ep.id, ep.einsatz_id, ep.snap_name AS name, \
                ep.lat, ep.lon, ep.tz_fachaufgabe, ep.tz_organisation, \
                EXISTS(SELECT 1 FROM einsatz_einheit e \
                       WHERE e.einsatz_id = ep.einsatz_id AND e.fuehrer_id = ep.id) AS ist_einheitsfuehrer, \
                EXISTS(SELECT 1 FROM einsatzabschnitt a \
                       WHERE a.einsatz_id = ep.einsatz_id AND a.leiter_id = ep.id) AS ist_abschnittsleiter \
         FROM einsatz_personal ep \
         WHERE ep.einsatz_id = ?1 \
           AND ( ep.id IN (SELECT fuehrer_id FROM einsatz_einheit WHERE einsatz_id = ?1 AND fuehrer_id IS NOT NULL) \
              OR ep.id IN (SELECT leiter_id  FROM einsatzabschnitt WHERE einsatz_id = ?1 AND leiter_id  IS NOT NULL) ) \
         ORDER BY ep.snap_name, ep.id",
    ).bind(einsatz_id).fetch_all(pool).await?;
    Ok(rows)
}

#[derive(Debug, Default)]
pub struct PositionPatch<'a> {
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
}

pub async fn aktualisiere_position(
    pool: &SqlitePool, einsatz_id: i64, ep_id: i64, daten: PositionPatch<'_>,
) -> Result<FuehrungskraftKarte, AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_personal SET \
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
            tz_fachaufgabe  = CASE WHEN ? THEN ? ELSE tz_fachaufgabe END, \
            tz_organisation = CASE WHEN ? THEN ? ELSE tz_organisation END \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.lat.is_some()).bind(daten.lat.flatten())
    .bind(daten.lon.is_some()).bind(daten.lon.flatten())
    .bind(daten.tz_fachaufgabe.is_some()).bind(daten.tz_fachaufgabe.flatten())
    .bind(daten.tz_organisation.is_some()).bind(daten.tz_organisation.flatten())
    .bind(ep_id).bind(einsatz_id)
    .execute(pool).await?.rows_affected();
    if betroffen == 0 { return Err(AppError::NotFound); }
    // Einzelsatz im Führungskräfte-Format zurückgeben:
    let liste = liste_fuehrungskraefte(pool, einsatz_id).await?;
    liste.into_iter().find(|f| f.id == ep_id).ok_or(AppError::NotFound)
}
```

- [ ] **Step 5: Test grün**

Run: `rtk proxy cargo test -p lifeline-hub personal::disposition_repo::`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/personal/
git commit -m "feat(be): Führungskräfte-Karten-Lesepfad + Personal-Position"
```

---

## Task 6: SSE-Helfer + Stream-Routen + Geo-PATCH-Handler (Einheit/Fahrzeug/Personal/Abschnitt)

Vier Geo-Endpunkte + drei Stream-Endpunkte + ein Führungskräfte-Leseendpunkt. Jeder Geo-Handler folgt exakt dem L‑1-Muster (Auth, Geo-Paar-Validierung, Repo-Aufruf, SSE-Publish, **kein ETB**).

**Files:**
- Modify: `src/routes/einsatz_einheit.rs`, `src/routes/einsatz_fahrzeug.rs`, `src/routes/einsatz_personal.rs`, `src/routes/einsatzabschnitt.rs`
- Modify: `src/app.rs` (Routen registrieren)
- Test: `tests/` Integrationstest (siehe Task 9) — hier nur Kompilier-Gate + ein Handler-Smoke.

- [ ] **Step 1: SSE-Helfer je Datei**

In `src/routes/einsatz_einheit.rs` (analog `sse_uhs`):
```rust
fn sse_einheit(state: &AppState, einsatz_id: i64, einheit_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "einheit_id": einheit_id }).to_string();
    state.live.publiziere_event(einsatz_id, "einheit", data);
}
```
Analog `sse_fahrzeug` (`"fahrzeug"`, `ef_id`) in `einsatz_fahrzeug.rs`, `sse_personal` (`"person"` — Tag existiert bereits!, `ep_id`) in `einsatz_personal.rs`, `sse_abschnitt` (`"abschnitt"`, `aid`) in `einsatzabschnitt.rs`.

> Hinweis: Personal nutzt das **bestehende** `person`-Tag (die Lagekarte abonniert es bereits über `useUhsStream`). Kein neues Personal-Tag.

- [ ] **Step 2: Tri-State-Deserializer je Datei sicherstellen**

Falls in `einsatz_einheit.rs`/`einsatz_fahrzeug.rs`/`einsatz_personal.rs`/`einsatzabschnitt.rs` noch nicht vorhanden, die lokale Kopie aus `src/routes/einsatz_uhs.rs:79-92` einfügen:
```rust
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where T: serde::Deserialize<'de>, D: serde::Deserializer<'de> {
    Option::<T>::deserialize(deserializer).map(Some)
}
```

- [ ] **Step 3: Geo-PATCH-Handler Einheit**

In `src/routes/einsatz_einheit.rs`:
```rust
#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/einheiten/{eid}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, einheit_id)): Path<(i64, i64)>,
    Json(body): Json<PositionBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // 404 falls fremd/unbekannt + Effektivzustand für Geo-Paar.
    let vorher = einheit_repo::laden(&state.pool, einsatz_id, einheit_id).await?;
    let eff_lat = match body.lat { Some(o) => o, None => vorher.lat };
    let eff_lon = match body.lon { Some(o) => o, None => vorher.lon };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into()));
    }
    if let Some(la) = eff_lat { if !(-90.0..=90.0).contains(&la) {
        return Err(AppError::UnprocessableEntity("lat muss zwischen -90 und 90 liegen".into())); } }
    if let Some(lo) = eff_lon { if !(-180.0..=180.0).contains(&lo) {
        return Err(AppError::UnprocessableEntity("lon muss zwischen -180 und 180 liegen".into())); } }

    let nachher = einheit_repo::aktualisiere_position(&state.pool, einsatz_id, einheit_id,
        einheit_repo::PositionPatch {
            lat: body.lat, lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        }).await?;
    sse_einheit(&state, einsatz_id, einheit_id);
    Ok(Json(nachher))
}
```
> Falls `einheit_repo::laden(pool, einsatz_id, id)` nicht existiert, einen `laden` analog zu `aktualisiere_position`/Step-5-SELECT ergänzen (eine Zeile via `SELECT_AUFGELOEST WHERE e.id=? AND e.einsatz_id=?`).

- [ ] **Step 4: Geo-PATCH-Handler Fahrzeug + Personal**

`einsatz_fahrzeug.rs::position` analog (Repo: `disposition_repo::aktualisiere_position(..., einsatz.ist_aktiv())`, Rückgabe `EinsatzFahrzeugAnzeige`, `sse_fahrzeug`). `vorher` via `disposition_repo::laden`.

`einsatz_personal.rs::position` analog (Repo: `disposition_repo::aktualisiere_position`, Rückgabe `FuehrungskraftKarte`, `sse_personal`). Geo-Paar-Validierung gegen die vorhandene Führungskraft-Position (lade einmalig via `liste_fuehrungskraefte` + `find`, oder ein schlankes `SELECT lat, lon FROM einsatz_personal WHERE id=? AND einsatz_id=?`).

- [ ] **Step 5: Flächen-PATCH-Handler Abschnitt**

In `src/routes/einsatzabschnitt.rs`:
```rust
#[derive(Debug, Deserialize)]
pub struct FlaecheBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub flaeche_geojson: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid}/flaeche — Lage-Pflege, KEIN ETB.
pub async fn flaeche(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
    Json(body): Json<FlaecheBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Leichte GeoJSON-Plausibilität (kein voller Parser): wenn gesetzt, muss es ein
    // JSON-Objekt mit "type":"Polygon" sein. Leeres/whitespace → als Löschen behandeln.
    if let Some(Some(gj)) = &body.flaeche_geojson {
        let v: serde_json::Value = serde_json::from_str(gj)
            .map_err(|_| AppError::UnprocessableEntity("flaeche_geojson ist kein gültiges JSON".into()))?;
        if v.get("type").and_then(|t| t.as_str()) != Some("Polygon") {
            return Err(AppError::UnprocessableEntity("flaeche_geojson muss ein GeoJSON-Polygon sein".into()));
        }
    }

    let nachher = abschnitt_repo::aktualisiere_flaeche(&state.pool, einsatz_id, aid,
        abschnitt_repo::FlaechePatch {
            flaeche_geojson: body.flaeche_geojson.as_ref().map(|o| o.as_deref()),
            tz_fachaufgabe:  body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        }).await?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(nachher))
}
```

- [ ] **Step 6: Führungskräfte-Leseendpunkt + drei Stream-Handler**

In `src/routes/einsatz_personal.rs`:
```rust
/// GET /api/einsaetze/{id}/karte/fuehrungskraefte — nur Einheits-/Abschnittsführung.
pub async fn karte_fuehrungskraefte(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<FuehrungskraftKarte>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(disposition_repo::liste_fuehrungskraefte(&state.pool, einsatz_id).await?))
}
```
Stream-Handler `stream` je in `einsatz_einheit.rs`, `einsatz_fahrzeug.rs`, `einsatzabschnitt.rs` — exakt nach `src/routes/etb.rs:211-236` (gleiche Imports, `fordere_lesezugriff`, `state.live.abonniere(einsatz_id)`, `BroadcastStream` + `lagged`). Der Stream transportiert alle Tags des Einsatz-Kanals; die Frontend-Hooks filtern per Event-Name.

- [ ] **Step 7: Routen registrieren**

In `src/app.rs` (bei den jeweiligen Blöcken):
```rust
.route("/api/einsaetze/{id}/einheiten/stream", get(routes::einsatz_einheit::stream))
.route("/api/einsaetze/{id}/einheiten/{eid}/position", patch(routes::einsatz_einheit::position))
.route("/api/einsaetze/{id}/fahrzeuge/stream", get(routes::einsatz_fahrzeug::stream))
.route("/api/einsaetze/{id}/fahrzeuge/{ef_id}/position", patch(routes::einsatz_fahrzeug::position))
.route("/api/einsaetze/{id}/personal/{ep_id}/position", patch(routes::einsatz_personal::position))
.route("/api/einsaetze/{id}/karte/fuehrungskraefte", get(routes::einsatz_personal::karte_fuehrungskraefte))
.route("/api/einsaetze/{id}/abschnitte/stream", get(routes::einsatzabschnitt::stream))
.route("/api/einsaetze/{id}/abschnitte/{aid}/flaeche", patch(routes::einsatzabschnitt::flaeche))
```

- [ ] **Step 8: Kompiliert**

Run: `rtk proxy cargo build`
Expected: ohne Fehler.

- [ ] **Step 9: Commit**
```bash
git add src/routes/ src/app.rs
git commit -m "feat(be): Geo-PATCH-Routen + Führungskräfte-Lesepfad + SSE-Streams (Einheit/Fahrzeug/Personal/Abschnitt)"
```

---

## Task 7: Org-Default `tz_organisation` — Backend-Route

**Files:**
- Create: `src/routes/organisation.rs`
- Modify: `src/routes/mod.rs` (`pub mod organisation;`), `src/app.rs`
- Test: `tests/organisation_tz.rs` (Integrationstest mit App-Harness — folge einem bestehenden `tests/*.rs`-Vorbild)

- [ ] **Step 1: Failing test (GET liefert Default, PATCH ändert, nur Admin)**
```rust
// tests/organisation_tz.rs — Harness wie in bestehenden Integrationstests aufbauen.
#[tokio::test]
async fn org_tz_default_lesen_und_admin_patch() {
    let app = TestApp::neu().await;          // bestehender Harness-Helfer
    let admin = app.login_admin().await;

    let org = app.get_json("/api/organisation", &admin).await;
    assert_eq!(org["tz_organisation"], "hilfsorganisation");

    let res = app.patch("/api/organisation", json!({ "tz_organisation": "feuerwehr" }), &admin).await;
    assert_eq!(res.status(), 200);
    let org2 = app.get_json("/api/organisation", &admin).await;
    assert_eq!(org2["tz_organisation"], "feuerwehr");

    // Nicht-Admin darf nicht patchen → 403.
    let user = app.login_user().await;       // system_rolle 'keiner'
    let res2 = app.patch("/api/organisation", json!({ "tz_organisation": "thw" }), &user).await;
    assert_eq!(res2.status(), 403);
}
```

- [ ] **Step 2: Test schlägt fehl**

Run: `rtk proxy cargo test --test organisation_tz`
Expected: FAIL (Route 404 / Harness-Symbole).

- [ ] **Step 3: Route implementieren**

`src/routes/organisation.rs`:
```rust
use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::auth::CurrentUser;
use crate::error::AppError;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct OrganisationAnzeige {
    pub id: i64,
    pub name: String,
    pub tz_organisation: Option<String>,
}

/// GET /api/organisation — Org-Stammdaten inkl. DV-102-Org-Default. Jeder eingeloggte Nutzer.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    let org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation ORDER BY id LIMIT 1",
    ).fetch_one(&state.pool).await?;
    Ok(Json(org))
}

#[derive(Debug, Deserialize)]
pub struct OrgPatch {
    pub tz_organisation: String,
}

const ERLAUBTE_ORG: &[&str] = &[
    "feuerwehr", "thw", "fuehrung", "polizei", "gefahrenabwehr",
    "hilfsorganisation", "bundeswehr", "zivil",
];

/// PATCH /api/organisation — Org-Default setzen. Nur Admin.
pub async fn aktualisieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<OrgPatch>,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    if !ERLAUBTE_ORG.contains(&body.tz_organisation.as_str()) {
        return Err(AppError::UnprocessableEntity("Unbekannte Organisation".into()));
    }
    sqlx::query("UPDATE organisation SET tz_organisation = ? WHERE id = (SELECT id FROM organisation ORDER BY id LIMIT 1)")
        .bind(&body.tz_organisation)
        .execute(&state.pool).await?;
    lesen(State(state), CurrentUser(_admin.0)).await
}
```
> `CurrentUser`/`AdminUser`-Importpfade an die echten Re-Exports anpassen (`AdminUser` liegt in `src/auth/session.rs`; `CurrentUser` ebenso — siehe bestehende Route-Imports).

- [ ] **Step 4: Registrieren**

`src/routes/mod.rs`: `pub mod organisation;`
`src/app.rs`:
```rust
.route("/api/organisation", get(routes::organisation::lesen))
.route("/api/organisation", patch(routes::organisation::aktualisieren))
```

- [ ] **Step 5: Test grün**

Run: `rtk proxy cargo test --test organisation_tz`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/routes/organisation.rs src/routes/mod.rs src/app.rs tests/organisation_tz.rs
git commit -m "feat(be): GET/PATCH /api/organisation für DV-102-Org-Default"
```

---

## Task 8: Live-Publish in bestehende K&M-Mutationen verdrahten

Die Spec verlangt Live „bei Geo-PATCH **und** K&M-Mutation". Die Geo-PATCHes publizieren bereits (Task 6). Jetzt in **jeden** bestehenden Mutations-Handler den passenden `sse_*`-Aufruf einbauen, jeweils **nach** erfolgreicher Repo-Mutation, **vor** dem `Ok(Json(...))`.

**Files:** `src/routes/einsatz_einheit.rs`, `src/routes/einsatz_fahrzeug.rs`, `src/routes/einsatz_personal.rs`, `src/routes/einsatzabschnitt.rs`

- [ ] **Step 1: Einheit-Handler**

In `einsatz_einheit.rs` nach erfolgreicher Mutation `sse_einheit(&state, einsatz_id, <id>)` ergänzen in: `bilden`, `aktualisieren`, `aufloesen`, `personal_zuordnen`, `personal_freigeben`, `fahrzeug_zuordnen`, `fahrzeug_freigeben`, `material_zuordnen`, `material_freigeben`. (Beim Auflösen die ID vor dem Löschen verwenden.)

- [ ] **Step 2: Fahrzeug-Handler**

In `einsatz_fahrzeug.rs`: `sse_fahrzeug(&state, einsatz_id, <ef_id>)` in `disponieren`, `aktualisieren`, `entfernen`.

- [ ] **Step 3: Personal-Handler**

In `einsatz_personal.rs`: `sse_personal(&state, einsatz_id, <ep_id>)` in `disponieren`, `aktualisieren`, `entfernen`.

- [ ] **Step 4: Abschnitt-Handler**

In `einsatzabschnitt.rs`: `sse_abschnitt(&state, einsatz_id, <aid>)` in `anlegen`, `aktualisieren`, `aufloesen`.

> Hinweis: `einheit::{fahrzeug_zuordnen,fahrzeug_freigeben}` und `personal_zuordnen/freigeben` ändern Zugehörigkeiten, die auch die jeweils andere Liste betreffen — zusätzlich das betroffene `sse_fahrzeug`/`sse_personal` feuern, damit Fahrzeug-/Personal-Layer ebenfalls live aktualisieren.

- [ ] **Step 5: Kompiliert + bestehende Tests grün**

Run: `rtk proxy cargo test -p lifeline-hub`
Expected: PASS (keine Regression).

- [ ] **Step 6: Commit**
```bash
git add src/routes/
git commit -m "feat(be): Live-Publish in alle K&M-Mutationen (Einheit/Fahrzeug/Personal/Abschnitt)"
```

---

## Task 9: Backend-Integrationstests (No-ETB, Live, Org-Isolation)

**Files:** `tests/lage_taktik.rs` (neuer Integrationstest; Harness wie in bestehenden `tests/*.rs`)

- [ ] **Step 1: Test — Geo-PATCH erzeugt KEINEN ETB-Eintrag, K&M-Mutation schon**
```rust
#[tokio::test]
async fn verorten_schreibt_keinen_etb_eintrag() {
    let app = TestApp::neu().await;
    let fk = app.login_fuehrung().await;            // schreibberechtigt
    let einsatz = app.einsatz_anlegen(&fk).await;
    let einheit = app.einheit_bilden(einsatz, &fk).await;   // erzeugt evtl. ETB

    let etb_vorher = app.etb_count(einsatz, &fk).await;
    let res = app.patch(&format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/position"),
        json!({ "lat": 50.1, "lon": 8.6, "tz_fachaufgabe": "rettungswesen" }), &fk).await;
    assert_eq!(res.status(), 200);
    let etb_nachher = app.etb_count(einsatz, &fk).await;
    assert_eq!(etb_vorher, etb_nachher, "Verorten darf keinen ETB-Eintrag erzeugen");
}
```

- [ ] **Step 2: Test — Partial-Merge (nur lat) nullt lon nicht / Geo-Paar 422**
```rust
#[tokio::test]
async fn geo_paar_partial_und_422() {
    let app = TestApp::neu().await;
    let fk = app.login_fuehrung().await;
    let einsatz = app.einsatz_anlegen(&fk).await;
    let einheit = app.einheit_bilden(einsatz, &fk).await;
    // erst beides setzen
    app.patch(&pfad(einsatz, einheit), json!({ "lat": 50.0, "lon": 8.0 }), &fk).await;
    // nur tz ändern → lat/lon bleiben (kein 422)
    let r = app.patch(&pfad(einsatz, einheit), json!({ "tz_fachaufgabe": "betreuung" }), &fk).await;
    assert_eq!(r.status(), 200);
    // nur lat senden, vorher gesetzt → Effektivzustand bleibt Paar → ok
    // aber: lat löschen ohne lon → unpaar → 422
    let r2 = app.patch(&pfad(einsatz, einheit), json!({ "lat": null }), &fk).await;
    assert_eq!(r2.status(), 422);
}
```

- [ ] **Step 3: Test — Karten-Lesedaten filtern Aufgelöstes; Führungskräfte nur Leader**

Einheit auflösen → erscheint nicht mehr in `GET …/einheiten`. `GET …/karte/fuehrungskraefte` enthält nur gesetzte `fuehrer_id`/`leiter_id`.

- [ ] **Step 4: Test — Org-Isolation (bekannte Lücke bewusst behandelt)**

**Entscheidung:** Der Test deckt die **regulär geschlossene** Isolation ab (Nicht-privilegierter Fremd-Org-Nutzer → kein Zugriff). Die bekannte `ist_hoehere_berechtigung`-Cross-Org-Leselücke (siehe Memory) wird in L‑2 **nicht** gefixt (out of scope) und hier nicht als grüner Test verlangt.
```rust
#[tokio::test]
async fn fremde_org_kein_zugriff() {
    let app = TestApp::neu().await;
    let fk = app.login_fuehrung().await;                   // Org A
    let einsatz = app.einsatz_anlegen(&fk).await;
    let einheit = app.einheit_bilden(einsatz, &fk).await;

    let fremd = app.login_user_in_neuer_org().await;       // Org B, system_rolle 'keiner', keine Mitgliedschaft
    // lesen verweigert
    assert_eq!(app.get_status(&format!("/api/einsaetze/{einsatz}/einheiten"), &fremd).await, 403);
    // verorten verweigert
    let r = app.patch(&format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/position"),
        json!({ "lat": 50.0, "lon": 8.0 }), &fremd).await;
    assert!(r.status() == 403 || r.status() == 404);
}
```
> `login_user_in_neuer_org` legt eine zweite `organisation`-Zeile + Benutzer an (Tabelle erlaubt mehrere Zeilen; der Bootstrap setzt nur die erste).

- [ ] **Step 5: Test — SSE feuert bei Geo-PATCH und K&M-Mutation**

Stream `…/einheiten/stream` abonnieren (oder den LiveHub direkt prüfen, falls der Harness das erlaubt), je eine Geo-PATCH- und eine `bilden`-Mutation auslösen, je ein `einheit`-Event erwarten. Falls der Harness keinen SSE-Client hat: alternativ `state.live`-Empfänger im Test direkt abonnieren.

- [ ] **Step 6: Tests grün**

Run: `rtk proxy cargo test --test lage_taktik`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add tests/lage_taktik.rs
git commit -m "test(be): L-2 No-ETB, Geo-Paar, Filter, Führungskräfte, Org-Isolation, Live"
```

---

## Task 10: Frontend — Abhängigkeiten installieren

**Files:** `frontend/package.json`, `frontend/package-lock.json`

- [ ] **Step 1: Installieren**

Run:
```bash
cd /Users/rubeen/dev/personal/lifeline-hub/frontend && npm install taktische-zeichen-react@^0.10.0 terra-draw@^1.31.0 terra-draw-maplibre-gl-adapter@^1.4.1
```
Expected: `taktische-zeichen-core` wird transitiv mitinstalliert; keine peer-Warnungen zu maplibre-gl (Adapter peer `>=4`).

- [ ] **Step 2: Build-Smoke**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine neuen Typfehler.

- [ ] **Step 3: Commit**
```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(fe): taktische-zeichen-react + terra-draw Abhängigkeiten"
```

---

## Task 11: Frontend — TZ-Mapping-Modul

**Files:**
- Create: `frontend/src/pages/lagekarte/taktischesZeichen.ts`
- Test: `frontend/src/pages/lagekarte/taktischesZeichen.test.ts`

- [ ] **Step 1: Failing test**

`taktischesZeichen.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { baueTzProps, groesseAusLabel } from './taktischesZeichen';

describe('taktischesZeichen', () => {
  it('Einheit: Grundzeichen + Größe aus Label + Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'einheit', einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('taktische-formation');
    expect(p.einheit).toBe('gruppe');
    expect(p.organisation).toBe('hilfsorganisation');
  });
  it('Objekt-Override schlägt Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'fahrzeug', organisation: 'feuerwehr', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('kraftfahrzeug-landgebunden');
    expect(p.organisation).toBe('feuerwehr');
  });
  it('Abschnitt/Führung default fachaufgabe = fuehrung', () => {
    expect(baueTzProps({ objekttyp: 'abschnitt' }).fachaufgabe).toBe('fuehrung');
    expect(baueTzProps({ objekttyp: 'fuehrung' }).grundzeichen).toBe('person');
  });
  it('unbekanntes Größen-Label → keine Größe', () => {
    expect(groesseAusLabel('Sonstige')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && npx vitest run src/pages/lagekarte/taktischesZeichen.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Modul implementieren**

`taktischesZeichen.ts`:
```ts
import type {
  EinheitId, FachaufgabeId, GrundzeichenId, OrganisationId,
  TaktischesZeichen as TZSpec,
} from 'taktische-zeichen-core';

export type Objekttyp = 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';

const GRUNDZEICHEN: Record<Objekttyp, GrundzeichenId> = {
  einheit: 'taktische-formation',
  fahrzeug: 'kraftfahrzeug-landgebunden',
  fuehrung: 'person',
  abschnitt: 'befehlsstelle',
};

// Einheit-Größe wird aus dem einheit_typ-Label abgeleitet (DV-102-Schlüssel).
const GROESSE_NACH_LABEL: Record<string, EinheitId> = {
  trupp: 'trupp', staffel: 'staffel', gruppe: 'gruppe', zug: 'zug', zugtrupp: 'zugtrupp',
};

export function groesseAusLabel(label: string | null | undefined): EinheitId | undefined {
  if (!label) return undefined;
  return GROESSE_NACH_LABEL[label.trim().toLowerCase()];
}

export interface TzEingabe {
  objekttyp: Objekttyp;
  einheitTypLabel?: string | null;
  fachaufgabe?: string | null;   // tz_fachaufgabe am Objekt
  organisation?: string | null;  // tz_organisation am Objekt (Override)
  orgDefault?: string | null;    // Org-Default aus /api/organisation
}

export type TzProps = Pick<TZSpec, 'grundzeichen' | 'organisation' | 'fachaufgabe' | 'einheit'>;

/** Leitet die DV-102-Spec aus App-Feldern ab (Org-Default + Objekt-Override + Fachaufgabe). */
export function baueTzProps(e: TzEingabe): TzProps {
  const organisation = (e.organisation ?? e.orgDefault ?? undefined) as OrganisationId | undefined;
  const fachaufgabe = (e.fachaufgabe
    ?? (e.objekttyp === 'abschnitt' || e.objekttyp === 'fuehrung' ? 'fuehrung' : undefined)) as
    FachaufgabeId | undefined;
  return {
    grundzeichen: GRUNDZEICHEN[e.objekttyp],
    organisation,
    fachaufgabe,
    einheit: e.objekttyp === 'einheit' ? groesseAusLabel(e.einheitTypLabel) : undefined,
  };
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && npx vitest run src/pages/lagekarte/taktischesZeichen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/lagekarte/taktischesZeichen.ts frontend/src/pages/lagekarte/taktischesZeichen.test.ts
git commit -m "feat(fe): TZ-Mapping-Modul (Objekt → DV-102-Props)"
```

---

## Task 12: Frontend — Zentroid-Helfer

**Files:**
- Create: `frontend/src/pages/lagekarte/geo.ts`
- Test: `frontend/src/pages/lagekarte/geo.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from 'vitest';
import { polygonZentroid } from './geo';

describe('polygonZentroid', () => {
  it('Mittelpunkt eines Quadrats', () => {
    const gj = { type: 'Polygon' as const, coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] };
    const [lon, lat] = polygonZentroid(gj)!;
    expect(lon).toBeCloseTo(1, 6);
    expect(lat).toBeCloseTo(1, 6);
  });
  it('ungültig → null', () => {
    expect(polygonZentroid({ type: 'Polygon', coordinates: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && npx vitest run src/pages/lagekarte/geo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementieren** (flächengewichteter Polygon-Zentroid, äußerer Ring)

`geo.ts`:
```ts
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/** Flächengewichteter Zentroid des äußeren Rings; null bei leerem/degeneriertem Polygon. */
export function polygonZentroid(poly: GeoJsonPolygon): [number, number] | null {
  const ring = poly.coordinates?.[0];
  if (!ring || ring.length < 4) return null; // mind. 3 Punkte + Schluss
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a === 0) {
    // entartet (kollinear) → Mittel der Stützpunkte
    const pts = ring.slice(0, -1);
    const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const sy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [sx, sy];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function parsePolygon(geojson: string | null | undefined): GeoJsonPolygon | null {
  if (!geojson) return null;
  try {
    const v = JSON.parse(geojson);
    return v?.type === 'Polygon' && Array.isArray(v.coordinates) ? (v as GeoJsonPolygon) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Test grün**

Run: `cd frontend && npx vitest run src/pages/lagekarte/geo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/lagekarte/geo.ts frontend/src/pages/lagekarte/geo.test.ts
git commit -m "feat(fe): Polygon-Zentroid + GeoJSON-Parser-Helfer"
```

---

## Task 13: Frontend — API-Clients (Lesen, Position-PATCH, Org-Default)

**Files:**
- Create/Modify: `frontend/src/api/einsatzEinheit.ts`, `einsatzFahrzeug.ts`, `einsatzAbschnitt.ts`, `einsatzPersonal.ts`, `organisation.ts`
- Modify: `frontend/src/api/types.ts` (Typen erweitern)

- [ ] **Step 1: Typen erweitern** (`frontend/src/api/types.ts`)

Felder an die bestehenden Typen `Einheit`, `EinsatzFahrzeug`, `Einsatzabschnitt` ergänzen (Namen exakt wie Backend-JSON):
```ts
// Einheit:        lat: number | null; lon: number | null; tz_fachaufgabe: string | null; tz_organisation: string | null;
// EinsatzFahrzeug: lat; lon; tz_fachaufgabe; tz_organisation; (status_kategorie/status_farbe existieren)
// Einsatzabschnitt: flaeche_geojson: string | null; tz_fachaufgabe; tz_organisation;
export interface FuehrungskraftKarte {
  id: number;
  einsatz_id: number;
  name: string;
  lat: number | null;
  lon: number | null;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  ist_einheitsfuehrer: boolean;
  ist_abschnittsleiter: boolean;
}
export interface OrganisationInfo {
  id: number;
  name: string;
  tz_organisation: string | null;
}
```

- [ ] **Step 2: API-Funktionen**

`frontend/src/api/einsatzEinheit.ts` (falls existent, ergänzen; sonst neu nach Vorbild `einsatzUhs.ts`):
```ts
import { apiGet, apiSend } from './client';
import type { Einheit } from './types';

export function listeEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten`);
}
export interface PositionPatch {
  lat?: number | null; lon?: number | null;
  tz_fachaufgabe?: string | null; tz_organisation?: string | null;
}
export function verorteEinheit(einsatzId: number, einheitId: number, daten: PositionPatch): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`, 'PATCH', daten);
}
```
Analog `einsatzFahrzeug.ts` (`listeFahrzeuge`, `verorteFahrzeug` → `/fahrzeuge/{ef_id}/position`), `einsatzPersonal.ts` (`listeFuehrungskraefte` → `/karte/fuehrungskraefte`, `verortePerson` → `/personal/{ep_id}/position`), `einsatzAbschnitt.ts` (`listeAbschnitte`, `zeichneAbschnitt` → `/abschnitte/{aid}/flaeche` mit Body `{ flaeche_geojson, tz_fachaufgabe?, tz_organisation? }`).

`frontend/src/api/organisation.ts`:
```ts
import { apiGet, apiSend } from './client';
import type { OrganisationInfo } from './types';

export function ladeOrganisation(): Promise<OrganisationInfo> {
  return apiGet<OrganisationInfo>('/api/organisation');
}
export function setzeOrgDefault(tz_organisation: string): Promise<OrganisationInfo> {
  return apiSend<OrganisationInfo>('/api/organisation', 'PATCH', { tz_organisation });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine Fehler (ggf. bestehende Importpfade angleichen).

- [ ] **Step 4: Commit**
```bash
git add frontend/src/api/
git commit -m "feat(fe): API-Clients für taktische Objekte (lesen, verorten, Org-Default)"
```

---

## Task 14: Frontend — SSE-Hooks für neue Kanäle

**Files:**
- Create: `frontend/src/etb/useEinheitenStream.ts`, `useFahrzeugeStream.ts`, `useAbschnitteStream.ts`

- [ ] **Step 1: Hooks implementieren** (Vorbild `frontend/src/etb/useSchaedenStream.ts`)

`useEinheitenStream.ts`:
```ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function useEinheitenStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/einheiten/stream`);
    const resync = () => {
      qc.invalidateQueries({ queryKey: ['einsatz-einheiten', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-fuehrungskraefte', einsatzId] });
    };
    quelle.addEventListener('einheit', resync);
    quelle.addEventListener('person', resync);   // Führer-Zuordnung ändert Leader-Set
    quelle.addEventListener('lagged', resync);
    return () => {
      quelle.removeEventListener('einheit', resync);
      quelle.removeEventListener('person', resync);
      quelle.removeEventListener('lagged', resync);
      quelle.close();
    };
  }, [einsatzId, qc]);
}
```
`useFahrzeugeStream.ts` analog (Event `fahrzeug`, Key `['einsatz-fahrzeuge', einsatzId]`). `useAbschnitteStream.ts` analog (Event `abschnitt`, Keys `['einsatz-abschnitte', einsatzId]` + `['einsatz-fuehrungskraefte', einsatzId]` weil `leiter_id` das Leader-Set ändert).

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/etb/useEinheitenStream.ts frontend/src/etb/useFahrzeugeStream.ts frontend/src/etb/useAbschnitteStream.ts
git commit -m "feat(fe): SSE-Hooks für Einheiten/Fahrzeuge/Abschnitte"
```

---

## Task 15: Frontend — Marker-Ableitung erweitern

**Files:**
- Modify: `frontend/src/pages/lagekarte/marker.ts`
- Modify: `frontend/src/pages/lagekarte/marker.test.ts`

- [ ] **Step 1: Failing test** (neue Typen in `marker.test.ts`)
```ts
it('leitet taktische Marker + nicht-verortet ab', () => {
  const einheiten = [
    { id: 1, name: 'Zug 1', typ_label: 'Zug', lat: 50.1, lon: 8.6, tz_fachaufgabe: 'rettungswesen', tz_organisation: null },
    { id: 2, name: 'Gruppe 2', typ_label: 'Gruppe', lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null },
  ] as any;
  const { verortet, nichtVerortet } = baueTaktischeMarker(
    { einheiten, fahrzeuge: [], fuehrungskraefte: [], orgDefault: 'hilfsorganisation' });
  expect(verortet.find((m) => m.schluessel === 'einheit-1')?.tz?.grundzeichen).toBe('taktische-formation');
  expect(nichtVerortet.some((o) => o.typ === 'einheit' && o.id === 2)).toBe(true);
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && npx vitest run src/pages/lagekarte/marker.test.ts`
Expected: FAIL.

- [ ] **Step 3: `KarteMarker`/`NichtVerortet` erweitern + `baueTaktischeMarker`**

In `marker.ts`:
```ts
import type { Einheit, EinsatzFahrzeug, FuehrungskraftKarte } from '../../api/types';
import { baueTzProps, type Objekttyp, type TzProps } from './taktischesZeichen';

// MarkerTyp + NichtVerortet.typ um taktische Typen erweitern:
export type MarkerTyp = 'einsatzort' | 'uhs' | 'schaden' | 'einheit' | 'fahrzeug' | 'fuehrung' | 'abschnitt';

// KarteMarker um optionale TZ-/FMS-Felder erweitern (bestehende Felder unverändert):
export interface KarteMarker {
  schluessel: string; typ: MarkerTyp; id: number; lat: number; lon: number; label: string; farbe: string;
  tz?: TzProps;                  // wenn gesetzt → DV-102-SVG statt Kreis
  statusFarbe?: string | null;   // FMS-Ring (nur Fahrzeug)
}
// NichtVerortet.typ entsprechend auf MarkerTyp-Untermenge erweitern.

export interface TaktischeQuelle {
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
  fuehrungskraefte: FuehrungskraftKarte[];
  orgDefault: string | null;
}

export function baueTaktischeMarker(q: TaktischeQuelle): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];
  const add = (
    typ: Exclude<Objekttyp, never>, id: number, label: string,
    lat: number | null, lon: number | null, tz: TzProps, statusFarbe?: string | null,
  ) => {
    if (lat != null && lon != null) {
      verortet.push({ schluessel: `${typ}-${id}`, typ, id, lat, lon, label, farbe: '#555', tz, statusFarbe });
    } else {
      nichtVerortet.push({ typ, id, label });
    }
  };
  for (const e of q.einheiten) {
    add('einheit', e.id, e.name, e.lat, e.lon,
      baueTzProps({ objekttyp: 'einheit', einheitTypLabel: e.typ_label, fachaufgabe: e.tz_fachaufgabe,
        organisation: e.tz_organisation, orgDefault: q.orgDefault }));
  }
  for (const f of q.fahrzeuge) {
    add('fahrzeug', f.id, f.funkrufname, f.lat, f.lon,
      baueTzProps({ objekttyp: 'fahrzeug', fachaufgabe: f.tz_fachaufgabe, organisation: f.tz_organisation, orgDefault: q.orgDefault }),
      f.status_farbe);
  }
  for (const p of q.fuehrungskraefte) {
    add('fuehrung', p.id, p.name, p.lat, p.lon,
      baueTzProps({ objekttyp: 'fuehrung', fachaufgabe: p.tz_fachaufgabe, organisation: p.tz_organisation, orgDefault: q.orgDefault }));
  }
  return { verortet, nichtVerortet };
}
```
> Abschnittsflächen sind **keine** `KarteMarker` (Polygone), sondern werden separat geführt (Task 17). Ein Befehlsstellen-Marker am Zentroid wird in Task 17 erzeugt.

- [ ] **Step 4: Test grün**

Run: `cd frontend && npx vitest run src/pages/lagekarte/marker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/lagekarte/marker.ts frontend/src/pages/lagekarte/marker.test.ts
git commit -m "feat(fe): taktische Marker-Ableitung (Einheit/Fahrzeug/Führung) + erweiterte Nicht-verortet-Liste"
```

---

## Task 16: Frontend — TZ-SVG-Marker + FMS-Ring in Kartenflaeche

**Files:** `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- [ ] **Step 1: TZ-Rendering im Marker-Effekt**

In `Kartenflaeche.tsx` den Marker-Effekt (`markers.map(...)`, Zeilen 90-104) erweitern: bei `mk.tz` ein DV-102-SVG statt Kreis rendern.
```ts
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-core';
// ...
markerObjekteRef.current = markers.map((mk) => {
  const el = document.createElement('div');
  el.title = mk.label;
  el.style.cursor = 'pointer';
  if (mk.tz) {
    // Per DOM-API bauen (kein innerHTML → kein XSS-Vektor), auch wenn dataUrl/
    // statusFarbe aus kontrollierten Enum-Werten stammen.
    const { dataUrl } = erzeugeTaktischesZeichen(mk.tz);
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    if (mk.statusFarbe) {
      wrap.style.cssText += `border:3px solid ${mk.statusFarbe};border-radius:6px;padding:1px;background:rgba(255,255,255,.85);`;
    }
    const img = document.createElement('img');
    img.src = dataUrl;        // data:image/svg+xml von der Lib erzeugt
    img.width = 34; img.height = 34; img.alt = '';
    wrap.appendChild(img);
    el.appendChild(wrap);
  } else {
    el.style.cssText += `width:18px;height:18px;border-radius:50%;border:2px solid #fff;background:${mk.farbe};box-shadow:0 0 3px rgba(0,0,0,.5)`;
  }
  el.addEventListener('click', (ev) => { ev.stopPropagation(); onMarkerKlick?.(mk.schluessel); });
  return new maplibregl.Marker({ element: el }).setLngLat([mk.lon, mk.lat]).addTo(map);
});
```
> `erzeugeTaktischesZeichen` liefert ein `dataUrl` (data:image/svg+xml…) — als `<img src>` einsetzbar, kein React-Render nötig. **Marker per DOM-API bauen, nicht via `el.innerHTML`** (XSS-Hygiene). FMS-Status (`statusFarbe`) wird als Ring **um** das Zeichen gelegt (nicht ins Grundzeichen gemischt — Spec).

- [ ] **Step 2: Typecheck + bestehende Tests grün**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/pages/LagekartePage.test.tsx`
Expected: keine Regression (Kartenflaeche ist in den Page-Tests gemockt).

- [ ] **Step 3: Commit**
```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): DV-102-SVG-Marker + FMS-Statusring in Kartenflaeche"
```

---

## Task 17: Frontend — Abschnittsflächen rendern + zeichnen (terra-draw)

**Files:**
- Create: `frontend/src/pages/lagekarte/abschnittDraw.ts`
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- [ ] **Step 1: terra-draw-Controller**

`abschnittDraw.ts`:
```ts
import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { GeoJsonPolygon } from './geo';

export interface AbschnittDraw {
  starten: () => void;
  stoppen: () => void;
  zerstoeren: () => void;
}

/** Aktiviert den Polygon-Zeichenmodus; ruft `onFertig` mit dem gezeichneten Polygon auf. */
export function createAbschnittDraw(
  map: maplibregl.Map,
  onFertig: (polygon: GeoJsonPolygon) => void,
): AbschnittDraw {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
    modes: [new TerraDrawPolygonMode()],
  });
  draw.on('finish', (id: string, ctx: { action: string }) => {
    if (ctx.action !== 'draw') return;
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && f.geometry.type === 'Polygon') {
      onFertig({ type: 'Polygon', coordinates: f.geometry.coordinates as number[][][] });
    }
    draw.removeFeatures(draw.getSnapshot().map((x) => x.id)); // Roh-Feature aufräumen; Persistenz übernimmt die App
  });
  return {
    // `draw.enabled` ist ein verifizierter read-only Getter. Bewusst KEIN
    // setMode('static') (Static-Mode ist hier nicht registriert) — der saubere
    // „nicht zeichnen"-Zustand ist draw.stop() (räumt den Adapter ab). start()
    // funktioniert danach auf derselben Instanz erneut.
    starten: () => { if (!draw.enabled) draw.start(); draw.setMode('polygon'); },
    stoppen: () => { if (draw.enabled) draw.stop(); },
    zerstoeren: () => { if (draw.enabled) draw.stop(); },
  };
}
```
> Verifiziert (`terra-draw@1.31` `.d.ts`): `enabled` (read-only), `start()`, `stop()`, `setMode(mode)` existieren. `setMode('static')` wird **nicht** verwendet, da der Static-Mode bei `modes:[PolygonMode]` nicht registriert ist und ein Aufruf werfen/no-op sein kann.

- [ ] **Step 2: Flächen-GeoJSON-Source + Zentroid-Marker in Kartenflaeche**

Neue Props an `KartenflaecheProps`:
```ts
  /** Abschnittsflächen als GeoJSON-Polygone (gefüllt, dezent). */
  flaechen?: { id: number; label: string; polygon: GeoJsonPolygon; tzMarker: KarteMarker }[];
  /** Polygon-Zeichenmodus aktiv? */
  zeichnen?: boolean;
  /** Fertig gezeichnetes Polygon. */
  onFlaecheGezeichnet?: (polygon: GeoJsonPolygon) => void;
  /** Klick auf eine Fläche → Inspector. */
  onFlaecheKlick?: (id: number) => void;
```
Effekte ergänzen:
- GeoJSON-Source `abschnitte` + `fill`-Layer (z. B. `fill-color #722ed1`, `fill-opacity 0.15`) + `line`-Layer (`line-color #722ed1`, `line-width 2`); bei Änderung der `flaechen` die Source-Daten via `(map.getSource('abschnitte') as GeoJSONSource).setData(...)` aktualisieren (Source/Layer beim ersten `map.on('load')` bzw. nach `setStyle` neu anlegen — `map.isStyleLoaded()` prüfen).
- `map.on('click', 'abschnitte-fill', (e) => onFlaecheKlick?.(Number(e.features?.[0]?.properties?.id)))`.
- Die `tzMarker` (Befehlsstelle am Zentroid) werden über die bestehende `markers`-Liste mitgereicht (Task 18 hängt sie an), nicht hier separat.
- Zeichenmodus: `useEffect` auf `zeichnen` → `createAbschnittDraw(map, onFlaecheGezeichnet).starten()` / beim Aus `stoppen()`/`zerstoeren()`. Controller-Instanz in einem `useRef` halten.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/lagekarte/abschnittDraw.ts frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): Abschnittsflächen rendern + Polygon-Zeichenmodus (terra-draw)"
```

---

## Task 18: Frontend — Sidebar erweitern (Layer + Nicht-verortet)

**Files:** `frontend/src/pages/lagekarte/Sidebar.tsx`

- [ ] **Step 1: `LayerSichtbar` + Props erweitern**
```ts
export interface LayerSichtbar {
  einsatzort: boolean; uhs: boolean; schaden: boolean;
  einheit: boolean; fahrzeug: boolean; fuehrung: boolean; abschnitt: boolean;
}
```
`SidebarProps.platzierungZiel`/`onPlatzierenStart` um die neuen Typen erweitern (`'einheit' | 'fahrzeug' | 'fuehrung'`), und einen separaten `onAbschnittZeichnenStart(id: number)` für Polygon-Modus ergänzen (Fläche ≠ Punkt-Platzieren).

- [ ] **Step 2: „Nicht verortet"-Liste + Layer-Toggles**

Die bestehende „Nicht verortet"-Liste rendert jetzt auch `einheit`/`fahrzeug`/`fuehrung` (Button „Platzieren" → `onPlatzierenStart`) und `abschnitt` (Button „Fläche zeichnen" → `onAbschnittZeichnenStart`). Label-Präfix je Typ („Einheit"/„Fahrzeug"/„Führung"/„Abschnitt"). Im „Ebenen"-Card vier neue `Switch` (Einheiten/Fahrzeuge/Personal-Führung/Abschnitte).

- [ ] **Step 3: Typecheck + bestehende Sidebar-Nutzung grün**

Run: `cd frontend && npx tsc --noEmit`
Expected: Fehler nur dort, wo `LagekartePage` die neuen Props noch nicht liefert (in Task 19 behoben). Sidebar selbst kompiliert.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx
git commit -m "feat(fe): Sidebar — Layer-Toggles + Nicht-verortet für taktische Objekte"
```

---

## Task 19: Frontend — LagekartePage verdrahten (Queries, Streams, Platzieren, Polygon)

**Files:** `frontend/src/pages/LagekartePage.tsx`

- [ ] **Step 1: Queries + Streams + Org-Default**

Neue Queries: `['einsatz-einheiten', id]`→`listeEinheiten`, `['einsatz-fahrzeuge', id]`→`listeFahrzeuge`, `['einsatz-abschnitte', id]`→`listeAbschnitte`, `['einsatz-fuehrungskraefte', id]`→`listeFuehrungskraefte`, `['organisation']`→`ladeOrganisation`. Neue Streams: `useEinheitenStream(einsatzId)`, `useFahrzeugeStream(einsatzId)`, `useAbschnitteStream(einsatzId)` (zusätzlich zu den bestehenden).

- [ ] **Step 2: Marker + Flächen zusammenführen**
```ts
const orgDefault = orgQuery.data?.tz_organisation ?? null;
const taktisch = useMemo(() => baueTaktischeMarker({
  einheiten: einheitenQuery.data ?? [], fahrzeuge: fahrzeugeQuery.data ?? [],
  fuehrungskraefte: fkQuery.data ?? [], orgDefault,
}), [einheitenQuery.data, fahrzeugeQuery.data, fkQuery.data, orgDefault]);

// Abschnittsflächen + Befehlsstellen-Marker am Zentroid:
const flaechen = useMemo(() => (abschnitteQuery.data ?? []).flatMap((a) => {
  const poly = parsePolygon(a.flaeche_geojson);
  if (!poly) return [];
  const z = polygonZentroid(poly);
  if (!z) return [];
  const tz = baueTzProps({ objekttyp: 'abschnitt', fachaufgabe: a.tz_fachaufgabe, organisation: a.tz_organisation, orgDefault });
  return [{ id: a.id, label: a.name, polygon: poly,
    tzMarker: { schluessel: `abschnitt-${a.id}`, typ: 'abschnitt' as const, id: a.id, lon: z[0], lat: z[1], label: a.name, farbe: '#722ed1', tz } }];
}, [abschnitteQuery.data, orgDefault]);

// Marker = L-1-Marker + taktische + Abschnitts-Zentroid-Marker, gefiltert nach Layer:
const alleVerortet = [...verortet, ...taktisch.verortet, ...flaechen.map((f) => f.tzMarker)];
const sichtbareMarker = alleVerortet.filter((m) => layer[m.typ]);
const nichtVerortet = [...l1NichtVerortet, ...taktisch.nichtVerortet,
  ...(abschnitteQuery.data ?? []).filter((a) => !a.flaeche_geojson).map((a) => ({ typ: 'abschnitt' as const, id: a.id, label: a.name }))];
```

- [ ] **Step 3: Platzieren-/Zeichnen-Flow erweitern**

`platzierungZiel`-Typ um `'einheit' | 'fahrzeug' | 'fuehrung'` erweitern; `verortenMutation` ruft je nach Typ `verorteEinheit`/`verorteFahrzeug`/`verortePerson` und invalidiert den passenden Query-Key. Neuer State `zeichneAbschnittId: number | null`; bei `onAbschnittZeichnenStart(id)` → `setZeichneAbschnittId(id)`, `Kartenflaeche zeichnen={zeichneAbschnittId != null}`, `onFlaecheGezeichnet={(poly) => zeichneAbschnitt(einsatzId, zeichneAbschnittId!, { flaeche_geojson: JSON.stringify(poly) }).then(invalidate).finally(() => setZeichneAbschnittId(null))}`.

- [ ] **Step 4: Layer-Default + an Kartenflaeche durchreichen**

`layer`-Default um `einheit:true, fahrzeug:true, fuehrung:true, abschnitt:true`. `flaechen` (nur wenn `layer.abschnitt`) + `onFlaecheKlick` an Kartenflaeche reichen.

- [ ] **Step 5: Manuelle Koordinateneingabe (Spec „alternativ Koordinate manuell eingeben")**

L‑1 ist klick-only — diese Affordanz ist neu in L‑2. Wenn ein Punkt-`platzierungZiel` aktiv ist, in der Sidebar-Platzieren-Card (Task 18) zwei `InputNumber` (lat/lon) + Button „Übernehmen" einblenden, der dieselbe `verortenMutation.mutate({ lat, lon })` aufruft wie der Karten-Klick. Props `onKoordinateEingeben(lat, lon)` an `Sidebar` reichen; Validierung der Bereiche übernimmt das Backend (422). (Nur Punkt-Ziele; Polygon hat keine manuelle Eingabe.)

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/pages/LagekartePage.tsx frontend/src/pages/lagekarte/Sidebar.tsx
git commit -m "feat(fe): LagekartePage — taktische Layer, Streams, Platzieren (Klick + manuell) + Polygon-Flow"
```

---

## Task 20: Frontend — Inspector erweitern (Typen, Links, Symbol-Auswahl)

**Files:** `frontend/src/pages/lagekarte/Inspector.tsx`

- [ ] **Step 1: Fach-Modul-Links + Typ-Labels**

`modulLink` um die neuen Typen erweitern (Routen relativ zu `/einsaetze/{id}/`, verifiziert aus `modulRegistry`):
```ts
const modulLink =
  marker.typ === 'uhs' ? `/einsaetze/${einsatzId}/unfallhilfsstellen/${marker.id}`
  : marker.typ === 'schaden' ? `/einsaetze/${einsatzId}/schaeden?schaden=${marker.id}`
  : marker.typ === 'einheit' ? `/einsaetze/${einsatzId}/einheiten`
  : marker.typ === 'fahrzeug' ? `/einsaetze/${einsatzId}/fahrzeuge`
  : marker.typ === 'fuehrung' ? `/einsaetze/${einsatzId}/personal`
  : marker.typ === 'abschnitt' ? `/einsaetze/${einsatzId}/einsatzabschnitte`
  : `/einsaetze/${einsatzId}/einsatzdaten`;
```
Typ-Label-Map analog erweitern.

- [ ] **Step 2: Symbol-Auswahl (Fachaufgabe + Org)**

Für taktische Typen (`einheit`/`fahrzeug`/`fuehrung`/`abschnitt`) zwei `Select` einblenden (nur wenn `darfSchreiben`):
- Fachaufgabe-`Select` mit den relevanten `FachaufgabeId`-Optionen (`rettungswesen`, `aerztliche-versorgung`, `betreuung`, `verpflegung`, `fuehrung`, `bergung`, `wasserrettung`; leer = Standard).
- Org-`Select` (Override) mit den `OrganisationId`-Optionen (leer = Org-Default).
Beide rufen einen neuen Prop `onSymbolAendern(marker, { tz_fachaufgabe?, tz_organisation? })` auf, der in `LagekartePage` den passenden Verorten-PATCH (ohne lat/lon) feuert und invalidiert. (Für `abschnitt`: `zeichneAbschnitt`-PATCH mit nur `tz_*`.)
> `Inspector` erhält dazu die aktuellen Symbol-Werte über den `marker` (TZ-Props) oder zusätzliche optionale Felder; minimal: aktuelle `tz_fachaufgabe`/`tz_organisation` als optionale Marker-Felder mitführen.

- [ ] **Step 3: Verortung-Löschen für taktische Punkte**

`onVerortungLoeschen` greift bereits; in `LagekartePage.loescheVerortung` die neuen Typen ergänzen (PATCH `{ lat:null, lon:null }` je Typ; für `abschnitt` `{ flaeche_geojson:null }`).

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/lagekarte/Inspector.tsx frontend/src/pages/LagekartePage.tsx
git commit -m "feat(fe): Inspector — Fach-Modul-Links + Symbol-Auswahl für taktische Objekte"
```

---

## Task 21: Frontend — Org-Default-Admin-Tab

**Files:**
- Create: `frontend/src/pages/stammdaten/OrganisationTab.tsx`, `OrganisationTab.test.tsx`
- Modify: `frontend/src/pages/StammdatenPage.tsx`

- [ ] **Step 1: Failing test**
```tsx
// OrganisationTab.test.tsx — Vorbild bestehende Stammdaten-Tab-Tests + MSW.
it('lädt Org-Default und speichert Änderung', async () => {
  let patched: unknown = null;
  server.use(
    http.get('/api/organisation', () => HttpResponse.json({ id: 1, name: 'DRK', tz_organisation: 'hilfsorganisation' })),
    http.patch('/api/organisation', async ({ request }) => { patched = await request.json(); return HttpResponse.json({ id:1, name:'DRK', tz_organisation:'feuerwehr' }); }),
  );
  renderTab();
  const select = await screen.findByLabelText('DV-102-Organisation');
  await userEvent.click(select);
  await userEvent.click(await screen.findByText('Feuerwehr'));
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(patched).toEqual({ tz_organisation: 'feuerwehr' }));
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && npx vitest run src/pages/stammdaten/OrganisationTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Tab implementieren**

`OrganisationTab.tsx`: `useQuery(['organisation'], ladeOrganisation)`, ein `Select` (Label „DV-102-Organisation") mit den `OrganisationId`-Optionen, `Speichern`-Button → `useMutation(setzeOrgDefault)` + `message.success`. Erklärtext: „Standard-Organisation für taktische Zeichen; pro Objekt überschreibbar."

- [ ] **Step 4: In StammdatenPage einhängen**

In `StammdatenPage.tsx` ein neues `items`-Element ergänzen:
```tsx
{ key: 'organisation', label: 'Organisation', children: <OrganisationTab /> },
```
(Import oben ergänzen.)

- [ ] **Step 5: Test grün**

Run: `cd frontend && npx vitest run src/pages/stammdaten/OrganisationTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/pages/stammdaten/OrganisationTab.tsx frontend/src/pages/stammdaten/OrganisationTab.test.tsx frontend/src/pages/StammdatenPage.tsx
git commit -m "feat(fe): Stammdaten-Tab für DV-102-Org-Default"
```

---

## Task 22: Frontend — LagekartePage-Integrationstests

**Files:** `frontend/src/pages/LagekartePage.test.tsx`

Der bestehende Test mockt `./lagekarte/Kartenflaeche` (Stub mit `karte-klick`-Button + `marker-<schluessel>`-Buttons) und `EventSource`. Diese Infrastruktur wiederverwenden. Den Stub um eine `flaeche-fertig`-Schaltfläche erweitern, die `props.onFlaecheGezeichnet?.({type:'Polygon',coordinates:[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]})` aufruft, und Buttons für `onFlaecheKlick`.

- [ ] **Step 1: MSW-Handler für neue Endpunkte**

Im `basisHandler`/Setup die neuen GETs ergänzen: `/api/einsaetze/1/einheiten`, `/fahrzeuge`, `/abschnitte`, `/karte/fuehrungskraefte`, `/api/organisation` (Default `hilfsorganisation`). Mindestens je ein verortetes + ein nicht-verortetes Objekt.

- [ ] **Step 2: Test — Layer-Toggles + Nicht-verortet-Liste**
```tsx
it('zeigt taktische Layer-Toggles und nicht-verortete taktische Objekte', async () => {
  basisHandler();
  renderSeite();
  expect(await screen.findByText('Einheiten')).toBeInTheDocument();   // Layer-Switch-Label
  expect(await screen.findByText(/Einheit: .*nicht verortet|Einheit:/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Test — Punkt platzieren (Einheit)**
```tsx
it('platziert eine Einheit: wählen → Karten-Klick → PATCH position', async () => {
  let body: unknown = null;
  basisHandler([ http.patch('/api/einsaetze/1/einheiten/2/position', async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }) ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByRole('button', { name: 'Platzieren' })); // Einheit #2 nicht verortet
  await user.click(await screen.findByText('karte-klick'));
  await waitFor(() => expect(body).toMatchObject({ lat: 50.1, lon: 8.6 }));
});
```

- [ ] **Step 4: Test — Polygon zeichnen (Abschnitt)**
```tsx
it('zeichnet Abschnittsfläche: Zeichnen starten → fertig → PATCH flaeche', async () => {
  let body: any = null;
  basisHandler([ http.patch('/api/einsaetze/1/abschnitte/3/flaeche', async ({ request }) => { body = await request.json(); return HttpResponse.json({}); }) ]);
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByRole('button', { name: 'Fläche zeichnen' }));
  await user.click(await screen.findByText('flaeche-fertig'));
  await waitFor(() => expect(JSON.parse(body.flaeche_geojson).type).toBe('Polygon'));
});
```

- [ ] **Step 5: Test — nur Führungskräfte als Personal-Zeichen**

Mock `/karte/fuehrungskraefte` mit einer Führungskraft (verortet) → Marker `marker-fuehrung-<id>` erscheint; normales Personal (nicht im Endpunkt) erzeugt keinen Marker.

- [ ] **Step 6: Test — Marker-Klick → Inspector + Modul-Link**
```tsx
it('Marker-Klick öffnet Inspector mit Modul-Link', async () => {
  basisHandler();
  const user = userEvent.setup();
  renderSeite();
  await user.click(await screen.findByText('marker-einheit-1'));
  expect(await screen.findByRole('button', { name: 'Im Fach-Modul öffnen' })).toBeInTheDocument();
});
```

- [ ] **Step 7: Tests grün**

Run: `cd frontend && npx vitest run src/pages/LagekartePage.test.tsx --no-file-parallelism`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add frontend/src/pages/LagekartePage.test.tsx
git commit -m "test(fe): L-2 Layer, Platzieren, Polygon, Führungskräfte, Inspector"
```

---

## Task 23: Voller Gate-Lauf + DV-102-Symbol-Rendering-Test

**Files:** `frontend/src/pages/lagekarte/taktischesZeichen.test.ts` (Render-Smoke ergänzen)

- [ ] **Step 1: DV-102-Render-Smoke** (echte Lib, kein Mock)

In `taktischesZeichen.test.ts` ergänzen: `erzeugeTaktischesZeichen(baueTzProps({...})).svg.render()` enthält `<svg` und ist nicht leer — pro Objekttyp einmal (Einheit/Fahrzeug/Führung/Abschnitt).
```ts
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-core';
it('erzeugt valides SVG je Objekttyp', () => {
  for (const objekttyp of ['einheit','fahrzeug','fuehrung','abschnitt'] as const) {
    const svg = erzeugeTaktischesZeichen(baueTzProps({ objekttyp, einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' })).svg.render();
    expect(svg).toContain('<svg');
  }
});
```
> Falls der Smoke unter jsdom an Font-/`document`-APIs stolpert: `skipFontRegistration: true` in die `erzeugeTaktischesZeichen`-Spec aufnehmen (Prop existiert in der Lib).

- [ ] **Step 2: Frontend-Gate** (sauberer Lauf, vgl. Memory zu Parallel-Timeouts)

Run: `cd frontend && npx vitest run --no-file-parallelism && npx tsc --noEmit && npx eslint src`
Expected: alle Tests grün, kein Typ-/Lint-Fehler.

- [ ] **Step 3: Backend-Gate**

Run: `rtk proxy cargo test -p lifeline-hub && rtk proxy cargo clippy --all-targets -- -D warnings`
Expected: alle Tests grün, kein Clippy-Fehler.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/lagekarte/taktischesZeichen.test.ts
git commit -m "test(fe): DV-102-SVG-Render-Smoke je Objekttyp"
```

---

## Task 24: Manuelle Verifikation + Progress

**Files:** `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: App starten + Smoke**

Über die `run`-Skill oder das Projekt-Startkommando: Einsatz öffnen → Lagekarte → eine Einheit platzieren, ein Fahrzeug platzieren (FMS-Ring sichtbar), eine Führungskraft platzieren, einen Abschnitt zeichnen. Zweiten Browser-Tab öffnen → Live-Aktualisierung prüfen. Org-Default in Stammdaten ändern → Symbol-Org ändert sich. Verifizieren, dass Verorten **keinen** ETB-Eintrag erzeugt (ETB-Modul prüfen).

- [ ] **Step 2: PROGRESS aktualisieren**

In `docs/superpowers/PROGRESS.md` unter „Teilprojekt 4 — Lage" L‑2 als DONE markieren (Stil der bestehenden L‑1-Zeile übernehmen).

- [ ] **Step 3: Commit**
```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs(progress): L-2 Taktische Gliederung als DONE markieren"
```

---

## Self-Review (gegen Spec geprüft)

- **Annahme 1 (vier Objekttypen platzierbar; Abschnitt = Fläche):** Tasks 2–5 (Daten), 6 (PATCH), 15/17 (Marker/Fläche), 19 (Flow). ✓
- **Annahme 2/3 (DV-102 via Lib, Org-Default + Fachaufgabe je Objekt, Override):** Task 11 (Mapping), 16 (Render), 20 (Auswahl), 7/21 (Org-Default). ✓
- **Annahme 4 (entity-gekoppelte Positionen, lat/lon paarweise, kein CHECK):** Task 1 (Migration), 2–5 (Repos), 6 (Geo-Paar-Validierung). ✓
- **Annahme 5 (kein ETB):** eigene Geo-Routen ohne ETB-Pfad (Task 6), Test in Task 9/Step 1. ✓
- **Annahme 6 (neue SSE-Kanäle):** Task 6 (Streams/Helfer), 8 (Publish in K&M), 14 (FE-Hooks). `person` wiederverwendet. ✓
- **Annahme 7 (manuell, kein Geocoding/GPS):** Punkt-Klick + Polygon-Zeichnen, kein Tracking. ✓
- **Symbol-Modell (Tabelle):** Grundzeichen/Größe abgeleitet (nicht gespeichert), `tz_fachaufgabe`/`tz_organisation` gespeichert, Org-Default — Task 11/1/7. FMS als Ring (Task 16, nicht ins Grundzeichen). ✓
- **Karten-Lesedaten:** bestehende Listen erweitert (Task 2–4); Führungskräfte dedizierter Pfad (Task 5); Storniertes/Aufgelöstes herausgefiltert (Task 9/Step 3). ✓
- **Berechtigung/Nachlauf + Org-Isolation:** `fordere_*` in allen Handlern; Org-Isolations-Test (Task 9/Step 4, bekannte `ist_hoehere_berechtigung`-Lücke bewusst out of scope). ✓
- **Frontend (Layer, kein Clustering, Inspector, Live):** Task 18 (Layer), 16/17 (Marker/Fläche, einzeln lesbar, kein Clustering), 20 (Inspector), 14/19 (Live). ✓
- **Plan-Spike Polygon-Lib:** aufgelöst → `terra-draw` + Adapter (maplibre-gl 5 kompatibel; mapbox-gl-draw verworfen). L‑3 nutzt dieselbe Mechanik. ✓
- **Tests:** Backend (Task 9) + Frontend (Task 22/23) decken die in der Spec gelisteten Fälle. ✓

**Offen gelassene Spec-Punkte — im Plan entschieden:** Führungskräfte-Lesepfad = dedizierter Endpunkt (Task 5); Org-Default-Pflege = `GET/PATCH /api/organisation` + Stammdaten-Tab (Task 7/21); Migration = `0035`; Polygon-Lib = terra-draw; Org-Isolations-Test = nur reguläre Isolation grün, bekannte höhere-Berechtigung-Lücke dokumentiert nicht gefixt.
