# Copernicus-Rasterbilder (COG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die COG-Satellitenbilder der gezeigten Copernicus-Produkte als eigene Rasterebene „Copernicus-Satellitenbilder“ unter allen Fachebenen zeigen, serverseitig gekachelt.

**Architecture:** Ein reiner COG-Leser (`src/karte/cog.rs`) liest den TIFF-Kopf, wählt die Übersicht und rendert eine 256-px-PNG-Kachel. `copernicus.rs` liefert die Bilderliste über dieselbe Auswahlkette wie die Vektorebene und legt je Bild einen Kopf-Eintrag im Kachel-Cache an. Eine Kachelroute liest per HTTP-Range nur die nötigen Quellkacheln von S3. Im Frontend ist `copernicus_bilder` eine Fachebene mit `darstellung: 'raster'`, die statt GeoJSON-Layern je Bild eine MapLibre-Rasterquelle anlegt.

**Tech Stack:** Rust (axum, reqwest, sqlx, `flate2`, `weezl`, `image` mit `png`/`jpeg`), React/TypeScript, MapLibre GL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md`

## Global Constraints

- Routen: `GET /api/map/overlays/copernicus/images?bbox=…[&archiv=1]` und `GET /api/map/overlays/copernicus/images/{bild}/{z}/{x}/{y}`; Wächter `scripts/check-api-routen.sh`.
- Quelle `copernicus_bilder`; Bild-Kennung = erste 16 Hex-Zeichen von SHA-256 über den S3-Pfad.
- URL immer `EBENEN_BASIS + pfad`; Pfad relativ, ohne `..`, ohne `//`, ohne Schema, endet auf `.tif`.
- Nur EPSG:3857, ohne Rotation, gekachelt, 8 Bit, PlanarConfig 1, 1/3/4 Kanäle, Compression 1/5/7/8/32946, Predictor 1/2; sonst `darstellbar: false`.
- Grenzen: Kopf ≤ 1 MiB, erster Kopfabruf 16 KiB, Quellkachel ≤ 2 MiB komprimiert, ≤ 4 Quellkacheln je Zielkachel, `MAX_BILDER` = 20, `PARALLEL` = 6.
- Kachel: PNG RGBA 256 × 256, `Cache-Control: public, max-age=86400, immutable`; 404 unbekannte Kennung, 400 falsche Kachel, 204 außerhalb `bounds`/unter `min_zoom`, 502 S3 weg ohne Cache.
- `min_zoom` = Zoom, ab dem das Bild ≥ 64 px breit ist, mindestens `BBOX_MIN_ZOOM` (Frontend-Konstante, im Backend gespiegelt).
- Kopf-Eintrag `cog-kopf:<kennung>`, Kacheln `cog:<kennung>/<z>/<x>/<y>`, beide im Kachel-Cache (`tile_cache`), nicht in `fachebenen_cache`.
- Feldnamen der Bild-Features deutsch (Sprache des bestehenden Copernicus-Features); Umschlag `FachebeneAntwort` unverändert, kein Typ-Codegen.
- Deckkraft Vorgabe 80 %, Ebene voreingestellt aus, Archiv-Schalter wirkt auf beide Ebenen und wird nicht gespeichert.
- Rasterlayer unter allen Fachebenen und unter `bild-*`; keine Klickebene; keine neuen Farbtöne.
- Prosa, Kommentare, Testnamen deutsch; Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“.

## Review Focus

- Ein COG mit Offset-Arrays hinter den ersten 16 KiB (großes Bild) → Kopf lädt nach, statt „nicht darstellbar“. Test in Task 1 (`liest_nachgeladenen_kopf`).
- Eine Kachel genau am Bildrand (halb innen) → äußerer Teil durchsichtig, keine Panik bei Index außerhalb. Test in Task 3 (`randkachel_ist_aussen_durchsichtig`).
- Kaputte Quelle: Offset/Länge zeigt hinter die Datei oder Länge 0 → Fehler, keine Panik, 502. Test in Task 3 (`kaputte_quellkachel_ist_fehler`).
- Bild ohne passenden `images[]`-Eintrag → Bild bleibt, Sensor/Aufnahme fehlen, Zeile zeigt „Sensor unbekannt“. Tests in Task 5 und Task 9.
- Kennung eines Bildes, dessen Kopf-Eintrag verdrängt wurde, aber Kachel im Cache → Kachel kommt trotzdem. Test in Task 6 (`kachel_aus_cache_ohne_kopf`).

---

### Task 1: COG-Kopf lesen

**Files:**
- Create: `src/karte/cog.rs`
- Modify: `src/karte/mod.rs` (Modul eintragen)
- Test: `src/karte/cog.rs` (`mod tests`), Testdatei `src/karte/testdaten/copernicus-cog-anfang.bin` (liegt schon da: Bytes 0–153 240 des GeoEye-Bildes von EMSR728/AOI01/DEL_MONIT04, enthält alle IFDs und die einzige Kachel der kleinsten Übersicht)

**Interfaces:**
- Produces:
  ```rust
  #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
  pub(crate) enum Kompression { Keine, Lzw, Deflate, Jpeg }
  #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
  pub(crate) struct Stufe { pub breite: u32, pub hoehe: u32, pub kachel_breite: u32, pub kachel_hoehe: u32, pub offsets: Vec<u64>, pub laengen: Vec<u64> }
  #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
  pub(crate) struct Kopf {
      pub stufen: Vec<Stufe>,          // [0] = Vollbild, dann Übersichten absteigend
      pub kanaele: u8, pub alpha: bool, pub kompression: Kompression, pub praediktor: u8,
      pub jpeg_tabellen: Option<Vec<u8>>, pub nodata: Option<u8>,
      pub ursprung: (f64, f64),        // EPSG:3857, linke obere Ecke
      pub pixel: (f64, f64),           // Meter je Pixel der Vollauflösung (x, y > 0)
      pub nicht_darstellbar: Option<String>, // Grund; None = darstellbar
  }
  pub(crate) enum KopfErgebnis { Fertig(Kopf), BrauchtBytes(u64) }
  #[derive(Debug, thiserror::Error)] pub(crate) enum CogFehler { #[error("…")] Format(String), #[error("…")] ZuGross }
  pub(crate) const KOPF_ERSTER_ABRUF: u64 = 16 * 1024;
  pub(crate) const KOPF_MAX: u64 = 1024 * 1024;
  pub(crate) fn parse_kopf(bytes: &[u8]) -> Result<KopfErgebnis, CogFehler>;
  ```
  (Fehlt `thiserror` im Crate, ein schlichtes Enum mit `Display`.)

- [x] **Step 1: Failing tests**
  - `liest_den_echten_kopf`: `parse_kopf(&ANFANG[..16384])` → `Fertig(k)` mit `k.stufen.len() == 6`, `k.stufen[0].breite == 11447`, `hoehe == 8594`, `kachel_breite == 512`, `k.stufen[0].offsets.len() == 391`, `k.stufen[5].offsets.len() == 1`, `k.stufen[5].laengen == vec![146627]`, `k.kanaele == 3`, `!k.alpha`, `k.kompression == Deflate`, `k.praediktor == 2`, `k.nodata == Some(0)`, `k.ursprung == (1019796.0, 6271424.0)`, `k.pixel == (4.0, 4.0)`, `k.nicht_darstellbar == None`.
  - `liest_nachgeladenen_kopf`: `parse_kopf(&ANFANG[..3000])` → `BrauchtBytes(n)` mit `3000 < n <= 16384`; danach `parse_kopf(&ANFANG[..n as usize])` → `Fertig`.
  - `kopf_ueber_grenze_ist_fehler`: synthetischer Kopf, dessen IFD-Offset > `KOPF_MAX` liegt → `Err(CogFehler::ZuGross)`.
  - `nicht_darstellbar_mit_grund`: je ein synthetischer Kopf (Builder aus Task 3, `baue_test_cog` mit Optionen) für EPSG 32632, Streifen statt Kacheln (keine Tags 322/324), BitsPerSample 16, ModelTransformation-Tag (34264) → `nicht_darstellbar.is_some()`.
  - `kaputter_kopf_ist_fehler`: `b"II*\0\xff\xff\xff\x7f"` und `b"XX"` → `Err(Format)`, keine Panik.
- [x] **Step 2:** `cargo test --lib karte::cog` → FAIL (Modul fehlt).
- [x] **Step 3: Implement `parse_kopf`.** Klassisch (42) und BigTIFF (43), II/MM. IFD-Kette folgen; Wert inline oder per Offset; ein Offset hinter `bytes.len()` → `BrauchtBytes(ende)` (> `KOPF_MAX` → `ZuGross`). Masken-IFDs (Tag 254 Bit 4) überspringen. Geo aus IFD 0: 33550, 33922, 34735 (Schlüssel 3072 = ProjectedCSType), 42113 (ASCII → u8). Höchstens 32 IFDs.
- [x] **Step 4:** `cargo test --lib karte::cog` → PASS.
- [x] **Step 5:** Commit `feat(karte): COG-Kopf lesen (LLH-2021)`.

### Task 2: Kachelmathematik

**Files:** Modify `src/karte/cog.rs`

**Interfaces:**
- Consumes: `Kopf`, `Stufe` (Task 1)
- Produces:
  ```rust
  pub(crate) const MIN_ZOOM_BACKEND: u8 = 10; // = BBOX_MIN_ZOOM in frontend/src/pages/lagekarte/fachebenen.ts
  pub(crate) fn bounds_wgs84(k: &Kopf) -> [f64; 4];        // [west, sued, ost, nord]
  pub(crate) fn zoom_grenzen(k: &Kopf) -> (u8, u8);       // (min_zoom, max_zoom)
  pub(crate) fn waehle_stufe(k: &Kopf, z: u8) -> usize;
  pub(crate) struct Quellkachel { pub index: usize, pub spalte: u32, pub zeile: u32 }
  pub(crate) fn quellkacheln(k: &Kopf, stufe: usize, z: u8, x: u32, y: u32) -> Vec<Quellkachel>;
  pub(crate) fn kachel_im_bild(k: &Kopf, z: u8, x: u32, y: u32) -> bool;
  ```
  Den tatsächlichen Wert von `BBOX_MIN_ZOOM` vor dem Schreiben im Frontend nachsehen; ein Vitest-Wächter in Task 7 vergleicht beide.

- [x] **Step 1: Failing tests** (am echten Kopf)
  - `bounds_von_emsr728`: `[9.16098, 48.77665, 9.57230, 48.97974]` (Ursprung 1019796/6271424, 11447 × 4 m bzw. 8594 × 4 m); Toleranz 1e-4.
  - `abnahme_lagerichtig`: für z = 14 ist die Kachel, die den Ursprung enthält, x = 8608, y = 5628 (Standardformel lon/lat → Kachel); `kachel_im_bild(k, 14, 8608, 5628)` ist wahr, `(14, 8607, 5628)` und `(14, 8608, 5627)` sind falsch.
  - `stufe_je_zoom`: `waehle_stufe(k, 15) == 0` (Pixel 4,8 m ≥ 4 m), `waehle_stufe(k, 13) == 2`, `waehle_stufe(k, 10) == 5`.
  - `zoom_grenzen_emsr728`: `max_zoom == 16` (bei z 16 wäre die Zielkachel mit 2,39 m feiner als 4 m), `min_zoom == 10` (das Bild ist schon bei z 8 75 px breit, also greift `MIN_ZOOM_BACKEND`).
  - `hoechstens_vier_quellkacheln`: für alle x/y im Bild bei z 10…16 gilt `quellkacheln(...).len() <= 4`.
  - `ausserhalb_nicht_im_bild`: Kachel (z 14, x 0, y 0) → `false`.
- [x] **Step 2:** Tests rot.
- [x] **Step 3:** Implementieren. Merc-Meter je Pixel der Zielkachel `2π·6378137 / (256·2^z)`; Stufe = die gröbste, deren Pixelgröße `pixel.0 · 2^i` (aus Breitenverhältnis) ≤ Zielpixel, sonst 0.
- [x] **Step 4:** Tests grün.
- [x] **Step 5:** Commit `feat(karte): Kachelmathematik für COG (LLH-2021)`.

### Task 3: Entpacken und Kachel rendern

**Files:** Modify `src/karte/cog.rs`, `Cargo.toml` (`weezl` als direkte Abhängigkeit, Version wie im Lockfile)

**Interfaces:**
- Consumes: Task 1, 2
- Produces:
  ```rust
  pub(crate) const QUELLKACHEL_MAX: u64 = 2 * 1024 * 1024;
  pub(crate) fn entpacke(k: &Kopf, stufe: usize, roh: &[u8]) -> Result<Vec<u8>, CogFehler>; // kachel_breite*kachel_hoehe*kanaele
  pub(crate) fn rendere_kachel(k: &Kopf, z: u8, x: u32, y: u32, quellen: &HashMap<usize, Vec<u8>>) -> Result<Vec<u8>, CogFehler>; // PNG
  #[cfg(test)] pub(crate) struct TestCog { pub epsg: u16, pub kanaele: u8, pub bits: u16, pub gekachelt: bool, pub rotation: bool, pub kompression: Kompression }
  #[cfg(test)] pub(crate) fn baue_test_cog(o: &TestCog) -> Vec<u8>; // 2×2 Kacheln à 16 px + 1 Übersicht, Prädiktor 2, Nodata 0
  ```
- [x] **Step 1: Failing tests**
  - `entpackt_die_echte_kleinste_stufe`: `entpacke(k, 5, &ANFANG[o..o+146627])` (o = `k.stufen[5].offsets[0]`) → Länge 512·512·3; im Bildbereich (357×268) sind > 90 % der Pixel nicht (0,0,0); außerhalb (Spalte ≥ 357) alle 0.
  - `praediktor_wird_rueckgerechnet`: `baue_test_cog` mit bekanntem Farbverlauf; entpackte Kachel = Original.
  - `rendert_png_256`: `rendere_kachel` → `image::load_from_memory` ergibt 256×256 RGBA.
  - `nodata_ist_durchsichtig`: Pixel (0,0,0) → Alpha 0; andere → Alpha 255.
  - `randkachel_ist_aussen_durchsichtig`: Zielkachel halb außerhalb → äußere Hälfte Alpha 0, keine Panik.
  - `kaputte_quellkachel_ist_fehler`: zufällige Bytes als Deflate → `Err`, keine Panik; entpackt länger als erwartet → `Err`.
  - `lzw_und_ohne_kompression`: `baue_test_cog` mit `Lzw` und `Keine` entpackt korrekt.
- [x] **Step 2:** Tests rot.
- [x] **Step 3:** Implementieren: Deflate `flate2::read::ZlibDecoder` mit `take(erwartet+1)`; LZW `weezl` (MSB, TIFF-Größe 8); JPEG über `image::codecs::jpeg` mit vorangestellten JPEGTables (SOI/EOI zusammenfügen); Prädiktor 2 je Zeile horizontal kumulieren; Abtastung nächster Nachbar von Zielpixel → Merc → Stufenpixel → Quellkachel; fehlende Quellkachel in `quellen` = durchsichtig. PNG über `image::codecs::png::PngEncoder`.
- [x] **Step 4:** Tests grün.
- [x] **Step 5:** Commit `feat(karte): COG-Kacheln entpacken und rendern (LLH-2021)`.

### Task 4: Kachel-Cache ohne Upstream

**Files:** Modify `src/karte/tile_cache.rs`

**Interfaces:**
- Produces:
  ```rust
  pub async fn lies_eintrag(cache: &TileCache, schluessel: &str) -> Option<(Vec<u8>, String)>; // bytes, content_type; Ablaufzeit egal, berührt LRU
  pub async fn schreibe_eintrag(cache: &TileCache, schluessel: &str, bytes: &[u8], content_type: &str);
  #[cfg(test)] pub(crate) async fn test_cache() -> TileCache;
  ```
- [x] **Step 1: Failing tests:** `eintrag_hin_und_zurueck`; `eintrag_zaehlt_in_groesse_und_lru` (mit kleinem Cap: zweiter großer Eintrag verdrängt den ersten); `fehlender_eintrag_ist_none`.
- [x] **Step 2:** rot.
- [x] **Step 3:** über `speichere` (mit `AssetAntwort`, `expires_at = now + 30 Tage`) und `verdraenge_falls_noetig`; Lesen über `lade` + `beruehre`.
- [x] **Step 4:** grün (`cargo test --lib karte::tile_cache`).
- [x] **Step 5:** Commit `feat(karte): Kachel-Cache nimmt gerenderte Einträge (LLH-2021)`.

### Task 5: Bilder aus den Details und Bilderliste

**Files:** Modify `src/karte/copernicus.rs` (bei Bedarf neues Untermodul `src/karte/copernicus/bilder.rs`)

**Interfaces:**
- Consumes: Task 1, 2, 4
- Produces:
  ```rust
  #[derive(Debug, Clone, PartialEq)]
  pub(crate) struct Bild { pub pfad: String, pub sensor: Option<String>, pub sensor_art: Option<String>, pub aufnahme: Option<String> }
  // Produkt bekommt `pub bilder: Vec<Bild>`
  pub(crate) fn check_bildpfad(pfad: &str) -> bool;
  pub(crate) fn bild_kennung(pfad: &str) -> String;
  pub(crate) const MAX_BILDER: usize = 20;
  pub(crate) const COPERNICUS_BILDER_ATTRIB: &str = COPERNICUS_ATTRIB;
  #[derive(Serialize, Deserialize)] pub(crate) struct KopfEintrag { pub pfad: String, pub kopf: cog::Kopf }
  pub(crate) async fn load_kopf<R, RFut>(cache: &TileCache, hole_bereich: &R, pfad: &str) -> Result<cog::Kopf, String>
      where R: Fn(String, u64, u64) -> RFut, RFut: Future<Output = Result<Vec<u8>, String>>;
  pub(crate) async fn build_bilder_antwort<H, Fut, R, RFut>(pool: &SqlitePool, cache: &TileCache, fetch: H, hole_bereich: R, bbox: Bbox, archiv: bool, jetzt: NaiveDateTime, max_bilder: usize) -> Option<Gebaut>;
  ```
  Die Auswahlkette (Liste → Kandidaten → Details → Gebiete im Ausschnitt → `select_produkte`) wird aus `build_antwort` in eine Funktion gezogen, die beide nutzen (Name nach Wahl, z. B. `select_im_ausschnitt`); `build_antwort` bleibt im Verhalten gleich.
- [x] **Step 1: Failing tests** (Testdaten `copernicus-emsr728.json`, Stub `hole_bereich` liefert Ausschnitte aus `copernicus-cog-anfang.bin` für jeden Pfad)
  - `bilder_mit_sensor_und_aufnahme`: Gebiet Stuttgart, gewähltes DEL (MONIT04) hat zwei Bilder: GeoEye-1 `2024-06-08 10:53:00` und Pleiades `2024-06-08 10:29:00`.
  - `bild_ohne_images_eintrag_bleibt`: `fileName` passt nicht → Bild da, `sensor == None`.
  - `bildpfad_pruefung`: `check_bildpfad` lehnt `../x.tif`, `https://evil/x.tif`, `a//b.tif`, `a/b.json`, `/a.tif` ab; nimmt `EMSR728/AOI01/DEL_MONIT04/x_ORTHO.tif`.
  - `nur_bilder_gewaehlter_produkte`: MONIT01–03-Bilder erscheinen nicht.
  - `bilderliste_stuttgart`: Archiv an, Ausschnitt Stuttgart → `ok`, Features mit `bild` (16 Hex), `emsr`, `gebiet`, `sensor`, `aufnahme`, `min_zoom`, `max_zoom`, `bounds`, `darstellbar: true`, Polygon-Geometrie = Bounds; `stand` = jüngste Aufnahme; im Cache steht `cog-kopf:<bild>`.
  - `bilderliste_leer` (Ausschnitt ohne Aktivierung) → Status `leer`; `bilderliste_offline` (Liste fehlt) → `None`.
  - `kopf_fehlt_macht_unvollstaendig`: `hole_bereich` scheitert für ein Bild → `vollstaendig == false`, das andere Bild steht da.
  - `bildgrenze_kuerzt`: `max_bilder = 1` → ein Feature, Gebiet trägt `gekuerzt: true`.
  - `kopf_aus_cache_ohne_abruf`: zweiter `load_kopf` ruft `hole_bereich` nicht.
  - Bestehende Copernicus-Tests bleiben grün.
- [x] **Step 2:** rot.
- [x] **Step 3:** Implementieren. `parse_produkt` liest `format == "cog"` mit `check_bildpfad`, verbindet über das letzte Pfadsegment mit `images[].fileName`. `load_kopf`: Cache `cog-kopf:<kennung>` → sonst `hole_bereich(url, 0, KOPF_ERSTER_ABRUF)` → bei `BrauchtBytes(n)` einmal `hole_bereich(url, 0, n)` → speichern. Köpfe mit `buffer_unordered(PARALLEL)`.
- [x] **Step 4:** grün (`cargo test --lib karte::copernicus`).
- [x] **Step 5:** Commit `feat(karte): Bilderliste der Copernicus-Aktivierungen (LLH-2021)`.

### Task 6: Routen für Liste und Kachel

**Files:**
- Modify: `src/karte/copernicus.rs` (oder `copernicus/bilder.rs`), `src/routes/karte.rs`, `src/app.rs`
- Test: `tests/karte_copernicus_bilder.rs` (neu) bzw. Unit-Tests im Modul

**Interfaces:**
- Consumes: Task 3–5
- Produces:
  ```rust
  pub async fn fetch_copernicus_bilder(s: &FachebenenState, pool: &SqlitePool, karten_dir: &Path, bbox_roh: &str, archiv: bool) -> Result<FachebeneAntwort, AppError>;
  pub(crate) enum KachelAntwort { Png(Vec<u8>), Leer }
  pub(crate) async fn liefere_kachel<R, RFut>(cache: &TileCache, hole_bereich: &R, bild: &str, z: i64, x: i64, y: i64) -> Result<KachelAntwort, KachelFehler>; // KachelFehler: Unbekannt (404), Ungueltig (400), Quelle (502)
  // routes::karte::copernicus_bilder (GET …/images), routes::karte::copernicus_bild_kachel (GET …/images/{bild}/{z}/{x}/{y})
  fn hole_bereich_s3(url: String, start: u64, laenge: u64) -> impl Future<Output = Result<Vec<u8>, String>>; // eigener Client: client_builder(Zweck::Lagekarte), redirect none, Timeout 20 s, verlangt 206, Body ≤ laenge
  ```
- [x] **Step 1: Failing tests**
  - `unbekannte_kennung_ist_404`, `falsch_geformte_kennung_ist_404` (`xyz`, 17 Zeichen, Großbuchstaben), `falsche_kachel_ist_400` (z 25; x ≥ 2^z), `ausserhalb_ist_204`, `unter_min_zoom_ist_204`.
  - `kachel_wird_gerendert_und_gecacht`: Stub liefert Bytes aus `copernicus-cog-anfang.bin`; erste Anfrage für eine Kachel der kleinsten Stufe → Png; zweite → kein Stub-Aufruf.
  - `kachel_aus_cache_ohne_kopf`: Kachel im Cache, Kopf-Eintrag gelöscht → Png.
  - `quelle_weg_ist_502`: Stub scheitert, Kachel nicht im Cache → `Quelle`.
  - Routentest (axum, wie bestehende `/api/map/overlays`-Tests): `GET /api/map/overlays/copernicus/images` ohne `bbox` → 400; `bbox` > 3° → 400; Kachel-Antwort trägt `Content-Type: image/png` und `Cache-Control: public, max-age=86400, immutable`.
  - Gleichzeitige Misses derselben Zielkachel → ein Lauf (Zähler im Stub = Anzahl Quellkacheln, nicht doppelt).
- [x] **Step 2:** rot.
- [x] **Step 3:** Implementieren. Liste über `quellen::liefere_geloest` mit `COPERNICUS_WARTE`, Schlüssel `copernicus-bilder`/`copernicus-bilder-archiv`. Kachel: Form prüfen → `lies_eintrag("cog:…")` → `lies_eintrag("cog-kopf:…")` → `kachel_im_bild`/`zoom_grenzen` → Quellkacheln laden (jede über `proxy::abruf_platz`, Länge ≤ `QUELLKACHEL_MAX`) → `spawn_blocking(rendere_kachel)` → `schreibe_eintrag`. Bündelung je Kachelschlüssel nach Muster `tile_cache::hole_gebuendelt`. Routen in `app.rs` direkt neben `/api/map/overlays/{quelle}`.
- [x] **Step 4:** grün; `scripts/check-api-routen.sh` grün.
- [x] **Step 5:** Commit `feat(karte): Routen für Copernicus-Bilder und -Kacheln (LLH-2021)`.

### Task 7: Fachebene `copernicus_bilder` im Frontend

**Files:** Modify `frontend/src/api/fachebenen.ts`, `frontend/src/api/queryKeys.ts`, `frontend/src/pages/lagekarte/fachebenen.ts`, `leistenDaten.ts`, `fachebenenAuswahl.ts`, `useKartenAnsicht.ts`, `useFachebenen.ts`; Tests daneben (`fachebenen.test.ts` u. a.)

**Interfaces:**
- Produces:
  - `FachebeneQuelle` um `'copernicus_bilder'`; `ladeFachebene('copernicus_bilder', bbox, archiv)` ruft `/api/map/overlays/copernicus/images?bbox=…[&archiv=1]`.
  - `FachebeneDef.darstellung?: 'raster'`.
  - `FACHEBENEN.copernicus_bilder` = `{ label: 'Copernicus-Satellitenbilder', geometrieTyp: 'polygon', darstellung: 'raster', pollMs: 600_000, aufwaermPollMs: 15_000, bboxAbhaengig: true, minZoom: BBOX_MIN_ZOOM, geltung: 'nur optische Aufnahmen, nur wo Copernicus aktiviert wurde', veraltetNachMin: 120 }`.
  - `globalKeys.fachebeneCopernicusBilder(bbox, archiv)`.
  - `export interface CopernicusBild { bild: string; emsr: string; gebiet: string; sensor?: string; aufnahme?: string; minZoom: number; maxZoom: number; bounds: [number, number, number, number]; darstellbar: boolean; gekuerzt: boolean }` und `export function copernicusBilder(fc: FeatureCollection): CopernicusBild[]` (jüngste Aufnahme zuerst) in `fachebenen.ts`.
  - `useFachebenen` liefert `copernicusBilder: { liste: CopernicusBild[]; deckkraft: number; setDeckkraft(n: number): void }` und nutzt `copernicusArchiv` für beide Abfragen.
- [x] **Step 1: Failing tests:** Gruppen-Wächter (`satellit` = `['copernicus', 'copernicus_bilder']`); TTL gegen Takt; Query-Key enthält Archiv; `copernicusBilder` sortiert und liest Felder, fehlender Sensor → `undefined`; `fachebeneKeys()` enthält `copernicus_bilder`; Auswahl voreingestellt aus und gespeichert wie `copernicus`; Wächter `BBOX_MIN_ZOOM` gegen den Backend-Wert 10 (Konstante als Literal im Test mit Verweis auf `cog::MIN_ZOOM_BACKEND`).
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/pages/lagekarte` → rot.
- [x] **Step 3:** Implementieren. Deckkraft in derselben Kartenansicht-Speicherung wie die Ebenenwahl (Feld `copernicusBilderDeckkraft`, Vorgabe 80, auf 0…100 geklemmt).
- [x] **Step 4:** grün; `mise exec -- pnpm -C frontend exec tsc --noEmit` grün.
- [x] **Step 5:** Commit `feat(lagekarte): Fachebene Copernicus-Satellitenbilder (LLH-2021)`.

### Task 8: Rasterlayer auf der Karte

**Files:** Create `frontend/src/pages/lagekarte/copernicusBildLayer.ts` (+ `.test.ts`); Modify `Kartenflaeche.tsx`, `fachebenenLayer.ts` (`fachebeneClickLayerIds` → `[]` bei `darstellung: 'raster'`), `kartenLayer.ts` (`AktiveFachebene` um optionale `bilder`/`deckkraft`, falls dort der Typ lebt)

**Interfaces:**
- Consumes: `CopernicusBild` (Task 7)
- Produces:
  ```ts
  export const copernicusBildSourceId = (kennung: string) => `copernicus-bild-${kennung}`;
  export const copernicusBildLayerId = (kennung: string) => `copernicus-bild-${kennung}-raster`;
  export function copernicusBildAnker(map: MapLibreMap): string | undefined; // unterster `bild-*-raster`, sonst 'abschnitte-fill', sonst undefined
  export function synchronisiereCopernicusBilder(map: MapLibreMap, bilder: CopernicusBild[], deckkraft: number): void;
  ```
- [x] **Step 1: Failing tests** (Map-Attrappe wie in `bildLayer.test.ts`): legt je darstellbarem Bild Quelle `{ type: 'raster', tiles: ['/api/map/overlays/copernicus/images/<k>/{z}/{x}/{y}'], tileSize: 256, bounds, minzoom, maxzoom }` und Layer mit `raster-opacity` 0.8 an; nicht darstellbare nicht; entfernt verschwundene; Deckkraftwechsel setzt nur Paint; jüngstes Bild oben (Reihenfolge der `addLayer`-Aufrufe/`moveLayer`); `beforeId` = unterster `bild-*`-Layer, sonst `abschnitte-fill`; leere Liste räumt alles ab; Ebene aus → alles weg.
- [x] **Step 2:** rot.
- [x] **Step 3:** Implementieren; in `Kartenflaeche.tsx` Fachebenen mit `def.darstellung === 'raster'` nicht an `sorgeFuerFachebeneLayer` geben, sondern `synchronisiereCopernicusBilder` (auch im `load`-Handler und nach Stilwechsel). Keine Rolle in `ordneKlickebene`.
- [x] **Step 4:** grün.
- [x] **Step 5:** Commit `feat(lagekarte): Copernicus-Bilder als Rasterlayer (LLH-2021)`.

### Task 9: Ebenenzeile mit Deckkraft und Bildliste

**Files:** Create `frontend/src/pages/lagekarte/CopernicusBilderZusatz.tsx` (+ `.test.tsx`); Modify `Ebenenbaum.tsx`, `CopernicusZusatz.tsx` (Archiv-Schalter auch an der Bilder-Zeile, wenn `copernicus` aus ist)

**Interfaces:**
- Consumes: Task 7 (`copernicusBilder`, `archiv`, `setArchiv`), `isCopernicusAufnahmeAlt`, `formatiereDtg` (vorhandener DTG-Formatierer, wie `CopernicusZusatz` ihn nutzt)
- [x] **Step 1: Failing tests:** `leer` → „Keine Satellitenbilder im Ausschnitt“; `ok` → Zeile `EMSR728 · Stuttgart · GeoEye-1 · <DTG>`; ohne Sensor „Sensor unbekannt“; alt → Marke „Satellitenaufnahme vom <DTG>“ mit `rollen.achtungText`; `darstellbar: false` → „nicht darstellbar“; `gekuerzt` → „weiter hineinzoomen“; Regler 0–100 ruft `setDeckkraft`; Archiv-Schalter nur an einer der beiden Zeilen sichtbar.
- [x] **Step 2:** rot.
- [x] **Step 3:** Implementieren (antd `Slider` im Stil der Ebenenzusätze, `data-lfh`-Kennungen `copernicus-bilder-*`).
- [x] **Step 4:** grün; `mise exec -- pnpm -C frontend lint` grün.
- [x] **Step 5:** Commit `feat(lagekarte): Ebenenzeile der Copernicus-Bilder (LLH-2021)`.

### Task 10: Doku und ADR

**Files:** `docs/fachebenen-quellen.md`, `docs/anwender/kapitel/lagekarte.md`, neue ADR unter `docs/architektur/entscheidungen/` (Nummer und Form nach `docs/architektur/AGENTS.md`), betroffene arc42-Kapitel laut `scripts/adr-fuer.sh src/karte/cog.rs src/karte/copernicus.rs`

- [x] **Step 1:** `docs/architektur/AGENTS.md` und `docs/anwender/AGENTS.md` lesen; ADR „Copernicus-Rasterbilder werden serverseitig gekachelt“ mit Ansätzen 1–3, Bezug ADR-0079.
- [x] **Step 2:** `fachebenen-quellen.md`: Zeile `copernicus_bilder` (TTL, Takt, Veraltet), Abschnitt COG/Übersichtswahl/Grenzen/„nur EPSG:3857“. Anwenderkapitel: zweite Ebene, Deckkraft, Alter, „nicht darstellbar“.
- [x] **Step 3:** Doku-Wächter laufen lassen (`./scripts/check-all.sh --geaendert --ohne-e2e` deckt sie ab).
- [x] **Step 4:** Commit `docs: Copernicus-Rasterbilder (LLH-2021)`.

### Task 11: Gates, Bilder, PR

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [x] **Step 2:** Bilder per Wegwerf-Spec (`frontend/e2e/doku-bilder/zz-h11vkn1p.bilder.ts`): Lagekarte über Stuttgart, Archiv an, EMSR728, Bild bei 80 %, Ebenenzeile offen. Ohne Netz zu Copernicus in der Sitzung: Route im Spec abfangen und Testdaten liefern; das wird im PR offen gesagt.
- [x] **Step 3:** Plan abhaken, PR gegen `alpha`.
