//! Referenz-Client für den Maschinenzugang der öffentlichen API von Lifeline Hub (ADR-0022,
//! Doku `docs/api/maschinenzugang.md`).
//!
//! Ablauf:
//! 1. Ein Admin legt unter „Anbindungen“ einen Zugang an und gibt den Einmal-Code weiter.
//! 2. [`prepare_redeem`] erzeugt aus dem Code und einem neuen Schlüssel die Anfrage an
//!    `POST /api/v1/zugang/redeem`. Der Code selbst geht nie über die Leitung.
//! 3. [`finish_redeem`] prüft die Antwort und liefert die [`Credentials`] (Schlüsseldatei).
//! 4. Jede Anfrage trägt `Authorization: Machine <jws>` aus [`Credentials::sign_request`].
//!
//! Absichtlich unabhängig vom Server implementiert: Die Testvektoren
//! (`docs/api/machine-auth-testvektoren.json`) beweisen, dass eine zweite Implementierung nach
//! der Doku auf dasselbe JWS kommt.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// `typ` einer Anfrage.
pub const TYP_REQUEST: &str = "lifeline-machine+jwt";
/// `typ` einer Antwort der Instanz.
pub const TYP_RESPONSE: &str = "lifeline-machine-response+jwt";
/// Schema im Kopf `Authorization`.
pub const SCHEME: &str = "Machine";
/// Kopf, der die Antwortsignatur trägt.
pub const RESPONSE_HEADER: &str = "Lifeline-Signature";

/// Wert von `?karte=`, mit dem `GET /api/v1/lage` die Karte weglässt.
pub const KARTE_NONE: &str = "none";
/// Höchste Lebensdauer eines Tokens in Sekunden.
pub const LIFETIME_S: i64 = 60;
/// Erlaubte Abweichung der Uhren in Sekunden.
pub const CLOCK_TOLERANCE_S: i64 = 300;
/// Salz der Code-Ableitung.
pub const SALT: &[u8] = b"lifeline-machine-client/1";

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Base64url ohne Auffüllung.
pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn parse_b64(text: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(text).ok()
}

fn sha256_b64(bytes: &[u8]) -> String {
    b64(&Sha256::digest(bytes))
}

/// Was schiefging. Der Server nennt nach außen keinen Grund (immer 401); diese Fehler entstehen
/// nur im Client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Code hat nicht 16 Zeichen Crockford-Base32.
    InvalidCode,
    /// Antwort aufs Einlösen trägt einen Prüfwert, der nicht passt: nicht diese Instanz oder
    /// verändert.
    InvalidProof,
    /// Schlüssel oder Token unlesbar.
    Malformed,
    /// Signatur, Ziel, Bezug, Status, Body oder Zeit der Antwort passen nicht.
    InvalidResponse(&'static str),
    /// Fehler beim HTTP-Aufruf (Feature `http`).
    Http(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::InvalidCode => f.write_str("Code hat nicht 16 Zeichen"),
            Error::InvalidProof => f.write_str("Prüfwert der Instanz passt nicht"),
            Error::Malformed => f.write_str("Schlüssel oder Token unlesbar"),
            Error::InvalidResponse(w) => write!(f, "Antwortsignatur ungültig: {w}"),
            Error::Http(e) => write!(f, "HTTP: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// Normalform eines Codes: Großbuchstaben, ohne Leerzeichen und Bindestriche, `O` als `0`, `I`
/// und `L` als `1`. Genau 16 Zeichen.
pub fn normalize_code(input: &str) -> Result<String, Error> {
    let mut out = String::with_capacity(16);
    for c in input.chars() {
        let c = match c.to_ascii_uppercase() {
            ' ' | '-' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        if !c.is_ascii() || !ALPHABET.contains(&(c as u8)) {
            return Err(Error::InvalidCode);
        }
        out.push(c);
    }
    if out.len() == 16 {
        Ok(out)
    } else {
        Err(Error::InvalidCode)
    }
}

/// Die drei aus dem Code abgeleiteten Werte (HKDF-SHA256, Salz [`SALT`], Infos `suche`,
/// `einloeser`, `aussteller`, je 32 Byte).
#[derive(Clone)]
pub struct CodeDerivation {
    /// Geht als `lookup` über die Leitung.
    pub lookup: String,
    k_redeemer: [u8; 32],
    k_issuer: [u8; 32],
}

impl std::fmt::Debug for CodeDerivation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CodeDerivation")
            .field("lookup", &self.lookup)
            .finish_non_exhaustive()
    }
}

fn expand(hk: &Hkdf<Sha256>, info: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    hk.expand(info, &mut out).expect("32 Byte passen");
    out
}

/// Leitet aus einem Code (beliebige Schreibweise) `lookup` und die Prüfschlüssel ab.
pub fn derive_code(code: &str) -> Result<CodeDerivation, Error> {
    let code = normalize_code(code)?;
    let hk = Hkdf::<Sha256>::new(Some(SALT), code.as_bytes());
    Ok(CodeDerivation {
        lookup: b64(&expand(&hk, b"suche")),
        k_redeemer: expand(&hk, b"einloeser"),
        k_issuer: expand(&hk, b"aussteller"),
    })
}

/// Kennung, dann je Teil seine Länge (u32, Big Endian) und seine Bytes.
fn transcript(label: &[u8], parts: &[&str]) -> Vec<u8> {
    let mut t = label.to_vec();
    for p in parts {
        t.extend_from_slice(&(p.len() as u32).to_be_bytes());
        t.extend_from_slice(p.as_bytes());
    }
    t
}

fn hmac_b64(key: &[u8; 32], data: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("jede Länge");
    mac.update(data);
    b64(&mac.finalize().into_bytes())
}

fn hmac_valid(key: &[u8; 32], data: &[u8], received: &str) -> bool {
    let Some(bytes) = parse_b64(received) else {
        return false;
    };
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("jede Länge");
    mac.update(data);
    mac.verify_slice(&bytes).is_ok()
}

/// Öffentlicher Ed25519-Schlüssel als JWK (RFC 8037).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Jwk {
    pub kty: String,
    pub crv: String,
    pub x: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
}

impl Jwk {
    pub fn ed25519(public_key: &[u8; 32]) -> Self {
        Jwk {
            kty: "OKP".into(),
            crv: "Ed25519".into(),
            x: b64(public_key),
            kid: None,
        }
    }

    fn verifying_key(&self) -> Result<VerifyingKey, Error> {
        if self.kty != "OKP" || self.crv != "Ed25519" {
            return Err(Error::Malformed);
        }
        let bytes: [u8; 32] = parse_b64(&self.x)
            .and_then(|b| b.try_into().ok())
            .ok_or(Error::Malformed)?;
        VerifyingKey::from_bytes(&bytes).map_err(|_| Error::Malformed)
    }
}

/// Body von `POST /api/v1/zugang/redeem`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedeemRequest {
    pub lookup: String,
    pub public_key: Jwk,
    pub proof: String,
}

/// Antwort auf `POST /api/v1/zugang/redeem`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RedeemResponse {
    pub zugang_id: String,
    pub instanz_id: String,
    pub instanz_public_key: Jwk,
    pub proof: String,
}

/// Transkript, das das Fremdsystem beim Einlösen bindet.
pub fn transcript_redeemer(lookup: &str, public_key_b64: &str) -> Vec<u8> {
    transcript(b"machine-einloeser", &[lookup, public_key_b64])
}

/// Transkript, das die Instanz in ihrer Antwort bindet.
pub fn transcript_issuer(
    lookup: &str,
    public_key_b64: &str,
    instanz_id: &str,
    instanz_public_key_b64: &str,
    zugang_id: &str,
) -> Vec<u8> {
    transcript(
        b"machine-aussteller",
        &[
            lookup,
            public_key_b64,
            instanz_id,
            instanz_public_key_b64,
            zugang_id,
        ],
    )
}

/// Erzeugt einen neuen privaten Schlüssel (32 Zufallsbytes).
pub fn generate_key() -> SigningKey {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("Zufall des Betriebssystems");
    SigningKey::from_bytes(&seed)
}

/// Baut die Anfrage zum Einlösen.
pub fn prepare_redeem(
    code: &str,
    key: &SigningKey,
) -> Result<(CodeDerivation, RedeemRequest), Error> {
    let d = derive_code(code)?;
    let public = key.verifying_key().to_bytes();
    let proof = hmac_b64(
        &d.k_redeemer,
        &transcript_redeemer(&d.lookup, &b64(&public)),
    );
    let request = RedeemRequest {
        lookup: d.lookup.clone(),
        public_key: Jwk::ed25519(&public),
        proof,
    };
    Ok((d, request))
}

/// Prüft die Antwort aufs Einlösen und liefert die Zugangsdaten. Scheitert, wenn die Instanz den
/// Code nicht kennt (also nicht die ist, bei der der Admin ihn ausgestellt hat).
pub fn finish_redeem(
    derivation: &CodeDerivation,
    key: &SigningKey,
    base_url: &str,
    response: &RedeemResponse,
) -> Result<Credentials, Error> {
    let public = b64(&key.verifying_key().to_bytes());
    let t = transcript_issuer(
        &derivation.lookup,
        &public,
        &response.instanz_id,
        &response.instanz_public_key.x,
        &response.zugang_id,
    );
    if !hmac_valid(&derivation.k_issuer, &t, &response.proof) {
        return Err(Error::InvalidProof);
    }
    response.instanz_public_key.verifying_key()?;
    Ok(Credentials {
        zugang_id: response.zugang_id.clone(),
        instanz_id: response.instanz_id.clone(),
        base_url: base_url.trim_end_matches('/').to_string(),
        private_key: b64(&key.to_bytes()),
        public_key: public,
        instanz_public_key: response.instanz_public_key.x.clone(),
    })
}

/// Fingerabdruck eines öffentlichen Schlüssels, wie ihn die Seite „Anbindungen“ zeigt: die ersten
/// 20 Byte von SHA-256 in Crockford-Base32, Vierergruppen.
pub fn fingerprint(public_key: &[u8]) -> String {
    let hash = Sha256::digest(public_key);
    let mut text = String::new();
    let (mut buf, mut bits) = (0u32, 0);
    for b in &hash[..20] {
        buf = (buf << 8) | u32::from(*b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            text.push(ALPHABET[((buf >> bits) & 0x1f) as usize] as char);
        }
    }
    text.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).expect("ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Kopf eines Tokens; die Reihenfolge der Felder ist die der Testvektoren.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Header {
    alg: String,
    typ: String,
    kid: String,
}

/// Claims einer Anfrage, in der Reihenfolge der Testvektoren.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestClaims {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub htm: String,
    pub htu: String,
    pub bh: String,
}

/// Claims einer Antwort der Instanz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResponseClaims {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub exp: i64,
    pub jti: String,
    pub req: String,
    pub status: u16,
    pub bh: String,
}

fn sign_compact<C: Serialize>(key: &SigningKey, typ: &str, kid: &str, claims: &C) -> String {
    let header = Header {
        alg: "EdDSA".into(),
        typ: typ.into(),
        kid: kid.into(),
    };
    let input = format!(
        "{}.{}",
        b64(&serde_json::to_vec(&header).expect("serialisierbar")),
        b64(&serde_json::to_vec(claims).expect("serialisierbar"))
    );
    let sig: Signature = key.sign(input.as_bytes());
    format!("{input}.{}", b64(&sig.to_bytes()))
}

/// Neue zufällige `jti` (128 Bit, Base64url).
pub fn new_jti() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("Zufall des Betriebssystems");
    b64(&b)
}

/// Zugangsdaten eines Fremdsystems; als JSON die Schlüsseldatei. Der private Schlüssel steht
/// darin, die Datei gehört nur dem Besitzer lesbar abgelegt.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credentials {
    pub zugang_id: String,
    pub instanz_id: String,
    pub base_url: String,
    /// Base64url der 32 Bytes des privaten Schlüssels.
    pub private_key: String,
    pub public_key: String,
    pub instanz_public_key: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("zugang_id", &self.zugang_id)
            .field("instanz_id", &self.instanz_id)
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl Credentials {
    fn signing_key(&self) -> Result<SigningKey, Error> {
        let bytes: [u8; 32] = parse_b64(&self.private_key)
            .and_then(|b| b.try_into().ok())
            .ok_or(Error::Malformed)?;
        Ok(SigningKey::from_bytes(&bytes))
    }

    /// Fingerabdruck des eigenen Schlüssels, zum Vergleich mit der Seite „Anbindungen“.
    pub fn fingerprint(&self) -> Result<String, Error> {
        Ok(fingerprint(&self.signing_key()?.verifying_key().to_bytes()))
    }

    /// Signiert eine Anfrage. `path_and_query` ist der Pfad ab `/api/v1/` samt Abfrage, genau so,
    /// wie er gesendet wird. Liefert den Wert für `Authorization`.
    pub fn sign_request(
        &self,
        method: &str,
        path_and_query: &str,
        body: &[u8],
        now: i64,
        jti: &str,
    ) -> Result<String, Error> {
        let claims = RequestClaims {
            iss: self.zugang_id.clone(),
            aud: self.instanz_id.clone(),
            iat: now,
            exp: now + LIFETIME_S,
            jti: jti.into(),
            htm: method.to_ascii_uppercase(),
            htu: path_and_query.into(),
            bh: sha256_b64(body),
        };
        let token = sign_compact(&self.signing_key()?, TYP_REQUEST, &self.zugang_id, &claims);
        Ok(format!("{SCHEME} {token}"))
    }

    /// Prüft die Antwortsignatur (Kopf [`RESPONSE_HEADER`]) gegen den Instanzschlüssel aus dem
    /// Einlösen. Freiwillig, aber empfohlen.
    pub fn verify_response(
        &self,
        token: &str,
        request_jti: &str,
        status: u16,
        body: &[u8],
        now: i64,
    ) -> Result<ResponseClaims, Error> {
        let key = Jwk::ed25519(
            &parse_b64(&self.instanz_public_key)
                .and_then(|b| b.try_into().ok())
                .ok_or(Error::Malformed)?,
        )
        .verifying_key()?;
        let parts: Vec<&str> = token.split('.').collect();
        let [h, c, s] = parts.as_slice() else {
            return Err(Error::Malformed);
        };
        let header: Header = parse_b64(h)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or(Error::Malformed)?;
        if header.alg != "EdDSA" || header.typ != TYP_RESPONSE {
            return Err(Error::InvalidResponse("Typ"));
        }
        let sig: [u8; 64] = parse_b64(s)
            .and_then(|b| b.try_into().ok())
            .ok_or(Error::Malformed)?;
        key.verify_strict(format!("{h}.{c}").as_bytes(), &Signature::from_bytes(&sig))
            .map_err(|_| Error::InvalidResponse("Signatur"))?;
        let claims: ResponseClaims = parse_b64(c)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or(Error::Malformed)?;
        if claims.iss != self.instanz_id || claims.aud != self.zugang_id {
            return Err(Error::InvalidResponse("Ziel"));
        }
        if claims.req != request_jti {
            return Err(Error::InvalidResponse("Bezug"));
        }
        if claims.status != status {
            return Err(Error::InvalidResponse("Status"));
        }
        if claims.bh != sha256_b64(body) {
            return Err(Error::InvalidResponse("Body"));
        }
        let lebt = claims.exp > claims.iat
            && claims.exp.saturating_sub(claims.iat) <= LIFETIME_S
            && claims.iat <= now.saturating_add(CLOCK_TOLERANCE_S)
            && claims.exp >= now.saturating_sub(CLOCK_TOLERANCE_S);
        if !lebt {
            return Err(Error::InvalidResponse("Zeit"));
        }
        Ok(claims)
    }
}

#[cfg(feature = "http")]
mod http;
#[cfg(feature = "http")]
pub use http::{lage, me, redeem};

#[cfg(test)]
mod vektoren;
