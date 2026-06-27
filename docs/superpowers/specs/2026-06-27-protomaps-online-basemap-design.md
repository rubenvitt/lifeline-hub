# Protomaps-Online-Basemap (beschriftet, key-sicher) — Design

**Task:** LFH-192 (erster Schritt: „Protomaps online zum Laufen bringen"). Folge aus der
Beobachtung, dass `api.protomaps.com/tiles/v4.json?key=…` als Online-Quelle eine **leere Karte**
ergibt — weil das eine **TileJSON** (Quell-Beschreibung) ist, kein vollständiger MapLibre-**Style**.
Protomaps hostet (anders als OpenFreeMap/basemap.de) keinen fertigen Style; den liefern wir selbst.

## Ziel

Ein Admin kann Protomaps als **beschriftete** Online-Basemap einbinden, indem er nur den
**API-Key** einträgt. Der Key bleibt **serverseitig** (LFH-182-Proxy); das Frontend baut den Style
aus unseren vorhandenen Protomaps-Layern **plus Label-Layern**, mit **öffentlichen** Protomaps-Glyphs.

## Architektur (Kurzfassung)

Neuer Online-Quellen-Typ `protomaps`. Registrierung speichert die Protomaps-**TileJSON-URL inkl.
Key** serverseitig, `proxy` ist erzwungen. `/api/karte/config` liefert für diesen Typ eine
**key-freie, proxied TileJSON-URL** (neuer slot-loser Entry-Endpunkt, der die registrierte URL als
TileJSON fetcht + via vorhandenem `rewrite_tilejson` key-frei umschreibt). Das Frontend erkennt den
Typ und baut den Style: unsere Flächen/Linien-Layer + Label-Symbol-Layer, `glyphs` = öffentliche
Protomaps-Fonts, Vektor-Quelle = die proxied TileJSON. MapLibre lädt key-freie TileJSON → proxied
Tiles → rendert beschriftet.

## Komponenten / Touchpoints

### Backend

- **`src/config.rs` — `OnlineStyleTyp`:** neue Variante `Protomaps` (serde `"protomaps"`, neben
  `Vektor`/`Raster`).
- **`src/karte/proxy.rs` — `proxy_config_url`:** neuer Arm
  `Protomaps => format!("/api/karte/proxy/{id}/tilejson")` (slot-loser Entry; **kein** `{slot}`,
  weil die registrierte URL selbst die TileJSON ist — analog zu `Vektor => /style.json`).
- **`src/routes/karte.rs` — neuer Handler + Route** `GET /api/karte/proxy/{id}/tilejson`
  (slot-los): Quelle per `finde_online_quelle` prüfen (existiert, `proxy && aktiv`), dann
  `proxy::hole_tilejson(proxy::proxy_client(), &state.pool, id, &q.url)` — fetcht die registrierte
  TileJSON (mit Key), schreibt `tiles` auf key-freie Slot-URLs um, liefert key-frei
  (`json_proxy_antwort`, no-cache). Die slot-**behaftete** Variante `…/tilejson/{slot}` (für von
  einem Style referenzierte TileJSONs) bleibt unverändert.
- **Registrierung (`offline`-analog, Online-Quelle-CRUD):** `typ=protomaps` zulassen; bei diesem Typ
  **`proxy=true` erzwingen** (Key-Schutz). Bei URL-Änderung Slots invalidieren (vorhandenes
  `slots_loeschen`).

### Frontend

- **`frontend/src/pages/lagekarte/basemapStil.ts` — `protomapsLabeledStyle(theme, tilejsonUrl)`:**
  baut den Style. Quelle `protomaps: { type: 'vector', url: <absolutierte tilejsonUrl> }`. Layer:
  die 6 bestehenden (`hintergrund`/`erde`/`landuse`/`wasser`/`strassen`/`gebaeude`) **plus**:
  - `strassennamen`: `source-layer: 'roads'`, `type: 'symbol'`, `layout: { 'symbol-placement':
    'line', 'text-field': ['get','name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }`,
    `paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1 }`.
  - `orte`: `source-layer: 'places'`, `type: 'symbol'`, `layout: { 'text-field': ['get','name'],
    'text-font': ['Noto Sans Regular'], 'text-size': 12 }`, gleiche Paint-Halo-Logik.
  - `glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'` (öffentlich,
    key-frei). **Kein Sprite** (v1 = nur Text-Labels, keine POI-Icons).
  - Theme-Farben um `label`/`labelHalo` ergänzen (light: dunkler Text/heller Halo; dark: umgekehrt).
- **`baueBasemapStyle` / `baueOnlineStyle`:** Zweig für `stil.typ === 'protomaps'` →
  `protomapsLabeledStyle(theme, stil.url)` statt URL-String. (`baueBasemapStyle` reicht `theme` schon
  durch.)
- **`frontend/src/api/karte.ts` — `OnlineStyle.typ`:** `'vektor' | 'raster' | 'protomaps'`.
- **`frontend/src/karten/OnlineQuelleFormModal.tsx` + `onlineQuellen.ts`:** Typ-Option „Protomaps
  (API-Key)". Bei Auswahl: nur **Key**-Feld; die App baut `url =
  https://api.protomaps.com/tiles/v4.json?key=<KEY>`, setzt `typ=protomaps`, `proxy=true` (fix,
  ausgegraut). Attribution-Default „© OpenStreetMap, © Protomaps".

## Datenfluss

1. Admin: Online-Quelle anlegen, Typ „Protomaps", Key eintragen → Backend speichert
   `url=…?key=…`, `typ=protomaps`, `proxy=true`.
2. `GET /api/karte/config`: für die aktive Protomaps-Quelle → `OnlineStyle { typ:'protomaps',
   url:'/api/karte/proxy/{id}/tilejson', attribution }` (key-frei).
3. Frontend (Online-Modus): `protomapsLabeledStyle(theme, '/api/karte/proxy/{id}/tilejson')` →
   `setStyle(styleObjekt)`.
4. MapLibre: lädt proxied TileJSON (key-frei) → erhält proxied Tile-URLs → lädt key-freie Tiles,
   Glyphs öffentlich → rendert beschriftet. `transformRequest`/`absolutiereProxyAnfrage`
   absolutiert die root-relativen `/api/…`-URLs für den Worker (LFH-166/Worker-Gotcha).

## Fehlerbehandlung / Sicherheit

- **Key nie im Frontend:** `typ=protomaps` erzwingt `proxy=true`; `/config` gibt nie die Upstream-URL
  aus. `contains_secret` (LFH-182) bleibt als Backstop, dass die rewrite-Antwort keinen Key leakt.
- **SSRF:** unverändert — der Proxy-Resolver/das Handler-Gate prüfen das Upstream-Ziel.
- **Kaputter/abgelaufener Key oder Proxy-Fehler:** Tile-/TileJSON-Requests scheitern → MapLibre
  rendert die Basis-/Hintergrund-Layer; der Nutzer kann via Basemap-Umschalter auf Offline/Blind.
  Kein Absturz (Background-Layer rendert immer).

## Tests

- **Frontend (Vitest):** `protomapsLabeledStyle` — enthält die Label-Layer (`orte`,
  `strassennamen`), `glyphs` gesetzt, `sources.protomaps.url` = absolutierte übergebene URL, kein
  Text-Layer ohne `text-font`. `baueBasemapStyle` mit `typ:'protomaps'` ruft den Protomaps-Zweig.
  Form baut `url`+`proxy=true` korrekt aus dem Key.
- **Backend (cargo test):** `OnlineStyleTyp::Protomaps` Serde-/DB-Round-Trip; `proxy_config_url`
  liefert `/tilejson` für Protomaps; Config-Handler gibt für eine aktive Protomaps-Quelle die
  proxied TileJSON-URL (nie den Key). Der neue `/tilejson`-Entry-Handler gegen einen Loopback-Fixture
  (registrierte „TileJSON" → key-freie Antwort, `tiles` auf Slot-URLs umgeschrieben).
- **Browser-Smoke (manuell, WebGL/nicht jsdom):** echte Karte mit Orts-/Straßennamen; Netzwerk zeigt
  nur `/api/karte/proxy/…`-Tile-Requests (kein `api.protomaps.com`/Key im Browser).

## Bewusst nicht in v1 (YAGNI)

- Volle `@protomaps/basemaps`-Kartografie (nur die wichtigsten Label-Layer).
- POI-Icons / Sprite (nur Text-Labels).
- Glyph-Proxying (öffentliche Protomaps-Fonts genügen online).
- Offline-Beschriftung (Offline bleibt label-frei — bräuchte gebündelte Fonts).
- Zoom-/Rang-fein abgestimmte Label-Dichte (einfache, lesbare Defaults; Feinschliff später).
