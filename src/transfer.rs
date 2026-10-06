//! Grenzen für große Transfers (LFH-938).
//!
//! Uploads und Voll-BLOB-Downloads stehen in [`crate::zulassung::OHNE_ZULASSUNGSGRENZE`]: das
//! 60-s-Budget kappte einen Upload über eine langsame Funkstrecke, und der 256er-Cap würde von
//! ihnen aufgezehrt. Damit sie nicht ungeschützt bleiben, tritt dieses Modul an deren Stelle:
//!
//! * **Upload-Grenze** — EINE Semaphore für alle Upload-Routen ([`MAX_GLEICHZEITIGE_UPLOADS`]
//!   Plätze). Ist kein Platz frei, kommt sofort 503 mit `Retry-After` (Lastabwurf wie in
//!   [`crate::zulassung`]). Jede hochgeladene Datei liegt im Handler mehrfach im Speicher; die
//!   Grenze deckelt diese Spitze unabhängig von der Zahl der Verbindungen.
//! * **Download-Grenze** — je Route [`MAX_GLEICHZEITIGE_DOWNLOADS`] Plätze, auf die gewartet
//!   wird. Der Platz reist im Response-Body ([`GebundenerBody`]) und wird erst frei, wenn der
//!   Body ganz gesendet oder verworfen ist. `tower`s `ConcurrencyLimit` gab ihn schon frei, sobald
//!   der Handler antwortete, also bevor der 25-MiB-Puffer geschrieben war.
//! * **Leerlauf-Frist** ([`LEERLAUF_FRIST`]) — ein Upload, der so lange keine Daten liefert,
//!   endet mit 408 (nicht mit dem 400 des Multipart-Extractors); ein Download, dessen Client so lange nichts abnimmt, gibt
//!   Puffer und Platz frei. Ein Transfer, der fortlaufend Daten liefert, darf beliebig lange
//!   dauern.

use crate::error::AppError;
use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use http_body::{Body as HttpBody, Frame, SizeHint};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{Instant, Sleep};

/// Body-Grenze jeder Upload-Route: etwas über der Dateigrenze von 25 MiB, für den
/// Multipart-Rahmen. `tests/zulassung_guard.rs` verlangt für jede Route mit einer Grenze über
/// 4 MiB einen Eintrag in der Ausnahmeliste und die Upload-Grenze.
pub const UPLOAD_BODY_MAX: usize = 26 * 1024 * 1024;

/// Plätze der gemeinsamen Upload-Grenze. Pi-tauglich: je Upload liegen bis zu vier Kopien der
/// Datei im Speicher (Multipart-Puffer, Prüfung, sqlx- und SQLite-Kopie beim Binden), bei vier
/// Plätzen also höchstens rund 400 MiB.
pub const MAX_GLEICHZEITIGE_UPLOADS: usize = 4;

/// Plätze je Download-Route. Ein Platz hält einen ganzen BLOB (bis 25 MiB) im Speicher, bis der
/// Client ihn abgenommen hat.
pub const MAX_GLEICHZEITIGE_DOWNLOADS: usize = 16;

/// So lange darf ein Transfer ohne Datenfluss bleiben. Großzügig: auch eine überlastete
/// Funkzelle liefert binnen einer Minute das nächste Stück.
pub const LEERLAUF_FRIST: Duration = Duration::from_secs(60);

/// Größe der Stücke, in denen ein Download geschrieben wird. Hyper fragt das nächste Stück erst
/// an, wenn sein Schreibpuffer Platz hat; so hält der Platz bis kurz vor dem Ende des Transfers.
const STUECK: usize = 64 * 1024;

/// Empfohlene Wartezeit nach einem abgewiesenen Upload.
const RETRY_AFTER_SEKUNDEN: u32 = 5;

/// Eigene Meldung, damit das Frontend nicht „Server überlastet“ sagt, wenn nur die Uploads voll
/// sind.
const UPLOADS_AUSGELASTET: &str =
    "Gerade laufen zu viele Uploads — bitte in einigen Sekunden erneut versuchen.";

/// Meldung zum 408 nach der Leerlauf-Frist.
const UPLOAD_LEERLAUF: &str =
    "Upload abgebrochen: die Verbindung lieferte zu lange keine Daten (Leerlauf).";

/// Die gemeinsame Upload-Grenze. `Clone` teilt die Semaphore: `app.rs` baut sie einmal und
/// hängt Klone an jede Upload-Route.
#[derive(Clone)]
pub struct UploadGrenze {
    plaetze: Arc<Semaphore>,
    frist: Duration,
}

impl UploadGrenze {
    pub fn neu(max_gleichzeitig: usize, frist: Duration) -> Self {
        Self {
            plaetze: Arc::new(Semaphore::new(max_gleichzeitig)),
            frist,
        }
    }
}

impl Default for UploadGrenze {
    fn default() -> Self {
        Self::neu(MAX_GLEICHZEITIGE_UPLOADS, LEERLAUF_FRIST)
    }
}

/// Middleware der Upload-Routen: holt einen Platz ohne zu warten und versieht den Request-Body
/// mit der Leerlauf-Frist. Der Platz lebt, bis der Handler geantwortet hat; die Antwort eines
/// Uploads ist klein. Ist die Frist abgelaufen, ersetzt 408 die Antwort des Handlers, der den
/// Body-Fehler sonst als 400 „ungültiger Upload“ meldete.
pub async fn upload_grenze(
    State(grenze): State<UploadGrenze>,
    req: Request,
    next: Next,
) -> Response {
    let Ok(platz) = grenze.plaetze.clone().try_acquire_owned() else {
        tracing::warn!(
            "Upload-Grenze erreicht ({} gleichzeitige Uploads), Anfrage abgewiesen (503)",
            MAX_GLEICHZEITIGE_UPLOADS
        );
        let mut antwort =
            AppError::ServiceUnavailable(UPLOADS_AUSGELASTET.to_string()).into_response();
        antwort
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from(RETRY_AFTER_SEKUNDEN));
        return antwort;
    };
    let frist = grenze.frist;
    let abgelaufen = Arc::new(AtomicBool::new(false));
    let req = req.map(|body| Body::new(LeerlaufBody::neu(body, frist, abgelaufen.clone())));
    let antwort = next.run(req).await;
    drop(platz);
    if abgelaufen.load(Ordering::Relaxed) {
        return (
            StatusCode::REQUEST_TIMEOUT,
            axum::Json(serde_json::json!({ "error": UPLOAD_LEERLAUF })),
        )
            .into_response();
    }
    antwort
}

/// Request-Body mit Leerlauf-Frist. Der Handler liest den Body aktiv, ein Timer im
/// `poll_frame` reicht deshalb: er weckt den wartenden Handler, sobald die Frist abläuft.
struct LeerlaufBody {
    inner: Body,
    frist: Duration,
    wecker: Pin<Box<Sleep>>,
    /// Meldet der Middleware, dass der Fehler aus der Frist stammt.
    abgelaufen: Arc<AtomicBool>,
}

impl LeerlaufBody {
    fn neu(inner: Body, frist: Duration, abgelaufen: Arc<AtomicBool>) -> Self {
        Self {
            inner,
            frist,
            wecker: Box::pin(tokio::time::sleep(frist)),
            abgelaufen,
        }
    }
}

impl HttpBody for LeerlaufBody {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = self.get_mut();
        match Pin::new(&mut this.inner).poll_frame(cx) {
            Poll::Ready(frame) => {
                this.wecker.as_mut().reset(Instant::now() + this.frist);
                Poll::Ready(frame)
            }
            Poll::Pending => {
                if this.wecker.as_mut().poll(cx).is_ready() {
                    tracing::warn!(
                        frist_sekunden = this.frist.as_secs(),
                        "Upload abgebrochen: der Client liefert keine Daten mehr"
                    );
                    this.abgelaufen.store(true, Ordering::Relaxed);
                    return Poll::Ready(Some(Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Upload nach Leerlauf abgebrochen",
                    )))));
                }
                Poll::Pending
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

/// Die Download-Grenze einer Route. Jede Route bekommt ihre eigene (`app.rs`), wie zuvor mit
/// `ConcurrencyLimitLayer`.
#[derive(Clone)]
pub struct DownloadGrenze {
    plaetze: Arc<Semaphore>,
    frist: Duration,
}

impl DownloadGrenze {
    pub fn neu(max_gleichzeitig: usize, frist: Duration) -> Self {
        Self {
            plaetze: Arc::new(Semaphore::new(max_gleichzeitig)),
            frist,
        }
    }
}

impl Default for DownloadGrenze {
    fn default() -> Self {
        Self::neu(MAX_GLEICHZEITIGE_DOWNLOADS, LEERLAUF_FRIST)
    }
}

/// Middleware der Download-Routen: wartet auf einen Platz und bindet ihn an den Response-Body.
/// Eine leere Antwort (304, Fehler ohne Body) gibt den Platz sofort zurück.
pub async fn download_grenze(
    State(grenze): State<DownloadGrenze>,
    req: Request,
    next: Next,
) -> Response {
    // Gewartet wird wie zuvor bei `ConcurrencyLimit`: die wartende Anfrage hält keinen Puffer,
    // und jeder belegte Platz wird spätestens nach der Leerlauf-Frist frei.
    let Ok(platz) = grenze.plaetze.clone().acquire_owned().await else {
        return AppError::ServiceUnavailable("Download-Grenze geschlossen".into()).into_response();
    };
    let antwort = next.run(req).await;
    if antwort.body().is_end_stream() {
        return antwort;
    }
    let frist = grenze.frist;
    antwort.map(|body| Body::new(GebundenerBody::neu(body, platz, frist)))
}

/// Zustand eines laufenden Downloads, geteilt zwischen Body und Leerlauf-Wächter.
enum Lauf {
    Aktiv {
        inner: Body,
        /// Rest des gerade gelesenen Frames; wird in [`STUECK`]-Kopien ausgegeben.
        rest: Bytes,
        _platz: OwnedSemaphorePermit,
    },
    Fertig,
    Abgebrochen,
}

/// Response-Body, der den Platz der Download-Grenze bis zum letzten Stück hält.
///
/// Große Frames werden in [`STUECK`]-**Kopien** ausgegeben, nicht als Slices: ein Slice hielte
/// den ganzen BLOB am Leben, solange hyper es puffert. So gehört der BLOB allein dem [`Lauf`],
/// und der Leerlauf-Wächter kann ihn freigeben, auch wenn hyper den Body nie wieder abfragt
/// (ein Client, der nicht liest, macht den Socket nie wieder schreibbar).
struct GebundenerBody {
    lauf: Arc<Mutex<Lauf>>,
    zuletzt: Arc<Mutex<Instant>>,
    waechter: tokio::task::AbortHandle,
}

impl GebundenerBody {
    fn neu(inner: Body, platz: OwnedSemaphorePermit, frist: Duration) -> Self {
        let lauf = Arc::new(Mutex::new(Lauf::Aktiv {
            inner,
            rest: Bytes::new(),
            _platz: platz,
        }));
        let zuletzt = Arc::new(Mutex::new(Instant::now()));
        let waechter = tokio::spawn(leerlauf_waechter(
            Arc::downgrade(&lauf),
            zuletzt.clone(),
            frist,
        ))
        .abort_handle();
        Self {
            lauf,
            zuletzt,
            waechter,
        }
    }
}

impl Drop for GebundenerBody {
    fn drop(&mut self) {
        self.waechter.abort();
    }
}

/// Bricht den Download ab, wenn länger als `frist` kein Stück abgenommen wurde. Hält den Lauf
/// nur schwach und endet mit ihm.
async fn leerlauf_waechter(lauf: Weak<Mutex<Lauf>>, zuletzt: Arc<Mutex<Instant>>, frist: Duration) {
    let faellig = || *zuletzt.lock().unwrap_or_else(|e| e.into_inner()) + frist;
    loop {
        tokio::time::sleep_until(faellig()).await;
        let Some(lauf) = lauf.upgrade() else {
            return;
        };
        let mut lauf = lauf.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(*lauf, Lauf::Aktiv { .. }) {
            return;
        }
        if Instant::now() >= faellig() {
            *lauf = Lauf::Abgebrochen;
            tracing::warn!(
                frist_sekunden = frist.as_secs(),
                "Download abgebrochen: der Client nimmt keine Daten mehr ab"
            );
            return;
        }
    }
}

impl HttpBody for GebundenerBody {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = self.get_mut();
        let mut lauf = this.lauf.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            let (inner, rest) = match &mut *lauf {
                Lauf::Aktiv { inner, rest, .. } => (inner, rest),
                Lauf::Fertig => return Poll::Ready(None),
                Lauf::Abgebrochen => {
                    return Poll::Ready(Some(Err(axum::Error::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Download nach Leerlauf abgebrochen",
                    )))))
                }
            };
            if !rest.is_empty() {
                let n = rest.len().min(STUECK);
                let stueck = Bytes::copy_from_slice(&rest[..n]);
                *rest = rest.slice(n..);
                *this.zuletzt.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
                return Poll::Ready(Some(Ok(Frame::data(stueck))));
            }
            match Pin::new(inner).poll_frame(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(None) => {
                    // Fertig: Puffer und Platz sofort freigeben, nicht erst mit dem Body.
                    *lauf = Lauf::Fertig;
                    return Poll::Ready(None);
                }
                Poll::Ready(Some(Err(fehler))) => {
                    *lauf = Lauf::Fertig;
                    return Poll::Ready(Some(Err(fehler)));
                }
                Poll::Ready(Some(Ok(frame))) => match frame.into_data() {
                    Ok(daten) if daten.len() > STUECK => *rest = daten,
                    Ok(daten) => {
                        *this.zuletzt.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
                        return Poll::Ready(Some(Ok(Frame::data(daten))));
                    }
                    // Trailer und andere Frames unverändert weiterreichen.
                    Err(frame) => return Poll::Ready(Some(Ok(frame))),
                },
            }
        }
    }

    fn is_end_stream(&self) -> bool {
        match &*self.lauf.lock().unwrap_or_else(|e| e.into_inner()) {
            Lauf::Aktiv { inner, rest, .. } => rest.is_empty() && inner.is_end_stream(),
            Lauf::Fertig => true,
            Lauf::Abgebrochen => false,
        }
    }

    /// Hyper setzt `Content-Length` aus diesem Hinweis, bevor das erste Stück gelesen ist.
    fn size_hint(&self) -> SizeHint {
        match &*self.lauf.lock().unwrap_or_else(|e| e.into_inner()) {
            Lauf::Aktiv { inner, rest, .. } => {
                let innen = inner.size_hint();
                let mut hinweis = SizeHint::new();
                hinweis.set_lower(innen.lower() + rest.len() as u64);
                if let Some(oben) = innen.upper() {
                    hinweis.set_upper(oben + rest.len() as u64);
                }
                hinweis
            }
            Lauf::Fertig => SizeHint::with_exact(0),
            Lauf::Abgebrochen => SizeHint::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::StatusCode,
        routing::{get, post},
        Router,
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt; // oneshot

    const KURZ: Duration = Duration::from_millis(150);

    fn anfrage(methode: &str, pfad: &str, body: Body) -> axum::http::Request<Body> {
        axum::http::Request::builder()
            .method(methode)
            .uri(pfad)
            .body(body)
            .unwrap()
    }

    /// Ein Body, der Stücke aus einem Kanal liefert und offen bleibt, solange der Sender lebt.
    fn kanal_body() -> (tokio::sync::mpsc::Sender<Bytes>, Body) {
        let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(8);
        let strom = futures::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|b| (Ok::<_, std::io::Error>(b), rx))
        });
        (tx, Body::from_stream(strom))
    }

    /// Liest den ganzen Body und meldet die Bytezahl oder den Fehler.
    async fn lesen(req: Request) -> Result<String, (StatusCode, String)> {
        req.into_body()
            .collect()
            .await
            .map(|b| b.to_bytes().len().to_string())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
    }

    fn upload_router(grenze: UploadGrenze) -> Router {
        Router::new()
            .route("/hoch", post(lesen))
            .layer(axum::middleware::from_fn_with_state(grenze, upload_grenze))
    }

    #[tokio::test(start_paused = true)]
    async fn upload_ueber_der_grenze_ist_sofort_503_mit_retry_after() {
        let router = upload_router(UploadGrenze::neu(1, Duration::from_secs(30)));
        let (_halten, body) = kanal_body();
        let erster = tokio::spawn(router.clone().oneshot(anfrage("POST", "/hoch", body)));
        tokio::time::sleep(Duration::from_millis(50)).await;

        let zweiter = router
            .clone()
            .oneshot(anfrage("POST", "/hoch", Body::from("x")))
            .await
            .unwrap();
        assert_eq!(zweiter.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            zweiter.headers().get(header::RETRY_AFTER).unwrap(),
            &RETRY_AFTER_SEKUNDEN.to_string()
        );
        erster.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn upload_platz_wird_nach_dem_handler_frei() {
        let router = upload_router(UploadGrenze::neu(1, Duration::from_secs(30)));
        for durchgang in 1..=3 {
            let antwort = router
                .clone()
                .oneshot(anfrage("POST", "/hoch", Body::from("abc")))
                .await
                .unwrap();
            assert_eq!(antwort.status(), StatusCode::OK, "Durchgang {durchgang}");
        }
    }

    /// Ein Upload, der fortlaufend liefert, läuft weit über die Frist hinaus.
    #[tokio::test(start_paused = true)]
    async fn fliessender_upload_ueberlebt_die_frist() {
        let router = upload_router(UploadGrenze::neu(1, KURZ));
        let (tx, body) = kanal_body();
        tokio::spawn(async move {
            for _ in 0..8 {
                tokio::time::sleep(KURZ / 3).await;
                tx.send(Bytes::from_static(b"0123456789")).await.unwrap();
            }
        });
        let antwort = router
            .oneshot(anfrage("POST", "/hoch", body))
            .await
            .unwrap();
        assert_eq!(antwort.status(), StatusCode::OK);
        let text = antwort.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&text[..], b"80");
    }

    /// Bleibt der Upload stumm, endet er mit 408 (der Handler sah einen Body-Fehler), und der
    /// Platz wird frei.
    #[tokio::test(start_paused = true)]
    async fn stummer_upload_endet_nach_der_frist_mit_408_und_gibt_den_platz_frei() {
        let grenze = UploadGrenze::neu(1, KURZ);
        let router = upload_router(grenze.clone());
        let (_halten, body) = kanal_body();

        let antwort = tokio::time::timeout(
            Duration::from_secs(5),
            router.clone().oneshot(anfrage("POST", "/hoch", body)),
        )
        .await
        .expect("der Leerlauf muss den Handler beenden")
        .unwrap();
        assert_eq!(antwort.status(), StatusCode::REQUEST_TIMEOUT);
        let json: serde_json::Value =
            serde_json::from_slice(&antwort.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(json["error"], UPLOAD_LEERLAUF, "{{error}}-Format");
        assert_eq!(grenze.plaetze.available_permits(), 1);
    }

    fn download_router(grenze: DownloadGrenze, groesse: usize) -> Router {
        Router::new()
            .route("/runter", get(move || async move { vec![7u8; groesse] }))
            .route(
                "/leer",
                get(|| async { StatusCode::NOT_MODIFIED.into_response() }),
            )
            .layer(axum::middleware::from_fn_with_state(
                grenze,
                download_grenze,
            ))
    }

    async fn runter(router: &Router, pfad: &str) -> Response {
        router
            .clone()
            .oneshot(anfrage("GET", pfad, Body::empty()))
            .await
            .unwrap()
    }

    /// Der Body kommt byte-gleich an, mit `Content-Length`-fähigem Größenhinweis.
    #[tokio::test(start_paused = true)]
    async fn download_liefert_alle_bytes_in_stuecken() {
        let groesse = 3 * STUECK + 17;
        let router = download_router(DownloadGrenze::neu(2, Duration::from_secs(30)), groesse);
        let antwort = runter(&router, "/runter").await;
        assert_eq!(
            antwort.body().size_hint().exact(),
            Some(groesse as u64),
            "hyper braucht die genaue Größe für Content-Length"
        );
        let mut body = antwort.into_body();
        let mut stuecke = 0;
        let mut summe = Vec::new();
        while let Some(frame) = body.frame().await {
            let daten = frame.unwrap().into_data().unwrap();
            assert!(daten.len() <= STUECK);
            summe.extend_from_slice(&daten);
            stuecke += 1;
        }
        assert_eq!(summe, vec![7u8; groesse]);
        assert_eq!(stuecke, 4);
    }

    /// Kern von L23: der Platz bleibt belegt, solange der Body nicht abgenommen ist. Mit
    /// `ConcurrencyLimit` liefe die dritte Anfrage sofort durch.
    #[tokio::test(start_paused = true)]
    async fn download_platz_haelt_bis_der_body_verworfen_ist() {
        let grenze = DownloadGrenze::neu(2, Duration::from_secs(30));
        let router = download_router(grenze.clone(), 4 * STUECK);

        let erste = runter(&router, "/runter").await;
        let zweite = runter(&router, "/runter").await;
        assert_eq!(grenze.plaetze.available_permits(), 0);

        let dritte = tokio::spawn({
            let router = router.clone();
            async move { runter(&router, "/runter").await }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !dritte.is_finished(),
            "die dritte muss auf einen Platz warten"
        );

        drop(erste);
        let dritte = tokio::time::timeout(Duration::from_secs(5), dritte)
            .await
            .expect("nach dem Verwerfen wird ein Platz frei")
            .unwrap();
        assert_eq!(dritte.status(), StatusCode::OK);
        drop((zweite, dritte));
        assert_eq!(grenze.plaetze.available_permits(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn vollstaendig_gelesener_download_gibt_den_platz_frei() {
        let grenze = DownloadGrenze::neu(1, Duration::from_secs(30));
        let router = download_router(grenze.clone(), 2 * STUECK);
        let antwort = runter(&router, "/runter").await;
        let mut body = antwort.into_body();
        while body.frame().await.is_some() {}
        assert_eq!(
            grenze.plaetze.available_permits(),
            1,
            "nach dem letzten Stück frei, nicht erst mit dem Body"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn leere_antwort_haelt_keinen_platz() {
        let grenze = DownloadGrenze::neu(1, Duration::from_secs(30));
        let router = download_router(grenze.clone(), 0);
        let antwort = runter(&router, "/leer").await;
        assert_eq!(antwort.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(grenze.plaetze.available_permits(), 1);
    }

    /// Ein Client, der nichts abnimmt, gibt Puffer und Platz nach der Frist frei, obwohl
    /// niemand den Body mehr abfragt.
    #[tokio::test(start_paused = true)]
    async fn stummer_download_gibt_nach_der_frist_den_platz_frei() {
        let grenze = DownloadGrenze::neu(1, KURZ);
        let router = download_router(grenze.clone(), 4 * STUECK);
        let antwort = runter(&router, "/runter").await;
        let mut body = antwort.into_body();
        // Ein Stück abnehmen, dann verstummen.
        body.frame().await.unwrap().unwrap();
        assert_eq!(grenze.plaetze.available_permits(), 0);

        tokio::time::sleep(KURZ * 4).await;
        assert_eq!(
            grenze.plaetze.available_permits(),
            1,
            "der Wächter muss den Platz ohne weitere Abfrage freigeben"
        );
        let fehler = body.frame().await.unwrap();
        assert!(fehler.is_err(), "danach endet der Body mit einem Fehler");
    }
}
