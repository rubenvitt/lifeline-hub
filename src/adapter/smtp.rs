//! Kleiner eigener SMTP-Client für den Ausgang per E-Mail (LLH-2093, Design-Doc
//! `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`, Abschnitt 2).
//!
//! Warum kein fertiger Transport: die Verbindung geht nur an die **geprüfte IP** (Auflösung mit
//! `filter_adressen`, kein DNS-Rebinding), TLS nur mit dem einen Crypto-Provider und einer
//! übergebenen `ClientConfig` (Vorgabe: `instanz::zertifikat::webpki_config`), und „ungewiss“
//! (Abbruch nach dem Ende der Daten) lässt sich nur mit eigener Kontrolle über die Phasen sicher
//! erkennen.
//!
//! Ablauf: Gruß, EHLO, STARTTLS (oder implizites TLS vor dem Gruß), EHLO, AUTH PLAIN (LOGIN nur,
//! wenn PLAIN fehlt), MAIL, RCPT, DATA mit CRLF-Normalisierung und Dot-Stuffing, QUIT.
//! Zugangsdaten gehen nur über TLS hinaus: ohne STARTTLS-Angebot bricht der Client ab (`Tls`),
//! bevor er etwas anderes als EHLO und QUIT sendet. Antworten sind gedeckelt (Zeilenlänge und
//! -zahl), Zeitlimits: Verbindung 5 s, jede Antwort 30 s, der Dialog bis zur `354` auf DATA
//! 120 s; Daten schreiben und die abschließende Antwort abwarten bekommen eigene 10 min
//! (RFC 5321 §4.5.3.2).
//!
//! Regeln: `src/AGENTS.md`, „Backend — Adapter“. Kein Geheimnis in Log oder Fehler: `SmtpFehler`
//! trägt nur einen Code und den Status des Servers, nie seinen Text.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use age::secrecy::zeroize::Zeroizing;
use age::secrecy::{ExposeSecret, SecretString};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rustls_pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout_at, Instant};
use tokio_rustls::TlsConnector;

use super::zustand::AdapterFehler;
use crate::public_api::webhook::ziel::{check_host, filter_adressen, ZielFehler};

/// Frist für Namensauflösung und Verbindungsaufbau.
pub const VERBINDUNG_ZEITLIMIT: Duration = Duration::from_secs(5);
/// Frist für jede Antwort des Servers (auch für den TLS-Handshake).
pub const ANTWORT_ZEITLIMIT: Duration = Duration::from_secs(30);
/// Frist für den Dialog bis einschließlich der `354` auf DATA, Verbindung eingeschlossen.
pub const SITZUNG_ZEITLIMIT: Duration = Duration::from_secs(120);
/// Frist für die Datenphase: Daten samt Abschluss schreiben und auf die abschließende Antwort
/// warten. Beginnt nach der `354` und hängt nicht am Rest von [`SITZUNG_ZEITLIMIT`]: große Anhänge
/// über eine langsame Leitung und ein prüfender Server brauchen Zeit (RFC 5321 §4.5.3.2.5 und
/// §4.5.3.2.6 nennen 3 bzw. 10 Minuten). QUIT danach bekommt noch [`QUIT_ZEITLIMIT`].
pub const DATEN_ZEITLIMIT: Duration = Duration::from_secs(10 * 60);
/// Längste Antwortzeile ohne CRLF.
pub const ZEILE_MAX: usize = 4096;
/// Meiste Zeilen einer (mehrzeiligen) Antwort.
pub const ZEILEN_MAX: usize = 64;
/// EHLO-Name, wenn der übergebene keiner ist, der in eine SMTP-Zeile passt.
pub const EHLO_VORGABE: &str = "lifeline-hub";

/// Frist für die Antwort auf QUIT; danach zählt der Versand trotzdem.
const QUIT_ZEITLIMIT: Duration = Duration::from_secs(5);

/// Wie die Verbindung verschlüsselt wird. Unverschlüsselt gibt es nicht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verschluesselung {
    /// Klartext bis STARTTLS (Port 587/25); ohne Angebot des Servers kein Versand.
    StartTls,
    /// TLS ab dem ersten Byte (Port 465).
    Tls,
}

/// Wohin und wie verbunden wird. `benutzer` und `passwort` gehören zusammen: nur eins von beiden
/// ist ein Fehler der Einstellungen (`Anmeldung`), nie ein Versand ohne Anmeldung.
#[derive(Clone, Copy)]
pub struct SmtpZiel<'a> {
    pub host: &'a str,
    pub port: u16,
    pub verschluesselung: Verschluesselung,
    pub lan_erlaubt: bool,
    pub benutzer: Option<&'a str>,
    pub passwort: Option<&'a SecretString>,
    pub ehlo_name: &'a str,
}

impl std::fmt::Debug for SmtpZiel<'_> {
    // Ohne Benutzer und Passwort: ein Ziel darf in ein Log, die Zugangsdaten nie.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SmtpZiel")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("verschluesselung", &self.verschluesselung)
            .field("lan_erlaubt", &self.lan_erlaubt)
            .field("anmeldung", &self.benutzer.is_some())
            .finish_non_exhaustive()
    }
}

/// Warum eine Sitzung scheiterte. Nur Codes und der Status des Servers, nie sein Text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpFehler {
    /// Der Name ließ sich nicht auflösen (oder ist keiner).
    Dns,
    /// Das Ziel liegt in einem gesperrten oder (ohne LAN-Ausnahme) privaten Netz.
    ZielIntern,
    /// Die Verbindung kam nicht zustande oder brach vor dem Ende der Daten ab.
    Verbindung,
    /// Verbindung, Antwort oder Sitzung über der Frist (vor dem Ende der Daten).
    Zeitueberschreitung,
    /// Kein STARTTLS-Angebot, Handshake gescheitert oder Zertifikat nicht anerkannt.
    Tls,
    /// Anmeldung abgelehnt, kein passendes Verfahren angeboten oder Zugangsdaten unvollständig.
    Anmeldung,
    /// Der Server lehnte vorübergehend ab (4xx).
    Voruebergehend(u16),
    /// Der Server lehnte endgültig ab (5xx).
    Abgelehnt(u16),
    /// Die Daten sind vollständig hinaus, aber keine abschließende Antwort kam an: ob die Mail
    /// zugestellt wurde, weiß niemand.
    Ungewiss,
    /// Die Antwort des Servers ließ sich nicht lesen (Form, Länge, Zeilenzahl, Daten nach
    /// STARTTLS).
    Antwort,
}

impl SmtpFehler {
    /// Code des Adapter-Rahmens; keine eigenen Codes (Design-Doc, „Fehlercodes der Anbindung“).
    pub fn adapter_fehler(&self) -> AdapterFehler {
        match self {
            SmtpFehler::Dns => AdapterFehler::Dns,
            SmtpFehler::ZielIntern => AdapterFehler::ZielIntern,
            SmtpFehler::Verbindung => AdapterFehler::Verbindung,
            SmtpFehler::Zeitueberschreitung => AdapterFehler::Zeitueberschreitung,
            SmtpFehler::Tls => AdapterFehler::Tls,
            SmtpFehler::Anmeldung => AdapterFehler::Abgelehnt,
            SmtpFehler::Voruebergehend(_) | SmtpFehler::Abgelehnt(_) | SmtpFehler::Ungewiss => {
                AdapterFehler::Status
            }
            SmtpFehler::Antwort => AdapterFehler::AntwortUngueltig,
        }
    }

    /// Status des Servers, wenn er einen nannte.
    pub fn status(&self) -> Option<u16> {
        match self {
            SmtpFehler::Voruebergehend(c) | SmtpFehler::Abgelehnt(c) => Some(*c),
            _ => None,
        }
    }
}

/// Prüft ein Ziel: Gruß, EHLO, TLS, Anmeldung (falls Zugangsdaten), QUIT. Nichts wird gesendet.
pub async fn pruefe(ziel: &SmtpZiel<'_>, tls: Arc<rustls::ClientConfig>) -> Result<(), SmtpFehler> {
    let ende = Instant::now() + SITZUNG_ZEITLIMIT;
    check_auftrag(ziel, &Auftrag::Pruefen)?;
    let strom = verbinde(ziel, ende).await?;
    sitzung(strom, ziel, tls, Auftrag::Pruefen, ende).await
}

/// Stellt eine fertige Nachricht (RFC 5322, Kopf und Rumpf) an einen Empfänger zu.
pub async fn sende(
    ziel: &SmtpZiel<'_>,
    tls: Arc<rustls::ClientConfig>,
    von: &str,
    an: &str,
    nachricht: &[u8],
) -> Result<(), SmtpFehler> {
    let ende = Instant::now() + SITZUNG_ZEITLIMIT;
    let auftrag = Auftrag::Senden { von, an, nachricht };
    check_auftrag(ziel, &auftrag)?;
    let strom = verbinde(ziel, ende).await?;
    sitzung(strom, ziel, tls, auftrag, ende).await
}

/// Was eine Sitzung nach Anmeldung tut.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Auftrag<'a> {
    Pruefen,
    Senden {
        von: &'a str,
        an: &'a str,
        nachricht: &'a [u8],
    },
}

/// Prüfungen vor jedem Netzverkehr: Zugangsdaten vollständig oder gar nicht, Adressen ohne
/// Zeichen, die eine SMTP-Zeile aufbrechen.
fn check_auftrag(ziel: &SmtpZiel<'_>, auftrag: &Auftrag<'_>) -> Result<(), SmtpFehler> {
    zugang(ziel)?;
    if let Auftrag::Senden { von, an, .. } = auftrag {
        if !is_adresse_sicher(von) || !is_adresse_sicher(an) {
            // Wie ein Server, der die Adresse ablehnt (553: Name nicht erlaubt); die Adresse
            // kommt geprüft aus lettre, das hier ist die letzte Wehr gegen Zeileneinschub.
            return Err(SmtpFehler::Abgelehnt(553));
        }
    }
    Ok(())
}

fn zugang<'a>(ziel: &SmtpZiel<'a>) -> Result<Option<(&'a str, &'a SecretString)>, SmtpFehler> {
    match (ziel.benutzer, ziel.passwort) {
        (Some(b), Some(p)) => Ok(Some((b, p))),
        (None, None) => Ok(None),
        _ => Err(SmtpFehler::Anmeldung),
    }
}

/// Eine Adresse für `MAIL FROM:<…>`/`RCPT TO:<…>`: druckbares ASCII ohne Leerzeichen und spitze
/// Klammern (Umlaut-Domains kommen als Punycode).
fn is_adresse_sicher(adresse: &str) -> bool {
    !adresse.is_empty()
        && adresse.len() <= 320
        && adresse
            .bytes()
            .all(|b| (0x21..=0x7e).contains(&b) && b != b'<' && b != b'>')
}

/// EHLO-Name: ein Hostname oder Adressliteral, sonst [`EHLO_VORGABE`].
fn ehlo_name(roh: &str) -> &str {
    let gueltig = !roh.is_empty()
        && roh.len() <= 255
        && roh
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'[' | b']' | b':'));
    if gueltig {
        roh
    } else {
        EHLO_VORGABE
    }
}

/// Erste Adresse nach dem fail-closed-Filter: ist eine aufgelöste Adresse nicht erlaubt, gilt
/// keine (`filter_adressen`).
pub(crate) fn erste_erlaubte(adressen: Vec<SocketAddr>, lan_erlaubt: bool) -> Option<SocketAddr> {
    filter_adressen(adressen, lan_erlaubt).into_iter().next()
}

/// Löst den Namen auf, prüft die Adressen und verbindet sich mit der ersten erlaubten (nie
/// erneut mit dem Namen). Ein IP-Literal oder `localhost` außerhalb des Erlaubten endet ohne
/// Verbindung.
pub(crate) async fn verbinde(ziel: &SmtpZiel<'_>, ende: Instant) -> Result<TcpStream, SmtpFehler> {
    let host = check_host(ziel.host, ziel.lan_erlaubt).map_err(|e| match e {
        ZielFehler::Intern | ZielFehler::Localhost => SmtpFehler::ZielIntern,
        _ => SmtpFehler::Dns,
    })?;
    let frist = frist(VERBINDUNG_ZEITLIMIT, ende);
    let adressen: Vec<SocketAddr> =
        match timeout_at(frist, tokio::net::lookup_host((host.as_str(), ziel.port))).await {
            Err(_) => return Err(SmtpFehler::Zeitueberschreitung),
            Ok(Err(_)) => return Err(SmtpFehler::Dns),
            Ok(Ok(a)) => a.collect(),
        };
    if adressen.is_empty() {
        return Err(SmtpFehler::Dns);
    }
    let adresse = erste_erlaubte(adressen, ziel.lan_erlaubt).ok_or(SmtpFehler::ZielIntern)?;
    match timeout_at(frist, TcpStream::connect(adresse)).await {
        Err(_) => Err(SmtpFehler::Zeitueberschreitung),
        Ok(Err(_)) => Err(SmtpFehler::Verbindung),
        Ok(Ok(s)) => Ok(s),
    }
}

fn frist(dauer: Duration, ende: Instant) -> Instant {
    (Instant::now() + dauer).min(ende)
}

/// Eine SMTP-Sitzung über einen schon verbundenen Strom. Generisch, damit Tests sie über
/// `tokio::io::duplex` mit einem geskripteten Server fahren; TLS kommt aus `tls`, der Name für
/// SNI und Zertifikat ist `ziel.host`.
pub(crate) async fn sitzung<S>(
    strom: S,
    ziel: &SmtpZiel<'_>,
    tls: Arc<rustls::ClientConfig>,
    auftrag: Auftrag<'_>,
    ende: Instant,
) -> Result<(), SmtpFehler>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    check_auftrag(ziel, &auftrag)?;
    let zugang = zugang(ziel)?;
    let name = ServerName::try_from(ziel.host.trim().trim_end_matches('.').to_ascii_lowercase())
        .map_err(|_| SmtpFehler::Tls)?;
    let tls = Tls {
        connector: TlsConnector::from(tls),
        name,
    };
    let ehlo = format!("EHLO {}", ehlo_name(ziel.ehlo_name));

    let mut leitung = Leitung::new(Box::new(strom), ende);
    if ziel.verschluesselung == Verschluesselung::Tls {
        leitung = tls.aufwerten(leitung).await?;
    }
    erwarte(leitung.lies_antwort().await?, &[220])?;
    let mut angebot = Angebot::aus(&erwarte(leitung.befehl(&ehlo).await?, &[250])?);

    if ziel.verschluesselung == Verschluesselung::StartTls {
        if !angebot.starttls {
            leitung.quit().await;
            return Err(SmtpFehler::Tls);
        }
        let a = leitung.befehl("STARTTLS").await?;
        if a.code != 220 {
            return Err(SmtpFehler::Tls);
        }
        leitung = tls.aufwerten(leitung).await?;
        angebot = Angebot::aus(&erwarte(leitung.befehl(&ehlo).await?, &[250])?);
    }

    // Ab hier ist die Leitung verschlüsselt, auf beiden Wegen.
    if let Some((benutzer, passwort)) = zugang {
        anmelden(&mut leitung, &angebot, benutzer, passwort).await?;
    }

    if let Auftrag::Senden { von, an, nachricht } = auftrag {
        erwarte(leitung.befehl(&format!("MAIL FROM:<{von}>")).await?, &[250])?;
        erwarte(
            leitung.befehl(&format!("RCPT TO:<{an}>")).await?,
            &[250, 251],
        )?;
        erwarte(leitung.befehl("DATA").await?, &[354])?;
        // Ab der 354 gilt die eigene Frist der Datenphase, nicht der Rest der Sitzung.
        leitung.ende = Instant::now() + DATEN_ZEITLIMIT;
        // Schreibfehler hier: der Abschluss ist nicht vollständig hinaus, also nicht ungewiss.
        leitung.schreibe_daten(&daten_bytes(nachricht)).await?;
        // Ab hier ist der Abschluss geschrieben: ohne lesbare Antwort ist der Ausgang ungewiss.
        // Die abschließende Antwort darf die ganze Datenfrist brauchen (Virenprüfung).
        match leitung.lies_abschluss().await {
            Ok(a) if (200..300).contains(&a.code) => {}
            Ok(a) if (400..600).contains(&a.code) => return Err(einordnen(a.code)),
            _ => return Err(SmtpFehler::Ungewiss),
        }
    }
    leitung.quit().await;
    Ok(())
}

async fn anmelden(
    leitung: &mut Leitung,
    angebot: &Angebot,
    benutzer: &str,
    passwort: &SecretString,
) -> Result<(), SmtpFehler> {
    if angebot.has_auth("PLAIN") {
        let roh = Zeroizing::new(format!("\0{benutzer}\0{}", passwort.expose_secret()));
        let zeile = Zeroizing::new(format!("AUTH PLAIN {}", STANDARD.encode(roh.as_bytes())));
        return erwarte_anmeldung(leitung.befehl(&zeile).await?, 235);
    }
    if angebot.has_auth("LOGIN") {
        erwarte_anmeldung(leitung.befehl("AUTH LOGIN").await?, 334)?;
        erwarte_anmeldung(leitung.befehl(&STANDARD.encode(benutzer)).await?, 334)?;
        let zeile = Zeroizing::new(STANDARD.encode(passwort.expose_secret()));
        return erwarte_anmeldung(leitung.befehl(&zeile).await?, 235);
    }
    leitung.quit().await;
    Err(SmtpFehler::Anmeldung)
}

fn erwarte_anmeldung(a: Antwort, ok: u16) -> Result<(), SmtpFehler> {
    match a.code {
        c if c == ok => Ok(()),
        400..=499 => Err(SmtpFehler::Voruebergehend(a.code)),
        500..=599 => Err(SmtpFehler::Anmeldung),
        _ => Err(SmtpFehler::Antwort),
    }
}

fn erwarte(a: Antwort, ok: &[u16]) -> Result<Antwort, SmtpFehler> {
    if ok.contains(&a.code) {
        Ok(a)
    } else {
        Err(einordnen(a.code))
    }
}

fn einordnen(code: u16) -> SmtpFehler {
    match code {
        400..=499 => SmtpFehler::Voruebergehend(code),
        500..=599 => SmtpFehler::Abgelehnt(code),
        _ => SmtpFehler::Antwort,
    }
}

/// Nachricht für die Datenphase: jedes nackte LF und CR wird CRLF, eine Zeile mit führendem `.`
/// bekommt einen zweiten, die letzte Zeile endet mit CRLF, danach der Abschluss `.\r\n`.
pub(crate) fn daten_bytes(nachricht: &[u8]) -> Vec<u8> {
    let mut aus = Vec::with_capacity(nachricht.len() + nachricht.len() / 32 + 8);
    let mut zeilenanfang = true;
    let mut i = 0;
    while i < nachricht.len() {
        let b = nachricht[i];
        match b {
            b'\r' | b'\n' => {
                aus.extend_from_slice(b"\r\n");
                zeilenanfang = true;
                if b == b'\r' && nachricht.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
            }
            _ => {
                if zeilenanfang && b == b'.' {
                    aus.push(b'.');
                }
                aus.push(b);
                zeilenanfang = false;
            }
        }
        i += 1;
    }
    if !zeilenanfang {
        aus.extend_from_slice(b"\r\n");
    }
    aus.extend_from_slice(b".\r\n");
    aus
}

/// Was der Server nach EHLO anbietet.
#[derive(Debug, Default)]
pub(crate) struct Angebot {
    pub starttls: bool,
    pub auth: Vec<String>,
}

impl Angebot {
    fn aus(a: &Antwort) -> Self {
        let mut angebot = Angebot::default();
        // Die erste Zeile ist der Gruß des Servers, danach je Zeile eine Erweiterung.
        for zeile in a.zeilen.iter().skip(1) {
            let mut teile = zeile.split_whitespace();
            let Some(wort) = teile.next() else { continue };
            let wort = wort.to_ascii_uppercase();
            if wort == "STARTTLS" {
                angebot.starttls = true;
            } else if wort == "AUTH" || wort.starts_with("AUTH=") {
                let erstes = wort.strip_prefix("AUTH=").filter(|s| !s.is_empty());
                angebot.auth.extend(erstes.map(str::to_string));
                angebot.auth.extend(teile.map(|t| t.to_ascii_uppercase()));
            }
        }
        angebot
    }

    fn has_auth(&self, verfahren: &str) -> bool {
        self.auth.iter().any(|a| a == verfahren)
    }
}

/// Eine Antwort des Servers: Code und Text je Zeile (ohne Code und Trenner).
#[derive(Debug)]
pub(crate) struct Antwort {
    pub code: u16,
    pub zeilen: Vec<String>,
}

/// Warum keine Antwort gelesen wurde.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LeseFehler {
    Ende,
    Netz,
    Zeit,
    Form,
}

impl From<LeseFehler> for SmtpFehler {
    fn from(e: LeseFehler) -> Self {
        match e {
            LeseFehler::Ende | LeseFehler::Netz => SmtpFehler::Verbindung,
            LeseFehler::Zeit => SmtpFehler::Zeitueberschreitung,
            LeseFehler::Form => SmtpFehler::Antwort,
        }
    }
}

trait Strom: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Strom for T {}

struct Tls {
    connector: TlsConnector,
    name: ServerName<'static>,
}

impl Tls {
    /// TLS-Handshake über die Leitung. Liegen danach schon ungelesene Klartext-Bytes im Puffer,
    /// hat der Server (oder jemand dazwischen) Antworten eingeschoben: Abbruch.
    async fn aufwerten(&self, leitung: Leitung) -> Result<Leitung, SmtpFehler> {
        let ende = leitung.ende;
        let frist = frist(ANTWORT_ZEITLIMIT, ende);
        let strom = leitung.into_strom()?;
        match timeout_at(frist, self.connector.connect(self.name.clone(), strom)).await {
            Err(_) => Err(SmtpFehler::Zeitueberschreitung),
            Ok(Err(_)) => Err(SmtpFehler::Tls),
            Ok(Ok(s)) => Ok(Leitung::new(Box::new(s), ende)),
        }
    }
}

/// Strom mit eigenem Lesepuffer und Fristen.
struct Leitung {
    strom: Box<dyn Strom>,
    puffer: Vec<u8>,
    ende: Instant,
}

impl Leitung {
    fn new(strom: Box<dyn Strom>, ende: Instant) -> Self {
        Leitung {
            strom,
            puffer: Vec::new(),
            ende,
        }
    }

    fn into_strom(self) -> Result<Box<dyn Strom>, SmtpFehler> {
        if self.puffer.is_empty() {
            Ok(self.strom)
        } else {
            Err(SmtpFehler::Antwort)
        }
    }

    async fn schreibe_bis(&mut self, bytes: &[u8], frist: Instant) -> Result<(), SmtpFehler> {
        let strom = &mut self.strom;
        let schreiben = async {
            strom.write_all(bytes).await?;
            strom.flush().await
        };
        match timeout_at(frist, schreiben).await {
            Err(_) => Err(SmtpFehler::Zeitueberschreitung),
            Ok(Err(_)) => Err(SmtpFehler::Verbindung),
            Ok(Ok(())) => Ok(()),
        }
    }

    /// Die Daten samt Abschluss; Frist ist nur das Ende der Datenphase (große Anhänge).
    async fn schreibe_daten(&mut self, bytes: &[u8]) -> Result<(), SmtpFehler> {
        let ende = self.ende;
        self.schreibe_bis(bytes, ende).await
    }

    async fn befehl(&mut self, zeile: &str) -> Result<Antwort, SmtpFehler> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(zeile.len() + 2));
        bytes.extend_from_slice(zeile.as_bytes());
        bytes.extend_from_slice(b"\r\n");
        self.schreibe_bis(&bytes, frist(ANTWORT_ZEITLIMIT, self.ende))
            .await?;
        self.lies_antwort().await
    }

    async fn lies_antwort(&mut self) -> Result<Antwort, SmtpFehler> {
        Ok(self.lies_antwort_roh().await?)
    }

    /// QUIT ohne Gewähr: Antwort kurz abwarten, Fehler zählen nicht.
    async fn quit(&mut self) {
        let frist = frist(QUIT_ZEITLIMIT, self.ende);
        if self.schreibe_bis(b"QUIT\r\n", frist).await.is_ok() {
            let _ = self.lies_antwort_bis(frist).await;
        }
        let _ = timeout_at(frist, self.strom.shutdown()).await;
    }

    /// Die abschließende Antwort nach den Daten: Frist ist das Ende der Datenphase, nicht
    /// [`ANTWORT_ZEITLIMIT`].
    async fn lies_abschluss(&mut self) -> Result<Antwort, LeseFehler> {
        let ende = self.ende;
        self.lies_antwort_bis(ende).await
    }

    async fn lies_antwort_roh(&mut self) -> Result<Antwort, LeseFehler> {
        let frist = frist(ANTWORT_ZEITLIMIT, self.ende);
        self.lies_antwort_bis(frist).await
    }

    async fn lies_antwort_bis(&mut self, frist: Instant) -> Result<Antwort, LeseFehler> {
        let mut code = None;
        let mut zeilen = Vec::new();
        loop {
            if zeilen.len() >= ZEILEN_MAX {
                return Err(LeseFehler::Form);
            }
            let zeile = self.lies_zeile(frist).await?;
            let (c, letzte, text) = zerlege(&zeile).ok_or(LeseFehler::Form)?;
            if code.is_some_and(|alt| alt != c) {
                return Err(LeseFehler::Form);
            }
            code = Some(c);
            zeilen.push(text);
            if letzte {
                return Ok(Antwort { code: c, zeilen });
            }
        }
    }

    /// Eine Zeile ohne Zeilenende; länger als [`ZEILE_MAX`] ist ein Formfehler.
    async fn lies_zeile(&mut self, frist: Instant) -> Result<Vec<u8>, LeseFehler> {
        loop {
            if let Some(pos) = self.puffer.iter().position(|&b| b == b'\n') {
                let mut zeile: Vec<u8> = self.puffer.drain(..=pos).collect();
                zeile.pop();
                if zeile.last() == Some(&b'\r') {
                    zeile.pop();
                }
                if zeile.len() > ZEILE_MAX {
                    return Err(LeseFehler::Form);
                }
                return Ok(zeile);
            }
            if self.puffer.len() > ZEILE_MAX + 1 {
                return Err(LeseFehler::Form);
            }
            let mut stueck = [0u8; 1024];
            let n = match timeout_at(frist, self.strom.read(&mut stueck)).await {
                Err(_) => return Err(LeseFehler::Zeit),
                Ok(Err(_)) => return Err(LeseFehler::Netz),
                Ok(Ok(0)) => return Err(LeseFehler::Ende),
                Ok(Ok(n)) => n,
            };
            self.puffer.extend_from_slice(&stueck[..n]);
        }
    }
}

/// `250-text` / `250 text` / `250` → (Code, letzte Zeile?, Text).
fn zerlege(zeile: &[u8]) -> Option<(u16, bool, String)> {
    if zeile.len() < 3 || !zeile[..3].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let code = u16::from(zeile[0] - b'0') * 100
        + u16::from(zeile[1] - b'0') * 10
        + u16::from(zeile[2] - b'0');
    if !(200..600).contains(&code) {
        return None;
    }
    let letzte = match zeile.get(3) {
        None | Some(b' ') => true,
        Some(b'-') => false,
        Some(_) => return None,
    };
    let text = zeile.get(4..).unwrap_or_default();
    Some((code, letzte, String::from_utf8_lossy(text).into_owned()))
}

#[cfg(test)]
mod tests;
