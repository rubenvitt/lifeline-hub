use crate::client_ip::ClientIpSource;
use clap::{Parser, Subcommand};
use ipnet::IpNet;
use std::{net::IpAddr, path::PathBuf};

#[derive(Parser, Debug, Clone)]
#[command(version, about = "push-relais — APNs-Relais für Lifeline-Server")]
pub struct RelaisConfig {
    #[arg(long, env = "PUSH_RELAIS_BIND", default_value = "0.0.0.0:8089")]
    pub bind: String,
    /// Pfad der SQLite-Datei (`:memory:` für Tests).
    #[arg(
        long,
        env = "PUSH_RELAIS_DATENBANK",
        default_value = "push-relais.sqlite"
    )]
    pub datenbank: String,
    /// Apple-Schlüssel (`.p8`).
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_SCHLUESSEL",
        default_value = "AuthKey.p8"
    )]
    pub apns_schluessel: PathBuf,
    #[arg(long, env = "PUSH_RELAIS_APNS_KEY_ID", default_value = "")]
    pub apns_key_id: String,
    #[arg(long, env = "PUSH_RELAIS_APNS_TEAM_ID", default_value = "")]
    pub apns_team_id: String,
    #[arg(
        long,
        env = "PUSH_RELAIS_BUNDLE_ID",
        default_value = "dev.rubeen.lifeline.ios"
    )]
    pub bundle_id: String,
    /// Nachrichten je Server und Minute.
    #[arg(long, env = "PUSH_RELAIS_LIMIT_MINUTE", default_value_t = 600)]
    pub limit_minute: u32,
    /// Registrierungen je IP und Stunde.
    #[arg(long, env = "PUSH_RELAIS_REGISTRIERUNGEN_STUNDE", default_value_t = 10)]
    pub registrierungen_stunde: u32,
    /// Hinter einem Reverse-Proxy zählt der letzte (rechte) Eintrag von `X-Forwarded-For` als
    /// Client-IP, den der Proxy anhängt; sonst die Peer-Adresse.
    /// Für genau einen Proxy ohne CDN davor; nicht zusammen mit `PUSH_RELAIS_TRUSTED_PROXIES`.
    #[arg(long, env = "PUSH_RELAIS_HINTER_PROXY", default_value_t = false)]
    pub hinter_proxy: bool,
    /// Vertraute Proxys als Komma-Liste aus Netzen (CIDR) und Adressen, etwa das Docker-Netz von
    /// Traefik und die Bereiche eines CDN (LLH-2080). Nur wenn die Gegenstelle darin liegt, gilt
    /// `X-Forwarded-For`, von rechts gelesen bis zum ersten Eintrag außerhalb der Liste.
    #[arg(
        long,
        env = "PUSH_RELAIS_TRUSTED_PROXIES",
        value_delimiter = ',',
        value_parser = proxy_netz_parsen
    )]
    pub trusted_proxies: Vec<IpNet>,
    /// Bereiche eines CDN vor dem Proxy (etwa Cloudflare), nur zusammen mit
    /// `PUSH_RELAIS_TRUSTED_PROXIES`. Ein Eintrag daraus wird höchstens einmal übersprungen
    /// (LLH-2080), damit ein eigener Worker im CDN seine Adresse nicht frei wählt.
    #[arg(
        long,
        env = "PUSH_RELAIS_CDN_PROXIES",
        value_delimiter = ',',
        value_parser = proxy_netz_parsen
    )]
    pub cdn_proxies: Vec<IpNet>,
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_BASIS_PRODUCTION",
        default_value = "https://api.push.apple.com",
        hide = true
    )]
    pub apns_basis_production: String,
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_BASIS_SANDBOX",
        default_value = "https://api.sandbox.push.apple.com",
        hide = true
    )]
    pub apns_basis_sandbox: String,

    #[command(subcommand)]
    pub command: Option<Command>,
}

impl RelaisConfig {
    /// Woher die Client-Adresse für die Registrierungsgrenze kommt. Schalter und Liste zugleich
    /// sind ein Fehler: welche Regel dann gälte, wäre nicht zu sehen.
    pub fn client_ip_source(&self) -> anyhow::Result<ClientIpSource> {
        if !self.cdn_proxies.is_empty() && self.trusted_proxies.is_empty() {
            anyhow::bail!(
                "PUSH_RELAIS_CDN_PROXIES verlangt PUSH_RELAIS_TRUSTED_PROXIES \
                 (die Adresse des Proxys, über den das CDN das Relais erreicht)"
            );
        }
        match (self.hinter_proxy, self.trusted_proxies.is_empty()) {
            (true, false) => anyhow::bail!(
                "PUSH_RELAIS_HINTER_PROXY und PUSH_RELAIS_TRUSTED_PROXIES sind beide gesetzt; \
                 nur PUSH_RELAIS_TRUSTED_PROXIES verwenden"
            ),
            (_, false) => Ok(ClientIpSource::TrustedProxies {
                proxies: self.trusted_proxies.clone(),
                cdn: self.cdn_proxies.clone(),
            }),
            (true, true) => Ok(ClientIpSource::SingleProxy),
            (false, true) => Ok(ClientIpSource::Peer),
        }
    }
}

/// Ein Eintrag der Proxy-Liste, wie `LIFELINE_TRUSTED_PROXIES` im Hauptpaket
/// (`src/config.rs`): Netz in CIDR-Form oder einzelne Adresse. Hostname, leerer Eintrag und
/// IPv4-gemapptes Netz brechen den Start ab, statt still jedem Proxy zu misstrauen.
fn proxy_netz_parsen(eintrag: &str) -> Result<IpNet, String> {
    let eintrag = eintrag.trim();
    let netz = eintrag
        .parse::<IpNet>()
        .or_else(|_| eintrag.parse::<IpAddr>().map(IpNet::from))
        .map(|netz| netz.trunc())
        .map_err(|_| format!("'{eintrag}' ist weder ein Netz (CIDR) noch eine IP-Adresse"))?;
    if let IpNet::V6(v6) = netz {
        if v6.addr().to_ipv4_mapped().is_some() {
            return Err(format!(
                "'{eintrag}' ist IPv4-gemappt — das Netz als IPv4 angeben (z. B. 10.0.1.0/24)"
            ));
        }
    }
    Ok(netz)
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Dauerbetrieb (Standard).
    Serve,
    /// Sperrt einen Server: weitere Aufrufe werden abgewiesen.
    Sperren { server_id: String },
    /// Hebt die Sperre eines Servers auf.
    Entsperren { server_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_ip::ClientIpSource;

    fn parse(args: &[&str]) -> Result<RelaisConfig, clap::Error> {
        RelaisConfig::try_parse_from(std::iter::once("push-relais").chain(args.iter().copied()))
    }

    #[test]
    fn trusted_proxies_als_liste() {
        let cfg = parse(&["--trusted-proxies", "10.0.1.0/24,173.245.48.0/20"]).unwrap();
        let erwartet: Vec<IpNet> = vec![
            "10.0.1.0/24".parse().unwrap(),
            "173.245.48.0/20".parse().unwrap(),
        ];
        assert_eq!(cfg.trusted_proxies, erwartet);
        assert_eq!(
            cfg.client_ip_source().unwrap(),
            ClientIpSource::TrustedProxies {
                proxies: erwartet,
                cdn: vec![]
            }
        );
    }

    #[test]
    fn cdn_und_proxy_liste() {
        let cfg = parse(&[
            "--trusted-proxies",
            "10.0.1.0/24",
            "--cdn-proxies",
            "173.245.48.0/20,2a06:98c0::/29",
        ])
        .unwrap();
        assert_eq!(
            cfg.client_ip_source().unwrap(),
            ClientIpSource::TrustedProxies {
                proxies: vec!["10.0.1.0/24".parse().unwrap()],
                cdn: vec![
                    "173.245.48.0/20".parse().unwrap(),
                    "2a06:98c0::/29".parse().unwrap()
                ],
            }
        );
    }

    #[test]
    fn cdn_ohne_proxy_liste_bricht_ab() {
        let cfg = parse(&["--cdn-proxies", "173.245.48.0/20"]).unwrap();
        let fehler = cfg.client_ip_source().unwrap_err().to_string();
        assert!(fehler.contains("PUSH_RELAIS_CDN_PROXIES"), "{fehler}");
        let cfg = parse(&["--hinter-proxy", "--cdn-proxies", "173.245.48.0/20"]).unwrap();
        assert!(cfg.client_ip_source().is_err());
    }

    #[test]
    fn hostname_in_der_cdn_liste_bricht_ab() {
        assert!(parse(&["--cdn-proxies", "cloudflare"]).is_err());
    }

    #[test]
    fn einzeladresse_wird_zum_netz() {
        let cfg = parse(&["--trusted-proxies", "10.0.1.5"]).unwrap();
        assert_eq!(
            cfg.trusted_proxies,
            vec!["10.0.1.5/32".parse::<IpNet>().unwrap()]
        );
    }

    #[test]
    fn hostname_in_der_liste_bricht_ab() {
        assert!(parse(&["--trusted-proxies", "traefik"]).is_err());
    }

    #[test]
    fn leerer_eintrag_bricht_ab() {
        assert!(parse(&["--trusted-proxies", "10.0.1.5,"]).is_err());
    }

    #[test]
    fn gemapptes_netz_bricht_ab() {
        assert!(parse(&["--trusted-proxies", "::ffff:10.0.0.0/104"]).is_err());
    }

    #[test]
    fn beide_gesetzt_bricht_ab() {
        let cfg = parse(&["--hinter-proxy", "--trusted-proxies", "10.0.1.0/24"]).unwrap();
        let fehler = cfg.client_ip_source().unwrap_err().to_string();
        assert!(fehler.contains("PUSH_RELAIS_HINTER_PROXY"), "{fehler}");
        assert!(fehler.contains("PUSH_RELAIS_TRUSTED_PROXIES"), "{fehler}");
    }

    #[test]
    fn schalter_allein_bleibt_ein_proxy() {
        let cfg = parse(&["--hinter-proxy"]).unwrap();
        assert_eq!(cfg.client_ip_source().unwrap(), ClientIpSource::SingleProxy);
    }

    #[test]
    fn ohne_angabe_zaehlt_die_gegenstelle() {
        let cfg = parse(&[]).unwrap();
        assert_eq!(cfg.client_ip_source().unwrap(), ClientIpSource::Peer);
    }
}
