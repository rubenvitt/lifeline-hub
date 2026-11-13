//! Sammelzeilen für Logereignisse, die ein Fremder je Anfrage auslösen kann (LFH-925).
//!
//! Lastabwurf, ein erschöpfter Verbindungspool oder ein 503 an sich schreiben ohne Drossel eine
//! Zeile je Anfrage. Wer den Server von außen in diesen Zustand bringt, flutet damit das Journal:
//! journald erreicht `RateLimitBurst` und verwirft für den Rest des Intervalls **alle** Meldungen
//! des Dienstes, also auch Backup-, Purge- und DB-Fehler.
//!
//! Eine [`Sammelzeile`] zählt solche Ereignisse und lässt höchstens eine Zeile je
//! [`SAMMEL_ABSTAND`] durch: die erste sofort (damit der Beginn im Log steht), danach eine mit
//! der Zahl seit der letzten Zeile. Gezählt wird bei jedem Ereignis, geschrieben nur beim
//! Ereignis, das die Zeile fällig macht. Ebbt die Flut ab, steht der Rest der Zählung deshalb
//! erst in der Zeile des nächsten Ereignisses; ein eigener Takt dafür wäre ein weiterer
//! Hintergrund-Task ohne Gewinn für die Diagnose.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Mindestabstand zweier Zeilen derselben [`Sammelzeile`].
pub const SAMMEL_ABSTAND: Duration = Duration::from_secs(60);

/// Zähler einer Ereignisart mit gedrosselter Ausgabe, als `static` an der Logstelle.
pub struct Sammelzeile {
    zustand: Mutex<Zustand>,
}

struct Zustand {
    /// Zeitpunkt der letzten Zeile.
    letzte: Option<Instant>,
    /// Ereignisse seit der letzten Zeile, einschließlich des laufenden.
    seither: u64,
}

/// Eine fällige Zeile: `anzahl` Ereignisse seit der letzten Zeile (mindestens dieses eine),
/// `seit_s` Sekunden seit ihr (`0` bei der ersten Zeile).
#[derive(Debug, PartialEq, Eq)]
pub struct Faellig {
    pub anzahl: u64,
    pub seit_s: u64,
}

impl Sammelzeile {
    pub const fn neu() -> Self {
        Self {
            zustand: Mutex::new(Zustand::neu()),
        }
    }

    /// Zählt ein Ereignis. `Some`, wenn der Aufrufer jetzt die Zeile schreiben soll.
    pub fn zaehlen(&self) -> Option<Faellig> {
        self.zaehlen_um(Instant::now())
    }

    fn zaehlen_um(&self, jetzt: Instant) -> Option<Faellig> {
        self.zustand
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .zaehlen_um(jetzt)
    }
}

impl Zustand {
    const fn neu() -> Self {
        Zustand {
            letzte: None,
            seither: 0,
        }
    }

    fn zaehlen_um(&mut self, jetzt: Instant) -> Option<Faellig> {
        self.seither += 1;
        if self
            .letzte
            .is_some_and(|t| jetzt.saturating_duration_since(t) < SAMMEL_ABSTAND)
        {
            return None;
        }
        let seit_s = self
            .letzte
            .map_or(0, |t| jetzt.saturating_duration_since(t).as_secs());
        self.letzte = Some(jetzt);
        Some(Faellig {
            anzahl: std::mem::take(&mut self.seither),
            seit_s,
        })
    }
}

/// Wie [`Sammelzeile`], aber mit einer Zählung je Schlüssel (etwa je Zugang): Ein lauter
/// Schlüssel verdeckt keinen leisen. Der Schlüssel darf nicht frei von außen wählbar sein, sonst
/// wächst die Tabelle mit jedem Aufruf; die Kennung eines angelegten Zugangs ist es nicht.
pub struct SammelzeileJe {
    zustand: Mutex<BTreeMap<String, Zustand>>,
}

/// Ab so vielen Schlüsseln räumt [`SammelzeileJe`] die auf, die lange still waren.
const JE_AUFRAEUMEN_AB: usize = 256;

impl SammelzeileJe {
    pub const fn neu() -> Self {
        Self {
            zustand: Mutex::new(BTreeMap::new()),
        }
    }

    /// Zählt ein Ereignis des Schlüssels. `Some`, wenn der Aufrufer jetzt die Zeile schreiben
    /// soll.
    pub fn zaehlen(&self, schluessel: &str) -> Option<Faellig> {
        self.zaehlen_um(schluessel, Instant::now())
    }

    fn zaehlen_um(&self, schluessel: &str, jetzt: Instant) -> Option<Faellig> {
        let mut alle = self.zustand.lock().unwrap_or_else(|e| e.into_inner());
        if alle.len() >= JE_AUFRAEUMEN_AB {
            alle.retain(|_, z| {
                z.letzte
                    .is_some_and(|t| jetzt.saturating_duration_since(t) < 10 * SAMMEL_ABSTAND)
            });
        }
        if !alle.contains_key(schluessel) {
            alle.insert(schluessel.to_string(), Zustand::neu());
        }
        alle.get_mut(schluessel)?.zaehlen_um(jetzt)
    }
}

impl Default for SammelzeileJe {
    fn default() -> Self {
        Self::neu()
    }
}

impl Default for Sammelzeile {
    fn default() -> Self {
        Self::neu()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mutationsprobe: ohne die Abstandsprüfung wäre jedes Ereignis fällig.
    #[test]
    fn hoechstens_eine_zeile_je_abstand() {
        let s = Sammelzeile::neu();
        let start = Instant::now();

        assert_eq!(
            s.zaehlen_um(start),
            Some(Faellig {
                anzahl: 1,
                seit_s: 0
            }),
            "das erste Ereignis steht sofort im Log"
        );
        let zeilen = (1..1000)
            .filter_map(|i| s.zaehlen_um(start + Duration::from_millis(i * 50)))
            .count();
        assert_eq!(zeilen, 0, "innerhalb des Abstands nur zählen");

        assert_eq!(
            s.zaehlen_um(start + SAMMEL_ABSTAND),
            Some(Faellig {
                anzahl: 1000,
                seit_s: 60
            }),
            "die nächste Zeile trägt die still gezählten mit"
        );
        assert_eq!(s.zaehlen_um(start + SAMMEL_ABSTAND), None);
    }

    /// Mutationsprobe: mit einer Zählung für alle Schlüssel schwiege der zweite.
    #[test]
    fn je_schluessel_verdeckt_ein_lauter_keinen_leisen() {
        let s = SammelzeileJe::neu();
        let start = Instant::now();
        assert!(s.zaehlen_um("a", start).is_some());
        for i in 1..100 {
            assert_eq!(
                s.zaehlen_um("a", start + Duration::from_millis(i * 100)),
                None
            );
        }
        assert_eq!(
            s.zaehlen_um("b", start + Duration::from_secs(30)),
            Some(Faellig {
                anzahl: 1,
                seit_s: 0
            }),
            "das erste Ereignis des zweiten Schlüssels steht sofort im Log"
        );
        assert_eq!(
            s.zaehlen_um("a", start + SAMMEL_ABSTAND),
            Some(Faellig {
                anzahl: 100,
                seit_s: 60
            }),
            "die Zählung von a enthält b nicht"
        );
    }

    #[test]
    fn je_schluessel_raeumt_stille_schluessel_auf() {
        let s = SammelzeileJe::neu();
        let start = Instant::now();
        for i in 0..JE_AUFRAEUMEN_AB {
            s.zaehlen_um(&format!("z{i}"), start);
        }
        s.zaehlen_um("spaet", start + 11 * SAMMEL_ABSTAND);
        assert_eq!(s.zustand.lock().unwrap().len(), 1);
    }

    #[test]
    fn nach_einer_ruhepause_steht_das_naechste_ereignis_sofort_im_log() {
        let s = Sammelzeile::neu();
        let start = Instant::now();
        assert!(s.zaehlen_um(start).is_some());
        assert_eq!(
            s.zaehlen_um(start + 10 * SAMMEL_ABSTAND),
            Some(Faellig {
                anzahl: 1,
                seit_s: 600
            })
        );
    }
}
