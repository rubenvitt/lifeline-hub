//! Schutz auf Verbindungsebene (LFH-231/G10).
//!
//! Diese Ebene liegt **unter** dem Router: hyper liest die Request-Header, bevor der
//! tower-Service überhaupt aufgerufen wird. Die Zulassungssteuerung aus
//! [`crate::zulassung`] kann hier strukturell nichts ausrichten — eine Slow-Loris-Verbindung,
//! die Header bytesweise trickst, erreicht nie einen Handler und wird von keinem
//! Request-Timeout erfasst.
//!
//! Zwei Maßnahmen:
//!
//! * **Header-Lese-Timeout** — eine Verbindung, die ihre Header nicht binnen
//!   [`HEADER_READ_TIMEOUT`] vollständig sendet, wird abgeräumt.
//! * **Verbindungs-Obergrenze** — höchstens [`MAX_VERBINDUNGEN`] Verbindungen werden
//!   gleichzeitig bedient ([`SemaphorAkzeptor`]).
//!
//! ## Die Timer-Falle
//!
//! `header_read_timeout` **erfordert** einen zuvor gesetzten Timer. Fehlt er, paniked hyper
//! (`common/time.rs`, `Time::check`) — und zwar nicht beim Start, sondern **bei der ersten
//! eingehenden Verbindung**, in der gespawnten Verbindungs-Task. Ein Smoke-Test, der den
//! Server nur startet, bemerkt das nicht; deshalb fahren die Tests hier echte Verbindungen.
//!
//! Bemerkenswert: **vorher gab es gar kein Header-Timeout.** hypers eingebauter 30-s-Default
//! fällt mangels Timer in einen `warn!`-Zweig und wird still auf „aus" gesetzt. Diese Änderung
//! schließt also eine offene Lücke, sie verschärft keinen bestehenden Wert.
//!
//! ## Was die Obergrenze leistet — und was nicht
//!
//! `axum-server` ruft den Akzeptor **innerhalb** der bereits gespawnten Verbindungs-Task auf.
//! Gedeckelt werden damit gleichzeitige TLS-Handshakes und gleichzeitig **bediente**
//! Verbindungen — **nicht** die Zahl offener Sockets. Gegen eine reine FD-Erschöpfung ist das
//! eine Teilabwehr; ein echtes FD-Cap bräuchte eine eigene Accept-Schleife und damit den
//! Nachbau von Graceful Shutdown und TLS-Handshake-Timeout. Bewusst nicht gebaut.

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
///
/// Großzügig genug für langsame Funkstrecken (BOS-Lagen hängen an LTE/Richtfunk), knapp genug,
/// dass eine bytesweise tröpfelnde Verbindung keinen Accept-Slot dauerhaft bindet.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(15);

/// Obergrenze gleichzeitig bedienter Verbindungen.
///
/// Muss deutlich über der erwarteten Clientzahl liegen, weil jeder Client neben seinen
/// normalen Requests **dauerhaft** eine SSE-Verbindung hält (eine `EventSource` je Einsatz).
pub const MAX_VERBINDUNGEN: usize = 1024;

/// Abstand der HTTP/2-PING-Prüfungen auf einer im Leerlauf wirkenden Verbindung.
///
/// HTTP/2 kennt **kein** Gegenstück zu `header_read_timeout`: die Header liegen dort in
/// HEADERS-Frames auf Streams, nicht in einer Lesephase vor dem Routing. Ein h2-Client, der
/// Frames tröpfelt, liefe also an der h1-Frist vorbei. Die PING-basierte Keep-Alive-Prüfung
/// ist der Ersatz — sie stellt fest, ob die Gegenstelle überhaupt noch antwortet, und räumt
/// sie sonst ab.
pub const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(20);

/// Wie lange auf die PING-Antwort gewartet wird, bevor die Verbindung als tot gilt.
///
/// Muss deutlich unter dem Intervall liegen, sonst überholen sich die Prüfungen.
pub const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(10);

/// Akzeptor, der jede Verbindung an ein Semaphore-Permit bindet.
///
/// Das Permit lebt in [`PermitStream`] und fällt zurück, sobald die Verbindung geschlossen
/// wird — Erfolg wie Abbruch.
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
            // Hier wird bewusst GEWARTET statt abgewiesen: anders als beim Request (wo ein
            // 503 die ehrliche Antwort ist) gibt es auf Verbindungsebene noch keinen
            // HTTP-Kontext, in dem sich ein Statuscode senden ließe. Wer nicht drankommt,
            // wartet — genau das ist die Bremse gegen Verbindungsfluten.
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

/// Setzt Timer und Fristen auf dem hyper-Builder des Servers — für HTTP/1 **und** HTTP/2.
///
/// Gilt für beide Bind-Arten (`from_tcp` wie `bind_rustls`), weil `http_builder` auf
/// `impl<A: Address, Acc> Server<A, Acc>` sitzt. Der Timer ist **nicht optional** — ohne ihn
/// paniked hyper bei der ersten Verbindung, s. Modul-Doku.
///
/// Die ZWEI Generics sind kein Zierrat: seit axum-server 0.8 ist `Server` nicht mehr nur über
/// den Akzeptor generisch, sondern auch über die Adress-Art (TCP/Unix-Socket) — `A` ist die
/// Adresse, `Acc` der Akzeptor. In 0.7 stand das einzelne `A` noch für den Akzeptor. Wer hier
/// auf ein Generic zurückkürzt, bindet die Funktion still an den Default-Akzeptor und schließt
/// damit genau die beiden Aufrufer aus, die den `SemaphorAkzeptor` tragen.
///
/// **Beide Protokolle müssen konfiguriert werden.** `hyper_util`s `auto::Builder` hält
/// getrennte h1-/h2-Konfigurationen und dispatcht nach ausgehandeltem Protokoll. Der
/// TLS-Pfad bietet per ALPN `["h2", "http/1.1"]` an, und h2 ist über „prior knowledge"
/// (h2c) auch im Klartext erreichbar — eine reine h1-Konfiguration ließe also ausgerechnet
/// moderne Clients ungeschützt. Weil HTTP/2 kein `header_read_timeout` kennt, tritt dort die
/// PING-basierte Keep-Alive-Prüfung an seine Stelle; `.http2()` braucht dafür einen
/// **eigenen** Timer.
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

/// Die Verbindungsfristen, gebündelt — damit Tests sie auf Millisekunden stellen können und
/// die Wirkung dadurch überhaupt beobachtbar wird.
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

/// Verbindungs-IO, das sein Semaphore-Permit für die eigene Lebensdauer festhält.
///
/// Delegiert alles ans innere IO; `Unpin` beim inneren Typ macht `pin_project` überflüssig.
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

    /// Startet einen echten Server mit voller Konfiguration und liefert seine Adresse.
    ///
    /// Bewusst ein ECHTER Listener statt `oneshot`: die Timer-Falle schlägt erst beim
    /// Verbindungsaufbau zu (`serve_connection`), nicht beim Bauen des Routers.
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

    /// Der Kern-Regressionstest gegen die Timer-Falle: ohne `.timer()` paniked hyper in der
    /// Verbindungs-Task, sobald `header_read_timeout` gesetzt ist — der Request bekäme nie
    /// eine Antwort. Nur eine ECHTE Verbindung deckt das auf.
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

    /// HTTP/2 im Klartext („prior knowledge", h2c) — der Weg, auf dem ein Client die
    /// h1-Konfiguration umgeht. Der Test beweist, dass der h2-Zweig konfiguriert ist und
    /// bedient wird: fehlt `.http2().timer(..)`, paniked hyper beim Setzen der
    /// Keep-Alive-Frist in der Verbindungs-Task und es kommt nie eine Antwort.
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

    /// Der eigentliche h2-Schutz: HTTP/2 kennt kein `header_read_timeout`, die Abwehr hängt an
    /// der PING-basierten Keep-Alive-Prüfung. Ein Client, der die Verbindung offen hält und auf
    /// PINGs nicht antwortet, muss abgeräumt werden — sonst bindet er seinen Verbindungsplatz
    /// beliebig lange, genau der Slow-Loris-Fall auf h2.
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

    /// Slow-Loris in klein: Verbindung offen halten, Header nie abschließen. Der Server muss
    /// sie nach der Frist von sich aus abräumen.
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

    /// Ohne Rückgabe des Permits liefe der Server nach MAX_VERBINDUNGEN Anfragen dauerhaft
    /// zu — jede geschlossene Verbindung muss ihren Platz zurückgeben.
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
}
