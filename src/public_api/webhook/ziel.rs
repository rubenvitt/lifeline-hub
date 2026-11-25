//! Schutz vor internen Zielen und der HTTP-Weg der Webhooks (LLH-1656, design.md D5, Spec
//! `webhook-zustellung`, „Keine Zustellung an interne Ziele“ und „LAN-Ziele nur als bewusste
//! Ausnahme“).
//!
//! - [`is_erlaubt`] entscheidet nach der gemeinsamen Einordnung
//!   [`crate::ausgehend::zieladresse::klasse`]: öffentlich immer, privat nur mit LAN-Ausnahme,
//!   gesperrt nie (LLH-1873, dieselbe Einordnung nutzt der Kartenabruf).
//! - [`check_url`] prüft die URL selbst, auch IP-Literale: reqwest löst sie nicht über den
//!   Resolver auf.
//! - [`WebhookResolver`] löst den Namen selbst auf und gibt nur geprüfte Adressen an reqwest
//!   (fail-closed, festgehalten wie `karte::proxy::SichererResolver`).
//! - Die Clients setzen `.no_proxy()`: Mit einem Proxy aus der Umgebung löste der Resolver nur den
//!   Proxy auf, und das Ziel bliebe ungeprüft. Weiterleitungen folgen sie nie.

use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::CONTENT_TYPE;
use reqwest::Url;

use super::{WebhookFehler, EVENT_ID_KOPF, PIN_LAENGE, VERBINDUNG_ZEITLIMIT, ZEITLIMIT};
use crate::ausgehend::zieladresse::{klasse, Adressklasse};
use crate::ausgehend::{client_builder, Zweck};
use crate::http_begrenzt::{lies_begrenzt, DECKEL_WEBHOOK};
use crate::instanz::signatur::EVENT_KOPF;
use crate::instanz::zertifikat::{erfasser_config, tls_config, Erfasser};

/// Ist die Adresse als Ziel erlaubt?
pub fn is_erlaubt(ip: &IpAddr, lan_erlaubt: bool) -> bool {
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
    /// Ein Host-Feld mit Schema, Pfad, Port, Anmeldedaten oder Sonderzeichen.
    KeinHostname,
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
            ZielFehler::KeinHostname => {
                "Der Server ist nur ein Hostname, ohne Schema, Port und Pfad."
            }
            ZielFehler::Localhost => "Ein Ziel auf diesem Rechner ist nicht erlaubt.",
            ZielFehler::Intern => {
                "Das Ziel liegt in einem internen Netz. Ein privates Netz ist nur mit der \
                 LAN-Ausnahme erlaubt; Loopback, Link-Local und Multicast nie."
            }
        }
    }
}

/// Prüft eine Ziel-URL: `https`, ohne Anmeldedaten und Anker, mit Host, nicht `localhost`, und
/// ein IP-Literal nach [`is_erlaubt`]. Läuft beim Speichern und vor jedem Versuch.
pub fn check_url(roh: &str, lan_erlaubt: bool) -> Result<Url, ZielFehler> {
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
        Ok(ip) if !is_erlaubt(&ip, lan_erlaubt) => return Err(ZielFehler::Intern),
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

/// Prüft einen Hostnamen ohne Schema, Port und Pfad (Feldtyp `Host` der Adapter): getrimmt und
/// kleingeschrieben zurück. Ein IP-Literal besteht nach [`is_erlaubt`], `localhost` nie. Ein Name
/// wird hier nicht aufgelöst; die aufgelösten Adressen prüft der Verbindungsaufbau
/// (`adapter::ziel`, kein Rebind-Fenster).
pub fn check_host(roh: &str, lan_erlaubt: bool) -> Result<String, ZielFehler> {
    let text = roh.trim().to_ascii_lowercase();
    if text.is_empty() {
        return Err(ZielFehler::OhneHost);
    }
    // Ein IPv6-Literal enthält `:`, darum vor der Zeichenprüfung (ohne eckige Klammern).
    if let Ok(ip) = text.parse::<IpAddr>() {
        return if is_erlaubt(&ip, lan_erlaubt) {
            Ok(text)
        } else {
            Err(ZielFehler::Intern)
        };
    }
    let name = text.trim_end_matches('.');
    let gueltig = !name.is_empty()
        && name.len() <= 253
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_'));
    if !gueltig {
        return Err(ZielFehler::KeinHostname);
    }
    if name == "localhost" || name.ends_with(".localhost") {
        return Err(ZielFehler::Localhost);
    }
    Ok(name.to_string())
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
pub fn filter_adressen(adressen: Vec<SocketAddr>, lan_erlaubt: bool) -> Vec<SocketAddr> {
    if adressen.iter().any(|a| !is_erlaubt(&a.ip(), lan_erlaubt)) {
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
            let geprueft = filter_adressen(adressen, lan_erlaubt);
            if geprueft.is_empty() {
                return Err(Box::new(ZielInternFehler) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(geprueft.into_iter()) as Addrs)
        })
    }
}

/// Der Fingerabdruck am Webhook besteht die Prüfung nicht (LLH-1872, D2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinFehler;

impl PinFehler {
    /// Meldung für die Verwaltung (400).
    pub fn text(self) -> &'static str {
        "Der Fingerabdruck besteht aus 64 Hex-Zeichen (SHA-256), mit oder ohne Doppelpunkte."
    }
}

/// Normalisiert einen eingegebenen Fingerabdruck: Doppelpunkte, Leerzeichen und Bindestriche
/// fallen weg, Kleinbuchstaben. Leer heißt „kein Fingerabdruck“.
pub fn normalize_pin(roh: &str) -> Result<Option<String>, PinFehler> {
    let pin: String = roh
        .chars()
        .filter(|c| !matches!(c, ':' | '-') && !c.is_whitespace())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if pin.is_empty() {
        return Ok(None);
    }
    if pin.len() == PIN_LAENGE && pin.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(Some(pin))
    } else {
        Err(PinFehler)
    }
}

/// Die einzige Stelle mit den Schutzeinstellungen der Webhooks (ADR-0046); `tls` ersetzt die
/// Vertrauensanker des Systems (Fingerabdruck oder Erfassung, ADR-0092).
fn baue_client(lan_erlaubt: bool, tls: Option<rustls::ClientConfig>) -> reqwest::Client {
    let mut builder = client_builder(Zweck::Webhook)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .no_gzip()
        .connect_timeout(VERBINDUNG_ZEITLIMIT)
        .timeout(ZEITLIMIT)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }));
    if let Some(tls) = tls {
        builder = builder.tls_backend_preconfigured(tls);
    }
    builder.build().expect("Webhook-Client baubar")
}

/// Der Client für ein Ziel, mit oder ohne LAN-Ausnahme und Fingerabdruck. Ohne Fingerabdruck je
/// ein Prozess-Singleton, mit einer je `(lan_erlaubt, pin)` (Verbindungen bleiben im Pool).
pub fn client(lan_erlaubt: bool, pin: Option<&str>) -> Result<reqwest::Client, String> {
    static OEFFENTLICH: OnceLock<reqwest::Client> = OnceLock::new();
    static MIT_LAN: OnceLock<reqwest::Client> = OnceLock::new();
    static GEPINNT: OnceLock<Mutex<HashMap<(bool, String), reqwest::Client>>> = OnceLock::new();
    let Some(pin) = pin else {
        let c = if lan_erlaubt {
            MIT_LAN.get_or_init(|| baue_client(true, None))
        } else {
            OEFFENTLICH.get_or_init(|| baue_client(false, None))
        };
        return Ok(c.clone());
    };
    let cache = GEPINNT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut c = cache
        .lock()
        .map_err(|_| "Webhook-Client-Cache".to_string())?;
    let schluessel = (lan_erlaubt, pin.to_string());
    if let Some(client) = c.get(&schluessel) {
        return Ok(client.clone());
    }
    let neu = baue_client(lan_erlaubt, Some(tls_config(Some(pin.to_string()))?));
    // Klein halten: ein Wechsel lässt den alten Eintrag zurück.
    if c.len() >= 64 {
        c.clear();
    }
    c.insert(schluessel, neu.clone());
    Ok(neu)
}

/// Liest den Fingerabdruck des Zertifikats, das ein Ziel zeigt (LLH-1872, D4). Die URL besteht
/// vorher [`check_url`], der Client hat alle Schutzeinstellungen, und der [`Erfasser`] bricht den
/// Handshake ab, sobald er das Zertifikat gelesen hat: es geht nie eine HTTP-Anfrage hinaus.
pub async fn hole_fingerabdruck(url: &str, lan_erlaubt: bool) -> Result<String, WebhookFehler> {
    let url = match check_url(url, lan_erlaubt) {
        Ok(url) => url,
        Err(ZielFehler::Intern) => return Err(WebhookFehler::ZielIntern),
        Err(_) => return Err(WebhookFehler::ZielUngueltig),
    };
    let erfasser = Arc::new(Erfasser::new());
    let tls = erfasser_config(erfasser.clone()).map_err(|_| WebhookFehler::Tls)?;
    let ergebnis = baue_client(lan_erlaubt, Some(tls)).post(url).send().await;
    if let Some(fp) = erfasser.gesehen() {
        return Ok(fp);
    }
    match ergebnis {
        Err(e) => Err(fehler_art(&e)),
        // Ohne Zertifikat kann keine Antwort kommen; zur Sicherheit als TLS-Fehler.
        Ok(_) => Err(WebhookFehler::Tls),
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
    /// Fingerabdruck des Zielzertifikats; gesetzt zählt nur dieses Zertifikat (LLH-1872).
    pub zertifikat_pin: Option<String>,
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
        let url = match check_url(&z.url, z.lan_erlaubt) {
            Ok(url) => url,
            Err(ZielFehler::Intern) => return fehlschlag(None, WebhookFehler::ZielIntern, 0),
            Err(_) => return fehlschlag(None, WebhookFehler::ZielUngueltig, 0),
        };
        let Ok(client) = client(z.lan_erlaubt, z.zertifikat_pin.as_deref()) else {
            return fehlschlag(None, WebhookFehler::ZielUngueltig, 0);
        };
        let mut anfrage = client
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

/// Ob in einem `io::Error` (auch mehrfach verschachtelt, wie hyper ihn beim Verbindungsaufbau
/// liefert) ein Fehler von rustls steckt. Der Fehler des pinnenden Verifiers kommt so an
/// (LLH-1872).
fn is_rustls_in_io(io: &std::io::Error) -> bool {
    let mut inner = io.get_ref();
    while let Some(i) = inner {
        if i.downcast_ref::<rustls::Error>().is_some() {
            return true;
        }
        inner = i
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::get_ref);
    }
    false
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
            if is_rustls_in_io(io) {
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
    fn check_host_nimmt_namen_und_oeffentliche_ip() {
        assert_eq!(
            check_host(" SMTP.Example.org ", false).as_deref(),
            Ok("smtp.example.org")
        );
        assert_eq!(
            check_host("203.0.113.5", false).as_deref(),
            Ok("203.0.113.5")
        );
        assert_eq!(
            check_host("mail.example.org.", false).as_deref(),
            Ok("mail.example.org")
        );
        assert_eq!(check_host("10.0.0.1", true).as_deref(), Ok("10.0.0.1"));
    }

    #[test]
    fn check_host_lehnt_url_port_loopback_ab() {
        assert_eq!(
            check_host("smtps://x", false),
            Err(ZielFehler::KeinHostname)
        );
        assert_eq!(check_host("x:25", false), Err(ZielFehler::KeinHostname));
        assert_eq!(check_host("x/pfad", false), Err(ZielFehler::KeinHostname));
        assert_eq!(check_host("a b", false), Err(ZielFehler::KeinHostname));
        assert_eq!(check_host("user@x", false), Err(ZielFehler::KeinHostname));
        assert_eq!(check_host("", false), Err(ZielFehler::OhneHost));
        assert_eq!(check_host("   ", false), Err(ZielFehler::OhneHost));
        assert_eq!(check_host("localhost", true), Err(ZielFehler::Localhost));
        assert_eq!(
            check_host("Mail.LOCALHOST", true),
            Err(ZielFehler::Localhost)
        );
        assert_eq!(check_host("127.0.0.1", true), Err(ZielFehler::Intern));
        assert_eq!(check_host("::1", true), Err(ZielFehler::Intern));
        assert_eq!(check_host("169.254.169.254", true), Err(ZielFehler::Intern));
        assert_eq!(check_host("10.0.0.1", false), Err(ZielFehler::Intern));
    }

    #[test]
    fn erlaubt_nur_mit_ausnahme_privat() {
        assert!(is_erlaubt(&ip("93.184.216.34"), false));
        assert!(!is_erlaubt(&ip("10.0.0.5"), false));
        assert!(is_erlaubt(&ip("10.0.0.5"), true));
        assert!(!is_erlaubt(&ip("169.254.169.254"), true));
        assert!(!is_erlaubt(&ip("127.0.0.1"), true));
    }

    #[test]
    fn check_url_lehnt_ab() {
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
            assert_eq!(check_url(roh, false), Err(erwartet), "{roh}");
        }
    }

    #[test]
    fn check_url_mit_lan_ausnahme() {
        assert!(check_url("https://10.0.0.5/hook", true).is_ok());
        assert!(check_url("https://[fd00::5]:8443/hook", true).is_ok());
        assert_eq!(
            check_url("https://169.254.169.254/", true),
            Err(ZielFehler::Intern)
        );
        assert_eq!(
            check_url("https://127.0.0.1/", true),
            Err(ZielFehler::Intern)
        );
        assert!(check_url("https://empfaenger.example/hook?t=1", false).is_ok());
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
        assert_eq!(filter_adressen(oeffentlich.clone(), false), oeffentlich);
        // gemischt: nichts
        assert!(filter_adressen(vec![sock("93.184.216.34"), sock("10.0.0.5")], false).is_empty());
        // privat nur mit Ausnahme
        assert_eq!(
            filter_adressen(vec![sock("192.168.10.20")], true),
            vec![sock("192.168.10.20")]
        );
        // gesperrt auch mit Ausnahme
        assert!(filter_adressen(vec![sock("192.168.10.20"), sock("127.0.0.1")], true).is_empty());
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
            zertifikat_pin: None,
        };
        let e = HttpZusteller.senden(z).await;
        assert_eq!(e.fehler, Some(WebhookFehler::ZielIntern));

        // Über den Namen: die Vorprüfung ist umgangen, der Resolver im Client fängt es.
        let fehler = client(true, None)
            .unwrap()
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

#[cfg(test)]
#[path = "ziel_tls_tests.rs"]
mod tls_tests;
