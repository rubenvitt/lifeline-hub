//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM).
//! Holt externe Geodaten, normalisiert sie zu GeoJSON und liefert einen
//! einheitlichen Umschlag mit definiertem Offline-Verhalten.

pub mod cache;
pub mod normalisierung;
pub mod quellen;
pub mod typen;

use std::time::Duration;

/// Geteilter Zustand des Aggregators: ein wiederverwendeter HTTP-Client.
/// Der Cache liegt persistent in der DB (siehe `cache`) und nutzt den AppState-Pool.
#[derive(Clone)]
pub struct FachebenenState {
    pub client: reqwest::Client,
}

impl FachebenenState {
    pub fn neu() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("LifelineHub-Lagekarte/1.0 (+https://github.com/)")
            .build()
            .expect("reqwest-Client baubar");
        FachebenenState { client }
    }
}

impl Default for FachebenenState {
    fn default() -> Self {
        Self::neu()
    }
}
