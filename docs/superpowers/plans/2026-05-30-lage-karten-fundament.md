# L‑1 Karten-Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine offline-fähige MapLibre-GL-Karte, die die bereits erfassten verortbaren Objekte (Einsatzort, UHS, Schäden) zeigt und per Klick verortbar macht — Koordinate direkt am Objekt, live über die bestehenden SSE-Kanäle.

**Architecture:** Geo-Spalten (`lat`/`lon REAL NULL`) werden entity-gekoppelt an `uhs` und `einsatz_schaden` angehängt (eine Wahrheit, kein Overlay-Layer). Verorten erweitert die bestehenden PATCH-Routen (lat/lon als Paar, Effektivzustand-Merge → 422). Eine konfigurierbare Basemap (lokale PMTiles-Datei per HTTP-Range **oder** Online-Style-URL, sonst Blind-Modus) wird über eine neue `KarteConfig` ausgeliefert. Das Frontend rendert mit MapLibre GL hinter einer dünnen, mockbaren `Kartenflaeche`-Komponente; die testbare Logik (Nicht-verortet-Liste, Platzieren→PATCH, Inspector, Basemap-Umschalter) lebt in Page/Pure-Functions. Der Einsatzort ist im Backend bereits voll verdrahtet (`einsatzort_lat/lon`, Migr. `0005`) — L‑1 liefert nur den Frontend-Picker dafür.

**Tech Stack:** Rust + Axum 0.8 + SQLite (sqlx 0.8), `tower-http` (fs, neu) für Range-Auslieferung; React 18 + Ant Design v5 + React-Query v5 + EventSource; `maplibre-gl` + `pmtiles` (neu); Vitest + @testing-library + MSW.

---

## Vorbemerkungen (vor Task 1 lesen)

**Gesetzte Entscheidungen dieses Plans** (aus Spec + Brainstorming, nicht neu verhandeln):

1. **Karten-Lesedaten = bestehende Listen-Endpunkte.** Sobald `lat`/`lon` in `UhsAnzeige`/`SchadenAnzeige` stehen, liefern `GET …/uhs` und `GET …/schaeden` alles, was die Karte braucht. **Kein** neuer Aggregat-Endpunkt (Spec erlaubt das für zwei Typen ausdrücklich). Der Einsatzort kommt aus `GET /api/einsaetze/{id}` (hat `einsatzort_lat/lon` schon).
2. **lat/lon als Paar.** Beide NULL = nicht verortet, beide gesetzt = verortet. „Nur eins gesetzt" ist nie ein gültiger Zustand: der PATCH prüft den **Effektivzustand** (Bestand + Request-Delta) und liefert **422** statt 500. Zusätzlich Range-Validierung (lat −90..90, lon −180..180 → 422).
3. **Verorten nur per PATCH.** `anlegen`/`NeueDaten` bleiben unverändert — neue UHS/Schäden entstehen ohne Koordinate in ihren Fach-Modulen und erscheinen auf der Karte unter „⚠ Nicht verortet".
4. **Live gratis durch Query-Key-Reuse.** Die Karte nutzt **exakt** die bestehenden Query-Keys `['einsatz-uhs', einsatzId]` und `['einsatz-schaeden', einsatzId]`. Dann invalidieren die bestehenden Hooks `useUhsStream`/`useSchaedenStream` die Karten-Caches mit — kein neuer SSE-Kanal.
5. **Basemap über `KarteConfig` + `Extension`-Layer.** `build_router(state)` delegiert an neues `build_router_mit_karte(state, KarteConfig::default())`. So bleiben alle ~24 bestehenden `AppState { pool, live }`-Test-Setups **unangetastet**. Die PMTiles-Datei wird mit `tower_http::services::ServeFile` (eine feste Datei, kein `ServeDir` → keine Path-Traversal-Fläche) ausgeliefert; fehlt der Pfad → 404-Stub.
6. **Drei Basemap-Styles, Vektor.** `online` = konfigurierte Style-URL (String). `offline` = handgeschriebener, theme-fähiger Vektor-Style über `pmtiles://` (Protomaps-Schema angenommen, **ohne Text-Layer → keine Glyphs nötig → voll offline**). `blind` = Background-only-Style (rendert immer; Marker + Koordinaten funktionieren weiter). Laufzeit-Default: online → offline → blind; bei Style-Ladefehler stuft die Page automatisch ab; manueller Umschalter zusätzlich.
7. **Test-Naht = eigene `Kartenflaeche`-Komponente, nicht `maplibre-gl` mocken.** jsdom hat kein WebGL. Alles Karten-Rendering liegt hinter `Kartenflaeche` (Props/Callbacks: `style`, `markers`, `onKarteKlick(lngLat)`, `onMarkerKlick(id)`, `flyToZiel`). Page-Tests mocken nur diese eine Komponente.
8. **Inspector-Modul-Links:** UHS → bestehende Item-Route `unfallhilfsstellen/{uhsId}`. Schaden hat **keine** Item-Route (Detail läuft über Drawer/Local-State) → Link auf `schaeden?schaden={id}`; `SchaedenPage` liest den Query-Param und öffnet den Drawer (kleiner Zusatz, Task B8).
9. **Einsatzort-Picker = Kopf-PATCH (Vollersatz).** `PATCH /api/einsaetze/{id}` ersetzt **alle** Kopffelder. Der Picker baut `KopfdatenUpdate` aus dem frisch geladenen Einsatz + neuer lat/lon. Der Kopf-PATCH feuert **kein** SSE → nach Erfolg `['einsatz', einsatzId]` invalidieren (anders als UHS/Schaden, die live sind).

**Test-Exit-Codes (Projekt-Konvention):** Der `rtk`-Hook maskiert Exit-Codes. Wo ein Schritt **Pass/Fail prüft**, das Kommando als `rtk proxy <cmd>` ausführen (z. B. `rtk proxy cargo test --test einsatz_uhs`), sonst greift das Gate nicht.

---

## File Structure

**Backend — neu:**
- `migrations/0034_lage_geo.sql` — vier `ADD COLUMN lat/lon REAL` (uhs + einsatz_schaden).
- `src/routes/karte.rs` — Basemap-Config-Endpoint (`/api/karte/config`) + 404-Stub für fehlende Tiles.
- `tests/karte.rs` — Basemap-Range-Auslieferung + Degradation + Config-Endpoint.

**Backend — geändert:**
- `src/uhs/mod.rs` — `UhsAnzeige`: `lat`/`lon`-Felder.
- `src/uhs/repo.rs` — `SELECT_ALLE` + `PatchDaten` + `aktualisiere` (lat/lon-Sentinels).
- `src/routes/einsatz_uhs.rs` — `PatchBody` + Handler (Paar-/Range-Check).
- `src/schaden/mod.rs` — `SchadenAnzeige`: `lat`/`lon`-Felder.
- `src/schaden/repo.rs` — `SELECT_ALLE` + `PatchDaten` + `aktualisiere`.
- `src/routes/einsatz_schaden.rs` — `PatchBody` + Handler.
- `src/config.rs` — `pmtiles_path` + `karte_online_style_url` CLI/ENV; `KarteConfig`-Struct.
- `src/app.rs` — `build_router_mit_karte` + Karte-Routen + Extension-Layer.
- `src/main.rs` — `KarteConfig` aus `Config` bauen, `build_router_mit_karte` aufrufen.
- `src/routes/mod.rs` — `pub mod karte;`.
- `Cargo.toml` — `tower-http = { version = "0.6", features = ["fs"] }`.
- `tests/einsatz_uhs.rs`, `tests/einsatz_schaden.rs` — Verorten-Tests.

**Frontend — neu (`frontend/src/`):**
- `api/karte.ts` — `ladeKarteConfig()` + `KarteServerConfig`-Typ.
- `pages/lagekarte/marker.ts` — Pure-Function `baueMarker(...)` (verortet / nicht-verortet).
- `pages/lagekarte/marker.test.ts`.
- `pages/lagekarte/basemapStil.ts` — `baueBasemapStyle`, `blindStyle`, `offlineStyle`, `defaultModus`.
- `pages/lagekarte/basemapStil.test.ts`.
- `pages/lagekarte/Kartenflaeche.tsx` — dünner MapLibre-Wrapper (einzige Stelle mit maplibre/pmtiles-Import).
- `pages/lagekarte/Sidebar.tsx` — Nicht-verortet-Sektion, Gruppen, Layer-Toggles, Basemap-Umschalter.
- `pages/lagekarte/Inspector.tsx` — Marker-Info + Modul-Link.
- `pages/LagekartePage.tsx` — Orchestrierung.
- `pages/LagekartePage.test.tsx` — vier Spec-Szenarien (Kartenflaeche gemockt).

**Frontend — geändert:**
- `api/types.ts` — `Uhs`/`Schaden`: `lat`/`lon`; (Patch-Typen liegen in den API-Modulen).
- `api/einsatzUhs.ts` — `UhsPatch`: `lat`/`lon`.
- `api/einsatzSchaden.ts` — `SchadenPatch`: `lat`/`lon`.
- `einsatz/modulRegistry.ts` — `lagekarte` von `geplant` auf `fertig`.
- `App.tsx` — `lagekarte: <LagekartePage />` in `MODUL_ELEMENTE`.
- `pages/SchaedenPage.tsx` — `?schaden=`-Deep-Link (Drawer öffnen).
- `package.json` — `maplibre-gl`, `pmtiles`.

---

# Phase A — Backend (Geo-Spalten, Verorten-PATCH, Basemap)

## Task A1: Migration + Geo-Felder in beiden Anzeige-Structs

Geo-Spalten anlegen und sie in den Lese-DTOs sichtbar machen. Reiner Additiv-Schritt — danach liefern die Listen `lat: null, lon: null`, alle bestehenden Tests bleiben grün.

> Vorab geprüft: `UhsAnzeige`/`SchadenAnzeige` werden **nirgends** als Struct-Literal konstruiert (`grep -rn "UhsAnzeige {" "SchadenAnzeige {" src/ tests/` zeigt nur die Definitionen) — sie entstehen nur via `sqlx::FromRow` aus `SELECT_ALLE`. Das Hinzufügen von Feldern bricht daher keine Konstruktion; einzige Voraussetzung ist, dass die Spalten in `SELECT_ALLE` stehen (Steps 3 + 5).

**Files:**
- Create: `migrations/0034_lage_geo.sql`
- Modify: `src/uhs/mod.rs` (UhsAnzeige, ~Zeile 202–218)
- Modify: `src/uhs/repo.rs` (SELECT_ALLE, Zeile 5–8)
- Modify: `src/schaden/mod.rs` (SchadenAnzeige, ~Zeile 164–194)
- Modify: `src/schaden/repo.rs` (SELECT_ALLE, Zeile 5–21)

- [ ] **Step 1: Migration schreiben**

Create `migrations/0034_lage_geo.sql`:

```sql
-- L‑1 Karten-Fundament: Geo-Koordinaten direkt am Objekt (entity-gekoppelt).
-- Beide NULL = nicht verortet, beide gesetzt = verortet. Kein Mehrspalten-CHECK
-- (folgt dem Einsatzort-Vorbild aus 0005); die App behandelt lat/lon als Paar.
-- Freitext standort/ort bleibt unverändert erhalten.
ALTER TABLE uhs             ADD COLUMN lat REAL;
ALTER TABLE uhs             ADD COLUMN lon REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lat REAL;
ALTER TABLE einsatz_schaden ADD COLUMN lon REAL;
```

- [ ] **Step 2: `UhsAnzeige` um lat/lon erweitern**

In `src/uhs/mod.rs`, im Struct `UhsAnzeige` direkt vor `pub status: String,` einfügen:

```rust
    pub lat: Option<f64>,
    pub lon: Option<f64>,
```

(`sqlx::FromRow` matcht nach Spaltenname, nicht nach Position — die Reihenfolge ist frei, aber jedes Feld braucht eine Spalte in `SELECT_ALLE`.)

- [ ] **Step 3: UHS `SELECT_ALLE` um lat/lon erweitern**

In `src/uhs/repo.rs`, `SELECT_ALLE` (Zeile 5–8) ersetzen durch:

```rust
const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, status, \
           lat, lon, \
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at \
    FROM uhs";
```

- [ ] **Step 4: `SchadenAnzeige` um lat/lon erweitern**

In `src/schaden/mod.rs`, im Struct `SchadenAnzeige` direkt nach `pub ort: String,` einfügen:

```rust
    pub lat: Option<f64>,
    pub lon: Option<f64>,
```

- [ ] **Step 5: Schaden `SELECT_ALLE` um lat/lon erweitern**

In `src/schaden/repo.rs`, in `SELECT_ALLE` (Zeile 5–21) die `s.ort,`-Zeile ergänzen um `s.lat, s.lon`:

```rust
const SELECT_ALLE: &str = "\
    SELECT s.id, s.einsatz_id, s.registrier_nr, s.status, s.typ, s.ausmass, s.ort, \
           s.lat, s.lon, \
           s.beschreibung, s.geschaedigt_person_id, s.geschaedigt_kontakt, \
           s.geschaedigt_personal_id, s.geschaedigt_organisation_id, \
           s.uebergeben_an, s.uebergeben_at, s.abschluss_grund, s.abschluss_at, \
           s.erfasst_at, s.erfasst_von, s.geaendert_at, s.geaendert_von, \
           s.storniert_at, s.storniert_von, \
           gp.registrier_nr AS geschaedigt_registrier_nr, \
           gp.storniert_at  AS geschaedigt_storniert_at, \
           gpe.snap_name    AS geschaedigt_personal_name, \
           go.name          AS geschaedigt_organisation_name \
    FROM einsatz_schaden s \
    LEFT JOIN einsatz_person gp ON gp.id = s.geschaedigt_person_id \
                               AND gp.einsatz_id = s.einsatz_id \
    LEFT JOIN einsatz_personal gpe ON gpe.id = s.geschaedigt_personal_id \
                                  AND gpe.einsatz_id = s.einsatz_id \
    LEFT JOIN organisation     go  ON go.id  = s.geschaedigt_organisation_id";
```

- [ ] **Step 6: Build + gesamte Test-Suite grün**

Run: `rtk proxy cargo test`
Expected: PASS — kompiliert, alle bestehenden Tests grün. (Die DB-Migration läuft beim Test-Setup; `query_as` findet die neuen Spalten, weil sie in `SELECT_ALLE` stehen.)

- [ ] **Step 7: Commit**

```bash
git add migrations/0034_lage_geo.sql src/uhs/mod.rs src/uhs/repo.rs src/schaden/mod.rs src/schaden/repo.rs
git commit -m "feat(be): Geo-Spalten lat/lon auf UHS und Schäden (L‑1 Fundament)"
```

---

## Task A2: UHS verorten — PATCH nimmt lat/lon (Paar + Range, 422)

**Files:**
- Modify: `src/uhs/repo.rs` (PatchDaten Zeile 22–28; aktualisiere Zeile 100–142)
- Modify: `src/routes/einsatz_uhs.rs` (PatchBody Zeile 201–211; aktualisieren Zeile 213–257)
- Test: `tests/einsatz_uhs.rs`

- [ ] **Step 1: Failing Tests schreiben**

In `tests/einsatz_uhs.rs` ans Dateiende anhängen. (Helfer `setup_mit_pool`, `login_cookie`, `einsatz_anlegen`, `json_request` existieren bereits in der Datei.)

```rust
#[tokio::test]
async fn verorten_setzt_lat_lon_und_liste_liefert_sie() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    // UHS anlegen:
    let (s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    assert_eq!(s, StatusCode::CREATED);
    let uhs_id = v["id"].as_i64().unwrap();

    // Verorten:
    let (s, v) = json_request(
        &app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1, "lon": 8.6})),
    ).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["lat"].as_f64(), Some(50.1));
    assert_eq!(v["lon"].as_f64(), Some(8.6));

    // Liste liefert die Koordinate mit:
    let (s, liste) = json_request(
        &app, "GET", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie, None,
    ).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste[0]["lat"].as_f64(), Some(50.1));
}

#[tokio::test]
async fn verorten_loeschen_setzt_beide_auf_null() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1, "lon": 8.6}))).await;
    // Beide explizit auf null:
    let (s, v) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": null, "lon": null}))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["lat"].is_null());
    assert!(v["lon"].is_null());
}

#[tokio::test]
async fn verorten_nur_lat_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    // Nur lat im leeren Effektivzustand → unvollständiges Paar:
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 50.1}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn verorten_ausserhalb_range_ist_422() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let (_s, v) = json_request(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/uhs"), &cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "BHP 50"})),
    ).await;
    let uhs_id = v["id"].as_i64().unwrap();
    let (s, _) = json_request(&app, "PATCH", &format!("/api/einsaetze/{einsatz}/uhs/{uhs_id}"), &cookie,
        Some(&json!({"lat": 99.0, "lon": 8.6}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `rtk proxy cargo test --test einsatz_uhs verorten`
Expected: FAIL — `lat`/`lon` werden ignoriert (`v["lat"]` ist null) bzw. der 422-Pfad existiert nicht.

- [ ] **Step 3: `PatchDaten` (Repo) um lat/lon erweitern**

In `src/uhs/repo.rs`, im Struct `PatchDaten` (Zeile 22–28) nach `pub notiz` einfügen:

```rust
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
```

- [ ] **Step 4: UHS `aktualisiere` SQL + Bindings (lat/lon-Sentinels)**

In `src/uhs/repo.rs`, die `aktualisiere`-Funktion (Zeile 100–142) — den `sqlx::query(...)`-Block und die Bindings — komplett ersetzen durch (die Positionsparameter ?8–?14 sind neu nummeriert):

```rust
    let ergebnis = sqlx::query(
        "UPDATE uhs \
         SET bezeichnung = COALESCE(?1, bezeichnung), \
             abschnitt_id = CASE WHEN ?2 IS NULL THEN abschnitt_id ELSE ?3 END, \
             standort = CASE WHEN ?4 IS NULL THEN standort ELSE ?5 END, \
             notiz = CASE WHEN ?6 IS NULL THEN notiz ELSE ?7 END, \
             lat = CASE WHEN ?8 IS NULL THEN lat ELSE ?9 END, \
             lon = CASE WHEN ?10 IS NULL THEN lon ELSE ?11 END, \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ?12 \
         WHERE id = ?13 AND einsatz_id = ?14",
    )
    // ?1 = bezeichnung (COALESCE: None = keep existing)
    .bind(daten.bezeichnung)
    // ?2 = abschnitt_id sentinel (Some(_) → 1, None → NULL), ?3 = new value
    .bind(daten.abschnitt_id.map(|_| 1_i64))
    .bind(daten.abschnitt_id.and_then(|v| v))
    // ?4 = standort sentinel, ?5 = new value
    .bind(daten.standort.map(|_| 1_i64))
    .bind(daten.standort.and_then(|v| v))
    // ?6 = notiz sentinel, ?7 = new value
    .bind(daten.notiz.map(|_| 1_i64))
    .bind(daten.notiz.and_then(|v| v))
    // ?8 = lat sentinel, ?9 = new value
    .bind(daten.lat.map(|_| 1_i64))
    .bind(daten.lat.and_then(|v| v))
    // ?10 = lon sentinel, ?11 = new value
    .bind(daten.lon.map(|_| 1_i64))
    .bind(daten.lon.and_then(|v| v))
    // ?12 = geaendert_von, ?13 = id, ?14 = einsatz_id
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(pool)
    .await;
```

(Der `match ergebnis { ... }`-Block darunter bleibt unverändert.)

- [ ] **Step 5: `PatchBody` (Route) um lat/lon erweitern**

In `src/routes/einsatz_uhs.rs`, im Struct `PatchBody` (Zeile 201–211) nach `pub notiz` einfügen:

```rust
    /// lat/lon werden als Paar behandelt (Effektivzustand-Check im Handler). `Some(null)` = löschen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
```

- [ ] **Step 6: Handler — vorher laden, Paar- + Range-Check, durchreichen**

In `src/routes/einsatz_uhs.rs`, in `aktualisieren` direkt **nach** `fordere_aktiv(&einsatz)?;` (nach Zeile 223) einfügen:

```rust
    // lat/lon als Paar: Effektivzustand nach dem Patch prüfen (422 statt 500).
    let vorher = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?; // 404 falls fremd
    let eff_lat = match body.lat { Some(opt) => opt, None => vorher.lat };
    let eff_lon = match body.lon { Some(opt) => opt, None => vorher.lon };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity("lat muss zwischen -90 und 90 liegen".into()));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity("lon muss zwischen -180 und 180 liegen".into()));
        }
    }
```

Und im `PatchDaten { ... }`-Konstruktor (Zeile 247–252) nach `notiz: ...` ergänzen:

```rust
            lat: body.lat,
            lon: body.lon,
```

- [ ] **Step 7: Tests grün**

Run: `rtk proxy cargo test --test einsatz_uhs`
Expected: PASS — alle vier neuen Tests + alle bestehenden UHS-Tests grün.

- [ ] **Step 8: Commit**

```bash
git add src/uhs/repo.rs src/routes/einsatz_uhs.rs tests/einsatz_uhs.rs
git commit -m "feat(be): UHS verorten — PATCH nimmt lat/lon als Paar (422 bei Teilpaar/Range)"
```

---

## Task A3: Schaden verorten — PATCH nimmt lat/lon (Paar + Range, 422)

**Files:**
- Modify: `src/schaden/repo.rs` (PatchDaten Zeile 35–48; aktualisiere Zeile 120–169)
- Modify: `src/routes/einsatz_schaden.rs` (PatchBody Zeile 233–251; aktualisieren Zeile 253–380)
- Test: `tests/einsatz_schaden.rs`

- [ ] **Step 1: Failing Tests schreiben**

In `tests/einsatz_schaden.rs` ans Dateiende anhängen. (Helfer `setup`, `login_cookie`, `einsatz_anlegen`, `schaden_anlegen`, `gueltig`, `anfrage` existieren in der Datei.)

```rust
#[tokio::test]
async fn schaden_verorten_setzt_lat_lon() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, v) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0, "lon": 7.0}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["lat"].as_f64(), Some(51.0));
    assert_eq!(v["lon"].as_f64(), Some(7.0));
}

#[tokio::test]
async fn schaden_verorten_nur_lon_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    let (s, _) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lon": 7.0}))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "darf 422 sein, NICHT 500");
}

#[tokio::test]
async fn schaden_verorten_loeschen_setzt_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = schaden_anlegen(&app, &admin, e, &gueltig()).await;
    anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": 51.0, "lon": 7.0}))).await;
    let (s, v) = anfrage(&app, "PATCH", &format!("/api/einsaetze/{e}/schaeden/{sid}"), &admin,
        Some(&json!({"lat": null, "lon": null}))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(v["lat"].is_null());
    assert!(v["lon"].is_null());
}
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `rtk proxy cargo test --test einsatz_schaden verorten`
Expected: FAIL — lat/lon werden ignoriert / 422-Pfad fehlt.

- [ ] **Step 3: `PatchDaten` (Repo) um lat/lon erweitern**

In `src/schaden/repo.rs`, im Struct `PatchDaten` (Zeile 35–48) nach `pub abschluss_grund: Option<Option<&'a str>>,` einfügen:

```rust
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
```

- [ ] **Step 4: Schaden `aktualisiere` SQL + Bindings (lat/lon, Boolean-Sentinel-Stil)**

In `src/schaden/repo.rs`, in `aktualisiere` (Zeile 127–162) den SQL-String erweitern: nach der `abschluss_grund = CASE ... END,`-Zeile (Zeile 138) zwei Zeilen einfügen:

```rust
            lat = CASE WHEN ? THEN ? ELSE lat END, \
            lon = CASE WHEN ? THEN ? ELSE lon END, \
```

Und in der Binding-Kette direkt **nach** den beiden `abschluss_grund`-Bindings (nach Zeile 158, vor `.bind(geaendert_von)`) einfügen:

```rust
    .bind(daten.lat.is_some())
    .bind(daten.lat.flatten())
    .bind(daten.lon.is_some())
    .bind(daten.lon.flatten())
```

(Bindings sind positionell — die `lat/lon`-Paare müssen exakt an der Stelle der neuen `CASE`-Klauseln stehen: nach `abschluss_grund`, vor `geaendert_von`.)

- [ ] **Step 5: `PatchBody` (Route) um lat/lon erweitern**

In `src/routes/einsatz_schaden.rs`, im Struct `PatchBody` (Zeile 233–251) nach `pub abschluss_grund` einfügen:

```rust
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
```

- [ ] **Step 6: Handler — Paar- + Range-Check, durchreichen**

In `src/routes/einsatz_schaden.rs`, in `aktualisieren` direkt **nach** dem `if vorher.storniert_at.is_some() { ... }`-Block (nach Zeile 267) einfügen (`vorher` ist hier schon geladen):

```rust
    // lat/lon als Paar: Effektivzustand nach dem Patch prüfen (422 statt 500).
    let eff_lat = match body.lat { Some(opt) => opt, None => vorher.lat };
    let eff_lon = match body.lon { Some(opt) => opt, None => vorher.lon };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity("lat muss zwischen -90 und 90 liegen".into()));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity("lon muss zwischen -180 und 180 liegen".into()));
        }
    }
```

Und im `schaden_repo::PatchDaten { ... }`-Konstruktor (Zeile 363–373) nach `abschluss_grund: ...` ergänzen:

```rust
            lat: body.lat,
            lon: body.lon,
```

- [ ] **Step 7: Tests grün**

Run: `rtk proxy cargo test --test einsatz_schaden`
Expected: PASS — neue + bestehende Schaden-Tests grün.

- [ ] **Step 8: Commit**

```bash
git add src/schaden/repo.rs src/routes/einsatz_schaden.rs tests/einsatz_schaden.rs
git commit -m "feat(be): Schaden verorten — PATCH nimmt lat/lon als Paar (422 bei Teilpaar/Range)"
```

---

## Task A4: Konfiguration für Basemap (PMTiles-Pfad + Online-Style-URL)

**Files:**
- Modify: `Cargo.toml` (dependencies)
- Modify: `src/config.rs` (Config-Felder + KarteConfig-Struct)

- [ ] **Step 1: `tower-http` als Dependency**

In `Cargo.toml`, in `[dependencies]` nach `rust-embed = "8"` einfügen:

```toml
tower-http = { version = "0.6", features = ["fs"] }
```

- [ ] **Step 2: Config-Felder für CLI/ENV**

In `src/config.rs`, im Struct `Config` direkt vor `#[command(subcommand)]` (Zeile 53) einfügen:

```rust
    /// Pfad zur lokalen PMTiles-Basemap (Offline-Karte). Fehlt er, gibt es keinen
    /// Offline-Tile-Service; das Frontend nutzt dann Online-URL oder Blind-Modus.
    #[arg(long, env = "LIFELINE_PMTILES_PATH")]
    pub pmtiles_path: Option<String>,

    /// Online-Style-URL (MapLibre-Style-JSON), bevorzugt wenn das Netz erreichbar ist.
    #[arg(long, env = "LIFELINE_KARTE_STYLE_URL")]
    pub karte_online_style_url: Option<String>,
```

- [ ] **Step 3: `KarteConfig`-Struct (zur Laufzeit an den Router gereicht)**

In `src/config.rs`, nach dem `impl GeheimesPasswort { ... }`-Block (nach Zeile 26) einfügen:

```rust
/// Karten-/Basemap-Konfiguration, die zur Laufzeit an die Karte-Routen geht.
/// `Default` (alles `None`) → kein Tile-Service, Frontend geht in den Blind-Modus.
#[derive(Clone, Debug, Default)]
pub struct KarteConfig {
    pub pmtiles_path: Option<String>,
    pub online_style_url: Option<String>,
}
```

- [ ] **Step 4: Config-Test ergänzen**

In `src/config.rs`, im `mod tests`-Block einen Test anhängen:

```rust
    #[test]
    fn karte_flags_werden_geparst() {
        let config = Config::parse_from([
            "lifeline-hub",
            "--pmtiles-path", "/data/de.pmtiles",
            "--karte-online-style-url", "https://tiles.example/style.json",
        ]);
        assert_eq!(config.pmtiles_path.as_deref(), Some("/data/de.pmtiles"));
        assert_eq!(
            config.karte_online_style_url.as_deref(),
            Some("https://tiles.example/style.json")
        );
    }
```

- [ ] **Step 5: Build + Config-Tests grün**

Run: `rtk proxy cargo test --lib config`
Expected: PASS — `karte_flags_werden_geparst` + bestehende Config-Tests grün, `tower-http` lädt.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock src/config.rs
git commit -m "feat(be): Config für Basemap (PMTiles-Pfad + Online-Style-URL) + KarteConfig"
```

---

## Task A5: Basemap-Routen — Config-Endpoint + PMTiles-Range-Auslieferung

**Files:**
- Create: `src/routes/karte.rs`
- Modify: `src/routes/mod.rs` (Modul-Deklaration)
- Modify: `src/app.rs` (build_router_mit_karte)
- Modify: `src/main.rs` (KarteConfig bauen + aufrufen)
- Create: `tests/karte.rs`

- [ ] **Step 1: Failing Test schreiben**

Create `tests/karte.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use lifeline_hub::app::{build_router, build_router_mit_karte, AppState};
use lifeline_hub::config::KarteConfig;
use lifeline_hub::live::LiveHub;
use std::io::Write;
use tower::ServiceExt; // oneshot

async fn pool() -> sqlx::SqlitePool {
    // db::test_pool() liefert einen bereits migrierten Test-Pool — genau das Muster
    // aller tests/*.rs (z. B. tests/einsatz_schaden.rs `setup_mit_pool`). NICHT
    // db::connect(":memory:") nutzen: ein :memory:-Pool gibt jeder Connection eine
    // eigene leere DB. Die Karte-Routen lesen die DB ohnehin nicht — der Pool wird
    // nur gebraucht, weil AppState einen verlangt.
    lifeline_hub::db::test_pool().await
}

#[tokio::test]
async fn tiles_route_liefert_range_aus() {
    let pool = pool().await;
    // Temp-PMTiles-Datei mit bekanntem Inhalt:
    let mut datei = tempfile::NamedTempFile::new().unwrap();
    datei.write_all(b"PMTILESDATA0123456789").unwrap();
    let pfad = datei.path().to_string_lossy().to_string();

    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new() },
        KarteConfig { pmtiles_path: Some(pfad), online_style_url: None },
    );

    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .header("Range", "bytes=0-7")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT); // 206
    let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&bytes[..], b"PMTILESD");
}

#[tokio::test]
async fn tiles_route_404_ohne_konfigurierten_pfad() {
    let pool = pool().await;
    let app = build_router(AppState { pool, live: LiveHub::new() }); // Default-KarteConfig
    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn config_endpoint_meldet_verfuegbarkeit() {
    let pool = pool().await;
    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new() },
        KarteConfig {
            pmtiles_path: Some("/irrelevant.pmtiles".into()),
            online_style_url: Some("https://tiles.example/style.json".into()),
        },
    );
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(true));
    assert_eq!(v["pmtiles_url"].as_str(), Some("/api/karte/tiles.pmtiles"));
    assert_eq!(v["online_style_url"].as_str(), Some("https://tiles.example/style.json"));
}
```

> Hinweis: `db::test_pool()` ist der bestehende Test-Pool-Helfer (in `src/db.rs`, von allen `tests/*.rs` genutzt) und migriert selbst. `tempfile` ist `[dependency]` (kein Dev-Only) → die `NamedTempFile` für die PMTiles-Datei ist in Tests verfügbar.

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen (Kompilierfehler)**

Run: `rtk proxy cargo test --test karte`
Expected: FAIL — `build_router_mit_karte`, `KarteConfig`-Re-Export und die Routen existieren noch nicht.

- [ ] **Step 3: Karte-Route-Modul schreiben**

Create `src/routes/karte.rs`:

```rust
use crate::config::KarteConfig;
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Serialize;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit
/// braucht — NICHT den Server-Dateipfad der PMTiles-Datei.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_style_url: Option<String>,
    pub pmtiles_verfuegbar: bool,
    /// Relative URL des Tile-Endpoints, wenn eine PMTiles-Datei konfiguriert ist.
    pub pmtiles_url: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend.
pub async fn config(Extension(karte): Extension<KarteConfig>) -> Json<KarteConfigAntwort> {
    let pmtiles_verfuegbar = karte.pmtiles_path.is_some();
    Json(KarteConfigAntwort {
        online_style_url: karte.online_style_url.clone(),
        pmtiles_verfuegbar,
        pmtiles_url: pmtiles_verfuegbar.then(|| "/api/karte/tiles.pmtiles".to_string()),
    })
}

/// Fallback für `/api/karte/tiles.pmtiles`, wenn keine Datei konfiguriert ist → 404.
/// Das Frontend wertet das als „kein Offline-Tile-Service" und geht in den Blind-Modus.
pub async fn tiles_fehlt() -> StatusCode {
    StatusCode::NOT_FOUND
}
```

- [ ] **Step 4: Modul registrieren**

In `src/routes/mod.rs` die Zeile `pub mod karte;` in alphabetischer Position einfügen (z. B. nach `pub mod health;` bzw. wo es in die bestehende `pub mod …;`-Liste passt).

- [ ] **Step 5: `build_router_mit_karte` in `src/app.rs`**

In `src/app.rs` die Imports oben ergänzen:

```rust
use crate::config::KarteConfig;
use axum::Extension;
use tower_http::services::ServeFile;
```

**Kontext (so endet `src/app.rs` heute, Zeile ~193–202):** die Routen-Kette schließt mit `…material_freigeben));`, danach folgt ein `#[cfg(feature = "dev-seeds")]`-Rebind von `router`, dann der finale Abschluss. Es gibt **keine** bestehenden `.layer(...)`-Aufrufe:

```rust
        .route("/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}", delete(routes::einsatz_einheit::material_freigeben));

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    router
        .fallback(crate::static_files::serve)
        .with_state(state)
}
```

Drei Edits:

1. **Delegator** direkt **vor** die bestehende Funktion `build_router` setzen:

```rust
/// Baut den Router mit Default-Karte (keine Basemap konfiguriert → Blind-Modus).
/// Bestehende Aufrufer und Tests bleiben unverändert.
pub fn build_router(state: AppState) -> Router {
    build_router_mit_karte(state, KarteConfig::default())
}
```

2. Die **bestehende** Signaturzeile `pub fn build_router(state: AppState) -> Router {` (Zeile 17) umbenennen in:

```rust
/// Baut den Axum-Router mit allen Routen, dem geteilten Zustand und der Basemap.
pub fn build_router_mit_karte(state: AppState, karte: KarteConfig) -> Router {
```

3. Den finalen Abschluss (exakt die letzten vier Zeilen oben) **ersetzen** — also `    router\n        .fallback(crate::static_files::serve)\n        .with_state(state)\n}` durch:

```rust
    let router = router.route("/api/karte/config", get(routes::karte::config));

    // PMTiles-Tile-Service: nur mounten, wenn eine Datei konfiguriert ist.
    // ServeFile (eine feste Datei, kein ServeDir) beherrscht HTTP-Range nativ.
    let router = match &karte.pmtiles_path {
        Some(pfad) => router.route_service("/api/karte/tiles.pmtiles", ServeFile::new(pfad)),
        None => router.route("/api/karte/tiles.pmtiles", get(routes::karte::tiles_fehlt)),
    };

    router
        .layer(Extension(karte))
        .fallback(crate::static_files::serve)
        .with_state(state)
}
```

> Der `#[cfg(feature = "dev-seeds")]`-Rebind bleibt **unverändert** zwischen der Routen-Kette und diesem neuen Block stehen — `router` ist davor wie danach dieselbe gebundene Variable, das `let router = router.route(...)` für `/api/karte/config` knüpft sauber daran an.

- [ ] **Step 6: `main.rs` — KarteConfig bauen und übergeben**

In `src/main.rs`:

Import (Zeile 2) erweitern:

```rust
use lifeline_hub::app::{build_router_mit_karte, AppState};
```

Und den `build_router(...)`-Aufruf (Zeile 68–71) ersetzen durch:

```rust
    let karte = lifeline_hub::config::KarteConfig {
        pmtiles_path: config.pmtiles_path.clone(),
        online_style_url: config.karte_online_style_url.clone(),
    };
    let app = build_router_mit_karte(
        AppState {
            pool,
            live: LiveHub::new(),
        },
        karte,
    );
```

- [ ] **Step 7: Tests grün (Karte + Gesamt-Suite)**

Run: `rtk proxy cargo test --test karte` dann `rtk proxy cargo test`
Expected: PASS — Karte-Tests grün, alle bestehenden Tests (die `build_router` nutzen) weiterhin grün.

- [ ] **Step 8: Commit**

```bash
git add src/routes/karte.rs src/routes/mod.rs src/app.rs src/main.rs tests/karte.rs
git commit -m "feat(be): Basemap-Routen — /api/karte/config + PMTiles per HTTP-Range (ServeFile)"
```

---

# Phase B — Frontend (Lagekarte)

> **Vor Phase B:** Backend ist gemerged/lauffähig. Frontend-Arbeitsverzeichnis ist `frontend/`. Build/Test: `pnpm test` bzw. `pnpm run build` (siehe `package.json`-Scripts). Wo Pass/Fail zählt: `rtk proxy pnpm test`.

## Task B1: Dependencies + TS-Typen (lat/lon) + Karte-API

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/api/types.ts` (Uhs, Schaden)
- Modify: `frontend/src/api/einsatzUhs.ts` (UhsPatch)
- Modify: `frontend/src/api/einsatzSchaden.ts` (SchadenPatch)
- Create: `frontend/src/api/karte.ts`

- [ ] **Step 1: MapLibre + PMTiles installieren**

Run (im `frontend/`-Verzeichnis):

```bash
pnpm add maplibre-gl pmtiles
```

Expected: `maplibre-gl` und `pmtiles` erscheinen in `package.json` → `dependencies`.

- [ ] **Step 2: `Uhs`- und `Schaden`-Typ um lat/lon erweitern**

In `frontend/src/api/types.ts`, im Interface `Uhs` nach `notiz: string | null;` (Zeile 434) einfügen:

```ts
  lat: number | null;
  lon: number | null;
```

Und im Interface `Schaden` nach `ort: string;` (Zeile 495) einfügen:

```ts
  lat: number | null;
  lon: number | null;
```

- [ ] **Step 3: `UhsPatch` um lat/lon erweitern**

In `frontend/src/api/einsatzUhs.ts`, im Interface `UhsPatch` (Zeile 33–39) nach `notiz?: string | null;` einfügen:

```ts
  /** lat/lon werden gemeinsam gesendet (beide Zahl = setzen, beide null = löschen). */
  lat?: number | null;
  lon?: number | null;
```

(`aktualisiereUhs` reicht das Patch-Objekt unverändert durch — keine weitere Änderung nötig.)

- [ ] **Step 4: `SchadenPatch` um lat/lon erweitern**

In `frontend/src/api/einsatzSchaden.ts`, im Interface `SchadenPatch` (Zeile 18–29) nach `abschluss_grund?: string | null;` einfügen:

```ts
  lat?: number | null;
  lon?: number | null;
```

- [ ] **Step 5: Karte-API-Modul**

Create `frontend/src/api/karte.ts`:

```ts
import { apiGet } from './client';

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss. */
export interface KarteServerConfig {
  online_style_url: string | null;
  pmtiles_verfuegbar: boolean;
  pmtiles_url: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
```

- [ ] **Step 6: Typecheck grün**

Run: `rtk proxy pnpm run build`
Expected: PASS — TypeScript kompiliert (neue optionale Felder brechen nichts).

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/api/types.ts frontend/src/api/einsatzUhs.ts frontend/src/api/einsatzSchaden.ts frontend/src/api/karte.ts
git commit -m "feat(fe): maplibre-gl/pmtiles-Deps, lat/lon-Typen, Karte-Config-API"
```

---

## Task B2: Marker-Builder (Pure Function) + Test

Die testbare Kernlogik: aus Einsatz + UHS-Liste + Schaden-Liste die verorteten Marker und die „Nicht verortet"-Liste ableiten.

**Files:**
- Create: `frontend/src/pages/lagekarte/marker.ts`
- Create: `frontend/src/pages/lagekarte/marker.test.ts`

- [ ] **Step 1: Failing Test schreiben**

Create `frontend/src/pages/lagekarte/marker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baueMarker } from './marker';
import type { EinsatzAnzeige, Schaden, Uhs } from '../../api/types';

function uhs(partial: Partial<Uhs>): Uhs {
  return {
    id: 1, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz',
    bezeichnung: 'BHP 50', standort: null, notiz: null, status: 'aktiv',
    lat: null, lon: null, erfasst_at: '', erfasst_von: 1, geaendert_at: '',
    geaendert_von: 1, storniert_at: null, ...partial,
  };
}
function schaden(partial: Partial<Schaden>): Schaden {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 7, status: 'offen', typ: 'sachschaden',
    ausmass: 'gross', ort: 'Hauptstr.', lat: null, lon: null, beschreibung: '',
    geschaedigt_person_id: null, geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
    uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null,
    erfasst_at: '', erfasst_von: 1, geaendert_at: '', geaendert_von: 1,
    storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
    geschaedigt_storniert_at: null, geschaedigt_personal_name: null,
    geschaedigt_organisation_name: null, ...partial,
  };
}

describe('baueMarker', () => {
  it('trennt verortete von nicht-verorteten Objekten', () => {
    const einsatz = { einsatzort: 'ELW', einsatzort_lat: 50, einsatzort_lon: 8 } as EinsatzAnzeige;
    const { verortet, nichtVerortet } = baueMarker(
      einsatz,
      [uhs({ id: 5, lat: 50.1, lon: 8.1 }), uhs({ id: 6, bezeichnung: 'PA', lat: null, lon: null })],
      [schaden({ id: 9, registrier_nr: 3, lat: 51, lon: 7 }), schaden({ id: 10, registrier_nr: 4 })],
    );
    expect(verortet.map((m) => m.schluessel)).toEqual(['einsatzort', 'uhs-5', 'schaden-9']);
    expect(nichtVerortet).toEqual([
      { typ: 'uhs', id: 6, label: 'PA' },
      { typ: 'schaden', id: 10, label: 'S-004' },
    ]);
  });

  it('lässt den Einsatzort weg, wenn er keine Koordinate hat', () => {
    const einsatz = { einsatzort: null, einsatzort_lat: null, einsatzort_lon: null } as EinsatzAnzeige;
    const { verortet } = baueMarker(einsatz, [], []);
    expect(verortet).toHaveLength(0);
  });

  it('färbt Schaden-Marker nach Ausmaß', () => {
    const { verortet } = baueMarker(undefined, [], [schaden({ id: 1, ausmass: 'katastrophal', lat: 51, lon: 7 })]);
    expect(verortet[0].farbe).toBe('#f5222d');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `rtk proxy pnpm test marker`
Expected: FAIL — `./marker` existiert nicht.

- [ ] **Step 3: Marker-Builder implementieren**

Create `frontend/src/pages/lagekarte/marker.ts`:

```ts
import type { EinsatzAnzeige, Schaden, Uhs } from '../../api/types';

export type MarkerTyp = 'einsatzort' | 'uhs' | 'schaden';

export interface KarteMarker {
  /** Stabil & eindeutig über alle Typen: 'einsatzort' | 'uhs-<id>' | 'schaden-<id>'. */
  schluessel: string;
  typ: MarkerTyp;
  /** Objekt-id im Fach-Modul (0 für den Einsatzort). */
  id: number;
  lat: number;
  lon: number;
  label: string;
  farbe: string;
}

export interface NichtVerortet {
  typ: 'uhs' | 'schaden';
  id: number;
  label: string;
}

const EINSATZORT_FARBE = '#a8071a';
const UHS_FARBE = '#1677ff';
const AUSMASS_FARBE: Record<string, string> = {
  gering: '#52c41a',
  mittel: '#faad14',
  gross: '#fa8c16',
  katastrophal: '#f5222d',
};

function schadenLabel(registrierNr: number): string {
  return `S-${String(registrierNr).padStart(3, '0')}`;
}

/** Leitet verortete Marker + Nicht-verortet-Liste aus den geladenen Objekten ab. */
export function baueMarker(
  einsatz: EinsatzAnzeige | undefined,
  uhsListe: Uhs[],
  schaeden: Schaden[],
): { verortet: KarteMarker[]; nichtVerortet: NichtVerortet[] } {
  const verortet: KarteMarker[] = [];
  const nichtVerortet: NichtVerortet[] = [];

  if (einsatz && einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null) {
    verortet.push({
      schluessel: 'einsatzort',
      typ: 'einsatzort',
      id: 0,
      lat: einsatz.einsatzort_lat,
      lon: einsatz.einsatzort_lon,
      label: einsatz.einsatzort ?? 'Einsatzort',
      farbe: EINSATZORT_FARBE,
    });
  }

  for (const u of uhsListe) {
    if (u.lat != null && u.lon != null) {
      verortet.push({
        schluessel: `uhs-${u.id}`,
        typ: 'uhs',
        id: u.id,
        lat: u.lat,
        lon: u.lon,
        label: u.bezeichnung,
        farbe: UHS_FARBE,
      });
    } else {
      nichtVerortet.push({ typ: 'uhs', id: u.id, label: u.bezeichnung });
    }
  }

  for (const s of schaeden) {
    if (s.lat != null && s.lon != null) {
      verortet.push({
        schluessel: `schaden-${s.id}`,
        typ: 'schaden',
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: schadenLabel(s.registrier_nr),
        farbe: AUSMASS_FARBE[s.ausmass] ?? '#8c8c8c',
      });
    } else {
      nichtVerortet.push({ typ: 'schaden', id: s.id, label: schadenLabel(s.registrier_nr) });
    }
  }

  return { verortet, nichtVerortet };
}
```

- [ ] **Step 4: Test grün**

Run: `rtk proxy pnpm test marker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/marker.ts frontend/src/pages/lagekarte/marker.test.ts
git commit -m "feat(fe): Marker-Builder (verortet/nicht-verortet) für die Lagekarte"
```

---

## Task B3: Basemap-Style-Erzeugung (online/offline/blind, hell/dunkel) + Test

**Files:**
- Create: `frontend/src/pages/lagekarte/basemapStil.ts`
- Create: `frontend/src/pages/lagekarte/basemapStil.test.ts`

- [ ] **Step 1: Failing Test schreiben**

Create `frontend/src/pages/lagekarte/basemapStil.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baueBasemapStyle, blindStyle, defaultModus, offlineStyle } from './basemapStil';
import type { KarteServerConfig } from '../../api/karte';

const beides: KarteServerConfig = {
  online_style_url: 'https://tiles.example/style.json',
  pmtiles_verfuegbar: true,
  pmtiles_url: '/api/karte/tiles.pmtiles',
};
const nurOffline: KarteServerConfig = {
  online_style_url: null, pmtiles_verfuegbar: true, pmtiles_url: '/api/karte/tiles.pmtiles',
};
const leer: KarteServerConfig = { online_style_url: null, pmtiles_verfuegbar: false, pmtiles_url: null };

describe('basemapStil', () => {
  it('blindStyle rendert nur einen Hintergrund-Layer', () => {
    const s = blindStyle('dark');
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].type).toBe('background');
  });

  it('offlineStyle referenziert die pmtiles-Source', () => {
    const s = offlineStyle('light', '/api/karte/tiles.pmtiles');
    expect(JSON.stringify(s.sources)).toContain('pmtiles://');
    // keine symbol/text-Layer → keine Glyphs nötig:
    expect(s.layers.some((l) => l.type === 'symbol')).toBe(false);
  });

  it('online-Modus liefert die konfigurierte URL als String', () => {
    expect(baueBasemapStyle('online', 'light', beides)).toBe('https://tiles.example/style.json');
  });

  it('blind ist der Fallback, wenn der Modus nicht verfügbar ist', () => {
    const s = baueBasemapStyle('online', 'light', leer);
    expect(typeof s).toBe('object');
    expect((s as { layers: unknown[] }).layers).toHaveLength(1);
  });

  it('defaultModus: online vor offline vor blind', () => {
    expect(defaultModus(beides)).toBe('online');
    expect(defaultModus(nurOffline)).toBe('offline');
    expect(defaultModus(leer)).toBe('blind');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `rtk proxy pnpm test basemapStil`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Style-Erzeugung implementieren**

Create `frontend/src/pages/lagekarte/basemapStil.ts`:

```ts
import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig } from '../../api/karte';

export type BasemapModus = 'online' | 'offline' | 'blind';
export type KartenTheme = 'light' | 'dark';

const FARBEN: Record<KartenTheme, Record<string, string>> = {
  light: {
    erde: '#f5f5f3', wasser: '#a8cdf0', landuse: '#eaf0e2',
    strasse: '#ffffff', gebaeude: '#e4e0da', hintergrund: '#e8e8e8',
  },
  dark: {
    erde: '#15181d', wasser: '#15233f', landuse: '#1b2119',
    strasse: '#33373d', gebaeude: '#23262b', hintergrund: '#0f1115',
  },
};

/** Background-only-Style: rendert immer, auch ganz ohne Tiles ("Blind-Modus"). */
export function blindStyle(theme: KartenTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': FARBEN[theme].hintergrund } },
    ],
  };
}

/**
 * Offline-Vektor-Style über `pmtiles://`. Annahme: Protomaps-Schema-PMTiles
 * (Source-Layer earth/landuse/water/roads/buildings). BEWUSST ohne Text-Layer →
 * keine Glyphs nötig → voll offline. Theme-Farben kommen aus FARBEN.
 */
export function offlineStyle(theme: KartenTheme, pmtilesUrl: string): StyleSpecification {
  const f = FARBEN[theme];
  const absolut = new URL(pmtilesUrl, window.location.origin).href;
  return {
    version: 8,
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${absolut}` },
    },
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      { id: 'erde', source: 'protomaps', 'source-layer': 'earth', type: 'fill', paint: { 'fill-color': f.erde } },
      { id: 'landuse', source: 'protomaps', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': f.landuse } },
      { id: 'wasser', source: 'protomaps', 'source-layer': 'water', type: 'fill', paint: { 'fill-color': f.wasser } },
      { id: 'strassen', source: 'protomaps', 'source-layer': 'roads', type: 'line', paint: { 'line-color': f.strasse, 'line-width': 1.2 } },
      { id: 'gebaeude', source: 'protomaps', 'source-layer': 'buildings', type: 'fill', paint: { 'fill-color': f.gebaeude } },
    ],
  };
}

/** Default-Modus nach Verfügbarkeit: online → offline → blind. */
export function defaultModus(config: KarteServerConfig | undefined): BasemapModus {
  if (config?.online_style_url) return 'online';
  if (config?.pmtiles_verfuegbar) return 'offline';
  return 'blind';
}

/**
 * Wählt den Style passend zu Modus + Theme + Verfügbarkeit. 'online' liefert die
 * konfigurierte URL (String). Ist der gewünschte Modus nicht verfügbar → Blind-Style.
 */
export function baueBasemapStyle(
  modus: BasemapModus,
  theme: KartenTheme,
  config: KarteServerConfig | undefined,
): StyleSpecification | string {
  if (modus === 'online' && config?.online_style_url) return config.online_style_url;
  if (modus === 'offline' && config?.pmtiles_url) return offlineStyle(theme, config.pmtiles_url);
  return blindStyle(theme);
}
```

> Hinweis: `import type { StyleSpecification }` ist ein reiner Typ-Import (zur Laufzeit gelöscht) — die Test-Datei lädt damit **kein** `maplibre-gl` und braucht kein WebGL.

- [ ] **Step 4: Test grün**

Run: `rtk proxy pnpm test basemapStil`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/basemapStil.ts frontend/src/pages/lagekarte/basemapStil.test.ts
git commit -m "feat(fe): Basemap-Style-Erzeugung (online/offline/blind, hell/dunkel)"
```

---

## Task B4: `Kartenflaeche` — dünner MapLibre-Wrapper (Test-Naht)

Die einzige Komponente mit `maplibre-gl`/`pmtiles`-Laufzeit-Import. Reine Props/Callbacks, damit Page-Tests sie mocken. Nicht in jsdom getestet — Verifikation erfolgt im Dev-Server (Step 4).

**Files:**
- Create: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- [ ] **Step 1: Komponente schreiben**

Create `frontend/src/pages/lagekarte/Kartenflaeche.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';

// pmtiles-Protokoll genau einmal global registrieren.
let pmtilesRegistriert = false;
function registrierePmtiles() {
  if (pmtilesRegistriert) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesRegistriert = true;
}

export interface KartenflaecheProps {
  style: StyleSpecification | string;
  markers: KarteMarker[];
  /** Karten-Klick (z. B. zum Platzieren) — liefert geklickte Koordinate. */
  onKarteKlick?: (lngLat: { lng: number; lat: number }) => void;
  /** Marker-Klick → Inspector öffnen. */
  onMarkerKlick?: (schluessel: string) => void;
  /** Beim Setzen sanft hinfliegen. */
  flyToZiel?: { lng: number; lat: number } | null;
  /** Style-Ladefehler (online nicht erreichbar) → Page stuft ab. */
  onStyleFehler?: () => void;
}

export default function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler,
}: KartenflaecheProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjekteRef = useRef<maplibregl.Marker[]>([]);
  // true, sobald der initiale Style geladen ist → danach gelten error-Events als
  // transient (einzelne Tiles), NICHT als Style-Ladefehler.
  const stilGeladenRef = useRef(false);

  // Karte einmalig erzeugen.
  useEffect(() => {
    registrierePmtiles();
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      stilGeladenRef.current = true;
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme).
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.setStyle(style);
  }, [style]);

  // Klick-Handler verdrahten (onKarteKlick kann sich ändern → neu binden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapMouseEvent) => onKarteKlick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handler);
    // Nur der INITIALE Style-Ladefehler stuft die Basemap ab. MapLibre feuert
    // 'error' auch für einzelne fehlende Tiles — die dürfen den Nutzer nicht aus
    // dem Online-Modus werfen.
    const fehler = () => {
      if (!stilGeladenRef.current) onStyleFehler?.();
    };
    map.on('error', fehler);
    return () => {
      map.off('click', handler);
      map.off('error', fehler);
    };
  }, [onKarteKlick, onStyleFehler]);

  // Marker re-rendern, wenn sich die Liste ändert.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markerObjekteRef.current) m.remove();
    markerObjekteRef.current = markers.map((mk) => {
      const el = document.createElement('div');
      el.style.cssText = `width:18px;height:18px;border-radius:50%;border:2px solid #fff;cursor:pointer;background:${mk.farbe};box-shadow:0 0 3px rgba(0,0,0,.5)`;
      el.title = mk.label;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation(); // nicht als Karten-Klick werten
        onMarkerKlick?.(mk.schluessel);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([mk.lon, mk.lat]).addTo(map);
    });
  }, [markers, onMarkerKlick]);

  // fly-to bei Auswahl.
  useEffect(() => {
    const map = mapRef.current;
    if (map && flyToZiel) map.flyTo({ center: [flyToZiel.lng, flyToZiel.lat] as LngLatLike, zoom: 15 });
  }, [flyToZiel]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />;
}
```

- [ ] **Step 2: Vite-Build kompiliert**

Run: `rtk proxy pnpm run build`
Expected: PASS — TypeScript + Vite bündeln maplibre-gl. (Falls Vite über den maplibre-Worker meckert, ist kein Sondersetup nötig — maplibre-gl v4 liefert den Worker inline; keine `optimizeDeps`-Anpassung erforderlich.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): Kartenflaeche — dünner MapLibre/PMTiles-Wrapper (mockbare Test-Naht)"
```

- [ ] **Step 4: Manuelle Dev-Verifikation (kein automatischer Test)**

Notiz für den Reviewer: `Kartenflaeche` wird in jsdom **nicht** automatisiert getestet (kein WebGL). Nach Task B5 im Dev-Server (`pnpm dev`) sichtprüfen: Karte lädt, Marker erscheinen, Klick funktioniert. Blind-Modus (ohne konfigurierte Basemap) muss eine einfarbige Fläche + Marker zeigen.

---

## Task B5: `LagekartePage` + Sidebar + Inspector (Orchestrierung)

Die Seite: lädt Einsatz/UHS/Schäden + Karte-Config, baut Marker, hält Platzierungs-/Auswahl-/Basemap-State, verdrahtet Verorten-PATCHs, reused die bestehenden SSE-Hooks.

**Files:**
- Create: `frontend/src/pages/lagekarte/Sidebar.tsx`
- Create: `frontend/src/pages/lagekarte/Inspector.tsx`
- Create: `frontend/src/pages/LagekartePage.tsx`

- [ ] **Step 1: Sidebar-Komponente**

Create `frontend/src/pages/lagekarte/Sidebar.tsx`:

```tsx
import { Badge, Button, Card, Empty, List, Radio, Space, Switch, Typography } from 'antd';
import type { KarteMarker, NichtVerortet } from './marker';
import type { BasemapModus } from './basemapStil';

export interface LayerSichtbar {
  einsatzort: boolean;
  uhs: boolean;
  schaden: boolean;
}

export interface SidebarProps {
  nichtVerortet: NichtVerortet[];
  verortet: KarteMarker[];
  darfSchreiben: boolean;
  platzierungZiel: { typ: 'uhs' | 'schaden' | 'einsatzort'; id: number } | null;
  onPlatzierenStart: (ziel: { typ: 'uhs' | 'schaden'; id: number }) => void;
  onPlatzierenAbbrechen: () => void;
  layer: LayerSichtbar;
  onLayerToggle: (key: keyof LayerSichtbar, an: boolean) => void;
  basemap: BasemapModus;
  onBasemapWechsel: (modus: BasemapModus) => void;
  onMarkerWaehlen: (schluessel: string) => void;
}

export default function Sidebar(props: SidebarProps) {
  const { nichtVerortet, verortet, darfSchreiben, platzierungZiel } = props;
  const uhsVerortet = verortet.filter((m) => m.typ === 'uhs');
  const schadenVerortet = verortet.filter((m) => m.typ === 'schaden');

  return (
    <div style={{ width: 300, padding: 12, overflowY: 'auto', height: '100%' }}>
      <Card
        size="small"
        title={
          <Space>
            <Typography.Text strong>⚠ Nicht verortet</Typography.Text>
            <Badge count={nichtVerortet.length} showZero color="#fa8c16" />
          </Space>
        }
        style={{ marginBottom: 12 }}
      >
        {nichtVerortet.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Alles verortet" />
        ) : (
          <List
            size="small"
            dataSource={nichtVerortet}
            renderItem={(o) => {
              const aktiv = platzierungZiel?.typ === o.typ && platzierungZiel?.id === o.id;
              return (
                <List.Item
                  actions={
                    darfSchreiben
                      ? [
                          aktiv ? (
                            <Button size="small" onClick={props.onPlatzierenAbbrechen}>
                              Abbrechen
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => props.onPlatzierenStart({ typ: o.typ, id: o.id })}
                            >
                              Platzieren
                            </Button>
                          ),
                        ]
                      : []
                  }
                >
                  <Typography.Text>
                    {o.typ === 'uhs' ? 'UHS' : 'Schaden'}: {o.label}
                  </Typography.Text>
                </List.Item>
              );
            }}
          />
        )}
      </Card>

      {platzierungZiel && darfSchreiben && (
        <Card size="small" style={{ marginBottom: 12, borderColor: '#1677ff' }}>
          <Typography.Text type="secondary">
            Klick auf die Karte setzt die Koordinate. (Esc/Abbrechen beendet.)
          </Typography.Text>
        </Card>
      )}

      <Card size="small" title="Verortet" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">UHS ({uhsVerortet.length})</Typography.Text>
        <List
          size="small"
          dataSource={uhsVerortet}
          renderItem={(m) => (
            <List.Item style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </List.Item>
          )}
        />
        <Typography.Text type="secondary">Schäden ({schadenVerortet.length})</Typography.Text>
        <List
          size="small"
          dataSource={schadenVerortet}
          renderItem={(m) => (
            <List.Item style={{ cursor: 'pointer' }} onClick={() => props.onMarkerWaehlen(m.schluessel)}>
              {m.label}
            </List.Item>
          )}
        />
      </Card>

      <Card size="small" title="Ebenen" style={{ marginBottom: 12 }}>
        <Space direction="vertical">
          <Space>
            <Switch checked={props.layer.einsatzort} onChange={(v) => props.onLayerToggle('einsatzort', v)} />
            Einsatzort
          </Space>
          <Space>
            <Switch checked={props.layer.uhs} onChange={(v) => props.onLayerToggle('uhs', v)} /> UHS
          </Space>
          <Space>
            <Switch checked={props.layer.schaden} onChange={(v) => props.onLayerToggle('schaden', v)} /> Schäden
          </Space>
        </Space>
      </Card>

      <Card size="small" title="Basemap">
        <Radio.Group
          value={props.basemap}
          onChange={(e) => props.onBasemapWechsel(e.target.value as BasemapModus)}
          optionType="button"
          size="small"
        >
          <Radio.Button value="online">Online</Radio.Button>
          <Radio.Button value="offline">Offline</Radio.Button>
          <Radio.Button value="blind">Blind</Radio.Button>
        </Radio.Group>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Inspector-Komponente**

Create `frontend/src/pages/lagekarte/Inspector.tsx`:

```tsx
import { Button, Card, Descriptions, Space } from 'antd';
import { Link } from 'react-router-dom';
import type { KarteMarker } from './marker';

export interface InspectorProps {
  einsatzId: number;
  marker: KarteMarker;
  darfSchreiben: boolean;
  onSchliessen: () => void;
  onVerortungLoeschen: (marker: KarteMarker) => void;
}

/** Kompakter Marker-Inspector mit Link ins jeweilige Fach-Modul. */
export default function Inspector({
  einsatzId, marker, darfSchreiben, onSchliessen, onVerortungLoeschen,
}: InspectorProps) {
  const modulLink =
    marker.typ === 'uhs'
      ? `/einsaetze/${einsatzId}/unfallhilfsstellen/${marker.id}`
      : marker.typ === 'schaden'
        ? `/einsaetze/${einsatzId}/schaeden?schaden=${marker.id}`
        : `/einsaetze/${einsatzId}/einsatzdaten`;

  return (
    <Card
      size="small"
      title={marker.label}
      extra={<Button size="small" type="text" onClick={onSchliessen} aria-label="Schließen">×</Button>}
      style={{ position: 'absolute', right: 12, top: 12, width: 280, zIndex: 5 }}
    >
      <Descriptions column={1} size="small">
        <Descriptions.Item label="Typ">
          {marker.typ === 'uhs' ? 'Unfallhilfsstelle' : marker.typ === 'schaden' ? 'Schaden' : 'Einsatzort'}
        </Descriptions.Item>
        <Descriptions.Item label="Koordinate">
          {marker.lat.toFixed(5)}, {marker.lon.toFixed(5)}
        </Descriptions.Item>
      </Descriptions>
      <Space style={{ marginTop: 8 }}>
        <Link to={modulLink}>
          <Button size="small">Im Fach-Modul öffnen</Button>
        </Link>
        {darfSchreiben && marker.typ !== 'einsatzort' && (
          <Button size="small" danger onClick={() => onVerortungLoeschen(marker)}>
            Verortung löschen
          </Button>
        )}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 3: `LagekartePage` (Orchestrierung)**

Create `frontend/src/pages/LagekartePage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereEinsatz, ladeEinsatz, type KopfdatenUpdate } from '../api/einsaetze';
import { listeUhs, aktualisiereUhs } from '../api/einsatzUhs';
import { listeSchaeden, aktualisiereSchaden } from '../api/einsatzSchaden';
import { ladeKarteConfig } from '../api/karte';
import type { EinsatzAnzeige } from '../api/types';
import { useUhsStream } from '../etb/useUhsStream';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { baueMarker, type KarteMarker } from './lagekarte/marker';
import { baueBasemapStyle, defaultModus, type BasemapModus } from './lagekarte/basemapStil';
import Kartenflaeche from './lagekarte/Kartenflaeche';
import Sidebar, { type LayerSichtbar } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';

/** EinsatzAnzeige → KopfdatenUpdate (Vollersatz) mit überschriebener Koordinate. */
function kopfMitKoordinate(e: EinsatzAnzeige, lat: number | null, lon: number | null): KopfdatenUpdate {
  return {
    bezeichnung: e.bezeichnung,
    stichwort: e.stichwort,
    einsatzart: e.einsatzart,
    einsatznummer_intern: e.einsatznummer_intern,
    leitstellen_nr: e.leitstellen_nr,
    einsatzort: e.einsatzort,
    einsatzort_lat: lat,
    einsatzort_lon: lon,
    meldende_stelle: e.meldende_stelle,
    sachverhalt: e.sachverhalt,
    anzahl_betroffene_initial: e.anzahl_betroffene_initial,
    begonnen_at: e.begonnen_at,
  };
}

export default function LagekartePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { effektiv } = useThemeMode();

  const [platzierungZiel, setPlatzierungZiel] =
    useState<{ typ: 'uhs' | 'schaden' | 'einsatzort'; id: number } | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<BasemapModus | null>(null);
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);
  const [layer, setLayer] = useState<LayerSichtbar>({ einsatzort: true, uhs: true, schaden: true });

  // SSE-Reuse: dieselben Query-Keys wie die Listenseiten → Marker live.
  useUhsStream(einsatzId);
  useSchaedenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({ queryKey: ['einsatz-uhs', einsatzId], queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });

  // Basemap-Default setzen, sobald Config da ist.
  useEffect(() => {
    if (basemap == null && configQuery.data) setBasemap(defaultModus(configQuery.data));
  }, [basemap, configQuery.data]);

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  const { verortet, nichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsQuery.data ?? [], schaedenQuery.data ?? []),
    [einsatz, uhsQuery.data, schaedenQuery.data],
  );

  const sichtbareMarker = verortet.filter((m) => layer[m.typ]);
  const aktiverMarker = verortet.find((m) => m.schluessel === auswahl) ?? null;

  const style = useMemo(
    () => baueBasemapStyle(basemap ?? 'blind', effektiv, configQuery.data),
    [basemap, effektiv, configQuery.data],
  );

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Verorten je nach Ziel-Typ (UHS/Schaden live; Einsatzort über Kopf-PATCH, dann invalidieren).
  const verortenMutation = useMutation({
    mutationFn: async (p: { lat: number | null; lon: number | null }) => {
      if (!platzierungZiel) return;
      if (platzierungZiel.typ === 'uhs') {
        await aktualisiereUhs(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'schaden') {
        await aktualisiereSchaden(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (einsatz) {
        await aktualisiereEinsatz(einsatzId, kopfMitKoordinate(einsatz, p.lat, p.lon));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
      setPlatzierungZiel(null);
    },
    onError: fehler,
  });

  function onKarteKlick(lngLat: { lng: number; lat: number }) {
    if (!platzierungZiel || !darfSchreiben) return;
    verortenMutation.mutate({ lat: lngLat.lat, lon: lngLat.lng });
  }

  function onMarkerWaehlen(schluessel: string) {
    setAuswahl(schluessel);
    const m = verortet.find((x) => x.schluessel === schluessel);
    if (m) setFlyToZiel({ lng: m.lon, lat: m.lat });
  }

  function loescheVerortung(marker: KarteMarker) {
    if (marker.typ === 'uhs') {
      aktualisiereUhs(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'schaden') {
      aktualisiereSchaden(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] }))
        .catch(fehler);
    }
    setAuswahl(null);
  }

  if (einsatzQuery.isLoading || configQuery.isLoading) {
    return <Spin style={{ marginTop: 64 }} />;
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', position: 'relative' }}>
      <Sidebar
        nichtVerortet={nichtVerortet}
        verortet={verortet}
        darfSchreiben={!!darfSchreiben}
        platzierungZiel={platzierungZiel}
        onPlatzierenStart={(z) => {
          setPlatzierungZiel(z);
          setAuswahl(null);
        }}
        onPlatzierenAbbrechen={() => setPlatzierungZiel(null)}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        basemap={basemap ?? 'blind'}
        onBasemapWechsel={setBasemap}
        onMarkerWaehlen={onMarkerWaehlen}
      />
      <div style={{ flex: 1, position: 'relative' }}>
        <Kartenflaeche
          style={style}
          markers={sichtbareMarker}
          onKarteKlick={onKarteKlick}
          onMarkerKlick={onMarkerWaehlen}
          flyToZiel={flyToZiel}
          onStyleFehler={() => {
            // online nicht erreichbar → eine Stufe abstufen
            setBasemap((m) => (m === 'online' ? 'offline' : m === 'offline' ? 'blind' : 'blind'));
          }}
        />
        {aktiverMarker && (
          <Inspector
            einsatzId={einsatzId}
            marker={aktiverMarker}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onVerortungLoeschen={loescheVerortung}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck/Build grün**

Run: `rtk proxy pnpm run build`
Expected: PASS — alle Importe (inkl. `useThemeMode`, `useUhsStream`, `useSchaedenStream`, `aktualisiereEinsatz`) auflösbar, Typen passen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx frontend/src/pages/lagekarte/Inspector.tsx frontend/src/pages/LagekartePage.tsx
git commit -m "feat(fe): LagekartePage + Sidebar + Inspector (Verorten, Live, Basemap-Umschalter)"
```

---

## Task B6: Modul aktivieren (Registry + Route)

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts` (Zeile 65)
- Modify: `frontend/src/App.tsx` (Import + MODUL_ELEMENTE)

- [ ] **Step 1: Registry-Status auf `fertig`**

In `frontend/src/einsatz/modulRegistry.ts`, den `lagekarte`-Eintrag (Zeile 65) ändern: `status: 'geplant'` → `status: 'fertig'` und die Beschreibung an L‑1 anpassen:

```ts
  { key: 'lagekarte', kategorie: 'lage', label: 'Lagekarte', icon: TbMap2, route: 'lagekarte', status: 'fertig', beschreibung: 'Karte der verortbaren Objekte: Einsatzort, Unfallhilfsstellen, Schäden — verorten per Klick.' },
```

- [ ] **Step 2: Seite ins Routing hängen**

In `frontend/src/App.tsx`:

Import nach den anderen Page-Imports (nach Zeile 22) ergänzen:

```tsx
import LagekartePage from './pages/LagekartePage';
```

Und im `MODUL_ELEMENTE`-Objekt (Zeile 29–41) einen Eintrag hinzufügen:

```tsx
  lagekarte: <LagekartePage />,
```

- [ ] **Step 3: Build grün + bestehende Tests grün**

Run: `rtk proxy pnpm run build` dann `rtk proxy pnpm test modulRegistry`
Expected: PASS — Modul gilt jetzt als `fertig`; `modulRegistry.test.ts` (prüft ggf. Status) bleibt grün oder ist anzupassen (siehe Hinweis unten).

> Hinweis: Falls `frontend/src/einsatz/modulRegistry.test.ts` eine Erwartung an die Anzahl `geplant`/`fertig`-Module hat, dort den Zähler um eins von `geplant`→`fertig` korrigieren.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx
git commit -m "feat(fe): Lagekarte-Modul aktivieren (Registry fertig + Route)"
```

---

## Task B7: Schaden-Deep-Link (`?schaden=`) im Bestand

Damit der Inspector-Link „Im Fach-Modul öffnen" für Schäden den passenden Datensatz öffnet (Schaden hat keine eigene Item-Route).

**Files:**
- Modify: `frontend/src/pages/SchaedenPage.tsx`
- Modify: `frontend/src/pages/SchaedenPage.test.tsx`

- [ ] **Step 1: Failing Test schreiben**

In `frontend/src/pages/SchaedenPage.test.tsx` einen Test ergänzen (Muster aus der Datei wiederverwenden — MSW-Handler für Liste + Detail, `renderMitProviders` mit `route`). Der Test rendert die Seite unter `schaeden?schaden=5` und erwartet den geöffneten Drawer:

```tsx
it('öffnet per ?schaden=-Query den Detail-Drawer', async () => {
  const liste = [
    {
      id: 5, einsatz_id: 1, registrier_nr: 7, status: 'offen', typ: 'sachschaden',
      ausmass: 'gross', ort: 'Hauptstr. 17', lat: null, lon: null, beschreibung: 'Riss',
      geschaedigt_person_id: null, geschaedigt_personal_id: null, geschaedigt_organisation_id: null,
      geschaedigt_kontakt: null, uebergeben_an: null, uebergeben_at: null, abschluss_grund: null,
      abschluss_at: null, erfasst_at: '', erfasst_von: 1, geaendert_at: '', geaendert_von: 1,
      storniert_at: null, storniert_von: null, geschaedigt_registrier_nr: null,
      geschaedigt_storniert_at: null, geschaedigt_personal_name: null, geschaedigt_organisation_name: null,
    },
  ];
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json({ id: 1, status: 'aktiv', meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Org' })),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json(liste)),
    http.get('/api/einsaetze/1/schaeden/5', () => HttpResponse.json(liste[0])),
  );
  renderMitProviders(<SchaedenPage />, { route: '/einsaetze/1/schaeden?schaden=5' });
  // Drawer zeigt den Ort des Schadens:
  expect(await screen.findByText('Hauptstr. 17')).toBeInTheDocument();
});
```

> Den genauen Render-/Provider-Aufruf und die Imports (`http`, `HttpResponse`, `server`, `renderMitProviders`, `screen`) an die bestehende `SchaedenPage.test.tsx` angleichen.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `rtk proxy pnpm test SchaedenPage`
Expected: FAIL — der Drawer öffnet nicht automatisch.

- [ ] **Step 3: Query-Param in `SchaedenPage` auswerten**

In `frontend/src/pages/SchaedenPage.tsx`:

Import erweitern (Zeile 2):

```tsx
import { useParams, useSearchParams } from 'react-router-dom';
```

In der Komponente nach `const einsatzId = Number(id);` (Zeile 160) ergänzen:

```tsx
  const [searchParams] = useSearchParams();
```

Und nach den Query-Definitionen (nach Zeile 195) einen Effekt hinzufügen, der den Drawer per Query öffnet:

```tsx
  useEffect(() => {
    const ziel = searchParams.get('schaden');
    if (ziel) setOffenerSchadenId(Number(ziel));
  }, [searchParams]);
```

`useEffect` ggf. zum bestehenden `react`-Import (Zeile 1) hinzufügen:

```tsx
import { useEffect, useState } from 'react';
```

- [ ] **Step 4: Test grün**

Run: `rtk proxy pnpm test SchaedenPage`
Expected: PASS — Drawer öffnet sich für `?schaden=5`; bestehende SchaedenPage-Tests bleiben grün.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchaedenPage.tsx frontend/src/pages/SchaedenPage.test.tsx
git commit -m "feat(fe): Schaden-Detail per ?schaden=-Deep-Link (Inspector-Link der Lagekarte)"
```

---

## Task B8: LagekartePage-Tests (vier Spec-Szenarien)

Page-Test mit gemockter `Kartenflaeche` (Stub mit Buttons, die die Callbacks feuern). Deckt die vier Frontend-Tests der Spec ab: Nicht-verortet-Liste+Badge, Platzieren-Flow→PATCH, Marker-Klick→Inspector+Modul-Link, Basemap-Umschalten inkl. Blind.

**Files:**
- Create: `frontend/src/pages/LagekartePage.test.tsx`

- [ ] **Step 1: Test mit gemockter Kartenflaeche schreiben**

Create `frontend/src/pages/LagekartePage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import LagekartePage from './LagekartePage';

// Kartenflaeche mocken: kein WebGL. Der Stub exponiert Buttons, die die
// Callbacks (Karten-Klick, Marker-Klick) mit festen Werten feuern.
vi.mock('./lagekarte/Kartenflaeche', () => ({
  default: (props: {
    markers: { schluessel: string; label: string }[];
    onKarteKlick?: (p: { lng: number; lat: number }) => void;
    onMarkerKlick?: (s: string) => void;
  }) => (
    <div data-testid="kartenflaeche-stub">
      <button onClick={() => props.onKarteKlick?.({ lng: 8.6, lat: 50.1 })}>karte-klick</button>
      {props.markers.map((m) => (
        <button key={m.schluessel} onClick={() => props.onMarkerKlick?.(m.schluessel)}>
          marker-{m.schluessel}
        </button>
      ))}
    </div>
  ),
}));

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const EINSATZ = {
  id: 1, bezeichnung: 'Test', stichwort: null, status: 'aktiv', begonnen_at: '2026-05-30 10:00:00',
  abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null,
  angelegt_at: '2026-05-30 10:00:00', leitstellen_nr: null, einsatzort: 'ELW',
  einsatzort_lat: 50.0, einsatzort_lon: 8.5, meldende_stelle: null, sachverhalt: null,
  anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'Org',
};
const UHS_NICHT_VERORTET = {
  id: 5, einsatz_id: 1, abschnitt_id: null, typ: 'behandlungsplatz', bezeichnung: 'BHP 50',
  standort: null, notiz: null, status: 'aktiv', lat: null, lon: null, erfasst_at: '', erfasst_von: 1,
  geaendert_at: '', geaendert_von: 1, storniert_at: null,
};
const SCHADEN_VERORTET = {
  id: 9, einsatz_id: 1, registrier_nr: 3, status: 'offen', typ: 'sachschaden', ausmass: 'gross',
  ort: 'Hauptstr.', lat: 51.0, lon: 7.0, beschreibung: '', geschaedigt_person_id: null,
  geschaedigt_personal_id: null, geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
  uebergeben_an: null, uebergeben_at: null, abschluss_grund: null, abschluss_at: null, erfasst_at: '',
  erfasst_von: 1, geaendert_at: '', geaendert_von: 1, storniert_at: null, storniert_von: null,
  geschaedigt_registrier_nr: null, geschaedigt_storniert_at: null, geschaedigt_personal_name: null,
  geschaedigt_organisation_name: null,
};

function basisHandler(extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(EINSATZ)),
    http.get('/api/einsaetze/1/uhs', () => HttpResponse.json([UHS_NICHT_VERORTET])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([SCHADEN_VERORTET])),
    http.get('/api/karte/config', () =>
      HttpResponse.json({ online_style_url: null, pmtiles_verfuegbar: false, pmtiles_url: null }),
    ),
    ...extra,
  );
}

describe('LagekartePage', () => {
  it('zeigt die Nicht-verortet-Liste mit Anzahl-Badge', async () => {
    basisHandler();
    renderMitProviders(<LagekartePage />, { route: '/einsaetze/1/lagekarte' });
    expect(await screen.findByText('⚠ Nicht verortet')).toBeInTheDocument();
    expect(await screen.findByText(/BHP 50/)).toBeInTheDocument();
  });

  it('platziert ein Objekt: Objekt wählen → Karten-Klick → PATCH mit lat/lon', async () => {
    let patchBody: unknown = null;
    basisHandler([
      http.patch('/api/einsaetze/1/uhs/5', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...UHS_NICHT_VERORTET, lat: 50.1, lon: 8.6 });
      }),
    ]);
    const user = userEvent.setup();
    renderMitProviders(<LagekartePage />, { route: '/einsaetze/1/lagekarte' });
    await user.click(await screen.findByRole('button', { name: 'Platzieren' }));
    await user.click(await screen.findByText('karte-klick'));
    await waitFor(() => expect(patchBody).toEqual({ lat: 50.1, lon: 8.6 }));
  });

  it('Marker-Klick öffnet den Inspector mit Modul-Link', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderMitProviders(<LagekartePage />, { route: '/einsaetze/1/lagekarte' });
    await user.click(await screen.findByText('marker-schaden-9'));
    // Inspector zeigt den Link ins Fach-Modul:
    const link = await screen.findByRole('link', { name: /Im Fach-Modul öffnen/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/schaeden?schaden=9');
  });

  it('Basemap-Umschalter: Blind ist wählbar, Marker bleiben sichtbar', async () => {
    basisHandler();
    const user = userEvent.setup();
    renderMitProviders(<LagekartePage />, { route: '/einsaetze/1/lagekarte' });
    // Marker da (auch ohne Basemap):
    expect(await screen.findByText('marker-schaden-9')).toBeInTheDocument();
    // Auf Blind umschalten:
    await user.click(screen.getByRole('radio', { name: 'Blind' }));
    expect((screen.getByRole('radio', { name: 'Blind' }) as HTMLInputElement).checked).toBe(true);
    // Marker weiterhin sichtbar:
    expect(screen.getByText('marker-schaden-9')).toBeInTheDocument();
  });
});
```

> Hinweise:
> - Der Einsatzort hat eine Koordinate (`einsatzort_lat/lon`) → er erscheint als Marker `einsatzort`; die Tests prüfen gezielt `schaden-9`.
> - Default-Basemap ist `blind` (Config meldet nichts verfügbar), daher ist der „Blind"-Radio-Button anfangs aktiv — der Umschalt-Test klickt ihn trotzdem und prüft `checked`.
> - `renderMitProviders` umschließt mit QueryClient + Router (siehe `frontend/src/test/utils.tsx`). Falls `LagekartePage` Auth-Kontext braucht, in `renderMitProviders` analog zu anderen Seiten-Tests einbinden — sie nutzt aber nur React-Query, kein `useAuth`.

- [ ] **Step 2: Tests grün**

Run: `rtk proxy pnpm test LagekartePage`
Expected: PASS — alle vier Szenarien grün.

- [ ] **Step 3: Gesamte Frontend-Suite grün**

Run: `rtk proxy pnpm test`
Expected: PASS — keine Regression (inkl. `modulRegistry`-, `SchaedenPage`-Tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LagekartePage.test.tsx
git commit -m "test(fe): LagekartePage — Nicht-verortet, Platzieren-PATCH, Inspector-Link, Basemap-Blind"
```

---

## Task B9: Betriebs-Doku der Basemap-Konfiguration

Operator-Hinweis: Offline-Vektor-Style setzt Protomaps-Schema-PMTiles voraus; Online-URL/PMTiles-Pfad sind die Stellschrauben.

**Files:**
- Modify: `docs/betrieb/packaging.md` (oder Create `docs/betrieb/karte-basemap.md`, falls thematisch sauberer)

- [ ] **Step 1: Doku-Abschnitt schreiben**

Abschnitt „Lagekarte / Basemap" ergänzen mit:
- `--pmtiles-path` / `LIFELINE_PMTILES_PATH`: lokale PMTiles-Datei (z. B. ein Protomaps-Build aus `build.protomaps.com`, DE-weit mehrere GB). Wird per HTTP-Range ausgeliefert (`/api/karte/tiles.pmtiles`).
- `--karte-online-style-url` / `LIFELINE_KARTE_STYLE_URL`: vollständige MapLibre-Style-JSON-URL (online).
- Laufzeit-Bevorzugung: online → offline (PMTiles) → Blind-Modus (neutrales Raster; Marker + Koordinaten funktionieren weiter).
- Hinweis: Der gebündelte Offline-Vektor-Style nimmt das **Protomaps-Schema** an (Source-Layer `earth/landuse/water/roads/buildings`) und rendert bewusst ohne Beschriftung (keine Glyphs/Offline-Fonts nötig). Andere PMTiles-Schemata erfordern eine angepasste `offlineStyle`-Funktion oder die Online-URL.

- [ ] **Step 2: Commit**

```bash
git add docs/betrieb/
git commit -m "docs(betrieb): Basemap-Konfiguration der Lagekarte (PMTiles/Online/Blind)"
```

---

## Abschluss

- [ ] **Gesamt-Gate Backend:** `rtk proxy cargo test` → alle Tests grün.
- [ ] **Gesamt-Gate Frontend:** `rtk proxy pnpm test` und `rtk proxy pnpm run build` → grün.
- [ ] **Manuelle Sichtprüfung** (Dev-Server): Lagekarte lädt im Blind-Modus (ohne konfigurierte Basemap), „Nicht verortet" zeigt neue UHS/Schäden, Platzieren per Klick setzt den Marker live, Marker-Klick öffnet Inspector mit Link, Online/Offline/Blind-Umschalter funktioniert, Theme-Wechsel färbt die Karte um.
- [ ] **`docs/superpowers/PROGRESS.md`** aktualisieren: Teilprojekt-4-Tabelle, L‑1-Status `📝 Plan` → `✅ DONE` (mit Plan-Pfad), und Verweis auf diesen Plan.

---

## Self-Review (vom Plan-Autor durchlaufen)

**Spec-Abdeckung:**
- Datenmodell/Migration (lat/lon auf uhs + einsatz_schaden, nullable, kein CHECK) → Task A1. ✓
- Verorten = bestehende PATCH-Routen erweitern, Effektivzustand-Merge, 422 → Tasks A2/A3. ✓
- Einsatzort per Karte editierbar (Kopf-PATCH existiert) → Frontend-Picker in Task B5 (`kopfMitKoordinate`). ✓
- Karten-Lesedaten = bestehende Listen-Endpunkte, storniert gefiltert → Entscheidung 1 + A1 (SELECT_ALLE filtert bereits in `liste`). ✓
- Basemap-Auslieferung (PMTiles HTTP-Range, ServeFile, Pfad+URL konfigurierbar, 404 bei fehlend) → Tasks A4/A5. ✓
- Berechtigung lesen/schreiben/Nachlauf → `fordere_lesezugriff`/`fordere_schreibrecht`/`fordere_aktiv` bleiben in den PATCH-Handlern (A2/A3) unverändert wirksam. ✓
- Kein eigener ETB-Eintrag beim Verorten → PATCH-Handler schreiben kein ETB (bestehendes Verhalten, nicht verändert). ✓
- Live über bestehende SSE-Kanäle → Entscheidung 4 + Query-Key-Reuse in B5; Storno entfernt Marker (Liste filtert storniert). ✓
- Frontend: LagekartePage, linke Sidebar mit „Nicht verortet"+Badge, Gruppen, Layer-Toggles, Basemap-Umschalter, Platzieren per Klick/manuell, Marker-Klick→Inspector+Modul-Link, Marker-Icons je Typ, fly-to, Live → Tasks B2–B8. (Manuelle Lat/Lon-Eingabe + Clustering: siehe Hinweis unten.) ✓ (teilweise)
- Neue Deps maplibre-gl + pmtiles → Task B1. ✓
- Tests Backend + Frontend (alle in der Spec genannten) → A2/A3/A5 + B8. ✓

**Bewusst NICHT in L‑1 (Spec-Abgrenzung) — eingehalten:** keine Fahrzeuge/FMS, keine Zonen/freies Zeichnen, kein Geocoding, kein Material-Marker. ✓

**Offene Mini-Lücken gegenüber der Spec (bewusst, klein gehalten — bei Umsetzung ergänzen, falls gewünscht):**
1. **Manuelle Lat/Lon-Eingabe** als Alternative zum Karten-Klick (Spec: „alternativ Koordinate manuell eingeben"). Nicht als eigener Task ausformuliert. Minimal nachrüstbar: im Sidebar-Platzierungs-Panel zwei `InputNumber` + „Setzen"-Button, der dieselbe `verortenMutation.mutate({lat, lon})` ruft. **Empfehlung:** als Step in Task B5 ergänzen, wenn der Picker-Flow steht.
2. **Clustering bei Gedränge** (Spec: „dezentes Clustering"). Für L‑1 mit Einzelmarkern unkritisch; MapLibre-`cluster`-Sources erfordern GeoJSON-Source statt DOM-Markern. **Bewusst später**, nicht blockierend.

**Typ-Konsistenz geprüft:** `KarteMarker.schluessel`/`typ`/`farbe` einheitlich in `marker.ts`, `Kartenflaeche`, `Sidebar`, `Inspector`, Page. `BasemapModus` einheitlich in `basemapStil.ts`, `Sidebar`, Page. Backend `PatchDaten.lat/lon: Option<Option<f64>>` einheitlich Route↔Repo (UHS & Schaden). `KarteConfig` (Backend) ↔ `KarteServerConfig`-Antwort (`online_style_url`/`pmtiles_verfuegbar`/`pmtiles_url`) ↔ Frontend-Typ konsistent. Query-Keys `['einsatz-uhs', id]`/`['einsatz-schaeden', id]`/`['einsatz', id]` exakt wie Bestand (verifiziert) → Live greift.

**Platzhalter-Scan:** keine „TBD"/„später ausfüllen"/„analog zu Task N"-Stellen in Code-Schritten; jeder Code-Schritt enthält vollständigen Code. ✓
