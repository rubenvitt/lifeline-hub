//! Zulassungssteuerung für eingehende Requests (LFH-226/G08).
//!
//! Der Router trug bisher keine Availability-Governance: ein Request lief zeitlich unbegrenzt
//! und in unbegrenzter Zahl. Ein hängender oder teurer Handler belegte Worker und Pool-Slots,
//! bis die Ressourcen erschöpft waren — Überlast wurde nirgends abgeworfen, sie staute sich.
//!
//! Diese Schicht regelt beides an einer Stelle:
//!
//! * **Zeitbudget** — jeder Request bekommt eine obere Zeitschranke ([`REQUEST_BUDGET`]).
//! * **Gleichzeitigkeit** — es laufen höchstens [`MAX_GLEICHZEITIGE_REQUESTS`] Requests;
//!   der überzählige wird **sofort abgewiesen, nicht gestaut** (Lastabwurf).
//!
//! Beide antworten mit demselben `{error}`-Envelope wie jeder andere Fehler, weil sie über
//! [`AppError`](crate::error::AppError) laufen.
//!
//! ## Warum eine eigene Middleware statt `TimeoutLayer` + `GlobalConcurrencyLimitLayer`
//!
//! Der Router ist eine flache Kette ohne `merge`/`nest` (261 Routen) — es gibt keine
//! Sub-Router-Grenze, an der sich ein „geregelter" von einem „ausgenommenen" Teil trennen
//! ließe. Ein äußerer tower-Layer wäre nicht selektiv abschaltbar. Die Ausnahme muss deshalb
//! zur Laufzeit anhand der [`MatchedPath`] entschieden werden.
//!
//! Beim Gleichzeitigkeits-Cap kommt ein zweiter Grund dazu: `tower`s `ConcurrencyLimit`
//! liefert bei Erschöpfung `Poll::Pending` — überzählige Requests **warten** auf ein Permit,
//! statt abgewiesen zu werden. Genau das soll hier nicht passieren; deshalb ein Semaphore mit
//! `try_acquire_owned()` (sofortiges 503) statt des tower-Layers.
//!
//! ## Warum die Ausnahmeliste methoden-genau ist
//!
//! Zwei Ausnahmen teilen ihren Pfad mit einer kurzen Operation im selben `MethodRouter` —
//! `GET /…/anhaenge/{aid}` (BLOB-Read) mit dem kurzen `DELETE`, und
//! `POST /…/hintergrundbilder` (Upload) mit dem kurzen `GET` (Liste). Eine rein pfadbasierte
//! Liste würde die kurzen Operationen stillschweigend mit befreien.
//!
//! ## Warum die Ausnahmen auch vom Cap befreit sind
//!
//! `src/app.rs` hält seit LFH-258 als Grundsatz fest, dass ein router-weiter Limiter die
//! langlebigen SSE-Streams aushungern würde: eine `EventSource` je Einsatz belegt ihren Slot
//! dauerhaft. Dieselbe Logik gilt für Uploads und BLOB-Downloads — sie halten den Slot über
//! die volle Transferdauer. Sie zählen deshalb nicht gegen den Cap, sondern behalten ihre
//! eigene, engere Admission-Control (`ConcurrencyLimitLayer(16)` auf den Download-Routen).

use crate::error::AppError;
use axum::{
    extract::{MatchedPath, Request, State},
    http::Method,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

/// Zeitbudget für einen geregelten Request (LFH-226/G08).
///
/// Bewusst großzügig: die 13 Routen mit ausgehendem HTTP-Aufruf tragen ihre eigenen, deutlich
/// kürzeren Client-Timeouts (Karten-Proxy 30 s, karten-service 10 s, OIDC 15 s, Fachebenen
/// 8 s, Geocoding 1,5 s) und feuern damit immer zuerst. Diese Schranke ist das Sicherheitsnetz
/// gegen den hängenden Handler, nicht die primäre Latenz-Politik — deshalb braucht keine
/// dieser Routen eine Ausnahme.
pub const REQUEST_BUDGET: Duration = Duration::from_secs(60);

/// Obergrenze gleichzeitig laufender geregelter Requests.
///
/// Großzügig bemessen: im Normalbetrieb einer Lage soll die Grenze nie greifen — sie ist der
/// Lastabwurf gegen Missbrauch und Stau, nicht eine Durchsatz-Politik. Die langlebigen Routen
/// (SSE, Uploads, Downloads) zählen nicht mit, sonst wäre der Cap schon durch die offenen
/// Live-Verbindungen verbraucht.
pub const MAX_GLEICHZEITIGE_REQUESTS: usize = 256;

/// Routen ohne Zulassungssteuerung, als `(Methode, MatchedPath)`.
///
/// Aufnahmekriterium ist ausschließlich die **Transferdauer**: die Route hält den Request
/// legitim lange offen, weil sie streamt, große Blobs überträgt oder unbeschränkt viele
/// Datensätze serialisiert. Eine Route, die nur *langsam sein könnte*, gehört NICHT hierher —
/// sie soll abgeschnitten werden.
///
/// Gegen tote Einträge und driftende Methoden wacht `tests/zulassung_guard.rs`.
pub const OHNE_ZULASSUNGSGRENZE: &[(&str, &str)] = &[
    // SSE-Dauerverbindung. Seit LFH-227 die EINE Live-Route (vormals 9 modul-eigene
    // `/stream`-Routen) — jede Zeitschranke > 0 würde hier jede Verbindung kappen, und jede
    // offene Verbindung würde dauerhaft einen Cap-Slot binden.
    ("GET", "/api/einsaetze/{id}/live"),
    // Admin-Download der gesamten DB: VACUUM INTO + 64-KiB-Chunk-Stream. Dauer skaliert mit
    // DB-Größe und Leitung des Clients.
    ("GET", "/api/backup"),
    // Multipart-Upload bis 26 MiB, plus clamd-INSTREAM-Scan im Request (Default 30 s).
    ("POST", "/api/einsaetze/{id}/anhaenge"),
    // Voll-BLOB-Read bis 25 MiB. NUR GET — das DELETE im selben MethodRouter ist ein reiner
    // DB-Delete und bleibt geregelt.
    ("GET", "/api/einsaetze/{id}/anhaenge/{aid}"),
    // Zweiter Multipart-Upload, ebenfalls mit clamd-Scan. NUR POST — das GET auf demselben
    // Pfad ist die kurze Liste.
    ("POST", "/api/einsaetze/{id}/karte/hintergrundbilder"),
    (
        "GET",
        "/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}/download",
    ),
    // CSV-Vollexporte: laden ohne Limit und bauen im Speicher — Dauer wächst linear mit der
    // Betroffenen-/Tierzahl der Lage.
    ("GET", "/api/einsaetze/{id}/personen/export"),
    ("GET", "/api/einsaetze/{id}/tiere/export"),
];

/// Konfiguration der Zulassungssteuerung. Als State an die Middleware gehängt, damit Tests mit
/// engen Grenzen fahren können, ohne die Produktionswerte anzufassen.
#[derive(Clone)]
pub struct Zulassung {
    budget: Duration,
    plaetze: Arc<Semaphore>,
}

impl Zulassung {
    pub fn neu(budget: Duration, max_gleichzeitig: usize) -> Self {
        Self {
            budget,
            plaetze: Arc::new(Semaphore::new(max_gleichzeitig)),
        }
    }
}

impl Default for Zulassung {
    fn default() -> Self {
        Self::neu(REQUEST_BUDGET, MAX_GLEICHZEITIGE_REQUESTS)
    }
}

/// Ob die Route von der Zulassungssteuerung ausgenommen ist.
///
/// `pfad` ist die [`MatchedPath`] (das Routen-Muster mit Platzhaltern, z. B.
/// `/api/einsaetze/{id}/live`), nicht die konkrete URL — nur so bleibt die Liste gegen
/// wechselnde IDs stabil.
pub fn ist_ausgenommen(methode: &Method, pfad: &str) -> bool {
    OHNE_ZULASSUNGSGRENZE
        .iter()
        .any(|(m, p)| *p == pfad && *m == methode.as_str())
}

/// Middleware: Zeitbudget + Gleichzeitigkeits-Cap für alle nicht ausgenommenen Routen.
///
/// Ohne [`MatchedPath`] — Fallback (Static-Files/SPA) und unbekannte Pfade — gilt die
/// Regelung ebenfalls; dort gibt es nichts legitim Langlaufendes.
pub async fn zulassung(State(cfg): State<Zulassung>, req: Request, next: Next) -> Response {
    let ausgenommen = req
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|treffer| ist_ausgenommen(req.method(), treffer.as_str()));

    if ausgenommen {
        return next.run(req).await;
    }

    // Lastabwurf: `try_acquire_owned` wartet NICHT. Ist kein Platz frei, ist die Antwort
    // sofort 503 — ein stauender Limiter würde die Verbindungen genau dann festhalten, wenn
    // ohnehin zu viele offen sind.
    let Ok(_platz) = cfg.plaetze.clone().try_acquire_owned() else {
        tracing::warn!(
            "Zulassungsgrenze erreicht ({} gleichzeitige Requests), Anfrage abgewiesen (503)",
            MAX_GLEICHZEITIGE_REQUESTS
        );
        return AppError::ServiceUnavailable(UEBERLASTET.to_string()).into_response();
    };

    // `_platz` lebt bis zum Ende dieser Funktion und gibt den Platz auch dann frei, wenn der
    // Handler in den Timeout läuft.
    match tokio::time::timeout(cfg.budget, next.run(req)).await {
        Ok(antwort) => antwort,
        Err(_) => {
            tracing::warn!(
                "Zeitbudget von {:?} überschritten, Anfrage abgebrochen (503)",
                cfg.budget
            );
            AppError::ServiceUnavailable(ZEIT_UEBERSCHRITTEN.to_string()).into_response()
        }
    }
}

/// Wortgleich mit der Überlast-Meldung aus [`AppError`](crate::error::AppError) (G09/LFH-228):
/// derselbe Zustand — der Dienst kann gerade nicht mehr annehmen — soll dem Client nicht in
/// zwei Formulierungen begegnen.
const UEBERLASTET: &str = "Dienst vorübergehend ausgelastet — bitte erneut versuchen.";

/// Eigene Meldung, weil die Ursache eine andere ist: nicht „zu viele auf einmal", sondern
/// „diese eine Anfrage hat zu lange gebraucht". Ein Retry hilft hier meist nicht.
const ZEIT_UEBERSCHRITTEN: &str = "Die Anfrage hat das Zeitbudget des Servers überschritten.";

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::StatusCode, routing::get, Router};
    use tower::ServiceExt; // oneshot

    /// Kurzes Budget, damit der Test in Millisekunden statt Minuten läuft; der Handler schläft
    /// bewusst ein Vielfaches davon.
    const TEST_BUDGET: Duration = Duration::from_millis(50);
    const HANDLER_SCHLAEFT: Duration = Duration::from_millis(800);

    async fn langsam() -> &'static str {
        tokio::time::sleep(HANDLER_SCHLAEFT).await;
        "fertig"
    }

    fn router_mit(cfg: Zulassung) -> Router {
        Router::new()
            .route("/api/einsaetze/{id}/lagemeldungen", get(langsam))
            .route("/api/einsaetze/{id}/live", get(langsam))
            .layer(axum::middleware::from_fn_with_state(cfg, zulassung))
    }

    async fn status_von(router: Router, pfad: &str) -> StatusCode {
        router
            .oneshot(
                axum::http::Request::builder()
                    .uri(pfad)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
    }

    async fn anfrage(pfad: &str) -> StatusCode {
        let cfg = Zulassung::neu(TEST_BUDGET, MAX_GLEICHZEITIGE_REQUESTS);
        status_von(router_mit(cfg), pfad).await
    }

    #[tokio::test]
    async fn geregelte_route_wird_nach_dem_budget_abgeschnitten() {
        assert_eq!(
            anfrage("/api/einsaetze/7/lagemeldungen").await,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[tokio::test]
    async fn ausgenommene_route_laeuft_ueber_das_budget_hinaus() {
        assert_eq!(anfrage("/api/einsaetze/7/live").await, StatusCode::OK);
    }

    /// Kern des Lastabwurfs: der überzählige Request wird SOFORT abgewiesen, nicht gestaut.
    /// Genau hier unterscheidet sich die Middleware von `tower`s `ConcurrencyLimit`, das auf
    /// ein Permit warten würde.
    #[tokio::test]
    async fn ueberzaehliger_request_wird_abgewiesen_statt_gestaut() {
        // Ein einziger Platz, großzügiges Budget: der zweite Request kann nur am Cap scheitern.
        let cfg = Zulassung::neu(Duration::from_secs(30), 1);
        let router = router_mit(cfg);

        let belegt = tokio::spawn(status_von(router.clone(), "/api/einsaetze/7/lagemeldungen"));
        // Dem ersten Request Zeit geben, den Platz zu belegen — er schläft danach 800 ms.
        tokio::time::sleep(Duration::from_millis(100)).await;

        let zweiter = status_von(router.clone(), "/api/einsaetze/7/lagemeldungen").await;
        assert_eq!(
            zweiter,
            StatusCode::SERVICE_UNAVAILABLE,
            "zweiter Request muss sofort abgewiesen werden"
        );

        assert_eq!(belegt.await.unwrap(), StatusCode::OK, "erster läuft durch");
    }

    /// Die ausgenommenen Routen dürfen den Cap nicht verbrauchen — sonst hungern schon ein paar
    /// offene SSE-Verbindungen den ganzen Server aus.
    #[tokio::test]
    async fn ausgenommene_route_belegt_keinen_platz() {
        let cfg = Zulassung::neu(Duration::from_secs(30), 1);
        let router = router_mit(cfg);

        let stream = tokio::spawn(status_von(router.clone(), "/api/einsaetze/7/live"));
        tokio::time::sleep(Duration::from_millis(100)).await;

        assert_eq!(
            status_von(router.clone(), "/api/einsaetze/7/lagemeldungen").await,
            StatusCode::OK,
            "der einzige Platz darf von der SSE-Route nicht belegt sein"
        );
        assert_eq!(stream.await.unwrap(), StatusCode::OK);
    }

    /// Der Platz muss nach dem Request wieder frei werden — sonst läuft der Server nach
    /// MAX_GLEICHZEITIGE_REQUESTS Anfragen dauerhaft auf 503.
    #[tokio::test]
    async fn platz_wird_nach_dem_request_wieder_frei() {
        let cfg = Zulassung::neu(Duration::from_secs(30), 1);
        let router = router_mit(cfg);

        for durchgang in 1..=3 {
            assert_eq!(
                status_von(router.clone(), "/api/einsaetze/7/lagemeldungen").await,
                StatusCode::OK,
                "Durchgang {durchgang} muss durchlaufen"
            );
        }
    }

    /// Die zwei Pfade, die sich einen `MethodRouter` mit einer kurzen Operation teilen, dürfen
    /// NUR in der langen Richtung befreit sein.
    #[test]
    fn ausnahme_trifft_methoden_genau() {
        let anhang = "/api/einsaetze/{id}/anhaenge/{aid}";
        assert!(ist_ausgenommen(&Method::GET, anhang), "BLOB-Read frei");
        assert!(
            !ist_ausgenommen(&Method::DELETE, anhang),
            "DELETE auf demselben MethodRouter bleibt geregelt"
        );

        let bild = "/api/einsaetze/{id}/karte/hintergrundbilder";
        assert!(ist_ausgenommen(&Method::POST, bild), "Upload frei");
        assert!(
            !ist_ausgenommen(&Method::GET, bild),
            "Liste auf demselben Pfad bleibt geregelt"
        );
    }

    /// Ohne `MatchedPath` (Fallback/Static-Files, 404) gilt die Regelung — dort gibt es nichts
    /// legitim Langlaufendes.
    #[test]
    fn unbekannter_pfad_ist_nicht_ausgenommen() {
        assert!(!ist_ausgenommen(&Method::GET, "/api/gibt/es/nicht"));
    }

    /// Der Fallback (SPA/Static-Files) trägt KEINE `MatchedPath` — für ihn entscheidet die
    /// Vorzeichenlogik der Bedingung, nicht die Liste. Ein Umschlagen von `is_some_and` auf
    /// `is_none_or` würde die gesamte Fallback-Fläche still von Zeitbudget und Cap befreien,
    /// ohne dass ein Listen-Test das merkt. Dieser Test schickt deshalb echten Verkehr durch
    /// den Fallback.
    #[tokio::test]
    async fn fallback_ohne_matched_path_bleibt_geregelt() {
        let router = Router::new()
            .route("/api/einsaetze/{id}/live", get(langsam))
            .fallback(langsam)
            .layer(axum::middleware::from_fn_with_state(
                Zulassung::neu(TEST_BUDGET, MAX_GLEICHZEITIGE_REQUESTS),
                zulassung,
            ));

        assert_eq!(
            status_von(router, "/ein/pfad/den/es/nicht/gibt").await,
            StatusCode::SERVICE_UNAVAILABLE,
            "der Fallback muss unter der Zulassungssteuerung bleiben"
        );
    }
}
