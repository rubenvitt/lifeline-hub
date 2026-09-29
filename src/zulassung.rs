//! Zulassungssteuerung für eingehende Requests (LFH-226).
//!
//! * **Zeitbudget** — jeder Request bekommt eine obere Zeitschranke ([`REQUEST_BUDGET`]).
//! * **Gleichzeitigkeit** — es laufen höchstens [`MAX_GLEICHZEITIGE_REQUESTS`] Requests; der
//!   überzählige wird **sofort abgewiesen, nicht gestaut** (Lastabwurf).
//!
//! Beide antworten über [`AppError`](crate::error::AppError) mit dem `{error}`-Envelope.
//!
//! ## Warum eine eigene Middleware statt `TimeoutLayer` + `GlobalConcurrencyLimitLayer`
//!
//! Der Router ist eine flache Kette ohne `merge`/`nest`; ein äußerer tower-Layer wäre nicht
//! selektiv abschaltbar. Die Ausnahme wird deshalb zur Laufzeit anhand der [`MatchedPath`]
//! entschieden. Außerdem wartet `tower`s `ConcurrencyLimit` auf ein Permit, statt abzuweisen;
//! hier gibt `try_acquire_owned()` sofort 503.
//!
//! ## Warum die Ausnahmeliste methoden-genau ist
//!
//! Zwei Ausnahmen teilen ihren Pfad mit einer kurzen Operation im selben `MethodRouter`
//! (`GET /…/anhaenge/{aid}` mit `DELETE`, `POST /…/hintergrundbilder` mit `GET`). Eine
//! pfadbasierte Liste befreite die kurzen Operationen mit.
//!
//! ## Warum die Ausnahmen auch vom Cap befreit sind
//!
//! SSE-Streams, Uploads und BLOB-Downloads halten ihren Slot über die ganze Dauer; ein
//! routerweiter Cap würde von ihnen aufgezehrt (s. `src/app.rs`). Sie behalten stattdessen ihre
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

/// Zeitbudget für einen geregelten Request. Großzügig: Routen mit ausgehendem HTTP-Aufruf
/// tragen deutlich kürzere eigene Client-Timeouts (Karten-Proxy 30 s, karten-service 10 s, OIDC
/// 15 s, Fachebenen 8 s, Geocoding 1,5 s) und feuern immer zuerst. Diese Schranke ist das
/// Sicherheitsnetz gegen den hängenden Handler.
pub const REQUEST_BUDGET: Duration = Duration::from_secs(60);

/// Obergrenze gleichzeitig laufender geregelter Requests. Im Normalbetrieb greift sie nie; sie
/// ist Lastabwurf gegen Missbrauch und Stau. Die langlebigen Routen zählen nicht mit, sonst
/// verbrauchten schon die Live-Verbindungen den Cap.
pub const MAX_GLEICHZEITIGE_REQUESTS: usize = 256;

/// Routen ohne Zulassungssteuerung, als `(Methode, MatchedPath)`.
///
/// Kriterium ist ausschließlich die **Transferdauer**: die Route hält den Request legitim lange
/// offen (Streaming, große Blobs, unbeschränkte Serialisierung). Eine Route, die nur langsam
/// sein könnte, gehört nicht hierher. Gegen tote Einträge wacht `tests/zulassung_guard.rs`.
pub const OHNE_ZULASSUNGSGRENZE: &[(&str, &str)] = &[
    // SSE-Dauerverbindung: jede Zeitschranke kappte sie, und jede offene Verbindung bände einen
    // Cap-Slot.
    ("GET", "/api/einsaetze/{id}/live"),
    // Admin-Download der gesamten DB: VACUUM INTO + 64-KiB-Chunk-Stream. Dauer skaliert mit
    // DB-Größe und Leitung des Clients.
    ("GET", "/api/backup"),
    // Multipart-Upload bis 26 MiB, plus clamd-INSTREAM-Scan im Request (Default 30 s).
    ("POST", "/api/einsaetze/{id}/anhaenge"),
    // Voll-BLOB-Read bis 25 MiB. NUR GET — das DELETE im selben MethodRouter ist ein reiner
    // DB-Delete und bleibt geregelt.
    ("GET", "/api/einsaetze/{id}/anhaenge/{aid}"),
    // Dokumentenablage: Multipart bis 26 MiB + clamd-Scan; Voll-BLOB-Download. Nur POST bzw. GET —
    // die Liste und das DELETE bleiben geregelt.
    ("POST", "/api/einsaetze/{id}/dokumente"),
    ("GET", "/api/einsaetze/{id}/dokumente/{did}/datei"),
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

/// Konfiguration der Zulassungssteuerung, als State an der Middleware, damit Tests enge Grenzen
/// setzen können.
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

/// Ob die Route ausgenommen ist. `pfad` ist die [`MatchedPath`] (Muster mit Platzhaltern), damit
/// die Liste gegen wechselnde IDs stabil bleibt.
pub fn ist_ausgenommen(methode: &Method, pfad: &str) -> bool {
    OHNE_ZULASSUNGSGRENZE
        .iter()
        .any(|(m, p)| *p == pfad && *m == methode.as_str())
}

/// Middleware: Zeitbudget und Gleichzeitigkeits-Cap für alle nicht ausgenommenen Routen. Ohne
/// [`MatchedPath`] (Fallback, unbekannte Pfade) gilt die Regelung ebenfalls.
pub async fn zulassung(State(cfg): State<Zulassung>, req: Request, next: Next) -> Response {
    let ausgenommen = req
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|treffer| ist_ausgenommen(req.method(), treffer.as_str()));

    if ausgenommen {
        return next.run(req).await;
    }

    // Lastabwurf: `try_acquire_owned` wartet nicht. Ein stauender Limiter hielte die Verbindungen
    // genau dann fest, wenn ohnehin zu viele offen sind.
    let Ok(_platz) = cfg.plaetze.clone().try_acquire_owned() else {
        tracing::warn!(
            "Zulassungsgrenze erreicht ({} gleichzeitige Requests), Anfrage abgewiesen (503)",
            MAX_GLEICHZEITIGE_REQUESTS
        );
        return AppError::ServiceUnavailable(UEBERLASTET.to_string()).into_response();
    };

    // `_platz` lebt bis zum Ende der Funktion und wird auch beim Timeout frei.
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

/// Wortgleich mit der Überlast-Meldung aus [`AppError`](crate::error::AppError): derselbe
/// Zustand soll dem Client nicht in zwei Formulierungen begegnen.
const UEBERLASTET: &str = "Dienst vorübergehend ausgelastet — bitte erneut versuchen.";

/// Eigene Meldung, weil die Ursache eine andere ist: diese eine Anfrage hat zu lange gebraucht.
/// Ein Retry hilft hier meist nicht.
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

    /// Der überzählige Request wird SOFORT abgewiesen, nicht gestaut (anders als `tower`s
    /// `ConcurrencyLimit`).
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

    /// Ausgenommene Routen verbrauchen den Cap nicht, sonst hungerten wenige SSE-Verbindungen den
    /// Server aus.
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

    /// Der Platz wird nach dem Request frei, sonst liefe der Server dauerhaft auf 503.
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

    /// Die zwei Pfade mit geteiltem `MethodRouter` sind nur in der langen Richtung befreit.
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

    /// Der Fallback trägt keine `MatchedPath`; für ihn entscheidet die Vorzeichenlogik der
    /// Bedingung. Ein Umschlagen von `is_some_and` auf `is_none_or` befreite die ganze
    /// Fallback-Fläche still — deshalb echter Verkehr durch den Fallback.
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
