//! Drosselung je Zugang im Prozessspeicher (R10): ein Token-Bucket je Maschinenzugang mit 60
//! Anfragen je Minute (Spec `maschinenzugang`, „Jeder Zugang ist gedrosselt“) und einer je
//! Einwurf-Zugang mit 30 je Minute (Spec `einwurf-zugang`, „Jeder Einwurf-Zugang ist
//! gedrosselt“). Beide Arten haben eigene Buckets; gleiche Kennungen stören sich nicht.
//!
//! Die Zeit kommt als Parameter herein, damit Tests ohne Warten auskommen. Anders als
//! `geocoding::TokenBucket` liefert ein leerer Bucket die Wartezeit für `Retry-After`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Vorrat und Nachfüllen eines Buckets.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rate {
    /// Größe des Buckets: so viele Anfragen gehen am Stück.
    pub kapazitaet: f64,
    /// Nachfüllen je Sekunde.
    pub je_sekunde: f64,
}

/// Maschinenzugang: 60 am Stück, eine je Sekunde nach.
pub const MASCHINE: Rate = Rate {
    kapazitaet: 60.0,
    je_sekunde: 1.0,
};
/// Einwurf-Zugang: 30 am Stück, eine je zwei Sekunden nach.
pub const EINWURF: Rate = Rate {
    kapazitaet: 30.0,
    je_sekunde: 0.5,
};
/// Ein voller Bucket, der so lange unbenutzt ist, wird beim nächsten Zugriff aufgeräumt.
const RUHE: Duration = Duration::from_secs(600);

#[derive(Debug, Clone)]
pub struct TokenBucket {
    rate: Rate,
    stand: f64,
    zuletzt: Instant,
}

impl TokenBucket {
    pub fn new(rate: Rate, jetzt: Instant) -> Self {
        TokenBucket {
            rate,
            stand: rate.kapazitaet,
            zuletzt: jetzt,
        }
    }

    fn fuellen(&mut self, jetzt: Instant) {
        let vergangen = jetzt.saturating_duration_since(self.zuletzt).as_secs_f64();
        self.stand = (self.stand + vergangen * self.rate.je_sekunde).min(self.rate.kapazitaet);
        self.zuletzt = jetzt.max(self.zuletzt);
    }

    /// Nimmt eine Anfrage; ist der Bucket leer, die Wartezeit bis zur nächsten.
    pub fn try_take(&mut self, jetzt: Instant) -> Result<(), Duration> {
        self.fuellen(jetzt);
        if self.stand >= 1.0 {
            self.stand -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64(
                (1.0 - self.stand) / self.rate.je_sekunde,
            ))
        }
    }

    fn is_ruhend(&self, jetzt: Instant) -> bool {
        jetzt.saturating_duration_since(self.zuletzt) >= RUHE
    }
}

/// `Retry-After` in ganzen Sekunden, aufgerundet, mindestens 1.
pub fn retry_after_s(warten: Duration) -> u64 {
    warten.as_secs_f64().ceil().max(1.0) as u64
}

/// Die Buckets aller Zugänge einer Art.
pub struct Drossel {
    rate: Rate,
    buckets: HashMap<String, TokenBucket>,
}

impl Default for Drossel {
    /// Die Drossel des Maschinenzugangs.
    fn default() -> Self {
        Drossel::new(MASCHINE)
    }
}

impl Drossel {
    pub fn new(rate: Rate) -> Self {
        Drossel {
            rate,
            buckets: HashMap::new(),
        }
    }

    /// Nimmt eine Anfrage des Zugangs. Räumt dabei ruhende Buckets anderer Zugänge weg, die
    /// ohnehin wieder voll wären.
    pub fn try_take(&mut self, zugang_id: &str, jetzt: Instant) -> Result<(), Duration> {
        if self.buckets.len() > 64 {
            self.buckets.retain(|_, b| !b.is_ruhend(jetzt));
        }
        self.buckets
            .entry(zugang_id.to_string())
            .or_insert_with(|| TokenBucket::new(self.rate, jetzt))
            .try_take(jetzt)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.buckets.len()
    }
}

static DROSSEL: LazyLock<Mutex<Drossel>> = LazyLock::new(|| Mutex::new(Drossel::new(MASCHINE)));
static DROSSEL_EINWURF: LazyLock<Mutex<Drossel>> =
    LazyLock::new(|| Mutex::new(Drossel::new(EINWURF)));

/// Nimmt eine Anfrage des Maschinenzugangs aus der prozessweiten Drossel. Synchron: der Guard
/// darf kein `.await` überleben.
pub fn try_take(zugang_id: &str) -> Result<(), Duration> {
    DROSSEL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .try_take(zugang_id, Instant::now())
}

/// Nimmt einen Einwurf des Einwurf-Zugangs aus dessen eigener Drossel.
pub fn try_take_einwurf(zugang_id: &str) -> Result<(), Duration> {
    DROSSEL_EINWURF
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .try_take(zugang_id, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn die_61_anfrage_einer_minute_wird_gedrosselt() {
        let start = Instant::now();
        let mut d = Drossel::default();
        for i in 0..60 {
            assert!(d.try_take("a", start).is_ok(), "Anfrage {}", i + 1);
        }
        let warten = d.try_take("a", start).unwrap_err();
        assert_eq!(retry_after_s(warten), 1);
        assert!(d.try_take("b", start).is_ok(), "je Zugang getrennt");
    }

    #[test]
    fn nach_wartezeit_geht_es_weiter() {
        let start = Instant::now();
        let mut d = Drossel::default();
        for _ in 0..60 {
            d.try_take("a", start).unwrap();
        }
        assert!(d.try_take("a", start + Duration::from_millis(500)).is_err());
        assert!(d.try_take("a", start + Duration::from_secs(1)).is_ok());
        // Eine Minute Pause füllt den Bucket wieder ganz, nicht darüber hinaus.
        let spaeter = start + Duration::from_secs(600);
        for _ in 0..60 {
            assert!(d.try_take("a", spaeter).is_ok());
        }
        assert!(d.try_take("a", spaeter).is_err());
    }

    #[test]
    fn retry_after_ist_aufgerundet_und_mindestens_eins() {
        assert_eq!(retry_after_s(Duration::from_millis(1)), 1);
        assert_eq!(retry_after_s(Duration::from_millis(1500)), 2);
        assert_eq!(retry_after_s(Duration::ZERO), 1);
    }

    #[test]
    fn ruhende_buckets_werden_aufgeraeumt() {
        let start = Instant::now();
        let mut d = Drossel::default();
        for i in 0..100 {
            d.try_take(&format!("z{i}"), start).unwrap();
        }
        d.try_take("neu", start + RUHE).unwrap();
        assert_eq!(d.len(), 1, "nur der eben benutzte bleibt");
    }

    #[test]
    fn der_31_einwurf_wird_gedrosselt_und_nach_zwei_sekunden_geht_einer() {
        let start = Instant::now();
        let mut d = Drossel::new(EINWURF);
        for i in 0..30 {
            assert!(d.try_take("a", start).is_ok(), "Einwurf {}", i + 1);
        }
        let warten = d.try_take("a", start).unwrap_err();
        assert_eq!(retry_after_s(warten), 2);
        assert!(d.try_take("a", start + Duration::from_secs(1)).is_err());
        assert!(d.try_take("a", start + Duration::from_secs(2)).is_ok());
        assert!(d.try_take("a", start + Duration::from_secs(2)).is_err());
    }

    /// Dieselbe Kennung in beiden prozessweiten Drosseln: ein leerer Einwurf-Vorrat nimmt dem
    /// Maschinenzugang nichts.
    #[test]
    fn einwurf_und_maschinenzugang_teilen_keinen_vorrat() {
        let id = "drossel-test-geteilte-kennung";
        for _ in 0..30 {
            try_take_einwurf(id).unwrap();
        }
        assert!(try_take_einwurf(id).is_err());
        assert!(try_take(id).is_ok());
    }

    #[test]
    fn rueckwaerts_laufende_uhr_bricht_nichts() {
        let start = Instant::now() + Duration::from_secs(10);
        let mut b = TokenBucket::new(MASCHINE, start);
        assert!(b.try_take(start - Duration::from_secs(5)).is_ok());
    }
}
