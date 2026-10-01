//! Offline-Karten-Download (LFH-181): SSRF-Guard, dedizierter HTTP-Client und
//! Streaming-Download-Kern. Der Guard (`validiere_download_url`) blockt interne Ziele; der Kern
//! (`lade_datei`) validiert NICHT selbst und ist so gegen einen Loopback-Fixture testbar.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use reqwest::Url;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

/// Transienter Download-Fortschritt, nur im `AppState`. `gesamt = 0` heißt „Größe unbekannt“.
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

/// Poisoning-fester Lesezugriff: eine Panik unter dem Write-Lock soll nicht jeden folgenden
/// Karten-Handler panicken lassen. `into_inner` ist sicher, weil unter dem Lock nur infallible
/// insert/remove laufen.
pub fn lies_fortschritt(
    map: &FortschrittMap,
) -> std::sync::RwLockReadGuard<'_, HashMap<i64, Arc<Fortschritt>>> {
    map.read().unwrap_or_else(|e| e.into_inner())
}

/// Poisoning-fester Schreibzugriff, s. [`lies_fortschritt`].
pub fn schreibe_fortschritt(
    map: &FortschrittMap,
) -> std::sync::RwLockWriteGuard<'_, HashMap<i64, Arc<Fortschritt>>> {
    map.write().unwrap_or_else(|e| e.into_inner())
}

/// Atomare Slot-Reservierung: `true`, wenn der Slot frei war; `false`, wenn für `id` schon ein
/// Download/Reload läuft. Check UND Insert unter EINEM Write-Lock — beim id-wiederverwendenden
/// In-Place-Reload schrieben sonst zwei parallele Requests in denselben `.part`-Pfad.
pub fn reserviere_fortschritt(map: &FortschrittMap, id: i64, f: Arc<Fortschritt>) -> bool {
    let mut m = schreibe_fortschritt(map);
    if m.contains_key(&id) {
        return false;
    }
    m.insert(id, f);
    true
}

/// Ergebnis eines erfolgreichen Downloads.
#[derive(Debug)]
pub struct DownloadErgebnis {
    pub groesse: i64,
    pub sha256: String,
}

/// Fehlerursachen des Download-Kerns (der Handler mappt sie auf `AppError`/Status).
#[derive(Debug)]
pub enum DownloadFehler {
    /// Vom Admin abgebrochen; die Teil-Datei ist zu löschen.
    Abgebrochen,
    /// Upstream antwortete mit einem Nicht-Erfolgs-Status.
    Status(u16),
    /// Netzwerk-/Reqwest-Fehler.
    Http(String),
    /// Lokaler I/O-Fehler beim Schreiben der Datei.
    Io(String),
    /// Die Datei stimmt nicht mit dem erwarteten SHA256-Pin überein (Supply-Chain).
    HashMismatch { erwartet: String, ist: String },
    /// Download überschreitet die erlaubte Maximalgröße (Content-Length oder gestreamt erkannt).
    ZuGross { grenze: u64 },
    /// Nicht genug freier Platz für die vom Server gemeldete Größe.
    KeinPlatz { frei: u64, benoetigt: u64 },
}

impl std::fmt::Display for DownloadFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DownloadFehler::Abgebrochen => write!(f, "Download abgebrochen"),
            DownloadFehler::Status(c) => write!(f, "Quelle antwortete mit HTTP {c}"),
            DownloadFehler::Http(e) => write!(f, "Netzwerkfehler: {e}"),
            DownloadFehler::Io(e) => write!(f, "Schreibfehler: {e}"),
            DownloadFehler::HashMismatch { erwartet, ist } => {
                write!(f, "SHA256 stimmt nicht: erwartet {erwartet}, war {ist}")
            }
            DownloadFehler::ZuGross { grenze } => {
                write!(
                    f,
                    "Download überschreitet die Maximalgröße von {grenze} Bytes"
                )
            }
            DownloadFehler::KeinPlatz { frei, benoetigt } => {
                write!(
                    f,
                    "Nicht genug Speicherplatz: {frei} Bytes frei, ~{benoetigt} Bytes benötigt"
                )
            }
        }
    }
}

/// True, wenn eine IP in einem internen/nicht routbaren Bereich liegt (SSRF-Schutz). Auch vom
/// pinnenden Proxy-Resolver (`karte::proxy`) genutzt.
pub(crate) fn ip_ist_intern(ip: &IpAddr) -> bool {
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
            if v6.is_loopback()
                || v6.is_unspecified()
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
                || (v6.segments()[0] & 0xffc0) == 0xfe80
            // fe80::/10 link-local
            {
                return true;
            }
            // Eingebettetes IPv4 in allen gängigen Formen prüfen; `to_ipv4_mapped` allein deckt nur
            // `::ffff:a.b.c.d`.
            let s = v6.segments();
            // IPv4-mapped (::ffff:a.b.c.d) UND IPv4-compatible (::a.b.c.d).
            if let Some(v4) = v6.to_ipv4() {
                if ip_ist_intern(&IpAddr::V4(v4)) {
                    return true;
                }
            }
            // NAT64 64:ff9b::/96 → eingebettete IPv4 in den letzten 32 Bit.
            if s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0
            {
                let v4 = std::net::Ipv4Addr::new(
                    (s[6] >> 8) as u8,
                    (s[6] & 0xff) as u8,
                    (s[7] >> 8) as u8,
                    (s[7] & 0xff) as u8,
                );
                if ip_ist_intern(&IpAddr::V4(v4)) {
                    return true;
                }
            }
            // 6to4 2002::/16 → eingebettete IPv4 in den Bits 16..48.
            if s[0] == 0x2002 {
                let v4 = std::net::Ipv4Addr::new(
                    (s[1] >> 8) as u8,
                    (s[1] & 0xff) as u8,
                    (s[2] >> 8) as u8,
                    (s[2] & 0xff) as u8,
                );
                if ip_ist_intern(&IpAddr::V4(v4)) {
                    return true;
                }
            }
            false
        }
    }
}

/// Prüft eine (auch per Redirect erreichte) URL: nur `https`, kein `localhost`, keine internen
/// IP-Literale. Domains werden hier nicht aufgelöst; DNS-Rebinding schließt der pinnende
/// Resolver des Download-Clients.
pub fn url_ist_sicher(url: &Url) -> Result<(), String> {
    url_ist_sicher_mit(url, dev_loopback_download_erlaubt())
}

/// Opt-in Dev-Escape `--download-allow-loopback` / `LIFELINE_DOWNLOAD_ALLOW_LOOPBACK`: erlaubt
/// Downloads von Loopback-Adressen (auch http). Vorgabe aus. Gelesen aus der beim Start
/// gesetzten [`crate::karte::KarteConfig`], damit eine ambient gesetzte Variable die
/// Security-Tests nicht kippen kann.
fn dev_loopback_download_erlaubt() -> bool {
    crate::karte::karte_config().download_allow_loopback
}

/// Ist der geparste Host ein Loopback (127.0.0.0/8, ::1, „localhost“)? `host_str()` hat Userinfo
/// schon aufgelöst (`localhost@evil.com` → Host evil.com).
fn host_ist_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let host_clean = host.trim_start_matches('[').trim_end_matches(']');
    matches!(host_clean.parse::<IpAddr>(), Ok(ip) if ip.is_loopback())
}

/// Testbarer Kern mit explizitem `dev_loopback` (keine Races über das Env).
fn url_ist_sicher_mit(url: &Url, dev_loopback: bool) -> Result<(), String> {
    // Dev-Escape nur für Loopback, sonst der strikte SSRF-Guard (der Pfad nimmt auch „Per
    // URL“-Eingaben).
    if dev_loopback && host_ist_loopback(url) {
        return Ok(());
    }
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
            return Err(format!(
                "interne/nicht-routbare Adresse {ip} ist nicht erlaubt"
            ));
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

/// Idle-/Read-Timeout gegen stockende Verbindungen. Setzt sich nach jedem Read zurück, beendet
/// also keinen gesunden, langsamen Großdownload — ohne ihn hinge `chunk().await` ewig, und das
/// Abbruch-Flag griffe nie.
const READ_TIMEOUT_SEKUNDEN: u64 = 60;

/// Redirect-Policy, die JEDEN Hop erneut auf SSRF-Sicherheit prüft (max. 10 Hops). Geteilt mit
/// dem Proxy-Client (`karte::proxy`).
pub fn ssrf_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error(std::io::Error::other("zu viele Redirects"));
        }
        match url_ist_sicher(attempt.url()) {
            Ok(()) => attempt.follow(),
            Err(grund) => attempt.error(std::io::Error::other(grund)),
        }
    })
}

/// Dedizierter Download-Client: Connect- und Read-Timeout, aber kein Gesamt-Timeout (sonst
/// stürbe ein langsamer Mehrhundert-MB-Download). Nutzt die SSRF-Redirect-Policy und den
/// pinnenden DNS-Resolver (`proxy::SichererResolver`): der Host wird selbst aufgelöst und über
/// `nur_public` gefiltert, es gibt kein Rebind-Fenster. `url_ist_sicher` bleibt Vorabprüfung.
pub fn download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(READ_TIMEOUT_SEKUNDEN))
        .user_agent("LifelineHub-Kartendownload/1.0 (+https://github.com/)")
        .redirect(ssrf_redirect_policy())
        .dns_resolver(std::sync::Arc::new(crate::karte::proxy::SichererResolver))
        // Byte-gleich auf die Platte: Größe, Fortschritt und sha256-Pin gelten den gelieferten
        // Bytes, nicht einem entpackten Strom (LFH-599).
        .no_gzip()
        .build()
        .expect("Download-Client baubar")
}

/// Entfernt die vom Download-Manager verwalteten Dateien einer Karte (`karte-{id}.mbtiles` und
/// `.part`-Rest), best-effort. NUR für gemanagte Downloads — extern registrierte Karten haben
/// einen admin-gelieferten Pfad und dürfen nicht angefasst werden.
pub async fn entferne_download_dateien(karten_dir: &Path, id: i64) {
    let _ = tokio::fs::remove_file(karten_dir.join(format!("karte-{id}.mbtiles"))).await;
    let _ = tokio::fs::remove_file(karten_dir.join(format!("karte-{id}.mbtiles.part"))).await;
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Harte Obergrenze je Karten-Download: Backstop gegen Platten-Erschöpfung durch eine Quelle
/// ohne Größen-Pin (z. B. „Per URL“). 64 GiB deckt auch Länder-Ausschnitte.
pub const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024 * 1024;

/// True, wenn `frei` für `groesse` plus 10 % Reserve reicht (saturierend). Eine Quelle für
/// Handler-Vorabcheck und Streaming-Kern.
pub fn genug_platz(frei: u64, groesse: u64) -> bool {
    frei >= groesse.saturating_add(groesse / 10)
}

/// Lädt `url` chunkweise nach `ziel_part`, rechnet sha256 mit und meldet Fortschritt; prüft vor
/// jedem Chunk `fortschritt.abbruch`. Kein Range-Resume. Validiert die URL NICHT selbst (das
/// tun Endpunkt und Redirect-Policy); die Teil-Datei räumt der Aufrufer.
pub async fn lade_datei(
    client: &reqwest::Client,
    url: Url,
    ziel_part: &Path,
    fortschritt: &Fortschritt,
    erwartet_sha256: Option<&str>,
    max_bytes: u64,
) -> Result<DownloadErgebnis, DownloadFehler> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| DownloadFehler::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(DownloadFehler::Status(resp.status().as_u16()));
    }
    // Vorab-Guards über die gemeldete Content-Length, VOR dem Anlegen der `.part`-Datei.
    if let Some(len) = resp.content_length() {
        fortschritt.gesamt.store(len, Ordering::Relaxed);
        if len > max_bytes {
            return Err(DownloadFehler::ZuGross { grenze: max_bytes });
        }
        if let Some(dir) = ziel_part.parent() {
            if let Ok(frei) = fs4::available_space(dir) {
                if !genug_platz(frei, len) {
                    return Err(DownloadFehler::KeinPlatz {
                        frei,
                        benoetigt: len.saturating_add(len / 10),
                    });
                }
            }
        }
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
        let chunk = match resp
            .chunk()
            .await
            .map_err(|e| DownloadFehler::Http(e.to_string()))?
        {
            Some(c) => c,
            None => break,
        };
        geladen += chunk.len() as u64;
        // Streaming-Backstop gegen fehlende oder gelogene Content-Length; geprüft vor dem
        // Schreiben.
        if geladen > max_bytes {
            return Err(DownloadFehler::ZuGross { grenze: max_bytes });
        }
        hasher.update(&chunk);
        datei
            .write_all(&chunk)
            .await
            .map_err(|e| DownloadFehler::Io(e.to_string()))?;
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

    let ist = hex(&hasher.finalize());
    if let Some(erwartet) = erwartet_sha256 {
        if !erwartet.eq_ignore_ascii_case(&ist) {
            return Err(DownloadFehler::HashMismatch {
                erwartet: erwartet.to_string(),
                ist,
            });
        }
    }
    Ok(DownloadErgebnis {
        groesse: geladen as i64,
        sha256: ist,
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

    #[test]
    fn dev_loopback_flag_erlaubt_nur_loopback() {
        let u = |s: &str| Url::parse(s).unwrap();
        // Dev-Flag AN: loopback-http (lokaler Dev-Object-Store) erlaubt.
        assert!(url_ist_sicher_mit(&u("http://127.0.0.1:9000/maps/x.mbtiles"), true).is_ok());
        assert!(url_ist_sicher_mit(&u("http://localhost:9000/maps/x.mbtiles"), true).is_ok());
        assert!(url_ist_sicher_mit(&u("http://[::1]:9000/maps/x.mbtiles"), true).is_ok());
        // Default (Flag AUS) bleibt streng: loopback-http verboten.
        assert!(url_ist_sicher_mit(&u("http://127.0.0.1:9000/maps/x.mbtiles"), false).is_err());
        // Das Flag hilft NUR Loopback — externe/private Nicht-Loopback-Ziele bleiben blockiert.
        assert!(url_ist_sicher_mit(&u("http://example.com/x.mbtiles"), true).is_err());
        assert!(url_ist_sicher_mit(&u("http://192.168.1.1/x.mbtiles"), true).is_err());
        // Kein Spoofing: echter Host ist evil.com, nicht loopback.
        assert!(url_ist_sicher_mit(&u("http://localhost@evil.com/x.mbtiles"), true).is_err());
        assert!(url_ist_sicher_mit(&u("http://127.0.0.1.evil.com/x.mbtiles"), true).is_err());
        // Öffentliches https bleibt unabhängig vom Flag erlaubt.
        assert!(url_ist_sicher_mit(&u("https://8.8.8.8/x.mbtiles"), true).is_ok());
    }

    /// `host_ist_loopback` vergleicht den Hostnamen und löst kein DNS auf; ein Name unterhalb von
    /// `.localhost` ist damit kein Loopback, obwohl RFC 6761 ihn dafür reserviert.
    ///
    /// Folge: `http://maps.web.garage.localhost:3902/<key>` fiele durch. Deshalb gibt
    /// `mise run garage` dem Bucket den globalen Alias `localhost`; ohne ihn ist der
    /// Kartendownload im Dev-Stack unbrauchbar.
    #[test]
    fn subdomain_von_localhost_ist_kein_loopback() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(
            url_ist_sicher_mit(&u("http://maps.web.garage.localhost:3902/x.mbtiles"), true)
                .is_err()
        );
        // Die Gestalt, die der Alias herstellt, passiert dagegen.
        assert!(url_ist_sicher_mit(&u("http://localhost:3902/x.mbtiles"), true).is_ok());
    }

    #[test]
    fn ip_ist_intern_faengt_ipv6_eingebettetes_ipv4() {
        let intern = |s: &str| ip_ist_intern(&s.parse::<IpAddr>().unwrap());
        assert!(intern("64:ff9b::a00:1"), "NAT64 → 10.0.0.1 (privat)");
        assert!(intern("2002:c0a8:0101::1"), "6to4 → 192.168.1.1 (privat)");
        assert!(
            intern("::a9fe:1"),
            "IPv4-compatible → 169.254.0.1 (link-local)"
        );
        assert!(intern("::ffff:10.0.0.5"), "IPv4-mapped privat");
        // Global eingebettet bzw. global IPv6 bleibt erlaubt.
        assert!(!intern("::ffff:8.8.8.8"), "öffentliches IPv4-mapped");
        assert!(!intern("2606:4700::1"), "globales IPv6");
        assert!(!intern("64:ff9b::8.8.8.8"), "NAT64 mit öffentlichem IPv4");
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

    /// Fixture, die `chunks` × `chunk_len` Bytes OHNE Content-Length streamt, damit der
    /// Streaming-Backstop getroffen wird.
    async fn spawn_streaming_fixture(chunks: usize, chunk_len: usize) -> String {
        use axum::{body::Body, routing::get, Router};
        let app = Router::new().route(
            "/f.pmtiles",
            get(move || async move {
                let s = futures::stream::iter(
                    (0..chunks).map(move |_| Ok::<_, std::io::Error>(vec![7u8; chunk_len])),
                );
                Body::from_stream(s)
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://127.0.0.1:{}/f.pmtiles", addr.port())
    }

    #[tokio::test]
    async fn lade_datei_schreibt_bytes_und_korrekten_sha256() {
        let body = b"PMTiles\x03-fixture-inhalt-fuer-den-download-test".repeat(50);
        let url_str = spawn_fixture(body.clone()).await;
        let tmp = tempfile::tempdir().unwrap();
        let ziel = tmp.path().join("karte-1.pmtiles.part");
        // Loopback hat keinen Redirect; die Policy greift nur bei Redirects.
        let client = download_client();
        let fortschritt = Fortschritt::default();
        let url = Url::parse(&url_str).unwrap();

        let erg = lade_datei(&client, url, &ziel, &fortschritt, None, MAX_DOWNLOAD_BYTES)
            .await
            .unwrap();

        assert_eq!(erg.groesse, body.len() as i64);
        assert_eq!(erg.sha256, erwarteter_hash(&body));
        assert_eq!(std::fs::read(&ziel).unwrap(), body, "Datei-Inhalt stimmt");
        assert_eq!(
            fortschritt.geladen.load(Ordering::Relaxed),
            body.len() as u64
        );
        assert_eq!(
            fortschritt.gesamt.load(Ordering::Relaxed),
            body.len() as u64,
            "Content-Length übernommen"
        );
    }

    // LFH-599: ein Download landet byte-gleich auf der Platte, auch wenn die Quelle
    // `Content-Encoding: gzip` meldet — der sha256-Pin gilt den gelieferten Bytes.
    #[tokio::test]
    async fn download_client_laedt_gzip_byte_gleich() {
        use crate::karte::gzip_fixture;
        let (url_str, mitschrift) = gzip_fixture::spawn().await;
        let tmp = tempfile::tempdir().unwrap();
        let ziel = tmp.path().join("gz.part");
        let erg = lade_datei(
            &download_client(),
            Url::parse(&url_str).unwrap(),
            &ziel,
            &Fortschritt::default(),
            Some(&erwarteter_hash(gzip_fixture::GZIP)),
            MAX_DOWNLOAD_BYTES,
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&ziel).unwrap(), gzip_fixture::GZIP);
        assert_eq!(erg.groesse, gzip_fixture::GZIP.len() as i64);
        assert_eq!(
            *mitschrift.lock().unwrap(),
            None,
            "kein Accept-Encoding vom Download-Client"
        );
    }

    // Atomare Slot-Reservierung: eine zweite Reservierung derselben id wird abgelehnt.
    #[test]
    fn reserviere_fortschritt_ist_atomar_ein_slot_pro_id() {
        let map = neue_fortschritt_map();
        assert!(
            reserviere_fortschritt(&map, 5, std::sync::Arc::new(Fortschritt::default())),
            "erste Reservierung frei"
        );
        assert!(
            !reserviere_fortschritt(&map, 5, std::sync::Arc::new(Fortschritt::default())),
            "zweite Reservierung derselben id abgelehnt"
        );
        assert!(
            reserviere_fortschritt(&map, 6, std::sync::Arc::new(Fortschritt::default())),
            "andere id frei"
        );
    }

    // Plattenplatz-Prädikat mit 10 % Reserve.
    #[test]
    fn genug_platz_beachtet_zehn_prozent_reserve() {
        assert!(genug_platz(1100, 1000), "exakt Größe + 10 % passt");
        assert!(
            !genug_platz(1099, 1000),
            "1 Byte unter Größe + 10 % reicht nicht"
        );
        assert!(genug_platz(50, 0), "Nullgröße passt immer");
        // Saturierend: eine riesige Größe panickt nicht und passt nicht.
        assert!(
            !genug_platz(1000, u64::MAX),
            "u64::MAX-Größe passt nicht in 1000 Bytes frei"
        );
    }

    // Ein Download über der Maximalgröße wird abgebrochen (hier über Content-Length erkannt).
    #[tokio::test]
    async fn lade_datei_lehnt_download_ueber_max_ab() {
        let body = b"y".repeat(2000);
        let url_str = spawn_fixture(body).await;
        let tmp = tempfile::tempdir().unwrap();
        let client = download_client();
        let f = Fortschritt::default();
        let err = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &tmp.path().join("big.part"),
            &f,
            None,
            1000, // max_bytes < Body
        )
        .await
        .unwrap_err();
        assert!(matches!(err, DownloadFehler::ZuGross { .. }), "war {err:?}");
        assert!(
            !tmp.path().join("big.part").exists(),
            "keine Teil-Datei bei Vorab-Ablehnung"
        );
    }

    // Ohne Content-Length greift nur der Streaming-Backstop — der einzige Schutz gegen
    // Platten-Erschöpfung bei Streams ohne Längenangabe.
    #[tokio::test]
    async fn lade_datei_streaming_backstop_ohne_content_length() {
        let url_str = spawn_streaming_fixture(20, 500).await; // 20×500 = 10 000 Bytes, chunked
        let tmp = tempfile::tempdir().unwrap();
        let client = download_client();
        let f = Fortschritt::default();
        let err = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &tmp.path().join("s.part"),
            &f,
            None,
            1500, // max_bytes < Gesamtstrom
        )
        .await
        .unwrap_err();
        assert_eq!(
            f.gesamt.load(Ordering::Relaxed),
            0,
            "keine Content-Length → Vorab-Check greift nicht (Fast-Path aus)"
        );
        assert!(
            matches!(err, DownloadFehler::ZuGross { .. }),
            "Streaming-Backstop muss abbrechen, war {err:?}"
        );
    }

    // Der Download-Client pinnt DNS: ein Hostname, der auf Loopback auflöst, wird geblockt.
    // IP-Literale umgehen den Resolver, deshalb ein Hostname.
    #[tokio::test]
    async fn download_client_blockt_hostnamen_die_auf_loopback_aufloesen() {
        let url_str = spawn_fixture(b"x".repeat(100))
            .await
            .replace("127.0.0.1", "localhost");
        let tmp = tempfile::tempdir().unwrap();
        let client = download_client();
        let f = Fortschritt::default();
        let err = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &tmp.path().join("x.part"),
            &f,
            None,
            MAX_DOWNLOAD_BYTES,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, DownloadFehler::Http(_)),
            "loopback-Hostname darf nicht connecten (war {err:?})"
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

        let err = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &ziel,
            &fortschritt,
            None,
            MAX_DOWNLOAD_BYTES,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, DownloadFehler::Abgebrochen));
    }

    #[tokio::test]
    async fn lade_datei_akzeptiert_korrekten_pin_und_lehnt_falschen_ab() {
        let body = b"PMTiles\x03-pin-test".repeat(40);
        let url_str = spawn_fixture(body.clone()).await;
        let tmp = tempfile::tempdir().unwrap();
        let client = download_client();

        // Korrekter Pin → Ok.
        let f1 = Fortschritt::default();
        let erg = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &tmp.path().join("ok.part"),
            &f1,
            Some(&erwarteter_hash(&body)),
            MAX_DOWNLOAD_BYTES,
        )
        .await
        .unwrap();
        assert_eq!(erg.sha256, erwarteter_hash(&body));

        // Falscher Pin → HashMismatch (erwartet vs. ist).
        let f2 = Fortschritt::default();
        let err = lade_datei(
            &client,
            Url::parse(&url_str).unwrap(),
            &tmp.path().join("bad.part"),
            &f2,
            Some("deadbeef"),
            MAX_DOWNLOAD_BYTES,
        )
        .await
        .unwrap_err();
        match err {
            DownloadFehler::HashMismatch { erwartet, ist } => {
                assert_eq!(erwartet, "deadbeef");
                assert_eq!(ist, erwarteter_hash(&body));
            }
            other => panic!("HashMismatch erwartet, war {other:?}"),
        }
    }

    #[tokio::test]
    async fn entferne_download_dateien_loescht_nur_id_dateien() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join("karte-7.mbtiles"), b"final").unwrap();
        std::fs::write(dir.join("karte-7.mbtiles.part"), b"rest").unwrap();
        // Extern registrierte Fremddatei mit beliebigem Namen — darf NICHT angefasst werden.
        std::fs::write(dir.join("fremd.mbtiles"), b"extern").unwrap();

        entferne_download_dateien(dir, 7).await;

        assert!(
            !dir.join("karte-7.mbtiles").exists(),
            "finale Datei entfernt"
        );
        assert!(!dir.join("karte-7.mbtiles.part").exists(), ".part entfernt");
        assert!(
            dir.join("fremd.mbtiles").exists(),
            "Fremddatei unangetastet"
        );
        // Idempotent: zweiter Aufruf ohne Dateien ist ein No-Op (kein Panic).
        entferne_download_dateien(dir, 7).await;
    }

    /// Eine Panik unter dem Write-Lock vergiftet die Fortschritt-Map; der Zugriff muss trotzdem
    /// funktionieren.
    #[test]
    fn fortschritt_map_ueberlebt_vergifteten_lock() {
        let map = neue_fortschritt_map();
        let m2 = map.clone();
        // Lock unter Panic vergiften.
        let _ = std::thread::spawn(move || {
            let _g = m2.write().unwrap();
            panic!("vergifte den Lock absichtlich");
        })
        .join();
        assert!(map.read().is_err(), "Vorbedingung: Lock ist vergiftet");

        // Poisoning-fest: reserviere_fortschritt darf NICHT panicken.
        assert!(
            reserviere_fortschritt(&map, 7, Arc::new(Fortschritt::default())),
            "muss trotz Vergiftung einfügen können"
        );
    }
}
