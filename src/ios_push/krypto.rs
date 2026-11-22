//! Verschlüsselung der Nutzlast an das Gerät (AES-256-GCM, OpenSSL) und der Abmelde-Nachweis.
//! Gemeinsamer Testvektor mit der iOS-Seite: `src-tauri/faelle/push-nutzlast.json`.

pub use crate::web_push::krypto::{b64, b64_lesen, KryptoFehler};
use openssl::hash::MessageDigest;
use openssl::pkey::PKey;
use openssl::sign::Signer;
use openssl::symm::{encrypt_aead, Cipher};

/// Länge des GCM-Tags.
const TAG: usize = 16;

/// Verschlüsselt `klartext` mit AES-256-GCM; die AAD ist die `kennung` der Anmeldung. Ergebnis:
/// Chiffrat gefolgt vom 16-Byte-Tag. Die Nonce (12 Byte, zufällig) wählt der Aufrufer und
/// verwendet sie nie zweimal mit demselben Schlüssel.
pub fn verschluesseln(
    schluessel: &[u8; 32],
    kennung: &str,
    klartext: &[u8],
    nonce: [u8; 12],
) -> Result<Vec<u8>, KryptoFehler> {
    let mut tag = [0u8; TAG];
    let mut chiffrat = encrypt_aead(
        Cipher::aes_256_gcm(),
        schluessel,
        Some(&nonce),
        kennung.as_bytes(),
        klartext,
        &mut tag,
    )?;
    chiffrat.extend_from_slice(&tag);
    Ok(chiffrat)
}

/// Der Umschlag, den das Relais als `umschlag` durchreicht: base64url von kompaktem JSON
/// `{"k":kennung,"n":nonce,"c":chiffrat}`, Felder base64url ohne Auffüllung.
pub fn umschlag(kennung: &str, nonce: &[u8; 12], chiffrat: &[u8]) -> String {
    let json = serde_json::json!({ "k": kennung, "n": b64(nonce), "c": b64(chiffrat) });
    b64(json.to_string().as_bytes())
}

/// Nachweis zum Abmelden ohne Sitzung: base64url(HMAC-SHA256(schluessel, "abmelden:" + kennung)).
pub fn nachweis(schluessel: &[u8; 32], kennung: &str) -> String {
    let rechnen = || -> Result<Vec<u8>, openssl::error::ErrorStack> {
        let key = PKey::hmac(schluessel)?;
        let mut signer = Signer::new(MessageDigest::sha256(), &key)?;
        signer.update(b"abmelden:")?;
        signer.update(kennung.as_bytes())?;
        signer.sign_to_vec()
    };
    b64(&rechnen().expect("HMAC-SHA256 ist in OpenSSL immer verfügbar"))
}
