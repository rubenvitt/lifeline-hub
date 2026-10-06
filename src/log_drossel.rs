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
            zustand: Mutex::new(Zustand {
                letzte: None,
                seither: 0,
            }),
        }
    }

    /// Zählt ein Ereignis. `Some`, wenn der Aufrufer jetzt die Zeile schreiben soll.
    pub fn zaehlen(&self) -> Option<Faellig> {
        self.zaehlen_um(Instant::now())
    }

    fn zaehlen_um(&self, jetzt: Instant) -> Option<Faellig> {
        let mut z = self.zustand.lock().unwrap_or_else(|e| e.into_inner());
        z.seither += 1;
        if z.letzte
            .is_some_and(|t| jetzt.saturating_duration_since(t) < SAMMEL_ABSTAND)
        {
            return None;
        }
        let seit_s = z
            .letzte
            .map_or(0, |t| jetzt.saturating_duration_since(t).as_secs());
        z.letzte = Some(jetzt);
        Some(Faellig {
            anzahl: std::mem::take(&mut z.seither),
            seit_s,
        })
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
