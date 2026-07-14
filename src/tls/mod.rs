//! HTTPS-Transport (LFH-274): Cert-Beschaffung in Präzedenz BYO→Cache→mkcert→rcgen.
//! Die Auflösung ist rein/testbar; der mkcert-Aufruf liegt hinter `MkcertSeam`.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::AppError;

/// Gewählte Cert-Quelle (Ergebnis der Präzedenz-Auflösung).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CertQuelle {
    /// Bring-your-own: explizite PEM-Pfade.
    Byo { cert: String, key: String },
    /// Gültiges Cert bereits im Cache neben der DB.
    Cache,
    /// Über mkcert erzeugen (CA lokal vertrauenswürdig).
    Mkcert,
    /// self-signed via rcgen (Fallback).
    Rcgen,
}

/// Auflösungsplan inkl. der SANs, die ein neu erzeugtes Cert tragen soll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertPlan {
    pub quelle: CertQuelle,
    pub sans: Vec<String>,
}

/// Seam für die mkcert-Verfügbarkeit (Real-Impl prüft PATH; Tests fälschen).
pub trait MkcertSeam {
    fn verfuegbar(&self) -> bool;
}

/// Wählt die Cert-Quelle in Präzedenz. BYO nur, wenn BEIDE Pfade gesetzt sind
/// (Teil-Konfig behandelt der Aufrufer als fail-fast, s. Task 5/6).
pub fn plane_cert(
    tls_cert: Option<&str>,
    tls_key: Option<&str>,
    cache_vorhanden: bool,
    mkcert: &dyn MkcertSeam,
    sans: Vec<String>,
) -> CertPlan {
    let quelle = match (tls_cert, tls_key) {
        (Some(c), Some(k)) => CertQuelle::Byo {
            cert: c.to_string(),
            key: k.to_string(),
        },
        _ if cache_vorhanden => CertQuelle::Cache,
        _ if mkcert.verfuegbar() => CertQuelle::Mkcert,
        _ => CertQuelle::Rcgen,
    };
    CertPlan { quelle, sans }
}

/// Cert-/Key-Cache-Pfade neben der DB-Datei.
pub fn cache_pfade(db_path: &str) -> (PathBuf, PathBuf) {
    let dir = Path::new(db_path)
        .parent()
        .unwrap_or_else(|| Path::new("."));
    (
        dir.join("lifeline-tls-cert.pem"),
        dir.join("lifeline-tls-key.pem"),
    )
}

/// self-signed Cert+Key (PEM) via rcgen für die gegebenen SANs.
pub fn rcgen_pem(sans: &[String]) -> Result<(String, String), AppError> {
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(sans.to_vec())
            .map_err(|e| AppError::Internal(format!("rcgen: {e}")))?;
    Ok((cert.pem(), signing_key.serialize_pem()))
}

/// Cache gültig, wenn beide Dateien existieren und nicht leer sind.
/// (Ablauf-Prüfung bewusst weggelassen: rcgen-Certs laufen bis 4096; BYO/mkcert
/// verwaltet der Operator. Re-Erzeugung erzwingt man durch Löschen der Cache-Dateien.)
pub fn cache_gueltig(cert: &Path, key: &Path) -> bool {
    let nichtleer = |p: &Path| std::fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false);
    nichtleer(cert) && nichtleer(key)
}

/// PATH-basierte mkcert-Verfügbarkeit (Real-Seam).
pub struct RealMkcert;
impl MkcertSeam for RealMkcert {
    fn verfuegbar(&self) -> bool {
        Command::new("mkcert")
            .arg("-CAROOT")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Argumentliste für `mkcert -cert-file <c> -key-file <k> <san…>`.
fn mkcert_args(cert: &Path, key: &Path, sans: &[String]) -> Vec<String> {
    let mut a = vec![
        "-cert-file".to_string(),
        cert.to_string_lossy().into_owned(),
        "-key-file".to_string(),
        key.to_string_lossy().into_owned(),
    ];
    a.extend(sans.iter().cloned());
    a
}

/// Führt mkcert aus (optional vorher `-install`), schreibt cert/key in den Cache.
fn mkcert_erzeugen(
    cert: &Path,
    key: &Path,
    sans: &[String],
    install: bool,
) -> Result<(), AppError> {
    if install {
        // Best-effort: CA sicherstellen. Fehler hier NICHT hart (Cert-Gen kann trotzdem klappen).
        let _ = Command::new("mkcert").arg("-install").status();
    }
    let status = Command::new("mkcert")
        .args(mkcert_args(cert, key, sans))
        .status()
        .map_err(|e| AppError::Internal(format!("mkcert exec: {e}")))?;
    if !status.success() {
        return Err(AppError::Internal("mkcert schlug fehl".into()));
    }
    Ok(())
}

/// Erzeugt ein rcgen-self-signed-Cert, schreibt cert+key in den Cache und
/// setzt den Key auf 0600 (Unix) — der Private Key darf nicht world-readable sein.
fn erzeuge_und_cache_rcgen(
    cache_cert: &Path,
    cache_key: &Path,
    sans: &[String],
) -> Result<(), AppError> {
    let (c, k) = rcgen_pem(sans)?;
    std::fs::write(cache_cert, c).map_err(|e| AppError::Internal(e.to_string()))?;
    std::fs::write(cache_key, &k).map_err(|e| AppError::Internal(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(cache_key, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }
    Ok(())
}

/// Beschafft ein Cert nach Präzedenz und liefert die zu ladenden PEM-Pfade.
/// BYO mit fehlender Datei → fail-fast. mkcert-Fehler → Fallback rcgen (Cache).
pub async fn beschaffe_cert(
    cfg: &crate::config::Config,
    sans: Vec<String>,
) -> Result<(PathBuf, PathBuf), AppError> {
    // Teil-BYO (nur eine Hälfte gesetzt) ist Fehlkonfiguration → fail-fast.
    match (cfg.tls_cert.as_deref(), cfg.tls_key.as_deref()) {
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::Internal(
                "--tls-cert und --tls-key müssen gemeinsam gesetzt sein".into(),
            ));
        }
        _ => {}
    }
    let (cache_cert, cache_key) = cache_pfade(&cfg.db_path);
    let plan = plane_cert(
        cfg.tls_cert.as_deref(),
        cfg.tls_key.as_deref(),
        cache_gueltig(&cache_cert, &cache_key),
        &RealMkcert,
        sans.clone(),
    );
    match plan.quelle {
        CertQuelle::Byo { cert, key } => {
            let (cp, kp) = (PathBuf::from(&cert), PathBuf::from(&key));
            if !cache_gueltig(&cp, &kp) {
                return Err(AppError::Internal(format!(
                    "BYO-Cert/Key nicht lesbar: {cert} / {key}"
                )));
            }
            Ok((cp, kp))
        }
        CertQuelle::Cache => Ok((cache_cert, cache_key)),
        CertQuelle::Mkcert => {
            match mkcert_erzeugen(&cache_cert, &cache_key, &plan.sans, cfg.tls_mkcert_install) {
                Ok(()) => Ok((cache_cert, cache_key)),
                Err(e) => {
                    tracing::warn!("mkcert fehlgeschlagen ({e}) — Fallback rcgen");
                    erzeuge_und_cache_rcgen(&cache_cert, &cache_key, &plan.sans)?;
                    Ok((cache_cert, cache_key))
                }
            }
        }
        CertQuelle::Rcgen => {
            erzeuge_und_cache_rcgen(&cache_cert, &cache_key, &plan.sans)?;
            Ok((cache_cert, cache_key))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeMkcert(bool);
    impl MkcertSeam for FakeMkcert {
        fn verfuegbar(&self) -> bool {
            self.0
        }
    }
    fn sans() -> Vec<String> {
        vec!["localhost".into(), "127.0.0.1".into()]
    }

    #[test]
    fn byo_hat_hoechste_praezedenz() {
        let p = plane_cert(
            Some("/c.pem"),
            Some("/k.pem"),
            true,
            &FakeMkcert(true),
            sans(),
        );
        assert_eq!(
            p.quelle,
            CertQuelle::Byo {
                cert: "/c.pem".into(),
                key: "/k.pem".into()
            }
        );
    }

    #[test]
    fn cache_vor_mkcert() {
        let p = plane_cert(None, None, true, &FakeMkcert(true), sans());
        assert_eq!(p.quelle, CertQuelle::Cache);
    }

    #[test]
    fn mkcert_wenn_verfuegbar_und_kein_cache() {
        let p = plane_cert(None, None, false, &FakeMkcert(true), sans());
        assert_eq!(p.quelle, CertQuelle::Mkcert);
    }

    #[test]
    fn rcgen_fallback_wenn_kein_mkcert() {
        let p = plane_cert(None, None, false, &FakeMkcert(false), sans());
        assert_eq!(p.quelle, CertQuelle::Rcgen);
    }

    #[test]
    fn teil_byo_faellt_nicht_auf_byo() {
        // Nur cert, kein key → NICHT Byo (der Aufrufer macht daraus fail-fast).
        let p = plane_cert(Some("/c.pem"), None, false, &FakeMkcert(false), sans());
        assert_eq!(p.quelle, CertQuelle::Rcgen);
    }

    #[test]
    fn rcgen_liefert_pem_paar() {
        let (cert, key) =
            super::rcgen_pem(&["localhost".to_string(), "127.0.0.1".to_string()]).unwrap();
        assert!(cert.contains("BEGIN CERTIFICATE"));
        assert!(key.contains("PRIVATE KEY"));
    }

    #[test]
    fn cache_pfade_liegen_neben_der_db() {
        let (c, k) = super::cache_pfade("/data/lifeline.db");
        assert_eq!(c.parent().unwrap().to_str().unwrap(), "/data");
        assert!(c.file_name().unwrap().to_str().unwrap().ends_with(".pem"));
        assert_ne!(c, k);
    }

    #[test]
    fn cache_gueltig_nur_wenn_beide_dateien_da() {
        let dir = std::env::temp_dir().join(format!("lfh-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = dir.join("c.pem");
        let k = dir.join("k.pem");
        assert!(!super::cache_gueltig(&c, &k));
        std::fs::write(&c, "x").unwrap();
        assert!(!super::cache_gueltig(&c, &k), "nur cert reicht nicht");
        std::fs::write(&k, "y").unwrap();
        assert!(super::cache_gueltig(&c, &k));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mkcert_args_enthalten_alle_sans() {
        let args = super::mkcert_args(
            &std::path::PathBuf::from("/tmp/c.pem"),
            &std::path::PathBuf::from("/tmp/k.pem"),
            &[
                "localhost".to_string(),
                "127.0.0.1".to_string(),
                "elw.local".to_string(),
            ],
        );
        // -cert-file /tmp/c.pem -key-file /tmp/k.pem localhost 127.0.0.1 elw.local
        assert!(args.iter().any(|a| a == "-cert-file"));
        assert!(args.iter().any(|a| a == "/tmp/c.pem"));
        assert!(args.iter().any(|a| a == "elw.local"));
        assert_eq!(args.last().unwrap(), "elw.local");
    }

    /// Socket-freier Serve-Pfad-Test: rcgen-PEM → Datei-Roundtrip → rustls-Ladbarkeit.
    /// Deckt zugleich den Rust-0.23-CryptoProvider-Auto-Default ab (GENAU EIN kompiliertes
    /// Provider-Feature) — ein künftiger Dep-Drift mit zwei Providern würde hier statt erst
    /// beim echten `--tls`-Serve auffallen. Öffnet keinen Port/Socket.
    #[tokio::test]
    async fn rcgen_pem_ist_per_rustls_ladbar() {
        let (cert_pem, key_pem) = super::rcgen_pem(&["localhost".to_string()]).unwrap();
        let dir = std::env::temp_dir().join(format!("lfh-tls-serve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cert_path = dir.join("cert.pem");
        let key_path = dir.join("key.pem");
        std::fs::write(&cert_path, cert_pem).unwrap();
        std::fs::write(&key_path, key_pem).unwrap();

        let result =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path).await;

        std::fs::remove_dir_all(&dir).ok();

        assert!(
            result.is_ok(),
            "rustls sollte das rcgen-PEM-Paar laden können: {:?}",
            result.err()
        );
    }
}
