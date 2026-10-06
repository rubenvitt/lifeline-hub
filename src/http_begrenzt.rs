//! Begrenztes Einlesen ausgehender HTTP-Antworten (LFH-923).
//!
//! `reqwest::Response::bytes()`/`json()`/`text()` lesen den Rumpf ohne Obergrenze ein, und das
//! Feature `gzip` (`Cargo.toml`) entpackt dabei selbst: wenige KB auf der Leitung werden zu
//! Hunderten MB im RAM, bevor `serde_json` sie ein weiteres Mal vervielfacht. Auf dem Pi im Feld
//! endet das im OOM-Kill des ganzen Servers. Jede fremde Antwort, die der Server ganz einliest
//! (Geocoder, Fachebenen-Quellen, OIDC), geht deshalb durch [`lies_begrenzt`] mit einem Deckel
//! je Zweck.
//!
//! Muster wie `karte::download::lade_datei`: die gemeldete Content-Length bricht vorab ab, ist
//! aber nur ein Schnellweg. Die `chunk()`-Schleife zählt die **entpackten** Bytes und bricht ab,
//! sobald der Deckel überschritten ist, auch ohne oder mit gelogener Content-Length. So endet
//! eine gzip-Bombe nach höchstens `deckel` + einem Chunk.

use serde::de::DeserializeOwned;

/// Deckel für Geocoder-Antworten (Ortsname, Ortssuche mit wenigen Treffern): einige KB im
/// Normalfall, 256 KiB lassen reichlich Luft.
pub const DECKEL_GEOCODER: usize = 256 * 1024;

/// Deckel für Fachebenen-Quellen. Die größte gemessene Antwort ist die ODL-Zeitreihe mit rund
/// 8,6 MB entpackt (`karte::quellen`, Grundpegel), der MaStR-Abzug je Seite rund 5 MB. DWD wächst
/// mit der Wetterlage und hat einen eigenen Deckel (`karte::quellen::DWD_DECKEL`).
pub const DECKEL_FACHEBENE: usize = 16 * 1024 * 1024;

/// Deckel für OIDC-Antworten (Discovery-Dokument, JWKS, Token-Antwort): wenige KB im
/// Normalfall.
pub const DECKEL_OIDC: usize = 1024 * 1024;

/// Fehler beim begrenzten Einlesen.
#[derive(Debug)]
pub enum LeseFehler {
    /// Der Rumpf ist größer als der Deckel (gemeldet oder beim Lesen gezählt).
    ZuGross { deckel: usize },
    /// Netz- oder Dekodierfehler beim Lesen des Rumpfs, ohne URL (sie kann einen Suchtext
    /// tragen, s. `geocoding::suche`).
    Http(reqwest::Error),
    /// Der Rumpf ist kein gültiges JSON des erwarteten Typs.
    Json(serde_json::Error),
}

impl std::fmt::Display for LeseFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LeseFehler::ZuGross { deckel } => {
                write!(f, "Antwort größer als {deckel} Bytes, abgebrochen")
            }
            LeseFehler::Http(e) => write!(f, "Antwort nicht lesbar: {e}"),
            LeseFehler::Json(e) => write!(f, "Antwort kein gültiges JSON: {e}"),
        }
    }
}

impl std::error::Error for LeseFehler {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LeseFehler::ZuGross { .. } => None,
            LeseFehler::Http(e) => Some(e),
            LeseFehler::Json(e) => Some(e),
        }
    }
}

/// Liest den Rumpf von `resp` bis höchstens `deckel` Bytes. Der Status wird nicht geprüft, das
/// bleibt beim Aufrufer. Ein `Vec` ohne zweite Kopie, vorab höchstens auf die gemeldete Länge
/// (und nie über den Deckel) reserviert.
pub async fn lies_begrenzt(
    mut resp: reqwest::Response,
    deckel: usize,
) -> Result<Vec<u8>, LeseFehler> {
    let gemeldet = resp.content_length();
    if gemeldet.is_some_and(|n| n > deckel as u64) {
        return Err(LeseFehler::ZuGross { deckel });
    }
    let mut rumpf = Vec::with_capacity(gemeldet.map_or(0, |n| n as usize));
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| LeseFehler::Http(e.without_url()))?
    {
        if rumpf.len() + chunk.len() > deckel {
            return Err(LeseFehler::ZuGross { deckel });
        }
        rumpf.extend_from_slice(&chunk);
    }
    Ok(rumpf)
}

/// [`lies_begrenzt`] und danach `serde_json::from_slice`.
pub async fn lies_json_begrenzt<T: DeserializeOwned>(
    resp: reqwest::Response,
    deckel: usize,
) -> Result<T, LeseFehler> {
    let rumpf = lies_begrenzt(resp, deckel).await?;
    serde_json::from_slice(&rumpf).map_err(LeseFehler::Json)
}

/// [`lies_begrenzt`] als Text; ungültiges UTF-8 wird ersetzt wie bei `Response::text()`.
pub async fn lies_text_begrenzt(
    resp: reqwest::Response,
    deckel: usize,
) -> Result<String, LeseFehler> {
    let rumpf = lies_begrenzt(resp, deckel).await?;
    Ok(match String::from_utf8(rumpf) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    })
}

/// Test-Fixtures für begrenzte Abrufe, auch für die Tests der Aufrufer (Geocoder, Fachebenen,
/// OIDC).
#[cfg(test)]
pub(crate) mod fixture {
    use axum::body::Body;
    use axum::http::header;
    use std::io::Write;

    /// `n` Bytes gzip-gepackt: Nullen packen auf rund ein Tausendstel.
    pub fn gzip_nullen(n: usize) -> Vec<u8> {
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        let block = vec![0u8; 64 * 1024];
        let mut rest = n;
        while rest > 0 {
            let teil = rest.min(block.len());
            enc.write_all(&block[..teil]).unwrap();
            rest -= teil;
        }
        enc.finish().unwrap()
    }

    /// Gültiges JSON aus `kopf`, `n` Nullen und `fuss`: ein Dokument, das ohne Deckel lesbar
    /// wäre. So unterscheidet ein Test den Deckel von einem bloßen JSON-Fehler.
    pub fn aufgeblaehtes_json(kopf: &str, n: usize, fuss: &str) -> Vec<u8> {
        let mut rumpf = Vec::with_capacity(kopf.len() + n + fuss.len());
        rumpf.extend_from_slice(kopf.as_bytes());
        rumpf.resize(kopf.len() + n, b'0');
        rumpf.extend_from_slice(fuss.as_bytes());
        rumpf
    }

    /// `rumpf` gzip-gepackt.
    pub fn gzip(rumpf: &[u8]) -> Vec<u8> {
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        enc.write_all(rumpf).unwrap();
        enc.finish().unwrap()
    }

    /// Antwort aus `rumpf` in Stücken ohne Content-Length (chunked).
    pub fn strom_aus(rumpf: Vec<u8>) -> axum::response::Response {
        let stuecke: Vec<Result<Vec<u8>, std::io::Error>> =
            rumpf.chunks(4096).map(|c| Ok(c.to_vec())).collect();
        axum::response::Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from_stream(futures::stream::iter(stuecke)))
            .unwrap()
    }

    /// Antwort aus `rumpf` als gzip-Strom mit `Content-Encoding: gzip`, gestückelt und ohne
    /// Content-Length (chunked), wie ein Dienst sie on the fly packt.
    pub fn gzip_antwort(rumpf: Vec<u8>) -> axum::response::Response {
        let stuecke: Vec<Result<Vec<u8>, std::io::Error>> =
            rumpf.chunks(4096).map(|c| Ok(c.to_vec())).collect();
        axum::response::Response::builder()
            .header(header::CONTENT_ENCODING, "gzip")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from_stream(futures::stream::iter(stuecke)))
            .unwrap()
    }

    /// Antwort aus `n` Bytes in Stücken ohne Content-Length (chunked).
    pub fn strom_antwort(n: usize) -> axum::response::Response {
        let stuecke: Vec<Result<Vec<u8>, std::io::Error>> = (0..n.div_ceil(4096))
            .map(|i| Ok(vec![b' '; 4096.min(n - i * 4096)]))
            .collect();
        axum::response::Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from_stream(futures::stream::iter(stuecke)))
            .unwrap()
    }

    /// Bedient `app` auf einem Ephemeral-Port und liefert die Basis-URL.
    pub async fn bediene(app: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });
        format!("http://{addr}")
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::*;
    use super::*;
    use axum::routing::get;

    async fn hole(url: &str) -> reqwest::Response {
        reqwest::Client::new().get(url).send().await.unwrap()
    }

    #[tokio::test]
    async fn liest_rumpf_unter_dem_deckel() {
        let basis = bediene(axum::Router::new().route(
            "/",
            get(|| async { axum::Json(serde_json::json!({"a": 1})) }),
        ))
        .await;
        let v: serde_json::Value = lies_json_begrenzt(hole(&basis).await, 1024).await.unwrap();
        assert_eq!(v, serde_json::json!({"a": 1}));
    }

    #[tokio::test]
    async fn rumpf_genau_am_deckel_geht_durch() {
        let basis =
            bediene(axum::Router::new().route("/", get(|| async { vec![b'x'; 1000] }))).await;
        let rumpf = lies_begrenzt(hole(&basis).await, 1000).await.unwrap();
        assert_eq!(rumpf.len(), 1000);
    }

    #[tokio::test]
    async fn content_length_ueber_dem_deckel_bricht_vorab_ab() {
        let basis =
            bediene(axum::Router::new().route("/", get(|| async { vec![b'x'; 2000] }))).await;
        let resp = hole(&basis).await;
        assert_eq!(
            resp.content_length(),
            Some(2000),
            "Fixture meldet die Länge"
        );
        let fehler = lies_begrenzt(resp, 1000).await.unwrap_err();
        assert!(
            matches!(fehler, LeseFehler::ZuGross { deckel: 1000 }),
            "{fehler}"
        );
    }

    #[tokio::test]
    async fn strom_ohne_content_length_bricht_am_deckel_ab() {
        let basis =
            bediene(axum::Router::new().route("/", get(|| async { strom_antwort(100_000) }))).await;
        let resp = hole(&basis).await;
        assert_eq!(resp.content_length(), None, "chunked, kein Schnellweg");
        let fehler = lies_begrenzt(resp, 10_000).await.unwrap_err();
        assert!(matches!(fehler, LeseFehler::ZuGross { .. }), "{fehler}");
    }

    /// Eine gzip-Bombe: rund 8 KB auf der Leitung, 8 MiB entpackt. Der Deckel zählt die
    /// entpackten Bytes.
    #[tokio::test]
    async fn gzip_bombe_endet_am_deckel() {
        let gepackt = gzip_nullen(8 * 1024 * 1024);
        assert!(gepackt.len() < 64 * 1024, "{} Bytes gepackt", gepackt.len());
        let basis = bediene(axum::Router::new().route(
            "/",
            get(move || {
                let g = gepackt.clone();
                async move { gzip_antwort(g) }
            }),
        ))
        .await;
        let fehler = lies_begrenzt(hole(&basis).await, DECKEL_GEOCODER)
            .await
            .unwrap_err();
        assert!(matches!(fehler, LeseFehler::ZuGross { .. }), "{fehler}");
    }

    #[tokio::test]
    async fn kein_json_ist_json_fehler() {
        let basis = bediene(axum::Router::new().route("/", get(|| async { "kein json" }))).await;
        let fehler = lies_json_begrenzt::<serde_json::Value>(hole(&basis).await, 1024)
            .await
            .unwrap_err();
        assert!(matches!(fehler, LeseFehler::Json(_)), "{fehler}");
    }

    #[tokio::test]
    async fn text_wird_gelesen() {
        let basis = bediene(axum::Router::new().route("/", get(|| async { "hallo" }))).await;
        assert_eq!(
            lies_text_begrenzt(hole(&basis).await, 1024).await.unwrap(),
            "hallo"
        );
    }
}
