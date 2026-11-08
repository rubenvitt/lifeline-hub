//! Prüft eine Passkey-Unterschrift über eine vorgegebene Erklärung (design.md D8, Spec
//! `org-admin-unterschrift`), ohne `webauthn-rs`: die Challenge ist der SHA-256 der Erklärung,
//! nicht ein Zufallswert des Servers, und der Passkey kann an einer anderen Instanz registriert
//! sein. LLH-1491 nutzt denselben Prüfer für die Notübernahme.
//!
//! Geprüft werden `clientDataJSON` (Typ, Challenge, Herkunft), `authenticatorData` (RP-ID-Hash,
//! Nutzerpräsenz UP, Nutzerverifikation UV) und die ES256-Signatur über
//! `authenticatorData ‖ SHA-256(clientDataJSON)`. Der Signaturzähler bleibt ungeprüft: Passkeys
//! melden oft 0, und eine Erklärung wird nicht wiederholt gezählt, sondern einmal gebunden.

use crate::instanz::basis32::{b64, parse_b64};
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

/// Eine UnterschriftAssertion, wie der Browser sie aus `navigator.credentials.get` liefert (Base64url).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
pub struct UnterschriftAssertion {
    pub credential_id: String,
    pub authenticator_data: String,
    pub client_data_json: String,
    pub signatur: String,
}

/// Der Schlüssel, gegen den geprüft wird.
#[derive(Debug, Clone)]
pub struct VerifySchluessel<'a> {
    pub credential_id: &'a str,
    /// Unkomprimierter SEC1-Punkt (65 Byte), Base64url.
    pub schluessel: &'a str,
    pub rp_id: &'a str,
    pub origin: &'a str,
}

/// Warum eine Unterschrift nicht gilt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    Form,
    Schluessel,
    Credential,
    Typ,
    Challenge,
    Herkunft,
    RpId,
    Praesenz,
    Verifikation,
    Signatur,
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            VerifyError::Form => "Unterschrift unlesbar",
            VerifyError::Schluessel => "Schlüssel unlesbar",
            VerifyError::Credential => "anderer Schlüssel",
            VerifyError::Typ => "keine Unterschrift (falscher Typ)",
            VerifyError::Challenge => "gilt einer anderen Erklärung",
            VerifyError::Herkunft => "falsche Herkunft",
            VerifyError::RpId => "falsche Instanz (RP-ID)",
            VerifyError::Praesenz => "ohne Nutzerpräsenz",
            VerifyError::Verifikation => "ohne Nutzerverifikation",
            VerifyError::Signatur => "Signatur ungültig",
        };
        f.write_str(text)
    }
}

#[derive(Deserialize)]
struct ClientData {
    #[serde(rename = "type")]
    typ: String,
    challenge: String,
    origin: String,
}

/// Flags in `authenticatorData[32]`.
const FLAG_UP: u8 = 0x01;
const FLAG_UV: u8 = 0x04;

/// SHA-256 der Erklärung; das ist die Challenge.
pub fn erklaerung_hash(erklaerung: &str) -> [u8; 32] {
    Sha256::digest(erklaerung.as_bytes()).into()
}

/// Challenge zu einer Erklärung, wie sie im `clientDataJSON` steht und wie der Browser sie
/// braucht (Base64url).
pub fn challenge(erklaerung: &str) -> String {
    b64(&erklaerung_hash(erklaerung))
}

/// Prüft `assertion` als Unterschrift über `erklaerung` mit `schluessel`.
pub fn verify(
    erklaerung: &str,
    assertion: &UnterschriftAssertion,
    schluessel: &VerifySchluessel<'_>,
) -> Result<(), VerifyError> {
    if assertion.credential_id != schluessel.credential_id {
        return Err(VerifyError::Credential);
    }
    let auth_data = parse_b64(&assertion.authenticator_data).ok_or(VerifyError::Form)?;
    let cdj = parse_b64(&assertion.client_data_json).ok_or(VerifyError::Form)?;
    let sig = parse_b64(&assertion.signatur).ok_or(VerifyError::Form)?;
    let client: ClientData = serde_json::from_slice(&cdj).map_err(|_| VerifyError::Form)?;
    if client.typ != "webauthn.get" {
        return Err(VerifyError::Typ);
    }
    if client.challenge != challenge(erklaerung) {
        return Err(VerifyError::Challenge);
    }
    if client.origin != schluessel.origin {
        return Err(VerifyError::Herkunft);
    }
    if auth_data.len() < 37 {
        return Err(VerifyError::Form);
    }
    if auth_data[..32] != Sha256::digest(schluessel.rp_id.as_bytes())[..] {
        return Err(VerifyError::RpId);
    }
    let flags = auth_data[32];
    if flags & FLAG_UP == 0 {
        return Err(VerifyError::Praesenz);
    }
    if flags & FLAG_UV == 0 {
        return Err(VerifyError::Verifikation);
    }
    let punkt = parse_b64(schluessel.schluessel).ok_or(VerifyError::Schluessel)?;
    let vk = VerifyingKey::from_sec1_bytes(&punkt).map_err(|_| VerifyError::Schluessel)?;
    let sig = Signature::from_der(&sig).map_err(|_| VerifyError::Signatur)?;
    let mut nachricht = auth_data;
    nachricht.extend_from_slice(&Sha256::digest(&cdj));
    vk.verify(&nachricht, &sig)
        .map_err(|_| VerifyError::Signatur)
}

/// Für Tests (hier und in `tests/`): ein Software-Authenticator mit festem P-256-Schlüssel, der
/// Assertions über eine Erklärung erzeugt, wie ein Browser sie liefern würde.
#[doc(hidden)]
pub mod test_authenticator {
    use super::*;
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::SigningKey;

    pub struct SoftwarePasskey {
        pub credential_id: String,
        schluessel: SigningKey,
    }

    impl SoftwarePasskey {
        pub fn new(credential_id: &str, geheim: [u8; 32]) -> Self {
            SoftwarePasskey {
                credential_id: credential_id.to_string(),
                schluessel: SigningKey::from_bytes(&geheim.into()).expect("gültiger Skalar"),
            }
        }

        /// Öffentlicher Schlüssel als unkomprimierter SEC1-Punkt, Base64url.
        pub fn oeffentlich(&self) -> String {
            b64(self
                .schluessel
                .verifying_key()
                .to_encoded_point(false)
                .as_bytes())
        }

        /// Unterschreibt `erklaerung` wie ein Browser an `origin`/`rp_id`, mit den Flags
        /// `flags` (UP|UV = 0x05).
        pub fn sign(
            &self,
            erklaerung: &str,
            origin: &str,
            rp_id: &str,
            flags: u8,
        ) -> UnterschriftAssertion {
            self.sign_raw(&challenge(erklaerung), "webauthn.get", origin, rp_id, flags)
        }

        pub fn sign_raw(
            &self,
            challenge: &str,
            typ: &str,
            origin: &str,
            rp_id: &str,
            flags: u8,
        ) -> UnterschriftAssertion {
            let cdj = serde_json::json!({"type": typ, "challenge": challenge, "origin": origin})
                .to_string();
            let mut auth_data = Sha256::digest(rp_id.as_bytes()).to_vec();
            auth_data.push(flags);
            auth_data.extend_from_slice(&[0, 0, 0, 0]);
            let mut nachricht = auth_data.clone();
            nachricht.extend_from_slice(&Sha256::digest(cdj.as_bytes()));
            let sig: Signature = self.schluessel.sign(&nachricht);
            UnterschriftAssertion {
                credential_id: self.credential_id.clone(),
                authenticator_data: b64(&auth_data),
                client_data_json: b64(cdj.as_bytes()),
                signatur: b64(sig.to_der().as_bytes()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_authenticator::SoftwarePasskey;
    use super::*;

    const ORIGIN: &str = "https://hub.example.org";
    const RP: &str = "hub.example.org";
    const ERKL: &str = r#"{"typ":"test","wert":1}"#;

    fn passkey() -> SoftwarePasskey {
        SoftwarePasskey::new("cred-a", [5u8; 32])
    }

    fn pruefe_mit(
        p: &SoftwarePasskey,
        erklaerung: &str,
        a: &UnterschriftAssertion,
    ) -> Result<(), VerifyError> {
        let oeff = p.oeffentlich();
        verify(
            erklaerung,
            a,
            &VerifySchluessel {
                credential_id: "cred-a",
                schluessel: &oeff,
                rp_id: RP,
                origin: ORIGIN,
            },
        )
    }

    #[test]
    fn gueltige_unterschrift() {
        let p = passkey();
        let a = p.sign(ERKL, ORIGIN, RP, 0x05);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Ok(()));
    }

    #[test]
    fn andere_erklaerung() {
        let p = passkey();
        let a = p.sign(ERKL, ORIGIN, RP, 0x05);
        assert_eq!(
            pruefe_mit(&p, r#"{"typ":"test","wert":2}"#, &a),
            Err(VerifyError::Challenge)
        );
    }

    #[test]
    fn falsche_rp_id_herkunft_typ() {
        let p = passkey();
        let a = p.sign(ERKL, ORIGIN, "elw.example.org", 0x05);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::RpId));
        let a = p.sign(ERKL, "https://boese.example", RP, 0x05);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Herkunft));
        let a = p.sign_raw(&challenge(ERKL), "webauthn.create", ORIGIN, RP, 0x05);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Typ));
    }

    #[test]
    fn ohne_praesenz_oder_verifikation() {
        let p = passkey();
        let a = p.sign(ERKL, ORIGIN, RP, 0x04);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Praesenz));
        let a = p.sign(ERKL, ORIGIN, RP, 0x01);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Verifikation));
    }

    #[test]
    fn fremder_schluessel_oder_veraenderte_daten() {
        let p = passkey();
        let fremd = SoftwarePasskey::new("cred-a", [6u8; 32]);
        let a = fremd.sign(ERKL, ORIGIN, RP, 0x05);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Signatur));

        let mut a = p.sign(ERKL, ORIGIN, RP, 0x05);
        let mut ad = parse_b64(&a.authenticator_data).unwrap();
        ad[33] ^= 1; // Zähler verändert
        a.authenticator_data = b64(&ad);
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Signatur));

        let mut a = p.sign(ERKL, ORIGIN, RP, 0x05);
        a.credential_id = "cred-b".into();
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Credential));

        let mut a = p.sign(ERKL, ORIGIN, RP, 0x05);
        a.signatur = "kaputt!".into();
        assert_eq!(pruefe_mit(&p, ERKL, &a), Err(VerifyError::Form));
    }
}
