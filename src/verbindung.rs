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
    I: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    S: Send + 'static,
{
    type Stream = PermitStream<I>;
    type Service = S;
    type Future = Pin<Box<dyn Future<Output = io::Result<(Self::Stream, Self::Service)>> + Send>>;

    fn accept(&self, stream: I, service: S) -> Self::Future {
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
/// braucht dafür einen **eigenen** Timer.
pub fn zeitschranken_setzen<A: axum_server::Address, Acc>(
    server: &mut axum_server::Server<A, Acc>,
    fristen: Fristen,
) {
    let builder = server.http_builder();
    builder
        .http1()
        .timer(hyper_util::rt::TokioTimer::new())
        .header_read_timeout(Some(fristen.header_read));
    builder
        .http2()
        .timer(hyper_util::rt::TokioTimer::new())
        .keep_alive_interval(Some(fristen.h2_intervall))
        .keep_alive_timeout(fristen.h2_timeout);
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
