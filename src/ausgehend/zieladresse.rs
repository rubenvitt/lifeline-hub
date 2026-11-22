//! Einordnung einer Zieladresse für ausgehende Abrufe (LLH-1873).
//!
//! Eine Stelle für die Frage „darf der Server diese Adresse ansprechen?“: Webhooks
//! (`public_api::webhook::ziel`, LLH-1656) und Kartendownload samt Kartenproxy
//! (`karte::download::ip_ist_intern`) ordnen nach [`klasse`] ein. Was dort fehlt, fehlt allen;
//! was hier gesperrt wird, gilt für alle.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Einordnung einer Zieladresse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Adressklasse {
    /// Im Internet erreichbar; immer erlaubt.
    Oeffentlich,
    /// Privates Netz (RFC 1918, CGNAT, ULA); nur mit LAN-Ausnahme.
    Privat,
    /// Nie erlaubt, auch nicht mit LAN-Ausnahme.
    Gesperrt,
}

/// Ordnet eine Adresse ein. Eingebettetes IPv4 (mapped, compatible, NAT64, 6to4) zählt wie die
/// IPv4-Adresse selbst.
pub fn klasse(ip: &IpAddr) -> Adressklasse {
    match ip {
        IpAddr::V4(v4) => klasse_v4(v4),
        IpAddr::V6(v6) => klasse_v6(v6),
    }
}

fn klasse_v4(v4: &Ipv4Addr) -> Adressklasse {
    let [a, b, ..] = v4.octets();
    if v4.is_loopback()
        || v4.is_link_local() // 169.254/16, auch die Metadatenadresse 169.254.169.254
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_multicast() // 224/4
        || a == 0 // 0/8 „dieses Netz“
        || a >= 240 // 240/4 reserviert
        || (a == 198 && (b & 0xfe) == 18) // 198.18/15 Benchmark
        || (a == 192 && b == 0 && v4.octets()[2] == 0)
    // 192.0.0/24 Protokollzuweisungen
    {
        return Adressklasse::Gesperrt;
    }
    if v4.is_private() || (a == 100 && (b & 0xc0) == 0x40) {
        // 10/8, 172.16/12, 192.168/16 und 100.64/10 (CGNAT)
        return Adressklasse::Privat;
    }
    Adressklasse::Oeffentlich
}

fn klasse_v6(v6: &Ipv6Addr) -> Adressklasse {
    let s = v6.segments();
    if v6.is_loopback()
        || v6.is_unspecified()
        || v6.is_multicast() // ff00::/8
        || (s[0] & 0xffc0) == 0xfe80 // fe80::/10 Link-Local
        || (s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0x0001)
    // 64:ff9b:1::/48 NAT64 für lokale Netze (RFC 8215): das Ziel dahinter ist nicht zu prüfen
    {
        return Adressklasse::Gesperrt;
    }
    if let Some(v4) = eingebettetes_v4(v6) {
        return klasse_v4(&v4);
    }
    if (s[0] & 0xfe00) == 0xfc00 {
        // fc00::/7 Unique Local
        return Adressklasse::Privat;
    }
    Adressklasse::Oeffentlich
}

/// IPv4 in einer IPv6-Adresse: mapped (`::ffff:a.b.c.d`), compatible (`::a.b.c.d`), NAT64
/// (`64:ff9b::/96`), SIIT (`::ffff:0:a.b.c.d`) und 6to4 (`2002::/16`).
fn eingebettetes_v4(v6: &Ipv6Addr) -> Option<Ipv4Addr> {
    let s = v6.segments();
    let aus = |hoch: u16, tief: u16| {
        Ipv4Addr::new((hoch >> 8) as u8, hoch as u8, (tief >> 8) as u8, tief as u8)
    };
    if let Some(v4) = v6.to_ipv4() {
        return Some(v4);
    }
    if s[..6] == [0x0064, 0xff9b, 0, 0, 0, 0] {
        return Some(aus(s[6], s[7]));
    }
    // SIIT, IPv4-übersetzt (`::ffff:0:a.b.c.d`, RFC 7915).
    if s[..6] == [0, 0, 0, 0, 0xffff, 0] {
        return Some(aus(s[6], s[7]));
    }
    if s[0] == 0x2002 {
        return Some(aus(s[1], s[2]));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn klasse_je_bereich() {
        for s in [
            "93.184.216.34",
            "1.1.1.1",
            "2606:4700:4700::1111",
            "2001:db8::1",
        ] {
            assert_eq!(klasse(&ip(s)), Adressklasse::Oeffentlich, "{s}");
        }
        for s in [
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.254",
            "192.168.10.20",
            "100.64.0.1",
            "fd00::1",
            "fc00::1",
        ] {
            assert_eq!(klasse(&ip(s)), Adressklasse::Privat, "{s}");
        }
        for s in [
            "127.0.0.1",
            "127.8.8.8",
            "169.254.169.254",
            "169.254.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "255.255.255.255",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "198.18.0.1",
            "198.19.255.254",
            "192.0.0.1",
            "::1",
            "::",
            "fe80::1",
            "ff02::1",
            "ff05::2",
        ] {
            assert_eq!(klasse(&ip(s)), Adressklasse::Gesperrt, "{s}");
        }
        // 172.32/16 und 198.20/16 liegen außerhalb der Bereiche.
        assert_eq!(klasse(&ip("172.32.0.1")), Adressklasse::Oeffentlich);
        assert_eq!(klasse(&ip("198.20.0.1")), Adressklasse::Oeffentlich);
    }

    #[test]
    fn eingebettetes_ipv4_zaehlt_wie_ipv4() {
        // mapped, compatible, NAT64, 6to4
        assert_eq!(klasse(&ip("::ffff:127.0.0.1")), Adressklasse::Gesperrt);
        assert_eq!(klasse(&ip("::ffff:10.0.0.5")), Adressklasse::Privat);
        assert_eq!(klasse(&ip("::169.254.169.254")), Adressklasse::Gesperrt);
        assert_eq!(klasse(&ip("64:ff9b::a9fe:a9fe")), Adressklasse::Gesperrt);
        assert_eq!(klasse(&ip("64:ff9b::c0a8:0a14")), Adressklasse::Privat);
        assert_eq!(klasse(&ip("2002:7f00:0001::")), Adressklasse::Gesperrt);
        assert_eq!(klasse(&ip("2002:5db8:d822::")), Adressklasse::Oeffentlich);
        // SIIT und NAT64 für lokale Netze
        assert_eq!(klasse(&ip("::ffff:0:7f00:1")), Adressklasse::Gesperrt);
        assert_eq!(klasse(&ip("::ffff:0:a00:5")), Adressklasse::Privat);
        assert_eq!(klasse(&ip("64:ff9b:1::5db8:d822")), Adressklasse::Gesperrt);
    }
}
