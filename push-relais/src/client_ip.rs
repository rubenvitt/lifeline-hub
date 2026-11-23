//! Client-Adresse für die Registrierungsgrenze (LLH-2080, `docs/betrieb/push-relais.md`).

use axum::http::HeaderMap;
use ipnet::IpNet;
use std::net::{IpAddr, SocketAddr};

/// Woher die Client-Adresse kommt.
#[derive(Clone, Debug, PartialEq)]
pub enum ClientIpSource {
    /// Ohne Proxy: die TCP-Gegenstelle.
    Peer,
    /// Genau ein Proxy, der anhängt (`PUSH_RELAIS_HINTER_PROXY`): der rechte
    /// `X-Forwarded-For`-Eintrag.
    SingleProxy,
    /// Vertraute Proxys (`PUSH_RELAIS_TRUSTED_PROXIES`, etwa das Docker-Netz von Traefik) und
    /// die Bereiche eines CDN davor (`PUSH_RELAIS_CDN_PROXIES`).
    TrustedProxies {
        proxies: Vec<IpNet>,
        cdn: Vec<IpNet>,
    },
}

const X_FORWARDED_FOR: &str = "x-forwarded-for";

/// Die Client-Adresse einer Anfrage; ohne Gegenstelle `0.0.0.0`.
///
/// - [`ClientIpSource::Peer`]: die Gegenstelle.
/// - [`ClientIpSource::SingleProxy`]: der rechte `X-Forwarded-For`-Eintrag, den der eine Proxy
///   anhängt; alles links davon kann der Client selbst mitschicken. Fehlt er, die Gegenstelle.
/// - [`ClientIpSource::TrustedProxies`]: wie `src/extract.rs::client_ip` im Hauptpaket
///   (LFH-604, Zwilling; beide gleich halten). Liegt die Gegenstelle nicht in `proxies`, gilt
///   sie selbst. Sonst wird `X-Forwarded-For` von rechts gelesen: jeder Proxy hängt an, von wem
///   er die Anfrage bekam. Einträge aus `proxies` werden übersprungen, solange kein CDN-Eintrag
///   kam; der erste Eintrag aus `cdn` wird **einmal** übersprungen; der nächste ist der Client,
///   auch wenn er in einer der Listen liegt. So zählt ein eigener Worker im CDN, der
///   `X-Forwarded-For` selbst setzt, mit seiner eigenen Adresse (LLH-2080). Ein unlesbarer
///   Eintrag beendet die Suche bei der letzten bekannten Stufe; endet die Kette ohne fremden
///   Eintrag, gilt ihr linkester. IPv4-gemappte Adressen zählen als IPv4.
pub fn client_ip(source: &ClientIpSource, headers: &HeaderMap, peer: Option<SocketAddr>) -> IpAddr {
    let Some(gegenstelle) = peer.map(|p| p.ip()) else {
        return IpAddr::from([0, 0, 0, 0]);
    };
    match source {
        ClientIpSource::Peer => gegenstelle,
        ClientIpSource::SingleProxy => headers
            .get(X_FORWARDED_FOR)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.rsplit(',').next())
            .and_then(|v| v.trim().parse::<IpAddr>().ok())
            .unwrap_or(gegenstelle),
        ClientIpSource::TrustedProxies { proxies, cdn } => {
            hinter_proxys(gegenstelle, headers, proxies, cdn)
        }
    }
}

fn hinter_proxys(
    gegenstelle: IpAddr,
    headers: &HeaderMap,
    proxies: &[IpNet],
    cdn: &[IpNet],
) -> IpAddr {
    let liegt_in = |netze: &[IpNet], ip: &IpAddr| netze.iter().any(|netz| netz.contains(ip));
    let mut stufe = gegenstelle.to_canonical();
    if !liegt_in(proxies, &stufe) {
        return stufe;
    }
    // Mehrere Headerzeilen gelten als eine Liste in ihrer Reihenfolge (RFC 9110, 5.3). Getrennt
    // wird auf Bytes, damit ein Nicht-UTF-8-Byte nur seinen Eintrag unlesbar macht.
    let eintraege: Vec<&[u8]> = headers
        .get_all(X_FORWARDED_FOR)
        .iter()
        .flat_map(|zeile| zeile.as_bytes().split(|b| *b == b','))
        .collect();
    let mut cdn_gesehen = false;
    for eintrag in eintraege.into_iter().rev() {
        let Some(ip) = std::str::from_utf8(eintrag)
            .ok()
            .and_then(|e| adresse_lesen(e.trim()))
        else {
            return stufe;
        };
        stufe = ip.to_canonical();
        if cdn_gesehen {
            return stufe;
        }
        if liegt_in(proxies, &stufe) {
            continue;
        }
        if liegt_in(cdn, &stufe) {
            cdn_gesehen = true;
            continue;
        }
        return stufe;
    }
    stufe
}

/// Ein `X-Forwarded-For`-Eintrag: Adresse, auch mit Port (`a.b.c.d:p`, `[v6]:p`).
fn adresse_lesen(eintrag: &str) -> Option<IpAddr> {
    eintrag
        .parse::<IpAddr>()
        .or_else(|_| eintrag.parse::<SocketAddr>().map(|s| s.ip()))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRAEFIK: &str = "10.0.1.5:4000";

    fn liste() -> ClientIpSource {
        ClientIpSource::TrustedProxies {
            proxies: vec!["10.0.1.0/24".parse().unwrap()],
            cdn: vec![
                "173.245.48.0/20".parse().unwrap(),
                "2a06:98c0::/29".parse().unwrap(),
            ],
        }
    }

    fn ohne_cdn() -> ClientIpSource {
        ClientIpSource::TrustedProxies {
            proxies: vec!["10.0.1.0/24".parse().unwrap()],
            cdn: vec![],
        }
    }

    fn xff(zeilen: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for z in zeilen {
            headers.append("x-forwarded-for", z.parse().unwrap());
        }
        headers
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn peer(s: &str) -> Option<SocketAddr> {
        Some(s.parse().unwrap())
    }

    #[test]
    fn ohne_proxy_zaehlt_die_gegenstelle() {
        let h = xff(&["198.51.100.1"]);
        assert_eq!(
            client_ip(&ClientIpSource::Peer, &h, peer(TRAEFIK)),
            ip("10.0.1.5")
        );
    }

    #[test]
    fn ein_proxy_zaehlt_den_rechten_eintrag() {
        let h = xff(&["198.51.100.1, 203.0.113.5"]);
        assert_eq!(
            client_ip(&ClientIpSource::SingleProxy, &h, peer(TRAEFIK)),
            ip("203.0.113.5")
        );
    }

    #[test]
    fn hinter_cloudflare_zaehlt_der_client() {
        let h = xff(&["198.51.100.9, 203.0.113.7, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
    }

    #[test]
    fn fremde_gegenstelle_zaehlt_selbst() {
        let h = xff(&["203.0.113.7"]);
        assert_eq!(
            client_ip(&liste(), &h, peer("192.0.2.1:4000")),
            ip("192.0.2.1")
        );
    }

    #[test]
    fn nur_vertraute_kette_liefert_den_linkesten() {
        let h = xff(&["173.245.48.20, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("173.245.48.20"));
    }

    #[test]
    fn unlesbarer_eintrag_beendet_die_suche() {
        let h = xff(&["203.0.113.7, kaputt, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("173.245.48.10"));
    }

    #[test]
    fn gemappte_gegenstelle_gilt_als_ipv4() {
        let h = xff(&["203.0.113.7"]);
        assert_eq!(
            client_ip(&liste(), &h, peer("[::ffff:10.0.1.5]:4000")),
            ip("203.0.113.7")
        );
    }

    #[test]
    fn mehrere_headerzeilen_sind_eine_liste() {
        let h = xff(&["203.0.113.7", "173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
    }

    #[test]
    fn eintrag_mit_port_wird_gelesen() {
        let h = xff(&["203.0.113.7:5555, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
    }

    #[test]
    fn cdn_wird_einmal_uebersprungen() {
        let h = xff(&["203.0.113.7, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
    }

    /// Ein eigener Cloudflare Worker schickt aus einem Cloudflare-Bereich und setzt
    /// `X-Forwarded-For` selbst: gezählt wird der Worker, nie der frei gewählte Eintrag.
    #[test]
    fn worker_zaehlt_selbst() {
        let h = xff(&["198.51.100.66, 2a06:98c0:3600::103, 173.245.48.10"]);
        assert_eq!(
            client_ip(&liste(), &h, peer(TRAEFIK)),
            ip("2a06:98c0:3600::103")
        );
    }

    #[test]
    fn innere_proxys_vor_dem_cdn_werden_uebersprungen() {
        let h = xff(&["203.0.113.7, 173.245.48.10, 10.0.1.9"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
    }

    #[test]
    fn proxy_links_vom_cdn_zaehlt_selbst() {
        let h = xff(&["198.51.100.66, 10.0.1.9, 173.245.48.10"]);
        assert_eq!(client_ip(&liste(), &h, peer(TRAEFIK)), ip("10.0.1.9"));
    }

    #[test]
    fn ohne_cdn_liste_werden_proxys_beliebig_uebersprungen() {
        let h = xff(&["203.0.113.7, 10.0.1.8, 10.0.1.9"]);
        assert_eq!(client_ip(&ohne_cdn(), &h, peer(TRAEFIK)), ip("203.0.113.7"));
        let h = xff(&["10.0.1.8, 10.0.1.9"]);
        assert_eq!(client_ip(&ohne_cdn(), &h, peer(TRAEFIK)), ip("10.0.1.8"));
    }

    #[test]
    fn gegenstelle_im_cdn_zaehlt_selbst() {
        let h = xff(&["203.0.113.7"]);
        assert_eq!(
            client_ip(&liste(), &h, peer("173.245.48.10:4000")),
            ip("173.245.48.10")
        );
    }

    #[test]
    fn ohne_gegenstelle_gilt_die_nulladresse() {
        let h = xff(&["203.0.113.7"]);
        assert_eq!(client_ip(&liste(), &h, None), ip("0.0.0.0"));
    }
}
