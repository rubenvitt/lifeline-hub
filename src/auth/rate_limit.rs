//! Rate-Limit für fehlgeschlagene Anmeldeversuche (LFH-249, LFH-793).
//!
//! In-code statt Fremd-Crate, um keinen neuen Abhängigkeitsbaum hereinzuholen.
//!
//! Bewusst großzügig: eine ganze Wache kann hinter einer NAT-IP hängen, und ein Aussperren im
//! Einsatz ist ein echter Betriebsschaden. Deshalb zählen nur Fehlversuche, [`MAX_FEHLVERSUCHE`]
//! je [`FENSTER`] und Quelle, und die Sperre läuft von selbst aus. Die Spur der Fehlversuche
//! steht zusätzlich in `auth_audit`.
//!
//! **Ein Erfolg räumt nur die Fehlversuche gegen das eigene Konto** (LFH-793). Wer sich
//! vertippt und dann anmeldet, nimmt seine Versuche mit, damit eine NAT-Quelle nicht schneller
//! gesperrt wird. Versuche gegen andere Konten bleiben stehen: räumte der Erfolg die ganze
//! Quelle, setzte ein Innentäter die Sperre nach neun fremden Passwörtern mit dem eigenen Konto
//! zurück. Versuche ohne bekanntes Ziel (ein unbekannter Code der Mac-App) räumt kein Erfolg.
//! Bewusst **keine** Sperre je Konto über alle Quellen: sie sperrte das Konto für jeden, der
//! seinen Namen kennt.
//!
//! **Die Tabelle ist begrenzt:** ab [`AUFRAEUM_SCHWELLE`] Quellen räumt ein neuer Eintrag die
//! abgelaufenen weg, bei [`OBERGRENZE`] verdrängt er die Quelle mit dem ältesten letzten Versuch;
//! je Quelle bleiben höchstens [`MAX_FEHLVERSUCHE`] Versuche. Sonst wüchse sie mit vielen
//! einmaligen Quelladressen (IPv6, Botnetz) bis zum Neustart.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Erlaubte Fehlversuche je Quelle innerhalb von [`FENSTER`].
pub const MAX_FEHLVERSUCHE: usize = 10;

/// Beobachtungsfenster für Fehlversuche.
pub const FENSTER: Duration = Duration::from_secs(300);

/// Ab so vielen Quellen räumt ein neuer Eintrag die abgelaufenen weg.
const AUFRAEUM_SCHWELLE: usize = 1_024;

/// Harte Obergrenze der Quellen. Wer so viele Adressen hat, umgeht eine Sperre je Quelle
/// ohnehin; die Verdrängung schützt hier nur den Speicher.
const OBERGRENZE: usize = 10_000;

/// Das Zielkonto eines Versuchs, als Hash des Benutzernamens: so belegt ein langer erfundener
/// Name keinen Speicher. Der Schlüssel ist je Prozess zufällig, also nicht vorab berechenbar.
type Konto = u64;

static KONTO_SCHLUESSEL: LazyLock<RandomState> = LazyLock::new(RandomState::new);

fn konto(benutzername: &str) -> Konto {
    KONTO_SCHLUESSEL.hash_one(benutzername)
}

struct Versuch {
    zeit: Instant,
    /// `None`: Ziel unbekannt, kein Erfolg räumt den Versuch.
    konto: Option<Konto>,
}

fn laeuft(v: &Versuch, jetzt: Instant) -> bool {
    jetzt.saturating_duration_since(v.zeit) < FENSTER
}

/// Fehlversuche je Quell-IP. Die Zeit kommt von außen, damit Tests das Fenster ohne Warten
/// überspringen.
#[derive(Default)]
struct Tabelle {
    quellen: HashMap<IpAddr, Vec<Versuch>>,
}

impl Tabelle {
    fn ist_gesperrt(&mut self, ip: IpAddr, jetzt: Instant) -> bool {
        let Some(versuche) = self.quellen.get_mut(&ip) else {
            return false;
        };
        versuche.retain(|v| laeuft(v, jetzt));
        if versuche.is_empty() {
            self.quellen.remove(&ip);
            return false;
        }
        versuche.len() >= MAX_FEHLVERSUCHE
    }

    fn fehlversuch(&mut self, ip: IpAddr, konto: Option<Konto>, jetzt: Instant) {
        if !self.quellen.contains_key(&ip) && self.quellen.len() >= AUFRAEUM_SCHWELLE {
            self.quellen.retain(|_, versuche| {
                versuche.retain(|v| laeuft(v, jetzt));
                !versuche.is_empty()
            });
            if self.quellen.len() >= OBERGRENZE {
                self.aelteste_verdraengen();
            }
        }
        let versuche = self.quellen.entry(ip).or_default();
        versuche.retain(|v| laeuft(v, jetzt));
        versuche.push(Versuch { zeit: jetzt, konto });
        // Mehr als die Schwelle ändert nichts an der Sperre; die jüngsten halten sie am längsten.
        if versuche.len() > MAX_FEHLVERSUCHE {
            let zuviel = versuche.len() - MAX_FEHLVERSUCHE;
            versuche.drain(..zuviel);
        }
    }

    /// Verdrängt die Quelle, deren letzter Versuch am längsten zurückliegt.
    fn aelteste_verdraengen(&mut self) {
        let aelteste = self
            .quellen
            .iter()
            .min_by_key(|(_, versuche)| versuche.last().map(|v| v.zeit))
            .map(|(ip, _)| *ip);
        if let Some(ip) = aelteste {
            self.quellen.remove(&ip);
        }
    }

    fn erfolg(&mut self, ip: IpAddr, konto: Konto) {
        let Some(versuche) = self.quellen.get_mut(&ip) else {
            return;
        };
        versuche.retain(|v| v.konto != Some(konto));
        if versuche.is_empty() {
            self.quellen.remove(&ip);
        }
    }
}

/// Prozessweit statt in `AppState`, damit Test-Konstruktionen unberührt bleiben.
static FEHLVERSUCHE: LazyLock<Mutex<Tabelle>> = LazyLock::new(|| Mutex::new(Tabelle::default()));

fn tabelle() -> std::sync::MutexGuard<'static, Tabelle> {
    FEHLVERSUCHE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ist diese Quelle aktuell gesperrt?
///
/// Synchron: der `MutexGuard` darf kein `.await` überleben, sonst wird der Handler `!Send`.
pub fn ist_gesperrt(ip: IpAddr) -> bool {
    tabelle().ist_gesperrt(ip, Instant::now())
}

/// Vermerkt einen Fehlversuch der Quelle gegen `benutzername`; `None`, wenn das Ziel unbekannt
/// ist.
pub fn fehlversuch(ip: IpAddr, benutzername: Option<&str>) {
    tabelle().fehlversuch(ip, benutzername.map(konto), Instant::now());
}

/// Räumt nach erfolgreicher Anmeldung die Fehlversuche der Quelle gegen genau dieses Konto.
/// Versuche gegen andere Konten bleiben stehen (s. Modulkopf).
pub fn erfolg(ip: IpAddr, benutzername: &str) {
    tabelle().erfolg(ip, konto(benutzername));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    /// Die n-te Adresse aus 2001:db8::/32, für viele einmalige Quellen.
    fn ip6(n: usize) -> IpAddr {
        IpAddr::V6(std::net::Ipv6Addr::from(0x2001_0db8_u128 << 96 | n as u128))
    }

    #[test]
    fn sperrt_erst_ab_der_schwelle() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.1");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
            assert!(
                !t.ist_gesperrt(quelle, jetzt),
                "unterhalb der Schwelle nicht sperren"
            );
        }
        t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        assert!(t.ist_gesperrt(quelle, jetzt), "ab der Schwelle sperren");
    }

    #[test]
    fn sperre_laeuft_nach_dem_fenster_aus() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.5");
        for _ in 0..MAX_FEHLVERSUCHE {
            t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        }
        assert!(t.ist_gesperrt(quelle, jetzt));
        assert!(!t.ist_gesperrt(quelle, jetzt + FENSTER));
        assert!(t.quellen.is_empty(), "die abgelaufene Quelle ist geräumt");
    }

    #[test]
    fn erfolg_raeumt_die_eigenen_fehlversuche() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.2");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(quelle, Some(konto("max")), jetzt);
        }
        t.erfolg(quelle, konto("max"));
        t.fehlversuch(quelle, Some(konto("max")), jetzt);
        assert!(
            !t.ist_gesperrt(quelle, jetzt),
            "wer sich vertippt und dann anmeldet, bringt die Quelle (NAT) nicht näher an die Sperre"
        );
        assert_eq!(t.quellen[&quelle].len(), 1);
    }

    #[test]
    fn erfolg_mit_eigenem_konto_laesst_fremde_fehlversuche_stehen() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.6");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        }
        t.erfolg(quelle, konto("innentaeter"));
        t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        assert!(
            t.ist_gesperrt(quelle, jetzt),
            "der eigene Login setzt die Sperre für das Fremdkonto nicht zurück"
        );
    }

    #[test]
    fn versuche_ohne_ziel_raeumt_kein_erfolg() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.7");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(quelle, None, jetzt);
        }
        t.erfolg(quelle, konto("admin"));
        t.fehlversuch(quelle, None, jetzt);
        assert!(t.ist_gesperrt(quelle, jetzt));
    }

    #[test]
    fn quellen_sind_unabhaengig() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let angreifer = ip("192.0.2.3");
        let unbeteiligt = ip("192.0.2.4");

        for _ in 0..MAX_FEHLVERSUCHE {
            t.fehlversuch(angreifer, Some(konto("admin")), jetzt);
        }
        assert!(t.ist_gesperrt(angreifer, jetzt));
        assert!(
            !t.ist_gesperrt(unbeteiligt, jetzt),
            "andere Quellen bleiben frei"
        );
    }

    #[test]
    fn je_quelle_bleiben_hoechstens_die_schwelle_an_versuchen() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.8");
        for _ in 0..3 * MAX_FEHLVERSUCHE {
            t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        }
        assert_eq!(t.quellen[&quelle].len(), MAX_FEHLVERSUCHE);
        assert!(t.ist_gesperrt(quelle, jetzt));
    }

    #[test]
    fn tabelle_bleibt_bei_vielen_einmaligen_quellen_unter_der_schwelle() {
        let mut t = Tabelle::default();
        let start = Instant::now();
        // Jede Quelle versucht es einmal; jede Welle liegt ein Fenster nach der vorigen.
        for welle in 0..5 {
            let jetzt = start + FENSTER * welle;
            for n in 0..AUFRAEUM_SCHWELLE {
                t.fehlversuch(ip6(welle as usize * AUFRAEUM_SCHWELLE + n), None, jetzt);
            }
            assert!(
                t.quellen.len() <= AUFRAEUM_SCHWELLE,
                "Welle {welle}: {} Quellen",
                t.quellen.len()
            );
        }
    }

    #[test]
    fn tabelle_bleibt_auch_innerhalb_eines_fensters_unter_der_obergrenze() {
        let mut t = Tabelle::default();
        let start = Instant::now();
        for n in 0..OBERGRENZE + 500 {
            t.fehlversuch(ip6(n), None, start + Duration::from_millis(n as u64));
        }
        assert_eq!(t.quellen.len(), OBERGRENZE);
        assert!(
            !t.quellen.contains_key(&ip6(0)),
            "verdrängt wird die Quelle mit dem ältesten letzten Versuch"
        );
        assert!(t.quellen.contains_key(&ip6(OBERGRENZE + 499)));
    }
}
