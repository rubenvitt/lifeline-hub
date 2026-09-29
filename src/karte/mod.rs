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

#[cfg(test)]
mod tests {
    use super::*;

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
