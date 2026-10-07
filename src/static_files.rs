use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::Response;
use rust_embed::Embed;
use sha2::{Digest, Sha256};

/// Eingebettetes Frontend. Release-Build bettet `frontend/dist` ein,
/// Debug-Build liest zur Laufzeit vom Dateisystem.
#[derive(Embed)]
#[folder = "frontend/dist"]
struct Asset;

/// MIME-Typ anhand der Dateiendung; ein kleiner fester Satz statt zusätzlicher Dependency.
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
        // HEIC-Decoder (LFH-759): `instantiateStreaming` verlangt genau diesen Typ.
        Some("wasm") => "application/wasm",
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
/// - Vorhandenes Asset → 200 mit Content-Type und Cache-Header.
/// - Fehlendes Asset **ohne** Dateiendung → SPA-Fallback auf `index.html` (200).
/// - Fehlendes Asset **mit** Dateiendung → 404 (sonst käme index.html etwa als Bild).
/// - Auch `index.html` fehlt → 404.
///
/// `assets/` trägt hash-suffixierte Namen (Vite) → `immutable`. Alles andere (index.html,
/// Service Worker, Manifest) → `no-cache`, damit nach einem Update kein altes Frontend hängt.
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

/// Ort des HEIC-Decoders (LFH-1000): Glue und WASM von libheif (LGPL 3.0), unverändert und
/// getrennt vom App-Code. Der Vite-Build legt sie hier ab (`frontend/vite.config.ts`), der
/// Worker lädt sie zur Laufzeit (`LIBHEIF_PFAD` in `frontend/src/heic/heicDekodieren.ts`).
const LIBHEIF_PFAD: &str = "bibliotheken/libheif/";
/// Nur diese Namen nimmt das Austauschverzeichnis an; nie ein Pfad aus der Anfrage.
const LIBHEIF_DATEIEN: [&str; 2] = ["libheif.js", "libheif.wasm"];

/// Der Dateiname, wenn `pfad` eine Datei des HEIC-Decoders meint.
fn libheif_datei(pfad: &str) -> Option<&'static str> {
    let name = pfad.trim_start_matches('/').strip_prefix(LIBHEIF_PFAD)?;
    LIBHEIF_DATEIEN.into_iter().find(|d| *d == name)
}

/// Eine Datei des Decoders: aus dem Austauschverzeichnis, wenn der Betreiber sie dort ersetzt
/// hat, sonst die eingebettete. Damit lässt sich die LGPL-Bibliothek tauschen, ohne das Binary
/// neu zu bauen (`frontend/src/heic/LIESMICH.md`).
async fn libheif_lesen(
    datei: &str,
    verzeichnis: Option<&Path>,
    eingebettet: impl Fn(&str) -> Option<Vec<u8>>,
) -> Option<Vec<u8>> {
    if let Some(verzeichnis) = verzeichnis {
        match tokio::fs::read(verzeichnis.join(datei)).await {
            Ok(daten) => return Some(daten),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("HEIC-Decoder {datei} aus dem Austauschverzeichnis: {e}"),
        }
    }
    eingebettet(&format!("{LIBHEIF_PFAD}{datei}"))
}

/// Antwort für eine Datei des Decoders. Ohne Hash im Namen: `no-cache` mit ETag, damit ein
/// Austausch beim nächsten Laden ankommt und sonst ein 304 genügt.
fn libheif_antwort(datei: &str, daten: Option<Vec<u8>>, kopf: &HeaderMap) -> Response {
    let Some(daten) = daten else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap();
    };
    let hash = Sha256::digest(&daten);
    let etag = format!("\"{}\"", hex_kurz(&hash));
    let etag_wert = HeaderValue::from_str(&etag).expect("Hex ist ein gültiger Header");
    let gleich = kopf
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|t| t.trim() == etag));
    let antwort = Response::builder()
        .header(header::ETAG, etag_wert)
        .header(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if gleich {
        return antwort
            .status(StatusCode::NOT_MODIFIED)
            .body(Body::empty())
            .unwrap();
    }
    antwort
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static(content_type(datei)),
        )
        .body(Body::from(daten))
        .unwrap()
}

/// Die ersten 16 Bytes als Hex: genug für ein ETag.
fn hex_kurz(bytes: &[u8]) -> String {
    bytes[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// Axum-Fallback-Handler für die eingebetteten Frontend-Dateien. `Uri` statt `Path`, weil ein
/// Fallback kein gematchtes Routenmuster hat. `heic_decoder` ist das Austauschverzeichnis des
/// HEIC-Decoders (`--heic-decoder-verzeichnis`).
pub async fn serve(uri: Uri, kopf: HeaderMap, heic_decoder: Option<Arc<PathBuf>>) -> Response {
    // Unbekannte API-Routen fallen nicht auf index.html zurück — Clients erwarten dort JSON/404.
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
    let eingebettet = |p: &str| Asset::get(p).map(|f| f.data.into_owned());
    if let Some(datei) = libheif_datei(uri.path()) {
        let daten = libheif_lesen(
            datei,
            heic_decoder.as_deref().map(PathBuf::as_path),
            eingebettet,
        )
        .await;
        return libheif_antwort(datei, daten, &kopf);
    }
    statische_antwort(uri.path(), eingebettet)
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

    /// LFH-759: der HEIC-Decoder lädt `libheif.wasm`; ohne `application/wasm` scheitert
    /// `WebAssembly.instantiateStreaming`, und Emscripten fällt auf den langsamen Weg zurück.
    #[test]
    fn webassembly_hat_seinen_typ() {
        let get = getter(vec![("assets/libheif-abc123.wasm", b"\0asm")]);
        let resp = statische_antwort("/assets/libheif-abc123.wasm", get);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/wasm"
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

    /// LFH-1000: nur genau die zwei Dateien des Decoders, kein Unterpfad, kein Durchgriff.
    #[test]
    fn libheif_nimmt_nur_die_zwei_namen() {
        assert_eq!(
            libheif_datei("/bibliotheken/libheif/libheif.js"),
            Some("libheif.js")
        );
        assert_eq!(
            libheif_datei("/bibliotheken/libheif/libheif.wasm"),
            Some("libheif.wasm")
        );
        for pfad in [
            "/bibliotheken/libheif/",
            "/bibliotheken/libheif/LIESMICH.md",
            "/bibliotheken/libheif/../../etc/passwd",
            "/bibliotheken/libheif/x/libheif.js",
            "/assets/libheif.js",
        ] {
            assert_eq!(libheif_datei(pfad), None, "{pfad}");
        }
    }

    /// LFH-1000: das Austauschverzeichnis schlägt die eingebettete Datei; was dort fehlt, bleibt
    /// eingebettet. Ohne Verzeichnis gilt immer die eingebettete.
    #[tokio::test]
    async fn libheif_aus_dem_austauschverzeichnis() {
        let verzeichnis = tempfile::tempdir().unwrap();
        std::fs::write(verzeichnis.path().join("libheif.wasm"), b"ersetzt").unwrap();
        let eingebettet = |p: &str| Some(format!("eingebettet:{p}").into_bytes());

        let wasm = libheif_lesen("libheif.wasm", Some(verzeichnis.path()), eingebettet).await;
        assert_eq!(wasm.as_deref(), Some(&b"ersetzt"[..]));
        let glue = libheif_lesen("libheif.js", Some(verzeichnis.path()), eingebettet).await;
        assert_eq!(
            glue.as_deref(),
            Some(&b"eingebettet:bibliotheken/libheif/libheif.js"[..])
        );
        let ohne = libheif_lesen("libheif.wasm", None, eingebettet).await;
        assert_eq!(
            ohne.as_deref(),
            Some(&b"eingebettet:bibliotheken/libheif/libheif.wasm"[..])
        );
    }

    /// LFH-1000: ohne Hash im Namen revalidiert der Browser; gleicher Inhalt → 304.
    #[test]
    fn libheif_antwort_mit_etag_und_304() {
        let resp = libheif_antwort("libheif.wasm", Some(b"\0asm".to_vec()), &HeaderMap::new());
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/wasm"
        );
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-cache"
        );
        let etag = resp.headers().get(header::ETAG).unwrap().clone();

        let mut kopf = HeaderMap::new();
        kopf.insert(header::IF_NONE_MATCH, etag.clone());
        let resp = libheif_antwort("libheif.wasm", Some(b"\0asm".to_vec()), &kopf);
        assert_eq!(resp.status(), StatusCode::NOT_MODIFIED);

        let resp = libheif_antwort("libheif.wasm", Some(b"\0asm-neu".to_vec()), &kopf);
        assert_eq!(resp.status(), StatusCode::OK);
        assert_ne!(resp.headers().get(header::ETAG).unwrap(), &etag);

        let resp = libheif_antwort("libheif.js", None, &HeaderMap::new());
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    /// LFH-1000: der Fallback-Handler liefert den ersetzten Decoder aus.
    #[tokio::test]
    async fn serve_liefert_den_ersetzten_decoder() {
        use axum::body::to_bytes;
        let verzeichnis = tempfile::tempdir().unwrap();
        std::fs::write(verzeichnis.path().join("libheif.js"), b"var libheif;").unwrap();
        let uri: Uri = "/bibliotheken/libheif/libheif.js".parse().unwrap();
        let resp = serve(
            uri,
            HeaderMap::new(),
            Some(Arc::new(verzeichnis.path().to_path_buf())),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/javascript; charset=utf-8"
        );
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], b"var libheif;");
    }

    #[tokio::test]
    async fn unbekannte_api_route_faellt_nicht_auf_html_zurueck() {
        use axum::http::Uri;
        let uri: Uri = "/api/gibtsnicht".parse().unwrap();
        let resp = serve(uri, HeaderMap::new(), None).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
    }
}
