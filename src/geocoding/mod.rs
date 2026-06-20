//! Geocoding & Peilung für die Koordinaten-Plausibilitätsprüfung (LFH Ort-Vorschau).
//!
//! Zwei Schichten:
//! - `peilung` — reine Mathematik (Haversine + 8-Strich-Bearing) zum nächsten bekannten
//!   verorteten Einsatz-Marker. Funktioniert IMMER offline, ohne externen Dienst.
//! - Reverse-Geocoding (Phase 2) — ergänzt einen Ortsnamen über einen konfigurierbaren
//!   Nominatim-kompatiblen Dienst, mit hartem Timeout, Token-Bucket-Rate-Limit und Cache.
//!
//! DATENSCHUTZ (bewusste Abwägung, Stil der GK-~3m-Grenze in `frontend/.../koordinaten.ts`):
//! Der Default-Geocoder (öffentlicher Nominatim) sendet die Einsatz-Koordinate an einen
//! Dritt-Server — anders als die bestehenden *Pulls* öffentlicher Warndaten (NINA/DWD/Pegel).
//! Der Cache-Key wird auf ~100 m gerundet (Nachbarpunkte teilen einen Eintrag). Admins können
//! eine eigene Geocoder-URL hinterlegen. Die Peilung kommt ohne jeden externen Dienst aus.

pub mod peilung;
pub mod marker;
pub mod cache;

use sqlx::SqlitePool;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Öffentlicher Nominatim als Default-Geocoder (Admin kann pro Org überschreiben).
pub const NOMINATIM_DEFAULT: &str = "https://nominatim.openstreetmap.org";

/// Harter Timeout je Geocoder-Anfrage — die Peilung wartet nie aufs Netz.
const GEOCODER_TIMEOUT: Duration = Duration::from_millis(1500);

/// Token-Bucket-Rate-Limit gegen den Geocoder (Nominatim-ToS: ≤ 1 req/s).
struct Statics {
    client: reqwest::Client,
    bucket: Mutex<TokenBucket>,
}

static STATICS: OnceLock<Statics> = OnceLock::new();

fn statics() -> &'static Statics {
    STATICS.get_or_init(|| Statics {
        client: reqwest::Client::builder()
            .timeout(GEOCODER_TIMEOUT)
            .user_agent("LifelineHub-Geocoder/1.0 (+https://github.com/)")
            .build()
            .expect("reqwest-Client baubar"),
        bucket: Mutex::new(TokenBucket::neu(1.0, 1.0)),
    })
}

/// Einfacher Token-Bucket (max. `kapazitaet` Tokens, Nachfüllrate `rate_pro_sek`).
pub struct TokenBucket {
    tokens: f64,
    kapazitaet: f64,
    rate_pro_sek: f64,
    zuletzt: Instant,
}

impl TokenBucket {
    pub fn neu(rate_pro_sek: f64, kapazitaet: f64) -> Self {
        Self { tokens: kapazitaet, kapazitaet, rate_pro_sek, zuletzt: Instant::now() }
    }

    /// Ein Token nehmen, falls verfügbar; füllt vorher zeitanteilig nach.
    pub fn try_take(&mut self) -> bool {
        let jetzt = Instant::now();
        let verstrichen = jetzt.duration_since(self.zuletzt).as_secs_f64();
        self.tokens = (self.tokens + verstrichen * self.rate_pro_sek).min(self.kapazitaet);
        self.zuletzt = jetzt;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Reverse-Geocoding (prod): nutzt den prozess-globalen Client + Token-Bucket.
pub async fn reverse(pool: &SqlitePool, base_url: &str, lat: f64, lon: f64) -> Option<String> {
    let s = statics();
    reverse_mit(&s.client, &s.bucket, pool, base_url, lat, lon).await
}

/// Reverse-Geocoding (injizierbar, für Tests). Reihenfolge: Cache → Rate-Limit → HTTP.
/// Cache-Treffer umgeht Rate-Limit UND Timeout. Jeder Fehlerpfad liefert `None`.
pub async fn reverse_mit(
    client: &reqwest::Client,
    bucket: &Mutex<TokenBucket>,
    pool: &SqlitePool,
    base_url: &str,
    lat: f64,
    lon: f64,
) -> Option<String> {
    let (lat_key, lon_key) = cache::schluessel(lat, lon);

    // 1. Cache.
    if let Some(name) = cache::lese(pool, lat_key, lon_key).await {
        return Some(name);
    }

    // 2. Rate-Limit: überzählig → None (Peilung kommt ja sowieso).
    if !bucket.lock().unwrap().try_take() {
        return None;
    }

    // 3. HTTP (mit dem hart getimeouteten Client).
    let url = format!(
        "{}/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=18&accept-language=de",
        base_url.trim_end_matches('/')
    );
    let name = match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(v) => v.get("display_name").and_then(|n| n.as_str()).map(String::from),
            Err(e) => {
                tracing::debug!("Geocoder-JSON-Parse fehlgeschlagen: {e}");
                None
            }
        },
        Ok(resp) => {
            tracing::debug!("Geocoder HTTP {}", resp.status());
            None
        }
        Err(e) => {
            tracing::debug!("Geocoder-Fetch fehlgeschlagen: {e}");
            None
        }
    };

    // 4. Erfolg cachen.
    if let Some(n) = &name {
        if !n.is_empty() {
            cache::schreibe(pool, lat_key, lon_key, n).await;
        }
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_erlaubt_eines_dann_sperrt() {
        let mut b = TokenBucket::neu(1.0, 1.0);
        assert!(b.try_take()); // erstes Token
        assert!(!b.try_take()); // sofort danach gesperrt
    }

    /// Startet einen Mini-HTTP-Stub auf einem Ephemeral-Port; liefert (base_url, handle).
    async fn stub(antwort: serde_json::Value) -> (String, tokio::task::JoinHandle<()>) {
        let app = axum::Router::new().route(
            "/reverse",
            axum::routing::get(move || {
                let a = antwort.clone();
                async move { axum::Json(a) }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        (format!("http://{addr}"), handle)
    }

    /// Ephemeral-Port binden und sofort freigeben → garantiert refused Connection (Offline).
    fn geschlossener_port() -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        format!("http://127.0.0.1:{port}")
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1500))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn erfolg_liefert_display_name_und_cached() {
        let pool = crate::db::test_pool().await;
        let (base, _h) = stub(serde_json::json!({ "display_name": "Hauptstr. 5, Musterstadt" })).await;
        let bucket = Mutex::new(TokenBucket::neu(1.0, 1.0));
        let name = reverse_mit(&test_client(), &bucket, &pool, &base, 51.1604, 10.4514).await;
        assert_eq!(name.as_deref(), Some("Hauptstr. 5, Musterstadt"));
        // In den Cache geschrieben.
        let (la, lo) = cache::schluessel(51.1604, 10.4514);
        assert_eq!(cache::lese(&pool, la, lo).await.as_deref(), Some("Hauptstr. 5, Musterstadt"));
    }

    #[tokio::test]
    async fn cache_hit_umgeht_http_und_rate_limit() {
        let pool = crate::db::test_pool().await;
        let (la, lo) = cache::schluessel(51.1604, 10.4514);
        cache::schreibe(&pool, la, lo, "Aus Cache").await;
        // Base zeigt auf geschlossenen Port; Bucket leer → trotzdem Treffer aus Cache.
        let mut leer = TokenBucket::neu(1.0, 1.0);
        leer.try_take(); // Token verbrauchen
        let bucket = Mutex::new(leer);
        let name = reverse_mit(&test_client(), &bucket, &pool, &geschlossener_port(), 51.1604, 10.4514).await;
        assert_eq!(name.as_deref(), Some("Aus Cache"));
    }

    #[tokio::test]
    async fn offline_liefert_none() {
        let pool = crate::db::test_pool().await;
        let bucket = Mutex::new(TokenBucket::neu(1.0, 1.0));
        let name = reverse_mit(&test_client(), &bucket, &pool, &geschlossener_port(), 51.0, 10.0).await;
        assert!(name.is_none());
    }

    #[tokio::test]
    async fn rate_limit_ueberzaehlig_liefert_none() {
        let pool = crate::db::test_pool().await;
        let (base, _h) = stub(serde_json::json!({ "display_name": "X" })).await;
        let mut leer = TokenBucket::neu(1.0, 1.0);
        leer.try_take(); // einziges Token weg
        let bucket = Mutex::new(leer);
        // Kein Cache-Eintrag, Bucket leer → None (ohne HTTP).
        let name = reverse_mit(&test_client(), &bucket, &pool, &base, 48.0, 11.0).await;
        assert!(name.is_none());
    }
}
