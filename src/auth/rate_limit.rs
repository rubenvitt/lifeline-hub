//! Rate-Limit für fehlgeschlagene Anmeldeversuche (LFH-249/F30).
//!
//! Ohne Bremse ist das Login beliebig oft pro Sekunde probierbar — bei einem System, das
//! im Einsatz auch mal offen im Netz hängt, ist das die billigste Angriffsfläche
//! überhaupt.
//!
//! **In-code statt Fremd-Crate** (z.B. `tower_governor`): ein neuer Abhängigkeitsbaum
//! widerspräche der Supply-Chain-Härtung aus LFH-253/G01, und das Projekt hat für
//! prozessweiten Zustand bereits ein Muster (`LazyLock`-Statics). Der Bedarf hier ist
//! eine Handvoll Zeilen.
//!
//! **Bewusst großzügig parametrisiert.** Eine ganze Wache kann hinter einer NAT-IP
//! hängen; eine zu enge Schwelle sperrt dann im Ernstfall alle gleichzeitig aus, und ein
//! Aussperren im Einsatz ist ein echter Betriebsschaden. Deshalb:
//! - nur FEHLVERSUCHE zählen (erfolgreiche Anmeldungen räumen den Zähler),
//! - [`MAX_FEHLVERSUCHE`] pro [`FENSTER`] je Quelle,
//! - die Sperre läuft von selbst aus, es gibt keine dauerhafte Blockliste.
//!
//! Die Spur der Fehlversuche liegt zusätzlich in `auth_audit` — auch wer unterhalb der
//! Schwelle bleibt, ist damit auswertbar.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Erlaubte Fehlversuche je Quelle innerhalb von [`FENSTER`].
pub const MAX_FEHLVERSUCHE: usize = 10;

/// Beobachtungsfenster für Fehlversuche.
pub const FENSTER: Duration = Duration::from_secs(300);

/// Fehlversuche je Quell-IP mit Zeitstempel. Prozessweit wie die übrigen Statics des
/// Projekts — kein `AppState`, damit die vielen inline-`AppState`-Konstruktionen in Tests
/// unberührt bleiben.
static FEHLVERSUCHE: LazyLock<Mutex<HashMap<IpAddr, Vec<Instant>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Ist diese Quelle aktuell gesperrt? Liefert `true`, wenn bereits zu viele Fehlversuche
/// im Fenster liegen.
///
/// Synchron und ohne `await` — der `MutexGuard` darf einen `.await` nicht überleben, sonst
/// wird der Handler `!Send` und axum nimmt ihn nicht mehr an.
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

/// Räumt die Quelle nach erfolgreicher Anmeldung.
///
/// Wichtig gegen die NAT-Falle: sobald sich jemand aus dem Netz erfolgreich anmeldet,
/// ist der Zähler für alle dahinter wieder frei.
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
