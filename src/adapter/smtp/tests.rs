//! SMTP-Client gegen einen geskripteten Server über `tokio::io::duplex`; TLS mit einem
//! rcgen-Zertifikat und einer Test-`ClientConfig`, die genau dieses Zertifikat annimmt.

use super::*;
use rustls_pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tokio::io::{AsyncBufReadExt, BufReader, DuplexStream};
use tokio_rustls::TlsAcceptor;

use crate::instanz::zertifikat::provider;

trait TestStrom: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> TestStrom for T {}

/// Ein Zertifikat für `localhost` mit passender Server- und Client-Konfiguration.
struct Schluessel {
    server: Arc<rustls::ServerConfig>,
    client: Arc<rustls::ClientConfig>,
}

fn schluessel() -> Schluessel {
    let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
    let cert: CertificateDer<'static> = ck.cert.der().clone();
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(ck.signing_key.serialize_der()));
    let server = rustls::ServerConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert.clone()], key)
        .unwrap();
    let mut wurzeln = rustls::RootCertStore::empty();
    wurzeln.add(cert).unwrap();
    let verifier =
        rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(wurzeln), provider())
            .build()
            .unwrap();
    let client = rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    Schluessel {
        server: Arc::new(server),
        client: Arc::new(client),
    }
}

/// Geskripteter Server: liest Zeilen, schreibt Antworten, merkt sich alles Gelesene.
struct Server {
    r: BufReader<Box<dyn TestStrom>>,
    gesehen: Vec<String>,
}

impl Server {
    fn new(strom: DuplexStream) -> Self {
        Server {
            r: BufReader::new(Box::new(strom)),
            gesehen: Vec::new(),
        }
    }

    async fn sag(&mut self, text: &str) {
        let w = self.r.get_mut();
        w.write_all(format!("{text}\r\n").as_bytes()).await.unwrap();
        w.flush().await.unwrap();
    }

    /// Nächste Zeile ohne CRLF; `None` am Ende.
    async fn hoer(&mut self) -> Option<String> {
        let mut zeile = String::new();
        match self.r.read_line(&mut zeile).await {
            Ok(0) | Err(_) => None,
            Ok(_) => {
                let zeile = zeile.trim_end_matches("\r\n").to_string();
                self.gesehen.push(zeile.clone());
                Some(zeile)
            }
        }
    }

    /// Erwartet eine Zeile, die mit `anfang` beginnt.
    async fn erwarte(&mut self, anfang: &str) {
        let z = self.hoer().await.unwrap_or_default();
        assert!(z.starts_with(anfang), "erwartet {anfang:?}, gesehen {z:?}");
    }

    /// Rohe Daten bis einschließlich `\r\n.\r\n` (die Zeile nach `354`).
    async fn daten(&mut self) -> String {
        let mut roh = Vec::new();
        while !(roh.ends_with(b"\r\n.\r\n") || roh == b".\r\n") {
            let mut b = [0u8; 1];
            if self.r.read_exact(&mut b).await.is_err() {
                break;
            }
            roh.push(b[0]);
        }
        String::from_utf8(roh).unwrap()
    }

    async fn tls(self, config: Arc<rustls::ServerConfig>) -> Self {
        assert!(self.r.buffer().is_empty(), "Klartext nach STARTTLS");
        let gesehen = self.gesehen;
        let strom = TlsAcceptor::from(config)
            .accept(self.r.into_inner())
            .await
            .unwrap();
        Server {
            r: BufReader::new(Box::new(strom)),
            gesehen,
        }
    }

    /// Liest bis zum Ende (QUIT bekommt 221) und liefert alles Gesehene.
    async fn rest(mut self) -> Vec<String> {
        while let Some(z) = self.hoer().await {
            if z == "QUIT" {
                self.sag("221 tschuess").await;
            }
        }
        self.gesehen
    }

    /// Gruß, EHLO, STARTTLS, TLS, EHLO mit `erweiterungen` nach TLS.
    async fn vorspann(mut self, config: Arc<rustls::ServerConfig>, erweiterungen: &[&str]) -> Self {
        self.sag("220 mx.test ESMTP").await;
        self.erwarte("EHLO ").await;
        self.sag("250-mx.test\r\n250-PIPELINING\r\n250 STARTTLS")
            .await;
        self.erwarte("STARTTLS").await;
        self.sag("220 los").await;
        let mut s = self.tls(config).await;
        s.erwarte("EHLO ").await;
        s.sag(&ehlo_antwort(erweiterungen)).await;
        s
    }
}

fn ehlo_antwort(erweiterungen: &[&str]) -> String {
    let mut zeilen = vec!["mx.test".to_string()];
    zeilen.extend(erweiterungen.iter().map(|e| e.to_string()));
    let n = zeilen.len();
    zeilen
        .iter()
        .enumerate()
        .map(|(i, z)| format!("250{}{z}", if i + 1 == n { ' ' } else { '-' }))
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn ziel<'a>(passwort: Option<&'a SecretString>) -> SmtpZiel<'a> {
    SmtpZiel {
        host: "localhost",
        port: 587,
        verschluesselung: Verschluesselung::StartTls,
        lan_erlaubt: false,
        benutzer: passwort.map(|_| "nutzer"),
        passwort,
        ehlo_name: "lifeline-hub",
    }
}

const SENDEN: Auftrag<'static> = Auftrag::Senden {
    von: "a@x",
    an: "b@y",
    nachricht: b"Subject: t\r\n\r\nhallo",
};

/// Fährt eine Sitzung gegen `skript`; liefert Ergebnis des Clients und Ergebnis des Skripts.
async fn fahre<F, Fut, T>(
    ziel: SmtpZiel<'_>,
    tls: Arc<rustls::ClientConfig>,
    auftrag: Auftrag<'_>,
    skript: F,
) -> (Result<(), SmtpFehler>, T)
where
    F: FnOnce(Server) -> Fut,
    Fut: std::future::Future<Output = T> + Send + 'static,
    T: Send + 'static,
{
    let (c, s) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(skript(Server::new(s)));
    let ende = Instant::now() + SITZUNG_ZEITLIMIT;
    let ergebnis = sitzung(c, &ziel, tls, auftrag, ende).await;
    (ergebnis, server.await.unwrap())
}

fn passwort() -> SecretString {
    SecretString::from("geheim".to_string())
}

#[tokio::test]
async fn starttls_auth_plain_und_zustellung() {
    let k = schluessel();
    let pw = passwort();
    let server = k.server.clone();
    let (ergebnis, (gesehen, daten)) = fahre(ziel(Some(&pw)), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &["AUTH LOGIN PLAIN", "8BITMIME"]).await;
        s.hoer().await;
        s.sag("235 ok").await;
        s.hoer().await;
        s.sag("250 ok").await;
        s.hoer().await;
        s.sag("250 ok").await;
        s.hoer().await;
        s.sag("354 los").await;
        let daten = s.daten().await;
        s.sag("250 angenommen").await;
        s.hoer().await;
        s.sag("221 tschuess").await;
        (s.rest().await, daten)
    })
    .await;
    assert_eq!(ergebnis, Ok(()));
    let b64 = STANDARD.encode("\0nutzer\0geheim");
    assert_eq!(
        gesehen,
        vec![
            "EHLO lifeline-hub".to_string(),
            "STARTTLS".into(),
            "EHLO lifeline-hub".into(),
            format!("AUTH PLAIN {b64}"),
            "MAIL FROM:<a@x>".into(),
            "RCPT TO:<b@y>".into(),
            "DATA".into(),
            "QUIT".into(),
        ]
    );
    assert_eq!(daten, "Subject: t\r\n\r\nhallo\r\n.\r\n");
}

#[tokio::test]
async fn punktzeile_wird_verdoppelt_und_lf_zu_crlf() {
    let k = schluessel();
    let server = k.server.clone();
    let auftrag = Auftrag::Senden {
        von: "a@x",
        an: "b@y",
        nachricht: b"a\n.\nb",
    };
    let (ergebnis, daten) = fahre(ziel(None), k.client, auftrag, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        for _ in 0..2 {
            s.hoer().await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        s.sag("354 los").await;
        let daten = s.daten().await;
        s.sag("250 ok").await;
        daten
    })
    .await;
    assert_eq!(ergebnis, Ok(()));
    assert_eq!(daten, "a\r\n..\r\nb\r\n.\r\n");
}

#[test]
fn daten_bytes_normalisiert_zeilenenden_und_stopft_punkte() {
    let f = |b: &[u8]| String::from_utf8(daten_bytes(b)).unwrap();
    assert_eq!(f(b"a\n.\nb"), "a\r\n..\r\nb\r\n.\r\n");
    assert_eq!(f(b".x"), "..x\r\n.\r\n");
    assert_eq!(f(b"x\ry\r\n"), "x\r\ny\r\n.\r\n");
    assert_eq!(f(b"x\r\n\r\n..y\r"), "x\r\n\r\n...y\r\n.\r\n");
    assert_eq!(f(b"a\n\rb"), "a\r\n\r\nb\r\n.\r\n");
    assert_eq!(f(b"a.b\r\n"), "a.b\r\n.\r\n");
    assert_eq!(f(b""), ".\r\n");
}

#[tokio::test]
async fn antwort_535_ist_anmeldung() {
    let k = schluessel();
    let pw = passwort();
    let server = k.server.clone();
    let (ergebnis, gesehen) = fahre(ziel(Some(&pw)), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &["AUTH PLAIN"]).await;
        s.erwarte("AUTH PLAIN ").await;
        s.sag("535 5.7.8 falsch").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Anmeldung));
    assert!(
        !gesehen.iter().any(|z| z.starts_with("MAIL")),
        "{gesehen:?}"
    );
}

#[tokio::test]
async fn login_nur_wenn_plain_fehlt() {
    let k = schluessel();
    let pw = passwort();
    let server = k.server.clone();
    let (ergebnis, gesehen) = fahre(
        ziel(Some(&pw)),
        k.client,
        Auftrag::Pruefen,
        |s| async move {
            let mut s = s
                .vorspann(server, &["AUTH=LOGIN", "AUTH LOGIN CRAM-MD5"])
                .await;
            s.erwarte("AUTH LOGIN").await;
            s.sag("334 VXNlcm5hbWU6").await;
            s.hoer().await;
            s.sag("334 UGFzc3dvcmQ6").await;
            s.hoer().await;
            s.sag("235 ok").await;
            s.erwarte("QUIT").await;
            s.sag("221 tschuess").await;
            s.rest().await
        },
    )
    .await;
    assert_eq!(ergebnis, Ok(()));
    assert_eq!(
        gesehen[3..],
        [
            "AUTH LOGIN".to_string(),
            STANDARD.encode("nutzer"),
            STANDARD.encode("geheim"),
            "QUIT".into()
        ]
    );
}

#[tokio::test]
async fn zugangsdaten_ohne_auth_angebot_ist_anmeldung() {
    let k = schluessel();
    let pw = passwort();
    let server = k.server.clone();
    let (ergebnis, gesehen) = fahre(ziel(Some(&pw)), k.client, SENDEN, |s| async move {
        s.vorspann(server, &["8BITMIME"]).await.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Anmeldung));
    assert!(
        !gesehen.iter().any(|z| z.starts_with("MAIL")),
        "{gesehen:?}"
    );
}

#[tokio::test]
async fn ohne_zugangsdaten_keine_anmeldung() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, gesehen) = fahre(ziel(None), k.client, Auftrag::Pruefen, |s| async move {
        let mut s = s.vorspann(server, &["AUTH PLAIN"]).await;
        s.erwarte("QUIT").await;
        s.sag("221 tschuess").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Ok(()));
    assert!(
        !gesehen.iter().any(|z| z.starts_with("AUTH")),
        "{gesehen:?}"
    );
}

#[tokio::test]
async fn halbe_zugangsdaten_sind_anmeldung_ohne_verbindung() {
    let k = schluessel();
    let mut z = ziel(None);
    z.benutzer = Some("nutzer");
    let (ergebnis, gesehen) = fahre(z, k.client, SENDEN, |s| async move { s.rest().await }).await;
    assert_eq!(ergebnis, Err(SmtpFehler::Anmeldung));
    assert!(gesehen.is_empty(), "{gesehen:?}");
}

/// Bis RCPT mit `antwort`, danach ist Schluss.
async fn rcpt_mit(antwort: &'static str) -> Result<(), SmtpFehler> {
    let k = schluessel();
    let server = k.server.clone();
    fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        s.erwarte("MAIL FROM:").await;
        s.sag("250 ok").await;
        s.erwarte("RCPT TO:").await;
        s.sag(antwort).await;
        s.rest().await
    })
    .await
    .0
}

#[tokio::test]
async fn antwort_450_bei_rcpt_ist_voruebergehend() {
    assert_eq!(
        rcpt_mit("450 4.2.1 spaeter").await,
        Err(SmtpFehler::Voruebergehend(450))
    );
}

#[tokio::test]
async fn antwort_550_bei_rcpt_ist_abgelehnt() {
    assert_eq!(
        rcpt_mit("550 5.1.1 unbekannt").await,
        Err(SmtpFehler::Abgelehnt(550))
    );
}

#[tokio::test]
async fn abbruch_nach_daten_ist_ungewiss() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, daten) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        for _ in 0..2 {
            s.hoer().await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        s.sag("354 los").await;
        s.daten().await
        // Server schließt, ohne zu antworten.
    })
    .await;
    assert!(daten.ends_with("\r\n.\r\n"), "{daten:?}");
    assert_eq!(ergebnis, Err(SmtpFehler::Ungewiss));
}

#[tokio::test(start_paused = true)]
async fn stille_nach_daten_ist_ungewiss() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, ()) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        for _ in 0..2 {
            s.hoer().await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        s.sag("354 los").await;
        s.daten().await;
        // Schweigt, bis der Client aufgibt.
        s.rest().await;
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Ungewiss));
}

#[tokio::test(start_paused = true)]
async fn abschliessende_antwort_nach_drei_minuten_gilt_als_zugestellt() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, ()) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        // Ein zäher Dialog bis zur 354 verbraucht schon einen guten Teil der Sitzungsfrist.
        let zaeh = Duration::from_secs(25);
        for _ in 0..2 {
            s.hoer().await;
            tokio::time::sleep(zaeh).await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        tokio::time::sleep(zaeh).await;
        s.sag("354 los").await;
        s.daten().await;
        // Der Server prüft lange (Virenscan), bevor er antwortet.
        tokio::time::sleep(Duration::from_secs(180)).await;
        s.sag("250 angenommen").await;
        s.rest().await;
    })
    .await;
    assert_eq!(ergebnis, Ok(()));
}

#[tokio::test(start_paused = true)]
async fn stille_nach_daten_endet_erst_nach_der_datenfrist() {
    let k = schluessel();
    let server = k.server.clone();
    let start = Instant::now();
    let (ergebnis, ()) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        for _ in 0..2 {
            s.hoer().await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        s.sag("354 los").await;
        s.daten().await;
        s.rest().await;
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Ungewiss));
    let dauer = start.elapsed();
    assert!(
        dauer >= DATEN_ZEITLIMIT && dauer < DATEN_ZEITLIMIT + Duration::from_secs(30),
        "{dauer:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn stille_vor_daten_ist_zeitueberschreitung() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, _) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        s.erwarte("MAIL FROM:").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Zeitueberschreitung));
}

#[tokio::test]
async fn abbruch_vor_daten_ist_verbindung() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, ()) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        s.erwarte("MAIL FROM:").await;
        s.sag("250 ok").await;
        s.erwarte("RCPT TO:").await;
        // Server schließt vor der Antwort.
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Verbindung));
}

#[tokio::test]
async fn ablehnung_nach_daten_ist_nicht_ungewiss() {
    let k = schluessel();
    let server = k.server.clone();
    let (ergebnis, _) = fahre(ziel(None), k.client, SENDEN, |s| async move {
        let mut s = s.vorspann(server, &[]).await;
        for _ in 0..2 {
            s.hoer().await;
            s.sag("250 ok").await;
        }
        s.erwarte("DATA").await;
        s.sag("354 los").await;
        s.daten().await;
        s.sag("554 5.7.1 spam").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Abgelehnt(554)));
}

#[tokio::test]
async fn ohne_starttls_angebot_kein_klartext() {
    let k = schluessel();
    let pw = passwort();
    let (ergebnis, gesehen) = fahre(ziel(Some(&pw)), k.client, SENDEN, |mut s| async move {
        s.sag("220 mx.test ESMTP").await;
        s.erwarte("EHLO ").await;
        s.sag("250-mx.test\r\n250 AUTH PLAIN LOGIN").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Tls));
    assert_eq!(gesehen, vec!["EHLO lifeline-hub", "QUIT"]);
}

#[tokio::test]
async fn eingeschobene_antwort_nach_starttls_bricht_ab() {
    let k = schluessel();
    let pw = passwort();
    let (ergebnis, gesehen) = fahre(ziel(Some(&pw)), k.client, SENDEN, |mut s| async move {
        s.sag("220 mx.test ESMTP").await;
        s.erwarte("EHLO ").await;
        s.sag("250-mx.test\r\n250 STARTTLS").await;
        s.erwarte("STARTTLS").await;
        s.sag("220 los\r\n250 eingeschoben").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Antwort));
    assert!(
        !gesehen.iter().any(|z| z.starts_with("AUTH")),
        "{gesehen:?}"
    );
}

#[tokio::test]
async fn fremdes_zertifikat_ist_tls() {
    let echt = schluessel();
    let fremd = schluessel();
    let pw = passwort();
    let server = fremd.server.clone();
    let (ergebnis, gesehen) = fahre(ziel(Some(&pw)), echt.client, SENDEN, |mut s| async move {
        s.sag("220 mx.test ESMTP").await;
        s.erwarte("EHLO ").await;
        s.sag("250-mx.test\r\n250 STARTTLS").await;
        s.erwarte("STARTTLS").await;
        s.sag("220 los").await;
        let gesehen = s.gesehen.clone();
        // Der Handshake scheitert am Client; der Server sieht danach nichts mehr.
        let r = TlsAcceptor::from(server).accept(s.r.into_inner()).await;
        assert!(r.is_err());
        gesehen
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Tls));
    assert_eq!(gesehen, vec!["EHLO lifeline-hub", "STARTTLS"]);
}

#[tokio::test]
async fn falscher_name_ist_tls() {
    let k = schluessel();
    let mut z = ziel(None);
    z.host = "mx.example.org";
    let server = k.server.clone();
    let (ergebnis, ()) = fahre(z, k.client, Auftrag::Pruefen, |mut s| async move {
        s.sag("220 mx.test ESMTP").await;
        s.erwarte("EHLO ").await;
        s.sag("250-mx.test\r\n250 STARTTLS").await;
        s.erwarte("STARTTLS").await;
        s.sag("220 los").await;
        let _ = TlsAcceptor::from(server).accept(s.r.into_inner()).await;
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Tls));
}

#[tokio::test]
async fn implizites_tls_vor_dem_gruss() {
    let k = schluessel();
    let pw = passwort();
    let mut z = ziel(Some(&pw));
    z.verschluesselung = Verschluesselung::Tls;
    z.port = 465;
    let server = k.server.clone();
    let (ergebnis, gesehen) = fahre(z, k.client, Auftrag::Pruefen, |s| async move {
        let mut s = s.tls(server).await;
        s.sag("220 mx.test ESMTP").await;
        s.erwarte("EHLO ").await;
        s.sag("250-mx.test\r\n250 AUTH PLAIN").await;
        s.erwarte("AUTH PLAIN ").await;
        s.sag("235 ok").await;
        s.erwarte("QUIT").await;
        s.sag("221 tschuess").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Ok(()));
    assert_eq!(gesehen.len(), 3, "{gesehen:?}");
}

#[tokio::test]
async fn gruss_554_ist_abgelehnt() {
    let k = schluessel();
    let (ergebnis, _) = fahre(ziel(None), k.client, SENDEN, |mut s| async move {
        s.sag("554 kein Dienst").await;
        s.rest().await
    })
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Abgelehnt(554)));
}

async fn gruss_mit(gruss: String) -> Result<(), SmtpFehler> {
    let k = schluessel();
    fahre(ziel(None), k.client, SENDEN, |mut s| async move {
        s.sag(&gruss).await;
        s.rest().await
    })
    .await
    .0
}

#[tokio::test]
async fn unlesbare_antworten_sind_antwort() {
    assert_eq!(gruss_mit("hallo".into()).await, Err(SmtpFehler::Antwort));
    assert_eq!(gruss_mit("220x".into()).await, Err(SmtpFehler::Antwort));
    assert_eq!(
        gruss_mit("220-a\r\n250 b".into()).await,
        Err(SmtpFehler::Antwort)
    );
    assert_eq!(
        gruss_mit(format!("220 {}", "x".repeat(ZEILE_MAX))).await,
        Err(SmtpFehler::Antwort)
    );
    let viele = (0..ZEILEN_MAX)
        .map(|_| "220-x".to_string())
        .chain(std::iter::once("220 x".to_string()))
        .collect::<Vec<_>>()
        .join("\r\n");
    assert_eq!(gruss_mit(viele).await, Err(SmtpFehler::Antwort));
}

#[tokio::test]
async fn mehrzeilige_antwort_im_deckel_gilt() {
    let gruss = (1..ZEILEN_MAX)
        .map(|_| "220-x".to_string())
        .chain(std::iter::once(format!(
            "220 {}",
            "y".repeat(ZEILE_MAX - 4)
        )))
        .collect::<Vec<_>>()
        .join("\r\n");
    // Der Gruß gilt, also kommt EHLO; danach schließt der Server.
    let k = schluessel();
    let (ergebnis, ehlo) = fahre(ziel(None), k.client, SENDEN, |mut s| async move {
        s.sag(&gruss).await;
        s.hoer().await
    })
    .await;
    assert_eq!(ehlo.as_deref(), Some("EHLO lifeline-hub"));
    assert_eq!(ergebnis, Err(SmtpFehler::Verbindung));
}

#[tokio::test]
async fn zeilenumbruch_in_adresse_wird_nie_gesendet() {
    let k = schluessel();
    let auftrag = Auftrag::Senden {
        von: "a@x>\r\nRCPT TO:<c@z",
        an: "b@y",
        nachricht: b"x",
    };
    let (ergebnis, gesehen) = fahre(
        ziel(None),
        k.client,
        auftrag,
        |s| async move { s.rest().await },
    )
    .await;
    assert_eq!(ergebnis, Err(SmtpFehler::Abgelehnt(553)));
    assert!(gesehen.is_empty(), "{gesehen:?}");
}

#[test]
fn ehlo_name_faellt_auf_vorgabe_zurueck() {
    assert_eq!(ehlo_name("hub.example.org"), "hub.example.org");
    assert_eq!(ehlo_name("hub\r\nMAIL"), EHLO_VORGABE);
    assert_eq!(ehlo_name(""), EHLO_VORGABE);
}

#[tokio::test]
async fn verbinde_lehnt_loopback_ab() {
    let ende = Instant::now() + SITZUNG_ZEITLIMIT;
    for host in ["127.0.0.1", "::1", "localhost", "169.254.169.254"] {
        let mut z = ziel(None);
        z.host = host;
        z.lan_erlaubt = true;
        assert_eq!(
            verbinde(&z, ende).await.err(),
            Some(SmtpFehler::ZielIntern),
            "{host}"
        );
    }
    let mut z = ziel(None);
    z.host = "10.0.0.1";
    assert_eq!(verbinde(&z, ende).await.err(), Some(SmtpFehler::ZielIntern));
}

#[tokio::test]
async fn sende_lehnt_loopback_ab() {
    let k = schluessel();
    let mut z = ziel(None);
    z.host = "127.0.0.1";
    assert_eq!(
        sende(&z, k.client, "a@x", "b@y", b"x").await,
        Err(SmtpFehler::ZielIntern)
    );
}

#[test]
fn gemischte_aufloesung_gilt_nicht() {
    let oeffentlich: SocketAddr = "93.184.216.34:25".parse().unwrap();
    let intern: SocketAddr = "127.0.0.1:25".parse().unwrap();
    assert_eq!(erste_erlaubte(vec![oeffentlich], false), Some(oeffentlich));
    assert_eq!(erste_erlaubte(vec![oeffentlich, intern], true), None);
    assert_eq!(erste_erlaubte(vec![], false), None);
}

#[test]
fn fehler_auf_bestehende_adaptercodes() {
    use AdapterFehler as A;
    let faelle = [
        (SmtpFehler::Dns, A::Dns, None),
        (SmtpFehler::ZielIntern, A::ZielIntern, None),
        (SmtpFehler::Verbindung, A::Verbindung, None),
        (
            SmtpFehler::Zeitueberschreitung,
            A::Zeitueberschreitung,
            None,
        ),
        (SmtpFehler::Tls, A::Tls, None),
        (SmtpFehler::Anmeldung, A::Abgelehnt, None),
        (SmtpFehler::Voruebergehend(451), A::Status, Some(451)),
        (SmtpFehler::Abgelehnt(550), A::Status, Some(550)),
        (SmtpFehler::Ungewiss, A::Status, None),
        (SmtpFehler::Antwort, A::AntwortUngueltig, None),
    ];
    for (f, a, s) in faelle {
        assert_eq!(f.adapter_fehler(), a, "{f:?}");
        assert_eq!(f.status(), s, "{f:?}");
    }
}

#[test]
fn debug_zeigt_keine_zugangsdaten() {
    let pw = passwort();
    let text = format!("{:?}", ziel(Some(&pw)));
    assert!(
        !text.contains("geheim") && !text.contains("nutzer"),
        "{text}"
    );
}
