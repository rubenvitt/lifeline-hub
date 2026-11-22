//! Verschlüsselung der Nutzlast an das Gerät (AES-256-GCM, OpenSSL) und der Abmelde-Nachweis.
//! Gemeinsamer Testvektor mit der iOS-Seite: `src-tauri/faelle/push-nutzlast.json`.

pub use crate::web_push::krypto::{b64, b64_lesen, KryptoFehler};
use openssl::hash::MessageDigest;
use openssl::pkey::PKey;
use openssl::sign::Signer;
use openssl::symm::{decrypt_aead, encrypt_aead, Cipher};

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

/// Gegenstück zu [`verschluesseln`] aus Sicht des Geräts (Notification Service Extension).
/// Der Server braucht es nicht; Tests prüfen damit, was das Relais zu sehen bekäme.
pub fn entschluesseln(
    schluessel: &[u8; 32],
    kennung: &str,
    nonce: &[u8; 12],
    chiffrat_mit_tag: &[u8],
) -> Result<Vec<u8>, KryptoFehler> {
    let Some(teil) = chiffrat_mit_tag.len().checked_sub(TAG) else {
        return Err(KryptoFehler("Chiffrat kürzer als das Tag".into()));
    };
    let (chiffrat, tag) = chiffrat_mit_tag.split_at(teil);
    Ok(decrypt_aead(
        Cipher::aes_256_gcm(),
        schluessel,
        Some(nonce),
        kennung.as_bytes(),
        chiffrat,
        tag,
    )?)
}

/// Liest einen [`umschlag`]: Kennung, Nonce, Chiffrat samt Tag. `None`, wenn er nicht die Form
/// hat. Wie [`entschluesseln`] nur für die Gegenseite und Tests.
pub fn umschlag_lesen(umschlag: &str) -> Option<(String, [u8; 12], Vec<u8>)> {
    let json: serde_json::Value = serde_json::from_slice(&b64_lesen(umschlag)?).ok()?;
    let kennung = json.get("k")?.as_str()?.to_owned();
    let nonce = <[u8; 12]>::try_from(b64_lesen(json.get("n")?.as_str()?)?).ok()?;
    let chiffrat = b64_lesen(json.get("c")?.as_str()?)?;
    Some((kennung, nonce, chiffrat))
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
