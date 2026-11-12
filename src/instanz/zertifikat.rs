//! Beglaubigtes TLS-Zertifikat einer Direktkopplung vor Ort (LLH-1497, Change
//! `t10a7luh-elw-lan-direktkopplung`, design.md D3, ADR-0025).
//!
//! Auf einer Direktkopplung zählt nicht das Vertrauen des Betriebssystems in das Zertifikat der
//! erreichten Seite, sondern eine Aussage, die diese mit ihrem Instanzschlüssel signiert: „Ich
//! zeige das Zertifikat mit diesem Fingerabdruck“ (beim Koppeln in der `KoppelnAntwort`, danach
//! über `POST /api/instanz/zertifikat`). Der [`Verifier`] hier prüft die Handshake-Signaturen wie
//! rustls selbst, aber weder Kette noch Hostname; stattdessen vergleicht er den Fingerabdruck mit
//! dem beglaubigten. Ohne erwarteten Wert (Erfassung) lässt er jedes Zertifikat zu: dann darf nur
//! eine Anfrage ohne Nutzdaten hinaus, und der gesehene Fingerabdruck kommt über
//! `reqwest::tls::TlsInfo` zum Vergleich mit der signierten Aussage.

use super::identitaet::tls_fingerabdruck;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::{DigitallySignedStruct, SignatureScheme};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Text des TLS-Fehlers, wenn das gezeigte Zertifikat nicht das beglaubigte ist. `melden` erkennt
/// daran den Fall „neues Zertifikat bestätigen“.
pub const PASST_NICHT: &str = "beglaubigtes Zertifikat passt nicht";

fn provider() -> Arc<CryptoProvider> {
    CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
}

/// Verifier einer Direktkopplung: `erwartet` = beglaubigter Fingerabdruck (hex), `None` =
/// Erfassung (jedes Zertifikat, nur für Anfragen ohne Nutzdaten).
#[derive(Debug)]
pub struct Verifier {
    erwartet: Option<String>,
    provider: Arc<CryptoProvider>,
}

impl Verifier {
    pub fn new(erwartet: Option<String>) -> Self {
        Self {
            erwartet,
            provider: provider(),
        }
    }
}

impl ServerCertVerifier for Verifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        match &self.erwartet {
            None => Ok(ServerCertVerified::assertion()),
            Some(e) if *e == tls_fingerabdruck(end_entity.as_ref()) => {
                Ok(ServerCertVerified::assertion())
            }
            Some(_) => Err(rustls::Error::General(PASST_NICHT.into())),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Baut einen Client für eine Direktkopplung: Verifier mit `erwartet`, TLS-Info an der Antwort,
/// keine Weiterleitung, Fristen wie beim Melden.
pub fn build_client(erwartet: Option<String>) -> Result<reqwest::Client, String> {
    let config = rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Verifier::new(erwartet)))
        .with_no_client_auth();
    crate::ausgehend::client_builder(crate::ausgehend::Zweck::Instanzkopplung)
        .tls_backend_preconfigured(config)
        .tls_info(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Ein Client je beglaubigtem Fingerabdruck (Verbindungen bleiben im Pool); die Erfassung baut
/// jedes Mal neu, damit nie eine Verbindung ohne Pin wiederverwendet wird.
pub fn client(erwartet: &str) -> Result<reqwest::Client, String> {
    static CACHE: OnceLock<Mutex<HashMap<String, reqwest::Client>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut c = cache.lock().map_err(|_| "Zertifikat-Cache".to_string())?;
    if let Some(client) = c.get(erwartet) {
        return Ok(client.clone());
    }
    let neu = build_client(Some(erwartet.to_string()))?;
    // Klein halten: ein Fingerabdruck je Gegenstelle, ein Wechsel lässt den alten zurück.
    if c.len() >= 64 {
        c.clear();
    }
    c.insert(erwartet.to_string(), neu.clone());
    Ok(neu)
}

/// Fingerabdruck des Zertifikats, über das eine Antwort kam (`tls_info` am Client nötig).
pub fn gesehen(resp: &reqwest::Response) -> Option<String> {
    resp.extensions()
        .get::<reqwest::tls::TlsInfo>()
        .and_then(|t| t.peer_certificate())
        .map(tls_fingerabdruck)
}

/// Ob ein Fehler von reqwest daher kommt, dass das gezeigte Zertifikat nicht das beglaubigte ist.
pub fn is_passt_nicht(e: &reqwest::Error) -> bool {
    let mut quelle: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(q) = quelle {
        if q.to_string().contains(PASST_NICHT) {
            return true;
        }
        quelle = q.source();
    }
    false
}

/// Ob ein Fehler von reqwest daher kommt, dass das Betriebssystem dem Zertifikat nicht vertraut
/// (Erkennen des Falls „selbstsigniert, also vielleicht eine Direktkopplung“ beim Einlösen).
pub fn is_zertifikat_fehler(e: &reqwest::Error) -> bool {
    let mut quelle: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(q) = quelle {
        if let Some(r) = q.downcast_ref::<rustls::Error>() {
            return matches!(
                r,
                rustls::Error::InvalidCertificate(_) | rustls::Error::General(_)
            );
        }
        let text = q.to_string();
        if text.contains("invalid peer certificate") || text.contains("UnknownIssuer") {
            return true;
        }
        quelle = q.source();
    }
    false
}

#[cfg(test)]
mod tests;
