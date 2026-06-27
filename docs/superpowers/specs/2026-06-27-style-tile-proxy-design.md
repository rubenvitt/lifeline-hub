# Server-Proxy für Style/Tile — Design (LFH-182)

**Status:** Abgenommen (Brainstorming) · **Datum:** 2026-06-27 · **Task:** LFH-182
(Epic LFH-178 „Karten-Verwaltung im Admin-UI") · **Branch:** `feat/lfh-182-style-tile-proxy`

## Problem / Motivation

Online-Basemap-Quellen werden heute **direkt vom Browser** geladen: `GET /api/karte/config`
liefert je Quelle eine Upstream-`url`, die MapLibre 1:1 verwendet (Vektor: Style-JSON-URL;
Raster: `{z}/{y}/{x}`-Template). Damit lassen sich **key-basierte Anbieter** (MapTiler, Stadia)
nicht sicher nutzen — der Key stünde im Klartext im Browser.

**Ziel:** Ein **serverseitiger Style-/Tile-Proxy**. Eine Quelle kann optional „über den Server"
laufen; das Frontend spricht dann nur relative `/api/karte/proxy/…`-Endpunkte an, der Server holt
vom Upstream und reicht durch. Der **Key bleibt server-seitig** und taucht nie im Browser auf.

### Einordnung / veraltete Prämisse des Tasks

Der ursprüngliche Task-Kontext („Heute stehen Online-URLs direkt im Frontend-**Bundle**") stammt
aus der Zeit vor LFH-179. Seit LFH-179 kommen die URLs **zur Laufzeit aus der DB** (Registry
startet leer), und alle eingebauten Katalog-Quellen sind **schlüssellos**. Das Akzeptanzkriterium
„keine Upstream-URLs/Keys im **Bundle**" ist damit bereits erfüllt. Der reale Mehrwert dieses
Tasks ist enger: **Keys verbergen**, damit key-basierte Anbieter überhaupt nutzbar werden.

**Es gibt aktuell keinen key-basierten Konsumenten.** Dieser Baustein wird bewusst als
**Vorbereitung** gebaut (Nutzer-Entscheidung 2026-06-27, „generisch / cross-host"). Der Umfang
ist entsprechend an Korrektheit/Robustheit ausgerichtet, nicht an einem konkreten Anbieter.

## Architektur-Kernidee

Eine **proxied Quelle** ist für MapLibre **transparent**: `/api/karte/config` liefert für sie
statt der Upstream-URL eine **relative** `/api/karte/proxy/{id}/…`-URL. Der Server lädt alle
Assets (Style-JSON, TileJSON, Tiles, Sprite, Glyphs) vom Upstream und streamt sie durch. Keys
leben ausschließlich server-seitig (DB). **Cross-Host:** ein proxied Vektor-Style darf Assets auf
beliebigen Hosts referenzieren (Style auf Host A, Tiles auf B, Sprite auf C).

Der gesamte Mehraufwand liegt im **Backend**. Das Frontend bleibt praktisch unverändert, weil
proxied Quellen wie normale (jetzt relative, same-origin) Quellen aussehen.

## 1. Opt-in-Modell (pro Quelle)

- Neue Spalte `proxy INTEGER NOT NULL DEFAULT 0 CHECK (proxy IN (0,1))` auf
  `karte_online_quelle`.
- **Schlüssellose Katalog-Quellen** (OpenFreeMap, basemap.de, TopPlusOpen) bleiben `proxy=0` →
  laufen **direkt** wie bisher. Kein Server-Traffic, kein ToS-Redistributor-Risiko, keine
  unnötige Latenz.
- Key-basierte Quellen: Admin legt die **volle Upstream-URL inkl. Key** in `url` ab und setzt
  `proxy=1`.
- Für `proxy=1`-Quellen wird `url` **nie** über `/api/karte/config` serialisiert (öffentlicher
  Endpunkt). Die Admin-Liste (`GET /api/karte/online-quellen`, admin-only) zeigt `url` weiterhin
  — der Admin hat sie selbst eingegeben und muss sie editieren können.
- `proxy` ist **backend-only**: der Frontend-`OnlineStyle`-Typ (`{name,url,typ,attribution}`)
  bleibt unverändert. Das Frontend erfährt nur die fertig umgeschriebene relative `url`.

## 2. `/config`-Rewrite

`GET /api/karte/config` (Handler `routes::karte::config`) schreibt pro aktiver Online-Quelle:

| Quelle | Ausgegebene `url` |
|---|---|
| `proxy=0` | unverändert (Upstream-URL wie heute) |
| `proxy=1`, `typ=vektor` | `/api/karte/proxy/{id}/style.json` |
| `proxy=1`, `typ=raster` | `/api/karte/proxy/{id}/raster/{z}/{x}/{y}` |

`attribution` bleibt unverändert (config-autoritativ, Frontend zeigt sie via
`customAttribution`). Die Pflicht-Attribution gilt für proxied Quellen genau wie für direkte.

## 3. Proxy-Endpunkte

Alle Proxy-Endpunkte sind **öffentlich** (kein Auth-Extractor) — wie `/api/karte/config` und
`/api/karte/tiles.pmtiles`. Begründung: die Basemap muss für jeden Karten-Nutzer laden, und die
Endpunkte können **nur** server-vorgegebene Ziele treffen (gespeicherte `url` bzw. recordete
Slots), nie client-gelieferte URLs. Admin-CRUD bleibt admin-only.

- `GET /api/karte/proxy/{id}/style.json`
  Holt den Upstream-Style (gespeicherte `url` inkl. Key), parst JSON, **schreibt jede absolute
  http(s)-URL im Dokument** auf Proxy-Slot-URLs um und liefert key-freies Style-JSON zurück.
  Rewrite ist **fail-safe**: lieber eine URL zu viel umschreiben als einen Key durchlassen.
  `Cache-Control: no-cache` (klein, bei Bedarf neu geholt).

- `GET /api/karte/proxy/{id}/raster/{z}/{x}/{y}`
  Substituiert z/x/y **namensbasiert** in die gespeicherte Template-`url` (respektiert
  `{z}/{y}/{x}`-Reihenfolge und `{-y}`/TMS), fetcht, streamt. Kein Slot nötig (genau ein
  Template = die gespeicherte `url`).

- `GET /api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}`
  Tiles aus Vektor-/Raster-Sources eines Styles. `slot` → Upstream-Tile-Template (inkl. Key);
  z/x/y namensbasiert substituiert.

- `GET /api/karte/proxy/{id}/tilejson/{slot}`
  TileJSON-Indirektion (`source.url`). Wird wie style.json geholt + rekursiv rewritten
  (enthält `tiles: [...]`-Templates → Tile-Slots).

- `GET /api/karte/proxy/{id}/sprite/{rest}`
  Sprite. MapLibre hängt `.json` / `.png` / `@2x.json` / `@2x.png` an die Sprite-Basis an; der
  Suffix muss **vor** den Upstream-Query geschoben werden (`…/sprite.png?key=K`).

- `GET /api/karte/proxy/{id}/glyphs/{slot}/{fontstack}/{range}`
  Glyphs. `slot` → Upstream-Glyphs-Template (`{fontstack}/{range}.pbf?key=K`); `fontstack`
  (kann Kommas/Leerzeichen enthalten) und `range` namensbasiert substituiert.

### Platzhalter-Umfang v1

Tile-/Raster-Templates: `{z}`, `{x}`, `{y}`, `{-y}` (TMS). Nicht v1: `{quadkey}`,
`{bbox-epsg-3857}`, `{ratio}` (selten bei key-basierten Vektor/Raster-XYZ-Anbietern;
dokumentierte Lücke, additiv nachrüstbar). Glyphs: `{fontstack}`, `{range}`.

## 4. Slot-Map (cross-host-tragend)

Cross-Host bedeutet: ein Asset-Request kann nicht aus einer einzelnen gespeicherten Basis
rekonstruiert werden. Daher eine **persistente Zuordnung** opaker Slot-IDs auf Upstream-URLs.

```sql
CREATE TABLE karte_proxy_asset (
    id           INTEGER PRIMARY KEY,
    quelle_id    INTEGER NOT NULL REFERENCES karte_online_quelle(id) ON DELETE CASCADE,
    upstream_url TEXT    NOT NULL,           -- inkl. Key; NUR server-seitig
    art          TEXT    NOT NULL            -- 'static'|'template'|'tilejson'|'sprite'|'glyphs'
                 CHECK (art IN ('static','template','tilejson','sprite','glyphs')),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (quelle_id, upstream_url)
);
```

- Beim Style-/TileJSON-Fetch wird je referenzierter Upstream-URL ein Slot **geupsertet**
  (`INSERT … ON CONFLICT(quelle_id, upstream_url) DO UPDATE … RETURNING id`, dedup via UNIQUE),
  der Client sieht nur die `id` (opaker Integer).
- `art` validiert beim Abruf, dass ein Slot über den **richtigen** Endpunkt kommt (ein
  Sprite-Slot darf nicht als Tile geladen werden) — Defense-in-Depth.
- **Cleanup:** Slots werden bei Quelle-**Update** (URL kann sich ändern → alte Slots stale) und
  Quelle-**Delete** entfernt. Delete zusätzlich per `ON DELETE CASCADE`, aber wir löschen auch
  explizit (FK-Enforcement in SQLite ist PRAGMA-abhängig — nicht allein darauf verlassen).
- **In-Memory-Cache** (`slot → upstream_url`) vor der Tabelle für heiße Tile-Lookups
  (`Arc<RwLock<HashMap>>`-Muster wie `download_fortschritt`), invalidiert bei Update/Delete.

*Alternative (verworfen):* rein in-memory Slot-Map — verliert beim Server-Neustart die Zuordnung;
bereits geladene Karten würden Tiles erst nach Style-Reload wieder bekommen. Wegen langlebiger
ELW-Sessions DB-gestützt.

*Alternative (verworfen):* key-gestrippte URL + HMAC im Pfad — erspart die Tabelle, erfordert aber
Key-Strippen + anbieter-/host-abhängige Re-Injektion + stabiles Server-Secret. Die Slot-Map
verbirgt Keys ohne jede Key-Param-Logik und ist konzeptionell einfacher.

## 5. Sicherheit

- **Key-Hiding:** Keys leben ausschließlich in `karte_online_quelle.url` und
  `karte_proxy_asset.upstream_url` (beide server-seitig in der DB). Kein Endpunkt serialisiert
  sie an den Client. Der Style-Rewrite ist fail-safe (alle absoluten URLs werden umgeschrieben).
- **SSRF:** **jeder** Upstream-Fetch (style.json, tilejson, tile, raster, sprite, glyphs) läuft
  durch `url_ist_sicher` + den Redirect-je-Hop-prüfenden Client (wiederverwendet aus
  `karte::download`). Schützt auch gegen einen **kompromittierten/böswilligen Upstream**, der z.B.
  `sprite: "http://169.254.169.254/…"` zurückgibt — die geparsten Sub-URLs werden vor dem Fetch
  ebenso geprüft.
- **Kein Open-Proxy:** Clients können nur (a) existierende Slots der Quelle oder (b) das
  gespeicherte Raster-Template treffen — **nie** eine client-gelieferte Ziel-URL. Slot-IDs sind
  opake Integer, an `quelle_id` gebunden.
- **Dedizierter `proxy_client`** (`reqwest::Client`): moderate Timeouts inkl. **Gesamt-Timeout**
  (Assets sind klein — anders als der GB-Download-Client, der bewusst keinen Globaltimeout hat).
  Größenlimit pro Asset gegen Speicher-Blowup.

## 6. Frontend

Praktisch **keine** funktionale Änderung am Karten-Rendering:

- `baueOnlineStyle` (`basemapStil.ts`) reicht bei Vektor die (jetzt relative) `url` durch;
  `rasterStyle` setzt das (jetzt relative) Tile-Template in `tiles: [...]`. Beide same-origin →
  **Bonus: keine CORS-Probleme**.
- Relative Style-URL ggf. mit `window.location.origin` absolutieren (wie `offlineStyle` es für
  die pmtiles-URL bereits tut), falls MapLibre die Style-URL nicht selbst gegen `location` auflöst
  — in der Umsetzung verifizieren.
- **Admin-UI:** ein „Über Server proxen"-Schalter (`<Switch>`/`<Checkbox>`) im
  Online-Quelle-Formular (`OnlineQuelleFormModal` o. ä.), gemappt auf das neue `proxy`-Feld. Kurzer
  Hinweistext: „Key bleibt auf dem Server, nur relative URLs im Browser."

## 7. Backend-Komponenten (Schnitt)

- **`src/karte/proxy.rs`** (neu): reine, unit-testbare Bausteine —
  - `proxy_client()` (dedizierter reqwest-Client).
  - Style-/TileJSON-**Rewrite-Walker**: nimmt JSON + eine Slot-Vergabe-Closure, ersetzt jede
    absolute http(s)-URL strukturabhängig (sources[].tiles → template-Slots, sprite-Key →
    sprite-Slot, glyphs-Key → glyphs-Slot, sources[].url → tilejson-Slot, sonstige → static-Slot)
    durch die passende `/api/karte/proxy/{id}/…`-URL. Tile-Template-Erkennung via Platzhalter.
  - Template-Substitution (`{z}/{x}/{y}/{-y}`, `{fontstack}/{range}`).
- **`src/karte/registry/repo.rs`**: `proxy`-Spalte in `OnlineQuelle`/`OnlineQuelleEingabe` +
  Queries; Slot-Map-CRUD (`slot_upsert`, `slot_aufloesen`, `slots_loeschen(quelle_id)`).
- **`src/routes/karte.rs`**: `OnlineQuelleBody`+`validiere_online` um `proxy` erweitern (SSRF-Check
  der `url` beim Speichern für `proxy=1`); `config`-Rewrite; die Proxy-Handler.
- **`src/app.rs`**: Routen registrieren; ggf. Slot-Cache-Feld im `AppState`.
- **Migration** `migrations/00XX_karte_proxy.sql` (additiv: `ALTER TABLE … ADD COLUMN proxy` +
  `CREATE TABLE karte_proxy_asset`). Rein additiv → kein CHECK-Rebuild.

## 8. Tests (TDD)

- **Rein (unit):**
  - Rewrite-Walker: alle absoluten URLs → Slots, Tile-Templates korrekt als Template erkannt,
    Ergebnis-JSON **key-frei**; relative/`pmtiles:`-URLs unangetastet.
  - Template-Substitution: `{z}/{y}/{x}`-Reihenfolge, `{-y}`-TMS, `{fontstack}/{range}`.
  - Sprite-Suffix-Einschub vor den Query.
- **Integration (Loopback-Fixture wie `download.rs`):**
  - Kette style.json → sprite → glyphs → tile gegen einen lokalen Fixture-Upstream; geprüft,
    dass der **Key nie** in der Client-Antwort steht und Slots korrekt auflösen.
  - SSRF: Upstream-Style mit interner Sub-URL → Sub-Fetch wird abgelehnt.
- **Repo:** Slot upsert/dedup/auflösen/purge (per Quelle), `proxy`-Spalte CRUD.
- **`/config`-Rewrite:** `proxy=1` verbirgt `url` und gibt die relative Proxy-URL aus (Vektor +
  Raster); `proxy=0` unverändert.
- **Frontend:** `basemapStil`-Unit (relative Proxy-URL wird durchgereicht/zum Raster-Template);
  Admin-Form mappt `proxy`.

## 9. Akzeptanzkriterien (aus dem Task, präzisiert)

- Eine `proxy=1`-Quelle liefert über `/config` **nur** relative `/api/karte/proxy/…`-URLs; die
  Upstream-`url` inkl. Key erscheint nirgends in einer client-gerichteten Antwort.
- Online-Views funktionieren weiter: `proxy=0` unverändert direkt; `proxy=1` Vektor **und** Raster
  rendern über den Proxy (empirisch verifiziert, siehe unten).
- Pflicht-Attribution bleibt config-autoritativ und auch für proxied Quellen sichtbar.

## 10. Verifikation (verification-before-completion)

Echter Beweis: eine key-basierte Vektor-Quelle (z.B. MapTiler-Style-URL mit Test-Key) als
`proxy=1` anlegen, Lagekarte öffnen, im Browser-Netzwerk-Tab prüfen: (a) Karte rendert (Tiles +
Sprite + Glyphs laden über `/api/karte/proxy/…`), (b) **kein** Request geht an den Upstream-Host,
(c) der Key steht in **keiner** vom Browser geladenen Ressource. Ohne Test-Key ersatzweise gegen
einen Loopback-Fixture-Upstream, der einen vollständigen Vektor-Style (style+sprite+glyphs+tiles)
nachstellt.

## Referenzen

- `src/routes/karte.rs` (`config`, `tiles`, Online-CRUD), `src/config.rs` (`OnlineStyle`)
- `src/karte/download.rs` (`url_ist_sicher`, Redirect-Policy, reqwest-Client — wiederverwendet)
- `src/karte/registry/repo.rs`, `migrations/0076_karte_registry.sql`
- `frontend/src/api/karte.ts`, `frontend/src/pages/lagekarte/basemapStil.ts`
- `docs/superpowers/specs/2026-06-26-karten-verwaltung-admin-ui-design.md` (Epic-Design, LFH-182
  als optionaler Baustein)
