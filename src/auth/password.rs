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

/// Brennt einen Wegwerf-Hash, nur zur Angleichung der Antwortzeit: jeder Weg durch den Login
/// kostet genau einen Argon2-Lauf. Gerufen vom `None`-Arm des Providers und vom
/// Parse-Fehler-Zweig von [`verifizieren`] — eine Funktion, damit beide denselben Lauf brennen.
pub(crate) fn wegwerf_lauf(passwort: &str) {
    let _ = hash(passwort);
}

/// Prüft ein Klartext-Passwort gegen einen gespeicherten PHC-Hash. Liefert `false` bei
/// Nichtübereinstimmung oder unparsbarem Hash.
///
/// Der Parse-Fehler-Zweig brennt vorher einen Wegwerf-Lauf: der SSO-only-Sentinel ist kein
/// PHC-String, und ohne Ausgleich wären SSO-only-Konten per Antwortzeit aufzählbar (LFH-310).
pub fn verifizieren(passwort: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(passwort.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => {
            wegwerf_lauf(passwort);
            false
        }
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
        // Der Sentinel ist kein PHC-String; `verifizieren` muss sicher `false` liefern.
        assert!(!verifizieren("egal", crate::auth::PASSWORT_HASH_SSO_ONLY));
    }

    /// Ein unparsbarer Hash darf nicht schneller antworten als eine echte Prüfung. Geprüft werden
    /// Sentinel und kaputter Hash; verglichen wird der schnellste von fünf Läufen je Seite als
    /// Verhältnis.
    ///
    /// Gemessen wird ABWECHSELND, damit eine Lastspitze des Runners (llvm-cov, volle Suite
    /// parallel) beide Seiten trifft statt nur die, die gerade an der Reihe ist. Die Schwelle 10
    /// prüft die Größenordnung: Gefangen wird ein Zweig ganz OHNE Argon2 (Mikrosekunden gegen
    /// einen vollen KDF-Lauf); eine engere Schwelle misst nur die Last.
    #[test]
    fn unparsbarer_hash_kostet_dieselbe_groessenordnung_wie_eine_echte_pruefung() {
        let echter_hash = hash("geheim123").unwrap();
        let messe = |gespeichert: &str| {
            let start = std::time::Instant::now();
            assert!(!verifizieren("falsch", gespeichert));
            start.elapsed()
        };

        for unparsbar in [crate::auth::PASSWORT_HASH_SSO_ONLY, "kein-gueltiger-hash"] {
            let mut echte_pruefung = std::time::Duration::MAX;
            let mut gemessen = std::time::Duration::MAX;
            for _ in 0..5 {
                echte_pruefung = echte_pruefung.min(messe(&echter_hash));
                gemessen = gemessen.min(messe(unparsbar));
            }
            assert!(
                gemessen * 10 >= echte_pruefung,
                "`{unparsbar}` muss KDF-Arbeit brennen: echte Prüfung {echte_pruefung:?}, \
                 unparsbarer Hash {gemessen:?} — so weit darunter liegt nur ein Zweig, der \
                 ohne Argon2 zurückkehrt (Timing-Orakel, LFH-310)"
            );
        }
    }

    #[test]
    fn zwei_hashes_desselben_passworts_unterscheiden_sich() {
        // Unterschiedliche Salts → unterschiedliche Hashes.
        assert_ne!(hash("gleich").unwrap(), hash("gleich").unwrap());
    }
}
