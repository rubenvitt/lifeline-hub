//! TOTP-/Recovery-Kern (RFC 6238) für den Zweitfaktor (LFH-43). Frei von DB/HTTP und über
//! einen festen Unix-Timestamp deterministisch testbar. Persistenz der Recovery-Codes steht in
//! [`storage`], der Pending-State zwischen Passwort- und TOTP-Schritt in [`state`].

pub mod state;
pub mod storage;

use sha2::{Digest, Sha256};
use totp_rs::{Algorithm, Builder, Secret, Totp};

use crate::error::AppError;

/// TOTP-Issuer, wie er in der otpauth-URL erscheint (Anzeige in der Authenticator-App).
pub const TOTP_ISSUER: &str = "lifeline-hub";

/// Anbieter-Kennung im Auth-Audit für eine Anmeldung, die mit dem Zweitfaktor abschließt
/// (LFH-792). Der Passwortschritt davor schreibt keinen Eintrag.
pub const PROVIDER: &str = "totp";

/// Anzahl der bei einem Enrollment ausgegebenen Recovery-Codes.
const RECOVERY_CODE_ANZAHL: usize = 10;

/// Baut die RFC-6238-Instanz (SHA1, 6-stellig, ±1 Schritt Skew, 30 s) — eine Stelle für
/// Erzeugung, Prüfung und otpauth-URL.
///
/// Die Parameter stehen ausgeschrieben, obwohl sie den Vorgaben von totp-rs entsprechen: eine
/// geänderte Crate-Vorgabe darf eingerichtete Authenticator-Apps nicht still ungültig machen.
/// `benutzername` fließt nur in die Anzeige der otpauth-URL ein.
fn baue_totp(secret_base32: &str, benutzername: &str) -> Result<Totp, AppError> {
    // Base32 nach RFC 4648 ohne Padding; gespeicherte Secrets bleiben damit gültig.
    let secret = Secret::try_from_base32(secret_base32)
        .map_err(|e| AppError::Internal(format!("TOTP-Secret ungültig: {e}")))?;
    Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(secret)
        .with_issuer(Some(TOTP_ISSUER))
        .with_account_name(benutzername)
        .build()
        .map_err(|e| AppError::Internal(format!("TOTP-Aufbau fehlgeschlagen: {e}")))
}

/// Frisches, kryptografisch zufälliges Secret (base32, 160 Bit) für ein neues Enrollment.
pub fn neues_secret() -> String {
    Secret::generate().to_base32()
}

/// Baut die `otpauth://totp/...`-URL für den QR-Code im Enrollment.
pub fn otpauth_url(secret_base32: &str, benutzername: &str) -> Result<String, AppError> {
    baue_totp(secret_base32, benutzername)?
        .to_url()
        .map_err(|e| AppError::Internal(format!("otpauth-URL-Aufbau fehlgeschlagen: {e}")))
}

/// Prüft `code` zum Zeitpunkt `jetzt_unix` (±1 Schritt Skew). Liefert `false` bei jedem
/// Baufehler (z. B. korruptes Secret), nie fälschlich „gültig“. Einen Replay-Schutz (RFC 6238
/// §5.2) leistet diese Funktion nicht.
pub fn pruefe_code(secret_base32: &str, code: &str, jetzt_unix: u64) -> bool {
    match baue_totp(secret_base32, "") {
        Ok(totp) => totp.check(code, jetzt_unix).is_some(),
        Err(_) => false,
    }
}

/// Erzeugt den zu `jetzt_unix` gültigen Code. Test-Helfer für deterministische
/// Integrationstests ohne echten Authenticator.
pub fn generiere_code(secret_base32: &str, jetzt_unix: u64) -> Option<String> {
    baue_totp(secret_base32, "")
        .ok()
        .map(|totp| totp.generate(jetzt_unix).to_string())
}

/// Frische, hochentropische Einmal-Recovery-Codes (Klartext) im Format
/// `xxxx-xxxx-xxxx-xxxx-xxxx` (10 CSPRNG-Bytes, hex, in Vierergruppen).
pub fn neue_recovery_codes() -> Vec<String> {
    (0..RECOVERY_CODE_ANZAHL)
        .map(|_| formatiere_recovery_code(&recovery_bytes()))
        .collect()
}

/// 10 CSPRNG-Bytes über den Secret-Generator von `totp-rs` (Feature `gen_secret`), ohne
/// direkte `rand`-Abhängigkeit.
fn recovery_bytes() -> Vec<u8> {
    Secret::generate().as_bytes()[..10].to_vec()
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

/// SHA-256-Hex eines Recovery-Codes. Die Codes sind hochentropisch, ein Argon2/Salt ist
/// unnötig.
pub fn hash_recovery(code: &str) -> String {
    Sha256::digest(code.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base32-Fixture aus den Tests von `totp-rs` (23 Bytes), kein Produktiv-Secret.
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
        // Base32 ohne Padding mit 160 Bit ergibt genau 32 Zeichen. Das Secret selbst gehört nicht
        // in
        // die Assert-Meldung, auch nicht als Testwert.
        assert_eq!(a.len(), 32);
        assert!(!a.contains('='), "Secret trägt Base32-Padding");
        let bytes = Secret::try_from_base32(&a).unwrap();
        assert_eq!(bytes.as_bytes().len(), 20);
    }

    /// RFC-6238-Anhang-B-Testvektoren (SHA1, 8 Stellen, auf 6 gekürzt): Algorithmus und
    /// Schrittweite stimmen, crate-unabhängig.
    #[test]
    fn rfc6238_testvektoren_mit_gespeichertem_base32_secret() {
        const RFC_SECRET_BASE32: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        for (zeit, code) in [
            (59, "287082"),
            (1_111_111_109, "081804"),
            (1_111_111_111, "050471"),
            (1_234_567_890, "005924"),
            (2_000_000_000, "279037"),
        ] {
            assert_eq!(
                generiere_code(RFC_SECRET_BASE32, zeit).as_deref(),
                Some(code),
                "t = {zeit}"
            );
            assert!(pruefe_code(RFC_SECRET_BASE32, code, zeit), "t = {zeit}");
        }
    }

    /// Golden-Pin gegen totp-rs 5.7.2: kippt dieser Test, erzeugen eingerichtete
    /// Authenticator-Apps andere Codes, als der Server prüft.
    #[test]
    fn codes_sind_identisch_zu_totp_rs_5() {
        for (zeit, code) in [
            (JETZT, "009897"),
            (JETZT - 30, "674507"),
            (JETZT + 30, "382211"),
        ] {
            assert_eq!(
                generiere_code(TEST_SECRET, zeit).as_deref(),
                Some(code),
                "t = {zeit}"
            );
        }
    }

    #[test]
    fn pruefe_code_skew_ist_genau_ein_schritt() {
        assert!(pruefe_code(
            TEST_SECRET,
            &generiere_code(TEST_SECRET, JETZT + 30).unwrap(),
            JETZT
        ));
        let zwei_schritte_frueher = generiere_code(TEST_SECRET, JETZT - 60).unwrap();
        let zwei_schritte_spaeter = generiere_code(TEST_SECRET, JETZT + 60).unwrap();
        let aktuell = generiere_code(TEST_SECRET, JETZT).unwrap();
        let nachbarn = [
            generiere_code(TEST_SECRET, JETZT - 30).unwrap(),
            generiere_code(TEST_SECRET, JETZT + 30).unwrap(),
        ];
        for fern in [zwei_schritte_frueher, zwei_schritte_spaeter] {
            // Zufällige Kollision mit einem Code im ±1-Fenster ausklammern.
            if fern != aktuell && !nachbarn.contains(&fern) {
                assert!(!pruefe_code(TEST_SECRET, &fern, JETZT), "Code: {fern}");
            }
        }
    }

    #[test]
    fn pruefe_code_lehnt_formabweichungen_und_korruptes_secret_ab() {
        let code = generiere_code(TEST_SECRET, JETZT).unwrap();
        assert!(!pruefe_code(TEST_SECRET, &format!(" {code}"), JETZT));
        assert!(!pruefe_code(
            TEST_SECRET,
            &format!("+{}", &code[1..]),
            JETZT
        ));
        assert!(!pruefe_code(TEST_SECRET, &code[..5], JETZT));
        assert!(!pruefe_code(TEST_SECRET, "", JETZT));
        assert!(!pruefe_code("kein-base32!", &code, JETZT));
        assert!(generiere_code("kein-base32!", JETZT).is_none());
    }

    /// Byte-Pin auf das bisherige otpauth-Format: `secret` vor `issuer`, keine Default-Parameter,
    /// Base32 ohne Padding, Label percent-kodiert.
    #[test]
    fn otpauth_url_ist_byte_gleich_zum_bisherigen_format() {
        assert_eq!(
            otpauth_url(TEST_SECRET, "max.mustermann").unwrap(),
            "otpauth://totp/lifeline-hub:max.mustermann\
             ?secret=OBWGC2LOFVZXI4TJNZTS243FMNZGK5BNGEZDG&issuer=lifeline-hub"
        );
        assert_eq!(
            otpauth_url(TEST_SECRET, "Max Muster@thw").unwrap(),
            "otpauth://totp/lifeline-hub:Max%20Muster%40thw\
             ?secret=OBWGC2LOFVZXI4TJNZTS243FMNZGK5BNGEZDG&issuer=lifeline-hub"
        );
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
