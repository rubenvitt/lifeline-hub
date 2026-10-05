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
//! **Je Quelle bleiben die ältesten [`MAX_FEHLVERSUCHE`] Versuche.** Gleichzeitige Anfragen kommen
//! alle an der Sperrprüfung vorbei, bevor ihr Fehlversuch zählt. Behielte die Tabelle die
//! jüngsten, verdrängte ein Schwall eigener Fehlversuche die fremden, und der eigene Erfolg
//! räumte danach die ganze Quelle.
//!
//! **Eine Quelle ist bei IPv6 ein /64, bei IPv4 die Einzeladresse** (LFH-866). Ein Anschluss
//! bekommt ein /64 und wechselt darin die Adresse nach Belieben; je Einzeladresse gezählt, käme
//! er mit Rotation an der Sperre vorbei. IPv4-gemappte Adressen (`::ffff:a.b.c.d`) zählen als
//! IPv4, sonst teilten alle IPv4-Clients hinter einem Dual-Stack-Socket ein /64. Gekürzt wird nur
//! der Schlüssel der Sperre: Log und `auth_audit` behalten die volle Adresse.
//!
//! **Die Tabelle ist begrenzt:** ab [`AUFRAEUM_SCHWELLE`] Quellen räumt ein neuer Eintrag die
//! abgelaufenen weg (höchstens alle [`AUFRAEUM_PAUSE`]), bei [`OBERGRENZE`] verdrängt er die
//! Quellen mit dem ältesten letzten Versuch auf [`NACH_VERDRAENGUNG`]. Sonst wüchse sie mit vielen
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

/// Mindestabstand zweier Aufräumläufe: ein Lauf geht über die ganze Tabelle, unter einer Flut
/// sonst bei jedem neuen Eintrag.
const AUFRAEUM_PAUSE: Duration = Duration::from_secs(1);

/// Harte Obergrenze der Quellen. Wer so viele Adressen hat, umgeht eine Sperre je Quelle
/// ohnehin; die Verdrängung schützt hier nur den Speicher.
const OBERGRENZE: usize = 10_000;

/// Auf so viele Quellen verdrängt ein Lauf, damit nicht jeder neue Eintrag die Tabelle absucht.
const NACH_VERDRAENGUNG: usize = OBERGRENZE - OBERGRENZE / 10;

/// Das Zielkonto eines Versuchs, als Hash des Benutzernamens: so belegt ein langer erfundener
/// Name keinen Speicher. Der Schlüssel ist je Prozess zufällig, also nicht vorab berechenbar.
type Konto = u64;

static KONTO_SCHLUESSEL: LazyLock<RandomState> = LazyLock::new(RandomState::new);

/// Gehasht wird kleingeschrieben (A–Z), wie die Suche vergleicht (`COLLATE NOCASE`, LFH-981):
/// sonst räumte ein Erfolg als `max` nicht die Fehlversuche derselben Quelle als `Max`.
fn konto(benutzername: &str) -> Konto {
    KONTO_SCHLUESSEL.hash_one(benutzername.to_ascii_lowercase())
}

struct Versuch {
    zeit: Instant,
    /// `None`: Ziel unbekannt, kein Erfolg räumt den Versuch.
    konto: Option<Konto>,
}

/// Der Schlüssel einer Quelle in der Tabelle (s. Modulkopf).
fn quelle(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(v6) => IpAddr::V6((u128::from(v6) & !u128::from(u64::MAX)).into()),
        v4 => v4,
    }
}

fn laeuft(v: &Versuch, jetzt: Instant) -> bool {
    jetzt.saturating_duration_since(v.zeit) < FENSTER
}

/// Fehlversuche je Quelle ([`quelle`]). Die Zeit kommt von außen, damit Tests das Fenster ohne
/// Warten überspringen.
#[derive(Default)]
struct Tabelle {
    quellen: HashMap<IpAddr, Vec<Versuch>>,
    /// Frühester Zeitpunkt des nächsten Aufräumlaufs.
    naechste_raeumung: Option<Instant>,
}

impl Tabelle {
    fn ist_gesperrt(&mut self, ip: IpAddr, jetzt: Instant) -> bool {
        let ip = quelle(ip);
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
        let ip = quelle(ip);
        if !self.quellen.contains_key(&ip) && self.quellen.len() >= AUFRAEUM_SCHWELLE {
            if self.naechste_raeumung.is_none_or(|t| jetzt >= t) {
                self.quellen.retain(|_, versuche| {
                    versuche.retain(|v| laeuft(v, jetzt));
                    !versuche.is_empty()
                });
                self.naechste_raeumung = Some(jetzt + AUFRAEUM_PAUSE);
            }
            if self.quellen.len() >= OBERGRENZE {
                self.aelteste_verdraengen();
            }
        }
        let versuche = self.quellen.entry(ip).or_default();
        versuche.retain(|v| laeuft(v, jetzt));
        // Über der Schwelle zählt nichts mehr dazu; die ältesten bleiben (s. Modulkopf).
        if versuche.len() < MAX_FEHLVERSUCHE {
            versuche.push(Versuch { zeit: jetzt, konto });
        }
    }

    /// Verdrängt die Quellen mit dem ältesten letzten Versuch, bis [`NACH_VERDRAENGUNG`] bleiben.
    fn aelteste_verdraengen(&mut self) {
        let zuviel = self.quellen.len().saturating_sub(NACH_VERDRAENGUNG);
        if zuviel == 0 {
            return;
        }
        let mut nach_alter: Vec<(Option<Instant>, IpAddr)> = self
            .quellen
            .iter()
            .map(|(ip, versuche)| (versuche.last().map(|v| v.zeit), *ip))
            .collect();
        nach_alter.select_nth_unstable_by_key(zuviel - 1, |(zeit, _)| *zeit);
        for (_, ip) in &nach_alter[..zuviel] {
            self.quellen.remove(ip);
        }
    }

    fn erfolg(&mut self, ip: IpAddr, konto: Konto) {
        let ip = quelle(ip);
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

    /// Eine Adresse im n-ten /64 aus 2001:db8::/32, für viele einmalige Quellen.
    fn ip6(n: usize) -> IpAddr {
        IpAddr::V6(std::net::Ipv6Addr::from(
            0x2001_0db8_u128 << 96 | (n as u128) << 64 | 1,
        ))
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

    /// Die Suche vergleicht ohne Groß-/Kleinschreibung; die Zählung je Konto muss es auch.
    #[test]
    fn erfolg_raeumt_fehlversuche_in_anderer_schreibweise() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.9");

        t.fehlversuch(quelle, Some(konto("Max")), jetzt);
        t.fehlversuch(quelle, Some(konto("MAX")), jetzt);
        t.erfolg(quelle, konto("max"));
        assert!(
            !t.quellen.contains_key(&quelle),
            "`Max` und `max` sind dasselbe Konto (LFH-981)"
        );
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

    /// Ein Anschluss bekommt ein /64; wer darin die Adresse wechselt, bleibt dieselbe Quelle.
    #[test]
    fn wechselnde_adressen_eines_ipv6_64_sperren_gemeinsam() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for n in 0..MAX_FEHLVERSUCHE {
            let rotiert = ip(&format!("2001:db8:1:2:{n:x}::{:x}", n * 7 + 1));
            assert!(!t.ist_gesperrt(rotiert, jetzt));
            t.fehlversuch(rotiert, Some(konto("opfer")), jetzt);
        }
        assert!(
            t.ist_gesperrt(ip("2001:db8:1:2:ffff:ffff:ffff:ffff"), jetzt),
            "jede Adresse desselben /64 ist gesperrt"
        );
        assert!(
            !t.ist_gesperrt(ip("2001:db8:1:3::1"), jetzt),
            "das Nachbar-/64 bleibt frei"
        );
        assert_eq!(
            t.quellen.len(),
            1,
            "Rotation im /64 legt keine neuen Einträge an"
        );
    }

    #[test]
    fn erfolg_raeumt_ueber_das_ganze_ipv6_64() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(ip("2001:db8:1:2::a"), Some(konto("max")), jetzt);
        }
        t.erfolg(ip("2001:db8:1:2::b"), konto("max"));
        assert!(t.quellen.is_empty());
    }

    /// IPv4 bleibt Einzeladresse: eine NAT-Wache neben der anderen sperrt nicht mit.
    #[test]
    fn ipv4_bleibt_einzeladresse() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for _ in 0..MAX_FEHLVERSUCHE {
            t.fehlversuch(ip("192.0.2.10"), None, jetzt);
        }
        assert!(t.ist_gesperrt(ip("192.0.2.10"), jetzt));
        assert!(!t.ist_gesperrt(ip("192.0.2.11"), jetzt));
    }

    /// Ein Dual-Stack-Socket liefert IPv4-Clients als `::ffff:a.b.c.d`. Auf /64 gekürzt hätten
    /// alle denselben Schlüssel, und ein Angreifer sperrte jeden IPv4-Client mit.
    #[test]
    fn ipv4_gemappte_adressen_zaehlen_als_ipv4() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        for _ in 0..MAX_FEHLVERSUCHE {
            t.fehlversuch(ip("::ffff:192.0.2.12"), None, jetzt);
        }
        assert!(t.ist_gesperrt(ip("192.0.2.12"), jetzt));
        assert!(
            !t.ist_gesperrt(ip("::ffff:192.0.2.13"), jetzt),
            "ein anderer IPv4-Client hinter dem Dual-Stack-Socket bleibt frei"
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

    /// Gleichzeitige Anfragen kommen alle an der Sperrprüfung vorbei, bevor ihr Fehlversuch
    /// zählt. Eigene Fehlversuche über die Schwelle dürfen die fremden nicht verdrängen, sonst
    /// räumt der eigene Erfolg danach die ganze Quelle.
    #[test]
    fn eigene_fehlversuche_verdraengen_keine_fremden() {
        let mut t = Tabelle::default();
        let jetzt = Instant::now();
        let quelle = ip("192.0.2.9");

        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        }
        for _ in 0..MAX_FEHLVERSUCHE {
            t.fehlversuch(quelle, Some(konto("innentaeter")), jetzt);
        }
        t.erfolg(quelle, konto("innentaeter"));
        t.fehlversuch(quelle, Some(konto("opfer")), jetzt);
        assert!(
            t.ist_gesperrt(quelle, jetzt),
            "die Fremdversuche überleben den Schwall eigener Fehlversuche"
        );
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
        assert!(t.quellen.len() <= OBERGRENZE, "{} Quellen", t.quellen.len());
        assert!(
            !t.quellen.contains_key(&quelle(ip6(0))),
            "verdrängt wird die Quelle mit dem ältesten letzten Versuch"
        );
        assert!(t.quellen.contains_key(&quelle(ip6(OBERGRENZE + 499))));
    }
}
