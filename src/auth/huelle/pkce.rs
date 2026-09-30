//! Form und Ableitung nach RFC 7636 (S256) für die Anmeldung aus dem Browser (LFH-818).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

fn ist_base64url(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// Prüft die Form der `challenge`: base64url ohne Auffüllung, genau 43 Zeichen (SHA-256).
pub fn challenge_gueltig(challenge: &str) -> bool {
    challenge.len() == 43 && challenge.chars().all(ist_base64url)
}

/// Prüft die Form des `verifier` nach RFC 7636 4.1: 43–128 Zeichen aus `[A-Za-z0-9-._~]`.
pub fn verifier_gueltig(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier
            .chars()
            .all(|c| ist_base64url(c) || c == '.' || c == '~')
}

/// `base64url(SHA-256(verifier))` ohne Auffüllung.
pub fn challenge_aus(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Ob `verifier` zur gespeicherten `challenge` passt, Vergleich in konstanter Zeit.
pub fn passt(verifier: &str, challenge: &str) -> bool {
    let erwartet = challenge_aus(verifier);
    let (a, b) = (erwartet.as_bytes(), challenge.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 7636, Anhang B.
    const RFC_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const RFC_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    #[test]
    fn challenge_nach_rfc_7636_anhang_b() {
        assert_eq!(challenge_aus(RFC_VERIFIER), RFC_CHALLENGE);
    }

    #[test]
    fn passender_verifier_passt() {
        assert!(passt(RFC_VERIFIER, RFC_CHALLENGE));
    }

    #[test]
    fn fremder_verifier_passt_nicht() {
        let fremd = "eBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert!(!passt(fremd, RFC_CHALLENGE));
        assert!(!passt(RFC_VERIFIER, "kurz"));
    }

    #[test]
    fn challenge_form() {
        assert!(challenge_gueltig(RFC_CHALLENGE));
        assert!(!challenge_gueltig(&RFC_CHALLENGE[..42]));
        assert!(!challenge_gueltig(&format!("{RFC_CHALLENGE}A")));
        assert!(!challenge_gueltig(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM"
        ));
        assert!(!challenge_gueltig(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw=cM"
        ));
        assert!(!challenge_gueltig(""));
    }

    #[test]
    fn verifier_form() {
        assert!(verifier_gueltig(RFC_VERIFIER));
        assert!(verifier_gueltig(&"a".repeat(43)));
        assert!(verifier_gueltig(&"a.b~c_d-".repeat(16)));
        assert!(!verifier_gueltig(&"a".repeat(42)));
        assert!(verifier_gueltig(&"a".repeat(128)));
        assert!(!verifier_gueltig(&"a".repeat(129)));
        assert!(!verifier_gueltig(&format!("{}+", "a".repeat(43))));
        assert!(!verifier_gueltig(&format!("{}ä", "a".repeat(43))));
        assert!(!verifier_gueltig(""));
    }
}
