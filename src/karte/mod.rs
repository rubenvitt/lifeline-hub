//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM-Extrakt u. a.): holt
//! Geodaten, normalisiert sie zu GeoJSON und liefert einen einheitlichen Umschlag mit
//! definiertem Offline-Verhalten. `FachebenenState` trägt außerdem Basis-URLs und Bremsen der
//! Einsatz-Nachschlagequellen (Pegel, Wetter).

pub mod assets;
pub mod cache;
pub mod download;
pub mod katalog;
pub mod kritis;
pub mod luftqualitaet;
pub mod mbtiles;
pub mod normalisierung;
pub mod odl_grundpegel;
pub mod proxy;
pub mod quellen;
pub mod registry;
pub mod tile_cache;
pub mod typen;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Betriebs-/Sicherheitsschalter der Karten-Module, einmal beim Serverstart per
/// [`init_karte_config`] aus der CLI/ENV-`Config` gesetzt (LFH-239). Damit stehen sie in
/// `--help` und im Startup-Log, und eine ambient gesetzte Variable kann den SSRF-Guard nicht
/// still schwächen.
///
/// Prozessweiter `OnceLock` statt `AppState`, weil der kritische Aufrufer
/// (`proxy::ssrf_redirect_policy`) ein `'static`-Closure in einem `OnceLock`-Client ist. Im
/// Testprozess bleibt er uninitialisiert, dort gilt also immer der sichere Default.
#[derive(Debug, Clone, Default)]
pub struct KarteConfig {
    /// Dev-Escape: erlaubt Downloads von Loopback-Adressen (auch http). Default AUS.
    pub download_allow_loopback: bool,
    /// Override der Manifest-URL des Offline-Katalogs. `None` → einkompilierter Pin.
    pub offline_katalog_manifest_url: Option<String>,
}

static KARTE_CONFIG: OnceLock<KarteConfig> = OnceLock::new();

/// Setzt die prozessweite Karten-Konfiguration (einmal beim Serverstart). Idempotent —
/// ein zweiter Aufruf wird ignoriert.
pub fn init_karte_config(cfg: KarteConfig) {
    let _ = KARTE_CONFIG.set(cfg);
}

/// Aktuelle Karten-Konfiguration; ohne Initialisierung (z. B. in Tests) der sichere Default.
pub fn karte_config() -> &'static KarteConfig {
    KARTE_CONFIG.get_or_init(KarteConfig::default)
}

/// Geteilter Zustand des Aggregators. Der Cache liegt in der DB (s. `cache`); `inflight`
/// verhindert parallele Hintergrund-Refreshes desselben Schlüssels.
#[derive(Clone)]
pub struct FachebenenState {
    pub client: reqwest::Client,
    pub inflight: Arc<Mutex<HashSet<String>>>,
    /// Basis-URL der PEGELONLINE-REST-API für Zeitreihen (`crate::pegel::abruf`). Tests lenken sie
    /// über [`FachebenenState::mit_pegel_basis_url`] um, damit kein Test ins Netz geht.
    pub pegel_basis_url: Arc<str>,
    /// Letzter gescheiterter Zeitreihenabruf je Station. Während der Abkühlung
    /// (`pegel::abruf::ABKUEHLUNG`) wird die Station nicht erneut angefragt, sonst warteten bei
    /// unbekannter UUID oder hängender Quelle alle Aufrufe bis zur Frist. Je `AppState`, damit
    /// Tests
    /// einander nicht beeinflussen.
    pub pegel_fehlschlag: Arc<Mutex<HashMap<String, Instant>>>,
    /// Basis-URL von Bright Sky für Warnungen und Vorhersage (`crate::wetter::abruf`), etwa gegen
    /// eine eigene Instanz austauschbar. Tests lenken sie über
    /// [`FachebenenState::mit_wetter_basis_url`] auf einen Stub.
    pub wetter_basis_url: Arc<str>,
    /// Letzter gescheiterter Wetterabruf je Cache-Schlüssel, getrennt von
    /// [`Self::pegel_fehlschlag`]: ein Ausfall von Bright Sky sperrt keine Pegelstation.
    pub wetter_fehlschlag: Arc<Mutex<HashMap<String, Instant>>>,
}

/// Produktive Basis-URL der PEGELONLINE-REST-API v2.
pub const PEGELONLINE_BASIS_URL: &str = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";

/// Produktive Basis-URL von Bright Sky (freie JSON-API auf DWD-Open-Data, ohne Schlüssel).
pub const BRIGHTSKY_BASIS_URL: &str = "https://api.brightsky.dev";

impl FachebenenState {
    pub fn neu() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("LifelineHub-Lagekarte/1.0 (+https://github.com/)")
            // Die 8 s gelten der ganzen Anfrage: ungepackt bräuchte ODL bei ~1 Mbit/s rund 7 s
            // (LFH-599). Ausdrücklich, obwohl Vorgabe — Proxy und Download schalten es ab.
            .gzip(true)
            .build()
            .expect("reqwest-Client baubar");
        FachebenenState {
            client,
            inflight: Arc::new(Mutex::new(HashSet::new())),
            pegel_basis_url: Arc::from(PEGELONLINE_BASIS_URL),
            pegel_fehlschlag: Arc::new(Mutex::new(HashMap::new())),
            wetter_basis_url: Arc::from(BRIGHTSKY_BASIS_URL),
            wetter_fehlschlag: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Lenkt die PEGELONLINE-Zeitreihenabrufe auf eine andere Basis-URL (Tests).
    pub fn mit_pegel_basis_url(mut self, url: &str) -> Self {
        self.pegel_basis_url = Arc::from(url.trim_end_matches('/'));
        self
    }

    /// Lenkt die Wetterabrufe (Bright Sky) auf eine andere Basis-URL (Tests).
    pub fn mit_wetter_basis_url(mut self, url: &str) -> Self {
        self.wetter_basis_url = Arc::from(url.trim_end_matches('/'));
        self
    }
}

impl Default for FachebenenState {
    fn default() -> Self {
        Self::neu()
    }
}

/// Loopback-Quelle, die immer gzip-kodiert antwortet und den `Accept-Encoding`-Kopf der Anfrage
/// mitschreibt (LFH-599). Geteilt von den Tests des Fachebenen-, Proxy- und Download-Clients.
#[cfg(test)]
pub(crate) mod gzip_fixture {
    use std::sync::{Arc, Mutex};

    /// Entpackter Inhalt von [`GZIP`].
    pub const ROH: &[u8] = br#"{"ebene":"odl","werte":[1,2,3]}"#;

    /// `ROH`, mit gzip gepackt (`mtime = 0`, damit die Bytes fest sind).
    pub const GZIP: &[u8] = &[
        0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x03, 0xab, 0x56, 0x4a, 0x4d, 0x4a,
        0xcd, 0x4b, 0x55, 0xb2, 0x52, 0xca, 0x4f, 0xc9, 0x51, 0xd2, 0x51, 0x2a, 0x4f, 0x2d, 0x2a,
        0x01, 0xf2, 0xa2, 0x0d, 0x75, 0x8c, 0x74, 0x8c, 0x63, 0x6b, 0x01, 0xff, 0xda, 0xc4, 0xfb,
        0x1f, 0x00, 0x00, 0x00,
    ];

    /// `Accept-Encoding` der letzten Anfrage; `None`, solange keine kam oder sie keinen trug.
    pub type Mitschrift = Arc<Mutex<Option<String>>>;

    /// Startet die Quelle und liefert ihre URL samt Mitschrift.
    pub async fn spawn() -> (String, Mitschrift) {
        use axum::{http::HeaderMap, response::Response, routing::get, Router};
        let mitschrift: Mitschrift = Arc::new(Mutex::new(None));
        let m = mitschrift.clone();
        let app = Router::new().route(
            "/q",
            get(move |headers: HeaderMap| {
                let m = m.clone();
                async move {
                    *m.lock().unwrap() = headers
                        .get("accept-encoding")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    Response::builder()
                        .header("content-type", "application/json")
                        .header("content-encoding", "gzip")
                        .body(axum::body::Body::from(GZIP))
                        .unwrap()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://127.0.0.1:{}/q", addr.port()), mitschrift)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // LFH-599: die Fachebenen-Quellen liefern gzip (ODL 890 KB → 81 KB), der Client muss es
    // anbieten und selbst entpacken — die Normalisierer sehen weiter das rohe JSON.
    #[tokio::test]
    async fn fachebenen_client_handelt_gzip_aus_und_entpackt() {
        let (url, mitschrift) = gzip_fixture::spawn().await;
        let text = FachebenenState::neu()
            .client
            .get(&url)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(text.as_bytes(), gzip_fixture::ROH, "Antwort entpackt");
        let angeboten = mitschrift.lock().unwrap().clone().unwrap_or_default();
        assert!(
            angeboten.contains("gzip"),
            "Accept-Encoding bietet gzip an, war {angeboten:?}"
        );
    }

    #[test]
    fn wetter_basis_vorgabe_und_setter() {
        let fe = FachebenenState::neu();
        assert_eq!(&*fe.wetter_basis_url, BRIGHTSKY_BASIS_URL);
        let fe = fe.mit_wetter_basis_url("http://127.0.0.1:9/");
        assert_eq!(&*fe.wetter_basis_url, "http://127.0.0.1:9");
        assert_eq!(
            &*fe.pegel_basis_url, PEGELONLINE_BASIS_URL,
            "die Pegel-Basis bleibt unberührt"
        );
    }

    #[test]
    fn wetter_und_pegel_kuehlen_getrennt_ab() {
        // Ein Wetterausfall sperrt keine Pegelstation und umgekehrt: zwei eigene Merker.
        let fe = FachebenenState::neu();
        fe.wetter_fehlschlag
            .lock()
            .unwrap()
            .insert("x".into(), Instant::now());
        assert!(fe.pegel_fehlschlag.lock().unwrap().is_empty());
        assert!(!Arc::ptr_eq(&fe.wetter_fehlschlag, &fe.pegel_fehlschlag));
    }
}
