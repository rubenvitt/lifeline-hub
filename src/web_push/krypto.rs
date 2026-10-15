//! Verschlüsselung und VAPID für Web Push (LLH-1223, design.md D4), mit dem ohnehin
//! eingebackenen OpenSSL (`Cargo.toml`, Eintrag `openssl`) statt einer eigenen Krypto-Crate.
//!
//! - Nutzlast nach RFC 8291 (`aes128gcm`, ein Datensatz): ECDH P-256 mit dem Schlüssel des
//!   Browsers, HKDF-SHA-256 mit seinem `auth`-Geheimnis, AES-128-GCM. Nachweis über den Testvektor
//!   aus RFC 8291, Anhang A (`tests`).
//! - Token nach RFC 8292 (VAPID): JWT mit ES256, signiert mit dem Schlüssel der Instanz.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
#[cfg(test)]
use openssl::bn::BigNum;
use openssl::bn::BigNumContext;
use openssl::derive::Deriver;
use openssl::ec::{EcGroup, EcKey, EcPoint, PointConversionForm};
use openssl::ecdsa::EcdsaSig;
use openssl::error::ErrorStack;
use openssl::hash::MessageDigest;
use openssl::nid::Nid;
use openssl::pkey::{PKey, Private, Public};
use openssl::sign::Signer;
use openssl::symm::{encrypt_aead, Cipher};

/// Länge eines unkomprimierten P-256-Punkts (`0x04 || x || y`).
pub const PUNKT_LAENGE: usize = 65;
/// Länge des `auth`-Geheimnisses des Browsers (RFC 8291, Abschnitt 3.2).
pub const AUTH_LAENGE: usize = 16;
/// Datensatzgröße im Kopf der Nachricht. Die Nutzlast passt immer in einen Datensatz.
const DATENSATZ: u32 = 4096;

/// Fehler beim Verschlüsseln oder Signieren; kommt nur aus OpenSSL oder einem kaputten
/// Schlüssel des Browsers.
#[derive(Debug)]
pub struct KryptoFehler(pub String);

impl std::fmt::Display for KryptoFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for KryptoFehler {}

impl From<ErrorStack> for KryptoFehler {
    fn from(e: ErrorStack) -> Self {
        KryptoFehler(e.to_string())
    }
}

fn gruppe() -> Result<EcGroup, ErrorStack> {
    EcGroup::from_curve_name(Nid::X9_62_PRIME256V1)
}

/// Base64url ohne Auffüllung, wie Browser und RFC 8292 es schreiben.
pub fn b64(daten: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(daten)
}

/// Liest Base64url mit oder ohne Auffüllung (`PushSubscription.toJSON()` schreibt ohne, ältere
/// Browser mit).
pub fn b64_lesen(text: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(text.trim_end_matches('=')).ok()
}

/// Das VAPID-Schlüsselpaar der Instanz.
#[derive(Clone)]
pub struct Schluessel {
    privat: PKey<Private>,
    /// Unkomprimierter öffentlicher Punkt, so wie ihn `applicationServerKey` erwartet.
    oeffentlich: Vec<u8>,
}

impl std::fmt::Debug for Schluessel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Nie den privaten Schlüssel ausgeben.
        f.debug_struct("Schluessel")
            .field("oeffentlich", &b64(&self.oeffentlich))
            .finish_non_exhaustive()
    }
}

impl Schluessel {
    /// Erzeugt ein neues Paar auf P-256.
    pub fn erzeugen() -> Result<Self, KryptoFehler> {
        let g = gruppe()?;
        let ec = EcKey::generate(&g)?;
        Self::aus_ec(ec)
    }

    /// Liest ein gespeichertes Paar (privater Schlüssel als PKCS#8-DER).
    pub fn aus_pkcs8(der: &[u8]) -> Result<Self, KryptoFehler> {
        let pkey = PKey::private_key_from_pkcs8(der)?;
        Self::aus_ec(pkey.ec_key()?)
    }

    fn aus_ec(ec: EcKey<Private>) -> Result<Self, KryptoFehler> {
        let g = gruppe()?;
        if ec.group().curve_name() != Some(Nid::X9_62_PRIME256V1) {
            return Err(KryptoFehler("Schlüssel liegt nicht auf P-256".into()));
        }
        let oeffentlich = punkt_bytes(&g, ec.public_key())?;
        Ok(Self {
            privat: PKey::from_ec_key(ec)?,
            oeffentlich,
        })
    }

    /// Privater Schlüssel als PKCS#8-DER, zum Speichern.
    pub fn pkcs8(&self) -> Result<Vec<u8>, KryptoFehler> {
        Ok(self.privat.private_key_to_pkcs8()?)
    }

    /// Öffentlicher Schlüssel, unkomprimiert (65 Byte).
    pub fn oeffentlich(&self) -> &[u8] {
        &self.oeffentlich
    }

    /// VAPID-Token (RFC 8292) für den Ursprung `aud` eines Push-Dienstes, gültig bis `exp`
    /// (Unix-Sekunden), mit dem Kontakt `sub`. Liefert den Wert der Kopfzeile `Authorization`.
    pub fn vapid_kopf(&self, aud: &str, exp: i64, sub: &str) -> Result<String, KryptoFehler> {
        let kopf = b64(br#"{"typ":"JWT","alg":"ES256"}"#);
        let ansprueche = serde_json::json!({ "aud": aud, "exp": exp, "sub": sub });
        let rumpf = b64(ansprueche.to_string().as_bytes());
        let eingabe = format!("{kopf}.{rumpf}");
        let digest = openssl::hash::hash(MessageDigest::sha256(), eingabe.as_bytes())?;
        let sig = EcdsaSig::sign(&digest, self.privat.ec_key()?.as_ref())?;
        // JOSE verlangt r || s mit je 32 Byte, nicht die DER-Form von OpenSSL.
        let mut roh = sig.r().to_vec_padded(32)?;
        roh.extend(sig.s().to_vec_padded(32)?);
        Ok(format!(
            "vapid t={eingabe}.{}, k={}",
            b64(&roh),
            b64(&self.oeffentlich)
        ))
    }
}

fn punkt_bytes(g: &EcGroup, p: &openssl::ec::EcPointRef) -> Result<Vec<u8>, ErrorStack> {
    let mut ctx = BigNumContext::new()?;
    p.to_bytes(g, PointConversionForm::UNCOMPRESSED, &mut ctx)
}

/// Prüft und liest den öffentlichen Schlüssel des Browsers (`p256dh`).
pub fn browser_schluessel(p256dh: &[u8]) -> Result<PKey<Public>, KryptoFehler> {
    if p256dh.len() != PUNKT_LAENGE || p256dh[0] != 0x04 {
        return Err(KryptoFehler(
            "p256dh ist kein unkomprimierter P-256-Punkt".into(),
        ));
    }
    let g = gruppe()?;
    let mut ctx = BigNumContext::new()?;
    let punkt = EcPoint::from_bytes(&g, p256dh, &mut ctx)?;
    let ec = EcKey::from_public_key(&g, &punkt)?;
    ec.check_key()?;
    Ok(PKey::from_ec_key(ec)?)
}

fn hmac(schluessel: &[u8], teile: &[&[u8]]) -> Result<Vec<u8>, ErrorStack> {
    let pkey = PKey::hmac(schluessel)?;
    let mut s = Signer::new(MessageDigest::sha256(), &pkey)?;
    for t in teile {
        s.update(t)?;
    }
    s.sign_to_vec()
}

/// Verschlüsselt `klartext` für einen Browser (RFC 8291) mit einem frischen Schlüssel und Salz.
pub fn verschluesseln(
    klartext: &[u8],
    p256dh: &[u8],
    auth: &[u8],
) -> Result<Vec<u8>, KryptoFehler> {
    let g = gruppe()?;
    let ec = EcKey::generate(&g)?;
    let mut salz = [0u8; 16];
    openssl::rand::rand_bytes(&mut salz)?;
    verschluesseln_mit(klartext, p256dh, auth, ec, &salz)
}

/// Kern von [`verschluesseln`] mit festem Absenderschlüssel und Salz (Testvektor).
fn verschluesseln_mit(
    klartext: &[u8],
    p256dh: &[u8],
    auth: &[u8],
    absender: EcKey<Private>,
    salz: &[u8; 16],
) -> Result<Vec<u8>, KryptoFehler> {
    if auth.len() != AUTH_LAENGE {
        return Err(KryptoFehler("auth ist nicht 16 Byte lang".into()));
    }
    // Ein Datensatz: Klartext, Trenner 0x02, 16 Byte Tag, dazu 86 Byte Kopf.
    if klartext.len() + 1 + 16 > DATENSATZ as usize {
        return Err(KryptoFehler("Nutzlast zu groß für einen Datensatz".into()));
    }
    let g = gruppe()?;
    let ua_oeffentlich = browser_schluessel(p256dh)?;
    let as_oeffentlich = punkt_bytes(&g, absender.public_key())?;
    let as_privat = PKey::from_ec_key(absender)?;

    let mut deriver = Deriver::new(&as_privat)?;
    deriver.set_peer(&ua_oeffentlich)?;
    let ecdh = deriver.derive_to_vec()?;

    // RFC 8291, Abschnitt 3.4: IKM aus ECDH und auth, dann RFC 8188 für Schlüssel und Nonce.
    let prk_key = hmac(auth, &[&ecdh])?;
    let ikm = hmac(
        &prk_key,
        &[b"WebPush: info\0", p256dh, &as_oeffentlich, &[1]],
    )?;
    let prk = hmac(salz, &[&ikm])?;
    let cek = hmac(&prk, &[b"Content-Encoding: aes128gcm\0", &[1]])?;
    let nonce = hmac(&prk, &[b"Content-Encoding: nonce\0", &[1]])?;

    let mut daten = klartext.to_vec();
    daten.push(0x02);
    let mut tag = [0u8; 16];
    let chiffre = encrypt_aead(
        Cipher::aes_128_gcm(),
        &cek[..16],
        Some(&nonce[..12]),
        &[],
        &daten,
        &mut tag,
    )?;

    let mut nachricht = Vec::with_capacity(86 + chiffre.len() + 16);
    nachricht.extend_from_slice(salz);
    nachricht.extend_from_slice(&DATENSATZ.to_be_bytes());
    nachricht.push(PUNKT_LAENGE as u8);
    nachricht.extend_from_slice(&as_oeffentlich);
    nachricht.extend_from_slice(&chiffre);
    nachricht.extend_from_slice(&tag);
    Ok(nachricht)
}

/// Gegenstück zu [`verschluesseln`] aus Sicht des Browsers mit dessen Schlüsselpaar `ua`. Der
/// Server braucht es nicht; Tests prüfen damit, was ein Push-Dienst zu sehen bekäme.
pub fn entschluesseln(
    nachricht: &[u8],
    ua: &Schluessel,
    auth: &[u8],
) -> Result<Vec<u8>, KryptoFehler> {
    if nachricht.len() < 86 + 16 || nachricht[20] as usize != PUNKT_LAENGE {
        return Err(KryptoFehler("Kopf der Nachricht kaputt".into()));
    }
    let salz = &nachricht[..16];
    let as_oeffentlich = &nachricht[21..86];
    let (chiffre, tag) = nachricht[86..].split_at(nachricht.len() - 86 - 16);

    let as_schluessel = browser_schluessel(as_oeffentlich)?;
    let mut deriver = Deriver::new(&ua.privat)?;
    deriver.set_peer(&as_schluessel)?;
    let ecdh = deriver.derive_to_vec()?;
    let prk_key = hmac(auth, &[&ecdh])?;
    let ikm = hmac(
        &prk_key,
        &[b"WebPush: info\0", ua.oeffentlich(), as_oeffentlich, &[1]],
    )?;
    let prk = hmac(salz, &[&ikm])?;
    let cek = hmac(&prk, &[b"Content-Encoding: aes128gcm\0", &[1]])?;
    let nonce = hmac(&prk, &[b"Content-Encoding: nonce\0", &[1]])?;
    let mut klar = openssl::symm::decrypt_aead(
        Cipher::aes_128_gcm(),
        &cek[..16],
        Some(&nonce[..12]),
        &[],
        chiffre,
        tag,
    )?;
    if klar.pop() != Some(0x02) {
        return Err(KryptoFehler("Trenner des letzten Datensatzes fehlt".into()));
    }
    Ok(klar)
}

/// Baut einen privaten P-256-Schlüssel aus seinem Skalar (nur Testvektoren).
#[cfg(test)]
fn ec_aus_skalar(d: &[u8]) -> EcKey<Private> {
    let g = gruppe().unwrap();
    let skalar = BigNum::from_slice(d).unwrap();
    let mut ctx = BigNumContext::new().unwrap();
    let mut punkt = EcPoint::new(&g).unwrap();
    punkt.mul_generator2(&g, &skalar, &mut ctx).unwrap();
    EcKey::from_private_components(&g, &skalar, &punkt).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Vec<u8> {
        b64_lesen(s).unwrap()
    }

    /// RFC 8291, Anhang A: fester Absenderschlüssel und Salz ergeben exakt die Nachricht des RFC.
    #[test]
    fn rfc_8291_anhang_a_ergibt_die_nachricht_des_rfc() {
        let klartext = d("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24");
        let as_privat = ec_aus_skalar(&d("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"));
        let ua_oeffentlich = d("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
        let auth = d("BTBZMqHH6r4Tts7J_aSIgg");
        let salz: [u8; 16] = d("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();

        let nachricht =
            verschluesseln_mit(&klartext, &ua_oeffentlich, &auth, as_privat, &salz).unwrap();

        assert_eq!(
            b64(&nachricht),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn entschluesseln_kehrt_verschluesseln_um() {
        let ua = Schluessel::erzeugen().unwrap();
        let auth = [9u8; 16];
        let n = verschluesseln(br#"{"a":1}"#, ua.oeffentlich(), &auth).unwrap();
        assert_eq!(entschluesseln(&n, &ua, &auth).unwrap(), br#"{"a":1}"#);
        assert!(
            entschluesseln(&n, &ua, &[8u8; 16]).is_err(),
            "falsches auth"
        );
    }

    #[test]
    fn frische_nachricht_hat_eigenes_salz_und_eigenen_absender() {
        let ua = Schluessel::erzeugen().unwrap();
        let auth = [7u8; 16];
        let a = verschluesseln(b"x", ua.oeffentlich(), &auth).unwrap();
        let b = verschluesseln(b"x", ua.oeffentlich(), &auth).unwrap();
        assert_ne!(a[..16], b[..16], "Salz");
        assert_ne!(a[21..86], b[21..86], "Absenderschlüssel");
        assert_eq!(a.len(), 86 + 1 + 1 + 16);
    }

    #[test]
    fn kaputter_browserschluessel_wird_abgelehnt() {
        assert!(
            browser_schluessel(&[4u8; 65]).is_err(),
            "kein Punkt der Kurve"
        );
        assert!(browser_schluessel(&[4u8; 33]).is_err(), "falsche Länge");
        assert!(
            verschluesseln(b"x", Schluessel::erzeugen().unwrap().oeffentlich(), &[0; 8]).is_err()
        );
    }

    #[test]
    fn schluessel_uebersteht_speichern_und_laden() {
        let s = Schluessel::erzeugen().unwrap();
        let geladen = Schluessel::aus_pkcs8(&s.pkcs8().unwrap()).unwrap();
        assert_eq!(s.oeffentlich(), geladen.oeffentlich());
        assert_eq!(s.oeffentlich().len(), PUNKT_LAENGE);
        assert!(!format!("{s:?}").contains(&b64(&s.pkcs8().unwrap())));
    }

    /// RFC 8292: Token aus Kopf, Ansprüchen und ES256-Signatur (r || s), prüfbar mit dem
    /// öffentlichen Schlüssel aus `k`.
    #[test]
    fn vapid_token_ist_mit_dem_oeffentlichen_schluessel_pruefbar() {
        let s = Schluessel::erzeugen().unwrap();
        let wert = s
            .vapid_kopf(
                "https://fcm.googleapis.com",
                1_800_000_000,
                "mailto:betrieb@example.org",
            )
            .unwrap();
        let rest = wert.strip_prefix("vapid t=").unwrap();
        let (token, k) = rest.split_once(", k=").unwrap();
        assert_eq!(d(k), s.oeffentlich());

        let mut teile = token.split('.');
        let (kopf, rumpf, sig) = (
            teile.next().unwrap(),
            teile.next().unwrap(),
            teile.next().unwrap(),
        );
        let kopf: serde_json::Value = serde_json::from_slice(&d(kopf)).unwrap();
        assert_eq!(kopf["alg"], "ES256");
        let rumpf_json: serde_json::Value = serde_json::from_slice(&d(rumpf)).unwrap();
        assert_eq!(rumpf_json["aud"], "https://fcm.googleapis.com");
        assert_eq!(rumpf_json["exp"], 1_800_000_000);
        assert_eq!(rumpf_json["sub"], "mailto:betrieb@example.org");

        let roh = d(sig);
        assert_eq!(roh.len(), 64);
        let sig = EcdsaSig::from_private_components(
            BigNum::from_slice(&roh[..32]).unwrap(),
            BigNum::from_slice(&roh[32..]).unwrap(),
        )
        .unwrap();
        let digest = openssl::hash::hash(
            MessageDigest::sha256(),
            format!("{}.{}", token.split('.').next().unwrap(), rumpf).as_bytes(),
        )
        .unwrap();
        let oeffentlich = browser_schluessel(s.oeffentlich()).unwrap();
        assert!(sig
            .verify(&digest, oeffentlich.ec_key().unwrap().as_ref())
            .unwrap());
    }
}
