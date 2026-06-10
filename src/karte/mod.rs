//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM).
//! Holt externe Geodaten, normalisiert sie zu GeoJSON und liefert einen
//! einheitlichen Umschlag mit definiertem Offline-Verhalten.

pub mod cache;
pub mod normalisierung;
pub mod quellen;
pub mod typen;

use cache::FachebenenCache;
use std::sync::Arc;
use std::time::Duration;

/// Geteilter Zustand des Aggregators: ein wiederverwendeter HTTP-Client und der Cache.
#[derive(Clone)]
pub struct FachebenenState {
    pub client: reqwest::Client,
    pub cache: Arc<FachebenenCache>,
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
            cache: Arc::new(FachebenenCache::neu()),
        }
    }
}

impl Default for FachebenenState {
    fn default() -> Self {
        Self::neu()
    }
}
