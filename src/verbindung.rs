//! Schutz auf Verbindungsebene (LFH-231).
//!
//! Diese Ebene liegt **unter** dem Router: hyper liest die Request-Header, bevor der
//! tower-Service aufgerufen wird. Eine Slow-Loris-Verbindung, die Header bytesweise tröpfelt,
//! erreicht nie einen Handler und damit auch nicht [`crate::zulassung`].
//!
//! * **Header-Lese-Timeout** — eine Verbindung, die ihre Header nicht binnen
//!   [`HEADER_READ_TIMEOUT`] vollständig sendet, wird abgeräumt.
//! * **Verbindungs-Obergrenze** — höchstens [`MAX_VERBINDUNGEN`] Verbindungen werden
//!   gleichzeitig bedient ([`SemaphorAkzeptor`]).
//! * **TCP-Keepalive** — jede angenommene Verbindung prüft nach [`TCP_KEEPALIVE_ZEIT`] Stille,
//!   ob die Gegenstelle noch da ist (LFH-938). Ein Feld-Tablet, das mitten im Upload in den
//!   Standby geht, sendet kein FIN; ohne Keepalive hielte die Verbindung ihren Platz unbegrenzt.
//! * **Streams je HTTP/2-Verbindung** — höchstens [`HTTP2_MAX_STREAMS`] zugleich (LFH-920).
//! * **Kopfgröße** — HTTP/1-Köpfe über [`HTTP1_MAX_KOPF`] weist hyper mit 431 ab (LFH-925).
//!
//! ## Die Timer-Falle
//!
//! `header_read_timeout` **erfordert** einen gesetzten Timer. Fehlt er, paniked hyper
//! (`Time::check`) — nicht beim Start, sondern **bei der ersten eingehenden Verbindung** in der
//! Verbindungs-Task. Ohne Timer setzt hyper seinen 30-s-Default zudem still auf „aus“. Die Tests
//! fahren deshalb echte Verbindungen.
//!
//! ## Was die Obergrenze leistet — und was nicht
//!
//! `axum-server` ruft den Akzeptor **innerhalb** der gespawnten Verbindungs-Task auf. Gedeckelt
//! werden damit gleichzeitige TLS-Handshakes und bediente Verbindungen, **nicht** die Zahl
//! offener Sockets. Ein echtes FD-Cap bräuchte eine eigene Accept-Schleife samt Graceful
//! Shutdown und TLS-Handshake-Timeout und ist bewusst nicht gebaut.

use axum_server::accept::Accept;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Frist, in der eine Verbindung ihre Request-Header vollständig gesendet haben muss.
/// Großzügig für langsame Funkstrecken (LTE/Richtfunk), knapp genug, dass eine tröpfelnde
/// Verbindung keinen Platz dauerhaft bindet.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(15);

/// Obergrenze gleichzeitig bedienter Verbindungen. Deutlich über der Clientzahl, weil jeder
/// Client dauerhaft eine SSE-Verbindung hält.
pub const MAX_VERBINDUNGEN: usize = 1024;

/// Abstand der HTTP/2-PING-Prüfungen.
///
/// HTTP/2 kennt kein Gegenstück zu `header_read_timeout` (Header liegen in HEADERS-Frames auf
/// Streams); ein h2-Client, der Frames tröpfelt, liefe an der h1-Frist vorbei. Die
/// PING-basierte Keep-Alive-Prüfung räumt eine nicht antwortende Gegenstelle ab.
pub const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(20);

/// Wie lange auf die PING-Antwort gewartet wird. Muss deutlich unter dem Intervall liegen.
pub const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(10);

/// Stille, nach der das Betriebssystem die erste Keepalive-Probe sendet.
pub const TCP_KEEPALIVE_ZEIT: Duration = Duration::from_secs(60);

/// Abstand der folgenden Keepalive-Proben (wo das System ihn einstellen lässt).
pub const TCP_KEEPALIVE_INTERVALL: Duration = Duration::from_secs(10);

/// Schaltet TCP-Keepalive an einer angenommenen Verbindung ein. Eigener Trait, weil der
/// Akzeptor generisch über den Verbindungstyp ist; beide Serve-Pfade nehmen
/// `tokio::net::TcpStream` an (TLS setzt erst danach auf).
pub trait KeepaliveSetzen {
    fn keepalive_setzen(&self);
}

impl KeepaliveSetzen for tokio::net::TcpStream {
    fn keepalive_setzen(&self) {
        let params = socket2::TcpKeepalive::new().with_time(TCP_KEEPALIVE_ZEIT);
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        let params = params.with_interval(TCP_KEEPALIVE_INTERVALL);
        // Kein Abbruch: ohne Keepalive bleibt die Verbindung so geschützt wie vorher.
        if let Err(fehler) = socket2::SockRef::from(self).set_tcp_keepalive(&params) {
            tracing::debug!(%fehler, "TCP-Keepalive ließ sich nicht setzen");
        }
    }
}

/// Gleichzeitige Streams je HTTP/2-Verbindung (LFH-920), dem Client per SETTINGS mitgeteilt; ein
/// Browser stellt weitere Anfragen zurück, bis ein Stream frei wird. Ohne diese Grenze gälten
/// hypers 200 Streams mit je bis zu 400 KiB Sendepuffer, und ein Client hielte auf einer einzigen
/// Verbindung beliebig viele Live-Ströme offen.
///
/// Ein Browser teilt EINE Verbindung über alle Tabs einer Origin: jeder Tab hält einen Live-Strom
/// (höchstens `live::strom::STROEME_JE_BENUTZER`), die übrigen Streams tragen die Abrufe. 64
/// lässt dafür genug Raum; der Sendepuffer je Stream bleibt bei hypers Vorgabe, damit große
/// Downloads auf langsamer Leitung nicht ausbremsen.
pub const HTTP2_MAX_STREAMS: u32 = 64;
const _: () = assert!(
    HTTP2_MAX_STREAMS <= 64,
    "LFH-920: höchstens 64 Streams je Verbindung"
);

/// Lesepuffer für HTTP/1-Köpfe (LFH-925). Ein längerer Kopf endet mit 431, bevor ein Handler
/// läuft. Ohne Grenze nähme hyper bis etwa 408 KiB an, und jeder Kopfwert, der in eine Logzeile
/// gerät (Request-ID, Pfad), flutete das Journal. 32 KiB lassen Cookies und lange Abfragen weit
/// hinter sich. HTTP/2 braucht nichts Eigenes: hypers Kopflistengrenze steht dort schon auf 16 KiB.
pub const HTTP1_MAX_KOPF: usize = 32 * 1024;

/// Akzeptor, der jede Verbindung an ein Semaphore-Permit bindet. Das Permit lebt in
/// [`PermitStream`] und fällt zurück, sobald die Verbindung geschlossen wird.
#[derive(Clone)]
pub struct SemaphorAkzeptor {
    plaetze: Arc<Semaphore>,
}

impl SemaphorAkzeptor {
    pub fn neu(max: usize) -> Self {
        Self {
            plaetze: Arc::new(Semaphore::new(max)),
        }
    }

    /// Aktuell freie Plätze — für Tests und Diagnose.
    pub fn freie_plaetze(&self) -> usize {
        self.plaetze.available_permits()
    }
}

impl Default for SemaphorAkzeptor {
    fn default() -> Self {
        Self::neu(MAX_VERBINDUNGEN)
    }
}

impl<I, S> Accept<I, S> for SemaphorAkzeptor
where
    I: AsyncRead + AsyncWrite + KeepaliveSetzen + Unpin + Send + 'static,
    S: Send + 'static,
{
    type Stream = PermitStream<I>;
    type Service = S;
    type Future = Pin<Box<dyn Future<Output = io::Result<(Self::Stream, Self::Service)>> + Send>>;

    fn accept(&self, stream: I, service: S) -> Self::Future {
        stream.keepalive_setzen();
        let plaetze = self.plaetze.clone();
        Box::pin(async move {
            // Hier wird GEWARTET statt abgewiesen: auf Verbindungsebene gibt es noch keinen
            // HTTP-Kontext
            // für einen Statuscode. Das Warten ist die Bremse gegen Verbindungsfluten.
            let permit = plaetze
                .acquire_owned()
                .await
                .map_err(|e| io::Error::other(format!("Verbindungs-Semaphore geschlossen: {e}")))?;
            Ok((
                PermitStream {
                    inner: stream,
                    _permit: permit,
                },
                service,
            ))
        })
    }
}

/// Setzt Timer und Fristen auf dem hyper-Builder — für HTTP/1 **und** HTTP/2, für beide
/// Bind-Arten (`from_tcp` wie `bind_rustls`). Der Timer ist Pflicht, s. Modul-Doku.
///
/// Die zwei Generics sind nötig: `A` ist die Adress-Art, `Acc` der Akzeptor. Mit nur einem
/// Generic wäre die Funktion still an den Default-Akzeptor gebunden und schlösse genau die
/// Aufrufer mit `SemaphorAkzeptor` aus.
///
/// **Beide Protokolle müssen konfiguriert werden:** `hyper_util`s `auto::Builder` hält getrennte
/// h1-/h2-Konfigurationen. TLS bietet per ALPN `h2` an, und h2 ist als h2c auch im Klartext
/// erreichbar. Für h2 tritt die PING-Prüfung an die Stelle des Header-Timeouts; `.http2()`
/// braucht dafür einen **eigenen** Timer. Die Stream-Grenze [`HTTP2_MAX_STREAMS`] gilt damit
/// ebenfalls für TLS und h2c.
pub fn zeitschranken_setzen<A: axum_server::Address, Acc>(
    server: &mut axum_server::Server<A, Acc>,
    fristen: Fristen,
) {
    let builder = server.http_builder();
    builder
        .http1()
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(Some(fristen.header_read))
        .max_buf_size(HTTP1_MAX_KOPF);
    builder
        .http2()
        .timer(hyper_util::rt::TokioTimer::new())
        .keep_alive_interval(Some(fristen.h2_intervall))
        .keep_alive_timeout(fristen.h2_timeout)
        .max_concurrent_streams(HTTP2_MAX_STREAMS);
}

/// Die Verbindungsfristen, gebündelt, damit Tests sie auf Millisekunden stellen können.
#[derive(Clone, Copy)]
pub struct Fristen {
    pub header_read: Duration,
    pub h2_intervall: Duration,
    pub h2_timeout: Duration,
}

impl Default for Fristen {
    fn default() -> Self {
        Self {
            header_read: HEADER_READ_TIMEOUT,
            h2_intervall: HTTP2_KEEP_ALIVE_INTERVAL,
            h2_timeout: HTTP2_KEEP_ALIVE_TIMEOUT,
        }
    }
}

/// Verbindungs-IO, das sein Semaphore-Permit für die eigene Lebensdauer festhält. `Unpin` beim
/// inneren Typ macht `pin_project` überflüssig.
pub struct PermitStream<I> {
    inner: I,
    _permit: OwnedSemaphorePermit,
}

impl<I: AsyncRead + Unpin> AsyncRead for PermitStream<I> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<I: AsyncWrite + Unpin> AsyncWrite for PermitStream<I> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Router};
    use tokio::io::AsyncReadExt;
    use tokio::io::AsyncWriteExt;

    /// Startet einen echten Server mit voller Konfiguration und liefert seine Adresse. Ein echter
    /// Listener statt `oneshot`, weil die Timer-Falle erst beim Verbindungsaufbau zuschlägt.
    async fn server_starten(
        fristen: Fristen,
        max_verbindungen: usize,
    ) -> (std::net::SocketAddr, SemaphorAkzeptor) {
        let app = Router::new().route("/ping", get(|| async { "pong" }));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("Testport");
        listener.set_nonblocking(true).expect("nonblocking");
        let addr = listener.local_addr().expect("Adresse");

        let akzeptor = SemaphorAkzeptor::neu(max_verbindungen);
        let mut server = axum_server::from_tcp(listener)
            .expect("from_tcp")
            .acceptor(akzeptor.clone());
        zeitschranken_setzen(&mut server, fristen);

        tokio::spawn(async move { server.serve(app.into_make_service()).await });

        // Dem Listener einen Moment geben, bevor der erste Client verbindet.
        tokio::time::sleep(Duration::from_millis(120)).await;
        (addr, akzeptor)
    }

    /// LFH-938: Keepalive ist an der Verbindung wirklich gesetzt, mit der Frist von oben.
    #[tokio::test]
    async fn keepalive_wird_an_der_verbindung_gesetzt() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let _client = tokio::net::TcpStream::connect(addr).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();

        let sock = socket2::SockRef::from(&server);
        assert!(!sock.keepalive().unwrap(), "Vorgabe: aus");
        server.keepalive_setzen();
        assert!(sock.keepalive().unwrap());
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        assert_eq!(sock.tcp_keepalive_time().unwrap(), TCP_KEEPALIVE_ZEIT);
    }

    /// Regressionstest gegen die Timer-Falle: ohne `.timer()` paniked hyper in der
    /// Verbindungs-Task, und der Request bekäme nie eine Antwort.
    #[tokio::test]
    async fn echte_anfrage_wird_beantwortet() {
        let (addr, _) = server_starten(Fristen::default(), 8).await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        sock.write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .expect("senden");

        let mut antwort = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), sock.read_to_end(&mut antwort))
            .await
            .expect("Antwort binnen 5 s — sonst ist die Verbindungs-Task gestorben")
            .expect("lesen");

        let text = String::from_utf8_lossy(&antwort);
        assert!(text.starts_with("HTTP/1.1 200"), "Antwort war: {text}");
        assert!(text.contains("pong"), "Antwort war: {text}");
    }

    /// HTTP/2 im Klartext (h2c): fehlt `.http2().timer(..)`, paniked hyper beim Setzen der
    /// Keep-Alive-Frist und es kommt nie eine Antwort.
    #[tokio::test]
    async fn h2c_verbindung_wird_bedient() {
        let (addr, _) = server_starten(Fristen::default(), 8).await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        // Connection Preface, dann ein leerer SETTINGS-Frame (Länge 0, Typ 0x4, Stream 0).
        sock.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
            .await
            .expect("Preface");
        sock.write_all(&[0, 0, 0, 4, 0, 0, 0, 0, 0])
            .await
            .expect("SETTINGS");

        // Der Server muss seinerseits mit einem SETTINGS-Frame antworten.
        let mut kopf = [0u8; 9];
        tokio::time::timeout(Duration::from_secs(5), sock.read_exact(&mut kopf))
            .await
            .expect("Antwort binnen 5 s — sonst ist die h2-Verbindungs-Task gestorben")
            .expect("lesen");

        assert_eq!(
            kopf[3], 0x4,
            "erster Server-Frame muss SETTINGS sein, war Typ {}",
            kopf[3]
        );
    }

    /// Die Stream-Grenze (LFH-920) steht im ersten SETTINGS-Frame des Servers. Ohne sie schickte
    /// hyper keinen `SETTINGS_MAX_CONCURRENT_STREAMS` (Kennung 0x3), und es gälten 200 Streams.
    #[tokio::test]
    async fn h2_settings_begrenzen_die_streams() {
        let (addr, _) = server_starten(Fristen::default(), 8).await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        sock.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
            .await
            .expect("Preface");
        sock.write_all(&[0, 0, 0, 4, 0, 0, 0, 0, 0])
            .await
            .expect("SETTINGS");

        let mut kopf = [0u8; 9];
        tokio::time::timeout(Duration::from_secs(5), sock.read_exact(&mut kopf))
            .await
            .expect("Antwort binnen 5 s")
            .expect("lesen");
        assert_eq!(kopf[3], 0x4, "erster Server-Frame muss SETTINGS sein");
        let laenge = u32::from_be_bytes([0, kopf[0], kopf[1], kopf[2]]) as usize;
        let mut nutzlast = vec![0u8; laenge];
        tokio::time::timeout(Duration::from_secs(5), sock.read_exact(&mut nutzlast))
            .await
            .expect("Nutzlast binnen 5 s")
            .expect("lesen");

        // Je Eintrag 2 Byte Kennung, 4 Byte Wert (RFC 9113, 6.5.1).
        let max_streams = nutzlast
            .chunks_exact(6)
            .find(|e| u16::from_be_bytes([e[0], e[1]]) == 0x3)
            .map(|e| u32::from_be_bytes([e[2], e[3], e[4], e[5]]));
        assert_eq!(max_streams, Some(HTTP2_MAX_STREAMS));
    }

    /// Der h2-Schutz: ein Client, der die Verbindung offen hält und auf PINGs nicht antwortet, muss
    /// abgeräumt werden — der Slow-Loris-Fall auf h2.
    #[tokio::test]
    async fn stiller_h2_client_wird_abgeraeumt() {
        // Fristen in Millisekunden, damit die Wirkung im Test überhaupt eintritt.
        let (addr, _) = server_starten(
            Fristen {
                header_read: Duration::from_secs(30),
                h2_intervall: Duration::from_millis(150),
                h2_timeout: Duration::from_millis(150),
            },
            8,
        )
        .await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        sock.write_all(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
            .await
            .expect("Preface");
        sock.write_all(&[0, 0, 0, 4, 0, 0, 0, 0, 0])
            .await
            .expect("SETTINGS");

        // Ab jetzt schweigt der Client — insbesondere beantwortet er keine PINGs.
        let mut muell = Vec::new();
        let ergebnis =
            tokio::time::timeout(Duration::from_secs(10), sock.read_to_end(&mut muell)).await;

        assert!(
            ergebnis.is_ok(),
            "Server hat die stille h2-Verbindung nicht abgeräumt — Keep-Alive-Prüfung wirkungslos"
        );
    }

    /// LFH-925: ein HTTP/1-Kopf über 32 KiB wird auf Verbindungsebene abgewiesen. Mutationsprobe:
    /// ohne `max_buf_size` antwortet der Server mit 200.
    #[tokio::test]
    async fn uebergrosser_kopf_wird_abgewiesen() {
        let (addr, _) = server_starten(Fristen::default(), 8).await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let anfrage = format!(
            "GET /ping HTTP/1.1\r\nHost: localhost\r\nx-request-id: {}\r\nConnection: close\r\n\r\n",
            "a".repeat(HTTP1_MAX_KOPF + 1024)
        );
        // Der Server kann die Verbindung schließen, bevor alles gesendet ist.
        let _ = sock.write_all(anfrage.as_bytes()).await;

        let mut antwort = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), sock.read_to_end(&mut antwort))
            .await
            .expect("Antwort oder Abbruch binnen 5 s");
        let text = String::from_utf8_lossy(&antwort);
        assert!(
            text.is_empty() || text.starts_with("HTTP/1.1 431"),
            "erwartet 431 oder Abbruch, Antwort war: {}",
            &text[..text.len().min(200)]
        );
    }

    /// Gegenprobe: ein Kopf knapp unter der Grenze wird bedient.
    #[tokio::test]
    async fn kopf_unter_der_grenze_wird_bedient() {
        let (addr, _) = server_starten(Fristen::default(), 8).await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        let anfrage = format!(
            "GET /ping HTTP/1.1\r\nHost: localhost\r\nx-gross: {}\r\nConnection: close\r\n\r\n",
            "a".repeat(HTTP1_MAX_KOPF / 2)
        );
        sock.write_all(anfrage.as_bytes()).await.expect("senden");
        let mut antwort = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), sock.read_to_end(&mut antwort))
            .await
            .expect("Antwort binnen 5 s")
            .expect("lesen");
        let text = String::from_utf8_lossy(&antwort);
        assert!(text.starts_with("HTTP/1.1 200"), "Antwort war: {text}");
    }

    /// Slow Loris im Kleinen: Header nie abschließen; der Server muss die Verbindung nach der Frist
    /// abräumen.
    #[tokio::test]
    async fn haengende_header_werden_abgeraeumt() {
        let frist = Duration::from_millis(400);
        let (addr, _) = server_starten(
            Fristen {
                header_read: frist,
                ..Fristen::default()
            },
            8,
        )
        .await;

        let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
        // Angefangener, nie beendeter Header-Block — genau das Slow-Loris-Muster.
        sock.write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\n")
            .await
            .expect("senden");

        let mut puffer = Vec::new();
        let ergebnis = tokio::time::timeout(frist * 8, sock.read_to_end(&mut puffer)).await;

        assert!(
            ergebnis.is_ok(),
            "Server hat die hängende Verbindung nicht abgeräumt — Header-Timeout wirkungslos"
        );
    }

    /// Jede geschlossene Verbindung muss ihren Platz zurückgeben, sonst liefe der Server nach
    /// MAX_VERBINDUNGEN Anfragen dauerhaft zu.
    #[tokio::test]
    async fn platz_faellt_nach_der_verbindung_zurueck() {
        let (addr, akzeptor) = server_starten(Fristen::default(), 4).await;
        assert_eq!(
            akzeptor.freie_plaetze(),
            4,
            "zu Beginn sind alle Plätze frei"
        );

        for _ in 0..3 {
            let mut sock = tokio::net::TcpStream::connect(addr).await.expect("connect");
            sock.write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .await
                .expect("senden");
            let mut antwort = Vec::new();
            let _ = tokio::time::timeout(Duration::from_secs(5), sock.read_to_end(&mut antwort))
                .await
                .expect("Antwort binnen 5 s");
            drop(sock);
        }

        // Der Permit-Drop passiert in der Verbindungs-Task, nicht synchron zum Client.
        for _ in 0..50 {
            if akzeptor.freie_plaetze() == 4 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
        assert_eq!(
            akzeptor.freie_plaetze(),
            4,
            "alle Plätze müssen nach dem Verbindungsende zurückgefallen sein"
        );
    }

    /// Wirkungsnachweis der Grenze (LFH-311): mit genau EINEM Platz hält die erste Verbindung ihn
    /// besetzt, die zweite wird erst nach deren Schließen bedient.
    ///
    /// Rot wird das bei einem `PermitStream` ohne festgehaltenes Permit und bei einem Serve-Pfad
    /// ohne `.acceptor(..)`. Für die Serve-Pfade in `src/main.rs` deckt Letzteres der Montage-Guard
    /// in `tests/zulassung_guard.rs` ab.
    #[tokio::test]
    async fn die_grenze_laesst_die_zweite_verbindung_warten() {
        let (addr, akzeptor) = server_starten(Fristen::default(), 1).await;
        assert_eq!(
            akzeptor.freie_plaetze(),
            1,
            "genau ein Platz, und der ist frei"
        );

        // Erste Verbindung ohne `Connection: close` bleibt offen und hält den einzigen Platz; ihre
        // Rundenzeit ist der Maßstab für das Wartefenster.
        let begonnen = std::time::Instant::now();
        let mut erste = tokio::net::TcpStream::connect(addr).await.expect("connect");
        erste
            .write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .expect("senden");
        let mut puffer = [0u8; 1024];
        let gelesen = tokio::time::timeout(Duration::from_secs(5), erste.read(&mut puffer))
            .await
            .expect("Antwort binnen 5 s")
            .expect("lesen");
        let erste_antwort = String::from_utf8_lossy(&puffer[..gelesen]).into_owned();
        assert!(
            erste_antwort.starts_with("HTTP/1.1 200"),
            "die erste Verbindung muss bedient werden, Antwort war: {erste_antwort}"
        );
        let rundenzeit = begonnen.elapsed();

        // Die offene Verbindung hält ihren Platz; fiele das Permit beim Accept zurück, stünde hier
        // 1.
        assert_eq!(
            akzeptor.freie_plaetze(),
            0,
            "die offene Verbindung muss ihren Platz über die ganze Verbindungsdauer halten"
        );

        // Zweite Verbindung: verbindet und sendet vollständig — bedient werden darf sie nicht.
        let mut zweite = tokio::net::TcpStream::connect(addr).await.expect("connect");
        zweite
            .write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .expect("senden");

        // „Wird nicht bedient“ braucht ein Zeitfenster. Es leitet sich aus der gemessenen
        // Rundenzeit
        // ab (Faktor 20), mit Untergrenze gegen Messrauschen und Obergrenze für langsame Hardware.
        let fenster = (rundenzeit * 20).clamp(Duration::from_millis(300), Duration::from_secs(3));
        let mut muell = [0u8; 64];
        let vorzeitig = tokio::time::timeout(fenster, zweite.read(&mut muell)).await;
        assert!(
            vorzeitig.is_err(),
            "die zweite Verbindung wurde binnen {fenster:?} bedient, obwohl der einzige Platz \
             belegt ist — die Obergrenze greift nicht"
        );
        assert_eq!(
            akzeptor.freie_plaetze(),
            0,
            "der Platz ist weiterhin von der ersten Verbindung belegt"
        );

        // Platz freigeben — erst jetzt darf die zweite drankommen.
        drop(erste);

        let mut antwort = Vec::new();
        tokio::time::timeout(Duration::from_secs(5), zweite.read_to_end(&mut antwort))
            .await
            .expect("die zweite Verbindung muss nach dem Freiwerden binnen 5 s bedient werden")
            .expect("lesen");
        let text = String::from_utf8_lossy(&antwort);
        assert!(text.starts_with("HTTP/1.1 200"), "Antwort war: {text}");
        assert!(text.contains("pong"), "Antwort war: {text}");
    }
}
