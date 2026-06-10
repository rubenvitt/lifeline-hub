//! Einfacher In-Memory-Cache mit TTL für Fachebenen-Antworten.
//! Schlüssel: `quelle` bzw. `quelle:bbox`. Kein await während des Lock-Haltens.

use crate::karte::typen::FachebeneAntwort;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct CacheEintrag {
    gespeichert: Instant,
    antwort: FachebeneAntwort,
}

pub struct FachebenenCache {
    eintraege: Mutex<HashMap<String, CacheEintrag>>,
}

impl FachebenenCache {
    pub fn neu() -> Self {
        FachebenenCache {
            eintraege: Mutex::new(HashMap::new()),
        }
    }

    /// Frischen Eintrag (jünger als `ttl`) liefern, sonst None.
    pub fn frisch(&self, schluessel: &str, ttl: Duration) -> Option<FachebeneAntwort> {
        let map = self.eintraege.lock().unwrap();
        map.get(schluessel)
            .filter(|e| e.gespeichert.elapsed() < ttl)
            .map(|e| e.antwort.clone())
    }

    /// Letzten (auch abgelaufenen) Eintrag liefern — für Stale-Serving bei Quell-Ausfall.
    pub fn stale(&self, schluessel: &str) -> Option<FachebeneAntwort> {
        let map = self.eintraege.lock().unwrap();
        map.get(schluessel).map(|e| e.antwort.clone())
    }

    pub fn setze(&self, schluessel: &str, antwort: FachebeneAntwort) {
        let mut map = self.eintraege.lock().unwrap();
        map.insert(
            schluessel.to_string(),
            CacheEintrag {
                gespeichert: Instant::now(),
                antwort,
            },
        );
    }
}

impl Default for FachebenenCache {
    fn default() -> Self {
        Self::neu()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::karte::typen::leere_collection;

    fn antwort() -> FachebeneAntwort {
        FachebeneAntwort::ok("dwd", "X", None, leere_collection())
    }

    #[test]
    fn frisch_innerhalb_ttl() {
        let c = FachebenenCache::neu();
        c.setze("dwd", antwort());
        assert!(c.frisch("dwd", Duration::from_secs(60)).is_some());
    }

    #[test]
    fn nicht_frisch_nach_ttl_null() {
        let c = FachebenenCache::neu();
        c.setze("dwd", antwort());
        assert!(c.frisch("dwd", Duration::from_millis(0)).is_none());
        // aber stale liefert ihn weiterhin
        assert!(c.stale("dwd").is_some());
    }

    #[test]
    fn unbekannter_schluessel_ist_none() {
        let c = FachebenenCache::neu();
        assert!(c.frisch("x", Duration::from_secs(60)).is_none());
        assert!(c.stale("x").is_none());
    }
}
