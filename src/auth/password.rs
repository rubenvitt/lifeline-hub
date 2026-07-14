use crate::error::AppError;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Hasht ein Klartext-Passwort mit Argon2id (OWASP-Defaultparameter)
/// und liefert den PHC-String (inkl. eingebettetem Salt).
pub fn hash(passwort: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(passwort.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Passwort-Hashing fehlgeschlagen: {e}")))
}

/// Prüft ein Klartext-Passwort gegen einen gespeicherten PHC-Hash.
/// Liefert `false` bei Nichtübereinstimmung oder unparsbarem Hash.
pub fn verifizieren(passwort: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(passwort.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_unterscheidet_sich_vom_klartext_und_ist_phc() {
        let h = hash("geheim123").unwrap();
        assert_ne!(h, "geheim123");
        assert!(h.starts_with("$argon2id$"), "PHC-String erwartet, war: {h}");
    }

    #[test]
    fn verifizieren_akzeptiert_korrektes_passwort() {
        let h = hash("geheim123").unwrap();
        assert!(verifizieren("geheim123", &h));
    }

    #[test]
    fn verifizieren_lehnt_falsches_passwort_ab() {
        let h = hash("geheim123").unwrap();
        assert!(!verifizieren("falsch", &h));
    }

    #[test]
    fn verifizieren_lehnt_kaputten_hash_ab() {
        assert!(!verifizieren("egal", "kein-gueltiger-hash"));
    }

    #[test]
    fn verifizieren_lehnt_sso_only_sentinel_ab() {
        // LFH-41: der Sentinel ist bewusst kein PHC-String — `verifizieren` muss dagegen
        // sicher `false` liefern (kein lokaler Passwort-Login für SSO-only-Konten).
        assert!(!verifizieren("egal", crate::auth::PASSWORT_HASH_SSO_ONLY));
    }

    #[test]
    fn zwei_hashes_desselben_passworts_unterscheiden_sich() {
        // Unterschiedliche Salts → unterschiedliche Hashes.
        assert_ne!(hash("gleich").unwrap(), hash("gleich").unwrap());
    }
}
