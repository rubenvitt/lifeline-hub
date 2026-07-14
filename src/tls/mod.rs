//! HTTPS-Transport (LFH-274): Cert-Beschaffung in Präzedenz BYO→Cache→mkcert→rcgen.
//! Die Auflösung ist rein/testbar; der mkcert-Aufruf liegt hinter `MkcertSeam`.

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
}
