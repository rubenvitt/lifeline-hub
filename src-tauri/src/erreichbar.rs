//! Anzeige „nicht erreichbar“ (LLH-1283): Lädt ein Fenster den Server und kommt keine Seite an,
//! bliebe es auf macOS leer — WKWebView zeigt keine Fehlerseite. Die Hülle wacht deshalb über
//! jedes Laden des Servers, das sie selbst anstößt, und zeigt sonst ihre lokale Seite
//! `nicht-erreichbar.html`.
//!
//! Eine Seite gilt als angekommen, sobald das Fenster irgendeine nicht-lokale Seite zu laden
//! beginnt: auch eine aus dem Service Worker (Offline-Betrieb, LFH-720 — die App startet dann
//! offline wie bisher) und auch die eines Identitätsanbieters, auf den der Server sofort umleitet.
//! WebView2 meldet seine eigene Fehlerseite ebenfalls als Laden; unter Windows bleibt es deshalb
//! bei dieser Seite.
//!
//! Wie lange die Wache wartet, hängt von einer eigenen Prüfung ab: Antwortet der Port nicht, kommt
//! die Anzeige nach kurzer Frist; ist er offen und es kommt trotzdem keine Seite (abgelehntes
//! Zertifikat, hängender Server), nach einer langen.

use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use url::Url;

/// Höchstdauer der eigenen Prüfung, Namensauflösung eingeschlossen.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(4);

/// Warum ein Fenster die Anzeige zeigt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grund {
    /// Der Port antwortet nicht: die Anzeige prüft selbst weiter und lädt, sobald er antwortet.
    NichtErreichbar,
    /// Der Port antwortet, aber keine Seite kam an: weiter nur auf Knopfdruck, sonst lüde das
    /// Fenster im Kreis.
    KeineAntwort,
}

/// Frist ab dem Ende der Prüfung, nach der ohne angekommene Seite die Anzeige kommt.
pub fn deadline(grund: Grund) -> Duration {
    match grund {
        // Kurz, aber nicht null: eine Seite aus dem Service Worker braucht einen Augenblick.
        Grund::NichtErreichbar => Duration::from_secs(2),
        // Lang genug für einen langsamen Server und die Freigabe „Lokales Netzwerk“ auf macOS.
        Grund::KeineAntwort => Duration::from_secs(20),
    }
}

pub fn grund(erreichbar: bool) -> Grund {
    if erreichbar {
        Grund::KeineAntwort
    } else {
        Grund::NichtErreichbar
    }
}

/// Ist das eine Seite, die nicht von der Hülle selbst kommt? Lokale Seiten (Maske, Anzeige) und
/// `about:` zählen nicht als Ankunft.
pub fn is_loaded(seite: &Url) -> bool {
    match seite.scheme() {
        "tauri" | "about" => false,
        "http" | "https" => seite.host_str() != Some("tauri.localhost"),
        _ => true,
    }
}

/// Nimmt der Server unter `server` eine TCP-Verbindung an? Höchstens `timeout` lang, die
/// Namensauflösung eingeschlossen (sie läuft deshalb in einem eigenen Thread). Ohne TLS: ein
/// abgelehntes Zertifikat fängt die lange Frist der Wache.
pub fn check_erreichbar(server: &Url, timeout: Duration) -> bool {
    let (Some(host), Some(port)) = (server.host_str(), server.port_or_known_default()) else {
        return false;
    };
    // IPv6-Literale stehen in der URL in Klammern, die Auflösung will sie ohne.
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let (sender, empfaenger) = mpsc::channel();
    thread::spawn(move || {
        let Ok(adressen) = (host.as_str(), port).to_socket_addrs() else {
            let _ = sender.send(false);
            return;
        };
        let offen = adressen
            .into_iter()
            .any(|adresse| TcpStream::connect_timeout(&adresse, timeout).is_ok());
        let _ = sender.send(offen);
    });
    empfaenger.recv_timeout(timeout).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn offener_port_ist_erreichbar() {
        let lauscher = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = lauscher.local_addr().unwrap().port();
        assert!(check_erreichbar(
            &url(&format!("https://127.0.0.1:{port}/")),
            Duration::from_secs(2)
        ));
    }

    #[test]
    fn geschlossener_port_ist_nicht_erreichbar() {
        // Port belegen und wieder freigeben: danach lauscht dort niemand.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert!(!check_erreichbar(
            &url(&format!("https://127.0.0.1:{port}/")),
            Duration::from_secs(2)
        ));
    }

    #[test]
    fn unaufloesbarer_name_ist_nicht_erreichbar() {
        // `.invalid` löst nie auf (RFC 2606).
        assert!(!check_erreichbar(
            &url("https://lifeline.invalid:8443/"),
            Duration::from_secs(3)
        ));
    }

    #[test]
    fn ipv6_literal_wird_ohne_klammern_aufgeloest() {
        let Ok(lauscher) = TcpListener::bind("[::1]:0") else {
            return; // Umgebung ohne IPv6
        };
        let port = lauscher.local_addr().unwrap().port();
        assert!(check_erreichbar(
            &url(&format!("https://[::1]:{port}/")),
            Duration::from_secs(2)
        ));
    }

    #[test]
    fn nur_nicht_lokale_seiten_zaehlen_als_angekommen() {
        assert!(is_loaded(&url("https://elw.local:8443/einsaetze/1")));
        // Umleitung auf den Identitätsanbieter: die Seite ist da, nur woanders.
        assert!(is_loaded(&url("https://id.example.org/login")));
        assert!(!is_loaded(&url("tauri://localhost/index.html")));
        assert!(!is_loaded(&url(
            "http://tauri.localhost/nicht-erreichbar.html"
        )));
        assert!(!is_loaded(&url("about:blank")));
    }

    #[test]
    fn ohne_antwort_des_ports_kommt_die_anzeige_frueh() {
        assert_eq!(grund(false), Grund::NichtErreichbar);
        assert_eq!(grund(true), Grund::KeineAntwort);
        assert!(deadline(Grund::NichtErreichbar) < deadline(Grund::KeineAntwort));
        assert!(deadline(Grund::NichtErreichbar) >= Duration::from_secs(1));
    }
}
