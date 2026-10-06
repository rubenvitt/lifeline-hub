//! Drossel für die öffentlichen Anmelde-Starts je Quelle (LFH-919): `GET /api/auth/oidc/start`,
//! `POST /api/auth/webauthn/auth/start` und `POST /api/auth/webauthn/discoverable/start`.
//!
//! Jeder Start legt einen Eintrag im begrenzten Zeremonie-Speicher an (`oidc/state.rs`,
//! `webauthn/state.rs`). Die Obergrenze dort schützt den Speicher, aber eine einzelne Quelle
//! könnte sie allein füllen und damit alle anderen aussperren. Die Drossel lässt je Quelle
//! höchstens [`MAX_STARTS`] je [`FENSTER`] zu; darüber antworten die Starts mit 429. Eine Quelle
//! belegt so in der TTL höchstens 150 (WebAuthn, 5 min) bzw. 300 (OIDC, 10 min) der 10.000 Plätze.
//!
//! **Grenze der Drossel:** Wer viele Quellen hat (ein Botnetz, oder rund 70 bzw. 35 IPv6-/64 aus
//! einem eigenen Präfix), füllt den Speicher trotzdem. Dann antworten Passkey- und SSO-Start bis
//! zum Ablauf der Einträge mit 503 bzw. mit dem Fehler-Redirect; der Passwort-Login bleibt. Das
//! ist der bewusste Tausch gegen unbegrenzten Speicher.
//!
//! Ohne `LIFELINE_TRUSTED_PROXIES` hinter einem Reverse-Proxy ist der Proxy die einzige Quelle,
//! und alle teilen sich [`MAX_STARTS`] (`docs/betrieb/env-registry.md`).
//!
//! Eigener Zähler, getrennt von den Fehlversuchen in `rate_limit.rs`: ein Start ist kein
//! Fehlversuch, und eine Wache hinter einer NAT-Adresse meldet sich zu Dienstbeginn gesammelt an.
//! Quelle wie dort: IPv6 je /64, IPv4 je Adresse ([`crate::auth::rate_limit::quelle`]).
//!
//! **Die Tabelle ist begrenzt** wie die der Fehlversuche: ab [`AUFRAEUM_SCHWELLE`] Quellen räumt
//! ein neuer Eintrag die abgelaufenen Fenster weg (höchstens alle [`AUFRAEUM_PAUSE`]), bei
//! [`OBERGRENZE`] verdrängt er die Quellen mit dem ältesten Fenster.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::auth::rate_limit::quelle;

/// Erlaubte Starts je Quelle innerhalb von [`FENSTER`].
pub const MAX_STARTS: u32 = 30;

/// Zählfenster.
pub const FENSTER: Duration = Duration::from_secs(60);

const AUFRAEUM_SCHWELLE: usize = 1_024;
const AUFRAEUM_PAUSE: Duration = Duration::from_secs(1);
const OBERGRENZE: usize = 10_000;
const NACH_VERDRAENGUNG: usize = OBERGRENZE - OBERGRENZE / 10;

struct Fenster {
    beginn: Instant,
    anzahl: u32,
}

impl Fenster {
    fn laeuft(&self, jetzt: Instant) -> bool {
        jetzt.saturating_duration_since(self.beginn) < FENSTER
    }
}

#[derive(Default)]
struct Tabelle {
    quellen: HashMap<IpAddr, Fenster>,
    naechste_raeumung: Option<Instant>,
}

impl Tabelle {
    /// Zählt einen Start der Quelle; `false`, wenn ihr Fenster schon voll ist (dann zählt er
    /// nicht mit).
    fn start(&mut self, ip: IpAddr, jetzt: Instant) -> bool {
        let ip = quelle(ip);
        if !self.quellen.contains_key(&ip) && self.quellen.len() >= AUFRAEUM_SCHWELLE {
            if self.naechste_raeumung.is_none_or(|t| jetzt >= t) {
                self.quellen.retain(|_, f| f.laeuft(jetzt));
                self.naechste_raeumung = Some(jetzt + AUFRAEUM_PAUSE);
            }
            if self.quellen.len() >= OBERGRENZE {
                self.aelteste_verdraengen();
            }
        }
        let fenster = self.quellen.entry(ip).or_insert(Fenster {
            beginn: jetzt,
            anzahl: 0,
        });
        if !fenster.laeuft(jetzt) {
            *fenster = Fenster {
                beginn: jetzt,
                anzahl: 0,
            };
        }
        if fenster.anzahl >= MAX_STARTS {
            return false;
        }
        fenster.anzahl += 1;
        true
    }

    fn aelteste_verdraengen(&mut self) {
        let zuviel = self.quellen.len().saturating_sub(NACH_VERDRAENGUNG);
        if zuviel == 0 {
            return;
        }
        let mut nach_alter: Vec<(Instant, IpAddr)> =
            self.quellen.iter().map(|(ip, f)| (f.beginn, *ip)).collect();
        nach_alter.select_nth_unstable_by_key(zuviel - 1, |(beginn, _)| *beginn);
        for (_, ip) in &nach_alter[..zuviel] {
            self.quellen.remove(ip);
        }
    }
}

/// Prozessweit statt in `AppState`, damit Test-Konstruktionen unberührt bleiben.
static STARTS: LazyLock<Mutex<Tabelle>> = LazyLock::new(|| Mutex::new(Tabelle::default()));

/// Zählt einen Anmelde-Start der Quelle; `false` heißt: abweisen (429).
///
/// Synchron: der `MutexGuard` darf kein `.await` überleben, sonst wird der Handler `!Send`.
pub fn start_erlaubt(ip: IpAddr) -> bool {
    STARTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .start(ip, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn ip6(n: usize) -> IpAddr {
        IpAddr::V6(std::net::Ipv6Addr::from(
            0x2001_0db8_u128 << 96 | (n as u128) << 64 | 1,
        ))
    }

    #[test]
    fn erlaubt_bis_zur_schwelle_und_weist_dann_ab() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for n in 0..MAX_STARTS {
            assert!(t.start(ip("192.0.2.1"), jetzt), "Start {n}");
        }
        assert!(!t.start(ip("192.0.2.1"), jetzt));
        assert!(
            t.start(ip("192.0.2.2"), jetzt),
            "andere Quellen bleiben frei"
        );
    }

    #[test]
    fn nach_dem_fenster_ist_die_quelle_wieder_frei() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for _ in 0..=MAX_STARTS {
            t.start(ip("192.0.2.3"), jetzt);
        }
        assert!(!t.start(ip("192.0.2.3"), jetzt + FENSTER - Duration::from_millis(1)));
        assert!(t.start(ip("192.0.2.3"), jetzt + FENSTER));
    }

    #[test]
    fn adressen_eines_ipv6_64_teilen_ein_fenster() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for n in 0..MAX_STARTS {
            assert!(t.start(ip(&format!("2001:db8:5:6::{:x}", n + 1)), jetzt));
        }
        assert!(!t.start(ip("2001:db8:5:6:ffff::1"), jetzt));
        assert_eq!(t.quellen.len(), 1);
    }

    #[test]
    fn tabelle_bleibt_unter_der_obergrenze() {
        let mut t = Tabelle::default();
        let start = Instant::now();
        for n in 0..OBERGRENZE + 500 {
            t.start(ip6(n), start + Duration::from_millis(n as u64));
        }
        assert!(t.quellen.len() <= OBERGRENZE, "{} Quellen", t.quellen.len());
        assert!(!t.quellen.contains_key(&quelle(ip6(0))));
        assert!(t.quellen.contains_key(&quelle(ip6(OBERGRENZE + 499))));
    }

    #[test]
    fn abgelaufene_fenster_werden_geraeumt() {
        let mut t = Tabelle::default();
        let start = Instant::now();
        for welle in 0..3u32 {
            let jetzt = start + FENSTER * welle;
            for n in 0..AUFRAEUM_SCHWELLE {
                t.start(ip6(welle as usize * AUFRAEUM_SCHWELLE + n), jetzt);
            }
            assert!(t.quellen.len() <= AUFRAEUM_SCHWELLE, "Welle {welle}");
        }
    }
}
