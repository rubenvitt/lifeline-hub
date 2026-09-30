//! PKCE (RFC 7636, S256) für „Im Browser anmelden“ (LFH-818): Der `verifier` bleibt in der
//! Hülle, nur die `challenge` geht an den Browser. Gegenstück im Server: `src/auth/huelle/pkce.rs`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Neuer `verifier`: 32 Byte aus dem OS-Zufall, base64url ohne Auffüllung (43 Zeichen).
pub fn neuer_verifier() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Kein Zufall vom System: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// `base64url(SHA-256(verifier))` ohne Auffüllung.
pub fn challenge_aus(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_nach_rfc_7636_anhang_b() {
        assert_eq!(
            challenge_aus("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_hat_43_base64url_zeichen_und_ist_jedes_mal_neu() {
        let a = neuer_verifier().unwrap();
        let b = neuer_verifier().unwrap();
        assert_eq!(a.len(), 43);
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(a, b);
    }
}
