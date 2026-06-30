# Karten-Proxy default-an + serverseitiger Tile-Cache (LFH-190)

> Folge zu LFH-182 (Server-Proxy für Style/Tile, shipped). Baut direkt auf `src/karte/proxy.rs`.

**Goal:** Proxy wird Default für neue Online-Quellen, und der Server **cacht** die Anbieter-
Antworten (Tiles/Sprite/Glyphs), damit derselbe Kachel-Abruf den Anbieter nicht erneut trifft.

**Architecture:** Ein SQLite-gestützter Byte-Cache vor `hole_asset` (binäre Assets), in einer
**separaten** DB-Datei (`<karten_dir>/tile-cache.db`) mit eigenem Pool — damit Tile-Writes im
Einsatz NICHT gegen operative Writes (Lagebericht/Meldung/ETB) um den SQLite-Single-Writer der
Haupt-DB konkurrieren. Respektiert Upstream-`Cache-Control`/`ETag`, revalidiert bedingt
(If-None-Match → 304), evictet per LRU unter einem Größen-Cap. Style/TileJSON bleiben **uncached**.

---

## Global Constraints (aus LFH-182 + Projekt)

- Backend Rust/axum, **sqlx 0.9** (`&'static str`-SQL — Spaltenlisten je Query als Literal), SQLite.
- reqwest ohne gzip-Feature — Bytes + `Content-Encoding` werden **roh** durchgereicht UND **roh** gecacht.
- clippy-Baseline Backend = 21 Warnungen (keine neuen). Frontend `eslint --max-warnings 0`.
- Gates ehrlich via `rtk proxy <cmd>`. Proxy-Endpunkte PUBLIC; SSRF-Gate bleibt im Handler.
- **Keine AppState-Felder** (51 Konstruktionsstellen, LFH-182-Lektion) — Cache-Pool wird global
  per-Pfad memoisiert, abgeleitet aus `state.karten_dir` (trägt AppState bereits).
- **Kein neues Migrations-File** — Cache-Tabelle lebt in der separaten Cache-DB
  (`CREATE TABLE IF NOT EXISTS` bei Pool-Init); proxy-default-an passiert app-seitig (s. u.).

---

## 1. Proxy als Default — ohne Migration

Der DB-Spalten-Default (`proxy … DEFAULT 0`) wird im App-Code **nie getroffen** (jeder INSERT
setzt `proxy` explizit). „Default an" passiert deshalb app-seitig, ohne Schemaänderung:

- **API:** `OnlineQuelleBody.proxy` → `#[serde(default = "wahr")] proxy: bool` (Weglassen ⇒ `true`).
- **Frontend `OnlineQuelleFormModal`:** Switch für **neue** Quellen `defaultChecked`/Form-`initialValues`
  `proxy: true`; beim Bearbeiten den gespeicherten Wert. Alert ergänzen: „Proxy nur aktivieren, wenn
  der Anbieter Proxying/Caching erlaubt — z. B. **OSM-Standard-Tiles verbieten es**."
- **`AusKatalogModal`:** Default `proxy: true` **nur**, wenn der Server-Katalog keine proxy-verbotenen
  Anbieter (OSM-Standard `tile.openstreetmap.org`) enthält. Vor dem Flip Server-Katalog prüfen; bei
  Mischbestand per-Eintrag respektieren (konservativ `false` für die verbotenen), sonst `true`.
- **Bestandsquellen bleiben unverändert** (kein Massen-Flip — bewusst direkte/OSM-Quellen nicht kippen).

## 2. Tile-Cache — separate DB + Schema (kein Migrations-File)

Cache-DB: `<karten_dir>/tile-cache.db`, eigener `SqlitePool` (WAL, foreign_keys irrelevant). Schema
bei Pool-Init:

```sql
CREATE TABLE IF NOT EXISTS tile_cache (
    schluessel       TEXT    PRIMARY KEY,   -- sha256(hex) der finalen Upstream-URL (inkl. Key) — kein Klartext-Leak
    bytes            BLOB    NOT NULL,
    content_type     TEXT    NOT NULL,
    content_encoding TEXT,                  -- roh durchgereicht (z. B. gzip)
    etag             TEXT,                  -- If-None-Match-Revalidierung
    expires_at       INTEGER NOT NULL,      -- Unix-Sek.; fetched_at + max-age (no-cache → 0)
    groesse          INTEGER NOT NULL,      -- = length(bytes), Cap/LRU ohne BLOB-Read
    letzter_zugriff  INTEGER NOT NULL       -- Unix-Sek., LRU-Schlüssel
);
CREATE INDEX IF NOT EXISTS idx_tile_cache_lru ON tile_cache (letzter_zugriff);
```

- **Pool-Memoisierung ohne AppState-Churn:** `OnceLock<std::sync::Mutex<HashMap<PathBuf, SqlitePool>>>`.
  `cache_pool(karten_dir)`: lock → vorhanden? clone+return : unlock → Pool async erzeugen + Schema →
  lock → insert-if-absent → clone. **std-Mutex NIE über `await` halten** (`!Send`, LFH-Memory) →
  Doppel-Check. Per-Pfad ⇒ Tests mit eigenem Temp-`karten_dir` sind isoliert.
- **Cap:** `const TILE_CACHE_CAP_BYTES: i64 = 256 * 1024 * 1024`. Keine CLI-Option (Konvention LFH-179).

## 3. Cacheability (Upstream-`Cache-Control` parsen)

`hole_asset` liefert `cache_control`/`etag`. `cache_plan(cache_control) -> CachePlan`:

- **`no-store`** oder **`private`** → `Nicht` (shared Cache respektiert `private`; ToS-bewusst).
- **`no-cache`** → `Cachen { ttl: 0 }` (immer revalidieren vor Auslieferung).
- **`max-age=N`**, N>0 → `Cachen { ttl: N }`.
- **kein/leeres `Cache-Control`** → `Nicht` (konservativ; kein heuristisches TTL).
- Nur **2xx mit Bytes** wird gecacht (keine Fehler).

## 4. Ablauf `hole_asset_cached(cache_pool, client, url, byte_cap, now)`

`now` als Parameter (testbar; Produktion: `unix_now()`).

```
schluessel = sha256_hex(url.as_str())
eintrag = SELECT bytes,content_type,content_encoding,etag,expires_at FROM tile_cache WHERE schluessel=?
falls eintrag:
    falls now < expires_at:                       # frisch → Hit
        beruehre(schluessel, now)                  # nur UPDATE, wenn now-letzter_zugriff > 3600 (write-sparsam)
        return AssetAntwort(Cache, cache_control = max-age=(expires_at-now))
    falls eintrag.etag:                            # stale → bedingt revalidieren
        match hole_asset_revalidiert(client, url, byte_cap, eintrag.etag):
            NichtVeraendert(cc) → UPDATE expires_at = now+ttl(cc), letzter_zugriff=now; return Cache-Bytes
            Frisch(a)           → speichere(a); return a
    # stale ohne etag → Miss-Pfad
antwort = hole_asset(client, url, byte_cap)
plan = cache_plan(antwort.cache_control)
falls plan == Cachen: speichere(schluessel, antwort, now+ttl); evict(cache_pool)   # evict: every-Nth (Zähler)
return antwort
```

- **`hole_asset_revalidiert(client, url, cap, etag) -> Result<Revalidiert, ProxyFehler>`**
  (`enum Revalidiert { NichtVeraendert(Option<String> /*cache_control*/), Frisch(AssetAntwort) }`),
  sendet `If-None-Match`. 304 → ohne Body. Teilt Header-/Byte-Cap-/Klemm-Code mit `hole_asset`
  (gemeinsamer Helfer extrahieren — `.without_url()` für Fehler beibehalten, LFH-182 #1).
- **Eviction `evict`:** zählt Schreibvorgänge in einem `AtomicU64`; nur jede 16. Schreiboperation
  prüft `SUM(groesse)` und löscht in `letzter_zugriff`-Reihenfolge (ältester zuerst), bis `<= cap`.
  (O(n)-SUM nicht pro Miss; Überschuss ≤ 16×Tile gebremst.)
- **Auslieferung:** `Cache-Control` zum Client = `public, max-age=<Restlaufzeit≥0>`, `ETag`
  durchreichen, `nosniff` wie gehabt → Browser cacht weiter korrekt.

## 5. Handler-Integration

- `proxy_asset(state, u)` ruft `hole_asset_cached(&cache_pool(&state.karten_dir).await, proxy_client(), u, ASSET_BYTE_CAP, unix_now())`
  statt `hole_asset`. Betrifft `proxy_raster`/`proxy_tile`/`proxy_sprite`/`proxy_glyphs`.
- `proxy_style`/`proxy_tilejson` bleiben **unverändert** (uncached).

## 6. Bewusste v2-Grenzen (dokumentiert, kein Scope)

- **Thundering Herd:** N parallele Misses derselben Kachel → N Fetches (konvergiert). Kein Single-Flight.
- **Synchroner Cache-Write** vor der Antwort (BLOB inline) — kleine Latenz; erst async machen, wenn der
  Smoke es zeigt.
- **Style/TileJSON uncached**; **kein `Vary`** (Tiles variieren nicht nach Request-Headern).
- **`packaging.md`:** Cache (256 MB, separate DB, LRU, ETag-Revalidierung) + ToS-Pflicht pro Anbieter.

## Akzeptanz / Verifikation

- **Unit:** `cache_plan` (no-store/private/no-cache/max-age/leer); `sha256_hex`-Stabilität.
- **Service (Loopback mit Upstream-Hit-Zähler):** Miss speichert; 2. Abruf = Hit, **Upstream-Zähler
  bleibt** (keystone); `no-store` → kein Eintrag; stale+ETag → If-None-Match → 304 → Cache serviert;
  Eviction hält `SUM(groesse) ≤ cap`.
- **Route/Integration:** neue Quelle ohne `proxy` im Body ⇒ `proxy=true`; gecachte Tile-Auslieferung
  (nosniff, durchgereichte Header).
- **Browser-Smoke (OpenFreeMap, default-proxy):** Karte rendert; **2. Navigation = Cache-Hits**
  (Server-Upstream-Fetch-Zähler flach).

## Referenzen

- LFH-182: `src/karte/proxy.rs` (`hole_asset`, `AssetAntwort`, `ProxyFehler`), `src/routes/karte.rs`
  (`proxy_asset`), `migrations/0077_karte_proxy.sql`.
- Spec-Nachtrag LFH-182: `docs/superpowers/specs/2026-06-27-style-tile-proxy-design.md`.
- AppState: `src/app.rs` (`pool`, `karten_dir`); `default_karten_dir` in `src/config.rs`.
