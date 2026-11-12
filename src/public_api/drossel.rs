//! Drosselung je Maschinenzugang (Spec `maschinenzugang`, „Jeder Zugang ist gedrosselt“;
//! design.md D4): ein Token-Bucket je Zugang im Prozessspeicher (R10), 60 Anfragen je Minute.
//!
//! Die Zeit kommt als Parameter herein, damit Tests ohne Warten auskommen. Anders als
//! `geocoding::TokenBucket` liefert ein leerer Bucket die Wartezeit für `Retry-After`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Größe des Buckets: so viele Anfragen gehen am Stück.
pub const KAPAZITAET: f64 = 60.0;
/// Nachfüllen je Sekunde: 60 je Minute.
pub const JE_SEKUNDE: f64 = 1.0;
/// Ein voller Bucket, der so lange unbenutzt ist, wird beim nächsten Zugriff aufgeräumt.
const RUHE: Duration = Duration::from_secs(600);

#[derive(Debug, Clone)]
pub struct TokenBucket {
    stand: f64,
    zuletzt: Instant,
}

impl TokenBucket {
    pub fn new(jetzt: Instant) -> Self {
        TokenBucket {
            stand: KAPAZITAET,
            zuletzt: jetzt,
        }
    }

    fn fuellen(&mut self, jetzt: Instant) {
        let vergangen = jetzt.saturating_duration_since(self.zuletzt).as_secs_f64();
        self.stand = (self.stand + vergangen * JE_SEKUNDE).min(KAPAZITAET);
        self.zuletzt = jetzt.max(self.zuletzt);
    }

    /// Nimmt eine Anfrage; ist der Bucket leer, die Wartezeit bis zur nächsten.
    pub fn try_take(&mut self, jetzt: Instant) -> Result<(), Duration> {
        self.fuellen(jetzt);
        if self.stand >= 1.0 {
            self.stand -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64((1.0 - self.stand) / JE_SEKUNDE))
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

/// Die Buckets aller Zugänge.
#[derive(Default)]
pub struct Drossel {
    buckets: HashMap<String, TokenBucket>,
}

impl Drossel {
    /// Nimmt eine Anfrage des Zugangs. Räumt dabei ruhende Buckets anderer Zugänge weg, die
    /// ohnehin wieder voll wären.
    pub fn try_take(&mut self, zugang_id: &str, jetzt: Instant) -> Result<(), Duration> {
        if self.buckets.len() > 64 {
            self.buckets.retain(|_, b| !b.is_ruhend(jetzt));
        }
        self.buckets
            .entry(zugang_id.to_string())
            .or_insert_with(|| TokenBucket::new(jetzt))
            .try_take(jetzt)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.buckets.len()
    }
}

static DROSSEL: LazyLock<Mutex<Drossel>> = LazyLock::new(|| Mutex::new(Drossel::default()));

/// Nimmt eine Anfrage des Zugangs aus der prozessweiten Drossel. Synchron: der Guard darf kein
/// `.await` überleben.
pub fn try_take(zugang_id: &str) -> Result<(), Duration> {
    DROSSEL
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
    fn rueckwaerts_laufende_uhr_bricht_nichts() {
        let start = Instant::now() + Duration::from_secs(10);
        let mut b = TokenBucket::new(start);
        assert!(b.try_take(start - Duration::from_secs(5)).is_ok());
    }
}
