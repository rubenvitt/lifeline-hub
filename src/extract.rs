//! Querschnittliche Extraktoren, die den `{error}`-JSON-Vertrag einhalten (LFH-267).
//!
//! axums Extractor-Rejections antworten mit `text/plain`; das Frontend liest die Meldung aber
//! aus dem JSON-Body (`frontend/src/api/client.ts`) und zeigte sonst nur „Serverfehler
//! (status)“. [`JsonBody`] delegiert deshalb an `axum::Json` und ersetzt nur die Rejection.

use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{ConnectInfo, FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::HeaderMap;
use ipnet::IpNet;
use serde::de::DeserializeOwned;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};
use std::sync::OnceLock;

use crate::error::AppError;

/// Quell-IP des Aufrufers, sofern ermittelbar.
///
/// `ConnectInfo<SocketAddr>` direkt ginge nicht: die Extension fehlt in jedem Router-Test
/// (`oneshot`), der Handler antwortete dort mit 500; `Option<ConnectInfo<_>>` ist in axum 0.8
/// kein Extractor mehr. Dieser Extractor ist infallible und liefert `None`, wenn die Adresse
/// unbekannt ist.
///
/// `X-Forwarded-For` zählt nur, wenn die Gegenstelle ein vertrauenswürdiger Proxy ist
/// ([`init_vertraute_proxys`], LFH-604); sonst ist der Header frei fälschbar, und ein
/// fälschbares Rate-Limit ist keins. Ohne Proxy-Liste gilt immer die Gegenstelle.
#[derive(Debug, Clone, Copy)]
pub struct PeerIp(pub Option<IpAddr>);

impl<S: Send + Sync> FromRequestParts<S> for PeerIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let vertraut = VERTRAUTE_PROXYS.get().map(Vec::as_slice).unwrap_or(&[]);
        Ok(PeerIp(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(adresse)| client_ip(adresse.ip(), &parts.headers, vertraut)),
        ))
    }
}

/// Netze der vertrauenswürdigen Reverse-Proxys (`--trusted-proxies`). Prozessweit statt in
/// `AppState`, damit die Test-Konstruktionen unberührt bleiben; ungesetzt heißt: keinem Proxy
/// trauen.
static VERTRAUTE_PROXYS: OnceLock<Vec<IpNet>> = OnceLock::new();

/// Setzt die Proxy-Liste einmal beim Serverstart. Weitere Aufrufe bleiben wirkungslos.
pub fn init_vertraute_proxys(netze: Vec<IpNet>) {
    let _ = VERTRAUTE_PROXYS.set(netze);
}

/// Client-Adresse hinter vertrauenswürdigen Proxys (LFH-604).
///
/// Liegt die Gegenstelle nicht in `vertraut`, gilt sie selbst. Sonst wird `X-Forwarded-For`
/// von rechts gelesen: jeder Proxy hängt die Adresse an, von der er die Anfrage bekam, und der
/// erste Eintrag außerhalb von `vertraut` ist der Client. Was links davon steht, hat der Client
/// selbst geschrieben und zählt nicht. Ein unlesbarer Eintrag beendet die Suche bei der letzten
/// bekannten Stufe; besteht die Kette nur aus Vertrauenswürdigem, gilt deren linkester Eintrag.
///
/// IPv4-gemappte IPv6-Adressen (`::ffff:a.b.c.d`, Dual-Stack-Socket) zählen als IPv4, damit
/// eine IPv4-Liste auch dort greift und die Sperre je Client nur einen Schlüssel kennt.
pub fn client_ip(gegenstelle: IpAddr, headers: &HeaderMap, vertraut: &[IpNet]) -> IpAddr {
    let ist_vertraut = |ip: &IpAddr| vertraut.iter().any(|netz| netz.contains(ip));
    let mut stufe = gegenstelle.to_canonical();
    if !ist_vertraut(&stufe) {
        return stufe;
    }
    // Mehrere Headerzeilen gelten als eine Liste in ihrer Reihenfolge (RFC 9110, 5.3). Eine
    // nicht als Text lesbare Zeile wird ein unlesbarer Eintrag.
    let eintraege: Vec<&str> = headers
        .get_all(X_FORWARDED_FOR)
        .iter()
        .flat_map(|zeile| zeile.to_str().unwrap_or("").split(','))
        .collect();
    for eintrag in eintraege.into_iter().rev() {
        let Some(ip) = adresse_lesen(eintrag.trim()) else {
            return stufe;
        };
        stufe = ip.to_canonical();
        if !ist_vertraut(&stufe) {
            return stufe;
        }
    }
    stufe
}

/// Ein `X-Forwarded-For`-Eintrag: Adresse, auch mit Port (`a.b.c.d:p`, `[v6]:p`).
fn adresse_lesen(eintrag: &str) -> Option<IpAddr> {
    eintrag
        .parse::<IpAddr>()
        .or_else(|_| eintrag.parse::<SocketAddr>().map(|s| s.ip()))
        .ok()
}

const X_FORWARDED_FOR: &str = "x-forwarded-for";

/// Json-Body-Extractor mit deutschsprachiger Rejection im `{error}`-Format; deserialisiert
/// exakt wie `axum::Json`. Der distinkte Name lässt `tests/json_extractor_guard.rs` Wrapper und
/// Rohform unterscheiden.
#[derive(Debug, Clone, Copy, Default)]
pub struct JsonBody<T>(pub T);

impl<T, S> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(axum::Json(wert)) => Ok(JsonBody(wert)),
            Err(rejection) => Err(rejection_zu_app_error(rejection)),
        }
    }
}

/// Bildet eine `JsonRejection` auf einen `AppError` ab. Alle Arme landen auf 400 (formal
/// ungültig).
///
/// Bewusste Ungenauigkeit: `MissingJsonContentType` wäre HTTP-korrekt 415, `LengthLimitError`
/// 413. `AppError` trägt beide Codes nicht; der Envelope zählt hier mehr als die Code-Nuance.
fn rejection_zu_app_error(rejection: JsonRejection) -> AppError {
    match rejection {
        JsonRejection::JsonSyntaxError(_) => {
            AppError::Validation("Anfrage-Body ist kein gültiges JSON.".into())
        }
        JsonRejection::JsonDataError(e) => AppError::Validation(format!(
            "Anfrage-Body passt nicht zum erwarteten Format: {e}"
        )),
        JsonRejection::MissingJsonContentType(_) => AppError::Validation(
            "Anfrage-Body muss als 'Content-Type: application/json' gesendet werden.".into(),
        ),
        JsonRejection::BytesRejection(_) => {
            AppError::Validation("Anfrage-Body konnte nicht gelesen werden.".into())
        }
        // `JsonRejection` ist `#[non_exhaustive]`; dieser Arm fängt künftige Varianten. Nicht auf
        // 400:
        // ein unbekannter Arm soll im Log auffallen.
        andere => {
            tracing::error!("Unbehandelte JsonRejection-Variante: {andere}");
            AppError::Internal(format!("Unbehandelte Json-Rejection: {andere}"))
        }
    }
}

/// Pfad-Parameter-Extractor mit deutschsprachiger Rejection im `{error}`-Format (LFH-317);
/// deserialisiert exakt wie `axum::extract::Path`. Der distinkte Name lässt
/// `tests/path_extractor_guard.rs` Wrapper und Rohform unterscheiden und vermeidet die
/// Kollision mit `std::path::Path`.
///
/// **Status 400, nicht 404:** eine nicht parsebare Route-ID ist ein formal ungültiger
/// Eingabewert; axums Default ist ebenfalls 400, die Ersetzung ändert nur den Envelope (gepinnt:
/// `tests/karte.rs::proxy_raster_nicht_numerisches_z_ist_400`). Anders `src/einsatz/kontext.rs`,
/// das die *einsatz_id* auf 404 abbildet (Existenzfrage). Die Extraktoren sind orthogonal:
/// `EinsatzKontext` zieht die `{id}`, `PfadParam` die Sub-IDs.
#[derive(Debug, Clone, Copy, Default)]
pub struct PfadParam<T>(pub T);

impl<T, S> FromRequestParts<S> for PfadParam<T>
where
    T: DeserializeOwned + Send,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(wert)) => Ok(PfadParam(wert)),
            Err(rejection) => Err(pfad_rejection_zu_app_error(rejection)),
        }
    }
}

/// Bildet eine `PathRejection` auf einen `AppError` ab; der Deserialisierungsfehler landet auf
/// 400.
fn pfad_rejection_zu_app_error(rejection: PathRejection) -> AppError {
    match rejection {
        PathRejection::FailedToDeserializePathParams(e) => {
            AppError::Validation(format!("Ungültiger Pfad-Parameter: {e}"))
        }
        // `MissingPathParams`: der Handler verlangt mehr Segmente als die Route trägt — ein
        // Programmierfehler, der als 500 im Log auffallen soll.
        PathRejection::MissingPathParams(e) => {
            tracing::error!("MissingPathParams (Route/Handler-Mismatch): {e}");
            AppError::Internal(format!("Pfad-Parameter fehlen (Router-Fehler): {e}"))
        }
        // `PathRejection` ist `#[non_exhaustive]`; Arm für künftige Varianten.
        andere => {
            tracing::error!("Unbehandelte PathRejection-Variante: {andere}");
            AppError::Internal(format!("Unbehandelte Path-Rejection: {andere}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Request, StatusCode};
    use axum::routing::post;
    use axum::Router;
    use serde::Deserialize;
    use serde_json::Value;
    use tower::ServiceExt;

    #[derive(Debug, Deserialize, PartialEq)]
    enum Farbe {
        #[serde(rename = "rot")]
        Rot,
    }

    #[derive(Debug, Deserialize)]
    struct Probe {
        name: String,
        anzahl: i64,
        farbe: Option<Farbe>,
    }

    /// Router ohne State — kein Feld von `AppState` ist für den Extractor relevant.
    fn probe_router() -> Router {
        Router::new().route(
            "/t",
            post(|JsonBody(p): JsonBody<Probe>| async move {
                format!("{}/{}/{:?}", p.name, p.anzahl, p.farbe)
            }),
        )
    }

    async fn sende(body: &str, content_type: Option<&str>) -> (StatusCode, String) {
        let mut req = Request::builder().method("POST").uri("/t");
        if let Some(ct) = content_type {
            req = req.header(header::CONTENT_TYPE, ct);
        }
        let resp = probe_router()
            .oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    /// Der Wrapper deserialisiert identisch zu `axum::Json`; darauf ruht die Verhaltensneutralität
    /// der Ersetzung.
    #[tokio::test]
    async fn gueltiger_body_wird_unveraendert_deserialisiert() {
        let (status, body) = sende(
            r#"{"name":"Probe","anzahl":42,"farbe":"rot"}"#,
            Some("application/json"),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "Probe/42/Some(Rot)");
    }

    #[tokio::test]
    async fn kaputte_syntax_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{kaputt"#, Some("application/json")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().unwrap().contains("gültiges JSON"));
    }

    #[tokio::test]
    async fn falscher_feldtyp_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{"name":123,"anzahl":42}"#, Some("application/json")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().is_some());
    }

    /// Ein unbekannter Enum-Wert ist formal ungültig (400), nicht 422 (axum allein lieferte 422).
    #[tokio::test]
    async fn unbekannter_enum_wert_wird_400_nicht_422() {
        let (status, body) = sende(
            r#"{"name":"Probe","anzahl":1,"farbe":"tuerkis"}"#,
            Some("application/json"),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "unbekannter Enum-Wert ist 400, nicht 422"
        );
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn fehlender_content_type_wird_400_mit_envelope() {
        let (status, body) = sende(r#"{"name":"Probe","anzahl":1}"#, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(json["error"].as_str().unwrap().contains("Content-Type"));
    }

    // ── Client-IP hinter vertrauenswürdigen Proxys (LFH-604) ──

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn netze(liste: &[&str]) -> Vec<IpNet> {
        liste.iter().map(|n| n.parse().unwrap()).collect()
    }

    fn xff(werte: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for w in werte {
            headers.append("x-forwarded-for", w.parse().unwrap());
        }
        headers
    }

    #[test]
    fn ohne_proxy_liste_gilt_die_gegenstelle() {
        let ergebnis = client_ip(ip("10.9.0.2"), &xff(&["203.0.113.50"]), &[]);
        assert_eq!(
            ergebnis,
            ip("10.9.0.2"),
            "ohne Liste wird der Header nie gelesen"
        );
    }

    #[test]
    fn fremde_gegenstelle_mit_header_bleibt_die_gegenstelle() {
        let ergebnis = client_ip(
            ip("192.0.2.66"),
            &xff(&["203.0.113.50"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("192.0.2.66"));
    }

    #[test]
    fn vertrauenswuerdige_gegenstelle_liefert_den_eintrag_aus_dem_header() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["203.0.113.50"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
    }

    #[test]
    fn vertrauenswuerdige_gegenstelle_ohne_header_bleibt_die_gegenstelle() {
        let ergebnis = client_ip(ip("10.9.0.2"), &HeaderMap::new(), &netze(&["10.9.0.0/16"]));
        assert_eq!(ergebnis, ip("10.9.0.2"));
    }

    /// Von rechts gelesen: was links vom ersten nicht vertrauenswürdigen Eintrag steht, hat der
    /// Client selbst geschrieben und ist frei erfunden.
    #[test]
    fn vom_client_vorangestellte_eintraege_werden_uebergangen() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["1.1.1.1, 198.51.100.9, 203.0.113.50"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
    }

    #[test]
    fn mehrere_vertrauenswuerdige_stufen_werden_uebersprungen() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["198.51.100.9, 203.0.113.50, 172.20.0.4"]),
            &netze(&["10.9.0.0/16", "172.20.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
    }

    #[test]
    fn mehrere_headerzeilen_gelten_als_eine_liste_in_reihenfolge() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["198.51.100.9", "203.0.113.50"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
    }

    /// Steht nur Vertrauenswürdiges in der Kette, kam die Anfrage aus dem eigenen Netz; dann
    /// gilt der am weitesten entfernte bekannte Absender.
    #[test]
    fn nur_vertrauenswuerdige_eintraege_liefern_den_linkesten() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["10.9.0.7, 10.9.0.5"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("10.9.0.7"));
    }

    /// Ein unlesbarer Eintrag beendet die Suche: links davon ist nichts mehr belastbar. Es gilt
    /// die letzte bekannte Stufe.
    #[test]
    fn unlesbarer_eintrag_beendet_die_suche_bei_der_letzten_stufe() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["203.0.113.50, unbekannt, 10.9.0.5"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("10.9.0.5"));
    }

    #[test]
    fn eintraege_mit_port_werden_gelesen() {
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["203.0.113.50:51234"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
        let ergebnis = client_ip(
            ip("10.9.0.2"),
            &xff(&["[2001:db8::5]:51234"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("2001:db8::5"));
    }

    /// Ein Dual-Stack-Socket meldet IPv4-Gegenstellen als `::ffff:a.b.c.d`; die Liste nennt sie
    /// als IPv4-Netz und muss trotzdem greifen.
    #[test]
    fn ipv4_gemappte_adressen_werden_wie_ipv4_behandelt() {
        let ergebnis = client_ip(
            ip("::ffff:10.9.0.2"),
            &xff(&["::ffff:203.0.113.50"]),
            &netze(&["10.9.0.0/16"]),
        );
        assert_eq!(ergebnis, ip("203.0.113.50"));
    }

    #[test]
    fn ipv6_proxy_netz_greift() {
        let ergebnis = client_ip(
            ip("fd00::2"),
            &xff(&["2001:db8::7"]),
            &netze(&["fd00::/64"]),
        );
        assert_eq!(ergebnis, ip("2001:db8::7"));
    }

    /// In diesem Test-Binary setzt niemand die Proxy-Liste; der Extractor liest den Header
    /// dann nicht (Default wie vor LFH-604).
    #[tokio::test]
    async fn extractor_ohne_einstellung_ignoriert_den_header() {
        let app = Router::new().route(
            "/ip",
            axum::routing::get(|PeerIp(ip): PeerIp| async move { format!("{ip:?}") }),
        );
        let mut req = Request::builder()
            .uri("/ip")
            .header("x-forwarded-for", "203.0.113.50")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut()
            .insert(ConnectInfo::<SocketAddr>("10.9.0.2:41000".parse().unwrap()));
        let resp = app.oneshot(req).await.unwrap();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(String::from_utf8_lossy(&bytes), "Some(10.9.0.2)");
    }

    // ── PfadParam ──

    fn pfad_router() -> Router {
        Router::new().route(
            "/t/{a}/{b}",
            axum::routing::get(|PfadParam((a, b)): PfadParam<(i64, String)>| async move {
                format!("{a}/{b}")
            }),
        )
    }

    async fn hole(uri: &str) -> (StatusCode, String) {
        let resp = pfad_router()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    /// Der Wrapper extrahiert identisch zu `axum::extract::Path`.
    #[tokio::test]
    async fn pfad_gueltig_wird_unveraendert_extrahiert() {
        let (status, body) = hole("/t/42/hallo").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "42/hallo");
    }

    /// Eine nicht-numerische Route-ID liefert 400 im `{error}`-Envelope statt `text/plain`.
    #[tokio::test]
    async fn pfad_nicht_numerisch_wird_400_mit_envelope() {
        let (status, body) = hole("/t/abc/hallo").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_str(&body).expect("Body ist JSON");
        assert!(
            json["error"].as_str().unwrap().contains("Pfad-Parameter"),
            "deutsche Envelope-Meldung erwartet, war: {json}"
        );
    }
}
