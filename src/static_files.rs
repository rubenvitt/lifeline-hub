use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::Response;
use rust_embed::Embed;

/// Eingebettetes Frontend. Release-Build bettet `frontend/dist` ein,
/// Debug-Build liest zur Laufzeit vom Dateisystem.
#[derive(Embed)]
#[folder = "frontend/dist"]
struct Asset;

/// MIME-Typ anhand der Dateiendung. Bewusst manuell (kleiner, deterministischer
/// Satz statt zusätzlicher Dependency).
fn content_type(pfad: &str) -> &'static str {
    match pfad.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("json") | Some("map") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// True, wenn das letzte Pfadsegment eine Dateiendung hat (enthält einen Punkt).
fn hat_dateiendung(pfad: &str) -> bool {
    pfad.rsplit('/').next().is_some_and(|seg| seg.contains('.'))
}

/// Baut die HTTP-Antwort für einen statischen Pfad.
///
/// Regeln:
/// - Vorhandenes Asset → 200 mit passendem Content-Type + Cache-Header.
/// - Fehlendes Asset **ohne** Dateiendung → SPA-Fallback auf `index.html` (200).
/// - Fehlendes Asset **mit** Dateiendung → 404 (sonst würde index.html z.B. als Bild ausgeliefert).
/// - Auch `index.html` fehlt → 404.
///
/// Cache: Dateien unter `assets/` tragen hash-suffixierte Namen (Vite) →
/// langes `immutable`-Caching. Alles andere (index.html, Service Worker, Manifest)
/// → `no-cache`, damit nach einem Binary-Update kein veraltetes Frontend hängen bleibt.
fn statische_antwort(pfad: &str, get: impl Fn(&str) -> Option<Vec<u8>>) -> Response {
    let pfad = pfad.trim_start_matches('/');
    let pfad = if pfad.is_empty() { "index.html" } else { pfad };

    if let Some(daten) = get(pfad) {
        return baue_antwort(pfad, daten);
    }

    if hat_dateiendung(pfad) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap();
    }

    // SPA-Fallback.
    match get("index.html") {
        Some(daten) => baue_antwort("index.html", daten),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Frontend nicht eingebettet"))
            .unwrap(),
    }
}

fn baue_antwort(pfad: &str, daten: Vec<u8>) -> Response {
    let cache = if pfad.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static(content_type(pfad)),
        )
        .header(header::CACHE_CONTROL, HeaderValue::from_static(cache))
        .body(Body::from(daten))
        .unwrap()
}

/// Axum-Fallback-Handler: liefert eingebettete Frontend-Dateien aus.
/// Nutzt den `Uri`-Extractor (ein Fallback hat kein gematchtes Routenmuster,
/// daher funktioniert hier kein `Path`-Extractor).
pub async fn serve(uri: Uri) -> Response {
    // Unbekannte API-Routen dürfen NICHT auf das SPA-index.html zurückfallen —
    // Clients erwarten dort JSON/404, kein HTML.
    if uri.path().starts_with("/api/") {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )
            .body(Body::from(r#"{"error":"Nicht gefunden"}"#))
            .unwrap();
    }
    statische_antwort(uri.path(), |p| Asset::get(p).map(|f| f.data.into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn getter(eintraege: Vec<(&'static str, &'static [u8])>) -> impl Fn(&str) -> Option<Vec<u8>> {
        let map: HashMap<&str, &[u8]> = eintraege.into_iter().collect();
        move |p: &str| map.get(p).map(|b| b.to_vec())
    }

    #[test]
    fn liefert_vorhandenes_asset_mit_content_type_und_cache() {
        let get = getter(vec![("assets/index-abc123.js", b"console.log(1)")]);
        let resp = statische_antwort("/assets/index-abc123.js", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn leerer_pfad_liefert_index_html_mit_no_cache() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache"
        );
    }

    #[test]
    fn root_level_sw_js_bekommt_no_cache() {
        let get = getter(vec![("sw.js", b"self.skipWaiting()")]);
        let resp = statische_antwort("/sw.js", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache"
        );
    }

    #[test]
    fn unbekannte_route_ohne_endung_faellt_auf_index_zurueck() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/einsaetze/42", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn fehlendes_asset_mit_endung_ist_404() {
        let get = getter(vec![("index.html", b"<!doctype html>")]);
        let resp = statische_antwort("/assets/fehlt.js", get);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn ohne_eingebettetes_index_html_ist_404() {
        let get = getter(vec![]);
        let resp = statische_antwort("/", get);
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unbekannte_api_route_faellt_nicht_auf_html_zurueck() {
        use axum::http::Uri;
        let uri: Uri = "/api/gibtsnicht".parse().unwrap();
        let resp = serve(uri).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
    }
}
