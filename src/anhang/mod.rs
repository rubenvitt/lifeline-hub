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

/// Konfiguration des Upload-AV-Scans (LFH-114), prozessweit einmal via
/// [`init_scan_config`] beim Serverstart gesetzt (aus der CLI/ENV-`Config`).
#[derive(Debug, Clone, Default)]
pub struct ScanConfig {
    /// clamd-Adresse: TCP `host:port` oder Unix-Socket `unix:/pfad`. `None` → Scan
    /// deaktiviert (No-op-Seam; der Default-Build ohne clamd bleibt single-binary).
    pub clamd_addr: Option<String>,
    /// Verhalten bei nicht erreichbarem clamd: `false` (Default) = fail-closed (Upload
    /// ablehnen, 503), `true` = fail-open (durchlassen — Feld-/Offline-Kompromiss).
    pub fail_open: bool,
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
/// `clamd_addr` (oder im Default-Build ohne das `clamav`-Cargo-Feature) ein No-op → `Ok`,
/// damit der Standard-Build single-binary bleibt. Bei Fund → 422, bei nicht erreichbarem
/// clamd → fail-open/closed gemäß [`ScanConfig`].
pub async fn scan(cfg: &ScanConfig, daten: &[u8]) -> Result<(), AppError> {
    let Some(addr) = cfg.clamd_addr.as_deref() else {
        return Ok(());
    };
    entscheide(clamd_scan(addr, daten).await, cfg.fail_open)
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
    let antwort = if let Some(pfad) = addr.strip_prefix("unix:") {
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
    };
    let antwort = match antwort {
        Ok(bytes) => bytes,
        Err(e) => {
            tracing::warn!("clamd nicht erreichbar / Scan fehlgeschlagen: {e}");
            return ScanErgebnis::ScannerNichtErreichbar;
        }
    };
    match clamav_client::clean(&antwort) {
        Ok(true) => ScanErgebnis::Sauber,
        Ok(false) => ScanErgebnis::Fund(signatur_aus_antwort(&antwort)),
        Err(e) => {
            tracing::warn!("clamd-Antwort unparsebar: {e}");
            ScanErgebnis::ScannerNichtErreichbar
        }
    }
}

/// Extrahiert den Signaturnamen aus einer clamd-Fund-Antwort (`stream: <Sig> FOUND`);
/// best-effort, fällt bei unerwartetem Format auf die getrimmte Rohantwort zurück.
#[cfg(feature = "clamav")]
fn signatur_aus_antwort(antwort: &[u8]) -> String {
    let s = String::from_utf8_lossy(antwort);
    let s = s.trim().trim_end_matches('\0').trim();
    s.strip_suffix(" FOUND")
        .and_then(|rest| rest.rsplit(':').next())
        .map(|sig| sig.trim().to_string())
        .unwrap_or_else(|| s.to_string())
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

    // --- Echter I/O-Pfad gegen nicht erreichbaren clamd (nur mit `clamav`-Feature) ---
    // Braucht KEINEN laufenden clamd: 127.0.0.1:1 verweigert die Verbindung → der
    // ScannerNichtErreichbar-Zweig + die fail-open/closed-Entscheidung werden real geübt.

    #[cfg(feature = "clamav")]
    #[tokio::test]
    async fn scan_gegen_toten_clamd_fail_closed_lehnt_ab() {
        let cfg = ScanConfig {
            clamd_addr: Some("127.0.0.1:1".into()),
            fail_open: false,
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
        };
        assert!(
            scan(&cfg, b"beliebige bytes").await.is_ok(),
            "toter clamd + fail-open → durchgelassen"
        );
    }

    #[cfg(feature = "clamav")]
    #[tokio::test]
    async fn scan_ohne_adresse_ist_noop() {
        let cfg = ScanConfig {
            clamd_addr: None,
            fail_open: false,
        };
        assert!(scan(&cfg, b"x").await.is_ok(), "ohne clamd-Adresse → No-op");
    }
}
