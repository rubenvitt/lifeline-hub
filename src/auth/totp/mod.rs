//! Pure TOTP-/Recovery-Core (RFC 6238) für den Passwort→TOTP-Zweitfaktor (LFH-43,
//! Increment 5 „MFA/TOTP").
//!
//! Bewusst frei von DB/HTTP: Secret-Erzeugung, otpauth-URL-Bau und Code-Prüfung sind reine
//! Funktionen — deterministisch testbar über einen festen Unix-Timestamp (`jetzt_unix`),
//! ohne Systemzeit-Abhängigkeit. Persistenz der Recovery-Codes ([`storage`]) und der
//! prozessweite Pending-MFA-State zwischen Passwort- und TOTP-Schritt ([`state`]) sind
//! eigene Module.

pub mod state;
pub mod storage;

use sha2::{Digest, Sha256};
use totp_rs::{Algorithm, Secret, TOTP};

use crate::error::AppError;

/// TOTP-Issuer, wie er in der otpauth-URL erscheint (Anzeige in der Authenticator-App).
pub const TOTP_ISSUER: &str = "lifeline-hub";

/// Anzahl der bei einem Enrollment ausgegebenen Recovery-Codes.
const RECOVERY_CODE_ANZAHL: usize = 10;

/// Baut die RFC-6238-Instanz mit den projektweiten Parametern (SHA1, 6-stellig, ±1
/// Zeitschritt Skew, 30s-Schritt). Zentral verdrahtet, damit `otpauth_url`/`pruefe_code`/
/// `generiere_code` garantiert dieselbe TOTP-Konfiguration verwenden.
///
/// `benutzername` fließt nur in `issuer`/`account_name` ein (otpauth-URL-Anzeige) — er
/// beeinflusst weder Code-Erzeugung noch -Prüfung (s. `totp_rs::TOTP::generate`/`check`).
fn baue_totp(secret_base32: &str, benutzername: &str) -> Result<TOTP, AppError> {
    let secret_bytes = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .map_err(|e| AppError::Internal(format!("TOTP-Secret ungültig: {e}")))?;
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some(TOTP_ISSUER.to_string()),
        benutzername.to_string(),
    )
    .map_err(|e| AppError::Internal(format!("TOTP-Aufbau fehlgeschlagen: {e}")))
}

/// Erzeugt ein frisches, kryptografisch zufälliges Secret (base32, 160 Bit) für ein neues
/// TOTP-Enrollment (`enroll/start`, Task 4).
pub fn neues_secret() -> String {
    Secret::generate_secret().to_encoded().to_string()
}

/// Baut die `otpauth://totp/...`-URL für den QR-Code-Scan im Enrollment (Task 4).
pub fn otpauth_url(secret_base32: &str, benutzername: &str) -> Result<String, AppError> {
    Ok(baue_totp(secret_base32, benutzername)?.get_url())
}

/// Prüft `code` gegen `secret_base32` zum Zeitpunkt `jetzt_unix` (±1 Zeitschritt Skew,
/// s. Modul-Doku). Liefert `false` bei jedem Baufehler (z.B. korruptes Secret) statt zu
/// panicen — der Aufrufer bekommt so nie fälschlich „gültig".
pub fn pruefe_code(secret_base32: &str, code: &str, jetzt_unix: u64) -> bool {
    match baue_totp(secret_base32, "") {
        Ok(totp) => totp.check(code, jetzt_unix),
        Err(_) => false,
    }
}

/// Erzeugt den zu `jetzt_unix` gültigen Code. TEST-HELFER: wird von den deterministischen
/// Integrationstests späterer Tasks (Enroll/Login) genutzt, um ohne echten Authenticator
/// einen gültigen Code für ein bekanntes Secret zu erzeugen.
pub fn generiere_code(secret_base32: &str, jetzt_unix: u64) -> Option<String> {
    baue_totp(secret_base32, "")
        .ok()
        .map(|totp| totp.generate(jetzt_unix))
}

/// Erzeugt frische, hochentropische Einmal-Recovery-Codes (Klartext) für den Fall eines
/// Authenticator-Geräteverlusts. Format `xxxx-xxxx-xxxx-xxxx-xxxx` (20 Hex-Zeichen aus
/// 10 CSPRNG-Bytes, in 4er-Gruppen für bessere Abtippbarkeit/Fehlererkennung).
pub fn neue_recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODE_ANZAHL)
        .map(|_| formatiere_recovery_code(&recovery_bytes()))
        .collect()
}

/// 10 CSPRNG-Bytes über den vom `totp-rs`-Crate bereitgestellten Secret-Generator (Feature
/// `gen_secret`) — kein zusätzlicher direkter `rand`-Dependency nötig.
fn recovery_bytes() -> Vec<u8> {
    let voll = Secret::generate_secret()
        .to_bytes()
        .expect("Secret::Raw.to_bytes() ist unfehlbar");
    voll[..10].to_vec()
}

/// Hex-kodiert `bytes` und gruppiert das Ergebnis in 4er-Blöcken, Bindestrich-getrennt.
fn formatiere_recovery_code(bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    hex.as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).expect("Hex-Ziffern sind reines ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// SHA-256-Hex-Digest eines Recovery-Codes (Klartext). Recovery-Codes sind hochentropisch
/// (CSPRNG-generiert, keine nutzergewählten Passwörter) → sha256 genügt (kein Argon2/Salt
/// nötig, s. Plan „Global Constraints": Recovery-Codes atomar single-use).
pub fn hash_recovery(code: &str) -> String {
    Sha256::digest(code.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base32-Fixture aus den `totp-rs`-eigenen Doctests/Tests (dekodiert zu 23 Bytes,
    /// deutlich über dem RFC-Minimum von 16 Bytes/128 Bit) — kein Secret aus Produktivdaten.
    const TEST_SECRET: &str = "OBWGC2LOFVZXI4TJNZTS243FMNZGK5BNGEZDG";
    const JETZT: u64 = 1_700_000_000;

    #[test]
    fn pruefe_code_akzeptiert_gueltigen_code() {
        let code = generiere_code(TEST_SECRET, JETZT).unwrap();
        assert!(pruefe_code(TEST_SECRET, &code, JETZT));
    }

    #[test]
    fn pruefe_code_lehnt_falschen_code_ab() {
        let gueltig = generiere_code(TEST_SECRET, JETZT).unwrap();
        let falsch = if gueltig == "000000" {
            "111111"
        } else {
            "000000"
        };
        assert!(!pruefe_code(TEST_SECRET, falsch, JETZT));
    }

    #[test]
    fn pruefe_code_akzeptiert_vorherigen_zeitschritt_wegen_skew() {
        // Code aus dem Nachbar-Zeitschritt (t - 30s): bei skew=1 noch gültig bei JETZT.
        let voriger_schritt_code = generiere_code(TEST_SECRET, JETZT - 30).unwrap();
        assert!(pruefe_code(TEST_SECRET, &voriger_schritt_code, JETZT));
    }

    #[test]
    fn neues_secret_ist_nichtleeres_base32_und_zwei_aufrufe_verschieden() {
        let a = neues_secret();
        let b = neues_secret();
        assert!(!a.is_empty());
        assert_ne!(a, b);
        // Muss als base32 dekodierbar sein (RFC4648 ohne Padding).
        assert!(Secret::Encoded(a).to_bytes().is_ok());
    }

    #[test]
    fn otpauth_url_enthaelt_schema_issuer_und_secret_param() {
        let url = otpauth_url(TEST_SECRET, "max.mustermann").unwrap();
        assert!(url.starts_with("otpauth://totp/"), "URL: {url}");
        assert!(url.contains(TOTP_ISSUER), "URL: {url}");
        assert!(url.contains("secret="), "URL: {url}");
    }

    #[test]
    fn neue_recovery_codes_liefert_10_verschiedene_hinreichend_lange_codes() {
        let codes = neue_recovery_codes();
        assert_eq!(codes.len(), RECOVERY_CODE_ANZAHL);

        let eindeutig: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(eindeutig.len(), RECOVERY_CODE_ANZAHL, "Codes: {codes:?}");

        for code in &codes {
            assert!(code.len() >= 16, "Code zu kurz: {code}");
        }
    }

    #[test]
    fn hash_recovery_ist_deterministisch_und_kein_klartext() {
        let code = "abcd-1234-efgh-5678";
        let h1 = hash_recovery(code);
        let h2 = hash_recovery(code);

        assert_eq!(h1, h2);
        assert_ne!(h1, code);
        assert_eq!(h1.len(), 64, "sha256-Hex sollte 64 Zeichen haben: {h1}");
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
