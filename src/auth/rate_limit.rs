//! Rate-Limit für fehlgeschlagene Anmeldeversuche (LFH-249).
//!
//! In-code statt Fremd-Crate, um keinen neuen Abhängigkeitsbaum hereinzuholen.
//!
//! Bewusst großzügig: eine ganze Wache kann hinter einer NAT-IP hängen, und ein Aussperren im
//! Einsatz ist ein echter Betriebsschaden. Deshalb zählen nur Fehlversuche (ein Erfolg räumt
//! den Zähler), [`MAX_FEHLVERSUCHE`] je [`FENSTER`] und Quelle, und die Sperre läuft von selbst
//! aus. Die Spur der Fehlversuche steht zusätzlich in `auth_audit`.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Erlaubte Fehlversuche je Quelle innerhalb von [`FENSTER`].
pub const MAX_FEHLVERSUCHE: usize = 10;

/// Beobachtungsfenster für Fehlversuche.
pub const FENSTER: Duration = Duration::from_secs(300);

/// Fehlversuche je Quell-IP. Prozessweit statt in `AppState`, damit Test-Konstruktionen
/// unberührt bleiben.
static FEHLVERSUCHE: LazyLock<Mutex<HashMap<IpAddr, Vec<Instant>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ist diese Quelle aktuell gesperrt?
///
/// Synchron: der `MutexGuard` darf kein `.await` überleben, sonst wird der Handler `!Send`.
pub fn ist_gesperrt(ip: IpAddr) -> bool {
    let mut map = FEHLVERSUCHE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(versuche) = map.get_mut(&ip) else {
        return false;
    };
    versuche.retain(|t| t.elapsed() < FENSTER);
    if versuche.is_empty() {
        map.remove(&ip);
        return false;
    }
    versuche.len() >= MAX_FEHLVERSUCHE
}

/// Vermerkt einen Fehlversuch.
pub fn fehlversuch(ip: IpAddr) {
    let mut map = FEHLVERSUCHE.lock().unwrap_or_else(|e| e.into_inner());
    let versuche = map.entry(ip).or_default();
    versuche.retain(|t| t.elapsed() < FENSTER);
    versuche.push(Instant::now());
}

/// Räumt die Quelle nach erfolgreicher Anmeldung — damit ist der Zähler für alle hinter
/// derselben NAT-IP wieder frei.
pub fn erfolg(ip: IpAddr) {
    let mut map = FEHLVERSUCHE.lock().unwrap_or_else(|e| e.into_inner());
    map.remove(&ip);
}

/// Nur für Tests: setzt den prozessweiten Zustand zurück.
#[cfg(test)]
fn zuruecksetzen() {
    FEHLVERSUCHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Der Zustand ist prozessweit — die Tests dürfen sich nicht überlappen.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn sperrt_erst_ab_der_schwelle() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        zuruecksetzen();
        let quelle = ip("192.0.2.1");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            fehlversuch(quelle);
            assert!(
                !ist_gesperrt(quelle),
                "unterhalb der Schwelle nicht sperren"
            );
        }
        fehlversuch(quelle);
        assert!(ist_gesperrt(quelle), "ab der Schwelle sperren");
    }

    #[test]
    fn erfolgreiche_anmeldung_raeumt_den_zaehler() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        zuruecksetzen();
        let quelle = ip("192.0.2.2");

        for _ in 0..MAX_FEHLVERSUCHE {
            fehlversuch(quelle);
        }
        assert!(ist_gesperrt(quelle));

        erfolg(quelle);
        assert!(
            !ist_gesperrt(quelle),
            "nach erfolgreicher Anmeldung ist die Quelle frei — sonst bliebe eine ganze \
             Wache hinter einer NAT-IP ausgesperrt, obwohl jemand das Passwort kennt"
        );
    }

    #[test]
    fn quellen_sind_unabhaengig() {
        let _g = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        zuruecksetzen();
        let angreifer = ip("192.0.2.3");
        let unbeteiligt = ip("192.0.2.4");

        for _ in 0..MAX_FEHLVERSUCHE {
            fehlversuch(angreifer);
        }
        assert!(ist_gesperrt(angreifer));
        assert!(!ist_gesperrt(unbeteiligt), "andere Quellen bleiben frei");
    }
}
