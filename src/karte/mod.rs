//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM).
//! Holt externe Geodaten, normalisiert sie zu GeoJSON und liefert einen
//! einheitlichen Umschlag mit definiertem Offline-Verhalten.

pub mod assets;
pub mod cache;
pub mod download;
pub mod katalog;
pub mod mbtiles;
pub mod normalisierung;
pub mod proxy;
pub mod quellen;
pub mod registry;
pub mod tile_cache;
pub mod typen;

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Betriebs-/Sicherheitsschalter der Karten-Module, prozessweit einmal beim Serverstart
/// via [`init_karte_config`] aus der CLI/ENV-`Config` gesetzt (LFH-239/F18).
///
/// Vorher lasen `download.rs` und `katalog.rs` ihre Schalter bei JEDEM Aufruf direkt per
/// `std::env::var`. Das hatte drei Folgen: die Schalter tauchten weder in `--help` noch im
/// Startup-Log auf, ein geleaktes `LIFELINE_DOWNLOAD_ALLOW_LOOPBACK=1` schwächte den
/// SSRF-Guard unbemerkt auch auf dem öffentlichen Proxy-Pfad, und die Security-Tests
/// kippten reproduzierbar, sobald die Variable ambient in der Umgebung stand.
///
/// Bewusst ein prozessweiter `OnceLock` statt `AppState`: der kritische Aufrufer
/// (`proxy::ssrf_redirect_policy`) ist ein `'static`-Closure in einem `OnceLock`-Client
/// und kommt an den AppState gar nicht heran. Gleiches Muster wie
/// `anhang::init_scan_config`.
///
/// Nebeneffekt, der die Test-Flakiness an der Wurzel erledigt: im Testprozess wird der
/// `OnceLock` nie initialisiert, also gilt der sichere Default — unabhängig davon, was
/// in der Umgebung steht.
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

/// Aktuelle Karten-Konfiguration; ohne Initialisierung gilt der sichere Default
/// (kein Loopback-Escape, einkompilierte Manifest-URL) — z.B. in Tests.
pub fn karte_config() -> &'static KarteConfig {
    KARTE_CONFIG.get_or_init(KarteConfig::default)
}

/// Geteilter Zustand des Aggregators. Der Cache liegt persistent in der DB (siehe `cache`)
/// und nutzt den AppState-Pool. `inflight` verhindert mehrfache parallele Hintergrund-
/// Refreshes desselben Schlüssels (Stale-while-revalidate).
#[derive(Clone)]
pub struct FachebenenState {
    pub client: reqwest::Client,
    pub inflight: Arc<Mutex<HashSet<String>>>,
}

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
        }
    }
}

impl Default for FachebenenState {
    fn default() -> Self {
        Self::neu()
    }
}
