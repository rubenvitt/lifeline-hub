# Offline-Karten: Shortbread/MBTiles-Rebuild (weg von Protomaps)

**Design-Spec — LFH-195 (Recherche+Design; Design-Phase); Altlasten-Ausbau LFH-196 hier eingebettet**
Stand: 2026-07-01 · Stack: Rust+SQLite-Backend (sqlx), MapLibre-GL-JS-Frontend

> **Grundlage:** Recherche-Report `docs/superpowers/specs/2026-06-27-offline-karten-konzept-recherche.md`
> (main `73b8065`). Dort ist die **Kartografie-Wahl belegt und abgeschlossen**; diese Spec ist die
> **codebase-spezifische Architektur** für die Umsetzung. Kartografie wird hier nicht neu aufgerollt.

---

## 0. Kurzfassung

Die bisherige Offline-Karte (Protomaps-PMTiles, LFH-181/183) und die Online-Protomaps-Basemap
(LFH-192) rendern unbefriedigend und werden **ersetzt**. Neu: eigene OSM-Vektorkarte im
**Shortbread-Schema**, ausgeliefert als **MBTiles (= SQLite)**, gebaut von einem **separaten
Docker-Build-Projekt im Repo**, als versioniertes Regions-Bundle (Default **Deutschland z0–14**).

Die App bleibt **komplett in-App** (LFH-178-Eckpunkt „alles in-App, kein Laufzeit-Docker / kein
externer Tile-Service"): sie lädt das MBTiles über den **bestehenden** Offline-Manager
(Download + One-Click-Update aus der Admin-UI) und serviert die Kacheln selbst aus SQLite. Online
bleibt **basemap.de** die Default-Basemap und überbrückt jede Offline-Lücke.

**Kernbefund aus der Code-Kartierung:** Der Unterbau ist überraschend gut vorbereitet — die
Download-/Registry-/Aktivierungs-Maschinerie ist **formatagnostisch** (die Tabelle
`karte_offline_karte` trägt bereits eine `kachel_schema`-Spalte). LFH-196 „alles abreißen" ist
daher **zu grob**: richtig ist **generische Infra behalten, nur die format-spezifische Oberfläche
ersetzen** (Tile-Serving, Frontend-Style, Protomaps-Online).

---

## 1. Getroffene Entscheidungen (Checkpoints dieser Design-Phase)

| Frage | Entscheidung |
|---|---|
| Offline bleiben? | **Ja** — Offline ist Kern-Anforderung. |
| Kartografie | **Shortbread-Schema + VersaTiles-Stil, Planetiler → MBTiles** (Report-Primärempfehlung); Protomaps entfällt. |
| Betriebsmodell | **Separates Docker-Build-Projekt im Repo → versioniertes Bundle → App lädt & serviert selbst**, Update über bestehenden Admin-Offline-Manager. Docker nur zur **Bau-Zeit**. |
| Region / Zoom | **Deutschland, z0–14** als Default-Katalogeintrag (Build-Region parametrisierbar). |
| Alt-Format | **Nur Shortbread/MBTiles.** Alte Offline-PMTiles-Logik + Protomaps-Online komplett raus (= LFH-196). `kachel_schema` bleibt generisch, aktiv ist nur `'shortbread'`. |
| Glyphs/Sprite | **Ins Binary eingebettet** (rust-embed), nicht im Download-Bundle → Download bleibt Einzeldatei. |
| Style-Erzeugung | **Im Frontend generiert** (konsistent zu `baueBasemapStyle`/Theming), nicht im Bundle mitgeliefert. |
| Sequenzierung | **Rebuild-first, Abriss danach** — die Lagekarte steht nie ohne Basemap. |

---

## 2. Bestand: Wiederverwenden vs. abreißen

Referenzen aus der Code-Kartierung (Datei:Zeile ca., vor Umsetzung erneut verifizieren).

### 2.1 Bleibt (generisch, unverändert oder minimal)

- **Download-Core** `src/karte/download.rs`: Chunked-HTTP-Download mit inkrementeller SHA256-Prüfung,
  atomarer `.part`→final-Swap, SSRF-Guard (`ip_ist_intern`, IPv6-Embedded-IPv4, per-Hop-Redirect),
  `fs4`-Plattenplatz-Check. **Nur Anpassung:** Datei-Suffix `.pmtiles` → `.mbtiles`
  (`entferne_download_dateien`, `karte-{id}.*`).
- **DB-Schema** `karte_offline_karte` (Migration `0076_karte_registry.sql`): Spalten `pfad`,
  `quell_url`, `lizenz`, **`kachel_schema` (Default heute `'protomaps'`)**, `groesse`, `sha256`,
  `status`-FSM (`registriert`/`laedt`/`bereit`/`fehler`), `aktiv_basemap` mit Unique-Constraint
  `idx_offline_eine_aktive`. **Bleibt** (nur Default-/Katalogwerte auf `'shortbread'`).
- **Registry/FSM** `src/karte/registry/repo.rs`: `new_download_karte`, `markiere_bereit`,
  `setze_status`, `aktiviere_wenn_keine_aktive`, `ersetze_aktive_offline_karte`
  (One-Click-Update, transaktional). **Bleibt.**
- **Online-Proxy-Core + Tile-Cache** (LFH-190, `0077_karte_proxy.sql`): formatagnostisch. **Bleibt.**
- **basemap.de-Online-Styles** + Online-Quellen-/Proxy-Unterbau (LFH-179/180/182). **Bleibt.**

### 2.2 Raus / umgebaut (LFH-196 hier eingebettet)

- **Statisches Offline-Tile-Serving** `GET /api/karte/tiles.pmtiles` (`src/routes/karte.rs`,
  `tower_http::ServeFile`) → ersetzt durch MBTiles-Tile-Endpoint (§3.2).
- **Frontend-Offline-Style** `frontend/src/pages/lagekarte/basemapStil.ts` → `offlineStyle()`
  mit hart verdrahteten **Protomaps-Layernamen** (`earth/landuse/water/roads/buildings/places`) und
  `pmtiles://`-URL → neu auf **Shortbread-Layer** + lokale Tile-URL (§3.3).
- **Online-Protomaps (LFH-192):** `OnlineStyleTyp::Protomaps`, `proxy_tilejson_entry` + Route,
  `protomapsLabeledStyle` + `baueBasemapStyle`-Protomaps-Zweig, Form-Typ-Option, `typ`-CHECK
  (Migration `0078`) → **entfernen** (neue no-tx-Migration, §3.5).
- **Config-Vertrag** `pmtiles_url`/`pmtiles_attribution` → `offline_tiles_url`/`offline_attribution`
  (Backend `src/config.rs` + `src/routes/karte.rs` `config`-Route; Frontend `KarteServerConfig` in
  `frontend/src/api/karte.ts`).

---

## 3. Neue/geänderte Bausteine

### 3.1 Build-Projekt `karten-build/` (das „zweite Projekt")

Eigenes, dockerisiertes Build-Tool **im Repo**, das nur zur Bau-Zeit läuft.

- **Tiles:** Planetiler-Shortbread (z. B. Image `ghcr.io/versatiles-org/planetiler-shortbread`),
  `--download --area=germany` → `germany.shortbread.mbtiles` (z0–14). Region als Parameter
  (`--area`), damit DACH/andere Extracts ohne Codeänderung baubar sind.
- **Glyphs (einmalig, schema-fix):** OFL-Open-Fonts (Noto/Open Sans/Roboto) → SDF-PBFs
  (`openmaptiles/fonts` oder `build_pbf_glyphs`), Ordner `fonts/<fontstack>/{range}.pbf`.
- **Sprite (einmalig):** CC0-Icons → `spreet` → `sprites/basemap.{png,json}` (+ `@2x`).
- **Manifest:** `manifest.json` (Schema, Region, Version/Build-Datum, Größe, SHA256, Attribution,
  `maxzoom`) — speist den Katalog-Eintrag (§3.4).
- **Reproduzierbarkeit:** Dockerfile + Makefile/README; Toolchain-Tag + Geofabrik-Datum festhalten.
- **Publikation:** Operator lädt `germany.shortbread.mbtiles` an eine stabile URL / als
  GitHub-Release. Glyphs/Sprite werden **einmalig ins Repo eingecheckt** (→ Binary-Embed, §3.2),
  nicht pro Region ausgeliefert.

**Nicht** Teil des App-Binaries; keine Java/Planetiler-Abhängigkeit zur Laufzeit.

### 3.2 Backend: MBTiles-Tile-Serving + eingebettete Assets

- **Tile-Endpoint** `GET /api/karte/offline/tiles/{z}/{x}/{y}`: öffnet die aktive MBTiles als
  SQLite (vorhandene `sqlx`-Schicht, **kein neues Format-Dependency**):
  ```sql
  SELECT tile_data FROM tiles
  WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3;
  ```
  **TMS-Y-Flip:** `tile_row = (2^z − 1) − y` (MapLibre liefert XYZ-`y`, MBTiles speichert TMS).
  Header: `Content-Type: application/x-protobuf`, **`Content-Encoding: gzip`** (MVT in MBTiles ist
  gzip). Fehlende Kachel → `204`/`404` (leer, kein Fehler).
- **Assets aus dem Binary** (rust-embed, wie Frontend-Bundle): `GET /api/karte/offline/fonts/{fontstack}/{range}.pbf`
  und `GET /api/karte/offline/sprites/basemap.{png,json}` (+`@2x`). Glyphs/Sprite sind klein und
  schema-fix → einbetten hält den Download-Pfad bei **einer Datei** (nur `.mbtiles`).
- **`config`-Route:** liefert `offline_tiles_url` (Template `…/offline/tiles/{z}/{x}/{y}?v=<ver>`,
  Cache-Bust wie bisher) + `offline_attribution` („© OpenStreetMap contributors", ODbL).

### 3.3 Frontend: Shortbread-`offlineStyle()` mit Beschriftung

- Vector-Source auf `/api/karte/offline/tiles/{z}/{x}/{y}`, `minzoom:0`, `maxzoom:14`.
- **Shortbread-Layer** (`landuse`, `water`, `transportation`, `building`, `boundary`, Label-Layer
  `place_labels`/`street_labels`/… mit `name_de`) — abgeleitet aus einem VersaTiles-Stil
  (graybeard/eclipse bzw. getuntes colorful), an die App-`KartenTheme` (light/dark) angepasst.
- `glyphs: '/api/karte/offline/fonts/{fontstack}/{range}.pbf'`, `sprite: '/api/karte/offline/sprites/basemap'`
  → **erstmals Labels offline** (heute rendert Offline ohne Beschriftung).
- Attribution im Style gesetzt; MapLibre-Attribution-Control aktiv lassen (ODbL-Pflicht).
- **Bestehende MapLibre-Gotchas beachten** (Projekt-Memory): `setData`/`setStyle`-Timing über die
  vorhandenen `wendeKartenDatenAn`-/render-Frame-Muster; root-relative Tile-URLs im Worker via
  `transformRequest` gegen die Origin absolutieren.

> **Optik-Feinjustage** (colorful vs. graybeard, „amtlich"-Tuning) ist bewusst eine spätere
> **Live-Demo-Entscheidung** (Report §9), nicht Teil dieser Spec. Diese Spec liefert einen
> funktional korrekten, beschrifteten Default-Stil.

### 3.4 Katalog

`default_offline_katalog()` (`src/config.rs`): Protomaps-Einträge raus, **ein Shortbread-DE-Eintrag**
rein — `kachel_schema:'shortbread'`, `quell_url` (gehostetes MBTiles), `groesse_erwartet`, `sha256`,
`maxzoom`, Attribution. Frontend-Katalog (`frontend/src/api/offlineKarten.ts`) ist bereits
`kachel_schema`-bewusst.

### 3.5 Migration (no-tx)

Neue no-tx-Migration (sqlx 0.9 im Projekt — FK-sichere CHECK-Rebuilds möglich, s. Memory):
- Online-Quellen-`typ`-CHECK ohne `'protomaps'` neu aufbauen; etwaige Protomaps-Online-Bestandszeilen
  vorher entfernen/migrieren.
- `karte_offline_karte.kachel_schema`-Default auf `'shortbread'` (Spalte bleibt, kein CHECK).
- Alte Migrationen **nicht** löschen (nur nach vorn ergänzen).

---

## 4. Sequenzierung: remove → rebuild (nie ohne Basemap)

**Rebuild zuerst, Abriss danach.** basemap.de-Online bleibt durchgehend Default-Basemap.

1. **Build-Projekt** `karten-build/` + reales `germany.shortbread.mbtiles` + Glyphs/Sprite-Artefakte.
2. **Backend:** MBTiles-Tile-Endpoint (+ TMS-Flip/gzip), eingebettete Fonts/Sprite,
   `config`-Route-Umbenennung.
3. **Frontend:** Shortbread-`offlineStyle()` + lokale Glyphs/Sprite; **Browser-Smoke**: Offline
   rendert **mit Labels**.
4. **Abriss (LFH-196):** Protomaps-Online + Offline-PMTiles-Reste + `pmtiles://` entfernen; Migration.
5. **Feinschliff:** Katalog, Admin-UI-Texte, `docs/packaging.md` aktualisieren.

Jede Stufe ist ein eigener, grün-getesteter Schritt; nach Stufe 3 ist der neue Pfad verifiziert,
bevor in Stufe 4 die Altlast fällt.

## 5. Test-Strategie

- **Backend:** MBTiles-Serving-Integrationstest mit Mini-Fixture-MBTiles — TMS-Y-Flip korrekt
  (bekannte z/x/y → erwartete Kachel), `Content-Encoding: gzip` gesetzt, fehlende Kachel → leer/404.
  Bestehende Download-Core-/Registry-Tests bleiben.
- **Frontend:** `offlineStyle()`-Unit-Tests — Shortbread-Layernamen, lokale `glyphs`/`sprite`/`tiles`-URLs,
  `name_de`-Label-Layer vorhanden.
- **Browser-Smoke** (Lagekarte ist WebGL/nicht-jsdom, s. Memory): Offline-Shortbread rendert inkl.
  Beschriftung (Glyphs vom lokalen Endpoint); Tile-URL im Worker korrekt absolutiert.
- **Build-Projekt:** CI-Smoke auf Mini-Extract → MBTiles valide (öffnet als SQLite, `tiles`-Tabelle
  nicht leer, `metadata` plausibel).
- **Gates:** Rust `cargo test`; Frontend `pnpm lint` (`--max-warnings 0`), `tsc --noEmit`, Vitest;
  Prod-Build-Smoke (s. Projekt-Memory zu Gate-Fallen).

## 6. Risiken & offene Punkte

| Thema | Risiko | Mitigation |
|---|---|---|
| MBTiles Y-Flip & gzip | Falscher `tile_row`/fehlender `Content-Encoding` → leere/kaputte Kacheln | Dedizierter z/x/y-Smoke gegen Fixture |
| Glyph-Größe im Binary | Volle Noto-Ranges blähen das Binary | Nur benötigte Fontstacks/Ranges einbetten; Größe messen |
| Optik „amtlich" | Kein OSM-Stil ist die amtliche Karte | Stil-Tuning später an Live-Demo (Report §9); CC0 erlaubt Tuning |
| DE-Größe/Build-Zeit | Report-Zahlen sind Schätzungen | Einmal real bauen, Werte im `manifest.json`/README verankern |
| Bestehende Protomaps-Daten | Online-`typ`-CHECK-Rebuild + Bestandszeilen | Migration entfernt/migriert Zeilen vor CHECK-Rebuild |
| MapLibre setStyle/setData-Timing | Custom-Layer-Re-Anlage racy (Projekt-Memory) | vorhandene render-Frame-Muster beibehalten |

## 7. Abgrenzung / später (nicht in dieser Spec)

- **Mehrere heruntergeladene Regionen gleichzeitig anzeigen** → LFH-188 (eigener Task; hier bleibt
  „genau eine aktive Basemap" via `idx_offline_eine_aktive`).
- **Zweite Kartografie / Raster / weitere Labels-Ausbaustufen** → LFH-184/185/186.
- **Offline-Manager-Härtung + Hot-Swap** → LFH-187.
- Finale visuelle Stilwahl (colorful/graybeard/Tuning) → Live-Demo-Entscheidung.

## 8. Referenzen

- Recherche-Report: `docs/superpowers/specs/2026-06-27-offline-karten-konzept-recherche.md` (main `73b8065`)
- ClickUp: LFH-195 (dieser Konzept-/Design-Task), LFH-196 (Altlasten-Ausbau, hier eingebettet),
  LFH-178 (Initiative „Karten-Verwaltung im Admin-UI")
- Code: `src/karte/download.rs`, `src/karte/registry/repo.rs`, `src/routes/karte.rs`, `src/config.rs`,
  `migrations/0076_karte_registry.sql`/`0077_karte_proxy.sql`/`0078_…`,
  `frontend/src/pages/lagekarte/basemapStil.ts`, `frontend/src/pages/lagekarte/OfflineKartenVerwaltung.tsx`,
  `frontend/src/api/karte.ts`, `frontend/src/api/offlineKarten.ts`
