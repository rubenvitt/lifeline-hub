//! Aggregator für externe Fachebenen (NINA, DWD, PEGELONLINE, KRITIS/OSM).
//! Holt externe Geodaten, normalisiert sie zu GeoJSON und liefert einen
//! einheitlichen Umschlag mit definiertem Offline-Verhalten.

pub mod cache;
pub mod normalisierung;
pub mod quellen;
pub mod typen;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
