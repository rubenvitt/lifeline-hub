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
  Endpunkt). Die Verwaltungsliste (`GET /api/karte/online-quellen`) ist **nicht admin-only** —
  `darf_admin_bereich()` schließt **Führungskräfte** (read-only) ein. Daher maskiert `online_liste`
  die `url` einer `proxy=1`-Quelle, **wenn der Benutzer nicht `ist_admin()`** ist; nur der echte
  Admin (der die URL eingegeben hat und editieren muss) sieht sie voll. (Korrigiert die frühere
  „admin-only"-Annahme.)
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

**Repo-Konsequenz:** Das heutige `aktive_online_styles()` liefert nur `name,url,typ,attribution`
(→ `OnlineStyle`) — **ohne `id`/`proxy`**, der Config-Handler könnte den Rewrite damit gar nicht
durchführen (sonst stünde der Klartext-Key default-mäßig öffentlich im `/config`). Daher ein neuer
Query `aktive_online_quellen_fuer_config()`, der zusätzlich `id` und `proxy` liefert; der Handler
baut daraus die (ggf. umgeschriebene) `OnlineStyle`-Liste. `aktive_online_styles()` wird ersetzt
(alter Unit-Test angepasst).

## 3. Proxy-Endpunkte

Alle Proxy-Endpunkte sind **öffentlich** (kein Auth-Extractor) — wie `/api/karte/config` und
`/api/karte/tiles.pmtiles`. Begründung: die Basemap muss für jeden Karten-Nutzer laden, und die
Endpunkte können **nur** server-vorgegebene Ziele treffen (gespeicherte `url` bzw. recordete
Slots), nie client-gelieferte URLs. Admin-CRUD bleibt admin-only.

- `GET /api/karte/proxy/{id}/style.json`
  Holt den Upstream-Style (gespeicherte `url` inkl. Key), parst JSON, schreibt **strukturell** nur
  bekannte Asset-Positionen auf Proxy-Slot-URLs um (siehe §5 Key-Hiding), **neutralisiert** absolute
  URLs an unbekannten Positionen, absolutiert relative Asset-Refs gegen die Style-Basis-URL, läuft
  durch den `contains_secret`-Backstop (fail-closed) und liefert key-freies Style-JSON.
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

## 5. Sicherheit (gehärtet nach adversarialer Design-Review)

- **Key-Hiding (mehrschichtig):**
  - Keys leben ausschließlich in `karte_online_quelle.url` und `karte_proxy_asset.upstream_url`
    (beide server-seitig in der DB). Kein client-gerichteter Endpunkt serialisiert sie.
  - **Rewrite ist strukturell-zuerst** (NICHT „alle absoluten URLs → Slot"): nur **bekannte
    Asset-Positionen** werden zu fetchbaren Slots (`sources[].tiles`→template,
    `sources[].url`→tilejson, `sprite`, `glyphs`, `sources[].data`→static). Absolute URLs an
    **unbekannten** Positionen werden **neutralisiert** (Schlüssel/Wert entfernt) — nie zu einem
    fetchbaren Slot. Das verbindet Key-Entfernung mit Open-Proxy-Schutz.
  - **Backstop `contains_secret` (fail-closed):** vor dem Ausliefern wird das serialisierte
    style.json/tilejson gegen die **Query-Param-Werte** der gespeicherten Upstream-URL gescannt;
    Treffer → Fehler statt Auslieferung. *Ehrliche Grenze:* Keys in Pfadsegmenten/Subdomains
    sind so nicht zuverlässig scanbar — dokumentierte Restgrenze, nicht „vollständig".
- **SSRF (auflösend + pinnend — Spec-Korrektur):** Das frühere Versprechen „`url_ist_sicher`
  schützt" war **unvollständig**: `url_ist_sicher` prüft nur **IP-Literale**, nicht aufgelöste
  Hostnamen. Das `http://169.254…`-Beispiel ist durch https-only ohnehin tot; die reale Lücke ist
  **`https://rebind.evil/` → interne IP** (Name→intern + DNS-Rebinding). Fix:
  - Ein **auflösender, pinnender DNS-Resolver** (`reqwest 0.13.4 ClientBuilder::dns_resolver` +
    `reqwest::dns::Resolve`-Trait, API verifiziert): löst den Host selbst auf, prüft **alle**
    A/AAAA gegen `ip_ist_intern` und gibt nur public IPs an reqwest zurück → reqwest connectet
    exakt auf diese Adressen, **kein Re-Resolve/Rebind-Fenster**. Greift auch in der Redirect-Policy.
  - `url_ist_sicher` bleibt als Schema-/Literal-Pre-Check **vor jedem** Fetch (style, tilejson,
    tile, raster, sprite, glyphs, geojson-data) — schützt auch gegen einen **kompromittierten
    Upstream**, der `sprite: "https://intern/…"` zurückgibt.
- **Kein Ziel-Open-Proxy:** Clients können nur (a) existierende Slots der Quelle (an `quelle_id`
  UND `art` gebunden) oder (b) das gespeicherte Raster-Template treffen — **nie** eine
  client-gelieferte Ziel-URL. Slot-IDs sind opake Integer.
- **Param-Injection-Guards:** `z/x/y` als `i64`-`Path`; `range` strikt `^\d+-\d+$`; `fontstack`
  auf erlaubte Zeichen whitelisten und **pro Komma-Segment percent-encodieren**; sprite-`rest`
  gegen feste Suffix-Allowlist (`@2x?\.(json|png)`). Keine rohe Konkatenation client-gelieferter
  Segmente in die Upstream-URL.
- **Antwort-Hygiene (`hole_asset`):** Content-Type, **Content-Encoding** (gzip/br verbatim — kein
  serverseitiges Dekomprimieren), ETag/Last-Modified/Cache-Control per **Allowlist** durchreichen;
  gefährliche Typen (`text/html`, `text/*`) auf `application/octet-stream` +
  `X-Content-Type-Options: nosniff` klemmen (Anti-XSS). `Location`/`Set-Cookie` strippen; bei
  non-2xx generischer Fehler **ohne** Upstream-Body. **Byte-Cap** pro Asset (Content-Length nicht
  vertrauen) gegen Speicher-Blowup.
- **Dedizierter `proxy_client`:** moderate Timeouts inkl. **Gesamt-Timeout** (Assets sind klein —
  anders als der GB-Download-Client ohne Globaltimeout). Nutzt den pinnenden Resolver.
- **DoS-Grenze beim Rewrite:** harte Obergrenze umgeschriebener URLs/Slots pro Style (z.B. 500) →
  darüber Rewrite-Abbruch (Quelle als fehlerhaft behandeln); Slot-Tabelle wächst nicht unbegrenzt.
- **Volumen-Open-Proxy (bewusste Grenze):** die unauthentifizierten Endpunkte können den
  abgerechneten Upstream-Key durch Volumen drainieren. v1 begrenzt sich aufs Billige (Tiles reichen
  Upstream-`Cache-Control`/`ETag` durch → Browser/CDN absorbieren Wiederholungen);
  serverseitiges Style-Caching/Rate-Limiting ist **OUT-OF-SCOPE** (kein Key-Konsument vorhanden) —
  als Bedrohungslage hier dokumentiert.

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

- **`src/karte/proxy.rs`** (neu): reine, unit-testbare Bausteine + nicht-validierende Service-Schicht —
  - **URL-Bauer:** `proxy_config_url(id,typ)` und `proxy_url(id, art, …)` (5 Client-Formen,
    **root-relativ** mit führendem `/`).
  - **Rewrite-Walker** (`rewrite_style`, `rewrite_tilejson`): nimmt JSON + Slot-Vergabe-Closure,
    schreibt **strukturell** (nur bekannte Positionen) auf Slots um, **neutralisiert** unbekannt
    positionierte absolute URLs, absolutiert relative Refs gegen die Style-Basis, mit
    Slot-Obergrenze (DoS). `ist_absolute_http_url` (https/HTTPS/protokoll-relativ, lehnt
    relative/`pmtiles:`/`mapbox:` ab). `contains_secret(json, upstream_url)` Backstop.
  - **Substitution:** `subst_template` (`{z}/{x}/{y}` namensbasiert + `{-y}`/TMS, roher String
    behält `{…}`), `subst_glyphs` (`{fontstack}` percent-encodet pro Segment, `{range}`),
    `validiere_range`, `validiere_fontstack`, `sprite_upstream` (Suffix vor den Query),
    `split_slot_suffix`.
  - **SSRF-Resolver:** `sicherer_resolver` (auflösend+pinnend, `reqwest::dns::Resolve`) und
    `proxy_client()` (dedizierter reqwest-Client **mit** Gesamt-Timeout, nutzt den Resolver).
  - **Service-Schicht (nicht-validierend, Loopback-testbar wie `download::lade_datei`):**
    `hole_asset` (Bytes + hygienisierte Header), `hole_style`/`hole_tilejson` (fetch + rewrite +
    Slots minten + fail-closed). Das SSRF-Gate (`url_ist_sicher` + Resolver) sitzt im **Handler**.
- **`src/karte/download.rs`**: `ssrf_redirect_policy()` aus `download_client()` herausziehen, damit
  der `proxy_client` die per-Hop-Prüfung teilt (bestehendes Verhalten unverändert/grün).
- **`src/karte/registry/repo.rs`**: `proxy`-Spalte in `OnlineQuelle`/`OnlineQuelleEingabe` +
  Queries; neuer `aktive_online_quellen_fuer_config()` (mit `id`+`proxy`, ersetzt
  `aktive_online_styles`); Slot-Map-CRUD (`slot_upsert` via `ON CONFLICT(quelle_id,upstream_url)
  DO UPDATE SET art RETURNING id`, `slot_aufloesen(quelle_id,slot,art)`,
  `slots_loeschen(quelle_id)`).
- **`src/routes/karte.rs`**: `OnlineQuelleBody`+`OnlineQuelleEingabe`+`validiere_online` um `proxy`
  erweitern. Für `proxy=1`: `url` **roh** (getrimmt) speichern (kein `Url`-Roundtrip — `url`-crate
  percent-encodet `{}`); SSRF-Check via `url_ist_sicher` auf einer **materialisierten Probe**
  (z=0/x=0/y=0 bzw. style-URL); **unbekannte `{…}`-Platzhalter ablehnen** (422, fail-fast).
  `online_liste` maskiert `url` für `proxy=1` wenn nicht `ist_admin()`. `config`-Rewrite. Die
  Proxy-Handler (öffentlich; prüfen Quelle existiert + `proxy=1` + `aktiv`, sonst 404; SSRF-Gate
  vor jedem Fetch).
- **`src/app.rs` + `src/main.rs` + `tests/*.rs`**: Routen registrieren; **ein gruppiertes
  `ProxyState{client, slots}`-Feld** im `AppState` (genau eine Zeile je Konstruktionsstelle —
  mechanischer, compile-getriebener Rollout wie der LFH-181-`download_client`; `rg`-Stellenliste
  vorab). `slots` = In-Memory-Cache (`Arc<RwLock<HashMap>>`) vor der Slot-Tabelle.
- **Migration** `migrations/0077_karte_proxy.sql` (additiv: `ALTER TABLE karte_online_quelle ADD
  COLUMN proxy …` + `CREATE TABLE karte_proxy_asset …`). Rein additiv → kein CHECK-Rebuild.
  **Vor Merge** gegen den dann-aktuellen `migrations/`-Stand re-prüfen (0077 könnte mit einem
  Parallel-Branch kollidieren → ggf. höher umbenennen).

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

## Nachtrag 2026-06-27 (Umsetzung + adversariale Review + Browser-Smoke)

Abweichungen/Präzisierungen gegenüber dem Design oben, aus der Umsetzung und der Multi-Agent-Review:

- **Proxy-Client als Prozess-Singleton** (`OnceLock`), **kein** `AppState`-Feld (vermeidet ~45
  Konstruktionsstellen). **In-Memory-Slot-Cache entfällt in v1** (DB-Read pro Tile ist lokal
  schnell, kein Live-Konsument) — dokumentierte Vereinfachung.
- **Slot-Identität inkl. `art`:** `UNIQUE (quelle_id, upstream_url, art)` (Review #5), sonst macht
  `ON CONFLICT DO UPDATE SET art` eine Asset-Art unauflösbar.
- **`contains_secret` scannt nur Query-Werte ≥12 Zeichen** (`MIN_SECRET_LEN`, Review #2) — sonst
  False-Positive-fail-closed durch kurze benigne Params (`v=1`).
- **Key-Log-Hygiene:** Upstream-Fetch-Fehler via `reqwest::Error::without_url()` (Review #1), sonst
  landet `?key=…` in der geloggten Fehlermeldung.
- **SSRF:** `ip_ist_intern` fängt zusätzlich **IPv6-eingebettetes IPv4** (NAT64/6to4/compat,
  Review #4).
- **Walker schont fremde URI-Schemata** (`ist_proxybar`: mapbox:/pmtiles:/data: unangetastet,
  Review #6).
- **Frontend `transformRequest`** (`absolutiereProxyAnfrage`): MapLibre lädt Tiles im Worker ohne
  Dokument-Base → root-relative `/api/karte/proxy/…`-URLs scheitern dort. Im **Browser-Smoke gegen
  OpenFreeMap** gefunden und behoben (1052 Features gerendert).
- **Verifikations-Grenze (offen):** Der Browser-Render-Beweis lief mit injiziertem CDN-MapLibre +
  Inline-`transformRequest`, nicht mit dem App-Bundle + `Kartenflaeche`-Wiring (tsc-typisiert,
  trivial). Voll schließen, sobald die erste echte keybasierte Quelle hinzugefügt wird.

## Referenzen

- `src/routes/karte.rs` (`config`, `tiles`, Online-CRUD), `src/config.rs` (`OnlineStyle`)
- `src/karte/download.rs` (`url_ist_sicher`, Redirect-Policy, reqwest-Client — wiederverwendet)
- `src/karte/registry/repo.rs`, `migrations/0076_karte_registry.sql`
- `frontend/src/api/karte.ts`, `frontend/src/pages/lagekarte/basemapStil.ts`
- `docs/superpowers/specs/2026-06-26-karten-verwaltung-admin-ui-design.md` (Epic-Design, LFH-182
  als optionaler Baustein)
