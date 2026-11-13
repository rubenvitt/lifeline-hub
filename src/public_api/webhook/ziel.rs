//! Schutz vor internen Zielen und der HTTP-Weg der Webhooks (LLH-1656, design.md D5, Spec
//! `webhook-zustellung`, „Keine Zustellung an interne Ziele“ und „LAN-Ziele nur als bewusste
//! Ausnahme“).
//!
//! - [`klasse`] ordnet eine Adresse ein: öffentlich, privat (nur mit LAN-Ausnahme) oder immer
//!   gesperrt (Loopback, Link-Local samt Metadatenadresse, Multicast, Broadcast, unbestimmt,
//!   reserviert).
//! - [`url_pruefen`] prüft die URL selbst, auch IP-Literale: reqwest löst sie nicht über den
//!   Resolver auf.
//! - [`WebhookResolver`] löst den Namen selbst auf und gibt nur geprüfte Adressen an reqwest
//!   (fail-closed, festgehalten wie `karte::proxy::SichererResolver`).
//! - Die Clients setzen `.no_proxy()`: Mit einem Proxy aus der Umgebung löste der Resolver nur den
//!   Proxy auf, und das Ziel bliebe ungeprüft. Weiterleitungen folgen sie nie.

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::CONTENT_TYPE;
use reqwest::Url;

use super::{WebhookFehler, EVENT_ID_KOPF, VERBINDUNG_ZEITLIMIT, ZEITLIMIT};
use crate::ausgehend::{client_builder, Zweck};
use crate::http_begrenzt::{lies_begrenzt, DECKEL_WEBHOOK};
use crate::instanz::signatur::EVENT_KOPF;

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
        || (s[0] & 0xffc0) == 0xfe80
    // fe80::/10 Link-Local
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
/// (`64:ff9b::/96`) und 6to4 (`2002::/16`).
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
    if s[0] == 0x2002 {
        return Some(aus(s[1], s[2]));
    }
    None
}

/// Ist die Adresse als Ziel erlaubt?
pub fn erlaubt(ip: &IpAddr, lan_erlaubt: bool) -> bool {
    match klasse(ip) {
        Adressklasse::Oeffentlich => true,
        Adressklasse::Privat => lan_erlaubt,
        Adressklasse::Gesperrt => false,
    }
}

/// Warum eine Ziel-URL nicht gilt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZielFehler {
    Unlesbar,
    NichtHttps,
    Anmeldedaten,
    Fragment,
    OhneHost,
    Localhost,
    /// Ein IP-Literal in einem gesperrten oder (ohne Ausnahme) privaten Netz.
    Intern,
}

impl ZielFehler {
    /// Meldung für die Verwaltung (400).
    pub fn text(self) -> &'static str {
        match self {
            ZielFehler::Unlesbar => "Die Ziel-URL ist nicht lesbar.",
            ZielFehler::NichtHttps => "Die Ziel-URL muss mit https:// beginnen.",
            ZielFehler::Anmeldedaten => {
                "Die Ziel-URL darf keinen Benutzernamen und kein Passwort enthalten."
            }
            ZielFehler::Fragment => "Die Ziel-URL darf keinen Anker (#…) enthalten.",
            ZielFehler::OhneHost => "Die Ziel-URL nennt keinen Server.",
            ZielFehler::Localhost => "Ein Ziel auf diesem Rechner ist nicht erlaubt.",
            ZielFehler::Intern => {
                "Das Ziel liegt in einem internen Netz. Ein privates Netz ist nur mit der \
                 LAN-Ausnahme erlaubt; Loopback, Link-Local und Multicast nie."
            }
        }
    }
}

/// Prüft eine Ziel-URL: `https`, ohne Anmeldedaten und Anker, mit Host, nicht `localhost`, und
/// ein IP-Literal nach [`erlaubt`]. Läuft beim Speichern und vor jedem Versuch.
pub fn url_pruefen(roh: &str, lan_erlaubt: bool) -> Result<Url, ZielFehler> {
    let url = Url::parse(roh.trim()).map_err(|_| ZielFehler::Unlesbar)?;
    if url.scheme() != "https" {
        return Err(ZielFehler::NichtHttps);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ZielFehler::Anmeldedaten);
    }
    if url.fragment().is_some() {
        return Err(ZielFehler::Fragment);
    }
    let host = url.host_str().ok_or(ZielFehler::OhneHost)?;
    // IPv6-Literale stehen in eckigen Klammern.
    match host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
    {
        Ok(ip) if !erlaubt(&ip, lan_erlaubt) => return Err(ZielFehler::Intern),
        Ok(_) => {}
        Err(_) => {
            let name = host.trim_end_matches('.').to_ascii_lowercase();
            if name.is_empty() {
                return Err(ZielFehler::OhneHost);
            }
            if name == "localhost" || name.ends_with(".localhost") {
                return Err(ZielFehler::Localhost);
            }
        }
    }
    Ok(url)
}

/// Host einer Ziel-URL für Admin-Spur und Anzeige; nie der Pfad (er kann ein Token tragen).
pub fn host_von(url: &str) -> Option<String> {
    Url::parse(url).ok()?.host_str().map(str::to_string)
}

/// Fehler des Resolvers, wenn ein Name auf ein nicht erlaubtes Netz zeigt. Die Fehlerkette von
/// reqwest trägt ihn bis zur Einordnung in [`WebhookFehler::ZielIntern`].
#[derive(Debug)]
pub struct ZielInternFehler;

impl std::fmt::Display for ZielInternFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Ziel liegt in einem nicht erlaubten Netz")
    }
}

impl std::error::Error for ZielInternFehler {}

/// Filtert aufgelöste Adressen fail-closed: Ist eine nicht erlaubt, kommt keine zurück (auch bei
/// gemischtem Ergebnis; sonst wäre DNS-Rebinding ein Weg nach innen).
pub fn adressen_filtern(adressen: Vec<SocketAddr>, lan_erlaubt: bool) -> Vec<SocketAddr> {
    if adressen.iter().any(|a| !erlaubt(&a.ip(), lan_erlaubt)) {
        Vec::new()
    } else {
        adressen
    }
}

/// Pinnender Resolver der Webhooks: löst selbst auf, prüft, und reqwest verbindet genau auf die
/// gelieferten Adressen. Kein Rebind-Fenster zwischen Prüfung und Verbindung.
pub struct WebhookResolver {
    pub lan_erlaubt: bool,
}

impl Resolve for WebhookResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let lan_erlaubt = self.lan_erlaubt;
        Box::pin(async move {
            // Port 0: reqwest setzt den Port aus der URL.
            let adressen: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
                .collect();
            let geprueft = adressen_filtern(adressen, lan_erlaubt);
            if geprueft.is_empty() {
                return Err(Box::new(ZielInternFehler) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(geprueft.into_iter()) as Addrs)
        })
    }
}

fn baue_client(lan_erlaubt: bool) -> reqwest::Client {
    client_builder(Zweck::Webhook)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .no_gzip()
        .connect_timeout(VERBINDUNG_ZEITLIMIT)
        .timeout(ZEITLIMIT)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }))
        .build()
        .expect("Webhook-Client baubar")
}

/// Der Client für ein Ziel, mit oder ohne LAN-Ausnahme (je ein Prozess-Singleton).
pub fn client(lan_erlaubt: bool) -> &'static reqwest::Client {
    static OEFFENTLICH: OnceLock<reqwest::Client> = OnceLock::new();
    static MIT_LAN: OnceLock<reqwest::Client> = OnceLock::new();
    if lan_erlaubt {
        MIT_LAN.get_or_init(|| baue_client(true))
    } else {
        OEFFENTLICH.get_or_init(|| baue_client(false))
    }
}

/// Eine Zustellung, fertig signiert.
#[derive(Debug, Clone)]
pub struct Zustellung {
    pub url: String,
    pub lan_erlaubt: bool,
    /// Wert des Kopfs `Lifeline-Signature`.
    pub signatur: String,
    /// Nummer des Ereignisses; `None` beim Testereignis.
    pub ereignis_id: Option<i64>,
    pub body: Vec<u8>,
}

/// Ausgang eines Versuchs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ergebnis {
    /// HTTP-Status, falls eine Antwort kam.
    pub status: Option<u16>,
    /// `None` heißt Erfolg (2xx).
    pub fehler: Option<WebhookFehler>,
    pub dauer_ms: i64,
}

impl Ergebnis {
    pub fn is_erfolg(&self) -> bool {
        self.fehler.is_none()
    }
}

/// Stellt eine Zustellung zu. Der Lauf nimmt ihn als Parameter, damit Tests ohne Netz zustellen
/// können: Loopback ist für den echten Weg immer gesperrt.
pub trait Zusteller: Send + Sync + 'static {
    fn senden(&self, zustellung: Zustellung) -> impl Future<Output = Ergebnis> + Send;
}

/// Der echte Weg über HTTPS.
#[derive(Debug, Clone, Copy, Default)]
pub struct HttpZusteller;

impl Zusteller for HttpZusteller {
    async fn senden(&self, z: Zustellung) -> Ergebnis {
        let start = Instant::now();
        let dauer = || start.elapsed().as_millis().min(i64::MAX as u128) as i64;
        let url = match url_pruefen(&z.url, z.lan_erlaubt) {
            Ok(url) => url,
            Err(ZielFehler::Intern) => return fehlschlag(None, WebhookFehler::ZielIntern, 0),
            Err(_) => return fehlschlag(None, WebhookFehler::ZielUngueltig, 0),
        };
        let mut anfrage = client(z.lan_erlaubt)
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(EVENT_KOPF, z.signatur);
        if let Some(id) = z.ereignis_id {
            anfrage = anfrage.header(EVENT_ID_KOPF, id.to_string());
        }
        match anfrage.body(z.body).send().await {
            Ok(antwort) => {
                let status = antwort.status();
                // Nur lesen, damit die Verbindung sauber endet; der Rumpf wird nie gespeichert.
                let _ = lies_begrenzt(antwort, DECKEL_WEBHOOK).await;
                let code = Some(status.as_u16());
                if status.is_success() {
                    Ergebnis {
                        status: code,
                        fehler: None,
                        dauer_ms: dauer(),
                    }
                } else if status.is_redirection() {
                    fehlschlag(code, WebhookFehler::Weiterleitung, dauer())
                } else {
                    fehlschlag(code, WebhookFehler::Status, dauer())
                }
            }
            Err(e) => fehlschlag(None, fehler_art(&e), dauer()),
        }
    }
}

fn fehlschlag(status: Option<u16>, fehler: WebhookFehler, dauer_ms: i64) -> Ergebnis {
    Ergebnis {
        status,
        fehler: Some(fehler),
        dauer_ms,
    }
}

/// Ordnet einen Fehler von reqwest ein, über seine Ursachenkette.
pub fn fehler_art(e: &reqwest::Error) -> WebhookFehler {
    if e.is_timeout() {
        return WebhookFehler::Zeitueberschreitung;
    }
    let mut quelle: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
    while let Some(q) = quelle {
        if q.downcast_ref::<ZielInternFehler>().is_some() {
            return WebhookFehler::ZielIntern;
        }
        if q.downcast_ref::<rustls::Error>().is_some() {
            return WebhookFehler::Tls;
        }
        if let Some(io) = q.downcast_ref::<std::io::Error>() {
            if io
                .get_ref()
                .is_some_and(|inner| inner.downcast_ref::<rustls::Error>().is_some())
            {
                return WebhookFehler::Tls;
            }
        }
        quelle = q.source();
    }
    let text = format!("{e:?}").to_ascii_lowercase();
    if text.contains("certificate") || text.contains("tls") {
        WebhookFehler::Tls
    } else if text.contains("dns") || text.contains("failed to lookup") {
        WebhookFehler::Dns
    } else {
        WebhookFehler::Verbindung
    }
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
    }

    #[test]
    fn erlaubt_nur_mit_ausnahme_privat() {
        assert!(erlaubt(&ip("93.184.216.34"), false));
        assert!(!erlaubt(&ip("10.0.0.5"), false));
        assert!(erlaubt(&ip("10.0.0.5"), true));
        assert!(!erlaubt(&ip("169.254.169.254"), true));
        assert!(!erlaubt(&ip("127.0.0.1"), true));
    }

    #[test]
    fn url_pruefen_lehnt_ab() {
        let faelle = [
            ("kein url", ZielFehler::Unlesbar),
            ("http://empfaenger.example/hook", ZielFehler::NichtHttps),
            ("ftp://empfaenger.example/hook", ZielFehler::NichtHttps),
            (
                "https://nutzer:geheim@empfaenger.example/hook",
                ZielFehler::Anmeldedaten,
            ),
            (
                "https://nutzer@empfaenger.example/hook",
                ZielFehler::Anmeldedaten,
            ),
            ("https://empfaenger.example/hook#x", ZielFehler::Fragment),
            ("https://localhost/hook", ZielFehler::Localhost),
            ("https://LOCALHOST./hook", ZielFehler::Localhost),
            ("https://x.localhost/hook", ZielFehler::Localhost),
            ("https://127.0.0.1/", ZielFehler::Intern),
            ("https://[::1]/", ZielFehler::Intern),
            ("https://10.0.0.5/", ZielFehler::Intern),
            ("https://[::ffff:169.254.169.254]/", ZielFehler::Intern),
        ];
        for (roh, erwartet) in faelle {
            assert_eq!(url_pruefen(roh, false), Err(erwartet), "{roh}");
        }
    }

    #[test]
    fn url_pruefen_mit_lan_ausnahme() {
        assert!(url_pruefen("https://10.0.0.5/hook", true).is_ok());
        assert!(url_pruefen("https://[fd00::5]:8443/hook", true).is_ok());
        assert_eq!(
            url_pruefen("https://169.254.169.254/", true),
            Err(ZielFehler::Intern)
        );
        assert_eq!(
            url_pruefen("https://127.0.0.1/", true),
            Err(ZielFehler::Intern)
        );
        assert!(url_pruefen("https://empfaenger.example/hook?t=1", false).is_ok());
    }

    #[test]
    fn host_ohne_pfad() {
        assert_eq!(
            host_von("https://empfaenger.example:8443/hook/geheim-token?x=1").as_deref(),
            Some("empfaenger.example")
        );
    }

    fn sock(s: &str) -> SocketAddr {
        SocketAddr::new(ip(s), 443)
    }

    #[test]
    fn filter_ist_fail_closed() {
        let oeffentlich = vec![sock("93.184.216.34"), sock("2606:4700::1")];
        assert_eq!(adressen_filtern(oeffentlich.clone(), false), oeffentlich);
        // gemischt: nichts
        assert!(adressen_filtern(vec![sock("93.184.216.34"), sock("10.0.0.5")], false).is_empty());
        // privat nur mit Ausnahme
        assert_eq!(
            adressen_filtern(vec![sock("192.168.10.20")], true),
            vec![sock("192.168.10.20")]
        );
        // gesperrt auch mit Ausnahme
        assert!(adressen_filtern(vec![sock("192.168.10.20"), sock("127.0.0.1")], true).is_empty());
    }

    #[tokio::test]
    async fn resolver_lehnt_loopback_namen_ab() {
        let r = WebhookResolver { lan_erlaubt: true };
        let ergebnis = r.resolve("localhost".parse::<Name>().unwrap()).await;
        let fehler = ergebnis.err().expect("localhost muss scheitern");
        assert!(
            fehler.downcast_ref::<ZielInternFehler>().is_some(),
            "{fehler}"
        );
    }

    /// Ein Ziel, das auf Loopback zeigt, bekommt keine Verbindung: weder als Literal (Vorprüfung)
    /// noch als Name (Resolver im Client).
    #[tokio::test]
    async fn loopback_bekommt_keine_verbindung() {
        let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = lauscher.local_addr().unwrap().port();

        let z = Zustellung {
            url: format!("https://127.0.0.1:{port}/hook"),
            lan_erlaubt: true,
            signatur: "x".into(),
            ereignis_id: Some(1),
            body: b"{}".to_vec(),
        };
        let e = HttpZusteller.senden(z).await;
        assert_eq!(e.fehler, Some(WebhookFehler::ZielIntern));

        // Über den Namen: die Vorprüfung ist umgangen, der Resolver im Client fängt es.
        let fehler = client(true)
            .post(format!("https://localhost:{port}/hook"))
            .send()
            .await
            .expect_err("darf nicht verbinden");
        assert_eq!(fehler_art(&fehler), WebhookFehler::ZielIntern);

        // Der Lauscher hat keine Verbindung gesehen.
        let angenommen =
            tokio::time::timeout(std::time::Duration::from_millis(200), lauscher.accept()).await;
        assert!(angenommen.is_err(), "keine Verbindung erwartet");
    }
}
