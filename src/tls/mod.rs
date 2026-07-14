//! HTTPS-Transport (LFH-274): Cert-Beschaffung in Präzedenz BYO→Cache→mkcert→rcgen.
//! Die Auflösung ist rein/testbar; der mkcert-Aufruf liegt hinter `MkcertSeam`.

use std::path::{Path, PathBuf};

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
}
