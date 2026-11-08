//! Signierte Nachrichten zwischen gekoppelten Instanzen (design.md D3): kompaktes JWS mit EdDSA,
//! Muster DPoP/`private_key_jwt`. Vorgabe für LLH-1148 in ADR-0014.
//!
//! Selbst geschrieben, weil das Format fest ist: es gibt genau einen Algorithmus (`EdDSA`), und
//! jeder andere Kopf wird abgelehnt, bevor eine Signatur geprüft wird. Ein JWT-Crate müsste
//! Algorithmus-Verwirrung erst wieder ausschließen.

use super::basis32::{b64, parse_b64, sha256_b64};
use super::identitaet::Identitaet;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// `typ` einer Anfrage.
pub const TYP_ANFRAGE: &str = "lifeline-instanz+jwt";
/// `typ` einer Antwort.
pub const TYP_ANTWORT: &str = "lifeline-instanz-antwort+jwt";
/// Kopf, der eine Anfrage trägt: `Authorization: Instanz <jws>`.
pub const SCHEMA: &str = "Instanz";
/// Kopf, der eine Antwort trägt.
pub const ANTWORT_KOPF: &str = "lifeline-instanz-antwort";
/// Höchste Lebensdauer eines Tokens.
pub const LEBENSDAUER_S: i64 = 60;
/// Erlaubte Abweichung der Uhren beider Seiten.
pub const UHR_TOLERANZ_S: i64 = 300;

/// Kopf eines Tokens.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Kopf {
    pub alg: String,
    pub typ: String,
    /// Kennung der signierenden Instanz.
    pub kid: String,
}

/// Claims einer Anfrage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Anfrage {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub htm: String,
    pub htu: String,
    pub bh: String,
    pub pv: u32,
}

/// Claims einer Antwort.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Antwort {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    /// `jti` der Anfrage, auf die geantwortet wird.
    pub bezug: String,
    pub status: u16,
    pub bh: String,
    pub pv: u32,
}

/// Warum ein Token nicht gilt. Nach außen ist jeder Fall 401; die Unterscheidung dient Log und
/// Anzeige.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignaturError {
    Form,
    Algorithmus,
    Signatur,
    Ziel,
    Methode,
    Pfad,
    Body,
    Zeit,
    Bezug,
    Status,
}

impl std::fmt::Display for SignaturError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            SignaturError::Form => "Token unlesbar",
            SignaturError::Algorithmus => "Algorithmus oder Typ nicht erlaubt",
            SignaturError::Signatur => "Signatur ungültig",
            SignaturError::Ziel => "Token gilt einer anderen Instanz",
            SignaturError::Methode => "Methode passt nicht",
            SignaturError::Pfad => "Pfad passt nicht",
            SignaturError::Body => "Body passt nicht zum Hash",
            SignaturError::Zeit => "Token abgelaufen oder aus der Zukunft",
            SignaturError::Bezug => "Antwort gehört zu einer anderen Anfrage",
            SignaturError::Status => "Status passt nicht",
        };
        f.write_str(text)
    }
}

/// Neue zufällige `jti` (128 Bit).
pub fn new_jti() -> String {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut b = [0u8; 16];
    OsRng.fill_bytes(&mut b);
    b64(&b)
}

fn sign<C: Serialize>(identitaet: &Identitaet, typ: &str, claims: &C) -> String {
    let kopf = Kopf {
        alg: "EdDSA".to_string(),
        typ: typ.to_string(),
        kid: identitaet.kennung.clone(),
    };
    let eingabe = format!(
        "{}.{}",
        b64(&serde_json::to_vec(&kopf).expect("Kopf ist serialisierbar")),
        b64(&serde_json::to_vec(claims).expect("Claims sind serialisierbar"))
    );
    let sig = identitaet.sign(eingabe.as_bytes());
    format!("{eingabe}.{}", b64(&sig))
}

/// Liest den Kopf ohne Prüfung, um den Schlüssel zu finden (`kid`). Nur `alg = EdDSA` und der
/// erwartete `typ` kommen durch.
pub fn parse_kopf(token: &str, typ: &str) -> Result<Kopf, SignaturError> {
    let teil = token.split('.').next().ok_or(SignaturError::Form)?;
    let kopf: Kopf = parse_b64(teil)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(SignaturError::Form)?;
    if kopf.alg != "EdDSA" || kopf.typ != typ {
        return Err(SignaturError::Algorithmus);
    }
    Ok(kopf)
}

/// Prüft Kopf und Signatur und liefert die Claims.
fn verify<C: DeserializeOwned>(
    token: &str,
    typ: &str,
    schluessel: &VerifyingKey,
) -> Result<C, SignaturError> {
    let teile: Vec<&str> = token.split('.').collect();
    let [kopf_t, claims_t, sig_t] = teile.as_slice() else {
        return Err(SignaturError::Form);
    };
    parse_kopf(token, typ)?;
    let sig: [u8; 64] = parse_b64(sig_t)
        .and_then(|b| b.try_into().ok())
        .ok_or(SignaturError::Form)?;
    let eingabe = format!("{kopf_t}.{claims_t}");
    // `verify_strict` lehnt schwache Schlüssel und nicht-kanonische Signaturen ab.
    schluessel
        .verify_strict(eingabe.as_bytes(), &Signature::from_bytes(&sig))
        .map_err(|_| SignaturError::Signatur)?;
    parse_b64(claims_t)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(SignaturError::Form)
}

fn is_zeit_valid(iat: i64, exp: i64, jetzt: i64) -> bool {
    exp > iat
        && exp - iat <= LEBENSDAUER_S
        && iat <= jetzt + UHR_TOLERANZ_S
        && exp >= jetzt - UHR_TOLERANZ_S
}

/// Was eine Anfrage beschreibt, bevor sie signiert wird.
#[derive(Debug, Clone)]
pub struct AnfrageDraft<'a> {
    pub ziel_kennung: &'a str,
    pub methode: &'a str,
    pub pfad: &'a str,
    pub body: &'a [u8],
}

/// Signiert eine Anfrage; liefert Token und `jti`.
pub fn sign_anfrage(
    identitaet: &Identitaet,
    entwurf: &AnfrageDraft<'_>,
    jetzt: i64,
) -> (String, String) {
    let jti = new_jti();
    let claims = Anfrage {
        iss: identitaet.kennung.clone(),
        aud: entwurf.ziel_kennung.to_string(),
        iat: jetzt,
        exp: jetzt + LEBENSDAUER_S,
        jti: jti.clone(),
        htm: entwurf.methode.to_ascii_uppercase(),
        htu: entwurf.pfad.to_string(),
        bh: sha256_b64(entwurf.body),
        pv: super::PROTOKOLL,
    };
    (sign(identitaet, TYP_ANFRAGE, &claims), jti)
}

/// Prüft eine Anfrage gegen das, was beim Empfänger ankam. Den Wiederholschutz (`jti`) trägt der
/// Aufrufer, weil er die DB braucht.
#[allow(clippy::too_many_arguments)]
pub fn verify_anfrage(
    token: &str,
    schluessel: &VerifyingKey,
    absender_kennung: &str,
    eigene_kennung: &str,
    methode: &str,
    pfad: &str,
    body: &[u8],
    jetzt: i64,
) -> Result<Anfrage, SignaturError> {
    let c: Anfrage = verify(token, TYP_ANFRAGE, schluessel)?;
    if c.iss != absender_kennung || c.aud != eigene_kennung {
        return Err(SignaturError::Ziel);
    }
    if !c.htm.eq_ignore_ascii_case(methode) {
        return Err(SignaturError::Methode);
    }
    if c.htu != pfad {
        return Err(SignaturError::Pfad);
    }
    if c.bh != sha256_b64(body) {
        return Err(SignaturError::Body);
    }
    if !is_zeit_valid(c.iat, c.exp, jetzt) {
        return Err(SignaturError::Zeit);
    }
    Ok(c)
}

/// Signiert eine Antwort auf die Anfrage mit `bezug` an `ziel_kennung`.
pub fn sign_antwort(
    identitaet: &Identitaet,
    ziel_kennung: &str,
    bezug: &str,
    status: u16,
    body: &[u8],
    jetzt: i64,
) -> String {
    let claims = Antwort {
        iss: identitaet.kennung.clone(),
        aud: ziel_kennung.to_string(),
        iat: jetzt,
        exp: jetzt + LEBENSDAUER_S,
        jti: new_jti(),
        bezug: bezug.to_string(),
        status,
        bh: sha256_b64(body),
        pv: super::PROTOKOLL,
    };
    sign(identitaet, TYP_ANTWORT, &claims)
}

/// Prüft eine Antwort: Signatur des erwarteten Gegenübers, an uns, zur eigenen Anfrage, mit
/// demselben Status und Body.
#[allow(clippy::too_many_arguments)]
pub fn verify_antwort(
    token: &str,
    schluessel: &VerifyingKey,
    gegenueber_kennung: &str,
    eigene_kennung: &str,
    bezug: &str,
    status: u16,
    body: &[u8],
    jetzt: i64,
) -> Result<Antwort, SignaturError> {
    let c: Antwort = verify(token, TYP_ANTWORT, schluessel)?;
    if c.iss != gegenueber_kennung || c.aud != eigene_kennung {
        return Err(SignaturError::Ziel);
    }
    if c.bezug != bezug {
        return Err(SignaturError::Bezug);
    }
    if c.status != status {
        return Err(SignaturError::Status);
    }
    if c.bh != sha256_b64(body) {
        return Err(SignaturError::Body);
    }
    if !is_zeit_valid(c.iat, c.exp, jetzt) {
        return Err(SignaturError::Zeit);
    }
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instanz::identitaet::parse_oeffentlich;

    const JETZT: i64 = 1_800_000_000;

    fn elw() -> Identitaet {
        Identitaet::from_parts("elw", [1u8; 32])
    }
    fn hub() -> Identitaet {
        Identitaet::from_parts("hub", [2u8; 32])
    }
    fn pk(i: &Identitaet) -> VerifyingKey {
        parse_oeffentlich(&i.oeffentlich_b64()).unwrap()
    }
    fn entwurf<'a>(body: &'a [u8]) -> AnfrageDraft<'a> {
        AnfrageDraft {
            ziel_kennung: "hub",
            methode: "post",
            pfad: "/api/instanz/melden",
            body,
        }
    }
    fn pruefe(token: &str, body: &[u8], jetzt: i64) -> Result<Anfrage, SignaturError> {
        verify_anfrage(
            token,
            &pk(&elw()),
            "elw",
            "hub",
            "POST",
            "/api/instanz/melden",
            body,
            jetzt,
        )
    }

    #[test]
    fn gueltige_anfrage() {
        let (t, jti) = sign_anfrage(&elw(), &entwurf(b"{}"), JETZT);
        let c = pruefe(&t, b"{}", JETZT).unwrap();
        assert_eq!(c.jti, jti);
        assert_eq!(c.pv, crate::instanz::PROTOKOLL);
    }

    #[test]
    fn falsche_signatur_ziel_methode_pfad_body() {
        let (t, _) = sign_anfrage(&elw(), &entwurf(b"{}"), JETZT);
        // falscher Schlüssel
        assert_eq!(
            verify_anfrage(
                &t,
                &pk(&hub()),
                "elw",
                "hub",
                "POST",
                "/api/instanz/melden",
                b"{}",
                JETZT
            ),
            Err(SignaturError::Signatur)
        );
        // anderes Ziel
        assert_eq!(
            verify_anfrage(
                &t,
                &pk(&elw()),
                "elw",
                "hub2",
                "POST",
                "/api/instanz/melden",
                b"{}",
                JETZT
            ),
            Err(SignaturError::Ziel)
        );
        assert_eq!(
            verify_anfrage(
                &t,
                &pk(&elw()),
                "elw",
                "hub",
                "PUT",
                "/api/instanz/melden",
                b"{}",
                JETZT
            ),
            Err(SignaturError::Methode)
        );
        assert_eq!(
            verify_anfrage(
                &t,
                &pk(&elw()),
                "elw",
                "hub",
                "POST",
                "/api/instanz/widerruf",
                b"{}",
                JETZT
            ),
            Err(SignaturError::Pfad)
        );
        assert_eq!(pruefe(&t, b"{ }", JETZT), Err(SignaturError::Body));
    }

    #[test]
    fn veraenderte_claims_brechen_die_signatur() {
        let (t, _) = sign_anfrage(&elw(), &entwurf(b"{}"), JETZT);
        let teile: Vec<&str> = t.split('.').collect();
        let mut c: Anfrage = serde_json::from_slice(&parse_b64(teile[1]).unwrap()).unwrap();
        c.exp += 1;
        let falsch = format!(
            "{}.{}.{}",
            teile[0],
            b64(&serde_json::to_vec(&c).unwrap()),
            teile[2]
        );
        assert_eq!(pruefe(&falsch, b"{}", JETZT), Err(SignaturError::Signatur));
    }

    #[test]
    fn zeitfenster() {
        let (t, _) = sign_anfrage(&elw(), &entwurf(b"{}"), JETZT);
        assert!(
            pruefe(&t, b"{}", JETZT + 60 + 290).is_ok(),
            "Uhr 290 s nach"
        );
        assert_eq!(
            pruefe(&t, b"{}", JETZT + 60 + 310),
            Err(SignaturError::Zeit),
            "abgelaufen"
        );
        assert!(pruefe(&t, b"{}", JETZT - 290).is_ok(), "Uhr 290 s vor");
        assert_eq!(pruefe(&t, b"{}", JETZT - 310), Err(SignaturError::Zeit));
    }

    #[test]
    fn zu_lange_lebensdauer_wird_abgelehnt() {
        let i = elw();
        let claims = Anfrage {
            iss: "elw".into(),
            aud: "hub".into(),
            iat: JETZT,
            exp: JETZT + 61,
            jti: "x".into(),
            htm: "POST".into(),
            htu: "/api/instanz/melden".into(),
            bh: sha256_b64(b"{}"),
            pv: 1,
        };
        let t = sign(&i, TYP_ANFRAGE, &claims);
        assert_eq!(pruefe(&t, b"{}", JETZT), Err(SignaturError::Zeit));
    }

    #[test]
    fn fremde_algorithmen_und_typen_werden_abgelehnt() {
        let (t, _) = sign_anfrage(&elw(), &entwurf(b"{}"), JETZT);
        let teile: Vec<&str> = t.split('.').collect();
        for kopf in [
            r#"{"alg":"none","typ":"lifeline-instanz+jwt","kid":"elw"}"#,
            r#"{"alg":"HS256","typ":"lifeline-instanz+jwt","kid":"elw"}"#,
            r#"{"alg":"EdDSA","typ":"lifeline-instanz-antwort+jwt","kid":"elw"}"#,
        ] {
            let falsch = format!("{}.{}.{}", b64(kopf.as_bytes()), teile[1], teile[2]);
            assert_eq!(
                pruefe(&falsch, b"{}", JETZT),
                Err(SignaturError::Algorithmus)
            );
        }
        let ohne_sig = format!("{}.{}.", teile[0], teile[1]);
        assert_eq!(pruefe(&ohne_sig, b"{}", JETZT), Err(SignaturError::Form));
        assert_eq!(pruefe("a.b", b"{}", JETZT), Err(SignaturError::Form));
    }

    #[test]
    fn antwort_gehoert_zur_anfrage() {
        let t = sign_antwort(&hub(), "elw", "jti-1", 200, b"{\"ok\":1}", JETZT);
        let ok = verify_antwort(
            &t,
            &pk(&hub()),
            "hub",
            "elw",
            "jti-1",
            200,
            b"{\"ok\":1}",
            JETZT,
        );
        assert!(ok.is_ok());
        assert_eq!(
            verify_antwort(
                &t,
                &pk(&hub()),
                "hub",
                "elw",
                "jti-2",
                200,
                b"{\"ok\":1}",
                JETZT
            ),
            Err(SignaturError::Bezug)
        );
        assert_eq!(
            verify_antwort(
                &t,
                &pk(&hub()),
                "hub",
                "elw",
                "jti-1",
                200,
                b"{\"ok\":2}",
                JETZT
            ),
            Err(SignaturError::Body)
        );
        assert_eq!(
            verify_antwort(
                &t,
                &pk(&hub()),
                "hub",
                "elw",
                "jti-1",
                410,
                b"{\"ok\":1}",
                JETZT
            ),
            Err(SignaturError::Status)
        );
        assert_eq!(
            verify_antwort(
                &t,
                &pk(&elw()),
                "hub",
                "elw",
                "jti-1",
                200,
                b"{\"ok\":1}",
                JETZT
            ),
            Err(SignaturError::Signatur)
        );
        // Eine Anfrage ist keine Antwort.
        let (anfrage, _) = sign_anfrage(&hub(), &entwurf(b"{}"), JETZT);
        assert_eq!(
            verify_antwort(
                &anfrage,
                &pk(&hub()),
                "hub",
                "elw",
                "jti-1",
                200,
                b"{}",
                JETZT
            ),
            Err(SignaturError::Algorithmus)
        );
    }
}
