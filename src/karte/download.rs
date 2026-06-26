//! Offline-Karten-Download (LFH-181): SSRF-Guard, dedizierter HTTP-Client und der
//! Streaming-Download-Core. Bewusst getrennt vom Endpunkt — der Guard (`validiere_download_url`)
//! blockt interne Ziele, der Core (`lade_datei`) ist dagegen gegen einen lokalen
//! Loopback-Fixture testbar (er validiert NICHT selbst).

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use reqwest::Url;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

/// Transienter Download-Fortschritt — lebt rein in-memory im `AppState` (keine DB-Spalte).
/// `gesamt = 0` heißt „Gesamtgröße unbekannt" (keine Content-Length).
#[derive(Debug, Default)]
pub struct Fortschritt {
    pub geladen: AtomicU64,
    pub gesamt: AtomicU64,
    pub abbruch: AtomicBool,
}

/// Karte-`id` → Fortschritt. Nach `fachebenen.inflight`-Muster (`Arc<RwLock<HashMap>>`).
pub type FortschrittMap = Arc<RwLock<HashMap<i64, Arc<Fortschritt>>>>;

/// Leere Fortschritt-Map für den `AppState`.
pub fn neue_fortschritt_map() -> FortschrittMap {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Ergebnis eines erfolgreichen Downloads.
#[derive(Debug)]
pub struct DownloadErgebnis {
    pub groesse: i64,
    pub sha256: String,
}

/// Fehlerursachen des Download-Core (der Handler mappt sie auf `AppError`/FSM-Status).
#[derive(Debug)]
pub enum DownloadFehler {
    /// Abgebrochen (Admin hat den Abbruch ausgelöst) — Teil-Datei ist zu löschen.
    Abgebrochen,
    /// Upstream antwortete mit einem Nicht-Erfolgs-Status.
    Status(u16),
    /// Netzwerk-/Reqwest-Fehler.
    Http(String),
    /// Lokaler I/O-Fehler beim Schreiben der Datei.
    Io(String),
}

impl std::fmt::Display for DownloadFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DownloadFehler::Abgebrochen => write!(f, "Download abgebrochen"),
            DownloadFehler::Status(c) => write!(f, "Quelle antwortete mit HTTP {c}"),
            DownloadFehler::Http(e) => write!(f, "Netzwerkfehler: {e}"),
            DownloadFehler::Io(e) => write!(f, "Schreibfehler: {e}"),
        }
    }
}

/// True, wenn eine IP in einem internen/nicht-routbaren Bereich liegt (SSRF-Schutz).
fn ip_ist_intern(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0 // 0.0.0.0/8 „this network"
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 0x40) // 100.64/10 CGNAT
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|m| ip_ist_intern(&IpAddr::V4(m)))
        }
    }
}

/// Prüft eine (auch per Redirect erreichte) URL auf SSRF-Sicherheit: nur `https`, kein
/// `localhost`, keine internen IP-Literale. Domains, die per DNS auf interne IPs zeigen,
/// werden hier (Admin-only, v1) bewusst nicht aufgelöst — Defense-in-Depth, kein Vollschutz.
pub fn url_ist_sicher(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err(format!("nur https erlaubt (war '{}')", url.scheme()));
    }
    let host = url.host_str().ok_or_else(|| "URL ohne Host".to_string())?;
    if host.eq_ignore_ascii_case("localhost") || host.eq_ignore_ascii_case("localhost.localdomain")
    {
        return Err("localhost ist nicht erlaubt".into());
    }
    // host_str() liefert IPv6 in Klammern ([::1]) — vor dem Parsen entfernen.
    let host_clean = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host_clean.parse::<IpAddr>() {
        if ip_ist_intern(&ip) {
            return Err(format!("interne/nicht-routbare Adresse {ip} ist nicht erlaubt"));
        }
    }
    Ok(())
}

/// Validiert eine vom Admin angegebene Download-URL und gibt die geparste `Url` zurück.
pub fn validiere_download_url(roh: &str) -> Result<Url, String> {
    let url = Url::parse(roh.trim()).map_err(|e| format!("ungültige URL: {e}"))?;
    url_ist_sicher(&url)?;
    Ok(url)
}

/// Dedizierter Download-Client: connect-Timeout (gegen tote Hosts), aber KEIN Globaltimeout
/// (sonst würde ein gesunder, langsamer Mehrhundert-MB-Download gekillt). Redirects werden
/// gefolgt, aber JEDER Hop wird neu auf SSRF geprüft (N.O.M.A.D. redirectet github.com →
/// release-assets.githubusercontent.com).
pub fn download_client() -> reqwest::Client {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error(std::io::Error::other("zu viele Redirects"));
        }
        match url_ist_sicher(attempt.url()) {
            Ok(()) => attempt.follow(),
            Err(grund) => attempt.error(std::io::Error::other(grund)),
        }
    });
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent("LifelineHub-Kartendownload/1.0 (+https://github.com/)")
        .redirect(policy)
        .build()
        .expect("Download-Client baubar")
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Lädt `url` chunked nach `ziel_part`, rechnet inkrementell sha256 mit und meldet Fortschritt.
/// Prüft vor jedem Chunk `fortschritt.abbruch`. KEIN Range-Resume (v1: einmaliger Prep-Download).
/// Validiert die URL NICHT selbst — der Aufruf-Pfad (Endpunkt) hat sie bereits geprüft, der
/// Redirect-Client prüft jeden Hop. Die Teil-Datei aufzuräumen ist Sache des Aufrufers.
pub async fn lade_datei(
    client: &reqwest::Client,
    url: Url,
    ziel_part: &Path,
    fortschritt: &Fortschritt,
) -> Result<DownloadErgebnis, DownloadFehler> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| DownloadFehler::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(DownloadFehler::Status(resp.status().as_u16()));
    }
    if let Some(len) = resp.content_length() {
        fortschritt.gesamt.store(len, Ordering::Relaxed);
    }

    let mut datei = tokio::fs::File::create(ziel_part)
        .await
        .map_err(|e| DownloadFehler::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut geladen: u64 = 0;
    let mut resp = resp;

    loop {
        if fortschritt.abbruch.load(Ordering::Relaxed) {
            return Err(DownloadFehler::Abgebrochen);
        }
        let chunk = match resp.chunk().await.map_err(|e| DownloadFehler::Http(e.to_string()))? {
            Some(c) => c,
            None => break,
        };
        hasher.update(&chunk);
        datei
            .write_all(&chunk)
            .await
            .map_err(|e| DownloadFehler::Io(e.to_string()))?;
        geladen += chunk.len() as u64;
        fortschritt.geladen.store(geladen, Ordering::Relaxed);
    }

    datei
        .flush()
        .await
        .map_err(|e| DownloadFehler::Io(e.to_string()))?;
    datei
        .sync_all()
        .await
        .map_err(|e| DownloadFehler::Io(e.to_string()))?;

    Ok(DownloadErgebnis {
        groesse: geladen as i64,
        sha256: hex(&hasher.finalize()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validiere_url_lehnt_unsichere_ziele_ab() {
        // http verboten.
        assert!(validiere_download_url("http://example.com/a.pmtiles").is_err());
        // Loopback + interne Bereiche.
        assert!(validiere_download_url("https://127.0.0.1/a.pmtiles").is_err());
        assert!(validiere_download_url("https://localhost/a.pmtiles").is_err());
        assert!(validiere_download_url("https://169.254.169.254/latest/meta").is_err());
        assert!(validiere_download_url("https://10.0.0.5/a.pmtiles").is_err());
        assert!(validiere_download_url("https://192.168.1.1/a.pmtiles").is_err());
        assert!(validiere_download_url("https://172.16.0.1/a.pmtiles").is_err());
        assert!(validiere_download_url("https://[::1]/a.pmtiles").is_err());
        assert!(validiere_download_url("https://0.0.0.0/a.pmtiles").is_err());
        // Quatsch-URL.
        assert!(validiere_download_url("nicht mal eine url").is_err());
    }

    #[test]
    fn validiere_url_akzeptiert_oeffentliches_https() {
        let url = validiere_download_url(
            "https://github.com/whitespring/project-nomad-maps-europe/releases/download/v1/de_bremen_20260320.pmtiles",
        )
        .expect("öffentliches https erlaubt");
        assert_eq!(url.scheme(), "https");
        assert!(validiere_download_url("https://8.8.8.8/a.pmtiles").is_ok());
    }

    /// Kleiner Loopback-Fixture-Server, der einen festen Body unter /f.pmtiles ausliefert.
    async fn spawn_fixture(body: Vec<u8>) -> String {
        use axum::{routing::get, Router};
        let app = Router::new().route(
            "/f.pmtiles",
            get(move || {
                let b = body.clone();
                async move { b }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}/f.pmtiles", addr.port())
    }

    fn erwarteter_hash(body: &[u8]) -> String {
        hex(&Sha256::digest(body))
    }

    #[tokio::test]
    async fn lade_datei_schreibt_bytes_und_korrekten_sha256() {
        let body = b"PMTiles\x03-fixture-inhalt-fuer-den-download-test".repeat(50);
        let url_str = spawn_fixture(body.clone()).await;
        let tmp = tempfile::tempdir().unwrap();
        let ziel = tmp.path().join("karte-1.pmtiles.part");
        // Client OHNE Redirect-Policy nötig — Loopback hat keinen Redirect; download_client()
        // würde den Initial-Request NICHT blocken (Policy greift nur bei Redirects).
        let client = download_client();
        let fortschritt = Fortschritt::default();
        let url = Url::parse(&url_str).unwrap();

        let erg = lade_datei(&client, url, &ziel, &fortschritt).await.unwrap();

        assert_eq!(erg.groesse, body.len() as i64);
        assert_eq!(erg.sha256, erwarteter_hash(&body));
        assert_eq!(std::fs::read(&ziel).unwrap(), body, "Datei-Inhalt stimmt");
        assert_eq!(fortschritt.geladen.load(Ordering::Relaxed), body.len() as u64);
        assert_eq!(
            fortschritt.gesamt.load(Ordering::Relaxed),
            body.len() as u64,
            "Content-Length übernommen"
        );
    }

    #[tokio::test]
    async fn lade_datei_bricht_bei_gesetztem_abbruch_ab() {
        let body = b"x".repeat(10_000);
        let url_str = spawn_fixture(body).await;
        let tmp = tempfile::tempdir().unwrap();
        let ziel = tmp.path().join("karte-2.pmtiles.part");
        let client = download_client();
        let fortschritt = Fortschritt::default();
        fortschritt.abbruch.store(true, Ordering::Relaxed); // vor dem ersten Chunk

        let err = lade_datei(&client, Url::parse(&url_str).unwrap(), &ziel, &fortschritt)
            .await
            .unwrap_err();
        assert!(matches!(err, DownloadFehler::Abgebrochen));
    }
}
