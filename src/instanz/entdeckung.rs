//! Entdeckung von Instanzen im lokalen Netz per mDNS/DNS-SD (LLH-1497, Change
//! `t10a7luh-elw-lan-direktkopplung`, design.md D6, Spec `instanz-entdeckung`).
//!
//! - Nur mit `--lan-entdeckung` und `--tls`, nie auf einem Loopback-Bind ([`startbedingung`]).
//!   Ohne Schalter sendet die Instanz kein Multicast.
//! - Die Ankündigung trägt nur Kennung, Name, Fingerabdruck des Instanzschlüssels und
//!   Protokollversion ([`Ankuendigung::txt`]), keine Daten einer Org, eines Kontos oder Einsatzes.
//! - Eine Ankündigung ist ein unbestätigter Hinweis: Vertrauen entsteht nur über Kopplungscode,
//!   Prüfwert und signierte Aussagen. Eine neu gefundene Adresse gilt erst nach einer signierten
//!   Antwort der Gegenstelle ([`crate::instanz::melden`]).
//! - Gesucht wird über die Naht [`Sucher`], damit Tests ohne Multicast auskommen; der Daemon
//!   läuft in einem eigenen Thread von `mdns-sd`.

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};
use utoipa::ToSchema;

/// Dienstname der Ankündigung.
pub const DIENST: &str = "_lifeline-hub._tcp.local.";

/// So lange sucht die Liste „Im Netz gefunden“.
pub const SUCHDAUER: Duration = Duration::from_secs(3);

/// Was eine Instanz über sich ankündigt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ankuendigung {
    pub kennung: String,
    pub name: String,
    /// Fingerabdruck des Instanzschlüssels, wie ihn die Seite „Instanzkopplung“ zeigt.
    pub fingerabdruck: String,
    pub protokoll: u32,
}

impl Ankuendigung {
    /// TXT-Einträge: `k` Kennung, `n` Name (gekürzt), `f` Fingerabdruck, `pv` Protokoll.
    pub fn txt(&self) -> Vec<(&'static str, String)> {
        vec![
            ("k", self.kennung.clone()),
            ("n", self.name.chars().take(60).collect()),
            ("f", self.fingerabdruck.clone()),
            ("pv", self.protokoll.to_string()),
        ]
    }
}

/// Eine im lokalen Netz gefundene Instanz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct InstanzGefunden {
    pub kennung: String,
    pub name: String,
    pub fingerabdruck: String,
    pub protokoll: u32,
    /// Adressen zum Einlösen, bevorzugt IPv4, etwa `https://192.168.1.20:8443`.
    pub adressen: Vec<String>,
    /// Mit dieser Instanz besteht schon eine Kopplung.
    pub gekoppelt: bool,
}

/// Warum die Entdeckung nicht startet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NichtGestartet {
    Aus,
    OhneTls,
    Loopback,
}

impl NichtGestartet {
    pub fn text(self) -> &'static str {
        match self {
            Self::Aus => "LAN-Entdeckung aus",
            Self::OhneTls => "LAN-Entdeckung braucht --tls",
            Self::Loopback => "LAN-Entdeckung: der Server lauscht nur auf Loopback",
        }
    }
}

/// Ob die Entdeckung startet (Spec `instanz-entdeckung`, „Entdeckung nur mit Schalter“).
pub fn startbedingung(an: bool, tls: bool, bind: &str) -> Result<u16, NichtGestartet> {
    if !an {
        return Err(NichtGestartet::Aus);
    }
    if !tls {
        return Err(NichtGestartet::OhneTls);
    }
    let addr: SocketAddr = bind.parse().map_err(|_| NichtGestartet::Loopback)?;
    if addr.ip().is_loopback() {
        return Err(NichtGestartet::Loopback);
    }
    Ok(addr.port())
}

/// Adressen zum Einlösen aus IP und Port: IPv4 zuerst, Link-Local-IPv6 nie.
pub fn adressen(ips: &[IpAddr], port: u16) -> Vec<String> {
    let mut v4: Vec<String> = ips
        .iter()
        .filter_map(|ip| match ip {
            IpAddr::V4(a) if !a.is_loopback() => Some(format!("https://{a}:{port}")),
            _ => None,
        })
        .collect();
    v4.sort();
    let mut v6: Vec<String> = ips
        .iter()
        .filter_map(|ip| match ip {
            IpAddr::V6(a) if !a.is_loopback() && (a.segments()[0] & 0xffc0) != 0xfe80 => {
                Some(format!("https://[{a}]:{port}"))
            }
            _ => None,
        })
        .collect();
    v6.sort();
    v4.extend(v6);
    v4
}

/// Die Naht für die Suche: echtes mDNS im Betrieb, eine Attrappe im Test. Blockiert bis zu
/// `dauer`.
pub trait Sucher: Send + Sync {
    fn suche(&self, dauer: Duration) -> Vec<InstanzGefunden>;
}

/// Sucher je Instanz (Kennung), weil Tests mehrere Instanzen in einem Prozess betreiben.
fn sucher_registry() -> &'static RwLock<HashMap<String, Arc<dyn Sucher>>> {
    static R: OnceLock<RwLock<HashMap<String, Arc<dyn Sucher>>>> = OnceLock::new();
    R.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Setzt den Sucher der Instanz `kennung` und schaltet die Entdeckung dort an.
pub async fn set_sucher(
    pool: &SqlitePool,
    kennung: &str,
    sucher: Arc<dyn Sucher>,
) -> Result<(), AppError> {
    if let Ok(mut r) = sucher_registry().write() {
        r.insert(kennung.to_string(), sucher);
    }
    save_an(pool, true).await
}

/// Schreibt beim Start, ob die Entdeckung läuft.
pub async fn save_an(pool: &SqlitePool, an: bool) -> Result<(), AppError> {
    crate::instanz::identitaet::load_or_create(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    sqlx::query("UPDATE instanz_identitaet SET lan_entdeckung_an = ?")
        .bind(an)
        .execute(pool)
        .await?;
    Ok(())
}

/// Ob die LAN-Entdeckung an dieser Instanz läuft (beim Start gesetzt).
pub async fn is_an(pool: &SqlitePool) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT lan_entdeckung_an FROM instanz_identitaet")
            .fetch_optional(pool)
            .await?
            .unwrap_or(0)
            == 1,
    )
}

/// Sucht `dauer` lang und liefert die gefundenen Instanzen ohne die eigene, schon gekoppelte
/// markiert. Leer, wenn die Entdeckung hier nicht läuft.
pub async fn suche(pool: &SqlitePool, dauer: Duration) -> Result<Vec<InstanzGefunden>, AppError> {
    if !is_an(pool).await? {
        return Ok(Vec::new());
    }
    let ich: String = sqlx::query_scalar("SELECT kennung FROM instanz_identitaet")
        .fetch_one(pool)
        .await?;
    let Some(sucher) = sucher_registry()
        .read()
        .ok()
        .and_then(|r| r.get(&ich).cloned())
    else {
        return Ok(Vec::new());
    };
    let mut gefunden = tokio::task::spawn_blocking(move || sucher.suche(dauer))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    gefunden.retain(|g| g.kennung != ich);
    gefunden.sort_by(|a, b| a.name.cmp(&b.name).then(a.kennung.cmp(&b.kennung)));
    gefunden.dedup_by(|a, b| a.kennung == b.kennung);
    for g in &mut gefunden {
        g.gekoppelt = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM instanz_kopplung WHERE gegenueber_kennung = ? \
             AND zustand IN ('aktiv', 'angebahnt'))",
        )
        .bind(&g.kennung)
        .fetch_one(pool)
        .await?;
    }
    Ok(gefunden)
}

/// Adressen, unter denen die Instanz `kennung` gerade angekündigt ist (Neuauflösen einer
/// Direktkopplung, Spec „Eine Direktkopplung findet ihre Gegenstelle neu“).
pub async fn suche_kennung(
    pool: &SqlitePool,
    kennung: &str,
    dauer: Duration,
) -> Result<Vec<String>, AppError> {
    Ok(suche(pool, dauer)
        .await?
        .into_iter()
        .filter(|g| g.kennung == kennung)
        .flat_map(|g| g.adressen)
        .collect())
}

/// Der echte Sucher über einen laufenden mDNS-Daemon.
pub struct MdnsSucher {
    daemon: mdns_sd::ServiceDaemon,
}

impl Sucher for MdnsSucher {
    fn suche(&self, dauer: Duration) -> Vec<InstanzGefunden> {
        let Ok(empfang) = self.daemon.browse(DIENST) else {
            return Vec::new();
        };
        let ende = Instant::now() + dauer;
        let mut aus = Vec::new();
        while let Some(rest) = ende.checked_duration_since(Instant::now()) {
            match empfang.recv_timeout(rest) {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(s)) => {
                    let wert = |k: &str| s.get_property_val_str(k).map(str::to_string);
                    let (Some(kennung), Some(fp)) = (wert("k"), wert("f")) else {
                        continue;
                    };
                    let ips: Vec<IpAddr> =
                        s.get_addresses().iter().map(|a| a.to_ip_addr()).collect();
                    aus.push(InstanzGefunden {
                        kennung,
                        name: wert("n").unwrap_or_default(),
                        fingerabdruck: fp,
                        protokoll: wert("pv").and_then(|p| p.parse().ok()).unwrap_or(0),
                        adressen: adressen(&ips, s.get_port()),
                        gekoppelt: false,
                    });
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = self.daemon.stop_browse(DIENST);
        aus
    }
}

/// Startet den Daemon, kündigt die Instanz an und registriert den Sucher. Fehler beim Start
/// halten den Server nicht auf (die Adresse von Hand geht immer).
pub async fn starte(pool: &SqlitePool, a: &Ankuendigung, port: u16) -> Result<(), AppError> {
    let daemon =
        mdns_sd::ServiceDaemon::new().map_err(|e| AppError::Internal(format!("mDNS: {e}")))?;
    let kurz: String = a.kennung.chars().take(8).collect();
    let instanzname = format!("{} ({kurz})", a.name.chars().take(40).collect::<String>());
    let txt: Vec<(&str, String)> = a.txt();
    let txt: Vec<(&str, &str)> = txt.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let info = mdns_sd::ServiceInfo::new(
        DIENST,
        &instanzname,
        &format!("lifeline-{kurz}.local."),
        "",
        port,
        &txt[..],
    )
    .map_err(|e| AppError::Internal(format!("mDNS: {e}")))?
    .enable_addr_auto();
    daemon
        .register(info)
        .map_err(|e| AppError::Internal(format!("mDNS: {e}")))?;
    set_sucher(pool, &a.kennung, Arc::new(MdnsSucher { daemon })).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startbedingung_braucht_schalter_tls_und_kein_loopback() {
        assert_eq!(
            startbedingung(false, true, "0.0.0.0:8443"),
            Err(NichtGestartet::Aus)
        );
        assert_eq!(
            startbedingung(true, false, "0.0.0.0:8443"),
            Err(NichtGestartet::OhneTls)
        );
        assert_eq!(
            startbedingung(true, true, "127.0.0.1:8443"),
            Err(NichtGestartet::Loopback)
        );
        assert_eq!(
            startbedingung(true, true, "[::1]:8443"),
            Err(NichtGestartet::Loopback)
        );
        assert_eq!(startbedingung(true, true, "0.0.0.0:8443"), Ok(8443));
        assert_eq!(startbedingung(true, true, "192.168.1.20:443"), Ok(443));
        assert_eq!(
            NichtGestartet::OhneTls.text(),
            "LAN-Entdeckung braucht --tls"
        );
    }

    #[test]
    fn die_ankuendigung_traegt_nur_kennung_name_fingerabdruck_und_protokoll() {
        let a = Ankuendigung {
            kennung: "k-1".into(),
            name: "ELW 1".into(),
            fingerabdruck: "AB12".into(),
            protokoll: 3,
        };
        let schluessel: Vec<&str> = a.txt().iter().map(|(k, _)| *k).collect();
        assert_eq!(schluessel, ["k", "n", "f", "pv"]);
        assert_eq!(a.txt()[3].1, "3");
    }

    /// Zwei echte Daemons auf derselben Maschine: der eine kündigt an, der andere findet. Braucht
    /// Multicast auf einer Schnittstelle; in Containern ohne Host-Netz fehlt es oft.
    #[test]
    #[ignore = "braucht Multicast auf der Maschine; lokal mit `cargo test -- --ignored`"]
    fn zwei_daemons_finden_einander() {
        let a = Ankuendigung {
            kennung: format!("test-{}", std::process::id()),
            name: "ELW Test".into(),
            fingerabdruck: "AB12".into(),
            protokoll: 3,
        };
        let anbieter = mdns_sd::ServiceDaemon::new().unwrap();
        let txt = a.txt();
        let txt: Vec<(&str, &str)> = txt.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let info = mdns_sd::ServiceInfo::new(
            DIENST,
            "ELW Test",
            "lifeline-test.local.",
            "",
            8443,
            &txt[..],
        )
        .unwrap()
        .enable_addr_auto();
        anbieter.register(info).unwrap();
        let sucher = MdnsSucher {
            daemon: mdns_sd::ServiceDaemon::new().unwrap(),
        };
        let gefunden = sucher.suche(Duration::from_secs(5));
        let _ = anbieter.shutdown();
        assert!(
            gefunden
                .iter()
                .any(|g| g.kennung == a.kennung && g.fingerabdruck == "AB12"),
            "{gefunden:?}"
        );
    }

    #[test]
    fn adressen_ipv4_zuerst_ohne_loopback_und_link_local() {
        let ips: Vec<IpAddr> = [
            "fe80::1",
            "2001:db8::5",
            "192.168.1.20",
            "127.0.0.1",
            "10.0.0.2",
        ]
        .iter()
        .map(|s| s.parse().unwrap())
        .collect();
        assert_eq!(
            adressen(&ips, 8443),
            [
                "https://10.0.0.2:8443",
                "https://192.168.1.20:8443",
                "https://[2001:db8::5]:8443"
            ]
        );
    }
}
