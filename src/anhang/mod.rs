//! Generische Datei-Anhang-Infrastruktur (LFH-102).
//!
//! Bewusst als **Top-Level-Modul** geschnitten — nicht unter `kommunikation` —,
//! weil Anhänge modulübergreifend gedacht sind (Chat dockt jetzt an, ETB/Lageobjekte
//! können dieselbe `anhang`-Tabelle später nutzen). Die chat-spezifische Verknüpfung
//! (`chat_nachricht_anhang`) lebt deshalb im `chat`-Modul, nicht hier.
//!
//! Dateien werden als BLOB in der SQLite-DB gespeichert (siehe Migration 0052):
//! ein einziger Zustands-Container, vom file-copy-/VACUUM-INTO-Backup automatisch
//! miterfasst.

pub mod repo;

use crate::error::AppError;
use serde::Serialize;
use std::sync::OnceLock;
use utoipa::ToSchema;

/// Maximale Upload-Größe pro Datei (25 MiB). Muss mit dem Body-Limit der
/// Upload-Route (`DefaultBodyLimit`) zusammenpassen und ist bewusst am späteren
/// clamd-`StreamMaxLength` (Default 25M, LFH-114) orientiert.
pub const MAX_GROESSE: usize = 25 * 1024 * 1024;

/// Erlaubte MIME-Typen (Allowlist). Bewusst kuratiert: Bilder, PDF, einfache
/// Texte/CSV und Office-Open-XML — das deckt die typischen BOS-Dokumente
/// (Fotos, Lagekarten als PDF, Listen) ab, ohne ausführbare Inhalte zuzulassen.
/// Erweiterbar; eine echte Inhalts-Sniffing-Prüfung folgt mit der AV-Anbindung
/// (LFH-114) — heute wird der aus der Dateiendung abgeleitete MIME-Typ geprüft.
pub const ERLAUBTE_MIME: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/// Öffentliche Darstellung eines Anhangs — ohne die Bytes (`daten`), die nur
/// über den Download-Endpoint ausgeliefert werden.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AnhangAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub hochgeladen_von: i64,
    pub erstellt_at: String,
}

/// Prüft die Upload-Größe gegen `MAX_GROESSE`. Leere Dateien sind unzulässig.
pub fn pruefe_groesse(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::Validation("Datei ist leer".into()));
    }
    if len > MAX_GROESSE {
        return Err(AppError::Validation(format!(
            "Datei ist zu groß ({} MiB erlaubt)",
            MAX_GROESSE / 1024 / 1024
        )));
    }
    Ok(())
}

/// Leitet den MIME-Typ aus der Dateiendung ab (mime_guess) und prüft ihn gegen
/// die Allowlist. Der vom Client gemeldete Content-Type wird bewusst NICHT als
/// Sicherheitsentscheidung herangezogen (manipulierbar) — die Endung ist hier
/// die maßgebliche, knappe Heuristik; echtes Content-Sniffing folgt mit LFH-114.
pub fn ermittle_mime(dateiname: &str) -> Result<String, AppError> {
    let mime = mime_guess::from_path(dateiname)
        .first_raw()
        .ok_or_else(|| AppError::Validation("Dateityp nicht erkennbar".into()))?;
    if !ERLAUBTE_MIME.contains(&mime) {
        return Err(AppError::Validation(format!(
            "Dateityp {mime} ist nicht erlaubt"
        )));
    }
    Ok(mime.to_string())
}

/// Baut einen sicheren `Content-Disposition`-Wert: reiner ASCII-Fallback plus
/// RFC-5987 `filename*` mit prozent-kodiertem UTF-8, damit Dateinamen mit
/// Umlauten korrekt ankommen, ohne dass `HeaderValue::from_str` scheitert.
/// Geteilte Asset-Auslieferungs-Infrastruktur (LFH-238): sowohl der generische
/// Anhang-Download als auch der Karten-Hintergrundbild-Download nutzen sie, damit
/// beide Pfade konsistent `attachment` mit korrekt kodiertem Dateinamen liefern.
pub fn content_disposition(dateiname: &str) -> String {
    let ascii: String = dateiname
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!(
        "attachment; filename=\"{ascii}\"; filename*=UTF-8''{}",
        prozent_kodiere(dateiname)
    )
}

/// Minimale Prozent-Kodierung (RFC 3986 unreserved bleibt erhalten).
fn prozent_kodiere(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Ergebnis eines AV-Scans (LFH-114) — Eingabe für die reine [`entscheide`]-Logik.
#[derive(Debug, PartialEq, Eq)]
pub enum ScanErgebnis {
    /// clamd meldet die Bytes als sauber.
    Sauber,
    /// clamd meldet einen Fund (Signaturname).
    Fund(String),
    /// clamd war nicht erreichbar / der Scan schlug technisch fehl.
    ScannerNichtErreichbar,
}

/// Default-Timeout (Sekunden) für den clamd-Scan.
const DEFAULT_CLAMD_TIMEOUT_SEKUNDEN: u64 = 30;

/// Konfiguration des Upload-AV-Scans (LFH-114), prozessweit einmal via
/// [`init_scan_config`] beim Serverstart gesetzt (aus der CLI/ENV-`Config`).
#[derive(Debug, Clone)]
pub struct ScanConfig {
    /// clamd-Adresse: TCP `host:port` oder Unix-Socket `unix:/pfad`. `None` → Scan
    /// deaktiviert (No-op-Seam; der Default-Build ohne clamd bleibt single-binary).
    pub clamd_addr: Option<String>,
    /// Verhalten bei nicht erreichbarem clamd: `false` (Default) = fail-closed (Upload
    /// ablehnen, 503), `true` = fail-open (durchlassen — Feld-/Offline-Kompromiss).
    pub fail_open: bool,
    /// Max. Wartezeit auf clamd; danach gilt der Scan als „nicht erreichbar" (die
    /// fail-open/closed-Entscheidung greift). Verhindert, dass ein hängender clamd
    /// (Verbindung angenommen, aber keine Antwort) den Upload-Request unbegrenzt blockiert
    /// — ein Hänger wäre für fail-closed schlimmer als eine abgelehnte Verbindung.
    pub timeout: std::time::Duration,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            clamd_addr: None,
            fail_open: false,
            timeout: std::time::Duration::from_secs(DEFAULT_CLAMD_TIMEOUT_SEKUNDEN),
        }
    }
}

static SCAN_CONFIG: OnceLock<ScanConfig> = OnceLock::new();

/// Setzt die prozessweite Scan-Konfiguration (einmal beim Serverstart). Idempotent —
/// ein zweiter Aufruf wird ignoriert; bewusst NICHT in AppState, um die ~20 inline
/// AppState-Test-Konstruktionen nicht zu brechen (analog zu prozessweiten Caches).
pub fn init_scan_config(cfg: ScanConfig) {
    let _ = SCAN_CONFIG.set(cfg);
}

/// Aktuelle Scan-Konfiguration; ohne Initialisierung deaktiviert (Default, z.B. Tests).
pub fn scan_config() -> &'static ScanConfig {
    SCAN_CONFIG.get_or_init(ScanConfig::default)
}

/// Reine Entscheidung aus AV-Ergebnis + fail-Modus → persistieren (`Ok`) oder ablehnen.
/// Bewusst getrennt von der Netz-I/O, damit ohne laufenden clamd testbar.
pub fn entscheide(ergebnis: ScanErgebnis, fail_open: bool) -> Result<(), AppError> {
    match ergebnis {
        ScanErgebnis::Sauber => Ok(()),
        ScanErgebnis::Fund(sig) => Err(AppError::UnprocessableEntity(format!(
            "Datei durch Virenscan abgelehnt (Fund: {sig})"
        ))),
        ScanErgebnis::ScannerNichtErreichbar => {
            if fail_open {
                Ok(())
            } else {
                Err(AppError::ServiceUnavailable(
                    "Virenscanner nicht erreichbar — Upload abgelehnt (fail-closed)".into(),
                ))
            }
        }
    }
}

/// AV-Scan eines Upload-Puffers (scan-vor-persist, LFH-114). Ohne konfigurierte
/// `clamd_addr` (oder im `--no-default-features`-Build ohne das `clamav`-Cargo-Feature) ein
/// No-op → `Ok`; das Binary bleibt so oder so single-binary. Bei Fund → 422, bei nicht erreichbarem
/// clamd → fail-open/closed gemäß [`ScanConfig`].
pub async fn scan(cfg: &ScanConfig, daten: &[u8]) -> Result<(), AppError> {
    let Some(addr) = cfg.clamd_addr.as_deref() else {
        return Ok(());
    };
    // Timeout gegen einen hängenden clamd: nach Ablauf gilt der Scanner als nicht
    // erreichbar, damit die fail-open/closed-Entscheidung greift statt der Request hängt.
    let ergebnis = match tokio::time::timeout(cfg.timeout, clamd_scan(addr, daten)).await {
        Ok(e) => e,
        Err(_zeitueberschritten) => {
            tracing::warn!(
                "clamd-Scan-Timeout nach {:?} — als nicht erreichbar behandelt",
                cfg.timeout
            );
            ScanErgebnis::ScannerNichtErreichbar
        }
    };
    entscheide(ergebnis, cfg.fail_open)
}

#[cfg(not(feature = "clamav"))]
async fn clamd_scan(_addr: &str, _daten: &[u8]) -> ScanErgebnis {
    // `clamav`-Feature nicht einkompiliert, aber eine Adresse ist gesetzt → bewusste
    // Fehlkonfiguration. Sicherer Default: als „nicht erreichbar" behandeln, damit
    // fail-closed greift statt still ungescannt zu persistieren. Der Serverstart warnt
    // zusätzlich (main.rs).
    ScanErgebnis::ScannerNichtErreichbar
}

/// Streamt den Puffer per INSTREAM an clamd und übersetzt die Antwort in ein
/// [`ScanErgebnis`]. Jeder Verbindungs-/Protokollfehler wird bewusst zu
/// `ScannerNichtErreichbar` (die fail-open/closed-Entscheidung trifft [`entscheide`]).
#[cfg(feature = "clamav")]
async fn clamd_scan(addr: &str, daten: &[u8]) -> ScanErgebnis {
    let antwort = clamd_verbinden(addr, daten).await;
    match antwort {
        Ok(bytes) => klassifiziere_antwort(&bytes),
        Err(e) => {
            tracing::warn!("clamd nicht erreichbar / Scan fehlgeschlagen: {e}");
            ScanErgebnis::ScannerNichtErreichbar
        }
    }
}

/// Verbindet je nach Adressform zu clamd. **Der `unix:`-Zweig existiert nur unter Unix**
/// (LFH-522): `clamav_client::tokio::Socket` ist in der Crate mit `#[cfg(unix)]` gated, weil
/// Unix-Domain-Sockets kein Windows-Konzept sind. Ohne diese Trennung ist das gesamte Crate
/// auf `x86_64-pc-windows-gnu` nicht übersetzbar (E0422) — gemessen beim Cross-Build-Spike.
///
/// Unter Windows bleibt der TCP-Zweig; eine dort konfigurierte `unix:`-Adresse landet als
/// gewöhnlicher Verbindungsfehler bei `ScannerNichtErreichbar` und damit in derselben
/// fail-open/closed-Entscheidung wie jeder andere Ausfall — kein neuer Fehlerpfad, aber eine
/// laute Warnung, weil die Konfiguration auf dieser Plattform nie funktionieren kann.
#[cfg(all(feature = "clamav", unix))]
async fn clamd_verbinden(addr: &str, daten: &[u8]) -> clamav_client::IoResult {
    if let Some(pfad) = addr.strip_prefix("unix:") {
        clamav_client::tokio::scan_buffer(
            daten,
            clamav_client::tokio::Socket { socket_path: pfad },
            None,
        )
        .await
    } else {
        clamav_client::tokio::scan_buffer(
            daten,
            clamav_client::tokio::Tcp { host_address: addr },
            None,
        )
        .await
    }
}

#[cfg(all(feature = "clamav", not(unix)))]
async fn clamd_verbinden(addr: &str, daten: &[u8]) -> clamav_client::IoResult {
    if addr.starts_with("unix:") {
        tracing::warn!(
            "clamd-Adresse '{addr}' verlangt einen Unix-Socket — auf dieser Plattform nicht \
             verfügbar. Der Scan gilt als nicht erreichbar; für Windows eine TCP-Adresse \
             (host:port) konfigurieren."
        );
    }
    clamav_client::tokio::scan_buffer(
        daten,
        clamav_client::tokio::Tcp { host_address: addr },
        None,
    )
    .await
}

/// Übersetzt eine clamd-INSTREAM-Antwort in ein [`ScanErgebnis`]. clamd endet mit
/// `OK` (sauber), `<Sig> FOUND` (Fund) oder `<Meldung> ERROR` (Betriebsfehler, z.B.
/// `INSTREAM size limit exceeded. ERROR` oder OOM). Ein ERROR / unerwartetes Format wird
/// bewusst als `ScannerNichtErreichbar` behandelt, damit die fail-open/closed-Politik
/// greift, statt einen Scanner-BETRIEBSfehler dem Nutzer als Virenfund (422) zu melden.
/// (`clamav_client::clean` allein wertet JEDES Nicht-`OK` als Fund — daher hier explizit.)
#[cfg(feature = "clamav")]
fn klassifiziere_antwort(antwort: &[u8]) -> ScanErgebnis {
    let s = String::from_utf8_lossy(antwort);
    let s = s.trim().trim_end_matches('\0').trim();
    if let Some(rest) = s.strip_suffix(" FOUND") {
        // Format: `stream: <Signatur> FOUND` — Signaturname best-effort extrahieren.
        let sig = rest.rsplit(':').next().map(str::trim).unwrap_or(rest);
        ScanErgebnis::Fund(sig.to_string())
    } else if s.ends_with("OK") {
        ScanErgebnis::Sauber
    } else {
        tracing::warn!("unerwartete/fehlerhafte clamd-Antwort: {s}");
        ScanErgebnis::ScannerNichtErreichbar
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pruefe_groesse_lehnt_leer_und_zu_gross_ab() {
        assert!(matches!(
            pruefe_groesse(0).unwrap_err(),
            AppError::Validation(_)
        ));
        assert!(pruefe_groesse(1).is_ok());
        assert!(pruefe_groesse(MAX_GROESSE).is_ok());
        assert!(matches!(
            pruefe_groesse(MAX_GROESSE + 1).unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn ermittle_mime_akzeptiert_erlaubte_und_lehnt_andere_ab() {
        assert_eq!(ermittle_mime("lage.pdf").unwrap(), "application/pdf");
        assert_eq!(ermittle_mime("foto.JPG").unwrap(), "image/jpeg");
        // Ausführbares / unbekanntes wird abgelehnt.
        assert!(matches!(
            ermittle_mime("schad.exe").unwrap_err(),
            AppError::Validation(_)
        ));
        assert!(matches!(
            ermittle_mime("ohne_endung").unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[test]
    fn content_disposition_kodiert_umlaute_und_bleibt_ascii() {
        let cd = content_disposition("Lageübersicht \"v2\".pdf");
        assert!(cd.is_ascii(), "Header-Wert muss reines ASCII sein");
        assert!(cd.starts_with("attachment"));
        assert!(cd.contains("filename*=UTF-8''"));
        // Umlaut prozent-kodiert (ü = C3 BC in UTF-8).
        assert!(cd.contains("%C3%BC"));
        // Quotes im ASCII-Fallback ersetzt.
        assert!(!cd.contains("\"v2\""));
    }

    // --- AV-Scan-Entscheidung (LFH-114) ---

    #[test]
    fn entscheide_sauber_ist_ok() {
        assert!(entscheide(ScanErgebnis::Sauber, false).is_ok());
        assert!(entscheide(ScanErgebnis::Sauber, true).is_ok());
    }

    #[test]
    fn entscheide_fund_wird_immer_abgelehnt() {
        // Ein Fund wird IMMER (422) abgelehnt — unabhängig vom fail-Modus.
        for fail_open in [false, true] {
            let err = entscheide(ScanErgebnis::Fund("Eicar-Test-Signature".into()), fail_open)
                .unwrap_err();
            assert!(
                matches!(err, AppError::UnprocessableEntity(_)),
                "Fund muss 422 sein (fail_open={fail_open})"
            );
        }
    }

    #[test]
    fn entscheide_scanner_weg_fail_closed_lehnt_ab() {
        // Sicherheits-Default: kein erreichbarer Scanner → Upload ablehnen (503).
        let err = entscheide(ScanErgebnis::ScannerNichtErreichbar, false).unwrap_err();
        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "fail-closed muss 503 sein"
        );
    }

    #[test]
    fn entscheide_scanner_weg_fail_open_laesst_durch() {
        // Bewusster Offline-/Feld-Kompromiss: Scanner weg → durchlassen.
        assert!(entscheide(ScanErgebnis::ScannerNichtErreichbar, true).is_ok());
    }

    // --- clamd-Antwort-Klassifikation (nur mit `clamav`-Feature) ---

    #[cfg(feature = "clamav")]
    #[test]
    fn klassifiziere_ok_ist_sauber() {
        assert_eq!(klassifiziere_antwort(b"stream: OK\0"), ScanErgebnis::Sauber);
    }

    #[cfg(feature = "clamav")]
    #[test]
    fn klassifiziere_found_extrahiert_signatur() {
        assert_eq!(
            klassifiziere_antwort(b"stream: Eicar-Test-Signature FOUND\0"),
            ScanErgebnis::Fund("Eicar-Test-Signature".into())
        );
    }

    #[cfg(feature = "clamav")]
    #[test]
    fn klassifiziere_error_ist_nicht_erreichbar_nicht_fund() {
        // clamd-BETRIEBSfehler dürfen NICHT als Virenfund (422) beim Nutzer landen,
        // sondern als „nicht erreichbar" die fail-open/closed-Politik durchlaufen.
        assert_eq!(
            klassifiziere_antwort(b"INSTREAM size limit exceeded. ERROR\0"),
            ScanErgebnis::ScannerNichtErreichbar
        );
        assert_eq!(
            klassifiziere_antwort(b"Can't allocate memory ERROR"),
            ScanErgebnis::ScannerNichtErreichbar
        );
    }

    // --- Echter I/O-Pfad gegen nicht erreichbaren clamd (nur mit `clamav`-Feature) ---
    // Braucht KEINEN laufenden clamd: 127.0.0.1:1 verweigert die Verbindung → der
    // ScannerNichtErreichbar-Zweig + die fail-open/closed-Entscheidung werden real geübt.

    #[cfg(feature = "clamav")]
    #[tokio::test]
    async fn scan_gegen_toten_clamd_fail_closed_lehnt_ab() {
        // 127.0.0.1:1 verweigert die Verbindung sofort (ECONNREFUSED).
        let cfg = ScanConfig {
            clamd_addr: Some("127.0.0.1:1".into()),
            fail_open: false,
            ..ScanConfig::default()
        };
        let err = scan(&cfg, b"beliebige bytes").await.unwrap_err();
        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "toter clamd + fail-closed → 503"
        );
    }

    #[cfg(feature = "clamav")]
    #[tokio::test]
    async fn scan_gegen_toten_clamd_fail_open_laesst_durch() {
        let cfg = ScanConfig {
            clamd_addr: Some("127.0.0.1:1".into()),
            fail_open: true,
            ..ScanConfig::default()
        };
        assert!(
            scan(&cfg, b"beliebige bytes").await.is_ok(),
            "toter clamd + fail-open → durchgelassen"
        );
    }

    #[cfg(feature = "clamav")]
    #[tokio::test]
    async fn scan_gegen_haengenden_clamd_timeout_lehnt_ab() {
        // Ein clamd, der die Verbindung ANNIMMT aber nie antwortet, darf den Upload nicht
        // unbegrenzt blockieren: der Scan muss per Timeout abbrechen und fail-closed ablehnen.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            let mut offen = Vec::new();
            loop {
                match listener.accept().await {
                    Ok((sock, _)) => offen.push(sock), // annehmen + offen halten, nie antworten
                    Err(_) => break,
                }
            }
        });
        let cfg = ScanConfig {
            clamd_addr: Some(addr),
            fail_open: false,
            timeout: std::time::Duration::from_millis(200),
        };
        let err = scan(&cfg, b"beliebige bytes").await.unwrap_err();
        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "hängender clamd + fail-closed → 503 via Timeout"
        );
    }

    // No-op ohne Adresse gilt in BEIDEN Builds → un-gated (läuft im Default-`cargo test`).
    #[tokio::test]
    async fn scan_ohne_adresse_ist_noop() {
        let cfg = ScanConfig {
            clamd_addr: None,
            ..ScanConfig::default()
        };
        assert!(scan(&cfg, b"x").await.is_ok(), "ohne clamd-Adresse → No-op");
    }

    // Fehlkonfig-Pfad des `--no-default-features`-Builds (Feature AUS, aber Adresse gesetzt):
    // der not-feature clamd_scan liefert ScannerNichtErreichbar → „kein stiller ungescannter
    // Upload". Läuft nur unter `cargo test --no-default-features` (ohne Netz — der not-feature
    // clamd_scan ist konstant und kehrt sofort zurück); im Default-Build greift der echte Pfad.

    #[cfg(not(feature = "clamav"))]
    #[tokio::test]
    async fn scan_adresse_ohne_feature_fail_closed_lehnt_ab() {
        let cfg = ScanConfig {
            clamd_addr: Some("127.0.0.1:3310".into()),
            fail_open: false,
            ..ScanConfig::default()
        };
        let err = scan(&cfg, b"x").await.unwrap_err();
        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "Adresse gesetzt + Feature aus + fail-closed → 503 (kein ungescannter Upload)"
        );
    }

    #[cfg(not(feature = "clamav"))]
    #[tokio::test]
    async fn scan_adresse_ohne_feature_fail_open_laesst_durch() {
        let cfg = ScanConfig {
            clamd_addr: Some("127.0.0.1:3310".into()),
            fail_open: true,
            ..ScanConfig::default()
        };
        assert!(
            scan(&cfg, b"x").await.is_ok(),
            "Adresse gesetzt + Feature aus + fail-open → durchgelassen"
        );
    }
}
