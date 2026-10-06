//! Serverseitiger Tile-Cache (LFH-190) vor `proxy::hole_asset` für Tiles/Sprite/Glyphs. Liegt
//! in einer **separaten** SQLite-Datei (`<karten_dir>/tile-cache.db`) mit eigenem Pool, damit
//! hochfrequente Tile-Writes nicht mit operativen Writes um den Single-Writer der Haupt-DB
//! konkurrieren.
//!
//! Respektiert `Cache-Control`/`ETag`, revalidiert bedingt (`If-None-Match` → 304), serviert
//! bei Upstream-Ausfall den Stale-Cache weiter und evictet per LRU unter einem Größen-Cap.
//! Cache-Fehler sind NIE fatal: Lesen → Miss, Schreiben → ignoriert.
//!
//! Jeder Upstream-Abruf belegt einen Platz der Proxy-Grenze (`proxy::abruf_platz`); gleichzeitige
//! Misses auf dieselbe URL teilen sich einen Abruf (LFH-930).

use crate::karte::proxy::{self, AssetAntwort, ProxyFehler, Revalidiert};
use futures::future::{BoxFuture, FutureExt, Shared};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Semaphore;

/// Cache-Obergrenze in Bytes (feste Vorgabe, keine CLI-Option).
pub const TILE_CACHE_CAP_BYTES: i64 = 256 * 1024 * 1024;

/// Eviction nur jede N-te Schreiboperation (die SUM ist O(n)); Überschuss ≤ N × Tile.
const EVICT_INTERVALL: u64 = 16;
static EVICT_ZAEHLER: AtomicU64 = AtomicU64::new(0);

/// `letzter_zugriff` wird bei einem Hit nur fortgeschrieben, wenn er älter als diese Schwelle
/// ist — sonst würde jeder Lesezugriff zum Write.
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

/// Cache-Schlüssel: SHA256-Hex der finalen Upstream-URL (inkl. Key); kein Klartext.
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

// ===== Pool (per Pfad memoisiert, kein AppState-Feld) =====

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

/// Memoisierter Cache-Pool für ein `karten_dir`; legt DB-Datei und Schema beim ersten Aufruf
/// an. Per Pfad, damit Tests mit eigenem Temp-Verzeichnis isoliert sind. Der std-Mutex wird nie
/// über ein `await` gehalten (`!Send`), daher der Doppel-Check.
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

/// Auslieferungs-Antwort aus einem Cache-Eintrag: `Cache-Control: public, max-age=<Rest>` und
/// durchgereichtes ETag, damit der Browser korrekt weitercacht.
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

// ===== Bündelung gleichzeitiger Misses (LFH-930) =====

type AbrufErgebnis = Result<AssetAntwort, ProxyFehler>;
type GeteilterAbruf = Shared<BoxFuture<'static, AbrufErgebnis>>;

/// Laufende Miss-Abrufe je Cache-Schlüssel. Ein Eintrag lebt genau so lange wie sein Abruf-Task.
static INFLIGHT: OnceLock<Mutex<HashMap<String, GeteilterAbruf>>> = OnceLock::new();

fn inflight() -> &'static Mutex<HashMap<String, GeteilterAbruf>> {
    INFLIGHT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Trägt den Schlüssel beim Drop aus `INFLIGHT` aus: nach Erfolg, Fehler, Timeout und Panik des
/// Abruf-Tasks gleichermaßen, damit die Map nicht wächst.
struct Austrag(String);

impl Drop for Austrag {
    fn drop(&mut self) {
        inflight()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}

#[cfg(test)]
fn laeuft_gebuendelt(schluessel: &str) -> bool {
    inflight().lock().unwrap().contains_key(schluessel)
}

/// Miss-Pfad: Läuft für `schluessel` schon ein Abruf, wartet der Aufrufer auf dessen Ergebnis
/// (ohne eigenen Platz der Proxy-Grenze). Sonst startet er ihn als eigenen Task: der läuft auch
/// weiter, wenn der auslösende Client abbricht (begrenzt durch das Gesamt-Timeout des
/// `proxy_client`), speichert die Kachel und trägt sich danach aus.
async fn hole_gebuendelt(
    cache_pool: &SqlitePool,
    client: &reqwest::Client,
    grenze: &Arc<Semaphore>,
    url: reqwest::Url,
    byte_cap: usize,
    now: i64,
    schluessel: &str,
) -> AbrufErgebnis {
    let abruf = {
        // Kein `await` unter dem std-Mutex; `tokio::spawn` startet den Task nur.
        let mut map = inflight().lock().unwrap_or_else(|e| e.into_inner());
        match map.get(schluessel) {
            Some(laufend) => laufend.clone(),
            None => {
                let platz = proxy::abruf_platz(grenze)?;
                let (tx, rx) = tokio::sync::oneshot::channel();
                let (pool, client, key) =
                    (cache_pool.clone(), client.clone(), schluessel.to_string());
                tokio::spawn(async move {
                    // `Austrag` entsteht erst im Task (nie unter der Sperre oben) und trägt bei
                    // Panik oder Abbruch über seinen Drop aus.
                    let austrag = Austrag(key.clone());
                    let erg = proxy::hole_asset(&client, url, byte_cap).await;
                    if let Ok(a) = &erg {
                        speichere_falls_cachebar(&pool, &key, a, now).await;
                    }
                    // Erst gespeichert, dann ausgetragen: wer danach kommt, findet die Kachel im
                    // Cache. Austrag und Platz vor dem Senden, damit ein Wartender beides schon
                    // frei vorfindet.
                    drop(austrag);
                    drop(platz);
                    let _ = tx.send(erg);
                });
                let geteilt = async move {
                    rx.await.unwrap_or_else(|_| {
                        Err(ProxyFehler::Http("gebündelter Abruf abgebrochen".into()))
                    })
                }
                .boxed()
                .shared();
                map.insert(schluessel.to_string(), geteilt.clone());
                geteilt
            }
        }
    };
    abruf.await
}

/// Führt einen Upstream-Abruf nur mit einem Platz der Proxy-Grenze aus. `abruf` ist noch nicht
/// gepollt, ohne Platz geht also nichts hinaus.
async fn mit_platz<T>(
    grenze: &Arc<Semaphore>,
    abruf: impl Future<Output = Result<T, ProxyFehler>>,
) -> Result<T, ProxyFehler> {
    let _platz = proxy::abruf_platz(grenze)?;
    abruf.await
}

// ===== Service =====

/// Cache-bewusster `hole_asset`: Hit (frisch) → Cache; stale + ETag → bedingt revalidieren
/// (304 → Cache); stale ohne ETag → neu holen; Upstream-Fehler bei stale → Stale-on-error.
/// Miss → holen + (falls cachebar) speichern, gebündelt je URL ([`hole_gebuendelt`]).
///
/// Jeder Upstream-Abruf belegt einen Platz von `grenze`; ist sie erschöpft, liefert ein Miss
/// [`ProxyFehler::Ueberlast`] und ein veralteter Eintrag wird weiter serviert. Hits brauchen
/// keinen Platz.
pub async fn hole_asset_cached(
    cache_pool: &SqlitePool,
    client: &reqwest::Client,
    grenze: &Arc<Semaphore>,
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
            let revalidiert = proxy::hole_asset_revalidiert(client, url.clone(), byte_cap, &etag);
            match mit_platz(grenze, revalidiert).await {
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
                // Upstream-Ausfall oder Grenze erschöpft → Stale-on-error.
                Err(_) => return Ok(aus_cache(row, now)),
            }
        }
        // stale ohne ETag → neu holen; Fehler → Stale-on-error.
        return match mit_platz(grenze, proxy::hole_asset(client, url, byte_cap)).await {
            Ok(a) => {
                speichere_falls_cachebar(cache_pool, &schluessel, &a, now).await;
                Ok(a)
            }
            Err(_) => Ok(aus_cache(row, now)),
        };
    }
    // Miss.
    hole_gebuendelt(cache_pool, client, grenze, url, byte_cap, now, &schluessel).await
}

/// Cache-bewusster Asset-Abruf, der den Pool selbst beschafft. Scheitert das (korrupte
/// `tile-cache.db`, volle Platte), wird auf einen Direkt-Fetch ohne Cache degradiert: eine
/// verwerfbare Cache-Datei darf zu „kein Caching“ führen, nicht zu „keine Kacheln“.
pub async fn hole_asset_via_cache_oder_direkt(
    karten_dir: &Path,
    client: &reqwest::Client,
    grenze: &Arc<Semaphore>,
    url: reqwest::Url,
    byte_cap: usize,
    now: i64,
) -> Result<AssetAntwort, ProxyFehler> {
    match cache_pool(karten_dir).await {
        Ok(pool) => hole_asset_cached(&pool, client, grenze, url, byte_cap, now).await,
        Err(e) => {
            tracing::warn!("Tile-Cache: Pool nicht verfügbar ({e}), Direkt-Fetch ohne Cache");
            mit_platz(grenze, proxy::hole_asset(client, url, byte_cap)).await
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

    /// Loopback-Upstream mit Hit-Zähler und `If-None-Match`→304; belegt, dass ein Cache-Hit den
    /// Upstream nicht erneut trifft.
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

    /// Eigene Grenze je Test, damit parallele Tests sich nicht die prozessweite teilen.
    fn grenze() -> Arc<Semaphore> {
        Arc::new(Semaphore::new(proxy::MAX_GLEICHZEITIGE_PROXY_ABRUFE))
    }

    /// Loopback-Upstream, der jede Anfrage `verzoegerung` lang hält, bevor er cachebar antwortet;
    /// zählt die Treffer. Pfade sind frei (`/a`, `/b` …), damit ein Test mehrere URLs hat.
    async fn spawn_langsam(verzoegerung: std::time::Duration) -> (String, Arc<AtomicU64>) {
        use axum::{response::IntoResponse, Router};
        let hits = Arc::new(AtomicU64::new(0));
        let h = hits.clone();
        let app = Router::new().fallback(move || {
            let h = h.clone();
            async move {
                h.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(verzoegerung).await;
                (
                    [
                        ("content-type", "application/x-protobuf"),
                        ("cache-control", "public, max-age=300"),
                    ],
                    b"LANGSAM".to_vec(),
                )
                    .into_response()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://127.0.0.1:{}", addr.port()), hits)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn gleichzeitige_misses_buendeln_zu_einem_abruf() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = grenze();
        let (basis, hits) = spawn_langsam(std::time::Duration::from_millis(300)).await;
        let u = url(&format!("{basis}/kachel"));

        let abrufe =
            (0..8).map(|_| hole_asset_cached(&pool, &client, &grenze, u.clone(), 1 << 20, 1000));
        let ergebnisse = futures::future::join_all(abrufe).await;
        for e in ergebnisse {
            assert_eq!(e.unwrap().bytes, b"LANGSAM");
        }
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "8 gleichzeitige Misses → ein Upstream-Abruf"
        );
        assert!(
            !laeuft_gebuendelt(&sha256_hex(u.as_str())),
            "Eintrag nach Erfolg ausgetragen"
        );
        assert_eq!(
            grenze.available_permits(),
            proxy::MAX_GLEICHZEITIGE_PROXY_ABRUFE,
            "Platz wieder frei"
        );

        // Der Leader hat gespeichert: der nächste Abruf ist ein Hit.
        hole_asset_cached(&pool, &client, &grenze, u, 1 << 20, 1001)
            .await
            .unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn gebuendelter_abruf_traegt_sich_auch_nach_fehler_aus() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = grenze();
        let u = url("http://127.0.0.1:1/tot-gebuendelt");
        let (a, b) = tokio::join!(
            hole_asset_cached(&pool, &client, &grenze, u.clone(), 1 << 20, 1000),
            hole_asset_cached(&pool, &client, &grenze, u.clone(), 1 << 20, 1000),
        );
        assert!(matches!(a, Err(ProxyFehler::Http(_))), "{a:?}");
        assert!(matches!(b, Err(ProxyFehler::Http(_))), "{b:?}");
        assert!(
            !laeuft_gebuendelt(&sha256_hex(u.as_str())),
            "Eintrag nach Fehler ausgetragen"
        );
        assert_eq!(
            grenze.available_permits(),
            proxy::MAX_GLEICHZEITIGE_PROXY_ABRUFE
        );
    }

    #[tokio::test]
    async fn erschoepfte_grenze_weist_miss_sofort_ab_und_serviert_hits() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = Arc::new(Semaphore::new(1));

        // Ein Hit, der vorher im Cache liegt.
        let hit_url = url("http://127.0.0.1:1/im-cache");
        let a = AssetAntwort {
            bytes: b"HIT".to_vec(),
            content_type: "application/x-protobuf".into(),
            content_encoding: None,
            cache_control: Some("public, max-age=300".into()),
            etag: None,
        };
        speichere(&pool, &sha256_hex(hit_url.as_str()), &a, 9999, 1000)
            .await
            .unwrap();

        // Der einzige Platz hängt an einem Upstream, der nicht antwortet.
        let (basis, hits) = spawn_langsam(std::time::Duration::from_secs(600)).await;
        let haengend = url(&format!("{basis}/haengt"));
        let (p, c, g, h) = (
            pool.clone(),
            client.clone(),
            grenze.clone(),
            haengend.clone(),
        );
        let _hintergrund =
            tokio::spawn(async move { hole_asset_cached(&p, &c, &g, h, 1 << 20, 1000).await });
        while hits.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        assert_eq!(grenze.available_permits(), 0);

        // Ein Miss auf eine andere Kachel: sofort Überlast, ohne Upstream-Abruf.
        let erg = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            hole_asset_cached(
                &pool,
                &client,
                &grenze,
                url(&format!("{basis}/andere")),
                1 << 20,
                1000,
            ),
        )
        .await
        .expect("sofort abgewiesen, nicht gestaut");
        assert!(matches!(erg, Err(ProxyFehler::Ueberlast)), "{erg:?}");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "kein zweiter Upstream-Abruf"
        );

        // Ein Wartender auf die hängende Kachel braucht keinen Platz (bündelt sich an).
        assert!(laeuft_gebuendelt(&sha256_hex(haengend.as_str())));

        // Der Hit kommt trotz erschöpfter Grenze.
        let treffer = hole_asset_cached(&pool, &client, &grenze, hit_url, 1 << 20, 1001)
            .await
            .unwrap();
        assert_eq!(treffer.bytes, b"HIT");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn wartende_auf_gebuendelten_abruf_brauchen_keinen_platz() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = Arc::new(Semaphore::new(1));
        let (basis, hits) = spawn_langsam(std::time::Duration::from_millis(300)).await;
        let u = url(&format!("{basis}/ein-platz"));
        let (a, b) = tokio::join!(
            hole_asset_cached(&pool, &client, &grenze, u.clone(), 1 << 20, 1000),
            hole_asset_cached(&pool, &client, &grenze, u.clone(), 1 << 20, 1000),
        );
        assert_eq!(a.unwrap().bytes, b"LANGSAM");
        assert_eq!(
            b.unwrap().bytes,
            b"LANGSAM",
            "der Wartende bekommt keine 503"
        );
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn abgebrochener_ausloeser_laesst_abruf_zu_ende_laufen() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = grenze();
        let (basis, hits) = spawn_langsam(std::time::Duration::from_millis(300)).await;
        let u = url(&format!("{basis}/abbruch"));
        let schluessel = sha256_hex(u.as_str());

        let (p, c, g, uu) = (pool.clone(), client.clone(), grenze.clone(), u.clone());
        let ausloeser =
            tokio::spawn(async move { hole_asset_cached(&p, &c, &g, uu, 1 << 20, 1000).await });
        while hits.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        ausloeser.abort(); // Client bricht ab.

        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while laeuft_gebuendelt(&schluessel)
                || grenze.available_permits() < proxy::MAX_GLEICHZEITIGE_PROXY_ABRUFE
            {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Eintrag ausgetragen und Platz frei");

        // Der Abruf lief zu Ende und hat gespeichert: der nächste ist ein Hit.
        let a = hole_asset_cached(&pool, &client, &grenze, u, 1 << 20, 1001)
            .await
            .unwrap();
        assert_eq!(a.bytes, b"LANGSAM");
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn erschoepfte_grenze_serviert_veralteten_eintrag_ohne_etag() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = Arc::new(Semaphore::new(0));
        let (basis, hits) = spawn_langsam(std::time::Duration::from_millis(1)).await;
        let u = url(&format!("{basis}/stale-ohne-etag"));
        let a = AssetAntwort {
            bytes: b"ALT".to_vec(),
            content_type: "application/x-protobuf".into(),
            content_encoding: None,
            cache_control: Some("public, max-age=300".into()),
            etag: None,
        };
        speichere(&pool, &sha256_hex(u.as_str()), &a, 500, 400)
            .await
            .unwrap();
        let erg = hole_asset_cached(&pool, &client, &grenze, u, 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(erg.bytes, b"ALT", "ohne Platz → Stale-on-error");
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn erschoepfte_grenze_serviert_veralteten_eintrag() {
        let pool = test_cache_pool().await;
        let client = reqwest::Client::new();
        let grenze = Arc::new(Semaphore::new(0));
        let (basis, hits) = spawn_langsam(std::time::Duration::from_millis(1)).await;
        let u = url(&format!("{basis}/stale"));
        let a = AssetAntwort {
            bytes: b"ALT".to_vec(),
            content_type: "application/x-protobuf".into(),
            content_encoding: None,
            cache_control: Some("public, max-age=300".into()),
            etag: Some("\"v1\"".into()),
        };
        // Abgelaufen, mit ETag: würde revalidiert.
        speichere(&pool, &sha256_hex(u.as_str()), &a, 500, 400)
            .await
            .unwrap();
        let erg = hole_asset_cached(&pool, &client, &grenze, u, 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(erg.bytes, b"ALT", "ohne Platz → Stale-on-error");
        assert_eq!(
            hits.load(Ordering::SeqCst),
            0,
            "kein Upstream-Abruf ohne Platz"
        );
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

        let a1 = hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(a1.bytes, b"TILE");
        assert_eq!(hits.load(Ordering::SeqCst), 1, "Miss → ein Upstream-Call");

        // Innerhalb der TTL → Cache-Hit ohne zweiten Upstream-Call.
        let a2 = hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1100)
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
        hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1001)
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

        let a1 = hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1000)
            .await
            .unwrap();
        assert_eq!(a1.bytes, b"BODY");
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // stale → If-None-Match → 304 (Body leer) → Cache wird serviert.
        let a2 = hole_asset_cached(&pool, &client, &grenze(), url(&u), 1 << 20, 1001)
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
        let erg = hole_asset_cached(
            &pool,
            &client,
            &grenze(),
            url("http://127.0.0.1:1/tot"),
            1 << 20,
            1000,
        )
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
        // `karten_dir` unter einer regulären Datei → `cache_pool()` scheitert (ENOTDIR). Erwartet
        // wird kein Fehler, sondern ein Direkt-Fetch.
        let client = reqwest::Client::new();
        let (u, hits) = spawn_zaehlend("public, max-age=300", None, b"DIRECT".to_vec()).await;
        let tmp = tempfile::tempdir().unwrap();
        let datei = tmp.path().join("eine-datei");
        std::fs::write(&datei, b"x").unwrap();
        let karten_dir = datei.join("unterhalb"); // Parent ist eine Datei → unbaubar

        let a = hole_asset_via_cache_oder_direkt(
            &karten_dir,
            &client,
            &grenze(),
            url(&u),
            1 << 20,
            1000,
        )
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
