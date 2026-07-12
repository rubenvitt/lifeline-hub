//! Serverseitiger Tile-Cache (LFH-190) vor `proxy::hole_asset` für binäre Assets
//! (Tiles/Sprite/Glyphs). Liegt in einer **separaten** SQLite-Datei (`<karten_dir>/tile-cache.db`)
//! mit eigenem Pool — damit hochfrequente Tile-Writes im Einsatz NICHT gegen operative Writes
//! (Lagebericht/Meldung/ETB) um den Single-Writer der Haupt-DB konkurrieren.
//!
//! Respektiert die Upstream-Caching-Header (`Cache-Control`/`ETag`), revalidiert bedingt
//! (`If-None-Match` → 304), serviert bei Upstream-Ausfall den (Stale-)Cache weiter
//! (Resilienz, passt zur Offline-DNA) und evictet per LRU unter einem Größen-Cap. Cache-Fehler
//! sind NIE fatal: Lesen → Miss, Schreiben → ignoriert.

use crate::karte::proxy::{self, AssetAntwort, ProxyFehler, Revalidiert};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Cache-Obergrenze (Summe der Bytes). Keine eigene CLI-Option (Konvention LFH-179: sinnvoller
/// Default statt Flag-Wildwuchs).
pub const TILE_CACHE_CAP_BYTES: i64 = 256 * 1024 * 1024;

/// Eviction läuft nur jede N-te Schreiboperation (O(n)-SUM nicht pro Miss; Überschuss ≤ N×Tile).
const EVICT_INTERVALL: u64 = 16;
static EVICT_ZAEHLER: AtomicU64 = AtomicU64::new(0);

/// `letzter_zugriff` wird bei einem Hit nur fortgeschrieben, wenn er älter als diese Schwelle ist
/// — sonst würde jeder *Lese*-Zugriff zu einem Write (heiße Tiles ≤ 1 Write/Stunde).
const BERUEHR_SCHWELLE_SEK: i64 = 3600;

// ===== Cacheability =====

/// Ableitung aus dem Upstream-`Cache-Control`, ob/wie lange gecacht werden darf.
#[derive(Debug, PartialEq, Eq)]
pub enum CachePlan {
    /// Nicht cachen (`no-store`/`private`/kein `Cache-Control`).
    Nicht,
    /// Cachen mit TTL in Sekunden (`no-cache`/`max-age=0` → `ttl: 0` → immer revalidieren).
    Cachen { ttl: i64 },
}

/// Parst `Cache-Control` zu einem `CachePlan`. `s-maxage` (shared cache) hat Vorrang vor `max-age`.
pub fn cache_plan(cache_control: Option<&str>) -> CachePlan {
    let Some(cc) = cache_control else {
        return CachePlan::Nicht;
    };
    let cc = cc.to_ascii_lowercase();
    let direktiven: Vec<&str> = cc.split(',').map(str::trim).collect();
    if direktiven
        .iter()
        .any(|d| *d == "no-store" || *d == "private")
    {
        return CachePlan::Nicht;
    }
    if direktiven.contains(&"no-cache") {
        return CachePlan::Cachen { ttl: 0 };
    }
    let s_maxage = direktiven.iter().find_map(|d| {
        d.strip_prefix("s-maxage=")
            .and_then(|v| v.parse::<i64>().ok())
    });
    let max_age = direktiven.iter().find_map(|d| {
        d.strip_prefix("max-age=")
            .and_then(|v| v.parse::<i64>().ok())
    });
    match s_maxage.or(max_age) {
        Some(n) if n > 0 => CachePlan::Cachen { ttl: n },
        Some(_) => CachePlan::Cachen { ttl: 0 }, // max-age=0 → revalidieren
        None => CachePlan::Nicht,
    }
}

/// Cache-Schlüssel: SHA256-Hex der finalen Upstream-URL (inkl. Key). Speichert KEINEN Klartext.
fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(s.as_bytes());
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Unix-Sekunden (Produktion). Tests übergeben `now` explizit (deterministisch).
pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ===== Pool (per-Pfad memoisiert — kein AppState-Feld, LFH-182-Lektion) =====

static POOLS: OnceLock<Mutex<HashMap<PathBuf, SqlitePool>>> = OnceLock::new();

fn pools() -> &'static Mutex<HashMap<PathBuf, SqlitePool>> {
    POOLS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn schema_anlegen(pool: &SqlitePool) -> sqlx::Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tile_cache (\
             schluessel       TEXT    PRIMARY KEY, \
             bytes            BLOB    NOT NULL, \
             content_type     TEXT    NOT NULL, \
             content_encoding TEXT, \
             etag             TEXT, \
             expires_at       INTEGER NOT NULL, \
             groesse          INTEGER NOT NULL, \
             letzter_zugriff  INTEGER NOT NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_tile_cache_lru ON tile_cache (letzter_zugriff)")
        .execute(pool)
        .await?;
    Ok(())
}

/// Liefert den (memoisierten) Cache-Pool für ein `karten_dir`. Erzeugt DB-Datei + Schema beim
/// ersten Aufruf. Per-Pfad ⇒ Tests mit eigenem Temp-`karten_dir` sind isoliert. Hält den std-Mutex
/// NIE über ein `await` (`!Send`, LFH-Memory) → Doppel-Check.
pub async fn cache_pool(karten_dir: &Path) -> sqlx::Result<SqlitePool> {
    let pfad = karten_dir.join("tile-cache.db");
    {
        let map = pools().lock().unwrap();
        if let Some(p) = map.get(&pfad) {
            return Ok(p.clone());
        }
    }
    let _ = std::fs::create_dir_all(karten_dir);
    let pool = SqlitePoolOptions::new()
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&pfad)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal),
        )
        .await?;
    schema_anlegen(&pool).await?;
    let mut map = pools().lock().unwrap();
    Ok(map.entry(pfad).or_insert(pool).clone())
}

// ===== Speicher-Operationen (Fehler nie fatal) =====

struct CacheRow {
    bytes: Vec<u8>,
    content_type: String,
    content_encoding: Option<String>,
    etag: Option<String>,
    expires_at: i64,
}

/// Tupel-Form einer Cache-Zeile beim Laden (Reihenfolge = SELECT-Spalten).
type LadeTupel = (Vec<u8>, String, Option<String>, Option<String>, i64);

async fn lade(pool: &SqlitePool, schluessel: &str) -> Option<CacheRow> {
    let row: Option<LadeTupel> = sqlx::query_as(
        "SELECT bytes, content_type, content_encoding, etag, expires_at \
         FROM tile_cache WHERE schluessel = ?",
    )
    .bind(schluessel)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Tile-Cache: Lesefehler: {e}");
        None
    });
    row.map(
        |(bytes, content_type, content_encoding, etag, expires_at)| CacheRow {
            bytes,
            content_type,
            content_encoding,
            etag,
            expires_at,
        },
    )
}

async fn speichere(
    pool: &SqlitePool,
    schluessel: &str,
    a: &AssetAntwort,
    expires_at: i64,
    now: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT OR REPLACE INTO tile_cache \
         (schluessel, bytes, content_type, content_encoding, etag, expires_at, groesse, letzter_zugriff) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(schluessel)
    .bind(a.bytes.as_slice())
    .bind(&a.content_type)
    .bind(a.content_encoding.as_deref())
    .bind(a.etag.as_deref())
    .bind(expires_at)
    .bind(a.bytes.len() as i64)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Hit-Zugriff fortschreiben — nur wenn der alte Zugriff hinreichend alt ist (write-sparsam).
async fn beruehre(pool: &SqlitePool, schluessel: &str, now: i64) {
    let _ = sqlx::query(
        "UPDATE tile_cache SET letzter_zugriff = ? \
         WHERE schluessel = ? AND ? - letzter_zugriff > ?",
    )
    .bind(now)
    .bind(schluessel)
    .bind(now)
    .bind(BERUEHR_SCHWELLE_SEK)
    .execute(pool)
    .await;
}

async fn aktualisiere_frische(
    pool: &SqlitePool,
    schluessel: &str,
    expires_at: i64,
    now: i64,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE tile_cache SET expires_at = ?, letzter_zugriff = ? WHERE schluessel = ?")
        .bind(expires_at)
        .bind(now)
        .bind(schluessel)
        .execute(pool)
        .await?;
    Ok(())
}

/// Evictet den ältesten (per `letzter_zugriff`) Eintrag, bis `SUM(groesse) <= cap`.
async fn evict_falls_noetig(pool: &SqlitePool, cap: i64) -> sqlx::Result<()> {
    let total: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(groesse), 0) FROM tile_cache")
        .fetch_one(pool)
        .await?;
    if total <= cap {
        return Ok(());
    }
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT schluessel, groesse FROM tile_cache ORDER BY letzter_zugriff ASC")
            .fetch_all(pool)
            .await?;
    let mut rest = total;
    for (schluessel, groesse) in rows {
        if rest <= cap {
            break;
        }
        sqlx::query("DELETE FROM tile_cache WHERE schluessel = ?")
            .bind(&schluessel)
            .execute(pool)
            .await?;
        rest -= groesse;
    }
    Ok(())
}

/// Gedrosselte Eviction: nur jede `EVICT_INTERVALL`-te Schreiboperation prüft den Cap.
async fn evict_throttled(pool: &SqlitePool, cap: i64) {
    if EVICT_ZAEHLER
        .fetch_add(1, Ordering::Relaxed)
        .is_multiple_of(EVICT_INTERVALL)
    {
        if let Err(e) = evict_falls_noetig(pool, cap).await {
            tracing::warn!("Tile-Cache: Eviction-Fehler: {e}");
        }
    }
}

/// Baut die Auslieferungs-Antwort aus einem Cache-Eintrag: `Cache-Control: public, max-age=<Rest>`
/// (≥0), ETag durchgereicht → Browser cacht weiter korrekt.
fn aus_cache(row: CacheRow, now: i64) -> AssetAntwort {
    let rest = (row.expires_at - now).max(0);
    AssetAntwort {
        bytes: row.bytes,
        content_type: row.content_type,
        content_encoding: row.content_encoding,
        cache_control: Some(format!("public, max-age={rest}")),
        etag: row.etag,
    }
}

async fn speichere_falls_cachebar(pool: &SqlitePool, schluessel: &str, a: &AssetAntwort, now: i64) {
    if let CachePlan::Cachen { ttl } = cache_plan(a.cache_control.as_deref()) {
        if speichere(pool, schluessel, a, now + ttl, now).await.is_ok() {
            evict_throttled(pool, TILE_CACHE_CAP_BYTES).await;
        } else {
            tracing::warn!("Tile-Cache: Schreibfehler (ignoriert)");
        }
    }
}

// ===== Service =====

/// Cache-bewusster `hole_asset`: Hit (frisch) → Cache; stale + ETag → bedingt revalidieren
/// (304 → Cache); stale ohne ETag → neu holen; Upstream-Fehler bei stale → Stale-on-error.
/// Miss → holen + (falls cachebar) speichern.
pub async fn hole_asset_cached(
    cache_pool: &SqlitePool,
    client: &reqwest::Client,
    url: reqwest::Url,
    byte_cap: usize,
    now: i64,
) -> Result<AssetAntwort, ProxyFehler> {
    let schluessel = sha256_hex(url.as_str());
    if let Some(mut row) = lade(cache_pool, &schluessel).await {
        if now < row.expires_at {
            beruehre(cache_pool, &schluessel, now).await; // frisch → Hit
            return Ok(aus_cache(row, now));
        }
        if let Some(etag) = row.etag.clone() {
            match proxy::hole_asset_revalidiert(client, url.clone(), byte_cap, &etag).await {
                Ok(Revalidiert::NichtVeraendert { cache_control }) => {
                    let ttl = match cache_plan(cache_control.as_deref()) {
                        CachePlan::Cachen { ttl } => ttl,
                        CachePlan::Nicht => 0,
                    };
                    row.expires_at = now + ttl;
                    let _ =
                        aktualisiere_frische(cache_pool, &schluessel, row.expires_at, now).await;
                    return Ok(aus_cache(row, now));
                }
                Ok(Revalidiert::Frisch(a)) => {
                    speichere_falls_cachebar(cache_pool, &schluessel, &a, now).await;
                    return Ok(a);
                }
                // Upstream-Ausfall → Stale-on-error (Resilienz, Offline-DNA).
                Err(_) => return Ok(aus_cache(row, now)),
            }
        }
        // stale ohne ETag → neu holen; Fehler → Stale-on-error.
        return match proxy::hole_asset(client, url, byte_cap).await {
            Ok(a) => {
                speichere_falls_cachebar(cache_pool, &schluessel, &a, now).await;
                Ok(a)
            }
            Err(_) => Ok(aus_cache(row, now)),
        };
    }
    // Miss.
    let a = proxy::hole_asset(client, url, byte_cap).await?;
    speichere_falls_cachebar(cache_pool, &schluessel, &a, now).await;
    Ok(a)
}

/// Cache-bewusster Asset-Abruf, der den Cache-Pool selbst beschafft. Schlägt die Beschaffung
/// fehl (korrupte/nicht öffenbare `tile-cache.db`, volle Platte), wird auf einen Direkt-Fetch
/// OHNE Cache degradiert — **Cache-Fehler sind NIE fatal** (Modulvertrag, s. o.): eine verwerfbare
/// Cache-Datei darf zu „kein Caching" führen, nicht zu „keine Kacheln" (sonst stürbe der ganze
/// Online-Proxy ab, obwohl der Direkt-Fetch funktioniert).
pub async fn hole_asset_via_cache_oder_direkt(
    karten_dir: &Path,
    client: &reqwest::Client,
    url: reqwest::Url,
    byte_cap: usize,
    now: i64,
) -> Result<AssetAntwort, ProxyFehler> {
    match cache_pool(karten_dir).await {
        Ok(pool) => hole_asset_cached(&pool, client, url, byte_cap, now).await,
        Err(e) => {
            tracing::warn!("Tile-Cache: Pool nicht verfügbar ({e}), Direkt-Fetch ohne Cache");
            proxy::hole_asset(client, url, byte_cap).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;

    async fn test_cache_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        schema_anlegen(&pool).await.unwrap();
        pool
    }

    /// Loopback-Upstream mit **Hit-Zähler** + `If-None-Match`→304-Unterstützung (keystone:
    /// beweist, dass ein Cache-Hit den Upstream NICHT erneut trifft).
    async fn spawn_zaehlend(
        cache_control: &'static str,
        etag: Option<&'static str>,
        body: Vec<u8>,
    ) -> (String, Arc<AtomicU64>) {
        use axum::{body::Body, http::HeaderMap, response::Response, routing::get, Router};
        let hits = Arc::new(AtomicU64::new(0));
        let h = hits.clone();
        let app = Router::new().route(
            "/t",
            get(move |headers: HeaderMap| {
                let body = body.clone();
                let h = h.clone();
                async move {
                    h.fetch_add(1, Ordering::SeqCst);
                    let inm = headers.get("if-none-match").and_then(|v| v.to_str().ok());
                    if let (Some(inm), Some(et)) = (inm, etag) {
                        if inm == et {
                            return Response::builder()
                                .status(304)
                                .header("cache-control", cache_control)
                                .body(Body::empty())
                                .unwrap();
                        }
                    }
                    let mut b = Response::builder()
                        .status(200)
                        .header("content-type", "application/x-protobuf")
                        .header("cache-control", cache_control);
                    if let Some(et) = etag {
                        b = b.header("etag", et);
                    }
                    b.body(Body::from(body)).unwrap()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://127.0.0.1:{}/t", addr.port()), hits)
    }

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn cache_plan_regeln() {
        assert_eq!(cache_plan(None), CachePlan::Nicht);
        assert_eq!(cache_plan(Some("")), CachePlan::Nicht);
        assert_eq!(cache_plan(Some("no-store")), CachePlan::Nicht);
        assert_eq!(cache_plan(Some("private, max-age=300")), CachePlan::Nicht);
        assert_eq!(
            cache_plan(Some("public, max-age=300")),
            CachePlan::Cachen { ttl: 300 }
        );
        assert_eq!(cache_plan(Some("no-cache")), CachePlan::Cachen { ttl: 0 });
        assert_eq!(cache_plan(Some("max-age=0")), CachePlan::Cachen { ttl: 0 });
        assert_eq!(
            cache_plan(Some("PUBLIC, MAX-AGE=120")),
            CachePlan::Cachen { ttl: 120 }
        );
        // s-maxage hat Vorrang vor max-age (shared cache).
        assert_eq!(
            cache_plan(Some("public, s-maxage=600, max-age=60")),
            CachePlan::Cachen { ttl: 600 }
        );
    }

    #[test]
    fn sha256_hex_stabil() {
        assert_eq!(sha256_hex("https://h/x?key=K").len(), 64);
        assert_eq!(sha256_hex("a"), sha256_hex("a"));
        assert_ne!(sha256_hex("a"), sha256_hex("b"));
    }

    #[tokio::test]
    async fn miss_dann_hit_trifft_upstream_nicht_erneut() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let (u, hits) =
            spawn_zaehlend("public, max-age=300", Some("\"v1\""), b"TILE".to_vec()).await;

        let a1 = hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(a1.bytes, b"TILE");
        assert_eq!(hits.load(Ordering::SeqCst), 1, "Miss → ein Upstream-Call");

        // Innerhalb der TTL → Cache-Hit, KEIN zweiter Upstream-Call (keystone).
        let a2 = hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1100)
            .await
            .unwrap();
        assert_eq!(a2.bytes, b"TILE");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "Hit darf den Upstream NICHT erneut treffen"
        );
    }

    #[tokio::test]
    async fn no_store_wird_nicht_gecacht() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let (u, hits) = spawn_zaehlend("no-store", None, b"X".to_vec()).await;
        hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1001)
            .await
            .unwrap();
        assert_eq!(
            hits.load(Ordering::SeqCst),
            2,
            "no-store → kein Cache, jeder Abruf trifft Upstream"
        );
    }

    #[tokio::test]
    async fn stale_mit_etag_revalidiert_und_serviert_cache() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        // max-age=0 → sofort stale; ETag vorhanden → bedingte Revalidierung.
        let (u, hits) = spawn_zaehlend("public, max-age=0", Some("\"v1\""), b"BODY".to_vec()).await;

        let a1 = hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(a1.bytes, b"BODY");
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // stale → If-None-Match → 304 (Body leer) → Cache wird serviert.
        let a2 = hole_asset_cached(&pool, &client, url(&u), 1 << 20, 1001)
            .await
            .unwrap();
        assert_eq!(a2.bytes, b"BODY", "304 → gecachte Bytes serviert");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            2,
            "Revalidierung trifft Upstream (aber nur 304)"
        );
    }

    #[tokio::test]
    async fn stale_on_error_serviert_cache_bei_upstream_ausfall() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        // Eintrag direkt anlegen: bereits stale (expires in der Vergangenheit), mit ETag.
        let a = AssetAntwort {
            bytes: b"ALT".to_vec(),
            content_type: "application/x-protobuf".into(),
            content_encoding: None,
            cache_control: Some("public, max-age=300".into()),
            etag: Some("\"v1\"".into()),
        };
        let schluessel = sha256_hex("http://127.0.0.1:1/tot");
        speichere(&pool, &schluessel, &a, 500, 400).await.unwrap();

        // Upstream tot (Port 1 → connection refused) → Revalidierung scheitert → Stale serviert.
        let erg = hole_asset_cached(&pool, &client, url("http://127.0.0.1:1/tot"), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(erg.bytes, b"ALT", "Upstream-Ausfall → Stale-on-error");
    }

    #[tokio::test]
    async fn eviction_loescht_aeltesten_bis_unter_cap() {
        let pool = test_cache_pool().await;
        let mk = |n: u8| AssetAntwort {
            bytes: vec![n; 100],
            content_type: "x".into(),
            content_encoding: None,
            cache_control: Some("public, max-age=300".into()),
            etag: None,
        };
        // 3×100 Bytes, distinkte letzter_zugriff (now=1,2,3).
        speichere(&pool, "a", &mk(1), 9999, 1).await.unwrap();
        speichere(&pool, "b", &mk(2), 9999, 2).await.unwrap();
        speichere(&pool, "c", &mk(3), 9999, 3).await.unwrap();

        evict_falls_noetig(&pool, 250).await.unwrap(); // muss auf ≤250 → ältesten (a) löschen
        let rest: Vec<String> =
            sqlx::query_scalar("SELECT schluessel FROM tile_cache ORDER BY schluessel")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rest,
            vec!["b", "c"],
            "ältester (a, niedrigster letzter_zugriff) evictet"
        );
    }

    #[tokio::test]
    async fn pool_fehler_degradiert_auf_direkt_fetch() {
        // `karten_dir` unter eine reguläre DATEI legen → cache_pool() kann dort keine
        // tile-cache.db anlegen (Parent ist kein Verzeichnis → ENOTDIR) → Err. Erwartung: KEIN
        // Fehler nach außen, sondern Direkt-Fetch (Cache-Fehler sind nie fatal, Modulvertrag).
        let client = reqwest::Client::new();
        let (u, hits) = spawn_zaehlend("public, max-age=300", None, b"DIRECT".to_vec()).await;
        let tmp = tempfile::tempdir().unwrap();
        let datei = tmp.path().join("eine-datei");
        std::fs::write(&datei, b"x").unwrap();
        let karten_dir = datei.join("unterhalb"); // Parent ist eine Datei → unbaubar

        let a = hole_asset_via_cache_oder_direkt(&karten_dir, &client, url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(
            a.bytes, b"DIRECT",
            "Pool-Fehler → Direkt-Fetch liefert die Bytes"
        );
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "genau ein Upstream-Call (Direkt-Fetch)"
        );
    }
}
